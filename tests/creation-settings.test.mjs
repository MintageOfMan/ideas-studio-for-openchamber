import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateJob, validateRequest } from '../shared/common/formats.mjs';

const request = extra => ({ id: randomUUID(), format: 'summary', sources: [{ path: 'notes.md', content: 'Source facts.' }], model: { providerID: 'unit-test', id: 'model' }, ...extra });

test('Second pass defaults on and an explicit off survives source resolution', () => {
  assert.equal(validateRequest(request()).secondPass, true);
  assert.equal(validateJob(request()).secondPass, true);
  assert.equal(validateRequest(request({ secondPass: false })).secondPass, false);
  assert.equal(validateJob(request({ secondPass: false })).secondPass, false);
});

test('ambiguous Second pass values are rejected instead of accidentally spending extra calls', () => {
  for (const secondPass of [null, 'false', 'true', 0, 1, [], {}]) {
    assert.throws(() => validateRequest(request({ secondPass })), { code: 'BAD_SECOND_PASS' });
  }
});
