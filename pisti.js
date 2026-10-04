'use strict';
/* Pişti: 52'lik deste, 2-4 oyuncu (4 kişide eşli de oynanır).
   Kartlar 0..51: renk = floor(id/13) (0 maça ♠, 1 kupa ♥, 2 karo ♦, 3 sinek ♣),
   değer = id%13 + 1 (1 As, 11 Vale, 12 Kız, 13 Papaz). */
const L = require('./lib.js');
const { fail } = L;

const suit = (id) => Math.floor(id / 13);
const rank = (id) => (id % 13) + 1;
const ACE = 1, JACK = 11;
const isJ = (id) => rank(id) === JACK;
const CLUB2 = 3 * 13 + 1; // sinek ikili
const DIAMOND10 = 2 * 13 + 9; // karo onlu
const TARGETS = [51, 101, 151];

// Kart puanları: her As ve Vale 1, sinek ikili 2, karo onlu 3
function cardPoints(id) {
  let p = 0;
  if (rank(id) === ACE || rank(id) === JACK) p += 1;
  if (id === CLUB2) p += 2;
  if (id === DIAMOND10) p += 3;
  return p;
}
// Pişti puanı: Vale ile vale 30, As ile as 20, diğerleri 10
const pistiPoints = (id) => (rank(id) === JACK ? 30 : rank(id) === ACE ? 20 : 10);

const isTeam = (s, r) => s.settings.mode === 'team' && r.active.filter(Boolean).length === 4;

function pushEvent(r, ev) {
  ev.id = ++r.evId;
  r.events.push(ev);
  if (r.events.length > 12) r.events.splice(0, r.events.length - 12);
}

function dealHands(r) {
  for (let seat = 0; seat < 4; seat++) if (r.active[seat]) r.hands[seat] = r.deck.splice(0, 4);
}

function deal(s) {
  const active = s.seats.map(Boolean);
  if (!active[s.startSeat]) s.startSeat = L.nextSeat(active, s.startSeat, 1);
  const deck = L.shuffle([...Array(52).keys()]);
  const pile = deck.splice(0, 4);
  // Yerdeki açık kart vale olmasın
  if (isJ(pile[3])) {
    const k = deck.findIndex((id) => !isJ(id));
    [pile[3], deck[k]] = [deck[k], pile[3]];
  }
  const r = {
    game: 'pisti',
    id: L.newToken(),
    no: s.history.length + 1,
    active,
    deck,
    pile,
    hidden: 3, // yerdeki ilk üç kart kapalı
    hands: [[], [], [], []],
    captured: [[], [], [], []],
    pistis: [[], [], [], []],
    lastCapturer: -1,
    turn: s.startSeat,
    moveNo: 0,
    events: [],
    evId: 0,
    deadline: 0,
    result: null,
  };
  dealHands(r);
  s.round = r;
  s.phase = 'playing';
  pushEvent(r, { type: 'deal' });
  L.startClock(s);
  L.addLog(s, `${r.no}. el başladı. ${L.nameOf(s, r.turn)} başlıyor.`);
}

function play(s, seat, id) {
  const r = s.round;
  if (s.phase !== 'playing') fail('Şu an oyun oynanmıyor.');
  if (r.turn !== seat) fail('Sıra sende değil.');
  const hand = r.hands[seat];
  if (!hand.includes(id)) fail('Bu kart elinde yok.');
  r.hands[seat] = hand.filter((x) => x !== id);
  const lastOfHand = !r.deck.length && r.hands.every((h) => h.length === 0);
  const top = r.pile.length ? r.pile[r.pile.length - 1] : null;
  const ev = { type: 'play', seat, card: id };
  if (top !== null && (rank(id) === rank(top) || isJ(id))) {
    // Pişti: yerde tek kart varken aynı değerle almak (elin son kartında sayılmaz)
    const pisti = r.pile.length === 1 && rank(id) === rank(top) && !lastOfHand ? pistiPoints(id) : 0;
    const taken = r.pile.concat([id]);
    r.captured[seat].push(...taken);
    if (pisti) r.pistis[seat].push(pisti);
    ev.capture = taken.length;
    ev.pisti = pisti;
    r.pile = [];
    r.hidden = 0;
    r.lastCapturer = seat;
    if (pisti) L.addLog(s, `${L.nameOf(s, seat)} PİŞTİ yaptı! +${pisti}`);
  } else {
    r.pile.push(id);
  }
  pushEvent(r, ev);
  r.moveNo++;
  if (r.hands.every((h, i) => !r.active[i] || h.length === 0)) {
    if (r.deck.length) {
      dealHands(r);
      pushEvent(r, { type: 'deal' });
    } else {
      endHand(s);
      return;
    }
  }
  r.turn = L.nextSeat(r.active, seat, 1);
  L.startClock(s);
}

function scoreTotals(s) {
  const t = [0, 0, 0, 0];
  s.history.forEach((h) => h.total.forEach((x, i) => (t[i] += x)));
  return t;
}

function endHand(s) {
  const r = s.round;
  // Yerde kalanlar son alan oyuncuya gider
  if (r.pile.length) {
    const to = r.lastCapturer >= 0 ? r.lastCapturer : r.turn;
    pushEvent(r, { type: 'sweep', seat: to, count: r.pile.length });
    r.captured[to].push(...r.pile);
    r.pile = [];
    r.hidden = 0;
  }
  const team = isTeam(s, r);
  const units = team ? [[0, 2], [1, 3]] : [0, 1, 2, 3].filter((i) => r.active[i]).map((i) => [i]);
  const detail = [0, 1, 2, 3].map((i) => ({
    cards: r.captured[i].length,
    cardPts: r.captured[i].reduce((a, id) => a + cardPoints(id), 0),
    pisti: r.pistis[i].reduce((a, p) => a + p, 0),
    pistiCount: r.pistis[i].length,
    majority: 0,
  }));
  // Kart çoğunluğu: en çok kartı alan 3 puan (eşitlikte kimse almaz)
  const unitCards = units.map((u) => u.reduce((a, i) => a + detail[i].cards, 0));
  const max = Math.max(...unitCards);
  if (unitCards.filter((c) => c === max).length === 1) {
    const u = units[unitCards.indexOf(max)];
    const who = u.reduce((a, i) => (detail[i].cards > detail[a].cards ? i : a), u[0]);
    detail[who].majority = 3;
  }
  const total = detail.map((d, i) => (r.active[i] ? d.cardPts + d.pisti + d.majority : 0));
  const note = 'El bitti.';
  s.history.push({ no: r.no, kind: 'pisti', winner: -1, total, counted: true, note });
  const sums = scoreTotals(s);
  const unitSums = units.map((u) => u.reduce((a, i) => a + sums[i], 0));
  const best = Math.max(...unitSums);
  const target = s.settings.pistiTarget || 101;
  const gameOver = best >= target && unitSums.filter((x) => x === best).length === 1;
  r.result = { kind: 'pisti', total, detail, team, gameOver, note };
  r.deadline = 0;
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
  if (a.type === 'play') return play(s, seat, a.card);
  fail('Bilinmeyen hamle.');
}

// ---------- Bot ----------
// Görülen kartlar: alınanlar, yerdeki açık kartlar ve kendi eli
function seenCounts(r, seat) {
  const c = new Array(14).fill(0);
  r.captured.forEach((p) => p.forEach((id) => c[rank(id)]++));
  r.pile.slice(r.hidden).forEach((id) => c[rank(id)]++);
  r.hands[seat].forEach((id) => c[rank(id)]++);
  return c;
}

function chooseCard(s, seat) {
  const r = s.round;
  const hand = r.hands[seat];
  if (hand.length === 1) return hand[0];
  const top = r.pile.length ? r.pile[r.pile.length - 1] : null;
  if (top !== null) {
    // Aynı değer varsa al (yerde tek kart varsa pişti)
    const same = hand.filter((id) => rank(id) === rank(top));
    if (same.length) return same.sort((a, b) => cardPoints(a) - cardPoints(b))[0];
    // Yerde değerli ya da çok kart varsa vale ile topla
    const jacks = hand.filter(isJ);
    const pileValue = r.pile.reduce((a, id) => a + cardPoints(id), 0);
    if (jacks.length && (r.pile.length >= 4 || pileValue >= 2 || (!r.deck.length && hand.length <= 2))) return jacks[0];
  }
  // Atılacak kart: vale tutulur; çok görülmüş değerler (rakipte çıkma ihtimali az) ve puansız kartlar atılır
  const pool = hand.filter((id) => !isJ(id));
  if (!pool.length) return hand[0];
  const seen = seenCounts(r, seat);
  const score = (id) => seen[rank(id)] * 3 - cardPoints(id) * 2 + (rank(id) === ACE ? -2 : 0);
  return pool.slice().sort((a, b) => score(b) - score(a) || rank(a) - rank(b))[0];
}

function botAct(s, seat) {
  play(s, seat, chooseCard(s, seat));
}

// Süre dolarsa sıradakinin yerine oynar
function tick(s, now) {
  const r = s.round;
  if (s.phase !== 'playing' || !r || !r.deadline) return false;
  if (now < r.deadline + 1200) return false;
  L.addLog(s, `${L.nameOf(s, r.turn)} süresini doldurdu, otomatik oynandı.`);
  botAct(s, r.turn);
  return true;
}

function view(s, me) {
  const r = s.round;
  const mine = me >= 0 && s.phase === 'playing' && r.turn === me;
  return {
    game: 'pisti',
    id: r.id,
    no: r.no,
    active: r.active,
    turn: r.turn,
    deckCount: r.deck.length,
    pile: r.pile.slice(r.hidden),
    hidden: r.hidden,
    pileCount: r.pile.length,
    hand: me >= 0 ? r.hands[me].slice() : [],
    handCounts: r.hands.map((h) => h.length),
    capturedCounts: r.captured.map((c) => c.length),
    pistiPoints: r.pistis.map((p) => p.reduce((a, x) => a + x, 0)),
    pistiCount: r.pistis.map((p) => p.length),
    lastCapturer: r.lastCapturer,
    playable: mine ? r.hands[me].slice() : [],
    events: r.events,
    evId: r.evId,
    moveNo: r.moveNo,
    team: isTeam(s, r),
    target: s.settings.pistiTarget || 101,
    remainingMs: r.deadline ? Math.max(0, r.deadline - Date.now()) : null,
    result: r.result,
  };
}

module.exports = { deal, act, view, tick, botAct, chooseCard, cardPoints, pistiPoints, rank, suit, isJ, TARGETS, CLUB2, DIAMOND10 };
