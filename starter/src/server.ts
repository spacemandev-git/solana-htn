import {
  HTTPFacilitatorClient,
  type FacilitatorClient,
} from "@x402/core/server";
import {
  paymentMiddleware,
  x402ResourceServer,
} from "@x402/hono";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { Hono } from "hono";

import {
  CLUSTERS,
  parseCluster,
  readQuestMessage,
  type Cluster,
} from "./chain.ts";

export type { FacilitatorClient };

interface ServerConfig {
  walletAddress: string;
  programId: string;
  priceUsd: number;
  cluster: Cluster;
  rpcUrl: string;
  facilitatorUrl: string;
  port: number;
}

export interface AppDependencies {
  facilitator?: FacilitatorClient;
  readMessage?: typeof readQuestMessage;
  schemeRpcUrl?: string | false;
}

function requiredEnv(name: "WALLET_ADDRESS" | "PROGRAM_ID"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function loadConfig(): ServerConfig {
  const priceText = process.env.PRICE_USD?.trim() || "1.00";
  const priceUsd = Number(priceText);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("PRICE_USD must be a positive number");
  }
  if (priceUsd > 1) {
    throw new Error("PRICE_USD must not exceed 1.00; the agent caps payment at $1");
  }

  const cluster = parseCluster(process.env.SOLANA_CLUSTER?.trim());
  const portText = process.env.PORT?.trim() || "4021";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }

  return {
    walletAddress: requiredEnv("WALLET_ADDRESS"),
    programId: requiredEnv("PROGRAM_ID"),
    priceUsd,
    cluster,
    rpcUrl:
      process.env.SOLANA_RPC_URL?.trim() || CLUSTERS[cluster].defaultRpcUrl,
    facilitatorUrl:
      process.env.FACILITATOR_URL?.trim() ||
      "https://facilitator.payai.network",
    port,
  };
}

export function createApp(dependencies: AppDependencies = {}) {
  const config = loadConfig();
  const cluster = CLUSTERS[config.cluster];
  const facilitator =
    dependencies.facilitator ??
    new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitator);
  const schemeRpcUrl =
    dependencies.schemeRpcUrl === false
      ? undefined
      : (dependencies.schemeRpcUrl ?? config.rpcUrl);
  registerExactSvmScheme(resourceServer, {
    networks: [cluster.caip2],
    rpcUrl: schemeRpcUrl,
  });

  const amount = String(Math.floor(config.priceUsd * 1_000_000));
  const app = new Hono();

  app.get("/healthz", (context) =>
    context.json({ ok: true, programId: config.programId }),
  );

  app.use(
    "/quest",
    paymentMiddleware(
      {
        "GET /quest": {
          accepts: {
            scheme: "exact",
            network: cluster.caip2,
            payTo: config.walletAddress,
            price: { amount, asset: cluster.usdcMint },
          },
          description: "The on-chain Hack the North quest message",
          mimeType: "application/json",
        },
      },
      resourceServer,
    ),
  );

  const readMessage = dependencies.readMessage ?? readQuestMessage;
  app.get("/quest", async (context) => {
    const message = await readMessage(config.rpcUrl, config.programId);
    return context.json({ programId: config.programId, message });
  });

  return { app, config };
}

if (import.meta.main) {
  const { app, config } = createApp();
  const cluster = CLUSTERS[config.cluster];
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`Quest price: $${config.priceUsd.toFixed(2)}`);
  console.log(`USDC payTo: ${config.walletAddress}`);
  console.log(`x402 network: ${cluster.caip2}`);
  console.log(`Public URL: http://localhost:${config.port}/quest (replace localhost when sharing)`);
}
