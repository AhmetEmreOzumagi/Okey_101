'use strict';
/* Masa kuran telefondaki oyun çekirdeği.

   server.js'in ağ dışındaki bütün işleri burada: durum, kayıt, görünüm (view), bağlı/kopuk
   takibi, 400 ms'lik süre/bot döngüsü, lobide uzun süre bağlı olmayanın kalkması.
   HTTP sunucusu ve SSE bağlantıları Kotlin tarafında (HttpSunucu.kt). Kotlin her istek için
   Host.call(jsonMetin) çağırır; bu çekirdek JSON metin döndürür. Çekirdek dışarıya hiç
   çağrı yapmaz (zamanlayıcı da kurmaz): her şeyi Kotlin tetikler, böylece gizli WebView'in
   zamanlayıcı kısıtlamaları oyunu etkilemez.

   İşlemler (op):
     init     { saved, boot, awayMs }      kayıttan yükle ya da yeni masa kur
     state    { token, ip }                GET /state
     api      { body, ip }                 POST /api  (body: nesne)
     ping     {}                           GET /ping
     sseOpen  { id, token, ip }            yeni canlı bağlantı
     sseClose { id }                       canlı bağlantı kapandı
     tick     { now }                      400 ms'de bir: süre, botlar, lobiden kalkma
     lan      { urls, net }                telefonun adresleri değişti
     dump     {}                           kaydedilecek durum (JSON metin)

   Cevap: { code, body, push, save, hostName }
     body:     HTTP cevabının gövdesi (JSON metin)
     push:     { bağlantıId: görünümJson } canlı bağlantılara gönderilecekler
     save:     true ise durum değişti, Kotlin kısa süre sonra dump alıp dosyaya yazar
     hostName: masayı kuran telefon (127.0.0.1) masaya oturdu; NSD adı bu olsun */
const G = require('./game.js');
const B = require('./bot.js');

let state = null;
let boot = '';
let started = 0;
let awayMs = 3 * 60 * 1000;
const sse = new Map(); // bağlantı id -> { token, ip, who }
const polledAt = new Map(); // token -> canlı bağlantısı olmayan telefonun son yoklaması
const lastSeen = new Map(); // token -> en son ne zaman bağlıydı
let lanUrls = [];
let netInfo = { sharing: false, ssid: '', wifi: '', public: '' };
const LOOPBACK = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1|localhost)$/;

const clock = () => new Date().toTimeString().slice(0, 5);
const log = (msg) => console.log(`${clock()}  ${msg}`);

// ---------- Bağlı mı? ----------
const touch = (token) => { if (token) { const t = Date.now(); polledAt.set(token, t); lastSeen.set(token, t); } };
const seen = (token) => { if (token) lastSeen.set(token, Date.now()); };
function isOnline(token) {
  if (!token) return false;
  for (const c of sse.values()) if (c.token === token) return true;
  return Date.now() - (polledAt.get(token) || 0) < 7000;
}
const isAway = (token) => !isOnline(token) && Date.now() - (lastSeen.get(token) || started) > awayMs;
const nameOf = (token) => {
  const i = G.seatOf(state, token);
  return i >= 0 ? state.seats[i].name : null;
};

// ---------- Görünümler ----------
function viewFor(token) {
  const v = G.view(state, token, isOnline, { lan: lanUrls, boot });
  v.net = netInfo;
  return v;
}
// Bütün canlı bağlantılara gidecek görünümler (aynı token'a tek hesap)
function pushAll() {
  const out = {};
  const byToken = new Map();
  for (const [id, c] of sse) {
    if (!byToken.has(c.token)) byToken.set(c.token, JSON.stringify(viewFor(c.token)));
    out[id] = byToken.get(c.token);
  }
  return out;
}
let dirty = false;
function save() {
  state.seq = (state.seq || 0) + 1;
  dirty = true;
}

// ---------- İşlemler ----------
function init(a) {
  boot = String(a.boot || Math.random().toString(16).slice(2, 10));
  if (a.awayMs) awayMs = +a.awayMs;
  started = Date.now();
  sse.clear(); polledAt.clear(); lastSeen.clear();
  let loaded = false;
  try {
    if (a.saved) {
      const s = JSON.parse(a.saved);
      if (!s || s.v !== 1) throw new Error('eski');
      state = G.normalize(s);
      loaded = true;
      log('Kaldığınız oyun yüklendi.');
    }
  } catch (e) {
    state = null;
  }
  if (!state) state = G.create();
  dirty = false;
  return { code: 200, body: JSON.stringify({ ok: true, loaded, phase: state.phase }) };
}

function doState(a) {
  const tk = a.token || '';
  const was = isOnline(tk);
  touch(tk);
  const res = { code: 200, body: JSON.stringify(viewFor(tk)) };
  if (!was && G.seatOf(state, tk) >= 0) res.push = pushAll(); // masadakiler onun geldiğini görsün
  return res;
}

function doApi(a) {
  const body = a.body && typeof a.body === 'object' ? a.body : null;
  if (!body) return { code: 400, body: JSON.stringify({ ok: false, error: 'Geçersiz istek.' }) };
  const ip = a.ip || '';
  try {
    if (body.type === 'join') {
      const want = Number.isInteger(body.seat) ? body.seat : -1;
      const r = G.join(state, body.name, body.token, isOnline, want);
      seen(r.token);
      const name = state.seats[r.seat].name;
      log(`Masaya oturdu: ${name} (${ip})`);
      save();
      const res = { code: 200, body: JSON.stringify({ ok: true, token: r.token, seat: r.seat, view: viewFor(r.token) }), push: pushAll(), save: true };
      if (LOOPBACK.test(ip)) res.hostName = name; // masayı kuran kişi: masanın adı onun adı olsun
      return res;
    }
    seen(body.token);
    const seat = G.seatOf(state, body.token);
    if (seat < 0 && body.type !== 'kick' && body.type !== 'botSeat') {
      return { code: 200, body: JSON.stringify({ ok: false, error: 'Masada değilsin. Adını yazıp otur.', notSeated: true }) };
    }
    G.lobbyAction(state, seat, body, isOnline);
    save();
    // Hamle yapan telefon canlı bağlantısı kopuk olsa bile yeni durumu hemen görsün
    return { code: 200, body: JSON.stringify({ ok: true, view: viewFor(body.token) }), push: pushAll(), save: true };
  } catch (e) {
    if (e instanceof G.GameError) return { code: 200, body: JSON.stringify({ ok: false, error: e.message, view: viewFor(body.token) }) };
    console.error(e && e.stack || e);
    return { code: 500, body: JSON.stringify({ ok: false, error: 'Sunucu hatası: ' + (e && e.message) }) };
  }
}

function sseOpen(a) {
  const token = a.token || '';
  const wasOnline = isOnline(token);
  const who = nameOf(token);
  sse.set(a.id, { token, ip: a.ip || '', who });
  if (!wasOnline && who) log(`Bağlandı: ${who} (${a.ip || ''})`);
  if (!wasOnline) return { code: 200, push: pushAll() };
  return { code: 200, push: { [a.id]: JSON.stringify(viewFor(token)) } };
}

function sseClose(a) {
  const c = sse.get(a.id);
  if (!c) return { code: 200 };
  sse.delete(a.id);
  if (c.token) lastSeen.set(c.token, Date.now());
  if (!isOnline(c.token)) {
    if (c.who) log(`Bağlantısı koptu: ${c.who} (telefon kendiliğinden yeniden bağlanır)`);
    return { code: 200, push: pushAll() };
  }
  return { code: 200 };
}

function tick(a) {
  const now = a.now || Date.now();
  let changed = false;
  try {
    changed = G.tick(state, now);
    if (B.step(state, now)) changed = true;
    if (G.dropAway(state, isAway)) changed = true;
  } catch (e) {
    console.error('(süre hatası)', e && e.message);
  }
  if (!changed) return { code: 200 };
  save();
  return { code: 200, push: pushAll(), save: true };
}

function setLan(a) {
  const urls = Array.isArray(a.urls) ? a.urls.map(String) : [];
  const net = Object.assign({ sharing: false, ssid: '', wifi: '', public: '' }, a.net || {});
  if (JSON.stringify(urls) === JSON.stringify(lanUrls) && JSON.stringify(net) === JSON.stringify(netInfo)) return { code: 200 };
  lanUrls = urls;
  netInfo = net;
  return { code: 200, push: pushAll() };
}

function call(json) {
  let a;
  try {
    a = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (e) {
    return JSON.stringify({ code: 400, body: JSON.stringify({ ok: false, error: 'Geçersiz istek.' }) });
  }
  let res;
  try {
    if (a.op === 'init') res = init(a);
    else if (!state) res = { code: 503, body: JSON.stringify({ ok: false, error: 'Masa henüz kurulmadı.' }) };
    else if (a.op === 'state') res = doState(a);
    else if (a.op === 'api') res = doApi(a);
    else if (a.op === 'ping') res = { code: 200, body: JSON.stringify({ ok: true, app: '101-okey' }) };
    else if (a.op === 'sseOpen') res = sseOpen(a);
    else if (a.op === 'sseClose') res = sseClose(a);
    else if (a.op === 'tick') res = tick(a);
    else if (a.op === 'lan') res = setLan(a);
    else if (a.op === 'dump') { dirty = false; res = { code: 200, body: JSON.stringify(state) }; }
    else if (a.op === 'clients') res = { code: 200, body: JSON.stringify({ sse: sse.size, dirty }) };
    else res = { code: 404, body: JSON.stringify({ ok: false, error: 'Bilinmeyen işlem.' }) };
  } catch (e) {
    console.error('(çekirdek hatası)', e && e.stack || e);
    res = { code: 500, body: JSON.stringify({ ok: false, error: 'Sunucu hatası: ' + (e && e.message) }) };
  }
  return JSON.stringify(res);
}

module.exports = { call, isOnline, viewFor };
