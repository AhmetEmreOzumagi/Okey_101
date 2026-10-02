#!/usr/bin/env node
'use strict';
/*
  101 Okey başlatıcı. Mac, Windows ve Linux'ta aynı çalışır; ek paket gerekmez.

    node baslat.js          Aynı Wi-Fi'dan oynamak için (internet gerekmez)
    node baslat.js link     İnternet linkiyle: herkes her ağdan, mobil veriyle de girer

  Seçenekler:  --port 9000      başka port
               --tarayici-acma  bilgisayarda tarayıcıyı açma
*/
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const cp = require('child_process');

const DIR = __dirname;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const args = process.argv.slice(2);
const flag = (a) => String(a).toLowerCase().replace(/^-+/, '');
const has = (names) => args.some((a) => names.indexOf(flag(a)) >= 0);

if (require.main === module && has(['yardim', 'yardım', 'help', 'h', '?'])) {
  console.log([
    '',
    '  node baslat.js          Aynı Wi-Fi\'dan oynamak için (internet gerekmez)',
    '  node baslat.js link     İnternet linkiyle (her ağdan, mobil veriyle de)',
    '',
    '  --port 9000      başka port kullan',
    '  --tarayici-acma  bilgisayarda oyun sayfasını açma',
    '',
  ].join('\n'));
  process.exit(0);
}

const LINK_MODE = has(['link', 'internet', 'l', 'i']);
const NO_OPEN = has(['tarayici-acma', 'tarayıcı-açma', 'no-open']) || process.env.OKEY_OPEN === '0';
const portAt = args.findIndex((a) => flag(a) === 'port');
const PORT = parseInt((portAt >= 0 && args[portAt + 1]) || process.env.PORT || '8101', 10);
process.env.PORT = String(PORT);

const LOCAL = 'http://localhost:' + PORT;
const LINK_FILE = path.join(DIR, 'internet-linki.txt');
const BIN_DIR = path.join(DIR, 'bin');
const CF = path.join(BIN_DIR, IS_WIN ? 'cloudflared.exe' : 'cloudflared');
const CF_BASE = process.env.OKEY_CF_BASE || 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
const CF_MAX_AGE = 120 * 24 * 3600 * 1000; // eski araç Cloudflare'de çalışmayı bırakabilir; arada bir yenilenir
const LINE = '  ' + '='.repeat(60);

const say = (s) => console.log('  ' + s);
const children = [];
let ownServer = false;
let exiting = false;
let tunnelChild = null;
let currentLink = '';

if (require.main === module && parseInt(process.versions.node, 10) < 14) {
  say('UYARI: Node.js sürümünüz eski (' + process.version + '). Sorun çıkarsa https://nodejs.org adresinden LTS sürümünü kurun.');
}

// ---------- yardımcılar ----------
function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/ping', timeout: 1500 }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(res.statusCode === 200 && /"ok"\s*:\s*true/.test(b)));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function openUrl(url) {
  if (NO_OPEN) return;
  const done = () => {};
  try {
    if (IS_MAC) cp.execFile('open', [url], done);
    else if (IS_WIN) cp.exec('start "" "' + url + '"', { windowsHide: true }, done);
    else cp.execFile('xdg-open', [url], done);
  } catch (e) {}
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Link dosyası: 1. satır link, 2. satır "pid=..." (hangi pencerenin açtığı)
function readLinkFile() {
  try {
    const lines = fs.readFileSync(LINK_FILE, 'utf8').split(/\r?\n/);
    const m = /^pid=(\d+)/.exec(lines[1] || '');
    return { url: (lines[0] || '').trim(), pid: m ? parseInt(m[1], 10) : 0 };
  } catch (e) {
    return null;
  }
}
function liveLinkOfOther() {
  const f = readLinkFile();
  if (!f) return '';
  if (f.pid && f.pid !== process.pid && alive(f.pid)) return f.url;
  try {
    fs.unlinkSync(LINK_FILE); // kapanmış bir pencereden kalmış
  } catch (e) {}
  return '';
}
function writeLink(url) {
  currentLink = url;
  try {
    fs.writeFileSync(LINK_FILE, url + '\npid=' + process.pid + '\n');
  } catch (e) {}
  if (!ownServer) showLink(url); // oyun bu pencerede çalışıyorsa linki kendisi yazar
}
function clearLink() {
  currentLink = '';
  const f = readLinkFile();
  if (f && f.pid === process.pid) {
    try {
      fs.unlinkSync(LINK_FILE);
    } catch (e) {}
  }
}
function showLink(url) {
  console.log('\n' + LINE);
  say(' İNTERNET LİNKİ HAZIR:\n');
  say('    ' + url + '\n');
  say(' Bilgisayardaki oyun sayfasında bu linkin QR kodu çıkar.');
  say(' Arkadaşlar okutsun ya da linki WhatsApp\'tan atın.');
  say(' Bu pencere açık kaldıkça link çalışır. KAPATMAYIN.');
  console.log(LINE + '\n');
}

// Oyun sürerken bilgisayar uyumasın (uyursa herkes kopar)
function keepAwake() {
  try {
    let c = null;
    if (IS_MAC) {
      c = cp.spawn('caffeinate', ['-dis', '-w', String(process.pid)], { stdio: 'ignore' });
    } else if (IS_WIN) {
      const ps = "$s='[DllImport(''kernel32.dll'')] public static extern uint SetThreadExecutionState(uint f);';" +
        '$k=Add-Type -MemberDefinition $s -Name Uyanik -Namespace Okey101 -PassThru;' +
        'while(Get-Process -Id ' + process.pid + ' -ErrorAction SilentlyContinue){[void]$k::SetThreadExecutionState([uint32]2147483651);Start-Sleep -Seconds 30}';
      c = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true });
    }
    if (c) {
      c.on('error', () => {});
      children.push(c);
    }
  } catch (e) {}
}

// ---------- bağlantı aracı (Cloudflare) ----------
function cfAsset() {
  const a = process.arch;
  if (IS_MAC) return a === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
  if (IS_WIN) return a === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe';
  if (process.platform === 'linux') {
    return { x64: 'cloudflared-linux-amd64', arm64: 'cloudflared-linux-arm64', arm: 'cloudflared-linux-arm', ia32: 'cloudflared-linux-386' }[a] || '';
  }
  return '';
}

function download(url, onProgress, hops) {
  hops = hops || 0;
  return new Promise((resolve, reject) => {
    const mod = /^https:/.test(url) ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': '101-okey' }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
        res.resume();
        if (hops > 8) return reject(new Error('çok fazla yönlendirme'));
        return resolve(download(new URL(res.headers.location, url).toString(), onProgress, hops + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('sunucu ' + res.statusCode + ' dedi'));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const parts = [];
      let got = 0;
      res.on('data', (c) => {
        parts.push(c);
        got += c.length;
        if (onProgress) onProgress(got, total);
      });
      res.on('end', () => (total && got < total ? reject(new Error('yarım indi')) : resolve(Buffer.concat(parts))));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('zaman aşımı')));
    req.on('error', reject);
  });
}

// .tgz içinden tek dosyayı çıkarır (tar komutuna gerek kalmasın)
function fromTar(buf, want) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.slice(off, off + 512);
    if (h[0] === 0) break;
    let name = h.toString('utf8', 0, 100).split('\0')[0];
    const prefix = h.toString('utf8', 345, 500).split('\0')[0];
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(h.toString('ascii', 124, 136).split('\0')[0].trim() || '0', 8) || 0;
    const type = h[156];
    off += 512;
    if ((type === 48 || type === 0) && name.split('/').pop() === want) return buf.slice(off, off + size);
    off += Math.ceil(size / 512) * 512;
  }
  return null;
}

function cfWorks() {
  return new Promise((resolve) => {
    cp.execFile(CF, ['--version'], { timeout: 20000, windowsHide: true }, (err, out) => resolve(!err && /cloudflared/i.test(String(out))));
  });
}

async function prepareCloudflared() {
  if (process.env.OKEY_NO_CF) return false;
  let have = false;
  let old = false;
  try {
    const st = fs.statSync(CF);
    have = st.size > 1e6;
    old = Date.now() - st.mtimeMs > CF_MAX_AGE;
  } catch (e) {}
  if (have && !old) return true;
  const asset = cfAsset();
  if (!asset) return have;
  console.log('');
  say(have ? 'Bağlantı aracı güncelleniyor...' : 'Bağlantı aracı indiriliyor (sadece ilk seferde, yaklaşık 20 MB)...');
  const tty = process.stdout.isTTY;
  let last = -1;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await download(CF_BASE + asset, (got, total) => {
        if (!tty || !total) return;
        const pct = Math.floor((got * 100) / total);
        if (pct !== last) {
          last = pct;
          process.stdout.write('\r  %' + pct + '   ');
        }
      });
      if (tty) process.stdout.write('\r          \r');
      const bin = /\.tgz$/.test(asset) ? fromTar(zlib.gunzipSync(data), 'cloudflared') : data;
      if (!bin || bin.length < 1e6) throw new Error('indirilen dosya bozuk');
      fs.mkdirSync(BIN_DIR, { recursive: true });
      const tmp = CF + '.indiriliyor';
      fs.writeFileSync(tmp, bin);
      fs.chmodSync(tmp, 0o755);
      try {
        fs.unlinkSync(CF);
      } catch (e) {}
      fs.renameSync(tmp, CF);
      if (await cfWorks()) {
        say('Hazır.');
        return true;
      }
      try {
        fs.unlinkSync(CF);
      } catch (e) {}
      throw new Error('araç bu bilgisayarda çalışmadı');
    } catch (e) {
      if (tty) process.stdout.write('\r          \r');
      say('İndirme olmadı (' + e.message + ')' + (attempt < 3 ? ', tekrar deneniyor...' : '.'));
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (have) {
    say('Eldeki araçla devam ediliyor.');
    return true;
  }
  say('Yedek yöntem (ssh / localhost.run) kullanılacak.');
  return false;
}

// Satırlardaki linki bulur; yan adresleri (api., admin. ...) atlar
function findLink(text) {
  const re = /https:\/\/([a-z0-9-]+)\.(trycloudflare\.com|lhr\.life|localhost\.run)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const sub = m[1].toLowerCase();
    const dom = m[2].toLowerCase();
    if (/^(api|admin|www|docs|dashboard|status)$/.test(sub)) continue;
    if (dom === 'trycloudflare.com' && sub.indexOf('-') < 0) continue;
    return 'https://' + sub + '.' + dom;
  }
  return '';
}

function startTunnel(cfReady) {
  const methods = cfReady ? ['cf', 'ssh'] : ['ssh'];
  let idx = 0;
  let fails = 0;
  let warned = false;

  function run() {
    if (exiting) return;
    const use = methods[idx % methods.length];
    let child;
    try {
      child = use === 'cf'
        ? cp.spawn(CF, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + PORT], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        : cp.spawn('ssh', ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
            '-o', 'ExitOnForwardFailure=yes', '-R', '80:127.0.0.1:' + PORT, 'nokey@localhost.run'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return setTimeout(run, 10000);
    }
    tunnelChild = child;
    let got = false;
    let ended = false;
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      if (buf.length > 4096) buf = buf.slice(-4096);
      for (const line of lines) {
        const url = findLink(line);
        if (url && url !== currentLink) {
          got = true;
          fails = 0;
          warned = false;
          clearTimeout(noLink);
          writeLink(url);
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    // 45 sn'de link gelmezse bu yöntemi bırakıp diğerini dene
    const noLink = setTimeout(() => {
      if (!got) {
        try {
          child.kill();
        } catch (e) {}
      }
    }, 45000);
    const end = (err) => {
      if (ended) return;
      ended = true;
      clearTimeout(noLink);
      tunnelChild = null;
      if (exiting) return;
      if (err && err.code === 'ENOENT' && use === 'ssh' && methods.length > 1) methods.splice(methods.indexOf('ssh'), 1);
      clearLink();
      let wait;
      if (got) {
        say('Link bağlantısı koptu (internet gitmiş olabilir). Yeniden bağlanıyor...');
        say('Yeni link çıkarsa oyun sayfasındaki QR da kendiliğinden değişir.');
        wait = 2000;
      } else {
        fails++;
        idx++;
        wait = Math.min(30000, 3000 * fails);
        if (fails >= methods.length && !warned) {
          warned = true;
          say('İnternet linki şu an açılamıyor. İnternet bağlantısını kontrol edin; arka planda denemeye devam ediyor.');
          say('Bu sırada aynı Wi-Fi\'dakiler yukarıdaki yerel adresten girebilir.');
        }
      }
      setTimeout(run, wait);
    };
    child.on('error', end);
    child.on('exit', () => end());
  }
  console.log('');
  say('İnternet linki açılıyor, birkaç saniye sürebilir...');
  run();
}

// ---------- kapanış ----------
function cleanup() {
  exiting = true;
  clearLink();
  if (tunnelChild) {
    try {
      tunnelChild.kill();
    } catch (e) {}
  }
  for (const c of children) {
    try {
      c.kill();
    } catch (e) {}
  }
}
// ---------- başla ----------
async function main() {
  process.on('exit', cleanup);
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
    process.on(sig, () => {
      if (!exiting) console.log('\n  Oyun kapatılıyor. Tekrar açınca kaldığı yerden devam eder.');
      process.exit(0);
    });
  });
  console.log('');
  say(LINK_MODE ? '101 Okey internet linkiyle başlıyor...' : '101 Okey başlıyor...');
  const running = await ping();
  if (running) {
    if (!LINK_MODE) {
      say('Oyun zaten açık (başka bir pencerede). O pencereyi kullanın; sayfa tarayıcıda açılıyor.');
      openUrl(LOCAL);
      return setTimeout(() => process.exit(0), 800);
    }
    const other = liveLinkOfOther();
    if (other) {
      say('İnternet linki zaten açık (başka bir pencerede): ' + other);
      openUrl(LOCAL);
      return setTimeout(() => process.exit(0), 800);
    }
    say('Oyun zaten açık; ona internet linki açılıyor.');
  } else {
    liveLinkOfOther(); // eski pencereden kalan linki temizle
    if (!NO_OPEN) process.env.OKEY_OPEN = '1';
    ownServer = true;
    require('./server.js');
  }
  keepAwake();
  if (LINK_MODE) startTunnel(await prepareCloudflared());
}

if (require.main === module) main();
module.exports = { fromTar, findLink, cfAsset };
