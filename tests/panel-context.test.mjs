import test from 'node:test';
import assert from 'node:assert/strict';
import { chosenModel, contextQuery, hostContext } from '../shared/panel/context.mjs';
import { FORMATS } from '../shared/common/formats.mjs';
import { ICONS, NOUNS, TILES } from '../shared/panel/icons.js';

test('draft host context is valid without a directory or saved session', () => {
  assert.deepEqual(hostContext({ directory: null, session: null }, 'http://localhost:1'), {
    directory: null, sessionId: '', hostOrigin: 'http://localhost:1',
  });
});

test('SDK model strings and agent selection survive the service query', () => {
  const context = hostContext({ directory: '/project', session: {
    id: 'ses_test', model: 'test-provider/model/name#variant', agent: 'plan',
  } }, 'http://localhost:1');
  assert.deepEqual(context.model, { providerID: 'test-provider', id: 'model/name', variant: 'variant' });
  const query = new URLSearchParams(contextQuery(context, { folder: 'notes & drafts' }));
  assert.deepEqual(JSON.parse(query.get('model')), context.model);
  assert.equal(query.get('agent'), 'plan');
  assert.equal(query.get('folder'), 'notes & drafts');
  assert.ok(!hostContext({ session: { model: 'A display label' } }, 'http://localhost:1').model);
});

test('Automatic follows the session default, not the retry fallback; explicit overrides win', () => {
  const session = { key: 'session', label: 'Session model' };
  const fallback = { key: 'fallback', label: 'Fallback' };
  const connection = { models: [fallback, session], defaultModelKey: session.key, recommendedModelKey: fallback.key };
  assert.equal(chosenModel(connection), session);
  assert.equal(chosenModel(connection, fallback.key), fallback);
  assert.equal(chosenModel(connection, 'removed-model'), session);
  assert.equal(chosenModel(null), null);
});

test('tile names, descriptions and icons match the current catalog', () => {
  assert.deepEqual(Object.keys(TILES), FORMATS.map((format) => format.key));
  assert.ok(FORMATS.every((format) => ICONS[format.key]));
  assert.equal(TILES.xlsx.name, 'Spreadsheet');
  assert.equal(NOUNS.xlsx, 'spreadsheet');
  assert.equal(ICONS.image, undefined);
  assert.deepEqual(Object.fromEntries(Object.entries(TILES).map(([key, value]) => [key, value.blurb])), {
    summary: 'The key points', docx: 'Generate Word document', pptx: 'Generate PowerPoint presentation',
    xlsx: 'Generate Excel spreadsheet', webpage: 'Generate HTML dashboard', pdf: 'Generate Portable PDF',
    mindmap: 'See how ideas connect', flashcards: 'Practice and remember', quiz: 'Test yourself',
    podcast: 'Coming soon', infographic: 'One-page poster',
  });
});
