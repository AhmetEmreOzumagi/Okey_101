'use strict';
/* Batak (ihaleli). 52 kart, As en büyük. Türler:
     ihale   : 4 kişi, herkes kendi için. 13'er kart. İhale en az 5, en çok 13; herkes pas derse ilk konuşana 4'ten kalır.
     esli    : 4 kişi, karşılıklı oturanlar eş. İhale en az 8; herkes pas derse ilk konuşana 7'den kalır.
               Koz söylenince ihaleyi alanın eşinin kartları açılır; o kartları da ihaleyi alan oynar.
     gommeli : 3 kişi, 16'şar kart, 4 kart gömüye. İhale en az 8, en çok 16; herkes pas derse ilk konuşana 7'den kalır.
               İhaleyi alan gömüdeki 4 kartı alır, elinden 4 kart gömer, sonra kozu söyler.
   Oynanış (hepsinde): ihaleyi alan kozu seçer ve ilk eli açar. Renge uymak zorunlu; yerdeki en büyüğü geçebiliyorsan
   geçmek zorunlu (el kozla kesildiyse açılan renkte bu zorunluluk kalkar). Renk yoksa koz atmak zorunlu; yerde koz varsa
   geçebiliyorsan geçmek zorunlu. Koz kırılmadan (yere koz düşmeden) kozla el açılmaz; elde sadece koz kalırsa açılır.
   Eşlide koz kırılmadan da kozla açılabilir.
   Puan: ihaleyi alan tutturursa aldığı el kadar, tutturamazsa eksi ihale. Diğerleri aldığı el kadar; hiç el almayan
   (eşlide 2'den az alan karşı takım) eksi ihale yazar. Seçilen el sayısı bitince en yüksek puan kazanır. */
const L = require('./lib.js');
const { fail } = L;

const TYPES = ['ihale', 'esli', 'gommeli'];
const ROUND_CHOICES = [5, 7, 11];
const RULES = {
  ihale: { players: 4, cards: 13, min: 5, max: 13, forced: 4, kitty: 0 },
  esli: { players: 4, cards: 13, min: 8, max: 13, forced: 7, kitty: 0 },
  gommeli: { players: 3, cards: 16, min: 8, max: 16, forced: 7, kitty: 4 },
};
const SUIT_NAMES = ['Maça', 'Kupa', 'Karo', 'Sinek'];

const suit = (id) => Math.floor(id / 13);
const rank = (id) => (id % 13) + 1;
const power = (id) => (rank(id) === 1 ? 14 : rank(id)); // As en büyük
const nameOf = (s, i) => L.nameOf(s, i);

function pushEvent(r, ev) {
  ev.id = ++r.evId;
  r.events.push(ev);
  if (r.events.length > 24) r.events.splice(0, r.events.length - 24);
}
const nextActive = (r, seat) => L.nextSeat(r.active, seat, 1);
const tipOf = (s) => (TYPES.includes(s.settings.batakTip) ? s.settings.batakTip : 'ihale');
const isTeam = (r) => r.tip === 'esli';
const partner = (seat) => (seat + 2) % 4;

function deal(s) {
  const tip = tipOf(s);
  const R = RULES[tip];
  const active = s.seats.map(Boolean);
  if (!active[s.startSeat]) s.startSeat = L.nextSeat(active, s.startSeat, 1);
  const deck = L.shuffle([...Array(52).keys()]);
  const hands = [[], [], [], []];
  for (let seat = 0; seat < 4; seat++) if (active[seat]) hands[seat] = deck.splice(0, R.cards);
  const first = s.startSeat; // dağıtandan sonraki ilk oyuncu: ihaleyi o açar
  const r = {
    game: 'batak',
    tip,
    id: L.newToken(),
    no: s.history.length + 1,
    active,
    first,
    dealer: L.nextSeat(active, first, -1),
    hands,
    kitty: deck.splice(0, R.kitty),
    kittyCards: [],
    phase: 'bid', // bid | bury | trump | play
    turn: first,
    bids: [null, null, null, null], // sayı ya da 0 (pas)
    passed: [false, false, false, false],
    high: 0,
    bidder: -1,
    contract: 0,
    trump: -1,
    trumpBroken: false,
    trick: [],
    lastTrick: null,
    tricks: [0, 0, 0, 0],
    dummy: -1,
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
  L.addLog(s, `${r.no}. el başladı. İhaleyi ${nameOf(s, first)} açıyor.`);
}

// ---------- İhale ----------
function bid(s, seat, amount) {
  const r = s.round;
  if (r.phase !== 'bid') fail('İhale bitti.');
  if (r.turn !== seat) fail('Söz sende değil.');
  const R = RULES[r.tip];
  amount = Math.floor(Number(amount));
  const min = Math.max(R.min, r.high + 1);
  if (!(amount >= min && amount <= R.max)) fail(`İhale ${min} ile ${R.max} arasında olmalı.`);
  r.high = amount;
  r.bidder = seat;
  r.bids[seat] = amount;
  pushEvent(r, { type: 'bid', seat, amount });
  L.addLog(s, `${nameOf(s, seat)}: ${amount}`);
  r.moveNo++;
  if (amount === R.max) return closeBidding(s);
  advanceBid(s);
}

function pass(s, seat) {
  const r = s.round;
  if (r.phase !== 'bid') fail('İhale bitti.');
  if (r.turn !== seat) fail('Söz sende değil.');
  r.passed[seat] = true;
  r.bids[seat] = 0;
  pushEvent(r, { type: 'bid', seat, amount: 0 });
  L.addLog(s, `${nameOf(s, seat)}: pas`);
  r.moveNo++;
  advanceBid(s);
}

function advanceBid(s) {
  const r = s.round;
  const inn = [0, 1, 2, 3].filter((i) => r.active[i] && !r.passed[i]);
  if (!inn.length || (inn.length === 1 && r.bidder === inn[0])) return closeBidding(s);
  let t = r.turn;
  for (let k = 0; k < 4; k++) {
    t = nextActive(r, t);
    if (!r.passed[t]) break;
  }
  r.turn = t;
  L.startClock(s);
}

function closeBidding(s) {
  const r = s.round;
  const R = RULES[r.tip];
  if (r.bidder < 0) {
    // Herkes pas: ihale ilk konuşana zorunlu kalır
    r.bidder = r.first;
    r.high = R.forced;
    L.addLog(s, `Herkes pas dedi: ihale ${L.ekli(s, r.first, 'e')} ${R.forced} ile kaldı.`);
  }
  r.contract = r.high;
  pushEvent(r, { type: 'contract', seat: r.bidder, amount: r.contract });
  L.addLog(s, `İhaleyi ${nameOf(s, r.bidder)} ${r.contract} ile aldı.`);
  r.turn = r.bidder;
  if (R.kitty) {
    r.kittyCards = r.kitty.slice();
    r.hands[r.bidder] = r.hands[r.bidder].concat(r.kitty);
    r.kitty = [];
    r.phase = 'bury';
    pushEvent(r, { type: 'kitty', seat: r.bidder });
  } else r.phase = 'trump';
  r.moveNo++;
  L.startClock(s);
}

function bury(s, seat, cards) {
  const r = s.round;
  if (r.phase !== 'bury' || seat !== r.bidder) fail('Gömme sırası sende değil.');
  if (!Array.isArray(cards) || cards.length !== 4 || new Set(cards).size !== 4) fail('Gömmek için 4 kart seç.');
  const hand = r.hands[seat];
  cards.forEach((c) => { if (!hand.includes(c)) fail('Bu kart elinde yok.'); });
  r.hands[seat] = hand.filter((c) => !cards.includes(c));
  r.buried = cards.slice();
  r.kittyCards = [];
  r.phase = 'trump';
  pushEvent(r, { type: 'bury', seat });
  L.addLog(s, `${nameOf(s, seat)} 4 kart gömdü.`);
  r.moveNo++;
  L.startClock(s);
}

function chooseTrump(s, seat, su) {
  const r = s.round;
  if (r.phase !== 'trump' || seat !== r.bidder) fail('Kozu ihaleyi alan seçer.');
  su = Number(su);
  if (!(su >= 0 && su < 4)) fail('Bir koz seç.');
  r.trump = su;
  r.phase = 'play';
  r.turn = r.bidder;
  if (isTeam(r)) r.dummy = partner(r.bidder);
  pushEvent(r, { type: 'trump', seat, suit: su });
  L.addLog(s, `Koz ${SUIT_NAMES[su]}.${isTeam(r) ? ` ${L.ekli(s, r.dummy, 'in')} kartları açıldı; onları ${nameOf(s, seat)} oynayacak.` : ''}`);
  r.moveNo++;
  L.startClock(s);
}

// ---------- Oynanış ----------
// Atılabilecek kartlar
function legalCards(r, seat) {
  const hand = r.hands[seat];
  const T = r.trump;
  if (!r.trick.length) {
    if (r.trumpBroken || isTeam(r)) return hand.slice();
    const non = hand.filter((c) => suit(c) !== T);
    return non.length ? non : hand.slice();
  }
  const led = suit(r.trick[0].card);
  const trumped = led !== T && r.trick.some((x) => suit(x.card) === T);
  const follow = hand.filter((c) => suit(c) === led);
  if (follow.length) {
    if (trumped) return follow; // el kozla kesildi: açılan renkte yükseltme zorunlu değil
    const top = Math.max(...r.trick.filter((x) => suit(x.card) === led).map((x) => power(x.card)));
    const higher = follow.filter((c) => power(c) > top);
    return higher.length ? higher : follow;
  }
  const trumps = hand.filter((c) => suit(c) === T);
  if (trumps.length) {
    const inTrick = r.trick.filter((x) => suit(x.card) === T);
    if (inTrick.length) {
      const top = Math.max(...inTrick.map((x) => power(x.card)));
      const higher = trumps.filter((c) => power(c) > top);
      return higher.length ? higher : trumps;
    }
    return trumps;
  }
  return hand.slice();
}

function trickWinner(r, trick) {
  const led = suit(trick[0].card);
  const T = r.trump;
  let best = trick[0];
  trick.forEach((x) => {
    const bs = suit(best.card), xs = suit(x.card);
    if (xs === T && bs !== T) best = x;
    else if (xs === bs && power(x.card) > power(best.card)) best = x;
    else if (xs === led && bs !== T && bs !== led) best = x;
  });
  return best.seat;
}

const playersIn = (r) => r.active.filter(Boolean).length;

// seat: hamleyi yapan (eşlide ihaleyi alan eşinin kartını da oynar)
function play(s, seat, card) {
  const r = s.round;
  if (r.phase !== 'play') fail('Şu an kart atılmaz.');
  let who = r.turn;
  if (who === r.dummy) {
    if (seat !== r.bidder) fail(seat === r.dummy ? 'Senin kartlarını eşin oynuyor.' : 'Sıra sende değil.');
  } else if (who !== seat) fail('Sıra sende değil.');
  card = Number(card);
  if (!r.hands[who].includes(card)) fail('Bu kart elde yok.');
  const legal = legalCards(r, who);
  if (!legal.includes(card)) {
    if (!r.trick.length) fail('Koz kırılmadan kozla el açılmaz.');
    const led = suit(r.trick[0].card);
    const follow = r.hands[who].filter((c) => suit(c) === led);
    if (follow.length) fail(`${SUIT_NAMES[led]} atmalısın${legal.length < follow.length ? ' ve yerdekini geçmelisin' : ''}.`);
    fail('Rengin yok: koz atmalısın' + (r.trick.some((x) => suit(x.card) === r.trump) ? ' ve yerdeki kozu geçmelisin.' : '.'));
  }
  r.hands[who] = r.hands[who].filter((c) => c !== card);
  r.trick.push({ seat: who, card });
  if (suit(card) === r.trump) r.trumpBroken = true;
  pushEvent(r, { type: 'play', seat: who, card });
  r.moveNo++;
  if (r.trick.length < playersIn(r)) {
    r.turn = nextActive(r, who);
    L.startClock(s);
    return;
  }
  const w = trickWinner(r, r.trick);
  r.tricks[w]++;
  r.lastTrick = { cards: r.trick.slice(), winner: w };
  pushEvent(r, { type: 'trick', winner: w, cards: r.trick.slice() });
  r.trick = [];
  r.turn = w;
  if (r.hands.every((h, i) => !r.active[i] || !h.length)) return endHand(s);
  L.startClock(s);
}

function endHand(s) {
  const r = s.round;
  const total = [0, 0, 0, 0];
  const c = r.contract, b = r.bidder;
  let made;
  if (isTeam(r)) {
    const bt = b % 2;
    const teamTricks = [r.tricks[0] + r.tricks[2], r.tricks[1] + r.tricks[3]];
    made = teamTricks[bt] >= c;
    const bScore = made ? teamTricks[bt] : -c;
    const oScore = teamTricks[1 - bt] >= 2 ? teamTricks[1 - bt] : -c;
    for (let i = 0; i < 4; i++) total[i] = i % 2 === bt ? bScore : oScore; // takım puanı iki eşe de yazılır
  } else {
    made = r.tricks[b] >= c;
    for (let i = 0; i < 4; i++) {
      if (!r.active[i]) continue;
      if (i === b) total[i] = made ? r.tricks[i] : -c;
      else total[i] = r.tricks[i] >= 1 ? r.tricks[i] : -c;
    }
  }
  const note = made ? `${nameOf(s, b)} ${c} ihalesini tutturdu!` : `${nameOf(s, b)} ${c} ihalesinde battı!`;
  s.history.push({ no: r.no, kind: 'batak', winner: b, total, counted: true, note });
  const rounds = s.settings.batakEl || 7;
  const gameOver = s.history.filter((h) => h.kind === 'batak').length >= rounds;
  r.result = { kind: 'batak', bidder: b, contract: c, made, tricks: r.tricks.slice(), total, team: isTeam(r), gameOver, note, buried: r.buried || null, rounds };
  r.deadline = 0;
  s.phase = 'roundEnd';
  s.startSeat = L.nextSeat(r.active, s.startSeat, 1);
  pushEvent(r, { type: 'end' });
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
    case 'bid': return bid(s, seat, a.amount);
    case 'pass': return pass(s, seat);
    case 'bury': return bury(s, seat, a.cards);
    case 'trump': return chooseTrump(s, seat, a.suit);
    case 'play': return play(s, seat, a.card);
    default: fail('Bilinmeyen hamle.');
  }
}

// ---------- Bot ----------
function suitLens(hand) {
  const n = [0, 0, 0, 0];
  hand.forEach((c) => n[suit(c)]++);
  return n;
}
// Koz olarak en iyi renk: uzunluk + büyük kartlar
function bestTrump(hand) {
  const n = suitLens(hand);
  let best = 0, bestSc = -1;
  for (let su = 0; su < 4; su++) {
    const sc = n[su] * 2 + hand.filter((c) => suit(c) === su && power(c) >= 11).reduce((x, c) => x + (power(c) - 10) * 0.6, 0);
    if (sc > bestSc) { bestSc = sc; best = su; }
  }
  return best;
}
// Bu elle kaç el alınır (kaba tahmin)
function estimate(hand, T) {
  const n = suitLens(hand);
  let est = 0;
  for (let su = 0; su < 4; su++) {
    const cs = hand.filter((c) => suit(c) === su).map(power).sort((a, b) => b - a);
    if (su === T) {
      est += cs.filter((p) => p >= 12).length * 0.9 + Math.max(0, cs.length - 3) * 0.85;
    } else {
      if (cs[0] === 14) est += 1;
      if (cs.includes(13)) est += cs.length >= 2 ? 0.75 : 0.25;
      if (cs.includes(12) && cs.length >= 3) est += 0.35;
      if (n[T] >= 3 && cs.length <= 1) est += (1 - cs.length) * 0.6 + 0.3; // kozla kesme
    }
  }
  return est;
}

function botBid(s, seat) {
  const r = s.round;
  const R = RULES[r.tip];
  const hand = r.hands[seat];
  let est = estimate(hand, bestTrump(hand));
  if (R.kitty) est += 1.2; // gömüden gelecek kartlar
  if (isTeam(r)) est += 3; // eşinden beklenen eller
  if (r.tip === 'ihale') est += 0.4;
  const want = Math.min(R.max, Math.floor(est));
  const min = Math.max(R.min, r.high + 1);
  if (want >= min) return bid(s, seat, min);
  return pass(s, seat);
}

function botBury(s, seat) {
  const r = s.round;
  const hand = r.hands[seat];
  const T = bestTrump(hand);
  const n = suitLens(hand);
  // Kısa renklerden küçük kartları göm (renk boşalınca kozla kesilir); koz, As ve Papaz gömülmez
  const cand = hand.filter((c) => suit(c) !== T && power(c) < 13)
    .sort((a, b) => n[suit(a)] - n[suit(b)] || power(a) - power(b));
  let pick = cand.slice(0, 4);
  if (pick.length < 4) pick = pick.concat(hand.filter((c) => !pick.includes(c)).sort((a, b) => power(a) - power(b)).slice(0, 4 - pick.length));
  return bury(s, seat, pick);
}

function currentWinner(r) {
  return r.trick.length ? trickWinner(r, r.trick) : -1;
}

function botPlay(s, seat) {
  const r = s.round;
  const who = r.turn; // eşlide ihaleyi alan, eşinin kartını da oynar
  const legal = legalCards(r, who);
  const T = r.trump;
  const lowest = (cs) => cs.slice().sort((a, b) => (suit(a) === T) - (suit(b) === T) || power(a) - power(b))[0];
  if (!r.trick.length) {
    // As'larla başla; sonra (koz kırıldıysa ve çok kozu varsa) büyük kozla kozları topla; yoksa uzun renginden küçük
    const aces = legal.filter((c) => power(c) === 14 && suit(c) !== T);
    if (aces.length) return play(s, seat, aces[0]);
    const myTr = r.hands[who].filter((c) => suit(c) === T);
    if (who === r.bidder && myTr.length >= 4 && legal.some((c) => suit(c) === T)) {
      return play(s, seat, legal.filter((c) => suit(c) === T).sort((a, b) => power(b) - power(a))[0]);
    }
    const n = suitLens(r.hands[who]);
    const non = legal.filter((c) => suit(c) !== T);
    const pool = non.length ? non : legal;
    return play(s, seat, pool.slice().sort((a, b) => n[suit(b)] - n[suit(a)] || power(a) - power(b))[0]);
  }
  const winSeat = currentWinner(r);
  const friend = isTeam(r) && (winSeat % 2 === who % 2);
  if (friend) return play(s, seat, lowest(legal));
  // Kazandıran en küçük kart
  const wins = legal.filter((c) => trickWinner(r, r.trick.concat([{ seat: who, card: c }])) === who);
  if (wins.length) {
    const sorted = wins.slice().sort((a, b) => (suit(a) === T) - (suit(b) === T) || power(a) - power(b));
    return play(s, seat, sorted[0]);
  }
  return play(s, seat, lowest(legal));
}

function botAct(s, seat) {
  const r = s.round;
  if (r.phase === 'bid') return botBid(s, seat);
  if (r.phase === 'bury') return botBury(s, seat);
  if (r.phase === 'trump') return chooseTrump(s, seat, bestTrump(r.hands[seat]));
  if (r.phase === 'play') return botPlay(s, seat);
}

function botFallback(s, seat) {
  const r = s.round;
  if (r.phase === 'bid') return pass(s, seat);
  if (r.phase === 'bury') return bury(s, seat, r.hands[seat].slice(0, 4));
  if (r.phase === 'trump') return chooseTrump(s, seat, 0);
  if (r.phase === 'play') return play(s, seat, legalCards(r, r.turn)[0]);
}

// Kim hamle yapmalı: eşlide eşin sırasında ihaleyi alan
function actor(s) {
  const r = s.round;
  if (!r || s.phase !== 'playing') return -1;
  if (r.phase === 'play' && r.turn === r.dummy) return r.bidder;
  return r.turn;
}

// El tamamlanınca kartlar yerde biraz görünsün
function botDelay(s) {
  const r = s.round;
  const last = r.events[r.events.length - 1];
  let d = 850 + L.randomInt(550);
  if (last && last.type === 'trick') d += 1100;
  if (last && (last.type === 'contract' || last.type === 'trump' || last.type === 'kitty')) d += 700;
  return d;
}

function tick(s, now) {
  const r = s.round;
  if (s.phase !== 'playing' || !r || !r.deadline) return false;
  if (now < r.deadline + 1200) return false;
  const who = actor(s);
  L.addLog(s, `${nameOf(s, who)} süresini doldurdu, otomatik oynandı.`);
  try { botAct(s, who); } catch (e) { try { botFallback(s, who); } catch (e2) {} }
  return true;
}

function view(s, me) {
  const r = s.round;
  const act = actor(s);
  const mine = me >= 0 && s.phase === 'playing' && act === me;
  let playable = [];
  if (mine && r.phase === 'play') playable = legalCards(r, r.turn);
  const showDummy = r.dummy >= 0 && r.phase === 'play';
  return {
    game: 'batak',
    tip: r.tip,
    id: r.id,
    no: r.no,
    active: r.active,
    phase: r.phase,
    first: r.first,
    dealer: r.dealer,
    turn: r.turn,
    actor: act,
    bids: r.bids,
    high: r.high,
    bidder: r.bidder,
    contract: r.contract,
    minBid: RULES[r.tip].min,
    maxBid: RULES[r.tip].max,
    trump: r.trump,
    trumpBroken: r.trumpBroken,
    trick: r.trick,
    lastTrick: r.lastTrick,
    tricks: r.tricks,
    hand: me >= 0 ? r.hands[me].slice() : [],
    handCounts: r.hands.map((h) => h.length),
    kittyCards: me === r.bidder && r.phase === 'bury' ? r.kittyCards : [],
    kittyCount: r.kitty.length,
    dummy: r.dummy,
    dummyHand: showDummy ? r.hands[r.dummy].slice() : [],
    playable,
    team: isTeam(r),
    rounds: s.settings.batakEl || 7,
    events: r.events,
    evId: r.evId,
    moveNo: r.moveNo,
    remainingMs: r.deadline ? Math.max(0, r.deadline - Date.now()) : null,
    result: r.result,
  };
}

module.exports = { deal, act, view, tick, botAct, botFallback, actor, botDelay, legalCards, trickWinner, estimate, bestTrump, TYPES, ROUND_CHOICES, RULES, SUIT_NAMES, suit, rank, power };
