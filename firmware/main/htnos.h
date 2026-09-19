/*
 * HTN OS — pinned constants. This is the C mirror of
 * packages/shared/src/htnos.ts (the TypeScript contract) and of the badge's
 * HAL guide (https://badge.hackthenorth.com/custom-firmware-hal.md). Change
 * a value here only together with its twin in htnos.ts and docs/HTNOS.md.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#define HTNOS_VERSION "0.2.0"
#define HTNOS_PROTOCOL_VERSION 1

/* ---- Identity ---------------------------------------------------------- */
#define HTNOS_ID_ALPHABET "23456789abcdefghjkmnpqrstuvwxyz"
#define HTNOS_ID_LENGTH 5
#define HTNOS_KEY_MIN 4
#define HTNOS_KEY_MAX 32
#define HTNOS_TOKEN_MAX 128
#define HTNOS_URL_MAX 128
#define HTNOS_SSID_MAX 32
#define HTNOS_PASS_MAX 64
#define HTNOS_DEFAULT_SERVICE_URL "wss://badge.solana-htn.com/v1/device/ws"

/* ---- Pin map (HAL guide §2) ------------------------------------------- */
#define PIN_LCD_MOSI 10
#define PIN_LCD_CLK 1
#define PIN_LCD_CS 2
#define PIN_LCD_DC 0
#define PIN_LCD_RST 4
#define PIN_I2C_SDA 5
#define PIN_I2C_SCL 6
#define PIN_HC165_DATA 7
#define PIN_HC165_LOAD 20
#define PIN_HC165_CLK 21
#define PIN_BTN_START 9 /* active-low, strapping pin */
#define PIN_LED_DIN 3

/* ---- Display (ST7789, HAL guide §4) ----------------------------------- */
#define LCD_WIDTH 320
#define LCD_HEIGHT 240
#define LCD_SPI_HOST SPI2_HOST
#define LCD_SPI_HZ (40 * 1000 * 1000)
#define LCD_SPI_MODE 0
/* Two DMA stripe buffers of this many rows; never a full frame. Screens are
   composed one band at a time in these (see hal_display.h). */
#define LCD_STRIPE_ROWS 30
/* Remote `text` sizes 1..4 select a Spleen bitmap font (fonts.h). Mirrors
   HTNOS_TEXT_SIZES in htnos.ts: 6x12, 8x16, 12x24, 16x32. */
#define TEXT_SIZE_MIN 1
#define TEXT_SIZE_MAX 4
#define TEXT_FONT_FOR_SIZE(z) \
    ((z) <= 1 ? FONT_6X12 : (z) == 2 ? FONT_8X16 : (z) == 3 ? FONT_12X24 : FONT_16X32)
#define TEXT_MAX 256

/* ---- Buttons (74HC165 + Start, HAL guide §3) ------------------------- */
/* Shift order out of the HC165, index = bit position: A first, Aux1 last. */
typedef enum {
    BTN_A = 0,
    BTN_B,
    BTN_HOME,
    BTN_DOWN,
    BTN_LEFT,
    BTN_RIGHT,
    BTN_UP,
    BTN_AUX1,
    BTN_START, /* GPIO9, not on the shift register */
    BTN_COUNT
} button_t;
#define BUTTON_POLL_MS 10
#define BUTTON_DEBOUNCE_SAMPLES 2
#define HOME_HOLD_MS 1000
/* Held D-pad keys repeat in menus and the keyboard. */
#define BUTTON_REPEAT_DELAY_MS 400
#define BUTTON_REPEAT_MS 80
/* Wire names, in button_t order (also HTNOS_BUTTONS in htnos.ts). */
#define BUTTON_NAMES { "a", "b", "home", "down", "left", "right", "up", "aux1", "start" }

/* ---- LEDs (WS2812B ×6, HAL guide §6) --------------------------------- */
#define LED_COUNT 6
#define LED_RMT_HZ (10 * 1000 * 1000)
/* Every channel is scaled by LED_CHANNEL_CAP/255 before it reaches the strip. */
#define LED_CHANNEL_CAP 160

/* ---- I2C bus (HAL guide §5, §7) --------------------------------------- */
#define I2C_HZ 400000
#define I2C_TIMEOUT_MS 50
#define ACCEL_ADDR 0x19
#define ACCEL_WHO_AM_I_REG 0x0F
#define ACCEL_WHO_AM_I_VALUE 0x11
#define ACCEL_CTRL_REG1 0x20
#define ACCEL_CTRL_REG1_VALUE 0x57 /* 100 Hz, all axes */
#define ACCEL_CTRL_REG4 0x23
#define ACCEL_CTRL_REG4_VALUE 0x80 /* BDU, ±2 g */
#define ACCEL_STATUS_REG 0x27
#define ACCEL_OUT_X_L 0x28
#define ACCEL_HZ_MAX 20
#define NFC_ADDR 0x26
#define NFC_TIMEOUT_MS_MAX 10000

/* ---- Wire protocol (docs/HTNOS.md §5) --------------------------------- */
#define WIRE_TEXT_FRAME_MAX 1024
#define WIRE_FRAME_MAX 8192
#define WIRE_BLIT_FRAME_TYPE 0x01
/* Room for the largest binary frame plus slack; esp_websocket_client buffer. */
#define WIRE_RX_BUFFER (WIRE_FRAME_MAX + 1024)
#define WIRE_PING_INTERVAL_S 20
#define WIRE_RECONNECT_MIN_MS 2000
#define WIRE_RECONNECT_MAX_MS 30000

/* ---- NVS -------------------------------------------------------------- */
#define NVS_NAMESPACE "htnos"
#define NVS_KEY_SSID "ssid"
#define NVS_KEY_PASS "pass"
#define NVS_KEY_ID "id"
#define NVS_KEY_TOKEN "tok"
#define NVS_KEY_APPKEY "key"
#define NVS_KEY_SERVER "srv"

/* ---- Colours (RGB565) -------------------------------------------------- */
#define RGB565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
#define COL_BLACK RGB565(0, 0, 0)
#define COL_WHITE RGB565(0xED, 0xED, 0xED)
#define COL_MUTE RGB565(0xA3, 0xA3, 0xA3)
#define COL_FAINT RGB565(0x7A, 0x7A, 0x7A)
#define COL_RAISE RGB565(0x11, 0x11, 0x11)
#define COL_RULE RGB565(0x33, 0x33, 0x33)
#define COL_ACCENT RGB565(0x99, 0x45, 0xFF) /* Solana purple */
#define COL_GREEN RGB565(0x14, 0xF1, 0x95)
#define COL_AMBER RGB565(0xFF, 0xB6, 0x48)
#define COL_RED RGB565(0xFF, 0x5C, 0x5C)
