# `htn_quest` — attendee quest program

`htn_quest` is the minimal Anchor program that Hack the North attendees deploy
for the on-chain portion of the quest. It owns one singleton PDA containing the
attendee's authority and a UTF-8 message.

Program ID (localnet default): `9UkH8LeXw8jpQFZVNS3yk9LmkzsFAh54MK7SGP8jTsfY`

The program uses Anchor **2.0.0-rc.1** from the `anchor-next` branch.

## PDA derivation

The only account is the canonical program-derived address for these seeds:

```text
[b"quest"]
```

In JavaScript, derive it with `findProgramAddressSync([Buffer.from("quest")],
programId)`. There are no authority-specific or message-specific seeds.

## Account layout

`Quest` is declared with `#[account(borsh)]` and accessed through
`BorshAccount<Quest>`. Its allocation is 300 bytes: 8 bytes for the Anchor
discriminator plus a maximum 292-byte Borsh payload.

| Absolute byte offset | Size | Field | Encoding |
| --- | ---: | --- | --- |
| `0..8` | 8 | account discriminator | Anchor discriminator for `Quest` |
| `8..40` | 32 | `authority` | Solana address bytes |
| `40..44` | 4 | `message` length | unsigned 32-bit little-endian byte count |
| `44..(44 + length)` | 1–256 | `message` bytes | UTF-8 |
| remaining bytes through `299` | variable | unused capacity | zero-filled |

The message string begins at absolute byte offset **40**. This offset is part
of the off-chain verification contract: the server reads the raw account data
there and expects Borsh's `u32` length prefix followed by UTF-8 bytes.

Rust state definition:

```rust
#[account(borsh)]
#[derive(InitSpace)]
pub struct Quest {
    pub authority: Address,
    #[max_len(256)]
    pub message: String,
}
```

## Instructions

### `initialize(message: String)`

Creates the singleton quest PDA, records the caller as its authority, and
stores the initial message. The message must contain 1–256 UTF-8 bytes.

| Account | Signer | Writable | Constraint |
| --- | --- | --- | --- |
| `quest` | no | yes | initialized at PDA `[b"quest"]`; rent paid by `authority` |
| `authority` | yes | yes | recorded as `quest.authority` |
| `system_program` | no | no | Solana system program |

Calling `initialize` after the singleton PDA already exists fails during the
account initialization constraint.

### `set_message(message: String)`

Replaces the stored message. The message must contain 1–256 UTF-8 bytes, and
the signer must match the authority recorded by `initialize`.

| Account | Signer | Writable | Constraint |
| --- | --- | --- | --- |
| `quest` | no | yes | PDA `[b"quest"]` |
| `authority` | yes | no | address equals `quest.authority` |

## Error codes

| Code | Name | Meaning |
| ---: | --- | --- |
| 6000 | `NotAuthority` | signer does not match `quest.authority` |
| 6001 | `MessageTooLong` | UTF-8 message encoding exceeds 256 bytes |
| 6002 | `MessageEmpty` | message is zero bytes long |

## Building

```bash
bun run program:build     # ./scripts/build-program.sh
```

`anchor build` **alone does not produce a deployable artifact.** It pins
platform-tools v1.52, which emits an SBPFv0 binary, and SIMD-0500 disables
deployment of SBPFv0/v1/v2. The build script therefore:

1. runs `anchor build` for the IDL and TypeScript types,
2. rebuilds `htn_quest.so` with `cargo-build-sbf --arch v3`
   (platform-tools v1.54),
3. asserts that the ELF `e_flags` value is `3`, and
4. copies the generated IDL to `starter/idl/htn_quest.json`.

The deployable artifacts are:

```text
program/target/deploy/htn_quest.so
program/target/deploy/htn_quest-keypair.json
starter/idl/htn_quest.json
```

The generated keypair's public key must match both `declare_id!` in the program
and the `htn_quest` entry in `program/Anchor.toml`.

## Local validator

```bash
./scripts/localnet.sh start
./scripts/localnet.sh env
./scripts/localnet.sh stop
```

`start` builds and deploys `htn_quest`, then prints `SOLANA_RPC_URL` and
`PROGRAM_ID`. The script does not initialize the quest PDA; attendees call
`initialize` themselves.

## Testing

```bash
bun run program:test      # cd program && cargo test
```

The LiteSVM suite in `program/programs/htn_quest/tests/quest.rs` covers
initialization, the raw account byte layout, authorized and unauthorized
updates, both message bounds on both instruction paths, and duplicate
initialization.
