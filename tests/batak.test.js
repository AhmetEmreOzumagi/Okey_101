'use strict';
/* Batak: 4 kişilik ihaleli, 4 kişilik eşli, 3 kişilik gömmeli. Dağıtım, ihale, koz, kart atma kuralları, puanlama, botlarla tam oyun */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../bot.js');
const BT = require('../batak.js');

const off = () => false;
// Kart: renk (0 maça, 1 kupa, 2 karo, 3 sinek) ve değer (1 As ... 11 Vale, 12 Kız, 13 Papaz)
const C = (suit, rank) => suit * 13 + rank - 1;
const [MACA, KUPA, KARO, SINEK] = [0, 1, 2, 3];

function mk(tip, extra) {
  const n = tip === 'gommeli' ? 3 : 4;
  const s = G.create();
  G.join(s, 'Ahmet', null, off, 0);
  for (let i = 1; i < n; i++) G.lobbyAction(s, 0, { type: 'addBot', seat: i }, off);
  G.lobbyAction(s, 0, { type: 'settings', game: 'batak', batakTip: tip, turnSecs: 0, ...(extra || {}) }, off);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  return s;
}
const turn = (s) => s.round.turn;

test('dağıtım: 4 kişide 13\'er kart; gömmelide 3 kişiye 16\'şar kart ve 4 kart gömü', () => {
  for (let k = 0; k < 20; k++) {
    for (const tip of ['ihale', 'esli']) {
      const r = mk(tip).round;
      assert.equal(r.phase, 'bid');
      r.hands.forEach((h) => assert.equal(h.length, 13));
      assert.equal(new Set(r.hands.flat()).size, 52);
    }
    const s = mk('gommeli');
    const r = s.round;
    assert.equal(r.active.filter(Boolean).length, 3);
    assert.equal(r.hands.filter((h) => h.length === 16).length, 3);
    assert.equal(r.kitty.length, 4);
    assert.equal(new Set([...r.hands.flat(), ...r.kitty]).size, 52);
  }
});

test('gömmeli 3 kişiyle oynanır: 4 kişilik masada başlamaz, ayara geçince fazla bot kalkar', () => {
  const s = G.create();
  G.join(s, 'Ahmet', null, off, 0);
  for (let i = 1; i < 4; i++) G.lobbyAction(s, 0, { type: 'addBot', seat: i }, off);
  G.lobbyAction(s, 0, { type: 'settings', game: 'batak', batakTip: 'gommeli' }, off);
  assert.equal(s.seats.filter(Boolean).length, 3, 'bir bot kendiliğinden kalkmalı');
  assert.ok(s.seats[0] && !s.seats[0].bot, 'oyuncu yerinde kalır');
  G.lobbyAction(s, 0, { type: 'addBot', seat: s.seats.findIndex((x) => !x) }, off);
  assert.throws(() => G.lobbyAction(s, 0, { type: 'start' }, off), /3 kişiyle/);
});

test('ihale: en az 5, her teklif öncekinden büyük, pas diyen tekrar giremez', () => {
  const s = mk('ihale');
  const r = s.round;
  const a = turn(s);
  assert.throws(() => G.act(s, a, { type: 'bid', amount: 4 }), /5 ile 13/);
  G.act(s, a, { type: 'bid', amount: 6 });
  const b = turn(s);
  assert.notEqual(b, a);
  assert.throws(() => G.act(s, b, { type: 'bid', amount: 6 }), /7 ile 13/);
  G.act(s, b, { type: 'pass' });
  const c = turn(s);
  G.act(s, c, { type: 'pass' });
  const d = turn(s);
  G.act(s, d, { type: 'pass' });
  assert.equal(r.phase, 'trump');
  assert.equal(r.bidder, a);
  assert.equal(r.contract, 6);
  assert.equal(r.turn, a);
});

test('herkes pas derse ihale ilk konuşana kalır: ihalelide 4, eşlide 7, gömmelide 7 (gömüyü alır)', () => {
  for (const [tip, forced] of [['ihale', 4], ['esli', 7], ['gommeli', 7]]) {
    const s = mk(tip);
    const r = s.round;
    const first = r.first;
    for (let k = 0; k < 4 && r.phase === 'bid'; k++) G.act(s, turn(s), { type: 'pass' });
    assert.equal(r.bidder, first);
    assert.equal(r.contract, forced);
    if (tip === 'gommeli') {
      assert.equal(r.phase, 'bury');
      assert.equal(r.hands[first].length, 20);
      assert.throws(() => G.act(s, first, { type: 'bury', cards: r.hands[first].slice(0, 3) }), /4 kart/);
      const g = r.hands[first].slice(0, 4);
      G.act(s, first, { type: 'bury', cards: g });
      assert.equal(r.hands[first].length, 16);
      assert.equal(r.phase, 'trump');
    } else assert.equal(r.phase, 'trump');
  }
});

test('en yüksek ihale (13 / gömmelide 16) söylenince ihale hemen kapanır', () => {
  const s = mk('ihale');
  G.act(s, turn(s), { type: 'bid', amount: 13 });
  assert.equal(s.round.phase, 'trump');
  const g = mk('gommeli');
  G.act(g, turn(g), { type: 'bid', amount: 16 });
  assert.equal(g.round.phase, 'bury');
});

// Oynanış durumunu elle kurar
function rigPlay(tip, hands, trump, opts) {
  const s = mk(tip);
  const r = s.round;
  r.hands = hands.map((h) => h.slice());
  r.trump = trump;
  r.phase = 'play';
  r.bidder = 0;
  r.contract = tip === 'ihale' ? 5 : 8;
  r.turn = 0;
  r.trick = [];
  r.trumpBroken = false;
  r.dummy = tip === 'esli' ? 2 : -1;
  Object.assign(r, opts || {});
  return s;
}

test('kart atma: renge uymak ve yerdekini geçmek zorunlu; geçemiyorsa küçük de atılır', () => {
  const s = rigPlay('ihale', [[C(MACA, 5)], [C(MACA, 2), C(MACA, 9), C(KUPA, 1)], [C(MACA, 3), C(KUPA, 5)], [C(KARO, 4)]], SINEK);
  const r = s.round;
  G.act(s, 0, { type: 'play', card: C(MACA, 5) });
  assert.deepEqual(BT.legalCards(r, 1), [C(MACA, 9)], 'maça 9 ile geçmek zorunlu');
  assert.throws(() => G.act(s, 1, { type: 'play', card: C(MACA, 2) }), /geçmelisin/);
  assert.throws(() => G.act(s, 1, { type: 'play', card: C(KUPA, 1) }), /Maça atmalısın/);
  G.act(s, 1, { type: 'play', card: C(MACA, 9) });
  assert.deepEqual(BT.legalCards(r, 2), [C(MACA, 3)], 'geçemiyorsa küçük maça');
});

test('kart atma: rengin yoksa koz atmak zorunlu, yerde koz varsa yükseltmek gerekir; koz da yoksa serbest', () => {
  const s = rigPlay('ihale', [[C(MACA, 5)], [C(SINEK, 4), C(KUPA, 1)], [C(SINEK, 2), C(SINEK, 9), C(KARO, 13)], [C(KARO, 4), C(KUPA, 7)]], SINEK);
  const r = s.round;
  G.act(s, 0, { type: 'play', card: C(MACA, 5) });
  assert.deepEqual(BT.legalCards(r, 1), [C(SINEK, 4)]);
  G.act(s, 1, { type: 'play', card: C(SINEK, 4) });
  assert.deepEqual(BT.legalCards(r, 2), [C(SINEK, 9)], 'yerdeki kozu geçmek zorunlu');
  G.act(s, 2, { type: 'play', card: C(SINEK, 9) });
  assert.deepEqual(BT.legalCards(r, 3).sort(), [C(KARO, 4), C(KUPA, 7)].sort());
  G.act(s, 3, { type: 'play', card: C(KUPA, 7) });
  assert.equal(r.tricks[2], 1, 'en büyük koz eli alır');
  assert.equal(r.turn, 2, 'eli alan yeni eli açar');
  assert.equal(r.trumpBroken, true);
});

test('el kozla kesildiyse açılan renkte yükseltmek gerekmez', () => {
  const s = rigPlay('ihale', [[C(MACA, 5)], [C(SINEK, 4)], [C(MACA, 2), C(MACA, 13)], [C(KARO, 4)]], SINEK);
  const r = s.round;
  G.act(s, 0, { type: 'play', card: C(MACA, 5) });
  G.act(s, 1, { type: 'play', card: C(SINEK, 4) });
  assert.deepEqual(BT.legalCards(r, 2).sort(), [C(MACA, 2), C(MACA, 13)].sort());
});

test('koz kırılmadan kozla el açılmaz (sadece koz kaldıysa açılır); eşlide kozla açılabilir', () => {
  const s = rigPlay('ihale', [[C(SINEK, 5), C(MACA, 2)], [C(MACA, 3)], [C(MACA, 4)], [C(MACA, 6)]], SINEK);
  assert.deepEqual(BT.legalCards(s.round, 0), [C(MACA, 2)]);
  assert.throws(() => G.act(s, 0, { type: 'play', card: C(SINEK, 5) }), /Koz kırılmadan/);
  const s2 = rigPlay('ihale', [[C(SINEK, 5), C(SINEK, 7)], [], [], []], SINEK);
  assert.equal(BT.legalCards(s2.round, 0).length, 2);
  const s3 = rigPlay('esli', [[C(SINEK, 5), C(MACA, 2)], [], [], []], SINEK);
  assert.equal(BT.legalCards(s3.round, 0).length, 2);
});

test('eli kim alır: koz varsa en büyük koz, yoksa açılan rengin en büyüğü (As en büyük)', () => {
  const r = { trump: KUPA };
  assert.equal(BT.trickWinner(r, [{ seat: 0, card: C(MACA, 13) }, { seat: 1, card: C(MACA, 1) }, { seat: 2, card: C(KARO, 1) }, { seat: 3, card: C(MACA, 10) }]), 1);
  assert.equal(BT.trickWinner(r, [{ seat: 0, card: C(MACA, 13) }, { seat: 1, card: C(KUPA, 2) }, { seat: 2, card: C(KUPA, 3) }, { seat: 3, card: C(MACA, 1) }]), 2);
});

// Elin sonunu hızlıca getirir: her elde kalan son kartlar
function finishWith(tip, tricks, bidder, contract) {
  const s = rigPlay(tip, [[C(MACA, 1)], [C(MACA, 2)], [C(MACA, 3)], tip === 'gommeli' ? [] : [C(MACA, 4)]], KUPA, { bidder, contract });
  const r = s.round;
  r.tricks = tricks.slice();
  r.turn = 0;
  const n = tip === 'gommeli' ? 3 : 4;
  for (let k = 0; k < n; k++) G.act(s, k === 2 && tip === 'esli' ? 0 : k, { type: 'play', card: r.hands[k][0] });
  return s;
}

test('puan (4 kişi): tutturan aldığı el kadar, batan eksi ihale; hiç el almayan eksi ihale', () => {
  // Son eli 0 alır (maça As)
  let s = finishWith('ihale', [5, 4, 3, 0], 0, 6);
  let h = s.history[s.history.length - 1];
  assert.deepEqual(h.total, [6, 4, 3, -6]);
  assert.equal(s.round.result.made, true);
  s = finishWith('ihale', [3, 5, 4, 0], 0, 6);
  h = s.history[s.history.length - 1];
  assert.deepEqual(h.total, [-6, 5, 4, -6]);
  assert.equal(s.round.result.made, false);
});

test('puan (eşli): takım tutturursa aldığı el, batarsa eksi ihale; karşı takım 2 elden azsa eksi ihale', () => {
  let s = finishWith('esli', [5, 1, 4, 2], 0, 9);
  assert.deepEqual(s.history[s.history.length - 1].total, [10, 3, 10, 3]);
  s = finishWith('esli', [5, 1, 6, 0], 0, 9);
  assert.deepEqual(s.history[s.history.length - 1].total, [12, -9, 12, -9]);
  s = finishWith('esli', [3, 2, 3, 4], 0, 9);
  assert.deepEqual(s.history[s.history.length - 1].total, [-9, 6, -9, 6]);
});

test('eşli: ihaleyi alanın eşinin kartları açılır ve onları ihaleyi alan oynar', () => {
  const s = mk('esli');
  const r = s.round;
  G.act(s, turn(s), { type: 'bid', amount: 8 });
  const bidder = r.bidder;
  while (r.phase === 'bid') G.act(s, turn(s), { type: 'pass' });
  G.act(s, bidder, { type: 'trump', suit: KUPA });
  const dummy = (bidder + 2) % 4;
  assert.equal(r.dummy, dummy);
  const v = BT.view(s, (bidder + 1) % 4);
  assert.equal(v.dummyHand.length, 13, 'açık el herkese görünür');
  // Sıra eşe gelene kadar oyna
  let guard = 0;
  while (r.turn !== dummy && guard++ < 10) {
    const t = r.turn;
    G.act(s, t === dummy ? bidder : t, { type: 'play', card: BT.legalCards(r, t)[0] });
  }
  assert.equal(r.turn, dummy);
  assert.throws(() => G.act(s, dummy, { type: 'play', card: BT.legalCards(r, dummy)[0] }), /eşin oynuyor/);
  const card = BT.legalCards(r, dummy)[0];
  G.act(s, bidder, { type: 'play', card });
  assert.ok(!r.hands[dummy].includes(card));
});

function playAll(tip, el) {
  const s = mk(tip, { batakEl: el });
  s.seats[0].bot = true;
  let now = Date.now(), steps = 0;
  while (s.phase !== 'gameEnd' && steps < 200000) {
    steps++;
    now += 2500;
    if (s.phase === 'roundEnd') { G.lobbyAction(s, 0, { type: 'next' }, off); continue; }
    B.step(s, now);
    G.tick(s, now);
  }
  return s;
}

test('botlarla tam oyun: üç türde de seçilen el sayısı kadar oynanır, her elde bütün eller dağıtılır', () => {
  for (const [tip, el] of [['ihale', 5], ['esli', 5], ['gommeli', 5], ['ihale', 11]]) {
    const s = playAll(tip, el);
    assert.equal(s.phase, 'gameEnd', tip);
    const hs = s.history.filter((h) => h.kind === 'batak');
    assert.equal(hs.length, el);
  }
});
