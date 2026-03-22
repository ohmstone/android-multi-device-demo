#!/bin/zsh
set -e


PACKAGE="one.ohmst.demo1.ctrlapp"
SCRIPT_DIR="${0:A:h}"
MAX_RETRIES=5
SLEEP_SEC=1

source "$SCRIPT_DIR/../select_device.sh"


for ((i=1; i<=MAX_RETRIES; i++)); do
  sleep "$SLEEP_SEC"
  PID=$(adb -s "$DEVICE_SERIAL" shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r')

  if [[ -n "$PID" ]]; then
    echo "App is running. PID: $PID"
    adb -s "$DEVICE_SERIAL" logcat --pid=$PID
    exit 0
  fi

  echo "Attempt $i/$MAX_RETRIES: app not running yet, retrying..."
done

echo "Error: $PACKAGE did not start after $MAX_RETRIES attempts"
exit 1
