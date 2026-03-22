#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"

source "$SCRIPT_DIR/../select_device.sh"


adb -s "$DEVICE_SERIAL" logcat -v color \
  AndroidRuntime:E \
  libc:E \
  DEBUG:E \
  main:I \
  '*:S'
