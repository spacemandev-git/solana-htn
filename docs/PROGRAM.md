# `badge_escrow` — on-chain program

Anchor **2.0.0-rc.1** (`otter-sec/anchor`, branch `anchor-next`). Pinocchio-based,
`#![no_std]`, zero-copy accounts.

Program ID (localnet default): `6kdZgrhS4FANagxKHiMoJzm2wEp2NRgNYTkjpYYRjtdD`

## What it is for

A hacker's animal and the clothing they earn are held **in escrow**: created and
funded by the badge server, owned by nobody. When the hacker connects a wallet,
they claim the vault and the server permanently loses the ability to move those
assets. That asymmetry is the whole point of putting it on chain.

| Actor | Can | Cannot |
| --- | --- | --- |
| Server (registry authority) | open vaults, mint items | claim a vault, withdraw an item |
| Hacker's wallet | claim their vault, withdraw their items | mint, or touch another badge's vault |

## Accounts

All three are `Pod` (fixed-size, zero-copy). Field order is
largest-alignment-first with explicit tail padding so there are no implicit
padding holes. Sizes below **exclude** the 8-byte discriminator;
`<Account<T> as Space>::INIT_SPACE` includes it.

### `Registry` — 48 bytes

Singleton naming the server key allowed to mint.

| Offset | Field | Type | Notes |
| --- | --- | --- | --- |
| 0 | `vault_count` | `u64` | Badges seen, ever |
| 8 | `authority` | `Address` | The badge server's hot key |
| 40 | `bump` | `u8` | |
| 41 | `_pad` | `[u8; 7]` | |

PDA: `["registry"]`

### `Vault` — 88 bytes

One per badge.

| Offset | Field | Type | Notes |
| --- | --- | --- | --- |
| 0 | `claimed_at` | `i64` | Unix seconds; `0` while unclaimed |
| 8 | `badge_hash` | `[u8; 32]` | sha256 of the badge id |
| 40 | `owner` | `Address` | Zero address while in escrow |
| 72 | `animal_code` | `u32` | Index into the shared catalog |
| 76 | `item_count` | `u32` | Also the next item index |
| 80 | `bump` | `u8` | |
| 81 | `_pad` | `[u8; 7]` | |

PDA: `["vault", badge_hash]`

Badge ids are hashed before they touch the chain, so attendee identifiers stay
off-ledger while every badge still gets a stable, collision-resistant address.

### `ItemRecord` — 120 bytes

One per earned piece of clothing.

| Offset | Field | Type | Notes |
| --- | --- | --- | --- |
| 0 | `minted_at` | `i64` | Unix seconds |
| 8 | `vault` | `Address` | Owning vault |
| 40 | `owner` | `Address` | Zero address while in escrow |
| 72 | `station_hash` | `[u8; 32]` | sha256 of the granting station id |
| 104 | `code` | `u32` | Packed slot / rarity / content (see below) |
| 108 | `index` | `u32` | Per-vault index |
| 112 | `withdrawn` | `u8` | `1` once out of escrow |
| 113 | `bump` | `u8` | |
| 114 | `_pad` | `[u8; 6]` | |

PDA: `["item", vault, index_le_u32]`

**`code` packing** (produced by `itemForVisit` in `packages/shared`):

```
bits  0..15  content hash
bits 16..18  slot index    (head face torso hands feet back aura)
bits 19..20  rarity index  (common uncommon rare legendary)
```

Decoded by `decodeItemCode()` off-chain, so the program never has to know what
a "Neon Jetpack" is.

## Instructions

### `initialize_registry()`

Creates the registry, pinning the caller as the mint authority. Called once, at
first server boot (`SolanaChainClient.connect` does it automatically).

| Account | Signer | Writable |
| --- | --- | --- |
| `payer` | yes | yes |
| `registry` | | yes |
| `system_program` | | |

### `create_vault(badge_hash: [u8; 32], animal_code: u32)`

Opens a badge's vault on its first sync.

| Account | Signer | Writable |
| --- | --- | --- |
| `registry` | | yes |
| `authority` | yes | yes |
| `vault` | | yes |
| `system_program` | | |

The authority is also the rent payer — a separate `payer` account would just be
the same key passed twice, which Anchor v2 rejects as a duplicate mutable
account.

Errors: `NotAuthority` if the signer is not `registry.authority`.

### `mint_item(index: u32, code: u32, station_hash: [u8; 32])`

Grants one item for visiting a new station.

| Account | Signer | Writable |
| --- | --- | --- |
| `registry` | | |
| `authority` | yes | yes |
| `vault` | | yes |
| `item` | | yes |
| `system_program` | | |

`index` must equal `vault.item_count`. Combined with the item PDA being derived
from that index, this makes the call safe to retry: a replay either lands on an
already-initialized PDA or trips `ItemIndexMismatch`. A retry storm from a hub
can never inflate an inventory.

Errors: `NotAuthority`, `ItemIndexMismatch`.

### `claim_vault()`

The hacker's wallet takes ownership.

| Account | Signer | Writable |
| --- | --- | --- |
| `owner` | yes | yes |
| `vault` | | yes |

Only the wallet itself can call this — the server has no path to claim on a
hacker's behalf. A vault can only ever be claimed once.

Errors: `VaultAlreadyClaimed`.

### `withdraw_item()`

Moves one item out of escrow onto the claiming wallet.

| Account | Signer | Writable |
| --- | --- | --- |
| `owner` | yes | yes |
| `vault` | | |
| `item` | | yes |

Errors: `VaultNotClaimed`, `NotVaultOwner`, `ItemVaultMismatch`,
`ItemAlreadyWithdrawn`.

## Error codes

| Code | Name | Meaning |
| --- | --- | --- |
| 6000 | `NotAuthority` | signer is not the registry authority |
| 6001 | `VaultAlreadyClaimed` | vault has already been claimed by a wallet |
| 6002 | `VaultNotClaimed` | vault has not been claimed by a wallet yet |
| 6003 | `NotVaultOwner` | signer is not the owner of this vault |
| 6004 | `ItemIndexMismatch` | item index must equal the vault's item count |
| 6005 | `ItemAlreadyWithdrawn` | item has already been withdrawn from escrow |
| 6006 | `ItemVaultMismatch` | item does not belong to this vault |

## Building

```bash
bun run program:build     # ./scripts/build-program.sh
```

`anchor build` **alone does not produce a deployable artifact.** It pins
platform-tools v1.52, which emits an SBPFv0 binary, and SIMD-0500 disables
deployment of SBPFv0/v1/v2. The build script therefore:

1. runs `anchor build` for the IDL and TypeScript types,
2. rebuilds the `.so` with `cargo-build-sbf --arch v3` (platform-tools v1.54),
3. asserts the ELF `e_flags` is `3`,
4. copies the IDL into `packages/chain/src/idl/` so the client's discriminators
   always match the deployed program.

## Testing

```bash
bun run program:test      # cd program && cargo test
```

17 LiteSVM tests in `program/programs/badge_escrow/tests/escrow.rs` cover the
happy path plus every authorization boundary: non-authority mint attempts,
out-of-order and replayed mints, double claims, cross-hacker withdrawal, and
that the minting authority itself is locked out once a hacker has claimed.

`packages/chain/test/integration.test.ts` runs the same lifecycle against a real
deployed program over RPC, which is what proves the TypeScript layouts in
`packages/chain/src/layout.ts` agree with the Rust structs. It skips (rather
than fails) when no validator is running.

## Known limitations

- Items are program-owned records, not SPL Token / Token-2022 mints. The escrow
  and ownership-transfer semantics are real, but the assets are not yet tradeable
  on an NFT marketplace. `anchor-spl` v2 supports Token-2022 CPI, so minting a
  real NFT per item is the natural next step.
- The registry authority is a single hot key. For production, this should be a
  multisig or a rotatable authority.
- `withdraw_item` marks custody rather than closing the escrow account, so the
  rent stays with the program. Closing to the owner would be a small change.
