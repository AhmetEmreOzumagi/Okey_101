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
  function renderActionsSoon() { clearTimeout(actTimer); actTimer = setTimeout(() => { if (view && view.round && !drag) renderActions(); }, 0); }

  function onView(v) {
    if (!v || typeof v !== 'object') return;
    if (view && v.boot === view.boot && typeof v.seq === 'number' && v.seq < view.seq) return;
    view = v;
    if (v.round && v.round.remainingMs != null && v.phase === 'playing') {
      deadline = performance.now() + v.round.remainingMs;
      turnTotal = Math.max(1000, (v.settings.turnSecs || 30) * 1000);
    } else deadline = 0;
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
      rack.slots = Array.isArray(saved) && saved.length === SLOTS ? saved : E.arrangeRack(r.hand, r.okey, 'runs', COLS, 2);
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

  // =============== Ne yapılabilir? ===============
  function plan() {
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
    rack.slots = E.arrangeRack(ids, r.okey, kind, COLS, 2);
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
    if (!finishing) {
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
    document.body.classList.toggle('in-game', !!inGame);
    $('#lobby').classList.toggle('hidden', !!inGame);
    $('#game').classList.toggle('hidden', !inGame);
    const before = lastRendered;
    if (inGame) {
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
  function renderLobby(before) {
    const v = view, me = v.me, seated = me >= 0, lobby = v.phase === 'lobby', team = v.settings.mode === 'team';
    $('#nameBar').classList.toggle('hidden', seated);
    if (!nameInit) { $('#nameIn').value = myName; nameInit = true; }
    const base = seated ? me : 0;
    const pos = (seat) => ['p-bottom', 'p-right', 'p-top', 'p-left'][(seat - base + 4) % 4];
    const filled = v.seats.filter((p) => p).length;
    let h = '<div class="ltable"><div class="board"></div><div class="tcenter">';
    if (lobby) {
      const st = v.settings;
      h += '<div class="tags">' +
        `<span class="tag">${team ? 'Eşli' : 'Eşsiz'}</span>` +
        (st.katlamali ? '<span class="tag">Katlamalı</span>' : '') +
        `<span class="tag">${st.turnSecs ? st.turnSecs + ' sn' : 'Süresiz'}</span>` +
        `<span class="tag">${st.rounds} el</span></div>`;
      h += `<div class="count">${filled} / 4 oyuncu</div>`;
      if (seated) {
        h += `<button class="btn primary" data-act="start"${filled === 4 ? '' : ' disabled'}>Oyunu başlat</button>`;
        if (filled < 4) h += `<button class="lnk botfill" data-act="fillBots">Boş yerlere bot oturt (${4 - filled})</button>`;
      } else h += '<div class="count">Adını yaz, boş bir sandalyeye dokun</div>';
    } else {
      const bots = v.seats.some((p) => p && p.bot);
      h += '<div class="count">Oyun sürüyor</div><div class="teamnote">' +
        (seated ? '' : 'Masadaysan kendi sandalyene dokun, yerine dönersin.' + (bots ? ' Yeni geldiysen adını yaz, bir botun sandalyesine dokun; onun yerine oynarsın.' : '')) + '</div>';
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
        if (lobby && seated && !isMe && !p.online) h += ` <button class="lnk" data-kick="${s}">çıkar</button>`;
        if (lobby && seated && p.bot) h += ` <button class="lnk" data-kick="${s}">çıkar</button>`;
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
    const st = v.settings, dis = !(seated && lobby);
    const seg = (key, opts, cur) => '<div class="seg">' + opts.map((o) =>
      `<button data-set="${key}" data-val="${o[0]}" class="${String(o[0]) === String(cur) ? 'on' : ''}"${dis ? ' disabled' : ''}>${o[1]}</button>`).join('') + '</div>';
    let sh = '<div class="card-dark"><h2>Oyun ayarları</h2>';
    sh += '<div class="setrow"><span class="lbl">Oyun</span>' + seg('mode', [['solo', 'Eşsiz'], ['team', 'Eşli']], st.mode) +
      (team ? '<span class="help">Karşılıklı oturanlar eş olur, puanlar toplanır. Biri bitince eşinin el cezası silinir.</span>' : '') + '</div>';
    sh += '<div class="setrow"><span class="lbl">Katlamalı</span>' + seg('katlamali', [['false', 'Kapalı'], ['true', 'Açık']], st.katlamali) +
      (st.katlamali ? '<span class="help">Sonra açan, rakibinin açtığından en az 1 fazlasıyla açar (çiftte de 1 çift fazla). Eşine katlanmaz.</span>' : '') + '</div>';
    sh += '<div class="setrow"><span class="lbl">Hamle süresi</span>' + seg('turnSecs', [[20, '20 sn'], [30, '30 sn'], [45, '45'], [60, '60'], [0, 'Yok']], st.turnSecs) + '</div>';
    sh += '<div class="setrow"><span class="lbl">El sayısı</span>' + seg('rounds', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9'], [11, '11']], st.rounds) + '</div>';
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
    if (r.opened[seat] === 'runs') bd += `<span class="op">${r.openValue[seat]}</span>`;
    else if (r.opened[seat] === 'pairs') bd += `<span class="op">${r.openValue[seat]} çift</span>`;
    if (r.penalties[seat]) bd += `<span class="pen">+${r.penalties[seat]}</span>`;
    if (isTeam() && seat === (v.me + 2) % 4) bd += '<span class="mate">eş</span>';
    if (p.bot) bd += '<span class="bot">bot</span>';
    if (v.completed > 0) bd += `<span class="tot">${v.totals[seat]} puan</span>`;
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
    else if (mineNow) {
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

  function renderMelds() {
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
    h += `<div class="row"><button class="btn isle${p.isleOn && !busy ? ' on' : ''}" data-do="isle"${p.isleOn && !busy ? '' : ' disabled'}>İşle</button>` +
      '<button class="btn" data-do="sortRuns">Seri diz</button><button class="btn" data-do="sortPairs">Çift diz</button></div>';
    $('#actions').innerHTML = h;
  }

  // ---------- El sonu / oyun sonu ----------
  function renderOverlay() {
    const v = view, ov = $('#overlay'), r = v.round;
    if (v.phase !== 'roundEnd' && v.phase !== 'gameEnd') { ov.classList.add('hidden'); ov.innerHTML = ''; ov.dataset.k = ''; return; }
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
    const v = view, team = isTeam();
    let h = '<h2>Puan tablosu</h2>';
    if (!v.history.length) h += '<p>Henüz biten el yok.</p>';
    else {
      h += '<table class="score"><tr><th>El</th>' + v.seats.map((p, i) => `<th class="num">${team ? `<span class="tdot ${teamCls(i)}"></span>` : ''}${esc(p ? p.name : '')}</th>`).join('') +
        (team ? '<th class="num"><span class="tdot ta"></span>Takım</th><th class="num"><span class="tdot tb"></span>Takım</th>' : '') + '</tr>';
      v.history.forEach((x) => {
        h += `<tr><td>${x.no}</td>` + x.total.map((n) => `<td class="num ${n < 0 ? 'neg' : ''}">${n}</td>`).join('') +
          (team ? `<td class="num">${x.total[0] + x.total[2]}</td><td class="num">${x.total[1] + x.total[3]}</td>` : '') + '</tr>';
      });
      h += '<tr class="team"><td>Toplam</td>' + v.totals.map((n) => `<td class="num">${n}</td>`).join('') +
        (team ? `<td class="num">${v.teamTotals[0]}</td><td class="num">${v.teamTotals[1]}</td>` : '') + '</tr></table>';
      h += `<p class="sub" style="margin-top:10px">${v.completed} / ${v.settings.rounds} el oynandı. En düşük puan kazanır. Deste bitince açan elindeki taşların toplamını (çiftle açan iki katını), açmayan 202 yazar.</p>`;
    }
    h += '<div class="btns"><button class="btn primary" id="closeM">Kapat</button></div>';
    modal(h, (m) => { m.querySelector('#closeM').onclick = closeModal; });
  }

  function showRules() {
    const st = view.settings;
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

  function showMenu() {
    const h = '<h2>Menü</h2><div class="menu">' +
      '<button class="btn" data-mm="scores">Puan tablosu</button>' +
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
          if (a === 'scores') showScores();
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
    const bar = $('#timebar');
    if (!view || !view.round || view.phase !== 'playing' || !deadline) {
      bar.firstElementChild.style.width = '0';
      return;
    }
    const rem = Math.max(0, deadline - performance.now());
    const frac = Math.min(1, rem / turnTotal);
    const low = rem < 10000;
    const mine = myTurn();
    bar.firstElementChild.style.width = mine ? (frac * 100).toFixed(2) + '%' : '0';
    bar.classList.toggle('low', low);
    $$('.who.turn .pg').forEach((c) => { c.style.strokeDashoffset = (100 * (1 - frac)).toFixed(2); c.classList.toggle('low', low); });
    const s = $('#secs');
    if (s) { s.textContent = Math.ceil(rem / 1000); s.classList.toggle('low', low); }
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
    const set = t.closest('[data-set]');
    if (set) {
      const k = set.dataset.set, raw = set.dataset.val;
      const val = k === 'katlamali' ? raw === 'true' : (k === 'mode' ? raw : +raw);
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
        toast('Önce adını yaz, sonra botun sandalyesine dokun.');
        return;
      }
      joinAs(name, +take.dataset.takeover);
      return;
    }
    if (t.closest('[data-m="scores"]')) { showScores(); return; }
    const d2 = t.closest('[data-do2]');
    if (d2) { api(d2.dataset.do2, null, d2.dataset.do2 === 'next'); return; }
    if (!view || !view.round) return;
    // Oyun
    if (t.closest('#menuBtn')) { showMenu(); return; }
    const d = t.closest('[data-do]');
    if (d) { if (!d.disabled) doAct(d.dataset.do); return; }
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
