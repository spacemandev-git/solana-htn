#include "hal_display.h"

#include <assert.h>
#include <stddef.h>
#include <string.h>

#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "htnos.h"

struct gfx {
    uint8_t *buf;
    int rx;
    int ry;
    int rw;
    int rh;
    int by;
    int bh;
};

static const char *TAG = "hal_display";
static esp_lcd_panel_handle_t s_panel;
static SemaphoreHandle_t s_mutex;
static SemaphoreHandle_t s_done;
static uint8_t *s_stripes[2];

static bool color_done(esp_lcd_panel_io_handle_t panel_io,
                       esp_lcd_panel_io_event_data_t *event,
                       void *user_ctx)
{
    (void)panel_io;
    (void)event;
    (void)user_ctx;
    BaseType_t wake = pdFALSE;
    xSemaphoreGiveFromISR(s_done, &wake);
    return wake == pdTRUE;
}

static bool clip_screen(int *x, int *y, int *w, int *h, int *src_x, int *src_y)
{
    *src_x = 0;
    *src_y = 0;
    if (*x < 0) {
        *src_x = -*x;
        *w += *x;
        *x = 0;
    }
    if (*y < 0) {
        *src_y = -*y;
        *h += *y;
        *y = 0;
    }
    if (*x + *w > LCD_WIDTH) {
        *w = LCD_WIDTH - *x;
    }
    if (*y + *h > LCD_HEIGHT) {
        *h = LCD_HEIGHT - *y;
    }
    return *w > 0 && *h > 0 && *x < LCD_WIDTH && *y < LCD_HEIGHT;
}

static bool clip_band(const gfx_t *g, int *x, int *y, int *w, int *h)
{
    if (*w <= 0 || *h <= 0) {
        return false;
    }
    const int right = *x + *w;
    const int bottom = *y + *h;
    const int band_right = g->rx + g->rw;
    const int band_bottom = g->by + g->bh;
    if (*x < g->rx) {
        *x = g->rx;
    }
    if (*y < g->by) {
        *y = g->by;
    }
    *w = (right < band_right ? right : band_right) - *x;
    *h = (bottom < band_bottom ? bottom : band_bottom) - *y;
    return *w > 0 && *h > 0;
}

static void put_pixel(gfx_t *g, int x, int y, uint16_t color)
{
    const size_t at = ((size_t)(y - g->by) * (size_t)g->rw + (size_t)(x - g->rx)) * 2;
    g->buf[at] = (uint8_t)(color >> 8);
    g->buf[at + 1] = (uint8_t)color;
}

static void wait_all(int pending)
{
    while (pending-- > 0) {
        xSemaphoreTake(s_done, portMAX_DELAY);
    }
}

static void blit_locked(int x, int y, int w, int h, const uint8_t *pixels)
{
    if (pixels == NULL || w <= 0 || h <= 0) {
        return;
    }
    const int source_w = w;
    int src_x;
    int src_y;
    if (!clip_screen(&x, &y, &w, &h, &src_x, &src_y)) {
        return;
    }

    int pending = 0;
    int stripe_index = 0;
    for (int row = 0; row < h;) {
        if (pending == 2) {
            xSemaphoreTake(s_done, portMAX_DELAY);
            --pending;
        }
        const int rows = (h - row > LCD_STRIPE_ROWS) ? LCD_STRIPE_ROWS : h - row;
        uint8_t *dst = s_stripes[stripe_index];
        const uint8_t *src = pixels + (((src_y + row) * source_w + src_x) * 2);
        for (int r = 0; r < rows; ++r) {
            memcpy(dst + (r * w * 2), src + (r * source_w * 2), (size_t)w * 2);
        }
        ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(s_panel, x, y + row, x + w, y + row + rows, dst));
        ++pending;
        stripe_index ^= 1;
        row += rows;
    }
    wait_all(pending);
}

void display_init(void)
{
    s_mutex = xSemaphoreCreateMutex();
    s_done = xSemaphoreCreateCounting(2, 0);
    assert(s_mutex != NULL && s_done != NULL);

    spi_bus_config_t bus = {
        .mosi_io_num = PIN_LCD_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = PIN_LCD_CLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = LCD_WIDTH * LCD_STRIPE_ROWS * 2,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(LCD_SPI_HOST, &bus, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_spi_config_t io_config = {
        .cs_gpio_num = PIN_LCD_CS,
        .dc_gpio_num = PIN_LCD_DC,
        .spi_mode = LCD_SPI_MODE,
        .pclk_hz = LCD_SPI_HZ,
        .trans_queue_depth = 2,
        .on_color_trans_done = color_done,
        .user_ctx = NULL,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    esp_lcd_panel_io_handle_t io = NULL;
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_SPI_HOST, &io_config, &io));

    esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = PIN_LCD_RST,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .data_endian = LCD_RGB_DATA_ENDIAN_BIG,
        .bits_per_pixel = 16,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7789(io, &panel_config, &s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(s_panel, true));
    ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(s_panel, true));
    ESP_ERROR_CHECK(esp_lcd_panel_mirror(s_panel, true, false));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(s_panel, true));

    const size_t stripe_bytes = LCD_WIDTH * LCD_STRIPE_ROWS * 2;
    s_stripes[0] = heap_caps_malloc(stripe_bytes, MALLOC_CAP_DMA);
    s_stripes[1] = heap_caps_malloc(stripe_bytes, MALLOC_CAP_DMA);
    assert(s_stripes[0] != NULL && s_stripes[1] != NULL);
    ESP_LOGI(TAG, "ST7789 ready with two %u-byte DMA stripes", (unsigned)stripe_bytes);
}

void display_render(int x, int y, int w, int h, paint_fn_t paint, void *ctx)
{
    if (paint == NULL) {
        return;
    }
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    int src_x;
    int src_y;
    if (!clip_screen(&x, &y, &w, &h, &src_x, &src_y)) {
        xSemaphoreGive(s_mutex);
        return;
    }
    (void)src_x;
    (void)src_y;

    int pending = 0;
    int stripe_index = 0;
    for (int row = 0; row < h;) {
        if (pending == 2) {
            xSemaphoreTake(s_done, portMAX_DELAY);
            --pending;
        }
        const int rows = (h - row > LCD_STRIPE_ROWS) ? LCD_STRIPE_ROWS : h - row;
        gfx_t g = {
            .buf = s_stripes[stripe_index],
            .rx = x,
            .ry = y,
            .rw = w,
            .rh = h,
            .by = y + row,
            .bh = rows,
        };
        /* The callback owns every pixel; full-screen painters normally begin with gfx_fill(). */
        paint(&g, ctx);
        ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(s_panel, x, g.by, x + w, g.by + rows, g.buf));
        ++pending;
        stripe_index ^= 1;
        row += rows;
    }
    wait_all(pending);
    xSemaphoreGive(s_mutex);
}

void gfx_fill(gfx_t *g, uint16_t color)
{
    gfx_rect(g, g->rx, g->ry, g->rw, g->rh, color);
}

void gfx_rect(gfx_t *g, int x, int y, int w, int h, uint16_t color)
{
    if (g == NULL || !clip_band(g, &x, &y, &w, &h)) {
        return;
    }
    const uint8_t hi = (uint8_t)(color >> 8);
    const uint8_t lo = (uint8_t)color;
    for (int py = y; py < y + h; ++py) {
        size_t at = ((size_t)(py - g->by) * (size_t)g->rw + (size_t)(x - g->rx)) * 2;
        for (int px = 0; px < w; ++px) {
            g->buf[at++] = hi;
            g->buf[at++] = lo;
        }
    }
}

void gfx_frame(gfx_t *g, int x, int y, int w, int h, uint16_t color)
{
    if (w <= 0 || h <= 0) {
        return;
    }
    gfx_rect(g, x, y, w, 1, color);
    if (h > 1) {
        gfx_rect(g, x, y + h - 1, w, 1, color);
    }
    if (h > 2) {
        gfx_rect(g, x, y + 1, 1, h - 2, color);
        if (w > 1) {
            gfx_rect(g, x + w - 1, y + 1, 1, h - 2, color);
        }
    }
}

void gfx_blit(gfx_t *g, int x, int y, int w, int h, const uint8_t *rgb565_be)
{
    if (g == NULL || rgb565_be == NULL || w <= 0 || h <= 0) {
        return;
    }
    const int source_x = x;
    const int source_y = y;
    const int source_w = w;
    if (!clip_band(g, &x, &y, &w, &h)) {
        return;
    }
    for (int row = 0; row < h; ++row) {
        const uint8_t *src = rgb565_be +
            (((size_t)(y - source_y + row) * (size_t)source_w + (size_t)(x - source_x)) * 2);
        uint8_t *dst = g->buf +
            (((size_t)(y - g->by + row) * (size_t)g->rw + (size_t)(x - g->rx)) * 2);
        memcpy(dst, src, (size_t)w * 2);
    }
}

static font_t checked_font(font_t font)
{
    return font >= 0 && font < FONT_COUNT ? font : FONT_6X12;
}

static void draw_text(gfx_t *g, int x, int y, const char *s, font_t font,
                      uint16_t fg, bool opaque, uint16_t bg)
{
    if (g == NULL || s == NULL) {
        return;
    }
    font = checked_font(font);
    const font_info_t *info = &FONTS[font];
    const int origin_x = x;
    for (size_t n = 0; s[n] != '\0' && n < TEXT_MAX; ++n) {
        unsigned char ch = (unsigned char)s[n];
        if (ch == '\n') {
            x = origin_x;
            y += info->height;
            continue;
        }
        if (ch < 0x20 || ch > 0x7e) {
            ch = '?';
        }
        if (opaque) {
            gfx_rect(g, x, y, info->width, info->height, bg);
        }
        int gx = x;
        int gy = y;
        int gw = info->width;
        int gh = info->height;
        if (clip_band(g, &gx, &gy, &gw, &gh)) {
            const uint8_t *glyph = info->glyphs +
                (size_t)(ch - 0x20) * info->height * info->bytes_per_row;
            for (int py = gy; py < gy + gh; ++py) {
                const uint8_t *row = glyph + (size_t)(py - y) * info->bytes_per_row;
                for (int px = gx; px < gx + gw; ++px) {
                    const int bit_x = px - x;
                    if ((row[bit_x / 8] & (uint8_t)(1U << (7 - bit_x % 8))) != 0) {
                        put_pixel(g, px, py, fg);
                    }
                }
            }
        }
        x += info->width;
    }
}

void gfx_text(gfx_t *g, int x, int y, const char *s, font_t font, uint16_t fg)
{
    draw_text(g, x, y, s, font, fg, false, 0);
}

void gfx_text_bg(gfx_t *g, int x, int y, const char *s, font_t font, uint16_t fg, uint16_t bg)
{
    draw_text(g, x, y, s, font, fg, true, bg);
}

int font_height(font_t font)
{
    return FONTS[checked_font(font)].height;
}

int font_text_width(font_t font, const char *s)
{
    if (s == NULL) {
        return 0;
    }
    const int glyph_width = FONTS[checked_font(font)].width;
    int line = 0;
    int widest = 0;
    for (size_t n = 0; s[n] != '\0' && n < TEXT_MAX; ++n) {
        if (s[n] == '\n') {
            if (line > widest) {
                widest = line;
            }
            line = 0;
        } else {
            line += glyph_width;
        }
    }
    return line > widest ? line : widest;
}

typedef struct {
    uint16_t color;
} fill_ctx_t;

static void paint_fill(gfx_t *g, void *ctx)
{
    const fill_ctx_t *fill = ctx;
    gfx_fill(g, fill->color);
}

void display_fill(uint16_t color)
{
    fill_ctx_t ctx = {.color = color};
    display_render(0, 0, LCD_WIDTH, LCD_HEIGHT, paint_fill, &ctx);
}

void display_fill_rect(int x, int y, int w, int h, uint16_t color)
{
    fill_ctx_t ctx = {.color = color};
    display_render(x, y, w, h, paint_fill, &ctx);
}

typedef struct {
    int x;
    int y;
    const char *text;
    font_t font;
    uint16_t fg;
    uint16_t bg;
} text_ctx_t;

static void paint_text(gfx_t *g, void *ctx)
{
    const text_ctx_t *text = ctx;
    gfx_fill(g, text->bg);
    gfx_text(g, text->x, text->y, text->text, text->font, text->fg);
}

void display_text(int x, int y, const char *s, font_t font, uint16_t fg, uint16_t bg)
{
    if (s == NULL) {
        return;
    }
    int lines = 1;
    for (size_t n = 0; s[n] != '\0' && n < TEXT_MAX; ++n) {
        if (s[n] == '\n') {
            ++lines;
        }
    }
    text_ctx_t ctx = {
        .x = x,
        .y = y,
        .text = s,
        .font = checked_font(font),
        .fg = fg,
        .bg = bg,
    };
    display_render(x, y, font_text_width(ctx.font, s), lines * font_height(ctx.font), paint_text, &ctx);
}

void display_blit(int x, int y, int w, int h, const uint8_t *rgb565_be)
{
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    blit_locked(x, y, w, h, rgb565_be);
    xSemaphoreGive(s_mutex);
}
