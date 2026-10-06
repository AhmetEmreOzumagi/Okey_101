#!/usr/bin/env node
'use strict';
/* Android için JS paketleyici (Gradle'daki PaketleJs görevinin Node karşılığı; testler bunu kullanır).

     node android/paketle.js [çıkış klasörü]

   Çıkış: <klasör>/host.js ve <klasör>/public/* . Klasör verilmezse android/app/build/uretilen/assets. */
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const MODULLER = ['lib.js', 'public/engine.js', 'pisti.js', 'uno.js', 'game.js', 'bot.js', 'android/host/host-core.js'];

function paketMetni() {
  let s = '// ÜRETİLMİŞ DOSYA — elle değiştirmeyin. Kaynak: depo kökündeki JS dosyaları (bkz. android/paketle.js).\n';
  s += fs.readFileSync(path.join(__dirname, 'host/paket-onsoz.js'), 'utf8');
  const dosyalar = MODULLER.map((m) => path.join(KOK, m)).sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  for (const f of dosyalar) {
    s += `\n__modul('${path.basename(f)}', function (module, exports, require) {\n${fs.readFileSync(f, 'utf8')}\n});\n`;
  }
  s += fs.readFileSync(path.join(__dirname, 'host/paket-sonsoz.js'), 'utf8');
  return s;
}

function paketle(cikis) {
  fs.rmSync(cikis, { recursive: true, force: true });
  fs.mkdirSync(path.join(cikis, 'public'), { recursive: true });
  for (const f of fs.readdirSync(path.join(KOK, 'public'))) {
    if (f.startsWith('.')) continue;
    fs.copyFileSync(path.join(KOK, 'public', f), path.join(cikis, 'public', f));
  }
  fs.writeFileSync(path.join(cikis, 'host.js'), paketMetni());
  return cikis;
}

if (require.main === module) {
  const out = paketle(path.resolve(process.argv[2] || path.join(__dirname, 'app/build/uretilen/assets')));
  console.log('Paketlendi:', out);
}
module.exports = { paketMetni, paketle, MODULLER };
