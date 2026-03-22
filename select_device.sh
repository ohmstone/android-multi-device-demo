#!/bin/zsh
# Source this file to populate DEVICE_SERIAL.
# If DEVICE_SERIAL is already exported in the environment, this is a no-op.

_pick_device() {
  local -a serials
  while IFS= read -r serial; do
    serials+=("$serial")
  done < <(adb devices | awk '/\tdevice$/{print $1}')

  if [[ ${#serials[@]} -eq 0 ]]; then
    echo "Error: no Android devices/emulators connected." >&2
    return 1
  fi

  if [[ ${#serials[@]} -eq 1 ]]; then
    DEVICE_SERIAL="${serials[1]}"
    local model
    model=$(adb -s "$DEVICE_SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
    echo "Using device: $DEVICE_SERIAL  ($model)"
    return 0
  fi

  echo "Multiple devices connected:"
  local -a labels
  local i=1
  for serial in "${serials[@]}"; do
    local brand model
    brand=$(adb -s "$serial" shell getprop ro.product.brand 2>/dev/null | tr -d '\r')
    model=$(adb -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
    labels+=("$serial  —  $brand $model")
    printf "  %d) %s\n" "$i" "${labels[$i]}"
    (( i++ ))
  done

  local choice
  while true; do
    printf "Select device [1-%d]: " "${#serials[@]}"
    read -r choice
    if [[ $choice =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#serials[@]} )); then
      break
    fi
    echo "Invalid selection, try again."
  done

  DEVICE_SERIAL="${serials[$choice]}"
  echo "Using: ${labels[$choice]}"
}

if [[ -z "$DEVICE_SERIAL" ]]; then
  _pick_device || exit 1
fi

export DEVICE_SERIAL
