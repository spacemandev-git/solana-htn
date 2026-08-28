import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  CLUSTERS,
  parseCluster,
  QUEST_MESSAGE_MAX,
  QUEST_SEED,
} from "./chain.ts";

const BUILD_IDL_ERROR =
  "build the program first: bun run program:build (from the repo root)";

function requiredProgramId(): string {
  const programId = process.env.PROGRAM_ID?.trim();
  if (!programId) {
    throw new Error("PROGRAM_ID is required");
  }
  return programId;
}

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return `${homedir()}${path.slice(1)}`;
  }
  return path;
}

function isByte(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= 255;
}

async function loadKeypair(path: string): Promise<Keypair> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every(isByte)) {
    throw new Error(`keypair file is not a JSON byte array: ${path}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function discriminatorFor(idl: unknown, instructionName: string): Uint8Array {
  if (
    typeof idl !== "object" ||
    idl === null ||
    !("instructions" in idl) ||
    !Array.isArray(idl.instructions)
  ) {
    throw new Error("htn_quest IDL is malformed");
  }

  const instruction = idl.instructions.find(
    (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "name" in candidate &&
      candidate.name === instructionName,
  );
  if (
    typeof instruction !== "object" ||
    instruction === null ||
    !("discriminator" in instruction) ||
    !Array.isArray(instruction.discriminator) ||
    instruction.discriminator.length !== 8 ||
    !instruction.discriminator.every(isByte)
  ) {
    throw new Error(`htn_quest IDL discriminator is malformed: ${instructionName}`);
  }
  return Uint8Array.from(instruction.discriminator);
}

async function loadDiscriminators(): Promise<{
  initialize: Uint8Array;
  setMessage: Uint8Array;
}> {
  const idlUrl = new URL("../idl/htn_quest.json", import.meta.url);
  let source: string;
  try {
    source = await readFile(fileURLToPath(idlUrl), "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(BUILD_IDL_ERROR);
    }
    throw error;
  }

  const idl: unknown = JSON.parse(source);
  return {
    initialize: discriminatorFor(idl, "initialize"),
    setMessage: discriminatorFor(idl, "set_message"),
  };
}

function encodeMessage(discriminator: Uint8Array, messageBytes: Uint8Array): Buffer {
  const data = Buffer.alloc(discriminator.length + 4 + messageBytes.length);
  data.set(discriminator, 0);
  data.writeUInt32LE(messageBytes.length, discriminator.length);
  data.set(messageBytes, discriminator.length + 4);
  return data;
}

async function main(): Promise<void> {
  const message = process.argv.slice(2).join(" ");
  if (!message) {
    throw new Error('usage: bun run set-message "your message"');
  }
  const messageBytes = new TextEncoder().encode(message);
  if (messageBytes.length > QUEST_MESSAGE_MAX) {
    throw new Error(`message exceeds ${QUEST_MESSAGE_MAX} UTF-8 bytes`);
  }

  const clusterName = parseCluster(process.env.SOLANA_CLUSTER?.trim());
  const cluster = CLUSTERS[clusterName];
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || cluster.defaultRpcUrl;
  const program = new PublicKey(requiredProgramId());
  const keypairPath = expandHome(
    process.env.KEYPAIR_PATH?.trim() || "~/.config/solana/id.json",
  );
  const authority = await loadKeypair(keypairPath);
  const discriminators = await loadDiscriminators();
  const [quest] = PublicKey.findProgramAddressSync(
    [Buffer.from(QUEST_SEED)],
    program,
  );
  const connection = new Connection(rpcUrl, "confirmed");
  const questAccount = await connection.getAccountInfo(quest, "confirmed");
  const initialize = questAccount === null;

  const instruction = new TransactionInstruction({
    programId: program,
    keys: initialize
      ? [
          { pubkey: quest, isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ]
      : [
          { pubkey: quest, isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        ],
    data: encodeMessage(
      initialize ? discriminators.initialize : discriminators.setMessage,
      messageBytes,
    ),
  });

  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: authority.publicKey,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }).add(instruction);
  transaction.sign(authority);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  const confirmation = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed",
  );
  if (confirmation.value.err !== null) {
    throw new Error(`transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  console.log(`Signature: ${signature}`);
  console.log(
    `Explorer: https://explorer.solana.com/tx/${signature}${cluster.explorerSuffix}`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
