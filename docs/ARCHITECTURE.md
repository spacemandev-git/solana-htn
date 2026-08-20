# Architecture

## The world

Hack the North attendees wear an ESP32-C3 badge. Scattered around the venue are
**Sync Stations** — ESP32 hubs that badges announce themselves to over ESP-NOW.

The stations are **hubs**: towns, where you meet NPCs, pick up quests, and find
points of interest. The space between them is **wilderness**, where you have no
station and have to find other hackers. Walking between hubs is the core loop,
and the badge knows which one you are standing in.

Mechanically: your badge gives you an animal. Every *new* station you reach
dresses that animal in one more funky piece of clothing, minted into an on-chain
escrow vault. Connect a wallet whenever you like and the assets become yours.

## Pieces

```
 ESP32 badge ──ESP-NOW──▶ Sync Station ──HTTPS POST──▶ apps/server
                                          x-station-key    │
                                                           │ pairing code + URL
                                                           ▼
                        hacker's phone ◀──── SSE ──── apps/pwa  /s/:pairingCode
                                │
                                │ wallet signs
                                ▼
                          Solana ◀── packages/chain ── program/ (badge_escrow)
```

| Package | Role |
| --- | --- |
| `apps/server` | Bun + Hono API. SQLite (`bun:sqlite`). SSE hub for live sessions. Holds the mint authority. |
| `apps/pwa` | SvelteKit 5 mobile PWA: the live session view, the wallet claim page, and the operator/simulator dashboard. |
| `packages/shared` | The contract: domain types, zod API schemas, and the deterministic content catalog. Imported by everything. |
| `packages/chain` | TypeScript client for `badge_escrow` — PDA derivation, instruction encoding, account decoding. |
| `program` | The Anchor 2.0 program. See [PROGRAM.md](PROGRAM.md). |

## Key decisions

### Content is derived, not stored

`animalForBadge(badgeId)` and `itemForVisit(badgeId, stationId)` in
`packages/shared/src/catalog.ts` are pure functions over an FNV-1a hash. The
same badge always gets the same animal; the same badge at the same station
always gets the same item.

This means no content state needs syncing between the server, the PWA, the
badge firmware, and the chain — each can derive it. The database records *that*
an item was granted; the catalog decides *what* it was.

### "New station" is a database constraint, not a code path

The `visits` table has a unique index on `(badge_id, station_id)`. Granting an
item is an `INSERT ... ON CONFLICT DO NOTHING RETURNING id`: the insert either
wins (first visit — grant the item) or does nothing (repeat sync — grant
nothing). Two hubs reporting the same badge at once cannot double-grant, because
the race is resolved by SQLite rather than by application logic.

The on-chain `mint_item` has an independent guard (`index == vault.item_count`),
so even a bug in the server cannot inflate an inventory on chain.

### The chain is optional at runtime, mandatory in semantics

`createChainClient()` returns a `DisabledChainClient` when `SOLANA_RPC_URL` or
the authority key is missing. Every write then resolves with a `null` signature
and the server records "not yet on chain" rather than failing.

That keeps the badge → station → phone loop fully demoable with no validator —
which matters at a hackathon, where the venue wifi is the least reliable
component in the system. `/api/health` reports `chainEnabled` so it is never
ambiguous which mode you are in.

Chain writes also happen *after* the local grant, so a flaky RPC can never cost
a hacker their loot. `assetAddress` / `signature` stay null until the write
lands.

### The server can mint but cannot take

The server holds the registry authority: it opens vaults and mints items. It
deliberately has **no** ability to claim a vault or withdraw an item — both
instructions require the hacker's wallet to sign.

So the claim flow is split. The server *builds* the unsigned transaction
(`POST /api/vault/claim-tx`), the browser wallet signs and submits it, and the
server separately records the binding after verifying an ed25519 signature over
a fixed message (`claimMessage()` in `packages/shared`, so the server and PWA
can never disagree about the bytes).

Handing out an unsigned transaction grants nothing, which is why that endpoint
needs no authentication beyond knowing the pairing code.

### Sessions are live, and end when you walk away

A station POSTs `sync` when a badge is in range and `disconnect` when it drops
out. A partial unique index on `sessions(badge_id) WHERE active = 1` enforces
one live pairing per badge, so walking to a new hub ends the old session and
pushes a `disconnected` event down its SSE channel.

The pairing code is short and human-readable (6 chars, no `0/O/1/I/L`) because
it has to survive being read off a small screen or a QR code.

## Data flow: one hacker, one afternoon

1. Hacker walks into range of **E7 Foundry**. The station POSTs
   `/api/station/sync` with its id and the badge's id, name, and email.
2. Server upserts the badge (assigning `loon` via `animalForBadge`), opens the
   escrow vault on chain, records the visit, grants **Glacial Flannel**
   (`itemForVisit`), mints it into the vault, and returns pairing code `4CW5G5`
   plus `http://…/s/4CW5G5`.
3. Hacker opens that URL on their phone. The PWA loads the `SessionView` and
   subscribes to the SSE stream. It shows their loon, their flannel, and a LIVE
   indicator.
4. Hacker wanders into the wilderness. The station POSTs `disconnect`; the
   phone flips to the wilderness state over SSE.
5. Hacker reaches **MC Great Hall**. New station → new visit → **Recursive
   Firefly Swarm**, minted as item index 1. New pairing code, new live session.
6. Hacker returns to E7 Foundry. Not a new station, so no item — but a fresh
   live session.
7. Hacker opens `/wallet`, connects a Solana wallet, and signs. The vault's
   `owner` goes from the zero address to their pubkey. From here the server can
   no longer move any of it.
8. Hacker withdraws the flannel to their own custody. `item.withdrawn = 1`.

## Testing

| Suite | Command | What it proves |
| --- | --- | --- |
| Server | `bun test` | Auth, idempotency, session lifecycle, claim/withdraw rules, aggregation |
| Program | `bun run program:test` | 17 LiteSVM tests: the escrow lifecycle and every authorization boundary |
| Chain integration | `bun test packages/chain` (with a validator) | The TypeScript layouts actually agree with the deployed Rust structs |

The chain integration suite is the important one: discriminators, PDA seeds, and
byte offsets are the three things that can silently drift between
`packages/chain` and `program/`, and only a round trip against a real deployed
program catches it.
