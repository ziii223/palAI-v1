import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/app.js';

test('health is public liveness only; API misses and local files stay isolated', async (t) => {
  const server = createApp(resolve('dist/client')).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-type') || '', /application\/json/);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const missingApi = await fetch(`${base}/api/not-implemented`, { method: 'POST' });
  assert.equal(missingApi.status, 404);
  assert.deepEqual(await missingApi.json(), {
    error: { code: 'INVALID_REQUEST', message: 'API route not found.', retryable: false },
  });

  for (const path of ['/.env', '/dev/backend-tester/README.md', '/data/palaycheck/palaycheck.pdf']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404);
  }
});
