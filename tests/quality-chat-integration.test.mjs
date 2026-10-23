import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { countWords } from '../shared/common/sources.mjs';
import { StudioJobs } from '../shared/service/jobs.mjs';

test('long-chat compression happens once before the three-stage quality pipeline and keeps word metadata', async () => {
  const temp = fileURLToPath(new URL('../temp/', import.meta.url));
  await fs.mkdir(temp, { recursive: true });
  const directory = await fs.mkdtemp(path.join(temp, 'quality-chat-'));
  const summary = 'The measured result came from one visit, not a yearly survey.';
  let summaries = 0;
  const connection = {
    agent: 'build',
    chatContext: async () => [{ type: 'user', text: 'word '.repeat(25_000).trim() }],
    summarizeChat: async () => { summaries += 1; return summary; },
  };
  const replies = ['# Draft\n\nA measured result.', '- Preserve the single-visit qualification.', '# Final\n\nThe measured result came from one visit, not a yearly survey.'];
  const prompts = [];
  const jobs = new StudioJobs();
  const id = randomUUID();
  await jobs.start(directory, { id, format: 'summary', sources: [{ path: 'notes.md', content: 'The result is a measurement.' }], chat: true,
    model: { providerID: 'unit-test', id: 'quality' } }, async prompt => {
    prompts.push(prompt);
    return { text: replies[prompts.length - 1] };
  }, { connection });
  let record;
  for (let i = 0; i < 300; i += 1) {
    record = await jobs.get(directory, id);
    if (!['queued', 'running'].includes(record.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(record.status, 'completed', JSON.stringify(record.error));
  assert.equal(record.secondPass, true);
  assert.equal(summaries, 1);
  assert.equal(prompts.length, 3);
  assert.ok(prompts.every(prompt => prompt.includes(summary)));
  assert.equal(record.chat.how, 'compressed');
  assert.equal(record.chat.fullWords, 25_001); // The transcript also includes the User: label.
  assert.equal(record.chat.words, countWords(summary));
  assert.equal(record.chat.characters, summary.length);
  assert.equal(record.markdown, `${replies[2]}\n`);
  assert.deepEqual(record.attempts.map(attempt => attempt.stage), ['draft', 'review', 'revision']);
  // Keep the generated fixture; this test uses no real model and deletes no files.
});
