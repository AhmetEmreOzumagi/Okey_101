#!/bin/bash
# Mac'te terminalden derlemek için: Android Studio'nun kendi Java'sını (JBR) bulur ve gradlew'i çalıştırır.
#   ./derle.sh                 → ./gradlew assembleDebug
#   ./derle.sh bundleRelease   → istenen Gradle görevi
cd "$(dirname "$0")" || exit 1
if [ -z "$JAVA_HOME" ]; then
  for j in "/Applications/Android Studio.app/Contents/jbr/Contents/Home" "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
    if [ -x "$j/bin/java" ]; then export JAVA_HOME="$j"; break; fi
  done
fi
if [ -z "$JAVA_HOME" ] && ! command -v java >/dev/null 2>&1; then
  echo "Java bulunamadı. Android Studio kurulu olmalı (içindeki Java kullanılır) ya da JAVA_HOME ayarlanmalı."
  exit 1
fi
if [ ! -f local.properties ] && [ -d "$HOME/Library/Android/sdk" ]; then
  echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
fi
exec ./gradlew "${@:-assembleDebug}"
