import { Database } from 'bun:sqlite';
import { DisabledChainClient } from '@htn/chain';
import { API_KEY_HEADER, type BadgeSummary, type SessionView, type SyncResponse } from '@htn/shared';
import { buildAppWithContext } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { ServiceContext } from '../src/services/context.ts';

export const TEST_API_KEY = 'test-station-key';
export const TEST_PROGRAM_ID = 'BadgeEscrow11111111111111111111111111111111';

export interface Harness {
  ctx: ServiceContext;
  request(path: string, init?: RequestInit): Promise<Response>;
  sync(body: unknown, key?: string | null): Promise<Response>;
  disconnect(body: unknown, key?: string | null): Promise<Response>;
  post(path: string, body: unknown): Promise<Response>;
  close(): void;
}

export function createHarness(): Harness {
  const db = new Database(':memory:');
  const chain = new DisabledChainClient(TEST_PROGRAM_ID);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    STATION_API_KEY: TEST_API_KEY,
    PUBLIC_APP_URL: 'http://localhost:5173',
    PWA_ORIGIN: 'http://localhost:5173',
    PROGRAM_ID: TEST_PROGRAM_ID,
  });

  const { app, ctx } = buildAppWithContext({ db, chain, config });
  const request = async (path: string, init?: RequestInit): Promise<Response> =>
    app.request(path, init);

  const authedPost = (
    path: string,
    body: unknown,
    key: string | null | undefined,
  ): Promise<Response> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key !== null) headers[API_KEY_HEADER] = key ?? TEST_API_KEY;
    return request(path, { method: 'POST', headers, body: JSON.stringify(body) });
  };

  return {
    ctx,
    request,
    sync: (body, key) => authedPost('/api/station/sync', body, key),
    disconnect: (body, key) => authedPost('/api/station/disconnect', body, key),
    post: (path, body) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    close: () => db.close(),
  };
}

export function syncBody(
  badgeId: string,
  stationId: string,
  overrides: { name?: string; email?: string; stationName?: string; rssi?: number } = {},
) {
  return {
    stationId,
    stationName: overrides.stationName ?? `Station ${stationId}`,
    badge: {
      badgeId,
      name: overrides.name ?? `Hacker ${badgeId}`,
      email: overrides.email ?? `${badgeId}@example.com`,
    },
    ...(overrides.rssi === undefined ? {} : { rssi: overrides.rssi }),
  };
}

export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export type { BadgeSummary, SessionView, SyncResponse };
