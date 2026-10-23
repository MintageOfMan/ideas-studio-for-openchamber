import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSource, listSources, readSource, readSourceOrExplain } from '../shared/service/sources.mjs';

// Every run keeps its fixtures under this repository, including the outside-boundary fixtures.
// There is deliberately no cleanup: these focused checks never delete files.
const temp = fileURLToPath(new URL('../temp/', import.meta.url));
async function project() {
  await fs.mkdir(temp, { recursive: true });
  return fs.mkdtemp(path.join(temp, 'source-browser-'));
}

test('listing is immediate-child metadata only, including hidden/tool folders and unsupported files', async (t) => {
  const root = await project();
  const folders = ['docs', '.git', '.studio', '.hidden', 'node_modules', 'temp', 'dist', 'build', 'out', 'coverage', '__pycache__', 'venv', '.venv', '..notes', ' Folder with spaces', 'Folder.MD'];
  for (const folder of folders) {
    await fs.mkdir(path.join(root, folder));
    await fs.writeFile(path.join(root, folder, 'inside.md'), 'Nested fixture.');
  }
  const files = {
    'notes.md': 'Notes.', '.hidden.txt': 'Visible.', 'LICENSE.md': 'License fixture.', 'package.json': '{}',
    'LICENSE': 'Unsupported extension.', 'image.png': 'Unsupported fixture.',
    'binary.txt': Buffer.from([0x61, 0, 0x62]), 'broken.docx': 'Not an Office document.', 'empty.md': '',
  };
  for (const [name, contents] of Object.entries(files)) await fs.writeFile(path.join(root, name), contents);
  const expectedInfo = await fs.lstat(path.join(root, 'notes.md'));
  const realReaddir = fs.readdir;
  const visited = [];
  t.mock.method(fs, 'readdir', async (directory, ...args) => {
    visited.push(directory);
    return realReaddir(directory, ...args);
  });
  const reads = t.mock.method(fs, 'readFile', async () => assert.fail('browsing must not read file contents'));
  const opens = t.mock.method(fs, 'open', async () => assert.fail('browsing must not open files'));

  const page = await listSources(root);
  const byPath = Object.fromEntries(page.entries.map((entry) => [entry.path, entry]));
  assert.equal(page.folder, '');
  assert.equal(page.total, folders.length + Object.keys(files).length);
  assert.equal(page.next, null);
  assert.deepEqual(visited, [await fs.realpath(root)]);
  assert.equal(reads.mock.callCount(), 0);
  assert.equal(opens.mock.callCount(), 0);
  for (const folder of folders) {
    assert.equal(byPath[folder].name, folder);
    assert.equal(byPath[folder].entryType, 'directory');
    assert.equal(byPath[folder].kind, null);
    assert.equal(byPath[folder].size, null);
    assert.ok(!byPath[folder].error);
  }
  for (const name of Object.keys(files)) assert.equal(byPath[name].entryType, 'file');
  assert.equal(byPath['notes.md'].size, expectedInfo.size);
  assert.equal(byPath['notes.md'].createdAt, expectedInfo.birthtimeMs || null);
  assert.equal(byPath['notes.md'].modifiedAt, expectedInfo.mtimeMs);
  assert.equal(byPath['notes.md'].kind, 'text');
  assert.equal(byPath['LICENSE.md'].kind, 'text');
  assert.equal(byPath['package.json'].kind, 'text');
  assert.equal(byPath['image.png'].kind, null);
  assert.match(byPath['image.png'].error, /cannot read/);
  assert.match(byPath.LICENSE.error, /cannot read/);
  assert.ok(!byPath['binary.txt'].error && !byPath['broken.docx'].error && !byPath['empty.md'].error, 'contents are not examined');
  assert.ok(page.entries.every((entry) => entry.folder === '' && !entry.path.includes('/')));
  assert.ok(page.entries.every((entry) => !('characters' in entry) && !('text' in entry) && !('pending' in entry)));
});

test('pages retain every entry and keep folders first even when sorting downwards', async () => {
  const root = await project();
  await fs.mkdir(path.join(root, 'A folder'));
  await fs.mkdir(path.join(root, 'Z folder'));
  for (let index = 0; index < 205; index += 1) {
    await fs.writeFile(path.join(root, `item-${String(index).padStart(3, '0')}.txt`), 'x'.repeat(index + 1));
  }
  const first = await listSources(root);
  const second = await listSources(root, { offset: first.next });
  const third = await listSources(root, { offset: second.next });
  assert.deepEqual([first.total, second.total, third.total], [207, 207, 207]);
  assert.deepEqual([first.entries.length, second.entries.length, third.entries.length], [100, 100, 7]);
  assert.deepEqual([first.next, second.next, third.next], [100, 200, null]);
  const all = [...first.entries, ...second.entries, ...third.entries].map((entry) => entry.path);
  assert.equal(new Set(all).size, 207);
  assert.deepEqual(all.slice(0, 3), ['A folder', 'Z folder', 'item-000.txt']);
  assert.equal(all.at(-1), 'item-204.txt');
  assert.deepEqual(await listSources(root, { offset: 207 }), { folder: '', entries: [], total: 207, next: null });
  assert.equal((await listSources(root, { offset: 1000 })).next, null);
  const descending = await listSources(root, { sort: 'size', direction: 'desc' });
  assert.deepEqual(descending.entries.slice(0, 4).map((entry) => entry.path), ['Z folder', 'A folder', 'item-204.txt', 'item-203.txt']);
  assert.equal(descending.next, 100);
  assert.ok(JSON.stringify(descending).length < 240_000);
});

test('name, size, creation and modification sorts keep unknown metadata last in both directions', async (t) => {
  const root = await project();
  for (const folder of ['A folder', 'Z folder']) await fs.mkdir(path.join(root, folder));
  for (const [name, size] of [['a.txt', 3], ['b.txt', 1], ['c.txt', 2], ['undated.txt', 4], ['unknown.txt', 5]]) {
    await fs.writeFile(path.join(root, name), 'x'.repeat(size));
  }
  const times = {
    'A folder': [3000, 1000], 'Z folder': [1000, 3000],
    'a.txt': [3000, 1000], 'b.txt': [1000, 3000], 'c.txt': [2000, 2000], 'undated.txt': [0, NaN],
  };
  const realLstat = fs.lstat;
  t.mock.method(fs, 'lstat', async (target, ...args) => {
    const name = path.basename(target);
    if (name === 'unknown.txt') throw Object.assign(new Error('Controlled metadata failure'), { code: 'EACCES' });
    const info = await realLstat(target, ...args);
    if (times[name]) [info.birthtimeMs, info.mtimeMs] = times[name];
    return info;
  });
  const orders = [
    ['name', 'asc', ['A folder', 'Z folder', 'a.txt', 'b.txt', 'c.txt', 'undated.txt', 'unknown.txt']],
    ['name', 'desc', ['Z folder', 'A folder', 'unknown.txt', 'undated.txt', 'c.txt', 'b.txt', 'a.txt']],
    ['size', 'asc', ['A folder', 'Z folder', 'b.txt', 'c.txt', 'a.txt', 'undated.txt', 'unknown.txt']],
    ['size', 'desc', ['Z folder', 'A folder', 'undated.txt', 'a.txt', 'c.txt', 'b.txt', 'unknown.txt']],
    ['createdAt', 'asc', ['Z folder', 'A folder', 'b.txt', 'c.txt', 'a.txt', 'undated.txt', 'unknown.txt']],
    ['createdAt', 'desc', ['A folder', 'Z folder', 'a.txt', 'c.txt', 'b.txt', 'unknown.txt', 'undated.txt']],
    ['modifiedAt', 'asc', ['A folder', 'Z folder', 'a.txt', 'c.txt', 'b.txt', 'undated.txt', 'unknown.txt']],
    ['modifiedAt', 'desc', ['Z folder', 'A folder', 'b.txt', 'c.txt', 'a.txt', 'unknown.txt', 'undated.txt']],
  ];
  for (const [sort, direction, expected] of orders) {
    const page = await listSources(root, { sort, direction });
    assert.deepEqual(page.entries.map((entry) => entry.name), expected, `${sort} ${direction}`);
    const unknown = page.entries.find((entry) => entry.name === 'unknown.txt');
    assert.deepEqual([unknown.size, unknown.createdAt, unknown.modifiedAt], [null, null, null]);
    assert.equal(unknown.entryType, 'file');
    assert.match(unknown.error, /could not be checked/);
    const undated = page.entries.find((entry) => entry.name === 'undated.txt');
    assert.deepEqual([undated.createdAt, undated.modifiedAt], [null, null]);
  }
});

test('navigation has no fixed depth, preserves names and does not read until inspection', async (t) => {
  const root = await project();
  const parts = ['.hidden', 'node_modules', '..notes', 'Folder with spaces', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  await fs.mkdir(path.join(root, ...parts), { recursive: true });
  await fs.writeFile(path.join(root, ...parts, 'Deep Notes.MD'), 'Deep notes.');
  const realReadFile = fs.readFile;
  const reads = t.mock.method(fs, 'readFile', (...args) => realReadFile(...args));
  for (let depth = 0; depth < parts.length; depth += 1) {
    const folder = parts.slice(0, depth).join('/');
    const page = await listSources(root, { folder });
    assert.equal(page.folder, folder);
    assert.equal(page.total, 1);
    assert.equal(page.next, null);
    assert.equal(page.entries[0].path, parts.slice(0, depth + 1).join('/'));
    assert.equal(page.entries[0].folder, folder);
    assert.equal(page.entries[0].name, parts[depth]);
    assert.equal(page.entries[0].entryType, 'directory');
  }
  const folder = parts.join('/');
  const leaf = await listSources(root, { folder });
  const relative = `${folder}/Deep Notes.MD`;
  assert.equal(leaf.entries[0].path, relative);
  assert.equal(leaf.entries[0].kind, 'text');
  assert.equal(reads.mock.callCount(), 0);
  assert.deepEqual(await inspectSource(root, relative), { path: relative, characters: 'Deep notes.'.length });
  assert.equal(reads.mock.callCount(), 1);
});

test('invalid paths, offsets and sort options are rejected before filesystem access', async (t) => {
  const root = await project();
  const operations = ['lstat', 'realpath', 'readdir', 'readFile'].map((name) =>
    t.mock.method(fs, name, async () => assert.fail('invalid input must not touch the filesystem')));
  const folders = ['..', '../outside', 'docs/../../outside', '/absolute', 'C:/absolute', 'C:relative', '\\\\server\\share', 'docs\\child', './docs', 'docs/../child', 'docs//child', 'docs/', 'bad\0name', root, null, 12];
  for (const folder of folders) await assert.rejects(listSources(root, { folder }), { code: 'BAD_SOURCE' });
  for (const relative of ['../outside.md', 'docs/../../outside.md', '/absolute.md', 'C:/absolute.md', 'C:relative.md', 'docs\\notes.md', './notes.md', 'docs/../notes.md', 'docs//notes.md', 'bad\0name.md', '', null, 12]) {
    assert.equal((await readSourceOrExplain(root, relative)).error.code, 'BAD_SOURCE');
    const inspection = await inspectSource(root, relative);
    assert.equal(typeof inspection.error, 'string');
    assert.ok(!('text' in inspection) && !('characters' in inspection));
  }
  for (const offset of [-1, 0.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(listSources(root, { offset }), { code: 'BAD_OFFSET' });
  }
  await assert.rejects(listSources(root, { sort: 'unknown' }), { code: 'BAD_SORT' });
  await assert.rejects(listSources(root, { direction: 'down' }), { code: 'BAD_SORT' });
  for (const operation of operations) assert.equal(operation.mock.callCount(), 0);
});

test('directory shortcuts stay visible but cannot escape the root during browsing or reads', async (t) => {
  const root = await project();
  const outside = `${root}-outside`;
  await fs.mkdir(path.join(root, 'docs'));
  await fs.mkdir(path.join(outside, 'nested'), { recursive: true });
  await fs.writeFile(path.join(outside, 'nested', 'notes.md'), 'Outside boundary fixture.');
  try {
    await fs.symlink(outside, path.join(root, 'docs', 'shortcut.md'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    t.skip('This system does not permit creating a directory shortcut. Fixtures are retained.');
    return;
  }
  const reads = t.mock.method(fs, 'readFile', async () => assert.fail('an outside source must not be read'));
  const realReaddir = fs.readdir;
  const visited = [];
  t.mock.method(fs, 'readdir', async (target, ...args) => {
    visited.push(target);
    return realReaddir(target, ...args);
  });
  const page = await listSources(root, { folder: 'docs' });
  assert.equal(page.entries[0].entryType, 'other');
  assert.equal(page.entries[0].path, 'docs/shortcut.md');
  assert.equal(page.entries[0].kind, null);
  assert.match(page.entries[0].error, /shortcut/);
  for (const folder of ['docs/shortcut.md', 'docs/shortcut.md/nested']) {
    await assert.rejects(listSources(root, { folder }), { code: 'BAD_SOURCE' });
  }
  for (const relative of ['docs/shortcut.md', 'docs/shortcut.md/nested/notes.md']) {
    assert.equal((await readSourceOrExplain(root, relative)).error.code, 'BAD_SOURCE');
    assert.match((await inspectSource(root, relative)).error, /shortcut/);
  }
  assert.deepEqual(visited, [await fs.realpath(path.join(root, 'docs'))]);
  assert.equal(reads.mock.callCount(), 0);
});

test('canonical escapes to a same-prefix sibling are rejected before enumeration or reading', async (t) => {
  const root = await project();
  const outside = `${root}-outside`;
  await fs.mkdir(path.join(root, 'docs'));
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'notes.md'), 'Outside boundary fixture.');
  const realRealpath = fs.realpath;
  const canonicalRoot = await realRealpath(root);
  const canonicalOutside = await realRealpath(outside);
  t.mock.method(fs, 'realpath', (target, ...args) => path.relative(canonicalRoot, target) === 'docs'
    ? Promise.resolve(canonicalOutside) : realRealpath(target, ...args));
  const reads = t.mock.method(fs, 'readFile', async () => assert.fail('outside files must not be read'));
  const listings = t.mock.method(fs, 'readdir', async () => assert.fail('outside folders must not be listed'));
  await assert.rejects(listSources(root, { folder: 'docs' }), { code: 'BAD_SOURCE' });
  assert.equal((await readSourceOrExplain(root, 'docs/notes.md')).error.code, 'BAD_SOURCE');
  assert.equal(reads.mock.callCount(), 0);
  assert.equal(listings.mock.callCount(), 0);
});

test('inspection returns counts or existing explanations, shares the read cache and respects file limits', async (t) => {
  const root = await project();
  const contents = '# Notes\nPlants need water.\n';
  await fs.writeFile(path.join(root, 'notes.md'), contents);
  await fs.writeFile(path.join(root, 'page.html'), '<h1>Plants &amp; water</h1><p>Roots.</p><script>throw 0</script>');
  await fs.writeFile(path.join(root, 'binary.txt'), Buffer.from([0x61, 0, 0x62]));
  await fs.writeFile(path.join(root, 'empty.md'), '   ');
  await fs.writeFile(path.join(root, 'broken.docx'), 'Not an Office document.');
  await fs.writeFile(path.join(root, 'image.png'), 'Unsupported fixture.');
  await fs.writeFile(path.join(root, 'long.md'), 'x'.repeat(200_001));
  await fs.mkdir(path.join(root, 'folder.md'));
  const large = await fs.open(path.join(root, 'large.txt'), 'wx');
  try { await large.truncate(25 * 1024 * 1024 + 1); }
  finally { await large.close(); }
  const realReadFile = fs.readFile;
  const reads = t.mock.method(fs, 'readFile', (...args) => realReadFile(...args));
  const page = await listSources(root);
  assert.equal(reads.mock.callCount(), 0);
  assert.match(page.entries.find((entry) => entry.name === 'large.txt').error, /over 25 MB/);

  assert.deepEqual(await inspectSource(root, 'notes.md'), { path: 'notes.md', characters: contents.trim().length });
  assert.equal(reads.mock.callCount(), 1);
  assert.equal(await readSource(root, 'notes.md'), contents.trim());
  assert.deepEqual(await inspectSource(root, 'notes.md'), { path: 'notes.md', characters: contents.trim().length });
  assert.equal(reads.mock.callCount(), 1, 'selection and later source reads share the parse');
  await fs.appendFile(path.join(root, 'notes.md'), 'More notes.');
  assert.deepEqual(await inspectSource(root, 'notes.md'), { path: 'notes.md', characters: (contents + 'More notes.').length });
  assert.equal(reads.mock.callCount(), 2, 'changed files are inspected again');
  assert.deepEqual(await inspectSource(root, 'page.html'), { path: 'page.html', characters: 'Plants & water\nRoots.'.length });
  assert.deepEqual(await inspectSource(root, 'long.md'), { path: 'long.md', characters: 200_001 }, 'inspection never truncates source text');
  assert.deepEqual(await inspectSource(root, 'binary.txt'), { path: 'binary.txt', error: 'binary.txt is not readable as text.' });
  const beforeRetry = reads.mock.callCount();
  await inspectSource(root, 'binary.txt');
  assert.equal(reads.mock.callCount(), beforeRetry + 1, 'failed parses are not cached');
  assert.deepEqual(await inspectSource(root, 'empty.md'), { path: 'empty.md', error: 'empty.md has no text in it.' });
  assert.deepEqual(await inspectSource(root, 'broken.docx'), { path: 'broken.docx', error: 'broken.docx could not be opened; it may be damaged.' });
  const beforeRejected = reads.mock.callCount();
  for (const [relative, reason] of [['large.txt', /over 25 MB/], ['image.png', /kind of file Studio cannot read/], ['folder.md', /not a file/], ['gone.md', /no longer exists/]]) {
    const inspection = await inspectSource(root, relative);
    assert.deepEqual(Object.keys(inspection).sort(), ['error', 'path']);
    assert.match(inspection.error, reason);
  }
  assert.equal(reads.mock.callCount(), beforeRejected);
  await assert.rejects(listSources(root, { folder: 'notes.md' }), { code: 'BAD_SOURCE' });
});
