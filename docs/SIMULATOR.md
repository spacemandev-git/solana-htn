# Driving the system without hardware

`/sim` is the operator console. It fakes badges and Sync Stations against the
real server, so the whole loop can be built, demoed and debugged before any
ESP32 is in the room — and used as a control panel when they are.

Open <http://localhost:5173/sim> after `bun run dev`.

## Setup

The console needs the Sync Station API key, because it is impersonating a
station and `/api/station/sync` is authenticated. Paste `STATION_API_KEY` (default
`dev-station-key`) into the API key field; it is persisted to `localStorage`
along with your rosters and selection, because live demos involve a lot of
reloads.

The header shows the server's `/api/health`, including `chainEnabled` — so it is
never ambiguous whether writes are reaching a chain or only SQLite.

## Seeded rosters

Six hubs and six hackers ship as defaults, and you can add your own:

| Stations | Badges |
| --- | --- |
| `e7-atrium` — E7 Atrium | `htn-0417` Ada Nkemelu |
| `slc-great-hall` — SLC Great Hall | `htn-0932` Rohan Mehta |
| `mc-comfy` — MC Comfy Lounge | `htn-1180` Sofia Petrova |
| `dc-fishbowl` — DC Fishbowl | `htn-2044` Kai Tanaka |
| `e5-hardware-bay` — E5 Hardware Bay | `htn-3311` Jordan Blake |
| `midnight-ramen` — Midnight Ramen Bar | `htn-5079` Mei Lin |

Because content is derived from ids, these are stable: `htn-0417` gets the same
animal every time you reset, and the same station always yields the same item
for the same badge.

## What you can do

- **Sync** — fires `POST /api/station/sync` for the selected badge at the
  selected station, exactly as a hub would, and shows the raw JSON response.
- **Disconnect** — fires `POST /api/station/disconnect`, simulating the hacker
  walking into the wilderness.
- **QR / open phone view** — turns the returned pairing code into a scannable
  code and a link to `/s/:pairingCode`, so you can point a real phone at it.
- **Roster table** — every badge with its animal, item count, stations visited,
  active session and vault/claim status. Auto-refreshes every 3s.
- **Badge detail** — click through for the full inventory, visits and vault.
- **Reset** — `POST /api/dev/reset` wipes the database. Dev-only route.

## A demo that shows everything

1. Sync `htn-0417` at `e7-atrium`. They're assigned an animal and granted their
   first item. Note the pairing code.
2. Open `/s/<code>` on a phone (or a second browser window). It shows the animal,
   the item, and a LIVE indicator.
3. Sync `htn-0417` at `slc-great-hall`. Watch the first phone view flip to
   **disconnected** over SSE — the hacker crossed the wilderness — and a new
   pairing code appear. Open that one: two items now.
4. Sync `htn-0417` at `e7-atrium` again. `granted` comes back empty: a hub you've
   already cleared gives no loot. This is the `visits` unique constraint doing
   the work, not application logic.
5. Sync a second badge at the same station. Different item — loot is seeded by
   badge *and* station, so no two hackers get the same thing.
6. Go to `/wallet`, connect a Solana wallet, and claim. The vault's owner goes
   from nobody to the hacker. Withdraw an item out of escrow.
7. Hit Disconnect and watch the phone view move to the wilderness state.

## Without a validator

Everything above works with the chain disabled — `/api/health` will report
`chainEnabled: false`, vault addresses stay null, and the wallet page does the
signature binding without submitting a transaction. That is deliberate: at a
hackathon the venue network is the least reliable component in the system, and
the badge experience must not depend on it.

To demo the on-chain half:

```bash
bun run localnet     # validator + deploy, prints the env
```

Paste the printed variables into `.env`, restart the server, and `/api/health`
flips to `chainEnabled: true`. Vault and item addresses then appear in the badge
detail view, and claiming actually moves ownership on chain.

## Curl equivalents

Useful when testing hub firmware directly:

```bash
# a badge arrives at a hub
curl -X POST http://localhost:3000/api/station/sync \
  -H 'content-type: application/json' \
  -H 'x-station-key: dev-station-key' \
  -d '{
        "stationId": "e7-atrium",
        "stationName": "E7 Atrium",
        "badge": { "badgeId": "htn-0417", "name": "Ada Nkemelu", "email": "ada.nkemelu@uwaterloo.ca" },
        "rssi": -47
      }'

# it walks out of range
curl -X POST http://localhost:3000/api/station/disconnect \
  -H 'content-type: application/json' \
  -H 'x-station-key: dev-station-key' \
  -d '{ "stationId": "e7-atrium", "badgeId": "htn-0417" }'
```

See [API.md](API.md) for the full surface.
