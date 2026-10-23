import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../shared/service/server.mjs';

test('the service resolves draft context and browses/inspects files without a chat or generation', async t => {
  const temp = fileURLToPath(new URL('../temp/', import.meta.url));
  await fs.mkdir(temp, { recursive: true });
  const directory = await fs.mkdtemp(path.join(temp, 'startup-service-'));
  await fs.mkdir(path.join(directory, 'docs'));
  await fs.writeFile(path.join(directory, 'notes.md'), 'Fixture notes.');
  await fs.writeFile(path.join(directory, 'docs', 'nested.md'), 'Nested notes.');
  let preparations = 0;
  const gateway = {
    resolveContext: async context => ({ ...context, directory, sessionId: context.sessionId || '', agent: 'build' }),
    describe: async context => ({ directory: context.directory, agent: 'build', models: [], version: '2.0.32' }),
    prepare: async () => { preparations += 1; throw new Error('No chat should be read during folder browsing.'); },
  };
  const token = randomUUID();
  const { server } = createStudioServer({ token, gateway });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = async (route, params = {}) => {
    const response = await fetch(`${origin}${route}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, route);
    return response.json();
  };
  assert.equal((await get('/context')).directory, directory);
  assert.equal((await get('/connection')).agent, 'build');
  const root = await get('/sources', { directory, sort: 'modifiedAt' });
  assert.deepEqual(root.entries.map(entry => entry.path), ['docs', 'notes.md']);
  assert.ok(root.entries.every(entry => !('characters' in entry)));
  const nested = await get('/sources', { directory, folder: 'docs', sort: 'createdAt', direction: 'desc' });
  assert.equal(nested.entries[0].path, 'docs/nested.md');
  assert.deepEqual(await get('/source', { directory, path: 'notes.md' }), { path: 'notes.md', characters: 14 });
  assert.equal((await get('/chat', { directory })).available, false);
  assert.equal(preparations, 0);
  // The fixtures are deliberately retained; no existing files are deleted by this test.
});
