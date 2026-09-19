# HTN OS — badge proxy protocol and API

HTN OS is a replacement firmware for the Hack the North 2026 Hacker Badge
(ESP32-C3-MINI-1-N4). Flash it once from <https://solana-htn.com/badge>, join
Wi-Fi from the badge's settings screen, and the badge registers itself with the
badge service and gets a permanent five-character **HTN-ID** (for example
`xb2b9`). From then on every peripheral — the 320×240 screen, six RGB LEDs,
nine buttons, the accelerometer, and the NFC reader — is reachable over HTTP,
so you build badge ↔ server and badge ↔ badge apps by talking to the service,
never by re-flashing.

```text
 your code ──HTTPS/WSS──▶ badge.solana-htn.com ──WSS──▶ HTN OS on the badge
 (any language)           apps/badge-service           firmware/
```

Production base URL: `https://badge.solana-htn.com`. Local development:
`http://localhost:3100` (`bun run --filter '@htn/badge-service' dev`).

This document is the contract. `packages/shared/src/htnos.ts` holds the same
constants and zod schemas for TypeScript; `firmware/main/htnos.h` mirrors the
constants in C.

## 1. Ids, keys, and who can do what

| Thing | Where it comes from | Who knows it |
| --- | --- | --- |
| **HTN-ID** | Minted by the service the first time a badge connects; 5 chars from `23456789abcdefghjkmnpqrstuvwxyz`. Shown on the badge home screen. | Public. Anyone can read a badge's online status by id. |
| **Device token** | Minted with the id; stored in the badge's NVS. Proves a socket really is that badge. | Badge and service only. Never leaves the wire protocol. |
| **App key** | Set by the owner on the badge (Settings → App key → *Generate* or *Type*). 4–32 printable characters. | The owner shares it with apps they trust. Every command must carry it. |

Commands are refused with `403 key_not_set` until the owner sets a key. The
service checks the key (it stores only a SHA-256 hash) and the badge checks it
again on every message, so a compromised service still cannot drive a badge
whose key it does not know. Rotate the key on the badge at any time; old apps
stop working immediately.

Supply the key as the `X-Badge-Key` header or the `key` query parameter.

## 2. Public API

All responses are JSON. Errors use `{ "error": "<code>", "detail"?: "<text>" }`.

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_request` | Body did not parse or did not match the schema. |
| 400 | `image_invalid` | Not a decodable PNG/JPEG. |
| 403 | `bad_key` | Wrong app key. |
| 403 | `key_not_set` | The owner has not set an app key yet. |
| 404 | `badge_not_found` | No badge with that HTN-ID has ever registered. |
| 404 | `app_not_found` | No such app in the store. |
| 409 | `badge_offline` | Registered, but not connected right now. |
| 413 | `image_too_large` | Upload exceeds 512 KiB. |
| 429 | `rate_limited` | More than 20 commands/s (burst 40) or 400 KB/s to one badge. |
| 504 | `badge_timeout` | The badge did not answer within 5 s. |

### Colours

Wherever a colour is accepted it is either `"#rrggbb"`, `"#rgb"`, or `[r, g, b]`
(0–255). The service converts to RGB565 for the wire.

### `GET /v1/health`

```json
{ "ok": true, "badgesRegistered": 12, "badgesOnline": 3, "apps": 4, "publicUrl": "https://badge.solana-htn.com" }
```

### `GET /v1/badges/:id`

Public; no key.

```json
{
  "badgeId": "xb2b9",
  "online": true,
  "hasKey": true,
  "fw": "0.1.0",
  "registeredAt": "2026-09-19T14:02:11.000Z",
  "lastSeenAt": "2026-09-19T15:40:02.000Z",
  "mode": "canvas"
}
```

`mode` is `canvas` while a remote app owns the screen, `menu` while the owner is
in the HTN OS menus, `null` when offline.

### Screen

The screen is 320×240, origin top-left, landscape. There is no framebuffer on
the badge: each command draws directly, so draw in the order you want to see.
The first screen command switches the badge into **canvas** mode (blank
screen, button events flowing); the owner holds **Home** for one second to
leave canvas mode and return to the menu, which emits a `mode` event.

`POST /v1/badges/:id/clear` — `{ "color"?: Color }` (default black) → `{ "ok": true }`

`POST /v1/badges/:id/text`

```json
{ "text": "HELLO\nWORLD", "x": 8, "y": 8, "size": 3, "color": "#14f195", "background": "#000", "clear": true }
```

`size` picks a bitmap font: 1 = 6×12 px per glyph, 2 = 8×16, 3 = 12×24,
4 = 16×32 (so 53, 40, 26, or 20 characters fit on a line). `\n` starts a new
line; there is no word wrap. `text` is at most 256 characters of printable ASCII. `clear: true`
fills the whole screen with `background` first. → `{ "ok": true }`

`POST /v1/badges/:id/rect` — `{ "x", "y", "w", "h", "color" }` filled → `{ "ok": true }`

`POST /v1/badges/:id/image`

Either a raw body with `Content-Type: image/png` or `image/jpeg` and options as
query parameters (`?x=0&y=0&fit=contain`), or JSON:

```json
{ "image": "<base64 png or jpeg>", "x": 0, "y": 0, "fit": "contain" }
```

`fit: "contain"` (default) scales the image to fit 320×240 keeping its aspect
ratio and centres it; `fit: "none"` draws it 1:1 at `x,y` and crops. Uploads
are capped at 512 KiB. The service decodes, converts to RGB565, and streams
the pixels to the badge in 8-row chunks; a full-screen image is about 150 KB on
the wire and takes roughly a second. → `{ "ok": true, "width": 320, "height": 240 }`

### LEDs

`POST /v1/badges/:id/leds`

```json
{ "leds": ["#ff0000", null, null, null, null, "#0000ff"] }
```

or `{ "all": "#101010" }`. Six entries in this order looking at the front:
`upper-left, upper-right, middle-right, bottom-right, bottom-left, middle-left`.
`null` leaves that LED as it is. The firmware caps every channel at 160/255 so
six white LEDs cannot brown out the AA supply. → `{ "ok": true }`

### Buttons

`GET /v1/badges/:id/buttons` → current state

```json
{ "buttons": { "a": false, "b": false, "home": false, "down": false, "left": false, "right": false, "up": true, "aux1": false, "start": false } }
```

`aux1` is the maintained side switch, so it can be `true` at boot. Live
presses arrive as `button` events (see §3) while the badge is in canvas mode.

### Accelerometer

`GET /v1/badges/:id/accel` → `{ "x": -12, "y": 4, "z": 1002 }` in milli-g.

`POST /v1/badges/:id/accel/stream` — `{ "hz": 10 }` (0 stops, max 20) starts
periodic `accel` events. Streaming stops automatically when the badge leaves
canvas mode or reconnects.

### NFC

`POST /v1/badges/:id/nfc` — `{ "timeoutMs"?: 3000 }` (max 10 000). Powers the
MFRC522 up, looks for an ISO 14443A tag until the timeout, powers it down.
→ `{ "uid": "04a1b2c3d4e5f6" }` or `{ "uid": null }`.

### System

`GET /v1/badges/:id/info` → `{ "fw": "0.1.0", "ip": "10.0.0.7", "rssi": -51, "heap": 143120, "uptimeSeconds": 812, "mode": "canvas" }`

`POST /v1/badges/:id/home` → leaves canvas mode and returns the badge to its
menu. → `{ "ok": true }`

### Events

`GET /v1/badges/:id/events` — Server-Sent Events. Needs the key. Each message
has `event:` set to the event name and `data:` as JSON:

```text
event: button
data: {"event":"button","badgeId":"xb2b9","button":"a","pressed":true,"at":"2026-09-19T15:40:02.120Z"}

event: accel
data: {"event":"accel","badgeId":"xb2b9","x":-12,"y":4,"z":1002,"at":"..."}

event: mode
data: {"event":"mode","badgeId":"xb2b9","mode":"menu","at":"..."}

event: offline
data: {"event":"offline","badgeId":"xb2b9","at":"..."}

event: online
data: {"event":"online","badgeId":"xb2b9","at":"..."}

event: ping
data: {"event":"ping","at":"..."}
```

A `ping` is sent as soon as the stream opens and every 25 s after that. The
stream is not replayed; reconnect and re-read state if you drop.

### App WebSocket

`GET /v1/badges/:id/ws?key=...` upgrades to a WebSocket that carries commands
one way and replies plus events the other, so a game loop needs one socket.

Send (one JSON object per text frame):

```json
{ "cmd": "text", "id": "t1", "text": "PONG", "x": 100, "y": 100, "size": 4 }
{ "cmd": "leds", "id": "l1", "body": { "all": "#220022" } }
{ "cmd": "accel", "id": "a1" }
{ "cmd": "buttons" }
{ "cmd": "image", "image": "<base64>", "fit": "contain" }
{ "cmd": "accelStream", "hz": 10 }
{ "cmd": "nfc", "timeoutMs": 2000 }
{ "cmd": "clear", "color": "#000" }
{ "cmd": "rect", "x": 0, "y": 0, "w": 10, "h": 10, "color": "#fff" }
{ "cmd": "info" }
{ "cmd": "home" }
```

`cmd` is the REST endpoint name (`accelStream` for `accel/stream`); the other
fields are that endpoint's body (`leds` wraps its body under `body` because it
is a union). `id` is optional and echoed back.

Receive:

```json
{ "type": "reply", "id": "a1", "data": { "x": -12, "y": 4, "z": 1002 } }
{ "type": "error", "id": "t1", "error": "badge_offline" }
{ "type": "event", "data": { "event": "button", "badgeId": "xb2b9", "button": "a", "pressed": true, "at": "..." } }
```

The socket closes with code `4403` on a bad key, `4404` for an unknown badge.
Rate limits are the same as REST.

### App store

`GET /v1/apps` → `{ "apps": [ { "appId": "k3j9d2xq", "name": "Badge Pong", "description": "...", "url": "https://...", "author": "...", "sourceUrl": null, "kind": "badge-to-badge", "createdAt": "..." } ] }`
newest first.

`POST /v1/apps`

```json
{ "name": "Badge Pong", "description": "Two badges, one ball. Tilt to move.", "url": "https://pong.example.com", "author": "Ada", "sourceUrl": "https://github.com/ada/badge-pong", "kind": "badge-to-badge" }
```

`kind` is `server` (one badge talks to your server), `badge-to-badge`, or
`tool`. Limited to 10 submissions per minute per IP. → `{ "app": { ... } }`

`DELETE /v1/apps/:appId` with `Authorization: Bearer <ADMIN_TOKEN>` removes a
listing; `404 app_not_found` if it is gone, `403 forbidden` without the token,
`404 not_found` when the service has no `ADMIN_TOKEN` configured.

## 3. Examples

### curl

```bash
BASE=https://badge.solana-htn.com; ID=xb2b9; KEY=hunter2

curl -s $BASE/v1/badges/$ID
curl -s -X POST $BASE/v1/badges/$ID/text -H "X-Badge-Key: $KEY" -H 'content-type: application/json' \
  -d '{"text":"HELLO","size":4,"clear":true,"color":"#9945ff"}'
curl -s -X POST $BASE/v1/badges/$ID/leds -H "X-Badge-Key: $KEY" -H 'content-type: application/json' \
  -d '{"all":"#001030"}'
curl -s -X POST "$BASE/v1/badges/$ID/image?fit=contain" -H "X-Badge-Key: $KEY" \
  -H 'content-type: image/png' --data-binary @logo.png
curl -s $BASE/v1/badges/$ID/accel -H "X-Badge-Key: $KEY"
curl -N "$BASE/v1/badges/$ID/events?key=$KEY"
```

### Badge ↔ server: a reaction-time game in TypeScript

One badge, your server. Show a prompt, wait for **A**, score the delay.

```ts
const BASE = 'wss://badge.solana-htn.com';
const badge = 'xb2b9';
const key = 'hunter2';

const ws = new WebSocket(`${BASE}/v1/badges/${badge}/ws?key=${key}`);
const send = (msg: object) => ws.send(JSON.stringify(msg));

ws.onopen = async () => {
  send({ cmd: 'text', text: 'WAIT...', size: 4, x: 40, y: 100, clear: true });
  await new Promise((r) => setTimeout(r, 1000 + Math.random() * 3000));
  send({ cmd: 'clear', color: '#14f195' });
  send({ cmd: 'text', text: 'PRESS A!', size: 4, x: 32, y: 100, background: '#14f195', color: '#000' });
  send({ cmd: 'leds', body: { all: '#00ff00' } });
  started = Date.now();
};

let started = 0;
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(String(data));
  if (msg.type === 'event' && msg.data.event === 'button' && msg.data.button === 'a' && msg.data.pressed) {
    const ms = Date.now() - started;
    send({ cmd: 'text', text: `${ms} ms`, size: 4, x: 60, y: 100, clear: true });
    send({ cmd: 'leds', body: { all: '#000' } });
  }
};
```

### Badge ↔ badge: tilt pong in Python

Two badges, one server. Each badge tilts to move its paddle; the ball is drawn
on both screens. Everything is REST + one SSE stream per badge, so it runs
anywhere `requests` does.

```python
import json, threading, time, requests

BASE = "https://badge.solana-htn.com"
PLAYERS = {"left": ("xb2b9", "hunter2"), "right": ("m4kq7", "secret9")}
W, H = 320, 240

def post(badge, key, path, body):
    requests.post(f"{BASE}/v1/badges/{badge}/{path}", json=body, headers={"X-Badge-Key": key}, timeout=5)

tilt = {"left": 0, "right": 0}

def listen(side):
    badge, key = PLAYERS[side]
    post(badge, key, "accel/stream", {"hz": 10})
    with requests.get(f"{BASE}/v1/badges/{badge}/events", headers={"X-Badge-Key": key}, stream=True) as r:
        for line in r.iter_lines():
            if line.startswith(b"data:"):
                ev = json.loads(line[5:])
                if ev["event"] == "accel":
                    tilt[side] = ev["y"]          # milli-g; sign picks the direction

for side in PLAYERS:
    threading.Thread(target=listen, args=(side,), daemon=True).start()

pad = {"left": H // 2, "right": H // 2}
ball = [W // 2, H // 2]; vel = [4, 3]
for badge, key in PLAYERS.values():
    post(badge, key, "clear", {"color": "#000"})

while True:
    for side in pad:
        pad[side] = max(20, min(H - 20, pad[side] + tilt[side] // 100))
    ball[0] += vel[0]; ball[1] += vel[1]
    if not 0 < ball[1] < H: vel[1] = -vel[1]
    if ball[0] < 8 and abs(ball[1] - pad["left"]) < 24: vel[0] = -vel[0]
    if ball[0] > W - 8 and abs(ball[1] - pad["right"]) < 24: vel[0] = -vel[0]
    if not 0 < ball[0] < W: ball = [W // 2, H // 2]
    for side, (badge, key) in PLAYERS.items():
        post(badge, key, "clear", {"color": "#000"})
        post(badge, key, "rect", {"x": 0 if side == "left" else W - 6, "y": pad[side] - 20, "w": 6, "h": 40, "color": "#9945ff"})
        post(badge, key, "rect", {"x": ball[0] - 4, "y": ball[1] - 4, "w": 8, "h": 8, "color": "#14f195"})
    time.sleep(0.1)
```

Ten frames a second with three commands each stays under the 20 commands/s
budget. For smoother motion, redraw only what moved (draw the old position in
black, then the new one) instead of clearing the whole screen.

### Rock, paper, scissors from the browser

<https://solana-htn.com/badge/rps> is a complete sample app that runs entirely
in the page: it opens the app WebSocket for your badge, draws the prompt,
turns Left / Up / Right presses into rock / paper / scissors, and shows the
result on the screen and LEDs. Enter a second badge to play badge ↔ badge.
The source is `apps/pwa/src/routes/badge/rps/` and `apps/pwa/src/lib/rps*.ts`.

### Show a picture from the browser

```js
const file = document.querySelector('input[type=file]').files[0];
await fetch(`https://badge.solana-htn.com/v1/badges/xb2b9/image?fit=contain`, {
  method: 'POST',
  headers: { 'X-Badge-Key': 'hunter2', 'content-type': file.type },
  body: file,
});
```

## 4. On the badge

| Key | In menus | In canvas mode |
| --- | --- | --- |
| Up / Down / Left / Right | Move | `button` event |
| A | Select / type | `button` event |
| B | Back / backspace | `button` event |
| Home | Open or close the menu | short press: `button` event; **hold 1 s: leave canvas** |
| Start | Confirm (keyboard OK) | `button` event |
| Aux1 (side switch) | — | `button` event on change |

Screens: **Home** (big HTN-ID, Wi-Fi, link and key status), **Menu** → Wi-Fi
(scan, pick, type password, saved to flash), App key (generate or type), Server
(the service URL, default `wss://badge.solana-htn.com/v1/device/ws`), Canvas,
LED test, About. The on-screen keyboard has lower, UPPER, and symbol pages;
Start confirms, Home cancels.

If the badge shows **NO ID**, it has not reached the service yet: check Wi-Fi.
The link reconnects by itself with back-off (2 s … 30 s).

## 5. Wire protocol (badge ↔ service)

For firmware hackers and anyone running their own service. One WebSocket from
the badge to `GET /v1/device/ws`. Text frames are single JSON objects with a
one-letter type `t`; binary frames are screen blits. Text frames from the
service never exceed 1024 bytes; binary frames never exceed 8192 bytes.

Badge → service:

| Frame | Meaning |
| --- | --- |
| `{"t":"hello","v":1,"mac":"aabbccddeeff","fw":"0.1.0","id":"xb2b9","tok":"…","key":"…"}` | First frame after connect. `id`/`tok` are omitted on the first ever boot; `key` is included when the owner has one so the service learns it after a database reset. |
| `{"t":"key","k":"hunter2"}` | Owner set or changed the app key. `""` clears it. |
| `{"t":"mode","m":"menu"}` | The badge entered or left canvas mode. |
| `{"t":"btn","n":"a","p":1}` | Button press (`p`=1) or release (0); canvas mode only. |
| `{"t":"accel","x":-12,"y":4,"z":1002}` | A streamed sample, milli-g. |
| `{"t":"r","i":7, …}` | Reply to the command that carried `"i":7`. Fields: `btn` → `"b":{…}`, `accel` → `"x","y","z"`, `nfc` → `"uid":"…"|null`, `info` → `"fw","ip","rssi","heap","up","mode"`. |

Service → badge (every command carries the app key `k`, which the badge
compares in constant time and silently drops on mismatch):

| Frame | Meaning |
| --- | --- |
| `{"t":"welcome","id":"xb2b9","tok":"…"}` | Registration accepted. `tok` is present only when newly minted; the badge stores both in NVS. |
| `{"t":"err","c":"bad_token"}` | The id/token pair is unknown; the badge forgets both and re-hellos to register again. `bad_hello` closes the socket; `replaced` means a second socket for the same badge took over. |
| `{"t":"clear","k":…,"c":0}` | Fill the screen with RGB565 `c`. |
| `{"t":"text","k":…,"x":8,"y":8,"s":"HI\nTHERE","c":65535,"b":0,"z":2,"cl":1}` | Draw text; `z` is the scale; `cl:1` clears to `b` first. |
| `{"t":"rect","k":…,"x":0,"y":0,"w":10,"h":10,"c":2016}` | Filled rectangle. |
| `{"t":"leds","k":…,"l":[[255,0,0],null,null,null,null,[0,0,255]]}` | Set LEDs; `null` keeps the current colour. |
| `{"t":"btn","k":…,"i":7}` | Ask for the button snapshot. |
| `{"t":"accel","k":…,"i":8}` | Ask for one accelerometer sample. |
| `{"t":"accel_stream","k":…,"hz":10}` | Stream samples; 0 stops. |
| `{"t":"nfc","k":…,"i":9,"ms":3000}` | Scan for a tag for `ms` milliseconds. |
| `{"t":"info","k":…,"i":10}` | Ask for system info. |
| `{"t":"home","k":…}` | Leave canvas mode. |

Binary blit frame, all integers big-endian:

```text
byte 0          0x01
byte 1          L, key length (4..32)
bytes 2..2+L    the app key, ASCII
u16 x, u16 y, u16 w, u16 h
w*h*2 bytes     RGB565 pixels, big-endian — the ST7789's native order, DMA-able as-is
```

Every screen command switches the badge to canvas mode first. The badge
replies to `welcome` by sending its current `mode` and (if set) `key`.
WebSocket ping/pong keeps the connection alive every 20 s; the service marks a
badge offline when its socket closes.

## 6. Running your own service

`bun run --filter '@htn/badge-service' dev` starts it on port 3100 with a local
SQLite file. Point a badge at it from Settings → Server with
`ws://<your-laptop-ip>:3100/v1/device/ws` (plain `ws://` is fine on a LAN; the
production URL must be `wss://`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3100` | Listen port. |
| `DATABASE_PATH` | `./data/badge.db` | SQLite file; `:memory:` for tests. |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated browser origins allowed to call the API. |
| `PUBLIC_URL` | `http://localhost:3100` | Reported in `/v1/health` and used in docs links. |
| `ADMIN_TOKEN` | unset | Enables `DELETE /v1/apps/:appId`. |
| `NODE_ENV` | `development` | `production` disables verbose logging. |

The service is single-process by design: badge sockets, reply correlation, and
event fan-out are in memory, and SQLite is replicated by Litestream in
production. Do not scale it past one instance.
