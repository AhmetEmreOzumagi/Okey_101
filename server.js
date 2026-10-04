'use strict';
/* 101 Okey yerel ağ sunucusu. Ek paket gerekmez: sadece Node'un kendi modülleri. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const G = require('./game.js');
const B = require('./bot.js');

const BASE_PORT = parseInt(process.env.PORT || '8101', 10);
const STATE_FILE = process.env.OKEY_STATE || path.join(__dirname, 'oyun-kaydi.json');
const PUBLIC = path.join(__dirname, 'public');

// Beklenmeyen bir hata oyunu asla kapatmasın.
process.on('uncaughtException', (e) => console.error('  (hata yakalandı, oyun devam ediyor)', e && e.message));
process.on('unhandledRejection', (e) => console.error('  (hata yakalandı, oyun devam ediyor)', e && e.message));

const clock = () => new Date().toTimeString().slice(0, 5);
const log = (msg) => console.log(`  ${clock()}  ${msg}`);

// ---------- Durum ----------
let state;
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state || state.v !== 1) throw new Error('eski');
  G.normalize(state);
  console.log('Kaldığınız oyun yüklendi.');
} catch (e) {
  state = G.create();
}
const BOOT = crypto.randomBytes(4).toString('hex');

let saveTimer = null;
function writeState() {
  saveTimer = null;
  try {
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
  } catch (e) {
    console.error('Kayıt yazılamadı:', e.message);
  }
}
function save() {
  state.seq = (state.seq || 0) + 1;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeState, 150);
}
// Pencere kapanırken ya da Ctrl+C'de son hamle de kaydedilsin
process.on('exit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    writeState();
  }
});
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  if (!process.listenerCount(sig)) process.on(sig, () => process.exit(0));
});

// ---------- Sayfa: tek dosya halinde, sıkıştırılmış ----------
// Zayıf Wi-Fi'da 5 ayrı dosya yerine tek istek: yarım yüklenen sayfa olmaz.
let page = null;
function buildPage() {
  const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
  const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
  let html = read('index.html');
  html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>' + read('style.css') + '</style>');
  // Bütün betikler sayfanın içine gömülür (engine.js, qr.js, cards.js, app.js ...)
  html = html.replace(/<script src="([a-z0-9-]+\.js)"><\/script>/g, (m, f) => '<script>' + safe(read(f)) + '</script>');
  const raw = Buffer.from(html, 'utf8');
  page = { raw, gz: zlib.gzipSync(raw, { level: 9 }), etag: '"' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16) + '"' };
}
buildPage();

// ---------- Bağlantılar ----------
const clients = new Set(); // {res, token, ip}
function isOnline(token) {
  if (!token) return false;
  for (const c of clients) if (c.token === token) return true;
  return false;
}
const ipOf = (req) => {
  const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return h || String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
};
const nameOf = (token) => {
  const i = G.seatOf(state, token);
  return i >= 0 ? state.seats[i].name : null;
};

const PLAT = process.env.OKEY_FAKE_PLATFORM || process.platform;
const IS_MAC = PLAT === 'darwin';
const IS_WIN = PLAT === 'win32';
let lanCache = [];
let bonjour = null;
let sharingNow = false;

// Mac'in "İnternet Paylaşımı" ile kurduğu kendi Wi-Fi ağı bridge arayüzünde görünür
// (genelde 192.168.2.1). Sanal makine köprülerinden (Parallels, VMware) ayırmak için
// köprüye Wi-Fi arayüzünün (ap1/en0/en1) bağlı olup olmadığına bakılır.
const bridgeCache = new Map();
function isSharingBridge(name, addr) {
  if (process.env.OKEY_FAKE_SHARING) return name === process.env.OKEY_FAKE_SHARING;
  if (!IS_MAC) return false;
  const key = name + addr;
  if (bridgeCache.has(key)) return bridgeCache.get(key);
  let yes = false;
  if (name === 'bridge0') { bridgeCache.set(key, false); return false; } // Thunderbolt Köprüsü
  try {
    const out = require('child_process').execSync('ifconfig ' + name, { timeout: 1500 }).toString();
    yes = /member:\s*ap\d\b/.test(out);
  } catch (e) {}
  if (!yes && /^192\.168\.2\./.test(addr)) yes = true;
  bridgeCache.set(key, yes);
  return yes;
}

function sharingName() {
  if (process.env.OKEY_FAKE_SSID) return process.env.OKEY_FAKE_SSID;
  if (!IS_MAC) return '';
  try {
    return require('child_process').execSync(
      '/usr/libexec/PlistBuddy -c "Print :NAT:AirPort:NetworkName" /Library/Preferences/SystemConfiguration/com.apple.nat.plist',
      { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) { return ''; }
}
let netInfo = { sharing: false, ssid: '', wifi: '', public: '' };
// "İnternetten Oyna" başlatıcısı açtığı linki bu dosyaya yazar
const LINK_FILE = path.join(__dirname, 'internet-linki.txt');
let publicUrl = '';
function readPublicUrl() {
  try {
    const lines = fs.readFileSync(LINK_FILE, 'utf8').split(/\r?\n/);
    const v = (lines[0] || '').trim();
    const m = /^pid=(\d+)/.exec(lines[1] || '');
    if (m && +m[1] !== process.pid) {
      try {
        process.kill(+m[1], 0);
      } catch (e) {
        if (e.code !== 'EPERM') return ''; // linki açan pencere kapanmış
      }
    }
    return /^https:\/\/[a-z0-9.-]+$/i.test(v) ? v : '';
  } catch (e) { return ''; }
}
let wifiNameCache = { at: 0, name: '' };
let wifiBusy = false;
function wifiNameWin() {
  if (wifiBusy || Date.now() - wifiNameCache.at < 20000) return wifiNameCache.name;
  wifiBusy = true;
  require('child_process').execFile('netsh', ['wlan', 'show', 'interfaces'], { timeout: 5000, windowsHide: true, encoding: 'buffer' }, (err, out) => {
    wifiBusy = false;
    let name = '';
    if (!err && out) {
      let txt = out.toString('utf8');
      if (txt.indexOf('\ufffd') >= 0) txt = out.toString('latin1');
      const m = txt.match(/^\s*SSID\s*:\s*(.+)$/m);
      if (m) name = m[1].trim();
    }
    wifiNameCache = { at: Date.now(), name };
  });
  return wifiNameCache.name;
}
function wifiName() {
  if (process.env.OKEY_FAKE_WIFI !== undefined) return process.env.OKEY_FAKE_WIFI;
  if (IS_WIN) return wifiNameWin();
  if (!IS_MAC) return '';
  if (Date.now() - wifiNameCache.at < 20000) return wifiNameCache.name;
  let name = '';
  const cp = require('child_process');
  try {
    const out = cp.execSync('ipconfig getsummary en0', { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = out.match(/^\s*SSID\s*:\s*(.+)$/m);
    if (m) name = m[1].trim();
  } catch (e) {}
  if (!name || /redacted/i.test(name)) {
    name = '';
    try {
      const out = cp.execSync('networksetup -getairportnetwork en0', { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const m = out.match(/Network:\s*(.+)$/m);
      if (m) name = m[1].trim();
    } catch (e) {}
  }
  wifiNameCache = { at: Date.now(), name };
  return name;
}

// Sanal makine, VPN, WSL gibi telefonların ulaşamayacağı arayüzler
const SKIP_IF = /^(utun|vmnet|vboxnet|docker|awdl|llw|ppp|ipsec|tun|tap|anpi|feth|zt|veth|virbr|br-|lxc|lxd|tailscale|wg)/i;
const SKIP_WIN = /(vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|Npcap|Tailscale|ZeroTier|Hamachi|Radmin|TAP-|OpenVPN|WireGuard|Wintun|Docker|Parallels|Teredo|isatap)/i;
function kindOf(name, addr) {
  if (IS_WIN) {
    if (/^192\.168\.137\./.test(addr) || /^(Local Area Connection|Yerel Ağ Bağlantısı)\*/i.test(name)) return 'hotspot'; // Windows Mobil etkin nokta
    if (/^(Wi-?Fi|WLAN|Wireless|Kablosuz)/i.test(name)) return 'wifi';
    if (/^(Ethernet|Local Area Connection|Yerel Ağ)/i.test(name)) return 'lan';
    return 'other';
  }
  if (/^wl/.test(name)) return 'wifi';
  if (/^(eth|en)/.test(name)) return 'lan';
  return 'other';
}
function lanUrls(port) {
  const out = [];
  const ifs = process.env.OKEY_FAKE_IFS ? JSON.parse(process.env.OKEY_FAKE_IFS) : os.networkInterfaces();
  sharingNow = false;
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      const fam = typeof a.family === 'string' ? a.family : a.family === 4 ? 'IPv4' : 'IPv6';
      if (fam !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.') || a.address.startsWith('127.')) continue;
      let sharing = false;
      let kind = 'other';
      if (IS_MAC) {
        if (/^bridge/.test(name)) {
          if (!isSharingBridge(name, a.address)) continue;
          sharing = true;
          sharingNow = true;
        } else if (SKIP_IF.test(name)) continue;
        kind = name === 'en0' ? 'wifi' : 'other';
      } else {
        if (SKIP_IF.test(name) || (IS_WIN && SKIP_WIN.test(name))) continue;
        kind = kindOf(name, a.address);
        if (kind === 'hotspot') {
          sharing = true;
          sharingNow = true;
        }
      }
      out.push({ name, url: `http://${a.address}:${port}`, addr: a.address, sharing, kind });
    }
  }
  // Bilgisayar Wi-Fi'a (ya da kabloyla modeme) bağlıysa her zaman o adres önde.
  // Mac kendi ağını yayınlıyorsa en0'ın adresi olmaz; o zaman paylaşım ağı öne geçer.
  const wifiUp = out.some((x) => x.kind === 'wifi' || (!IS_MAC && x.kind === 'lan'));
  if (wifiUp) sharingNow = false;
  const score = (x) => (x.kind === 'wifi' ? -20 : x.kind === 'lan' && !IS_MAC ? -18 : 0) + (x.sharing ? -10 : 0) +
    (x.addr.startsWith('192.168.') || x.addr.startsWith('172.20.10.') || x.addr.startsWith('10.') ? 0 : 1);
  out.sort((a, b) => score(a) - score(b));
  const urls = out.map((x) => x.url);
  if (bonjour) urls.push(`http://${bonjour}:${port}`);
  publicUrl = readPublicUrl();
  if (publicUrl) urls.unshift(publicUrl);
  const wifi = out.some((x) => x.kind === 'wifi') ? wifiName() : '';
  if (sharingNow !== netInfo.sharing || wifi !== netInfo.wifi || publicUrl !== netInfo.public) netInfo = { sharing: sharingNow, ssid: sharingNow ? sharingName() : '', wifi, public: publicUrl };
  return urls;
}
if (IS_MAC && process.platform === 'darwin') {
  try {
    const n = require('child_process').execSync('scutil --get LocalHostName', { timeout: 2000 }).toString().trim();
    if (n) bonjour = n + '.local';
  } catch (e) {}
}

function viewFor(token) {
  const v = G.view(state, token, isOnline, { lan: lanCache, boot: BOOT });
  v.net = netInfo;
  return v;
}
function send(c) {
  c.res.write(`data: ${JSON.stringify(viewFor(c.token))}\n\n`);
}
function broadcast() {
  for (const c of clients) {
    try {
      send(c);
    } catch (e) {
      /* bağlantı kapanmış olabilir */
    }
  }
}

// ---------- HTTP ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const seenIps = new Map();
function servePage(req, res) {
  const ip = ipOf(req);
  if (ip && Date.now() - (seenIps.get(ip) || 0) > 60000) {
    seenIps.set(ip, Date.now());
    if (ip !== '127.0.0.1' && ip !== '::1') log(`Sayfa açıldı: ${ip}${req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] ? ' (internet linkinden)' : ''}`);
  }
  if (req.headers['if-none-match'] === page.etag) {
    res.writeHead(304, { ETag: page.etag });
    return res.end();
  }
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gz ? page.gz : page.raw;
  const h = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: page.etag, 'Content-Length': body.length };
  if (gz) h['Content-Encoding'] = 'gzip';
  res.writeHead(200, h);
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  let p;
  try {
    p = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  } catch (e) {
    p = '/__yok__';
  }
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Bilinmeyen adres: oyunun ana sayfasına yönlendir (adres yanlış yazılsa bile oyun açılsın)
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 65536) {
        reject(new Error('Çok büyük'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj, req) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  // Zayıf bağlantıda (ör. internet linki) veri az gitsin
  if (req && body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const gz = zlib.gzipSync(body, { level: 6 });
    h['Content-Encoding'] = 'gzip';
    res.writeHead(code, h);
    return res.end(gz);
  }
  res.writeHead(code, h);
  res.end(body);
}

async function handleApi(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, error: 'Geçersiz istek.' });
  }
  const a = body || {};
  try {
    if (a.type === 'join') {
      const want = Number.isInteger(a.seat) ? a.seat : -1;
      const r = G.join(state, a.name, a.token, isOnline, want);
      log(`Masaya oturdu: ${state.seats[r.seat].name} (${ipOf(req)})`);
      save();
      broadcast();
      return json(res, 200, { ok: true, token: r.token, seat: r.seat, view: viewFor(r.token) }, req);
    }
    const seat = G.seatOf(state, a.token);
    if (seat < 0) return json(res, 200, { ok: false, error: 'Masada değilsin. Adını yazıp otur.', notSeated: true });
    G.lobbyAction(state, seat, a, isOnline);
    save();
    broadcast();
    // Hamle yapan telefon canlı bağlantısı kopuk olsa bile yeni durumu hemen görsün
    return json(res, 200, { ok: true, view: viewFor(a.token) }, req);
  } catch (e) {
    if (e instanceof G.GameError) return json(res, 200, { ok: false, error: e.message, view: viewFor(a.token) }, req);
    console.error(e);
    return json(res, 500, { ok: false, error: 'Sunucu hatası: ' + e.message });
  }
}

function handleEvents(req, res, url) {
  const token = url.searchParams.get('token') || '';
  req.socket.setKeepAlive(true, 10000);
  req.socket.setNoDelay(true);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1000\n\n');
  const c = { res, token, ip: ipOf(req) };
  const wasOnline = isOnline(token);
  clients.add(c);
  const who = nameOf(token);
  if (!wasOnline && who) log(`Bağlandı: ${who} (${c.ip})`);
  if (!wasOnline) broadcast();
  else send(c);
  const bye = () => {
    if (!clients.has(c)) return;
    clients.delete(c);
    if (!isOnline(token)) {
      if (who) log(`Bağlantısı koptu: ${who} (telefon kendiliğinden yeniden bağlanır)`);
      broadcast();
    }
  };
  req.on('close', bye);
  res.on('error', bye);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }
  const p = url.pathname;
  if (req.method === 'POST' && p === '/api') return handleApi(req, res);
  if (req.method === 'GET' && p === '/events') return handleEvents(req, res, url);
  if (req.method === 'GET' && p === '/state') return json(res, 200, viewFor(url.searchParams.get('token') || ''), req);
  if (req.method === 'GET' && p === '/ping') return json(res, 200, { ok: true, app: '101-okey' });
  if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/' || p === '/index.html')) return servePage(req, res);
  if (req.method === 'GET' && p === '/favicon.ico') return serveStatic(req, res, '/icon.png');
  if (req.method === 'GET') return serveStatic(req, res, p);
  res.writeHead(405);
  res.end();
});
server.keepAliveTimeout = 30000;
server.headersTimeout = 35000;

// Süre sayacı (süresi dolanın yerine otomatik oyna) ve botlar
setInterval(() => {
  try {
    const now = Date.now();
    let changed = G.tick(state, now);
    if (B.step(state, now)) changed = true;
    if (changed) {
      save();
      broadcast();
    }
  } catch (e) {
    console.error('  (süre hatası)', e && e.message);
  }
}, 400);

// Bağlantıları canlı tut (telefon 10 sn'de bir sinyal alır, gelmezse yeniden bağlanır)
setInterval(() => {
  for (const c of clients) {
    try {
      c.res.write('event: ping\ndata: 1\n\n');
    } catch (e) {}
  }
}, 10000);

let port = BASE_PORT;
function openBrowser() {
  if (process.env.OKEY_OPEN !== '1') return;
  const cp = require('child_process');
  const url = 'http://localhost:' + port;
  const done = () => {};
  try {
    if (process.platform === 'darwin') cp.execFile('open', [url], done);
    else if (process.platform === 'win32') cp.exec('start "" "' + url + '"', { windowsHide: true }, done);
    else cp.execFile('xdg-open', [url], done);
  } catch (e) {}
}
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('\n101 Okey zaten açık (başka bir pencerede çalışıyor). O pencereyi kullanın.\n');
    openBrowser();
    setTimeout(() => process.exit(0), 500);
  } else {
    console.error('Sunucu başlatılamadı:', e.message);
    process.exit(1);
  }
});

function printAddress(title) {
  const line = '='.repeat(60);
  console.log('\n' + line);
  console.log('   ' + title);
  console.log(line);
  if (publicUrl) {
    console.log('\n   İNTERNET LİNKİ (her ağdan, mobil veriyle de girilir):\n');
    console.log('      ' + publicUrl);
    console.log('\n   Bilgisayardaki oyun sayfasında bu linkin QR kodu var. Linki WhatsApp\'tan da atabilirsiniz.');
    console.log('   Bu pencere açık kaldıkça link çalışır. KAPATMAYIN.');
    console.log(line + '\n');
    return;
  }
  const ips = lanCache.filter((u) => !/\.local:/.test(u) && !/^https:/.test(u));
  if (netInfo.sharing) {
    if (IS_MAC) console.log('\n   Mac kendi Wi-Fi ağını yayınlıyor' + (netInfo.ssid ? ': "' + netInfo.ssid + '"' : '') + '.');
    else console.log('\n   Bilgisayarın Mobil etkin noktası açık' + (netInfo.ssid ? ': "' + netInfo.ssid + '"' : '') + '.');
    console.log('   Herkes önce Wi-Fi ayarlarından bu ağa bağlansın.');
  }
  if (netInfo.wifi) console.log('\n   ' + (IS_MAC ? 'Mac' : 'Bilgisayar') + ' şu Wi-Fi ağına bağlı: "' + netInfo.wifi + '". Herkes bu ağa bağlansın.');
  if (ips.length) {
    console.log('\n   Telefonlarda tarayıcıyı (Chrome ya da Safari) açıp şu adrese girin:\n');
    console.log('      ' + ips[0]);
    const pre = ips[0].replace(/^http:\/\//, '').split(':')[0].split('.').slice(0, 3).join('.') + '.';
    console.log('\n   Telefonun Wi-Fi ayrıntılarındaki IP adresi ' + pre + ' ile başlar; çok farklıysa o telefon başka bir ağda.');
    if (lanCache.length > 1) console.log('\n   Olmazsa: ' + lanCache.slice(1).join('   '));
  } else if (IS_MAC) {
    console.log('\n   UYARI: Ağ bağlantısı yok. Mac\'i Wi-Fi\'a bağlayın ya da Mac\'in kendi ağını açın');
    console.log('   (Sistem Ayarları > Genel > Paylaşma > İnternet Paylaşımı). O zaman adres: http://192.168.2.1:' + port);
  } else if (IS_WIN) {
    console.log('\n   UYARI: Ağ bağlantısı yok. Bilgisayarı Wi-Fi\'a bağlayın ya da kendi ağını açın');
    console.log('   (Ayarlar > Ağ ve internet > Mobil etkin nokta). O zaman adres: http://192.168.137.1:' + port);
  } else {
    console.log('\n   UYARI: Ağ bağlantısı yok. Bilgisayarı Wi-Fi\'a bağlayın.');
  }
  if (IS_WIN) {
    console.log('\n   Windows Güvenlik Duvarı sorarsa "Erişime izin ver" deyin. Telefonlar yine giremezse:');
    console.log('   Ayarlar > Ağ ve internet > Wi-Fi > (bağlı ağ) > Ağ profili türü: Özel ağ.');
  }
  console.log('\n   Bu pencereyi KAPATMAYIN. Kapatınca oyun durur.');
  console.log('   Kimin bağlandığı aşağıda görünür. Bir telefon girmeye çalıştığında');
  console.log('   "Sayfa açıldı" satırı çıkmıyorsa, o telefon ' + (IS_MAC ? 'Mac\'e' : 'bilgisayara') + ' hiç ulaşamıyor demektir (ağ sorunu).');
  console.log(line + '\n');
}

server.on('listening', () => {
  lanCache = lanUrls(port);
  setInterval(() => {
    const hadLink = /^https:/.test(lanCache[0] || '');
    const now = lanUrls(port);
    if (JSON.stringify(now) !== JSON.stringify(lanCache)) {
      lanCache = now;
      if (publicUrl) printAddress('İNTERNET LİNKİ HAZIR');
      else if (hadLink) log('İnternet linki kapandı; yenisi açılınca burada ve oyun sayfasında görünür.');
      else printAddress('AĞ DEĞİŞTİ — YENİ ADRES');
      broadcast();
    }
  }, 2000);
  printAddress('101 OKEY ÇALIŞIYOR');
  openBrowser();
});
server.listen(port, '0.0.0.0');

module.exports = { server, getPort: () => port };
