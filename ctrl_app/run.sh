#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"

source "$SCRIPT_DIR/../select_device.sh"


cordova run android --target="$DEVICE_SERIAL"
