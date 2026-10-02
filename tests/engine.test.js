'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');
const G = require('../game.js');

// renk: 0 kırmızı, 1 sarı, 2 mavi, 3 siyah
const T = (c, n, copy = 0) => c * 26 + (n - 1) * 2 + copy;
const FAKE = 104;
const okey = { c: 2, n: 7 }; // mavi 7 okey
const WILD = T(2, 7);

test('taş bilgisi ve gösterge', () => {
  assert.deepEqual(E.tileInfo(T(3, 13, 1)), { id: T(3, 13, 1), fake: false, c: 3, n: 13 });
  assert.equal(E.tileInfo(105).fake, true);
  assert.deepEqual(E.okeyFromIndicator(T(1, 5)), { c: 1, n: 6 });
  assert.deepEqual(E.okeyFromIndicator(T(0, 13)), { c: 0, n: 1 });
});

test('seri: düz, okeyli, 1 sadece altta', () => {
  assert.equal(E.interpret([T(0, 4), T(0, 5), T(0, 6)], okey, 'runs').value, 15);
  const r = E.interpret([T(0, 4), WILD, T(0, 6)], okey, 'runs');
  assert.equal(r.type, 'run');
  assert.equal(r.value, 15);
  assert.equal(E.interpret([T(0, 1), T(0, 2), T(0, 3)], okey, 'runs').value, 6);
  assert.equal(E.interpret([T(0, 12), T(0, 13), T(0, 1)], okey, 'runs'), null);
  assert.equal(E.interpret([T(0, 4), T(1, 5), T(0, 6)], okey, 'runs'), null);
  // okey uçta: verilen sıraya göre
  assert.equal(E.interpret([T(0, 5), T(0, 6), WILD], okey, 'runs').end, 7);
  assert.equal(E.interpret([WILD, T(0, 5), T(0, 6)], okey, 'runs').start, 4);
  // ters sıra da kabul
  assert.equal(E.interpret([T(0, 9), T(0, 8), T(0, 7)], okey, 'runs').value, 24);
  // karışık sıra (esnek)
  assert.equal(E.interpret([T(0, 9), T(0, 7), T(0, 8)], okey, 'runs').value, 24);
  // 12-13 + okey -> 11-12-13 (14 yok)
  const hi = E.interpret([T(0, 12), T(0, 13), WILD], okey, 'runs');
  assert.ok(hi);
  assert.equal(hi.start, 11);
});

test('sahte okey okeyin yerine geçer, joker değildir', () => {
  // sahte okey = mavi 7
  assert.ok(E.interpret([T(2, 6), FAKE, T(2, 8)], okey, 'runs'));
  assert.equal(E.interpret([T(0, 6), FAKE, T(0, 8)], okey, 'runs'), null);
  assert.ok(E.interpret([T(0, 7), FAKE, T(3, 7)], okey, 'runs'));
  assert.equal(E.isWild(FAKE, okey), false);
  assert.equal(E.isWild(WILD, okey), true);
});

test('grup: farklı renk şart', () => {
  assert.equal(E.interpret([T(0, 11), T(1, 11), T(3, 11)], okey, 'runs').value, 33);
  assert.equal(E.interpret([T(0, 11), T(0, 11, 1), T(3, 11)], okey, 'runs'), null);
  assert.equal(E.interpret([T(0, 11), T(1, 11), T(2, 11), T(3, 11)], okey, 'runs').value, 44);
  assert.equal(E.interpret([T(0, 11), T(1, 11), WILD], okey, 'runs').value, 33);
  assert.equal(E.interpret([T(0, 11), T(1, 11), T(2, 11), T(3, 11), WILD], okey, 'runs'), null);
});

test('çift', () => {
  assert.ok(E.tryPair([T(0, 5), T(0, 5, 1)], okey));
  assert.equal(E.tryPair([T(0, 5), T(1, 5)], okey), null);
  assert.ok(E.tryPair([T(0, 5), WILD], okey));
  assert.ok(E.tryPair([FAKE, 105], okey));
});

test('işleme', () => {
  const run = E.interpret([T(0, 4), T(0, 5), T(0, 6)], okey, 'runs');
  assert.equal(E.addToMeld(run, T(0, 7), okey).end, 7);
  assert.equal(E.addToMeld(run, T(0, 3), okey).start, 3);
  assert.equal(E.addToMeld(run, T(0, 8), okey), null);
  assert.equal(E.addToMeld(run, T(1, 7), okey), null);
  assert.equal(E.addToMeld(run, WILD, okey, 'start').start, 3);
  assert.equal(E.addToMeld(run, WILD, okey).end, 7);
  const top = E.interpret([T(0, 11), T(0, 12), T(0, 13)], okey, 'runs');
  assert.equal(E.addToMeld(top, T(0, 1), okey), null); // 13'ten sonra 1 olmaz
  assert.equal(E.addToMeld(top, WILD, okey).start, 10);
  const set = E.interpret([T(0, 9), T(1, 9), WILD], okey, 'runs');
  assert.ok(E.addToMeld(set, T(3, 9), okey));
  assert.equal(E.addToMeld(set, T(0, 9, 1), okey), null);
  const full = E.interpret([T(0, 9), T(1, 9), T(2, 9), T(3, 9)], okey, 'runs');
  assert.equal(E.addToMeld(full, WILD, okey), null);
  const pair = E.tryPair([T(0, 5), T(0, 5, 1)], okey);
  assert.equal(E.addToMeld(pair, WILD, okey), null);
  assert.equal(E.isLayable(T(0, 7), [run], okey), true);
  assert.equal(E.isLayable(T(0, 9), [run], okey), false);
});

test('elde kalan değer', () => {
  assert.equal(E.handValue([T(0, 5), T(3, 13), WILD, FAKE], okey), 5 + 13 + 101 + 7);
});

test('puanlama tablosu', () => {
  const hands = [[], [T(0, 5), T(0, 6)], [T(0, 3)], new Array(21).fill(T(0, 1))];
  const opened = ['runs', 'runs', 'pairs', null];
  const base = (o) => E.scoreWin(Object.assign({ winner: 0, opened, hands, okey, lastOkey: false, elden: false }, o));
  assert.deepEqual(base({}), [-101, 11, 6, 202]);
  assert.deepEqual(base({ lastOkey: true }), [-202, 22, 12, 404]);
  const op2 = ['pairs', 'runs', 'pairs', null];
  assert.deepEqual(base({ opened: op2 }), [-202, 22, 12, 404]);
  assert.deepEqual(base({ opened: op2, lastOkey: true }), [-404, 44, 24, 404]);
  assert.deepEqual(base({ elden: true }), [-202, 404, 404, 404]);
  assert.deepEqual(base({ elden: true, lastOkey: true }), [-404, 808, 808, 808]);
});

// ---------- Oyun akışı ----------
function setupGame() {
  const s = G.create();
  const off = () => false;
  const toks = ['Ali', 'Ayşe', 'Can', 'Deniz'].map((n) => G.join(s, n, null, off).token);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  return { s, toks, off };
}

// Durumu kontrollü bir ele çevirir.
function rig(s, hands, opts = {}) {
  const r = s.round;
  r.okey = okey;
  r.indicator = T(2, 6);
  const used = new Set([r.indicator]);
  hands.forEach((h) => h.forEach((id) => used.add(id)));
  const rest = [...Array(106).keys()].filter((id) => !used.has(id));
  r.hands = hands.map((h) => h.slice());
  r.stock = rest.slice(0, opts.stock === undefined ? 20 : opts.stock);
  r.turn = 0;
  r.tphase = opts.tphase || 'play';
  s.startSeat = 0;
  return rest.slice(r.stock.length);
}

function countTiles(s) {
  const r = s.round;
  let n = 1 + r.stock.length;
  r.hands.forEach((h) => (n += h.length));
  r.discards.forEach((d) => (n += d.length));
  r.melds.forEach((m) => (n += m.tiles.length));
  return n;
}

test('açılış 101 kontrolü ve yandan alma kuralı', () => {
  const { s } = setupGame();
  // 0: 11-12-13 kırmızı (36) + 11-12-13 sarı (36) + 9-10-11 siyah (30) = 102
  const opener = [T(0, 11), T(0, 12), T(0, 13), T(1, 11), T(1, 12), T(1, 13), T(3, 9), T(3, 10), T(3, 11), T(0, 2), T(1, 3)];
  const low = [T(0, 11), T(0, 12), T(0, 13), T(1, 1), T(1, 2), T(1, 3)];
  rig(s, [opener, [T(2, 1), T(2, 2)], [T(2, 3)], [T(2, 4)]]);
  assert.throws(() => G.act(s, 0, { type: 'open', mode: 'runs', melds: [low.slice(0, 3), low.slice(3)] }), /Bu taş elinde yok|101/);
  G.act(s, 0, { type: 'open', mode: 'runs', melds: [opener.slice(0, 3), opener.slice(3, 6), opener.slice(6, 9)] });
  assert.equal(s.round.opened[0], 'runs');
  assert.equal(s.round.openValue[0], 102);
  // işlek taş atma cezası: kırmızı 2 işlenemez ama ... siyah 8 olsaydı işlenirdi
  G.act(s, 0, { type: 'discard', tile: T(0, 2) });
  assert.equal(s.round.penalties[0], 0);
  assert.equal(s.round.turn, 1);
  // 1 numara: yandan aldığı taşla açamazsa hiçbir şey değişmez, taş yerde kalır
  const before = countTiles(s);
  const handBefore = s.round.hands[1].slice();
  assert.throws(() => G.act(s, 1, { type: 'open', side: true, mode: 'runs', melds: [[T(2, 1), T(2, 2), T(0, 2)]] }), /per|101/);
  assert.deepEqual(s.round.hands[1], handBefore);
  assert.equal(s.round.discards[0].length, 1);
  assert.equal(s.round.tphase, 'draw');
  assert.equal(countTiles(s), before);
  G.act(s, 1, { type: 'draw' });
  assert.equal(countTiles(s), before);
  assert.equal(s.round.hands[1].length, 3);
});

test('yandan alınan taşla açma (atomik)', () => {
  const { s } = setupGame();
  // 0 numara mavi 13 atar; 1 numara mavi 11-12 + yandan 13 ile açar
  const h1 = [T(2, 11), T(2, 12), T(1, 11), T(1, 12), T(1, 13), T(3, 9), T(3, 10), T(3, 11), T(0, 1)];
  rig(s, [[T(2, 13), T(0, 5)], h1, [T(3, 1)], [T(3, 2)]]);
  G.act(s, 0, { type: 'discard', tile: T(2, 13) });
  const v = G.view(s, s.seats[1].token, () => true);
  assert.equal(v.round.sideTile, T(2, 13));
  // yandan taş açışta kullanılmazsa reddedilir ve hiçbir şey değişmez
  assert.throws(() => G.act(s, 1, { type: 'open', side: true, mode: 'runs', melds: [[T(1, 11), T(1, 12), T(1, 13)]] }), /Yandan|elinde yok/);
  assert.equal(s.round.discards[0].length, 1);
  G.act(s, 1, { type: 'open', side: true, mode: 'runs', melds: [[T(2, 11), T(2, 12), T(2, 13)], [T(1, 11), T(1, 12), T(1, 13)], [T(3, 9), T(3, 10), T(3, 11)]] });
  assert.equal(s.round.opened[1], 'runs');
  assert.equal(s.round.openValue[1], 102);
  assert.equal(s.round.discards[0].length, 0);
  assert.equal(s.round.tphase, 'play');
  assert.deepEqual(s.round.hands[1], [T(0, 1)]);
});

test('açmış oyuncu yandan aldığı taşı işler', () => {
  const { s } = setupGame();
  rig(s, [[T(2, 5), T(0, 9), T(0, 10)], [T(1, 1), T(1, 2)], [T(3, 1)], [T(3, 2)]]);
  s.round.opened[1] = 'runs';
  s.round.melds = [Object.assign(E.interpret([T(2, 2), T(2, 3), T(2, 4)], okey, 'runs'), { id: 1, owner: 2 })];
  s.round.meldSeq = 2;
  G.act(s, 0, { type: 'discard', tile: T(0, 9) }); // işlenemez taş, ceza yok
  assert.equal(s.round.penalties[0], 0);
  s.round.turn = 0; s.round.tphase = 'play';
  G.act(s, 0, { type: 'discard', tile: T(2, 5) }); // işlek taş: ceza
  assert.equal(s.round.penalties[0], 101);
  assert.throws(() => G.act(s, 1, { type: 'add', side: true, tile: T(0, 9), meld: 1 }), /işle/);
  G.act(s, 1, { type: 'add', side: true, tile: T(2, 5), meld: 1 });
  assert.equal(s.round.melds[0].end, 5);
  assert.equal(s.round.tphase, 'play');
});

test('katlamalı: rakibin bir fazlası, eşe katlama yok', () => {
  const { s, off } = setupGame();
  s.phase = 'lobby';
  G.lobbyAction(s, 0, { type: 'settings', mode: 'team', katlamali: true }, off);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  const r = s.round;
  r.opened = ['runs', null, null, null];
  r.openValue = [130, 0, 0, 0];
  assert.equal(G.openReq(s, 2, 'runs'), 101); // eşi
  assert.equal(G.openReq(s, 1, 'runs'), 131); // rakip
  assert.equal(G.openReq(s, 3, 'runs'), 131);
  assert.equal(G.openReq(s, 1, 'pairs'), 5);
  r.opened[1] = 'pairs'; r.openValue[1] = 5;
  assert.equal(G.openReq(s, 0, 'pairs'), 6);
  assert.equal(G.openReq(s, 3, 'pairs'), 5); // 1'in eşi
  s.settings.mode = 'solo';
  assert.equal(G.openReq(s, 2, 'runs'), 131);
  s.settings.katlamali = false;
  assert.equal(G.openReq(s, 2, 'runs'), 101);
});

test('katlamalı açış sunucuda da uygulanır', () => {
  const { s } = setupGame();
  s.settings.katlamali = true;
  const h = [T(0, 11), T(0, 12), T(0, 13), T(1, 11), T(1, 12), T(1, 13), T(3, 9), T(3, 10), T(3, 11), T(0, 2)];
  rig(s, [h, [T(2, 1)], [T(2, 3)], [T(2, 4)]]);
  s.round.opened[1] = 'runs'; s.round.openValue[1] = 110;
  assert.throws(() => G.act(s, 0, { type: 'open', mode: 'runs', melds: [h.slice(0, 3), h.slice(3, 6), h.slice(6, 9)] }), /111/);
});

test('eşli: bitenin eşinin el cezası silinir, takım toplamı', () => {
  const { s } = setupGame();
  s.settings.mode = 'team';
  const h0 = [T(0, 11), T(0, 12), T(0, 13), T(1, 11), T(1, 12), T(1, 13), T(3, 9), T(3, 10), T(3, 11), T(1, 1)];
  rig(s, [h0, [T(2, 1), T(2, 2), T(3, 5)], [T(2, 9), T(2, 10)], [T(2, 4)]]);
  s.round.opened[1] = 'runs';
  G.act(s, 0, { type: 'open', mode: 'runs', melds: [h0.slice(0, 3), h0.slice(3, 6), h0.slice(6, 9)] });
  G.act(s, 0, { type: 'discard', tile: T(1, 1) });
  const res = s.round.result;
  assert.deepEqual(res.total, [-101, 8, 0, 202]);
  const v = G.view(s, s.seats[0].token, () => true);
  assert.deepEqual(v.teamTotals, [-101, 210]);
});

test('süre dolunca otomatik oynanır', () => {
  const { s } = setupGame();
  s.settings.turnSecs = 30;
  rig(s, [[T(1, 1), T(1, 5)], [T(2, 1)], [T(2, 3)], [T(2, 4)]], { tphase: 'draw' });
  s.round.lastDiscardSeat = 3;
  s.round.deadline = Date.now() - 5000;
  const before = s.round.stock.length;
  assert.equal(G.tick(s, Date.now()), true);
  assert.equal(s.round.turn, 1);
  assert.equal(s.round.stock.length, before - 1);
  assert.equal(s.round.hands[0].length, 2);
  assert.equal(s.round.discards[0].length, 1);
  assert.ok(s.round.deadline > Date.now());
  assert.equal(G.tick(s, Date.now()), false);
  s.settings.turnSecs = 0;
  s.round.deadline = 0;
  assert.equal(G.tick(s, Date.now() + 999999), false);
});

test('ıstakadaki perlerin değeri', () => {
  const slots = new Array(30).fill(null);
  // 1. sıra: [K11 K12 K13] _ [S7 M7 Si7] _ [M4 OKEY M6] 9
  [T(0, 11), T(0, 12), T(0, 13), null, T(1, 7), T(2, 7, 1), T(3, 7), null, T(2, 4), WILD, T(2, 6), T(0, 9)].forEach((id, i) => (slots[i] = id));
  // 2. sıra: boşluksuz iki per [S1 S2 S3 Si8 Si9 Si10]
  [T(1, 1), T(1, 2), T(1, 3), T(3, 8), T(3, 9), T(3, 10)].forEach((id, i) => (slots[15 + i] = id));
  const ch = E.rackChunks(slots, 15, okey, 'runs');
  const total = ch.reduce((a, c) => a + c.value, 0);
  assert.equal(total, 36 + 21 + 15 + 6 + 27);
  assert.equal(ch.length, 5);
  const pairs = E.rackChunks([T(0, 5), T(0, 5, 1), T(1, 9), T(1, 9, 1), null, T(2, 2), WILD].concat(new Array(23).fill(null)), 15, okey, 'pairs');
  assert.equal(pairs.length, 3);
});

test('seri diz perlerin arasında boşluk bırakır', () => {
  for (let k = 0; k < 300; k++) {
    const s = G.create();
    const off = () => false;
    ['A', 'B', 'C', 'D'].forEach((n) => G.join(s, n, null, off));
    G.lobbyAction(s, 0, { type: 'start' }, off);
    const r = s.round;
    const hand = r.hands[r.turn];
    const slots = E.arrangeRack(hand, r.okey, 'runs', 15, 2);
    assert.equal(slots.length, 30);
    assert.deepEqual(slots.filter((x) => x !== null).sort((a, b) => a - b), hand.slice().sort((a, b) => a - b));
    // önerilen her per ıstakada tanınmalı ve değerleri tutmalı
    const sug = E.suggestMelds(hand, r.okey);
    const ch = E.rackChunks(slots, 15, r.okey, 'runs');
    const sum = ch.reduce((a, c) => a + c.value, 0);
    assert.ok(sum >= sug.value, `ıstakadaki değer ${sum} < önerilen ${sug.value}`);
    // perler birbirine yapışık olmamalı (iki per arasında en az bir boşluk)
    for (let i = 0; i < ch.length - 1; i++) {
      const a = ch[i], b = ch[i + 1];
      if (a.row === b.row) assert.ok(b.col > a.col + a.len, 'perler arasında boşluk yok');
    }
    const pslots = E.arrangeRack(hand, r.okey, 'pairs', 15, 2);
    assert.deepEqual(pslots.filter((x) => x !== null).sort((a, b) => a - b), hand.slice().sort((a, b) => a - b));
  }
});

test('okeyler akıllıca kullanılır', () => {
  // M4 M6 + okey -> 4-5-6 ; K13 + iki okey yok, tek okey
  const sug = E.suggestMelds([T(2, 4), T(2, 6), WILD, T(0, 1), T(3, 13)], okey);
  assert.equal(sug.melds.length, 1);
  assert.equal(sug.value, 15);
  const two = E.suggestMelds([T(3, 13), WILD, T(2, 7, 1), T(0, 2)], okey);
  assert.equal(two.value, 39); // 13 + iki okey = 13'lü grup
});

test('işlek taş ve okey atma cezası', () => {
  const { s } = setupGame();
  const h0 = [T(0, 11), T(0, 12), T(0, 13), T(1, 11), T(1, 12), T(1, 13), T(3, 9), T(3, 10), T(3, 11), T(3, 8), WILD, T(1, 1)];
  rig(s, [h0, [T(2, 1), T(2, 2)], [T(2, 3)], [T(2, 4)]]);
  G.act(s, 0, { type: 'open', mode: 'runs', melds: [h0.slice(0, 3), h0.slice(3, 6), h0.slice(6, 9)] });
  G.act(s, 0, { type: 'discard', tile: T(3, 8) }); // siyah 9-10-11'e işlenir
  assert.equal(s.round.penalties[0], 101);
});

test('okey atma cezası', () => {
  const { s } = setupGame();
  rig(s, [[WILD, T(1, 1), T(2, 2)], [T(2, 1)], [T(2, 3)], [T(2, 4)]]);
  G.act(s, 0, { type: 'discard', tile: WILD });
  assert.equal(s.round.penalties[0], 101);
});

test('bitiş ve puanlar; sıradaki el', () => {
  const { s } = setupGame();
  const h0 = [T(0, 11), T(0, 12), T(0, 13), T(1, 11), T(1, 12), T(1, 13), T(3, 9), T(3, 10), T(3, 11), T(1, 1)];
  rig(s, [h0, [T(2, 1), T(2, 2), T(3, 5)], [T(2, 3)], new Array(0).concat([T(2, 4)])]);
  s.round.opened[1] = 'runs';
  G.act(s, 0, { type: 'open', mode: 'runs', melds: [h0.slice(0, 3), h0.slice(3, 6), h0.slice(6, 9)] });
  G.act(s, 0, { type: 'discard', tile: T(1, 1) });
  assert.equal(s.phase, 'roundEnd');
  const res = s.round.result;
  assert.equal(res.winner, 0);
  assert.equal(res.total[0], -101);
  assert.equal(res.total[1], 1 + 2 + 5);
  assert.equal(res.total[2], 202);
  G.act(s, 0, { type: 'next' });
  assert.equal(s.phase, 'playing');
  assert.equal(s.round.no, 2);
});

test('elden bitiş (101 altı ama tüm el)', () => {
  const { s } = setupGame();
  // 7 tane 3'lü seri, 21 taş + 1 atılacak = 22
  const melds = [];
  for (let c = 0; c < 4; c++) melds.push([T(c, 1), T(c, 2), T(c, 3)]);
  for (let c = 0; c < 3; c++) melds.push([T(c, 4, 0), T(c, 5, 0), T(c, 6, 0)]);
  const hand = melds.flat().concat([T(3, 13)]);
  assert.equal(hand.length, 22);
  rig(s, [hand, [T(3, 10)], [T(3, 11)], [T(3, 12)]]);
  G.act(s, 0, { type: 'open', mode: 'runs', melds });
  G.act(s, 0, { type: 'discard', tile: T(3, 13) });
  assert.equal(s.phase, 'roundEnd');
  assert.deepEqual(s.round.result.base, [-202, 404, 404, 404]);
});

test('çiftten açma ve karışmama', () => {
  const { s } = setupGame();
  const pairs = [];
  for (let n = 1; n <= 5; n++) pairs.push([T(0, n, 0), T(0, n, 1)]);
  const h = pairs.flat().concat([T(1, 9), T(1, 10), T(1, 11), T(3, 13)]);
  rig(s, [h, [T(2, 1)], [T(2, 3)], [T(2, 4)]]);
  assert.throws(() => G.act(s, 0, { type: 'open', mode: 'pairs', melds: pairs.slice(0, 4) }), /5 çift/);
  G.act(s, 0, { type: 'open', mode: 'pairs', melds: pairs });
  assert.throws(() => G.act(s, 0, { type: 'meld', melds: [[T(1, 9), T(1, 10), T(1, 11)]] }), /çift/);
});

test('deste biterse puansız el, okey tutan 101', () => {
  const { s } = setupGame();
  rig(s, [[T(1, 1), T(1, 2)], [WILD, T(2, 1)], [T(2, 3)], [T(2, 4)]], { stock: 0 });
  G.act(s, 0, { type: 'discard', tile: T(1, 1) });
  assert.throws(() => G.act(s, 1, { type: 'draw' }), /Deste/);
  G.act(s, 1, { type: 'endStock' });
  assert.equal(s.phase, 'roundEnd');
  assert.deepEqual(s.round.result.base, [0, 101, 0, 0]);
  assert.equal(s.history[0].counted, true);
});

test('yeniden bağlanma: aynı isimle dönüş', () => {
  const s = G.create();
  const online = new Set();
  const isOn = (t) => online.has(t);
  const a = G.join(s, 'Ali', null, isOn);
  online.add(a.token);
  assert.throws(() => G.join(s, 'ali', null, isOn), /isim/);
  online.delete(a.token);
  const b = G.join(s, 'ALİ', null, isOn);
  assert.equal(b.seat, a.seat);
  assert.notEqual(b.token, a.token);
});

test('eski kayıt yeni sürümde açılır', () => {
  const { s } = setupGame();
  // eski sürüm: ayarlarda yeni alanlar yok, yandan alınmış taş elde duruyor
  s.settings = { rounds: 5 };
  delete s.seq;
  const r = s.round;
  const left = (r.turn + 3) % 4;
  const tile = r.hands[left].pop();
  r.hands[r.turn].push(tile);
  r.took = tile;
  r.tphase = 'play';
  const old = JSON.parse(JSON.stringify(s));
  G.normalize(old);
  assert.equal(old.settings.mode, 'solo');
  assert.equal(old.settings.katlamali, false);
  assert.equal(old.settings.turnSecs, 30);
  assert.equal(old.round.took, null);
  assert.equal(old.round.tphase, 'draw');
  assert.ok(!old.round.hands[old.round.turn].includes(tile));
  assert.equal(old.round.discards[left].slice(-1)[0], tile);
  assert.ok(old.round.deadline > Date.now());
});
