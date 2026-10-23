import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { modelKey } from '../shared/common/core.mjs';
import { measureChat } from '../shared/service/chat.mjs';
import { OpenCodeGateway } from '../shared/service/opencode.mjs';

// Controlled transports only. These fixtures never contact a host or model, and the
// temporary folders are retained under temp/ for inspection after the test run.
const origin = 'http://127.0.0.1:1';
const selected = { providerID: 'unit-test', id: 'selected' };
const configured = { providerID: 'unit-test', id: 'configured' };
const runtimeDefault = { providerID: 'unit-test', id: 'runtime-default' };
const recommended = { providerID: 'amazon-bedrock', id: 'us.openai.gpt-6-astra-ultrafast' };
const entry = (ref) => ({ ...ref, name: ref.id, enabled: true, variants: [], capabilities: { output: ['text'] } });
const primary = (id, extra = {}) => ({ id, name: `Display ${id}`, mode: 'primary', hidden: false, ...extra });

async function fixture() {
  const parent = path.resolve('temp');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'connection-test-'));
  const home = path.join(root, 'home');
  const chats = path.join(root, 'managed-chats');
  const project = path.join(root, 'project');
  await Promise.all([home, chats, project].map((directory) => fs.mkdir(directory)));
  const sessionId = 'ses_controlled_connection';
  const state = {
    info: { version: '2.0.32' },
    home: { home, chatsRoot: chats, canonicalChatsRoot: chats },
    settings: { defaultModel: 'unit-test/configured', defaultAgent: 'configured-agent' },
    agents: ['build', 'draft-agent', 'session-agent', 'configured-agent'].map((id) => primary(id)),
    catalog: [selected, configured, runtimeDefault, recommended].map(entry),
    config: [{ type: 'document', info: { model: { providerID: runtimeDefault.providerID, model: runtimeDefault.id } } }],
    session: { id: sessionId, location: { directory: project }, model: selected, agent: 'session-agent' },
    messages: [],
    responses: new Map(),
  };
  const requests = [];
  const gateway = new OpenCodeGateway({ fetch: async (url, options) => {
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, undefined);
    requests.push({ route: url.pathname, ...options });
    if (state.responses.has(url.pathname)) return state.responses.get(url.pathname)(url, options);
    switch (url.pathname) {
      case '/api/info': return Response.json(state.info);
      // Shapes verified in OpenChamber v2.5.0 fs/routes.js, opencode/routes.js,
      // settings-helpers.js; OpenCode v2.0.32 model/agent/session handlers.
      case '/api/fs/home': return Response.json(state.home);
      case '/api/config/settings': return Response.json(state.settings);
      case '/api/agent': return Response.json({ data: state.agents });
      case '/api/model': return Response.json({ data: state.catalog });
      case '/api/config': return Response.json(state.config);
      case `/api/session/${sessionId}`: return Response.json({ data: state.session });
      case `/api/session/${sessionId}/context`: return Response.json({ data: state.messages });
      case '/api/experimental/generate': return Response.json({ data: { text: 'Controlled reply.' } });
      default: throw new Error(`Unexpected controlled route: ${url.pathname}`);
    }
  } });
  const context = { directory: project, sessionId: '', hostOrigin: origin, model: selected, agent: 'draft-agent' };
  return { root, home, chats, project, sessionId, state, requests, gateway, context };
}

const routes = (fixture) => fixture.requests.map((request) => request.route);
const readOnly = (fixture) => assert.ok(fixture.requests.every((request) => request.method === 'GET' && request.body === undefined));
const noSession = (fixture) => assert.ok(routes(fixture).every((route) => !route.startsWith('/api/session/')));

test('missing and empty sessions open settings with the draft model, separately from the retry recommendation', async () => {
  const f = await fixture();
  for (const sessionId of [undefined, '', null]) {
    const result = await f.gateway.describe({ ...f.context, sessionId });
    assert.equal(result.sessionId, '');
    assert.equal(result.directory, f.project);
    assert.equal(result.agent, 'draft-agent');
    assert.equal(result.selectedModelKey, modelKey(selected));
    assert.equal(result.defaultModelKey, modelKey(selected));
    assert.equal(result.recommendedModelKey, modelKey(recommended));
    assert.equal(result.ready, true);
    assert.equal(result.selectionRequired, false);
    assert.equal(result.selectionError, null);
    assert.ok(result.agents.some((agent) => agent.id === 'draft-agent'));
    assert.equal(result.generate, undefined);
  }
  assert.ok(routes(f).every((route) => ['/api/info', '/api/model', '/api/agent'].includes(route)));
  noSession(f);
  readOnly(f);
});

test('fresh startup resolves the managed Chats root and uses app defaults before any session exists', async () => {
  const f = await fixture();
  const input = Object.freeze({ hostOrigin: origin, sessionId: '' });
  const context = await f.gateway.resolveContext(input);
  assert.deepEqual(context, {
    directory: f.chats, sessionId: '', hostOrigin: origin,
  });
  assert.deepEqual(routes(f), ['/api/fs/home']);
  const result = await f.gateway.describe(context);
  assert.equal(result.ready, true);
  assert.equal(result.agent, 'configured-agent');
  assert.equal(result.defaultModelKey, modelKey(configured));
  noSession(f);
  readOnly(f);
});

test('a host without a managed Chats field supplies its own home instead of the service OS home', async () => {
  const f = await fixture();
  f.state.home = { home: f.home };
  const result = await f.gateway.resolveContext({ ...f.context, directory: undefined });
  assert.equal(result.directory, f.home);
  assert.deepEqual(routes(f), ['/api/fs/home']);
});

test('supplied ModelRefs, including JSON query values, need no defaults read and do not mutate input', async () => {
  const f = await fixture();
  const model = { ...selected, variant: 'high' };
  const input = Object.freeze({ ...f.context, model: JSON.stringify({ ...model, unrelated: 'discard' }) });
  assert.deepEqual(await f.gateway.resolveContext(input), { ...f.context, model });
  assert.equal(f.requests.length, 0);
  assert.equal(typeof input.model, 'string');
});

test('saved sessions are authoritative for directory, model variant and agent even before the first message', async () => {
  const f = await fixture();
  const model = { ...selected, variant: 'high' };
  f.state.session.model = model;
  f.state.catalog[0].variants = [{ id: 'high' }];
  const connection = await f.gateway.prepare({ ...f.context, sessionId: f.sessionId, model: configured });
  assert.equal(connection.agent, 'session-agent');
  assert.equal(connection.ready, true);
  assert.equal(connection.defaultModelKey, modelKey(model));
  assert.deepEqual(connection.models.find((entry) => entry.key === connection.defaultModelKey)?.ref, model);
  assert.deepEqual(await measureChat(connection), { available: false, reason: 'This chat has no messages yet.' });
  assert.ok(!routes(f).includes('/api/config/settings'));
  assert.ok(routes(f).includes('/api/agent'));
  readOnly(f);
});

test('a saved session resolves its own directory when the bridge omits it', async () => {
  const f = await fixture();
  const result = await f.gateway.resolveContext({ hostOrigin: origin, sessionId: f.sessionId });
  assert.deepEqual(result, {
    hostOrigin: origin, sessionId: f.sessionId, directory: f.project,
  });
  assert.deepEqual(routes(f), [`/api/session/${f.sessionId}`]);
});

test('saved-session directory and identity mismatches fail before any fallback lookup', async () => {
  const f = await fixture();
  const context = { ...f.context, sessionId: f.sessionId };
  await assert.rejects(f.gateway.resolveContext({ ...context, directory: f.home }), { code: 'WRONG_DIRECTORY' });
  f.state.session.id = 'ses_another_controlled_session';
  await assert.rejects(f.gateway.prepare(context), { code: 'WRONG_SERVER' });
  f.state.session.id = f.sessionId;
  f.state.session.location = {};
  await assert.rejects(f.gateway.resolveContext(context), { code: 'NO_DIRECTORY' });
  assert.ok(routes(f).every((route) => route === `/api/session/${f.sessionId}`));
  readOnly(f);
});

test('invalid nonempty context is not silently replaced with defaults', async () => {
  const f = await fixture();
  for (const sessionId of [' ', 'draft', 'ses', 'ses/other', 42]) {
    await assert.rejects(f.gateway.describe({ ...f.context, sessionId }), { code: 'BAD_CONTEXT' });
  }
  for (const model of ['not JSON', 'null', '[]', '{}', { providerID: 'unit-test' }, { ...selected, variant: 1 }]) {
    await assert.rejects(f.gateway.resolveContext({ ...f.context, model }), { code: 'BAD_CONTEXT' });
  }
  await assert.rejects(f.gateway.resolveContext({ ...f.context, agent: ['build'] }), { code: 'BAD_CONTEXT' });
  for (const directory of ['relative', path.join(f.root, 'not-created'), `${f.project}\0`]) {
    await assert.rejects(f.gateway.resolveContext({ ...f.context, directory }), { code: 'NO_DIRECTORY' });
  }
  assert.equal(f.requests.length, 0);
});

test('project defaults apply only to the actual directory and keep their own variant', async () => {
  const f = await fixture();
  f.state.agents.push(primary('project-agent'));
  f.state.settings.defaultVariant = 'global-effort';
  f.state.catalog[0].variants = [{ id: 'project-effort' }];
  f.state.catalog[1].variants = [{ id: 'global-effort' }];
  f.state.settings.projects = [
    { path: f.home, defaultModel: 'unit-test/unrelated', defaultAgent: 'unrelated-agent' },
    { path: f.project, defaultModel: 'unit-test/selected', defaultAgent: 'project-agent' },
  ];
  const context = { ...f.context, model: undefined, agent: undefined };
  const result = await f.gateway.describe(context);
  assert.equal(result.ready, true);
  assert.equal(result.defaultModelKey, modelKey(selected));
  assert.equal(result.agent, 'project-agent');
  f.state.settings.projects[1].defaultVariant = 'project-effort';
  assert.equal((await f.gateway.describe(context)).defaultModelKey, modelKey({ ...selected, variant: 'project-effort' }));
  const chat = await f.gateway.describe({ ...context, directory: f.chats });
  assert.equal(chat.defaultModelKey, modelKey({ ...configured, variant: 'global-effort' }));
  assert.equal(chat.agent, 'configured-agent');
});

test('selection and settings changes are re-read without keeping an earlier model or agent', async () => {
  const f = await fixture();
  f.state.agents.push(primary('changed-agent'), primary('chosen-agent'));
  const context = await f.gateway.resolveContext({ ...f.context, model: undefined, agent: undefined });
  assert.equal((await f.gateway.describe(context)).defaultModelKey, modelKey(configured));
  f.state.settings = { defaultModel: 'unit-test/selected', defaultAgent: 'changed-agent' };
  const changed = await f.gateway.describe(context);
  assert.equal(changed.defaultModelKey, modelKey(selected));
  assert.equal(changed.agent, 'changed-agent');
  const draft = await f.gateway.describe({ ...f.context, model: runtimeDefault, agent: 'chosen-agent' });
  assert.equal(draft.defaultModelKey, modelKey(runtimeDefault));
  assert.equal(draft.agent, 'chosen-agent');
  noSession(f);
  readOnly(f);
});

test('missing agent inherits the OpenCode catalog default ID, and its pinned model follows host defaults', async () => {
  const f = await fixture();
  f.state.settings = {};
  f.state.agents = [
    primary('runtime-agent', { model: selected }),
    primary('build', { model: configured }),
  ];
  const result = await f.gateway.describe({ ...f.context, model: undefined, agent: undefined });
  assert.equal(result.agent, 'runtime-agent');
  assert.equal(result.defaultModelKey, modelKey(selected));
  assert.equal(routes(f).includes('/api/model/default'), false);
  const request = f.requests.find((request) => request.route === '/api/agent');
  assert.equal(decodeURIComponent(request.headers['x-opencode-directory']), f.project);
  f.state.settings = { defaultModel: 'unit-test/configured' };
  const hostDefault = await f.gateway.describe({ ...f.context, model: undefined, agent: 'runtime-agent' });
  assert.equal(hostDefault.defaultModelKey, modelKey(configured));
});

test('an explicitly selected agent supplies its pinned model when host model defaults are unset', async () => {
  const f = await fixture();
  f.state.settings = { defaultAgent: 'build' };
  f.state.agents = [primary('build', { model: configured }), primary('draft-agent', { model: selected })];
  const result = await f.gateway.describe({ ...f.context, model: undefined });
  assert.equal(result.agent, 'draft-agent');
  assert.equal(result.defaultModelKey, modelKey(selected));
});

test('OpenCode directory defaults are inherited while the advertised catalog stays in base configuration', async () => {
  const f = await fixture();
  f.state.settings = {};
  f.state.config = [
    { type: 'document', info: { model: 'unit-test/runtime-default' } },
    { type: 'directory', path: f.project },
    { type: 'document', info: { model: { providerID: selected.providerID, model: selected.id } } },
  ];
  const result = await f.gateway.describe({ ...f.context, model: undefined, agent: undefined });
  assert.equal(result.defaultModelKey, modelKey(selected));
  assert.equal(result.agent, 'build');
  assert.equal(decodeURIComponent(f.requests.find((request) => request.route === '/api/config').headers['x-opencode-directory']), f.project);
  assert.equal(decodeURIComponent(f.requests.find((request) => request.route === '/api/model').headers['x-opencode-directory']), path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'opencode'));
});

test('unavailable optional settings use OpenCode defaults, while protected default reads stop', async () => {
  const f = await fixture();
  f.state.responses.set('/api/config/settings', () => new Response('', { status: 404 }));
  const context = { ...f.context, model: undefined, agent: undefined };
  const result = await f.gateway.describe(context);
  assert.equal(result.agent, 'build');
  assert.equal(result.defaultModelKey, modelKey(runtimeDefault));
  const before = f.requests.length;
  f.state.responses.set('/api/config/settings', () => new Response('private-marker', { status: 403 }));
  await assert.rejects(f.gateway.describe(context), (error) => error.code === 'AUTH_REQUIRED' && !error.message.includes('private-marker'));
  assert.equal(f.requests.slice(before).some((request) => request.route === '/api/config'), false);
  readOnly(f);
});

test('an unavailable inherited model tries named defaults and never an arbitrary catalog model', async () => {
  const f = await fixture();
  const projectModel = { providerID: 'unit-test', id: 'project-only' };
  const result = await f.gateway.describe({ ...f.context, model: projectModel });
  assert.equal(result.selectedModelKey, modelKey(projectModel));
  assert.equal(result.defaultModelKey, modelKey(configured));
  assert.equal(result.recommendedModelKey, modelKey(recommended));
  assert.equal(result.models.some((entry) => entry.key === modelKey(projectModel)), false);
  const baseDirectory = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'opencode');
  for (const request of f.requests.filter((request) => request.route.startsWith('/api/model'))) {
    assert.equal(decodeURIComponent(request.headers['x-opencode-directory']), baseDirectory);
  }
  f.state.settings = {};
  assert.equal((await f.gateway.describe({ ...f.context, model: projectModel })).defaultModelKey, modelKey(runtimeDefault));
  f.state.config = [];
  const unresolved = await f.gateway.prepare({ ...f.context, model: projectModel });
  assert.equal(unresolved.ready, false);
  assert.equal(unresolved.defaultModelKey, null);
  await assert.rejects(unresolved.generate('Must not be sent.', selected), { code: 'NO_MODEL' });
  assert.equal(routes(f).includes('/api/model/default'), false);
});

test('draft chat helpers never build an empty session route; explicit generation remains stateless', async () => {
  const f = await fixture();
  const connection = await f.gateway.prepare(f.context);
  assert.deepEqual(await connection.chatContext(), []);
  assert.equal((await measureChat(connection)).available, false);
  await assert.rejects(connection.summarizeChat('Must not be sent'), { code: 'NO_CHAT' });
  readOnly(f);
  const signal = new AbortController().signal;
  assert.deepEqual(await connection.generate('Controlled prompt.', selected, signal), { text: 'Controlled reply.' });
  const sent = f.requests.at(-1);
  assert.equal(sent.route, '/api/experimental/generate');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.signal, signal);
  assert.deepEqual(JSON.parse(sent.body), { prompt: 'Controlled prompt.', model: selected });
  assert.equal(decodeURIComponent(sent.headers['x-opencode-directory']), path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'opencode'));
  noSession(f);
});

test('remote origins, redirects and authentication refusals do not gain a fallback connection', async () => {
  const f = await fixture();
  for (const hostOrigin of ['https://example.com', 'http://192.0.2.1', 'file:///project', `${origin}/other`, `${origin}?x=1`, 'http://user:password@localhost:1']) {
    await assert.rejects(f.gateway.resolveContext({ ...f.context, hostOrigin }), { code: 'LOCAL_HOST_REQUIRED' });
  }
  assert.equal(f.requests.length, 0);
  f.state.responses.set('/api/fs/home', () => new Response('', { status: 401 }));
  await assert.rejects(f.gateway.resolveContext({ ...f.context, directory: undefined }), { code: 'AUTH_REQUIRED' });
  f.state.responses.set('/api/fs/home', () => new Response('', { status: 302, headers: { location: 'https://example.com' } }));
  await assert.rejects(f.gateway.resolveContext({ ...f.context, directory: undefined }), { code: 'CONNECTION_FAILED' });
  assert.deepEqual(routes(f), ['/api/fs/home', '/api/fs/home']);
});

test('invalid server and catalog responses cannot advertise a working generation connection', async () => {
  const f = await fixture();
  f.state.info = { version: '1.0.0' };
  await assert.rejects(f.gateway.describe(f.context), { code: 'WRONG_SERVER' });
  f.state.info = { version: '2.0.32' };
  f.state.catalog = { unexpected: [] };
  await assert.rejects(f.gateway.describe(f.context), { code: 'BAD_CATALOG' });
  f.state.catalog = [
    { ...entry(selected), enabled: false },
    { ...entry(configured), capabilities: { output: ['image'] } },
  ];
  const result = await f.gateway.describe(f.context);
  assert.deepEqual(result.models, []);
  assert.ok(result.agents.length > 0);
  assert.equal(result.ready, false);
  assert.equal(result.selectionRequired, true);
  assert.equal(result.defaultModelKey, null);
  assert.equal(result.recommendedModelKey, null);
  f.state.agents = { unexpected: [] };
  await assert.rejects(f.gateway.describe(f.context), { code: 'BAD_CATALOG' });
  readOnly(f);
  noSession(f);
});

test('invalid project defaults fall through to valid app defaults, then named OpenCode defaults', async () => {
  const f = await fixture();
  f.state.settings.projects = [{ path: f.project, defaultAgent: 'missing-project-agent', defaultModel: 'unit-test/missing-project-model' }];
  const context = { ...f.context, agent: undefined, model: undefined };
  const app = await f.gateway.describe(context);
  assert.equal(app.ready, true);
  assert.equal(app.agent, 'configured-agent');
  assert.equal(app.defaultModelKey, modelKey(configured));
  f.state.settings.defaultAgent = 'missing-app-agent';
  f.state.settings.defaultModel = 'unit-test/missing-app-model';
  f.state.config[0].info.default_agent = 'build';
  const opencode = await f.gateway.describe(context);
  assert.equal(opencode.ready, true);
  assert.equal(opencode.agent, 'build');
  assert.equal(opencode.defaultModelKey, modelKey(runtimeDefault));
  f.state.config = [];
  const missing = await f.gateway.prepare(context);
  assert.equal(missing.ready, false);
  assert.equal(missing.agent, null);
  assert.equal(missing.defaultModelKey, null);
  assert.ok(missing.agents.length > 0);
  assert.ok(missing.models.length > 0);
  assert.equal(missing.selectionRequired, true);
  assert.equal(typeof missing.selectionError, 'string');
  await assert.rejects(missing.generate('Must not be sent.', selected), { code: 'NO_AGENT' });
  readOnly(f);
});

test('the live default agent order applies only without named defaults and never supplies an arbitrary model', async () => {
  const f = await fixture();
  f.state.settings = {};
  f.state.config = [];
  f.state.agents = [primary('runtime-primary'), primary('build')];
  const context = { ...f.context, agent: undefined };
  assert.equal((await f.gateway.describe(context)).agent, 'runtime-primary');
  f.state.settings.defaultAgent = 'missing-agent';
  const named = await f.gateway.describe(context);
  assert.equal(named.agent, null);
  assert.equal(named.ready, false);
  f.state.settings = {};
  const noModel = await f.gateway.prepare({ ...context, model: undefined });
  assert.equal(noModel.agent, 'runtime-primary');
  assert.equal(noModel.defaultModelKey, null);
  assert.equal(noModel.ready, false);
  await assert.rejects(noModel.generate('Must not be sent.', selected), { code: 'NO_MODEL' });
  readOnly(f);
});

test('agent catalogs include only enabled visible primary/all agents and resolve IDs rather than labels', async () => {
  const f = await fixture();
  f.state.agents = [
    primary('hidden', { hidden: true }), primary('disabled', { enabled: false }),
    primary('also-disabled', { disabled: true }), primary('worker', { mode: 'subagent' }),
    primary('all-agent', { mode: 'all', model: selected }), primary('build'),
  ];
  const result = await f.gateway.describe({ ...f.context, agentOverride: 'all-agent' });
  assert.deepEqual(result.agents, [
    { id: 'all-agent', label: 'Display all-agent', model: selected },
    { id: 'build', label: 'Display build' },
  ]);
  assert.equal(result.agent, 'all-agent');
  assert.equal(result.ready, true);
  for (const agentOverride of ['hidden', 'disabled', 'also-disabled', 'worker', 'Display all-agent']) {
    const invalid = await f.gateway.prepare({ ...f.context, agentOverride });
    assert.equal(invalid.agent, null);
    assert.equal(invalid.ready, false);
    await assert.rejects(invalid.generate('Must not be sent.', selected), { code: 'NO_AGENT' });
  }
  readOnly(f);
});

test('no available agents requires selection and blocks generation while a verified saved chat remains readable', async () => {
  const f = await fixture();
  f.state.agents = [];
  f.state.messages = [{ type: 'user', text: 'Controlled chat source.' }];
  const connection = await f.gateway.prepare({ ...f.context, sessionId: f.sessionId });
  assert.equal(connection.agent, null);
  assert.deepEqual(connection.agents, []);
  assert.ok(connection.models.length > 0);
  assert.equal(connection.ready, false);
  assert.equal(connection.selectionRequired, true);
  assert.deepEqual(await connection.chatContext(), f.state.messages);
  assert.equal((await measureChat(connection)).available, true);
  await assert.rejects(connection.generate('Must not be sent.', selected), { code: 'NO_AGENT' });
  await assert.rejects(connection.summarizeChat('Must not be sent.'), { code: 'NO_AGENT' });
  // Public selector metadata is not an authorization switch for direct callers.
  connection.ready = true;
  connection.agent = 'build';
  await assert.rejects(connection.generate('Must not be sent.', selected), { code: 'NO_AGENT' });
  readOnly(f);
});

test('no available models leaves the agent catalog and verified chat available but refuses direct generation', async () => {
  const f = await fixture();
  f.state.catalog = [];
  f.state.messages = [{ type: 'user', text: 'Controlled chat source.' }];
  const connection = await f.gateway.prepare({ ...f.context, sessionId: f.sessionId });
  assert.equal(connection.agent, 'session-agent');
  assert.ok(connection.agents.length > 0);
  assert.deepEqual(connection.models, []);
  assert.equal(connection.ready, false);
  assert.equal(connection.defaultModelKey, null);
  assert.equal((await measureChat(connection)).available, true);
  await assert.rejects(connection.generate('Must not be sent.', selected), { code: 'NO_MODEL' });
  readOnly(f);
});

test('Studio agent and model overrides survive query resolution and take precedence without changing the saved chat', async () => {
  const f = await fixture();
  f.state.agents.push(primary('studio-agent', { model: configured }));
  const original = structuredClone(f.state.session);
  const context = await f.gateway.resolveContext({
    ...f.context, sessionId: f.sessionId, agentOverride: 'studio-agent', modelOverride: JSON.stringify(runtimeDefault),
  });
  assert.equal(context.agentOverride, 'studio-agent');
  assert.deepEqual(context.modelOverride, runtimeDefault);
  const connection = await f.gateway.prepare(context);
  assert.equal(connection.ready, true);
  assert.equal(connection.agent, 'studio-agent');
  assert.equal(connection.defaultModelKey, modelKey(runtimeDefault));
  const agentOnly = await f.gateway.describe({ ...context, modelOverride: undefined });
  assert.equal(agentOnly.agent, 'studio-agent');
  assert.equal(agentOnly.defaultModelKey, modelKey(configured));
  const modelOnly = await f.gateway.describe({ ...context, agentOverride: undefined });
  assert.equal(modelOnly.agent, 'session-agent');
  assert.equal(modelOnly.defaultModelKey, modelKey(runtimeDefault));
  assert.deepEqual(f.state.session, original);
  readOnly(f);
  await connection.generate('Controlled prompt.', runtimeDefault);
  assert.deepEqual(JSON.parse(f.requests.at(-1).body), { prompt: 'Controlled prompt.', model: runtimeDefault });
  assert.ok(f.requests.every((request) => request.method === 'GET' || request.route === '/api/experimental/generate'));
  assert.deepEqual(f.state.session, original);
});

test('invalid explicit overrides stay non-ready instead of falling through after a context round trip', async () => {
  const f = await fixture();
  for (const agentOverride of ['missing-agent', ' ', 123]) {
    const context = await f.gateway.resolveContext({ ...f.context, agentOverride });
    const invalid = await f.gateway.prepare(context);
    assert.equal(invalid.agent, null);
    assert.equal(invalid.ready, false);
    await assert.rejects(invalid.generate('Must not be sent.', selected), { code: 'NO_AGENT' });
  }
  for (const modelOverride of [
    { providerID: 'unit-test', id: 'missing' }, { ...selected, variant: 'missing-variant' },
    'not JSON', 'null', '{}', { id: 'selected' },
  ]) {
    const context = await f.gateway.resolveContext({ ...f.context, modelOverride });
    const invalid = await f.gateway.prepare(context);
    assert.equal(invalid.agent, 'draft-agent');
    assert.equal(invalid.defaultModelKey, null);
    assert.equal(invalid.ready, false);
    assert.equal(invalid.selectionRequired, true);
    await assert.rejects(invalid.generate('Must not be sent.', configured), { code: 'NO_MODEL' });
  }
  readOnly(f);
});

test('explicit variant overrides must be in the enabled base catalog, and arbitrary direct models are refused', async () => {
  const f = await fixture();
  const model = { ...selected, variant: 'high' };
  f.state.catalog[0].variants = [{ id: 'high' }, { id: 'disabled', enabled: false }];
  const connection = await f.gateway.prepare({ ...f.context, modelOverride: model });
  assert.equal(connection.ready, true);
  assert.equal(connection.defaultModelKey, modelKey(model));
  assert.ok(connection.models.some((entry) => entry.key === modelKey(model)));
  for (const unavailable of [{ providerID: 'unit-test', id: 'missing' }, { ...selected, variant: 'disabled' }]) {
    await assert.rejects(connection.generate('Must not be sent.', unavailable), { code: 'NO_MODEL' });
  }
  // Adding an entry to the returned UI catalog cannot change the private availability check.
  const unlisted = { providerID: 'unit-test', id: 'unlisted' };
  connection.models.push({ key: modelKey(unlisted), label: 'Unlisted', ref: unlisted });
  await assert.rejects(connection.generate('Must not be sent.', unlisted), { code: 'NO_MODEL' });
  readOnly(f);
});

test('catalog and defaults connection failures remain fatal rather than becoming a guessed selection', async () => {
  const f = await fixture();
  for (const route of ['/api/agent', '/api/config/settings', '/api/config']) {
    f.state.settings = {};
    f.state.responses.set(route, () => new Response('private-marker', { status: 503 }));
    await assert.rejects(f.gateway.describe({ ...f.context, agent: undefined, model: undefined }), (error) =>
      error.code === 'CONNECTION_FAILED' && !error.message.includes('private-marker'));
    f.state.responses.delete(route);
  }
  f.state.responses.set('/api/agent', () => new Response('', { status: 401 }));
  await assert.rejects(f.gateway.describe(f.context), { code: 'AUTH_REQUIRED' });
  readOnly(f);
});
