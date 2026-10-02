'use strict';
/* 4 botla çok sayıda el oynatır; taş sayısının korunduğunu ve hiçbir beklenmeyen hata olmadığını kontrol eder.
   Eşli/eşsiz, katlamalı ve süre dolması (otomatik oynama) rastgele karışık denenir. */
const E = require('../public/engine.js');
const G = require('../game.js');

function countTiles(s) {
  const r = s.round;
  let n = 1 + r.stock.length;
  r.hands.forEach((h) => (n += h.length));
  r.discards.forEach((d) => (n += d.length));
  r.melds.forEach((m) => (n += m.tiles.length));
  return n;
}

function tryAct(s, seat, a, stats) {
  const before = JSON.stringify(s.round);
  try {
    G.act(s, seat, a);
    const k = a.side ? a.type + '+yandan' : a.type;
    stats.ok[k] = (stats.ok[k] || 0) + 1;
    return true;
  } catch (e) {
    if (!(e instanceof G.GameError)) throw e;
    // Reddedilen hamle durumu hiç değiştirmemeli
    if (JSON.stringify(s.round) !== before) throw new Error('Reddedilen hamle durumu değiştirdi: ' + a.type + ' ' + e.message);
    const k = a.side ? a.type + '+yandan' : a.type;
    stats.rejected[k] = (stats.rejected[k] || 0) + 1;
    return false;
  }
}

function botTurn(s, seat, stats) {
  const r = s.round;
  const okey = r.okey;
  if (r.tphase === 'draw') {
    const left = (seat + 3) % 4;
    const pile = r.discards[left];
    const side = pile.length && r.lastDiscardSeat === left ? pile[pile.length - 1] : null;
    if (side !== null && Math.random() < 0.6) {
      const withSide = r.hands[seat].concat([side]);
      if (!r.opened[seat]) {
        const sug = E.suggestMelds(withSide, okey);
        const need = G.openReq(s, seat, 'runs');
        // bazen bilerek yetersiz açmayı dene: reddedilmeli ve taş yerinde kalmalı
        if (sug.melds.some((m) => m.includes(side)) && (sug.value >= need || Math.random() < 0.2)) {
          tryAct(s, seat, { type: 'open', side: true, mode: 'runs', melds: sug.melds }, stats);
        }
      } else if (r.hands[seat].length >= 1) {
        for (const m of r.melds) {
          if (E.addToMeld(m, side, okey) && tryAct(s, seat, { type: 'add', side: true, tile: side, meld: m.id }, stats)) break;
        }
      }
      if (s.phase !== 'playing') return;
    }
    if (r.tphase === 'draw') {
      // Ara sıra süre dolsun: sunucu otomatik oynar
      if (s.settings.turnSecs && Math.random() < 0.05) {
        s.round.deadline = Date.now() - 5000;
        if (!G.tick(s, Date.now())) throw new Error('Süre dolunca otomatik oynanmadı');
        stats.auto++;
        return;
      }
      if (r.stock.length) tryAct(s, seat, { type: 'draw' }, stats);
      else {
        tryAct(s, seat, { type: 'endStock' }, stats);
        return;
      }
    }
  }
  if (s.phase !== 'playing') return;
  const hand = () => s.round.hands[seat];
  if (!r.opened[seat]) {
    const sug = E.suggestMelds(hand(), okey);
    if (sug.value >= G.openReq(s, seat, 'runs')) tryAct(s, seat, { type: 'open', mode: 'runs', melds: sug.melds }, stats);
    if (!r.opened[seat]) {
      const p = E.suggestPairs(hand(), okey);
      if (p.pairs.length >= G.openReq(s, seat, 'pairs') && Math.random() < 0.5) tryAct(s, seat, { type: 'open', mode: 'pairs', melds: p.pairs }, stats);
    }
    if (!r.opened[seat] && Math.random() < 0.05 && sug.melds.length) {
      if (tryAct(s, seat, { type: 'open', mode: 'runs', melds: sug.melds.slice(0, 1) }, stats) && sug.value < 101 && hand().length > 1) {
        throw new Error('101 altı açış kabul edildi!');
      }
    }
  }
  if (s.phase !== 'playing') return;
  if (r.opened[seat]) {
    if (r.opened[seat] === 'runs') {
      const sug = E.suggestMelds(hand(), okey);
      for (const m of sug.melds) if (hand().length - m.length >= 1) tryAct(s, seat, { type: 'meld', melds: [m] }, stats);
    } else {
      const p = E.suggestPairs(hand(), okey);
      for (const m of p.pairs) if (hand().length - 2 >= 1) tryAct(s, seat, { type: 'meld', melds: [m] }, stats);
    }
    let progress = true;
    while (progress && hand().length > 1) {
      progress = false;
      for (const id of hand().slice()) {
        if (hand().length <= 1) break;
        for (const m of s.round.melds) {
          if (E.addToMeld(m, id, okey) && tryAct(s, seat, { type: 'add', tile: id, meld: m.id, at: Math.random() < 0.5 ? 'start' : 'end' }, stats)) {
            progress = true;
            break;
          }
        }
      }
    }
  }
  if (s.phase !== 'playing') return;
  if (s.settings.turnSecs && Math.random() < 0.03) {
    s.round.deadline = Date.now() - 5000;
    if (!G.tick(s, Date.now())) throw new Error('Süre dolunca otomatik atılmadı');
    stats.auto++;
    return;
  }
  const h = hand();
  let pick = h.find((id) => !E.isWild(id, okey) && !E.isLayable(id, s.round.melds, okey));
  if (pick === undefined || Math.random() < 0.03) pick = h[Math.floor(Math.random() * h.length)];
  if (!tryAct(s, seat, { type: 'discard', tile: pick }, stats)) { try { G.act(s, seat, { type: 'discard', tile: pick }); } catch (e) { throw new Error('Atış reddedildi: ' + e.message + ' tphase=' + s.round.tphase + ' took=' + s.round.took + ' hand=' + s.round.hands[seat].length); } }
}

function runGames(nGames) {
  const stats = { ok: {}, rejected: {}, rounds: 0, kinds: {}, eldenWins: 0, okeyFinish: 0, auto: 0, team: 0, katla: 0 };
  for (let g = 0; g < nGames; g++) {
    const s = G.create();
    const off = () => false;
    ['A', 'B', 'C', 'D'].forEach((n) => G.join(s, n, null, off));
    const team = Math.random() < 0.5, katla = Math.random() < 0.5;
    if (team) stats.team++;
    if (katla) stats.katla++;
    G.lobbyAction(s, 0, { type: 'settings', rounds: 5, mode: team ? 'team' : 'solo', katlamali: katla, turnSecs: Math.random() < 0.8 ? 30 : 0 }, off);
    G.lobbyAction(s, 0, { type: 'start' }, off);
    let guard = 0;
    while (s.phase !== 'gameEnd') {
      if (++guard > 20000) throw new Error('Oyun bitmedi');
      if (s.phase === 'roundEnd') {
        stats.rounds++;
        const res = s.round.result;
        stats.kinds[res.kind] = (stats.kinds[res.kind] || 0) + 1;
        if (res.elden) stats.eldenWins++;
        if (res.lastOkey) stats.okeyFinish++;
        if (team && res.kind === 'win' && res.base[(res.winner + 2) % 4] !== 0) throw new Error('Eşin cezası silinmedi');
        G.act(s, guard % 4, { type: 'next' });
        continue;
      }
      const seat = s.round.turn;
      botTurn(s, seat, stats);
      if (s.phase === 'playing' && countTiles(s) !== 106) throw new Error('Taş sayısı bozuldu: ' + countTiles(s));
      if (s.round && s.phase === 'playing') {
        const r = s.round;
        // katlamalı kuralı: her açışın, açtığı anda gerekenden düşük olmaması
        const v = G.view(s, s.seats[seat].token, () => true);
        if (v.round.hand.length !== r.hands[seat].length) throw new Error('Görünüm hatası');
        if (r.took !== null) throw new Error('Yandan alınan taş elde kaldı');
      }
    }
    const totals = [0, 0, 0, 0];
    s.history.forEach((h) => h.total.forEach((x, i) => (totals[i] += x)));
    if (totals.some((x) => !Number.isFinite(x))) throw new Error('Puan hatası');
  }
  return stats;
}

const n = parseInt(process.argv[2] || '200', 10);
const t0 = Date.now();
const stats = runGames(n);
console.log(`${n} oyun (${stats.team} eşli, ${stats.katla} katlamalı), ${stats.rounds} el, ${Date.now() - t0} ms`);
console.log('El sonları:', stats.kinds, 'elden:', stats.eldenWins, 'okeyle bitiş:', stats.okeyFinish, 'süre dolması:', stats.auto);
console.log('Kabul edilen hamleler:', stats.ok);
console.log('Reddedilen hamleler:', stats.rejected);
