#include "link.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "hal_accel.h"
#include "hal_buttons.h"
#include "hal_display.h"
#include "hal_leds.h"
#include "hal_nfc.h"
#include "settings.h"
#include "ui.h"
#include "wifi.h"

static const char *TAG = "link";
static esp_websocket_client_handle_t s_client;
static esp_timer_handle_t s_reconnect_timer;
static esp_timer_handle_t s_accel_timer;
static SemaphoreHandle_t s_send_mutex;
static portMUX_TYPE s_state_lock = portMUX_INITIALIZER_UNLOCKED;
static link_status_t s_status = LINK_OFF;
static uint32_t s_backoff_ms = WIRE_RECONNECT_MIN_MS;
static bool s_client_started;
static int s_stream_hz;
static uint8_t s_frame[WIRE_FRAME_MAX + 1];
static size_t s_message_len;
static size_t s_fragment_base;
static size_t s_fragment_len;
static uint8_t s_frame_opcode;
static bool s_frame_dropped;

static void set_status(link_status_t status)
{
    portENTER_CRITICAL(&s_state_lock);
    s_status = status;
    portEXIT_CRITICAL(&s_state_lock);
    ui_refresh();
}

link_status_t link_status(void)
{
    portENTER_CRITICAL(&s_state_lock);
    const link_status_t status = s_status;
    portEXIT_CRITICAL(&s_state_lock);
    return status;
}

static bool online(void)
{
    return s_client != NULL && link_status() == LINK_ONLINE && esp_websocket_client_is_connected(s_client);
}

static void send_text_owned(char *text)
{
    if (text == NULL) {
        return;
    }
    if (online()) {
        xSemaphoreTake(s_send_mutex, portMAX_DELAY);
        (void)esp_websocket_client_send_text(s_client, text, (int)strlen(text), pdMS_TO_TICKS(1000));
        xSemaphoreGive(s_send_mutex);
    }
    free(text);
}

static void send_json(cJSON *root)
{
    if (root == NULL) {
        return;
    }
    char *text = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    send_text_owned(text);
}

static cJSON *message(const char *type)
{
    cJSON *root = cJSON_CreateObject();
    if (root != NULL) {
        cJSON_AddStringToObject(root, "t", type);
    }
    return root;
}

static void send_hello(void)
{
    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_BASE));
    char mac_text[13];
    snprintf(mac_text, sizeof(mac_text), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    cJSON *root = message("hello");
    if (root == NULL) {
        return;
    }
    cJSON_AddNumberToObject(root, "v", HTNOS_PROTOCOL_VERSION);
    cJSON_AddStringToObject(root, "mac", mac_text);
    cJSON_AddStringToObject(root, "fw", HTNOS_VERSION);
    const settings_t *config = settings();
    if (config->id[0] != '\0' && config->token[0] != '\0') {
        cJSON_AddStringToObject(root, "id", config->id);
        cJSON_AddStringToObject(root, "tok", config->token);
    }
    if (config->key[0] != '\0') {
        cJSON_AddStringToObject(root, "key", config->key);
    }
    send_json(root);
}

void link_send_mode(bool canvas)
{
    cJSON *root = message("mode");
    if (root != NULL) {
        cJSON_AddStringToObject(root, "m", canvas ? "canvas" : "menu");
    }
    send_json(root);
}

void link_send_key(void)
{
    cJSON *root = message("key");
    if (root != NULL) {
        cJSON_AddStringToObject(root, "k", settings()->key);
    }
    send_json(root);
}

void link_send_button(button_t b, bool pressed)
{
    cJSON *root = message("btn");
    if (root != NULL) {
        cJSON_AddStringToObject(root, "n", button_name(b));
        cJSON_AddNumberToObject(root, "p", pressed ? 1 : 0);
    }
    send_json(root);
}

static void send_accel_event(void)
{
    int16_t x;
    int16_t y;
    int16_t z;
    if (!online() || !accel_read(&x, &y, &z)) {
        return;
    }
    cJSON *root = message("accel");
    if (root != NULL) {
        cJSON_AddNumberToObject(root, "x", x);
        cJSON_AddNumberToObject(root, "y", y);
        cJSON_AddNumberToObject(root, "z", z);
    }
    send_json(root);
}

static void accel_timer_cb(void *arg)
{
    (void)arg;
    send_accel_event();
}

static void stop_accel_timer(bool clear_rate)
{
    if (s_accel_timer != NULL) {
        (void)esp_timer_stop(s_accel_timer);
    }
    if (clear_rate) {
        s_stream_hz = 0;
    }
}

void link_stop_accel_stream(void)
{
    stop_accel_timer(true);
}

static void start_accel_stream(int hz)
{
    stop_accel_timer(true);
    if (hz < 1 || hz > ACCEL_HZ_MAX) {
        return;
    }
    s_stream_hz = hz;
    ESP_ERROR_CHECK(esp_timer_start_periodic(s_accel_timer, 1000000ULL / (uint64_t)hz));
}

static void schedule_reconnect(uint32_t delay_ms, bool grow)
{
    if (s_reconnect_timer == NULL) {
        return;
    }
    if (grow && esp_timer_is_active(s_reconnect_timer)) {
        return;
    }
    (void)esp_timer_stop(s_reconnect_timer);
    ESP_ERROR_CHECK(esp_timer_start_once(s_reconnect_timer, (uint64_t)delay_ms * 1000));
    if (grow) {
        const uint64_t next = (uint64_t)s_backoff_ms * 2;
        s_backoff_ms = next > WIRE_RECONNECT_MAX_MS ? WIRE_RECONNECT_MAX_MS : (uint32_t)next;
    }
}

static void reconnect_timer_cb(void *arg)
{
    (void)arg;
    if (wifi_status() != WIFI_CONNECTED) {
        set_status(LINK_OFF);
        schedule_reconnect(WIRE_RECONNECT_MIN_MS, false);
        return;
    }
    if (s_client == NULL || online()) {
        return;
    }
    if (s_client_started) {
        (void)esp_websocket_client_stop(s_client);
        s_client_started = false;
    }
    set_status(LINK_CONNECTING);
    const esp_err_t result = esp_websocket_client_start(s_client);
    if (result == ESP_OK) {
        s_client_started = true;
    } else {
        ESP_LOGW(TAG, "WebSocket start failed: %s", esp_err_to_name(result));
        set_status(LINK_OFF);
        schedule_reconnect(s_backoff_ms, true);
    }
}

static int json_int(const cJSON *root, const char *name, int fallback)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, name);
    return cJSON_IsNumber(item) ? item->valueint : fallback;
}

typedef struct {
    int x;
    int y;
    const char *text;
    font_t font;
    uint16_t foreground;
    uint16_t background;
} clear_text_ctx_t;

static void paint_clear_text(gfx_t *g, void *ctx)
{
    const clear_text_ctx_t *text = ctx;
    gfx_fill(g, text->background);
    gfx_text(g, text->x, text->y, text->text, text->font, text->foreground);
}

static bool key_matches_bytes(const uint8_t *provided, size_t provided_len)
{
    const char *expected = settings()->key;
    const size_t expected_len = strnlen(expected, HTNOS_KEY_MAX + 1);
    if (expected_len == 0 || expected_len > HTNOS_KEY_MAX || provided == NULL) {
        return false;
    }
    const size_t count = expected_len > provided_len ? expected_len : provided_len;
    uint8_t difference = (uint8_t)(expected_len ^ provided_len);
    for (size_t i = 0; i < count; ++i) {
        const uint8_t a = i < expected_len ? (uint8_t)expected[i] : 0;
        const uint8_t b = i < provided_len ? provided[i] : 0;
        difference |= (uint8_t)(a ^ b);
    }
    return difference == 0;
}

static bool command_key_matches(const cJSON *root)
{
    const cJSON *key = cJSON_GetObjectItemCaseSensitive(root, "k");
    if (!cJSON_IsString(key) || key->valuestring == NULL) {
        return false;
    }
    const size_t len = strnlen(key->valuestring, WIRE_TEXT_FRAME_MAX);
    return key_matches_bytes((const uint8_t *)key->valuestring, len);
}

static void add_reply_id(cJSON *reply, const cJSON *command)
{
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(command, "i");
    if (id != NULL) {
        cJSON *copy = cJSON_Duplicate(id, true);
        if (copy != NULL) {
            cJSON_AddItemToObject(reply, "i", copy);
        }
    }
}

static void reply_buttons(const cJSON *command)
{
    cJSON *reply = message("r");
    cJSON *buttons = cJSON_CreateObject();
    if (reply == NULL || buttons == NULL) {
        cJSON_Delete(reply);
        cJSON_Delete(buttons);
        return;
    }
    add_reply_id(reply, command);
    const uint16_t state = buttons_state();
    for (int i = 0; i < BTN_COUNT; ++i) {
        cJSON_AddNumberToObject(buttons, button_name((button_t)i), (state & (1U << i)) != 0 ? 1 : 0);
    }
    cJSON_AddItemToObject(reply, "b", buttons);
    send_json(reply);
}

static void reply_accel(const cJSON *command)
{
    cJSON *reply = message("r");
    if (reply == NULL) {
        return;
    }
    add_reply_id(reply, command);
    int16_t x;
    int16_t y;
    int16_t z;
    if (accel_read(&x, &y, &z)) {
        cJSON_AddNumberToObject(reply, "x", x);
        cJSON_AddNumberToObject(reply, "y", y);
        cJSON_AddNumberToObject(reply, "z", z);
    } else {
        cJSON_AddStringToObject(reply, "err", "accel");
    }
    send_json(reply);
}

static void reply_nfc(const cJSON *command)
{
    int timeout = json_int(command, "ms", 3000);
    if (timeout < 0) {
        timeout = 0;
    } else if (timeout > NFC_TIMEOUT_MS_MAX) {
        timeout = NFC_TIMEOUT_MS_MAX;
    }
    const int resume_hz = s_stream_hz;
    stop_accel_timer(false);
    uint8_t uid[10];
    uint8_t uid_len = 0;
    const bool found = nfc_scan((uint32_t)timeout, uid, &uid_len);
    if (resume_hz > 0 && online()) {
        s_stream_hz = resume_hz;
        ESP_ERROR_CHECK(esp_timer_start_periodic(s_accel_timer, 1000000ULL / (uint64_t)resume_hz));
    }
    cJSON *reply = message("r");
    if (reply == NULL) {
        return;
    }
    add_reply_id(reply, command);
    if (found) {
        char text[21];
        for (uint8_t i = 0; i < uid_len; ++i) {
            snprintf(&text[i * 2], sizeof(text) - i * 2, "%02x", uid[i]);
        }
        text[uid_len * 2] = '\0';
        cJSON_AddStringToObject(reply, "uid", text);
    } else {
        cJSON_AddNullToObject(reply, "uid");
    }
    send_json(reply);
}

static void reply_info(const cJSON *command)
{
    char ip[16];
    wifi_ip_str(ip, sizeof(ip));
    cJSON *reply = message("r");
    if (reply == NULL) {
        return;
    }
    add_reply_id(reply, command);
    cJSON_AddStringToObject(reply, "fw", HTNOS_VERSION);
    cJSON_AddStringToObject(reply, "ip", ip);
    cJSON_AddNumberToObject(reply, "rssi", wifi_rssi());
    cJSON_AddNumberToObject(reply, "heap", esp_get_free_heap_size());
    cJSON_AddNumberToObject(reply, "up", (double)(esp_timer_get_time() / 1000000));
    cJSON_AddStringToObject(reply, "mode", ui_is_canvas() ? "canvas" : "menu");
    send_json(reply);
}

static void dispatch_command(cJSON *root)
{
    const cJSON *type_item = cJSON_GetObjectItemCaseSensitive(root, "t");
    if (!cJSON_IsString(type_item) || type_item->valuestring == NULL) {
        return;
    }
    const char *type = type_item->valuestring;
    if (strcmp(type, "welcome") == 0) {
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(root, "id");
        const cJSON *token = cJSON_GetObjectItemCaseSensitive(root, "tok");
        if (cJSON_IsString(id) && id->valuestring != NULL && strlen(id->valuestring) == HTNOS_ID_LENGTH) {
            const bool is_new = strcmp(settings()->id, id->valuestring) != 0;
            settings_set_identity(id->valuestring,
                                  cJSON_IsString(token) && token->valuestring != NULL ? token->valuestring : NULL);
            if (is_new) {
                char toast[32];
                snprintf(toast, sizeof(toast), "Registered %s", id->valuestring);
                ui_toast(toast);
            }
            ui_refresh();
            link_send_mode(ui_is_canvas());
            if (settings()->key[0] != '\0') {
                link_send_key();
            }
        }
        return;
    }
    if (strcmp(type, "err") == 0) {
        const cJSON *code = cJSON_GetObjectItemCaseSensitive(root, "c");
        if (cJSON_IsString(code) && code->valuestring != NULL) {
            if (strcmp(code->valuestring, "bad_token") == 0) {
                settings_clear_identity();
                ui_refresh();
                send_hello();
            } else if (strcmp(code->valuestring, "replaced") == 0 || strcmp(code->valuestring, "bad_hello") == 0) {
                set_status(LINK_OFF);
                stop_accel_timer(true);
                s_backoff_ms = WIRE_RECONNECT_MAX_MS;
                schedule_reconnect(WIRE_RECONNECT_MAX_MS, false);
            }
        }
        return;
    }
    if (!command_key_matches(root)) {
        ESP_LOGD(TAG, "dropping command with missing or mismatched key");
        return;
    }
    if (strcmp(type, "clear") == 0) {
        ui_enter_canvas();
        display_fill((uint16_t)json_int(root, "c", 0));
    } else if (strcmp(type, "text") == 0) {
        const cJSON *text = cJSON_GetObjectItemCaseSensitive(root, "s");
        if (cJSON_IsString(text) && text->valuestring != NULL) {
            int size = json_int(root, "z", 1);
            if (size < TEXT_SIZE_MIN) {
                size = TEXT_SIZE_MIN;
            } else if (size > TEXT_SIZE_MAX) {
                size = TEXT_SIZE_MAX;
            }
            const font_t font = TEXT_FONT_FOR_SIZE(size);
            const int x = json_int(root, "x", 0);
            const int y = json_int(root, "y", 0);
            const uint16_t foreground = (uint16_t)json_int(root, "c", COL_WHITE);
            const uint16_t background = (uint16_t)json_int(root, "b", 0);
            ui_enter_canvas();
            if (json_int(root, "cl", 0) == 1) {
                clear_text_ctx_t ctx = {
                    .x = x,
                    .y = y,
                    .text = text->valuestring,
                    .font = font,
                    .foreground = foreground,
                    .background = background,
                };
                display_render(0, 0, LCD_WIDTH, LCD_HEIGHT, paint_clear_text, &ctx);
            } else {
                display_text(x, y, text->valuestring, font, foreground, background);
            }
        }
    } else if (strcmp(type, "rect") == 0) {
        ui_enter_canvas();
        display_fill_rect(json_int(root, "x", 0), json_int(root, "y", 0),
                          json_int(root, "w", 0), json_int(root, "h", 0),
                          (uint16_t)json_int(root, "c", 0));
    } else if (strcmp(type, "leds") == 0) {
        const cJSON *list = cJSON_GetObjectItemCaseSensitive(root, "l");
        if (cJSON_IsArray(list) && cJSON_GetArraySize(list) == LED_COUNT) {
            for (int i = 0; i < LED_COUNT; ++i) {
                const cJSON *rgb = cJSON_GetArrayItem(list, i);
                if (cJSON_IsArray(rgb) && cJSON_GetArraySize(rgb) == 3) {
                    const cJSON *red = cJSON_GetArrayItem(rgb, 0);
                    const cJSON *green = cJSON_GetArrayItem(rgb, 1);
                    const cJSON *blue = cJSON_GetArrayItem(rgb, 2);
                    if (cJSON_IsNumber(red) && cJSON_IsNumber(green) && cJSON_IsNumber(blue)) {
                        leds_set(i, (uint8_t)red->valueint, (uint8_t)green->valueint, (uint8_t)blue->valueint);
                    }
                }
            }
            leds_show();
        }
    } else if (strcmp(type, "btn") == 0) {
        reply_buttons(root);
    } else if (strcmp(type, "accel") == 0) {
        reply_accel(root);
    } else if (strcmp(type, "accel_stream") == 0) {
        const int hz = json_int(root, "hz", 0);
        if (hz == 0) {
            link_stop_accel_stream();
        } else if (hz >= 1 && hz <= ACCEL_HZ_MAX) {
            start_accel_stream(hz);
        }
    } else if (strcmp(type, "nfc") == 0) {
        reply_nfc(root);
    } else if (strcmp(type, "info") == 0) {
        reply_info(root);
    } else if (strcmp(type, "home") == 0) {
        ui_leave_canvas();
    }
}

static void process_text(const uint8_t *data, size_t len)
{
    if (len > WIRE_TEXT_FRAME_MAX) {
        return;
    }
    char text[WIRE_TEXT_FRAME_MAX + 1];
    memcpy(text, data, len);
    text[len] = '\0';
    cJSON *root = cJSON_ParseWithLength(text, len);
    if (root != NULL && cJSON_IsObject(root)) {
        dispatch_command(root);
    }
    cJSON_Delete(root);
}

static uint16_t read_be16(const uint8_t *data)
{
    return (uint16_t)(((uint16_t)data[0] << 8) | data[1]);
}

static void process_binary(const uint8_t *data, size_t len)
{
    if (len < 2 || data[0] != WIRE_BLIT_FRAME_TYPE) {
        return;
    }
    const size_t key_len = data[1];
    const size_t header = 2 + key_len + 8;
    if (key_len < HTNOS_KEY_MIN || key_len > HTNOS_KEY_MAX || len < header || !key_matches_bytes(&data[2], key_len)) {
        return;
    }
    const uint8_t *geometry = &data[2 + key_len];
    const uint16_t x = read_be16(&geometry[0]);
    const uint16_t y = read_be16(&geometry[2]);
    const uint16_t w = read_be16(&geometry[4]);
    const uint16_t h = read_be16(&geometry[6]);
    const size_t pixels_len = (size_t)w * (size_t)h * 2;
    if (w == 0 || h == 0 || pixels_len > WIRE_FRAME_MAX || header + pixels_len != len) {
        return;
    }
    ui_enter_canvas();
    display_blit(x, y, w, h, &data[header]);
}

static void consume_data_event(const esp_websocket_event_data_t *event)
{
    if (event->op_code == 0x08 || event->op_code == 0x09 || event->op_code == 0x0a) {
        return;
    }
    if (event->payload_offset == 0) {
        if (event->op_code == 0x01 || event->op_code == 0x02) {
            s_message_len = 0;
            s_fragment_base = 0;
            s_frame_opcode = event->op_code;
            s_frame_dropped = false;
        } else if (event->op_code == 0x00 && s_frame_opcode != 0) {
            s_fragment_base = s_message_len;
        } else {
            s_frame_dropped = true;
        }
        s_fragment_len = event->payload_len > 0 ? (size_t)event->payload_len : (size_t)event->data_len;
        if (s_fragment_base + s_fragment_len > WIRE_FRAME_MAX) {
            s_frame_dropped = true;
        }
    }
    if (event->payload_offset < 0 || event->data_len < 0 ||
        (size_t)event->payload_offset + (size_t)event->data_len > s_fragment_len ||
        s_fragment_base + (size_t)event->payload_offset + (size_t)event->data_len > WIRE_FRAME_MAX) {
        s_frame_dropped = true;
    }
    if (!s_frame_dropped && event->data_len > 0) {
        memcpy(&s_frame[s_fragment_base + (size_t)event->payload_offset], event->data_ptr,
               (size_t)event->data_len);
    }
    if ((size_t)event->payload_offset + (size_t)event->data_len == s_fragment_len) {
        s_message_len = s_fragment_base + s_fragment_len;
        if (event->fin) {
            if (!s_frame_dropped) {
                if (s_frame_opcode == 0x01) {
                    process_text(s_frame, s_message_len);
                } else {
                    process_binary(s_frame, s_message_len);
                }
            }
            s_message_len = 0;
            s_fragment_base = 0;
            s_fragment_len = 0;
            s_frame_opcode = 0;
            s_frame_dropped = false;
        } else if (s_frame_dropped) {
            s_message_len = s_fragment_base + s_fragment_len;
        }
    }
}

static void websocket_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    esp_websocket_event_data_t *event = data;
    if (id == WEBSOCKET_EVENT_CONNECTED) {
        s_backoff_ms = WIRE_RECONNECT_MIN_MS;
        (void)esp_timer_stop(s_reconnect_timer);
        set_status(LINK_ONLINE);
        ESP_LOGI(TAG, "WebSocket connected");
        send_hello();
    } else if (id == WEBSOCKET_EVENT_DATA) {
        consume_data_event(event);
    } else if (id == WEBSOCKET_EVENT_DISCONNECTED || id == WEBSOCKET_EVENT_CLOSED) {
        s_client_started = false;
        set_status(LINK_OFF);
        stop_accel_timer(true);
        schedule_reconnect(s_backoff_ms, true);
        ESP_LOGW(TAG, "WebSocket disconnected");
    } else if (id == WEBSOCKET_EVENT_ERROR) {
        set_status(LINK_OFF);
        stop_accel_timer(true);
        schedule_reconnect(s_backoff_ms, true);
        ESP_LOGW(TAG, "WebSocket error");
    }
}

static void create_client(void)
{
    esp_websocket_client_config_t config = {
        .uri = settings()->server,
        .disable_auto_reconnect = true,
        .task_stack = 10240, /* TLS + cJSON + a 2 KB glyph buffer run on this task */
        .buffer_size = WIRE_RX_BUFFER,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .network_timeout_ms = 10000,
        .ping_interval_sec = WIRE_PING_INTERVAL_S,
    };
    s_client = esp_websocket_client_init(&config);
    configASSERT(s_client != NULL);
    ESP_ERROR_CHECK(esp_websocket_register_events(s_client, WEBSOCKET_EVENT_ANY, websocket_event, NULL));
}

void link_init(void)
{
    s_send_mutex = xSemaphoreCreateMutex();
    configASSERT(s_send_mutex != NULL);
    const esp_timer_create_args_t reconnect_args = {.callback = reconnect_timer_cb, .name = "link_reconnect"};
    ESP_ERROR_CHECK(esp_timer_create(&reconnect_args, &s_reconnect_timer));
    const esp_timer_create_args_t accel_args = {.callback = accel_timer_cb, .name = "accel_stream"};
    ESP_ERROR_CHECK(esp_timer_create(&accel_args, &s_accel_timer));
    create_client();
    schedule_reconnect(1, false);
}

void link_restart(void)
{
    if (s_reconnect_timer == NULL) {
        return;
    }
    link_stop_accel_stream();
    (void)esp_timer_stop(s_reconnect_timer);
    if (s_client != NULL) {
        if (s_client_started) {
            (void)esp_websocket_client_stop(s_client);
        }
        ESP_ERROR_CHECK(esp_websocket_client_destroy(s_client));
        s_client = NULL;
        s_client_started = false;
    }
    s_backoff_ms = WIRE_RECONNECT_MIN_MS;
    set_status(LINK_OFF);
    create_client();
    schedule_reconnect(1, false);
}
