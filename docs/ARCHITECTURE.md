# Architecture

## The activation

Hack the North attendees wear an ESP32-C3 badge. Around the venue are
**beacons** — ESP32 hubs that badges announce themselves to over ESP-NOW. Walk
up to one, the beacon reports your badge to the server, and your badge gets a
QR code. Scan it and your phone is live-paired to the event over SSE.

There is exactly **one quest**, and it pays real money:

> Deploy a tiny Anchor program that stores a message on Solana. Wrap it in an
> HTTP endpoint paywalled with **x402**. Submit the URL. Our agent calls your
> endpoint exactly once, pays your price in USDC (up to $1, straight to your
> wallet), and verifies the paid response against the chain.

The reward *is* the payment. There is no scoreboard to update and no asset to
custody — the x402 settlement to the hacker's own `payTo` wallet is the loot.

## Pieces

```
 ESP32 badge ──ESP-NOW──▶ Beacon ──HTTPS POST──▶ apps/server
                                   x-station-key     │
                                                     │ pairing code + URL (QR)
                                                     ▼
                    hacker's phone ◀──── SSE ──── apps/pwa  /s/:pairingCode
                          │ submits { endpointUrl, programId }
                          ▼
                    apps/server verification agent
                          │ 1─2. RPC reads            3─5. HTTP + x402 payment
                          ▼                                ▼
                    Solana cluster                hacker's starter/ endpoint
                    (their htn_quest program)     (402 → X-PAYMENT → paid 200)
```

| Package | Role |
| --- | --- |
| `apps/server` | Bun + Hono API. SQLite (`bun:sqlite`). SSE hub. Runs the verification agent and holds the x402 payer key. |
| `apps/pwa` | SvelteKit 5 terminal-themed PWA: the quest console, plus the operator/simulator dashboard. |
| `packages/shared` | The contract: domain types, zod API schemas, and the pinned quest constants (PDA seed, byte offsets, cluster/network/USDC ids). |
| `packages/chain` | The x402 + Solana module: 402 challenge parsing/validation, the paying `fetch`, and raw RPC reads of hacker programs. |
| `program` | `htn_quest`, the Anchor 2.0 reference program hackers deploy. See [PROGRAM.md](PROGRAM.md). |
| `starter` | The kit hackers copy: an x402-paywalled Hono server + a `set-message` script. See [QUEST.md](QUEST.md). |

## The verification pipeline

A submission is `{ endpointUrl, programId }`, authenticated by an active
pairing code. The agent then runs five steps, streaming each over SSE so the
phone renders a live terminal log:

1. **program** — `programId` is a live, executable account on the cluster.
2. **state** — `PDA(["quest"], programId)` exists, is owned by that program,
   and holds a borsh string at byte offset 40 (8 discriminator + 32 authority).
3. **challenge** — a plain GET returns HTTP 402 whose terms are acceptable:
   `exact` scheme, this cluster's network id (v1 or CAIP-2), the canonical
   USDC mint, amount ≤ the cap, a `payTo`.
4. **payment** — the wrapped fetch pays over x402 and retries. The settlement
   signature from `X-PAYMENT-RESPONSE` is recorded.
5. **proof** — the paid response's JSON `message` equals the on-chain message.

Order is the security model: everything cheap and read-only runs **before**
money moves, so the only post-payment failure mode is a hacker whose endpoint
lies about their own chain state.

## Key decisions

### Pay-once is a database fact, not a code path

`quest_submissions.paid` is set in the same synchronous write that records the
settlement signature, *before* the proof step is evaluated. Any later
submission for that badge — retry, resubmit, crash-recovery — sees `paid = 1`
and refuses to reach the payment step. The cap (`MAX_REWARD_USD`, default $1)
is enforced twice more, independently: at challenge validation and again
inside `packages/chain` right before paying. The server can lose at most the
cap per badge, once.

### The x402 knowledge lives in one package

`packages/chain` is the only code that knows what a 402 challenge looks like
(v1 `maxAmountRequired` and v2 `amount` envelopes, body or header), how to
build an `X-PAYMENT`, or how to talk to an RPC. The server consumes the frozen
`QuestChain` interface (`packages/chain/src/types.ts`) and writes its results
straight into SQLite. Swapping facilitator ecosystems or protocol versions
never touches `apps/server`.

### The chain is optional at runtime, mandatory in semantics

No `X402_PAYER_SECRET_KEY` → the disabled client: chain reads are skipped,
and the payment step sends a simulated `X-PAYMENT` that only the dev mock
vendor (`GET /api/dev/vendor`) accepts. The whole badge → beacon → phone →
quest loop is demoable offline via `/sim`, which matters at a hackathon where
venue wifi is the least reliable component. `/api/health` reports
`chainEnabled` so the mode is never ambiguous.

### Verification is asynchronous, progress is push

`POST /api/quest/submit` answers 202 immediately; the pipeline runs in the
background and publishes `quest-progress` / `quest-result` events to the
session's SSE channel. Walking away from the beacon ends the *session*, not
the verification — the agent finishes regardless, and the result is waiting at
the next sync.

### The server verifies the hacker's program by raw bytes, not by IDL

Hackers may build with our Anchor 2.0 reference or anything ABI-compatible.
The agent never loads their IDL: it checks the account at `PDA(["quest"])` is
owned by their program and borsh-decodes the string at the pinned offset
(`QUEST_MESSAGE_OFFSET` in `packages/shared`). The program test suite asserts
that exact offset against LiteSVM, so the contract cannot drift silently.

## Data flow: one hacker, one afternoon

1. Hacker taps their badge near the **registration beacon**. It POSTs
   `/api/station/sync`; the badge screen shows a QR for `/s/4CW5G5`.
2. The phone opens the quest console: the brief, the env facts (cluster, USDC
   mint, reward cap, the agent's address), and a submission prompt.
3. Hacker clones the repo, deploys `htn_quest` to devnet, runs
   `bun run set-message "gm htn"`, starts `starter/` with their wallet as
   `payTo`, and tunnels it.
4. They submit the URL + program id. The console streams:
   `✔ program deployed on-chain`, `✔ quest PDA holds a message`,
   `✔ endpoint answers 402 with valid terms — $1.00 to 7f9k…`,
   `✔ x402 payment settled`, `✔ paid response matches on-chain state`.
5. The payout panel shows $1.00, the settlement signature (explorer link), and
   their message writ large. The USDC is already in their wallet.

## Testing

| Suite | Command | What it proves |
| --- | --- | --- |
| Server | `bun test apps/server` | Auth, session lifecycle, the five-step pipeline against a fake chain, the pay-once invariant |
| Chain | `bun test packages/chain` | 402 envelope parsing (v1+v2), cap enforcement, quest-account byte decoding, disabled-mode flow |
| Program | `bun run program:test` | LiteSVM: instruction auth and the byte-offset contract the server depends on |
| Starter | `bun test starter` | The kit actually emits a compliant 402 with the right mint/network/cap |
