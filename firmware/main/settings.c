#include "settings.h"

#include <string.h>

#include "esp_log.h"
#include "nvs.h"

static const char *TAG = "settings";
static settings_t s_settings;
static nvs_handle_t s_nvs;

static void copy_text(char *dst, size_t capacity, const char *src)
{
    if (capacity == 0) {
        return;
    }
    if (src == NULL) {
        src = "";
    }
    strlcpy(dst, src, capacity);
}

static void load_text(const char *key, char *dst, size_t capacity)
{
    size_t size = capacity;
    esp_err_t result = nvs_get_str(s_nvs, key, dst, &size);
    if (result != ESP_OK) {
        dst[0] = '\0';
        if (result != ESP_ERR_NVS_NOT_FOUND) {
            ESP_LOGW(TAG, "could not read %s: %s", key, esp_err_to_name(result));
        }
    }
}

static void store_text(const char *key, const char *value)
{
    esp_err_t result = nvs_set_str(s_nvs, key, value);
    if (result == ESP_OK) {
        result = nvs_commit(s_nvs);
    }
    if (result != ESP_OK) {
        ESP_LOGE(TAG, "could not store %s: %s", key, esp_err_to_name(result));
    }
}

void settings_load(void)
{
    memset(&s_settings, 0, sizeof(s_settings));
    ESP_ERROR_CHECK(nvs_open(NVS_NAMESPACE, NVS_READWRITE, &s_nvs));
    load_text(NVS_KEY_SSID, s_settings.ssid, sizeof(s_settings.ssid));
    load_text(NVS_KEY_PASS, s_settings.pass, sizeof(s_settings.pass));
    load_text(NVS_KEY_ID, s_settings.id, sizeof(s_settings.id));
    load_text(NVS_KEY_TOKEN, s_settings.token, sizeof(s_settings.token));
    load_text(NVS_KEY_APPKEY, s_settings.key, sizeof(s_settings.key));
    load_text(NVS_KEY_SERVER, s_settings.server, sizeof(s_settings.server));
    if (s_settings.server[0] == '\0') {
        copy_text(s_settings.server, sizeof(s_settings.server), HTNOS_DEFAULT_SERVICE_URL);
    }
    ESP_LOGI(TAG, "settings loaded%s", s_settings.id[0] != '\0' ? " with identity" : "");
}

const settings_t *settings(void)
{
    return &s_settings;
}

void settings_set_wifi(const char *ssid, const char *pass)
{
    copy_text(s_settings.ssid, sizeof(s_settings.ssid), ssid);
    copy_text(s_settings.pass, sizeof(s_settings.pass), pass);
    store_text(NVS_KEY_SSID, s_settings.ssid);
    store_text(NVS_KEY_PASS, s_settings.pass);
}

void settings_set_identity(const char *id, const char *token)
{
    copy_text(s_settings.id, sizeof(s_settings.id), id);
    store_text(NVS_KEY_ID, s_settings.id);
    if (token != NULL) {
        copy_text(s_settings.token, sizeof(s_settings.token), token);
        store_text(NVS_KEY_TOKEN, s_settings.token);
    }
}

void settings_clear_identity(void)
{
    s_settings.id[0] = '\0';
    s_settings.token[0] = '\0';
    store_text(NVS_KEY_ID, "");
    store_text(NVS_KEY_TOKEN, "");
}

void settings_set_key(const char *key)
{
    copy_text(s_settings.key, sizeof(s_settings.key), key);
    store_text(NVS_KEY_APPKEY, s_settings.key);
}

void settings_set_server(const char *url)
{
    copy_text(s_settings.server, sizeof(s_settings.server), url);
    if (s_settings.server[0] == '\0') {
        copy_text(s_settings.server, sizeof(s_settings.server), HTNOS_DEFAULT_SERVICE_URL);
    }
    store_text(NVS_KEY_SERVER, s_settings.server);
}
