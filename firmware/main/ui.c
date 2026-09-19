#include "ui.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "hal_buttons.h"
#include "hal_display.h"
#include "hal_leds.h"
#include "htnos.h"
#include "link.h"
#include "settings.h"
#include "wifi.h"

static const char *TAG = "ui";

typedef enum {
    HOME,
    MENU,
    WIFI,
    KEYBOARD,
    APPKEY,
    SERVER,
    CANVAS,
    LEDTEST,
    ABOUT,
} screen_t;

typedef enum {
    KEYBOARD_NONE,
    KEYBOARD_WIFI,
    KEYBOARD_APPKEY,
    KEYBOARD_SERVER,
} keyboard_purpose_t;

static SemaphoreHandle_t s_state_mutex;
static SemaphoreHandle_t s_render_mutex;
static TaskHandle_t s_task;
static screen_t s_screen = HOME;
static int s_selection;
static wifi_ap_t s_aps[20];
static int s_ap_count;
static char s_pending_ssid[HTNOS_SSID_MAX + 1];
static char s_keyboard_title[64];
static char s_keyboard_text[HTNOS_URL_MAX + 1];
static size_t s_keyboard_max;
static int s_keyboard_row;
static int s_keyboard_col;
static int s_keyboard_page;
static keyboard_purpose_t s_keyboard_purpose;
static screen_t s_keyboard_return;
static char s_toast[64];
static int64_t s_toast_until;
static bool s_toast_pending;
static int64_t s_home_pressed_at;
static bool s_home_hold_handled;
static bool s_canvas_home_release_pending;
static int s_led_index;
static int64_t s_next_led_at;
static button_t s_repeat_button = BTN_COUNT;
static screen_t s_repeat_screen = HOME;
static int64_t s_repeat_at;

/* Values captured before display_render so band callbacks only format and paint. */
static screen_t s_paint_screen;
static char s_paint_toast[sizeof(s_toast)];
static char s_paint_ip[16];
static char s_paint_mac[13];
static link_status_t s_paint_link_status;
static uint32_t s_paint_heap;
static int64_t s_paint_uptime;

static const char *const MENU_ITEMS[] = {
    "Wi-Fi", "App key", "Server", "Canvas", "LED test", "About",
};

static const char *const KEY_LOWER[4] = {
    "qwertyuiop", "asdfghjkl.", "zxcvbnm-_@", "!#$%&*()+=",
};
static const char *const KEY_UPPER[4] = {
    "QWERTYUIOP", "ASDFGHJKL.", "ZXCVBNM-_@", "!#$%&*()+=",
};
static const char *const KEY_SYMBOL[4] = {
    "1234567890", "[]{}<>?/\\|", ",:;'\"~^`..", "_-=+*/%^@#",
};

static void repeat_reset(void)
{
    s_repeat_button = BTN_COUNT;
    s_repeat_at = 0;
}

static screen_t current_screen(void)
{
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    const screen_t screen = s_screen;
    xSemaphoreGive(s_state_mutex);
    return screen;
}

static void set_screen(screen_t screen)
{
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    s_screen = screen;
    s_selection = 0;
    xSemaphoreGive(s_state_mutex);
    repeat_reset();
}

bool ui_is_canvas(void)
{
    if (s_state_mutex == NULL) {
        return false;
    }
    return current_screen() == CANVAS;
}

static void gfx_centered_text(gfx_t *g, int y, const char *text, font_t font, uint16_t color)
{
    gfx_text(g, (LCD_WIDTH - font_text_width(font, text)) / 2, y, text, font, color);
}

static void paint_title(gfx_t *g, const char *title)
{
    gfx_text(g, 8, 2, title, FONT_8X16, COL_MUTE);
    gfx_rect(g, 0, 21, LCD_WIDTH, 1, COL_RULE);
}

static void paint_menu_row(gfx_t *g, int y, const char *text, bool selected)
{
    if (selected) {
        char marked[64];
        snprintf(marked, sizeof(marked), "> %s", text);
        gfx_rect(g, 0, y - 3, LCD_WIDTH, 23, COL_ACCENT);
        gfx_text(g, 12, y, marked, FONT_8X16, COL_BLACK);
    } else {
        gfx_text(g, 12, y, text, FONT_8X16, COL_WHITE);
    }
}

static int paint_wrapped(gfx_t *g, const char *text, int x, int y, int chars_per_line,
                         int pitch, font_t font, uint16_t color)
{
    const size_t length = strlen(text);
    if (length == 0) {
        return y + pitch;
    }
    for (size_t offset = 0; offset < length; offset += (size_t)chars_per_line) {
        char line[64];
        const size_t left = length - offset;
        const size_t count = left > (size_t)chars_per_line ? (size_t)chars_per_line : left;
        memcpy(line, &text[offset], count);
        line[count] = '\0';
        gfx_text(g, x, y, line, font, color);
        y += pitch;
    }
    return y;
}

static void paint_home(gfx_t *g)
{
    char line[96];
    snprintf(line, sizeof(line), "HTN OS %s", HTNOS_VERSION);
    gfx_text(g, 6, 4, line, FONT_6X12, COL_FAINT);

    if (settings()->id[0] != '\0') {
        gfx_centered_text(g, 44, settings()->id, FONT_32X64, COL_ACCENT);
    } else {
        gfx_centered_text(g, 60, "NO ID", FONT_16X32, COL_RED);
    }

    gfx_text(g, 8, 128, "wifi", FONT_8X16, COL_FAINT);
    if (settings()->ssid[0] == '\0') {
        strlcpy(line, "not set", sizeof(line));
    } else if (s_paint_ip[0] != '\0') {
        snprintf(line, sizeof(line), "%s %s", settings()->ssid, s_paint_ip);
    } else {
        strlcpy(line, settings()->ssid, sizeof(line));
    }
    line[32] = '\0';
    gfx_text(g, 56, 128, line, FONT_8X16, COL_WHITE);

    gfx_text(g, 8, 150, "link", FONT_8X16, COL_FAINT);
    const char *link_value = s_paint_link_status == LINK_ONLINE ? "online" :
        s_paint_link_status == LINK_CONNECTING ? "connecting" : "offline";
    gfx_text(g, 56, 150, link_value, FONT_8X16, COL_WHITE);

    gfx_text(g, 8, 172, "key", FONT_8X16, COL_FAINT);
    gfx_text(g, 56, 172, settings()->key[0] != '\0' ? "set" : "not set", FONT_8X16, COL_WHITE);

    const char *hint = "HOME  menu";
    gfx_text(g, LCD_WIDTH - font_text_width(FONT_6X12, hint) - 6, 226,
             hint, FONT_6X12, COL_FAINT);
}

static void paint_menu(gfx_t *g)
{
    paint_title(g, "MENU");
    for (int i = 0; i < (int)(sizeof(MENU_ITEMS) / sizeof(MENU_ITEMS[0])); ++i) {
        paint_menu_row(g, 30 + i * 22, MENU_ITEMS[i], i == s_selection);
    }
}

static int wifi_row_count(void)
{
    return s_ap_count + 2;
}

static void paint_wifi(gfx_t *g)
{
    paint_title(g, "WI-FI");
    const int total = wifi_row_count();
    int first = s_selection >= 9 ? s_selection - 8 : 0;
    if (first + 9 > total) {
        first = total > 9 ? total - 9 : 0;
    }
    for (int visible = 0; visible < 9; ++visible) {
        const int row = first + visible;
        if (row >= total) {
            break;
        }
        char label[48];
        if (row == 0) {
            strlcpy(label, "Rescan", sizeof(label));
        } else if (row == total - 1) {
            strlcpy(label, "Forget saved", sizeof(label));
        } else {
            const wifi_ap_t *ap = &s_aps[row - 1];
            snprintf(label, sizeof(label), "%-20.20s %4d %c",
                     ap->ssid, ap->rssi, ap->secured ? '*' : ' ');
        }
        paint_menu_row(g, 30 + visible * 22, label, row == s_selection);
    }
}

static const char *keyboard_page_row(int row)
{
    return s_keyboard_page == 0 ? KEY_LOWER[row] :
        s_keyboard_page == 1 ? KEY_UPPER[row] : KEY_SYMBOL[row];
}

static void paint_keyboard(gfx_t *g)
{
    gfx_text(g, 6, 3, s_keyboard_title, FONT_6X12, COL_MUTE);
    gfx_rect(g, 0, 16, LCD_WIDTH, 24, COL_RAISE);
    char visible[40];
    const size_t length = strlen(s_keyboard_text);
    const char *start = length > 38 ? &s_keyboard_text[length - 38] : s_keyboard_text;
    const size_t visible_length = strlen(start);
    memcpy(visible, start, visible_length);
    visible[visible_length] = '_';
    visible[visible_length + 1] = '\0';
    gfx_text(g, 6, 20, visible, FONT_8X16, COL_WHITE);

    for (int row = 0; row < 4; ++row) {
        const char *keys = keyboard_page_row(row);
        for (int col = 0; col < 10; ++col) {
            const int x = col * 32;
            const int y = 46 + row * 36;
            const bool selected = row == s_keyboard_row && col == s_keyboard_col;
            gfx_rect(g, x, y, 32, 36, selected ? COL_ACCENT : COL_BLACK);
            if (!selected) {
                gfx_rect(g, x, y, 32, 1, COL_RULE);
            }
            char key[2] = {keys[col], '\0'};
            gfx_text(g, x + (32 - font_text_width(FONT_8X16, key)) / 2, y + 10,
                     key, FONT_8X16, selected ? COL_BLACK : COL_WHITE);
        }
    }

    const char *special[5] = {
        s_keyboard_page == 0 ? "abc" : s_keyboard_page == 1 ? "ABC" : "#+=",
        "space", "DEL", "OK", "CANCEL",
    };
    for (int col = 0; col < 5; ++col) {
        const int x = col * 64;
        const bool selected = s_keyboard_row == 4 && s_keyboard_col == col;
        gfx_rect(g, x, 190, 64, 36, selected ? COL_ACCENT : COL_BLACK);
        if (!selected) {
            gfx_rect(g, x, 190, 64, 1, COL_RULE);
        }
        gfx_text(g, x + (64 - font_text_width(FONT_6X12, special[col])) / 2, 202,
                 special[col], FONT_6X12, selected ? COL_BLACK : COL_WHITE);
    }
}

static void paint_appkey(gfx_t *g)
{
    paint_title(g, "APP KEY");
    const bool has_key = settings()->key[0] != '\0';
    gfx_text(g, 8, 30, has_key ? settings()->key : "not set", FONT_12X24,
             has_key ? COL_WHITE : COL_FAINT);
    const char *items[] = {"Generate new", "Type key", "Clear key"};
    for (int i = 0; i < 3; ++i) {
        paint_menu_row(g, 92 + i * 22, items[i], i == s_selection);
    }
}

static void paint_server(gfx_t *g)
{
    paint_title(g, "SERVER");
    int y = paint_wrapped(g, settings()->server, 8, 30, 38, 18, FONT_8X16, COL_WHITE) + 12;
    const char *items[] = {"Edit URL", "Reset default"};
    for (int i = 0; i < 2; ++i) {
        paint_menu_row(g, y + i * 22, items[i], i == s_selection);
    }
}

static void paint_ledtest(gfx_t *g)
{
    paint_title(g, "LED TEST");
    gfx_centered_text(g, 90, "LED TEST", FONT_16X32, COL_ACCENT);
    gfx_centered_text(g, 140, "B / HOME  exit", FONT_6X12, COL_FAINT);
}

static void paint_about_pair(gfx_t *g, int y, const char *label, const char *value)
{
    gfx_text(g, 8, y, label, FONT_6X12, COL_FAINT);
    gfx_text(g, 8 + font_text_width(FONT_6X12, label) + 6, y,
             value, FONT_6X12, COL_WHITE);
}

static void paint_about(gfx_t *g)
{
    paint_title(g, "ABOUT");
    char line[96];
    paint_about_pair(g, 30, "HTN OS", HTNOS_VERSION);
    paint_about_pair(g, 44, "MAC", s_paint_mac);
    paint_about_pair(g, 58, "HTN-ID",
                     settings()->id[0] != '\0' ? settings()->id : "not registered");
    gfx_text(g, 8, 72, "Server", FONT_6X12, COL_FAINT);
    int y = paint_wrapped(g, settings()->server, 8, 86, 52, 14, FONT_6X12, COL_WHITE);
    snprintf(line, sizeof(line), "%lu", (unsigned long)s_paint_heap);
    paint_about_pair(g, y, "Heap", line);
    paint_about_pair(g, y + 14, "IP", s_paint_ip[0] != '\0' ? s_paint_ip : "offline");
    snprintf(line, sizeof(line), "%llds", (long long)s_paint_uptime);
    paint_about_pair(g, y + 28, "Up", line);
}

static void paint_current(gfx_t *g, void *ctx)
{
    (void)ctx;
    gfx_fill(g, COL_BLACK);
    switch (s_paint_screen) {
    case HOME: paint_home(g); break;
    case MENU: paint_menu(g); break;
    case WIFI: paint_wifi(g); break;
    case KEYBOARD: paint_keyboard(g); break;
    case APPKEY: paint_appkey(g); break;
    case SERVER: paint_server(g); break;
    case CANVAS: break;
    case LEDTEST: paint_ledtest(g); break;
    case ABOUT: paint_about(g); break;
    }
    if (s_paint_screen != CANVAS && s_paint_toast[0] != '\0') {
        gfx_rect(g, 0, 220, LCD_WIDTH, 20, COL_ACCENT);
        gfx_text(g, 8, 222, s_paint_toast, FONT_8X16, COL_BLACK);
    }
}

static void snapshot_paint_state(void)
{
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    s_paint_screen = s_screen;
    if (esp_timer_get_time() < s_toast_until) {
        strlcpy(s_paint_toast, s_toast, sizeof(s_paint_toast));
    } else {
        s_paint_toast[0] = '\0';
    }
    xSemaphoreGive(s_state_mutex);
    wifi_ip_str(s_paint_ip, sizeof(s_paint_ip));
    s_paint_link_status = link_status();
    s_paint_heap = esp_get_free_heap_size();
    s_paint_uptime = esp_timer_get_time() / 1000000;
}

static void render_current_locked(void)
{
    snapshot_paint_state();
    if (s_paint_screen == CANVAS) {
        return;
    }
    display_render(0, 0, LCD_WIDTH, LCD_HEIGHT, paint_current, NULL);
}

static void repaint(void)
{
    xSemaphoreTake(s_render_mutex, portMAX_DELAY);
    render_current_locked();
    xSemaphoreGive(s_render_mutex);
}

static void paint_black(gfx_t *g, void *ctx)
{
    (void)ctx;
    gfx_fill(g, COL_BLACK);
}

static void paint_interstitial(gfx_t *g, void *ctx)
{
    const char *message = ctx;
    gfx_fill(g, COL_BLACK);
    gfx_centered_text(g, 108, message, FONT_12X24, COL_ACCENT);
}

static void paint_splash(gfx_t *g, void *ctx)
{
    (void)ctx;
    gfx_fill(g, COL_BLACK);
    gfx_centered_text(g, 64, "HTN OS", FONT_32X64, COL_WHITE);
    gfx_rect(g, 100, 136, 120, 6, COL_ACCENT);
}

void ui_refresh(void)
{
    if (s_task != NULL) {
        xTaskNotifyGive(s_task);
    }
}

void ui_toast(const char *msg)
{
    if (s_state_mutex == NULL || msg == NULL) {
        return;
    }
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    strlcpy(s_toast, msg, sizeof(s_toast));
    s_toast_until = esp_timer_get_time() + 2000000;
    s_toast_pending = true;
    xSemaphoreGive(s_state_mutex);
    ui_refresh();
}

void ui_enter_canvas(void)
{
    if (s_state_mutex == NULL) {
        return;
    }
    xSemaphoreTake(s_render_mutex, portMAX_DELAY);
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    const bool changed = s_screen != CANVAS;
    s_screen = CANVAS;
    s_home_pressed_at = 0;
    s_home_hold_handled = false;
    xSemaphoreGive(s_state_mutex);
    repeat_reset();
    if (changed) {
        display_render(0, 0, LCD_WIDTH, LCD_HEIGHT, paint_black, NULL);
        link_send_mode(true);
    }
    xSemaphoreGive(s_render_mutex);
}

void ui_leave_canvas(void)
{
    if (s_state_mutex == NULL) {
        return;
    }
    xSemaphoreTake(s_render_mutex, portMAX_DELAY);
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    const bool was_canvas = s_screen == CANVAS;
    s_screen = MENU;
    s_selection = 0;
    s_home_pressed_at = 0;
    s_home_hold_handled = false;
    xSemaphoreGive(s_state_mutex);
    repeat_reset();
    link_stop_accel_stream();
    if (was_canvas) {
        link_send_mode(false);
    }
    snapshot_paint_state();
    display_render(0, 0, LCD_WIDTH, LCD_HEIGHT, paint_current, NULL);
    xSemaphoreGive(s_render_mutex);
}

static void begin_keyboard(const char *title, const char *prefill, size_t max,
                           keyboard_purpose_t purpose, screen_t return_screen)
{
    strlcpy(s_keyboard_title, title, sizeof(s_keyboard_title));
    strlcpy(s_keyboard_text, prefill != NULL ? prefill : "", sizeof(s_keyboard_text));
    s_keyboard_max = max;
    s_keyboard_purpose = purpose;
    s_keyboard_return = return_screen;
    s_keyboard_row = 0;
    s_keyboard_col = 0;
    s_keyboard_page = 0;
    set_screen(KEYBOARD);
    repaint();
}

static void scan_wifi(void)
{
    xSemaphoreTake(s_render_mutex, portMAX_DELAY);
    display_render(0, 0, LCD_WIDTH, LCD_HEIGHT, paint_interstitial, "Scanning...");
    xSemaphoreGive(s_render_mutex);
    s_ap_count = wifi_scan(s_aps, (int)(sizeof(s_aps) / sizeof(s_aps[0])));
    s_selection = 0;
    if (current_screen() == WIFI) {
        repaint();
    }
}

static void join_wifi(const char *ssid, const char *pass)
{
    xSemaphoreTake(s_render_mutex, portMAX_DELAY);
    display_render(0, 0, LCD_WIDTH, LCD_HEIGHT, paint_interstitial, "Connecting...");
    xSemaphoreGive(s_render_mutex);
    wifi_connect(ssid, pass);
    bool connected = false;
    for (int elapsed = 0; elapsed < 15000; elapsed += 200) {
        vTaskDelay(pdMS_TO_TICKS(200));
        if (wifi_status() == WIFI_CONNECTED) {
            connected = true;
            break;
        }
        if (wifi_status() == WIFI_FAILED) {
            break;
        }
    }
    if (connected) {
        settings_set_wifi(ssid, pass);
        set_screen(HOME);
        ui_toast("Connected");
    } else {
        set_screen(WIFI);
        ui_toast("Failed to join");
    }
    repaint();
}

static bool valid_app_key(const char *key)
{
    const size_t length = strlen(key);
    if (length < HTNOS_KEY_MIN || length > HTNOS_KEY_MAX) {
        return false;
    }
    for (size_t i = 0; i < length; ++i) {
        if (!isprint((unsigned char)key[i]) || isspace((unsigned char)key[i])) {
            return false;
        }
    }
    return true;
}

static void finish_keyboard(void)
{
    if (s_keyboard_purpose == KEYBOARD_WIFI) {
        set_screen(WIFI);
        join_wifi(s_pending_ssid, s_keyboard_text);
    } else if (s_keyboard_purpose == KEYBOARD_APPKEY) {
        set_screen(APPKEY);
        if (!valid_app_key(s_keyboard_text)) {
            ui_toast("4-32 chars, no spaces");
        } else {
            settings_set_key(s_keyboard_text);
            link_send_key();
            ui_toast("App key saved");
        }
        repaint();
    } else if (s_keyboard_purpose == KEYBOARD_SERVER) {
        set_screen(SERVER);
        if (s_keyboard_text[0] != '\0') {
            settings_set_server(s_keyboard_text);
            link_restart();
            ui_toast("Server updated");
        }
        repaint();
    }
    s_keyboard_purpose = KEYBOARD_NONE;
}

static void cancel_keyboard(void)
{
    set_screen(s_keyboard_return);
    s_keyboard_purpose = KEYBOARD_NONE;
    repaint();
}

static void keyboard_backspace(void)
{
    const size_t length = strlen(s_keyboard_text);
    if (length > 0) {
        s_keyboard_text[length - 1] = '\0';
    }
}

static void keyboard_type(char ch)
{
    const size_t length = strlen(s_keyboard_text);
    if (length < s_keyboard_max && length + 1 < sizeof(s_keyboard_text)) {
        s_keyboard_text[length] = ch;
        s_keyboard_text[length + 1] = '\0';
    }
}

static void keyboard_select(void)
{
    if (s_keyboard_row < 4) {
        keyboard_type(keyboard_page_row(s_keyboard_row)[s_keyboard_col]);
    } else if (s_keyboard_col == 0) {
        s_keyboard_page = (s_keyboard_page + 1) % 3;
    } else if (s_keyboard_col == 1) {
        keyboard_type(' ');
    } else if (s_keyboard_col == 2) {
        keyboard_backspace();
    } else if (s_keyboard_col == 3) {
        finish_keyboard();
        return;
    } else {
        cancel_keyboard();
        return;
    }
    repaint();
}

static void move_selection(int delta, int count)
{
    if (count <= 0) {
        return;
    }
    s_selection = (s_selection + delta + count) % count;
    repaint();
}

static void select_menu_item(void)
{
    switch (s_selection) {
    case 0:
        set_screen(WIFI);
        scan_wifi();
        break;
    case 1:
        set_screen(APPKEY);
        repaint();
        break;
    case 2:
        set_screen(SERVER);
        repaint();
        break;
    case 3:
        ui_enter_canvas();
        break;
    case 4:
        set_screen(LEDTEST);
        s_led_index = 0;
        s_next_led_at = 0;
        repaint();
        break;
    case 5:
        set_screen(ABOUT);
        repaint();
        break;
    default:
        break;
    }
}

static void select_wifi_item(void)
{
    const int total = wifi_row_count();
    if (s_selection == 0) {
        scan_wifi();
    } else if (s_selection == total - 1) {
        wifi_forget();
        ui_toast("Wi-Fi forgotten");
        repaint();
    } else {
        const wifi_ap_t *ap = &s_aps[s_selection - 1];
        strlcpy(s_pending_ssid, ap->ssid, sizeof(s_pending_ssid));
        if (ap->secured) {
            char title[64];
            snprintf(title, sizeof(title), "Password for %.45s", ap->ssid);
            begin_keyboard(title, "", HTNOS_PASS_MAX, KEYBOARD_WIFI, WIFI);
        } else {
            join_wifi(ap->ssid, "");
        }
    }
}

static void select_appkey_item(void)
{
    if (s_selection == 0) {
        const char *alphabet = HTNOS_ID_ALPHABET;
        const size_t alphabet_len = strlen(alphabet);
        char key[9];
        for (int i = 0; i < 8; ++i) {
            key[i] = alphabet[esp_random() % alphabet_len];
        }
        key[8] = '\0';
        settings_set_key(key);
        link_send_key();
        ui_toast("New app key");
        repaint();
    } else if (s_selection == 1) {
        begin_keyboard("Type app key", settings()->key, HTNOS_KEY_MAX, KEYBOARD_APPKEY, APPKEY);
    } else {
        settings_set_key("");
        link_send_key();
        ui_toast("App key cleared");
        repaint();
    }
}

static void select_server_item(void)
{
    if (s_selection == 0) {
        begin_keyboard("Service WebSocket URL", settings()->server,
                       HTNOS_URL_MAX, KEYBOARD_SERVER, SERVER);
    } else {
        settings_set_server(HTNOS_DEFAULT_SERVICE_URL);
        link_restart();
        ui_toast("Server reset");
        repaint();
    }
}

static void keyboard_move(button_t button)
{
    if (button == BTN_LEFT) {
        const int columns = s_keyboard_row == 4 ? 5 : 10;
        s_keyboard_col = (s_keyboard_col + columns - 1) % columns;
    } else if (button == BTN_RIGHT) {
        const int columns = s_keyboard_row == 4 ? 5 : 10;
        s_keyboard_col = (s_keyboard_col + 1) % columns;
    } else if (button == BTN_UP) {
        if (s_keyboard_row == 0) {
            s_keyboard_row = 4;
            s_keyboard_col /= 2;
        } else {
            if (s_keyboard_row == 4) {
                s_keyboard_col *= 2;
            }
            --s_keyboard_row;
        }
    } else if (button == BTN_DOWN) {
        if (s_keyboard_row == 4) {
            s_keyboard_row = 0;
            s_keyboard_col *= 2;
        } else if (s_keyboard_row == 3) {
            s_keyboard_row = 4;
            s_keyboard_col /= 2;
        } else {
            ++s_keyboard_row;
        }
    }
    repaint();
}

static void handle_menu_button(button_t button)
{
    const screen_t screen = current_screen();
    if (screen == KEYBOARD) {
        if (button == BTN_UP || button == BTN_DOWN || button == BTN_LEFT || button == BTN_RIGHT) {
            keyboard_move(button);
        } else if (button == BTN_A) {
            keyboard_select();
        } else if (button == BTN_B) {
            keyboard_backspace();
            repaint();
        } else if (button == BTN_START) {
            finish_keyboard();
        } else if (button == BTN_HOME) {
            cancel_keyboard();
        }
        return;
    }
    if (button == BTN_HOME) {
        set_screen(screen == HOME ? MENU : HOME);
        if (screen == LEDTEST) {
            leds_clear();
        }
        repaint();
        return;
    }
    if (button == BTN_B) {
        if (screen == HOME) {
            return;
        }
        if (screen == MENU) {
            set_screen(HOME);
        } else {
            if (screen == LEDTEST) {
                leds_clear();
            }
            set_screen(MENU);
        }
        repaint();
        return;
    }
    if (screen == HOME) {
        return;
    }
    if (screen == MENU) {
        if (button == BTN_UP || button == BTN_LEFT) {
            move_selection(-1, 6);
        } else if (button == BTN_DOWN || button == BTN_RIGHT) {
            move_selection(1, 6);
        } else if (button == BTN_A) {
            select_menu_item();
        }
    } else if (screen == WIFI) {
        if (button == BTN_UP || button == BTN_LEFT) {
            move_selection(-1, wifi_row_count());
        } else if (button == BTN_DOWN || button == BTN_RIGHT) {
            move_selection(1, wifi_row_count());
        } else if (button == BTN_A) {
            select_wifi_item();
        }
    } else if (screen == APPKEY) {
        if (button == BTN_UP || button == BTN_LEFT) {
            move_selection(-1, 3);
        } else if (button == BTN_DOWN || button == BTN_RIGHT) {
            move_selection(1, 3);
        } else if (button == BTN_A) {
            select_appkey_item();
        }
    } else if (screen == SERVER) {
        if (button == BTN_UP || button == BTN_LEFT || button == BTN_DOWN || button == BTN_RIGHT) {
            move_selection(1, 2);
        } else if (button == BTN_A) {
            select_server_item();
        }
    }
}

static bool repeat_screen(screen_t screen)
{
    return screen == MENU || screen == WIFI || screen == KEYBOARD ||
        screen == APPKEY || screen == SERVER;
}

static bool is_dpad(button_t button)
{
    return button == BTN_UP || button == BTN_DOWN || button == BTN_LEFT || button == BTN_RIGHT;
}

static void handle_button(const button_event_t *event)
{
    if (!event->pressed && event->btn == s_repeat_button) {
        repeat_reset();
    }
    if (ui_is_canvas()) {
        repeat_reset();
        link_send_button(event->btn, event->pressed);
        if (event->btn == BTN_HOME) {
            if (event->pressed) {
                s_home_pressed_at = esp_timer_get_time();
                s_home_hold_handled = false;
            } else {
                s_canvas_home_release_pending = false;
                s_home_pressed_at = 0;
                s_home_hold_handled = false;
            }
        }
        return;
    }
    if (event->btn == BTN_HOME && !event->pressed && s_canvas_home_release_pending) {
        s_canvas_home_release_pending = false;
        link_send_button(BTN_HOME, false);
        return;
    }
    if (event->pressed) {
        handle_menu_button(event->btn);
        const screen_t screen = current_screen();
        if (is_dpad(event->btn) && repeat_screen(screen)) {
            s_repeat_button = event->btn;
            s_repeat_screen = screen;
            s_repeat_at = esp_timer_get_time() + (int64_t)BUTTON_REPEAT_DELAY_MS * 1000;
        }
    }
}

static void periodic_repeat(int64_t now)
{
    if (s_repeat_button == BTN_COUNT) {
        return;
    }
    const screen_t screen = current_screen();
    if (screen != s_repeat_screen || !repeat_screen(screen) ||
        (buttons_state() & (1U << s_repeat_button)) == 0) {
        repeat_reset();
        return;
    }
    if (now >= s_repeat_at) {
        const button_t button = s_repeat_button;
        handle_menu_button(button);
        if (current_screen() == s_repeat_screen &&
            (buttons_state() & (1U << button)) != 0) {
            s_repeat_at = now + (int64_t)BUTTON_REPEAT_MS * 1000;
        } else {
            repeat_reset();
        }
    }
}

static void periodic(void)
{
    const int64_t now = esp_timer_get_time();
    if (ui_is_canvas() && s_home_pressed_at != 0 && !s_home_hold_handled &&
        now - s_home_pressed_at >= (int64_t)HOME_HOLD_MS * 1000) {
        s_home_hold_handled = true;
        s_canvas_home_release_pending = true;
        ui_leave_canvas();
    }
    periodic_repeat(now);
    if (current_screen() == LEDTEST && now >= s_next_led_at) {
        leds_clear();
        leds_set(s_led_index, 64, 24, 128);
        leds_show();
        s_led_index = (s_led_index + 1) % LED_COUNT;
        s_next_led_at = now + 120000;
    }
    bool repaint_after_toast = false;
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    if (s_toast_pending) {
        s_toast_pending = false;
        repaint_after_toast = true;
    } else if (s_toast_until != 0 && now >= s_toast_until) {
        s_toast_until = 0;
        s_toast[0] = '\0';
        repaint_after_toast = true;
    }
    xSemaphoreGive(s_state_mutex);
    if (repaint_after_toast) {
        repaint();
    }
    if (ulTaskNotifyTake(pdTRUE, 0) > 0 && current_screen() == HOME) {
        repaint();
    }
}

static void ui_task(void *arg)
{
    (void)arg;
    button_event_t event;
    for (;;) {
        if (xQueueReceive(buttons_queue(), &event, pdMS_TO_TICKS(20)) == pdTRUE) {
            handle_button(&event);
        }
        periodic();
    }
}

void ui_start(void)
{
    s_state_mutex = xSemaphoreCreateMutex();
    s_render_mutex = xSemaphoreCreateMutex();
    configASSERT(s_state_mutex != NULL && s_render_mutex != NULL);
    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_BASE));
    snprintf(s_paint_mac, sizeof(s_paint_mac), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    display_render(0, 0, LCD_WIDTH, LCD_HEIGHT, paint_splash, NULL);
    vTaskDelay(pdMS_TO_TICKS(800));
    repaint();
    BaseType_t result = xTaskCreate(ui_task, "ui", 6144, NULL, 6, &s_task);
    configASSERT(result == pdPASS);
    ESP_LOGI(TAG, "UI started");
}
