'use strict';
/* Masa yönetimi: bağlantısı kopanı/botu masaya oturmadan çıkarma, oyun sürerken yerine geçme,
   yerine bot koyma, lobide uzun süre bağlı olmayanın kendiliğinden kalkması */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');

function table(names, online) {
  const s = G.create();
  const tokens = names.map((n, i) => G.join(s, n, null, () => false, i).token);
  const isOnline = (t) => online.includes(tokens.indexOf(t));
  return { s, tokens, isOnline };
}

test('masa dolu: oturmamış biri bağlantısı kopanı ve botu çıkarıp yer açar, bağlı olanı çıkaramaz', () => {
  const { s, isOnline } = table(['Ali', 'Ayşe', 'Can'], [0]);
  G.lobbyAction(s, 0, { type: 'addBot', seat: 3 }, isOnline);
  // masa dolu: yeni gelen oturamaz, ama ne yapacağı söylenir
  assert.throws(() => G.join(s, 'Deniz', null, isOnline, -1), /çıkar/);
  // oturmamış (seat -1) biri: bağlı olan Ali çıkarılamaz
  assert.throws(() => G.lobbyAction(s, -1, { type: 'kick', seat: 0 }, isOnline), /Bağlı oyuncu/);
  // bağlantısı kopan Ayşe ve bot çıkarılabilir
  G.lobbyAction(s, -1, { type: 'kick', seat: 1 }, isOnline);
  G.lobbyAction(s, -1, { type: 'kick', seat: 3 }, isOnline);
  assert.equal(s.seats[1], null);
  assert.equal(s.seats[3], null);
  assert.throws(() => G.lobbyAction(s, -1, { type: 'kick', seat: 3 }, isOnline), /boş/);
  assert.throws(() => G.lobbyAction(s, -1, { type: 'kick', seat: 9 }, isOnline), /boş/);
  // boşalan yere oturulur
  const d = G.join(s, 'Deniz', null, isOnline, 1);
  assert.equal(d.seat, 1);
  assert.ok(s.log.some((l) => /Ayşe masadan çıkarıldı/.test(l.text)));
});

test('oyun sürerken: bağlantısı kopanın yerine yeni gelen geçer, bağlı olanın yerine geçilemez', () => {
  const { s, isOnline } = table(['Ali', 'Ayşe', 'Can', 'Ece'], [0, 2, 3]);
  G.lobbyAction(s, 0, { type: 'start' }, isOnline);
  const hand = s.round.hands[1].slice();
  assert.throws(() => G.lobbyAction(s, -1, { type: 'kick', seat: 1 }, isOnline), /yerine bot/);
  assert.throws(() => G.join(s, 'Deniz', null, isOnline, 0), /yerine geç/);
  const d = G.join(s, 'Deniz', null, isOnline, 1);
  assert.equal(d.seat, 1);
  assert.equal(s.seats[1].name, 'Deniz');
  assert.deepEqual(s.round.hands[1], hand, 'Ayşe\'nin taşlarıyla devam eder');
  assert.ok(s.log.some((l) => /Deniz, Ayşe yerine oyuna girdi/.test(l.text)));
});

test('yerine bot koy: bağlantısı kopanın yerine bot oturur, kişi dönünce botun yerine geçer', () => {
  const { s, isOnline } = table(['Ali', 'Ayşe', 'Can', 'Ece'], [0, 2, 3]);
  G.lobbyAction(s, 0, { type: 'start' }, isOnline);
  const hand = s.round.hands[1].slice();
  assert.throws(() => G.lobbyAction(s, 0, { type: 'botSeat', seat: 2 }, isOnline), /Bağlı oyuncunun/);
  // masadaki biri de, oturmamış biri de koyabilir
  G.lobbyAction(s, -1, { type: 'botSeat', seat: 1 }, isOnline);
  assert.equal(s.seats[1].bot, true);
  assert.match(s.seats[1].name, /^Bot /);
  assert.deepEqual(s.round.hands[1], hand);
  assert.throws(() => G.lobbyAction(s, 0, { type: 'botSeat', seat: 1 }, isOnline), /zaten bot/);
  // Ayşe geri gelir, botun yerine geçer
  const back = G.join(s, 'Ayşe', null, isOnline, 1);
  assert.equal(back.seat, 1);
  assert.equal(s.seats[1].bot, undefined);
  assert.deepEqual(s.round.hands[1], hand);
});

test('kart oyunlarında da yerine bot koyulur ve bot oynamaya devam eder', () => {
  const B = require('../bot.js');
  for (const game of ['pisti', 'uno']) {
    const { s, isOnline } = table(['Ali', 'Ayşe'], [0]);
    G.lobbyAction(s, 0, { type: 'settings', game }, isOnline);
    G.lobbyAction(s, 0, { type: 'start' }, isOnline);
    G.lobbyAction(s, 0, { type: 'botSeat', seat: 1 }, isOnline);
    s.round.turn = 1;
    const moves = s.round.moveNo;
    let now = Date.now();
    for (let k = 0; k < 4 && s.round.moveNo === moves; k++) { now += 2000; B.step(s, now); }
    assert.ok(s.round.moveNo > moves || s.phase !== 'playing', game + ': bot oynadı');
  }
});

test('lobide uzun süredir bağlı olmayan kendiliğinden kalkar; oyun sürerken kalkmaz', () => {
  const { s, tokens, isOnline } = table(['Ali', 'Ayşe', 'Can'], [0]);
  G.lobbyAction(s, 0, { type: 'addBot', seat: 3 }, isOnline);
  const away = (t) => t === tokens[1];
  assert.equal(G.dropAway(s, away), true);
  assert.equal(s.seats[1], null);
  assert.ok(s.seats[0] && s.seats[2] && s.seats[3].bot, 'diğerleri ve bot yerinde');
  assert.equal(G.dropAway(s, away), false);
  // oyun sürerken kimse kendiliğinden kalkmaz
  G.join(s, 'Deniz', null, isOnline, 1);
  G.lobbyAction(s, 0, { type: 'start' }, isOnline);
  assert.equal(G.dropAway(s, () => true), false);
  assert.ok(s.seats.every(Boolean));
});
