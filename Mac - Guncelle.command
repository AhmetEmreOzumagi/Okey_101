#!/bin/bash
# 101 Okey'i GitHub'daki en yeni sürüme günceller, sonra oyunu internet linkiyle açar.
# Oyun kaydı ve bağlantı aracı (bin klasörü) olduğu gibi kalır. Çift tıklamanız yeterli.
main() {
  cd "$(dirname "$0")" || exit 1
  clear
  echo ""
  echo "  101 Okey güncelleniyor..."
  local TMP
  TMP="$(mktemp -d)"
  if curl -fsSL --retry 2 -o "$TMP/okey.zip" "https://github.com/AhmetEmreOzumagi/Okey_101/archive/refs/heads/main.zip" &&
     unzip -oq "$TMP/okey.zip" -d "$TMP" && [ -f "$TMP/Okey_101-main/baslat.js" ]; then
    cp -R "$TMP/Okey_101-main/." .
    chmod +x ./*.command 2>/dev/null
    echo "  Güncellendi, en yeni sürüm hazır."
  else
    echo "  Güncelleme indirilemedi (internet bağlantısını kontrol edin)."
    echo "  Eldeki sürümle devam ediliyor."
  fi
  rm -rf "$TMP"
  [ -n "$OKEY_NO_START" ] && exit 0
  sleep 1
  exec bash "Mac - Internetten Oyna.command"
}
main "$@"
exit
