import type { Database } from 'bun:sqlite';
import type { QuestChain } from '@htn/chain';
import type { ServerConfig } from '../config.ts';
import type { LiveHub } from '../live.ts';

/** Everything a service needs, passed explicitly so tests can swap any piece. */
export interface ServiceContext {
  db: Database;
  chain: QuestChain;
  config: ServerConfig;
  live: LiveHub;
}

export function nowIso(): string {
  return new Date().toISOString();
}
