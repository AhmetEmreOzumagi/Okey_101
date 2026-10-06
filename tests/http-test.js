'use strict';
/* Gerçek sunucuyu başlatır, 4 sanal telefonla HTTP + SSE üzerinden birkaç el oynar. */
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const E = require('../public/engine.js');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const STATE = path.join(os.tmpdir(), 'okey-test-' + PORT + '.json');
const ROUNDS = parseInt(process.argv[2] || '3', 10);

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.end(data);
  });
}

function sse(token, onView) {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/events?token=' + token }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line && !chunk.startsWith('event: ping')) onView(JSON.parse(line.slice(6)));
      }
    });
  });
  return req;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), OKEY_STATE: STATE, OKEY_AWAY_MS: '3000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  srv.stdout.on('data', (d) => (out += d));
  srv.stderr.on('data', (d) => (out += d));
  await sleep(600);

  // statik dosyalar
  for (const p of ['/', '/app.js', '/engine.js', '/style.css', '/qr.js']) {
    const code = await new Promise((r) => http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => { res.resume(); r(res.statusCode); }));
    if (code !== 200) throw new Error(p + ' -> ' + code);
  }
  const trav = await new Promise((r) => http.get({ host: '127.0.0.1', port: PORT, path: '/../server.js' }, (res) => { res.resume(); r(res.statusCode); }));
  if (trav === 200) throw new Error('Dizin dışına erişilebiliyor!');

  const names = ['Ali', 'Ayşe', 'Can', 'Deniz'];
  const players = [];
  for (const n of names) {
    const j = await post({ type: 'join', name: n });
    if (!j.ok) throw new Error('join: ' + j.error);
    players.push({ name: n, token: j.token, seat: j.seat, view: null });
  }
  const dup = await post({ type: 'join', name: 'Ekstra' });
  if (dup.ok) throw new Error('5. kişi oturabildi');

  let busy = false;
  let rounds = 0, lastRoundId = null, errors = 0, actions = 0;
  const conns = players.map((p) => sse(p.token, (v) => { p.view = v; }));
  await sleep(300);
  if (!players.every((p) => p.view && p.view.seats.every((s) => s && s.online))) throw new Error('Herkes bağlı görünmüyor');
  await post({ type: 'rounds', token: players[0].token, rounds: ROUNDS });
  const st = await post({ type: 'start', token: players[0].token });
  if (!st.ok) throw new Error('start: ' + st.error);

  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await sleep(15);
    const v = players[0].view;
    if (!v) continue;
    if (v.phase === 'gameEnd') break;
    if (v.phase === 'roundEnd') {
      if (v.round.id !== lastRoundId) { rounds++; lastRoundId = v.round.id; }
      await post({ type: 'next', token: players[1].token });
      await sleep(30);
      continue;
    }
    if (v.phase !== 'playing') continue;
    const cur = players.find((p) => p.seat === v.round.turn);
    const cv = cur.view;
    if (!cv || !cv.round || cv.round.turn !== cur.seat) continue;
    const r = cv.round;
    // gizlilik: herkes sadece kendi elini görür
    for (const p of players) {
      if (p.view && p.view.round && p.view.round.hand.length !== p.view.round.handCounts[p.seat]) throw new Error('El sayısı tutarsız');
    }
    if (r.tphase === 'draw') {
      const j = r.stockCount ? await post({ type: 'draw', token: cur.token }) : await post({ type: 'endStock', token: cur.token });
      if (!j.ok) errors++;
      actions++;
      await sleep(25);
      continue;
    }
    if (!r.opened[cur.seat]) {
      const sug = E.suggestMelds(r.hand, r.okey);
      if (sug.value >= 101) {
        const j = await post({ type: 'open', token: cur.token, mode: 'runs', melds: sug.melds });
        if (!j.ok) throw new Error('open reddedildi: ' + j.error);
        await sleep(25);
        continue;
      }
    }
    const pick = r.hand.find((id) => !E.isWild(id, r.okey) && !E.isLayable(id, r.melds, r.okey)) ?? r.hand[0];
    const j = await post({ type: 'discard', token: cur.token, tile: pick });
    if (!j.ok) { errors++; console.log('discard reddi', j.error); }
    actions++;
    await sleep(25);
  }

  if (players[0].view.phase !== 'gameEnd') throw new Error('Okey oyunu bitmedi');
  const okeyRounds = rounds;

  // Pişti ve Renk: aynı masada yeni oyun, 2 insan + 2 bot, birer el HTTP üzerinden
  const cardResults = [];
  for (const game of ['pisti', 'uno']) {
    let j = await post({ type: 'reset', token: players[0].token });
    if (!j.ok) throw new Error('reset: ' + j.error);
    j = await post({ type: 'settings', token: players[0].token, game, turnSecs: 0 });
    if (!j.ok) throw new Error('settings: ' + j.error);
    if (game === 'pisti') {
      // Can ve Deniz kalkar, yerlerine bot oturur (bir sonraki oyunda da kalırlar)
      for (const p of players.slice(2)) {
        j = await post({ type: 'leave', token: p.token });
        if (!j.ok) throw new Error('leave: ' + j.error);
        j = await post({ type: 'addBot', token: players[0].token, seat: p.seat });
        if (!j.ok) throw new Error('addBot: ' + j.error);
      }
    }
    j = await post({ type: 'start', token: players[0].token });
    if (!j.ok) throw new Error(game + ' start: ' + j.error);
    const humans = players.slice(0, 2);
    let moves = 0, done = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 90000) {
      await sleep(20);
      const v = humans[0].view;
      if (!v || !v.round || v.round.game !== game) continue;
      if (v.phase === 'roundEnd') { done = true; break; }
      if (v.phase !== 'playing') continue;
      for (const p of humans) {
        const r = p.view.round;
        if (r.hand.length !== r.handCounts[p.seat]) throw new Error('El sayısı tutarsız (' + game + ')');
        if ('hands' in r || 'deck' in r) throw new Error('Gizli bilgi sızıyor (' + game + ')');
      }
      const cur = humans.find((p) => p.seat === v.round.turn);
      if (!cur || !cur.view.round || cur.view.round.turn !== cur.seat) continue;
      const r = cur.view.round;
      const id = r.playable[0];
      if (game === 'uno' && r.hand.length === 2 && !r.uno[cur.seat]) await post({ type: 'uno', token: cur.token });
      if (id !== undefined) j = await post({ type: 'play', token: cur.token, card: id, color: 2 });
      else if (r.drew) j = await post({ type: 'pass', token: cur.token });
      else j = await post({ type: 'draw', token: cur.token });
      if (!j.ok) { errors++; console.log(game, 'reddedildi', j.error); }
      moves++;
      await sleep(30);
    }
    if (!done) throw new Error(game + ' eli bitmedi');
    cardResults.push(`${game} ${moves} hamle`);
  }

  // Yeniden bağlanma: Ayşe'nin bağlantısını kopar, aynı isimle dön
  conns[1].destroy();
  await sleep(200);
  const back = await post({ type: 'join', name: 'ayşe' });
  if (!back.ok || back.seat !== players[1].seat) throw new Error('Yeniden bağlanma olmadı: ' + JSON.stringify(back));

  // Masa yönetimi: masaya oturmamış biri (Can) botu çıkarabilir, bağlı olanı çıkaramaz;
  // lobide bağlantısı kopan (Ayşe'nin canlı bağlantısı yok) bir süre sonra kendiliğinden kalkar
  let j2 = await post({ type: 'reset', token: players[0].token });
  if (!j2.ok) throw new Error('reset: ' + j2.error);
  const can = players[2];
  j2 = await post({ type: 'kick', token: can.token, seat: 3 });
  if (!j2.ok) throw new Error('Oturmamış biri botu çıkaramadı: ' + j2.error);
  j2 = await post({ type: 'kick', token: can.token, seat: players[0].seat });
  if (j2.ok || !/Bağlı/.test(j2.error)) throw new Error('Bağlı oyuncu çıkarılabildi');
  j2 = await post({ type: 'start', token: can.token });
  if (j2.ok || !j2.notSeated) throw new Error('Oturmamış biri oyunu başlatabildi');
  const tAway = Date.now();
  let dropped = false;
  while (Date.now() - tAway < 15000) {
    await sleep(250);
    const v = players[0].view;
    if (v && v.phase === 'lobby' && !v.seats[back.seat]) { dropped = true; break; }
  }
  if (!dropped) throw new Error('Bağlantısı kopan lobide kendiliğinden kalkmadı');
  if (!players[0].view.log.some((l) => /uzun süredir bağlı değil/.test(l.text))) throw new Error('Kalkma kayda yazılmadı');
  const awaySecs = ((Date.now() - tAway) / 1000).toFixed(1);

  // Sunucu yeniden başlarsa kayıt
  const saved = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  conns.forEach((c) => c.destroy());
  srv.kill();
  fs.unlinkSync(STATE);

  console.log(`HTTP testi tamam: okey ${okeyRounds} el, ${actions} hamle, ${errors} reddedilen; ${cardResults.join(', ')}; bağlantısı kopan ${awaySecs} sn'de kalktı; kayıt: ${saved.phase}`);
  console.log(out.split('\n').filter((l) => l.includes('http://')).slice(0, 2).join('\n'));
}

main().catch((e) => { console.error('HATA:', e); process.exit(1); });
