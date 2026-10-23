import { createHash } from 'node:crypto';
import { LIMITS, modelKey, StudioError } from '../common/core.mjs';
import { formatFor, validateJob, validateRequest } from '../common/formats.mjs';
import { reviewPrompt, revisionPrompt, validateReview } from '../common/review.mjs';
import { CHAT_SOURCE } from '../common/sources.mjs';
import { chatSource } from './chat.mjs';
import { readSourceOrExplain } from './sources.mjs';
import { buildFile, fileMeta } from './builders/index.mjs';
import { embeddedFontCss } from './fonts.mjs';
import { exportFile, exportUnique, listRecords, readArtifactFile, readRecord, writeArtifactFile, writeRecord } from './storage.mjs';

// Generous for 12 sections or 15 slides of text; a larger file means something went wrong.
const FILE_BYTES = 20 * 1024 * 1024;
// Jobs that may run at once in one project, and the time one model call may take.
const PARALLEL = 3;
const ATTEMPT_MS = 240_000;
// Failures another try can plausibly fix. Configuration and storage problems are not retried.
const RETRYABLE = new Set(['BAD_OUTPUT', 'EMPTY_RESULT', 'OUTPUT_TOO_LARGE', 'MODEL_FAILED', 'MODEL_TIMEOUT', 'MODEL_CONFIGURATION_REJECTED', 'BUILD_FAILED']);

const unfinished = (record) => ['queued', 'running'].includes(record.status);
const sameDirectory = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const digest = (text) => createHash('md5').update(text).digest('hex');
const clearOutput = (record) => Object.assign(record, { title: null, markdown: null, artifact: null, notes: [], file: null });

export class StudioJobs {
  #active = new Map();
  #starts = new Map();
  #locks = new Map();
  #uploads = new Map();
  #buildFile;

  constructor({ build = buildFile } = {}) {
    this.#buildFile = build;
  }

  // `fallback` is an optional known-good model used once if the chosen model keeps failing.
  // `connection` supplies the chat when the request ticks it. File text is read here, in the
  // job, so the panel sends only paths and slow reads (PDFs, chat summaries) never block it.
  async start(directory, raw, generate, { fallback = null, connection = null } = {}) {
    const request = validateRequest(raw);
    // Concurrent deliveries of the same request must share one job, including while its
    // initial record is being written. Capture the options before waiting for that write.
    const key = `${process.platform === 'win32' ? directory.toLowerCase() : directory}\0${request.id}`;
    const previous = this.#starts.get(key) ?? Promise.resolve();
    const recoveryModel = fallback ? structuredClone(fallback) : null;
    const started = previous.catch(() => {}).then(() => this.#start(directory, request, generate, recoveryModel, connection));
    this.#starts.set(key, started);
    try { return await started; }
    finally { if (this.#starts.get(key) === started) this.#starts.delete(key); }
  }

  async #start(directory, request, generate, fallback, connection) {
    const format = formatFor(request.format);
    const fingerprint = digest(JSON.stringify(request));
    try {
      const previous = await this.get(directory, request.id);
      if (previous.fingerprint !== fingerprint) throw new StudioError('JOB_CONFLICT', 'This job identifier belongs to another request.', 409);
      return previous;
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
    }
    if ([...this.#active.values()].filter((job) => sameDirectory(job.directory, directory)).length >= PARALLEL) {
      throw new StudioError('BUSY', `Studio is already making ${PARALLEL} things in this project. Wait for one to finish.`, 409);
    }
    const label = [...request.sources.map((source) => source.path), ...(request.chat ? ['this chat'] : [])];
    const record = {
      version: 1, id: request.id, format: format.key, status: 'queued',
      createdAt: new Date().toISOString(), ownerPid: process.pid, fingerprint,
      // Filled in with sizes and MD5s once the sources are read.
      source: { path: label.length === 1 ? label[0] : `${label[0]} + ${label.length - 1} more` },
      sources: request.sources.map((source) => ({ path: source.path })), chat: request.chat ? { how: 'pending' } : null,
      instructions: request.instructions, choice: request.choice, secondPass: request.secondPass, agent: connection?.agent ?? null,
      model: request.model, requestedModel: request.model, attempts: [],
      title: null, markdown: null, artifact: null, notes: [], file: null, progress: null, savedPath: null, error: null,
    };
    const controller = new AbortController();
    const job = { directory, record, controller };
    this.#active.set(record.id, job);
    try {
      await writeRecord(directory, record, true);
    } catch (error) {
      this.#active.delete(record.id);
      throw error;
    }
    job.finished = this.#run(job, request, format, generate, fallback, connection);
    return this.public(record);
  }

  // Reads every ticked file (and the chat) into the model input. A file that cannot be read
  // stops the job with a message naming it; nothing is skipped silently.
  async #resolve(job, request, connection) {
    const { directory, record, controller } = job;
    const sources = [];
    for (const source of request.sources) {
      if (source.content !== undefined) { sources.push(source); continue; }
      const { text, error } = await readSourceOrExplain(directory, source.path);
      if (error) throw new StudioError(error.code, error.message);
      sources.push({ path: source.path, content: text });
    }
    if (request.chat) {
      if (!connection) throw new StudioError('NO_CHAT', 'Open the chat in OpenChamber to include it.');
      const chat = await chatSource(connection, controller.signal);
      record.chat = { how: chat.how, characters: chat.characters, words: chat.words, md5: chat.md5,
        ...(chat.fullCharacters ? { fullCharacters: chat.fullCharacters } : {}),
        ...(Number.isFinite(chat.fullWords) ? { fullWords: chat.fullWords } : {}) };
      sources.push({ path: CHAT_SOURCE, content: chat.content });
    }
    const input = validateJob({ ...request, sources });
    record.sources = input.sources.filter((source) => source.path !== CHAT_SOURCE).map((source) => ({ path: source.path, characters: source.content.length, md5: digest(source.content) }));
    record.source = { ...record.source, characters: input.source.content.length, md5: digest(input.source.content) };
    return input;
  }

  // One actual model call. Drafts and criticism stay local to #run; only the last stage
  // may invoke a file builder, and even its output stays private until it is ready.
  async #attempt(job, input, format, generate, model, stage, prompt, final) {
    const { directory, record, controller } = job;
    if (controller.signal.aborted) return;
    const timeout = AbortSignal.timeout(ATTEMPT_MS);
    const attempt = { stage, model, outcome: 'running' };
    record.attempts.push(attempt);
    try {
      let text;
      try {
        ({ text } = await generate(prompt, model, AbortSignal.any([controller.signal, timeout])));
      } catch (error) {
        // Provider errors can contain request bodies or credentials. Only our own messages leave the service.
        if (timeout.aborted) throw new StudioError('MODEL_TIMEOUT', 'Generation timed out. The provider may have billed work already started.');
        if (error instanceof StudioError) throw error;
        throw new StudioError('MODEL_FAILED', 'Generation failed. Check this model and its connection in OpenChamber.');
      }
      if (controller.signal.aborted) return;
      // A late reply from a transport that ignored the timeout cannot complete the attempt.
      if (timeout.aborted) throw new StudioError('MODEL_TIMEOUT', 'Generation timed out. The provider may have billed work already started.');
      if (typeof text !== 'string' || !text.trim()) {
        throw new StudioError('EMPTY_RESULT', 'The model returned no text.');
      }
      if (text.length > LIMITS.output) throw new StudioError('OUTPUT_TOO_LARGE', 'The model response exceeds this build\'s output limit. It was not truncated.');
      if (stage === 'review') {
        const criticism = validateReview(text);
        attempt.outcome = 'completed';
        return criticism;
      }
      const built = format.build(text, input);
      const candidate = { ...record, title: built.title, markdown: built.markdown, artifact: built.artifact ?? null, notes: built.notes ?? [], file: null, model };
      this.#checkSize(candidate);
      if (final && format.binary) await this.#storeFile(directory, candidate, format, controller.signal);
      if (controller.signal.aborted) return;
      attempt.outcome = 'completed';
      return { title: candidate.title, markdown: candidate.markdown, artifact: candidate.artifact, notes: candidate.notes, file: candidate.file };
    } catch (error) {
      const failure = error instanceof StudioError ? error : new StudioError('STUDIO_FAILED', 'Studio could not finish this request.');
      attempt.outcome = failure.code;
      throw failure;
    } finally {
      if (controller.signal.aborted) attempt.outcome = record.status === 'interrupted' ? 'interrupted' : 'cancelled';
    }
  }

  #checkSize(record) {
    // Include completion metadata before any file write, including the current attempt's
    // final outcome, so a near-limit reply cannot grow past the bridge limit at publication.
    const completed = { ...record, status: 'completed', completedAt: new Date().toISOString(),
      attempts: record.attempts.map((attempt) => attempt.outcome === 'running' ? { ...attempt, outcome: 'completed' } : attempt) };
    if (JSON.stringify(this.public(completed)).length > LIMITS.response) {
      throw new StudioError('OUTPUT_TOO_LARGE', 'This artifact is too large for the host bridge. It was not truncated.');
    }
  }

  async #run(job, request, format, generate, fallback, connection) {
    const { directory, record, controller } = job;
    // One shared recovery ladder, never reset between stages: retry the chosen model once,
    // then use a distinct known-good model once. Successful stages carry their model forward.
    // Three required calls with Second pass (one without), plus at most two recovery calls.
    const recovery = [request.model];
    if (fallback && modelKey(fallback) !== modelKey(request.model)) recovery.push(fallback);
    let nextRecovery = 0;
    let model = request.model;
    let draft = null;
    let criticism = null;
    try {
      if (controller.signal.aborted) return;
      record.status = 'running';
      await writeRecord(directory, record);
      let input;
      try { input = await this.#resolve(job, request, connection); }
      catch (error) {
        if (controller.signal.aborted) return;
        throw error instanceof StudioError ? error : new StudioError('SOURCE_FAILED', 'Studio could not read the selected sources.');
      }
      const stages = request.secondPass ? ['draft', 'review', 'revision'] : ['draft'];
      for (const stage of stages) {
        if (controller.signal.aborted) return;
        const final = stage === stages.at(-1);
        const prompt = stage === 'review' ? reviewPrompt(input, format, draft)
          : stage === 'revision' ? revisionPrompt(input, format, draft, criticism) : format.prompt(input);
        for (;;) {
          if (controller.signal.aborted) return;
          try {
            const result = await this.#attempt(job, input, format, generate, model, stage, prompt, final);
            if (controller.signal.aborted) return;
            record.model = model;
            if (final) Object.assign(record, result);
            else {
              if (stage === 'draft') draft = result;
              else criticism = result;
              await writeRecord(directory, record);
            }
            break;
          } catch (error) {
            if (controller.signal.aborted) return;
            if (!RETRYABLE.has(error.code)) throw error;
            // A model the host refuses outright will not do better on a repeated call.
            while (nextRecovery < recovery.length && error.code === 'MODEL_CONFIGURATION_REJECTED'
                && modelKey(recovery[nextRecovery]) === modelKey(model)) nextRecovery += 1;
            if (nextRecovery >= recovery.length) throw error;
            model = recovery[nextRecovery++];
            await writeRecord(directory, record);
          }
        }
      }
      record.status = 'completed';
      record.completedAt = new Date().toISOString();
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = error instanceof StudioError ? error : new StudioError('STUDIO_FAILED', 'Studio could not finish this request.');
      clearOutput(record);
      record.status = 'failed';
      record.error = { code: failure.code, message: failure.message };
    } finally {
      try {
        // Cancel/stop already captured the terminal attempt outcomes. A late transport
        // reply must share that write, not replace the same cancelled record a second time.
        if (controller.signal.aborted && job.terminalWrite) await job.terminalWrite;
        else await writeRecord(directory, record);
      }
      catch {
        clearOutput(record);
        record.status = 'failed';
        record.error = { code: 'STORAGE_FAILED', message: 'Studio could not save this artifact. Check that the project is writable.' };
        console.error('Studio could not persist a job update. Existing records were not deleted.');
      }
      this.#active.delete(record.id);
    }
  }

  // Only the final candidate reaches the trusted builder. Check its preview and cancellation
  // before writing any bytes; export later copies these exact bytes.
  async #storeFile(directory, record, format, signal) {
    let built;
    try { built = await this.#buildFile(format.key, record.artifact, fileMeta(record)); }
    catch {
      console.error(`Studio could not build a ${format.label} file.`);
      throw new StudioError('BUILD_FAILED', `Studio could not build the ${format.label} file from this reply. Nothing was saved; regenerate explicitly.`);
    }
    if (signal.aborted) return;
    if (built.bytes.length > FILE_BYTES) throw new StudioError('OUTPUT_TOO_LARGE', `The ${format.label} file exceeds this build's size limit.`);
    record.notes = [...record.notes, ...built.notes];
    // A light preview (infographics) travels with the artifact so the panel can show it.
    if (built.preview) record.artifact = { ...record.artifact, svg: built.preview };
    record.file = { name: `${record.id}.${format.extension}`, bytes: built.bytes.length, md5: digest(built.bytes), pages: built.pages };
    this.#checkSize(record);
    await writeArtifactFile(directory, record, format.extension, built.bytes);
  }

  async get(directory, id) {
    const active = this.#active.get(id);
    if (active && sameDirectory(active.directory, directory)) {
      // Do not advertise a completed artifact before its final record reaches disk.
      if (['completed', 'failed'].includes(active.record.status)) await active.finished;
      return structuredClone(active.record);
    }
    const record = await readRecord(directory, id);
    if (unfinished(record)) {
      let ownerAlive = false;
      if (Number.isInteger(record.ownerPid) && record.ownerPid > 0 && record.ownerPid !== process.pid) {
        try { process.kill(record.ownerPid, 0); ownerAlive = true; } catch (error) { ownerAlive = error.code === 'EPERM'; }
      }
      if (!ownerAlive) {
        record.status = 'interrupted';
        record.error = { code: 'INTERRUPTED', message: 'Studio stopped before this job completed. Regenerate explicitly.' };
        await writeRecord(directory, record);
      }
    }
    return record;
  }

  public(record, detail = true) {
    const { fingerprint, ownerPid, ...visible } = record;
    if (!detail) {
      for (const field of ['markdown', 'artifact', 'notes', 'progress', 'instructions']) delete visible[field];
    }
    return { ...visible, canCancel: this.#active.has(record.id) && unfinished(record) };
  }

  async list(directory, offset = 0) {
    const records = await listRecords(directory);
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = await Promise.all(records.slice(offset, offset + 25).map((record) => this.get(directory, record.id)));
    return { jobs: page.map((record) => this.public(record, false)), total: records.length, next: offset + 25 < records.length ? offset + 25 : null };
  }

  async cancel(directory, id) {
    const job = this.#active.get(id);
    if (!job || !sameDirectory(job.directory, directory) || !unfinished(job.record)) {
      throw new StudioError('NOT_RUNNING', 'This Studio process has no running job with that identifier.', 409);
    }
    job.record.status = 'cancelled';
    clearOutput(job.record);
    for (const attempt of job.record.attempts) if (attempt.outcome === 'running') attempt.outcome = 'cancelled';
    job.terminalWrite = writeRecord(directory, job.record);
    job.controller.abort();
    await job.terminalWrite;
    return this.public(job.record);
  }

  // Serializes read-modify-write updates of one saved record (export and progress).
  async #update(directory, id, change) {
    const previous = this.#locks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      const record = await this.get(directory, id);
      if (record.status !== 'completed') throw new StudioError('NOT_READY', 'Only a completed artifact can be changed or exported.', 409);
      const result = await change(record, formatFor(record.format));
      await writeRecord(directory, record);
      return result;
    });
    this.#locks.set(id, run);
    try { return await run; }
    finally { if (this.#locks.get(id) === run) this.#locks.delete(id); }
  }

  // filename null picks a friendly unused name from the title, such as "Solar system (2).docx".
  save(directory, id, filename = null) {
    return this.#update(directory, id, async (record, format) => {
      let content;
      if (format.binary) {
        // Binary bytes are copied service-side; they never travel through the panel bridge.
        content = await readArtifactFile(directory, record, FILE_BYTES);
        if (digest(content) !== record.file.md5) throw new StudioError('FILE_CHANGED', 'The stored file no longer matches this artifact. Regenerate explicitly.', 409);
      } else content = format.exportContent ? format.exportContent(record, { fontCss: await embeddedFontCss() }) : record.markdown;
      record.savedPath = filename === null
        ? await exportUnique(directory, content, record.title || format.label, format.extension)
        : await exportFile(directory, content, filename, format.extension);
      return { savedPath: record.savedPath };
    });
  }

  // A PNG of an infographic is drawn by the panel (the text needs a browser to rasterize) and
  // arrives in bridge-sized base64 chunks. Chunks are held in memory only until the last one.
  async savePicture(directory, id, { upload, index, total, data } = {}) {
    if (typeof upload !== 'string' || !/^[0-9a-f-]{36}$/i.test(upload) || !Number.isInteger(index) || !Number.isInteger(total)
        || total < 1 || total > 600 || index < 0 || index >= total || typeof data !== 'string' || data.length > 48_000 || !/^[A-Za-z0-9+/=]*$/.test(data)) {
      throw new StudioError('BAD_UPLOAD', 'Invalid picture upload.');
    }
    const now = Date.now();
    for (const [key, entry] of this.#uploads) if (now - entry.started > 300_000) this.#uploads.delete(key);
    const entry = this.#uploads.get(upload) ?? { id, total, parts: [], started: now };
    if (entry.id !== id || entry.total !== total || index !== entry.parts.length) throw new StudioError('BAD_UPLOAD', 'Picture chunks arrived out of order. Try saving again.');
    entry.parts.push(data);
    this.#uploads.set(upload, entry);
    if (entry.parts.length < total) return { received: entry.parts.length };
    this.#uploads.delete(upload);
    const bytes = Buffer.from(entry.parts.join(''), 'base64');
    if (bytes.length > FILE_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      throw new StudioError('BAD_UPLOAD', 'That picture could not be saved. Try again.');
    }
    return this.#update(directory, id, async (record, format) => {
      if (format.key !== 'infographic') throw new StudioError('BAD_UPLOAD', 'Only infographics are saved as pictures.');
      const savedPath = await exportUnique(directory, bytes, record.title || format.label, 'png');
      record.savedPicture = savedPath;
      return { savedPath };
    });
  }

  saveProgress(directory, id, value) {
    return this.#update(directory, id, async (record, format) => {
      if (!format.validateProgress) throw new StudioError('NO_PROGRESS', `${format.label} has no study progress.`, 409);
      record.progress = format.validateProgress(record.artifact, value);
      record.progressUpdatedAt = new Date().toISOString();
      return { progress: record.progress };
    });
  }

  async stop() {
    await Promise.all([...this.#active.values()].map(async (job) => {
      if (!unfinished(job.record)) { await job.terminalWrite; return; }
      job.record.status = 'interrupted';
      job.record.error = { code: 'INTERRUPTED', message: 'Studio stopped before this job completed.' };
      clearOutput(job.record);
      for (const attempt of job.record.attempts) if (attempt.outcome === 'running') attempt.outcome = 'interrupted';
      job.terminalWrite = writeRecord(job.directory, job.record);
      job.controller.abort();
      await job.terminalWrite;
    }));
  }
}
