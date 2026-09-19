#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "htnos.h"

typedef struct {
    button_t btn;
    bool pressed;
} button_event_t;

void buttons_init(void);
QueueHandle_t buttons_queue(void);
uint16_t buttons_state(void);
const char *button_name(button_t b);
