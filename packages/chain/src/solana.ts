import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

import type { ChainConfig } from './factory.ts';
import {
  decodeItem,
  decodeRegistry,
  decodeVault,
  encodeCreateVault,
  encodeClaimVault,
  encodeInitializeRegistry,
  encodeMintItem,
  encodeWithdrawItem,
  hashId,
  itemPda,
  registryPda,
  vaultPda,
} from './layout.ts';
import type { ChainClient, ChainWriteResult, OnChainItem, OnChainVault } from './types.ts';

/**
 * Live client for the `badge_escrow` Anchor 2.0 program.
 *
 * The server holds the registry authority key: it opens vaults and mints items.
 * It deliberately holds no power over claimed assets — `claim_vault` and
 * `withdraw_item` require the hacker's own wallet to sign, so those are only
 * ever *built* here and signed in the browser.
 */
export class SolanaChainClient implements ChainClient {
  readonly enabled = true;
  readonly programId: string;

  private readonly connection: Connection;
  private readonly authority: Keypair;
  private readonly program: PublicKey;

  private constructor(connection: Connection, authority: Keypair, program: PublicKey) {
    this.connection = connection;
    this.authority = authority;
    this.program = program;
    this.programId = program.toBase58();
  }

  /**
   * Connects and bootstraps the registry if this is a fresh deployment.
   *
   * Throws if the program is not deployed, or if a registry exists that names a
   * different authority — both mean the server would silently fail every write,
   * which is worse discovered at boot than at the first badge sync.
   */
  static async connect(config: ChainConfig): Promise<ChainClient> {
    const connection = new Connection(config.rpcUrl!, 'confirmed');
    const authority = Keypair.fromSecretKey(bs58.decode(config.authoritySecretKey!));
    const program = new PublicKey(config.programId);

    const programAccount = await connection.getAccountInfo(program);
    if (!programAccount?.executable) {
      throw new Error(
        `badge_escrow is not deployed at ${config.programId} on ${config.rpcUrl}. ` +
          'Run `bun run program:deploy` or unset SOLANA_RPC_URL to run without a chain.',
      );
    }

    const client = new SolanaChainClient(connection, authority, program);
    await client.ensureRegistry();
    return client;
  }

  private get registry(): PublicKey {
    return registryPda(this.program);
  }

  private async ensureRegistry(): Promise<void> {
    const existing = await this.connection.getAccountInfo(this.registry);
    if (existing) {
      const { authority } = decodeRegistry(existing.data);
      if (authority !== this.authority.publicKey.toBase58()) {
        throw new Error(
          `badge_escrow registry is owned by ${authority}, but the server key is ` +
            `${this.authority.publicKey.toBase58()}. Every mint would be rejected.`,
        );
      }
      return;
    }

    await this.send([
      new TransactionInstruction({
        programId: this.program,
        keys: [
          { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: this.registry, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInitializeRegistry(),
      }),
    ]);
  }

  private async send(instructions: TransactionInstruction[]): Promise<string> {
    const tx = new Transaction().add(...instructions);
    return sendAndConfirmTransaction(this.connection, tx, [this.authority], {
      commitment: 'confirmed',
    });
  }

  async ensureVault(badgeId: string, animalCode: number): Promise<ChainWriteResult> {
    const vault = vaultPda(this.program, badgeId);
    const existing = await this.connection.getAccountInfo(vault);
    if (existing) return { address: vault.toBase58(), signature: null };

    const signature = await this.send([
      new TransactionInstruction({
        programId: this.program,
        keys: [
          { pubkey: this.registry, isSigner: false, isWritable: true },
          { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeCreateVault(badgeId, animalCode),
      }),
    ]);
    return { address: vault.toBase58(), signature };
  }

  async mintItem(args: {
    badgeId: string;
    index: number;
    code: number;
    stationId: string;
  }): Promise<ChainWriteResult> {
    const vault = vaultPda(this.program, args.badgeId);
    const item = itemPda(this.program, vault, args.index);

    // The program rejects a replay, but checking first keeps a retried sync from
    // surfacing a confusing on-chain error to the station.
    const existing = await this.connection.getAccountInfo(item);
    if (existing) return { address: item.toBase58(), signature: null };

    const signature = await this.send([
      new TransactionInstruction({
        programId: this.program,
        keys: [
          { pubkey: this.registry, isSigner: false, isWritable: false },
          { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: item, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeMintItem(args.index, args.code, args.stationId),
      }),
    ]);
    return { address: item.toBase58(), signature };
  }

  async claimVault(badgeId: string, wallet: string): Promise<ChainWriteResult> {
    const vault = vaultPda(this.program, badgeId);
    const state = await this.getVault(badgeId);
    if (state?.owner && state.owner !== wallet) {
      throw new Error(`vault ${vault.toBase58()} is already claimed by ${state.owner}`);
    }
    return { address: vault.toBase58(), signature: null };
  }

  async withdrawItem(badgeId: string, index: number): Promise<ChainWriteResult> {
    const vault = vaultPda(this.program, badgeId);
    return { address: itemPda(this.program, vault, index).toBase58(), signature: null };
  }

  async buildClaimVaultTransaction(badgeId: string, wallet: string): Promise<string | null> {
    const owner = new PublicKey(wallet);
    const vault = vaultPda(this.program, badgeId);
    return this.buildUnsigned(owner, [
      new TransactionInstruction({
        programId: this.program,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
        ],
        data: encodeClaimVault(),
      }),
    ]);
  }

  async buildWithdrawItemTransaction(
    badgeId: string,
    index: number,
    wallet: string,
  ): Promise<string | null> {
    const owner = new PublicKey(wallet);
    const vault = vaultPda(this.program, badgeId);
    return this.buildUnsigned(owner, [
      new TransactionInstruction({
        programId: this.program,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: false },
          { pubkey: itemPda(this.program, vault, index), isSigner: false, isWritable: true },
        ],
        data: encodeWithdrawItem(),
      }),
    ]);
  }

  /** Serializes an unsigned transaction for the browser wallet to sign. */
  private async buildUnsigned(
    feePayer: PublicKey,
    instructions: TransactionInstruction[],
  ): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer, recentBlockhash: blockhash }).add(...instructions);
    return tx.serialize({ requireAllSignatures: false }).toString('base64');
  }

  async getVault(badgeId: string): Promise<OnChainVault | null> {
    const vault = vaultPda(this.program, badgeId);
    const account = await this.connection.getAccountInfo(vault);
    if (!account) return null;
    const decoded = decodeVault(account.data);
    return {
      vaultAddress: vault.toBase58(),
      badgeHash: decoded.badgeHash,
      owner: decoded.owner,
      animalCode: decoded.animalCode,
      itemCount: decoded.itemCount,
    };
  }

  async listItems(badgeId: string): Promise<OnChainItem[]> {
    const state = await this.getVault(badgeId);
    if (!state) return [];

    const vault = new PublicKey(state.vaultAddress);
    const addresses = Array.from({ length: state.itemCount }, (_, index) =>
      itemPda(this.program, vault, index),
    );
    if (addresses.length === 0) return [];

    const accounts = await this.connection.getMultipleAccountsInfo(addresses);
    return accounts.flatMap((account, index) => {
      if (!account) return [];
      const decoded = decodeItem(account.data);
      return [
        {
          itemAddress: addresses[index]!.toBase58(),
          index: decoded.index,
          code: decoded.code,
          stationHash: decoded.stationHash,
          mintedAt: decoded.mintedAt,
          withdrawn: decoded.withdrawn,
        },
      ];
    });
  }

  /** Exposed so the server can log which key the stations' mints come from. */
  get authorityAddress(): string {
    return this.authority.publicKey.toBase58();
  }
}

export { hashId };
