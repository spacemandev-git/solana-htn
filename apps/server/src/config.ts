/**
 * Environment parsing. Every value has a defensible local default so a fresh
 * clone boots with `bun run dev` and nothing else.
 */

/** Placeholder used until the Anchor program is deployed and PROGRAM_ID is set. */
const DEFAULT_PROGRAM_ID = 'BadgeEscrow11111111111111111111111111111111';

export interface ServerConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  /** ':memory:' is honoured verbatim so tests can run without touching disk. */
  databasePath: string;
  stationApiKey: string;
  /** Origin allowed through CORS (the PWA dev server or its deployed origin). */
  pwaOrigin: string;
  /** Base of the pairing URL handed back to Sync Stations. */
  publicAppUrl: string;
  programId: string;
  solanaRpcUrl: string | undefined;
  solanaAuthoritySecretKey: string | undefined;
  /** Dev-only routes (reset, unauthenticated sync) are mounted off production. */
  devRoutesEnabled: boolean;
}

export type EnvLike = Record<string, string | undefined>;

const DEFAULT_STATION_API_KEY = 'dev-station-key';

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function loadConfig(env: EnvLike = process.env): ServerConfig {
  const nodeEnv = trimmed(env.NODE_ENV) ?? 'development';
  const isProduction = nodeEnv === 'production';
  const stationApiKey = trimmed(env.STATION_API_KEY) ?? DEFAULT_STATION_API_KEY;

  if (isProduction && stationApiKey === DEFAULT_STATION_API_KEY) {
    console.warn('[config] STATION_API_KEY is unset in production; using the public dev default.');
  }

  return {
    nodeEnv,
    isProduction,
    port: parsePort(env.PORT, 3000),
    databasePath: trimmed(env.DATABASE_PATH) ?? './data/htn.db',
    stationApiKey,
    pwaOrigin: trimmed(env.PWA_ORIGIN) ?? 'http://localhost:5173',
    publicAppUrl: trimmed(env.PUBLIC_APP_URL) ?? 'http://localhost:5173',
    programId: trimmed(env.PROGRAM_ID) ?? DEFAULT_PROGRAM_ID,
    solanaRpcUrl: trimmed(env.SOLANA_RPC_URL),
    solanaAuthoritySecretKey: trimmed(env.SOLANA_AUTHORITY_SECRET_KEY),
    devRoutesEnabled: !isProduction,
  };
}

/** The link a Sync Station prints/beams so the hacker can open their session. */
export function pairingUrl(config: ServerConfig, pairingCode: string): string {
  return `${config.publicAppUrl.replace(/\/+$/, '')}/s/${pairingCode}`;
}
