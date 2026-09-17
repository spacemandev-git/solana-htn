/** Environment parsing with local defaults for a fresh development clone. */
import {
  CLUSTERS,
  DEFAULT_SOLANA_BOX_ID,
  DEFAULT_SOLANA_FINAL_BOX_ID,
  toAtomic,
  type Cluster,
} from '@htn/shared';

export interface ServerConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  databasePath: string;
  pwaOrigin: string;
  publicAppUrl: string;
  solanaCluster: Cluster;
  solanaRpcUrl: string | undefined;
  x402PayerSecretKey: string | undefined;
  maxRewardAtomic: number;
  paymentMint: string;
  paymentSymbol: string;
  solanaBoxId: string;
  solanaFinalBoxId: string;
  devRoutesEnabled: boolean;
}

export type EnvLike = Record<string, string | undefined>;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function parseCluster(value: string | undefined): Cluster {
  const cluster = trimmed(value) ?? 'devnet';
  if (cluster !== 'devnet' && cluster !== 'mainnet') {
    throw new Error('SOLANA_CLUSTER must be devnet or mainnet');
  }
  return cluster;
}

function parseMaxRewardAtomic(value: string | undefined): number {
  const units = Number.parseFloat(value ?? '1');
  return Math.max(1, toAtomic(Number.isFinite(units) ? units : 1));
}

export function loadConfig(env: EnvLike = process.env): ServerConfig {
  const nodeEnv = trimmed(env.NODE_ENV) ?? 'development';
  const isProduction = nodeEnv === 'production';
  const solanaCluster = parseCluster(env.SOLANA_CLUSTER);

  return {
    nodeEnv,
    isProduction,
    port: parsePort(env.PORT, 3000),
    databasePath: trimmed(env.DATABASE_PATH) ?? './data/htn.db',
    pwaOrigin: trimmed(env.PWA_ORIGIN) ?? 'http://localhost:5173',
    publicAppUrl: trimmed(env.PUBLIC_APP_URL) ?? 'http://localhost:5173',
    solanaCluster,
    solanaRpcUrl: trimmed(env.SOLANA_RPC_URL),
    x402PayerSecretKey: trimmed(env.X402_PAYER_SECRET_KEY),
    maxRewardAtomic: parseMaxRewardAtomic(env.MAX_REWARD_USD),
    paymentMint: trimmed(env.PAYMENT_MINT) ?? CLUSTERS[solanaCluster].paymentMint,
    paymentSymbol: trimmed(env.PAYMENT_SYMBOL) ?? CLUSTERS[solanaCluster].paymentSymbol,
    solanaBoxId: trimmed(env.SOLANA_BOX_ID) ?? DEFAULT_SOLANA_BOX_ID,
    solanaFinalBoxId: trimmed(env.SOLANA_FINAL_BOX_ID) ?? DEFAULT_SOLANA_FINAL_BOX_ID,
    devRoutesEnabled: !isProduction,
  };
}

export function pairingUrl(config: ServerConfig, pairingCode: string): string {
  return `${config.publicAppUrl.replace(/\/+$/, '')}/s/${pairingCode}`;
}
