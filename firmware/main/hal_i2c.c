#include "hal_i2c.h"

#include <assert.h>

#include "driver/i2c_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "htnos.h"

static i2c_master_bus_handle_t s_bus;
static i2c_master_dev_handle_t s_accel;
static i2c_master_dev_handle_t s_nfc;
static SemaphoreHandle_t s_mutex;

static i2c_master_dev_handle_t device_for(uint8_t addr)
{
    if (addr == ACCEL_ADDR) {
        return s_accel;
    }
    if (addr == NFC_ADDR) {
        return s_nfc;
    }
    return NULL;
}

void i2c_bus_init(void)
{
    i2c_master_bus_config_t config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = PIN_I2C_SDA,
        .scl_io_num = PIN_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&config, &s_bus));
    i2c_device_config_t device = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .scl_speed_hz = I2C_HZ,
    };
    device.device_address = ACCEL_ADDR;
    ESP_ERROR_CHECK(i2c_master_bus_add_device(s_bus, &device, &s_accel));
    device.device_address = NFC_ADDR;
    ESP_ERROR_CHECK(i2c_master_bus_add_device(s_bus, &device, &s_nfc));
    s_mutex = xSemaphoreCreateMutex();
    assert(s_mutex != NULL);
}

esp_err_t i2c_write_reg(uint8_t addr, uint8_t reg, uint8_t value)
{
    i2c_master_dev_handle_t device = device_for(addr);
    if (device == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    const uint8_t data[2] = {reg, value};
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    const esp_err_t result = i2c_master_transmit(device, data, sizeof(data), I2C_TIMEOUT_MS);
    xSemaphoreGive(s_mutex);
    return result;
}

esp_err_t i2c_read_regs(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len)
{
    i2c_master_dev_handle_t device = device_for(addr);
    if (device == NULL || buf == NULL || len == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (len > 1) {
        reg |= 0x80;
    }
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    const esp_err_t result = i2c_master_transmit_receive(device, &reg, 1, buf, len, I2C_TIMEOUT_MS);
    xSemaphoreGive(s_mutex);
    return result;
}
