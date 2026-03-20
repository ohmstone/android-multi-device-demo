#!/bin/zsh
set -e


PACKAGE="one.ohmst.demo1.audioapp"


cargo ndk  --link-libcxx-shared -t arm64-v8a -o app/src/main/jniLibs/  build
./gradlew clean
./gradlew assembleDebug
./gradlew installDebug
adb shell am start -n $PACKAGE/.MainActivity
bash log.sh