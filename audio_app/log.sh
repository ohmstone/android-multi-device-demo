#!/bin/zsh
set -e


PACKAGE="one.ohmst.demo1.audioapp"
MAX_RETRIES=5
SLEEP_SEC=1


for ((i=1; i<=MAX_RETRIES; i++)); do
  sleep "$SLEEP_SEC"
  PID=$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r')

  if [[ -n "$PID" ]]; then
    echo "App is running. PID: $PID"
    adb logcat --pid=$PID
  fi

  echo "Attempt $i/$MAX_RETRIES: app not running yet, retrying..."
done

echo "Error: $PACKAGE did not start after $MAX_RETRIES attempts"
exit 1