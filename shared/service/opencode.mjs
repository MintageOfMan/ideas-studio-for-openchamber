import { modelKey, StudioError } from '../common/core.mjs';
import { projectDirectory } from './storage.mjs';
import os from 'node:os';
import path from 'node:path';

function localOrigin(value) {
  let url;
  try { url = new URL(value); } catch { /* The same actionable error handles malformed origins. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new StudioError('LOCAL_HOST_REQUIRED', 'Ideas Studio supports a local OpenChamber desktop connection. Remote and protected hosts are not supported.');
  }
  return url.origin;
}

const unpack = (value) => value?.data ?? value;
const identifier = (value) => typeof value === 'string' && value.trim().length > 0
  && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : undefined;
const absent = (value) => value === undefined || value === null || value === '';

function modelRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const providerID = identifier(value.providerID);
  const id = identifier(value.id);
  const variant = absent(value.variant) ? undefined : identifier(value.variant);
  if (!providerID || !id || (!absent(value.variant) && !variant)) return undefined;
  return { providerID, id, ...(variant ? { variant } : {}) };
}

function queryModel(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = null; }
  }
  return modelRef(parsed);
}

function contextModel(value) {
  if (absent(value)) return undefined;
  // GET requests carry the same ModelRef as POST requests, serialized as JSON.
  const ref = queryModel(value);
  if (!ref) throw new StudioError('BAD_CONTEXT', 'The selected AI model could not be read. Reopen Ideas Studio.');
  return ref;
}

function configuredRef(value, variant) {
  // OpenCode v2 Config.ModelSelection encodes a string or { providerID, model, variant }.
  if (value && typeof value === 'object') return modelRef({ ...value, id: value.model });
  if (typeof value !== 'string') return undefined;
  value = value.trim();
  const slash = value.indexOf('/');
  if (slash < 1) return undefined;
  const hash = value.indexOf('#', slash + 1);
  return modelRef({ providerID: value.slice(0, slash), id: value.slice(slash + 1, hash < 0 ? undefined : hash),
    variant: variant ?? (hash < 0 ? undefined : value.slice(hash + 1)) });
}

const configuredModel = (settings) => configuredRef(settings?.defaultModel, settings?.defaultVariant);

function openCodeDefaults(entries) {
  if (entries === undefined) return {};
  if (!Array.isArray(entries)) throw new StudioError('BAD_RESPONSE', 'OpenCode returned an unreadable configuration.');
  const defaults = {};
  // GET /api/config returns Config.Entry[] in precedence order, lowest first
  // (OpenCode v2.0.32 config.ts). Read only these two fields; never expose config.
  for (const entry of entries) {
    if (entry?.type !== 'document') continue;
    if (entry.info?.default_agent !== undefined) defaults.agent = entry.info.default_agent;
    if (entry.info?.model !== undefined) defaults.model = configuredRef(entry.info.model);
  }
  return defaults;
}

// A missing optional defaults route is distinct from a failed connection or refused
// authentication. Only 404 is optional; neither failure can authorize a fallback.
const optionalRead = async (call, route) => unpack(await call(route, { optional: true }));

// Models that produced every Studio format live on this build's reference host. This is
// the quiet-retry recommendation, separate from Automatic's inherited selection.
// A plain variant is preferred for recovery after a reasoning variant returned empty text.
const KNOWN_GOOD = [
  ['amazon-bedrock', 'us.openai.gpt-6-astra-ultrafast'], ['amazon-bedrock', 'global.openai.gpt-6-astra-ultrafast'],
  ['amazon-bedrock', 'openai.gpt-6-astra-ultrafast'],
];
export function recommendModel(models, selectedKey) {
  for (const [providerID, id] of KNOWN_GOOD) {
    const match = models.find((model) => model.ref.providerID === providerID && model.ref.id === id && !model.ref.variant);
    if (match) return match.key;
  }
  const selected = models.find((model) => model.key === selectedKey);
  const plain = selected && models.find((model) => model.ref.providerID === selected.ref.providerID && model.ref.id === selected.ref.id && !model.ref.variant);
  return (plain ?? selected ?? models[0])?.key ?? null;
}
const sameDirectory = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

export class OpenCodeGateway {
  constructor({ fetch: transport = globalThis.fetch } = {}) {
    this.fetch = transport;
  }

  #caller(origin, directory) {
    const baseDirectory = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'opencode');
    return async (route, { body, signal, generation = false, baseConfiguration = false, optional = false } = {}) => {
      const scope = baseConfiguration ? baseDirectory : directory;
      let response;
      try {
        response = await this.fetch(new URL(route, origin), {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            ...(scope ? { 'x-opencode-directory': encodeURIComponent(scope) } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error',
          signal: signal ?? AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new StudioError('CONNECTION_FAILED', 'The selected local OpenChamber API could not be reached. No other server was tried.', 502);
      }
      if (response.status === 401 || response.status === 403) {
        throw new StudioError('AUTH_REQUIRED', 'This host requires authentication that its extension service cannot inherit. This build will not bypass it or switch to the Small Model.', 403);
      }
      if (optional && response.status === 404) return undefined;
      if (!response.ok) {
        if (generation && response.status === 400) {
          const failure = await response.json().catch(() => null);
          const text = typeof failure?.message === 'string' ? failure.message : '';
          // Classify known selection failures without exposing provider error bodies.
          const reason = /model unavailable/i.test(text) ? 'The model is unavailable to OpenCode base-configuration generation.'
            : /variant/i.test(text) ? 'OpenCode rejected this model variant for stateless generation.'
            : /package|initializ|configur|environment|variable/i.test(text) ? 'OpenCode could not initialize this model for stateless generation.'
            : 'OpenCode rejected the stateless generation request.';
          throw new StudioError('MODEL_CONFIGURATION_REJECTED', `${reason} No fallback model was used.`, 400);
        }
        throw new StudioError(generation ? 'MODEL_FAILED' : 'CONNECTION_FAILED',
          generation ? `The chosen OpenCode model request failed (HTTP ${response.status}). Check its connection in OpenChamber.`
            : `Could not read this OpenChamber connection (HTTP ${response.status}). Reopen Ideas Studio and try again.`, 502);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new StudioError('UNSUPPORTED_CONNECTION', 'The host did not return the expected OpenCode v2 API response.', 502);
      }
      try { return await response.json(); }
      catch { throw new StudioError('BAD_RESPONSE', 'OpenCode returned an unreadable response.', 502); }
    };
  }

  // Verify location independently of generation readiness. Keep the original selection
  // inputs, so a later refresh cannot mistake an automatic default for a manual pick.
  async #context(context = {}) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      throw new StudioError('BAD_CONTEXT', 'The current OpenChamber context could not be read.');
    }
    const hostOrigin = localOrigin(context.hostOrigin);
    const sessionId = absent(context.sessionId) ? '' : context.sessionId;
    if (typeof sessionId !== 'string' || (sessionId && !/^ses[A-Za-z0-9_-]{1,196}$/.test(sessionId))) {
      throw new StudioError('BAD_CONTEXT', 'The selected chat identifier could not be read. Reopen Ideas Studio.');
    }
    const model = contextModel(context.model);
    const agent = absent(context.agent) ? undefined : identifier(context.agent);
    if (!absent(context.agent) && !agent) throw new StudioError('BAD_CONTEXT', 'The selected AI agent could not be read. Reopen Ideas Studio.');
    // Invalid overrides survive the context round trip: prepare reports a selection
    // error with the catalogs, without replacing the user's explicit choice.
    const overrides = {
      ...(!absent(context.agentOverride) ? { agentOverride: identifier(context.agentOverride) ?? context.agentOverride } : {}),
      ...(!absent(context.modelOverride) ? { modelOverride: queryModel(context.modelOverride) ?? context.modelOverride } : {}),
    };
    let directory = absent(context.directory) ? undefined : await projectDirectory(context.directory);
    let session;
    if (sessionId) {
      session = unpack(await this.#caller(hostOrigin, directory)(`/api/session/${encodeURIComponent(sessionId)}`));
      if (session?.id !== sessionId) {
        throw new StudioError('WRONG_SERVER', 'Studio could not match the selected chat to this OpenCode connection.');
      }
      const sessionDirectory = await projectDirectory(session.location?.directory);
      if (directory && !sameDirectory(directory, sessionDirectory)) {
        throw new StudioError('WRONG_DIRECTORY', 'The active session belongs to another directory. Select its matching project or worktree.');
      }
      directory = sessionDirectory;
    }
    if (!directory) {
      // OpenChamber 2.5.0 /api/fs/home names its configured managed Chats root, including
      // OPENCHAMBER_DATA_DIR relocation. Never guess it from this service's OS home.
      const home = unpack(await this.#caller(hostOrigin)('/api/fs/home'));
      directory = await projectDirectory(absent(home?.chatsRoot) ? home?.home : home.chatsRoot);
    }
    return { context: { directory, sessionId, hostOrigin, ...(model ? { model } : {}), ...(agent ? { agent } : {}), ...overrides }, session };
  }

  async resolveContext(context) {
    return (await this.#context(context)).context;
  }

  async prepare(context) {
    const { context: resolved, session } = await this.#context(context);
    const { directory, sessionId, hostOrigin: origin } = resolved;
    const call = this.#caller(origin, directory);
    // Use the origin of our actual guest frame, not a guessed port or the unrelated CLI service.
    // This adapter is deliberately limited to a local proxy that accepts the request as configured.
    // The v2 stateless handler runs in the server's base config, regardless of a
    // project header. Load that catalog, not a project-only model/override.
    const [infoPayload, catalog, agentPayload] = await Promise.all([
      call('/api/info'), call('/api/model', { baseConfiguration: true }), call('/api/agent'),
    ]);
    const info = unpack(infoPayload);
    if (typeof info?.version !== 'string' || !info.version.startsWith('2.')) {
      throw new StudioError('WRONG_SERVER', 'Studio could not verify an OpenCode v2 connection. No model call was made.');
    }
    const entries = unpack(catalog);
    if (!Array.isArray(entries)) throw new StudioError('BAD_CATALOG', 'OpenCode returned an unreadable model catalog.');
    const agentEntries = unpack(agentPayload);
    if (!Array.isArray(agentEntries)) throw new StudioError('BAD_CATALOG', 'OpenCode returned an unreadable agent catalog.');
    const agents = agentEntries.filter((entry) => identifier(entry?.id) && !entry.hidden && entry.enabled !== false
      && entry.disabled !== true && ['primary', 'all'].includes(entry.mode)).map((entry) => ({
      id: identifier(entry.id), label: identifier(entry.name) ?? entry.id,
      ...(modelRef(entry.model) ? { model: modelRef(entry.model) } : {}),
    }));
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const textModels = entries.filter((entry) => entry?.enabled === true && Array.isArray(entry.capabilities?.output)
      && entry.capabilities.output.includes('text') && modelRef(entry));
    const models = textModels.map((entry) => {
      const ref = modelRef({ providerID: entry.providerID, id: entry.id });
      return { key: modelKey(ref), label: `${entry.name || entry.id} (${entry.providerID})`, ref };
    });
    const availableModels = new Set(models.map((model) => model.key));
    for (const entry of textModels) {
      for (const variant of Array.isArray(entry.variants) ? entry.variants : []) {
        const ref = modelRef({ providerID: entry.providerID, id: entry.id, variant: variant?.id });
        if (ref?.variant && variant.enabled !== false && variant.disabled !== true) availableModels.add(modelKey(ref));
      }
    }
    const availableModel = (ref) => Boolean(ref && availableModels.has(modelKey(ref)));
    const hasAgentOverride = !absent(resolved.agentOverride);
    const hasModelOverride = !absent(resolved.modelOverride);
    const agentCandidates = hasAgentOverride ? [resolved.agentOverride] : [session?.agent, resolved.agent];
    const pickAgent = () => agentCandidates.map(identifier).find((id) => agentById.has(id)) ?? null;
    let agent = pickAgent();
    const modelCandidates = hasModelOverride ? [queryModel(resolved.modelOverride)] : [
      // A Studio agent override uses its own pinned model ahead of the chat's selection.
      hasAgentOverride ? agentById.get(agent)?.model : undefined,
      modelRef(session?.model), resolved.model,
    ];
    const pickModel = () => modelCandidates.find(availableModel) ?? null;
    let model = pickModel();
    if ((!agent && !hasAgentOverride) || (!model && !hasModelOverride)) {
      // OpenChamber v2.5.0 exposes sanitized merged project/app defaults here. Its GET
      // may migrate old host settings; Studio never writes them. Draft composer picks
      // absent from PluginPane's session:null snapshot stay unavailable to the SDK.
      const settings = await optionalRead(call, '/api/config/settings');
      const project = Array.isArray(settings?.projects) ? settings.projects.find((entry) =>
        typeof entry?.path === 'string' && path.isAbsolute(entry.path) && !entry.path.includes('\0')
        && sameDirectory(path.resolve(entry.path), directory)) : undefined;
      if (!hasAgentOverride) agentCandidates.push(project?.defaultAgent, settings?.defaultAgent);
      if (!hasModelOverride) modelCandidates.push(configuredModel(project), configuredModel(settings));
      agent = pickAgent();
      if (!hasModelOverride) modelCandidates.push(agentById.get(agent)?.model);
      model = pickModel();
      if ((!agent && !hasAgentOverride) || (!model && !hasModelOverride)) {
        const defaults = openCodeDefaults(await optionalRead(call, '/api/config'));
        if (!hasAgentOverride) agentCandidates.push(defaults.agent);
        agent = pickAgent();
        // Agent.list puts OpenCode's resolved primary default first. Its order is usable
        // only without any named agent selection; failed names never authorize a guess.
        if (!agent && !hasAgentOverride && agentCandidates.every(absent)) agent = agents[0]?.id ?? null;
        if (!hasModelOverride) modelCandidates.push(agentById.get(agent)?.model, defaults.model);
        model = pickModel();
      }
    }
    // Model.default may itself fall back to the first text model (OpenCode v2.0.32).
    // Only the named config value above is a default here; an empty catalog is useful
    // selector data, and the retry recommendation never establishes readiness.
    if (model?.variant && !models.some((entry) => entry.key === modelKey(model))) {
      const base = models.find((entry) => entry.ref.providerID === model.providerID && entry.ref.id === model.id);
      models.unshift({ key: modelKey(model), label: `${base.label} (${model.variant})`, ref: model });
    }
    const selected = modelCandidates.find(Boolean);
    const defaultModelKey = model ? modelKey(model) : null;
    const ready = Boolean(agent && model);
    const selectionError = !agent
      ? (agents.length ? 'Choose an available AI agent. The selected or default agent is unavailable.' : 'No available primary AI agents were found. Configure one in OpenChamber.')
      : !model ? (models.length ? 'Choose an available AI model for this agent.' : 'No enabled text models are available. Configure one in OpenChamber.')
        : null;
    const requireReady = () => {
      if (!ready) throw new StudioError(agent ? 'NO_MODEL' : 'NO_AGENT', selectionError);
    };
    return {
      endpoint: origin, version: info.version, directory, sessionId, agent, agents, models, modelScope: 'OpenCode base configuration',
      ready, selectionRequired: !ready, selectionError,
      selectedModelKey: selected ? modelKey(selected) : null,
      defaultModelKey,
      recommendedModelKey: recommendModel(models, selected ? modelKey(selected) : null),
      // The active chat context: every message after the last compaction, with its summary first.
      chatContext: async () => sessionId ? unpack(await call(`/api/session/${encodeURIComponent(sessionId)}/context`, { signal: AbortSignal.timeout(60_000) })) : [],
      // OpenCode's own summarizer over the session's context; it does not change the chat.
      summarizeChat: async (prompt, signal) => {
        if (!sessionId) throw new StudioError('NO_CHAT', 'There is no saved chat to include yet.');
        requireReady();
        return unpack(await call(`/api/session/${encodeURIComponent(sessionId)}/generate`, { body: { prompt }, signal, generation: true }))?.text;
      },
      generate: async (prompt, requestedModel, signal) => {
        requireReady();
        const chosen = modelRef(requestedModel);
        if (!availableModel(chosen)) throw new StudioError('NO_MODEL', 'Choose an available AI model for this agent.');
        // Public v2 one-shot generation: no session prompt, agent tools, or transcript mutation.
        const output = unpack(await call('/api/experimental/generate', { body: { prompt, model: chosen }, signal, generation: true, baseConfiguration: true }));
        return { text: output?.text };
      },
    };
  }

  async describe(context) {
    const { generate, chatContext, summarizeChat, ...publicConnection } = await this.prepare(context);
    return publicConnection;
  }
}
