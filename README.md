# Hack the North × Solana — badge activation

A Solana activation for the Hack the North hacker badges.

Attendees wear an ESP32-C3 badge. **Sync Stations** placed around the venue pick
badges up over ESP-NOW and report them to a server, which hands back a pairing
code and a URL. Open that URL on your phone and you get a live session for as
long as you're standing near the station.

The stations are **hubs** — towns, where you find quests, NPCs and points of
interest. Between them is **wilderness**, where you have to go find other
hackers. Your badge gives you an animal, and every new hub you reach dresses it
in one more funky piece of clothing, minted into an on-chain escrow vault.
Connect a wallet whenever you want and take ownership.

## Status

Infrastructure and the full end-to-end loop are built and tested. Quests, NPCs
and the AI storyteller are not — this is the substrate they will sit on.

## Quick start

```bash
bun install
bun run dev          # server on :3000, PWA on :5173
```

Then open <http://localhost:5173/sim> and fire a fake badge sync. No hardware and
no blockchain required — the server runs happily with the chain disabled.

### With a real chain

```bash
bun run localnet     # starts a validator, deploys badge_escrow, prints env
```

Paste the three printed variables into `.env` and restart the server.
`/api/health` will report `chainEnabled: true`.

## Layout

```
apps/server      Bun + Hono API. SQLite via bun:sqlite. SSE for live sessions.
apps/pwa         SvelteKit 5 mobile PWA + operator/simulator dashboard.
packages/shared  Types, zod API schemas, deterministic content catalog.
packages/chain   TypeScript client for the badge_escrow program.
program          Anchor 2.0.0-rc.1 workspace (Rust + LiteSVM tests).
scripts          Program build and local validator tooling.
```

## The PWA

| Route | What it is |
| --- | --- |
| `/` | Landing page |
| `/s/:pairingCode` | **The phone view.** Your animal, your clothing, which hub you're in, live over SSE |
| `/wallet` | Connect a Solana wallet, claim your vault, withdraw items from escrow |
| `/sim` | **The simulator.** Fake badges and stations, fire syncs and disconnects, watch every badge's inventory |

`/sim` is how you demo or test the whole thing without hardware.

## The chain

`program/` is an Anchor **2.0.0-rc.1** program, `badge_escrow`. It holds each
badge's animal and clothing in escrow — created and funded by the server, owned
by nobody — until the hacker connects a wallet and claims the vault. After that
the server permanently loses the ability to move those assets.

That asymmetry is the point: the server can mint, and cannot take.

See [docs/PROGRAM.md](docs/PROGRAM.md) for account layouts and instructions.

## Commands

```bash
bun run dev             # server + PWA
bun run dev:server      # server only
bun run dev:pwa         # PWA only
bun test                # all TypeScript tests
bun run program:build   # build the program + IDL (see note below)
bun run program:test    # LiteSVM tests
bun run localnet        # validator + deploy
bun run localnet:stop
```

> `anchor build` on its own does **not** produce a deployable artifact — it emits
> an SBPFv0 binary, and SIMD-0500 disables deployment of SBPFv0/v1/v2. Always use
> `bun run program:build`, which rebuilds with `--arch v3` and verifies the ELF
> flags. See [CLAUDE.md](CLAUDE.md#building-the-program).

## Configuration

Copy `.env.example` to `.env`. Every value has a working local default; the only
one you must change before pointing real hardware at it is `STATION_API_KEY`,
the shared secret the Sync Stations authenticate with.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit and why
- [docs/API.md](docs/API.md) — every HTTP endpoint, the SSE stream, the schema
- [docs/PROGRAM.md](docs/PROGRAM.md) — on-chain accounts, instructions, errors
- [docs/SIMULATOR.md](docs/SIMULATOR.md) — driving the system without hardware
- [CLAUDE.md](CLAUDE.md) — project rules and Anchor v2 gotchas
