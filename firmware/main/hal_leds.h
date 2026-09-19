#pragma once

#include <stdint.h>

void leds_init(void);
void leds_set(int i, uint8_t r, uint8_t g, uint8_t b);
void leds_show(void);
void leds_clear(void);
