'use strict';
/* Boş koltuklar için bilgisayar oyuncusu. Sunucu her 400 ms'de step() çağırır;
   bot sırası geldiyse biraz bekleyip (insan gibi) hamlesini yapar. */
const E = require('./public/engine.js');
const G = require('./game.js');

const DRAW_DELAY = [700, 1200];
const PLAY_DELAY = [1000, 1700];
const rand = (a) => a[0] + Math.floor(Math.random() * (a[1] - a[0]));

// Okeyle tamamlanan çiftler dahil, eldeki çiftler
function pairsWithWild(tiles, okey) {
  const sp = E.suggestPairs(tiles, okey);
  const pairs = sp.pairs.map((p) => p.slice());
  const rest = sp.rest.slice().sort((a, b) => E.natural(b, okey).n - E.natural(a, okey).n);
  for (const w of sp.wild) {
    if (rest.length) pairs.push([rest.shift(), w]);
  }
  return pairs;
}

// Açılabiliyorsa açış hamlesini döndürür. must: mutlaka kullanılacak taş (yandan alınan)
function bestOpen(s, seat, tiles, must) {
  const r = s.round, okey = r.okey;
  const uses = (groups) => must === null || groups.some((g) => g.includes(must));
  const needR = G.openReq(s, seat, 'runs');
  const sug = E.suggestMelds(tiles, okey);
  let melds = sug.melds.slice();
  const val = (gs) => gs.reduce((a, g) => a + ((E.interpret(g, okey, 'runs') || {}).value || 0), 0);
  const used = (gs) => gs.reduce((a, g) => a + g.length, 0);
  // Elde atacak bir taş kalmalı: gerekirse en küçük peri bırak
  while (melds.length && tiles.length - used(melds) < 1) {
    const sorted = melds.slice().sort((a, b) => val([a]) - val([b]));
    melds = melds.filter((g) => g !== sorted[0]);
  }
  if (melds.length && uses(melds)) {
    const left = tiles.length - used(melds);
    if ((val(melds) >= needR && left >= 1) || (left === 1 && used(melds) >= 20)) {
      return { type: 'open', mode: 'runs', melds };
    }
  }
  const needP = G.openReq(s, seat, 'pairs');
  let pairs = pairsWithWild(tiles, okey);
  while (pairs.length && tiles.length - pairs.length * 2 < 1) pairs = pairs.slice(0, -1);
  if (pairs.length >= needP && uses(pairs)) return { type: 'open', mode: 'pairs', melds: pairs };
  return null;
}

function tryAct(s, seat, a) {
  try {
    G.act(s, seat, a);
    return true;
  } catch (e) {
    if (e instanceof G.GameError) return false;
    throw e;
  }
}

// Atılacak taş: okey ve işlek taş atılmaz (ceza); perlere/çiftlere girecek taşlar tutulur.
// Geri kalanlardan işe yaramayanlar arasında en küçük sayılı olan atılır
// (yarıyor gibi duranlar, yani yanında komşusu olanlar en sona kalır).
function chooseDiscard(s, seat) {
  const r = s.round, okey = r.okey, hand = r.hands[seat];
  if (hand.length === 1) return hand[0];
  const bad = (id) => E.isWild(id, okey) || E.isLayable(id, r.melds, okey);
  let pool = hand.filter((id) => !bad(id));
  if (!pool.length) {
    // hepsi okey ya da işlek: en azından okeyi atma, en küçük işlek taşı at
    const nonWild = hand.filter((id) => !E.isWild(id, okey));
    if (!nonWild.length) return hand[0];
    return nonWild.sort((x, y) => E.natural(x, okey).n - E.natural(y, okey).n)[0];
  }
  const opened = r.opened[seat];
  const pairish = opened === 'pairs' || (!opened && E.suggestPairs(hand, okey).pairs.length >= 4);
  const keep = new Set();
  if (pairish) E.suggestPairs(hand, okey).pairs.forEach((g) => g.forEach((id) => keep.add(id)));
  else E.suggestMelds(hand, okey).melds.forEach((g) => g.forEach((id) => keep.add(id)));
  if (opened === 'runs' && G.pairsAllowed(r, seat)) E.suggestPairs(hand, okey).pairs.forEach((g) => g.forEach((id) => keep.add(id)));
  const free = pool.filter((id) => !keep.has(id));
  if (free.length) pool = free;
  const nat = (id) => E.natural(id, okey);
  // 0: hiç işe yaramıyor, 1: zayıf ihtimal, 2: güçlü ihtimal (yanında komşusu var)
  const use = (id) => {
    const a = nat(id);
    let best = 0;
    for (const o of hand) {
      if (o === id || E.isWild(o, okey)) continue;
      const b = nat(o);
      let v = 0;
      if (b.c === a.c && b.n === a.n) v = pairish ? 2 : 1;
      else if (b.c === a.c && Math.abs(b.n - a.n) === 1) v = pairish ? 1 : 2;
      else if (b.c === a.c && Math.abs(b.n - a.n) === 2) v = 1;
      else if (b.n === a.n) v = pairish ? 1 : 2;
      if (v > best) best = v;
    }
    return best;
  };
  // Perlere girmeyen ve yanında güçlü komşusu olmayan taşlar arasından en küçüğü atılır
  const weak = pool.filter((id) => use(id) < 2);
  const list = weak.length ? weak : pool;
  list.sort((x, y) => nat(x).n - nat(y).n || use(x) - use(y));
  return list[0];
}

function drawStep(s, seat) {
  const r = s.round, okey = r.okey;
  const left = (seat + 3) % 4;
  const pile = r.discards[left];
  const side = pile.length && r.lastDiscardSeat === left ? pile[pile.length - 1] : null;
  if (side !== null) {
    const hand = r.hands[seat];
    const withSide = hand.concat([side]);
    const opened = r.opened[seat];
    if (!opened) {
      const op = bestOpen(s, seat, withSide, side);
      if (op && tryAct(s, seat, Object.assign({ side: true }, op))) return;
    } else {
      const pl = E.planIsle(withSide, r.melds, okey, [], side);
      if (pl.ops.length && pl.usedMust &&
        tryAct(s, seat, { type: 'batch', side: true, ops: pl.ops.map((o) => ({ type: o.type, tile: o.tile, meld: o.meld })) })) return;
      let grp = null;
      if (opened === 'runs') grp = E.suggestMelds(withSide, okey).melds.find((g) => g.includes(side));
      else grp = pairsWithWild(withSide, okey).find((g) => g.includes(side));
      if (grp && withSide.length - grp.length >= 1 && tryAct(s, seat, { type: 'meld', side: true, melds: [grp] })) return;
    }
  }
  if (r.stock.length) G.act(s, seat, { type: 'draw' });
  else G.act(s, seat, { type: 'endStock' });
}

function playStep(s, seat) {
  const okey = s.round.okey;
  const hand = () => s.round.hands[seat];
  const playing = () => s.phase === 'playing' && s.round.turn === seat;
  if (!s.round.opened[seat]) {
    const op = bestOpen(s, seat, hand(), null);
    if (op) tryAct(s, seat, op);
    if (!playing()) return;
  }
  const opened = s.round.opened[seat];
  if (opened === 'runs') {
    for (const g of E.suggestMelds(hand(), okey).melds) {
      if (hand().length - g.length >= 1) tryAct(s, seat, { type: 'meld', melds: [g] });
    }
    // masada çift açan varsa, seriyle açan da çiftlerini indirebilir
    if (G.pairsAllowed(s.round, seat)) {
      for (const g of E.suggestPairs(hand(), okey).pairs) {
        if (hand().length - g.length >= 1) tryAct(s, seat, { type: 'meld', melds: [g] });
      }
    }
  } else if (opened === 'pairs') {
    for (const g of pairsWithWild(hand(), okey)) {
      if (hand().length - g.length >= 1) tryAct(s, seat, { type: 'meld', melds: [g] });
    }
  }
  if (!playing()) return;
  if (opened) {
    const pl = E.planIsle(hand(), s.round.melds, okey, [], null);
    if (pl.ops.length) tryAct(s, seat, { type: 'batch', ops: pl.ops.map((o) => ({ type: o.type, tile: o.tile, meld: o.meld })) });
    // Bitirmeye bir adım kaldıysa okeyi de işle: elde tek taş kalsın, onu atıp bitsin
    // (elde sadece okeyler varsa biri kalır ve okey atarak biter)
    const others = hand().filter((id) => !E.isWild(id, okey));
    if (others.length <= 1) {
      for (const w of hand().filter((id) => E.isWild(id, okey))) {
        if (hand().length <= 1) break;
        const m = s.round.melds.find((x) => E.addToMeld(x, w, okey, 'end'));
        if (m) tryAct(s, seat, { type: 'add', tile: w, meld: m.id, at: 'end' });
      }
    }
  }
  if (!playing()) return;
  G.act(s, seat, { type: 'discard', tile: chooseDiscard(s, seat) });
}

// Sıradaki bot hamlesini yapar. Bir şey değiştiyse true döner.
function step(s, now) {
  if (s.phase !== 'playing' || !s.round) return false;
  const r = s.round;
  const seat = r.turn;
  const p = s.seats[seat];
  if (!p || !p.bot) {
    if (r.botAt) r.botAt = 0;
    return false;
  }
  if (!r.botAt || r.botSeat !== seat || r.botPhase !== r.tphase) {
    r.botAt = now + rand(r.tphase === 'draw' ? DRAW_DELAY : PLAY_DELAY);
    r.botSeat = seat;
    r.botPhase = r.tphase;
    return false;
  }
  if (now < r.botAt) return false;
  r.botAt = 0;
  try {
    if (r.tphase === 'draw') drawStep(s, seat);
    else playStep(s, seat);
  } catch (e) {
    // Beklenmeyen bir durumda takılmasın: sıradan bir hamle yap
    try {
      if (s.phase === 'playing' && s.round.turn === seat) {
        if (s.round.tphase === 'draw') G.act(s, seat, s.round.stock.length ? { type: 'draw' } : { type: 'endStock' });
        else G.act(s, seat, { type: 'discard', tile: chooseDiscard(s, seat) });
      }
    } catch (e2) {
      console.error('  (bot hatası)', e2 && e2.message);
    }
  }
  return true;
}

module.exports = { step, chooseDiscard, bestOpen };
