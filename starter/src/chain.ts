import { Connection, PublicKey } from "@solana/web3.js";

// Copied from packages/shared/src/quest.ts so starter/ remains standalone.
export const QUEST_SEED = "quest";
export const QUEST_MESSAGE_OFFSET = 40;
export const QUEST_MESSAGE_MAX = 256;

export type Cluster = "devnet" | "mainnet";

export interface ClusterInfo {
  caip2: `${string}:${string}`;
  /** The SPL mint the event agent pays in. */
  paymentMint: string;
  /** Ticker for paymentMint. */
  paymentSymbol: string;
  defaultRpcUrl: string;
  explorerSuffix: string;
}

export const CLUSTERS: Record<Cluster, ClusterInfo> = {
  devnet: {
    caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    paymentMint: "3W7U7Dh81RdKBmwmF2nR3tz5YoaPFFUyBY1bz2u5tE1Q",
    paymentSymbol: "HTN",
    defaultRpcUrl: "https://api.devnet.solana.com",
    explorerSuffix: "?cluster=devnet",
  },
  mainnet: {
    caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    paymentMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    paymentSymbol: "USDC",
    defaultRpcUrl: "https://api.mainnet-beta.solana.com",
    explorerSuffix: "",
  },
};

export function parseCluster(value: string | undefined): Cluster {
  const cluster = value ?? "devnet";
  if (cluster !== "devnet" && cluster !== "mainnet") {
    throw new Error("SOLANA_CLUSTER must be devnet or mainnet");
  }
  return cluster;
}

export async function readQuestMessage(
  rpcUrl: string,
  programId: string,
): Promise<string> {
  const program = new PublicKey(programId);
  const [quest] = PublicKey.findProgramAddressSync(
    [Buffer.from(QUEST_SEED)],
    program,
  );
  const connection = new Connection(rpcUrl, "confirmed");
  const [programAccount, questAccount] = await Promise.all([
    connection.getAccountInfo(program),
    connection.getAccountInfo(quest),
  ]);

  if (programAccount === null || !programAccount.executable) {
    throw new Error("program not deployed");
  }
  if (questAccount === null) {
    throw new Error("quest account not initialized — run bun run set-message");
  }
  if (!questAccount.owner.equals(program)) {
    throw new Error("message malformed");
  }

  const data = questAccount.data;
  const messageStart = QUEST_MESSAGE_OFFSET + 4;
  if (data.length < messageStart) {
    throw new Error("message malformed");
  }

  const messageLength = data.readUInt32LE(QUEST_MESSAGE_OFFSET);
  const messageEnd = messageStart + messageLength;
  if (messageLength > QUEST_MESSAGE_MAX || messageEnd > data.length) {
    throw new Error("message malformed");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      data.subarray(messageStart, messageEnd),
    );
  } catch {
    throw new Error("message malformed");
  }
}
