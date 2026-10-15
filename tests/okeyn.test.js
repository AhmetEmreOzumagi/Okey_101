'use strict';
/* Normal (düz) okey: dağıtım, seri/grup kuralları (12-13-1 olur, 13-1-2 olmaz), bitirme puanları, gösterge, botlarla tam oyun */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../bot.js');
const E = require('../public/engine.js');
const ON = require('../okeyn.js');

const off = () => false;
// renk: 0 kırmızı, 1 sarı, 2 mavi, 3 siyah; copy: aynı taşın ikinci eşi
const T = (c, n, copy = 0) => c * 26 + (n - 1) * 2 + copy;
const OKEY = { c: 2, n: 7 }; // mavi 7 okey (gösterge mavi 6)
const WILD = T(2, 7);

function mk(settings) {
  const s = G.create();
  G.join(s, 'Ahmet', null, off, 0);
  for (let i = 1; i < 4; i++) G.lobbyAction(s, 0, { type: 'addBot', seat: i }, off);
  G.lobbyAction(s, 0, { type: 'settings', game: 'okeyn', turnSecs: 0, ...(settings || {}) }, off);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  return s;
}
// Sırayı 0. koltuğa verip eline istenen 15 taşı koyar (ilk hamle: çekmeden atar)
function rig(s, hand) {
  const r = s.round;
  r.indicator = T(2, 6);
  r.okey = OKEY;
  r.turn = 0;
  r.tphase = 'play';
  r.turnNo = 0;
  r.played = [false, false, false, false];
  r.hands[0] = hand.slice();
  return r;
}
const pts = (s) => ON.pointsOf(s);

test('dağıtım: başlayana 15, diğerlerine 14 taş; gösterge sahte okey olmaz; okey göstergenin bir fazlası', () => {
  for (let k = 0; k < 30; k++) {
    const s = mk();
    const r = s.round;
    assert.equal(r.game, 'okeyn');
    for (let i = 0; i < 4; i++) assert.equal(r.hands[i].length, i === s.startSeat ? 15 : 14);
    assert.equal(r.turn, s.startSeat);
    assert.equal(r.tphase, 'play', 'başlayan çekmeden atar');
    assert.ok(r.indicator < 104);
    assert.deepEqual(r.okey, E.okeyFromIndicator(r.indicator));
    const all = [...r.stock, r.indicator, ...r.hands.flat()];
    assert.equal(all.length, 106);
    assert.equal(new Set(all).size, 106);
  }
});

test('seri ve grup: 12-13-1 olur, 13-1-2 olmaz; grup farklı renk; okey ve sahte okey', () => {
  assert.equal(E.meldN([T(1, 12), T(1, 13), T(1, 1)], OKEY), true);
  assert.equal(E.meldN([T(1, 11), T(1, 12), T(1, 13), T(1, 1)], OKEY), true);
  assert.equal(E.meldN([T(1, 13), T(1, 1), T(1, 2)], OKEY), false);
  assert.equal(E.meldN([T(1, 1), T(1, 2), T(1, 3)], OKEY), true);
  assert.equal(E.meldN([T(1, 12), WILD, T(1, 1)], OKEY), true, 'okey 13 yerine');
  assert.equal(E.meldN([T(1, 4), T(0, 5), T(1, 6)], OKEY), false, 'seri tek renk');
  assert.equal(E.meldN([T(0, 8), T(1, 8), T(3, 8)], OKEY), true);
  assert.equal(E.meldN([T(0, 8), T(1, 8), T(2, 8), T(3, 8)], OKEY), true);
  assert.equal(E.meldN([T(0, 8), T(0, 8, 1), T(3, 8)], OKEY), false, 'grupta aynı renk iki kez olmaz');
  // Sahte okey, okeyin (mavi 7) yerine geçer: mavi 6-7-8
  assert.equal(E.meldN([T(2, 6), 104, T(2, 8)], OKEY), true);
  assert.equal(E.meldN([T(0, 6), 104, T(0, 8)], OKEY), false, 'sahte okey joker değildir');
});

test('bitirme kontrolü: 14 taşın hepsi per ya da 7 çift', () => {
  const runs = [T(0, 1), T(0, 2), T(0, 3), T(0, 4), T(1, 12), T(1, 13), T(1, 1), T(2, 9), T(2, 10), T(2, 11), T(0, 8), T(1, 8), T(2, 8), T(3, 8)];
  assert.equal(E.finishN(runs, OKEY).kind, 'runs');
  const pairs = [T(0, 1), T(0, 1, 1), T(0, 3), T(0, 3, 1), T(1, 4), T(1, 4, 1), T(1, 9), T(1, 9, 1), T(2, 2), T(2, 2, 1), T(3, 11), T(3, 11, 1), T(3, 13), WILD];
  assert.equal(E.finishN(pairs, OKEY).kind, 'pairs', 'okey tek taşla çift olur');
  const bad = runs.slice(0, 13).concat([T(3, 5)]);
  assert.equal(E.finishN(bad, OKEY), null);
});

const WIN = [T(0, 1), T(0, 2), T(0, 3), T(0, 4), T(1, 12), T(1, 13), T(1, 1), T(2, 9), T(2, 10), T(2, 11), T(0, 8), T(1, 8), T(2, 8), T(3, 8)];
const PAIRS = [T(0, 1), T(0, 1, 1), T(0, 3), T(0, 3, 1), T(1, 4), T(1, 4, 1), T(1, 9), T(1, 9, 1), T(2, 2), T(2, 2, 1), T(3, 11), T(3, 11, 1), T(3, 13), T(3, 13, 1)];

test('puan: normal bitiş diğerlerinden 2, okey atarak 4, çiftle 4, çift + okey 8 düşer', () => {
  const cases = [
    [WIN, T(3, 2), 2],
    [WIN, WILD, 4],
    [PAIRS, T(3, 2), 4],
    [PAIRS, WILD, 8],
  ];
  for (const [hand, last, loss] of cases) {
    const s = mk({ okeynPuan: 20 });
    rig(s, hand.concat([last]));
    G.act(s, 0, { type: 'finish', tile: last });
    assert.equal(s.phase, 'roundEnd');
    assert.equal(s.round.result.winner, 0);
    assert.deepEqual(pts(s), [20, 20 - loss, 20 - loss, 20 - loss]);
  }
});

test('eşlide bitirenin eşi puan kaybetmez', () => {
  const s = mk({ okeynPuan: 20, mode: 'team' });
  rig(s, WIN.concat([T(3, 2)]));
  G.act(s, 0, { type: 'finish', tile: T(3, 2) });
  assert.deepEqual(pts(s), [20, 18, 20, 18]);
});

test('bitmeyen elle Bitir denenemez; el 15 taş değilken atılmaz', () => {
  const s = mk();
  const bad = WIN.slice(0, 13).concat([T(3, 5), T(3, 2)]);
  rig(s, bad);
  assert.throws(() => G.act(s, 0, { type: 'finish', tile: T(3, 2) }), /bitmiyor/);
  G.act(s, 0, { type: 'discard', tile: T(3, 2) });
  assert.equal(s.round.turn, 1);
  assert.equal(s.round.tphase, 'draw');
  assert.throws(() => G.act(s, 1, { type: 'discard', tile: s.round.hands[1][0] }), /çekmelisin/);
});

test('yandan alma: sadece soldakinin attığı son taş alınır', () => {
  const s = mk();
  rig(s, WIN.concat([T(3, 2)]));
  G.act(s, 0, { type: 'discard', tile: T(3, 2) });
  const r = s.round;
  G.act(s, 1, { type: 'take' });
  assert.ok(r.hands[1].includes(T(3, 2)));
  G.act(s, 1, { type: 'discard', tile: r.hands[1][0] });
  // 2. koltuk için soldaki 1; 0'ın yığınından alamaz
  r.discards[0].push(T(3, 3));
  r.lastDiscardSeat = 0;
  assert.throws(() => G.act(s, 2, { type: 'take' }), /Yandan/);
});

test('gösterge: eşi elinde olan ilk hamlesinde gösterir, el bitince diğerleri 1 puan kaybeder', () => {
  const s = mk({ okeynPuan: 20, okeynGosterge: true });
  const hand = WIN.slice(0, 13).concat([T(2, 6, 1), T(3, 2)]); // T(2,6,1): göstergenin (T(2,6)) eşi
  rig(s, hand);
  G.act(s, 0, { type: 'show' });
  assert.equal(s.round.shown, 0);
  assert.throws(() => G.act(s, 0, { type: 'show' }));
  // Deste biterse el puansız biter ama gösterge cezası yine yazılır
  s.round.stock = [];
  G.act(s, 0, { type: 'discard', tile: T(3, 2) });
  G.act(s, 1, { type: 'endStock' });
  assert.equal(s.phase, 'roundEnd');
  assert.deepEqual(pts(s), [20, 19, 19, 19]);
});

test('gösterge ayarı kapalıysa gösterilemez; ilk hamle geçince de gösterilemez', () => {
  const s = mk({ okeynGosterge: false });
  rig(s, WIN.slice(0, 13).concat([T(2, 6, 1), T(3, 2)]));
  assert.throws(() => G.act(s, 0, { type: 'show' }));
  const s2 = mk({ okeynGosterge: true });
  rig(s2, WIN.slice(0, 13).concat([T(2, 6, 1), T(3, 2)]));
  G.act(s2, 0, { type: 'discard', tile: T(3, 2) });
  s2.round.turn = 0; s2.round.tphase = 'draw';
  assert.throws(() => G.act(s2, 0, { type: 'show' }));
});

function playAll(settings) {
  const s = mk(settings);
  s.seats[0].bot = true;
  let now = Date.now(), steps = 0;
  while (s.phase !== 'gameEnd' && steps < 400000) {
    steps++;
    now += 2500;
    if (s.phase === 'roundEnd') { G.lobbyAction(s, 0, { type: 'next' }, off); continue; }
    B.step(s, now);
    G.tick(s, now);
  }
  return s;
}

test('botlarla tam oyun (eşsiz ve eşli): biri 0\'a inince biter', () => {
  for (const st of [{ okeynPuan: 10 }, { okeynPuan: 10, mode: 'team' }]) {
    const s = playAll(st);
    assert.equal(s.phase, 'gameEnd');
    const p = pts(s);
    assert.ok(p.some((x) => x <= 0), 'birinin puanı bitmiş olmalı');
    if (st.mode === 'team') { assert.equal(p[0], p[2]); assert.equal(p[1], p[3]); }
  }
});
