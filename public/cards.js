/* Pişti ve Uno masası — telefon arayüzü. app.js çağırır: CardUI.render(view, yardımcılar) */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  let C = null; // app.js yardımcıları: api, toast, esc, modal, closeModal, avatarText, showMenu
  let V = null; // son görünüm
  let roundId = null, seenEv = 0;
  let sel = null; // seçili kart
  let udisc = []; // uno: yerdeki son kartlar (üstteki dahil)
  let bound = false;

  // =============== Kartlar ===============
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const prk = (id) => (id % 13) + 1;
  const pst = (id) => Math.floor(id / 13);

  function pcard(id, cls) {
    const r = prk(id), s = pst(id), red = s === 1 || s === 2;
    const ix = `<b>${RANKS[r]}</b><i>${SUITS[s]}</i>`;
    let mid;
    if (r === 1) mid = `<span class="pm ace">${SUITS[s]}</span>`;
    else if (r >= 11) mid = `<span class="pm face"><b>${RANKS[r]}</b><i>${SUITS[s]}</i></span>`;
    else mid = `<span class="pm">${SUITS[s]}</span>`;
    return `<div class="pc${red ? ' red' : ''}${cls ? ' ' + cls : ''}" data-card="${id}"><span class="ix">${ix}</span>${mid}<span class="ix bt">${ix}</span></div>`;
  }

  const UCOL = ['r', 'y', 'g', 'b'];
  const UCOL_TR = ['Kırmızı', 'Sarı', 'Yeşil', 'Mavi'];
  function uinfo(id) {
    if (id >= 104) return { c: -1, t: 'wild4' };
    if (id >= 100) return { c: -1, t: 'wild' };
    const c = Math.floor(id / 25), k = id % 25;
    if (k === 0) return { c, t: 'num', n: 0 };
    if (k <= 18) return { c, t: 'num', n: ((k - 1) >> 1) + 1 };
    if (k <= 20) return { c, t: 'skip' };
    if (k <= 22) return { c, t: 'rev' };
    return { c, t: 'draw2' };
  }
  function ucard(id, cls) {
    const x = uinfo(id);
    let sym, big, ul = '';
    if (x.t === 'num') { sym = big = String(x.n); if (x.n === 6 || x.n === 9) ul = ' ul'; }
    else if (x.t === 'skip') sym = big = '⊘';
    else if (x.t === 'rev') sym = big = '⇄';
    else if (x.t === 'draw2') sym = big = '+2';
    else if (x.t === 'wild') { sym = '★'; big = '<span class="wheel"></span>'; }
    else { sym = '+4'; big = '<span class="wheel"></span><b class="w4">+4</b>'; }
    const col = x.c >= 0 ? UCOL[x.c] : 'w';
    return `<div class="uc ${col}${ul}${cls ? ' ' + cls : ''}" data-card="${id}"><span class="ut">${sym}</span><span class="um">${big}</span><span class="ut bt">${sym}</span></div>`;
  }
  const pback = (cls) => `<div class="pc back${cls ? ' ' + cls : ''}"></div>`;
  const uback = (cls) => `<div class="uc back${cls ? ' ' + cls : ''}"><span class="ulogo"></span></div>`;
  const back = (g, cls) => (g === 'uno' ? uback(cls) : pback(cls));
  const face = (g, id, cls) => (g === 'uno' ? ucard(id, cls) : pcard(id, cls));

  function sortHand(g, ids) {
    if (g === 'uno') {
      const k = (id) => { const x = uinfo(id); return (x.c < 0 ? 9 : x.c) * 100 + (x.t === 'num' ? x.n : x.t === 'skip' ? 20 : x.t === 'rev' ? 21 : x.t === 'draw2' ? 22 : x.t === 'wild' ? 30 : 31); };
      return ids.slice().sort((a, b) => k(a) - k(b));
    }
    return ids.slice().sort((a, b) => prk(a) - prk(b) || pst(a) - pst(b));
  }

  // =============== Boyutlar ===============
  function sizes() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const big = vh >= 560 && vw >= 900;
    const tall = vh > vw * 1.15; // telefon dik tutuluyor
    let ch, pch, sh;
    if (tall) {
      ch = Math.round(Math.max(64, Math.min(vw * .34, vh * .19, 160)));
      pch = Math.round(Math.max(56, Math.min(vw * .3, vh * .16, 150)));
      sh = Math.round(Math.max(24, Math.min(vw * .1, 44)));
    } else {
      ch = Math.round(Math.max(64, Math.min(vh * (big ? .24 : .3), big ? 168 : 132)));
      pch = Math.round(Math.max(56, Math.min(vh * (big ? .2 : .25), big ? 150 : 112)));
      sh = Math.round(Math.max(24, Math.min(vh * .085, big ? 48 : 40)));
    }
    $('#cg').classList.toggle('tall', tall);
    const st = $('#cg').style;
    st.setProperty('--ch', ch + 'px');
    st.setProperty('--cw', Math.round(ch * .7) + 'px');
    st.setProperty('--pch', pch + 'px');
    st.setProperty('--pcw', Math.round(pch * .7) + 'px');
    st.setProperty('--sh', sh + 'px');
    st.setProperty('--sw', Math.round(sh * .7) + 'px');
  }

  // =============== Yerleşim ===============
  // Diğer oyuncular: sıradaki sağda, karşıdaki üstte, önceki solda. İki kişide rakip karşıda.
  function positions(v) {
    const me = v.me, act = v.round.active;
    const others = [1, 2, 3].map((k) => (me + k) % 4).filter((s) => act[s]);
    const pos = {};
    if (others.length === 1) pos[others[0]] = 'top';
    else if (others.length === 2) { pos[others[0]] = 'right'; pos[others[1]] = 'left'; }
    else { pos[others[0]] = 'right'; pos[others[1]] = 'top'; pos[others[2]] = 'left'; }
    return pos;
  }

  const myTurn = () => V && V.phase === 'playing' && V.round.turn === V.me;

  function whoHTML(v, seat) {
    const p = v.seats[seat];
    if (!p) return '';
    const r = v.round, esc = C.esc;
    let bd = '';
    if (r.game === 'pisti' && r.pistiCount[seat]) bd += `<span class="pst">${r.pistiCount[seat]} pişti</span>`;
    if (r.game === 'uno' && r.handCounts[seat] === 1) bd += `<span class="unob">${r.uno[seat] ? 'UNO!' : '1 kart'}</span>`;
    if (r.team && seat === (v.me + 2) % 4) bd += '<span class="mate">eş</span>';
    if (p.bot) bd += '<span class="bot">bot</span>';
    if (v.completed > 0) bd += `<span class="tot">${v.totals[seat]} puan</span>`;
    const turn = v.phase === 'playing' && r.turn === seat ? ' turn' : '';
    const team = r.team ? (seat % 2 === 0 ? ' ta' : ' tb') : '';
    const av = `<div class="av${p.bot ? ' bot' : ''}">${C.avatarText(p)}<svg viewBox="0 0 36 36"><circle class="tr" cx="18" cy="18" r="16"/><circle class="pg" cx="18" cy="18" r="16" pathLength="100"/></svg>${p.online ? '' : '<span class="off"></span>'}</div>`;
    return `<div class="who${team}${turn}" data-seat="${seat}">${av}<div class="info"><div class="nm">${esc(p.name)}</div><div class="bd">${bd}</div></div></div>`;
  }

  function seatHTML(v, seat, pos) {
    const r = v.round, g = r.game;
    const n = r.handCounts[seat];
    let fan = '';
    for (let i = 0; i < Math.min(n, g === 'uno' ? 8 : 4); i++) fan += back(g, 'sm');
    let extra = '';
    if (g === 'pisti') {
      const c = r.capturedCounts[seat];
      extra = `<div class="cap" data-cap="${seat}">${c ? pback('sm') : '<span class="capx"></span>'}<b>${c}</b></div>`;
    }
    const cnt = g === 'uno' ? `<span class="fcount${n === 1 ? ' one' : ''}">${n}</span>` : '';
    return `<div class="cseat p-${pos}" data-seat="${seat}"><div class="fan">${fan}${cnt}</div>${whoHTML(v, seat)}${extra}</div>`;
  }

  function tf(seed, k) {
    const rot = ((seed * 37) % 17) - 8, dx = ((seed * 13) % 9) - 4, dy = ((seed * 7) % 7) - 3;
    return `transform:translate(${dx}px,${dy}px) rotate(${rot}deg);z-index:${k + 1}`;
  }

  function centerPisti(v) {
    const r = v.round;
    const deck = r.deckCount
      ? `<div class="cdeck" id="cgdeck">${pback('pile')}${r.deckCount > 4 ? pback('pile d2') : ''}<b>${r.deckCount}</b></div>`
      : '<div class="cdeck empty" id="cgdeck"></div>';
    let pile = '';
    for (let i = 0; i < r.hidden; i++) pile += `<div class="ps" style="${tf(i * 97 + 31, i)}">${pback('pile')}</div>`;
    const start = Math.max(0, r.pile.length - 6);
    r.pile.slice(start).forEach((id, k) => { pile += `<div class="ps" style="${tf(id + 5, r.hidden + k)}">${pcard(id, 'pile')}</div>`; });
    if (!r.pileCount) pile = '<div class="pempty">Yer boş</div>';
    const can = myTurn() && sel !== null ? ' can' : '';
    return `${deck}<div class="cpile${can}" id="cgpile">${pile}${r.pileCount > 1 ? `<span class="pcount">${r.pileCount}</span>` : ''}</div>`;
  }

  function centerUno(v) {
    const r = v.round;
    if (udisc[udisc.length - 1] !== r.top) udisc = [r.top];
    const canDraw = myTurn() && !r.drew;
    const deck = `<div class="cdeck${canDraw ? ' can' : ''}" id="cgdeck">${uback('pile')}${uback('pile d2')}<b>${r.deckCount}</b>${canDraw ? `<span class="lbl">${r.pending ? r.pending + ' kart çek' : 'Çek'}</span>` : ''}</div>`;
    let pile = '';
    const list = udisc.slice(-3);
    list.forEach((id, k) => { pile += `<div class="ps" style="${k === list.length - 1 ? 'z-index:9' : tf(id + 3, k)}">${ucard(id, 'pile')}</div>`; });
    const can = myTurn() && sel !== null ? ' can' : '';
    const pend = r.pending ? `<div class="pend">+${r.pending}</div>` : '';
    return `<div class="dirring ${r.dir > 0 ? 'ccw' : 'cw'} c-${UCOL[r.color]}" id="cgdir"><i></i><i></i></div>${deck}<div class="cpile uno c-${UCOL[r.color]}${can}" id="cgpile">${pile}<span class="ccol">${UCOL_TR[r.color]}</span>${pend}</div>`;
  }

  // Son olayın kısa açıklaması (durum satırında)
  function cardLabel(g, id) {
    if (g === 'pisti') return RANKS[prk(id)] + SUITS[pst(id)];
    const x = uinfo(id);
    if (x.t === 'wild') return 'Renk kartı';
    if (x.t === 'wild4') return '+4';
    const n = x.t === 'num' ? x.n : x.t === 'skip' ? 'Engel' : x.t === 'rev' ? 'Yön' : '+2';
    return UCOL_TR[x.c] + ' ' + n;
  }
  function evText(v) {
    const r = v.round;
    const e = r.events && r.events[r.events.length - 1];
    if (!e) return '';
    const me = (s) => s === v.me;
    const nm = (s) => (me(s) ? 'Sen' : v.seats[s] ? v.seats[s].name : '');
    // fiil: başkası için 3. tekil, kendin için 2. tekil
    const vb = (s, a, b) => `${nm(s)} ${me(s) ? b : a}`;
    const g = r.game;
    switch (e.type) {
      case 'deal': return r.moveNo ? 'Yeni kartlar dağıtıldı' : `${r.no}. el başladı`;
      case 'play':
        if (g === 'pisti') {
          if (e.pisti) return vb(e.seat, `PİŞTİ yaptı! +${e.pisti}`, `PİŞTİ yaptın! +${e.pisti}`);
          if (e.capture) return vb(e.seat, `${cardLabel(g, e.card)} ile ${e.capture} kart aldı`, `${cardLabel(g, e.card)} ile ${e.capture} kart aldın`);
          return vb(e.seat, `${cardLabel(g, e.card)} attı`, `${cardLabel(g, e.card)} attın`);
        }
        return vb(e.seat, cardLabel(g, e.card) + ' attı', cardLabel(g, e.card) + ' attın') + (e.card >= 100 ? ' → ' + UCOL_TR[e.color] : '');
      case 'sweep': return `Yerde kalan ${e.count} kart ${me(e.seat) ? 'senin oldu' : nm(e.seat) + ' aldı'}`;
      case 'draw': return vb(e.seat, `${e.count} kart çekti`, `${e.count} kart çektin`);
      case 'skip': return me(e.seat) ? 'Sıran geçti' : `${nm(e.seat)} sırası geçti`;
      case 'reverse': return 'Yön değişti';
      case 'pass': return vb(e.seat, 'pas geçti', 'pas geçtin');
      case 'uno': return `${nm(e.seat)}: UNO!`;
      case 'caught': return me(e.seat) ? 'UNO demedin, 2 kart ceza' : `${nm(e.seat)} UNO demedi, 2 kart ceza`;
      case 'reshuffle': return 'Yerdeki kartlar karıştırılıp desteye kondu';
    }
    return '';
  }

  function statusHTML(v) {
    const r = v.round, esc = C.esc;
    let main = '';
    if (v.phase === 'playing') {
      if (myTurn()) {
        if (r.game === 'pisti') main = sel !== null ? 'Seçtiğin karta tekrar dokun ya da yere dokun' : 'Sıra sende: bir kart at';
        else if (r.pending) main = `+${r.pending} geldi: ${r.stack && r.playable.length ? '+2/+4 ile karşılık ver ya da ' : ''}kart çek`;
        else if (r.drew) main = 'Çektiğin kartı oynayabilir ya da pas geçebilirsin';
        else main = r.playable.length ? 'Sıra sende: kart at ya da çek' : 'Oynayacak kartın yok: desteden çek';
      } else main = 'Sıra: ' + esc(v.seats[r.turn] ? v.seats[r.turn].name : '');
    }
    const last = evText(v) || (v.log.length ? v.log[v.log.length - 1].text : '');
    return `<div class="main${myTurn() ? ' mine' : ''}"><span>${main}</span>${v.round.remainingMs != null && v.phase === 'playing' ? '<span class="secs" id="secs"></span>' : ''}</div><div class="last">${esc(last)}</div>`;
  }

  function actionsHTML(v) {
    const r = v.round, me = v.me;
    let h = '';
    if (r.game === 'pisti') {
      const c = r.capturedCounts[me], p = r.pistiCount[me];
      h += `<div class="mine-info"><div class="cap mine" data-cap="${me}">${c ? pback('sm') : '<span class="capx"></span>'}<b>${c}</b></div><div><small>Aldığın kart</small>${p ? `<span class="pst">${p} pişti · +${r.pistiPoints[me]}</span>` : ''}</div></div>`;
    } else {
      const mine = myTurn();
      if (mine && !r.drew) h += `<button class="btn primary" data-cg="draw">${r.pending ? r.pending + ' kart çek' : 'Kart çek'}</button>`;
      if (mine && r.drew) h += '<button class="btn primary" data-cg="pass">Pas</button>';
      if (r.hand.length <= 2 && r.hand.length > 0 && !r.uno[me]) h += `<button class="btn unobtn${r.hand.length === 2 && mine ? ' hot' : ''}" data-cg="uno">UNO!</button>`;
      if (r.vulnerable >= 0 && r.vulnerable !== me) h += `<button class="btn catchbtn" data-cg="catch">Yakala! <small>${C.esc(v.seats[r.vulnerable] ? v.seats[r.vulnerable].name : '')} UNO demedi</small></button>`;
    }
    if (v.completed > 0) h += `<div class="myscore"><small>Puanın</small><b>${v.totals[me]}</b>${r.team ? `<small>Takım ${v.teamTotals[me % 2]}</small>` : ''}</div>`;
    return h;
  }

  function handHTML(v) {
    const r = v.round, g = r.game;
    const ids = sortHand(g, r.hand);
    const ok = new Set(r.playable);
    const mine = myTurn();
    if (sel !== null && ids.indexOf(sel) < 0) sel = null;
    return ids.map((id) => `<button class="hc${ok.has(id) ? ' ok' : mine && g === 'uno' ? ' no' : ''}${sel === id ? ' sel' : ''}" data-hc="${id}">${face(g, id)}</button>`).join('');
  }

  // Elde çok kart varsa üst üste bindir
  function fitHand() {
    const el = $('#cghand');
    const cards = $$('.hc', el);
    if (!cards.length) return;
    const cw = cards[0].offsetWidth;
    const avail = el.clientWidth - 8;
    const n = cards.length;
    let gap = 6;
    if (n > 1 && n * cw + (n - 1) * gap > avail) gap = (avail - n * cw) / (n - 1);
    cards.forEach((c, i) => { c.style.marginLeft = i ? gap + 'px' : '0'; c.style.zIndex = i + 1; });
  }

  // =============== Çizim ===============
  function render(v, ctx) {
    C = ctx;
    bind();
    const r = v.round, g = r.game;
    const cg = $('#cg');
    const rects = capture();
    const prev = V;
    V = v;
    let fresh = false;
    if (roundId !== r.id) {
      fresh = true;
      roundId = r.id;
      sel = null;
      udisc = [];
      seenEv = prev && prev.round && prev.round.id === r.id ? seenEv : 0;
    }
    const evs = r.events.filter((e) => e.id > seenEv);
    seenEv = r.evId;
    evs.forEach((e) => { if (e.type === 'play' && g === 'uno') udisc.push(e.card); });
    if (udisc.length > 6) udisc = udisc.slice(-6);
    cg.classList.toggle('game-uno', g === 'uno');
    cg.classList.toggle('game-pisti', g === 'pisti');
    sizes();
    const pos = positions(v);
    ['top', 'left', 'right'].forEach((p) => {
      const seat = Object.keys(pos).find((s) => pos[s] === p);
      $('#cgs-' + p).innerHTML = seat !== undefined ? seatHTML(v, +seat, p) : '';
    });
    $('#cgc').innerHTML = g === 'uno' ? centerUno(v) : centerPisti(v);
    $('#cgst').innerHTML = statusHTML(v);
    $('#cghand').innerHTML = handHTML(v);
    $('#cgact').innerHTML = actionsHTML(v);
    $('#cghand').classList.toggle('turn', myTurn());
    fitHand();
    animate(evs, rects, fresh);
    requestAnimationFrame(fitHand);
  }

  function capture() {
    const o = { hand: {}, pile: [], pileBox: null, seat: {}, deck: null };
    const cg = $('#cg');
    if (!cg || cg.classList.contains('hidden')) return o;
    $$('#cghand [data-hc]').forEach((el) => { o.hand[el.dataset.hc] = el.getBoundingClientRect(); });
    $$('#cgpile .ps').forEach((el) => {
      const c = el.firstElementChild;
      if (c) o.pile.push({ rect: c.getBoundingClientRect(), html: c.outerHTML });
    });
    o.pileBox = rectOf($('#cgpile'));
    $$('#cg .cseat[data-seat]').forEach((el) => { o.seat[el.dataset.seat] = rectOf(el.querySelector('.av') || el); });
    o.deck = rectOf($('#cgdeck'));
    return o;
  }

  // =============== Animasyon ===============
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  function centerOf(r) { return { left: r.left + r.width / 2, top: r.top + r.height / 2 }; }

  // Bir kartı bir yerden bir yere uçurur
  function fly(html, from, to, o) {
    o = o || {};
    if (!from || !to || !from.width || !to.width) return;
    const w = o.w || to.width, h = o.h || to.height;
    const wrap = document.createElement('div');
    wrap.className = 'fly cfly';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    wrap.innerHTML = html;
    const c = wrap.firstElementChild;
    if (c) { c.style.width = w + 'px'; c.style.height = h + 'px'; c.style.setProperty('--w', w + 'px'); }
    $('#fx').appendChild(wrap);
    const fx = from.left + from.width / 2 - w / 2, fy = from.top + from.height / 2 - h / 2;
    const tx = to.left + to.width / 2 - w / 2, ty = to.top + to.height / 2 - h / 2;
    const fs = o.fromScale != null ? o.fromScale : from.width / w;
    const ts = o.toScale != null ? o.toScale : 1;
    const r0 = o.rot0 || 0, r1 = o.rot1 || 0;
    const mx = (fx + tx) / 2, my = (fy + ty) / 2 - Math.min(50, Math.abs(tx - fx) * .1 + 18);
    const hideEl = o.hide || null;
    if (hideEl) hideEl.style.visibility = 'hidden';
    const anim = wrap.animate([
      { transform: `translate(${fx}px,${fy}px) scale(${fs}) rotate(${r0}deg)`, opacity: o.fromOpacity != null ? o.fromOpacity : 1 },
      { transform: `translate(${mx}px,${my}px) scale(${(fs + ts) / 2 * 1.08}) rotate(${(r0 + r1) / 2}deg)`, opacity: 1, offset: .55 },
      { transform: `translate(${tx}px,${ty}px) scale(${ts}) rotate(${r1}deg)`, opacity: o.toOpacity != null ? o.toOpacity : 1 },
    ], { duration: o.dur || 440, delay: o.delay || 0, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' });
    const done = () => { wrap.remove(); if (hideEl) hideEl.style.visibility = ''; };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  function seatRect(seat, rects) {
    if (seat === V.me) return rectOf($('#cghand'));
    const el = $(`#cg .cseat[data-seat="${seat}"] .av`);
    return rectOf(el) || (rects && rects.seat[seat]) || null;
  }
  function capRect(seat) {
    return rectOf($(`#cg [data-cap="${seat}"]`)) || seatRect(seat);
  }

  function floatText(text, rect, delay, cls) {
    if (!rect) return;
    const el = document.createElement('div');
    el.className = 'ftext' + (cls ? ' ' + cls : '');
    el.textContent = text;
    const c = centerOf(rect);
    // ekran kenarından taşmasın
    const pad = Math.min(90, window.innerWidth / 4);
    el.style.left = Math.max(pad, Math.min(window.innerWidth - pad, c.left)) + 'px';
    el.style.top = Math.max(28, c.top) + 'px';
    el.style.animationDelay = (delay || 0) + 'ms';
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), (delay || 0) + 1700);
  }

  function burst(points, delay, mine, card) {
    const box = rectOf($('#cgpile')) || rectOf($('#cgc'));
    if (!box) return;
    const c = centerOf(box);
    const label = prk(card) === 11 ? 'VALE PİŞTİ!' : prk(card) === 1 ? 'AS PİŞTİ!' : 'PİŞTİ!';
    const el = document.createElement('div');
    el.className = 'pburst' + (points >= 20 ? ' gold' : '');
    el.innerHTML = `<b>${label}</b><span>+${points}</span>`;
    el.style.left = c.left + 'px';
    el.style.top = c.top + 'px';
    el.style.animationDelay = delay + 'ms';
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), delay + 2300);
    const ring = document.createElement('div');
    ring.className = 'pring';
    ring.style.left = c.left + 'px';
    ring.style.top = c.top + 'px';
    ring.style.animationDelay = delay + 'ms';
    $('#fx').appendChild(ring);
    setTimeout(() => ring.remove(), delay + 1200);
    if (!reduceMotion) confetti(c, delay, points >= 20 ? 40 : 26);
    setTimeout(() => {
      const t = $('#cgt');
      if (t) { t.classList.remove('shake2'); void t.offsetWidth; t.classList.add('shake2'); }
      if (mine && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate([40, 60, 120]); } catch (e) {} }
    }, delay);
  }

  function confetti(c, delay, n) {
    const colors = ['#e3b04b', '#f8f2df', '#e05252', '#7fc4ec', '#8fe0a0', '#ffd166'];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'conf';
      p.style.background = colors[i % colors.length];
      p.style.left = c.left + 'px';
      p.style.top = c.top + 'px';
      $('#fx').appendChild(p);
      const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 130;
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d - 40;
      const anim = p.animate([
        { transform: 'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: .6 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 90}px)) scale(.8) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 500, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
      anim.onfinish = () => p.remove();
    }
  }

  function bubble(seat, text, delay, cls) {
    const r = seat === V.me ? rectOf($('#cgact')) || rectOf($('#cghand')) : seatRect(seat);
    floatText(text, r, delay, 'bubble ' + (cls || ''));
  }

  function animate(evs, rects, fresh) {
    if (reduceMotion || !evs.length) return;
    const g = V.round.game;
    if (fresh) {
      // yeni el: sadece dağıtımı göster
      if (evs[0].type === 'deal' && evs.length <= 3) dealAnim(0);
      return;
    }
    let t = 0;
    const list = evs.slice(-4);
    list.forEach((ev) => { t = runEvent(g, ev, rects, t); });
  }

  function dealAnim(t) {
    const g = V.round.game;
    const deck = rectOf($('#cgdeck')) || rectOf($('#cgc'));
    if (!deck) return;
    $$('#cghand .hc').forEach((el, i) => {
      const card = el.firstElementChild;
      fly(card.outerHTML, deck, el.getBoundingClientRect(), { hide: el, delay: t + i * 70, dur: 420, fromScale: .55, rot0: -12, rot1: 0 });
    });
    Object.keys(positions(V)).forEach((seat, k) => {
      const to = seatRect(+seat);
      if (!to) return;
      for (let i = 0; i < 3; i++) fly(back(g, 'pile'), deck, to, { delay: t + i * 80 + k * 40, dur: 400, toScale: .4, toOpacity: 0, w: deck.width, h: deck.height });
    });
  }

  function runEvent(g, ev, rects, t) {
    const me = V.me;
    if (ev.type === 'deal') { dealAnim(t); return t + 500; }
    if (ev.type === 'play') {
      const from = ev.seat === me ? rects.hand[ev.card] || rectOf($('#cghand')) : seatRect(ev.seat, rects);
      const target = $(`#cgpile [data-card="${ev.card}"]`);
      const pileBox = rectOf($('#cgpile')) || rects.pileBox;
      const to = target ? rectOf(target) : pileBox;
      const html = face(g, ev.card, 'pile');
      const tw = target ? to.width : (rects.pile.length ? rects.pile[rects.pile.length - 1].rect.width : pileBox && pileBox.width * .7);
      const th = target ? to.height : (rects.pile.length ? rects.pile[rects.pile.length - 1].rect.height : pileBox && pileBox.height * .9);
      const fromScale = ev.seat === me ? 1.05 : .45;
      fly(html, from, to, { hide: target, delay: t, dur: 430, fromScale, rot0: ev.seat === me ? 0 : -25, rot1: ((ev.card * 37) % 17) - 8, w: tw, h: th });
      if (g === 'pisti' && ev.capture) {
        const dest = capRect(ev.seat);
        const land = t + 440;
        rects.pile.forEach((pc, i) => {
          fly(pc.html, pc.rect, dest, { delay: land + i * 30, dur: 520, toScale: .35, toOpacity: .1, w: pc.rect.width, h: pc.rect.height, rot1: 40 });
        });
        if (pileBox) fly(html, { left: pileBox.left + (pileBox.width - tw) / 2, top: pileBox.top + (pileBox.height - th) / 2, width: tw, height: th }, dest, { delay: land + rects.pile.length * 30, dur: 520, toScale: .35, toOpacity: .1, w: tw, h: th, rot1: -30 });
        if (ev.pisti) burst(ev.pisti, t + 380, ev.seat === me, ev.card);
        else floatText(`+${ev.capture} kart`, dest, land + 250, 'small');
        return t + 1000;
      }
      return t + 380;
    }
    if (ev.type === 'sweep') {
      const dest = capRect(ev.seat);
      rects.pile.forEach((pc, i) => fly(pc.html, pc.rect, dest, { delay: t + i * 30, dur: 520, toScale: .35, toOpacity: .1, w: pc.rect.width, h: pc.rect.height }));
      floatText(`Yerdekiler: +${ev.count}`, dest, t + 300, 'small');
      return t + 700;
    }
    if (ev.type === 'draw') {
      const from = rectOf($('#cgdeck')) || rects.deck;
      const to = seatRect(ev.seat);
      const n = Math.min(ev.count, 5);
      for (let i = 0; i < n; i++) fly(uback('pile'), from, to, { delay: t + i * 90, dur: 420, toScale: ev.seat === me ? .9 : .4, toOpacity: ev.seat === me ? 0 : 0, w: from && from.width, h: from && from.height });
      if (ev.forced) bubble(ev.seat, `+${ev.count}`, t + 200, 'bad');
      return t + 300 + n * 90;
    }
    if (ev.type === 'skip') { bubble(ev.seat, '⊘ Pas', t + 250, 'bad'); return t + 200; }
    if (ev.type === 'reverse') {
      const d = $('#cgdir');
      if (d) setTimeout(() => { d.classList.remove('spin'); void d.offsetWidth; d.classList.add('spin'); }, t);
      floatText('⇄ Yön değişti', rectOf($('#cgc')), t + 150, 'small');
      return t + 200;
    }
    if (ev.type === 'uno') { bubble(ev.seat, 'UNO!', t, 'uno'); return t + 150; }
    if (ev.type === 'caught') { bubble(ev.seat, 'Yakalandı! +2', t, 'bad'); return t + 200; }
    if (ev.type === 'pass') { bubble(ev.seat, 'Pas', t, 'small'); return t + 100; }
    if (ev.type === 'reshuffle') { floatText('Deste karıştırıldı', rectOf($('#cgdeck')), t, 'small'); return t; }
    return t;
  }

  // =============== Dokunma ===============
  function pickColor() {
    return new Promise((resolve) => {
      C.modal('<h2>Renk seç</h2><div class="cpick">' + UCOL.map((c, i) => `<button class="cpk ${c}" data-col="${i}">${UCOL_TR[i]}</button>`).join('') +
        '</div><div class="btns"><button class="btn" id="cpCancel">Vazgeç</button></div>', (m) => {
        $$('[data-col]', m).forEach((b) => { b.onclick = () => { C.closeModal(); resolve(+b.dataset.col); }; });
        m.querySelector('#cpCancel').onclick = () => { C.closeModal(); resolve(null); };
      });
    });
  }

  function playCard(id) {
    const r = V.round;
    if (!myTurn()) { C.toast('Sıra sende değil.'); return; }
    if (r.game === 'uno') {
      if (r.playable.indexOf(id) < 0) {
        C.toast(r.pending ? `+${r.pending} geldi: ${r.stack ? '+2/+4 atabilir ya da ' : ''}kart çekmelisin.` : r.drew ? 'Sadece çektiğin kartı oynayabilirsin, ya da pas geç.' : 'Bu kart oynanmaz: rengi, sayısı ya da işareti tutmuyor.');
        return;
      }
      if (uinfo(id).c < 0) {
        pickColor().then((c) => { if (c !== null) { sel = null; C.api('play', { card: id, color: c }); } });
        return;
      }
    }
    sel = null;
    C.api('play', { card: id });
  }

  function tapCard(id) {
    if (sel === id) { playCard(id); return; }
    sel = id;
    $$('#cghand .hc').forEach((el) => el.classList.toggle('sel', +el.dataset.hc === id));
    const p = $('#cgpile');
    if (p) p.classList.toggle('can', myTurn());
    if (myTurn() && V.round.game === 'pisti') { const m = $('#cgst .main span'); if (m) m.textContent = 'Atmak için karta tekrar dokun ya da yere dokun'; }
  }

  function doAction(a) {
    if (a === 'draw') { if (!myTurn()) { C.toast('Sıra sende değil.'); return; } sel = null; C.api('draw'); }
    else if (a === 'pass') C.api('pass');
    else if (a === 'uno') C.api('uno');
    else if (a === 'catch') C.api('catch');
  }

  // Sürükleyerek atma: kartı yukarı (masaya) çekip bırak
  let drag = null, dragged = false;
  function onDown(e) {
    const hc = e.target.closest('.hc');
    if (!hc || (e.button !== undefined && e.button !== 0)) return;
    drag = { id: +hc.dataset.hc, el: hc, x0: e.clientX, y0: e.clientY, ghost: null };
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.ghost) {
      if (dx * dx + dy * dy < 144) return;
      const g = drag.el.firstElementChild.cloneNode(true);
      g.classList.add('cghost');
      g.style.width = drag.el.offsetWidth + 'px';
      g.style.height = drag.el.offsetHeight + 'px';
      document.body.appendChild(g);
      drag.ghost = g;
      drag.el.classList.add('lift');
    }
    drag.ghost.style.left = (e.clientX - drag.ghost.offsetWidth / 2) + 'px';
    drag.ghost.style.top = (e.clientY - drag.ghost.offsetHeight * .7) + 'px';
    const handTop = $('#cgh').getBoundingClientRect().top;
    const p = $('#cgpile');
    if (p) p.classList.toggle('hot', e.clientY < handTop - 10);
    e.preventDefault();
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.ghost) return;
    dragged = true;
    setTimeout(() => { dragged = false; }, 60);
    d.ghost.remove();
    d.el.classList.remove('lift');
    const p = $('#cgpile');
    if (p) p.classList.remove('hot');
    const handTop = $('#cgh').getBoundingClientRect().top;
    if (e && e.clientY < handTop - 10) playCard(d.id);
  }

  function onClick(e) {
    if (dragged) return;
    const t = e.target;
    if (t.closest('#cgMenu')) { C.showMenu(); return; }
    const hc = t.closest('[data-hc]');
    if (hc) { tapCard(+hc.dataset.hc); return; }
    const a = t.closest('[data-cg]');
    if (a) { doAction(a.dataset.cg); return; }
    if (t.closest('#cgpile')) {
      if (sel !== null) playCard(sel);
      else if (myTurn()) C.toast('Önce elinden bir kart seç.');
      return;
    }
    if (t.closest('#cgdeck') && V && V.round.game === 'uno') { doAction('draw'); return; }
    if (!t.closest('#cgh') && sel !== null) {
      sel = null;
      $$('#cghand .hc.sel').forEach((el) => el.classList.remove('sel'));
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    const cg = $('#cg');
    cg.addEventListener('click', onClick);
    cg.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', () => { if (drag) { if (drag.ghost) drag.ghost.remove(); drag.el.classList.remove('lift'); drag = null; } });
    window.addEventListener('resize', () => { if (V && !$('#cg').classList.contains('hidden')) { sizes(); fitHand(); } });
    // El alanının genişliği değişince (düğmeler değişti, ekran döndü) kartları yeniden sığdır
    if (window.ResizeObserver) new ResizeObserver(() => { if (V) fitHand(); }).observe($('#cghand'));
  }

  // =============== El sonu / oyun sonu ===============
  // El bitince sonuç penceresi son hamlenin animasyonu görülsün diye biraz geç açılır
  let ovTimer = null, watchedRound = null;
  function overlay(v, ctx) {
    C = ctx;
    const ov = $('#overlay'), r = v.round, esc = C.esc;
    if (v.phase === 'playing') watchedRound = r.id;
    if (v.phase !== 'roundEnd' && v.phase !== 'gameEnd') {
      clearTimeout(ovTimer); ovTimer = null;
      ov.classList.add('hidden'); ov.innerHTML = ''; ov.dataset.k = ''; return;
    }
    const key = v.phase + ':' + r.id + ':' + v.seq;
    if (ov.dataset.k === key) return;
    if (v.phase === 'roundEnd' && watchedRound === r.id && !reduceMotion) {
      if (!ovTimer) ovTimer = setTimeout(() => { ovTimer = null; watchedRound = null; if (V) overlay(V, C); }, 1900);
      return;
    }
    ov.dataset.k = key;
    const seats = [0, 1, 2, 3].filter((i) => r.active[i]);
    const name = (i) => esc(v.seats[i] ? v.seats[i].name : 'Koltuk ' + (i + 1));
    const dot = (i) => (r.team ? `<span class="tdot ${i % 2 === 0 ? 'ta' : 'tb'}"></span>` : '');
    let h = '<div class="card">';
    if (v.phase === 'roundEnd' && r.result) {
      const res = r.result;
      if (r.game === 'pisti') {
        h += `<h2>El bitti</h2><p class="sub">Hedef ${r.target} puan · en yüksek puan kazanır</p>`;
        h += '<table class="score"><tr><th>Oyuncu</th><th class="num">Kart</th><th class="num">Kart puanı</th><th class="num">Pişti</th><th class="num">Çoğunluk</th><th class="num">Bu el</th><th class="num">Toplam</th></tr>';
        const order = r.team ? [0, 2, 1, 3] : seats;
        order.forEach((i, k) => {
          const d = res.detail[i];
          h += `<tr><td>${dot(i)}<b>${name(i)}</b></td><td class="num">${d.cards}</td><td class="num">${d.cardPts}</td><td class="num">${d.pisti ? d.pisti + ` <small>(${d.pistiCount})</small>` : ''}</td><td class="num">${d.majority || ''}</td>` +
            `<td class="num gain">${res.total[i]}</td><td class="num">${v.totals[i]}</td></tr>`;
          if (r.team && k % 2 === 1) {
            const a = order[k - 1], b = order[k];
            h += `<tr class="team"><td colspan="5">${name(a)} ve ${name(b)}</td><td class="num">${res.total[a] + res.total[b]}</td><td class="num">${v.totals[a] + v.totals[b]}</td></tr>`;
          }
        });
        h += '</table><p class="sub" style="margin-top:8px">As ve Vale 1, sinek ikili 2, karo onlu 3 puan. En çok kart alan 3 puan. Pişti 10, As ile 20, Vale ile 30.</p>';
      } else {
        h += `<h2>${esc(res.note)}</h2><p class="sub">Hedef ${r.target} puan · elini ilk bitiren, rakiplerinin kartlarının puanını alır</p>`;
        h += '<table class="score"><tr><th>Oyuncu</th><th>Kalan kartlar</th><th class="num">Bu el</th><th class="num">Toplam</th></tr>';
        seats.forEach((i) => {
          const cards = res.hands[i].map((id) => ucard(id, 'tiny')).join('');
          h += `<tr class="${i === res.winner ? 'win' : ''}"><td><b>${name(i)}</b></td><td><div class="handline">${cards || (i === res.winner ? 'Bitti!' : '')}</div></td><td class="num gain">${res.total[i]}</td><td class="num">${v.totals[i]}</td></tr>`;
        });
        h += '</table><p class="sub" style="margin-top:8px">Sayılar kendi değeri, Pas/Yön/+2 20, Renk kartı ve +4 50 puan.</p>';
      }
      h += `<div class="btns"><button class="btn" data-m="scores">Puan tablosu</button><button class="btn primary" data-do2="next">${res.gameOver ? 'Sonuçları gör' : 'Sonraki el'}</button></div>`;
    } else if (v.phase === 'gameEnd') {
      let rank;
      if (r.team) {
        const tt = [v.totals[0] + v.totals[2], v.totals[1] + v.totals[3]];
        const w = tt[0] >= tt[1] ? 0 : 1;
        const nm = (t) => (t === 0 ? `${name(0)} ve ${name(2)}` : `${name(1)} ve ${name(3)}`);
        h += `<h2>Oyun bitti! Kazanan: ${nm(w)}</h2><p class="sub">En yüksek puanlı takım kazanır.</p><div class="podium">`;
        [w, 1 - w].forEach((t, k) => { h += `<div class="pl${k === 0 ? ' first' : ''}">${nm(t)}<b>${tt[t]}</b></div>`; });
      } else {
        rank = seats.slice().sort((a, b) => v.totals[b] - v.totals[a]);
        h += `<h2>Oyun bitti! Kazanan: ${name(rank[0])}</h2><p class="sub">En yüksek puan kazanır.</p><div class="podium">`;
        rank.forEach((s, k) => { h += `<div class="pl${k === 0 ? ' first' : ''}">${k + 1}. ${name(s)}<b>${v.totals[s]}</b></div>`; });
      }
      h += '</div><div class="btns"><button class="btn" data-m="scores">El el puanlar</button><button class="btn primary" data-do2="reset">Yeni oyun</button></div>';
    }
    h += '</div>';
    ov.innerHTML = h;
    ov.classList.remove('hidden');
  }

  function rulesHTML(game, st) {
    if (game === 'pisti') {
      return '<h2>Pişti kuralları</h2><ul class="rules">' +
        '<li>52 kartla oynanır. Ortaya 4 kart konur, üstteki açıktır. Herkese 4 kart dağıtılır; kartlar bitince yeniden 4\'er dağıtılır.</li>' +
        '<li>Sıranda bir kart atarsın. Yerdeki en üst kartla aynı değerde kart atarsan yerdeki bütün kartları alırsın.</li>' +
        '<li>Vale (J) ile yerdeki bütün kartlar alınır.</li>' +
        '<li>Yerde tek kart varken aynı değerle alırsan <b>PİŞTİ</b>: 10 puan. As ile as 20, Vale ile vale 30 puan. Tek karta vale atmak ve elin en son kartıyla yapılan pişti sayılmaz.</li>' +
        '<li>Puanlar: her As ve Vale 1, sinek ikili 2, karo onlu 3 puan. En çok kartı alan 3 puan.</li>' +
        '<li>Deste bitince yerde kalanlar en son kart alana gider.</li>' +
        `<li>${st.pistiTarget || 101} puana ilk ulaşan (eşlide takım) kazanır.${st.mode === 'team' ? ' Karşılıklı oturanlar eştir.' : ''}</li>` +
        '<li>Kartı oynamak için iki kez dokun ya da masaya sürükle.</li></ul>';
    }
    return '<h2>Uno kuralları</h2><ul class="rules">' +
      '<li>Herkese 7 kart dağıtılır. Sıranda yerdeki kartla aynı renkte, aynı sayıda ya da aynı işarette bir kart atarsın.</li>' +
      '<li>Atacak kartın yoksa desteden bir kart çekersin; çektiğin kart uyuyorsa hemen atabilir ya da pas geçebilirsin.</li>' +
      '<li>⊘ Pas: sıradaki oyuncu atlanır. ⇄ Yön: oyunun yönü değişir (iki kişide pas gibi). +2: sıradaki 2 kart çeker ve atlanır.</li>' +
      '<li>Renk kartı (çark): istediğin rengi seçersin. +4: rengi seçersin, sıradaki 4 kart çeker ve atlanır.</li>' +
      (st.unoStack ? '<li>Biriktirme açık: +2 gelince +2 ya da +4, +4 gelince +4 atarak cezayı sıradakine aktarabilirsin.</li>' : '') +
      '<li>Elinde 2 kart kalınca "UNO!" düğmesine bas. Demeden 1 karta inersen biri "Yakala!" derse 2 kart çekersin.</li>' +
      '<li>Elini ilk bitiren, rakiplerin elindeki kartların puanını alır: sayılar kendi değeri, Pas/Yön/+2 20, Renk kartı ve +4 50 puan.</li>' +
      `<li>${st.unoTarget || 200} puana ilk ulaşan kazanır.</li></ul>`;
  }

  window.CardUI = { render, overlay, rulesHTML, pcard, ucard };
})();
