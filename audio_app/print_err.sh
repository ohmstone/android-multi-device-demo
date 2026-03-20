#!/bin/zsh
set -e

adb logcat -v color \
  AndroidRuntime:E \
  libc:E \
  DEBUG:E \
  main:I \
  '*:S'
