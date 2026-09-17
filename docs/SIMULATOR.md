# Driving the blind boxes without hardware

`/sim` is a development-only box tapper. It sends the same
`POST /api/box` payload as the badge relay, displays the response exactly as
JSON, and links directly to each badge's permanent console.

Start the app, then open <http://localhost:5173/sim>:

```bash
bun run dev
```

No API key or special route mode is required. Box taps are intentionally
unauthenticated because the physical relay cannot attach headers.

## Tap controls

The tool keeps six seeded fake badges in browser storage under `htn.sim.v2`.
Each badge has a user id, name, email, and an optional public key. Pick a badge
and one of the nine fixed boxes, then select **Tap box**. Each box hands out
one fixed item:

| Box id | Zone | Item |
| --- | --- | --- |
| `solana-booth` | Solana Booth | `8` |
| `solana-booth-final` | Solana Booth (Final) | `9` after the quest, otherwise empty |
| `hardware-hub` | Hardware Hub | `1` |
| `extended-bay` | Extended Sponsor Bay | `2` |
| `mentor-cafe` | Mentor Cafe | `3` |
| `third-floor` | Third Floor Hacking Space | `4` |
| `fourth-floor` | Fourth Floor Hacking Space | `5` |
| `fifth-floor` | Fifth Floor Hacking Space | `6` |
| `seventh-floor` | Seventh Floor | `7` |

The boxes matching `solanaBoxId` and `solanaFinalBoxId` from `GET /api/health` are labeled **Solana box (item 8)** and **Solana final box (item 9, quest-gated)**, respectively.
Every tap sends:

```json
{
  "box": "hardware-hub",
  "user_id": "htn-0417",
  "name": "Ada Nkemelu",
  "email": "ada.nkemelu@uwaterloo.ca",
  "public_key": ""
}
```

After a successful tap, the response panel shows the raw `BoxResponse`, its
compact JSON size in UTF-8 bytes, and an **Open console** link parsed from
`chain_link`. The byte counter turns red above the shared
`BOX_RESPONSE_MAX_BYTES` limit because a physical relay would truncate that
payload.

The badge table shows badge id, name, collected item ids, quest status, and a
console link. It refreshes after every tap and every five seconds while `/sim`
is open.

**Reset server** calls the development-only `POST /api/dev/reset` endpoint and
clears badges, awards, and quest submissions. It does not change the fake
badge selection stored in the browser.

## Full offline quest demo

When the server has no chain payer configured, it uses its disabled chain
client. Program and account reads are skipped, and payment is simulated. The
development mock vendor accepts that simulated payment, so the complete box,
inventory, and verification flow works without RPC, tokens, or a deployed
program.

1. Start `bun run dev`, open `/sim`, and select **Reset server**.
2. Pick a fake badge and a regular box, then select **Tap box**.
3. Follow **Open console** from the response panel.
4. In the quest form, submit:

   - endpoint URL: `http://localhost:3000/api/dev/vendor`
   - program ID: `11111111111111111111111111111111`

5. Watch the verification log advance through program, state, challenge,
   payment, and proof. The simulator table changes from `verifying` to
   `completed`.
6. Return to `/sim`, choose the box labeled **Solana box**, and tap it with the
   same fake badge. The response awards item `9` (item `8` came on the first tap); the console inventory
   updates over its live stream.

The phone must be able to reach the server origin. A phone on the same LAN
cannot use its own `localhost`; open the PWA through the development machine's
LAN address and submit that machine's address for the mock vendor instead.

## Chain-enabled demo

With the payer secret and RPC configuration present, `chainEnabled` becomes
`true`. The mock vendor is intended for the offline path; use the deployed
starter endpoint and its real program ID for an on-chain run. The agent checks
the deployment, reads the `["quest"]` PDA, validates the x402 challenge, pays
once, and compares the paid response with the on-chain message.

See [QUEST.md](QUEST.md) for the participant walkthrough and [API.md](API.md)
for the HTTP contract.
