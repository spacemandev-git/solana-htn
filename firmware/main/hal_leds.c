#include "hal_leds.h"

#include "esp_log.h"
#include "htnos.h"
#include "led_strip.h"

static const char *TAG = "hal_leds";
static led_strip_handle_t s_strip;

void leds_init(void)
{
    led_strip_config_t strip_config = {
        .strip_gpio_num = PIN_LED_DIN,
        .max_leds = LED_COUNT,
        .led_model = LED_MODEL_WS2812,
        .color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB,
        .flags.invert_out = false,
    };
    led_strip_rmt_config_t rmt_config = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = LED_RMT_HZ,
        .mem_block_symbols = 0,
        .flags.with_dma = false,
    };
    ESP_ERROR_CHECK(led_strip_new_rmt_device(&strip_config, &rmt_config, &s_strip));
    leds_clear();
    ESP_LOGI(TAG, "%d LEDs ready", LED_COUNT);
}

static uint8_t cap(uint8_t value)
{
    return (uint8_t)(((uint16_t)value * LED_CHANNEL_CAP) / 255U);
}

void leds_set(int i, uint8_t r, uint8_t g, uint8_t b)
{
    if (i < 0 || i >= LED_COUNT || s_strip == NULL) {
        return;
    }
    ESP_ERROR_CHECK(led_strip_set_pixel(s_strip, i, cap(r), cap(g), cap(b)));
}

void leds_show(void)
{
    if (s_strip != NULL) {
        ESP_ERROR_CHECK(led_strip_refresh(s_strip));
    }
}

void leds_clear(void)
{
    if (s_strip != NULL) {
        ESP_ERROR_CHECK(led_strip_clear(s_strip));
    }
}
