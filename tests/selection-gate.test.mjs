import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canCreate, chosenModel, contextQuery, selectionContext } from '../shared/panel/context.mjs';
import { modelKey } from '../shared/common/core.mjs';
import { createStudioServer } from '../shared/service/server.mjs';

const model = { providerID: 'unit-test', id: 'available' };
const models = [{ ref: model, key: modelKey(model), label: 'Available model' }];
const selection = { ready: true, agent: 'build', agents: [{ id: 'build' }], models, defaultModelKey: modelKey(model) };

test('creation requires a verified agent and model; retry recommendations are not a default selection', () => {
  assert.equal(canCreate(selection), true);
  for (const connection of [null, { ...selection, ready: false }, { ...selection, agent: null },
    { ...selection, agents: [] }, { ...selection, models: [] }]) assert.equal(canCreate(connection), false);
  const unresolved = { ...selection, defaultModelKey: null, selectedModelKey: null, recommendedModelKey: modelKey(model) };
  assert.equal(chosenModel(unresolved), null);
  assert.equal(canCreate(unresolved), false);
});

test('Studio override queries preserve agent/model selection without changing the host context', () => {
  const host = Object.freeze({ directory: '/project', sessionId: 'ses_test', hostOrigin: 'http://localhost:1', agent: 'build', model });
  const variant = { ...model, variant: 'high' };
  const manual = selectionContext(host, 'plan', modelKey(variant));
  assert.equal(manual.agentOverride, 'plan');
  assert.deepEqual(manual.modelOverride, variant);
  assert.equal(manual.agent, host.agent);
  assert.equal(host.agentOverride, undefined);
  const query = new URLSearchParams(contextQuery(manual));
  assert.equal(query.get('agentOverride'), 'plan');
  assert.deepEqual(JSON.parse(query.get('modelOverride')), variant);
  assert.deepEqual(selectionContext(manual), host);
});

test('the service refuses job submission until the agent/model selection is valid', async t => {
  const temp = fileURLToPath(new URL('../temp/', import.meta.url));
  await fs.mkdir(temp, { recursive: true });
  const directory = await fs.mkdtemp(path.join(temp, 'selection-gate-'));
  let connection = { ...selection, ready: false, agent: null, agents: [] };
  let starts = 0;
  const gateway = { prepare: async () => connection };
  const jobs = {
    start: async (_directory, body, _generate, options) => { starts += 1; return { id: body.id, status: 'queued', agent: options.connection.agent }; },
    public: record => record,
  };
  const token = randomUUID();
  const { server } = createStudioServer({ token, gateway, jobs });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const submit = () => fetch(`http://127.0.0.1:${server.address().port}/jobs`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: randomUUID(), format: 'summary', sources: [{ path: 'notes.md' }], model, context: { directory } }),
  });
  let response = await submit();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'AI_SELECTION_REQUIRED');
  connection = { ...selection, agents: [] };
  assert.equal((await submit()).status, 409);
  connection = { ...selection, models: [] };
  assert.equal((await submit()).status, 400);
  assert.equal(starts, 0);
  connection = selection;
  response = await submit();
  assert.equal(response.status, 202);
  assert.equal((await response.json()).agent, 'build');
  assert.equal(starts, 1);
  // Retain the task-owned fixture; no model is called and no files are deleted.
});
