import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHarness, json, type Harness } from './harness.ts';

let h: Harness;
beforeEach(() => { h = createHarness(); });
afterEach(() => { h.close(); });

const valid = (name: string) => ({
  name,
  description: 'A sufficiently descriptive badge application.',
  url: `https://example.com/${name.toLowerCase().replaceAll(' ', '-')}`,
  author: 'Ada',
  sourceUrl: 'https://github.com/example/badge-app',
  kind: 'badge-to-badge',
});

describe('app store', () => {
  test('validates submissions and lists newest first', async () => {
    const invalid = await h.post('/v1/apps', { name: 'x' });
    expect(invalid.status).toBe(400);
    expect((await json<Record<string, unknown>>(invalid)).error).toBe('invalid_request');

    await h.post('/v1/apps', valid('First App'));
    await h.post('/v1/apps', valid('Second App'));
    const listing = await json<{ apps: { name: string }[] }>(await h.request('/v1/apps'));
    expect(listing.apps.map((app) => app.name)).toEqual(['Second App', 'First App']);
  });

  test('limits the eleventh submission from one forwarded IP', async () => {
    const responses: Response[] = [];
    for (let index = 0; index < 11; index++) {
      responses.push(await h.request('/v1/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
        body: JSON.stringify(valid(`App ${index}`)),
      }));
    }
    expect(responses.slice(0, 10).every((response) => response.status === 200)).toBe(true);
    expect(responses[10]?.status).toBe(429);
  });

  test('implements all configured and unconfigured delete flows', async () => {
    const disabled = await h.request('/v1/apps/anything', { method: 'DELETE' });
    expect(disabled.status).toBe(404);
    expect(await json<unknown>(disabled)).toEqual({ error: 'not_found' });

    const local = createHarness({ adminToken: 'admin-secret' });
    try {
      const submitted = await json<{ app: { appId: string } }>(await local.post('/v1/apps', valid('Delete Me')));
      expect((await local.request(`/v1/apps/${submitted.app.appId}`, { method: 'DELETE' })).status).toBe(403);
      expect((await local.request('/v1/apps/missing1', {
        method: 'DELETE', headers: { authorization: 'Bearer admin-secret' },
      })).status).toBe(404);
      const removed = await local.request(`/v1/apps/${submitted.app.appId}`, {
        method: 'DELETE', headers: { authorization: 'Bearer admin-secret' },
      });
      expect(removed.status).toBe(200);
      expect(await json<unknown>(removed)).toEqual({ ok: true });
    } finally {
      local.close();
    }
  });
});
