#include "hal_buttons.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/task.h"

static const char *TAG = "hal_buttons";
static const char *const s_names[BTN_COUNT] = BUTTON_NAMES;
static QueueHandle_t s_queue;
static portMUX_TYPE s_state_lock = portMUX_INITIALIZER_UNLOCKED;
static uint16_t s_state;

static uint16_t read_raw(void)
{
    uint16_t state = 0;
    gpio_set_level(PIN_HC165_LOAD, 0);
    esp_rom_delay_us(1);
    gpio_set_level(PIN_HC165_LOAD, 1);
    esp_rom_delay_us(1);
    for (int i = 0; i < 8; ++i) {
        if (gpio_get_level(PIN_HC165_DATA) == 0) {
            state |= (uint16_t)(1U << i);
        }
        gpio_set_level(PIN_HC165_CLK, 1);
        esp_rom_delay_us(1);
        gpio_set_level(PIN_HC165_CLK, 0);
        esp_rom_delay_us(1);
    }
    if (gpio_get_level(PIN_BTN_START) == 0) {
        state |= (uint16_t)(1U << BTN_START);
    }
    return state;
}

static void poll_task(void *arg)
{
    (void)arg;
    uint16_t candidate = read_raw();
    uint16_t stable = candidate;
    unsigned samples = BUTTON_DEBOUNCE_SAMPLES;
    portENTER_CRITICAL(&s_state_lock);
    s_state = stable;
    portEXIT_CRITICAL(&s_state_lock);

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(BUTTON_POLL_MS));
        const uint16_t raw = read_raw();
        if (raw == candidate) {
            if (samples < BUTTON_DEBOUNCE_SAMPLES) {
                ++samples;
            }
        } else {
            candidate = raw;
            samples = 1;
        }
        if (samples < BUTTON_DEBOUNCE_SAMPLES || candidate == stable) {
            continue;
        }
        const uint16_t changed = stable ^ candidate;
        stable = candidate;
        portENTER_CRITICAL(&s_state_lock);
        s_state = stable;
        portEXIT_CRITICAL(&s_state_lock);
        for (int i = 0; i < BTN_COUNT; ++i) {
            if ((changed & (1U << i)) != 0) {
                button_event_t event = {
                    .btn = (button_t)i,
                    .pressed = (stable & (1U << i)) != 0,
                };
                (void)xQueueSend(s_queue, &event, 0);
            }
        }
    }
}

void buttons_init(void)
{
    gpio_config_t outputs = {
        .pin_bit_mask = (1ULL << PIN_HC165_LOAD) | (1ULL << PIN_HC165_CLK),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&outputs));
    gpio_set_level(PIN_HC165_LOAD, 1);
    gpio_set_level(PIN_HC165_CLK, 0);
    gpio_config_t inputs = {
        .pin_bit_mask = (1ULL << PIN_HC165_DATA) | (1ULL << PIN_BTN_START),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&inputs));
    s_queue = xQueueCreate(16, sizeof(button_event_t));
    configASSERT(s_queue != NULL);
    BaseType_t created = xTaskCreate(poll_task, "buttons", 2048, NULL, 8, NULL);
    configASSERT(created == pdPASS);
    ESP_LOGI(TAG, "button poll started");
}

QueueHandle_t buttons_queue(void)
{
    return s_queue;
}

uint16_t buttons_state(void)
{
    portENTER_CRITICAL(&s_state_lock);
    const uint16_t state = s_state;
    portEXIT_CRITICAL(&s_state_lock);
    return state;
}

const char *button_name(button_t b)
{
    return (b >= 0 && b < BTN_COUNT) ? s_names[b] : "?";
}
