import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { StudioError } from '../shared/common/core.mjs';
import { docx } from '../shared/common/documents.mjs';
import { validateJob, validateRequest } from '../shared/common/formats.mjs';
import { validateReview } from '../shared/common/review.mjs';
import { summary } from '../shared/common/summary.mjs';
import { buildFile } from '../shared/service/builders/index.mjs';
import { StudioJobs } from '../shared/service/jobs.mjs';
import { readRecord } from '../shared/service/storage.mjs';

// Controlled transports only. Every fixture, history record and exported file stays in temp/.
const chosen = { providerID: 'unit-test', id: 'chosen', variant: 'plain' };
const fallback = { providerID: 'unit-test', id: 'fallback' };
const sources = [
  { path: 'notes/pond.md', content: 'The south pond had 12 frogs during one visit, not an annual count.' },
  { path: 'limits.txt', content: 'The north pond was not surveyed.' },
];
const draftText = '# Draft-only working title\n\nThe south pond had 12 frogs.\n';
const criticism = '- Explain the single-visit limit in Pond, and include the unsurveyed north pond from Limits. Private-criticism-marker.';
const finalText = '# Pond visit\n\nOne visit counted 12 frogs at the south pond. The north pond was not surveyed.\n';
const request = (extra = {}) => ({
  id: randomUUID(), format: 'summary', sources, model: chosen,
  instructions: 'Use plain words and preserve the single-visit limitation.', choice: 'short', ...extra,
});
const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
const payload = (prompt) => JSON.parse(prompt.split('\n').at(-1));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function directory() {
  const parent = fileURLToPath(new URL('../temp/', import.meta.url));
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, 'second-pass-test-'));
}
async function settle(jobs, root, id) {
  for (let count = 0; count < 500; count += 1) {
    const record = await jobs.get(root, id);
    if (!['queued', 'running'].includes(record.status)) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The controlled Second pass transport did not settle.');
}
function transport(replies) {
  const calls = [];
  return {
    calls,
    generate: async (prompt, model, signal) => {
      const index = calls.length;
      calls.push({ prompt, model: structuredClone(model), signal });
      const reply = replies[index];
      if (reply instanceof Error) throw reply;
      if (typeof reply === 'function') return reply({ prompt, model, signal });
      if (reply === undefined) throw new Error('Unexpected extra model call.');
      return { text: reply };
    },
  };
}
function assertEmpty(record) {
  for (const key of ['title', 'markdown', 'artifact', 'file']) assert.equal(record[key], null, key);
  assert.deepEqual(record.notes, []);
}
function assertPrivate(record) {
  const encoded = JSON.stringify(record);
  for (const text of ['Draft-only', 'Private-criticism-marker', 'private-provider-error', 'Discarded-only']) assert.ok(!encoded.includes(text), text);
}
const outcomes = (record) => record.attempts.map(({ stage, model, outcome }) => [stage, model.id, outcome]);

test('Second pass is a strict boolean, enabled by default in both request contracts', () => {
  for (const validate of [validateRequest, validateJob]) {
    assert.equal(validate(request()).secondPass, true);
    assert.equal(validate(request({ secondPass: true })).secondPass, true);
    assert.equal(validate(request({ secondPass: false })).secondPass, false);
    for (const value of [null, 0, 1, 'true', 'false', {}, []]) {
      assert.throws(() => validate(request({ secondPass: value })), (error) => error instanceof StudioError);
    }
  }
});

test('default-enabled jobs make draft, review and revision calls, publishing only the final summary', async () => {
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const mock = transport([draftText, criticism, finalText]);
  await jobs.start(root, input, mock.generate);
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed', JSON.stringify(record.error));
  assert.equal(record.secondPass, true);
  assert.equal(record.markdown, finalText);
  assert.equal(mock.calls.length, 3);
  assert.deepEqual(outcomes(record), [['draft', 'chosen', 'completed'], ['review', 'chosen', 'completed'], ['revision', 'chosen', 'completed']]);
  assert.deepEqual(record.model, chosen);
  assertPrivate(record);

  const original = summary.prompt(validateJob(input));
  assert.equal(mock.calls[0].prompt, original);
  assert.equal(payload(mock.calls[1].prompt).originalTask, original);
  assert.deepEqual(payload(mock.calls[1].prompt).validatedDraft, { content: draftText, validationNotes: [] });
  assert.ok(mock.calls[2].prompt.startsWith(original));
  assert.equal(payload(mock.calls[2].prompt).criticism, criticism);
  assert.match(mock.calls[1].prompt, /concise, actionable criticism/);
  assert.match(mock.calls[1].prompt, /never claim to have inspected/);
  assert.match(mock.calls[2].prompt, /Reject criticism inconsistent with source facts/);
  assert.match(mock.calls[2].prompt, /complete final creation in the normal response format and exact schema/);
  const saved = await jobs.save(root, input.id);
  assert.equal(await fs.readFile(path.join(root, saved.savedPath), 'utf8'), finalText);
  const restored = await new StudioJobs().get(root, input.id);
  assert.deepEqual(restored.attempts, record.attempts);
  assert.equal(restored.secondPass, true);
  assertPrivate(restored);
});

test('Second pass off keeps one successful creation call and records false', async () => {
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request({ secondPass: false });
  const mock = transport([draftText]);
  await jobs.start(root, input, mock.generate, { fallback });
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed');
  assert.equal(record.secondPass, false);
  assert.equal(mock.calls.length, 1);
  assert.equal(record.markdown, draftText);
  assert.deepEqual(outcomes(record), [['draft', 'chosen', 'completed']]);
  assert.equal((await readRecord(root, input.id)).secondPass, false);
});

// Full Iosevka faces make this real Word build slower than the controlled model calls,
// especially when the document/font suites run in parallel. This is not a model timeout.
test('validated draft notes, original source snapshot and options reach refinement; only the final file is built', { timeout: 60_000 }, async (t) => {
  const root = await directory();
  await fs.mkdir(path.join(root, 'notes'));
  for (const source of sources) await fs.writeFile(path.join(root, source.path), source.content);
  const builtArtifacts = [];
  const jobs = new StudioJobs({ build: async (...args) => {
    builtArtifacts.push(structuredClone(args[1]));
    return buildFile(...args);
  } });
  const draft = { title: 'Draft-only working title', sections: [
    { heading: 'Count', paragraphs: ['The south pond had 12 frogs.'] },
    { heading: 'Discarded-only empty section', paragraphs: [] },
  ] };
  const final = { title: 'Pond visit', sections: [
    { heading: 'One visit', paragraphs: ['A single visit counted 12 frogs at the south pond. The north pond was not surveyed.'] },
  ] };
  const reviewReady = deferred();
  const reviewRelease = deferred();
  const revisionReady = deferred();
  const revisionRelease = deferred();
  t.after(async () => { reviewRelease.resolve(); revisionRelease.resolve(); await jobs.stop(); });
  const input = request({ format: 'docx', sources: sources.map(({ path }) => ({ path })) });
  const original = docx.prompt(validateJob({ ...input, sources }));
  const mock = transport([
    JSON.stringify(draft),
    async () => { reviewReady.resolve(); await reviewRelease.promise; return { text: criticism }; },
    async () => { revisionReady.resolve(); await revisionRelease.promise; return { text: JSON.stringify(final) }; },
  ]);
  await jobs.start(root, input, mock.generate);
  await reviewReady.promise;
  const checked = docx.build(JSON.stringify(draft));
  assert.deepEqual(payload(mock.calls[1].prompt), {
    originalTask: original, validatedDraft: { content: checked.artifact, validationNotes: checked.notes },
  });
  assert.deepEqual(checked.notes, ['Left out 1 empty section.']);
  assert.ok(!mock.calls[1].prompt.includes('Discarded-only'));
  assert.match(original, /up to 3 sections/);
  assert.ok(original.includes(input.instructions));
  for (const source of sources) assert.ok(original.includes(JSON.stringify(source.content)));

  for (const record of [await jobs.get(root, input.id), await readRecord(root, input.id)]) {
    assert.equal(record.status, 'running');
    assertEmpty(record);
    assertPrivate(record);
  }
  assert.deepEqual(builtArtifacts, [], 'the draft must never reach the file builder');
  assert.deepEqual(await fs.readdir(path.join(root, '.studio/documents')), [`${input.id}.json`]);
  assert.equal((await jobs.list(root)).jobs[0].title, null);
  await assert.rejects(jobs.save(root, input.id), { code: 'NOT_READY' });

  // Later UI choices and file edits must not redirect an already submitted job.
  input.secondPass = false;
  input.instructions = 'Late instruction marker';
  input.choice = 'long';
  await fs.writeFile(path.join(root, sources[0].path), 'Late source marker');
  reviewRelease.resolve();
  await revisionReady.promise;
  assert.ok(mock.calls[2].prompt.startsWith(original));
  assert.deepEqual(payload(mock.calls[2].prompt), {
    validatedDraft: { content: checked.artifact, validationNotes: checked.notes }, criticism,
  });
  assert.ok(!mock.calls[2].prompt.includes('Late source marker'));
  assert.ok(!mock.calls[2].prompt.includes('Late instruction marker'));
  assert.equal(builtArtifacts.length, 0);
  assertEmpty(await jobs.get(root, input.id));
  assertPrivate(await readRecord(root, input.id));
  revisionRelease.resolve();

  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed', JSON.stringify(record.error));
  assert.equal(record.secondPass, true);
  assert.equal(record.choice, 'short');
  assert.equal(record.sources[0].md5, md5(sources[0].content));
  assert.deepEqual(builtArtifacts, [docx.build(JSON.stringify(final)).artifact]);
  assert.deepEqual(record.notes, [], 'draft validation notes are private; final notes describe only the final artifact');
  assertPrivate(record);
  assertPrivate(await readRecord(root, input.id));
  const bytes = await fs.readFile(path.join(root, '.studio/documents', record.file.name));
  const document = strFromU8(unzipSync(bytes)['word/document.xml']);
  assert.ok(document.includes('single visit counted 12 frogs'));
  assert.ok(!document.includes('Draft-only') && !document.includes('Private-criticism-marker'));
  assert.equal(md5(bytes), record.file.md5);
  const saved = await jobs.save(root, input.id);
  assert.equal(md5(await fs.readFile(path.join(root, saved.savedPath))), md5(bytes));
});

test('two draft recovery calls consume the shared budget and carry the fallback into both later stages', async () => {
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const mock = transport(['', '', draftText, criticism, finalText]);
  await jobs.start(root, input, mock.generate, { fallback });
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed');
  assert.equal(mock.calls.length, 5);
  assert.deepEqual(outcomes(record), [
    ['draft', 'chosen', 'EMPTY_RESULT'], ['draft', 'chosen', 'EMPTY_RESULT'], ['draft', 'fallback', 'completed'],
    ['review', 'fallback', 'completed'], ['revision', 'fallback', 'completed'],
  ]);
  assert.deepEqual(record.requestedModel, chosen);
  assert.deepEqual(record.model, fallback);
  assertPrivate(record);
});

test('review and revision share two recovery calls instead of receiving a budget per stage', async () => {
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const mock = transport([draftText, new Error('private-provider-error review'), criticism, new Error('private-provider-error revision'), finalText]);
  await jobs.start(root, input, mock.generate, { fallback });
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed');
  assert.equal(mock.calls.length, 5);
  assert.deepEqual(outcomes(record), [
    ['draft', 'chosen', 'completed'], ['review', 'chosen', 'MODEL_FAILED'], ['review', 'chosen', 'completed'],
    ['revision', 'chosen', 'MODEL_FAILED'], ['revision', 'fallback', 'completed'],
  ]);
  assert.equal(mock.calls[1].prompt, mock.calls[2].prompt);
  assert.equal(mock.calls[3].prompt, mock.calls[4].prompt);
  assertPrivate(record);
});

test('review exhaustion fails with no draft output and never begins a revision', async () => {
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const error = new Error('private-provider-error');
  const mock = transport([draftText, error, error, error]);
  await jobs.start(root, input, mock.generate, { fallback });
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'failed');
  assert.equal(record.error.code, 'MODEL_FAILED');
  assert.equal(mock.calls.length, 4);
  assert.deepEqual(outcomes(record), [
    ['draft', 'chosen', 'completed'], ['review', 'chosen', 'MODEL_FAILED'],
    ['review', 'chosen', 'MODEL_FAILED'], ['review', 'fallback', 'MODEL_FAILED'],
  ]);
  assertEmpty(record);
  assertPrivate(record);
  assertEmpty(await readRecord(root, input.id));
  await assert.rejects(jobs.save(root, input.id), { code: 'NOT_READY' });
});

test('an invalid revision after earlier recovery has no new budget and never builds or falls back to the draft', async () => {
  const root = await directory();
  let builds = 0;
  const jobs = new StudioJobs({ build: async () => { builds += 1; throw new Error('No builder should run.'); } });
  const input = request({ format: 'docx' });
  const draft = JSON.stringify({ title: 'Draft-only working title', sections: [{ paragraphs: ['The south pond had 12 frogs.'] }] });
  const mock = transport(['', draft, new Error('private-provider-error review'), criticism, '{"title":"Partial final",']);
  await jobs.start(root, input, mock.generate, { fallback });
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'failed');
  assert.equal(mock.calls.length, 5);
  assert.deepEqual(outcomes(record), [
    ['draft', 'chosen', 'EMPTY_RESULT'], ['draft', 'chosen', 'completed'], ['review', 'chosen', 'MODEL_FAILED'],
    ['review', 'fallback', 'completed'], ['revision', 'fallback', 'BAD_OUTPUT'],
  ]);
  assert.equal(builds, 0);
  assertEmpty(record);
  assertPrivate(record);
  assertEmpty(await readRecord(root, input.id));
  await assert.rejects(fs.access(path.join(root, '.studio/documents', `${input.id}.docx`)));
});

test('a configuration rejection skips a repeat and carries the successful fallback into revision', async () => {
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const mock = transport([draftText, new StudioError('MODEL_CONFIGURATION_REJECTED', 'Rejected.'), criticism, finalText]);
  await jobs.start(root, input, mock.generate, { fallback });
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed');
  assert.equal(mock.calls.length, 4);
  assert.deepEqual(outcomes(record), [
    ['draft', 'chosen', 'completed'], ['review', 'chosen', 'MODEL_CONFIGURATION_REJECTED'],
    ['review', 'fallback', 'completed'], ['revision', 'fallback', 'completed'],
  ]);
});

test('an unavailable distinct fallback does not become repeated calls to the chosen model', async () => {
  for (const secondPass of [true, false]) {
    const root = await directory();
    const jobs = new StudioJobs();
    const input = request({ secondPass });
    const mock = transport(['', '']);
    await jobs.start(root, input, mock.generate, { fallback: { ...chosen } });
    const record = await settle(jobs, root, input.id);
    assert.equal(record.status, 'failed');
    assert.equal(mock.calls.length, 2);
    assert.deepEqual(outcomes(record), [['draft', 'chosen', 'EMPTY_RESULT'], ['draft', 'chosen', 'EMPTY_RESULT']]);
  }
});

test('late review replies after timeout are rejected and use the shared recovery budget', async (t) => {
  const timers = [];
  t.mock.method(AbortSignal, 'timeout', () => {
    const timer = new AbortController();
    timers.push(timer);
    return timer.signal;
  });
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const mock = transport([draftText, () => {
    timers.at(-1).abort();
    return { text: 'Late private criticism must not be used.' };
  }, criticism, finalText]);
  await jobs.start(root, input, mock.generate, { fallback });
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed');
  assert.equal(mock.calls.length, 4);
  assert.equal(mock.calls[1].signal.aborted, true);
  assert.deepEqual(outcomes(record), [
    ['draft', 'chosen', 'completed'], ['review', 'chosen', 'MODEL_TIMEOUT'],
    ['review', 'chosen', 'completed'], ['revision', 'chosen', 'completed'],
  ]);
  assert.equal(payload(mock.calls.at(-1).prompt).criticism, criticism);
  assertPrivate(record);
});

test('invalid or oversized criticism is refused without truncation and cannot become final content', async () => {
  assert.throws(() => validateReview(''), { code: 'EMPTY_RESULT' });
  assert.throws(() => validateReview('x'.repeat(6_001)), { code: 'OUTPUT_TOO_LARGE' });
  assert.throws(() => validateReview('Bad\0criticism'), { code: 'BAD_OUTPUT' });
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const mock = transport([draftText, 'x'.repeat(6_001), 'Bad\0criticism']);
  await jobs.start(root, input, mock.generate);
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'failed');
  assert.equal(mock.calls.length, 3);
  assert.deepEqual(outcomes(record), [
    ['draft', 'chosen', 'completed'], ['review', 'chosen', 'OUTPUT_TOO_LARGE'], ['review', 'chosen', 'BAD_OUTPUT'],
  ]);
  assertEmpty(record);
  assertPrivate(record);
});

for (const cancelledStage of ['review', 'revision']) {
  test(`cancelling ${cancelledStage} records the actual attempt and discards even a late reply`, { timeout: 10_000 }, async (t) => {
    const root = await directory();
    let builds = 0;
    const jobs = new StudioJobs({ build: async () => { builds += 1; throw new Error('No builder should run.'); } });
    const input = request({ format: 'docx' });
    const draft = JSON.stringify({ title: 'Draft-only working title', sections: [{ paragraphs: ['Draft-only content.'] }] });
    const reached = deferred();
    const release = deferred();
    const returned = deferred();
    const blocked = async ({ signal }) => {
      reached.resolve(signal);
      await release.promise; // Deliberately ignore cancellation to simulate a late provider reply.
      returned.resolve();
      return { text: cancelledStage === 'review' ? criticism : draft };
    };
    const mock = transport(cancelledStage === 'review' ? [draft, blocked] : [draft, criticism, blocked]);
    t.after(async () => { release.resolve(); await jobs.stop(); });
    await jobs.start(root, input, mock.generate, { fallback });
    const signal = await reached.promise;
    const cancelled = await jobs.cancel(root, input.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(signal.aborted, true);
    assertEmpty(cancelled);
    assertPrivate(cancelled);
    assert.deepEqual(cancelled.attempts.at(-1), { stage: cancelledStage, model: chosen, outcome: 'cancelled' });
    release.resolve();
    await returned.promise;
    await new Promise((resolve) => setImmediate(resolve));
    const record = await jobs.get(root, input.id);
    assert.equal(record.status, 'cancelled');
    assertEmpty(record);
    assertPrivate(record);
    assert.equal(mock.calls.length, cancelledStage === 'review' ? 2 : 3);
    assert.equal(builds, 0);
    assertEmpty(await readRecord(root, input.id));
    assert.deepEqual(await fs.readdir(path.join(root, '.studio/documents')), [`${input.id}.json`]);
    await assert.rejects(jobs.save(root, input.id), { code: 'NOT_READY' });
  });
}

test('stopping during revision records an interrupted attempt without publishing the draft', { timeout: 10_000 }, async (t) => {
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const reached = deferred();
  const mock = transport([draftText, criticism, ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('private-provider-error interrupted')), { once: true });
    reached.resolve();
  })]);
  t.after(() => jobs.stop());
  await jobs.start(root, input, mock.generate);
  await reached.promise;
  await jobs.stop();
  const record = await jobs.get(root, input.id);
  assert.equal(record.status, 'interrupted');
  assert.deepEqual(record.attempts.at(-1), { stage: 'revision', model: chosen, outcome: 'interrupted' });
  assertEmpty(record);
  assertPrivate(record);
  assert.equal(mock.calls.length, 3);
});

test('a final builder failure retries revision only, and builder errors cannot leak private content', async (t) => {
  const root = await directory();
  const builtArtifacts = [];
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const jobs = new StudioJobs({ build: async (_format, artifact) => {
    builtArtifacts.push(artifact);
    if (builtArtifacts.length === 1) throw new Error('private-provider-error builder with draft body');
    return { bytes: Buffer.from('Controlled final binary'), notes: [] };
  } });
  const input = request({ format: 'docx' });
  const document = (title) => JSON.stringify({ title, sections: [{ paragraphs: ['Source-supported text.'] }] });
  const mock = transport([document('Draft-only working title'), criticism, document('Revised attempt'), document('Final revision')]);
  await jobs.start(root, input, mock.generate, { fallback });
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed');
  assert.equal(mock.calls.length, 4);
  assert.deepEqual(builtArtifacts.map(({ title }) => title), ['Revised attempt', 'Final revision']);
  assert.deepEqual(outcomes(record), [
    ['draft', 'chosen', 'completed'], ['review', 'chosen', 'completed'],
    ['revision', 'chosen', 'BUILD_FAILED'], ['revision', 'chosen', 'completed'],
  ]);
  assert.ok(logs.length > 0 && logs.every((line) => !line.includes('private-provider-error')));
  assertPrivate(record);
});

test('cancelling while the final file is building leaves no output or binary file', { timeout: 10_000 }, async (t) => {
  const root = await directory();
  const reached = deferred();
  const release = deferred();
  const builtArtifacts = [];
  const jobs = new StudioJobs({ build: async (_format, artifact) => {
    builtArtifacts.push(artifact);
    reached.resolve();
    await release.promise;
    return { bytes: Buffer.from('Controlled final binary'), notes: [] };
  } });
  t.after(async () => { release.resolve(); await jobs.stop(); });
  const input = request({ format: 'docx' });
  const document = (title) => JSON.stringify({ title, sections: [{ paragraphs: ['Source-supported text.'] }] });
  const mock = transport([document('Draft-only working title'), criticism, document('Final revision')]);
  await jobs.start(root, input, mock.generate);
  await reached.promise;
  assert.deepEqual(builtArtifacts.map(({ title }) => title), ['Final revision']);
  assertEmpty(await jobs.get(root, input.id));
  await jobs.cancel(root, input.id);
  release.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  const record = await jobs.get(root, input.id);
  assert.equal(record.status, 'cancelled');
  assertEmpty(record);
  assertPrivate(record);
  await assert.rejects(fs.access(path.join(root, '.studio/documents', `${input.id}.docx`)));
});

test('simultaneous, in-flight and persisted duplicate requests share one full pipeline', { timeout: 10_000 }, async (t) => {
  const root = await directory();
  const jobs = new StudioJobs();
  const input = request();
  const reached = deferred();
  const release = deferred();
  const mock = transport([draftText, async () => {
    reached.resolve();
    await release.promise;
    return { text: criticism };
  }, finalText]);
  t.after(async () => { release.resolve(); await jobs.stop(); });
  const submitted = await Promise.all(Array.from({ length: 3 }, () => jobs.start(root, input, mock.generate)));
  assert.ok(submitted.every((record) => record.id === input.id));
  await reached.promise;
  const duplicate = await jobs.start(root, { ...input, secondPass: true }, mock.generate);
  assert.equal(duplicate.status, 'running');
  assertEmpty(duplicate);
  await assert.rejects(jobs.start(root, { ...input, secondPass: false }, mock.generate), { code: 'JOB_CONFLICT' });
  assert.equal(mock.calls.length, 2);
  release.resolve();
  const record = await settle(jobs, root, input.id);
  assert.equal(record.status, 'completed');
  await jobs.start(root, input, mock.generate);
  await new StudioJobs().start(root, input, mock.generate);
  assert.equal(mock.calls.length, 3);
  assert.equal((await jobs.list(root)).total, 1);
  assertPrivate(record);
});
