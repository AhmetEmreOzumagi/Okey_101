'use strict';
/* Android çekirdeği (android/host/host-core.js) ve paketleyici (android/paketle.js).
   Paket, Node'da sanal bir pencerede çalıştırılır; Kotlin tarafının yaptığı çağrılar
   (init, api, state, sseOpen, sseClose, tick, lan, dump) taklit edilir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { paketMetni, MODULLER } = require('../android/paketle.js');

const PAKET = paketMetni();

// Gizli WebView gibi bir ortam: window, crypto.getRandomValues, console
function kur() {
  const sandbox = { console, crypto: globalThis.crypto };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PAKET, sandbox, { filename: 'host.js' });
  const call = (o) => JSON.parse(sandbox.Host.call(typeof o === 'string' ? o : JSON.stringify(o)));
  const body = (r) => JSON.parse(r.body);
  const api = (b, ip) => call({ op: 'api', body: b, ip: ip || '192.168.1.9' });
  return { sandbox, call, body, api };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('paket: bütün oyun dosyaları tek dosyada, Node modülü gerekmiyor', () => {
  for (const m of MODULLER) assert.ok(PAKET.includes(`__modul('${m.split('/').pop()}'`), m);
  assert.ok(PAKET.includes("__modul('crypto'"), 'crypto yedeği');
  assert.ok(!/require\('(fs|http|os|path|zlib|child_process)'\)/.test(PAKET), 'Node modülü çağrılmamalı');
  const { sandbox } = kur();
  assert.equal(typeof sandbox.Host.call, 'function');
});

test('init, ping, join: masayı kuran telefon (127.0.0.1) masanın adını belirler', () => {
  const { call, body, api } = kur();
  let r = call({ op: 'ping' });
  assert.equal(r.code, 503, 'masa kurulmadan istek kabul edilmez');
  r = call({ op: 'init', boot: 'abcd1234' });
  assert.equal(r.code, 200);
  assert.equal(body(r).loaded, false);
  r = call({ op: 'ping' });
  assert.deepEqual(body(r), { ok: true, app: '101-okey' });

  r = api({ type: 'join', name: 'Ali' }, '127.0.0.1');
  const j = body(r);
  assert.equal(j.ok, true);
  assert.equal(j.seat, 0);
  assert.match(j.token, /^[0-9a-f]{24}$/, 'crypto yedeği 12 baytlık hex anahtar üretir');
  assert.equal(j.view.me, 0);
  assert.equal(j.view.boot, 'abcd1234');
  assert.equal(r.hostName, 'Ali');
  assert.equal(r.save, true);
  assert.deepEqual(r.push, {}, 'canlı bağlantı yokken yayın boş');

  r = api({ type: 'join', name: 'Ayşe', seat: 2 }, '192.168.1.7');
  assert.equal(body(r).seat, 2);
  assert.equal(r.hostName, undefined, 'misafirin adı masanın adı olmaz');
  // Ali bağlı değilken aynı adla gelen onun yerine döner (telefon değişmiş olabilir); bağlıyken ad çakışır
  const geri = body(api({ type: 'join', name: 'ali' }, '192.168.1.8'));
  assert.equal(geri.ok, true);
  assert.equal(geri.seat, 0);
  call({ op: 'state', token: geri.token, ip: '192.168.1.8' });
  assert.match(body(api({ type: 'join', name: 'ALİ' }, '192.168.1.9')).error, /zaten var/, 'bağlı olanın adı alınamaz');
});

test('sseOpen / sseClose / state: bağlı sayılma ve yayın', () => {
  const { call, body, api } = kur();
  call({ op: 'init' });
  const ali = body(api({ type: 'join', name: 'Ali' }, '127.0.0.1')).token;
  const ayse = body(api({ type: 'join', name: 'Ayşe' }, '192.168.1.7')).token;

  let r = call({ op: 'sseOpen', id: 1, token: ali, ip: '127.0.0.1' });
  assert.deepEqual(Object.keys(r.push), ['1']);
  let v = JSON.parse(r.push['1']);
  assert.equal(v.me, 0);
  assert.equal(v.seats[0].online, true);
  assert.equal(v.seats[1].online, false, 'Ayşe henüz bağlı değil');

  r = call({ op: 'sseOpen', id: 2, token: ayse, ip: '192.168.1.7' });
  assert.deepEqual(Object.keys(r.push).sort(), ['1', '2'], 'yeni biri bağlanınca herkese yayın');
  assert.equal(JSON.parse(r.push['1']).seats[1].online, true);
  assert.equal(JSON.parse(r.push['2']).me, 1, 'herkes kendi görünümünü alır');

  r = call({ op: 'sseOpen', id: 3, token: ayse, ip: '192.168.1.7' });
  assert.deepEqual(Object.keys(r.push), ['3'], 'zaten bağlı olanın ikinci sekmesi sadece kendine görünüm alır');

  r = call({ op: 'sseClose', id: 3 });
  assert.equal(r.push, undefined, 'bir bağlantısı daha varken kopmuş sayılmaz');
  r = call({ op: 'sseClose', id: 2 });
  assert.deepEqual(Object.keys(r.push), ['1'], 'kopunca kalanlara yayın');
  assert.equal(JSON.parse(r.push['1']).seats[1].online, false);

  // Yoklama ile de bağlı sayılır
  r = call({ op: 'state', token: ayse, ip: '192.168.1.7' });
  assert.equal(body(r).me, 1);
  assert.deepEqual(Object.keys(r.push), ['1'], 'yoklamayla geri gelince masadakilere yayın');
  r = call({ op: 'state', token: ayse, ip: '192.168.1.7' });
  assert.equal(r.push, undefined, 'zaten bağlıysa yayın yok');
  r = call({ op: 'state', token: '', ip: '192.168.1.8' });
  assert.equal(body(r).me, -1, 'masada olmayan da görünüm alır');
});

test('tick: botlar ve süre; eller gizli; kayıt alınıp geri yüklenir', () => {
  const { call, body, api } = kur();
  call({ op: 'init', boot: 'b1' });
  const ali = body(api({ type: 'join', name: 'Ali' }, '127.0.0.1')).token;
  const ayse = body(api({ type: 'join', name: 'Ayşe' }, '192.168.1.7')).token;
  call({ op: 'sseOpen', id: 1, token: ali, ip: '127.0.0.1' });
  call({ op: 'sseOpen', id: 2, token: ayse, ip: '192.168.1.7' });
  let r = api({ type: 'settings', token: ali, game: 'pisti', turnSecs: 0 });
  assert.equal(body(r).ok, true, body(r).error);
  assert.deepEqual(Object.keys(r.push).sort(), ['1', '2']);
  api({ type: 'addBot', token: ali, seat: 2 });
  api({ type: 'addBot', token: ali, seat: 3 });
  r = api({ type: 'start', token: ali });
  assert.equal(body(r).ok, true, body(r).error);
  assert.equal(body(r).view.phase, 'playing');

  let now = Date.now(), pushes = 0, moves = 0, phase = 'playing';
  const tokens = [ali, ayse];
  for (let k = 0; k < 600 && phase === 'playing'; k++) {
    now += 500;
    r = call({ op: 'tick', now });
    if (r.push) {
      pushes++;
      assert.equal(r.save, true);
      const v1 = JSON.parse(r.push['1']), v2 = JSON.parse(r.push['2']);
      assert.equal(v1.round.hand.length, v1.round.handCounts[0], 'Ali sadece kendi elini görür');
      assert.equal(v2.round.hand.length, v2.round.handCounts[1]);
      assert.ok(!('hands' in v1.round) && !('deck' in v1.round), 'gizli bilgi sızmaz');
    }
    const v = body(call({ op: 'state', token: ali, ip: '127.0.0.1' }));
    phase = v.phase;
    if (phase !== 'playing') break;
    const turn = v.round.turn;
    if (turn < 2) {
      const me = body(call({ op: 'state', token: tokens[turn], ip: 'x' }));
      const id = me.round.playable[0];
      if (id !== undefined) {
        const j = body(api({ type: 'play', token: tokens[turn], card: id }));
        assert.equal(j.ok, true, j.error);
        moves++;
      }
    }
  }
  assert.equal(phase, 'roundEnd', 'pişti eli bitti');
  assert.ok(pushes >= 5, 'botlar oynadıkça yayın yapıldı: ' + pushes);
  assert.ok(moves >= 20, 'insanlar da oynadı: ' + moves);

  // Kayıt: dump → yeni çekirdek aynı durumla açılır
  const saved = call({ op: 'dump' }).body;
  const s = JSON.parse(saved);
  assert.equal(s.v, 1);
  assert.equal(s.phase, 'roundEnd');
  const ikinci = kur();
  r = ikinci.call({ op: 'init', saved, boot: 'b2' });
  assert.equal(ikinci.body(r).loaded, true);
  const v = ikinci.body(ikinci.call({ op: 'state', token: ali, ip: '127.0.0.1' }));
  assert.equal(v.phase, 'roundEnd');
  assert.equal(v.me, 0, 'eski oturum anahtarı yeni çekirdekte de geçerli');
  assert.equal(v.boot, 'b2');
  assert.equal(v.round.game, 'pisti');
  // Bozuk kayıt: yeni masa kurulur
  const ucuncu = kur();
  assert.equal(ucuncu.body(ucuncu.call({ op: 'init', saved: '{"v":0}' })).loaded, false);
  assert.equal(ucuncu.body(ucuncu.call({ op: 'init', saved: 'bozuk' })).loaded, false);
});

test('lan: telefonun adresleri ve ağ bilgisi görünüme girer, değişmezse yayın yok', () => {
  const { call, body, api } = kur();
  call({ op: 'init' });
  const ali = body(api({ type: 'join', name: 'Ali' }, '127.0.0.1')).token;
  call({ op: 'sseOpen', id: 1, token: ali, ip: '127.0.0.1' });
  let r = call({ op: 'lan', urls: ['http://192.168.1.5:8101'], net: { sharing: false } });
  assert.deepEqual(Object.keys(r.push), ['1']);
  const v = JSON.parse(r.push['1']);
  assert.deepEqual(v.lan, ['http://192.168.1.5:8101']);
  assert.deepEqual(v.net, { sharing: false, ssid: '', wifi: '', public: '' });
  r = call({ op: 'lan', urls: ['http://192.168.1.5:8101'], net: { sharing: false } });
  assert.equal(r.push, undefined);
  r = call({ op: 'lan', urls: ['http://192.168.43.1:8101'], net: { sharing: true } });
  assert.equal(JSON.parse(r.push['1']).net.sharing, true);
});

test('lobide uzun süre bağlı olmayan kendiliğinden kalkar', async () => {
  const { call, body, api } = kur();
  call({ op: 'init', awayMs: 250 });
  const ali = body(api({ type: 'join', name: 'Ali' }, '127.0.0.1')).token;
  body(api({ type: 'join', name: 'Ayşe' }, '192.168.1.7'));
  call({ op: 'sseOpen', id: 1, token: ali, ip: '127.0.0.1' });
  let r = call({ op: 'tick', now: Date.now() });
  assert.equal(r.push, undefined, 'henüz kimse kalkmadı');
  await sleep(400);
  r = call({ op: 'tick', now: Date.now() });
  assert.ok(r.push && r.push['1'], 'kalkınca yayın');
  const v = JSON.parse(r.push['1']);
  assert.equal(v.seats[1], null, 'Ayşe kalktı');
  assert.ok(v.seats[0], 'bağlı olan Ali yerinde');
  assert.ok(v.log.some((l) => /uzun süredir bağlı değil/.test(l.text)));
});

test('bozuk istekler çekirdeği düşürmez', () => {
  const { call, body, api } = kur();
  assert.equal(call('{bozuk').code, 400);
  call({ op: 'init' });
  assert.equal(call({ op: 'api', body: null }).code, 400);
  assert.equal(call({ op: 'yok' }).code, 404);
  let r = api({ type: 'start', token: 'yok' });
  assert.equal(body(r).notSeated, true);
  const ali = body(api({ type: 'join', name: 'Ali' }, '127.0.0.1')).token;
  r = api({ type: 'xyz', token: ali });
  assert.equal(body(r).ok, false);
  assert.match(body(r).error, /Bilinmeyen hamle/);
  assert.equal(r.code, 200, 'kural hatası 200 ile döner (sayfa mesajı gösterir)');
  r = api({ type: 'start', token: ali });
  assert.match(body(r).error, /4 kişi/);
  assert.equal(call({ op: 'sseClose', id: 99 }).code, 200, 'bilinmeyen bağlantı sorun değil');
  assert.equal(call({ op: 'tick' }).code, 200);
});
