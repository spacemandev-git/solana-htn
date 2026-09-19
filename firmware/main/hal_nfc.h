#pragma once

#include <stdbool.h>
#include <stdint.h>

bool nfc_scan(uint32_t timeout_ms, uint8_t uid[10], uint8_t *uid_len);
