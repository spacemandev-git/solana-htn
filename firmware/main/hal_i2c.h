#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

void i2c_bus_init(void);
esp_err_t i2c_write_reg(uint8_t addr, uint8_t reg, uint8_t value);
esp_err_t i2c_read_regs(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len);
