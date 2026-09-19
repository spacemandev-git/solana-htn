#pragma once

#include <stdbool.h>
#include <stdint.h>

bool accel_init(void);
bool accel_read(int16_t *x_mg, int16_t *y_mg, int16_t *z_mg);
