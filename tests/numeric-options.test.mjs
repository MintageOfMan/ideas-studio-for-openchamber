import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { CHOICES, defaultChoice, formatFor, validateJob } from '../shared/common/formats.mjs';
import { DOCUMENT_CAPS, pptx } from '../shared/common/documents.mjs';
import { infographic, LAYOUTS } from '../shared/common/infographic.mjs';
import { buildPptx } from '../shared/service/builders/pptx.mjs';

const request = (format, choice) => ({
  id: randomUUID(), format, choice,
  source: { path: 'notes.md', content: 'Facts from the selected source.' },
  instructions: 'Focus on the facts.', model: { providerID: 'unit-test', id: 'controlled-transport' },
});
const numbers = (text) => (text.match(/\d+/g) ?? []).map(Number);

test('saved choice IDs keep their defaults and every displayed target reaches the prompt', () => {
  const historyChoices = {
    summary: [['short', 'standard', 'long'], 'standard'],
    docx: [['short', 'standard', 'long'], 'standard'],
    pdf: [['short', 'standard', 'long'], 'standard'],
    webpage: [['short', 'standard', 'long'], 'standard'],
    pptx: [['short', 'standard'], 'standard'],
    flashcards: [['fewer', 'standard', 'more'], 'standard'],
    quiz: [['easy', 'medium', 'hard'], 'medium'],
    infographic: [['simple', 'detailed'], 'detailed'],
    mindmap: [['simple', 'standard'], 'standard'],
  };
  assert.deepEqual(Object.keys(CHOICES).sort(), Object.keys(historyChoices).sort());
  for (const [key, [ids, defaultID]] of Object.entries(historyChoices)) {
    assert.deepEqual(CHOICES[key].options.map((option) => option.id), ids, key);
    assert.equal(defaultChoice(key), defaultID, key);
    assert.equal(validateJob(request(key)).choice, defaultID, key);
    for (const option of CHOICES[key].options) {
      const input = validateJob(request(key, option.id));
      const prompt = formatFor(key).prompt(input);
      const payload = JSON.parse(prompt.split('\n').at(-1));
      assert.equal(payload.preference, option.hint, `${key}/${option.id}`);
      assert.equal(payload.focus, 'Focus on the facts.');
      assert.match(option.label, /(?:about|up to) \d+/i, `${key}/${option.id}`);
      assert.ok(numbers(option.label).every((number) => numbers(payload.preference).includes(number)), `${key}/${option.id}`);
    }
  }
  const sheet = validateJob(request('xlsx'));
  assert.equal(sheet.choice, null);
  assert.equal(sheet.preference, '');
  assert.equal(sheet.instructions, 'Focus on the facts.');
});

test('the Slides target includes the title slide in the actual PowerPoint file', async () => {
  const meta = { source: 'Test notes', createdAt: new Date('2026-01-01T00:00:00Z'), notes: [] };
  for (const option of CHOICES.pptx.options) {
    const total = numbers(option.label)[0];
    const input = validateJob(request('pptx', option.id));
    const content = Number(input.preference.match(/at most (\d+) content slides/)[1]);
    assert.equal(content + 1, total);
    assert.ok(content <= DOCUMENT_CAPS.slides);
    const built = pptx.build(JSON.stringify({ title: 'A deck', slides: Array.from({ length: content }, (_, index) => ({
      title: `Point ${index + 1}`, bullets: ['A source fact.'], notes: '',
    })) }));
    const { bytes } = await buildPptx(built.artifact, meta);
    const slideFiles = Object.keys(unzipSync(bytes)).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    assert.equal(slideFiles.length, total, option.id);
  }
});

test('Infographic numeric targets fit each data shape, including the fixed group counts', () => {
  for (const option of CHOICES.infographic.options) {
    const [count, perGroup] = numbers(option.label);
    for (const layout of ['cards', 'columns', 'compare', 'swot', 'tree']) {
      const { kind, groups } = LAYOUTS[layout];
      const items = Array.from({ length: count }, (_, index) => ({ label: `Fact ${index + 1}`, value: index + 1 }));
      const body = kind === 'items' ? { items }
        : kind === 'values' ? { values: items }
          : kind === 'groups' ? { groups: Array.from({ length: groups }, (_, index) => ({
            label: `Group ${index + 1}`, items: Array.from({ length: perGroup }, (_, item) => `Fact ${item + 1}`),
          })) }
            : { root: { label: 'Main idea', children: items.slice(1) } };
      const { artifact, notes } = infographic.build(JSON.stringify({ layout, title: 'A poster', ...body }));
      assert.deepEqual(notes, [], `${layout}/${option.id}`);
      if (kind === 'groups') {
        assert.equal(artifact.groups.length, groups);
        assert.ok(artifact.groups.every((group) => group.items.length === perGroup));
      } else {
        assert.equal(kind === 'tree' ? 1 + artifact.root.children.length : (artifact.items ?? artifact.values).length, count);
      }
    }
  }
});
