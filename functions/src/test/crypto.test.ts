import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { open, seal } from '../crypto';

const key = randomBytes(32).toString('base64');

test('seal/open round-trip', () => {
  const s = seal('1//refresh-token-value', key, 'conn123');
  assert.notEqual(s.data, '1//refresh-token-value');
  assert.equal(open(s, key, 'conn123'), '1//refresh-token-value');
});

test('ciphertext is bound to its connection id', () => {
  const s = seal('secret', key, 'connA');
  assert.throws(() => open(s, key, 'connB'));
});

test('wrong key fails; tampering fails', () => {
  const s = seal('secret', key, 'c');
  assert.throws(() => open(s, randomBytes(32).toString('base64'), 'c'));
  const t = { ...s, data: Buffer.from('tampered').toString('base64') };
  assert.throws(() => open(t, key, 'c'));
});

test('rejects short keys', () => {
  assert.throws(() => seal('x', randomBytes(16).toString('base64'), 'c'), /32 bytes/);
});

import { assertClientId } from '../config';
test('client ID guard rejects secrets and junk', () => {
  assert.throws(() => assertClientId('GOCSPX-dummySecretValueForTestingPurposesOnly'), /SECRET/);
  assert.throws(() => assertClientId('hello'), /not an OAuth client ID/);
  assert.doesNotThrow(() => assertClientId('123456789-placeholder.apps.googleusercontent.com'));
});
