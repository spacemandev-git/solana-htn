#include "wifi.h"

#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "settings.h"
#include "ui.h"

static const char *TAG = "wifi";
static SemaphoreHandle_t s_lock;
static esp_netif_t *s_netif;
static wifi_status_t s_status = WIFI_OFF;
static char s_ssid[HTNOS_SSID_MAX + 1];
static char s_pass[HTNOS_PASS_MAX + 1];
static char s_ip[16];
static int s_rssi;
static unsigned s_attempts;
static bool s_started;

static void event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xSemaphoreTake(s_lock, portMAX_DELAY);
        s_ip[0] = '\0';
        ++s_attempts;
        const bool retry = s_ssid[0] != '\0' && s_attempts < 4;
        s_status = retry ? WIFI_CONNECTING : (s_ssid[0] != '\0' ? WIFI_FAILED : WIFI_OFF);
        xSemaphoreGive(s_lock);
        if (retry) {
            ESP_LOGW(TAG, "connection dropped, retry %u/4", s_attempts + 1);
            esp_wifi_connect();
        }
        ui_refresh();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = data;
        char ip[16];
        snprintf(ip, sizeof(ip), IPSTR, IP2STR(&event->ip_info.ip));
        wifi_ap_record_t record;
        int rssi = 0;
        if (esp_wifi_sta_get_ap_info(&record) == ESP_OK) {
            rssi = record.rssi;
        }
        xSemaphoreTake(s_lock, portMAX_DELAY);
        strlcpy(s_ip, ip, sizeof(s_ip));
        s_rssi = rssi;
        s_attempts = 0;
        s_status = WIFI_CONNECTED;
        xSemaphoreGive(s_lock);
        ESP_LOGI(TAG, "connected, IP %s", ip);
        ui_refresh();
    }
}

void wifi_init(void)
{
    s_lock = xSemaphoreCreateMutex();
    configASSERT(s_lock != NULL);
    ESP_ERROR_CHECK(esp_netif_init());
    esp_err_t result = esp_event_loop_create_default();
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(result);
    }
    s_netif = esp_netif_create_default_wifi_sta();
    configASSERT(s_netif != NULL);
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, event_handler, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());
    s_started = true;
    if (settings()->ssid[0] != '\0') {
        wifi_connect(settings()->ssid, settings()->pass);
    }
}

static int compare_ap(const void *left, const void *right)
{
    const wifi_ap_t *a = left;
    const wifi_ap_t *b = right;
    return (int)b->rssi - (int)a->rssi;
}

int wifi_scan(wifi_ap_t *out, int max)
{
    if (out == NULL || max <= 0 || !s_started) {
        return 0;
    }
    wifi_scan_config_t config = {
        .scan_type = WIFI_SCAN_TYPE_ACTIVE,
        .show_hidden = false,
    };
    esp_err_t result = esp_wifi_scan_start(&config, true);
    if (result != ESP_OK) {
        ESP_LOGW(TAG, "scan failed: %s", esp_err_to_name(result));
        return 0;
    }
    uint16_t count = 0;
    ESP_ERROR_CHECK(esp_wifi_scan_get_ap_num(&count));
    if (count == 0) {
        return 0;
    }
    wifi_ap_record_t *records = calloc(count, sizeof(*records));
    if (records == NULL) {
        return 0;
    }
    uint16_t fetched = count;
    result = esp_wifi_scan_get_ap_records(&fetched, records);
    if (result != ESP_OK) {
        free(records);
        return 0;
    }
    int used = 0;
    for (uint16_t i = 0; i < fetched && used < max; ++i) {
        if (records[i].ssid[0] == '\0') {
            continue;
        }
        int existing = -1;
        for (int j = 0; j < used; ++j) {
            if (strcmp(out[j].ssid, (const char *)records[i].ssid) == 0) {
                existing = j;
                break;
            }
        }
        const bool secured = records[i].authmode != WIFI_AUTH_OPEN;
        if (existing >= 0) {
            if (records[i].rssi > out[existing].rssi) {
                out[existing].rssi = records[i].rssi;
                out[existing].secured = secured;
            }
            continue;
        }
        strlcpy(out[used].ssid, (const char *)records[i].ssid, sizeof(out[used].ssid));
        out[used].rssi = records[i].rssi;
        out[used].secured = secured;
        ++used;
    }
    free(records);
    qsort(out, used, sizeof(*out), compare_ap);
    return used;
}

void wifi_connect(const char *ssid, const char *pass)
{
    if (!s_started || ssid == NULL) {
        return;
    }
    wifi_config_t config = {0};
    strlcpy((char *)config.sta.ssid, ssid, sizeof(config.sta.ssid));
    strlcpy((char *)config.sta.password, pass != NULL ? pass : "", sizeof(config.sta.password));
    config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    strlcpy(s_ssid, ssid, sizeof(s_ssid));
    strlcpy(s_pass, pass != NULL ? pass : "", sizeof(s_pass));
    s_attempts = 0;
    s_ip[0] = '\0';
    s_status = WIFI_CONNECTING;
    xSemaphoreGive(s_lock);
    (void)esp_wifi_disconnect();
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &config));
    ESP_ERROR_CHECK(esp_wifi_connect());
    ui_refresh();
}

void wifi_forget(void)
{
    settings_set_wifi("", "");
    if (!s_started || s_lock == NULL) {
        return;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_ssid[0] = '\0';
    s_pass[0] = '\0';
    s_ip[0] = '\0';
    s_attempts = 0;
    s_status = WIFI_OFF;
    xSemaphoreGive(s_lock);
    (void)esp_wifi_disconnect();
    ui_refresh();
}

wifi_status_t wifi_status(void)
{
    if (s_lock == NULL) {
        return WIFI_OFF;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const wifi_status_t status = s_status;
    xSemaphoreGive(s_lock);
    return status;
}

void wifi_ip_str(char *buf, size_t len)
{
    if (buf == NULL || len == 0) {
        return;
    }
    if (s_lock == NULL) {
        buf[0] = '\0';
        return;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    strlcpy(buf, s_ip, len);
    xSemaphoreGive(s_lock);
}

int wifi_rssi(void)
{
    if (s_lock == NULL) {
        return 0;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const int rssi = s_rssi;
    xSemaphoreGive(s_lock);
    return rssi;
}
