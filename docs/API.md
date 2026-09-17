# HTTP API

The server receives blind-box taps, exposes each badge's authoritative state,
and verifies one quest submission per badge while paying a valid x402 endpoint
at most once. JSON fields use the casing shown below: firmware fields are
snake_case and browser/dashboard fields are camelCase. Timestamps are ISO 8601
strings.

Examples use `http://localhost:3000` as the base URL. Production uses
`https://api.solana-htn.com`.

## Deployment

The production API is the `htn-api` Cloud Run service in project `solana-htn`
(region `northamerica-northeast2`), fronted by a global external HTTPS load
balancer at `https://api.solana-htn.com`. Cloud Run domain mappings are not
allowed in that region, so the hostname resolves to the load balancer's static
IP rather than `ghs.googlehosted.com`. The relay POSTs to
`https://api.solana-htn.com/api/box`.

## Authentication

The pairing code is the only credential. It is minted permanently for a badge,
embedded in the pairing URL, and supplied to `POST /api/quest/submit`.

`POST /api/box` is deliberately unauthenticated because the hardware relay
cannot set HTTP headers. Badge reads, SSE, dashboard, and health endpoints are
also unauthenticated. Development endpoints are unauthenticated but are not
mounted in production.

Errors use this shape:

```json
{
  "error": "badge_not_found",
  "detail": "no badge with that pairing code"
}
```

Malformed JSON returns `400 invalid_json`. JSON that does not match the shared
schema returns `400 invalid_request`. Unknown routes return `404 not_found`.

## `POST /api/box`

The relay forwards the firmware payload verbatim. A successful request always
returns HTTP 200 and should finish in under 8 seconds so the relay can deliver
the response over BLE.

```http
POST /api/box
Content-Type: application/json

{
  "box": "hardware-hub",
  "user_id": "1042",
  "name": "Ada Hacker",
  "email": "ada@example.com",
  "public_key": ""
}
```

The firmware field names are fixed. `box` is printable ASCII, 1–39 characters.
`user_id` is the badge identity; if it is empty, the server uses `public_key`
instead. At least one must be non-empty. Empty `name`, `email`, or `public_key`
values never erase previously recorded non-empty values.

```json
{
  "new_item": "1",
  "chain_link": "http://localhost:5173/s/7KQ9DW",
  "all_items": ["1"]
}
```

- `new_item` is the item won at this box.
- `chain_link` is the permanent quest-console pairing link.
- `all_items` is the authoritative inventory, oldest award first.

The serialized response is at most 207 UTF-8 bytes. If necessary, the server
sets `chain_link` to `""`; it never drops inventory items.

Each configured box hands out one fixed item. Repeated taps replay the same
`new_item` without awarding anything new:

| `box` | Zone | Item |
| --- | --- | --- |
| `solana-booth` | Solana Booth | `"8"` |
| `solana-booth-final` | Solana Booth (Final) | `"9"` once the quest is complete, otherwise empty |
| `hardware-hub` | Hardware Hub | `"1"` |
| `extended-bay` | Extended Sponsor Bay | `"2"` |
| `mentor-cafe` | Mentor Cafe | `"3"` |
| `third-floor` | Third Floor Hacking Space | `"4"` |
| `fourth-floor` | Fourth Floor Hacking Space | `"5"` |
| `fifth-floor` | Fifth Floor Hacking Space | `"6"` |
| `seventh-floor` | Seventh Floor | `"7"` |

Item ids map to the collectible characters below (`ITEM_LABELS` in
`packages/shared/src/items.ts`; artwork ships with the PWA at
`/items/<id>.png`):

| Item | Character |
| --- | --- |
| `"1"` | Ginny Locked In |
| `"2"` | Ginny Sparkle |
| `"3"` | Patch Snooze |
| `"4"` | Patch Sparkle |
| `"5"` | Vinyl Curious |
| `"6"` | Ginny Heart |
| `"7"` | Patch Curious |
| `"8"` | Vinyl Snooze |
| `"9"` | Vinyl Sparkle |

The box table is pinned in `packages/shared/src/items.ts`. A `box` id that is not
in it returns `new_item: ""` (the badge shows "Empty box?") but still returns
the pairing link and the current inventory.

The configured first Solana box (default `solana-booth`) awards item `"8"`
independent of quest status and replays `new_item: "8"` on every later tap. The
configured final Solana box (default `solana-booth-final`) is empty until the
badge's quest is `completed`; it then awards item `"9"` and replays
`new_item: "9"` on later taps. Unknown ids, and a Solana-item box entry reached
through the regular-box path because its configured id was overridden, are
empty boxes.

## `GET /api/badge/:pairingCode`

Returns the full browser view for the permanently paired badge:

```json
{
  "badge": {
    "badgeId": "1042",
    "name": "Ada Hacker",
    "email": "ada@example.com",
    "publicKey": "",
    "pairingCode": "7KQ9DW",
    "createdAt": "2026-08-28T16:00:00.000Z",
    "lastSeenAt": "2026-08-28T16:04:00.000Z"
  },
  "awards": [
    {
      "badgeId": "1042",
      "item": "4",
      "box": "hardware-hub",
      "awardedAt": "2026-08-28T16:00:00.000Z"
    }
  ],
  "quest": null,
  "env": {
    "chainEnabled": true,
    "cluster": "devnet",
    "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "paymentMint": "3W7U7Dh81RdKBmwmF2nR3tz5YoaPFFUyBY1bz2u5tE1Q",
    "paymentSymbol": "HTN",
    "maxRewardAtomic": 1000000,
    "payerAddress": "9wFFmG6Q7examplePayerAddress111111111111",
    "solanaBoxId": "solana-booth",
    "solanaFinalBoxId": "solana-booth-final"
  }
}
```

`chainEnabled` is false and `payerAddress` is null when no payer key is
configured. An unknown code returns `404 badge_not_found`.

## `GET /api/badge/:pairingCode/stream`

Opens a Server-Sent Events stream with content type `text/event-stream`. The
first event is the authoritative `state`. The server sends `ping` every 25
seconds. Reconnect by opening a new stream; events are not replayed because the
initial state contains the current truth.

Every frame uses standard SSE data framing:

```text
data: {"type":"ping"}

```

An unknown code returns `404 badge_not_found`.

## `POST /api/quest/submit`

The pairing code is the credential. It must belong to a badge. The server
persists the submission and returns `202` before verification finishes; watch
the badge stream or fetch the badge again for the result.

```http
POST /api/quest/submit
Content-Type: application/json

{
  "pairingCode": "7KQ9DW",
  "endpointUrl": "https://hacker.example/quest",
  "programId": "11111111111111111111111111111111"
}
```

```json
{
  "submission": {
    "badgeId": "1042",
    "endpointUrl": "https://hacker.example/quest",
    "programId": "11111111111111111111111111111111",
    "status": "verifying",
    "step": null,
    "error": null,
    "message": null,
    "amountPaidAtomic": null,
    "paymentSignature": null,
    "network": null,
    "paid": false,
    "submittedAt": "2026-08-28T16:03:00.000Z",
    "completedAt": null
  }
}
```

Submission errors:

- `404 badge_not_found`: no badge has that pairing code.
- `409 quest_verifying`: verification is already running for the badge.
- `409 quest_already_completed`: the badge already completed the quest.
- `409 quest_already_paid`: an earlier failed run moved money and cannot be
  replaced.
- `409 program_already_claimed`: that program id belongs to another badge;
  every hacker must deploy their own `htn_quest`.

An unpaid failed submission may be replaced. Replacement clears its prior
endpoint, program, progress, message, error, and payment metadata before the new
run begins.

### Verification pipeline

The steps always run in this order:

1. `program`: confirm the submitted program is deployed and executable.
2. `state`: read the message from its quest PDA.
3. `challenge`: probe the endpoint and validate its x402 terms, cluster,
   configured payment mint, and amount ceiling.
4. `payment`: pay the endpoint once, or simulate the request when the chain
   client is disabled.
5. `proof`: validate the paid JSON response and compare its `message` with the
   message read from chain.

Before a live payment, the payer creates the recipient's associated token
account for the payment mint idempotently and at the payer's expense, because
the x402 client emits the token transfer but does not create its destination.

The settlement fields and `paid = true` are committed before proof parsing.
Consequently, a crash or proof failure after settlement cannot make the badge
eligible for another payment. The in-memory concurrent-run guard is only a
second layer; SQLite is the pay-once source of truth.

The `quest_submissions` table is the source of truth for this persisted state
machine:

```text
no submission ──submit──> verifying ──all steps pass──> completed
                              │
                              └──step fails──> failed
                                                │
                          paid=false ──submit────┘
                          paid=true  ──terminal (quest_already_paid)

completed is terminal (quest_already_completed)
verifying rejects another submit (quest_verifying)
```

A completed submission has `step: null`, `error: null`, and a non-null
`completedAt`. A failed submission records the failing `step`, a human-readable
`error`, and `completedAt: null`.

## Dashboard

### `GET /api/badges`

Returns one summary per badge. `items` contains award ids oldest first and
`quest` may be null.

```json
[
  {
    "badge": {
      "badgeId": "1042",
      "name": "Ada Hacker",
      "email": "ada@example.com",
      "publicKey": "",
      "pairingCode": "7KQ9DW",
      "createdAt": "2026-08-28T16:00:00.000Z",
      "lastSeenAt": "2026-08-28T16:04:00.000Z"
    },
    "items": ["4", "2"],
    "quest": null
  }
]
```

### `GET /api/health`

```json
{
  "ok": true,
  "chainEnabled": true,
  "cluster": "devnet",
  "payerAddress": "9wFFmG6Q7examplePayerAddress111111111111",
  "maxRewardAtomic": 1000000,
  "badgeCount": 42,
  "solanaBoxId": "solana-booth",
  "solanaFinalBoxId": "solana-booth-final"
}
```

This does not perform an RPC health check. It reports configured chain-client
mode and the current local badge count.

## SSE event catalogue

### `state`

The authoritative badge snapshot. It is the first stream event, is published
after every box tap, and follows every quest result.

```json
{
  "type": "state",
  "view": {
    "badge": {},
    "awards": [],
    "quest": null,
    "env": {}
  }
}
```

The abbreviated objects have the full shapes documented under
`GET /api/badge/:pairingCode`.

### `quest-progress`

Sent before and after each pipeline step. `status` is `running`, `ok`, or
`fail`. A challenge success includes the formatted amount and payee in
`detail`; failures include their error detail.

```json
{
  "type": "quest-progress",
  "badgeId": "1042",
  "step": "challenge",
  "status": "ok",
  "detail": "1.00 HTN to 11111111111111111111111111111111"
}
```

### `quest-result`

Sent after the database row reaches `completed` or `failed`, immediately before
the refreshed `state` event. `submission` has the full submit-response shape.

```json
{
  "type": "quest-result",
  "submission": {
    "badgeId": "1042",
    "status": "completed",
    "step": null,
    "error": null
  }
}
```

### `ping`

Heartbeat sent every 25 seconds:

```json
{ "type": "ping" }
```

## Development-only endpoints

These routes exist only when `NODE_ENV !== production`.

### `POST /api/dev/reset`

Deletes all local quest, award, and badge rows and clears live-event listeners.

```json
{ "ok": true, "reset": true }
```

### `GET /api/dev/vendor`

This mock lets the disabled client exercise the full local flow. Without
`X-PAYMENT`, it returns HTTP 402 with one `exact` requirement whose network,
amount, and asset come from server configuration. `resource` is the full
request URL.

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "amount": "1000000",
      "asset": "3W7U7Dh81RdKBmwmF2nR3tz5YoaPFFUyBY1bz2u5tE1Q",
      "payTo": "11111111111111111111111111111111",
      "resource": "http://localhost:3000/api/dev/vendor",
      "description": "HTN mock vendor",
      "maxTimeoutSeconds": 300
    }
  ]
}
```

With any `X-PAYMENT` header, it returns HTTP 200:

```json
{
  "message": "hello from the mock vendor",
  "programId": "11111111111111111111111111111111"
}
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | Production disables `/api/dev/*`. |
| `PORT` | `3000` | HTTP listen port. |
| `DATABASE_PATH` | `./data/htn.db` | SQLite path; `:memory:` is supported. |
| `PWA_ORIGIN` | `http://localhost:5173` | Allowed browser origin. |
| `PUBLIC_APP_URL` | `http://localhost:5173` | Base used in badge pairing links. |
| `SOLANA_BOX_ID` | `solana-booth` | `box` id that hands out item `"8"`. |
| `SOLANA_FINAL_BOX_ID` | `solana-booth-final` | Quest-gated `box` id that hands out item `"9"`. |
| `SOLANA_CLUSTER` | `devnet` | Must be `devnet` or `mainnet`. |
| `SOLANA_RPC_URL` | cluster public RPC | Optional RPC override passed to the chain client. |
| `X402_PAYER_SECRET_KEY` | unset | Enables live validation/payment when present. |
| `MAX_REWARD_USD` | `1` | Payment ceiling in whole tokens, converted to six-decimal atomic units and clamped to at least one; `1` is 1.00 HTN on devnet and $1 USDC on mainnet. |
| `PAYMENT_MINT` | cluster payment mint | Optional override for the only accepted payment asset; devnet defaults to HTN Bucks and mainnet to USDC. |
| `PAYMENT_SYMBOL` | cluster payment symbol | Optional display symbol override; devnet defaults to `HTN` and mainnet to `USDC`. |

Changing the configured maximum does not make an already-paid badge eligible
again. The database payment flag remains authoritative.
