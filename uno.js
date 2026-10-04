'use strict';
/* Uno: 108 kart, 2-4 oyuncu.
   Kartlar 0..99 renkli: renk = floor(id/25) (0 kırmızı, 1 sarı, 2 yeşil, 3 mavi), k = id%25:
     k=0 → 0, k=1..18 → 1..9 (ikişer), 19-20 → engel, 21-22 → yön değiştir, 23-24 → +2
   100..103 → renk seç, 104..107 → +4 renk seç */
const L = require('./lib.js');
const { fail } = L;

const COLOR_NAMES = ['kırmızı', 'sarı', 'yeşil', 'mavi'];
const TARGETS = [100, 200, 300, 500];

function info(id) {
  if (id >= 104) return { id, c: -1, t: 'wild4' };
  if (id >= 100) return { id, c: -1, t: 'wild' };
  const c = Math.floor(id / 25), k = id % 25;
  if (k === 0) return { id, c, t: 'num', n: 0 };
  if (k <= 18) return { id, c, t: 'num', n: ((k - 1) >> 1) + 1 };
  if (k <= 20) return { id, c, t: 'skip' };
  if (k <= 22) return { id, c, t: 'rev' };
  return { id, c, t: 'draw2' };
}
function value(id) {
  const x = info(id);
  if (x.t === 'num') return x.n;
  if (x.t === 'wild' || x.t === 'wild4') return 50;
  return 20;
}

const top = (r) => r.discard[r.discard.length - 1];
const activeCount = (r) => r.active.filter(Boolean).length;
const nextOf = (r, seat) => L.nextSeat(r.active, seat, r.dir);

function canPlay(r, id, st) {
  const x = info(id), t = info(top(r));
  if (r.pending > 0) {
    // +2/+4 gelirken: biriktirme açıksa +2 üstüne +2/+4, +4 üstüne +4 atılabilir
    if (!st.unoStack) return false;
    if (t.t === 'draw2') return x.t === 'draw2' || x.t === 'wild4';
    if (t.t === 'wild4') return x.t === 'wild4';
    return false;
  }
  if (x.c === -1) return true;
  if (x.c === r.color) return true;
  if (x.t === 'num') return t.t === 'num' && x.n === t.n;
  return x.t === t.t;
}

function pushEvent(r, ev) {
  ev.id = ++r.evId;
  r.events.push(ev);
  if (r.events.length > 14) r.events.splice(0, r.events.length - 14);
}

// Desteden kart çeker; deste biterse yerdekiler (üstteki hariç) karıştırılıp deste olur
function drawCards(r, seat, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!r.deck.length) {
      const keep = r.discard.pop();
      r.deck = L.shuffle(r.discard);
      r.discard = [keep];
      if (r.deck.length) pushEvent(r, { type: 'reshuffle' });
    }
    if (!r.deck.length) break;
    const id = r.deck.pop();
    r.hands[seat].push(id);
    got.push(id);
  }
  if (got.length) {
    r.uno[seat] = false;
    if (r.vulnerable === seat) r.vulnerable = -1;
  }
  return got;
}

function deal(s) {
  const active = s.seats.map(Boolean);
  if (!active[s.startSeat]) s.startSeat = L.nextSeat(active, s.startSeat, 1);
  const deck = L.shuffle([...Array(108).keys()]);
  const hands = [[], [], [], []];
  for (let seat = 0; seat < 4; seat++) if (active[seat]) hands[seat] = deck.splice(0, 7);
  // İlk açılan kart renkli olsun (joker gelirse desteye geri karışır)
  let first = deck.pop();
  while (info(first).c === -1) {
    deck.splice(L.randomInt(deck.length), 0, first);
    first = deck.pop();
  }
  const r = {
    game: 'uno',
    id: L.newToken(),
    no: s.history.length + 1,
    active,
    deck,
    discard: [first],
    color: info(first).c,
    hands,
    turn: s.startSeat,
    dir: 1,
    pending: 0,
    drew: false,
    drawn: null,
    uno: [false, false, false, false],
    vulnerable: -1,
    catchAt: 0,
    moveNo: 0,
    events: [],
    evId: 0,
    deadline: 0,
    result: null,
  };
  s.round = r;
  s.phase = 'playing';
  pushEvent(r, { type: 'deal' });
  // İlk kartın etkisi ilk oyuncuya uygulanır
  const f = info(first);
  if (f.t === 'skip' || (f.t === 'rev' && activeCount(r) === 2)) {
    pushEvent(r, { type: 'skip', seat: r.turn });
    r.turn = nextOf(r, r.turn);
  } else if (f.t === 'rev') {
    r.dir = -1;
    pushEvent(r, { type: 'reverse', dir: -1 });
  } else if (f.t === 'draw2') {
    drawCards(r, r.turn, 2);
    pushEvent(r, { type: 'draw', seat: r.turn, count: 2, forced: true });
    r.turn = nextOf(r, r.turn);
  }
  L.startClock(s);
  L.addLog(s, `${r.no}. el başladı. ${L.nameOf(s, r.turn)} başlıyor.`);
}

function play(s, seat, id, color) {
  const r = s.round;
  if (r.turn !== seat) fail('Sıra sende değil.');
  if (!r.hands[seat].includes(id)) fail('Bu kart elinde yok.');
  if (r.drew && id !== r.drawn) fail('Çektiğin kartı oynayabilir ya da pas geçebilirsin.');
  if (!canPlay(r, id, s.settings)) {
    fail(r.pending ? `+${r.pending} geldi: ${s.settings.unoStack ? 'sadece +2/+4 ile karşılık verebilir ya da' : ''} kart çekmelisin.` : 'Bu kart oynanmaz: rengi, sayısı ya da işareti tutmuyor.');
  }
  const x = info(id);
  let c = x.c;
  if (c === -1) {
    c = color;
    if (!(Number.isInteger(c) && c >= 0 && c < 4)) fail('Bir renk seç.');
  }
  if (r.vulnerable !== seat) r.vulnerable = -1; // önceki oyuncuyu yakalama fırsatı geçti
  r.hands[seat] = r.hands[seat].filter((k) => k !== id);
  r.discard.push(id);
  r.color = c;
  r.drew = false;
  r.drawn = null;
  const left = r.hands[seat].length;
  pushEvent(r, { type: 'play', seat, card: id, color: c });
  r.moveNo++;
  if (left === 1 && !r.uno[seat]) {
    // UNO demedi: yakalanırsa 2 kart çeker
    r.vulnerable = seat;
    const bots = [0, 1, 2, 3].filter((i) => i !== seat && r.active[i] && s.seats[i] && s.seats[i].bot);
    r.catchAt = bots.length && Math.random() < 0.7 ? Date.now() + 1400 + L.randomInt(2200) : 0;
  }
  if (left !== 1) r.uno[seat] = false;

  let nxt = nextOf(r, seat);
  if (x.t === 'rev') {
    if (activeCount(r) === 2) {
      pushEvent(r, { type: 'skip', seat: nxt });
      nxt = seat;
    } else {
      r.dir = -r.dir;
      pushEvent(r, { type: 'reverse', dir: r.dir });
      nxt = nextOf(r, seat);
    }
  } else if (x.t === 'skip') {
    pushEvent(r, { type: 'skip', seat: nxt });
    nxt = nextOf(r, nxt);
  } else if (x.t === 'draw2' || x.t === 'wild4') {
    const n = x.t === 'draw2' ? 2 : 4;
    if (s.settings.unoStack && left > 0) {
      r.pending += n; // sıradaki karşılık verebilir ya da toplamı çeker
    } else {
      const total = r.pending + n;
      r.pending = 0;
      drawCards(r, nxt, total);
      pushEvent(r, { type: 'draw', seat: nxt, count: total, forced: true });
      L.addLog(s, `${L.nameOf(s, nxt)} ${total} kart çekti.`);
      nxt = nextOf(r, nxt);
    }
  }
  if (x.c === -1) L.addLog(s, `${L.nameOf(s, seat)} rengi ${COLOR_NAMES[c]} yaptı.`);
  if (left === 0) {
    endHand(s, seat);
    return;
  }
  r.turn = nxt;
  L.startClock(s);
}

function draw(s, seat) {
  const r = s.round;
  if (r.turn !== seat) fail('Sıra sende değil.');
  if (r.vulnerable !== seat) r.vulnerable = -1;
  if (r.pending > 0) {
    const n = r.pending;
    r.pending = 0;
    drawCards(r, seat, n);
    pushEvent(r, { type: 'draw', seat, count: n, forced: true });
    L.addLog(s, `${L.nameOf(s, seat)} ${n} kart çekti.`);
    r.moveNo++;
    r.turn = nextOf(r, seat);
    L.startClock(s);
    return;
  }
  if (r.drew) fail('Zaten bir kart çektin. Onu oynayabilir ya da pas geçebilirsin.');
  const got = drawCards(r, seat, 1);
  pushEvent(r, { type: 'draw', seat, count: got.length });
  r.moveNo++;
  if (got.length && canPlay(r, got[0], s.settings)) {
    // Çekilen kart oynanabiliyorsa oyuncu oynayabilir ya da pas geçer
    r.drew = true;
    r.drawn = got[0];
    return;
  }
  r.turn = nextOf(r, seat);
  L.startClock(s);
}

function pass(s, seat) {
  const r = s.round;
  if (r.turn !== seat) fail('Sıra sende değil.');
  if (!r.drew) fail('Önce kart çekmelisin.');
  r.drew = false;
  r.drawn = null;
  pushEvent(r, { type: 'pass', seat });
  r.moveNo++;
  r.turn = nextOf(r, seat);
  L.startClock(s);
}

function callUno(s, seat) {
  const r = s.round;
  if (r.hands[seat].length > 2) fail('UNO, elinde 2 ya da 1 kart kalınca denir.');
  if (r.uno[seat]) return;
  r.uno[seat] = true;
  if (r.vulnerable === seat) r.vulnerable = -1;
  pushEvent(r, { type: 'uno', seat });
  L.addLog(s, `${L.nameOf(s, seat)}: UNO!`);
}

function catchUno(s, seat) {
  const r = s.round;
  const v = r.vulnerable;
  if (v < 0 || v === seat) fail('Yakalanacak kimse yok.');
  r.vulnerable = -1;
  r.catchAt = 0;
  drawCards(r, v, 2);
  pushEvent(r, { type: 'caught', seat: v, by: seat, count: 2 });
  L.addLog(s, `${L.nameOf(s, seat)} yakaladı! ${L.nameOf(s, v)} UNO demedi, 2 kart çekti.`);
}

function totals(s) {
  const t = [0, 0, 0, 0];
  s.history.forEach((h) => h.total.forEach((x, i) => (t[i] += x)));
  return t;
}

function endHand(s, winner) {
  const r = s.round;
  const points = r.hands.reduce((a, h, i) => (i === winner ? a : a + h.reduce((b, id) => b + value(id), 0)), 0);
  const total = [0, 0, 0, 0];
  total[winner] = points;
  const note = `${L.nameOf(s, winner)} elini bitirdi! +${points}`;
  s.history.push({ no: r.no, kind: 'uno', winner, total, counted: true, note });
  const sums = totals(s);
  const target = s.settings.unoTarget || 200;
  r.result = { kind: 'uno', winner, points, total, hands: r.hands.map((h) => h.slice()), gameOver: sums[winner] >= target, note };
  r.deadline = 0;
  r.vulnerable = -1;
  s.phase = 'roundEnd';
  s.startSeat = L.nextSeat(r.active, s.startSeat, 1);
  L.addLog(s, note);
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
    case 'play': return play(s, seat, a.card, a.color);
    case 'draw': return draw(s, seat);
    case 'pass': return pass(s, seat);
    case 'uno': return callUno(s, seat);
    case 'catch': return catchUno(s, seat);
    default: fail('Bilinmeyen hamle.');
  }
}

// ---------- Bot ----------
function bestColor(hand, except) {
  const n = [0, 0, 0, 0];
  hand.forEach((id) => { if (id !== except && info(id).c >= 0) n[info(id).c] += 1 + value(id) / 50; });
  const max = Math.max(...n);
  if (max === 0) return L.randomInt(4);
  return n.indexOf(max);
}

function botAct(s, seat) {
  const r = s.round;
  const st = s.settings;
  const hand = r.hands[seat];
  const playable = hand.filter((id) => canPlay(r, id, st) && (!r.drew || id === r.drawn));
  if (r.pending > 0 && !playable.length) return draw(s, seat);
  if (r.drew && !playable.length) return pass(s, seat);
  if (!playable.length) return draw(s, seat);
  if (hand.length === 2 && !r.uno[seat] && Math.random() < 0.85) callUno(s, seat);
  const nxt = nextOf(r, seat);
  const nextCount = r.hands[nxt].length;
  const mostColor = bestColor(hand, -1);
  const score = (id) => {
    const x = info(id);
    let sc;
    if (x.t === 'num') sc = x.n;
    else if (x.t === 'wild') sc = -25;
    else if (x.t === 'wild4') sc = nextCount <= 2 ? 40 : -35;
    else sc = 12 + (nextCount <= 2 ? 30 : 0);
    if (x.c === mostColor) sc += 4;
    return sc;
  };
  const id = playable.slice().sort((a, b) => score(b) - score(a))[0];
  return play(s, seat, id, info(id).c === -1 ? bestColor(hand, id) : undefined);
}

// Süre dolması ve botların UNO yakalaması
function tick(s, now) {
  const r = s.round;
  if (s.phase !== 'playing' || !r) return false;
  if (r.vulnerable >= 0 && r.catchAt && now >= r.catchAt) {
    const bots = [0, 1, 2, 3].filter((i) => i !== r.vulnerable && r.active[i] && s.seats[i] && s.seats[i].bot);
    r.catchAt = 0;
    if (bots.length) {
      catchUno(s, bots[L.randomInt(bots.length)]);
      return true;
    }
  }
  if (!r.deadline || now < r.deadline + 1200) return false;
  L.addLog(s, `${L.nameOf(s, r.turn)} süresini doldurdu, otomatik oynandı.`);
  botAct(s, r.turn);
  return true;
}

function view(s, me) {
  const r = s.round;
  const mine = me >= 0 && s.phase === 'playing' && r.turn === me;
  const hand = me >= 0 ? r.hands[me].slice() : [];
  return {
    game: 'uno',
    id: r.id,
    no: r.no,
    active: r.active,
    turn: r.turn,
    dir: r.dir,
    color: r.color,
    top: top(r),
    discardCount: r.discard.length,
    deckCount: r.deck.length,
    pending: r.pending,
    hand,
    handCounts: r.hands.map((h) => h.length),
    uno: r.uno,
    vulnerable: r.vulnerable,
    drew: mine ? r.drew : false,
    drawn: mine ? r.drawn : null,
    playable: mine ? hand.filter((id) => canPlay(r, id, s.settings) && (!r.drew || id === r.drawn)) : [],
    stack: !!s.settings.unoStack,
    target: s.settings.unoTarget || 200,
    events: r.events,
    evId: r.evId,
    moveNo: r.moveNo,
    remainingMs: r.deadline ? Math.max(0, r.deadline - Date.now()) : null,
    result: r.result,
  };
}

module.exports = { deal, act, view, tick, botAct, info, value, canPlay, TARGETS, COLOR_NAMES };
