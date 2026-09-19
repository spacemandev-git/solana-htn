# Hack the North × Solana — the $1 quest

One quest, real money. Attendees wear an ESP32-C3 badge; **beacons** around the
venue pick badges up over ESP-NOW and hand back a QR code that live-pairs the
hacker's phone. The phone shows a single quest:

> Deploy a tiny Anchor program that stores a message on Solana. Paywall an HTTP
> endpoint with **x402**. Submit the URL — our agent calls it once, pays your
> price in the cluster's payment token, straight to your wallet, and verifies
> the paid response against the chain. Devnet pays HTN Bucks (`HTN`); mainnet
> pays USDC.

The reward is the payment itself. No points, no items, no custody.

## Quick start

```bash
bun install
bun run dev          # server on :3000, PWA on :5173
```

Open <http://localhost:5173/sim>, tap a box with a fake badge, open its console
link, and submit `http://localhost:3000/api/dev/vendor` as the endpoint with
any base58 address as the program id. No hardware, no blockchain, no money —
payments are simulated until you configure a payer key.

### With real payments

```bash
# .env
SOLANA_CLUSTER=devnet
X402_PAYER_SECRET_KEY=<base58 64-byte key holding HTN Bucks + a little SOL>
```

Restart the server; `/api/health` reports `chainEnabled: true` and the agent
pays for real. Devnet uses HTN Bucks (`HTN`), an SPL token we mint whose supply
the agent wallet holds, so hackers need no tokens and no faucet. Mainnet uses
USDC.

## Layout

```
apps/server      Bun + Hono API. SQLite. SSE. The verification agent + x402 payer.
apps/pwa         SvelteKit 5 terminal-themed quest console + simulator dashboard.
apps/badge-service  Bun + Hono HTN OS control plane and badge WebSocket proxy.
packages/shared  Types, zod API schemas, pinned quest constants.
packages/chain   x402 challenge parsing, the paying fetch, Solana RPC reads.
program          htn_quest — the Anchor 2.0 reference program hackers deploy.
starter          The kit hackers copy: x402-paywalled endpoint + set-message CLI.
firmware         ESP-IDF HTN OS for remotely programmable hacker badges.
scripts          Program build (SBPFv3) and local validator tooling.
```

## The PWA

| Route | What it is |
| --- | --- |
| `/` | Landing page |
| `/s/:pairingCode` | **The quest console.** Brief, submission form, live verification log, payout |
| `/sim` | **The simulator.** Fake badges and beacons; demo the whole loop offline |
| `/badge` | **HTN OS.** Flash the badge firmware from the browser, drive your badge, browse and submit badge apps |
| `/badge/docs` | **HTN OS docs.** The badge API, wire protocol, and badge ↔ server / badge ↔ badge examples |

## The quest, hacker-side

Everything a hacker needs is in [`starter/`](starter/) and
[docs/QUEST.md](docs/QUEST.md): deploy `program/` (htn_quest) to devnet, write
a message into its `["quest"]` PDA, run the starter's x402 server with their
own wallet as `payTo`, expose it, submit. The agent's five checks — program
deployed, PDA readable, valid 402 terms within the token cap, payment settles,
response matches chain state — stream to their phone as a terminal log.

## Commands

```bash
bun run dev             # server + PWA
bun run dev:badge       # HTN OS badge service on :3100
bun test                # all TypeScript tests
bun run firmware:build  # build the ESP-IDF HTN OS firmware
bun run program:build   # build htn_quest + IDL (SBPFv3 — see note)
bun run program:test    # LiteSVM tests
bun run localnet        # validator + deploy, for local program hacking
```

> `anchor build` on its own does **not** produce a deployable artifact — it
> emits an SBPFv0 binary, and SIMD-0500 disables deployment of SBPFv0/v1/v2.
> Always use `bun run program:build`. Devnet is the exception: it has not
> activated SBPFv3, so deploy the SBPFv0 file the same build leaves at
> `program/target/sbpf-solana-solana/release/htn_quest.so`. See
> [CLAUDE.md](CLAUDE.md#building-the-program).

## Configuration

Copy `.env.example` to `.env`. Every value has a working local default. The
ones that matter at the event: `SOLANA_BOX_ID` (the `box` id of the Solana
station, default `solana-booth`), `SOLANA_CLUSTER`, `X402_PAYER_SECRET_KEY` (the paying wallet), and
`MAX_REWARD_USD` (the per-badge cap, default $1).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit and why
- [docs/API.md](docs/API.md) — every HTTP endpoint, the SSE stream, the schema
- [docs/PROGRAM.md](docs/PROGRAM.md) — htn_quest account layout and instructions
- [docs/QUEST.md](docs/QUEST.md) — the hacker-facing walkthrough
- [docs/SIMULATOR.md](docs/SIMULATOR.md) — demoing without hardware
- [docs/HTNOS.md](docs/HTNOS.md) — HTN OS badge API, protocol, and firmware workflow
