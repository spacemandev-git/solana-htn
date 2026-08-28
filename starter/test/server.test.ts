import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { CLUSTERS } from "../src/chain.ts";
import { createApp } from "../src/server.ts";

const WALLET = "11111111111111111111111111111111";
const PROGRAM_ID = "9UkH8LeXw8jpQFZVNS3yk9LmkzsFAh54MK7SGP8jTsfY";
const DEVNET = CLUSTERS.devnet;

const ENV_KEYS = [
  "WALLET_ADDRESS",
  "PROGRAM_ID",
  "PRICE_USD",
  "SOLANA_CLUSTER",
  "SOLANA_RPC_URL",
  "FACILITATOR_URL",
  "PORT",
] as const;

const originalEnv = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function paymentChallenge(response: Response): Promise<Record<string, unknown>> {
  const encoded = response.headers.get("payment-required");
  const parsed: unknown = encoded
    ? JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
    : await response.json();
  if (!isRecord(parsed)) {
    throw new Error("402 challenge is not an object");
  }
  return parsed;
}

describe("hacker starter server", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeAll(() => {
    process.env.WALLET_ADDRESS = WALLET;
    process.env.PROGRAM_ID = PROGRAM_ID;
    process.env.PRICE_USD = "1.00";
    process.env.SOLANA_CLUSTER = "devnet";
    process.env.SOLANA_RPC_URL = "https://rpc.invalid";
    process.env.FACILITATOR_URL = "https://facilitator.invalid";
    process.env.PORT = "4021";

    ({ app } = createApp({
      facilitator: {
        async verify() {
          throw new Error("verify must not run for an unpaid request");
        },
        async settle() {
          throw new Error("settle must not run for an unpaid request");
        },
        async getSupported() {
          return {
            kinds: [
              {
                x402Version: 2,
                scheme: "exact",
                network: DEVNET.caip2,
                extra: { feePayer: WALLET },
              },
            ],
            extensions: [],
            signers: { [DEVNET.caip2]: [WALLET] },
          };
        },
      },
      readMessage: async () => "stubbed chain message",
      schemeRpcUrl: false,
    }));
  });

  afterAll(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("GET /quest advertises an exact devnet USDC payment", async () => {
    const response = await app.request("/quest");
    expect(response.status).toBe(402);

    const challenge = await paymentChallenge(response);
    const accepts = challenge.accepts;
    if (!Array.isArray(accepts)) {
      throw new Error("402 challenge has no accepts array");
    }
    const option = accepts.find(
      (candidate: unknown) =>
        isRecord(candidate) &&
        candidate.scheme === "exact" &&
        candidate.network === DEVNET.caip2,
    );
    if (!isRecord(option)) {
      throw new Error("402 challenge has no exact devnet option");
    }

    expect(option.asset).toBe(DEVNET.usdcMint);
    expect(option.payTo).toBe(WALLET);
    const amount = option.amount;
    expect(typeof amount).toBe("string");
    if (typeof amount !== "string") {
      throw new Error("402 amount is not a string");
    }
    expect(Number(amount)).toBeLessThanOrEqual(1_000_000);
  });

  test("GET /healthz is open", async () => {
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, programId: PROGRAM_ID });
  });
});
