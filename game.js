'use strict';
/* Masa (lobi, koltuklar, ayarlar) ve 101 Okey oyunu. Pişti ve Uno kendi dosyalarında.
   Sunucu bunu kullanır; testler de doğrudan bunu çağırır. */
const E = require('./public/engine.js');
const crypto = require('crypto');
const { GameError, fail, shuffle, newToken, addLog, nameOf, startClock } = require('./lib.js');
const P = require('./pisti.js');
const U = require('./uno.js');

// Kart oyunları: masadaki oyun pişti ya da uno ise hamleler o dosyaya gider
const CARD = { pisti: P, uno: U };
const cardGame = (s) => (s.round && CARD[s.round.game]) || null;

const GAMES = ['okey', 'pisti', 'uno'];
const DEFAULTS = { game: 'okey', rounds: 5, mode: 'solo', katlamali: false, turnSecs: 30, pistiTarget: 101, unoTarget: 200, unoStack: false };
const TURN_CHOICES = [0, 20, 30, 45, 60];

function create() {
  return {
    v: 1,
    seq: 0,
    phase: 'lobby', // lobby | playing | roundEnd | gameEnd
    seats: [null, null, null, null], // {name, token, bot?}
    settings: Object.assign({}, DEFAULTS),
    startSeat: 0,
    history: [],
    round: null,
    log: [],
  };
}

// Eski kayıtları yeni sürüme uyarlar.
function normalize(s) {
  s.settings = Object.assign({}, DEFAULTS, s.settings || {});
  if (typeof s.seq !== 'number') s.seq = 0;
  if (!Array.isArray(s.log)) s.log = [];
  if (!Array.isArray(s.history)) s.history = [];
  const r = s.round;
  if (r && CARD[r.game]) {
    if (s.phase === 'playing') startClock(s);
  } else if (r) {
    // Eski sürümde yandan alınıp elde kalan taş: geri bırak, sıra yeniden çekişe dönsün
    if (r.took !== null && r.took !== undefined && s.phase === 'playing') {
      const left = (r.turn + 3) % 4;
      r.hands[r.turn] = r.hands[r.turn].filter((id) => id !== r.took);
      r.discards[left].push(r.took);
      r.lastDiscardSeat = left;
      r.tphase = 'draw';
    }
    r.took = null;
    if (s.phase === 'playing') startClock(s);
  }
  return s;
}

const BOT_NAMES = ['Bot Ali', 'Bot Ayşe', 'Bot Can', 'Bot Zeynep', 'Bot Mehmet', 'Bot Elif'];
function botName(s) {
  const taken = new Set(s.seats.filter(Boolean).map((p) => p.name.toLocaleLowerCase('tr')));
  return BOT_NAMES.find((n) => !taken.has(n.toLocaleLowerCase('tr'))) || 'Bot';
}
const completedRounds = (s) => s.history.filter((h) => h.counted).length;
const isTeam = (s) => s.settings.mode === 'team';
const partnerOf = (seat) => (seat + 2) % 4;

// ---------- Süre ----------
// Süre dolduysa sıradakini otomatik oynatır. Bir şey değiştiyse true döner.
function tick(s, now) {
  const M = cardGame(s);
  if (M) return M.tick(s, now || Date.now());
  const r = s.round;
  if (s.phase !== 'playing' || !r || !r.deadline) return false;
  if ((now || Date.now()) < r.deadline + 1200) return false; // ağ gecikmesi için küçük pay
  autoPlay(s);
  return true;
}

function autoPlay(s) {
  const r = s.round;
  const seat = r.turn;
  addLog(s, `${nameOf(s, seat)} süresini doldurdu, otomatik oynandı.`);
  if (r.tphase === 'draw') {
    if (!r.stock.length) {
      endRoundNoWin(s, 'stock');
      return;
    }
    act(s, seat, { type: 'draw' });
  }
  const hand = r.hands[seat];
  const safe = (id) => !E.isWild(id, r.okey) && !E.isLayable(id, r.melds, r.okey);
  let pick = r.lastDrawn !== null && hand.includes(r.lastDrawn) && safe(r.lastDrawn) ? r.lastDrawn : hand.find(safe);
  if (pick === undefined) pick = hand.find((id) => !E.isWild(id, r.okey));
  if (pick === undefined) pick = hand[0];
  act(s, seat, { type: 'discard', tile: pick });
}

// ---------- Lobi ----------
function seatOf(s, token) {
  if (!token) return -1;
  return s.seats.findIndex((p) => p && p.token === token);
}

function join(s, name, token, isOnline, wantSeat) {
  const existing = seatOf(s, token);
  name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 14);
  if (existing >= 0) {
    if (name && s.phase === 'lobby') s.seats[existing].name = name;
    if (s.phase === 'lobby' && wantSeat >= 0 && wantSeat < 4 && !s.seats[wantSeat]) {
      s.seats[wantSeat] = s.seats[existing];
      s.seats[existing] = null;
      return { seat: wantSeat, token };
    }
    return { seat: existing, token };
  }
  if (!name) fail('Önce adını yaz.');
  const same = s.seats.findIndex((p) => p && p.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
  if (same >= 0) {
    if (s.seats[same].bot || isOnline(s.seats[same].token)) fail('Bu isim masada zaten var, başka bir isim yaz.');
    // Bağlantısı kopmuş oyuncu aynı isimle yerine döner (telefon değişse bile).
    s.seats[same].token = newToken();
    addLog(s, `${s.seats[same].name} geri döndü.`);
    return { seat: same, token: s.seats[same].token };
  }
  // Botun ya da bağlantısı kopmuş birinin yeri boşaltılabilir/devralınabilir
  const replaceable = (p) => p && (p.bot || !isOnline(p.token));
  if (s.phase !== 'lobby') {
    // Oyun sürerken gelen biri bir botun ya da bağlantısı kopan birinin yerine geçebilir (elindekilerle devam eder)
    const take = wantSeat >= 0 && wantSeat < 4 && replaceable(s.seats[wantSeat]) ? wantSeat : -1;
    if (take < 0) fail(s.seats.some(replaceable) ? 'Oyun sürüyor. Bir botun ya da bağlantısı kopan birinin altındaki "yerine geç"e dokun.' : 'Oyun başladı, masa dolu. Masadaysan adını aynen yaz.');
    const old = s.seats[take].name;
    const t = newToken();
    s.seats[take] = { name, token: t };
    addLog(s, `${name}, ${old} yerine oyuna girdi.`);
    return { seat: take, token: t };
  }
  let free = wantSeat >= 0 && wantSeat < 4 && !s.seats[wantSeat] ? wantSeat : s.seats.findIndex((p) => !p);
  if (free < 0) fail(s.seats.some(replaceable) ? 'Masa dolu. Bağlantısı olmayan birinin ya da botun altındaki "çıkar"a dokun, boşalan yere otur.' : 'Masa dolu (4 kişi).');
  const t = newToken();
  s.seats[free] = { name, token: t };
  addLog(s, `${name} masaya oturdu.`);
  return { seat: free, token: t };
}

// ---------- El dağıtma ----------
function deal(s) {
  const deck = shuffle([...Array(E.TILE_COUNT).keys()]);
  const indIdx = deck.findIndex((id) => id < 104);
  const indicator = deck.splice(indIdx, 1)[0];
  const okey = E.okeyFromIndicator(indicator);
  const hands = [[], [], [], []];
  for (let k = 0; k < 4; k++) {
    const seat = (s.startSeat + k) % 4;
    hands[seat] = deck.splice(0, k === 0 ? 22 : 21);
  }
  s.round = {
    id: newToken(),
    no: completedRounds(s) + 1,
    indicator,
    okey,
    stock: deck,
    hands,
    discards: [[], [], [], []],
    melds: [],
    meldSeq: 1,
    opened: [null, null, null, null],
    openValue: [0, 0, 0, 0],
    openedTurn: [-1, -1, -1, -1],
    penalties: [0, 0, 0, 0],
    turn: s.startSeat,
    tphase: 'play', // ilk oyuncu 22 taşla çekmeden atar
    turnNo: 0,
    took: null,
    acts: 0,
    lastDrawn: null,
    lastDiscardSeat: -1,
    deadline: 0,
    result: null,
  };
  s.phase = 'playing';
  startClock(s);
  addLog(s, `${s.round.no}. el başladı. ${nameOf(s, s.startSeat)} başlıyor.`);
}

// ---------- Yardımcılar ----------
function requireTurn(s, seat, tphase) {
  if (s.phase !== 'playing') fail('Şu an oyun oynanmıyor.');
  const r = s.round;
  if (r.turn !== seat) fail('Sıra sende değil.');
  if (tphase && r.tphase !== tphase) {
    fail(tphase === 'draw' ? 'Bu turda zaten taş aldın.' : 'Önce taş çekmelisin.');
  }
  return r;
}

// Açış için gereken en az değer (seri: puan, çift: çift sayısı).
// Katlamalıda rakiplerin en yüksek açışının bir fazlası gerekir; eşe katlama yapılmaz.
function openReq(s, seat, mode) {
  const r = s.round;
  const base = mode === 'pairs' ? 5 : 101;
  if (!s.settings.katlamali || !r || seat < 0) return base;
  let need = base;
  for (let i = 0; i < 4; i++) {
    if (i === seat || r.opened[i] !== mode) continue;
    if (isTeam(s) && i === partnerOf(seat)) continue;
    need = Math.max(need, r.openValue[i] + 1);
  }
  return need;
}

function parseMelds(r, seat, melds, mode) {
  if (!Array.isArray(melds) || !melds.length) fail('Per seçmedin.');
  const hand = r.hands[seat];
  const seen = new Set();
  const out = [];
  for (const m of melds) {
    if (!Array.isArray(m)) fail('Geçersiz per.');
    for (const id of m) {
      if (!Number.isInteger(id) || !hand.includes(id)) fail('Bu taş elinde yok.');
      if (seen.has(id)) fail('Aynı taş iki kez kullanılamaz.');
      seen.add(id);
    }
    // 'mixed': seriyle açan, masada çift açan varsa çift de indirebilir
    const res = mode === 'mixed' ? E.interpret(m, r.okey, m.length === 2 ? 'pairs' : 'runs') : E.interpret(m, r.okey, mode);
    if (!res) fail(mode === 'pairs' ? 'Geçersiz çift var.' : mode === 'mixed' ? 'Geçersiz per ya da çift var.' : 'Geçersiz per var (seri ya da grup değil).');
    out.push(res);
  }
  return { list: out, used: seen };
}

// Çift indirebilir mi: çiftle açan ya da seriyle açmış ama masada çift açan biri var
function pairsAllowed(r, seat) {
  const m = r.opened[seat];
  return m === 'pairs' || (m === 'runs' && r.opened.some((o) => o === 'pairs'));
}

function placeMelds(r, seat, list, used) {
  r.hands[seat] = r.hands[seat].filter((id) => !used.has(id));
  for (const m of list) {
    m.id = r.meldSeq++;
    m.owner = seat;
    r.melds.push(m);
  }
  if (r.took !== null && used.has(r.took)) r.took = null;
}

// Yandan taş: ancak aynı hamlede kullanılırsa ele geçer. Hamle olmazsa hiçbir şey değişmez,
// taş yerinde kalır (eski sürümdeki "elde kalma" sorunu böylece olmaz).
function sideAction(s, seat, a) {
  const r0 = requireTurn(s, seat, 'draw');
  const left = (seat + 3) % 4;
  const pile = r0.discards[left];
  if (!pile.length || r0.lastDiscardSeat !== left) fail('Yandan alınacak taş yok.');
  const id = pile[pile.length - 1];
  if ((a.type === 'add' || a.type === 'swap') && a.tile !== id) fail('Yandan aldığın taşı işlemelisin.');
  const snap = JSON.parse(JSON.stringify(r0));
  r0.discards[left].pop();
  r0.hands[seat].push(id);
  r0.tphase = 'play';
  r0.took = id;
  try {
    act(s, seat, Object.assign({}, a, { side: false }));
    if (s.round.hands[seat].includes(id)) fail('Yandan aldığın taşı bu hamlede kullanmalısın.');
  } catch (e) {
    // Yerinde geri al (eldeki referanslar geçerli kalsın)
    Object.keys(r0).forEach((k) => delete r0[k]);
    Object.assign(r0, snap);
    s.round = r0;
    throw e;
  }
  const r = s.round;
  r.took = null;
  r.lastDrawn = id;
  addLog(s, `${nameOf(s, seat)}, ${nameOf(s, left)}'in attığı taşı alıp kullandı.`);
}

// ---------- Hamleler ----------
function meldIndex(r, meldId) {
  const idx = r.melds.findIndex((m) => m.id === meldId);
  if (idx < 0) fail('Per bulunamadı.');
  return idx;
}

// Taş işleme (pere ekleme)
function doAdd(r, seat, a) {
  const id = a.tile;
  if (!r.hands[seat].includes(id)) fail('Bu taş elinde yok.');
  const idx = meldIndex(r, a.meld);
  const res = E.addToMeld(r.melds[idx], id, r.okey, a.at);
  if (!res) fail('Bu taş bu pere işlenemez.');
  if (r.hands[seat].length - 1 < 1) fail('Son taşı atarak bitirmelisin.');
  res.id = r.melds[idx].id;
  res.owner = r.melds[idx].owner;
  r.melds[idx] = res;
  r.hands[seat] = r.hands[seat].filter((x) => x !== id);
  if (r.took === id) r.took = null;
  r.acts++;
}

// Masadaki okeyi alma: okeyin yerine geçtiği taş pere girer, okey ele geçer.
function doSwap(r, seat, a) {
  const id = a.tile;
  if (!r.hands[seat].includes(id)) fail('Bu taş elinde yok.');
  const idx = meldIndex(r, a.meld);
  const res = E.swapOkey(r.melds[idx], id, r.okey);
  if (!res) fail('Bu taş bu perdeki okeyin yerine geçmez.');
  res.meld.id = r.melds[idx].id;
  res.meld.owner = r.melds[idx].owner;
  r.melds[idx] = res.meld;
  r.hands[seat] = r.hands[seat].filter((x) => x !== id).concat([res.okeyId]);
  if (r.took === id) r.took = null;
  r.acts++;
}

function act(s, seat, a) {
  if (seat < 0) fail('Masada değilsin.');
  const M = cardGame(s);
  if (M) return M.act(s, seat, a || {});
  const type = a && a.type;
  if (a && a.side && (type === 'open' || type === 'meld' || type === 'add' || type === 'swap' || type === 'batch')) return sideAction(s, seat, a);
  switch (type) {
    case 'draw': {
      const r = requireTurn(s, seat, 'draw');
      if (!r.stock.length) fail('Deste bitti.');
      const id = r.stock.pop();
      r.hands[seat].push(id);
      r.lastDrawn = id;
      r.tphase = 'play';
      return;
    }
    case 'open': {
      const r = requireTurn(s, seat, 'play');
      if (r.opened[seat]) fail('Zaten açtın.');
      const mode = a.mode === 'pairs' ? 'pairs' : 'runs';
      const { list, used } = parseMelds(r, seat, a.melds, mode);
      if (r.took !== null && !used.has(r.took)) fail('Yandan aldığın taşı açarken kullanmalısın.');
      const remaining = r.hands[seat].length - used.size;
      if (remaining < 1) fail('Atacak bir taş bırakmalısın.');
      const need = openReq(s, seat, mode);
      let value;
      if (mode === 'runs') {
        value = list.reduce((x, m) => x + m.value, 0);
        // Tek seferde tüm eli (1 taş hariç) elden indiren, sınıra ulaşmasa da açabilir.
        if (value < need && !(remaining === 1 && used.size >= 20)) fail(`Toplam ${value}. Açmak için en az ${need} gerekli.`);
      } else {
        value = list.length;
        if (value < need) fail(`${value} çift var. Çiftten açmak için en az ${need} çift gerekli.`);
      }
      placeMelds(r, seat, list, used);
      r.opened[seat] = mode;
      r.openValue[seat] = value;
      r.openedTurn[seat] = r.turnNo;
      r.acts++;
      addLog(s, mode === 'runs' ? `${nameOf(s, seat)} ${value} ile açtı.` : `${nameOf(s, seat)} ${value} çiftle açtı.`);
      if (r.opened.every((o) => o === 'pairs')) endRoundNoWin(s, 'allPairs');
      return;
    }
    case 'meld': {
      const r = requireTurn(s, seat, 'play');
      const mode = r.opened[seat];
      if (!mode) fail('Önce elini açmalısın.');
      const { list, used } = parseMelds(r, seat, a.melds, pairsAllowed(r, seat) && mode === 'runs' ? 'mixed' : mode);
      if (r.took !== null && !used.has(r.took)) fail('Yandan aldığın taşı kullanmalısın.');
      if (r.hands[seat].length - used.size < 1) fail('Atacak bir taş bırakmalısın.');
      placeMelds(r, seat, list, used);
      r.acts++;
      addLog(s, `${nameOf(s, seat)} yeni per indirdi.`);
      return;
    }
    case 'add': {
      const r = requireTurn(s, seat, 'play');
      if (!r.opened[seat]) fail('Taş işlemek için önce elini açmalısın.');
      if (r.took !== null && a.tile !== r.took) fail('Yandan aldığın taşı kullanmalısın.');
      doAdd(r, seat, a);
      return;
    }
    case 'swap': {
      const r = requireTurn(s, seat, 'play');
      if (!r.opened[seat]) fail('Masadaki okeyi almak için önce elini açmalısın.');
      if (r.took !== null && a.tile !== r.took) fail('Yandan aldığın taşı kullanmalısın.');
      doSwap(r, seat, a);
      addLog(s, `${nameOf(s, seat)} masadaki okeyi aldı.`);
      return;
    }
    case 'batch': {
      // "İşle" düğmesi: birden çok işleme / okey alma tek seferde; biri olmazsa hiçbiri olmaz.
      const r = requireTurn(s, seat, 'play');
      if (!r.opened[seat]) fail('Taş işlemek için önce elini açmalısın.');
      const ops = Array.isArray(a.ops) ? a.ops : [];
      if (!ops.length) fail('İşlenecek taş yok.');
      if (ops.length > 30) fail('Çok fazla hamle.');
      const snap = JSON.parse(JSON.stringify(r));
      const took = r.took;
      r.took = null;
      let adds = 0, swaps = 0;
      try {
        for (const op of ops) {
          if (op && op.type === 'add') { doAdd(r, seat, op); adds++; }
          else if (op && op.type === 'swap') { doSwap(r, seat, op); swaps++; }
          else fail('Geçersiz hamle.');
        }
        if (took !== null && r.hands[seat].includes(took)) fail('Yandan aldığın taşı kullanmalısın.');
      } catch (e) {
        Object.keys(r).forEach((k) => delete r[k]);
        Object.assign(r, snap);
        throw e;
      }
      const parts = [];
      if (swaps) parts.push(swaps > 1 ? `masadan ${swaps} okey aldı` : 'masadaki okeyi aldı');
      if (adds) parts.push(`${adds} taş işledi`);
      addLog(s, `${nameOf(s, seat)} ${parts.join(', ')}.`);
      return;
    }
    case 'discard': {
      const r = requireTurn(s, seat, 'play');
      const id = a.tile;
      const hand = r.hands[seat];
      if (!hand.includes(id)) fail('Bu taş elinde yok.');
      if (r.took !== null) fail('Yandan aldığın taşı bu turda kullanmalısın.');
      const finishing = hand.length === 1;
      if (!finishing) {
        if (E.isWild(id, r.okey)) {
          r.penalties[seat] += 101;
          addLog(s, `${nameOf(s, seat)} okey attı: +101 ceza!`);
        } else if (E.isLayable(id, r.melds, r.okey)) {
          r.penalties[seat] += 101;
          addLog(s, `${nameOf(s, seat)} işlek taş attı: +101 ceza!`);
        }
      }
      r.hands[seat] = hand.filter((x) => x !== id);
      r.discards[seat].push(id);
      r.lastDiscardSeat = seat;
      if (finishing) {
        finishWin(s, seat, id);
        return;
      }
      // Ortada taş kalmadıysa el burada biter (sıradaki oyuncu yandan alamaz)
      if (!r.stock.length) {
        endRoundNoWin(s, 'stock');
        return;
      }
      r.turn = (seat + 1) % 4;
      r.tphase = 'draw';
      r.turnNo++;
      r.took = null;
      r.acts = 0;
      r.lastDrawn = null;
      startClock(s);
      return;
    }
    case 'endStock': {
      const r = requireTurn(s, seat, 'draw');
      if (r.stock.length) fail('Destede hâlâ taş var.');
      endRoundNoWin(s, 'stock');
      return;
    }
    case 'next': {
      if (s.phase !== 'roundEnd') fail('El henüz bitmedi.');
      if (completedRounds(s) >= s.settings.rounds) {
        s.phase = 'gameEnd';
        addLog(s, 'Oyun bitti!');
      } else deal(s);
      return;
    }
    default:
      fail('Bilinmeyen hamle.');
  }
}

function finishWin(s, w, lastTile) {
  const r = s.round;
  const lastOkey = E.isWild(lastTile, r.okey);
  const elden = r.openedTurn[w] === r.turnNo && r.opened.every((o, i) => i === w || !o);
  const base = E.scoreWin({ winner: w, opened: r.opened, hands: r.hands, okey: r.okey, lastOkey, elden });
  // Eşlide bitenin eşinin el cezası silinir.
  if (isTeam(s)) base[partnerOf(w)] = 0;
  let note = `${nameOf(s, w)} bitti`;
  if (elden) note += ' (elden)';
  else if (r.opened[w] === 'pairs') note += ' (çiftten)';
  if (lastOkey) note += ', okey atarak';
  note += '!';
  closeRound(s, { kind: 'win', winner: w, base, lastOkey, elden, note });
}

function endRoundNoWin(s, kind) {
  const r = s.round;
  let base, note;
  if (kind === 'stock') {
    // Deste bitti, kimse bitiremedi: açan elindeki taşların toplamını (çiftle açan iki katını),
    // açmayan 202 yazar. Elde kalan okey 101 sayılır.
    base = r.hands.map((h, i) => (r.opened[i] === 'runs' ? E.handValue(h, r.okey) : r.opened[i] === 'pairs' ? E.handValue(h, r.okey) * 2 : 202));
    note = 'Deste bitti, kimse bitiremedi.';
  } else {
    base = r.hands.map((h) => h.filter((id) => E.isWild(id, r.okey)).length * 101);
    note = 'Herkes çiftten açtı, el puansız bitti.';
  }
  closeRound(s, { kind, winner: -1, base, lastOkey: false, elden: false, note });
}

function closeRound(s, res) {
  const r = s.round;
  const total = res.base.map((b, i) => b + r.penalties[i]);
  r.deadline = 0;
  r.result = Object.assign({}, res, {
    penalties: r.penalties.slice(),
    total,
    hands: r.hands.map((h) => h.slice()),
  });
  s.history.push({ no: r.no, kind: res.kind, winner: res.winner, total, counted: true, note: res.note });
  s.phase = 'roundEnd';
  // Her elden sonra (biten olsun olmasın) başlama sırası bir sonraki oyuncuya geçer
  s.startSeat = (s.startSeat + 1) % 4;
  addLog(s, res.note);
}

// ---------- Ana giriş ----------
function lobbyAction(s, seat, a, isOnline) {
  switch (a.type) {
    case 'sit': {
      if (s.phase !== 'lobby') fail('Oyun başladı.');
      const to = a.seat;
      if (!(to >= 0 && to < 4) || s.seats[to]) fail('Bu koltuk dolu.');
      s.seats[to] = s.seats[seat];
      s.seats[seat] = null;
      return;
    }
    case 'leave': {
      if (s.phase !== 'lobby') fail('Oyun sürerken kalkılamaz.');
      addLog(s, `${nameOf(s, seat)} masadan kalktı.`);
      s.seats[seat] = null;
      return;
    }
    case 'addBot':
    case 'fillBots': {
      if (s.phase !== 'lobby') fail('Bot, oyun başlamadan eklenir.');
      const targets = a.type === 'fillBots' ? [0, 1, 2, 3].filter((i) => !s.seats[i]) : [a.seat];
      if (!targets.length) fail('Boş koltuk yok.');
      for (const t of targets) {
        if (!(t >= 0 && t < 4) || s.seats[t]) fail('Bu koltuk dolu.');
        s.seats[t] = { name: botName(s), token: newToken(), bot: true };
        addLog(s, `${s.seats[t].name} masaya oturdu.`);
      }
      return;
    }
    case 'kick': {
      // Masaya oturmamış biri de yapabilir: bağlantısı kopanı ya da botu kaldırıp yer açar
      if (s.phase !== 'lobby') fail('Oyun sürerken çıkarılamaz; istersen yerine bot koy.');
      const t = a.seat;
      if (!(t >= 0 && t < 4) || !s.seats[t]) fail('Koltuk boş.');
      if (!s.seats[t].bot && isOnline(s.seats[t].token)) fail('Bağlı oyuncu çıkarılamaz.');
      addLog(s, `${nameOf(s, t)} masadan çıkarıldı.`);
      s.seats[t] = null;
      return;
    }
    case 'botSeat': {
      // Bağlantısı kopan birinin yerine bot oturur (oyun sürerken de); kişi dönerse "yerine geç" ile devralır
      const t = a.seat;
      const p = s.seats[t];
      if (!(t >= 0 && t < 4) || !p) fail('Koltuk boş.');
      if (p.bot) fail('Orada zaten bot var.');
      if (isOnline(p.token)) fail('Bağlı oyuncunun yerine bot konmaz.');
      const bot = { name: botName(s), token: newToken(), bot: true };
      s.seats[t] = bot;
      addLog(s, `${p.name} yerine ${bot.name} oturdu.`);
      return;
    }
    case 'rounds':
      return lobbyAction(s, seat, { type: 'settings', rounds: a.rounds }, isOnline);
    case 'settings': {
      if (s.phase !== 'lobby') fail('Ayarlar oyun başlamadan değiştirilebilir.');
      const st = s.settings;
      if (a.rounds !== undefined) {
        const n = parseInt(a.rounds, 10);
        if (!(n >= 1 && n <= 21)) fail('Geçersiz el sayısı.');
        st.rounds = n;
      }
      if (a.mode !== undefined) st.mode = a.mode === 'team' ? 'team' : 'solo';
      if (a.katlamali !== undefined) st.katlamali = !!a.katlamali;
      if (a.turnSecs !== undefined) {
        const t = parseInt(a.turnSecs, 10);
        if (!TURN_CHOICES.includes(t)) fail('Geçersiz süre.');
        st.turnSecs = t;
      }
      if (a.game !== undefined) {
        if (!GAMES.includes(a.game)) fail('Geçersiz oyun.');
        st.game = a.game;
      }
      if (a.pistiTarget !== undefined) {
        const t = parseInt(a.pistiTarget, 10);
        if (!P.TARGETS.includes(t)) fail('Geçersiz hedef puan.');
        st.pistiTarget = t;
      }
      if (a.unoTarget !== undefined) {
        const t = parseInt(a.unoTarget, 10);
        if (!U.TARGETS.includes(t)) fail('Geçersiz hedef puan.');
        st.unoTarget = t;
      }
      if (a.unoStack !== undefined) st.unoStack = !!a.unoStack;
      return;
    }
    case 'start': {
      if (s.phase !== 'lobby') fail('Oyun zaten başladı.');
      const game = s.settings.game || 'okey';
      const seated = s.seats.filter(Boolean);
      if (game === 'okey') {
        if (s.seats.some((p) => !p)) fail('Başlamak için 4 kişi gerekli. Boş yerlere bot oturtabilirsin.');
      } else {
        if (seated.length < 2) fail('Başlamak için en az 2 kişi gerekli. Boş yerlere bot oturtabilirsin.');
        if (game === 'pisti' && s.settings.mode === 'team' && seated.length < 4) fail('Eşli pişti için 4 kişi gerekli.');
      }
      if (seated.every((p) => p.bot)) fail('Masada en az bir kişi olmalı.');
      s.history = [];
      const occupied = [0, 1, 2, 3].filter((i) => s.seats[i]);
      s.startSeat = occupied[crypto.randomInt(occupied.length)];
      if (game === 'okey') deal(s);
      else CARD[game].deal(s);
      return;
    }
    case 'reset': {
      s.phase = 'lobby';
      s.round = null;
      s.history = [];
      addLog(s, `${nameOf(s, seat)} oyunu sıfırladı.`);
      return;
    }
    default:
      return act(s, seat, a);
  }
}

// Lobide uzun süredir bağlantısı olmayanlar kendiliğinden kalkar (telefonu kapatıp giden yer tutmasın)
function dropAway(s, isAway) {
  if (s.phase !== 'lobby') return false;
  let changed = false;
  s.seats.forEach((p, i) => {
    if (p && !p.bot && isAway(p.token)) {
      addLog(s, `${p.name} uzun süredir bağlı değil, masadan kalktı.`);
      s.seats[i] = null;
      changed = true;
    }
  });
  return changed;
}

function teamTotals(totals) {
  return [totals[0] + totals[2], totals[1] + totals[3]];
}

function view(s, token, isOnline, extra) {
  const me = seatOf(s, token);
  const totals = [0, 0, 0, 0];
  s.history.forEach((h) => h.total.forEach((x, i) => (totals[i] += x)));
  const v = {
    seq: s.seq,
    boot: (extra && extra.boot) || '',
    phase: s.phase,
    me,
    seats: s.seats.map((p) => (p ? { name: p.name, online: !!p.bot || isOnline(p.token), bot: !!p.bot } : null)),
    settings: s.settings,
    history: s.history,
    totals,
    teamTotals: teamTotals(totals),
    completed: completedRounds(s),
    log: s.log.slice(-20),
    lan: (extra && extra.lan) || [],
  };
  const r = s.round;
  const M = cardGame(s);
  if (M && s.phase !== 'lobby') {
    v.round = M.view(s, me);
  } else if (r && s.phase !== 'lobby') {
    const left = me >= 0 ? (me + 3) % 4 : -1;
    const canTake = me >= 0 && s.phase === 'playing' && r.turn === me && r.tphase === 'draw' &&
      r.discards[left].length > 0 && r.lastDiscardSeat === left;
    v.round = {
      id: r.id,
      no: r.no,
      indicator: r.indicator,
      okey: r.okey,
      stockCount: r.stock.length,
      hand: me >= 0 ? r.hands[me].slice() : [],
      handCounts: r.hands.map((h) => h.length),
      discards: r.discards.map((d) => ({ top: d.length ? d[d.length - 1] : null, count: d.length })),
      melds: r.melds,
      opened: r.opened,
      openValue: r.openValue,
      penalties: r.penalties,
      turn: r.turn,
      tphase: r.tphase,
      turnNo: r.turnNo,
      lastDrawn: me === r.turn ? r.lastDrawn : null,
      sideTile: canTake ? r.discards[left][r.discards[left].length - 1] : null,
      canTake,
      req: { runs: openReq(s, me, 'runs'), pairs: openReq(s, me, 'pairs') },
      remainingMs: r.deadline ? Math.max(0, r.deadline - Date.now()) : null,
      result: r.result,
    };
  }
  return v;
}

module.exports = { create, normalize, join, lobbyAction, act, view, seatOf, deal, tick, dropAway, openReq, pairsAllowed, GameError, newToken, TURN_CHOICES, GAMES, CARD };
