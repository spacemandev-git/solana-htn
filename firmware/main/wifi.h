#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "htnos.h"

typedef enum { WIFI_OFF, WIFI_CONNECTING, WIFI_CONNECTED, WIFI_FAILED } wifi_status_t;

typedef struct {
    char ssid[HTNOS_SSID_MAX + 1];
    int8_t rssi;
    bool secured;
} wifi_ap_t;

void wifi_init(void);
int wifi_scan(wifi_ap_t *out, int max);
void wifi_connect(const char *ssid, const char *pass);
void wifi_forget(void);
wifi_status_t wifi_status(void);
void wifi_ip_str(char *buf, size_t len);
int wifi_rssi(void);
