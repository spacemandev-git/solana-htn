import { afterEach, describe, expect, test } from 'bun:test';
import { API_KEY_HEADER } from '@htn/shared';
import { createHarness, json, syncBody, type Harness } from './harness.ts';
import type { ApiError } from '@htn/shared';

let harness: Harness | null = null;

function setup(): Harness {
  harness = createHarness();
  return harness;
}

afterEach(() => {
  harness?.close();
  harness = null;
});

describe('station auth', () => {
  test('rejects a sync with no api key', async () => {
    const h = setup();
    const response = await h.sync(syncBody('badge-a', 'station-1'), null);
    expect(response.status).toBe(401);
    const body = await json<ApiError>(response);
    expect(body.error).toBe('unauthorized');
  });

  test('rejects a sync with the wrong api key', async () => {
    const h = setup();
    const response = await h.sync(syncBody('badge-a', 'station-1'), 'not-the-key');
    expect(response.status).toBe(401);
  });

  test('accepts a sync with the correct api key', async () => {
    const h = setup();
    const response = await h.sync(syncBody('badge-a', 'station-1'));
    expect(response.status).toBe(200);
  });

  test('rejects a disconnect with the wrong api key', async () => {
    const h = setup();
    await h.sync(syncBody('badge-a', 'station-1'));
    const response = await h.disconnect({ badgeId: 'badge-a', stationId: 'station-1' }, 'nope');
    expect(response.status).toBe(401);
  });

  test('dev routes do not require the api key', async () => {
    const h = setup();
    const response = await h.post('/api/dev/sync', syncBody('badge-dev', 'station-1'));
    expect(response.status).toBe(200);
    expect(response.headers.get(API_KEY_HEADER)).toBeNull();
  });

  test('a malformed body is a 400, not a 500', async () => {
    const h = setup();
    const response = await h.sync({ stationId: 'station-1' });
    expect(response.status).toBe(400);
    expect((await json<ApiError>(response)).error).toBe('invalid_request');
  });
});
