#pragma once

#include <stdbool.h>

void ui_start(void);
bool ui_is_canvas(void);
void ui_enter_canvas(void);
void ui_leave_canvas(void);
void ui_toast(const char *msg);
void ui_refresh(void);
