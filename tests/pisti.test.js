'use strict';
/* Pişti: dağıtım, alma, pişti puanları (10 / As 20 / Vale 30), kart puanları, çoğunluk, eşli oyun, botlarla tam oyun */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../bot.js');
const P = require('../pisti.js');

const off = () => false;
// Kart numarası: renk (0 maça, 1 kupa, 2 karo, 3 sinek) ve değer (1 As ... 11 Vale, 12 Kız, 13 Papaz)
const card = (suit, rank) => suit * 13 + rank - 1;

function mk(n, settings) {
  const s = G.create();
  G.join(s, 'Ahmet', null, off, 0);
  for (let i = 1; i < n; i++) G.lobbyAction(s, 0, { type: 'addBot', seat: i }, off);
  G.lobbyAction(s, 0, { type: 'settings', game: 'pisti', ...(settings || {}) }, off);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  return s;
}

function count(r) {
  let n = r.deck.length + r.pile.length;
  r.hands.forEach((h) => (n += h.length));
  r.captured.forEach((c) => (n += c.length));
  return n;
}

test('dağıtım: yere 4 kart (üstteki açık, vale değil), herkese 4 kart', () => {
  for (let k = 0; k < 40; k++) {
    for (const n of [2, 3, 4]) {
      const s = mk(n);
      const r = s.round;
      assert.equal(s.phase, 'playing');
      assert.equal(r.game, 'pisti');
      assert.equal(r.pile.length, 4);
      assert.equal(r.hidden, 3);
      assert.ok(!P.isJ(r.pile[3]), 'yerdeki açık kart vale olmamalı');
      for (let i = 0; i < 4; i++) assert.equal(r.hands[i].length, i < n ? 4 : 0);
      assert.equal(r.deck.length, 52 - 4 - 4 * n);
      assert.equal(count(r), 52);
      assert.equal(new Set([...r.deck, ...r.pile, ...r.hands.flat()]).size, 52);
    }
  }
});

test('kart puanları: As ve Vale 1, sinek ikili 2, karo onlu 3; destede toplam 13', () => {
  assert.equal(P.cardPoints(card(0, 1)), 1);
  assert.equal(P.cardPoints(card(2, 11)), 1);
  assert.equal(P.cardPoints(P.CLUB2), 2);
  assert.equal(P.cardPoints(P.DIAMOND10), 3);
  assert.equal(P.cardPoints(card(1, 7)), 0);
  assert.equal(P.CLUB2, card(3, 2));
  assert.equal(P.DIAMOND10, card(2, 10));
  let t = 0;
  for (let id = 0; id < 52; id++) t += P.cardPoints(id);
  assert.equal(t, 13);
  assert.equal(P.pistiPoints(card(0, 5)), 10);
  assert.equal(P.pistiPoints(card(0, 1)), 20);
  assert.equal(P.pistiPoints(card(0, 11)), 30);
});

test('aynı değerdeki kart yerdekilerin hepsini alır, gizli kartlar da açılır', () => {
  const s = mk(2);
  const r = s.round;
  r.turn = 0;
  r.pile = [card(0, 3), card(1, 4), card(2, 9), card(3, 7)];
  r.hidden = 3;
  r.hands[0] = [card(0, 7), card(1, 2), card(1, 5), card(2, 6)];
  G.act(s, 0, { type: 'play', card: card(0, 7) });
  assert.equal(r.pile.length, 0);
  assert.equal(r.hidden, 0);
  assert.equal(r.captured[0].length, 5);
  assert.equal(r.pistis[0].length, 0, 'çok kartlı yerde pişti olmaz');
  assert.equal(r.lastCapturer, 0);
  assert.equal(r.turn, 1);
  const ev = r.events[r.events.length - 1];
  assert.equal(ev.type, 'play');
  assert.equal(ev.capture, 5);
  assert.equal(ev.pisti, 0);
});

test('değer tutmazsa kart yere eklenir; sıra sıradakine geçer', () => {
  const s = mk(3);
  const r = s.round;
  r.turn = 1;
  r.pile = [card(0, 3)];
  r.hidden = 0;
  r.hands[1] = [card(1, 8), card(1, 9), card(2, 2), card(2, 4)];
  r.hands[2] = [card(0, 10), card(0, 12), card(0, 13), card(3, 13)];
  G.act(s, 1, { type: 'play', card: card(1, 8) });
  assert.deepEqual(r.pile, [card(0, 3), card(1, 8)]);
  assert.equal(r.turn, 2);
  assert.throws(() => G.act(s, 1, { type: 'play', card: card(1, 9) }), /Sıra sende değil/);
  assert.throws(() => G.act(s, 2, { type: 'play', card: card(1, 9) }), /elinde yok/);
});

test('pişti: tek kart varken aynı değer 10, As ile 20, Vale ile 30 puan', () => {
  const cases = [[5, 10], [1, 20], [11, 30], [13, 10]];
  for (const [rank, pts] of cases) {
    const s = mk(2);
    const r = s.round;
    r.turn = 0;
    r.pile = [card(0, rank)];
    r.hidden = 0;
    r.hands[0] = [card(2, rank), card(1, 4), card(1, 6), card(3, 8)];
    G.act(s, 0, { type: 'play', card: card(2, rank) });
    assert.deepEqual(r.pistis[0], [pts], `değer ${rank}`);
    assert.equal(r.captured[0].length, 2);
    const ev = r.events[r.events.length - 1];
    assert.equal(ev.pisti, pts);
  }
});

test('vale her şeyi alır ama tek karta vale atmak pişti sayılmaz', () => {
  const s = mk(2);
  const r = s.round;
  r.turn = 0;
  r.pile = [card(0, 9)];
  r.hidden = 0;
  r.hands[0] = [card(3, 11), card(1, 4), card(1, 6), card(3, 8)];
  G.act(s, 0, { type: 'play', card: card(3, 11) });
  assert.equal(r.captured[0].length, 2);
  assert.equal(r.pistis[0].length, 0);
  // vale ile kalabalık yeri toplamak
  r.turn = 1;
  r.pile = [card(0, 2), card(0, 4), card(1, 1), card(2, 10)];
  r.hands[1] = [card(2, 11), card(0, 5), card(0, 6), card(0, 7)];
  G.act(s, 1, { type: 'play', card: card(2, 11) });
  assert.equal(r.captured[1].length, 5);
  assert.equal(r.pile.length, 0);
});

test('boş yere atılan kart yerde kalır (alma yok)', () => {
  const s = mk(2);
  const r = s.round;
  r.turn = 0;
  r.pile = [];
  r.hidden = 0;
  r.hands[0] = [card(3, 11), card(1, 4), card(1, 6), card(3, 8)];
  G.act(s, 0, { type: 'play', card: card(3, 11) });
  assert.deepEqual(r.pile, [card(3, 11)]);
  assert.equal(r.captured[0].length, 0);
});

test('eller bitince yeniden 4\'er kart dağıtılır', () => {
  const s = mk(2);
  const r = s.round;
  const deckBefore = r.deck.length;
  for (let k = 0; k < 8; k++) {
    const seat = r.turn;
    G.act(s, seat, { type: 'play', card: r.hands[seat][0] });
  }
  assert.equal(r.hands[0].length, 4);
  assert.equal(r.hands[1].length, 4);
  assert.equal(r.deck.length, deckBefore - 8);
  assert.equal(count(r), 52);
  assert.ok(r.events.some((e) => e.type === 'deal' && e.id > 1));
});

test('el sonu: yerde kalanlar son alana gider, son karttaki pişti sayılmaz, puanlar doğru', () => {
  const s = mk(2);
  const r = s.round;
  // Son tur: deste boş, herkesin elinde 1 kart
  r.deck = [];
  r.turn = 0;
  r.hidden = 0;
  r.pile = [card(1, 6)];
  r.captured[0] = [card(0, 1), card(0, 11), P.DIAMOND10, card(1, 2), card(1, 3)]; // 1+1+3 = 5 puan, 5 kart
  r.captured[1] = [P.CLUB2, card(3, 5)]; // 2 puan, 2 kart
  r.pistis[1] = [10];
  r.lastCapturer = 1;
  r.hands[0] = [card(2, 4)];
  r.hands[1] = [card(3, 4)];
  G.act(s, 0, { type: 'play', card: card(2, 4) }); // yere ekler: 6♥ 4♦
  assert.equal(s.phase, 'playing');
  G.act(s, 1, { type: 'play', card: card(3, 4) }); // 4♣ ile alır, ama yerde 2 kart vardı: pişti değil
  assert.equal(s.phase, 'roundEnd');
  const res = r.result;
  assert.equal(res.kind, 'pisti');
  // seat 1: 2 + 3 kart = 5 kart; seat 0: 5 kart → eşit, çoğunluk yok
  assert.equal(res.detail[0].cards, 5);
  assert.equal(res.detail[1].cards, 5);
  assert.equal(res.detail[0].majority + res.detail[1].majority, 0);
  assert.equal(res.total[0], 5);
  assert.equal(res.total[1], 2 + 10);
  assert.equal(s.history.length, 1);
  assert.deepEqual(s.history[0].total, res.total);
});

test('elin en son kartıyla yapılan pişti sayılmaz; yerde kalan son alana gider', () => {
  const s = mk(2);
  const r = s.round;
  r.deck = [];
  r.hidden = 0;
  r.turn = 1;
  r.pile = [card(1, 9)];
  r.lastCapturer = 0;
  r.hands[0] = [];
  r.hands[1] = [card(3, 9)];
  G.act(s, 1, { type: 'play', card: card(3, 9) });
  assert.equal(s.phase, 'roundEnd');
  assert.equal(r.pistis[1].length, 0);
  assert.equal(r.captured[1].length, 2);

  const s2 = mk(2);
  const r2 = s2.round;
  r2.deck = [];
  r2.hidden = 0;
  r2.turn = 1;
  r2.pile = [card(1, 9), card(0, 4)];
  r2.lastCapturer = 0;
  r2.hands[0] = [];
  r2.hands[1] = [card(3, 5)];
  r2.captured = [[], [], [], []];
  G.act(s2, 1, { type: 'play', card: card(3, 5) });
  assert.equal(s2.phase, 'roundEnd');
  assert.equal(r2.captured[0].length, 3, 'yerdeki 3 kart son alan oyuncuya');
  assert.ok(r2.events.some((e) => e.type === 'sweep' && e.seat === 0 && e.count === 3));
});

test('çoğunluk: en çok kartı alan 3 puan alır', () => {
  const s = mk(3);
  const r = s.round;
  r.deck = [];
  r.hidden = 0;
  r.turn = 0;
  r.pile = [];
  r.lastCapturer = 2;
  r.captured = [[card(1, 3), card(1, 4)], [card(1, 5)], [card(1, 6), card(1, 7), card(1, 8)], []];
  r.hands = [[card(2, 3)], [], [], []];
  G.act(s, 0, { type: 'play', card: card(2, 3) });
  assert.equal(s.phase, 'roundEnd');
  const d = r.result.detail;
  assert.equal(d[2].cards, 4); // 3 + yerde kalan 1
  assert.equal(d[2].majority, 3);
  assert.equal(r.result.total[2], 3);
  assert.equal(r.result.total[0], 0);
});

test('eşli oyun: 4 kişi, karşılıklılar eş; çoğunluk takıma bakılır', () => {
  assert.throws(() => mk(3, { mode: 'team' }), /4 kişi/);
  const s = mk(4, { mode: 'team' });
  const r = s.round;
  const v = P.view(s, 0);
  assert.equal(v.team, true);
  r.deck = [];
  r.hidden = 0;
  r.turn = 0;
  r.pile = [];
  r.lastCapturer = 1;
  // Takım A (0+2): 3+3 = 6 kart; Takım B (1+3): 5+0 = 5 kart (+ yerde kalan 1 → 6) → eşit, kimse almaz
  r.captured = [[0, 1, 2], [13, 14, 15, 16, 17], [3, 4, 5], []];
  r.hands = [[card(2, 6)], [], [], []];
  G.act(s, 0, { type: 'play', card: card(2, 6) });
  const d = r.result.detail;
  assert.equal(d.reduce((a, x) => a + x.majority, 0), 0);
  assert.equal(r.result.team, true);

  const s2 = mk(4, { mode: 'team' });
  const r2 = s2.round;
  r2.deck = [];
  r2.hidden = 0;
  r2.turn = 0;
  r2.pile = [];
  r2.lastCapturer = 2;
  r2.captured = [[0, 1, 2], [13, 14, 15, 16, 17], [3, 4, 5], []];
  r2.hands = [[card(2, 6)], [], [], []];
  G.act(s2, 0, { type: 'play', card: card(2, 6) }); // yerde kalan takım A'ya: 7 > 5
  const d2 = r2.result.detail;
  assert.equal(d2[0].majority + d2[2].majority, 3);
  assert.equal(d2[1].majority + d2[3].majority, 0);
});

test('görünüm: başkasının eli ve yerdeki kapalı kartlar görünmez', () => {
  const s = mk(3);
  const r = s.round;
  const v = P.view(s, 0);
  assert.deepEqual(v.hand, r.hands[0]);
  assert.equal(v.pile.length, 1);
  assert.equal(v.hidden, 3);
  assert.equal(v.pileCount, 4);
  assert.deepEqual(v.handCounts, [4, 4, 4, 0]);
  assert.ok(!('hands' in v));
  const spectator = P.view(s, -1);
  assert.deepEqual(spectator.hand, []);
  const full = G.view(s, s.seats[0].token, off);
  assert.ok(!('hands' in full.round) && !('deck' in full.round) && !('captured' in full.round));
  assert.deepEqual(full.round.hand, r.hands[0]);
});

test('süre dolunca sıradakinin yerine kart atılır', () => {
  const s = mk(2);
  const r = s.round;
  r.turn = 0;
  const before = r.hands[0].length;
  assert.equal(G.tick(s, r.deadline - 1000), false);
  assert.equal(G.tick(s, r.deadline + 5000), true);
  assert.equal(r.hands[0].length, before - 1);
  assert.equal(r.turn, 1);
});

test('bot: pişti fırsatını kaçırmaz, değerli yeri valeyle toplar, valeyi boşa atmaz', () => {
  const s = mk(2);
  const r = s.round;
  r.turn = 1;
  r.hidden = 0;
  r.pile = [card(0, 8)];
  r.hands[1] = [card(1, 11), card(2, 8), card(3, 4), card(1, 12)];
  assert.equal(P.chooseCard(s, 1), card(2, 8));
  r.pile = [card(0, 1), P.DIAMOND10, card(1, 5)];
  r.hands[1] = [card(1, 11), card(2, 9), card(3, 4), card(1, 12)];
  assert.equal(P.chooseCard(s, 1), card(1, 11));
  r.pile = [card(1, 5)];
  r.hands[1] = [card(1, 11), card(2, 9), card(3, 4), card(1, 12)];
  assert.notEqual(P.chooseCard(s, 1), card(1, 11));
});

function playOut(n, settings) {
  const s = mk(n, settings);
  for (let i = 0; i < 4; i++) if (s.seats[i]) s.seats[i].bot = true; // herkes bot
  let now = Date.now();
  let hands = 0;
  for (let step = 0; step < 200000 && s.phase !== 'gameEnd'; step++) {
    if (s.phase === 'roundEnd') {
      hands++;
      const r = s.round;
      assert.equal(count(r), 52);
      const sum = r.result.detail.reduce((a, d) => a + d.cardPts, 0);
      assert.equal(sum, 13, 'bir elde toplam kart puanı 13');
      assert.equal(r.result.detail.reduce((a, d) => a + d.cards, 0), 52);
      G.act(s, 0, { type: 'next' });
      continue;
    }
    now += 2000;
    B.step(s, now);
    if (s.phase === 'playing') assert.equal(count(s.round), 52);
  }
  return { s, hands };
}

test('botlarla tam oyun: 2, 3, 4 kişi ve eşli; hedefe ulaşan kazanır', () => {
  for (const [n, st] of [[2, {}], [3, {}], [4, {}], [4, { mode: 'team' }], [2, { pistiTarget: 51 }], [3, { pistiTarget: 151 }]]) {
    const { s, hands } = playOut(n, st);
    assert.equal(s.phase, 'gameEnd', `${n} kişi ${JSON.stringify(st)}`);
    assert.ok(hands >= 1);
    const t = [0, 0, 0, 0];
    s.history.forEach((h) => h.total.forEach((x, i) => (t[i] += x)));
    const target = s.settings.pistiTarget;
    if (st.mode === 'team') assert.ok(Math.max(t[0] + t[2], t[1] + t[3]) >= target);
    else assert.ok(Math.max(...t) >= target);
  }
});
