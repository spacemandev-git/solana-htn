import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHarness, json, type Harness } from './harness.ts';

let h: Harness;
beforeEach(() => { h = createHarness(); });
afterEach(() => { h.close(); });

test('health reports registered badges, live badges, apps, and the public URL', async () => {
  const first = await h.connectBadge({ mac: 'aabbccddeeff' });
  await h.connectBadge({ mac: '112233445566' });
  first.close();
  await Bun.sleep(20);
  await h.post('/v1/apps', {
    name: 'Health App',
    description: 'An application used to verify health counters.',
    url: 'https://example.com/health',
    author: 'Ada',
    kind: 'tool',
  });
  expect(await json<unknown>(await h.request('/v1/health'))).toEqual({
    ok: true,
    badgesRegistered: 2,
    badgesOnline: 1,
    apps: 1,
    publicUrl: 'http://localhost:3100',
  });
});
