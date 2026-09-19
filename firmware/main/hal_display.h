#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "fonts.h"

/*
 * Flicker-free band renderer.
 *
 * The badge cannot afford a full framebuffer, so a screen (or any rectangle of
 * it) is composed one LCD_STRIPE_ROWS-row band at a time inside a DMA stripe
 * buffer and pushed to the panel while the next band is being drawn in the
 * other stripe. Nothing half-drawn ever reaches the glass, which is what
 * removes the clear-then-redraw flash of a glyph-by-glyph painter.
 *
 * A paint callback draws in *screen* coordinates with the gfx_* primitives;
 * the band clips. It runs once per band, so it must be a pure function of the
 * UI state: no side effects, no I/O, no display_* calls.
 */
typedef struct gfx gfx_t;
typedef void (*paint_fn_t)(gfx_t *g, void *ctx);

void display_init(void);

/* Compose and push the rectangle x,y,w,h (clipped to the screen). Every
   display_* call is serialized by an internal mutex. */
void display_render(int x, int y, int w, int h, paint_fn_t paint, void *ctx);

/* Primitives, valid only inside a paint callback. All clip to the band. */
void gfx_fill(gfx_t *g, uint16_t color);                              /* the whole render rectangle */
void gfx_rect(gfx_t *g, int x, int y, int w, int h, uint16_t color);  /* filled */
void gfx_frame(gfx_t *g, int x, int y, int w, int h, uint16_t color); /* 1 px outline */
void gfx_text(gfx_t *g, int x, int y, const char *s, font_t font, uint16_t fg); /* transparent background */
void gfx_text_bg(gfx_t *g, int x, int y, const char *s, font_t font, uint16_t fg, uint16_t bg);
void gfx_blit(gfx_t *g, int x, int y, int w, int h, const uint8_t *rgb565_be);

/* Text metrics, no drawing. '\n' starts a new line at the same x; characters
   outside 0x20..0x7E render as '?'. */
int font_height(font_t font);
int font_text_width(font_t font, const char *s); /* widest line, px */

/* Immediate-mode helpers for the remote protocol, built on display_render so
   each call is a single composed update. */
void display_fill(uint16_t color);
void display_fill_rect(int x, int y, int w, int h, uint16_t color);
/* Paints bg behind the text's bounding box, then the text, in one pass. */
void display_text(int x, int y, const char *s, font_t font, uint16_t fg, uint16_t bg);
/* Pixels already in panel byte order (big-endian RGB565), w*h*2 bytes. */
void display_blit(int x, int y, int w, int h, const uint8_t *rgb565_be);
