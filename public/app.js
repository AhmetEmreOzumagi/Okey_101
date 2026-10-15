/* 101 Okey — telefon arayüzü */
(function () {
  'use strict';
  const E = window.OkeyEngine;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const LS = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const COLS = 15, SLOTS = 30;
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  let token = LS.get('okey101.token') || '';
  let myName = LS.get('okey101.name') || '';
  let view = null, lastRendered = null;
  let rack = { roundId: null, slots: emptySlots() };
  let rackKind = 'runs';
  let selected = new Set();
  let pendingSide = null;
  let drag = null, pendingRender = false;
  let deadline = 0, turnTotal = 30000, warned = false;
  let lastTurnMine = false;
  let freshId = null, freshUntil = 0;
  // Masadan okey alınınca okey, yerine koyduğumuz taşın yuvasına gelsin
  const swapSlots = new Map();
  const swapFresh = new Map(); // ele gelen okey: id -> parlama bitişi
  let busy = 0;

  function emptySlots() { return new Array(SLOTS).fill(null); }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const initial = (n) => (String(n || '?').trim()[0] || '?').toLocaleUpperCase('tr');
  // Avatar içi: bot için robot, kişi için baş harf
  const avatarText = (p) => (p && p.bot ? '🤖' : esc(initial(p && p.name)));

  // Oyun türleri: taşlı (101 Okey, Okey) ıstaka ekranında, kart oyunları (Pişti, Batak, Renk) kart masasında,
  // İstanbul Emlak kendi tahtasında oynanır.
  const KIND = { okey: 'tile', okeyn: 'tile', pisti: 'card', batak: 'card', uno: 'card', emlak: 'board' };
  const gameOf = (v) => (v && v.round && v.round.game) || 'okey';
  const isCard = (v) => !!(v && v.round && KIND[gameOf(v)] === 'card');
  const isBoard = (v) => !!(v && v.round && KIND[gameOf(v)] === 'board');
  const isOkeyN = (v) => !!(v && v.round && gameOf(v) === 'okeyn');
  const GAME_TITLE = { okey: '101 Okey', okeyn: 'Okey', pisti: 'Pişti', batak: 'Batak', uno: 'Renk', emlak: 'İstanbul Emlak' };
  function cardCtx() { return { api, toast, esc, modal, closeModal, confirmBox, avatarText, showMenu, showScores }; }

  // =============== Bağlantı ===============
  let es = null, lastSeen = Date.now(), pollTimer = null, polling = false;

  function fetchT(url, opts, ms) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const o = Object.assign({ cache: 'no-store' }, opts || {});
    if (ctl) o.signal = ctl.signal;
    const timer = setTimeout(() => ctl && ctl.abort(), ms || 8000);
    return fetch(url, o).then((r) => { clearTimeout(timer); return r; }, (e) => { clearTimeout(timer); throw e; });
  }
  const setConn = (ok) => $('#conn').classList.toggle('hidden', ok);

  function poll() {
    fetchT('/state?token=' + encodeURIComponent(token), null, 6000)
      .then((r) => r.json()).then((v) => { setConn(true); onView(v); })
      .catch(() => setConn(false));
  }
  function startPolling() { if (polling) return; polling = true; poll(); pollTimer = setInterval(poll, 2000); }
  function stopPolling() { polling = false; clearInterval(pollTimer); }

  function connect() {
    if (es) es.close();
    lastSeen = Date.now();
    poll();
    if (typeof EventSource === 'undefined') { startPolling(); return; }
    es = new EventSource('/events?token=' + encodeURIComponent(token));
    const thisEs = es;
    let got = false;
    setTimeout(() => { if (!got && es === thisEs) startPolling(); }, 4000);
    es.onmessage = (ev) => {
      got = true; lastSeen = Date.now(); stopPolling(); setConn(true);
      let v; try { v = JSON.parse(ev.data); } catch (e) { return; }
      onView(v);
    };
    es.addEventListener('ping', () => { lastSeen = Date.now(); stopPolling(); setConn(true); });
    es.onerror = () => startPolling();
  }
  setInterval(() => {
    const quiet = Date.now() - lastSeen;
    if (quiet > 13000 && !polling) startPolling();
    if (quiet > 25000) connect();
  }, 3000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!es || es.readyState === 2 || Date.now() - lastSeen > 12000)) connect();
  });
  window.addEventListener('online', connect);

  function post(body) {
    const send = () => fetchT('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 8000).then((r) => r.json());
    return send().catch(() => new Promise((ok) => setTimeout(ok, 700)).then(send));
  }

  function api(type, data, quiet) {
    busy++;
    renderActionsSoon();
    const body = Object.assign({ type, token }, data || {});
    return post(body)
      .then((j) => { if (j.view) onView(j.view); if (!j.ok && !quiet) toast(j.error || 'Olmadı.'); return j; })
      .catch(() => { toast('Oyuna ulaşılamadı. İnternet / Wi-Fi bağlantını kontrol et, tekrar dene.'); return { ok: false }; })
      .finally(() => { busy--; renderActionsSoon(); });
  }
  let actTimer = 0;
  function renderActionsSoon() { clearTimeout(actTimer); actTimer = setTimeout(() => { if (view && view.round && !drag && !isCard(view)) renderActions(); }, 0); }

  function onView(v) {
    if (!v || typeof v !== 'object') return;
    if (view && v.boot === view.boot && typeof v.seq === 'number' && v.seq < view.seq) return;
    // Aynı durum iki kez gelebilir (hamlenin cevabı + anlık güncelleme): masayı boşuna yeniden çizme
    const same = view && v.boot === view.boot && v.seq === view.seq && v.me === view.me &&
      JSON.stringify(v.seats) === JSON.stringify(view.seats) && JSON.stringify(v.net) === JSON.stringify(view.net);
    view = v;
    if (v.round && v.round.remainingMs != null && v.phase === 'playing') {
      deadline = performance.now() + v.round.remainingMs;
      turnTotal = Math.max(1000, (v.settings.turnSecs || 30) * 1000);
    } else deadline = 0;
    if (same) return;
    if (drag) { pendingRender = true; return; }
    render();
  }

  // =============== Yardımcılar ===============
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function modal(html, bind) {
    const m = $('#modal');
    m.innerHTML = '<div class="card">' + html + '</div>';
    m.classList.remove('hidden');
    if (bind) bind(m);
    m.onclick = (e) => { if (e.target === m) closeModal(); };
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }
  function confirmBox(title, text, ok, danger) {
    return new Promise((resolve) => {
      modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="btns"><button class="btn" data-a="no">Vazgeç</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(ok)}</button></div>`, (m) => {
        m.querySelector('[data-a=no]').onclick = () => { closeModal(); resolve(false); };
        m.querySelector('[data-a=yes]').onclick = () => { closeModal(); resolve(true); };
      });
    });
  }
  const isTeam = () => view && view.settings.mode === 'team';
  const teamCls = (seat) => (isTeam() ? (seat % 2 === 0 ? 'ta' : 'tb') : '');
  const seatName = (s) => (view.seats[s] ? view.seats[s].name : '');
  function myTurn() { const r = view && view.round; return !!r && view.phase === 'playing' && r.turn === view.me; }
  function canPlay() { return myTurn() && view.round.tphase === 'play'; }

  // Taş görünümü. o.hand: kendi elimizde (okey ters görünür)
  function tileHTML(id, cls, okey, o) {
    o = o || {};
    const t = E.tileInfo(id);
    const wild = okey && E.isWild(id, okey);
    let c = 'tile' + (cls ? ' ' + cls : '');
    if (wild && (o.hand || o.table)) return `<div class="${c} back" data-tile="${id}"></div>`;
    // Sahte okey: sayı yazmaz, sadece yonca işareti (okey olan taşın yerine geçer)
    if (t.fake) return `<div class="${c} fake" data-tile="${id}"><span class="fk">✿</span></div>`;
    let num = t.n, col = t.c;
    if (wild && o.rep) { num = o.rep.n; col = o.rep.c; c += ' wildrep'; }
    return `<div class="${c} c${col}" data-tile="${id}"><span class="n">${num}</span><span class="d"></span></div>`;
  }
  const backHTML = (cls) => `<div class="tile back ${cls || ''}"></div>`;

  // =============== Istaka ===============
  const rackKey = (id) => 'okey101.rack.' + id;
  function saveRack() { if (rack.roundId) LS.set(rackKey(rack.roundId), JSON.stringify(rack.slots)); }
  function rackHas(id) { return rack.slots.indexOf(id) >= 0; }

  function syncRack(r) {
    if (rack.roundId !== r.id) {
      if (rack.roundId) LS.del(rackKey(rack.roundId));
      rack.roundId = r.id;
      selected.clear();
      pendingSide = null;
      swapSlots.clear();
      let saved = null;
      try { saved = JSON.parse(LS.get(rackKey(r.id)) || 'null'); } catch (e) {}
      rack.slots = Array.isArray(saved) && saved.length === SLOTS ? saved : (isOkeyN(view) ? E.arrangeN(r.hand, r.okey, COLS, 2) : E.arrangeRack(r.hand, r.okey, 'runs', COLS, 2));
      rackKind = 'runs';
    }
    if (pendingSide !== null && !(myTurn() && r.tphase === 'draw' && r.sideTile === pendingSide)) pendingSide = null;
    const present = new Set(r.hand);
    if (pendingSide !== null) present.add(pendingSide);
    for (let i = 0; i < SLOTS; i++) if (rack.slots[i] !== null && !present.has(rack.slots[i])) rack.slots[i] = null;
    present.forEach((id) => {
      if (rackHas(id)) return;
      const at = swapSlots.get(id);
      if (at !== undefined && rack.slots[at] === null) {
        rack.slots[at] = id;
        swapFresh.set(id, Date.now() + 2200);
      } else placeFree(id);
      swapSlots.delete(id);
    });
    selected.forEach((id) => { if (!present.has(id)) selected.delete(id); });
    saveRack();
  }

  // Yeni gelen (çekilen ya da yandan alınan) taş: ıstakada boş bir yere, sağ alta konur.
  // Pere kendiliğinden yerleştirilmez; oyuncu istediği yere kendisi sürükler.
  function placeFree(id) {
    const s = rack.slots;
    const free = (i) => s[i] === null;
    for (let i = SLOTS - 1; i >= 0; i--) {
      const c = i % COLS;
      if (free(i) && (c === COLS - 1 || free(i + 1)) && (c === 0 || free(i - 1))) { s[i] = id; return i; }
    }
    for (let i = SLOTS - 1; i >= 0; i--) if (free(i)) { s[i] = id; return i; }
    return -1;
  }

  function moveTile(id, from, to) {
    if (from === to) return;
    const s = rack.slots;
    s[from] = null;
    if (s[to] !== null) {
      let j = -1, k;
      for (k = to + 1; k < SLOTS; k++) if (s[k] === null) { j = k; break; }
      if (j >= 0) { for (k = j; k > to; k--) s[k] = s[k - 1]; }
      else {
        for (k = to - 1; k >= 0; k--) if (s[k] === null) { j = k; break; }
        for (k = j; k < to; k++) s[k] = s[k + 1];
      }
    }
    s[to] = id;
    saveRack();
  }

  const selectedInOrder = () => rack.slots.filter((id) => id !== null && selected.has(id));

  function rackInfo() {
    const r = view.round, okey = r.okey;
    const runs = E.rackChunks(rack.slots, COLS, okey, 'runs');
    const pairsAll = E.rackChunks(rack.slots, COLS, okey, 'pairs');
    const inRun = new Set();
    runs.forEach((c) => c.tiles.forEach((id) => inRun.add(id)));
    const pairs = pairsAll;
    const total = r.hand.length + (pendingSide !== null ? 1 : 0);
    const runValue = runs.reduce((a, c) => a + c.value, 0);
    const runTiles = runs.reduce((a, c) => a + c.len, 0);
    const pairShown = pairsAll.filter((c) => !c.tiles.some((id) => inRun.has(id)));
    return { runs, pairs, pairShown, runValue, runTiles, pairCount: pairs.length, total };
  }

  // Çift indirebilir mi: çiftle açtıysa ya da seriyle açıp masada çift açan varsa
  function pairsOk(r) {
    const m = r.opened[view.me];
    return m === 'pairs' || (m === 'runs' && r.opened.some((o) => o === 'pairs'));
  }

  // =============== İşleme ===============
  // Elde masaya işlenebilen ya da masadaki okeyi alabilen taşlar (altlarında işaret çıkar)
  function islekSet() {
    const r = view.round, set = new Set();
    if (!r.melds.length) return set;
    const ids = r.hand.concat(pendingSide !== null ? [pendingSide] : []);
    ids.forEach((id) => {
      if (E.isWild(id, r.okey)) return;
      if (E.isLayable(id, r.melds, r.okey) || E.canSwap(id, r.melds, r.okey)) set.add(id);
    });
    return set;
  }
  // "İşle" düğmesinin yapacakları. Istakada dizili perler İndir için bırakılır
  // (okey almak hariç: okey, yerine koyduğun taşın yerine gelir).
  function islePlan(info) {
    const r = view.round, opened = r.opened[view.me];
    const hand = r.hand.concat(pendingSide !== null ? [pendingSide] : []);
    const keep = [];
    if (opened) {
      const chs = opened === 'pairs' ? info.pairs : info.runs.concat(pairsOk(r) ? info.pairShown : []);
      chs.forEach((c) => c.tiles.forEach((id) => keep.push(id)));
    }
    return E.planIsle(hand, r.melds, r.okey, keep, pendingSide);
  }

  // =============== Normal okey ===============
  // Bitirme: seçili taş (ya da kendiliğinden bulunan taş) atılınca kalan 14 taş per/çift oluyor mu
  let finCache = { key: '', res: null };
  function finishPlanN() {
    const r = view.round;
    if (!myTurn() || r.tphase !== 'play' || r.hand.length !== 15) return null;
    const sel = selectedInOrder();
    const key = r.hand.slice().sort((a, b) => a - b).join(',') + '|' + sel.join(',');
    if (finCache.key === key) return finCache.res;
    const tryTile = (id) => {
      const f = E.finishN(r.hand.filter((x) => x !== id), r.okey);
      return f ? { tile: id, pairs: f.kind === 'pairs', okey: E.isWild(id, r.okey) } : null;
    };
    let res = null;
    if (sel.length === 1) res = tryTile(sel[0]);
    if (!res) for (const id of r.hand.filter((x) => E.isWild(x, r.okey))) { res = tryTile(id); if (res) break; }
    if (!res) for (const id of r.hand) { if (E.isWild(id, r.okey)) continue; res = tryTile(id); if (res) break; }
    finCache = { key, res };
    return res;
  }
  function planN() {
    const r = view.round, mine = myTurn();
    const p = { info: null, opened: null, mine, primary: null, second: null, link: null, hint: '', isle: { ops: [], usedMust: false }, isleOn: false, toMeld: null };
    if (!mine) {
      p.primary = { act: 'finish', label: 'Bitir', on: false };
      p.second = { act: 'discard', label: 'At', on: false };
    } else if (r.tphase === 'draw') {
      p.primary = r.stockCount > 0 ? { act: 'draw', label: 'Çek', on: true } : { act: 'endStock', label: 'Eli bitir', on: true };
      p.second = { act: 'take', label: 'Yandan al', on: !!r.canTake };
    } else {
      const fin = finishPlanN();
      p.primary = { act: 'finish', label: 'Bitir', sub: fin ? (fin.pairs ? 'çiftten' : '') + (fin.okey ? (fin.pairs ? ' + ' : '') + 'okeyle' : '') : '', on: !!fin };
      p.second = { act: 'discard', label: 'At', on: selected.size === 1 };
    }
    if (mine && r.canShow) p.link = { act: 'show', label: 'Göstergeyi göster' };
    return p;
  }

  // =============== Ne yapılabilir? ===============
  function plan() {
    if (isOkeyN(view)) return planN();
    const v = view, r = v.round, me = v.me, opened = r.opened[me];
    const info = rackInfo();
    const mine = myTurn();
    const sideIn = (chs) => pendingSide === null || chs.some((c) => c.tiles.indexOf(pendingSide) >= 0);
    const leftAfterRuns = info.total - info.runTiles;
    const runsOK = info.runs.length > 0 && ((info.runValue >= r.req.runs && leftAfterRuns >= 1) || (info.runTiles >= 20 && leftAfterRuns === 1)) && sideIn(info.runs);
    const pairsOK = info.pairCount >= r.req.pairs && info.total - info.pairCount * 2 >= 1 && sideIn(info.pairs);
    const p = { info, opened, mine, runsOK, pairsOK, primary: null, second: null, link: null, hint: '' };
    const isle = opened && r.melds.length ? islePlan(info) : { ops: [], usedMust: false };
    p.isle = isle;
    p.isleOn = !!(mine && opened && (r.tphase === 'play' || pendingSide !== null) && isle.ops.length && isle.usedMust);
    const isleBtn = () => ({ act: 'isle', label: 'İşle', sub: isle.ops.length > 1 ? isle.ops.length + ' taş' : '', on: true });

    // İndirilecek per(ler): seçim varsa seçim, yoksa ıstakada dizili perler
    let toMeld = null;
    if (opened) {
      const sel = selectedInOrder();
      const mixed = opened === 'runs' && pairsOk(r);
      if (sel.length) {
        const m = E.interpret(sel, r.okey, mixed && sel.length === 2 ? 'pairs' : opened);
        toMeld = m ? [sel] : null;
      } else {
        const chs = opened === 'pairs' ? info.pairs : info.runs.concat(mixed ? info.pairShown : []);
        toMeld = chs.length ? chs.map((c) => c.tiles) : null;
      }
      if (toMeld) {
        const used = toMeld.reduce((a, g) => a + g.length, 0);
        if (info.total - used < 1) toMeld = null;
        else if (pendingSide !== null && !toMeld.some((g) => g.indexOf(pendingSide) >= 0)) toMeld = null;
      }
    }
    p.toMeld = toMeld;

    const openBtn = () => {
      if (runsOK) return { act: 'openRuns', label: 'Aç', sub: info.runValue + ' ile', on: true };
      if (pairsOK) return { act: 'openPairs', label: 'Çiftle aç', sub: info.pairCount + ' çift', on: true };
      return { act: 'openRuns', label: 'Aç', sub: '', on: false };
    };
    const meldBtn = () => ({ act: 'meld', label: 'İndir', sub: toMeld ? (toMeld.length > 1 ? toMeld.length + ' per' : '') : '', on: !!toMeld });

    if (!mine) {
      p.primary = opened ? Object.assign(meldBtn(), { on: false }) : Object.assign(openBtn(), { on: false, sub: '' });
      p.second = { act: 'discard', label: 'At', on: false };
    } else if (r.tphase === 'draw' && pendingSide === null) {
      p.primary = r.stockCount > 0 ? { act: 'draw', label: 'Çek', on: true } : { act: 'endStock', label: 'Eli bitir', on: true };
      p.second = { act: 'take', label: 'Yandan al', on: !!r.canTake };
    } else if (r.tphase === 'draw') {
      // Yandan alınan taş işlenebiliyorsa (ya da masadaki okeyi alıyorsa) ana düğme "İşle"
      const sideInMeld = toMeld && toMeld.some((g) => g.indexOf(pendingSide) >= 0);
      p.primary = opened ? (p.isleOn && !sideInMeld ? isleBtn() : meldBtn()) : openBtn();
      p.second = { act: 'giveBack', label: 'Geri bırak', on: true };
      if (!opened && runsOK && pairsOK) p.link = { act: 'openPairs', label: 'Çiftle aç' };
      p.hint = opened ? 'Yandan aldığın taşı bir pere işle ya da yeni perle indir' : 'Yandan aldığın taşla aç';
    } else {
      p.primary = opened ? meldBtn() : openBtn();
      p.second = { act: 'discard', label: 'At', on: selected.size === 1 };
      if (!opened && runsOK && pairsOK) p.link = { act: 'openPairs', label: 'Çiftle aç' };
    }
    return p;
  }

  // =============== Hamleler ===============
  function doAct(act) {
    const r = view.round;
    if (isOkeyN(view)) {
      switch (act) {
        case 'draw': return api('draw');
        case 'take': return api('take');
        case 'show': return api('show');
        case 'endStock':
          return confirmBox('El bitsin mi?', 'Deste bitti. El puansız biter.', 'Eli bitir').then((y) => y && api('endStock'));
        case 'finish': {
          const f = finishPlanN();
          if (!f) { toast('Elin henüz bitmiyor: 14 taşın hepsi seri/grup ya da 7 çift olmalı.'); return; }
          selected.clear();
          return api('finish', { tile: f.tile });
        }
        case 'discard': {
          const ids = selectedInOrder();
          if (ids.length !== 1) { toast('Atmak için tek bir taş seç.'); return; }
          return discardTile(ids[0]);
        }
        case 'sortRuns': rackKind = 'runs'; arrange('runs'); return;
        case 'sortPairs': rackKind = 'pairs'; arrange('pairs'); return;
      }
      return;
    }
    switch (act) {
      case 'draw':
        if (pendingSide !== null) giveBack(true);
        return api('draw');
      case 'endStock':
        return confirmBox('El bitsin mi?', 'Deste bitti. Açanlar elindeki taşların toplamını (çiftle açan iki katını), açmayanlar 202 yazar.', 'Eli bitir').then((y) => y && api('endStock'));
      case 'take': return takeSide();
      case 'giveBack': return giveBack();
      case 'openRuns': return openFromRack('runs');
      case 'openPairs': return openFromRack('pairs');
      case 'meld': {
        const p = plan();
        if (!p.toMeld) { toast(selected.size ? 'Seçtiğin taşlar per oluşturmuyor.' : 'Istakada indirilecek per yok.'); return; }
        selected.clear();
        return api('meld', { melds: p.toMeld, side: pendingSide !== null });
      }
      case 'discard': {
        const ids = selectedInOrder();
        if (ids.length !== 1) { toast('Atmak için tek bir taş seç.'); return; }
        return discardTile(ids[0]);
      }
      case 'isle': return doIsle();
      case 'sortRuns': rackKind = 'runs'; arrange('runs'); return;
      case 'sortPairs': rackKind = 'pairs'; arrange('pairs'); return;
    }
    return r;
  }

  function doIsle() {
    const r = view.round;
    if (!myTurn()) { toast('Sıra sende değil.'); return; }
    if (!r.opened[view.me]) { toast('Taş işlemek için önce elini açmalısın.'); return; }
    if (r.tphase !== 'play' && pendingSide === null) { toast('Önce taş çek.'); return; }
    const p = islePlan(rackInfo());
    if (!p.ops.length) { toast('İşlenecek taş yok.'); return; }
    if (!p.usedMust) { toast('Yandan aldığın taş işlenmiyor. Onu bir perle indir ya da geri bırak.'); return; }
    p.ops.forEach((o) => {
      if (o.type !== 'swap') return;
      const i = rack.slots.indexOf(o.tile);
      if (i >= 0) swapSlots.set(o.okeyId, i);
    });
    selected.clear();
    return api('batch', { ops: p.ops.map((o) => ({ type: o.type, tile: o.tile, meld: o.meld })), side: pendingSide !== null });
  }

  function arrange(kind) {
    const r = view.round;
    const ids = r.hand.concat(pendingSide !== null ? [pendingSide] : []);
    const rects = captureRects();
    rack.slots = isOkeyN(view) && kind === 'runs' ? E.arrangeN(ids, r.okey, COLS, 2) : E.arrangeRack(ids, r.okey, kind, COLS, 2);
    selected.clear();
    saveRack();
    render();
    slideRack(rects);
  }

  function openFromRack(mode) {
    const p = plan();
    const chs = mode === 'pairs' ? p.info.pairs : p.info.runs;
    const ok = mode === 'pairs' ? p.pairsOK : p.runsOK;
    if (!ok) {
      if (pendingSide !== null && !chs.some((c) => c.tiles.indexOf(pendingSide) >= 0)) toast('Yandan aldığın taşı bir perin içine koy.');
      else if (mode === 'pairs') toast(`Çiftle açmak için en az ${view.round.req.pairs} çift diz.`);
      else toast(`Dizili perlerin toplamı ${p.info.runValue}. Açmak için ${view.round.req.runs} gerekli.`);
      return;
    }
    selected.clear();
    return api('open', { mode, melds: chs.map((c) => c.tiles), side: pendingSide !== null });
  }

  function takeSide() {
    const r = view.round;
    if (!r.canTake || r.sideTile === null) { toast('Alınacak taş yok.'); return; }
    if (pendingSide !== null) return;
    const from = rectOf($('#pile-bl .tile'));
    pendingSide = r.sideTile;
    placeFree(pendingSide); // oyuncu istediği yere kendisi koyar
    saveRack();
    render();
    const el = tileEl(pendingSide);
    if (el) fly(tileHTML(pendingSide, '', r.okey, { hand: true }), from, el, { hide: true });
  }

  function giveBack(silent) {
    if (pendingSide === null) return;
    const id = pendingSide;
    const from = rectOf(tileEl(id));
    pendingSide = null;
    const i = rack.slots.indexOf(id);
    if (i >= 0) rack.slots[i] = null;
    selected.delete(id);
    saveRack();
    render();
    if (!silent || from) {
      const to = $('#pile-bl .tile');
      if (to && from) fly(tileHTML(id, 'pt', view.round.okey), from, to, { hide: true });
    }
  }

  function discardTile(id) {
    const r = view.round;
    if (!myTurn()) { toast('Sıra sende değil.'); return; }
    if (r.tphase !== 'play') { toast(pendingSide !== null ? 'Yandan aldığın taşı kullan ya da geri bırak.' : 'Önce taş çek.'); return; }
    if (id === pendingSide) return;
    const finishing = r.hand.length === 1;
    let ask = null;
    if (!finishing && !isOkeyN(view)) {
      if (E.isWild(id, r.okey)) ask = ['Okey atıyorsun', 'Okey atmanın cezası 101 puan. Yine de atılsın mı?'];
      else if (E.isLayable(id, r.melds, r.okey)) ask = ['Bu taş işlenebilir', 'Masadaki bir pere işlenebilecek taşı atmanın cezası 101 puan. Yine de atılsın mı?'];
    }
    const go = () => { selected.delete(id); api('discard', { tile: id }); };
    if (ask) confirmBox(ask[0], ask[1], 'At, 101 ceza', true).then((y) => y && go());
    else go();
  }

  function addTile(id, meldId, at) {
    const r = view.round;
    const side = id === pendingSide;
    if (!myTurn()) { toast('Sıra sende değil.'); return; }
    if (!side && r.tphase !== 'play') { toast('Önce taş çek.'); return; }
    if (!r.opened[view.me]) { toast('Taş işlemek için önce elini açmalısın.'); return; }
    const m = r.melds.find((x) => x.id === meldId);
    const sw = m && E.swapOkey(m, id, r.okey);
    if (!m || (!sw && !E.addToMeld(m, id, r.okey, at))) { toast('Bu taş bu pere işlenemez.'); return; }
    if (!sw && !side && r.hand.length <= 1) { toast('Son taşı atarak bitirmelisin.'); return; }
    if (pendingSide !== null && !side) { toast('Önce yandan aldığın taşı kullan.'); return; }
    selected.delete(id);
    if (sw) {
      // Okeyin yerine geçen taşı koyup masadaki okeyi al
      const i = rack.slots.indexOf(id);
      if (i >= 0) swapSlots.set(sw.okeyId, i);
      api('swap', { tile: id, meld: meldId, side });
      return;
    }
    api('add', { tile: id, meld: meldId, at, side });
  }

  // =============== Çizim ===============
  function render() {
    if (!view) return;
    const boot = $('#boot');
    if (boot) boot.style.display = 'none';
    const v = view;
    const inGame = v.me >= 0 && v.phase !== 'lobby' && v.round;
    const card = !!inGame && isCard(v);
    const board = !!inGame && isBoard(v);
    document.body.classList.toggle('in-game', !!inGame);
    document.body.classList.toggle('card-game', card || board);
    document.body.classList.toggle('board-game', board);
    $('#lobby').classList.toggle('hidden', !!inGame);
    $('#game').classList.toggle('hidden', !inGame || card || board);
    $('#cg').classList.toggle('hidden', !card);
    $('#em').classList.toggle('hidden', !board);
    const before = lastRendered;
    if (board) {
      window.EmlakUI.render(v, cardCtx());
      renderOverlayBoard();
      const mine = window.EmlakUI.myMove(v);
      if (mine && !lastTurnMine) {
        warned = false;
        if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(120); } catch (e) {} }
      }
      lastTurnMine = mine;
    } else if (card) {
      window.CardUI.render(v, cardCtx());
      window.CardUI.overlay(v, cardCtx());
      const mine = myTurn();
      if (mine && !lastTurnMine) {
        warned = false;
        if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(120); } catch (e) {} }
      }
      lastTurnMine = mine;
    } else if (inGame) {
      const rects = captureRects();
      renderGame();
      renderOverlay();
      const wasGame = before && before.round && before.me >= 0 && before.phase !== 'lobby';
      if (!wasGame || before.round.id !== v.round.id) dealAnim();
      else animateDiff(before, v, rects);
      const mine = myTurn();
      if (mine && !lastTurnMine) {
        warned = false;
        if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(120); } catch (e) {} }
      }
      lastTurnMine = mine;
    } else {
      $('#overlay').classList.add('hidden');
      renderLobby(before);
    }
    lastRendered = v;
    updateTimer();
  }

  // ---------- Lobi ----------
  let nameInit = false;
  function gamesHTML(v) {
    const g = v.settings.game || 'okey';
    const can = v.me >= 0 && v.phase === 'lobby';
    const CU = window.CardUI;
    const icons = {
      okey: '<span class="gt c0">1</span><span class="gt c2">0</span><span class="gt c3">1</span>',
      okeyn: '<span class="gt c3">7</span><span class="gt c0">7</span><span class="gt c1">7</span>',
      pisti: CU.pcard(10, 'mini') + CU.pcard(13, 'mini'),
      batak: CU.pcard(0, 'mini') + CU.pcard(12, 'mini'),
      uno: CU.ucard(7, 'mini') + CU.ucard(104, 'mini'),
      emlak: EMLAK_ICON,
    };
    const item = (id, title, sub) => `<button class="gpick${g === id ? ' on' : ''}" data-set="game" data-val="${id}"${can || g === id ? '' : ' disabled'}>` +
      `<span class="gicon ${id}">${icons[id]}</span><span class="gtx"><b>${title}</b><small>${sub}</small></span></button>`;
    return '<div class="gpicks">' + item('okey', '101 Okey', '4 kişi · taşlarla') + item('okeyn', 'Okey', '4 kişi · klasik') +
      item('pisti', 'Pişti', '2-4 kişi · iskambil') + item('batak', 'Batak', '3-4 kişi · ihaleli') +
      item('uno', 'Renk', '2-4 kişi · renkli kartlar') + item('emlak', 'Emlak', '2-4 kişi · İstanbul') + '</div>' +
      (can ? '' : v.phase === 'lobby' ? '<p class="gnote">Oyunu masaya oturan seçer.</p>' : '');
  }
  // Emlak simgesi: zar ve ev
  const EMLAK_ICON = '<svg class="emic" viewBox="0 0 48 34" aria-hidden="true"><rect x="2" y="9" width="21" height="21" rx="4" fill="#fffdf6" stroke="#cdbf9c"/>' +
    '<circle cx="8" cy="15" r="2.2" fill="#c8102e"/><circle cx="12.5" cy="19.5" r="2.2" fill="#c8102e"/><circle cx="17" cy="24" r="2.2" fill="#c8102e"/>' +
    '<path d="M27 19 L37 10 L47 19 V31 H27 Z" fill="#2c9c59" stroke="#0f3b28" stroke-width="1.2"/><rect x="34" y="23" width="6" height="8" fill="#0f3b28"/><rect x="30" y="20" width="4" height="4" fill="#f8f2df"/><rect x="40" y="20" width="4" height="4" fill="#f8f2df"/></svg>';

  // Oyunun kaç kişiyle oynandığı (sunucudaki playersNeeded ile aynı)
  function playersNeeded(st) {
    const g = st.game || 'okey';
    if (g === 'okey' || g === 'okeyn') return { exact: 4 };
    if (g === 'batak') return { exact: st.batakTip === 'gommeli' ? 3 : 4 };
    if (g === 'pisti' && st.mode === 'team') return { exact: 4 };
    return { min: 2 };
  }
  // Eşli mi: okeyde, okey'de ve piştide ayardan, batakta türünden
  function teamOn(st) {
    const g = st.game || 'okey';
    if (g === 'batak') return st.batakTip === 'esli';
    return st.mode === 'team' && (g === 'okey' || g === 'okeyn' || g === 'pisti');
  }
  const BATAK_TIP = { ihale: '4 kişi ihaleli', esli: '4 kişi eşli', gommeli: '3 kişi gömmeli' };
  const money = (n) => '₺' + Number(n).toLocaleString('tr-TR');

  function renderLobby(before) {
    const v = view, me = v.me, seated = me >= 0, lobby = v.phase === 'lobby';
    const st = v.settings;
    const game = st.game || 'okey';
    const team = teamOn(st);
    $('#lgames').innerHTML = gamesHTML(v);
    $('#ltitle').textContent = GAME_TITLE[game] || '101 Okey';
    $('#nameBar').classList.toggle('hidden', seated);
    if (!nameInit) { $('#nameIn').value = myName; nameInit = true; }
    const base = seated ? me : 0;
    const pos = (seat) => ['p-bottom', 'p-right', 'p-top', 'p-left'][(seat - base + 4) % 4];
    const filled = v.seats.filter((p) => p).length;
    const need = playersNeeded(st);
    let h = '<div class="ltable"><div class="board"></div><div class="tcenter">';
    if (lobby) {
      const secs = `<span class="tag">${st.turnSecs ? st.turnSecs + ' sn' : 'Süresiz'}</span>`;
      const tag = (t) => `<span class="tag">${t}</span>`;
      let tags = '';
      if (game === 'okey') tags = tag(team ? 'Eşli' : 'Eşsiz') + (st.katlamali ? tag('Katlamalı') : '') + secs + tag(st.rounds + ' el');
      else if (game === 'okeyn') tags = tag(team ? 'Eşli' : 'Eşsiz') + secs + tag(st.okeynPuan + ' puan');
      else if (game === 'pisti') tags = tag(team ? 'Eşli' : 'Eşsiz') + secs + tag(st.pistiTarget + ' puan');
      else if (game === 'batak') tags = tag(BATAK_TIP[st.batakTip] || 'Batak') + secs + tag(st.batakEl + ' el');
      else if (game === 'uno') tags = secs + tag(st.unoTarget + ' puan') + (st.unoStack ? tag('+2/+4 biriktirme') : '');
      else tags = tag(money(st.emlakPara)) + secs + tag(st.emlakTur ? st.emlakTur + ' tur' : 'Son kalan kazanır');
      h += '<div class="tags">' + tags + '</div>';
      const ready = need.exact ? filled === need.exact : filled >= need.min;
      h += `<div class="count">${need.exact ? `${filled} / ${need.exact} oyuncu` : `${filled} oyuncu · en az ${need.min} kişi`}</div>`;
      if (need.exact && filled > need.exact) h += `<div class="count warn">Bu oyun ${need.exact} kişiyle oynanır: bir koltuğu boşaltın</div>`;
      if (seated) {
        h += `<button class="btn primary" data-act="start"${ready ? '' : ' disabled'}>Oyunu başlat</button>`;
        const room = (need.exact || 4) - filled;
        if (room > 0) h += `<button class="lnk botfill" data-act="fillBots">Boş yerlere bot oturt (${room})</button>`;
      } else if (filled === 4) {
        const clearable = v.seats.some((p) => p && (p.bot || !p.online));
        h += `<div class="count">${clearable ? 'Masa dolu: bağlantısı olmayanın ya da botun altındaki <b>çıkar</b>\'a dokun, boşalan yere otur' : 'Masa dolu'}</div>`;
      } else h += '<div class="count">Adını yaz, boş bir sandalyeye dokun</div>';
    } else {
      const open = v.seats.some((p) => p && (p.bot || !p.online));
      h += '<div class="count">Oyun sürüyor</div><div class="teamnote">' +
        (seated ? '' : 'Masadaysan kendi sandalyene dokun, yerine dönersin.' + (open ? ' Yeni geldiysen adını yaz, bir botun ya da bağlantısı kopan birinin altındaki <b>yerine geç</b>\'e dokun; onun elindekilerle oynarsın.' : '')) + '</div>';
    }
    h += '</div>';
    for (let s = 0; s < 4; s++) {
      const p = v.seats[s];
      const tcls = team ? (s % 2 === 0 ? ' ta' : ' tb') : '';
      const isMe = s === me;
      const arrive = p && before && before.seats && !before.seats[s] ? ' arrive' : '';
      h += `<div class="lseat ${pos(s)}${tcls}${isMe ? ' me' : ''}${arrive}">`;
      if (p) {
        const canReclaim = !seated && !lobby && !p.online;
        const canTake = !seated && !lobby && p.bot;
        const tap = canReclaim ? `data-reclaim="${s}"` : canTake ? `data-takeover="${s}"` : '';
        h += `<button class="lav${p.bot ? ' bot' : ''}" ${tap}>${avatarText(p)}${p.online ? '' : '<span class="off"></span>'}</button>`;
        h += `<div class="lname">${esc(p.name)}</div><div class="lsub">`;
        if (isMe) h += lobby ? 'sen <button class="lnk" data-act="leave">kalk</button>' : 'sen';
        else if (team && seated && s === (me + 2) % 4) h += p.bot ? 'eşin (bot)' : 'eşin';
        else if (p.bot) h += canTake ? `<button class="lnk" data-takeover="${s}">yerine geç</button>` : 'bot';
        else h += p.online ? 'bağlı' : 'bağlantı yok';
        const off = !p.bot && !p.online;
        // Masaya oturmamış biri de bağlantısı kopanı ya da botu çıkarabilir (masa dolu kalmasın)
        if (lobby && !isMe && (p.bot || off)) h += ` <button class="lnk" data-kick="${s}">çıkar</button>`;
        if (!lobby && !isMe && off) {
          h += '<span class="lacts">' + (seated ? '' : `<button class="lnk" data-takeover="${s}">yerine geç</button>`) +
            `<button class="lnk" data-botseat="${s}">bot koy</button></span>`;
        }
        h += '</div>';
      } else {
        h += `<button class="lav empty" data-sit="${s}" ${lobby ? '' : 'disabled'}>+</button><div class="lname" style="opacity:.75">Boş</div>` +
          `<div class="lsub">${lobby ? 'otur' : ''}${lobby && seated ? ` · <button class="lnk" data-bot="${s}">bot koy</button>` : ''}</div>`;
      }
      h += '</div>';
    }
    h += '</div>';
    $('#ltable').innerHTML = h;

    // Ayarlar
    const dis = !(seated && lobby);
    const seg = (key, opts, cur) => '<div class="seg">' + opts.map((o) =>
      `<button data-set="${key}" data-val="${o[0]}" class="${String(o[0]) === String(cur) ? 'on' : ''}"${dis ? ' disabled' : ''}>${o[1]}</button>`).join('') + '</div>';
    const row = (lbl, inner, help) => `<div class="setrow"><span class="lbl">${lbl}</span>${inner}${help ? `<span class="help">${help}</span>` : ''}</div>`;
    let sh = `<div class="card-dark"><h2>${GAME_TITLE[game]} ayarları</h2>`;
    const secsRow = row('Hamle süresi', seg('turnSecs', [[20, '20 sn'], [30, '30 sn'], [45, '45'], [60, '60'], [0, 'Yok']], st.turnSecs));
    const teamRow = (help) => row('Oyun', seg('mode', [['solo', 'Eşsiz'], ['team', 'Eşli']], st.mode), help);
    if (game === 'okey') {
      sh += teamRow(team ? 'Karşılıklı oturanlar eş olur, puanlar toplanır. Biri bitince eşinin el cezası silinir.' : '');
      sh += row('Katlamalı', seg('katlamali', [['false', 'Kapalı'], ['true', 'Açık']], st.katlamali),
        st.katlamali ? 'Sonra açan, rakibinin açtığından en az 1 fazlasıyla açar (çiftte de 1 çift fazla). Eşine katlanmaz.' : '');
      sh += secsRow;
      sh += row('El sayısı', seg('rounds', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9'], [11, '11']], st.rounds));
    } else if (game === 'okeyn') {
      sh += teamRow(team ? 'Karşılıklı oturanlar eş olur; eşlerden biri bitirince ikisi de puan kaybetmez.' : 'Dört kişi, herkes kendi için oynar.');
      sh += row('Başlangıç puanı', seg('okeynPuan', (view.okeynPuanlar || [10, 20, 30]).map((x) => [x, String(x)]), st.okeynPuan),
        'Herkes bu puanla başlar; biri bitirince diğerlerinin puanı düşer. Puanı biten oyunu kaybeder.');
      sh += row('Gösterge', seg('okeynGosterge', [['true', 'Açık'], ['false', 'Kapalı']], st.okeynGosterge),
        st.okeynGosterge ? 'Göstergenin eşi elinde olan, ilk hamlesinde gösterirse diğerleri 1 puan kaybeder.' : '');
      sh += secsRow;
    } else if (game === 'pisti') {
      sh += teamRow(team ? 'Dört kişi oynanır, karşılıklı oturanlar eş olur, puanlar toplanır.' : '2, 3 ya da 4 kişi, herkes kendi için oynar.');
      sh += row('Hedef puan', seg('pistiTarget', [[51, '51'], [101, '101'], [151, '151']], st.pistiTarget));
      sh += secsRow;
      sh += '<p class="help">Pişti 10, As ile pişti 20, Vale ile pişti 30 puan. As ve Vale 1, sinek ikili 2, karo onlu 3, en çok kart 3 puan.</p>';
    } else if (game === 'batak') {
      sh += row('Tür', seg('batakTip', [['ihale', '4 kişi'], ['esli', '4 eşli'], ['gommeli', '3 gömmeli']], st.batakTip),
        st.batakTip === 'gommeli' ? '3 kişi, herkese 16 kart; 4 kart gömüye gider. İhaleyi alan gömüyü alır, 4 kart gömer.'
          : st.batakTip === 'esli' ? 'Karşılıklı oturanlar eş; ihaleyi takım tutturmaya çalışır.' : 'Dört kişi, herkes kendi için oynar. İhaleyi alan kozu seçer.');
      sh += row('El sayısı', seg('batakEl', (view.batakEller || [5, 7, 11]).map((x) => [x, String(x)]), st.batakEl));
      sh += secsRow;
    } else if (game === 'uno') {
      sh += row('Hedef puan', seg('unoTarget', [[100, '100'], [200, '200'], [300, '300'], [500, '500']], st.unoTarget));
      sh += row('+2 / +4 biriktirme', seg('unoStack', [['false', 'Kapalı'], ['true', 'Açık']], st.unoStack),
        st.unoStack ? '+2 gelince +2 ya da +4, +4 gelince +4 atıp cezayı sıradakine aktarabilirsin.' : '+2 ya da +4 gelen kartları çeker, sırası geçer.');
      sh += secsRow;
      sh += '<p class="help">2, 3 ya da 4 kişi. Elinde 2 kart kalınca "SON!" demeyi unutma.</p>';
    } else {
      sh += row('Başlangıç parası', seg('emlakPara', (view.emlakParalar || [1000, 1500, 2000]).map((x) => [x, money(x)]), st.emlakPara));
      sh += row('Oyun sonu', seg('emlakTur', [[0, 'Son kalan'], [20, '20 tur'], [30, '30 tur'], [50, '50 tur']], st.emlakTur),
        st.emlakTur ? `${st.emlakTur} tur sonunda en zengin (para + mülk + bina) kazanır.` : 'Herkes iflas edene kadar sürer; son kalan kazanır.');
      sh += row('Otopark kumbarası', seg('emlakOtopark', [['false', 'Kapalı'], ['true', 'Açık']], st.emlakOtopark),
        st.emlakOtopark ? 'Vergiler ve cezalar ortada birikir; Otopark\'a gelen hepsini alır.' : 'Resmî kural: Otopark\'ta bir şey olmaz.');
      sh += secsRow;
      sh += '<p class="help">22 İstanbul semti gerçek konut fiyatlarına göre ucuzdan pahalıya dizildi. Zar at, al, kirayı topla, ev ve otel kur.</p>';
    }
    sh += '</div>';
    $('#lsettings').innerHTML = sh;
    $('#ljoin').innerHTML = '<div class="card-dark"><h2>Arkadaşların nasıl girecek?</h2>' + joinHTML(false) + '</div>';
  }

  function joinHTML(light) {
    const urls = view && view.lan && view.lan.length ? view.lan : [location.origin];
    const url = urls[0];
    const pub = /^https:/.test(url);
    let qr = '';
    try { qr = window.QR ? window.QR.svg(url) : ''; } catch (e) {}
    return `<div class="join${light ? ' light' : ''}">` + (qr ? `<div class="qr">${qr}</div>` : '') +
      `<div>${pub ? '<p class="netname">İnternet linki açık</p>' : (view && view.net && view.net.wifi && !view.net.sharing ? `<p class="netname">Oyunun ağı: <b>${esc(view.net.wifi)}</b></p>` : '')}<p>${pub ? 'Telefon hangi ağda olursa olsun (mobil veriyle de olur) kodu okutsun ya da linke girsin:' : view && view.net && view.net.sharing ? `Önce Wi-Fi'dan ${view.net.ssid ? '<b>' + esc(view.net.ssid) + '</b> ağına' : 'oyun bilgisayarının açtığı ağa'} bağlansınlar, sonra kodu okutsunlar ya da şunu yazsınlar:` : 'Aynı Wi-Fi\'a bağlanıp kodu kamerayla okutsunlar ya da tarayıcıya şunu yazsınlar:'}</p><div class="url">${esc(url.replace(/^https?:\/\//, ''))}</div>` +
      (urls.length > 1 && !pub ? `<div class="alt">Olmazsa: ${urls.slice(1).map((u) => esc(u.replace(/^http:\/\//, ''))).join(', ')}</div>` : '') +
      (!pub && ipPrefix(url) ? `<div class="alt">Giremeyen olursa telefonunun Wi-Fi ayrıntılarına baksın: IP adresi genelde <b>${esc(ipPrefix(url))}</b> ile başlar. Başlamıyorsa başka bir ağdadır.</div>` : '') + '</div></div>';
  }

  function ipPrefix(url) {
    const m = String(url).match(/^https?:\/\/(\d+)\.(\d+)\.(\d+)\.\d+/);
    return m ? `${m[1]}.${m[2]}.${m[3]}.` : '';
  }

  function sitAt(seat) {
    const v = view;
    if (v.me >= 0) { api('sit', { seat }); return; }
    const name = $('#nameIn').value.trim();
    if (!name) {
      const nb = $('#nameBar');
      nb.classList.remove('shake'); void nb.offsetWidth; nb.classList.add('shake');
      $('#nameIn').focus();
      toast('Önce adını yaz.');
      return;
    }
    joinAs(name, seat);
  }
  function joinAs(name, seat) {
    post({ type: 'join', name, token, seat })
      .then((j) => {
        if (!j.ok) { toast(j.error); return; }
        token = j.token; myName = name;
        LS.set('okey101.token', token); LS.set('okey101.name', name);
        if (j.view) onView(j.view);
        connect();
      })
      .catch(() => toast('Oyuna ulaşılamadı. İnternet / Wi-Fi bağlantını kontrol et, tekrar dene.'));
  }
  $('#nameBar').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#nameIn').value.trim();
    $('#nameIn').blur();
    if (!name) return;
    const free = view ? view.seats.findIndex((p) => !p) : -1;
    joinAs(name, free);
  });

  // ---------- Oyun ----------
  function whoHTML(seat, side) {
    const v = view, r = v.round, p = v.seats[seat];
    if (!p) return '';
    let bd = '';
    if (isOkeyN(v)) {
      bd += `<span class="tot">${r.points[seat]} puan</span>`;
      if (r.shown === seat) bd += '<span class="op">gösterge</span>';
      if (isTeam() && seat === (v.me + 2) % 4) bd += '<span class="mate">eş</span>';
      if (p.bot) bd += '<span class="bot">bot</span>';
    } else if (r.opened[seat] === 'runs') bd += `<span class="op">${r.openValue[seat]}</span>`;
    else if (r.opened[seat] === 'pairs') bd += `<span class="op">${r.openValue[seat]} çift</span>`;
    if (!isOkeyN(v)) {
      if (r.penalties[seat]) bd += `<span class="pen">+${r.penalties[seat]}</span>`;
      if (isTeam() && seat === (v.me + 2) % 4) bd += '<span class="mate">eş</span>';
    }
    if (!isOkeyN(v)) {
      if (p.bot) bd += '<span class="bot">bot</span>';
      if (v.completed > 0) bd += `<span class="tot">${v.totals[seat]} puan</span>`;
    }
    const turn = v.phase === 'playing' && r.turn === seat ? ' turn' : '';
    const av = `<div class="av${p.bot ? ' bot' : ''}">${avatarText(p)}<svg viewBox="0 0 36 36"><circle class="tr" cx="18" cy="18" r="16"/><circle class="pg" cx="18" cy="18" r="16" pathLength="100"/></svg>${p.online ? '' : '<span class="off"></span>'}</div>`;
    if (side) return `<div class="who ${teamCls(seat)}${turn}" data-seat="${seat}">${av}<div class="nm">${esc(p.name)}</div><div class="bd">${bd}</div></div>`;
    return `<div class="who ${teamCls(seat)}${turn}" data-seat="${seat}">${av}<div class="info"><div class="nm">${esc(p.name)}</div><div class="bd">${bd}</div></div></div>`;
  }

  function pileHTML(seat, role) {
    const r = view.round, d = r.discards[seat];
    let inner = '';
    if (d.top !== null) {
      const dim = role === 'take' && pendingSide !== null;
      inner = tileHTML(d.top, 'pt', r.okey).replace('class="tile', `${dim ? 'style="opacity:.3" ' : ''}class="tile`);
    }
    let lbl = '';
    if (role === 'take' && r.canTake) lbl = pendingSide !== null ? '<span class="lbl">Bırak</span>' : '<span class="lbl">Al</span>';
    if (role === 'mine' && canPlay()) lbl = '<span class="lbl">At</span>';
    return inner + lbl + (d.count > 1 ? `<span class="cnt">${d.count}</span>` : '');
  }

  function renderGame() {
    const v = view, r = v.round, me = v.me;
    syncRack(r);
    const right = (me + 1) % 4, top = (me + 2) % 4, left = (me + 3) % 4;
    $('#opp-top').innerHTML = whoHTML(top, false);
    $('#opp-left').innerHTML = whoHTML(left, true);
    $('#opp-right').innerHTML = whoHTML(right, true);

    // Atılan taşlar: herkes sağına atar
    $('#pile-tl').innerHTML = pileHTML(top);
    $('#pile-tr').innerHTML = pileHTML(right);
    $('#pile-bl').innerHTML = pileHTML(left, 'take');
    $('#pile-br').innerHTML = pileHTML(me, 'mine');
    $('#pile-bl').classList.toggle('take', !!r.canTake && pendingSide === null);
    $('#pile-br').classList.toggle('drop', canPlay());

    // Orta: deste, gösterge, durum
    const drawable = myTurn() && r.tphase === 'draw' && r.stockCount > 0;
    let mid = `<div class="deck${drawable ? ' can' : ''}" id="deck">${backHTML()}<span class="num">${r.stockCount}</span>${drawable ? '<span class="lbl">Çek</span>' : ''}</div>`;
    mid += `<div class="ind">${tileHTML(r.indicator, 'pt')}<span>Gösterge</span></div>`;
    let main;
    const mineNow = myTurn();
    if (v.phase !== 'playing') main = '';
    else if (mineNow && isOkeyN(v)) {
      if (r.tphase === 'draw') main = r.stockCount ? (r.canTake ? 'Sıra sende: çek ya da soldakini al' : 'Sıra sende: desteden çek') : 'Deste bitti: yandan al ya da eli bitir';
      else main = finishPlanN() ? 'Elin bitiyor: Bitir\'e bas!' : 'Bir taş at';
    } else if (mineNow) {
      if (r.tphase === 'draw' && pendingSide !== null) main = r.opened[me] ? 'Yandan aldığını işle ya da indir' : 'Yandan aldığınla aç';
      else if (r.tphase === 'draw') main = r.stockCount ? (r.canTake ? 'Sıra sende: çek ya da soldakini al' : 'Sıra sende: desteden çek') : 'Deste bitti';
      else if (r.hand.length === 1) main = 'Son taşını at ve bitir';
      else main = r.opened[me] ? 'İndir, işle ya da bir taş at' : 'Aç ya da bir taş at';
    } else main = 'Sıra: ' + seatName(r.turn);
    const last = v.log.length ? v.log[v.log.length - 1].text : '';
    mid += `<div class="status"><div class="main${mineNow ? ' mine' : ''}"><span>${esc(main)}</span>${deadline && v.phase === 'playing' ? '<span class="secs" id="secs"></span>' : ''}</div><div class="last">${esc(last)}</div></div>`;
    $('#mid').innerHTML = mid;

    renderMelds();
    renderRack();
    renderActions();
  }

  function renderMeldsN() {
    const v = view, r = v.round, me = v.me;
    const order = [me, (me + 1) % 4, (me + 2) % 4, (me + 3) % 4];
    let h = '<div class="nboard"><div class="nhead">Puanlar <small>(herkes ' + r.start + ' ile başladı · puanı biten kaybeder)</small></div><div class="npts">';
    order.forEach((s) => {
      const low = r.points[s] <= 4 ? ' low' : '';
      h += `<div class="npt ${teamCls(s)}${s === me ? ' me' : ''}${low}"><span>${esc(seatName(s))}</span><b>${r.points[s]}</b></div>`;
    });
    h += '</div><div class="nhint">';
    if (r.shown >= 0) h += `<b>${esc(seatName(r.shown))}</b> göstergeyi gösterdi: el bitince ${isTeam() ? 'rakip takım' : 'diğerleri'} 1 puan kaybeder.<br>`;
    h += 'Taşlarını seri ve gruplara diz (12-13-1 de olur). 15. taşı atarken kalan 14 taş tamamsa <b>Bitir</b>. Okey atarak ya da çiftle bitirmek iki kat.';
    h += '</div></div>';
    $('#melds').innerHTML = h;
  }

  function renderMelds() {
    if (isOkeyN(view)) return renderMeldsN();
    const v = view, r = v.round, me = v.me;
    const sel = selectedInOrder();
    const probe = drag ? drag.id : (sel.length === 1 ? sel[0] : null);
    const canAdd = probe !== null && r.opened[me] && (myTurn());
    let h = '';
    [me, (me + 1) % 4, (me + 2) % 4, (me + 3) % 4].forEach((seat) => {
      const ms = r.melds.filter((m) => m.owner === seat);
      if (!ms.length) return;
      h += `<div class="mrow"><span class="who2 ${teamCls(seat)}">${esc(seatName(seat))}</span>`;
      ms.forEach((m) => {
        const can = canAdd && (E.addToMeld(m, probe, r.okey) || E.swapOkey(m, probe, r.okey)) ? ' can' : '';
        h += `<div class="meld${seat === me ? ' mine' : ''}${can}" data-meld="${m.id}">` +
          m.tiles.map((id, k) => tileHTML(id, 'mini', r.okey, { rep: m.rep[k], table: true })).join('') + '</div>';
      });
      h += '</div>';
    });
    if (!h) {
      const req = r.req;
      h = `<div class="empty">Henüz kimse açmadı.<br>Açmak için ${req.runs} puanlık seri/grup ya da ${req.pairs} çift gerekir.</div>`;
    }
    $('#melds').innerHTML = h;
  }

  function renderRack() {
    const r = view.round;
    const info = rackInfo();
    const opened = r.opened[view.me];
    const now = Date.now();
    if (r.lastDrawn !== null && r.lastDrawn !== freshId) { freshId = r.lastDrawn; freshUntil = now + 2200; }
    const islek = islekSet();
    let h = '';
    for (let i = 0; i < SLOTS; i++) {
      const id = rack.slots[i];
      let t = '';
      if (id !== null) {
        let cls = '';
        if (selected.has(id)) cls += ' sel';
        if (islek.has(id)) cls += ' islek';
        if (id === pendingSide) cls += ' side';
        else if ((id === freshId && now < freshUntil) || (swapFresh.get(id) || 0) > now) cls += ' fresh';
        t = tileHTML(id, cls.trim(), r.okey, { hand: true });
      }
      h += `<div class="slot" data-slot="${i}" style="grid-row:${Math.floor(i / COLS) + 1};grid-column:${(i % COLS) + 1}">${t}</div>`;
    }
    h += totalHTML(info, r, opened);
    $('#rack').innerHTML = h;
    if (freshId !== null && now < freshUntil) {
      clearTimeout(renderRack.t);
      renderRack.t = setTimeout(() => { if (!drag && view && view.round) { const el = tileEl(freshId); if (el) el.classList.remove('fresh'); } }, freshUntil - now);
    }
  }

  // Istakanın sağ üstündeki toplam
  function totalHTML(info, r, opened) {
    if (isOkeyN(view)) {
      const cov = E.rackCoverN(rack.slots, COLS, r.okey).cov;
      const pr = E.pairsN(r.hand, r.okey).pairs;
      const pairsView = rackKind === 'pairs';
      const main = pairsView ? `<b>${pr}</b><small> / 7 çift</small>` : `<b>${Math.min(cov, 14)}</b><small> / 14 dizili</small>`;
      const ok = pairsView ? pr >= 7 : cov >= 14;
      return `<div class="rtotal${ok ? ' ok' : ''}">${main}</div><div class="rscore"><small>Puanın </small><b>${r.points[view.me]}</b></div>`;
    }
    const pairsView = opened === 'pairs' || ((!opened || (opened === 'runs' && pairsOk(r) && !info.runs.length)) && rackKind === 'pairs');
    let main, cls = '';
    if (pairsView) {
      const need = opened ? 0 : r.req.pairs;
      main = `<b>${info.pairCount}</b> çift` + (need ? `<small> / ${need}</small>` : '');
      if (need && info.pairCount >= need) cls = ' ok';
    } else {
      const need = opened ? 0 : r.req.runs;
      main = `<b>${info.runValue}</b>` + (need ? `<small> / ${need}</small>` : '');
      if (need && info.runValue >= need) cls = ' ok';
    }
    if (opened) {
      // Açtıktan sonra: elde kalan taşların cezası (biri biterse yazılacak puan)
      const ids = r.hand.concat(pendingSide !== null ? [pendingSide] : []);
      const hv = E.handValue(ids, r.okey);
      main = `<small>Elde </small><b>${hv}</b>` + (opened === 'pairs' ? '<small> ×2</small>' : '');
      cls = '';
    }
    let out = `<div class="rtotal${cls}">${main}</div>`;
    if (view.completed > 0) out += `<div class="rscore"><small>Puanın </small><b>${view.totals[view.me]}</b></div>`;
    return out;
  }

  function renderActions() {
    const p = plan();
    let val = '';
    const b = (x, cls) => x ? `<button class="btn ${cls}" data-do="${x.act}"${x.on && !busy ? '' : ' disabled'}>${esc(x.label)}${x.sub ? `<span class="sub">${esc(x.sub)}</span>` : ''}</button>` : '';
    if (p.mine && pendingSide !== null && p.primary && !p.primary.on) {
      const inAny = p.info.runs.concat(p.info.pairs).some((c) => c.tiles.indexOf(pendingSide) >= 0);
      if (!inAny) val = '<small>Yandan taşı bir perin içine koy</small>';
    }
    let h = val ? `<div class="val">${val}</div>` : '';
    h += b(p.primary, 'primary');
    h += b(p.second, '');
    if (p.link) h += `<button class="link" data-do="${p.link.act}">${esc(p.link.label)}</button>`;
    h += '<div class="row">' + (isOkeyN(view) ? '' : `<button class="btn isle${p.isleOn && !busy ? ' on' : ''}" data-do="isle"${p.isleOn && !busy ? '' : ' disabled'}>İşle</button>`) +
      '<button class="btn" data-do="sortRuns">Seri diz</button><button class="btn" data-do="sortPairs">Çift diz</button></div>';
    $('#actions').innerHTML = h;
  }

  // ---------- El sonu / oyun sonu ----------
  // İstanbul Emlak: oyun sonu
  function renderOverlayBoard() {
    const v = view, ov = $('#overlay'), r = v.round;
    if (v.phase !== 'roundEnd' && v.phase !== 'gameEnd') { ov.classList.add('hidden'); ov.innerHTML = ''; ov.dataset.k = ''; return; }
    const key = v.phase + ':' + r.id;
    if (ov.dataset.k === key) return;
    ov.dataset.k = key;
    const show = () => {
      ov.innerHTML = '<div class="card">' + window.EmlakUI.overlayHTML(v) +
        `<div class="btns">${v.phase === 'roundEnd' ? '<button class="btn primary" data-do2="next">Tamam</button>' : '<button class="btn primary" data-do2="reset">Yeni oyun</button>'}</div></div>`;
      ov.classList.remove('hidden');
    };
    if (v.phase === 'roundEnd') setTimeout(() => { if (view && view.phase === 'roundEnd' && ov.dataset.k === key) show(); }, 2200);
    else show();
  }

  function renderOverlayN(ov, firstShow) {
    const v = view, r = v.round, res = r.result, team = isTeam();
    const pts = res ? res.points : r.points;
    let h = `<div class="card"${firstShow ? '' : ' style="animation:none"'}>`;
    if (v.phase === 'roundEnd' && res) {
      h += `<h2>${esc(res.note)}</h2><p class="sub">${r.no}. el · herkes ${r.start} puanla başladı; puanı biten kaybeder</p>`;
      if (res.kind === 'win') {
        h += `<div class="nwin"><div class="nwhy">${esc(window.Dil.ek(seatName(res.winner), 'in'))} eli${res.pairs ? ' (7 çift)' : ''}${res.lastOkey ? ' · okeyle bitirdi' : ''}</div><div class="ngroups">` +
          res.groups.map((g) => '<span class="ngrp">' + g.map((id) => tileHTML(id, 'tiny', r.okey, { hand: true })).join('') + '</span>').join('') + '</div></div>';
      }
      h += '<table class="score"><tr><th>Oyuncu</th><th>Kalan taşlar</th><th class="num">Bu el</th><th class="num">Puan</th></tr>';
      const order = team ? [0, 2, 1, 3] : [0, 1, 2, 3];
      order.forEach((i) => {
        const hand = i === res.winner ? '' : sortForShow(res.hands[i], r.okey).map((id) => tileHTML(id, 'tiny', r.okey, { hand: true })).join('');
        h += `<tr class="${i === res.winner ? 'win' : ''}"><td>${team ? `<span class="tdot ${teamCls(i)}"></span>` : ''}<b>${esc(seatName(i))}</b>${res.shown === i ? ' <small>(gösterge)</small>' : ''}</td><td><div class="handline">${hand || (i === res.winner ? 'Bitirdi' : '')}</div></td>` +
          `<td class="num ${res.total[i] < 0 ? 'lossv' : ''}">${res.total[i] || ''}</td><td class="num${pts[i] <= 0 ? ' lossv' : ''}">${pts[i]}</td></tr>`;
      });
      h += '</table>';
      h += `<div class="btns"><button class="btn" data-m="scores">Puan tablosu</button><button class="btn primary" data-do2="next">${res.gameOver ? 'Sonuçları gör' : 'Sonraki el'}</button></div>`;
    } else if (v.phase === 'gameEnd') {
      const rank = [0, 1, 2, 3].sort((a, b) => pts[b] - pts[a]);
      const w = rank[0];
      const nm = (s2) => team ? `${seatName(s2)} ve ${seatName((s2 + 2) % 4)}` : seatName(s2);
      h += `<h2>Oyun bitti! Kazanan: ${esc(nm(w))}</h2><p class="sub">Puanı en yüksek olan kazanır.</p><div class="podium">`;
      // Eşlide iki takım: kazanan takım (w'nin takımı) ve diğeri; puanlar eşlerde aynıdır
      (team ? [w % 2, 1 - (w % 2)] : rank).forEach((s2, k) => { h += `<div class="pl${k === 0 ? ' first' : ''}">${team ? '' : (k + 1) + '. '}${esc(nm(s2))}<b>${pts[s2]}</b></div>`; });
      h += '</div><div class="btns"><button class="btn" data-m="scores">El el puanlar</button><button class="btn primary" data-do2="reset">Yeni oyun</button></div>';
    }
    h += '</div>';
    ov.innerHTML = h;
    ov.classList.remove('hidden');
  }

  function renderOverlay() {
    const v = view, ov = $('#overlay'), r = v.round;
    if (v.phase !== 'roundEnd' && v.phase !== 'gameEnd') { ov.classList.add('hidden'); ov.innerHTML = ''; ov.dataset.k = ''; return; }
    if (isOkeyN(v)) {
      const key = v.phase + ':' + r.id + ':' + v.seq;
      if (ov.dataset.k === key) return;
      const firstShow = !ov.dataset.k || ov.dataset.k.split(':')[0] !== v.phase || ov.dataset.k.split(':')[1] !== r.id;
      ov.dataset.k = key;
      return renderOverlayN(ov, firstShow);
    }
    const key = v.phase + ':' + r.id + ':' + v.seq;
    if (ov.dataset.k === key) return;
    const firstShow = !ov.dataset.k || ov.dataset.k.split(':')[0] !== v.phase || ov.dataset.k.split(':')[1] !== r.id;
    ov.dataset.k = key;
    const team = isTeam();
    let h = `<div class="card"${firstShow ? '' : ' style="animation:none"'}>`;
    if (v.phase === 'roundEnd' && r.result) {
      const res = r.result;
      h += `<h2>${esc(res.note)}</h2><p class="sub">${v.settings.rounds} elin ${r.no}.'si bitti</p>`;
      h += '<table class="score"><tr><th>Oyuncu</th><th>Durum</th><th>Kalan taşlar</th><th class="num">Ceza</th><th class="num">Bu el</th><th class="num">Toplam</th></tr>';
      const order = team ? [0, 2, 1, 3] : [0, 1, 2, 3];
      order.forEach((i, k) => {
        const p = v.seats[i];
        let durum = i === res.winner ? 'Bitti' : r.opened[i] === 'runs' ? `Açtı (${r.openValue[i]})` : r.opened[i] === 'pairs' ? `Çift (${r.openValue[i]})` : 'Açmadı';
        if (res.kind === 'allPairs' && res.base && res.base[i] > 0) durum += `<div class="why">elinde okey kaldı: +${res.base[i]}</div>`;
        else if (res.kind === 'stock' && r.opened[i] === 'pairs') durum += '<div class="why">kalan taşlar ×2</div>';
        const hand = sortForShow(res.hands[i], r.okey).map((id) => tileHTML(id, 'tiny', r.okey, { hand: true })).join('');
        h += `<tr class="${i === res.winner ? 'win' : ''}"><td>${team ? `<span class="tdot ${teamCls(i)}"></span>` : ''}<b>${esc(p ? p.name : '')}</b></td><td>${durum}</td><td><div class="handline">${hand}</div></td>` +
          `<td class="num">${res.penalties[i] ? '+' + res.penalties[i] : ''}</td><td class="num ${res.total[i] < 0 ? 'neg' : 'pos'}">${res.total[i]}</td><td class="num">${v.totals[i]}</td></tr>`;
        if (team && k % 2 === 1) {
          const t = Math.floor(k / 2), a = order[k - 1], bb = order[k];
          h += `<tr class="team"><td colspan="4">${esc(seatName(a))} ve ${esc(seatName(bb))}</td><td class="num">${res.total[a] + res.total[bb]}</td><td class="num">${v.teamTotals[t === 0 ? 0 : 1]}</td></tr>`;
        }
      });
      h += '</table>';
      const last = v.completed >= v.settings.rounds;
      h += `<div class="btns"><button class="btn" data-m="scores">Puan tablosu</button><button class="btn primary" data-do2="next">${last ? 'Sonuçları gör' : 'Sonraki el'}</button></div>`;
    } else if (v.phase === 'gameEnd') {
      if (team) {
        const tt = v.teamTotals, w = tt[0] <= tt[1] ? 0 : 1;
        const names = (t) => t === 0 ? `${seatName(0)} ve ${seatName(2)}` : `${seatName(1)} ve ${seatName(3)}`;
        h += `<h2>Oyun bitti! Kazanan: ${esc(names(w))}</h2><p class="sub">En düşük puanlı takım kazanır.</p><div class="podium">`;
        [w, 1 - w].forEach((t, k) => { h += `<div class="pl${k === 0 ? ' first' : ''}">${esc(names(t))}<b>${tt[t]}</b></div>`; });
        h += '</div>';
      } else {
        const rank = [0, 1, 2, 3].sort((a, b) => v.totals[a] - v.totals[b]);
        h += `<h2>Oyun bitti! Kazanan: ${esc(seatName(rank[0]))}</h2><p class="sub">En düşük puan kazanır.</p><div class="podium">`;
        rank.forEach((s, k) => { h += `<div class="pl${k === 0 ? ' first' : ''}">${k + 1}. ${esc(seatName(s))}<b>${v.totals[s]}</b></div>`; });
        h += '</div>';
      }
      h += '<div class="btns"><button class="btn" data-m="scores">El el puanlar</button><button class="btn primary" data-do2="reset">Yeni oyun</button></div>';
    }
    h += '</div>';
    ov.innerHTML = h;
    ov.classList.remove('hidden');
  }

  function sortForShow(ids, okey) {
    const key = (id) => (E.isWild(id, okey) ? { c: 9, n: 99 } : E.natural(id, okey));
    return ids.slice().sort((a, b) => { const x = key(a), y = key(b); return x.c - y.c || x.n - y.n; });
  }

  function showScores() {
    const v = view;
    const card = isCard(v);
    const team = card ? !!v.round.team : isTeam();
    // Batak eşli ve Okey eşli: takım puanı iki eşe de yazılır; takım sütunu toplam değil tek eşin puanı
    const teamSum = !(gameOf(v) === 'batak' || gameOf(v) === 'okeyn');
    const cols = [0, 1, 2, 3].filter((i) => (card ? v.round.active[i] : true));
    const dot = (i) => (team ? `<span class="tdot ${i % 2 === 0 ? 'ta' : 'tb'}"></span>` : '');
    let h = '<h2>Puan tablosu</h2>';
    if (!v.history.length) h += '<p>Henüz biten el yok.</p>';
    else {
      h += '<table class="score"><tr><th>El</th>' + cols.map((i) => `<th class="num">${dot(i)}${esc(v.seats[i] ? v.seats[i].name : '')}</th>`).join('') +
        (team ? '<th class="num"><span class="tdot ta"></span>Takım</th><th class="num"><span class="tdot tb"></span>Takım</th>' : '') + '</tr>';
      // 101'de eksi iyidir (yeşil); diğer oyunlarda puan kaybı kırmızı
      const negCls = gameOf(v) === 'okey' ? 'neg' : 'lossv';
      v.history.forEach((x) => {
        h += `<tr><td>${x.no}</td>` + cols.map((i) => `<td class="num ${x.total[i] < 0 ? negCls : ''}">${x.total[i]}</td>`).join('') +
          (team ? `<td class="num">${teamSum ? x.total[0] + x.total[2] : x.total[0]}</td><td class="num">${teamSum ? x.total[1] + x.total[3] : x.total[1]}</td>` : '') + '</tr>';
      });
      // Normal okeyde toplam yerine kalan puan gösterilir (başlangıç puanı + değişimler)
      const base = gameOf(v) === 'okeyn' ? (v.round.start || 20) : 0;
      h += `<tr class="team"><td>${base ? 'Puan' : 'Toplam'}</td>` + cols.map((i) => `<td class="num">${base + v.totals[i]}</td>`).join('') +
        (team ? `<td class="num">${teamSum ? v.teamTotals[0] : base + v.totals[0]}</td><td class="num">${teamSum ? v.teamTotals[1] : base + v.totals[1]}</td>` : '') + '</tr></table>';
      const g = gameOf(v);
      let foot;
      if (g === 'okeyn') foot = `${v.completed} el oynandı. Herkes ${base} puanla başladı; birinin puanı bitince oyun biter, en yüksek puan kazanır.`;
      else if (g === 'batak') foot = `${v.completed} / ${v.settings.batakEl || 7} el oynandı. Tutturan aldığı el kadar, batan eksi ihale yazar; en yüksek puan kazanır.`;
      else if (card) foot = `${v.completed} el oynandı. Hedef ${v.round.target} puan; en yüksek puan kazanır.`;
      else foot = `${v.completed} / ${v.settings.rounds} el oynandı. En düşük puan kazanır. Deste bitince açan elindeki taşların toplamını (çiftle açan iki katını), açmayan 202 yazar.`;
      h += `<p class="sub" style="margin-top:10px">${foot}</p>`;
    }
    h += '<div class="btns"><button class="btn primary" id="closeM">Kapat</button></div>';
    modal(h, (m) => { m.querySelector('#closeM').onclick = closeModal; });
  }

  function rulesOkeyN(st) {
    return '<h2>Okey kuralları</h2><ul class="rules">' +
      '<li>106 taş: 4 renkte 1-13, her taştan iki tane ve 2 sahte okey. Başlayana 15, diğerlerine 14 taş. Başlayan çekmeden bir taş atar.</li>' +
      '<li>Okey, göstergenin bir üstüdür (gösterge 13 ise 1). Okey her taşın yerine geçer; sahte okey (✿) okey olan taşın yerine geçer.</li>' +
      '<li>Sıranda desteden çek ya da soldakinin attığı son taşı al, sonra bir taş at. Masaya per açılmaz, işlek taş ve okey atma cezası yoktur.</li>' +
      '<li>Seri: aynı renk, ardışık en az 3 taş. 1, 13\'ün üstüne de gelebilir (12-13-1 olur, 13-1-2 olmaz). Grup: aynı sayı, farklı renk 3-4 taş.</li>' +
      '<li>Bitirmek: 15. taşı atarken kalan 14 taşın hepsi seri/grup ya da 7 çift olmalı. Taşı ortadaki desteye sürükle ya da <b>Bitir</b>\'e bas.</li>' +
      `<li>Herkes ${st.okeynPuan || 20} puanla başlar. Biri bitirince diğerleri 2 puan kaybeder; okey atarak ya da çiftle bitirince 4, çift + okeyle 8.${st.mode === 'team' ? ' Eşlide puan takımca tutulur; eşlerden biri bitirince karşı takım kaybeder.' : ''}</li>` +
      (st.okeynGosterge ? '<li>Göstergenin eşi elinde olan, ilk hamlesinde (taş çekmeden önce) <b>Göstergeyi göster</b> derse diğerleri 1 puan kaybeder.</li>' : '') +
      '<li>Deste biter ve kimse bitiremezse el puansız biter. Birinin puanı 0\'a inince oyun biter; puanı en yüksek olan kazanır.</li></ul>';
  }

  function showRules() {
    const st = view.settings;
    if (isOkeyN(view)) {
      modal(rulesOkeyN(st) + '<div class="btns"><button class="btn primary" id="closeM">Tamam</button></div>', (m) => { m.querySelector('#closeM').onclick = closeModal; });
      return;
    }
    if (isBoard(view)) {
      modal(window.EmlakUI.rulesHTML(st) + '<div class="btns"><button class="btn primary" id="closeM">Tamam</button></div>', (m) => { m.querySelector('#closeM').onclick = closeModal; });
      return;
    }
    if (isCard(view)) {
      modal(window.CardUI.rulesHTML(view.round.game, st) + '<div class="btns"><button class="btn primary" id="closeM">Tamam</button></div>', (m) => { m.querySelector('#closeM').onclick = closeModal; });
      return;
    }
    const h = '<h2>Kısa kurallar</h2><ul class="rules">' +
      '<li>Herkese 21, başlayana 22 taş. Başlayan çekmeden bir taş atar. Okey, göstergenin bir üstüdür. Her elden sonra bir sonraki oyuncu başlar.</li>' +
      '<li>Sıranda desteden çek ya da soldakinin attığını al. Yandan aldığın taşı o anda açışta ya da işlemede kullanırsın; kullanmazsan "Geri bırak" ile yerine döner.</li>' +
      '<li>Açış: tek seferde en az 101 puanlık seri/grup ya da en az 5 çift. Taşlarını ıstakada boşluklarla dizince toplamı ıstakanın sağ üstünde yazar; "Aç" hepsini birden indirir.</li>' +
      (st.katlamali ? '<li>Katlamalı: sonra açan, rakibinin açtığından en az 1 fazlasıyla açar (çiftte 1 çift fazla). Eşine katlanmaz.</li>' : '') +
      (st.mode === 'team' ? '<li>Eşli: karşılıklı oturanlar eş. Biri bitince eşinin el cezası silinir, puanlar takım olarak toplanır.</li>' : '') +
      '<li>Seri: aynı renk ardışık en az 3 taş (12-13-1 olmaz). Grup: aynı sayı farklı renk 3-4 taş.</li>' +
      '<li>Okey her taşın yerine geçer; elinde de masada da ters görünür. Sahte okey (✿) okey olan taşın yerine geçer.</li>' +
      '<li>Seriyle açtıysan ve masada çiftle açan varsa, çiftlerini de indirebilirsin.</li>' +
      '<li>Ortada taş kalmayınca son taşı atanla el biter: açan elindeki taşların toplamını (çiftle açan iki katını), açmayan 202 yazar. Elde kalan okey 101 sayılır.</li>' +
      '<li>Açtıktan sonra taşı masadaki bir pere sürükleyerek ya da "İşle" düğmesiyle işlersin. İşlenebilen ya da okey alabilen taşların altında yeşil çizgi olur.</li>' +
      '<li>Masadaki bir okeyin yerine geçen taş sende varsa (açtıysan) o taşı pere koyup okeyi alırsın. Yandan gelen taşla da olur; "İşle" bunu kendisi yapar.</li>' +
      '<li>Okey atmak ya da işlenebilecek taşı atmak 101 ceza.</li>' +
      (st.turnSecs ? `<li>Her hamle için ${st.turnSecs} saniye var. Süre dolarsa taş otomatik çekilip atılır.</li>` : '') +
      '<li>Biten −101 alır. Açanlar elindeki taşların toplamını, çiftle açanlar iki katını, açmayanlar 202 ceza yer. Okey atarak ya da çiftten bitince puanlar ikiye katlanır.</li></ul>' +
      '<div class="btns"><button class="btn primary" id="closeM">Tamam</button></div>';
    modal(h, (m) => { m.querySelector('#closeM').onclick = closeModal; });
  }

  function showInvite() {
    modal('<h2>Bağlanma adresi</h2>' + joinHTML(true) + '<p class="sub" style="margin-top:10px">Masadaysa aynı adını yazınca yerine döner.</p><div class="btns"><button class="btn primary" id="closeM">Kapat</button></div>',
      (m) => { m.querySelector('#closeM').onclick = closeModal; });
  }

  // Bağlantısı kopan birinin yerine bot oturt (kişi dönerse "yerine geç" ile devralır)
  function botInstead(seat) {
    const p = view && view.seats[seat];
    if (!p) return;
    confirmBox(`${p.name} yerine bot otursun mu?`, `${p.name} bağlı değil. Yerine bot oturur ve onun eliyle oynar. ${p.name} dönerse botun altındaki "yerine geç" ile kaldığı yerden devam eder.`, 'Bot koy')
      .then((y) => y && api('botSeat', { seat }));
  }

  function showMenu() {
    const away = view ? view.seats.map((p, i) => (p && !p.bot && !p.online && i !== view.me ? i : -1)).filter((i) => i >= 0) : [];
    const h = '<h2>Menü</h2><div class="menu">' +
      away.map((i) => `<button class="btn" data-mm="bot:${i}">${esc(view.seats[i].name)} yerine bot koy <small>(bağlantısı yok)</small></button>`).join('') +
      (isBoard(view) ? '' : '<button class="btn" data-mm="scores">Puan tablosu</button>') +
      '<button class="btn" data-mm="invite">Bağlanma adresi (QR)</button>' +
      '<button class="btn" data-mm="full">Tam ekran</button>' +
      '<button class="btn" data-mm="rules">Kısa kurallar</button>' +
      '<button class="btn" data-mm="reset">Oyunu sıfırla, lobiye dön</button>' +
      '<button class="btn" data-mm="close">Kapat</button></div>';
    modal(h, (m) => {
      m.querySelectorAll('[data-mm]').forEach((b) => {
        b.onclick = () => {
          const a = b.getAttribute('data-mm');
          closeModal();
          if (a.startsWith('bot:')) botInstead(+a.slice(4));
          else if (a === 'scores') showScores();
          else if (a === 'invite') showInvite();
          else if (a === 'rules') showRules();
          else if (a === 'full') goFull();
          else if (a === 'reset') confirmBox('Oyun sıfırlansın mı?', 'Puanlar silinir ve herkes lobiye döner.', 'Sıfırla', true).then((y) => y && api('reset'));
        };
      });
    });
  }

  function fullHelp(standalone) {
    modal('<h2>Tam ekran</h2>' + (standalone ? '<p>Zaten tam ekrandasın.</p>' :
      '<p>iPhone\'da tam ekran için Safari\'de Paylaş düğmesine basıp <b>Ana Ekrana Ekle</b>\'yi seç. Sonra ana ekrandaki 101 Okey simgesinden aç; içeri girince aynı adını yazman yeterli.</p>') +
      '<div class="btns"><button class="btn primary" id="closeM">Tamam</button></div>', (m) => { m.querySelector('#closeM').onclick = closeModal; });
  }
  function goFull() {
    const d = document.documentElement;
    const req = d.requestFullscreen || d.webkitRequestFullscreen;
    const standalone = window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    const enabled = document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false;
    if (!req || !enabled || standalone) { fullHelp(standalone); return; }
    try {
      const p = req.call(d);
      if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => fullHelp(false));
    } catch (e) { fullHelp(false); }
  }

  // =============== Süre ===============
  function updateTimer() {
    const bars = $$('#timebar, #cgtime, #emtime');
    // Süre çubuğu genişlik yerine transform ile kısalır (sayfayı yeniden dizmeden, akıcı)
    const setBar = (b, f) => { const i = b.firstElementChild, t = 'scaleX(' + f.toFixed(3) + ')'; if (i.style.transform !== t) i.style.transform = t; };
    if (!view || !view.round || view.phase !== 'playing' || !deadline) {
      bars.forEach((b) => setBar(b, 0));
      return;
    }
    const rem = Math.max(0, deadline - performance.now());
    const frac = Math.min(1, rem / turnTotal);
    const low = rem < 10000;
    const mine = isBoard(view) ? window.EmlakUI.myMove(view) : myTurn();
    bars.forEach((b) => { setBar(b, mine ? frac : 0); b.classList.toggle('low', low); });
    $$('.who.turn .pg').forEach((c) => { c.style.strokeDashoffset = (100 * (1 - frac)).toFixed(1); c.classList.toggle('low', low); });
    const s = $('#secs');
    if (s) { const txt = String(Math.ceil(rem / 1000)); if (s.textContent !== txt) s.textContent = txt; s.classList.toggle('low', low); }
    if (mine && rem < 5000 && rem > 0 && !warned) {
      warned = true;
      if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate([60, 80, 60]); } catch (e) {} }
    }
  }
  setInterval(updateTimer, 250);

  // =============== Animasyon ===============
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  const tileEl = (id) => document.querySelector(`#rack .tile[data-tile="${id}"]`);

  function captureRects() {
    const o = { tiles: {}, av: {}, deck: null };
    if ($('#game').classList.contains('hidden')) return o;
    $$('#rack .tile[data-tile]').forEach((el) => { o.tiles[el.dataset.tile] = el.getBoundingClientRect(); });
    o.deck = rectOf($('#deck .tile'));
    $$('.who[data-seat]').forEach((el) => { o.av[el.dataset.seat] = el.querySelector('.av').getBoundingClientRect(); });
    return o;
  }

  // Bir taşı bir yerden ötekine uçurur (yumuşak bir yay çizerek).
  function fly(html, from, toEl, o) {
    o = o || {};
    if (reduceMotion || !from || !toEl || !from.width) return;
    const to = toEl.getBoundingClientRect ? toEl.getBoundingClientRect() : toEl;
    if (!to.width) return;
    const w = o.w || to.width, h = o.h || to.height;
    const wrap = document.createElement('div');
    wrap.className = 'fly';
    wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
    wrap.innerHTML = html;
    const t = wrap.firstElementChild;
    if (t) { t.style.setProperty('--w', w + 'px'); t.style.setProperty('--h', h + 'px'); }
    $('#fx').appendChild(wrap);
    const fx = from.left + from.width / 2 - w / 2, fy = from.top + from.height / 2 - h / 2;
    const tx = to.left + to.width / 2 - w / 2, ty = to.top + to.height / 2 - h / 2;
    const fs = o.fromScale != null ? o.fromScale : from.width / w;
    const ts = o.toScale != null ? o.toScale : (o.w ? to.width / w : 1);
    const mx = (fx + tx) / 2, my = (fy + ty) / 2 - Math.min(40, Math.abs(tx - fx) * .12 + 12);
    const hideEl = o.hide && toEl.style ? toEl : null;
    if (hideEl) hideEl.style.visibility = 'hidden';
    const anim = wrap.animate([
      { transform: `translate(${fx}px,${fy}px) scale(${fs})`, opacity: o.fromOpacity != null ? o.fromOpacity : 1 },
      { transform: `translate(${mx}px,${my}px) scale(${(fs + ts) / 2 * 1.06})`, opacity: 1, offset: .5 },
      { transform: `translate(${tx}px,${ty}px) scale(${ts})`, opacity: o.toOpacity != null ? o.toOpacity : 1 },
    ], { duration: o.dur || 430, delay: o.delay || 0, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' });
    const done = () => { wrap.remove(); if (hideEl) hideEl.style.visibility = ''; };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  function dealAnim() {
    if (reduceMotion) return;
    const deck = rectOf($('#deck .tile'));
    if (!deck) return;
    rack.slots.forEach((id, i) => {
      if (id === null) return;
      const el = tileEl(id);
      if (!el) return;
      fly(tileHTML(id, '', view.round.okey, { hand: true }), deck, el, { hide: true, delay: i * 14, dur: 380, fromScale: .7 });
    });
  }

  function animateDiff(pv, nv, rects) {
    const pr = pv.round, nr = nv.round, me = nv.me;
    if (!pr || !nr) return;
    // Benim çektiğim taş
    if (nr.turn === me && pr.tphase === 'draw' && nr.tphase === 'play' && nr.stockCount === pr.stockCount - 1 && nr.lastDrawn !== null) {
      const el = tileEl(nr.lastDrawn);
      if (el) fly(tileHTML(nr.lastDrawn, '', nr.okey, { hand: true }), rects.deck || rectOf($('#deck .tile')), el, { hide: true });
    }
    // Normal okeyde yandan alınan taş
    if (isOkeyN(nv) && nr.turn === me && pr.tphase === 'draw' && nr.tphase === 'play' && nr.lastDrawn !== null && nr.stockCount === pr.stockCount) {
      const el = tileEl(nr.lastDrawn), left = (me + 3) % 4;
      const src = rectOf($('#pile-bl .tile'));
      if (el && src && pr.discards[left].top === nr.lastDrawn) fly(tileHTML(nr.lastDrawn, '', nr.okey, { hand: true }), src, el, { hide: true });
    }
    // Atılan taşlar
    for (let s = 0; s < 4; s++) {
      const a = pr.discards[s], b = nr.discards[s];
      if (b.count === a.count + 1 && b.top !== null) {
        const pileId = s === me ? '#pile-br' : s === (me + 1) % 4 ? '#pile-tr' : s === (me + 2) % 4 ? '#pile-tl' : '#pile-bl';
        const dst = $(pileId + ' .tile');
        const from = s === me ? rects.tiles[b.top] : rects.av[s];
        if (dst && from) fly(tileHTML(b.top, 'pt', nr.okey), from, dst, { hide: true, w: dst.offsetWidth, h: dst.offsetHeight, fromScale: s === me ? from.width / dst.offsetWidth : .6 });
      }
    }
    // Rakiplerin desteden çekişi
    for (let s = 0; s < 4; s++) {
      if (s === me) continue;
      if (nr.handCounts[s] === pr.handCounts[s] + 1 && nr.stockCount === pr.stockCount - 1) {
        const to = rects.av[s] || rectOf($(`.who[data-seat="${s}"] .av`));
        const from = rectOf($('#deck .tile'));
        const pw = from ? from.width : 30;
        if (to && from) fly(backHTML(), from, { left: to.left, top: to.top, width: to.width, height: to.height, getBoundingClientRect: null }, { w: pw, h: from.height, toScale: .45, toOpacity: 0, dur: 420 });
      }
    }
    // Yeni perler ve işlenen taşlar
    const prev = new Map(pr.melds.map((m) => [m.id, m.tiles]));
    let k = 0;
    nr.melds.forEach((m) => {
      const el = document.querySelector(`.meld[data-meld="${m.id}"]`);
      if (!el) return;
      if (!prev.has(m.id)) { el.style.animationDelay = (k++ * 70) + 'ms'; el.classList.add('pop'); }
      else if (m.tiles.some((id) => prev.get(m.id).indexOf(id) < 0)) {
        const old = new Set(prev.get(m.id));
        m.tiles.forEach((id, i) => { if (!old.has(id)) { const t = el.children[i]; if (t) t.classList.add('pop'); } });
      }
    });
  }

  // Istaka yeniden dizilince taşları eski yerlerinden kaydırarak getirir.
  function slideRack(rects) {
    if (reduceMotion) return;
    $$('#rack .tile[data-tile]').forEach((el, i) => {
      const old = rects.tiles[el.dataset.tile];
      if (!old) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left, dy = old.top - now.top;
      if (!dx && !dy) return;
      el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 360, delay: Math.min(i * 6, 120), easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' });
    });
  }

  // =============== Dokunma / sürükleme ===============
  const rackEl = $('#rack');
  rackEl.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const tEl = e.target.closest('.tile');
    const slotEl = e.target.closest('.slot');
    const pill = e.target.closest('.pill');
    if (pill) return;
    if (!tEl || !slotEl) {
      if (slotEl && selected.size === 1) {
        const only = selectedInOrder()[0];
        const from = rack.slots.indexOf(only);
        if (from >= 0) {
          const rects = captureRects();
          moveTile(only, from, +slotEl.dataset.slot);
          selected.clear();
          render();
          slideRack(rects);
        }
      }
      return;
    }
    drag = { id: +tEl.dataset.tile, slot: +slotEl.dataset.slot, x0: e.clientX, y0: e.clientY, started: false, el: tEl, ghost: null, target: null, hl: null };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.started) {
      if (dx * dx + dy * dy < 81) return;
      drag.started = true;
      const g = drag.el.cloneNode(true);
      g.classList.remove('sel', 'fresh', 'side');
      g.classList.add('ghost');
      g.style.setProperty('--w', drag.el.offsetWidth + 'px');
      g.style.setProperty('--h', drag.el.offsetHeight + 'px');
      document.body.appendChild(g);
      drag.ghost = g;
      drag.el.classList.add('lift');
      // işlenebilecek perleri parlat
      const r = view.round;
      if (r.opened[view.me] && myTurn()) {
        $$('.meld[data-meld]').forEach((m) => {
          const mm = r.melds.find((x) => x.id === +m.dataset.meld);
          if (mm && E.addToMeld(mm, drag.id, r.okey)) m.classList.add('can');
        });
      }
    }
    const rect = drag.ghost.getBoundingClientRect();
    drag.ghost.style.left = (e.clientX - rect.width / 2) + 'px';
    drag.ghost.style.top = (e.clientY - rect.height * .8) + 'px';
    findTarget(e.clientX, e.clientY);
    e.preventDefault();
  }, { passive: false });

  function setHot(el) {
    if (drag.hl === el) return;
    if (drag.hl) drag.hl.classList.remove('hot');
    drag.hl = el;
    if (el) el.classList.add('hot');
  }
  function findTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    drag.target = null;
    if (!el) { setHot(null); return; }
    const slot = el.closest('.slot');
    if (slot && rackEl.contains(slot)) { drag.target = { kind: 'slot', slot: +slot.dataset.slot }; setHot(slot); return; }
    if (el.closest('#pile-br')) { drag.target = { kind: 'discard' }; setHot($('#pile-br')); return; }
    if (isOkeyN(view) && el.closest('#deck') && view.round.tphase === 'play' && myTurn()) { drag.target = { kind: 'finish' }; setHot($('#deck')); return; }
    if (el.closest('#pile-bl') && drag.id === pendingSide) { drag.target = { kind: 'giveBack' }; setHot($('#pile-bl')); return; }
    const meld = el.closest('.meld');
    if (meld) {
      const rc = meld.getBoundingClientRect();
      drag.target = { kind: 'meld', meld: +meld.dataset.meld, at: x < rc.left + rc.width / 2 ? 'start' : 'end' };
      setHot(meld);
      return;
    }
    setHot(null);
  }

  function endDrag(cancelled) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.ghost) d.ghost.remove();
    if (d.hl) d.hl.classList.remove('hot');
    if (d.el) d.el.classList.remove('lift');
    $$('.meld.can').forEach((m) => m.classList.remove('can'));
    let rects = null;
    if (!cancelled) {
      if (!d.started) {
        if (selected.has(d.id)) selected.delete(d.id); else selected.add(d.id);
      } else if (d.target) {
        if (d.target.kind === 'slot') { moveTile(d.id, d.slot, d.target.slot); }
        else if (d.target.kind === 'discard') discardTile(d.id);
        else if (d.target.kind === 'finish') {
          selected.clear(); selected.add(d.id);
          const f = finishPlanN();
          if (f && f.tile === d.id) doAct('finish');
          else { selected.clear(); toast('Bu taşı atınca elin bitmiyor.'); }
        }
        else if (d.target.kind === 'giveBack') { pendingRender = false; giveBack(); return; }
        else if (d.target.kind === 'meld') addTile(d.id, d.target.meld, d.target.at);
      }
    }
    pendingRender = false;
    render();
    if (rects) slideRack(rects);
  }
  window.addEventListener('pointerup', () => { if (drag) endDrag(false); });
  window.addEventListener('pointercancel', () => { if (drag) endDrag(true); });

  document.addEventListener('click', (e) => {
    const t = e.target;
    // Lobi
    const sit = t.closest('[data-sit]');
    if (sit) { sitAt(+sit.dataset.sit); return; }
    const rec = t.closest('[data-reclaim]');
    if (rec) { const s = +rec.dataset.reclaim; joinAs(view.seats[s].name, s); return; }
    const kick = t.closest('[data-kick]');
    if (kick) { api('kick', { seat: +kick.dataset.kick }); return; }
    const bs = t.closest('[data-botseat]');
    if (bs) { botInstead(+bs.dataset.botseat); return; }
    const set = t.closest('[data-set]');
    if (set) {
      const k = set.dataset.set, raw = set.dataset.val;
      const val = ['katlamali', 'unoStack', 'okeynGosterge', 'emlakOtopark'].includes(k) ? raw === 'true' : (['mode', 'game', 'batakTip'].includes(k) ? raw : +raw);
      api('settings', { [k]: val });
      return;
    }
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'start') api('start');
      else if (a === 'leave') api('leave');
      else if (a === 'fillBots') api('fillBots');
      return;
    }
    const bot = t.closest('[data-bot]');
    if (bot) { api('addBot', { seat: +bot.dataset.bot }); return; }
    const take = t.closest('[data-takeover]');
    if (take) {
      const name = $('#nameIn').value.trim();
      if (!name) {
        const nb = $('#nameBar');
        nb.classList.remove('shake'); void nb.offsetWidth; nb.classList.add('shake');
        $('#nameIn').focus();
        toast('Önce adını yaz, sonra "yerine geç"e dokun.');
        return;
      }
      joinAs(name, +take.dataset.takeover);
      return;
    }
    if (t.closest('[data-m="scores"]')) { showScores(); return; }
    const d2 = t.closest('[data-do2]');
    if (d2) { api(d2.dataset.do2, null, d2.dataset.do2 === 'next'); return; }
    if (!view || !view.round || isCard(view)) return;
    // Oyun
    if (t.closest('#menuBtn')) { showMenu(); return; }
    const d = t.closest('[data-do]');
    if (d) { if (!d.disabled) doAct(d.dataset.do); return; }
    if (t.closest('#deck') && isOkeyN(view)) {
      const r = view.round;
      if (!myTurn()) toast('Sıra sende değil.');
      else if (r.tphase === 'draw') doAct(r.stockCount ? 'draw' : 'endStock');
      else if (finishPlanN()) doAct('finish');
      else toast('Bu turda taş aldın. Şimdi bir taş at (elin bitince Bitir).');
      return;
    }
    if (t.closest('#pile-bl') && isOkeyN(view)) {
      if (view.round.canTake) doAct('take');
      else if (myTurn() && view.round.tphase === 'play') toast('Bu turda taş aldın.');
      return;
    }
    if (t.closest('#deck')) {
      const r = view.round;
      if (!myTurn()) toast('Sıra sende değil.');
      else if (r.tphase !== 'draw') toast('Bu turda taş aldın. Şimdi bir taş at.');
      else if (!r.stockCount) toast('Deste bitti.');
      else doAct('draw');
      return;
    }
    if (t.closest('#pile-bl')) {
      if (pendingSide !== null) giveBack();
      else if (view.round.canTake) takeSide();
      else if (myTurn() && view.round.tphase === 'play') toast('Bu turda taş aldın.');
      return;
    }
    if (t.closest('#pile-br')) {
      const sel = selectedInOrder();
      if (canPlay() && sel.length === 1) discardTile(sel[0]);
      else if (canPlay()) toast('Atmak için ıstakadan bir taş seç ya da buraya sürükle.');
      return;
    }
    const meld = t.closest('.meld');
    if (meld) {
      const sel = selectedInOrder();
      if (sel.length !== 1) { toast('İşlemek için tek bir taş seç, sonra pere dokun. Ya da taşı pere sürükle.'); return; }
      const rc = meld.getBoundingClientRect();
      addTile(sel[0], +meld.dataset.meld, e.clientX < rc.left + rc.width / 2 ? 'start' : 'end');
    }
  });

  // =============== Boyutlar ===============
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const big = vh >= 560 && vw >= 900;
    const compact = vh < 430;
    const actW = Math.round(big ? Math.min(160, vw * .13) : Math.max(86, Math.min(118, vw * .115)));
    let tw = Math.floor((vw - actW - 30) / COLS) - 3;
    tw = Math.min(tw, big ? 66 : 60);
    let th = Math.round(tw * 1.34);
    const maxTh = Math.floor((vh * (vh < 400 ? .37 : .38) - 26) / 2);
    if (th > maxTh) { th = maxTh; tw = Math.floor(th / 1.34); }
    tw = Math.max(tw, 18); th = Math.max(th, 24);
    const trayH = 2 * (th + 8) + 4 + 9 + 5;
    const tableH = vh - trayH;
    let pw = Math.max(22, Math.min(big ? 58 : 46, Math.round(tw * .82)));
    let ph = Math.round(pw * 1.34);
    const maxPh = Math.floor((tableH * .62 - 18) / 2) - 12;
    if (ph > maxPh) { ph = Math.max(28, maxPh); pw = Math.round(ph / 1.34); }
    const mw = Math.max(18, Math.min(big ? 44 : 32, Math.round(tw * (big ? .66 : .6))));
    document.body.classList.toggle('compact', compact);
    const st = document.documentElement.style;
    st.setProperty('--tw', tw + 'px');
    st.setProperty('--th', th + 'px');
    st.setProperty('--mw', mw + 'px');
    st.setProperty('--mh', Math.round(mw * 1.34) + 'px');
    st.setProperty('--pw', pw + 'px');
    st.setProperty('--ph', ph + 'px');
    st.setProperty('--actw', actW + 'px');
    st.setProperty('--sidew', (big ? Math.max(130, pw + 70) : Math.max(74, pw + 36)) + 'px');
  }
  window.addEventListener('resize', () => { layout(); });
  window.addEventListener('orientationchange', () => setTimeout(layout, 200));
  layout();
  connect();
})();
