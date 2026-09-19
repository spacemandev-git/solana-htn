#include "hal_accel.h"

#include "hal_i2c.h"
#include "htnos.h"

bool accel_init(void)
{
    uint8_t who = 0;
    if (i2c_read_regs(ACCEL_ADDR, ACCEL_WHO_AM_I_REG, &who, 1) != ESP_OK || who != ACCEL_WHO_AM_I_VALUE) {
        return false;
    }
    return i2c_write_reg(ACCEL_ADDR, ACCEL_CTRL_REG1, ACCEL_CTRL_REG1_VALUE) == ESP_OK &&
           i2c_write_reg(ACCEL_ADDR, ACCEL_CTRL_REG4, ACCEL_CTRL_REG4_VALUE) == ESP_OK;
}

bool accel_read(int16_t *x_mg, int16_t *y_mg, int16_t *z_mg)
{
    if (x_mg == NULL || y_mg == NULL || z_mg == NULL) {
        return false;
    }
    uint8_t data[6];
    if (i2c_read_regs(ACCEL_ADDR, ACCEL_OUT_X_L | 0x80, data, sizeof(data)) != ESP_OK) {
        return false;
    }
    const int16_t x = (int16_t)((uint16_t)data[0] | ((uint16_t)data[1] << 8));
    const int16_t y = (int16_t)((uint16_t)data[2] | ((uint16_t)data[3] << 8));
    const int16_t z = (int16_t)((uint16_t)data[4] | ((uint16_t)data[5] << 8));
    *x_mg = (int16_t)(x >> 4);
    *y_mg = (int16_t)(y >> 4);
    *z_mg = (int16_t)(z >> 4);
    return true;
}
