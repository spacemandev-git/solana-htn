/* Bitmap fonts for HTN OS: Spleen by Frederic Cambus (BSD 2-Clause), converted from the BDF
 * sources at https://github.com/fcambus/spleen by scripts/bdf2c.py. Do not edit by hand.
 *
 * Copyright (c) 2018-2026, Frederic Cambus
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 *   * Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 *
 *   * Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
#pragma once

#include <stdint.h>

typedef struct {
    uint8_t width;
    uint8_t height;
    uint8_t bytes_per_row;
    /* 95 glyphs for 0x20..0x7E, height*bytes_per_row bytes each, rows top to bottom;
       pixel x of a row is bit (7 - x%8) of byte x/8, so byte 0 bit 7 is the leftmost pixel. */
    const uint8_t *glyphs;
} font_info_t;

typedef enum {
    FONT_6X12,
    FONT_8X16,
    FONT_12X24,
    FONT_16X32,
    FONT_32X64,
    FONT_COUNT
} font_t;

extern const font_info_t FONTS[FONT_COUNT];
