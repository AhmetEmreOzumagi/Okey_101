'use strict';
/* Renk (uno.js): deste, oynanabilirlik, engel / yön / +2 / +4, biriktirme, çekilen kart, SON deme ve yakalama, puanlama, botlarla tam oyun */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../bot.js');
const U = require('../uno.js');

const off = () => false;
// Kart numarası: renk (0 kırmızı, 1 sarı, 2 yeşil, 3 mavi) * 25 + k
const num = (c, n) => c * 25 + (n === 0 ? 0 : 2 * n - 1);
const num2 = (c, n) => c * 25 + 2 * n; // aynı sayının ikinci kartı
const SKIP = (c) => c * 25 + 19;
const REV = (c) => c * 25 + 21;
const D2 = (c) => c * 25 + 23;
const D2b = (c) => c * 25 + 24;
const WILD = 100, WILD4 = 104, WILD4b = 105;

function mk(n, settings) {
  const s = G.create();
  G.join(s, 'Ahmet', null, off, 0);
  for (let i = 1; i < n; i++) G.lobbyAction(s, 0, { type: 'addBot', seat: i }, off);
  G.lobbyAction(s, 0, { type: 'settings', game: 'uno', ...(settings || {}) }, off);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  return s;
}
// Belirli bir durum kurar: üstteki kart, sıra, eller
function setup(s, { top, color, turn, hands, dir }) {
  const r = s.round;
  const used = new Set([top, ...hands.flat()]);
  r.deck = [...Array(108).keys()].filter((id) => !used.has(id));
  r.discard = [top];
  r.color = color !== undefined ? color : U.info(top).c;
  r.turn = turn || 0;
  r.dir = dir || 1;
  r.pending = 0;
  r.drew = false;
  r.drawn = null;
  r.uno = [false, false, false, false];
  r.vulnerable = -1;
  r.catchAt = 0;
  r.hands = [0, 1, 2, 3].map((i) => (hands[i] ? hands[i].slice() : []));
  return r;
}
const total = (r) => r.deck.length + r.discard.length + r.hands.reduce((a, h) => a + h.length, 0);

test('deste: 108 kart; her renkte bir 0, ikişer 1-9, engel, yön, +2; 4 renk seç, 4 +4', () => {
  const c = {};
  for (let id = 0; id < 108; id++) {
    const x = U.info(id);
    const k = `${x.c}:${x.t}:${x.n === undefined ? '' : x.n}`;
    c[k] = (c[k] || 0) + 1;
  }
  for (let col = 0; col < 4; col++) {
    assert.equal(c[`${col}:num:0`], 1);
    for (let n = 1; n <= 9; n++) assert.equal(c[`${col}:num:${n}`], 2);
    assert.equal(c[`${col}:skip:`], 2);
    assert.equal(c[`${col}:rev:`], 2);
    assert.equal(c[`${col}:draw2:`], 2);
  }
  assert.equal(c['-1:wild:'], 4);
  assert.equal(c['-1:wild4:'], 4);
  assert.equal(U.value(num(0, 7)), 7);
  assert.equal(U.value(SKIP(2)), 20);
  assert.equal(U.value(D2(1)), 20);
  assert.equal(U.value(WILD), 50);
  assert.equal(U.value(WILD4), 50);
  assert.deepEqual(U.info(num(3, 9)), { id: num(3, 9), c: 3, t: 'num', n: 9 });
  assert.equal(U.info(num2(3, 9)).n, 9);
});

test('dağıtım: herkese 7 kart, ilk kart renk seç olmaz, kart sayısı korunur', () => {
  for (let k = 0; k < 60; k++) {
    const n = 2 + (k % 3);
    const s = mk(n);
    const r = s.round;
    assert.equal(r.game, 'uno');
    for (let i = 0; i < 4; i++) {
      if (i >= n) assert.equal(r.hands[i].length, 0);
      else assert.ok(r.hands[i].length === 7 || r.hands[i].length === 9); // ilk kart +2 ise ilk oyuncu 2 çeker
    }
    assert.ok(U.info(r.discard[0]).c >= 0);
    assert.equal(r.color, U.info(r.discard[0]).c);
    assert.equal(total(r), 108);
  }
});

test('oynanabilirlik: aynı renk, aynı sayı ya da aynı işaret; renk seç her zaman', () => {
  const s = mk(2);
  const r = setup(s, { top: num(0, 5), hands: [[], []] });
  const ok = (id) => U.canPlay(r, id, s.settings);
  assert.ok(ok(num(0, 9)));
  assert.ok(ok(num(2, 5)));
  assert.ok(!ok(num(2, 6)));
  assert.ok(ok(SKIP(0)));
  assert.ok(!ok(SKIP(1)));
  assert.ok(ok(WILD));
  assert.ok(ok(WILD4));
  r.discard = [SKIP(1)];
  r.color = 1;
  assert.ok(ok(SKIP(3)));
  assert.ok(!ok(REV(3)));
  // renk seçildikten sonra seçilen renge göre
  r.discard = [WILD];
  r.color = 3;
  assert.ok(ok(num(3, 1)));
  assert.ok(!ok(num(0, 1)));
});

test('kart atma: kural dışı kart ve sıra dışı hamle reddedilir; renk seç için renk gerekir', () => {
  const s = mk(3);
  setup(s, { top: num(0, 5), turn: 0, hands: [[num(2, 6), WILD, num(0, 1)], [num(1, 1)], [num(1, 2)]] });
  assert.throws(() => G.act(s, 0, { type: 'play', card: num(2, 6) }), /oynanmaz/);
  assert.throws(() => G.act(s, 1, { type: 'play', card: num(1, 1) }), /Sıra sende değil/);
  assert.throws(() => G.act(s, 0, { type: 'play', card: WILD }), /renk seç/i);
  G.act(s, 0, { type: 'play', card: WILD, color: 2 });
  assert.equal(s.round.color, 2);
  assert.equal(s.round.turn, 1);
});

test('engel: sıradaki atlanır; yön değiştir: 3+ kişide yön döner, 2 kişide engel gibi', () => {
  let s = mk(3);
  let r = setup(s, { top: num(0, 5), turn: 0, hands: [[SKIP(0), num(1, 1)], [num(1, 2), num(1, 3)], [num(1, 4), num(1, 5)]] });
  G.act(s, 0, { type: 'play', card: SKIP(0) });
  assert.equal(r.turn, 2);

  s = mk(4);
  r = setup(s, { top: num(0, 5), turn: 1, hands: [[num(1, 1), num(1, 1)], [REV(0), num(2, 2)], [num(1, 4), num(3, 3)], [num(1, 6), num(1, 7)]] });
  G.act(s, 1, { type: 'play', card: REV(0) });
  assert.equal(r.dir, -1);
  assert.equal(r.turn, 0, 'yön dönünce sıra öncekine geçer');
  assert.ok(r.events.some((e) => e.type === 'reverse'));

  s = mk(2);
  r = setup(s, { top: num(0, 5), turn: 0, hands: [[REV(0), num(1, 1)], [num(1, 2), num(1, 3)]] });
  G.act(s, 0, { type: 'play', card: REV(0) });
  assert.equal(r.turn, 0, 'iki kişide yön değiştir tekrar oynatır');
});

test('+2 ve +4: sıradaki kart çeker ve atlanır', () => {
  let s = mk(3);
  let r = setup(s, { top: num(0, 5), turn: 0, hands: [[D2(0), num(1, 1)], [num(1, 2)], [num(1, 4)]] });
  G.act(s, 0, { type: 'play', card: D2(0) });
  assert.equal(r.hands[1].length, 3);
  assert.equal(r.turn, 2);
  assert.equal(r.pending, 0);

  s = mk(3);
  r = setup(s, { top: num(0, 5), turn: 0, hands: [[WILD4, num(1, 1)], [num(1, 2)], [num(1, 4)]] });
  G.act(s, 0, { type: 'play', card: WILD4, color: 1 });
  assert.equal(r.hands[1].length, 5);
  assert.equal(r.turn, 2);
  assert.equal(r.color, 1);
  assert.equal(total(r), 108);
});

test('biriktirme açıkken +2 üstüne +2 atılır, ceza toplanır; karşılık veremeyen hepsini çeker', () => {
  const s = mk(3, { unoStack: true });
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[D2(0), num(1, 1)], [D2(2), num(1, 2)], [num(1, 4), num(3, 3)]] });
  G.act(s, 0, { type: 'play', card: D2(0) });
  assert.equal(r.pending, 2);
  assert.equal(r.turn, 1);
  assert.throws(() => G.act(s, 1, { type: 'play', card: num(1, 2) }), /\+2 geldi/);
  G.act(s, 1, { type: 'play', card: D2(2) });
  assert.equal(r.pending, 4);
  assert.equal(r.turn, 2);
  const v = U.view(s, 2);
  assert.deepEqual(v.playable, []);
  G.act(s, 2, { type: 'draw' });
  assert.equal(r.hands[2].length, 6);
  assert.equal(r.pending, 0);
  assert.equal(r.turn, 0, 'cezayı çeken oyuncu atlanır');
});

test('biriktirme kapalıyken +2 hemen çektirir', () => {
  const s = mk(2, { unoStack: false });
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[D2(0), num(1, 1)], [D2b(0), num(1, 2)]] });
  G.act(s, 0, { type: 'play', card: D2(0) });
  assert.equal(r.hands[1].length, 4);
  assert.equal(r.turn, 0);
});

test('kart çekme: çekilen kart uyuyorsa oynanabilir ya da pas geçilir; uymuyorsa sıra geçer', () => {
  const s = mk(2);
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[num(1, 1), num(2, 2)], [num(1, 2), num(3, 3)]] });
  r.deck.push(num(0, 9)); // çekilecek kart uyuyor
  G.act(s, 0, { type: 'draw' });
  assert.equal(r.drew, true);
  assert.equal(r.drawn, num(0, 9));
  assert.equal(r.turn, 0);
  assert.deepEqual(U.view(s, 0).playable, [num(0, 9)]);
  assert.throws(() => G.act(s, 0, { type: 'draw' }), /Zaten/);
  G.act(s, 0, { type: 'pass' });
  assert.equal(r.turn, 1);
  assert.throws(() => G.act(s, 1, { type: 'pass' }), /Önce kart çek/);
  r.deck.push(num(2, 7)); // uymayan kart (üstte kırmızı 5)
  G.act(s, 1, { type: 'draw' });
  assert.equal(r.drew, false);
  assert.equal(r.turn, 0);
});

test('deste bitince yerdekiler (üstteki hariç) karıştırılıp deste olur', () => {
  const s = mk(2);
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[num(1, 1)], [num(1, 2)]] });
  const rest = r.deck.slice();
  r.deck = [];
  r.discard = [...rest, num(0, 5)];
  G.act(s, 0, { type: 'draw' });
  assert.equal(r.discard.length, 1);
  assert.equal(r.discard[0], num(0, 5));
  assert.equal(total(r), 108);
  assert.ok(r.events.some((e) => e.type === 'reshuffle'));
});

test('SON: demeden 1 karta inen yakalanırsa 2 kart çeker; deyince yakalanamaz', () => {
  const s = mk(3);
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[num(0, 1), num(0, 2)], [num(1, 2), num(1, 3)], [num(1, 4), num(1, 5)]] });
  G.act(s, 0, { type: 'play', card: num(0, 1) });
  assert.equal(r.vulnerable, 0);
  assert.equal(U.view(s, 1).vulnerable, 0);
  assert.throws(() => G.act(s, 0, { type: 'catch' }), /kimse yok/);
  G.act(s, 2, { type: 'catch' });
  assert.equal(r.hands[0].length, 3);
  assert.equal(r.vulnerable, -1);
  assert.ok(r.events.some((e) => e.type === 'caught' && e.seat === 0));

  const s2 = mk(3);
  const r2 = setup(s2, { top: num(0, 5), turn: 0, hands: [[num(0, 1), num(0, 2)], [num(1, 2), num(1, 3), num(1, 6)], [num(1, 4), num(1, 5)]] });
  assert.throws(() => G.act(s2, 1, { type: 'uno' }), /2 ya da 1/);
  G.act(s2, 0, { type: 'uno' });
  G.act(s2, 0, { type: 'play', card: num(0, 1) });
  assert.equal(r2.vulnerable, -1);
  assert.throws(() => G.act(s2, 1, { type: 'catch' }), /kimse yok/);
});

test('SON yakalama fırsatı bir sonraki hamleyle kaçar; bot yakalayabilir', () => {
  const s = mk(3);
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[num(0, 1), num(0, 2)], [num(0, 3), num(1, 3), num(1, 6)], [num(1, 4), num(1, 5)]] });
  G.act(s, 0, { type: 'play', card: num(0, 1) });
  assert.equal(r.vulnerable, 0);
  G.act(s, 1, { type: 'play', card: num(0, 3) });
  assert.equal(r.vulnerable, -1);

  const s2 = mk(3);
  const r2 = setup(s2, { top: num(0, 5), turn: 0, hands: [[num(0, 1), num(0, 2)], [num(0, 3), num(1, 3)], [num(1, 4), num(1, 5)]] });
  G.act(s2, 0, { type: 'play', card: num(0, 1) });
  r2.catchAt = Date.now() - 1; // bot yakalama zamanı geldi
  assert.equal(G.tick(s2, Date.now()), true);
  assert.equal(r2.hands[0].length, 3);
});

test('el bitişi: bitiren, rakiplerin kartlarının puanını alır; hedefe ulaşınca oyun biter', () => {
  const s = mk(3, { unoTarget: 100 });
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[num(0, 1)], [num(1, 9), SKIP(2), WILD], [D2(3), num(3, 0)]] });
  r.uno[0] = true;
  G.act(s, 0, { type: 'play', card: num(0, 1) });
  assert.equal(s.phase, 'roundEnd');
  const res = r.result;
  assert.equal(res.winner, 0);
  assert.equal(res.points, 9 + 20 + 50 + 20 + 0);
  assert.deepEqual(res.total, [99, 0, 0, 0]);
  assert.equal(res.gameOver, false);
  G.act(s, 0, { type: 'next' });
  assert.equal(s.phase, 'playing');
  const r2 = setup(s, { top: num(0, 5), turn: 1, hands: [[num(2, 3)], [num(0, 8)], [num(3, 1)]] });
  G.act(s, 1, { type: 'play', card: num(0, 8) });
  assert.equal(r2.result.points, 4);
  assert.equal(r2.result.gameOver, false, '1 + 4 puan hedefe ulaşmaz');
  G.act(s, 0, { type: 'next' });
  const r3 = setup(s, { top: num(0, 5), turn: 0, hands: [[num(0, 2)], [num(1, 1)], [num(3, 1)]] });
  G.act(s, 0, { type: 'play', card: num(0, 2) });
  assert.equal(r3.result.gameOver, true, '99 + 2 = 101');
  G.act(s, 0, { type: 'next' });
  assert.equal(s.phase, 'gameEnd');
});

test('son kart +2 ise sıradaki yine çeker ve o kartlar da puana sayılır', () => {
  const s = mk(2);
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[D2(0)], [num(1, 9)]] });
  r.uno[0] = true;
  G.act(s, 0, { type: 'play', card: D2(0) });
  assert.equal(s.phase, 'roundEnd');
  assert.equal(r.result.hands[1].length, 3);
  assert.ok(r.result.points >= 9);
});

test('görünüm: başkalarının eli görünmez, oynanabilir kartlar sadece sıradakine', () => {
  const s = mk(3);
  const r = setup(s, { top: num(0, 5), turn: 0, hands: [[num(0, 1), num(2, 2)], [num(0, 3), num(1, 3)], [num(1, 4), num(1, 5)]] });
  const v0 = U.view(s, 0);
  assert.deepEqual(v0.playable, [num(0, 1)]);
  assert.deepEqual(v0.handCounts, [2, 2, 2, 0]);
  const v1 = U.view(s, 1);
  assert.deepEqual(v1.playable, []);
  assert.deepEqual(v1.hand, r.hands[1]);
  const full = G.view(s, s.seats[0].token, off);
  assert.ok(!('hands' in full.round) && !('deck' in full.round));
});

test('süre dolunca otomatik oynanır', () => {
  const s = mk(2);
  const r = s.round;
  const seat = r.turn;
  const moves = r.moveNo;
  assert.equal(G.tick(s, r.deadline - 100), false);
  assert.equal(G.tick(s, r.deadline + 5000), true);
  assert.ok(r.moveNo > moves || s.phase !== 'playing' || r.turn !== seat);
});

test('bot: renk seçerken elindeki en çok rengi seçer, oynayamazsa çeker', () => {
  const s = mk(2);
  const r = setup(s, { top: num(0, 5), turn: 1, hands: [[num(1, 1), num(1, 2)], [WILD, num(3, 1), num(3, 7), num(2, 2)]] });
  U.botAct(s, 1);
  assert.equal(r.discard[r.discard.length - 1], WILD);
  assert.equal(r.color, 3);
  const r2 = setup(s, { top: num(0, 5), turn: 1, hands: [[num(1, 1), num(1, 2)], [num(3, 1), num(2, 2)]] });
  r2.deck.push(num(1, 9));
  U.botAct(s, 1);
  assert.equal(r2.hands[1].length, 3);
});

function playOut(n, settings) {
  const s = mk(n, settings);
  for (let i = 0; i < 4; i++) if (s.seats[i]) s.seats[i].bot = true;
  let now = Date.now();
  let hands = 0;
  for (let step = 0; step < 400000 && s.phase !== 'gameEnd'; step++) {
    if (s.phase === 'roundEnd') {
      hands++;
      const r = s.round;
      assert.equal(total(r), 108);
      const w = r.result.winner;
      assert.equal(r.hands[w].length, 0);
      const pts = r.hands.reduce((a, h) => a + h.reduce((b, id) => b + U.value(id), 0), 0);
      assert.equal(r.result.points, pts);
      G.act(s, 0, { type: 'next' });
      continue;
    }
    now += 1500;
    B.step(s, now);
    G.tick(s, now);
    if (s.phase === 'playing') {
      const r = s.round;
      assert.equal(total(r), 108);
      assert.equal(new Set([...r.deck, ...r.discard, ...r.hands.flat()]).size, 108);
    }
  }
  return { s, hands };
}

test('botlarla tam oyun: 2, 3, 4 kişi, biriktirmeli ve biriktirmesiz', () => {
  for (const [n, st] of [[2, {}], [3, {}], [4, {}], [2, { unoStack: true }], [4, { unoStack: true, unoTarget: 100 }], [3, { unoTarget: 300 }]]) {
    const { s, hands } = playOut(n, st);
    assert.equal(s.phase, 'gameEnd', `${n} kişi ${JSON.stringify(st)}`);
    assert.ok(hands >= 1);
    const t = [0, 0, 0, 0];
    s.history.forEach((h) => h.total.forEach((x, i) => (t[i] += x)));
    assert.ok(Math.max(...t) >= s.settings.unoTarget);
  }
});
