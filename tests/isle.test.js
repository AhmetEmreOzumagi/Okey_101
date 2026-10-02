'use strict';
/* İşleme düğmesi, işlek taşlar ve masadaki okeyi alma */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');
const G = require('../game.js');

// renk: 0 kırmızı, 1 sarı, 2 mavi, 3 siyah
const T = (c, n, copy = 0) => c * 26 + (n - 1) * 2 + copy;
const FAKE = 104;
const okey = { c: 2, n: 7 }; // mavi 7 okey
const WILD = T(2, 7);
const WILD2 = T(2, 7, 1);
const meld = (ids, id, owner) => Object.assign(E.interpret(ids, okey, 'runs'), { id, owner });

function setup(hands, melds, opts = {}) {
  const s = G.create();
  const off = () => false;
  ['Ali', 'Ayşe', 'Can', 'Deniz'].forEach((n) => G.join(s, n, null, off));
  G.lobbyAction(s, 0, { type: 'start' }, off);
  const r = s.round;
  r.okey = okey;
  r.indicator = T(2, 6);
  const used = new Set([r.indicator]);
  hands.forEach((h) => h.forEach((id) => used.add(id)));
  melds.forEach((m) => m.tiles.forEach((id) => used.add(id)));
  const rest = [...Array(106).keys()].filter((id) => !used.has(id));
  r.hands = hands.map((h) => h.slice());
  r.melds = melds;
  r.meldSeq = 50;
  r.stock = rest.slice(0, 20);
  r.discards = [[], [], [], []];
  r.turn = opts.turn || 0;
  r.tphase = opts.tphase || 'play';
  r.opened = opts.opened || [null, null, null, null];
  return s;
}
function count(s) {
  const r = s.round;
  let n = 1 + r.stock.length;
  r.hands.forEach((h) => (n += h.length));
  r.discards.forEach((d) => (n += d.length));
  r.melds.forEach((m) => (n += m.tiles.length));
  return n;
}

test('masadaki okeyin yerine geçen taş: seri ve grup, çiftte olmaz', () => {
  const run = meld([T(0, 4), WILD, T(0, 6)], 1, 2); // okey = kırmızı 5
  const sw = E.swapOkey(run, T(0, 5, 1), okey);
  assert.ok(sw);
  assert.equal(sw.okeyId, WILD);
  assert.deepEqual(sw.meld.tiles, [T(0, 4), T(0, 5, 1), T(0, 6)]);
  assert.equal(sw.meld.value, run.value);
  assert.equal(E.swapOkey(run, T(1, 5), okey), null); // renk tutmuyor
  assert.equal(E.swapOkey(run, WILD2, okey), null); // okeyle okey alınmaz

  const set = meld([T(0, 9), T(3, 9), WILD], 2, 1); // eksik: sarı ya da mavi 9
  assert.ok(E.swapOkey(set, T(1, 9), okey));
  assert.ok(E.swapOkey(set, T(2, 9), okey));
  assert.equal(E.swapOkey(set, T(0, 9, 1), okey), null); // kırmızı zaten var

  const pair = Object.assign(E.interpret([T(0, 3), WILD], okey, 'pairs'), { id: 3, owner: 0 });
  assert.equal(E.swapOkey(pair, T(0, 3, 1), okey), null);

  // sahte okey, okeyin (mavi 7) yerine geçer
  const blue = meld([T(2, 6), WILD, T(2, 8)], 4, 0);
  assert.ok(E.swapOkey(blue, FAKE, okey));
  assert.ok(E.canSwap(T(0, 5), [set, run], okey));
  assert.equal(E.canSwap(T(0, 8), [set, run], okey), false);
});

test('işle planı: önce okey, sonra zincirleme işleme; bir taş elde kalır', () => {
  const run = meld([T(0, 4), WILD, T(0, 6)], 1, 2);
  // kırmızı 5 okeyi alır; kırmızı 7 ve 8 sırayla işlenir; mavi 1 işlenmez
  let p = E.planIsle([T(1, 1), T(0, 8), T(0, 7), T(0, 5)], [run], okey, [], null);
  assert.deepEqual(p.ops.map((o) => o.type + ':' + o.tile), ['swap:' + T(0, 5), 'add:' + T(0, 7), 'add:' + T(0, 8)]);
  assert.ok(p.hand.includes(WILD));
  assert.ok(p.hand.includes(T(1, 1)));
  // hepsi işlenebiliyorsa sonuncusu elde kalır
  p = E.planIsle([T(0, 7), T(0, 8)], [run], okey, [], null);
  assert.equal(p.ops.length, 1);
  assert.equal(p.hand.length, 1);
  // ıstakada dizili per (keep) işlenmez; okey hiç işlenmez
  p = E.planIsle([T(0, 7), WILD2, T(1, 2)], [run], okey, [T(0, 7)], null);
  assert.equal(p.ops.length, 0);
  // yandan alınan taş (must) dizili perde olsa da işlenir
  p = E.planIsle([T(0, 7), T(1, 2)], [run], okey, [T(0, 7)], T(0, 7));
  assert.equal(p.ops.length, 1);
  assert.ok(p.usedMust);
  p = E.planIsle([T(1, 2), T(1, 3)], [run], okey, [], T(1, 2));
  assert.equal(p.usedMust, false);
});

test('açmış oyuncu masadaki okeyi alır; açmamış alamaz', () => {
  const s = setup([[T(0, 5), T(3, 1), T(3, 2)], [T(1, 1)], [T(1, 2)], [T(1, 3)]], [meld([T(0, 4), WILD, T(0, 6)], 1, 2)]);
  const n = count(s);
  assert.throws(() => G.act(s, 0, { type: 'swap', tile: T(0, 5), meld: 1 }), /açmalısın/);
  s.round.opened[0] = 'runs';
  assert.throws(() => G.act(s, 0, { type: 'swap', tile: T(3, 1), meld: 1 }), /okeyin yerine geçmez/);
  G.act(s, 0, { type: 'swap', tile: T(0, 5), meld: 1 });
  assert.deepEqual(s.round.melds[0].tiles, [T(0, 4), T(0, 5), T(0, 6)]);
  assert.equal(s.round.melds[0].owner, 2);
  assert.ok(s.round.hands[0].includes(WILD));
  assert.equal(s.round.hands[0].length, 3);
  assert.equal(count(s), n);
  assert.match(s.log[s.log.length - 1].text, /okeyi aldı/);
});

test('yandan gelen taşla masadaki okeyi alma', () => {
  // 0 kırmızı 5 atar; 1 (açmış) onu alıp perdeki okeyin yerine koyar, okey eline geçer
  const s = setup([[T(0, 5), T(3, 1)], [T(1, 1), T(1, 2)], [T(1, 3)], [T(1, 4)]], [meld([T(0, 4), WILD, T(0, 6)], 1, 2)], { opened: [null, 'runs', null, null] });
  G.act(s, 0, { type: 'discard', tile: T(0, 5) });
  const n = count(s);
  assert.throws(() => G.act(s, 1, { type: 'swap', side: true, tile: T(1, 1), meld: 1 }), /Yandan/);
  assert.equal(s.round.discards[0].length, 1);
  G.act(s, 1, { type: 'swap', side: true, tile: T(0, 5), meld: 1 });
  assert.equal(s.round.discards[0].length, 0);
  assert.equal(s.round.tphase, 'play');
  assert.ok(s.round.hands[1].includes(WILD));
  assert.equal(s.round.hands[1].length, 3);
  assert.equal(count(s), n);
});

test('İşle: birden çok hamle tek seferde, yandan taş zincirin sonunda olabilir', () => {
  // masada kırmızı 4-okey-6; 1 numarada kırmızı 5 ve 7 var; soldan kırmızı 8 geliyor
  const s = setup([[T(0, 8), T(3, 1)], [T(0, 5), T(0, 7), T(1, 2), T(1, 3)], [T(1, 4)], [T(1, 5)]],
    [meld([T(0, 4), WILD, T(0, 6)], 1, 2)], { opened: [null, 'runs', null, null] });
  G.act(s, 0, { type: 'discard', tile: T(0, 8) });
  const n = count(s);
  const p = E.planIsle(s.round.hands[1].concat([T(0, 8)]), s.round.melds, okey, [], T(0, 8));
  assert.ok(p.usedMust);
  G.act(s, 1, { type: 'batch', side: true, ops: p.ops.map((o) => ({ type: o.type, tile: o.tile, meld: o.meld })) });
  const m = s.round.melds[0];
  assert.equal(m.start, 4);
  assert.equal(m.end, 8);
  assert.ok(!m.tiles.includes(WILD));
  assert.deepEqual(s.round.hands[1].slice().sort((a, b) => a - b), [T(1, 2), T(1, 3), WILD].sort((a, b) => a - b));
  assert.equal(s.round.discards[0].length, 0);
  assert.equal(count(s), n);
  assert.match(s.log.map((l) => l.text).join(' | '), /okeyi aldı, 2 taş işledi/);
});

test('İşle: bir hamle geçersizse hiçbir şey değişmez', () => {
  const s = setup([[T(0, 8), T(3, 1)], [T(0, 5), T(0, 7), T(1, 2)], [T(1, 4)], [T(1, 5)]],
    [meld([T(0, 4), WILD, T(0, 6)], 1, 2)], { opened: [null, 'runs', null, null] });
  G.act(s, 0, { type: 'discard', tile: T(0, 8) });
  const before = JSON.stringify(s.round);
  // yandan taş işlenmiyor
  assert.throws(() => G.act(s, 1, { type: 'batch', side: true, ops: [{ type: 'swap', tile: T(0, 5), meld: 1 }] }), /Yandan/);
  assert.equal(JSON.stringify(s.round), before);
  // ikinci hamle geçersiz (sarı 2 işlenmez)
  s.round.turn = 1; s.round.tphase = 'play';
  const before2 = JSON.stringify(s.round);
  assert.throws(() => G.act(s, 1, { type: 'batch', ops: [{ type: 'add', tile: T(0, 7), meld: 1 }, { type: 'add', tile: T(1, 2), meld: 1 }] }), /işlenemez/);
  assert.equal(JSON.stringify(s.round), before2);
  // son taş elde kalmalı
  s.round.hands[1] = [T(0, 7)];
  assert.throws(() => G.act(s, 1, { type: 'batch', ops: [{ type: 'add', tile: T(0, 7), meld: 1 }] }), /Son taşı/);
  // açmamış oyuncu işleyemez
  s.round.opened[1] = null;
  s.round.hands[1] = [T(0, 7), T(1, 2)];
  assert.throws(() => G.act(s, 1, { type: 'batch', ops: [{ type: 'add', tile: T(0, 7), meld: 1 }] }), /açmalısın/);
});

test('başkalarının taş sayısı ekranda yazmaz', () => {
  const fs = require('fs');
  const app = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(!/handCounts\[seat\]\} taş/.test(app));
});
