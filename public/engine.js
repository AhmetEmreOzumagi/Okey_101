/* 101 Okey kural motoru — hem sunucu (Node) hem telefon (tarayıcı) bunu kullanır. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OkeyEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Taş numaraları: 0..103 sayılı taşlar, 104 ve 105 sahte okey.
  // id -> renk = floor(id/26), sayı = floor((id%26)/2)+1
  var COLOR_NAMES = ['Kırmızı', 'Sarı', 'Mavi', 'Siyah'];
  var TILE_COUNT = 106;

  function tileInfo(id) {
    if (id >= 104) return { id: id, fake: true, c: -1, n: 0 };
    return { id: id, fake: false, c: Math.floor(id / 26), n: Math.floor((id % 26) / 2) + 1 };
  }

  function okeyFromIndicator(indId) {
    var t = tileInfo(indId);
    return { c: t.c, n: t.n === 13 ? 1 : t.n + 1 };
  }

  // Gerçek okey mi (joker)?
  function isWild(id, okey) {
    var t = tileInfo(id);
    return !t.fake && t.c === okey.c && t.n === okey.n;
  }

  // Taşın "doğal" değeri. Okey (joker) için null döner.
  // Sahte okey, okeyin rengi ve sayısı yerine geçer.
  function natural(id, okey) {
    var t = tileInfo(id);
    if (t.fake) return { c: okey.c, n: okey.n };
    if (t.c === okey.c && t.n === okey.n) return null;
    return { c: t.c, n: t.n };
  }

  function sumRep(rep) {
    var s = 0;
    for (var i = 0; i < rep.length; i++) s += rep[i].n;
    return s;
  }

  // Verilen sırayla seri (aynı renk, ardışık). 1 sadece en altta olabilir.
  function tryRunOrdered(ids, okey) {
    if (ids.length < 3 || ids.length > 13) return null;
    var color = null, start = null;
    for (var i = 0; i < ids.length; i++) {
      var nt = natural(ids[i], okey);
      if (!nt) continue;
      if (color === null) color = nt.c;
      else if (color !== nt.c) return null;
      var s = nt.n - i;
      if (start === null) start = s;
      else if (start !== s) return null;
    }
    if (color === null) return null;
    if (start < 1 || start + ids.length - 1 > 13) return null;
    var rep = ids.map(function (_, k) { return { c: color, n: start + k }; });
    return { type: 'run', tiles: ids.slice(), rep: rep, color: color, start: start, end: start + ids.length - 1, value: sumRep(rep) };
  }

  // Sıra ne olursa olsun seri kurmayı dener (okeyleri boşluklara, sonra üste, sonra alta koyar).
  function tryRunFlex(ids, okey) {
    if (ids.length < 3 || ids.length > 13) return null;
    var nats = [], wild = [];
    ids.forEach(function (id) {
      var nt = natural(id, okey);
      if (nt) nats.push({ id: id, c: nt.c, n: nt.n }); else wild.push(id);
    });
    if (!nats.length) return null;
    var color = nats[0].c;
    for (var i = 0; i < nats.length; i++) if (nats[i].c !== color) return null;
    nats.sort(function (a, b) { return a.n - b.n; });
    for (i = 1; i < nats.length; i++) if (nats[i].n === nats[i - 1].n) return null;
    var lo = nats[0].n, hi = nats[nats.length - 1].n;
    var gaps = hi - lo + 1 - nats.length;
    if (gaps > wild.length) return null;
    var extra = wild.length - gaps, start = lo, end = hi;
    while (extra > 0 && end < 13) { end++; extra--; }
    while (extra > 0 && start > 1) { start--; extra--; }
    if (extra > 0) return null;
    var byN = {}; nats.forEach(function (x) { byN[x.n] = x.id; });
    var order = [], wi = 0;
    for (var n = start; n <= end; n++) order.push(byN[n] !== undefined ? byN[n] : wild[wi++]);
    return tryRunOrdered(order, okey);
  }

  // Grup: aynı sayı, farklı renkler, 3-4 taş.
  function trySet(ids, okey) {
    if (ids.length < 3 || ids.length > 4) return null;
    var num = null, used = {};
    for (var i = 0; i < ids.length; i++) {
      var nt = natural(ids[i], okey);
      if (!nt) continue;
      if (num === null) num = nt.n;
      else if (num !== nt.n) return null;
      if (used[nt.c]) return null;
      used[nt.c] = true;
    }
    if (num === null) return null;
    var missing = [0, 1, 2, 3].filter(function (c) { return !used[c]; });
    var mi = 0;
    var rep = ids.map(function (id) {
      var nt = natural(id, okey);
      return nt ? { c: nt.c, n: num } : { c: missing[mi++], n: num };
    });
    return { type: 'set', tiles: ids.slice(), rep: rep, num: num, value: sumRep(rep) };
  }

  // Çift: aynı renk ve sayıdan iki taş (okey her şeyin yerine geçer).
  function tryPair(ids, okey) {
    if (ids.length !== 2) return null;
    var a = natural(ids[0], okey), b = natural(ids[1], okey);
    var r;
    if (a && b) {
      if (a.c !== b.c || a.n !== b.n) return null;
      r = a;
    } else r = a || b || { c: okey.c, n: okey.n };
    var rep = [{ c: r.c, n: r.n }, { c: r.c, n: r.n }];
    return { type: 'pair', tiles: ids.slice(), rep: rep, value: sumRep(rep) };
  }

  // mode: 'runs' (seri/grup) veya 'pairs' (çift)
  function interpret(ids, okey, mode) {
    if (mode === 'pairs') return tryPair(ids, okey);
    return tryRunOrdered(ids, okey) || trySet(ids, okey) ||
      tryRunOrdered(ids.slice().reverse(), okey) || tryRunFlex(ids, okey);
  }

  // Masadaki pere taş işleme. side: 'start' | 'end' (sadece okey için anlamlı)
  function addToMeld(meld, id, okey, side) {
    if (!meld || meld.type === 'pair') return null;
    if (meld.type === 'run') {
      var nt = natural(id, okey), atEnd;
      if (nt) {
        if (nt.c !== meld.color) return null;
        if (nt.n === meld.end + 1) atEnd = true;
        else if (nt.n === meld.start - 1) atEnd = false;
        else return null;
      } else {
        var canEnd = meld.end < 13, canStart = meld.start > 1;
        if (side === 'start' && canStart) atEnd = false;
        else if (canEnd) atEnd = true;
        else if (canStart) atEnd = false;
        else return null;
      }
      var tiles = atEnd ? meld.tiles.concat([id]) : [id].concat(meld.tiles);
      return tryRunOrdered(tiles, okey);
    }
    if (meld.type === 'set') {
      if (meld.tiles.length >= 4) return null;
      return trySet(meld.tiles.concat([id]), okey);
    }
    return null;
  }

  function isLayable(id, melds, okey) {
    for (var i = 0; i < melds.length; i++) if (addToMeld(melds[i], id, okey)) return true;
    return false;
  }

  // Masadaki okeyi almak: okeyin yerine geçtiği taşı koyup okeyi ele alırsın.
  // Seri ve gruplarda olur (çiftte olmaz). Sonuç: { meld: yeni per, okeyId: alınan okey }
  // Grupta okey ancak grup 4'lüyken alınır: 3'lü grupta (ör. kırmızı 13, sarı 13, okey) okey mavi de
  // siyah da olabilir; tek taşla alınmaz. Önce eksik renklerden biri işlenir (grup 4'lü olur, okey artık
  // tek bir rengin yerindedir), sonra o son renk konup okey alınır. Yani iki eksik taşın ikisi de gerekir.
  function swapOkey(meld, id, okey) {
    if (!meld || (meld.type !== 'run' && meld.type !== 'set')) return null;
    if (meld.type === 'set' && meld.tiles.length < 4) return null;
    var nt = natural(id, okey);
    if (!nt) return null; // okeyle okey alınmaz
    for (var i = 0; i < meld.tiles.length; i++) {
      var w = meld.tiles[i];
      if (!isWild(w, okey)) continue;
      var rep = meld.rep[i];
      if (rep.n !== nt.n || (meld.type === 'run' && rep.c !== nt.c)) continue;
      var tiles = meld.tiles.slice();
      tiles[i] = id;
      var res = meld.type === 'run' ? tryRunOrdered(tiles, okey) : trySet(tiles, okey);
      if (res) return { meld: res, okeyId: w, index: i };
    }
    return null;
  }

  function canSwap(id, melds, okey) {
    for (var i = 0; i < melds.length; i++) if (swapOkey(melds[i], id, okey)) return true;
    return false;
  }

  // "İşle" düğmesi için: eldeki taşları masaya otomatik işleme planı.
  // Önce okey alınabilecek taşlar (okey ele geçer), sonra işlenebilen taşlar.
  // keep: işlenmeyecek taşlar (ıstakada dizili perler); must: mutlaka işlenmesi gereken taş (yandan alınan)
  // En az bir taş elde kalır (atıp bitirmek için).
  function planIsle(hand, melds, okey, keep, must) {
    keep = keep || [];
    var h = hand.slice(), ms = melds.slice(), ops = [], progress = true, guard = 0;
    var keepSet = {};
    keep.forEach(function (id) { if (id !== must) keepSet[id] = true; });
    while (progress && guard++ < 200) {
      progress = false;
      var i, j, id, res;
      for (i = 0; i < h.length && !progress; i++) {
        id = h[i];
        if (isWild(id, okey)) continue;
        for (j = 0; j < ms.length; j++) {
          res = swapOkey(ms[j], id, okey);
          if (res) {
            res.meld.id = ms[j].id; res.meld.owner = ms[j].owner;
            ops.push({ type: 'swap', tile: id, meld: ms[j].id, okeyId: res.okeyId });
            ms[j] = res.meld;
            h.splice(i, 1, res.okeyId);
            progress = true;
            break;
          }
        }
      }
      if (progress) continue;
      for (i = 0; i < h.length && !progress; i++) {
        id = h[i];
        if (h.length <= 1) break;
        if (isWild(id, okey) || keepSet[id]) continue;
        for (j = 0; j < ms.length; j++) {
          res = addToMeld(ms[j], id, okey);
          if (res) {
            res.id = ms[j].id; res.owner = ms[j].owner;
            ops.push({ type: 'add', tile: id, meld: ms[j].id });
            ms[j] = res;
            h.splice(i, 1);
            progress = true;
            break;
          }
        }
      }
    }
    var usedMust = must === null || must === undefined || ops.some(function (o) { return o.tile === must; });
    return { ops: ops, melds: ms, hand: h, usedMust: usedMust };
  }

  // Elde kalan taşların ceza değeri: okey 101, sahte okey okeyin sayısı, diğerleri sayısı.
  function tileValue(id, okey) {
    if (isWild(id, okey)) return 101;
    var nt = natural(id, okey);
    return nt.n;
  }
  function handValue(ids, okey) {
    var s = 0;
    for (var i = 0; i < ids.length; i++) s += tileValue(ids[i], okey);
    return s;
  }

  // El sonu puanları (cezalar hariç).
  // opened: [null|'runs'|'pairs' x4], hands: [[id]] x4
  function scoreWin(o) {
    var w = o.winner, out = [];
    if (o.elden) {
      var mm = o.lastOkey ? 2 : 1;
      for (var i = 0; i < 4; i++) out.push(i === w ? -202 * mm : 404 * mm);
      return out;
    }
    var m = 1;
    if (o.opened[w] === 'pairs') m *= 2;
    if (o.lastOkey) m *= 2;
    for (var k = 0; k < 4; k++) {
      if (k === w) out.push(-101 * m);
      else if (o.opened[k] === 'runs') out.push(handValue(o.hands[k], o.okey) * m);
      else if (o.opened[k] === 'pairs') out.push(handValue(o.hands[k], o.okey) * 2 * m);
      else out.push(Math.min(202 * m, 404));
    }
    return out;
  }

  // ---- Otomatik dizme / öneri (okeyleri kullanmaz, kenara ayırır) ----
  function extractRuns(pool, okey) {
    var groups = [], rest = pool.slice();
    for (var c = 0; c < 4; c++) {
      var changed = true;
      while (changed) {
        changed = false;
        var byN = {};
        rest.forEach(function (id) {
          var nt = natural(id, okey);
          if (nt.c === c && byN[nt.n] === undefined) byN[nt.n] = id;
        });
        var best = null, n = 1;
        while (n <= 13) {
          if (byN[n] !== undefined) {
            var m = n;
            while (m + 1 <= 13 && byN[m + 1] !== undefined) m++;
            if (m - n + 1 >= 3 && (!best || m - n > best[1] - best[0])) best = [n, m];
            n = m + 1;
          } else n++;
        }
        if (best) {
          var g = [];
          for (var k = best[0]; k <= best[1]; k++) g.push(byN[k]);
          groups.push(g);
          rest = rest.filter(function (id) { return g.indexOf(id) < 0; });
          changed = true;
        }
      }
    }
    return { groups: groups, rest: rest };
  }

  function extractSets(pool, okey) {
    var groups = [], rest = pool.slice();
    for (var n = 13; n >= 1; n--) {
      var changed = true;
      while (changed) {
        changed = false;
        var byC = {};
        rest.forEach(function (id) {
          var nt = natural(id, okey);
          if (nt.n === n && byC[nt.c] === undefined) byC[nt.c] = id;
        });
        var g = Object.keys(byC).map(function (k) { return byC[k]; });
        if (g.length >= 3) {
          groups.push(g);
          rest = rest.filter(function (id) { return g.indexOf(id) < 0; });
          changed = true;
        }
      }
    }
    return { groups: groups, rest: rest };
  }

  function meldsValue(groups, okey) {
    var s = 0;
    groups.forEach(function (g) { var r = interpret(g, okey, 'runs'); if (r) s += r.value; });
    return s;
  }

  // Bir okeyi en çok puan getirecek yere koyar: iki taşla yeni per kurar ya da bir peri uzatır.
  function placeWild(plan, w, okey) {
    var best = null;
    var rest = plan.rest;
    var consider = function (gain, apply) { if (!best || gain > best.gain) best = { gain: gain, apply: apply }; };
    // iki taş + okey ile yeni per
    for (var i = 0; i < rest.length; i++) {
      for (var j = 0; j < rest.length; j++) {
        if (i === j) continue;
        var a = natural(rest[i], okey), b = natural(rest[j], okey);
        var tiles = null;
        if (a.c === b.c && b.n === a.n + 1) tiles = a.n + 2 <= 13 ? [rest[i], rest[j], w] : (a.n > 1 ? [w, rest[i], rest[j]] : null);
        else if (a.c === b.c && b.n === a.n + 2) tiles = [rest[i], w, rest[j]];
        else if (a.n === b.n && a.c < b.c) tiles = [rest[i], rest[j], w];
        if (!tiles) continue;
        var m = interpret(tiles, okey, 'runs');
        if (!m) continue;
        (function (tiles, ri, rj, val) {
          consider(val + 0.5, function () {
            plan.melds.push(tiles);
            plan.rest = plan.rest.filter(function (id) { return id !== ri && id !== rj; });
          });
        })(tiles, rest[i], rest[j], m.value);
      }
    }
    // var olan bir peri uzat
    plan.melds.forEach(function (g, k) {
      var m = interpret(g, okey, 'runs');
      if (!m) return;
      var cands = m.type === 'run' ? [g.concat([w]), [w].concat(g)] : (g.length < 4 ? [g.concat([w])] : []);
      cands.forEach(function (t) {
        var mm = interpret(t, okey, 'runs');
        if (mm) consider(mm.value - m.value, function () { plan.melds[k] = t; });
      });
    });
    if (best) { best.apply(); return true; }
    return false;
  }

  function planValue(plan, okey) { return meldsValue(plan.melds, okey); }

  function suggestMelds(ids, okey) {
    var wild = ids.filter(function (id) { return isWild(id, okey); });
    var pool = ids.filter(function (id) { return !isWild(id, okey); });
    var a1 = extractRuns(pool, okey), a2 = extractSets(a1.rest, okey);
    var b1 = extractSets(pool, okey), b2 = extractRuns(b1.rest, okey);
    var plans = [
      { melds: a1.groups.concat(a2.groups), rest: a2.rest },
      { melds: b1.groups.concat(b2.groups), rest: b2.rest }
    ];
    var results = [];
    plans.forEach(function (p) {
      var plan = { melds: p.melds.map(function (g) { return g.slice(); }), rest: p.rest.slice() };
      var left = [];
      wild.forEach(function (w) { if (!placeWild(plan, w, okey)) left.push(w); });
      // iki okey + tek taş ile üçlü (ör. 13 + okey + okey = 13'lü grup)
      if (left.length === 2 && plan.rest.length) {
        var top = plan.rest.slice().sort(function (x, y) { return natural(y, okey).n - natural(x, okey).n; })[0];
        plan.melds.push([top, left[0], left[1]]);
        plan.rest = plan.rest.filter(function (id) { return id !== top; });
        left = [];
      }
      plan.wild = left;
      results.push(plan);
      // okeysiz hali de aday (okeyi kenarda tutmak isteyen için değil, karşılaştırma için)
    });
    var best = planValue(results[0], okey) >= planValue(results[1], okey) ? results[0] : results[1];
    best.value = planValue(best, okey);
    return best;
  }

  // ---- Istaka: boşluklarla ayrılmış dizilerdeki perleri bulur ----
  // seg: taş dizisi (boşluksuz). Taş atlamaya izin vererek en yüksek değeri veren perleri seçer.
  function segmentChunks(seg, okey, kind) {
    var n = seg.length, best = new Array(n + 1);
    best[n] = { score: 0, chunks: [] };
    for (var i = n - 1; i >= 0; i--) {
      var cand = { score: best[i + 1].score, chunks: best[i + 1].chunks };
      if (kind === 'pairs') {
        if (i + 2 <= n && tryPair(seg.slice(i, i + 2), okey)) {
          var sc = 1 + best[i + 2].score;
          if (sc > cand.score) cand = { score: sc, chunks: [{ start: i, len: 2, value: 1, tiles: seg.slice(i, i + 2) }].concat(best[i + 2].chunks) };
        }
      } else {
        for (var len = 3; len <= 13 && i + len <= n; len++) {
          var t = seg.slice(i, i + len), m = interpret(t, okey, 'runs');
          if (!m) continue;
          var sc2 = m.value + best[i + len].score;
          if (sc2 > cand.score || (sc2 === cand.score && best[i + len].chunks.length + 1 < cand.chunks.length)) cand = { score: sc2, chunks: [{ start: i, len: len, value: m.value, tiles: t }].concat(best[i + len].chunks) };
        }
      }
      best[i] = cand;
    }
    return best[0];
  }

  // slots: istaka (null = boşluk), cols: bir sıradaki yuva sayısı
  function rackChunks(slots, cols, okey, kind) {
    var out = [];
    for (var r = 0; r * cols < slots.length; r++) {
      var c = 0;
      while (c < cols) {
        if (slots[r * cols + c] === null || slots[r * cols + c] === undefined) { c++; continue; }
        var s0 = c, seg = [];
        while (c < cols && slots[r * cols + c] !== null && slots[r * cols + c] !== undefined) { seg.push(slots[r * cols + c]); c++; }
        segmentChunks(seg, okey, kind).chunks.forEach(function (ch) {
          out.push({ row: r, col: s0 + ch.start, len: ch.len, value: ch.value, tiles: ch.tiles });
        });
      }
    }
    return out;
  }

  // Taşları istakaya boşluklu yerleştirir. Perler bölünmez; per olmayan taşlar renge göre gruplanır.
  function arrangeRack(ids, okey, kind, cols, rows) {
    cols = cols || 15; rows = rows || 2;
    var blocks = [];
    var sortN = function (a, b) {
      var x = natural(a, okey) || { c: 9, n: 99 }, y = natural(b, okey) || { c: 9, n: 99 };
      return x.c - y.c || x.n - y.n;
    };
    var rest, wild;
    if (kind === 'pairs') {
      var p = suggestPairs(ids, okey);
      p.pairs.forEach(function (g) { blocks.push({ tiles: g, fixed: true }); });
      rest = p.rest; wild = p.wild;
    } else {
      var s = suggestMelds(ids, okey);
      s.melds.forEach(function (g) { blocks.push({ tiles: g, fixed: true }); });
      rest = s.rest; wild = s.wild;
    }
    var byColor = [[], [], [], []];
    rest.slice().sort(sortN).forEach(function (id) { byColor[natural(id, okey).c].push(id); });
    var restBlocks = byColor.filter(function (g) { return g.length; });
    var wildBlock = wild.length ? [wild] : [];

    function pack(fixed, loose, gap) {
      var rowsArr = [], used = [];
      for (var r = 0; r < rows; r++) { rowsArr.push([]); used.push(0); }
      var order = fixed.map(function (b, i) { return { b: b, i: i }; })
        .sort(function (x, y) { return y.b.tiles.length - x.b.tiles.length || x.i - y.i; });
      for (var k = 0; k < order.length; k++) {
        var len = order[k].b.tiles.length, placed = false;
        for (var r2 = 0; r2 < rows && !placed; r2++) {
          var need = len + (rowsArr[r2].length ? gap : 0);
          if (used[r2] + need <= cols) { rowsArr[r2].push({ tiles: order[k].b.tiles, i: order[k].i }); used[r2] += need; placed = true; }
        }
        if (!placed) return null;
      }
      rowsArr.forEach(function (row) { row.sort(function (x, y) { return x.i - y.i; }); });
      for (var q = 0; q < loose.length; q++) {
        var t = loose[q].slice();
        for (var r3 = 0; r3 < rows && t.length; r3++) {
          var g = rowsArr[r3].length ? gap : 0, space = cols - used[r3] - g;
          if (space <= 0) continue;
          var take = Math.min(space, t.length);
          rowsArr[r3].push({ tiles: t.slice(0, take), i: 1000 + q });
          used[r3] += take + g;
          t = t.slice(take);
        }
        if (t.length) return null;
      }
      var slots = [];
      for (var r4 = 0; r4 < rows; r4++) {
        var line = [];
        rowsArr[r4].forEach(function (b, j) {
          if (j > 0) for (var z = 0; z < gap; z++) line.push(null);
          line = line.concat(b.tiles);
        });
        while (line.length < cols) line.push(null);
        slots = slots.concat(line);
      }
      return slots;
    }
    var allRest = restBlocks.reduce(function (a, b) { return a.concat(b); }, []);
    var attempts = [
      function () { return pack(blocks, restBlocks.concat(wildBlock), 1); },
      function () { return pack(blocks, [allRest.concat(wild)].filter(function (b) { return b.length; }), 1); },
      function () { return pack(blocks, [allRest.concat(wild)].filter(function (b) { return b.length; }), 0); }
    ];
    for (var a = 0; a < attempts.length; a++) {
      var res = attempts[a]();
      if (res) return res;
    }
    // Sığmazsa: perler arasında boşluk yok ama sıralı
    var flat = [];
    blocks.forEach(function (b) { flat = flat.concat(b.tiles); });
    flat = flat.concat(allRest, wild);
    var out = [];
    for (var f = 0; f < cols * rows; f++) out.push(f < flat.length ? flat[f] : null);
    return out;
  }

  function suggestPairs(ids, okey) {
    var wild = ids.filter(function (id) { return isWild(id, okey); });
    var byKey = {}, order = [];
    ids.forEach(function (id) {
      if (isWild(id, okey)) return;
      var nt = natural(id, okey), k = nt.c * 100 + nt.n;
      if (!byKey[k]) { byKey[k] = []; order.push(k); }
      byKey[k].push(id);
    });
    order.sort(function (a, b) { return (a % 100) - (b % 100) || a - b; });
    var pairs = [], rest = [];
    order.forEach(function (k) {
      var arr = byKey[k];
      if (arr.length >= 2) { pairs.push(arr.slice(0, 2)); rest = rest.concat(arr.slice(2)); }
      else rest = rest.concat(arr);
    });
    return { pairs: pairs, rest: rest, wild: wild };
  }

  // ================= Normal (düz) okey =================
  // 101'den farkları: masaya per açılmaz; 12-13-1 serisi geçerlidir (1, 13'ün üstüne gelebilir; 13-1-2 olmaz);
  // el, 15. taş atılınca kalan 14 taşın tamamı seri/grup (ya da 7 çift) olunca biter.

  // Tek bir per mi (sıra önemli değil): grup ya da 12-13-1'e izin veren seri
  function meldN(ids, okey) {
    if (ids.length < 3) return false;
    if (ids.length <= 4 && trySet(ids, okey)) return true;
    if (ids.length > 13) return false;
    var nats = [], wild = 0;
    for (var i = 0; i < ids.length; i++) {
      var nt = natural(ids[i], okey);
      if (nt) nats.push(nt); else wild++;
    }
    if (!nats.length) return false;
    var c = nats[0].c;
    for (i = 1; i < nats.length; i++) if (nats[i].c !== c) return false;
    var len = ids.length;
    // 1 ya en altta (1) ya da 13'ün üstünde (14) sayılır
    for (var hi1 = 0; hi1 < 2; hi1++) {
      var vals = nats.map(function (x) { return x.n === 1 && hi1 ? 14 : x.n; }).sort(function (a, b) { return a - b; });
      var dup = false;
      for (i = 1; i < vals.length; i++) if (vals[i] === vals[i - 1]) dup = true;
      if (dup) continue;
      var lo = vals[0], hi = vals[vals.length - 1];
      var sMin = Math.max(1, hi - len + 1), sMax = Math.min(lo, 15 - len);
      if (sMin <= sMax) return true;
    }
    return false;
  }

  // Çift: aynı renk ve sayıdan iki taş; okey her taşla çift olur
  function pairsN(ids, okey) {
    var wild = 0, cnt = {};
    ids.forEach(function (id) {
      var nt = natural(id, okey);
      if (!nt) { wild++; return; }
      var k = nt.c * 100 + nt.n;
      cnt[k] = (cnt[k] || 0) + 1;
    });
    var pairs = 0, singles = 0;
    Object.keys(cnt).forEach(function (k) { pairs += Math.floor(cnt[k] / 2); singles += cnt[k] % 2; });
    var usedWild = Math.min(wild, singles);
    pairs += usedWild + Math.floor((wild - usedWild) / 2);
    return { pairs: pairs, singles: singles - usedWild };
  }

  // En çok taşı perlere koyan bölüşüm (12-13-1 dahil). Sonuç: { cov: perlerdeki taş sayısı, groups: [[id]], rest: [id] }
  function solveN(ids, okey) {
    var items = ids.map(function (id) { return { id: id, nt: natural(id, okey) }; });
    var nats = items.filter(function (t) { return t.nt; }).sort(function (a, b) { return a.nt.c - b.nt.c || a.nt.n - b.nt.n; });
    var wilds = items.filter(function (t) { return !t.nt; });
    var arr = nats.concat(wilds), N = arr.length, W0 = nats.length;
    if (N > 30) return { cov: 0, groups: [], rest: ids.slice() };
    var memo = {};
    function bits(m) { var k = 0; while (m) { m &= m - 1; k++; } return k; }
    function wildIdx(mask) { var out = []; for (var i = W0; i < N; i++) if (mask & (1 << i)) out.push(i); return out; }
    // i taşını içeren, mask içindeki taşlardan kurulabilen perler (bit maskesi olarak)
    function meldsWith(i, mask) {
      var t = arr[i].nt, out = [], wi = wildIdx(mask);
      var rest = mask & ~(1 << i);
      // Grup: aynı sayı, farklı renkler
      var byColor = {};
      for (var j = 0; j < W0; j++) {
        if (!(rest & (1 << j))) continue;
        var u = arr[j].nt;
        if (u.n === t.n && u.c !== t.c && byColor[u.c] === undefined) byColor[u.c] = j;
      }
      var cols = Object.keys(byColor).map(function (k) { return byColor[k]; });
      for (var sub = 0; sub < (1 << cols.length); sub++) {
        var m = 1 << i, size = 1;
        for (var q = 0; q < cols.length; q++) if (sub & (1 << q)) { m |= 1 << cols[q]; size++; }
        for (var w = 0; w <= wi.length && size + w <= 4; w++) {
          if (size + w >= 3) {
            var mm = m;
            for (var z = 0; z < w; z++) mm |= 1 << wi[z];
            out.push(mm);
          }
        }
      }
      // Seri: aynı renk; t'nin değeri v (1 ise 14 de olabilir)
      var vs = t.n === 1 ? [1, 14] : [t.n];
      vs.forEach(function (v) {
        for (var s = Math.max(1, v - 12); s <= v; s++) {
          for (var e = Math.max(v, s + 2); e <= Math.min(14, s + 12); e++) {
            // her değer için aday taş: doğal (bu maskede) ya da okey
            var need = [];
            for (var x = s; x <= e; x++) {
              if (x === v) continue;
              var nn = x === 14 ? 1 : x, found = -1;
              for (var j2 = 0; j2 < W0; j2++) {
                if ((rest & (1 << j2)) && arr[j2].nt.c === t.c && arr[j2].nt.n === nn) { found = j2; break; }
              }
              need.push(found);
            }
            var req = need.filter(function (f) { return f < 0; }).length;
            if (req > wi.length) continue;
            // okeyle doldurulacak yerler: zorunlular + (kalan okey kadar) doğal yerine okey
            var natPos = [];
            need.forEach(function (f, k) { if (f >= 0) natPos.push(k); });
            var extraMax = Math.min(wi.length - req, natPos.length);
            var combos = [[]];
            if (extraMax >= 1) natPos.forEach(function (p) { combos.push([p]); });
            if (extraMax >= 2) for (var a = 0; a < natPos.length; a++) for (var b = a + 1; b < natPos.length; b++) combos.push([natPos[a], natPos[b]]);
            combos.forEach(function (cmb) {
              var m2 = 1 << i, wk = 0, ok = true;
              need.forEach(function (f, k) {
                if (f < 0 || cmb.indexOf(k) >= 0) { if (wk >= wi.length) ok = false; else m2 |= 1 << wi[wk++]; }
                else m2 |= 1 << f;
              });
              if (ok) out.push(m2);
            });
          }
        }
      });
      return out;
    }
    function best(mask) {
      if (!mask) return { cov: 0, groups: [] };
      if (memo[mask]) return memo[mask];
      var i = 0;
      while (!(mask & (1 << i))) i++;
      if (i >= W0) { memo[mask] = { cov: 0, groups: [] }; return memo[mask]; }
      var res = best(mask & ~(1 << i));
      var ms = meldsWith(i, mask);
      for (var k = 0; k < ms.length; k++) {
        var sub = best(mask & ~ms[k]);
        var cov = sub.cov + bits(ms[k]);
        if (cov > res.cov) res = { cov: cov, groups: [ms[k]].concat(sub.groups) };
        if (res.cov === bits(mask)) break;
      }
      memo[mask] = res;
      return res;
    }
    var full = (1 << N) - 1;
    var r = best(full);
    var used = 0;
    var groups = r.groups.map(function (m) {
      used |= m;
      var g = [];
      for (var i = 0; i < N; i++) if (m & (1 << i)) g.push(arr[i].id);
      return orderMeldN(g, okey);
    });
    var rest = [];
    for (var i = 0; i < N; i++) if (!(used & (1 << i))) rest.push(arr[i].id);
    return { cov: r.cov, groups: groups, rest: rest };
  }

  // Peri ıstakada okunacak sıraya koyar (seride küçükten büyüğe, okeyler boşluklarda; grupta renk sırası)
  function orderMeldN(g, okey) {
    var nats = [], wild = [];
    g.forEach(function (id) { var nt = natural(id, okey); if (nt) nats.push({ id: id, nt: nt }); else wild.push(id); });
    if (!nats.length) return g.slice();
    var isRun = nats.every(function (x) { return x.nt.c === nats[0].nt.c; }) && (nats.length === 1 || nats[0].nt.n !== nats[1].nt.n);
    if (!isRun) return nats.sort(function (a, b) { return a.nt.c - b.nt.c; }).map(function (x) { return x.id; }).concat(wild);
    var len = g.length;
    for (var hi1 = 0; hi1 < 2; hi1++) {
      var vals = nats.map(function (x) { return { id: x.id, v: x.nt.n === 1 && hi1 ? 14 : x.nt.n }; }).sort(function (a, b) { return a.v - b.v; });
      var lo = vals[0].v, hi = vals[vals.length - 1].v;
      var sMin = Math.max(1, hi - len + 1), sMax = Math.min(lo, 15 - len);
      if (sMin > sMax) continue;
      var s = sMax, out = [], wi = 0, byV = {};
      vals.forEach(function (x) { byV[x.v] = x.id; });
      for (var v = s; v < s + len; v++) out.push(byV[v] !== undefined ? byV[v] : wild[wi++]);
      return out;
    }
    return g.slice();
  }

  // El bitiyor mu: kalan taşların hepsi perlerde ya da 7 çift
  function finishN(ids, okey) {
    var pr = pairsN(ids, okey);
    if (ids.length === 14 && pr.pairs === 7 && pr.singles === 0) return { kind: 'pairs' };
    var r = solveN(ids, okey);
    if (r.cov === ids.length) return { kind: 'runs', groups: r.groups };
    return null;
  }

  // Istakadaki dizilerden geçerli perlerde kaç taş var (normal okey göstergesi)
  function rackCoverN(slots, cols, okey) {
    var cov = 0, chunks = [];
    for (var r = 0; r * cols < slots.length; r++) {
      var c = 0;
      while (c < cols) {
        if (slots[r * cols + c] === null || slots[r * cols + c] === undefined) { c++; continue; }
        var seg = [], s0 = c;
        while (c < cols && slots[r * cols + c] !== null && slots[r * cols + c] !== undefined) { seg.push(slots[r * cols + c]); c++; }
        // diziyi soldan sağa en uzun perlere böl
        var n = seg.length, bestArr = new Array(n + 1);
        bestArr[n] = { cov: 0, ch: [] };
        for (var i = n - 1; i >= 0; i--) {
          var cand = { cov: bestArr[i + 1].cov, ch: bestArr[i + 1].ch };
          for (var len = 3; len <= 13 && i + len <= n; len++) {
            var t = seg.slice(i, i + len);
            if (!meldN(t, okey)) continue;
            if (len + bestArr[i + len].cov > cand.cov) cand = { cov: len + bestArr[i + len].cov, ch: [{ row: r, col: s0 + i, len: len, tiles: t }].concat(bestArr[i + len].ch) };
          }
          bestArr[i] = cand;
        }
        cov += bestArr[0].cov;
        chunks = chunks.concat(bestArr[0].ch);
      }
    }
    return { cov: cov, chunks: chunks };
  }

  // Normal okey için ıstaka dizme: çözücünün perleri bloklar halinde, kalanlar renge göre
  function arrangeN(ids, okey, cols, rows) {
    var r = solveN(ids, okey);
    var fake = r.groups.map(function (g) { return g; });
    return arrangeBlocks(fake, r.rest, okey, cols, rows);
  }
  function arrangeBlocks(groups, rest, okey, cols, rows) {
    cols = cols || 15; rows = rows || 2;
    var wild = rest.filter(function (id) { return isWild(id, okey); });
    var loose = rest.filter(function (id) { return !isWild(id, okey); }).sort(function (a, b) {
      var x = natural(a, okey), y = natural(b, okey);
      return x.c - y.c || x.n - y.n;
    });
    var rowsArr = [[], []].slice(0, rows), used = [];
    for (var q = 0; q < rows; q++) { rowsArr[q] = []; used.push(0); }
    var blocks = groups.slice().sort(function (a, b) { return b.length - a.length; });
    var placeBlock = function (tiles) {
      for (var rr = 0; rr < rows; rr++) {
        var need = tiles.length + (rowsArr[rr].length ? 1 : 0);
        if (used[rr] + need <= cols) {
          if (rowsArr[rr].length) rowsArr[rr].push(null);
          rowsArr[rr] = rowsArr[rr].concat(tiles); used[rr] += need; return true;
        }
      }
      return false;
    };
    var leftover = [];
    blocks.forEach(function (b) { if (!placeBlock(b)) leftover = leftover.concat(b); });
    var tail = leftover.concat(loose, wild);
    // kalanları boş yerlere (önce bir boşluk bırakarak) dağıt
    for (var rr = 0; rr < rows && tail.length; rr++) {
      if (rowsArr[rr].length && used[rr] < cols) { rowsArr[rr].push(null); used[rr]++; }
      while (used[rr] < cols && tail.length) { rowsArr[rr].push(tail.shift()); used[rr]++; }
    }
    var slots = [];
    for (rr = 0; rr < rows; rr++) {
      var line = rowsArr[rr].slice(0, cols);
      while (line.length < cols) line.push(null);
      slots = slots.concat(line);
    }
    // sığmayan kalırsa (çok nadir) boş yerlere
    tail.forEach(function (id) { var k = slots.indexOf(null); if (k >= 0) slots[k] = id; });
    return slots;
  }

  return {
    meldN: meldN,
    pairsN: pairsN,
    solveN: solveN,
    finishN: finishN,
    orderMeldN: orderMeldN,
    rackCoverN: rackCoverN,
    arrangeN: arrangeN,
    suggestMelds: suggestMelds,
    suggestPairs: suggestPairs,
    segmentChunks: segmentChunks,
    rackChunks: rackChunks,
    arrangeRack: arrangeRack,
    COLOR_NAMES: COLOR_NAMES,
    TILE_COUNT: TILE_COUNT,
    tileInfo: tileInfo,
    okeyFromIndicator: okeyFromIndicator,
    isWild: isWild,
    natural: natural,
    tryRunOrdered: tryRunOrdered,
    tryRunFlex: tryRunFlex,
    trySet: trySet,
    tryPair: tryPair,
    interpret: interpret,
    addToMeld: addToMeld,
    isLayable: isLayable,
    swapOkey: swapOkey,
    canSwap: canSwap,
    planIsle: planIsle,
    tileValue: tileValue,
    handValue: handValue,
    scoreWin: scoreWin
  };
});
