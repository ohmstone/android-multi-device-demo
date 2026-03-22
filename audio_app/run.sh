#!/bin/zsh
set -e


PACKAGE="one.ohmst.demo1.audioapp"
SCRIPT_DIR="${0:A:h}"

source "$SCRIPT_DIR/../select_device.sh"


cargo ndk  --link-libcxx-shared -t arm64-v8a -o app/src/main/jniLibs/  build
ANDROID_SERIAL="$DEVICE_SERIAL" ./gradlew clean
ANDROID_SERIAL="$DEVICE_SERIAL" ./gradlew assembleDebug
ANDROID_SERIAL="$DEVICE_SERIAL" ./gradlew installDebug
adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE/.MainActivity"
zsh "$SCRIPT_DIR/log.sh"
