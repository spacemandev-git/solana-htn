#include "hal_nfc.h"

#include <string.h>

#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "hal_i2c.h"
#include "htnos.h"

enum {
    REG_COMMAND = 0x01,
    REG_COM_IRQ = 0x04,
    REG_DIV_IRQ = 0x05,
    REG_ERROR = 0x06,
    REG_FIFO_DATA = 0x09,
    REG_FIFO_LEVEL = 0x0a,
    REG_CONTROL = 0x0c,
    REG_BIT_FRAMING = 0x0d,
    REG_COLL = 0x0e,
    REG_MODE = 0x11,
    REG_TX_CONTROL = 0x14,
    REG_TX_ASK = 0x15,
    REG_CRC_RESULT_H = 0x21,
    REG_CRC_RESULT_L = 0x22,
    REG_T_MODE = 0x2a,
    REG_T_PRESCALER = 0x2b,
    REG_T_RELOAD_H = 0x2c,
    REG_T_RELOAD_L = 0x2d,
};

enum {
    CMD_IDLE = 0x00,
    CMD_CALC_CRC = 0x03,
    CMD_TRANSCEIVE = 0x0c,
    CMD_SOFT_RESET = 0x0f,
};

static bool reg_write(uint8_t reg, uint8_t value)
{
    return i2c_write_reg(NFC_ADDR, reg, value) == ESP_OK;
}

static bool reg_read(uint8_t reg, uint8_t *value)
{
    return i2c_read_regs(NFC_ADDR, reg, value, 1) == ESP_OK;
}

static bool set_bits(uint8_t reg, uint8_t bits)
{
    uint8_t value;
    return reg_read(reg, &value) && reg_write(reg, value | bits);
}

static bool clear_bits(uint8_t reg, uint8_t bits)
{
    uint8_t value;
    return reg_read(reg, &value) && reg_write(reg, value & (uint8_t)~bits);
}

static bool calculate_crc(const uint8_t *data, size_t len, uint8_t crc[2])
{
    if (!reg_write(REG_COMMAND, CMD_IDLE) || !reg_write(REG_DIV_IRQ, 0x04) ||
        !set_bits(REG_FIFO_LEVEL, 0x80)) {
        return false;
    }
    for (size_t i = 0; i < len; ++i) {
        if (!reg_write(REG_FIFO_DATA, data[i])) {
            return false;
        }
    }
    if (!reg_write(REG_COMMAND, CMD_CALC_CRC)) {
        return false;
    }
    const int64_t deadline = esp_timer_get_time() + 50000;
    uint8_t irq = 0;
    while (esp_timer_get_time() < deadline) {
        if (!reg_read(REG_DIV_IRQ, &irq)) {
            return false;
        }
        if ((irq & 0x04) != 0) {
            return reg_read(REG_CRC_RESULT_L, &crc[0]) && reg_read(REG_CRC_RESULT_H, &crc[1]);
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    return false;
}

static bool transceive(const uint8_t *send, size_t send_len, uint8_t tx_last_bits,
                       uint8_t *reply, size_t reply_capacity, size_t *reply_len)
{
    if (!reg_write(REG_COMMAND, CMD_IDLE) || !reg_write(REG_COM_IRQ, 0x7f) ||
        !set_bits(REG_FIFO_LEVEL, 0x80) || !reg_write(REG_BIT_FRAMING, tx_last_bits)) {
        return false;
    }
    for (size_t i = 0; i < send_len; ++i) {
        if (!reg_write(REG_FIFO_DATA, send[i])) {
            return false;
        }
    }
    if (!reg_write(REG_COMMAND, CMD_TRANSCEIVE) || !set_bits(REG_BIT_FRAMING, 0x80)) {
        return false;
    }

    const int64_t deadline = esp_timer_get_time() + 50000;
    uint8_t irq = 0;
    do {
        if (!reg_read(REG_COM_IRQ, &irq)) {
            return false;
        }
        if ((irq & 0x30) != 0) {
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    } while (esp_timer_get_time() < deadline);
    (void)clear_bits(REG_BIT_FRAMING, 0x80);
    if ((irq & 0x30) == 0) {
        return false;
    }
    uint8_t error;
    if (!reg_read(REG_ERROR, &error) || (error & 0x13) != 0) {
        return false;
    }
    uint8_t fifo_count;
    uint8_t control;
    if (!reg_read(REG_FIFO_LEVEL, &fifo_count) || !reg_read(REG_CONTROL, &control)) {
        return false;
    }
    const uint8_t last_bits = control & 0x07;
    const size_t bytes = fifo_count;
    if (bytes > reply_capacity) {
        return false;
    }
    for (size_t i = 0; i < bytes; ++i) {
        if (!reg_read(REG_FIFO_DATA, &reply[i])) {
            return false;
        }
    }
    *reply_len = bytes;
    if (last_bits != 0 && bytes > 0) {
        *reply_len = bytes;
    }
    return true;
}

static bool request_a(void)
{
    const uint8_t command = 0x26;
    uint8_t answer[2];
    size_t answer_len = 0;
    return transceive(&command, 1, 0x07, answer, sizeof(answer), &answer_len) && answer_len == 2;
}

static bool anticollision(uint8_t cascade, uint8_t result[5])
{
    const uint8_t command[2] = {cascade, 0x20};
    size_t result_len = 0;
    if (!reg_write(REG_COLL, 0x80) ||
        !transceive(command, sizeof(command), 0, result, 5, &result_len) || result_len != 5) {
        return false;
    }
    return (uint8_t)(result[0] ^ result[1] ^ result[2] ^ result[3]) == result[4];
}

static bool select_level(uint8_t cascade, const uint8_t uid_part[5], uint8_t *sak)
{
    uint8_t frame[9] = {cascade, 0x70};
    memcpy(&frame[2], uid_part, 5);
    if (!calculate_crc(frame, 7, &frame[7])) {
        return false;
    }
    uint8_t answer[3];
    size_t answer_len = 0;
    if (!transceive(frame, sizeof(frame), 0, answer, sizeof(answer), &answer_len) || answer_len != 3) {
        return false;
    }
    *sak = answer[0];
    return true;
}

static bool reader_start(void)
{
    if (!reg_write(REG_COMMAND, CMD_SOFT_RESET)) {
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(50));
    if (!reg_write(REG_T_MODE, 0x8d) || !reg_write(REG_T_PRESCALER, 0x3e) ||
        !reg_write(REG_T_RELOAD_L, 30) || !reg_write(REG_T_RELOAD_H, 0) ||
        !reg_write(REG_TX_ASK, 0x40) || !reg_write(REG_MODE, 0x3d)) {
        return false;
    }
    uint8_t tx_control;
    return reg_read(REG_TX_CONTROL, &tx_control) &&
           reg_write(REG_TX_CONTROL, (uint8_t)(tx_control | 0x03));
}

static void reader_stop(void)
{
    (void)clear_bits(REG_TX_CONTROL, 0x03);
    (void)reg_write(REG_COMMAND, 0x10);
}

bool nfc_scan(uint32_t timeout_ms, uint8_t uid[10], uint8_t *uid_len)
{
    if (uid == NULL || uid_len == NULL) {
        return false;
    }
    *uid_len = 0;
    if (timeout_ms > NFC_TIMEOUT_MS_MAX) {
        timeout_ms = NFC_TIMEOUT_MS_MAX;
    }
    if (!reader_start()) {
        reader_stop();
        return false;
    }

    bool found = false;
    const int64_t deadline = esp_timer_get_time() + (int64_t)timeout_ms * 1000;
    while (esp_timer_get_time() < deadline) {
        uint8_t level1[5];
        if (request_a() && anticollision(0x93, level1)) {
            uint8_t sak = 0;
            if (!select_level(0x93, level1, &sak)) {
                break;
            }
            if (level1[0] == 0x88 || (sak & 0x04) != 0) {
                uint8_t level2[5];
                if (!anticollision(0x95, level2) || !select_level(0x95, level2, &sak)) {
                    break;
                }
                memcpy(uid, &level1[1], 3);
                memcpy(&uid[3], level2, 4);
                *uid_len = 7;
            } else {
                memcpy(uid, level1, 4);
                *uid_len = 4;
            }
            found = true;
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    reader_stop();
    return found;
}
