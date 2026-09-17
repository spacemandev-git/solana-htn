import { createQuestChain } from '@htn/chain';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/index.ts';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const chain = await createQuestChain({
  cluster: config.solanaCluster,
  rpcUrl: config.solanaRpcUrl,
  payerSecretKey: config.x402PayerSecretKey,
  paymentMint: config.paymentMint,
  maxPaymentAtomic: config.maxRewardAtomic,
});

const app = buildApp({ db, chain, config });

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  // SSE streams stay open for the length of a hackathon; the 25s heartbeat is
  // the liveness check, not the socket timeout.
  idleTimeout: 0,
});

console.log(
  `[server] listening on http://localhost:${server.port} ` +
    `(db=${config.databasePath}, chain=${chain.enabled ? 'live' : 'disabled'}, ` +
    `dev routes=${config.devRoutesEnabled ? 'on' : 'off'})`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.stop(true);
    db.close();
    process.exit(0);
  });
}
