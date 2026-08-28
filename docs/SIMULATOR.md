# Driving the quest without hardware

`/sim` is the operator console for the complete badge-to-quest flow. It sends
the same sync and disconnect requests as an ESP32 beacon, produces the same
pairing QR, and watches the same quest status returned by the server.

Start the app, then open <http://localhost:5173/sim>:

```bash
bun run dev
```

## Setup

For the quickest local demo, enable **Use `/api/dev/*`** in the simulator.
These development-only routes do not require a station key. To exercise the
authenticated route instead, leave that switch off and enter
`STATION_API_KEY` (the development default is `dev-station-key`). The
selection, fake rosters, route mode, and key are kept in browser storage.

The header reports `GET /api/health`, including the cluster and whether chain
access is enabled. The simulator polls the badge table every three seconds; the
Auto switch can pause polling.

## Controls

- **Sync badge** sends the selected fake badge and station to
  `POST /api/dev/sync` or `POST /api/station/sync`. The response contains a
  pairing code, which can be opened directly or displayed as a QR.
- **Disconnect** ends the selected badge's active session. This changes the
  phone header to OFFLINE, but an in-flight verification continues on the
  server and its result is retained.
- **Edit roster** adds or removes fake stations and badges. Restore seeded
  roster returns to the six built-in examples without clearing the station key.
- **Reset server** calls `POST /api/dev/reset` and wipes badges, sessions, and
  quest submissions.
- **Badge table** shows each badge's active station, pairing code, and quest
  state: `—`, `verifying`, `completed`, or `failed`.

The raw response and operator log make request failures visible without opening
browser developer tools.

## Full offline quest demo

When the server has no chain payer configured, it uses its disabled chain
client. Program and account reads are skipped, and payment is simulated. The
development mock vendor accepts that simulated payment, so the entire UI and
verification pipeline can be demonstrated without RPC, USDC, or a deployed
program.

1. Start `bun run dev`, open `/sim`, and enable **Use `/api/dev/*`**.
2. Click **Reset server** for a clean run.
3. Choose a badge and station, then click **Sync badge**.
4. Open the returned `/s/:pairingCode` link or scan its QR.
5. In the quest form, submit:

   - endpoint URL: `http://localhost:3000/api/dev/vendor`
   - program ID: `11111111111111111111111111111111`

6. Watch the phone's verification log advance through program, state,
   challenge, payment, and proof. The simulator table changes from
   `verifying` to `completed`.
7. The outcome shows **simulated payment** and the mock proof message. No funds
   move in this mode.

The phone must be able to reach the server origin. A phone on the same LAN
cannot use its own `localhost`; open the PWA through the development machine's
LAN address and submit that machine's address for the mock vendor instead.

## Disconnect during verification

To demonstrate the server-side lifecycle, submit the quest and immediately
click **Disconnect** in the simulator. The phone reports that the station signal
was lost while the verifier continues. Reconnect the stream or sync the same
badge again to see the stored result. Disconnecting never cancels verification.

## Chain-enabled demo

With the payer secret and RPC configuration present, `chainEnabled` becomes
`true`. The mock vendor is intended for the offline path; use the deployed
starter endpoint and its real program ID for an on-chain run. The agent checks
the deployment, reads the `["quest"]` PDA, validates the x402 challenge, pays
once, and compares the paid response with the on-chain message.

See [QUEST.md](QUEST.md) for the participant walkthrough and [API.md](API.md)
for the HTTP contract.
