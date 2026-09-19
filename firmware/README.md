# HTN OS firmware

HTN OS targets the Hack the North 2026 badge (`esp32c3`) and is built with
ESP-IDF v5.5.3. Install that exact ESP-IDF release at `~/esp/esp-idf` before
building. The repository build command activates the toolchain, builds the app,
checks the factory-partition size, and publishes the web-flasher binaries:

```sh
bun run firmware:build
```

To build or flash directly, activate ESP-IDF first and run `idf.py` from this
directory:

```sh
. ~/esp/esp-idf/export.sh
idf.py build
idf.py -p <port> flash
```

The published build can also be flashed in a browser from `/badge`. If the
badge is not detected, hold **Start** while plugging in USB-C to enter download
mode, then retry. A blank screen while Start is held at plug-in is normal.

## Display rendering and fonts

HTN OS composes every screen update off-screen in two alternating DMA bands,
then sends each completed band to the ST7789. This band renderer avoids a
full-frame buffer while also preventing visible clear-then-redraw flashes.

The interface uses the Spleen bitmap font family by Frederic Cambus, distributed
under the BSD 2-Clause license. The checked-in generated font tables provide
6×12, 8×16, 12×24, 16×32, and 32×64 sizes; they are regenerated from the BDF
sources by `scripts/bdf2c.py` rather than edited by hand.

## Screens

- **Home** shows the HTN-ID, Wi-Fi and IP, badge-service link state, and whether
  an app key is set.
- **Menu** opens Wi-Fi, App key, Server, Canvas, LED test, and About.
- **Wi-Fi** scans nearby access points. Select a secured network to open the
  on-screen password keyboard; successful credentials are saved to NVS.
- **App key** generates, enters, or clears the owner-controlled app key.
- **Server** edits or resets the badge-service WebSocket URL.
- **Canvas** gives a connected app control of the display and button events.
- **LED test** chases a dim purple light around the six badge LEDs.
- **About** shows firmware, MAC, HTN-ID, server, heap, and IP information.

## Keys

In menus, **Up/Down/Left/Right** move, **A** selects, **B** goes back, and
**Home** toggles between Home and Menu. On the keyboard, the D-pad moves with
wraparound, **A** types the selected cell, **B** deletes, **Start** confirms,
and **Home** cancels. The page cell cycles lower-case, upper-case, and symbol
layouts. D-pad auto-repeat starts after a short hold in menus, Wi-Fi, App key,
Server, and the keyboard, then continues at a steady interval until release or
a screen change.

In Canvas, presses and releases from all nine controls are sent to the badge
service. Hold **Home** for at least one second to leave Canvas and return to the
Menu. The Aux1 side control is a maintained switch, so it reports an edge when
its physical state changes.
