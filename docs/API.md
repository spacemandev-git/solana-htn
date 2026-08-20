# HTTP API

The badge Sync Station API for the Hack the North x Solana activation
(`apps/server`). Bun + Hono, SQLite via `bun:sqlite`, SSE for live session
pushes, and an optional Solana `badge_escrow` chain client.

It serves three consumers:

- **Sync Stations** — ESP32 hubs that POST when a badge announces itself over ESP-NOW.
- **The PWA** — the hacker's phone page, opened from a pairing code, kept current over SSE.
- **The operator dashboard / simulator** — read-only aggregates plus dev-only helpers.

Base URL: `http://localhost:{PORT}`, default `http://localhost:3000` (`apps/server/src/index.ts`,
`PORT` from `config.ts`). Every route is under `/api`. All request and response
bodies are JSON.

CORS is applied to every route with a single allowed origin (`PWA_ORIGIN`),
`credentials: true`, allowed headers `content-type` and `x-station-key`, allowed
methods `GET`, `POST`, `OPTIONS`.

Bun's server runs with `idleTimeout: 0` so SSE connections are not cut by the
runtime; the 25s heartbeat is the liveness check.

## Errors

Every non-2xx response is the `ApiError` shape from `@htn/shared`:

```json
{ "error": "session_not_found", "detail": "no session for that pairing code" }
```

`detail` is omitted when the thrower did not supply one. Unmatched routes return
`404 not_found` with `detail` set to the request path. Any uncaught exception
becomes `500 internal_error` with `detail: "unexpected server error"`.

Because bodies go through `parseJson` (`http.ts`), every POST endpoint can also
return:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | Body is not parseable JSON |
| 400 | `invalid_request` | Body failed its zod schema; `detail` is `path: message; path: message` |

## Authentication

There is exactly one authenticated surface: `/api/station/*`.

`app.use('/api/station/*', stationAuth(config.stationApiKey))` requires the
`x-station-key` header (`API_KEY_HEADER` in `packages/shared/src/api.ts`).
Comparison is in `auth.ts`: both the provided and expected keys are SHA-256
hashed, then compared with `node:crypto` `timingSafeEqual` over the resulting
32-byte digests. Hashing first means the comparison is always over equal lengths,
so neither a length mismatch (which would throw) nor the real key's length leaks.

A missing or non-matching header returns `401 unauthorized` with
`detail: "missing or invalid x-station-key header"`. There is no other auth: no
sessions, cookies, or bearer tokens.

| Surface | Auth |
| --- | --- |
| `/api/station/*` | `x-station-key` required |
| `/api/session/*` | Public — knowing the 6-character pairing code is the only credential |
| `/api/vault/*` | Public. `/claim` and `/withdraw` additionally require an ed25519 wallet signature; `/withdraw` also requires the signer to be the wallet that claimed the vault. The `-tx` endpoints need no signature because an unsigned transaction grants nothing. |
| `/api/badges`, `/api/stations`, `/api/health` | Public, read-only |
| `/api/dev/*` | No auth at all, and only mounted when `NODE_ENV !== 'production'` |

Dev gating: `config.devRoutesEnabled = !isProduction`, and `app.ts` only calls
`app.route('/api/dev', devRoutes(ctx))` when that flag is true. In production the
dev routes do not exist and fall through to `404 not_found`. `devRoutes` mounts
`stationRoutes` at its own root, so `/api/dev/sync` and `/api/dev/disconnect` are
byte-for-byte the same handlers as the station endpoints, minus the API key.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/station/sync` | `x-station-key` | A station saw a badge: upsert badge/station/vault, start or refresh the session, grant an item on a first visit |
| POST | `/api/station/disconnect` | `x-station-key` | Badge left ESP-NOW range: end the session at that station |
| GET | `/api/session/:pairingCode` | Public | Full `SessionView` for a pairing code (ended sessions included) |
| GET | `/api/session/:pairingCode/stream` | Public | SSE stream of `LiveEvent`s for that pairing code |
| POST | `/api/vault/claim` | Public + signature | Bind a wallet to the badge's vault |
| POST | `/api/vault/claim-tx` | Public | Build the unsigned `claim_vault` transaction |
| POST | `/api/vault/withdraw-tx` | Public | Build the unsigned `withdraw_item` transaction |
| POST | `/api/vault/withdraw` | Wallet signature | Record one item as withdrawn from escrow |
| GET | `/api/badges` | Public | `BadgeSummary[]` for the dashboard |
| GET | `/api/badges/:badgeId` | Public | One badge with items, visits, vault and sessions |
| GET | `/api/stations` | Public | `Station[]`, ordered by station id |
| GET | `/api/health` | Public | Liveness plus chain status and badge count |
| POST | `/api/dev/reset` | Dev only | Wipe every table and clear all SSE channels |
| POST | `/api/dev/sync` | Dev only | Same as `/api/station/sync`, unauthenticated |
| POST | `/api/dev/disconnect` | Dev only | Same as `/api/station/disconnect`, unauthenticated |

---

### POST /api/station/sync

Called by a Sync Station every few seconds while a badge is in range. Idempotent:
the badge and station upserts are conditional, the vault insert is
`ON CONFLICT DO NOTHING`, the visit insert is guarded by
`UNIQUE(badge_id, station_id)`, and an already-active session at the same station
keeps its pairing code.

Order of work in `services/sync.ts#handleSync`: upsert badge (assigning the
deterministic animal on first sight) → upsert station → ensure vault → start or
refresh session → publish `disconnected` to any superseded session → record the
visit (granting an item only on the first ever visit to that station) → publish
`item` if granted → publish `state`.

Request body — `SyncRequest` (`packages/shared/src/api.ts`):

| Field | Type | Constraints |
| --- | --- | --- |
| `stationId` | string | required, 1–64 chars, `^[a-zA-Z0-9._-]+$` |
| `stationName` | string | optional, 1–120 chars; overwrites the stored name when present |
| `badge.badgeId` | string | required, 1–64 chars, `^[a-zA-Z0-9._-]+$` |
| `badge.name` | string | required, 1–120 chars |
| `badge.email` | string | required, valid email, max 254 chars |
| `rssi` | number | optional integer, −127 to 0, informational only (stored on the visit row) |

```bash
curl -X POST http://localhost:3000/api/station/sync \
  -H 'content-type: application/json' \
  -H 'x-station-key: dev-station-key' \
  -d '{
    "stationId": "station-atrium",
    "stationName": "Atrium Sync Station",
    "badge": {
      "badgeId": "badge-0042",
      "name": "Ada Lovelace",
      "email": "ada@example.com"
    },
    "rssi": -58
  }'
```

Response `200` — `SyncResponse`:

```json
{
  "pairingCode": "K7M2QX",
  "url": "http://localhost:5173/s/K7M2QX",
  "badgeId": "badge-0042",
  "animal": "otter",
  "granted": [
    { "name": "Immutable Hoodie", "slot": "torso", "rarity": "uncommon" }
  ],
  "itemCount": 1
}
```

`granted` holds at most one item and is `[]` on a repeat sync to a station the
badge has already visited. `url` is `PUBLIC_APP_URL` + `/s/` + the pairing code
(`pairingUrl` in `config.ts`).

| Status | `error` |
| --- | --- |
| 400 | `invalid_json`, `invalid_request` |
| 401 | `unauthorized` |
| 500 | `internal_error` |

---

### POST /api/station/disconnect

The badge dropped out of range. Ends the badge's active session **only if** the
reporting station is the one it is currently paired to
(`endSessionAtStation`); a disconnect from a stale station is a no-op. On a real
end the server publishes `disconnected` and then `state` to that pairing code.

Request body — `DisconnectRequest`:

| Field | Type | Constraints |
| --- | --- | --- |
| `stationId` | string | required, 1–64 chars, `^[a-zA-Z0-9._-]+$` |
| `badgeId` | string | required, 1–64 chars, `^[a-zA-Z0-9._-]+$` |

```bash
curl -X POST http://localhost:3000/api/station/disconnect \
  -H 'content-type: application/json' \
  -H 'x-station-key: dev-station-key' \
  -d '{ "stationId": "station-atrium", "badgeId": "badge-0042" }'
```

Response `200` (inline shape, not a shared type):

```json
{ "ended": true, "pairingCode": "K7M2QX" }
```

When nothing was ended: `{ "ended": false, "pairingCode": null }` — still `200`.

| Status | `error` |
| --- | --- |
| 400 | `invalid_json`, `invalid_request` |
| 401 | `unauthorized` |
| 500 | `internal_error` |

---

### GET /api/session/:pairingCode

The PWA's primary read. Ended sessions are still served so the page can render
"you walked away".

```bash
curl http://localhost:3000/api/session/K7M2QX
```

Response `200` — `SessionView` (`packages/shared/src/types.ts`), assembled by
`buildSessionView`:

```json
{
  "session": {
    "pairingCode": "K7M2QX",
    "badgeId": "badge-0042",
    "stationId": "station-atrium",
    "startedAt": "2026-08-18T14:02:11.418Z",
    "endedAt": null,
    "active": true
  },
  "badge": {
    "badgeId": "badge-0042",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "animal": "otter",
    "createdAt": "2026-08-18T14:02:11.418Z"
  },
  "station": {
    "stationId": "station-atrium",
    "name": "Atrium Sync Station",
    "blurb": "A warm hub of cables and questionable coffee.",
    "lastSeenAt": "2026-08-18T14:02:11.418Z"
  },
  "animal": {
    "id": "otter",
    "name": "Otter",
    "emoji": "🦦",
    "blurb": "Floats through demos holding hands."
  },
  "items": [
    {
      "id": 1,
      "badgeId": "badge-0042",
      "stationId": "station-atrium",
      "itemKey": "immutable-hoodie",
      "name": "Immutable Hoodie",
      "slot": "torso",
      "rarity": "uncommon",
      "code": 655635,
      "mintedAt": "2026-08-18T14:02:11.418Z",
      "assetAddress": null,
      "signature": null,
      "withdrawn": false
    }
  ],
  "newItemIds": [1],
  "vault": {
    "badgeId": "badge-0042",
    "vaultAddress": null,
    "ownerWallet": null,
    "claimedAt": null
  }
}
```

`items` is every item the badge owns, ordered by `item_index`. `newItemIds` are
only the items whose `granted_session` equals this pairing code, so the PWA can
play the unlock animation once. `assetAddress` / `signature` stay `null` until a
chain write lands — with the disabled chain client they stay null forever.

| Status | `error` | When |
| --- | --- | --- |
| 404 | `session_not_found` | No session row for that pairing code |
| 404 | `session_incomplete` | The session exists but its badge, station, or vault row is missing |

---

### GET /api/session/:pairingCode/stream

Server-sent events for one pairing code. See [SSE stream](#sse-stream) below.

| Status | `error` |
| --- | --- |
| 404 | `session_not_found` (JSON, before the stream opens) |

---

### POST /api/vault/claim

Binds a wallet to the badge's vault after verifying an ed25519 signature over the
exact message from `claimMessage(pairingCode, wallet)`:

```
Hack the North x Solana
Claim badge vault
pairing: K7M2QX
wallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

Any known session — including an ended one — identifies the badge, so a hacker
can still claim after walking away. Signature verification (`verifyWalletSignature`
in `services/vaults.ts`) base58-decodes the wallet and signature, requires 32 and
64 bytes respectively, and treats every malformed input as a failed verification
rather than an error. Re-claiming with the same wallet is allowed and simply
refreshes `claimed_at`.

On success it publishes `vault-claimed` and then `state` to the pairing code.

Request body — `ClaimRequest`:

| Field | Type | Constraints |
| --- | --- | --- |
| `pairingCode` | string | required, 1–32 chars |
| `wallet` | string | required, 32–44 chars (base58 pubkey) |
| `signature` | string | required, min 1 char; base58 ed25519 signature over `claimMessage(pairingCode, wallet)` |

```bash
curl -X POST http://localhost:3000/api/vault/claim \
  -H 'content-type: application/json' \
  -d '{
    "pairingCode": "K7M2QX",
    "wallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "signature": "3yZe7d3s1qkS2u9M9EbdcTvW7c8s3s1qkS2u9M9EbdcTvW7c8s3s1qkS2u9M9Ebdc7Vm1c9L3wYqKrFj2N8sPqR4"
  }'
```

Response `200` — `{ vault: Vault }`:

```json
{
  "vault": {
    "badgeId": "badge-0042",
    "vaultAddress": null,
    "ownerWallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "claimedAt": "2026-08-18T14:11:03.902Z"
  }
}
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_request` | Bad body |
| 404 | `session_not_found` | Unknown pairing code |
| 404 | `vault_not_found` | Badge has no vault row |
| 401 | `bad_signature` | Signature does not verify against the wallet |
| 409 | `vault_already_claimed` | A different wallet already owns the vault (checked *after* the signature, so ownership cannot be probed unauthenticated) |
| 500 | `internal_error` | Chain client threw |

---

### POST /api/vault/claim-tx

Builds the unsigned `claim_vault` transaction for the hacker's wallet to sign in
the browser. Deliberately unauthenticated beyond knowing the pairing code: the
result is unsigned and useless without the wallet's own signature, and the
program rejects a second claim anyway. Note that unlike `/claim`, this does not
require or check a signature and does not mutate the database.

Request body — `ClaimTxRequest`:

| Field | Type | Constraints |
| --- | --- | --- |
| `pairingCode` | string | required, 1–32 chars |
| `wallet` | string | required, 32–44 chars |

```bash
curl -X POST http://localhost:3000/api/vault/claim-tx \
  -H 'content-type: application/json' \
  -d '{
    "pairingCode": "K7M2QX",
    "wallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  }'
```

Response `200` — `BuildTxResponse`:

```json
{ "transaction": "AQAAAAAAAAAAAAAA...base64...", "chainEnabled": true }
```

With the disabled chain client (no `SOLANA_RPC_URL` / `SOLANA_AUTHORITY_SECRET_KEY`)
the response is `{ "transaction": null, "chainEnabled": false }`.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_request` | Bad body |
| 404 | `session_not_found` | Unknown pairing code |
| 404 | `vault_not_found` | Badge has no vault row |
| 409 | `vault_already_claimed` | A different wallet already owns the vault |
| 500 | `internal_error` | Chain client threw |

---

### POST /api/vault/withdraw-tx

Builds the unsigned `withdraw_item` transaction. Requires the vault to already be
claimed by the requesting wallet. The item's on-chain index (`items.item_index`,
which the API shape hides) is resolved server-side.

Request body — `WithdrawTxRequest`:

| Field | Type | Constraints |
| --- | --- | --- |
| `pairingCode` | string | required, 1–32 chars |
| `itemId` | number | required, non-negative integer (the `Item.id`, not the on-chain index) |
| `wallet` | string | required, 32–44 chars |

```bash
curl -X POST http://localhost:3000/api/vault/withdraw-tx \
  -H 'content-type: application/json' \
  -d '{
    "pairingCode": "K7M2QX",
    "itemId": 1,
    "wallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  }'
```

Response `200` — `BuildTxResponse`:

```json
{ "transaction": "AQAAAAAAAAAAAAAA...base64...", "chainEnabled": true }
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_request` | Bad body |
| 404 | `session_not_found` | Unknown pairing code |
| 403 | `vault_not_claimed` | Vault missing or `ownerWallet` is null |
| 403 | `not_vault_owner` | Vault is owned by a different wallet |
| 404 | `item_not_found` | No such item id, the item belongs to another badge, or it has no stored index |
| 409 | `item_already_withdrawn` | The item has already left escrow |
| 500 | `internal_error` | Chain client threw |

---

### POST /api/vault/withdraw

Records one item as withdrawn from escrow: calls `chain.withdrawItem`, sets
`withdrawn = 1`, stores the signature if one came back, then publishes `state`.
Note this is a server-side bookkeeping write, not the signed on-chain withdrawal
itself — with the disabled chain client it flips the flag with no chain effect.

Requires the **same wallet proof as claiming**, and the wallet must be the one
that claimed the vault. The pairing code alone is not a credential worth moving
assets on: it is short and readable off a badge screen by anyone standing nearby.

Request body — `WithdrawRequest`:

| Field | Type | Constraints |
| --- | --- | --- |
| `pairingCode` | string | required, 1–32 chars |
| `itemId` | number | required, non-negative integer |
| `wallet` | string | required, 32–44 chars (base58 pubkey) |
| `signature` | string | required; base58 ed25519 signature over `withdrawMessage(pairingCode, itemId, wallet)` |

`withdrawMessage()` lives in `packages/shared/src/api.ts` so the server and PWA
can never disagree about the signed bytes:

```
Hack the North x Solana
Withdraw item from escrow
pairing: K7M2QX
item: 1
wallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

```bash
curl -X POST http://localhost:3000/api/vault/withdraw \
  -H 'content-type: application/json' \
  -d '{
        "pairingCode": "K7M2QX",
        "itemId": 1,
        "wallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        "signature": "5VeQ...88charsOfBase58...xR2p"
      }'
```

Response `200` — `{ item: Item, wallet: string }`:

```json
{
  "item": {
    "id": 1,
    "badgeId": "badge-0042",
    "stationId": "station-atrium",
    "itemKey": "immutable-hoodie",
    "name": "Immutable Hoodie",
    "slot": "torso",
    "rarity": "uncommon",
    "code": 655635,
    "mintedAt": "2026-08-18T14:02:11.418Z",
    "assetAddress": null,
    "signature": null,
    "withdrawn": true
  },
  "wallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
}
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_request` | Bad body |
| 404 | `session_not_found` | Unknown pairing code |
| 403 | `vault_not_claimed` | Vault missing or unclaimed |
| 401 | `bad_signature` | Signature does not verify against the wallet |
| 403 | `not_vault_owner` | The signing wallet is not the one that claimed the vault |
| 404 | `item_not_found` | No such item id, or the item belongs to another badge |
| 409 | `item_already_withdrawn` | `withdrawn` is already true |
| 500 | `internal_error` | Chain client threw |

---

### GET /api/badges

```bash
curl http://localhost:3000/api/badges
```

Response `200` — `BadgeSummary[]`, one row per badge ordered by `created_at`, then
`badge_id`:

```json
[
  {
    "badge": {
      "badgeId": "badge-0042",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "animal": "otter",
      "createdAt": "2026-08-18T14:02:11.418Z"
    },
    "itemCount": 2,
    "stationsVisited": 2,
    "activeSession": {
      "pairingCode": "K7M2QX",
      "badgeId": "badge-0042",
      "stationId": "station-atrium",
      "startedAt": "2026-08-18T14:02:11.418Z",
      "endedAt": null,
      "active": true
    },
    "vault": {
      "badgeId": "badge-0042",
      "vaultAddress": null,
      "ownerWallet": null,
      "claimedAt": null
    }
  }
]
```

`activeSession` is `null` when the badge is not currently paired. `vault` falls
back to an all-null `Vault` object if the row is missing, so it is never null here.

No error statuses beyond `500 internal_error`.

---

### GET /api/badges/:badgeId

```bash
curl http://localhost:3000/api/badges/badge-0042
```

Response `200` — an inline shape (no shared type):

```json
{
  "badge": {
    "badgeId": "badge-0042",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "animal": "otter",
    "createdAt": "2026-08-18T14:02:11.418Z"
  },
  "animal": {
    "id": "otter",
    "name": "Otter",
    "emoji": "🦦",
    "blurb": "Floats through demos holding hands."
  },
  "items": [
    {
      "id": 1,
      "badgeId": "badge-0042",
      "stationId": "station-atrium",
      "itemKey": "immutable-hoodie",
      "name": "Immutable Hoodie",
      "slot": "torso",
      "rarity": "uncommon",
      "code": 655635,
      "mintedAt": "2026-08-18T14:02:11.418Z",
      "assetAddress": null,
      "signature": null,
      "withdrawn": false
    }
  ],
  "visits": [
    {
      "badgeId": "badge-0042",
      "stationId": "station-atrium",
      "stationName": "Atrium Sync Station",
      "firstSeenAt": "2026-08-18T14:02:11.418Z",
      "lastSeenAt": "2026-08-18T14:09:44.001Z",
      "visitCount": 7,
      "lastRssi": -58
    }
  ],
  "vault": {
    "badgeId": "badge-0042",
    "vaultAddress": null,
    "ownerWallet": null,
    "claimedAt": null
  },
  "sessions": [
    {
      "pairingCode": "K7M2QX",
      "badgeId": "badge-0042",
      "stationId": "station-atrium",
      "startedAt": "2026-08-18T14:02:11.418Z",
      "endedAt": null,
      "active": true
    }
  ]
}
```

`items` is ordered by `item_index`, `visits` by `first_seen_at` then `id`,
`sessions` by `started_at` descending. `vault` falls back to an all-null `Vault`
when the row does not exist yet, matching `/api/badges` (`emptyVault()` in
`services/vaults.ts` is the single source of that shape). `visits[].stationName`
is `null` if the station row was deleted.

| Status | `error` | When |
| --- | --- | --- |
| 404 | `badge_not_found` | No badge with that id |

---

### GET /api/stations

```bash
curl http://localhost:3000/api/stations
```

Response `200` — `Station[]`, ordered by `station_id`:

```json
[
  {
    "stationId": "station-atrium",
    "name": "Atrium Sync Station",
    "blurb": "A warm hub of cables and questionable coffee.",
    "lastSeenAt": "2026-08-18T14:09:44.001Z"
  }
]
```

Stations are created implicitly on their first sync. `blurb` is derived
deterministically from the station id; `name` defaults to a title-cased form of
the id when the station POSTs without `stationName`.

No error statuses beyond `500 internal_error`.

---

### GET /api/health

```bash
curl http://localhost:3000/api/health
```

Response `200` — inline shape:

```json
{
  "ok": true,
  "chainEnabled": false,
  "programId": "BadgeEscrow11111111111111111111111111111111",
  "badgeCount": 12
}
```

`chainEnabled` is false whenever the disabled chain client is in use (i.e.
`SOLANA_RPC_URL` or `SOLANA_AUTHORITY_SECRET_KEY` is unset). Always `200`.

---

### POST /api/dev/reset

Dev only (`NODE_ENV !== 'production'`). Deletes every row from `items`, `visits`,
`sessions`, `vaults`, `badges`, `stations` in that order inside a transaction,
resets the `items` / `visits` autoincrement counters, and clears every SSE
channel in the `LiveHub`. Takes no body.

```bash
curl -X POST http://localhost:3000/api/dev/reset
```

Response `200`:

```json
{ "ok": true, "reset": true }
```

In production this path is not mounted and returns
`404 { "error": "not_found", "detail": "/api/dev/reset" }`.

---

### POST /api/dev/sync and POST /api/dev/disconnect

Dev only. Identical handlers, bodies, responses and errors to
`/api/station/sync` and `/api/station/disconnect`, with no `x-station-key`
requirement (so no `401 unauthorized`). They exist so the browser simulator can
drive the whole flow.

```bash
curl -X POST http://localhost:3000/api/dev/sync \
  -H 'content-type: application/json' \
  -d '{
    "stationId": "station-solana-lounge",
    "badge": { "badgeId": "badge-0042", "name": "Ada Lovelace", "email": "ada@example.com" }
  }'
```

## SSE stream

`GET /api/session/:pairingCode/stream`

Response headers:

```
content-type: text/event-stream; charset=utf-8
cache-control: no-cache, no-transform
connection: keep-alive
x-accel-buffering: no
```

**Frame format.** Every frame is an unnamed data-only event — the server never
sets an SSE `event:` name, an `id:`, or a `retry:`:

```
data: {"type":"state","view":{...}}\n\n
```

The payload is `JSON.stringify(event)` of a `LiveEvent` from
`packages/shared/src/types.ts`. Consumers therefore switch on the `type` field of
the parsed JSON, not on the SSE event name.

On connect the server immediately sends one `state` frame (skipped if
`buildSessionView` returns null, e.g. the badge/station/vault row is missing),
then a `ping` every **25 000 ms** (`HEARTBEAT_MS` in `routes/session.ts`). The
stream is torn down on request abort or stream cancel; the heartbeat interval is
cleared and the listener unsubscribed.

Delivery is in-process and non-durable (`live.ts`): one channel per pairing code,
a `Set` of listeners so multiple tabs work, and nothing is buffered or replayed.
A reconnecting client gets a fresh `state` frame instead.

| `type` | Payload | Emitted when |
| --- | --- | --- |
| `state` | `view: SessionView` | On connect, and after every sync, disconnect, vault claim, and withdraw (`publishState`) |
| `item` | `item: Item` | A sync granted a new item to this session |
| `disconnected` | `at: string` (ISO timestamp) | The station reported a disconnect, or the badge synced at a **different** station and this session was superseded |
| `vault-claimed` | `wallet: string` | `POST /api/vault/claim` succeeded (sent just before the follow-up `state`) |
| `ping` | — | Every 25 s heartbeat |

Consuming it:

```js
const source = new EventSource(`http://localhost:3000/api/session/${pairingCode}/stream`);

source.onmessage = (message) => {
  const event = JSON.parse(message.data);
  switch (event.type) {
    case 'state':
      render(event.view);                   // SessionView
      break;
    case 'item':
      playUnlock(event.item);               // Item
      break;
    case 'disconnected':
      showWilderness(event.at);
      break;
    case 'vault-claimed':
      showClaimed(event.wallet);
      break;
    case 'ping':
      break;                                // heartbeat, every 25s
  }
};

source.onerror = () => {
  // EventSource reconnects on its own; refetch GET /api/session/:pairingCode if needed.
};
```

## Environment variables

From `apps/server/src/config.ts`. Every value is trimmed, and an empty string is
treated as unset. Every value has a local default, so a fresh clone boots with
`bun run dev` and nothing else.

| Variable | Default | Effect |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` sets `isProduction`, which disables the `/api/dev` routes |
| `PORT` | `3000` | Listen port. Non-numeric, ≤ 0 or ≥ 65536 values fall back to 3000 |
| `DATABASE_PATH` | `./data/htn.db` | SQLite file. Parent directories are created; WAL and `busy_timeout=5000` are set. `:memory:` is honoured verbatim (no mkdir, no WAL) |
| `STATION_API_KEY` | `dev-station-key` | Expected value of the `x-station-key` header. Logs a warning if left at the default in production |
| `PWA_ORIGIN` | `http://localhost:5173` | The single origin allowed through CORS |
| `PUBLIC_APP_URL` | `http://localhost:5173` | Base of the pairing URL returned as `SyncResponse.url` (`{base}/s/{pairingCode}`, trailing slashes stripped) |
| `PROGRAM_ID` | `BadgeEscrow11111111111111111111111111111111` | `badge_escrow` program id, surfaced at `/api/health` |
| `SOLANA_RPC_URL` | unset | RPC endpoint. Without it (or without the authority key) the disabled chain client is used |
| `SOLANA_AUTHORITY_SECRET_KEY` | unset | base58-encoded 64-byte secret key for the server's mint authority |

There is no `DEV_ROUTES` variable: `devRoutesEnabled` is derived as
`NODE_ENV !== 'production'`.

## SQLite schema

`apps/server/src/db/schema.ts`. The whole schema is plain SQL, every statement is
`IF NOT EXISTS`, and it is executed on every boot and in every test — the schema
is the migration. `PRAGMA foreign_keys = ON`. Columns are snake_case in SQLite and
camelCase in the API; `db/index.ts` holds the only mappers.

### `badges`

| Column | Type | Notes |
| --- | --- | --- |
| `badge_id` | TEXT | PRIMARY KEY — the id burned into the ESP32-C3 |
| `name` | TEXT NOT NULL | Updated by later syncs if registration data changes |
| `email` | TEXT NOT NULL | Same |
| `animal` | TEXT NOT NULL | Assigned on first sight from `animalForBadge`, then frozen |
| `created_at` | TEXT NOT NULL | ISO timestamp |

### `stations`

| Column | Type | Notes |
| --- | --- | --- |
| `station_id` | TEXT | PRIMARY KEY |
| `name` | TEXT NOT NULL | Only overwritten when a sync actually sends `stationName` |
| `blurb` | TEXT NOT NULL | Deterministic from the station id |
| `last_seen_at` | TEXT | Refreshed on every sync |

### `sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `pairing_code` | TEXT | PRIMARY KEY — the public 6-character code, alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L) |
| `badge_id` | TEXT NOT NULL | → `badges(badge_id)` ON DELETE CASCADE |
| `station_id` | TEXT NOT NULL | → `stations(station_id)` ON DELETE CASCADE |
| `started_at` | TEXT NOT NULL | |
| `ended_at` | TEXT | Null while active |
| `last_seen_at` | TEXT NOT NULL | Bumped by repeat syncs; not exposed in the `Session` API type |
| `active` | INTEGER NOT NULL DEFAULT 1 | Mapped to `Session.active` as `=== 1` |

Indices:

- `idx_sessions_badge` on `(badge_id, active)`
- `idx_sessions_station` on `(station_id)`
- **`idx_sessions_one_active_per_badge`** — `UNIQUE (badge_id) WHERE active = 1`. A
  badge can only be paired to one station at a time; walking to a new hub ends the
  old session before the new one is inserted.

### `visits`

One row per `(badge, station)` pair, ever. Its absence is what makes a station
"new" and therefore worth an item.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `badge_id` | TEXT NOT NULL | → `badges(badge_id)` ON DELETE CASCADE |
| `station_id` | TEXT NOT NULL | → `stations(station_id)` ON DELETE CASCADE |
| `first_seen_at` | TEXT NOT NULL | |
| `last_seen_at` | TEXT NOT NULL | |
| `visit_count` | INTEGER NOT NULL DEFAULT 1 | Incremented on repeat syncs |
| `last_rssi` | INTEGER | `COALESCE`d, so a sync without `rssi` keeps the old value |

Indices / constraints:

- **`UNIQUE(badge_id, station_id)`** — the idempotency anchor for item grants. The
  insert is `ON CONFLICT(badge_id, station_id) DO NOTHING ... RETURNING id`: if a row
  comes back it was the first visit and an item is granted; if not, it is a repeat
  sync and only the counters move. Safe even if two hubs report simultaneously.
- `idx_visits_badge` on `(badge_id)`, `idx_visits_station` on `(station_id)`

### `items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT — the `itemId` used by the vault endpoints |
| `badge_id` | TEXT NOT NULL | → `badges(badge_id)` ON DELETE CASCADE |
| `station_id` | TEXT NOT NULL | → `stations(station_id)` ON DELETE CASCADE |
| `item_index` | INTEGER NOT NULL | 0-based position in the badge's vault; seeds the on-chain item PDA. Not exposed in the `Item` API type |
| `item_key` | TEXT NOT NULL | Deterministic content id, e.g. `immutable-hoodie` |
| `name` | TEXT NOT NULL | e.g. `Immutable Hoodie` |
| `slot` | TEXT NOT NULL | One of `head, face, torso, hands, feet, back, aura` |
| `rarity` | TEXT NOT NULL | One of `common, uncommon, rare, legendary` |
| `code` | INTEGER NOT NULL | u32 packing: low 16 bits content hash, next 3 slot index, next 2 rarity index |
| `minted_at` | TEXT NOT NULL | |
| `asset_address` | TEXT | On-chain item PDA; null until the chain write lands |
| `signature` | TEXT | Mint (and later withdraw) signature; null until confirmed |
| `withdrawn` | INTEGER NOT NULL DEFAULT 0 | Mapped to `Item.withdrawn` as `=== 1` |
| `granted_session` | TEXT | → `sessions(pairing_code)` ON DELETE SET NULL. Drives `SessionView.newItemIds` |

Indices / constraints:

- **`UNIQUE(badge_id, station_id)`** — at most one item per badge per station, ever.
- **`UNIQUE(badge_id, item_index)`** — vault indices are dense and unique per badge.
- `idx_items_badge` on `(badge_id)`, `idx_items_session` on `(granted_session)`

### `vaults`

| Column | Type | Notes |
| --- | --- | --- |
| `badge_id` | TEXT | PRIMARY KEY → `badges(badge_id)` ON DELETE CASCADE — one vault per badge is the idempotency guarantee (`INSERT ... ON CONFLICT(badge_id) DO NOTHING`) |
| `vault_address` | TEXT | PDA, null until the chain client returns one |
| `owner_wallet` | TEXT | Null while still in escrow |
| `claimed_at` | TEXT | Null while unclaimed |
| `created_at` | TEXT NOT NULL | Not exposed in the `Vault` API type |

Index: `idx_vaults_owner` on `(owner_wallet)`.

## Flow

1. **Station sync.** A hub POSTs `/api/station/sync` with `x-station-key`. The
   server upserts the badge (assigning `animalForBadge(badgeId)` on first sight),
   upserts the station, and ensures a `vaults` row plus its on-chain counterpart.
2. **Pairing code.** `startOrRefreshSession` finds no active session, generates a
   unique 6-character code, and inserts a `sessions` row. `recordVisit` wins the
   `visits` insert, so this is a first visit: `itemForVisit(badgeId, stationId)`
   is persisted as item index 0 and then minted on chain (after the local write,
   so a flaky RPC can never cost the hacker their loot). The response carries
   `pairingCode`, `url` = `{PUBLIC_APP_URL}/s/K7M2QX`, and the granted item. The
   badge shows the code/URL.
3. **PWA opens the session.** The phone hits `GET /api/session/K7M2QX` for the
   full `SessionView`, then attaches to `GET /api/session/K7M2QX/stream`, which
   immediately replays a `state` frame and heartbeats every 25 s. `newItemIds`
   tells it which item to animate.
4. **Second station grants an item.** The hacker walks to `station-solana-lounge`,
   whose hub POSTs `/api/station/sync`. The badge has an active session at a
   different station, so the old session is ended (its stream gets
   `{"type":"disconnected"}`) and a **new pairing code** is minted. The `visits`
   insert wins again, granting item index 1; the new session's stream gets
   `{"type":"item"}` then `{"type":"state"}`. The PWA must follow the new code —
   the old one is now inactive but still readable.
5. **Wallet claims.** In the PWA the hacker signs `claimMessage(pairingCode, wallet)`
   with their wallet and POSTs `/api/vault/claim`. The server verifies the ed25519
   signature, writes `owner_wallet` / `claimed_at`, and pushes `vault-claimed`
   then `state`. To do the claim on chain the PWA first calls
   `/api/vault/claim-tx`, has the wallet sign the returned base64 transaction, and
   submits it — the server holds the registry authority and can mint, but cannot
   claim on a hacker's behalf.
6. **Withdraw.** For each item the hacker wants out of escrow, the PWA calls
   `/api/vault/withdraw-tx`, signs and submits the transaction, then signs
   `withdrawMessage(pairingCode, itemId, wallet)` and POSTs `/api/vault/withdraw`
   so the server verifies the signer is the claiming wallet, marks
   `withdrawn = 1`, records the signature, and pushes an updated `state` frame.
7. **Walking away.** When the badge drops out of range the hub POSTs
   `/api/station/disconnect`; the session goes inactive and the stream receives
   `disconnected` followed by `state`. The `SessionView` stays readable so the page
   can render "you walked away".
