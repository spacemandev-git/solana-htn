#pragma once

#include <stdbool.h>

#include "htnos.h"

typedef enum { LINK_OFF, LINK_CONNECTING, LINK_ONLINE } link_status_t;

void link_init(void);
void link_restart(void);
link_status_t link_status(void);
void link_send_button(button_t b, bool pressed);
void link_send_mode(bool canvas);
void link_send_key(void);
void link_stop_accel_stream(void);
