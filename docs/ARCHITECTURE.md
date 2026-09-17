# Architecture

## The activation

Hack the North attendees wear an ESP32-C3 badge. Around the venue are eight
**blind boxes**. A badge taps a box, the hardware relay POSTs the firmware
payload to the server, and the server returns a newly awarded item plus the
badge's permanent QR link. Scan it and the phone opens the badge's live state
over SSE.

Seven boxes award one unowned regular item. The Solana box stays empty until
the badge completes the quest, then awards both Solana items:

> Deploy a tiny Anchor program that stores a message on Solana. Wrap it in an
> HTTP endpoint paywalled with **x402**. Submit the URL. Our agent calls your
> endpoint exactly once, pays your price in USDC (up to $1, straight to your
> wallet), and verifies the paid response against the chain.

The reward *is* the payment. There is no scoreboard to update and no asset to
custody — the x402 settlement to the hacker's own `payTo` wallet is the loot.

## Pieces

```text
 ESP32 badge ──BLE──▶ Box relay ──HTTPS POST /api/box──▶ apps/server
       ▲                                                   │
       └──────── item inventory + permanent pairing URL ───┘
                                                           │ badge state + events
                                                           ▼
                    hacker's phone ◀──── SSE ───────── apps/pwa /s/:pairingCode
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
| `apps/server` | Bun + Hono API. SQLite (`bun:sqlite`). Awards blind-box items, fans out badge SSE, runs the verification agent, and holds the x402 payer key. |
| `apps/pwa` | SvelteKit 5 terminal-themed PWA: the quest console, plus the operator/simulator dashboard. |
| `packages/shared` | The contract: domain types, zod API schemas, item pools, and pinned quest constants (PDA seed, byte offsets, cluster/network/USDC ids). |
| `packages/chain` | The x402 + Solana module: 402 challenge parsing/validation, the paying `fetch`, and raw RPC reads of hacker programs. |
| `program` | `htn_quest`, the Anchor 2.0 reference program hackers deploy. See [PROGRAM.md](PROGRAM.md). |
| `starter` | The kit hackers copy: an x402-paywalled Hono server + a `set-message` script. See [QUEST.md](QUEST.md). |

## The verification pipeline

A submission is `{ endpointUrl, programId }`, authenticated by a badge pairing
code. The agent then runs five steps, streaming each over SSE so the phone
renders a live terminal log:

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

### Box replay and inventory are database facts

Each award is unique by `(badge_id, item)`, and records the box that granted it.
If the same badge taps the same box again, that box's first award is replayed.
Regular boxes choose only from unowned regular items. The Solana box checks the
persisted quest status and grants its two items together. The response always
contains the complete authoritative inventory, so badge-local state can recover
after a reset or dropped relay response.

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
vendor (`GET /api/dev/vendor`) accepts. The whole badge → box → phone → quest
loop is demoable offline via `/sim`, which matters at a hackathon where venue
wifi is the least reliable component. `/api/health` reports `chainEnabled` so
the mode is never ambiguous.

### Verification is asynchronous, progress is push

`POST /api/quest/submit` answers 202 immediately; the pipeline runs in the
background and publishes `quest-progress` / `quest-result` events to the
badge's permanent SSE channel. The verification finishes independently of
whether a browser is connected, and its result is present in the next
authoritative state fetch.

### The server verifies the hacker's program by raw bytes, not by IDL

Hackers may build with our Anchor 2.0 reference or anything ABI-compatible.
The agent never loads their IDL: it checks the account at `PDA(["quest"])` is
owned by their program and borsh-decodes the string at the pinned offset
(`QUEST_MESSAGE_OFFSET` in `packages/shared`). The program test suite asserts
that exact offset against LiteSVM, so the contract cannot drift silently.

## Data flow: one hacker, one afternoon

1. A hacker taps any regular blind box. The relay POSTs `/api/box`; the badge
   receives an item, its authoritative inventory, and `/s/4CW5G5`.
2. The phone opens the quest console: the brief, inventory, and environment
   facts (cluster, USDC mint, reward cap, Solana box id, agent address).
3. The hacker clones the repo, deploys `htn_quest` to devnet, runs
   `bun run set-message "gm htn"`, starts `starter/` with their wallet as
   `payTo`, and tunnels it.
4. They submit the URL + program id. The console streams:
   `✔ program deployed on-chain`, `✔ quest PDA holds a message`,
   `✔ endpoint answers 402 with valid terms — $1.00 to 7f9k…`,
   `✔ x402 payment settled`, `✔ paid response matches on-chain state`.
5. The payout panel shows $1.00, the settlement signature (explorer link), and
   their message. Their next tap at `blind-box-01` awards item `9` (item `8` came on their first tap there).

## Testing

| Suite | Command | What it proves |
| --- | --- | --- |
| Server | `bun test apps/server` | Box replay, inventory exhaustion, Solana gating, badge SSE, the five-step pipeline against a fake chain, and the pay-once invariant |
| Chain | `bun test packages/chain` | 402 envelope parsing (v1+v2), cap enforcement, quest-account byte decoding, disabled-mode flow |
| Program | `bun run program:test` | LiteSVM: instruction auth and the byte-offset contract the server depends on |
| Starter | `bun test starter` | The kit actually emits a compliant 402 with the right mint/network/cap |
