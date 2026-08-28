# HTTP API

The server pairs hardware badges with browser sessions, verifies one quest
submission per badge, and pays a valid x402 endpoint at most once. JSON fields
use camelCase. Timestamps are ISO 8601 strings.

The examples below assume the server is available at `http://localhost:3000`.

## Authentication

There are two credentials with separate jobs:

- The station key is the hardware credential. Send it as
  `X-Station-Key: <STATION_API_KEY>` to `/api/station/*`. It authenticates a
  beacon, not a hacker.
- The pairing code is the quest-submission credential. It is embedded in the
  pairing URL and sent in `POST /api/quest/submit`. A code can submit only while
  its session is active.

Read-only session and dashboard endpoints are unauthenticated. Development
endpoints are also unauthenticated, but they are not mounted in production.

Errors use this shape:

```json
{
  "error": "session_not_found",
  "detail": "no session for that pairing code"
}
```

Malformed JSON returns `400 invalid_json`. JSON that does not match the shared
schema returns `400 invalid_request`. Unknown routes return `404 not_found`.

## Station endpoints

### `POST /api/station/sync`

Requires `X-Station-Key`. A beacon calls this repeatedly while a badge is in
range. Repeated calls for the same badge and station keep the same pairing
code. A sync at a different station ends the badge's old active session and
creates a new one.

Request:

```http
POST /api/station/sync
Content-Type: application/json
X-Station-Key: dev-station-key

{
  "stationId": "north-hall",
  "stationName": "North Hall",
  "badge": {
    "badgeId": "badge-1042",
    "name": "Ada Hacker",
    "email": "ada@example.com"
  },
  "rssi": -48
}
```

`stationName` and `rssi` are optional. Response:

```json
{
  "pairingCode": "7KQ9DW",
  "url": "http://localhost:5173/s/7KQ9DW",
  "badgeId": "badge-1042",
  "questStatus": null
}
```

`questStatus` is `null`, `verifying`, `completed`, or `failed`. Sync performs no
chain operation and does not start verification.

Errors:

- `401 unauthorized`: missing or incorrect station key.
- `400 invalid_json` or `400 invalid_request`: malformed request.

### `POST /api/station/disconnect`

Requires `X-Station-Key`. It ends the active session only when the submitted
station is the station currently paired with that badge.

```http
POST /api/station/disconnect
Content-Type: application/json
X-Station-Key: dev-station-key

{
  "stationId": "north-hall",
  "badgeId": "badge-1042"
}
```

Matching session:

```json
{
  "ended": true,
  "pairingCode": "7KQ9DW"
}
```

No matching active session:

```json
{
  "ended": false,
  "pairingCode": null
}
```

## Session endpoints

### `GET /api/session/:pairingCode`

Returns the full browser view. Ended sessions remain readable so the client can
show that the badge walked away.

```json
{
  "session": {
    "pairingCode": "7KQ9DW",
    "badgeId": "badge-1042",
    "stationId": "north-hall",
    "startedAt": "2026-08-28T16:00:00.000Z",
    "endedAt": null,
    "active": true
  },
  "badge": {
    "badgeId": "badge-1042",
    "name": "Ada Hacker",
    "email": "ada@example.com",
    "createdAt": "2026-08-28T16:00:00.000Z"
  },
  "station": {
    "stationId": "north-hall",
    "name": "North Hall",
    "lastSeenAt": "2026-08-28T16:00:04.000Z"
  },
  "quest": null,
  "env": {
    "chainEnabled": true,
    "cluster": "devnet",
    "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "usdcMint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "maxRewardAtomic": 1000000,
    "payerAddress": "9wFFmG6Q7examplePayerAddress111111111111"
  }
}
```

`chainEnabled` is false and `payerAddress` is null when no payer key is
configured. In that mode the chain client can simulate payment for the local
mock endpoint.

Errors:

- `404 session_not_found`: unknown pairing code.
- `404 session_incomplete`: a referenced badge or station row is missing.

### `GET /api/session/:pairingCode/stream`

Opens a Server-Sent Events stream with content type `text/event-stream`. The
first event is the current `state` when the session is complete enough to build
a view. The server sends `ping` every 25 seconds. Reconnect by opening a new
stream; events are not replayed because the initial state is authoritative.

Every frame uses the standard SSE data form:

```text
data: {"type":"ping"}

```

The endpoint returns `404 session_not_found` for an unknown code.

## Quest endpoint

### `POST /api/quest/submit`

The pairing code is the credential. The referenced session must exist and
still be active. The server persists the submission and returns `202` before
verification finishes; watch the session stream or fetch the session again for
the result.

```http
POST /api/quest/submit
Content-Type: application/json

{
  "pairingCode": "7KQ9DW",
  "endpointUrl": "https://hacker.example/quest",
  "programId": "11111111111111111111111111111111"
}
```

Response:

```json
{
  "submission": {
    "badgeId": "badge-1042",
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

- `404 session_not_found`: no session has that pairing code.
- `409 session_ended`: the code belongs to an ended session.
- `409 quest_verifying`: verification is already running for the badge.
- `409 quest_already_completed`: the badge already completed the quest.
- `409 quest_already_paid`: an earlier failed run moved money and cannot be
  replaced.

An unpaid failed submission may be replaced. Replacement clears its prior
endpoint, program, progress, message, error, and payment metadata before the new
run begins.

### Verification pipeline

The steps always run in this order:

1. `program`: confirm the submitted program is deployed and executable.
2. `state`: read the message from its quest PDA.
3. `challenge`: probe the endpoint and validate its x402 terms, cluster, USDC
   mint, and amount ceiling.
4. `payment`: pay the endpoint once, or simulate the request when the chain
   client is disabled.
5. `proof`: validate the paid JSON response and compare its `message` with the
   message read from chain.

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

## Dashboard and monitoring

### `GET /api/badges`

Returns one summary per badge:

```json
[
  {
    "badge": {
      "badgeId": "badge-1042",
      "name": "Ada Hacker",
      "email": "ada@example.com",
      "createdAt": "2026-08-28T16:00:00.000Z"
    },
    "activeSession": {
      "pairingCode": "7KQ9DW",
      "badgeId": "badge-1042",
      "stationId": "north-hall",
      "startedAt": "2026-08-28T16:00:00.000Z",
      "endedAt": null,
      "active": true
    },
    "quest": null
  }
]
```

`activeSession` and `quest` may each be null.

### `GET /api/badges/:badgeId`

Returns the badge, all of its sessions newest first, and its current quest:

```json
{
  "badge": {
    "badgeId": "badge-1042",
    "name": "Ada Hacker",
    "email": "ada@example.com",
    "createdAt": "2026-08-28T16:00:00.000Z"
  },
  "sessions": [
    {
      "pairingCode": "7KQ9DW",
      "badgeId": "badge-1042",
      "stationId": "north-hall",
      "startedAt": "2026-08-28T16:00:00.000Z",
      "endedAt": null,
      "active": true
    }
  ],
  "quest": null
}
```

An unknown id returns `404 badge_not_found`.

### `GET /api/stations`

```json
[
  {
    "stationId": "north-hall",
    "name": "North Hall",
    "lastSeenAt": "2026-08-28T16:00:04.000Z"
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
  "badgeCount": 42
}
```

This endpoint does not perform an RPC health check. It reports the configured
chain-client mode and current local badge count.

## SSE event catalogue

### `state`

The authoritative session snapshot. It is sent when a stream opens, after a
sync or disconnect changes session state, and after a quest result.

```json
{
  "type": "state",
  "view": {
    "session": {},
    "badge": {},
    "station": {},
    "quest": null,
    "env": {}
  }
}
```

The abbreviated objects above have the full shapes documented under
`GET /api/session/:pairingCode`.

### `quest-progress`

Sent before and after each pipeline step. `status` is `running`, `ok`, or
`fail`. A challenge success includes the formatted amount and payee in
`detail`; failures include their error detail.

```json
{
  "type": "quest-progress",
  "badgeId": "badge-1042",
  "step": "challenge",
  "status": "ok",
  "detail": "$1.00 to 11111111111111111111111111111111"
}
```

### `quest-result`

Sent after the database row reaches `completed` or `failed`, immediately before
the refreshed `state` event.

```json
{
  "type": "quest-result",
  "submission": {
    "badgeId": "badge-1042",
    "status": "completed",
    "step": null,
    "error": null
  }
}
```

The `submission` object includes every field shown in the submit response.

### `disconnected`

Sent when a station reports the badge gone or a new station supersedes the old
session.

```json
{
  "type": "disconnected",
  "at": "2026-08-28T16:10:00.000Z"
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

Deletes all local quest, session, badge, and station rows and clears live-event
listeners.

```json
{ "ok": true, "reset": true }
```

### `POST /api/dev/sync` and `POST /api/dev/disconnect`

Unauthenticated passthroughs to the station endpoints. Their request and
response shapes are identical to `/api/station/sync` and
`/api/station/disconnect`.

### `GET /api/dev/vendor`

This mock lets the disabled client exercise the full local flow.

Without `X-PAYMENT`, it returns HTTP 402:

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "amount": "1000000",
      "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "payTo": "11111111111111111111111111111111",
      "resource": "http://localhost:3000/api/dev/vendor",
      "description": "HTN mock vendor",
      "maxTimeoutSeconds": 300
    }
  ]
}
```

`network`, `amount`, and `asset` come from the running server configuration;
`resource` is the full request URL.

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
| `STATION_API_KEY` | `dev-station-key` | Hardware credential. |
| `PWA_ORIGIN` | `http://localhost:5173` | Allowed browser origin. |
| `PUBLIC_APP_URL` | `http://localhost:5173` | Base used in sync pairing URLs. |
| `SOLANA_CLUSTER` | `devnet` | Must be `devnet` or `mainnet`. |
| `SOLANA_RPC_URL` | cluster public RPC | Optional RPC override passed to the chain client. |
| `X402_PAYER_SECRET_KEY` | unset | Enables live validation/payment when present. |
| `MAX_REWARD_USD` | `1` | Payment ceiling; converted to six-decimal USDC base units and clamped to at least one unit. |
| `USDC_MINT` | cluster canonical USDC | The only accepted payment asset. |

Changing the configured maximum does not make an already-paid badge eligible
again. The database payment flag remains authoritative.
