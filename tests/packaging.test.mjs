import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyLicenses } from '../scripts/dependency-licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalize = text => text.replace(/\r\n/g, '\n').trim();

test('license collection includes nested packages and original vendored notices', async () => {
  const inputs = [
    'node_modules/jszip/node_modules/readable-stream/readable.js',
    'node_modules/htmlparser2/node_modules/dom-serializer/lib/index.js',
    'node_modules/postcss/node_modules/nanoid/index.js',
    'node_modules/@antv/layout/lib/node_modules/dagre/index.js',
    'node_modules/@antv/layout/lib/node_modules/graphlib/index.js',
  ];
  const text = normalize((await dependencyLicenses(inputs, root)).join('\n'));
  for (const file of [
    'node_modules/jszip/node_modules/readable-stream/LICENSE',
    'node_modules/htmlparser2/node_modules/dom-serializer/LICENSE',
    'node_modules/postcss/node_modules/nanoid/LICENSE',
  ]) assert.ok(text.includes(normalize(await fs.readFile(path.join(root, file), 'utf8'))), file);
  assert.ok(text.includes('Copyright (c) 2012-2014 Chris Pettitt'));
  assert.ok(text.includes('Copyright (c) 2014, Chris Pettitt'));
  await assert.rejects(dependencyLicenses(['node_modules/fixture-without-a-license/index.js'], root), /Missing license/);
});

test('Git-root and platform packages expose valid installable extension manifests', async () => {
  for (const folder of ['', 'windows-11-x64', 'linux-fedora-amd64']) {
    const directory = path.join(root, folder);
    const { openchamber } = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    assert.equal(openchamber.apiVersion, 1);
    const { panel, service } = openchamber.contributes;
    assert.equal(panel.id, 'ideas-studio-v2');
    assert.match(panel.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    for (const file of [panel.entry, panel.icon, service.entry]) {
      assert.ok(!path.isAbsolute(file));
      await fs.access(path.join(directory, file));
    }
  }
});
