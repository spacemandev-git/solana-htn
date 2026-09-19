# HTN OS — replacement firmware for the Hack the North 2026 Hacker Badge.
# Build with ./scripts/build-firmware.sh (ESP-IDF v5.5.3, target esp32c3).
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(htn_os)
