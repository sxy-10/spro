import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { signInternalRequest } from './internalRouter.js';

test('internal HMAC binds method, path, timestamp, nonce and JSON body', () => {
  const secret = 'independent-test-secret-with-more-than-32-characters';
  const timestamp = '1795600000000';
  const nonce = '0123456789abcdef01234567';
  const body = { task: 'expire-orders', batch: 10 };
  const signature = signInternalRequest('POST', '/internal/timers/expire-orders', timestamp, nonce, body, secret);
  const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const expected = createHmac('sha256', secret)
    .update(['POST', '/internal/timers/expire-orders', timestamp, nonce, bodyHash].join('\n'))
    .digest('hex');
  assert.equal(signature, expected);
  assert.match(signature, /^[a-f0-9]{64}$/);
  assert.notEqual(
    signature,
    signInternalRequest('POST', '/internal/timers/refresh-stock', timestamp, nonce, body, secret)
  );
  assert.notEqual(
    signature,
    signInternalRequest('POST', '/internal/timers/expire-orders', timestamp, nonce, { ...body, batch: 11 }, secret)
  );
  assert.notEqual(
    signature,
    signInternalRequest('GET', '/internal/timers/expire-orders', timestamp, nonce, body, secret)
  );
});
