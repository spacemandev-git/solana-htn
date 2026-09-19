#!/usr/bin/env bash
# Builds HTN OS (firmware/) with ESP-IDF v5.5.3 and publishes the flashable
# parts to apps/pwa/static/firmware/htn-os/ for the /badge web flasher.
#
# Usage: ./scripts/build-firmware.sh [--clean]
#
# ESP-IDF is expected at $IDF_PATH or ~/esp/esp-idf (installed with
# `./install.sh esp32c3`). The web flasher writes the three parts at the
# ESP32-C3 offsets: bootloader 0x0, partition table 0x8000, app 0x10000.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDF="${IDF_PATH:-$HOME/esp/esp-idf}"
OUT="$ROOT/apps/pwa/static/firmware/htn-os"
SRC="$ROOT/firmware"

[ -f "$IDF/export.sh" ] || { echo "error: ESP-IDF not found at $IDF (set IDF_PATH)" >&2; exit 1; }

# export.sh picks the venv from whichever python3 is first on PATH; the one
# install.sh created may belong to a different interpreter (uv's 3.12 here).
if [ -z "${IDF_PYTHON_ENV_PATH:-}" ]; then
  for env_dir in "$HOME"/.espressif/python_env/idf5.5_py*_env; do
    [ -x "$env_dir/bin/python" ] && export IDF_PYTHON_ENV_PATH="$env_dir" && break
  done
fi
# shellcheck disable=SC1091
. "$IDF/export.sh" >/dev/null

cd "$SRC"
if [ "${1:-}" = "--clean" ]; then
  idf.py fullclean
fi
idf.py set-target esp32c3 >/dev/null 2>&1 || true
idf.py build

VERSION="$(sed -n 's/^#define HTNOS_VERSION "\(.*\)"/\1/p' main/htnos.h)"
[ -n "$VERSION" ] || { echo "error: HTNOS_VERSION missing from main/htnos.h" >&2; exit 1; }

mkdir -p "$OUT"
cp build/bootloader/bootloader.bin "$OUT/bootloader.bin"
cp build/partition_table/partition-table.bin "$OUT/partition-table.bin"
cp build/htn_os.bin "$OUT/htn_os.bin"

APP_SIZE="$(stat -f %z build/htn_os.bin 2>/dev/null || stat -c %s build/htn_os.bin)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$OUT/manifest.json" <<JSON
{
  "name": "HTN OS",
  "version": "$VERSION",
  "chip": "esp32c3",
  "builtAt": "$BUILT_AT",
  "flashMode": "dio",
  "flashFreq": "80m",
  "flashSize": "4MB",
  "parts": [
    { "path": "bootloader.bin", "offset": 0 },
    { "path": "partition-table.bin", "offset": 32768 },
    { "path": "htn_os.bin", "offset": 65536 }
  ]
}
JSON

echo "HTN OS $VERSION: app $APP_SIZE bytes (limit $((0x2A0000)))"
[ "$APP_SIZE" -le $((0x2A0000)) ] || { echo "error: app exceeds the factory partition" >&2; exit 1; }
echo "published to $OUT"
