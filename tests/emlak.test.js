'use strict';
/* İstanbul Emlak: tahta ve fiyatlar, kira, ev kurma kuralları, satın alma, açık artırma, hapis, borç ve iflas, botlarla tam oyun */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../bot.js');
const EM = require('../emlak.js');
const D = require('../public/emlak-data.js');

const off = () => false;
const { BOARD, STREET_POS, OWNABLE } = D;

function mk(n, settings) {
  const s = G.create();
  G.join(s, 'Ahmet', null, off, 0);
  for (let i = 1; i < n; i++) G.lobbyAction(s, 0, { type: 'addBot', seat: i }, off);
  G.lobbyAction(s, 0, { type: 'settings', game: 'emlak', turnSecs: 0, ...(settings || {}) }, off);
  G.lobbyAction(s, 0, { type: 'start' }, off);
  s.round.turn = 0;
  return s;
}
const blank = () => ({
  owner: new Array(40).fill(-1), houses: new Array(40).fill(0), mortgaged: new Array(40).fill(false),
  players: [0, 1, 2, 3].map(() => ({ money: 1500 })), bankHouses: 32, bankHotels: 12,
});

test('tahta: 40 kare, 22 semt, 4 istasyon, 2 idare, 3 şans, 3 kamu fonu, 2 vergi', () => {
  assert.equal(BOARD.length, 40);
  const count = (t) => BOARD.filter((x) => x.type === t).length;
  assert.equal(count('street'), 22);
  assert.equal(count('rail'), 4);
  assert.equal(count('util'), 2);
  assert.equal(count('chance'), 3);
  assert.equal(count('chest'), 3);
  assert.equal(count('tax'), 2);
  assert.equal(OWNABLE.length, 28);
  assert.equal(BOARD[0].type, 'go');
  assert.equal(BOARD[10].type, 'jail');
  assert.equal(BOARD[30].type, 'gotojail');
  assert.equal(D.CHANCE.length, 16);
  assert.equal(D.CHEST.length, 16);
});

test('semt fiyatları m² fiyatıyla orantılı; gruplar tahtada ucuzdan pahalıya; Etiler en pahalı (400 ₺)', () => {
  const max = Math.max(...D.SEMTLER.map((x) => x.m2));
  // Grup içinde ucuzdan pahalıya; grupların en ucuzu ve en pahalısı da tahta boyunca artar
  // (gerçek veriye göre Yeşilköy, sonraki gruptaki Yeniköy'den biraz pahalı: tek tek arsada küçük sıçrama olabilir)
  let prevMin = 0, prevMax = 0;
  D.GROUPS.forEach((g, i) => {
    const prices = D.groupMembers(i).map((p) => BOARD[p].price);
    prices.forEach((x, k) => { if (k) assert.ok(x >= prices[k - 1], `${g.name} grubu içinde sıralı olmalı`); });
    assert.ok(Math.min(...prices) >= prevMin && Math.max(...prices) >= prevMax, `${g.name} bir önceki gruptan ucuz olmamalı`);
    prevMin = Math.min(...prices);
    prevMax = Math.max(...prices);
  });
  STREET_POS.forEach((p) => {
    const sq = BOARD[p];
    assert.ok(Math.abs(sq.price - (400 * sq.m2) / max) <= 5, `${sq.name} fiyatı m² ile orantılı olmalı`);
    assert.equal(sq.mortgage, sq.price / 2);
    for (let h = 1; h < 6; h++) assert.ok(sq.rents[h] > sq.rents[h - 1], `${sq.name} kirası evle artmalı`);
  });
  assert.equal(BOARD[39].name, 'Etiler');
  assert.equal(BOARD[39].price, 400);
  assert.equal(BOARD[1].name, 'Esenyurt');
  // Gruplar tahtada yan yana (aynı kenarda) ve 2-3 arsalı
  D.GROUPS.forEach((g, i) => {
    const m = D.groupMembers(i);
    assert.ok(m.length === 2 || m.length === 3);
    assert.equal(Math.floor(m[0] / 10), Math.floor(m[m.length - 1] / 10));
  });
});

test('kira: boş arsa, grup tamamsa 2 kat, evli, ipotekli 0; istasyon sayıya göre; idare zar × 4 / × 10', () => {
  const r = blank();
  const [a, b] = D.groupMembers(0);
  r.owner[a] = 1;
  assert.equal(D.rentFor(r, a, 7), BOARD[a].rents[0]);
  r.owner[b] = 1;
  assert.equal(D.rentFor(r, a, 7), BOARD[a].rents[0] * 2);
  r.houses[a] = 3;
  assert.equal(D.rentFor(r, a, 7), BOARD[a].rents[3]);
  r.houses[a] = 0;
  r.mortgaged[a] = true;
  assert.equal(D.rentFor(r, a, 7), 0);
  [5, 15, 25, 35].forEach((p, i) => {
    r.owner[p] = 2;
    assert.equal(D.rentFor(r, 5, 7), [25, 50, 100, 200][i]);
  });
  assert.equal(D.rentFor(r, 5, 7, { double: true }), 400);
  r.owner[12] = 3;
  assert.equal(D.rentFor(r, 12, 8), 32);
  r.owner[28] = 3;
  assert.equal(D.rentFor(r, 12, 8), 80);
});

test('ev kurma: grubun hepsi gerekli, evler eşit kurulur ve eşit satılır, ipotek varsa kurulmaz', () => {
  const r = blank();
  const g = D.groupMembers(2); // 3 arsalı grup
  r.owner[g[0]] = 0; r.owner[g[1]] = 0;
  assert.match(D.canBuild(r, 0, g[0]), /bütün arsaları/);
  r.owner[g[2]] = 0;
  assert.equal(D.canBuild(r, 0, g[0]), null);
  r.houses[g[0]] = 1;
  assert.match(D.canBuild(r, 0, g[0]), /eşit/);
  assert.equal(D.canBuild(r, 0, g[1]), null);
  r.houses[g[1]] = 1; r.houses[g[2]] = 1;
  r.houses[g[0]] = 2;
  assert.match(D.canSell(r, 0, g[1]), /eşit/);
  assert.equal(D.canSell(r, 0, g[0]), null);
  assert.match(D.canMortgage(r, 0, g[1]), /binaları sat/);
  r.houses = new Array(40).fill(0);
  r.mortgaged[g[2]] = true;
  assert.match(D.canBuild(r, 0, g[0]), /ipotekli/);
  assert.equal(D.unmortgageCost(g[2]), Math.ceil(BOARD[g[2]].mortgage * 1.1));
});

test('BAŞLA\'dan geçen 200 ₺ alır; sahipsiz arsaya gelen satın alabilir', () => {
  const s = mk(2);
  const r = s.round;
  const p = r.players[0];
  const start = p.money;
  p.pos = 36;
  EM.rollWith(s, 0, [2, 3]);
  assert.equal(p.pos, 1);
  assert.equal(p.money, start + 200);
  assert.equal(r.phase, 'buy');
  G.act(s, 0, { type: 'buy' });
  assert.equal(r.owner[1], 0);
  assert.equal(p.money, start + 200 - BOARD[1].price);
  assert.equal(r.phase, 'done');
  G.act(s, 0, { type: 'end' });
  assert.equal(r.turn, 1);
});

test('almak istemeyen arsa açık artırmaya çıkar: en az 10 ₺, en yüksek teklif alır', () => {
  const s = mk(2);
  const r = s.round;
  r.players[0].pos = 0;
  EM.rollWith(s, 0, [1, 2]); // 3: Beylikdüzü
  assert.equal(r.phase, 'buy');
  G.act(s, 0, { type: 'decline' });
  assert.equal(r.phase, 'auction');
  assert.throws(() => G.act(s, 1, { type: 'bid', amount: 5 }), /en az 10/);
  G.act(s, 1, { type: 'bid', amount: 10 });
  assert.throws(() => G.act(s, 0, { type: 'bid', amount: 10 }), /yüksek/);
  G.act(s, 0, { type: 'bid', amount: 25 });
  G.act(s, 1, { type: 'passBid' });
  assert.equal(r.owner[3], 0);
  assert.equal(r.players[0].money, 1500 - 25);
  assert.equal(r.phase, 'done');
});

test('başkasının arsasına gelen kira öder', () => {
  const s = mk(2);
  const r = s.round;
  r.owner[39] = 1;
  r.owner[37] = 1;
  r.players[0].pos = 35;
  EM.rollWith(s, 0, [1, 3]);
  const rent = BOARD[39].rents[0] * 2;
  assert.equal(r.players[0].money, 1500 - rent);
  assert.equal(r.players[1].money, 1500 + rent);
});

test('üst üste üç çift atan hapse girer; hapiste üç denemede çift gelmezse 50 ₺ ödeyip ilerler', () => {
  const s = mk(2);
  const r = s.round;
  const p = r.players[0];
  OWNABLE.forEach((q) => { r.owner[q] = 0; }); // kendi mülküne gelmek bir şey yapmaz
  p.pos = 10;
  EM.rollWith(s, 0, [1, 1]);
  assert.equal(r.phase, 'roll');
  EM.rollWith(s, 0, [2, 2]);
  assert.equal(r.phase, 'roll');
  EM.rollWith(s, 0, [3, 3]);
  assert.equal(p.pos, 10);
  assert.equal(p.jail, 1);
  assert.equal(r.phase, 'done');
  const m = p.money;
  EM.rollWith(s, 0, [1, 2]);
  assert.equal(p.jail, 2);
  EM.rollWith(s, 0, [1, 2]);
  assert.equal(p.jail, 3);
  EM.rollWith(s, 0, [1, 2]);
  assert.equal(p.jail, 0);
  assert.equal(p.pos, 13);
  assert.equal(p.money, m - 50);
});

test('hapisten çiftle çıkan ilerler ama tekrar zar atmaz', () => {
  const s = mk(2);
  const r = s.round;
  const p = r.players[0];
  OWNABLE.forEach((q) => { r.owner[q] = 0; });
  p.pos = 10; p.jail = 1;
  EM.rollWith(s, 0, [3, 3]);
  assert.equal(p.jail, 0);
  assert.equal(p.pos, 16);
  assert.equal(r.phase, 'done');
});

test('parası yetmeyen ipotekleyip borcunu öder; ödeyemeyen iflas eder ve her şeyi alacaklıya geçer', () => {
  const s = mk(2);
  const r = s.round;
  r.owner[39] = 1; r.owner[37] = 1; r.houses[39] = 1;
  r.owner[5] = 0;
  r.players[0].money = 100;
  r.players[0].pos = 35;
  EM.rollWith(s, 0, [1, 3]);
  assert.equal(r.phase, 'debt');
  assert.throws(() => G.act(s, 0, { type: 'payDebt' }), /bulman gerekiyor/);
  G.act(s, 0, { type: 'mortgage', pos: 5 });
  G.act(s, 0, { type: 'payDebt' });
  assert.equal(r.players[0].money, 0);
  assert.equal(r.players[1].money, 1500 + BOARD[39].rents[1]);
  assert.equal(r.phase, 'done');

  const s2 = mk(2);
  const r2 = s2.round;
  r2.owner[39] = 1; r2.owner[37] = 1; r2.houses[39] = 5; r2.houses[37] = 4;
  r2.owner[1] = 0;
  r2.players[0].pos = 35;
  EM.rollWith(s2, 0, [1, 3]);
  assert.equal(r2.phase, 'debt');
  G.act(s2, 0, { type: 'bankrupt' });
  assert.equal(r2.players[0].bankrupt, true);
  assert.equal(r2.owner[1], 1, 'mülk alacaklıya geçer');
  assert.equal(s2.phase, 'roundEnd');
  assert.equal(r2.result.winner, 1);
});

test('vergi ödenir; otopark ayarı açıksa vergiler kumbarada birikir ve otoparka gelen alır', () => {
  const s = mk(2, { emlakOtopark: true });
  const r = s.round;
  r.players[0].pos = 1;
  EM.rollWith(s, 0, [1, 2]); // 4: Gelir Vergisi
  assert.equal(r.players[0].money, 1500 - 200);
  assert.equal(r.pot, 200);
  r.players[0].pos = 15;
  OWNABLE.forEach((q) => { r.owner[q] = 0; });
  EM.rollWith(s, 0, [2, 3]); // 20: Otopark
  assert.equal(r.players[0].money, 1500);
  assert.equal(r.pot, 0);
  const s2 = mk(2);
  s2.round.players[0].pos = 1;
  EM.rollWith(s2, 0, [1, 2]);
  assert.equal(s2.round.pot, 0, 'ayar kapalıyken kumbara yok');
});

test('takas: kabul edilince mülk ve para el değiştirir', () => {
  const s = mk(2);
  const r = s.round;
  r.owner[1] = 0; r.owner[3] = 1;
  G.act(s, 0, { type: 'offer', to: 1, give: { props: [1], money: 50 }, get: { props: [3] } });
  assert.ok(r.trade);
  G.act(s, 1, { type: 'acceptTrade' });
  assert.equal(r.owner[1], 1);
  assert.equal(r.owner[3], 0);
  assert.equal(r.players[0].money, 1450);
  assert.equal(r.players[1].money, 1550);
});

function playAll(n, settings) {
  const s = mk(n, settings);
  s.seats[0].bot = true;
  let now = Date.now(), steps = 0;
  while (s.phase !== 'gameEnd' && steps < 300000) {
    steps++;
    now += 2500;
    if (s.phase === 'roundEnd') { G.lobbyAction(s, 0, { type: 'next' }, off); continue; }
    B.step(s, now);
    G.tick(s, now);
  }
  return s;
}

test('botlarla tam oyun: tur sınırıyla ve iflasa kadar biter, para eksiye düşmez', () => {
  for (const [n, st] of [[4, { emlakTur: 20 }], [3, { emlakTur: 30, emlakOtopark: true }], [2, { emlakTur: 0 }]]) {
    const s = playAll(n, st);
    assert.equal(s.phase, 'gameEnd', JSON.stringify(st));
    s.round.players.forEach((p) => assert.ok(p.money >= 0));
    const houses = s.round.houses.reduce((a, h) => a + (h === 5 ? 0 : h), 0);
    const hotels = s.round.houses.filter((h) => h === 5).length;
    assert.equal(houses + s.round.bankHouses, 32, 'ev sayısı korunur');
    assert.equal(hotels + s.round.bankHotels, 12, 'otel sayısı korunur');
  }
});
