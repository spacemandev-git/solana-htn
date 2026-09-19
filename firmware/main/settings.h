#pragma once

#include "htnos.h"

typedef struct {
    char ssid[HTNOS_SSID_MAX + 1];
    char pass[HTNOS_PASS_MAX + 1];
    char id[HTNOS_ID_LENGTH + 1];
    char token[HTNOS_TOKEN_MAX + 1];
    char key[HTNOS_KEY_MAX + 1];
    char server[HTNOS_URL_MAX + 1];
} settings_t;

void settings_load(void);
const settings_t *settings(void);
void settings_set_wifi(const char *ssid, const char *pass);
void settings_set_identity(const char *id, const char *token);
void settings_clear_identity(void);
void settings_set_key(const char *key);
void settings_set_server(const char *url);
