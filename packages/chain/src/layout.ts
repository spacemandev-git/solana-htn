import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import idl from './idl/badge_escrow.json' with { type: 'json' };

/**
 * Instruction/account discriminators and byte layouts for `badge_escrow`.
 *
 * Discriminators are read straight out of the Anchor-generated IDL rather than
 * hardcoded, so `anchor build` + copying the IDL is enough to stay in sync.
 * The account layouts are hand-written because Anchor v2 accounts are `Pod`
 * (fixed-size, zero-copy) — there is no varint/borsh framing to interpret.
 */

type IdlInstruction = { name: string; discriminator: number[] };
type IdlAccount = { name: string; discriminator: number[] };

const instructions = (idl.instructions as IdlInstruction[]).reduce<Record<string, Buffer>>(
  (acc, ix) => {
    acc[ix.name] = Buffer.from(ix.discriminator);
    return acc;
  },
  {},
);

const accountDiscriminators = (idl.accounts as IdlAccount[]).reduce<Record<string, Buffer>>(
  (acc, a) => {
    acc[a.name] = Buffer.from(a.discriminator);
    return acc;
  },
  {},
);

function discriminator(name: string): Buffer {
  const found = instructions[name];
  if (!found) throw new Error(`instruction "${name}" is not in the badge_escrow IDL`);
  return found;
}

export const PROGRAM_ID_FROM_IDL: string = idl.address;

/** Badge and station ids are hashed before they ever touch the chain. */
export function hashId(id: string): Buffer {
  return createHash('sha256').update(id, 'utf8').digest();
}

// -- PDA derivation -----------------------------------------------------------

export function registryPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('registry')], programId)[0];
}

export function vaultPda(programId: PublicKey, badgeId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), hashId(badgeId)],
    programId,
  )[0];
}

export function itemPda(programId: PublicKey, vault: PublicKey, index: number): PublicKey {
  const indexLe = Buffer.alloc(4);
  indexLe.writeUInt32LE(index);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('item'), vault.toBuffer(), indexLe],
    programId,
  )[0];
}

// -- Instruction data ---------------------------------------------------------

export function encodeInitializeRegistry(): Buffer {
  return discriminator('initialize_registry');
}

export function encodeCreateVault(badgeId: string, animalCode: number): Buffer {
  const args = Buffer.alloc(36);
  hashId(badgeId).copy(args, 0);
  args.writeUInt32LE(animalCode >>> 0, 32);
  return Buffer.concat([discriminator('create_vault'), args]);
}

export function encodeMintItem(index: number, code: number, stationId: string): Buffer {
  const args = Buffer.alloc(40);
  args.writeUInt32LE(index >>> 0, 0);
  args.writeUInt32LE(code >>> 0, 4);
  hashId(stationId).copy(args, 8);
  return Buffer.concat([discriminator('mint_item'), args]);
}

export function encodeClaimVault(): Buffer {
  return discriminator('claim_vault');
}

export function encodeWithdrawItem(): Buffer {
  return discriminator('withdraw_item');
}

// -- Account decoding ---------------------------------------------------------

const ZERO_ADDRESS = '11111111111111111111111111111111';

function checkDiscriminator(data: Buffer, account: string): void {
  const expected = accountDiscriminators[account];
  if (!expected) throw new Error(`account "${account}" is not in the badge_escrow IDL`);
  if (!data.subarray(0, 8).equals(expected)) {
    throw new Error(`account data is not a ${account}`);
  }
}

/** Reads a pubkey field, mapping the program's zero-address sentinel to null. */
function readOwner(data: Buffer, offset: number): string | null {
  const address = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  return address === ZERO_ADDRESS ? null : address;
}

export interface DecodedRegistry {
  vaultCount: number;
  authority: string;
  bump: number;
}

export function decodeRegistry(data: Buffer): DecodedRegistry {
  checkDiscriminator(data, 'Registry');
  return {
    vaultCount: Number(data.readBigUInt64LE(8)),
    authority: new PublicKey(data.subarray(16, 48)).toBase58(),
    bump: data.readUInt8(48),
  };
}

export interface DecodedVault {
  claimedAt: number;
  badgeHash: string;
  owner: string | null;
  animalCode: number;
  itemCount: number;
  bump: number;
}

export function decodeVault(data: Buffer): DecodedVault {
  checkDiscriminator(data, 'Vault');
  return {
    claimedAt: Number(data.readBigInt64LE(8)),
    badgeHash: data.subarray(16, 48).toString('hex'),
    owner: readOwner(data, 48),
    animalCode: data.readUInt32LE(80),
    itemCount: data.readUInt32LE(84),
    bump: data.readUInt8(88),
  };
}

export interface DecodedItem {
  mintedAt: number;
  vault: string;
  owner: string | null;
  stationHash: string;
  code: number;
  index: number;
  withdrawn: boolean;
  bump: number;
}

export function decodeItem(data: Buffer): DecodedItem {
  checkDiscriminator(data, 'ItemRecord');
  return {
    mintedAt: Number(data.readBigInt64LE(8)),
    vault: new PublicKey(data.subarray(16, 48)).toBase58(),
    owner: readOwner(data, 48),
    stationHash: data.subarray(80, 112).toString('hex'),
    code: data.readUInt32LE(112),
    index: data.readUInt32LE(116),
    withdrawn: data.readUInt8(120) === 1,
    bump: data.readUInt8(121),
  };
}
