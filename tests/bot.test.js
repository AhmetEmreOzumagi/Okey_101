'use strict';
/* Botlar: koltuğa oturtma, oyunu bitirebilme, oyun sürerken botun yerine geçme */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../bot.js');

const off = () => false;

function countTiles(s) {
  const r = s.round;
  let n = 1 + r.stock.length;
  r.hands.forEach((h) => (n += h.length));
  r.discards.forEach((d) => (n += d.length));
  r.melds.forEach((m) => (n += m.tiles.length));
  return n;
}

test('boş koltuklara bot oturur; en az bir insan gerekir', () => {
  const s = G.create();
  const me = G.join(s, 'Ahmet', null, off, 0);
  assert.throws(() => G.lobbyAction(s, 0, { type: 'start' }, off), /bot/);
  G.lobbyAction(s, 0, { type: 'addBot', seat: 2 }, off);
  assert.equal(s.seats[2].bot, true);
  assert.match(s.seats[2].name, /^Bot /);
  G.lobbyAction(s, 0, { type: 'fillBots' }, off);
  assert.ok(s.seats.every(Boolean));
  assert.equal(new Set(s.seats.map((p) => p.name)).size, 4);
  // botun adıyla kimse giremez, bot "bağlı" görünür
  assert.throws(() => G.join(s, s.seats[1].name, null, off, -1), /zaten var/);
  const v = G.view(s, me.token, off);
  assert.equal(v.seats[1].bot, true);
  assert.equal(v.seats[1].online, true);
  // bot çıkarılabilir (bağlı görünse de)
  G.lobbyAction(s, 0, { type: 'kick', seat: 1 }, off);
  assert.equal(s.seats[1], null);
  // sadece botlarla başlanmaz
  const s2 = G.create();
  G.join(s2, 'Ali', null, off, 0);
  G.lobbyAction(s2, 0, { type: 'fillBots' }, off);
  s2.seats[0] = { name: 'Bot X', token: 'x', bot: true };
  assert.throws(() => G.lobbyAction(s2, 0, { type: 'start' }, off), /en az bir kişi/);
});

test('oyun sürerken gelen biri botun yerine geçer, eli aynen kalır', () => {
  const s = G.create();
  G.join(s, 'Ahmet', null, off, 0);
  G.lobbyAction(s, 0, { type: 'fillBots' }, off);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  assert.throws(() => G.lobbyAction(s, 0, { type: 'addBot', seat: 1 }, off), /başlamadan/);
  assert.throws(() => G.join(s, 'Mehmet', null, off, -1), /botun sandalyesine/);
  const hand = s.round.hands[3].slice();
  const j = G.join(s, 'Mehmet', null, off, 3);
  assert.equal(j.seat, 3);
  assert.equal(s.seats[3].name, 'Mehmet');
  assert.ok(!s.seats[3].bot);
  assert.deepEqual(s.round.hands[3], hand);
  assert.match(s.log[s.log.length - 1].text, /yerine oyuna girdi/);
});

// Bir insan + üç bot: insan basitçe çekip atar, botlar kendi oynar
function playGame(settings) {
  const s = G.create();
  G.join(s, 'İnsan', null, off, 0);
  Object.assign(s.settings, settings);
  G.lobbyAction(s, 0, { type: 'fillBots' }, off);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  let now = Date.now();
  const stats = { botTurns: 0, opens: 0, rounds: 0 };
  let guard = 0;
  while (s.phase !== 'gameEnd') {
    if (++guard > 20000) throw new Error('Oyun bitmedi');
    if (s.phase === 'roundEnd') {
      stats.rounds++;
      G.act(s, 0, { type: 'next' });
      continue;
    }
    const before = countTiles(s);
    const r = s.round;
    if (r.turn === 0) {
      if (r.tphase === 'draw') G.act(s, 0, r.stock.length ? { type: 'draw' } : { type: 'endStock' });
      else G.act(s, 0, { type: 'discard', tile: B.chooseDiscard(s, 0) });
    } else {
      const opened = r.opened.filter(Boolean).length;
      now += 2500;
      if (B.step(s, now)) stats.botTurns++;
      if (s.round && s.round.opened.filter(Boolean).length > opened) stats.opens++;
    }
    if (s.phase === 'playing') assert.equal(countTiles(s), before, 'taş sayısı değişti');
  }
  return stats;
}

test('botlarla oyun sonuna kadar oynanır (eşli, eşsiz, katlamalı)', () => {
  let opens = 0, rounds = 0;
  for (let i = 0; i < 12; i++) {
    const st = playGame({ rounds: 3, mode: i % 2 ? 'team' : 'solo', katlamali: i % 3 === 0, turnSecs: 0 });
    opens += st.opens;
    rounds += st.rounds;
    assert.ok(st.botTurns > 0);
  }
  assert.equal(rounds, 36);
  assert.ok(opens > 10, 'botlar neredeyse hiç açmadı: ' + opens);
});

test('bot atarken okey ve işlek taş atmaz (elinde başka taş varsa)', () => {
  const E = require('../public/engine.js');
  for (let i = 0; i < 40; i++) {
    const s = G.create();
    G.join(s, 'İnsan', null, off, 0);
    G.lobbyAction(s, 0, { type: 'fillBots' }, off);
    G.lobbyAction(s, 0, { type: 'start' }, off);
    const r = s.round;
    for (let seat = 0; seat < 4; seat++) {
      const id = B.chooseDiscard(s, seat);
      assert.ok(r.hands[seat].includes(id));
      if (r.hands[seat].some((x) => !E.isWild(x, r.okey))) assert.ok(!E.isWild(id, r.okey));
    }
  }
});
