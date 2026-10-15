'use strict';
/* Normal (düz) Okey: 4 oyuncu, 106 taş. Başlayana 15, diğerlerine 14 taş.
   Sırası gelen desteden çeker ya da soldakinin attığı son taşı alır, sonra bir taş atar.
   El, 15. taş atılınca kalan 14 taşın hepsi seri/grup (12-13-1 geçerli, 13-1-2 değil) ya da 7 çift olunca biter.
   Masaya per açılmaz, işlek taş ve okey atma cezası yoktur.
   Puan: herkes başlangıç puanıyla (varsayılan 20) başlar; biri bitirince diğerlerinden düşülür:
   normal 2, okey atarak 4, çiftle 4, çift + okey 8. Gösterge: göstergenin eşi elinde olan, ilk hamlesinde
   gösterirse diğerleri 1 puan kaybeder. Birinin puanı 0'a inince oyun biter, en yüksek puanlı kazanır.
   Eşlide karşılıklı oturanlar eştir; puan takımca tutulur. Deste bitince el puansız biter. */
const E = require('./public/engine.js');
const L = require('./lib.js');
const { fail } = L;

const START_POINTS = [10, 20, 30];
const isTeam = (s) => s.settings.mode === 'team';
const teamOf = (seat) => seat % 2;

function pushEvent(r, ev) {
  ev.id = ++r.evId;
  r.events.push(ev);
  if (r.events.length > 12) r.events.splice(0, r.events.length - 12);
}

// Oyuncuların (eşlide takımların) şu anki puanı: başlangıç + geçmiş ellerdeki değişimler
function pointsOf(s) {
  const start = s.settings.okeynPuan || 20;
  const p = [start, start, start, start];
  s.history.forEach((h) => { if (h.kind === 'okeyn') h.total.forEach((x, i) => (p[i] += x)); });
  return p;
}

function deal(s) {
  const deck = L.shuffle([...Array(E.TILE_COUNT).keys()]);
  const indIdx = deck.findIndex((id) => id < 104); // gösterge sahte okey olamaz
  const indicator = deck.splice(indIdx, 1)[0];
  const okey = E.okeyFromIndicator(indicator);
  const hands = [[], [], [], []];
  for (let k = 0; k < 4; k++) {
    const seat = (s.startSeat + k) % 4;
    hands[seat] = deck.splice(0, k === 0 ? 15 : 14);
  }
  const r = {
    game: 'okeyn',
    id: L.newToken(),
    no: s.history.length + 1,
    indicator,
    okey,
    stock: deck,
    hands,
    discards: [[], [], [], []],
    turn: s.startSeat,
    tphase: 'play', // başlayan 15 taşla çekmeden atar
    turnNo: 0,
    played: [false, false, false, false], // ilk taşını attı mı (gösterge ancak ilk hamlede)
    shown: -1,
    lastDrawn: null,
    lastDiscardSeat: -1,
    moveNo: 0,
    events: [],
    evId: 0,
    deadline: 0,
    result: null,
  };
  s.round = r;
  s.phase = 'playing';
  pushEvent(r, { type: 'deal' });
  L.startClock(s);
  L.addLog(s, `${r.no}. el başladı. ${L.nameOf(s, s.startSeat)} başlıyor.`);
}

function requireTurn(s, seat, tphase) {
  if (s.phase !== 'playing') fail('Şu an oyun oynanmıyor.');
  const r = s.round;
  if (r.turn !== seat) fail('Sıra sende değil.');
  if (tphase && r.tphase !== tphase) fail(tphase === 'draw' ? 'Bu turda zaten taş aldın.' : 'Önce taş çekmelisin.');
  return r;
}

// Göstergenin eşi (aynı renk ve sayıdaki diğer taş)
const twinOf = (ind) => (ind % 2 === 0 ? ind + 1 : ind - 1);
function canShow(s, seat) {
  const r = s.round;
  if (!s.settings.okeynGosterge || r.shown >= 0 || r.played[seat] || r.turn !== seat) return false;
  if (r.tphase === 'play' && r.turnNo > 0) return false; // ilk taşını çektikten sonra gösterilmez
  return r.hands[seat].includes(twinOf(r.indicator));
}

function draw(s, seat) {
  const r = requireTurn(s, seat, 'draw');
  if (!r.stock.length) fail('Deste bitti.');
  const id = r.stock.pop();
  r.hands[seat].push(id);
  r.lastDrawn = id;
  r.tphase = 'play';
  r.moveNo++;
  pushEvent(r, { type: 'draw', seat });
}

function take(s, seat) {
  const r = requireTurn(s, seat, 'draw');
  const left = (seat + 3) % 4;
  const pile = r.discards[left];
  if (!pile.length || r.lastDiscardSeat !== left) fail('Yandan alınacak taş yok.');
  const id = pile.pop();
  r.hands[seat].push(id);
  r.lastDrawn = id;
  r.tphase = 'play';
  r.moveNo++;
  pushEvent(r, { type: 'take', seat, tile: id });
}

function discard(s, seat, id) {
  const r = requireTurn(s, seat, 'play');
  const hand = r.hands[seat];
  if (!hand.includes(id)) fail('Bu taş elinde yok.');
  if (hand.length !== 15) fail('Atmak için elinde 15 taş olmalı.');
  r.hands[seat] = hand.filter((x) => x !== id);
  r.discards[seat].push(id);
  r.lastDiscardSeat = seat;
  r.played[seat] = true;
  r.turn = (seat + 1) % 4;
  r.tphase = 'draw';
  r.turnNo++;
  r.lastDrawn = null;
  r.moveNo++;
  pushEvent(r, { type: 'discard', seat, tile: id });
  L.startClock(s);
}

// Bitirme: son taşı (15.) atıp kalan 14 taşı açar
function finish(s, seat, id) {
  const r = requireTurn(s, seat, 'play');
  const hand = r.hands[seat];
  if (!hand.includes(id)) fail('Bu taş elinde yok.');
  if (hand.length !== 15) fail('Bitirmek için elinde 15 taş olmalı.');
  const rest = hand.filter((x) => x !== id);
  const f = E.finishN(rest, r.okey);
  if (!f) fail('Elin bitmiyor: kalan 14 taşın hepsi seri/grup ya da 7 çift olmalı.');
  const lastOkey = E.isWild(id, r.okey);
  const mult = (f.kind === 'pairs' ? 2 : 1) * (lastOkey ? 2 : 1);
  const loss = 2 * mult;
  r.hands[seat] = rest;
  r.discards[seat].push(id);
  r.lastDiscardSeat = seat;
  const groups = f.kind === 'pairs' ? pairGroups(rest, r.okey) : f.groups;
  let note = `${L.nameOf(s, seat)} bitirdi`;
  if (f.kind === 'pairs') note += ' (çiftten)';
  if (lastOkey) note += ', okey atarak';
  note += `! Diğerleri ${loss} puan kaybetti.`;
  if (isTeam(s)) note = note.replace('Diğerleri', 'Rakip takım');
  closeRound(s, { kind: 'win', winner: seat, pairs: f.kind === 'pairs', lastOkey, loss, groups, note });
}

function pairGroups(ids, okey) {
  const p = E.suggestPairs(ids, okey);
  const groups = p.pairs.map((g) => g.slice());
  const rest = p.rest.slice();
  p.wild.forEach((w) => { if (rest.length) groups.push([rest.shift(), w]); else rest.push(w); });
  for (let i = 0; i + 1 < rest.length; i += 2) groups.push([rest[i], rest[i + 1]]);
  return groups;
}

function closeRound(s, res) {
  const r = s.round;
  const total = [0, 0, 0, 0];
  if (res.kind === 'win') {
    for (let i = 0; i < 4; i++) {
      if (i === res.winner) continue;
      if (isTeam(s) && teamOf(i) === teamOf(res.winner)) continue;
      total[i] -= res.loss;
    }
  }
  // Gösterge (el bitince de geçerli)
  if (r.shown >= 0) {
    for (let i = 0; i < 4; i++) {
      if (i === r.shown) continue;
      if (isTeam(s) && teamOf(i) === teamOf(r.shown)) continue;
      total[i] -= 1;
    }
  }
  r.deadline = 0;
  s.history.push({ no: r.no, kind: 'okeyn', winner: res.winner, total, counted: true, note: res.note });
  const pts = pointsOf(s);
  const gameOver = pts.some((x) => x <= 0);
  r.result = Object.assign({}, res, { total, points: pts, gameOver, hands: r.hands.map((h) => h.slice()), shown: r.shown });
  s.phase = 'roundEnd';
  s.startSeat = (s.startSeat + 1) % 4;
  pushEvent(r, { type: 'end', winner: res.winner });
  L.addLog(s, res.note);
}

function show(s, seat) {
  const r = s.round;
  if (!canShow(s, seat)) fail('Göstergeyi şimdi gösteremezsin (sadece ilk hamlende, eşi elindeyse).');
  r.shown = seat;
  r.moveNo++;
  pushEvent(r, { type: 'show', seat, tile: twinOf(r.indicator) });
  L.addLog(s, `${L.nameOf(s, seat)} göstergeyi gösterdi: ${isTeam(s) ? 'rakip takım' : 'diğerleri'} 1 puan kaybedecek.`);
}

function endStock(s, seat) {
  const r = requireTurn(s, seat, 'draw');
  if (r.stock.length) fail('Destede hâlâ taş var.');
  closeRound(s, { kind: 'stock', winner: -1, note: 'Deste bitti, el puansız bitti.' });
}

function next(s) {
  if (s.phase !== 'roundEnd') fail('El henüz bitmedi.');
  if (s.round.result && s.round.result.gameOver) {
    s.phase = 'gameEnd';
    L.addLog(s, 'Oyun bitti!');
  } else deal(s);
}

function act(s, seat, a) {
  if (seat < 0) fail('Masada değilsin.');
  if (a.type === 'next') return next(s);
  if (s.phase !== 'playing') fail('Şu an oyun oynanmıyor.');
  switch (a.type) {
    case 'draw': return draw(s, seat);
    case 'take': return take(s, seat);
    case 'discard': return discard(s, seat, a.tile);
    case 'finish': return finish(s, seat, a.tile);
    case 'show': return show(s, seat);
    case 'endStock': return endStock(s, seat);
    default: fail('Bilinmeyen hamle.');
  }
}

// ---------- Bot ----------
// Elin değeri: perlerdeki taş sayısı (asıl ölçü) + çift ihtimali + yan yana taşlar (geleceğe yatırım)
function handScore(ids, okey) {
  const cov = E.solveN(ids, okey);
  const pr = E.pairsN(ids, okey);
  let pot = 0;
  const rest = cov.rest.filter((id) => !E.isWild(id, okey));
  rest.forEach((id) => {
    const a = E.natural(id, okey);
    let best = 0;
    ids.forEach((o) => {
      if (o === id) return;
      const b = E.natural(o, okey);
      if (!b) return;
      if (b.c === a.c && (Math.abs(b.n - a.n) === 1 || (a.n === 1 && b.n === 13) || (a.n === 13 && b.n === 1))) best = Math.max(best, 2);
      else if (b.c === a.c && Math.abs(b.n - a.n) === 2) best = Math.max(best, 1);
      else if (b.n === a.n && b.c !== a.c) best = Math.max(best, 1.6);
    });
    pot += best;
  });
  const wild = ids.filter((id) => E.isWild(id, okey)).length;
  return cov.cov * 10 + pot + wild * 6 + Math.max(0, pr.pairs - 4) * 4;
}

function bestDiscard(hand, okey) {
  let best = null, bestSc = -Infinity;
  const seen = new Set();
  hand.forEach((id) => {
    const nt = E.natural(id, okey);
    const key = nt ? nt.c * 100 + nt.n : 'w';
    if (seen.has(key)) return;
    seen.add(key);
    let sc = handScore(hand.filter((x) => x !== id), okey);
    if (E.isWild(id, okey)) sc -= 25; // okeyi atma
    if (sc > bestSc) { bestSc = sc; best = id; }
  });
  return { id: best, score: bestSc };
}

function finishingTile(hand, okey) {
  // Okeyle bitirmek iki kat puan: önce okeyi atmayı dene
  const wild = hand.filter((id) => E.isWild(id, okey));
  for (const w of wild) if (E.finishN(hand.filter((x) => x !== w), okey)) return w;
  for (const id of hand) if (!E.isWild(id, okey) && E.finishN(hand.filter((x) => x !== id), okey)) return id;
  return null;
}

function botAct(s, seat) {
  const r = s.round;
  if (r.turn !== seat) return;
  if (canShow(s, seat)) return show(s, seat);
  const hand = r.hands[seat];
  if (r.tphase === 'draw') {
    const left = (seat + 3) % 4;
    const pile = r.discards[left];
    const side = pile.length && r.lastDiscardSeat === left ? pile[pile.length - 1] : null;
    if (side !== null) {
      const withSide = hand.concat([side]);
      if (finishingTile(withSide, r.okey) !== null) return take(s, seat);
      const now = handScore(hand, r.okey);
      const bd = bestDiscard(withSide, r.okey);
      if (bd.id !== side && bd.score >= now + 8) return take(s, seat);
      if (!r.stock.length) return take(s, seat);
    }
    if (!r.stock.length) return endStock(s, seat);
    return draw(s, seat);
  }
  const fin = finishingTile(hand, r.okey);
  if (fin !== null) return finish(s, seat, fin);
  return discard(s, seat, bestDiscard(hand, r.okey).id);
}

function botFallback(s, seat) {
  const r = s.round;
  if (r.tphase === 'draw') return r.stock.length ? draw(s, seat) : endStock(s, seat);
  const id = r.hands[seat].find((x) => !E.isWild(x, r.okey));
  return discard(s, seat, id !== undefined ? id : r.hands[seat][0]);
}

// Süre dolarsa: çek ve at (bot gibi)
function tick(s, now) {
  const r = s.round;
  if (s.phase !== 'playing' || !r || !r.deadline) return false;
  if (now < r.deadline + 1200) return false;
  const seat = r.turn;
  L.addLog(s, `${L.nameOf(s, seat)} süresini doldurdu, otomatik oynandı.`);
  try {
    if (r.tphase === 'draw') {
      if (!r.stock.length) { endStock(s, seat); return true; }
      draw(s, seat);
    }
    const fin = finishingTile(r.hands[seat], r.okey);
    if (fin !== null) finish(s, seat, fin);
    else discard(s, seat, bestDiscard(r.hands[seat], r.okey).id);
  } catch (e) {
    try { botFallback(s, seat); } catch (e2) {}
  }
  return true;
}

function view(s, me) {
  const r = s.round;
  const left = me >= 0 ? (me + 3) % 4 : -1;
  const canTake = me >= 0 && s.phase === 'playing' && r.turn === me && r.tphase === 'draw' &&
    r.discards[left].length > 0 && r.lastDiscardSeat === left;
  const pts = pointsOf(s);
  return {
    game: 'okeyn',
    id: r.id,
    no: r.no,
    indicator: r.indicator,
    okey: r.okey,
    stockCount: r.stock.length,
    hand: me >= 0 ? r.hands[me].slice() : [],
    handCounts: r.hands.map((h) => h.length),
    discards: r.discards.map((d) => ({ top: d.length ? d[d.length - 1] : null, count: d.length })),
    turn: r.turn,
    tphase: r.tphase,
    turnNo: r.turnNo,
    lastDrawn: me === r.turn ? r.lastDrawn : null,
    sideTile: canTake ? r.discards[left][r.discards[left].length - 1] : null,
    canTake,
    canShow: me >= 0 && s.phase === 'playing' && canShow(s, me),
    shown: r.shown,
    gosterge: !!s.settings.okeynGosterge,
    points: pts,
    start: s.settings.okeynPuan || 20,
    team: isTeam(s),
    events: r.events,
    evId: r.evId,
    moveNo: r.moveNo,
    remainingMs: r.deadline ? Math.max(0, r.deadline - Date.now()) : null,
    result: r.result,
    // 101 ekranıyla uyum için boş alanlar
    melds: [],
    opened: [null, null, null, null],
    openValue: [0, 0, 0, 0],
    penalties: [0, 0, 0, 0],
  };
}

module.exports = { deal, act, view, tick, botAct, botFallback, START_POINTS, pointsOf, handScore, finishingTile, twinOf };
