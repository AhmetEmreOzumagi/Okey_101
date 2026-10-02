#!/bin/bash
# 101 Okey — internet linkiyle başlatır (herkes her ağdan girer). Çift tıklamanız yeterli.
cd "$(dirname "$0")" || exit 1
clear

NODE=""
command -v node >/dev/null 2>&1 && NODE="$(command -v node)"
if [ -z "$NODE" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  command -v node >/dev/null 2>&1 && NODE="$(command -v node)"
fi
if [ -z "$NODE" ]; then
  for p in /opt/homebrew/bin/node /usr/local/bin/node $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1); do
    if [ -x "$p" ]; then NODE="$p"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo ""
  echo "  Node.js bulunamadı. Oyunu açmak için bir kere Node.js kurmak gerekiyor (ücretsiz)."
  echo "  Açılan sayfadan LTS sürümünü indirip kurun, sonra bu dosyaya tekrar çift tıklayın."
  open "https://nodejs.org/" 2>/dev/null
  echo ""
  read -n 1 -s -r -p "  Kapatmak için bir tuşa basın..."
  exit 1
fi

"$NODE" baslat.js link

echo ""
echo "  Oyun kapandı. Bu pencereyi kapatabilirsiniz."
read -n 1 -s -r
