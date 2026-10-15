'use strict';
/* İstanbul Emlak: zarla tahtada dolaşılan, mülk alınıp kira toplanan klasik emlak oyunu. 2-4 oyuncu.
   Kurallar klasik oyunun resmî kurallarıdır: 40 kare, 22 arsa (8 renk grubu), 4 istasyon, 2 idare,
   Şans ve Kamu Fonu kartları, hapis, çift zar, açık artırma, ev/otel (eşit kurma), ipotek, takas, iflas.
   Arsalar İstanbul semtleridir; ucuzdan pahalıya gerçek konut m² fiyatlarına göre dizilir ve fiyatlanır
   (bkz. SEMTLER). Para birimi oyun parasıdır (₺). */
const L = require('./lib.js');
const { fail } = L;

const MONEY_CHOICES = [1000, 1500, 2000];
const TURN_CHOICES = [0, 20, 30, 50];
const GO_MONEY = 200;
const JAIL_FINE = 50;
const JAIL = 10;
const GO_TO_JAIL = 30;
const BANK_HOUSES = 32;
const BANK_HOTELS = 12;

// ---------- Tahta, kartlar ve kural yardımcıları: public/emlak-data.js (telefon arayüzüyle ortak) ----------
const D = require('./public/emlak-data.js');
const { BOARD, GROUPS, SEMTLER, SEMT_KAYNAK, CHANCE, CHEST, OWNABLE, STREET_POS, RAILS, UTILS, RAIL_RENT,
  groupMembers, ownsGroup, railsOwned, utilsOwned, rentFor, worth, liquidity,
  canBuild, canSell, canMortgage, canUnmortgage, unmortgageCost } = D;

// ---------- Yardımcılar ----------
const P = (r, seat) => r.players[seat];
const alive = (r) => [0, 1, 2, 3].filter((i) => r.active[i] && !r.players[i].bankrupt);
const nameOf = (s, i) => L.nameOf(s, i);

function pushEvent(r, ev) {
  ev.id = ++r.evId;
  r.events.push(ev);
  if (r.events.length > 30) r.events.splice(0, r.events.length - 30);
}

function nextSeat(r, seat) {
  for (let k = 1; k <= 4; k++) {
    const t = (seat + k) % 4;
    if (r.active[t] && !r.players[t].bankrupt) return t;
  }
  return seat;
}

// ---------- Dağıtım ----------
function deal(s) {
  const active = s.seats.map(Boolean);
  if (!active[s.startSeat]) s.startSeat = L.nextSeat(active, s.startSeat, 1);
  const money = s.settings.emlakPara || 1500;
  const r = {
    game: 'emlak',
    id: L.newToken(),
    no: 1,
    active,
    players: [0, 1, 2, 3].map(() => ({ pos: 0, money, jail: 0, jailCards: 0, bankrupt: false })),
    owner: new Array(40).fill(-1),
    houses: new Array(40).fill(0),
    mortgaged: new Array(40).fill(false),
    bankHouses: BANK_HOUSES,
    bankHotels: BANK_HOTELS,
    chance: L.shuffle([...Array(CHANCE.length).keys()]),
    chest: L.shuffle([...Array(CHEST.length).keys()]),
    jailCardsOut: { chance: 0, chest: 0 }, // oyuncuların elindeki hapisten çıkış kartları desteden çıkar
    pot: 0, // otopark kumbarası (ayar açıksa)
    turn: s.startSeat,
    firstSeat: s.startSeat,
    cardSeq: 0,
    phase: 'roll', // roll | buy | auction | debt | done
    dice: null,
    doubles: 0,
    after: null, // borç ödenince ne olacak: 'roll' | 'done'
    debt: null, // { amount, to (koltuk ya da -1 banka), parts?: [{to, amount}], reason }
    auction: null,
    trade: null,
    card: null, // son çekilen kart { deck, text }
    roundNo: 1,
    turnsLimit: s.settings.emlakTur || 0,
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
  L.addLog(s, `Oyun başladı. ${nameOf(s, r.turn)} başlıyor. Herkese ${money} ₺ verildi.`);
}

// ---------- Para ----------
function addMoney(r, seat, amount) {
  P(r, seat).money += amount;
}

// Ödeme: para yetiyorsa hemen öder; yetmiyorsa borç aşamasına geçer (satarak/ipotekleyerek toplar ya da iflas eder).
// parts: birden çok alacaklı (ör. her oyuncuya 50 ₺). to = -1 banka.
function charge(s, seat, amount, to, reason, parts) {
  const r = s.round;
  if (amount <= 0) return true;
  if (P(r, seat).money >= amount) {
    payNow(s, seat, amount, to, reason, parts);
    return true;
  }
  r.debt = { amount, to, reason, parts: parts || null };
  r.after = r.after || 'done';
  r.phase = 'debt';
  L.addLog(s, `${nameOf(s, seat)} ${amount} ₺ ödeyemiyor: satarak ya da ipotekleyerek para bulmalı.`);
  return false;
}

function payNow(s, seat, amount, to, reason, parts) {
  const r = s.round;
  addMoney(r, seat, -amount);
  if (parts) parts.forEach((x) => { addMoney(r, x.to, x.amount); pushEvent(r, { type: 'pay', from: seat, to: x.to, amount: x.amount, reason }); });
  else if (to >= 0) { addMoney(r, to, amount); pushEvent(r, { type: 'pay', from: seat, to, amount, reason }); }
  else {
    if (s.settings.emlakOtopark && (reason === 'tax' || reason === 'card' || reason === 'jail')) r.pot += amount;
    pushEvent(r, { type: 'pay', from: seat, to: -1, amount, reason });
  }
}

// ---------- Hareket ----------
function moveTo(s, seat, to, opts) {
  const r = s.round;
  const p = P(r, seat);
  const from = p.pos;
  opts = opts || {};
  let steps = (to - from + 40) % 40;
  if (opts.back) steps = -((from - to + 40) % 40);
  p.pos = to;
  pushEvent(r, { type: 'move', seat, from, to, steps, via: opts.via || 'roll' });
  // BAŞLA'dan geçme ya da BAŞLA'ya gelme (geri gitmede ve hapse girerken para yok)
  if (steps > 0 && from + steps >= 40 && !opts.noGo) {
    addMoney(r, seat, GO_MONEY);
    pushEvent(r, { type: 'go', seat, amount: GO_MONEY });
  }
}

function sendToJail(s, seat) {
  const r = s.round;
  const p = P(r, seat);
  const from = p.pos;
  p.pos = JAIL;
  p.jail = 1;
  r.doubles = 0;
  pushEvent(r, { type: 'move', seat, from, to: JAIL, steps: 0, via: 'jail' });
  pushEvent(r, { type: 'jail', seat });
  L.addLog(s, `${nameOf(s, seat)} hapse girdi.`);
}

// Kareye gelince olanlar. opt: { double: istasyon kirası 2 kat, util10: idare zar × 10 }
function land(s, seat, opt) {
  const r = s.round;
  const pos = P(r, seat).pos;
  const sq = BOARD[pos];
  opt = opt || {};
  if (sq.type === 'street' || sq.type === 'rail' || sq.type === 'util') {
    const o = r.owner[pos];
    if (o < 0) {
      r.phase = 'buy';
      r.offer = { pos, opt };
      return;
    }
    if (o === seat || r.mortgaged[pos]) return;
    let dice = r.dice ? r.dice[0] + r.dice[1] : 7;
    if (sq.type === 'util' && opt.util10) {
      // Karttan gelen idare: zar yeniden atılır
      const d = [L.randomInt(6) + 1, L.randomInt(6) + 1];
      dice = d[0] + d[1];
      pushEvent(r, { type: 'roll', seat, dice: d, util: true });
    }
    const rent = rentFor(r, pos, dice, opt);
    if (rent > 0) {
      L.addLog(s, `${nameOf(s, seat)}, ${L.ekli(s, o, 'e')} ${sq.name} kirası ${rent} ₺ ödüyor.`);
      charge(s, seat, rent, o, 'rent');
    }
    return;
  }
  if (sq.type === 'tax') {
    L.addLog(s, `${nameOf(s, seat)} ${sq.name} ödüyor: ${sq.amount} ₺.`);
    charge(s, seat, sq.amount, -1, 'tax');
    return;
  }
  if (sq.type === 'chance' || sq.type === 'chest') return drawCard(s, seat, sq.type);
  if (sq.type === 'gotojail') return sendToJail(s, seat);
  if (sq.type === 'park' && s.settings.emlakOtopark && r.pot > 0) {
    const amount = r.pot;
    r.pot = 0;
    addMoney(r, seat, amount);
    pushEvent(r, { type: 'pot', seat, amount });
    L.addLog(s, `${nameOf(s, seat)} otopark kumbarasından ${amount} ₺ aldı!`);
  }
}

function drawCard(s, seat, deck) {
  const r = s.round;
  const list = deck === 'chance' ? CHANCE : CHEST;
  let idx = r[deck].shift();
  r[deck].push(idx);
  // Elde tutulan hapisten çıkış kartı destede yoksa atla
  if (list[idx].act.t === 'jailcard' && r.jailCardsOut[deck]) {
    idx = r[deck].shift();
    r[deck].push(idx);
  }
  const card = list[idx];
  r.cardSeq = (r.cardSeq || 0) + 1;
  r.card = { deck, text: card.text, seat, id: r.cardSeq };
  pushEvent(r, { type: 'card', seat, deck, text: card.text });
  L.addLog(s, `${nameOf(s, seat)} ${deck === 'chance' ? 'Şans' : 'Kamu Fonu'} kartı çekti: ${card.text}`);
  const a = card.act;
  const p = P(r, seat);
  switch (a.t) {
    case 'goto':
      moveTo(s, seat, a.to, { via: 'card' });
      return land(s, seat);
    case 'nearest': {
      const list2 = a.kind === 'rail' ? RAILS : UTILS;
      let to = list2.map((x) => x.pos).find((q) => q > p.pos);
      if (to === undefined) to = list2[0].pos;
      moveTo(s, seat, to, { via: 'card' });
      return land(s, seat, a.kind === 'rail' ? { double: true } : { util10: true });
    }
    case 'back':
      moveTo(s, seat, (p.pos - a.n + 40) % 40, { via: 'card', back: true });
      return land(s, seat);
    case 'jail':
      return sendToJail(s, seat);
    case 'jailcard':
      p.jailCards++;
      r.jailCardsOut[deck]++;
      p.jailFrom = (p.jailFrom || []).concat([deck]);
      return;
    case 'money':
      if (a.amount > 0) { addMoney(r, seat, a.amount); pushEvent(r, { type: 'gain', seat, amount: a.amount }); }
      else charge(s, seat, -a.amount, -1, 'card');
      return;
    case 'each': {
      const others = alive(r).filter((i) => i !== seat);
      if (a.amount > 0) {
        // her oyuncudan al: ödeyemeyen için kalan borç işlemi basitçe banka adına yapılmaz, elindeki kadar öder
        others.forEach((o) => {
          const pay = Math.min(a.amount, P(r, o).money);
          if (pay > 0) { addMoney(r, o, -pay); addMoney(r, seat, pay); pushEvent(r, { type: 'pay', from: o, to: seat, amount: pay, reason: 'card' }); }
        });
      } else {
        const each = -a.amount;
        charge(s, seat, each * others.length, -1, 'card', others.map((o) => ({ to: o, amount: each })));
      }
      return;
    }
    case 'repair': {
      let total = 0;
      STREET_POS.forEach((q) => {
        if (r.owner[q] !== seat) return;
        const h = r.houses[q];
        total += h === 5 ? a.hotel : h * a.house;
      });
      if (total > 0) charge(s, seat, total, -1, 'card');
      return;
    }
    default:
  }
}

// ---------- Tur ----------
function afterResolve(s, seat) {
  // Çözüm bittiğinde: borç ya da satın alma bekleniyorsa orada kalır
  const r = s.round;
  if (r.phase === 'buy' || r.phase === 'debt' || r.phase === 'auction') return;
  if (P(r, seat).jail) { r.phase = 'done'; return; }
  r.phase = r.dice && r.dice[0] === r.dice[1] && r.doubles > 0 ? 'roll' : 'done';
}

function roll(s, seat) {
  const r = s.round;
  if (r.phase !== 'roll') fail('Şu an zar atılmaz.');
  const d = [L.randomInt(6) + 1, L.randomInt(6) + 1];
  return rollWith(s, seat, d);
}

function rollWith(s, seat, d) {
  const r = s.round;
  const p = P(r, seat);
  r.dice = d;
  r.card = null;
  const dbl = d[0] === d[1];
  pushEvent(r, { type: 'roll', seat, dice: d });
  r.moveNo++;
  if (p.jail) {
    if (dbl) {
      p.jail = 0;
      r.doubles = 0; // hapisten çiftle çıkan tekrar atmaz
      L.addLog(s, `${nameOf(s, seat)} çift attı, hapisten çıktı.`);
      moveTo(s, seat, (p.pos + d[0] + d[1]) % 40);
      r.after = 'done';
      land(s, seat);
      if (!['buy', 'debt', 'auction'].includes(r.phase)) r.phase = 'done';
      startClock(s);
      return;
    }
    if (p.jail >= 3) {
      // Üçüncü denemede de çift gelmedi: ceza ödenir, zar kadar ilerlenir
      L.addLog(s, `${nameOf(s, seat)} üç denemede çift atamadı: ${JAIL_FINE} ₺ ödeyip çıkıyor.`);
      p.jail = 0;
      r.after = 'move';
      r.pendingMove = d[0] + d[1];
      if (!charge(s, seat, JAIL_FINE, -1, 'jail')) { startClock(s); return; }
      finishPendingMove(s, seat);
      startClock(s);
      return;
    }
    p.jail++;
    L.addLog(s, `${nameOf(s, seat)} çift atamadı, hapiste kalıyor.`);
    r.phase = 'done';
    startClock(s);
    return;
  }
  if (dbl) {
    r.doubles++;
    if (r.doubles >= 3) {
      L.addLog(s, `${nameOf(s, seat)} üst üste üç kez çift attı: hapse!`);
      sendToJail(s, seat);
      r.phase = 'done';
      startClock(s);
      return;
    }
  } else r.doubles = 0;
  moveTo(s, seat, (p.pos + d[0] + d[1]) % 40);
  r.after = dbl ? 'roll' : 'done';
  land(s, seat);
  afterResolve(s, seat);
  startClock(s);
}

function finishPendingMove(s, seat) {
  const r = s.round;
  const p = P(r, seat);
  const steps = r.pendingMove || 0;
  r.pendingMove = 0;
  r.after = 'done';
  moveTo(s, seat, (p.pos + steps) % 40);
  land(s, seat);
  if (r.phase !== 'buy' && r.phase !== 'debt' && r.phase !== 'auction') r.phase = 'done';
}

function startClock(s) {
  L.startClock(s);
}

// Satın alma kararı
function buy(s, seat) {
  const r = s.round;
  if (r.phase !== 'buy' || !r.offer) fail('Satın alınacak bir yer yok.');
  const pos = r.offer.pos;
  const sq = BOARD[pos];
  if (P(r, seat).money < sq.price) fail(`Paran yetmiyor (${sq.price} ₺). Açık artırmaya bırakabilir ya da ipotekleyip para bulabilirsin.`);
  addMoney(r, seat, -sq.price);
  r.owner[pos] = seat;
  r.offer = null;
  pushEvent(r, { type: 'buy', seat, pos, price: sq.price });
  L.addLog(s, `${nameOf(s, seat)} ${L.ek(sq.name, 'i')} ${sq.price} ₺'ye satın aldı.`);
  r.moveNo++;
  r.phase = r.after === 'roll' ? 'roll' : 'done';
  startClock(s);
}

// Almak istemezse açık artırma: herkes (vazgeçen dahil) katılabilir
function decline(s, seat) {
  const r = s.round;
  if (r.phase !== 'buy' || !r.offer) fail('Satın alınacak bir yer yok.');
  const pos = r.offer.pos;
  r.offer = null;
  const order = [];
  let t = seat;
  for (let k = 0; k < 4; k++) {
    t = nextSeat(r, t);
    if (!order.includes(t)) order.push(t);
  }
  r.auction = { pos, high: 0, highSeat: -1, order, idx: 0, out: [], back: r.after === 'roll' ? 'roll' : 'done' };
  r.phase = 'auction';
  pushEvent(r, { type: 'auction', pos });
  L.addLog(s, `${BOARD[pos].name} açık artırmada.`);
  r.moveNo++;
  startClock(s);
}

function auctionBidder(r) {
  const a = r.auction;
  return a ? a.order[a.idx] : -1;
}

function auctionNext(s) {
  const r = s.round;
  const a = r.auction;
  const inn = a.order.filter((x) => !a.out.includes(x));
  // Bitti mi: en yüksek teklif verenden başka kimse kalmadıysa ya da herkes çekildiyse
  if (!inn.length || (inn.length === 1 && a.highSeat === inn[0])) return auctionEnd(s);
  for (let k = 1; k <= a.order.length; k++) {
    const i = (a.idx + k) % a.order.length;
    if (!a.out.includes(a.order[i])) { a.idx = i; break; }
  }
  if (inn.length === 1 && a.highSeat < 0) {
    // tek kişi kaldı ve henüz teklif yok: o kişi teklif verebilir ya da çekilir
  }
  startClock(s);
}

function auctionEnd(s) {
  const r = s.round;
  const a = r.auction;
  const sq = BOARD[a.pos];
  if (a.highSeat >= 0) {
    addMoney(r, a.highSeat, -a.high);
    r.owner[a.pos] = a.highSeat;
    pushEvent(r, { type: 'buy', seat: a.highSeat, pos: a.pos, price: a.high, auction: true });
    L.addLog(s, `${nameOf(s, a.highSeat)} ${L.ek(sq.name, 'i')} açık artırmada ${a.high} ₺'ye aldı.`);
  } else {
    pushEvent(r, { type: 'auctionNone', pos: a.pos });
    L.addLog(s, `${sq.name} için teklif gelmedi, bankada kaldı.`);
  }
  r.auction = null;
  r.phase = a.back;
  startClock(s);
}

function bid(s, seat, amount) {
  const r = s.round;
  const a = r.auction;
  if (r.phase !== 'auction' || !a) fail('Açık artırma yok.');
  if (auctionBidder(r) !== seat) fail('Teklif sırası sende değil.');
  amount = Math.floor(Number(amount));
  if (!(amount > a.high) || amount < 10) fail(a.high ? `Teklif ${a.high} ₺'den yüksek olmalı.` : 'Açık artırma en az 10 ₺ ile başlar.');
  if (amount > P(r, seat).money) fail('Paran bu teklife yetmiyor.');
  a.high = amount;
  a.highSeat = seat;
  pushEvent(r, { type: 'bid', seat, amount });
  r.moveNo++;
  auctionNext(s);
}

function passBid(s, seat) {
  const r = s.round;
  const a = r.auction;
  if (r.phase !== 'auction' || !a) fail('Açık artırma yok.');
  if (auctionBidder(r) !== seat) fail('Teklif sırası sende değil.');
  a.out.push(seat);
  pushEvent(r, { type: 'bidPass', seat });
  r.moveNo++;
  auctionNext(s);
}

// ---------- Bina ve ipotek ----------
function build(s, seat, pos) {
  const r = s.round;
  const why = canBuild(r, seat, pos);
  if (why) fail(why);
  const sq = BOARD[pos];
  addMoney(r, seat, -sq.house);
  if (r.houses[pos] === 4) { r.bankHotels--; r.bankHouses += 4; } else r.bankHouses--;
  r.houses[pos]++;
  pushEvent(r, { type: 'build', seat, pos, houses: r.houses[pos] });
  L.addLog(s, `${nameOf(s, seat)} ${L.ek(sq.name, 'e')} ${r.houses[pos] === 5 ? 'otel' : 'ev'} kurdu.`);
  r.moveNo++;
}
function sellHouse(s, seat, pos) {
  const r = s.round;
  const why = canSell(r, seat, pos);
  if (why) fail(why);
  const sq = BOARD[pos];
  if (r.houses[pos] === 5) {
    if (r.bankHouses >= 4) { r.bankHouses -= 4; r.bankHotels++; r.houses[pos] = 4; addMoney(r, seat, sq.house / 2); }
    else { r.bankHotels++; r.houses[pos] = 0; addMoney(r, seat, (sq.house * 5) / 2); }
  } else { r.bankHouses++; r.houses[pos]--; addMoney(r, seat, sq.house / 2); }
  pushEvent(r, { type: 'sell', seat, pos, houses: r.houses[pos] });
  L.addLog(s, `${nameOf(s, seat)} ${L.ek(sq.name, 'de')} bina sattı.`);
  r.moveNo++;
}
function mortgage(s, seat, pos) {
  const r = s.round;
  const why = canMortgage(r, seat, pos);
  if (why) fail(why);
  r.mortgaged[pos] = true;
  addMoney(r, seat, BOARD[pos].mortgage);
  pushEvent(r, { type: 'mortgage', seat, pos, amount: BOARD[pos].mortgage });
  L.addLog(s, `${nameOf(s, seat)} ${L.ek(BOARD[pos].name, 'i')} ipotek etti (+${BOARD[pos].mortgage} ₺).`);
  r.moveNo++;
}
function unmortgage(s, seat, pos) {
  const r = s.round;
  const why = canUnmortgage(r, seat, pos);
  if (why) fail(why);
  const c = unmortgageCost(pos);
  r.mortgaged[pos] = false;
  addMoney(r, seat, -c);
  pushEvent(r, { type: 'unmortgage', seat, pos, amount: c });
  L.addLog(s, `${nameOf(s, seat)} ${L.ek(BOARD[pos].name, 'in')} ipoteğini kaldırdı (-${c} ₺).`);
  r.moveNo++;
}

// ---------- Borç ve iflas ----------
function payDebt(s, seat) {
  const r = s.round;
  if (r.phase !== 'debt' || !r.debt) fail('Borcun yok.');
  const d = r.debt;
  if (P(r, seat).money < d.amount) fail(`Daha ${d.amount - P(r, seat).money} ₺ bulman gerekiyor: bina sat ya da ipotekle.`);
  r.debt = null;
  payNow(s, seat, d.amount, d.to, d.reason, d.parts);
  L.addLog(s, `${nameOf(s, seat)} borcunu ödedi.`);
  r.moveNo++;
  if (r.after === 'move') {
    // Hapis cezası ödendi: zar kadar ilerler (borç aşaması kapanır; yeni kareye göre satın alma/kira olabilir)
    r.phase = 'done';
    finishPendingMove(s, seat);
    startClock(s);
    return;
  }
  r.phase = r.after === 'roll' && !P(r, seat).jail ? 'roll' : 'done';
  startClock(s);
}

function bankrupt(s, seat) {
  const r = s.round;
  const p = P(r, seat);
  const d = r.debt;
  const to = d && d.to >= 0 && !d.parts ? d.to : -1;
  // Binalar bankaya yarı fiyattan satılır
  STREET_POS.forEach((q) => {
    if (r.owner[q] !== seat || !r.houses[q]) return;
    const h = r.houses[q];
    if (h === 5) r.bankHotels++; else r.bankHouses += h;
    p.money += (h * BOARD[q].house) / 2;
    r.houses[q] = 0;
  });
  if (to >= 0) {
    addMoney(r, to, Math.max(0, p.money));
    OWNABLE.forEach((q) => { if (r.owner[q] === seat) r.owner[q] = to; });
    P(r, to).jailCards += p.jailCards;
    P(r, to).jailFrom = (P(r, to).jailFrom || []).concat(p.jailFrom || []);
  } else {
    OWNABLE.forEach((q) => { if (r.owner[q] === seat) { r.owner[q] = -1; r.mortgaged[q] = false; } });
    (p.jailFrom || []).forEach((deck) => { r.jailCardsOut[deck] = Math.max(0, r.jailCardsOut[deck] - 1); });
  }
  p.money = 0;
  p.jailCards = 0;
  p.jailFrom = [];
  p.bankrupt = true;
  p.jail = 0;
  r.debt = null;
  if (r.trade && (r.trade.from === seat || r.trade.to === seat)) r.trade = null;
  pushEvent(r, { type: 'bankrupt', seat, to });
  L.addLog(s, `${nameOf(s, seat)} iflas etti${to >= 0 ? `; her şeyi ${L.ekli(s, to, 'e')} geçti` : ''}.`);
  r.moveNo++;
  if (alive(r).length <= 1) return gameOver(s, 'last');
  if (r.turn === seat) nextTurn(s);
}

function endTurn(s, seat) {
  const r = s.round;
  if (r.phase !== 'done') fail(r.phase === 'roll' ? 'Önce zar at.' : 'Önce bu işi bitir.');
  if (r.trade) fail('Önce takas teklifinin cevabını bekle ya da teklifi geri çek.');
  nextTurn(s);
}

function nextTurn(s) {
  const r = s.round;
  const prev = r.turn;
  r.turn = nextSeat(r, prev);
  // Bütün oyuncular bir kez oynayınca tur sayısı artar (sıra başlayan oyuncuya ya da ondan sonraki ilk oyuncuya dönünce)
  const first = r.active[r.firstSeat] && !r.players[r.firstSeat].bankrupt ? r.firstSeat : nextSeat(r, r.firstSeat);
  if (r.turn === first) r.roundNo++;
  r.phase = 'roll';
  r.doubles = 0;
  r.dice = null;
  r.after = null;
  r.offer = null;
  r.card = null;
  r.moveNo++;
  pushEvent(r, { type: 'turn', seat: r.turn });
  if (r.turnsLimit && r.roundNo > r.turnsLimit) return gameOver(s, 'turns');
  startClock(s);
}

function gameOver(s, why) {
  const r = s.round;
  const worths = [0, 1, 2, 3].map((i) => (r.active[i] && !r.players[i].bankrupt ? worth(r, i) : 0));
  const order = [0, 1, 2, 3].filter((i) => r.active[i]).sort((a, b) => worths[b] - worths[a] || (r.players[a].bankrupt ? 1 : 0) - (r.players[b].bankrupt ? 1 : 0));
  const winner = order[0];
  const note = why === 'last' ? `${nameOf(s, winner)} kazandı: herkes iflas etti!` : `${r.turnsLimit} tur bitti. En zengin: ${nameOf(s, winner)}!`;
  r.result = { kind: 'emlak', winner, worths, order, why, note, gameOver: true };
  r.deadline = 0;
  s.history.push({ no: 1, kind: 'emlak', winner, total: worths, counted: true, note });
  s.phase = 'roundEnd';
  pushEvent(r, { type: 'end', winner });
  L.addLog(s, note);
}

// ---------- Hapis ----------
function payJail(s, seat) {
  const r = s.round;
  const p = P(r, seat);
  if (!p.jail || r.phase !== 'roll') fail('Hapiste değilsin.');
  if (p.money < JAIL_FINE) fail(`${JAIL_FINE} ₺ gerekli.`);
  payNow(s, seat, JAIL_FINE, -1, 'jail');
  p.jail = 0;
  r.doubles = 0;
  L.addLog(s, `${nameOf(s, seat)} ${JAIL_FINE} ₺ ödeyip hapisten çıktı.`);
  r.moveNo++;
}
function useJailCard(s, seat) {
  const r = s.round;
  const p = P(r, seat);
  if (!p.jail || r.phase !== 'roll') fail('Hapiste değilsin.');
  if (!p.jailCards) fail('Hapisten çıkış kartın yok.');
  p.jailCards--;
  const deck = (p.jailFrom || []).pop() || 'chance';
  r.jailCardsOut[deck] = Math.max(0, r.jailCardsOut[deck] - 1);
  p.jail = 0;
  r.doubles = 0;
  pushEvent(r, { type: 'jailcard', seat });
  L.addLog(s, `${nameOf(s, seat)} hapisten çıkış kartını kullandı.`);
  r.moveNo++;
}

// ---------- Takas ----------
function cleanSide(r, seat, side) {
  side = side || {};
  const props = Array.isArray(side.props) ? [...new Set(side.props.map(Number))] : [];
  const money = Math.max(0, Math.floor(Number(side.money) || 0));
  const cards = Math.max(0, Math.floor(Number(side.cards) || 0));
  props.forEach((q) => {
    if (!OWNABLE.includes(q) || r.owner[q] !== seat) fail('Takasta olmayan bir mülk var.');
    const sq = BOARD[q];
    if (sq.type === 'street' && groupMembers(sq.group).some((x) => r.houses[x] > 0)) fail(`${sq.name} grubunda bina var: önce binaları satmak gerekir.`);
  });
  if (money > P(r, seat).money) fail('Takastaki para yetmiyor.');
  if (cards > P(r, seat).jailCards) fail('O kadar hapisten çıkış kartı yok.');
  return { props, money, cards };
}

function offer(s, seat, a) {
  const r = s.round;
  if (r.turn !== seat || (r.phase !== 'roll' && r.phase !== 'done')) fail('Takas teklifini kendi sıranda, zar atmadan önce ya da sonra yapabilirsin.');
  if (r.trade) fail('Zaten bekleyen bir teklifin var.');
  const to = Number(a.to);
  if (!(to >= 0 && to < 4) || to === seat || !r.active[to] || P(r, to).bankrupt) fail('Takas için bir oyuncu seç.');
  const give = cleanSide(r, seat, a.give);
  const get = cleanSide(r, to, a.get);
  if (!give.props.length && !give.money && !give.cards && !get.props.length && !get.money && !get.cards) fail('Takasa bir şey koy.');
  r.trade = { from: seat, to, give, get, id: L.newToken().slice(0, 6) };
  pushEvent(r, { type: 'offer', from: seat, to });
  L.addLog(s, `${nameOf(s, seat)}, ${L.ekli(s, to, 'e')} takas teklif etti.`);
  r.moveNo++;
  startClock(s); // cevap için süre baştan başlar
}

function transfer(r, fromSeat, toSeat, side) {
  side.props.forEach((q) => { r.owner[q] = toSeat; });
  addMoney(r, fromSeat, -side.money);
  addMoney(r, toSeat, side.money);
  for (let k = 0; k < side.cards; k++) {
    P(r, fromSeat).jailCards--;
    P(r, toSeat).jailCards++;
    const deck = (P(r, fromSeat).jailFrom || []).pop() || 'chance';
    P(r, toSeat).jailFrom = (P(r, toSeat).jailFrom || []).concat([deck]);
  }
}

function acceptTrade(s, seat) {
  const r = s.round;
  const t = r.trade;
  if (!t || t.to !== seat) fail('Sana gelen bir teklif yok.');
  // Teklif verildiğinden beri durum değiştiyse geçersiz
  const give = cleanSide(r, t.from, t.give);
  const get = cleanSide(r, t.to, t.get);
  // Güncel kural (2025): ipotekli mülk ipotekli olarak geçer; yeni sahibi ipoteği istediği zaman kaldırır, ek faiz yok
  transfer(r, t.from, t.to, give);
  transfer(r, t.to, t.from, get);
  r.trade = null;
  pushEvent(r, { type: 'trade', from: t.from, to: t.to, give: give.props, get: get.props });
  L.addLog(s, `${nameOf(s, t.from)} ile ${nameOf(s, t.to)} takas yaptı.`);
  r.moveNo++;
}
function rejectTrade(s, seat) {
  const r = s.round;
  const t = r.trade;
  if (!t || (t.to !== seat && t.from !== seat)) fail('Bekleyen bir teklif yok.');
  r.trade = null;
  pushEvent(r, { type: 'tradeNo', from: t.from, to: t.to, by: seat });
  L.addLog(s, seat === t.from ? `${nameOf(s, seat)} takas teklifini geri çekti.` : `${nameOf(s, seat)} takas teklifini reddetti.`);
  r.moveNo++;
}

// ---------- Ana giriş ----------
function next(s) {
  if (s.phase !== 'roundEnd') fail('Oyun henüz bitmedi.');
  s.phase = 'gameEnd';
  L.addLog(s, 'Oyun bitti!');
}

// Yönetim işleri (bina, ipotek) sadece kendi sırasında: zar atmadan önce, attıktan sonra ya da borç öderken
function manageOk(r, seat) {
  if (r.turn !== seat) fail('Bunu kendi sıranda yapabilirsin.');
  if (!['roll', 'done', 'debt'].includes(r.phase)) fail('Şu an bunu yapamazsın.');
}

function act(s, seat, a) {
  if (seat < 0) fail('Masada değilsin.');
  if (a.type === 'next') return next(s);
  if (s.phase !== 'playing') fail('Şu an oyun oynanmıyor.');
  const r = s.round;
  if (P(r, seat).bankrupt) fail('İflas ettin; oyunu izleyebilirsin.');
  const pos = Number(a.pos);
  switch (a.type) {
    case 'bid': return bid(s, seat, a.amount);
    case 'passBid': return passBid(s, seat);
    case 'acceptTrade': return acceptTrade(s, seat);
    case 'rejectTrade': return rejectTrade(s, seat);
    default:
  }
  if (r.turn !== seat) fail('Sıra sende değil.');
  if (r.trade && a.type !== 'offer') fail('Önce takas teklifinin cevabını bekle ya da teklifi geri çek.');
  switch (a.type) {
    case 'roll': return roll(s, seat);
    case 'buy': return buy(s, seat);
    case 'decline': return decline(s, seat);
    case 'payJail': payJail(s, seat); return;
    case 'useCard': useJailCard(s, seat); return;
    case 'build': manageOk(r, seat); return build(s, seat, pos);
    case 'sell': manageOk(r, seat); return sellHouse(s, seat, pos);
    case 'mortgage': manageOk(r, seat); return mortgage(s, seat, pos);
    case 'unmortgage': manageOk(r, seat); return unmortgage(s, seat, pos);
    case 'payDebt': return payDebt(s, seat);
    case 'bankrupt':
      if (r.phase !== 'debt') fail('Borcun yok.');
      return bankrupt(s, seat);
    case 'end': return endTurn(s, seat);
    case 'offer': return offer(s, seat, a);
    default: fail('Bilinmeyen hamle.');
  }
}

// ---------- Bot ----------
// Bir mülkün bot için değeri: fiyat; grubu tamamlıyorsa ya da rakibin grubunu bozuyorsa fazlası
function valueFor(r, seat, pos) {
  const sq = BOARD[pos];
  let v = sq.price;
  if (sq.type === 'street') {
    const g = groupMembers(sq.group);
    const mine = g.filter((q) => r.owner[q] === seat).length;
    const others = new Set(g.filter((q) => r.owner[q] >= 0 && r.owner[q] !== seat).map((q) => r.owner[q]));
    if (mine === g.length - 1 && r.owner[pos] !== seat) v *= 2.2; // grubu tamamlar
    else if (mine > 0 && !others.size) v *= 1.4;
    // rakip grubu tamamlamak üzereyse onu engellemek de değerli
    others.forEach((o) => { if (g.filter((q) => r.owner[q] === o).length === g.length - 1) v *= 1.5; });
  } else if (sq.type === 'rail') v *= 1 + 0.25 * railsOwned(r, seat);
  return v;
}
const RESERVE = 150;

function botManage(s, seat, wantCash) {
  const r = s.round;
  const p = P(r, seat);
  // Borçta: önce ipotek (grupsuz mülkler), sonra bina satışı
  if (wantCash) {
    const mort = OWNABLE.filter((q) => !canMortgage(r, seat, q)).sort((a, b) => valueFor(r, seat, a) - valueFor(r, seat, b));
    if (mort.length) { mortgage(s, seat, mort[0]); return true; }
    const sell = STREET_POS.filter((q) => !canSell(r, seat, q)).sort((a, b) => BOARD[a].house - BOARD[b].house);
    if (sell.length) { sellHouse(s, seat, sell[0]); return true; }
    return false;
  }
  // Para fazlaysa: ipotek kaldır, ev kur (en pahalı grubun en az evli arsası, 3 eve kadar öncelik)
  const um = OWNABLE.filter((q) => r.mortgaged[q] && r.owner[q] === seat && p.money - unmortgageCost(q) > RESERVE + 150);
  if (um.length) { unmortgage(s, seat, um[0]); return true; }
  // Önce bir grubu otele kadar tamamla (en çok evli grup, sonra en pahalı): oteller bankaya ev geri verir,
  // herkes her gruba 3'er ev dikip bankayı boşaltınca oyun kilitlenmez
  const bl = STREET_POS.filter((q) => !canBuild(r, seat, q) && p.money - BOARD[q].house > RESERVE)
    .sort((a, b) => r.houses[b] - r.houses[a] || BOARD[b].price - BOARD[a].price);
  if (bl.length && (r.houses[bl[0]] < 3 || p.money > 700)) { build(s, seat, bl[0]); return true; }
  // Bankada ev kalmadıysa ve para boldaysa: ucuz gruptan bir ev satıp pahalı grupta 4. eve (sonra otele) ilerle
  if (r.bankHouses === 0 && p.money > 1200) {
    const up = STREET_POS.filter((q) => r.owner[q] === seat && r.houses[q] === 3 && ownsGroup(r, seat, BOARD[q].group) &&
      groupMembers(BOARD[q].group).every((x) => r.houses[x] >= 3 && !r.mortgaged[x]))
      .sort((a, b) => BOARD[b].price - BOARD[a].price)[0];
    if (up !== undefined) {
      const from = STREET_POS.filter((q) => !canSell(r, seat, q) && BOARD[q].group !== BOARD[up].group && BOARD[q].price < BOARD[up].price)
        .sort((a, b) => BOARD[a].price - BOARD[b].price)[0];
      if (from !== undefined) { sellHouse(s, seat, from); return true; }
    }
  }
  return false;
}

function tradeValue(r, seat, side, sign) {
  // seat açısından tarafın değeri: mülkler (bot değerlemesiyle) + para + kart (40)
  return sign * (side.props.reduce((x, q) => x + valueFor(r, seat, q), 0) + side.money + side.cards * 40);
}

// Bot takas teklifi: bir grubu tamamlamak için eksik tek arsayı sahibinden parayla ister.
// Teklif, karşı tarafın (bot da olsa) kabul edeceği kadar cömerttir; her bot en fazla 3 turda bir dener.
function botTrade(s, seat) {
  const r = s.round;
  const p = P(r, seat);
  r.botTry = r.botTry || {};
  if ((r.botTry[seat] || -99) + 3 > r.roundNo) return false;
  r.botTry[seat] = r.roundNo;
  let best = null;
  GROUPS.forEach((g, gi) => {
    const m = groupMembers(gi);
    if (m.some((q) => r.houses[q] > 0)) return;
    const missing = m.filter((q) => r.owner[q] !== seat);
    if (missing.length !== 1) return;
    const q = missing[0];
    const o = r.owner[q];
    if (o < 0 || o === seat || P(r, o).bankrupt) return;
    // Karşı tarafın gözünden kaybı (botların kabul hesabıyla aynı): arsanın değeri + rakibe grup tamamlatma payı
    const theirLoss = valueFor(r, o, q) + BOARD[q].price * 1.5;
    const ask = Math.ceil((theirLoss * 1.2 + 20) / 10) * 10;
    if (p.money - ask < RESERVE + 100) return;
    const score = BOARD[q].rents[3];
    if (!best || score > best.score) best = { q, o, ask, score };
  });
  if (!best) return false;
  try {
    offer(s, seat, { to: best.o, give: { money: best.ask }, get: { props: [best.q] } });
    return true;
  } catch (e) {
    return false;
  }
}

function botAct(s, seat) {
  const r = s.round;
  const p = P(r, seat);
  if (r.trade && r.trade.to === seat) {
    const t = r.trade;
    // Bot için: alınan (give) - verilen (get). Grubunu bozacak mülkü kolay vermez.
    const gain = tradeValue(r, seat, t.give, 1);
    let loss = tradeValue(r, seat, t.get, 1);
    t.get.props.forEach((q) => { const sq = BOARD[q]; if (sq.type === 'street' && ownsGroup(r, seat, sq.group)) loss += sq.price * 3; });
    // rakibe grubu tamamlatacaksa daha pahalıya verir
    t.get.props.forEach((q) => {
      const sq = BOARD[q];
      if (sq.type !== 'street') return;
      const g = groupMembers(sq.group);
      if (g.filter((x) => r.owner[x] === t.from).length === g.length - 1) loss += sq.price * 1.5;
    });
    try {
      if (gain >= loss * 1.15 && gain - loss >= 20) acceptTrade(s, seat);
      else rejectTrade(s, seat);
    } catch (e) { rejectTrade(s, seat); }
    return;
  }
  if (r.phase === 'auction') {
    const a = r.auction;
    const v = valueFor(r, seat, a.pos);
    const inc = a.high < 100 ? 10 : a.high < 300 ? 20 : 50;
    const limit = Math.min(v * 0.95, p.money - RESERVE / 2);
    const amt = Math.max(10, a.high + inc);
    if (amt <= limit) return bid(s, seat, amt);
    return passBid(s, seat);
  }
  if (r.turn !== seat) return;
  if (r.phase === 'debt') {
    if (p.money >= r.debt.amount) return payDebt(s, seat);
    if (botManage(s, seat, true)) return;
    return bankrupt(s, seat);
  }
  if (r.phase === 'buy') {
    const sq = BOARD[r.offer.pos];
    const v = valueFor(r, seat, r.offer.pos);
    if (p.money >= sq.price && (p.money - sq.price >= RESERVE || v > sq.price * 1.5)) return buy(s, seat);
    return decline(s, seat);
  }
  if (r.phase === 'roll') {
    if (p.jail) {
      // Erken oyunda hapisten çık (mülk toplamak için), geç oyunda hapiste beklemek kira ödememeyi sağlar
      const unowned = OWNABLE.filter((q) => r.owner[q] < 0).length;
      if (p.jailCards) return useJailCard(s, seat);
      if (unowned > 8 && p.money > 200) return payJail(s, seat);
      return roll(s, seat);
    }
    if (botManage(s, seat, false)) return;
    if (botTrade(s, seat)) return;
    return roll(s, seat);
  }
  if (r.phase === 'done') {
    if (botManage(s, seat, false)) return;
    return endTurn(s, seat);
  }
}

// Bot takılmasın: en basit hamle
function botFallback(s, seat) {
  const r = s.round;
  if (r.trade && r.trade.to === seat) return rejectTrade(s, seat);
  if (r.phase === 'auction') return passBid(s, seat);
  if (r.phase === 'debt') return bankrupt(s, seat);
  if (r.phase === 'buy') return decline(s, seat);
  if (r.phase === 'roll') return roll(s, seat);
  if (r.phase === 'done') return endTurn(s, seat);
}

// Şu an kim hamle yapmalı (botlar ve süre için)
function actor(s) {
  const r = s.round;
  if (!r || s.phase !== 'playing') return -1;
  if (r.trade) return r.trade.to;
  if (r.phase === 'auction') return auctionBidder(r);
  return r.turn;
}

// Bot bekleme süresi: piyon yürürken izlensin diye hareketten sonra biraz daha bekler
function botDelay(s) {
  const r = s.round;
  const last = r.events[r.events.length - 1];
  let d = 650 + L.randomInt(400);
  if (r.phase === 'auction' || (r.trade && r.trade.to >= 0)) d = 900 + L.randomInt(500);
  const recent = r.events.slice(-4);
  const mv = recent.filter((e) => e.type === 'move').reduce((x, e) => x + Math.abs(e.steps), 0);
  if (mv) d += Math.min(2600, mv * 110 + 500);
  if (recent.some((e) => e.type === 'card')) d += 1600;
  if (last && last.type === 'roll') d += 500;
  return d;
}

// Süre dolarsa sıradakinin yerine bot oynar (takas teklifi reddedilir)
function tick(s, now) {
  const r = s.round;
  if (s.phase !== 'playing' || !r) return false;
  if (!r.deadline || now < r.deadline + 1200) return false;
  if (r.trade) {
    // Cevap gelmedi: teklif kendiliğinden reddedilir
    L.addLog(s, `${nameOf(s, r.trade.to)} takas teklifine cevap vermedi.`);
    rejectTrade(s, r.trade.to);
    startClock(s);
    return true;
  }
  const who = actor(s);
  if (who < 0) return false;
  L.addLog(s, `${nameOf(s, who)} süresini doldurdu, otomatik oynandı.`);
  try { botAct(s, who); } catch (e) { try { botFallback(s, who); } catch (e2) {} }
  if (s.phase === 'playing' && s.round.deadline < now) startClock(s);
  return true;
}

function view(s, me) {
  const r = s.round;
  return {
    game: 'emlak',
    id: r.id,
    no: r.no,
    active: r.active,
    turn: r.turn,
    phase: r.phase,
    players: r.players.map((p) => ({ pos: p.pos, money: p.money, jail: p.jail, jailCards: p.jailCards, bankrupt: p.bankrupt })),
    owner: r.owner,
    houses: r.houses,
    mortgaged: r.mortgaged,
    bankHouses: r.bankHouses,
    bankHotels: r.bankHotels,
    dice: r.dice,
    doubles: r.doubles,
    offer: r.offer ? r.offer.pos : null,
    debt: r.debt ? { amount: r.debt.amount, to: r.debt.to, reason: r.debt.reason } : null,
    auction: r.auction ? { pos: r.auction.pos, high: r.auction.high, highSeat: r.auction.highSeat, bidder: auctionBidder(r), out: r.auction.out } : null,
    trade: r.trade,
    card: r.card,
    pot: r.pot,
    otopark: !!s.settings.emlakOtopark,
    roundNo: r.roundNo,
    turnsLimit: r.turnsLimit,
    worths: [0, 1, 2, 3].map((i) => (r.active[i] ? worth(r, i) : 0)),
    actor: actor(s),
    events: r.events,
    evId: r.evId,
    moveNo: r.moveNo,
    remainingMs: r.deadline ? Math.max(0, r.deadline - Date.now()) : null,
    result: r.result,
    hand: [],
    handCounts: [0, 0, 0, 0],
  };
}

module.exports = {
  deal, act, view, tick, botAct, botFallback, actor, botDelay,
  BOARD, GROUPS, SEMTLER, SEMT_KAYNAK, CHANCE, CHEST, OWNABLE, STREET_POS, RAILS, UTILS, RAIL_RENT,
  MONEY_CHOICES, TURN_CHOICES, GO_MONEY, JAIL_FINE,
  rentFor, worth, liquidity, canBuild, canSell, canMortgage, canUnmortgage, unmortgageCost, groupMembers, ownsGroup,
  rollWith,
};
