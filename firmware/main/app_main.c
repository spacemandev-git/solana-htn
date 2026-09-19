#include "esp_err.h"
#include "esp_log.h"
#include "hal_accel.h"
#include "hal_buttons.h"
#include "hal_display.h"
#include "hal_i2c.h"
#include "hal_leds.h"
#include "link.h"
#include "nvs_flash.h"
#include "settings.h"
#include "ui.h"
#include "wifi.h"

void app_main(void)
{
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        result = nvs_flash_init();
    }
    ESP_ERROR_CHECK(result);
    settings_load();
    display_init();
    buttons_init();
    leds_init();
    leds_clear();
    i2c_bus_init();
    if (!accel_init()) {
        ESP_LOGW("app_main", "accelerometer not detected; continuing");
    }
    ui_start();
    wifi_init();
    link_init();
}
