/* Pişti ve Renk masası — telefon arayüzü. app.js çağırır: CardUI.render(view, yardımcılar) */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  let C = null; // app.js yardımcıları: api, toast, esc, modal, closeModal, avatarText, showMenu
  let V = null; // son görünüm
  let roundId = null, seenEv = 0;
  let sel = null; // seçili kart
  let udisc = []; // renk oyunu: yerdeki son kartlar (üstteki dahil)
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
    if (g === 'batak') {
      const so = [0, 1, 3, 2]; // maça, kupa, sinek, karo (siyah-kırmızı sırayla)
      return ids.slice().sort((a, b) => so.indexOf(pst(a)) - so.indexOf(pst(b)) || bpow(a) - bpow(b));
    }
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
    cardW = Math.round(ch * .7);
    const key = [ch, pch, sh, tall].join();
    if (key === sizeKey) return false; // değişmediyse dokunma (bütün masanın stili yeniden hesaplanmasın)
    sizeKey = key;
    $('#cg').classList.toggle('tall', tall);
    const st = $('#cg').style;
    st.setProperty('--ch', ch + 'px');
    st.setProperty('--cw', cardW + 'px');
    st.setProperty('--pch', pch + 'px');
    st.setProperty('--pcw', Math.round(pch * .7) + 'px');
    st.setProperty('--sh', sh + 'px');
    st.setProperty('--sw', Math.round(sh * .7) + 'px');
    return true;
  }
  let sizeKey = '', cardW = 0, handW = 0;

  // Bir bölümü sadece içeriği değiştiyse yeniden çizer: değişmeyen kartlar yerinde kalır,
  // telefon gereksiz yere boyama yapmaz, uçan kartların gizlediği hedefler bozulmaz.
  function setHTML(el, html) {
    if (!el || el.__h === html) return false;
    el.__h = html;
    el.innerHTML = html;
    return true;
  }
  // Doğrudan değiştirilen bölüm: bir sonraki çizimde mutlaka yenilensin
  const dirty = (el) => { if (el) el.__h = null; };

  // Eldeki kartların aralığı (sığmazsa üst üste biner)
  function handGap(n) {
    const avail = handW - 8;
    if (n < 2 || !cardW || avail <= 0) return 6;
    return n * cardW + (n - 1) * 6 > avail ? (avail - n * cardW) / (n - 1) : 6;
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

  // Hamle sırası bende mi (batak eşlide eşin kartlarını da ihaleyi alan oynar: actor)
  const myTurn = () => V && V.phase === 'playing' && (V.round.actor !== undefined ? V.round.actor : V.round.turn) === V.me;

  function whoHTML(v, seat) {
    const p = v.seats[seat];
    if (!p) return '';
    const r = v.round, esc = C.esc;
    let bd = '';
    if (r.game === 'pisti' && r.pistiCount[seat]) bd += `<span class="pst">${r.pistiCount[seat]} pişti</span>`;
    if (r.game === 'uno' && r.handCounts[seat] === 1) bd += `<span class="unob">${r.uno[seat] ? 'SON!' : '1 kart'}</span>`;
    if (r.game === 'batak') {
      if (r.phase === 'bid') { const b = r.bids[seat]; if (b !== null) bd += b ? `<span class="bbid">${b}</span>` : '<span class="bpas">pas</span>'; }
      else {
        if (seat === r.bidder) bd += `<span class="bbid">İhale ${r.contract}</span>`;
        if (seat === r.dummy) bd += '<span class="bpas">açık el</span>';
        if (r.phase === 'play') bd += `<span class="btk">${r.tricks[seat]} el</span>`;
      }
    }
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
    // Eşli batakta açık el ortada gösterilir; koltukta kapalı kart çizilmez
    const open = g === 'batak' && seat === r.dummy && r.dummyHand && r.dummyHand.length > 0;
    let fan = '';
    if (!open) for (let i = 0; i < Math.min(n, g === 'uno' ? 8 : g === 'batak' ? 5 : 4); i++) fan += back(g, 'sm');
    let extra = '';
    if (g === 'batak' && r.phase === 'play') extra = `<div class="cap" data-cap="${seat}"><span class="capx"></span><b>${r.tricks[seat]}</b></div>`;
    if (g === 'pisti') {
      const c = r.capturedCounts[seat];
      extra = `<div class="cap" data-cap="${seat}">${c ? pback('sm') : '<span class="capx"></span>'}<b>${c}</b></div>`;
    }
    const cnt = (g === 'uno' || g === 'batak') && n > 0 && !open ? `<span class="fcount${n === 1 && g === 'uno' ? ' one' : ''}">${n}</span>` : '';
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

  // =============== Batak ===============
  const SUIT_TR = ['Maça', 'Kupa', 'Karo', 'Sinek'];
  const bpow = (id) => (prk(id) === 1 ? 14 : prk(id));
  let buryPick = new Set(); // gömülecek seçili kartlar
  let trickShow = null; // biten el: kartlar bir süre ortada görünür { cards, winner, until }
  let trickTimer = 0;
  // Bir koltuğun ortadaki kart yeri (benim: alt, sağdaki, karşı, soldaki)
  function trickPos(v, seat) {
    if (seat === v.me) return 'b';
    const p = positions(v)[seat];
    return p === 'top' ? 't' : p === 'left' ? 'l' : 'r';
  }
  function suitBadge(su, big) {
    if (su < 0) return '';
    return `<span class="ksuit s${su}${big ? ' big' : ''}">${SUITS[su]}</span>`;
  }
  function centerBatak(v) {
    const r = v.round, esc = C.esc;
    const nm = (s) => esc(v.seats[s] ? v.seats[s].name : '');
    let info = '';
    if (r.bidder >= 0 && r.phase !== 'bid') info = `<div class="binfo"><span>İhale <b>${nm(r.bidder)} ${r.contract}</b></span>${r.trump >= 0 ? `<span>Koz ${suitBadge(r.trump)} <b>${SUIT_TR[r.trump]}</b></span>` : ''}</div>`;
    else if (r.phase === 'bid' && !myTurn()) info = `<div class="binfo"><span>${r.high ? `En yüksek: <b>${nm(r.bidder)} ${r.high}</b>` : `İhale en az <b>${r.minBid}</b>`}</span></div>`;
    let mid = '';
    if (r.phase === 'bid' && myTurn()) {
      const min = Math.max(r.minBid, r.high + 1);
      let chips = '';
      for (let n = min; n <= r.maxBid; n++) chips += `<button class="bchip" data-bid="${n}">${n}</button>`;
      mid = `<div class="bpanel"><div class="bttl">İhalen kaç?<small>${r.high ? ` en yüksek: ${nm(r.bidder)} ${r.high}` : ` en az ${r.minBid}`}</small></div><div class="bchips">${chips}<button class="bchip bpass" data-bid="0">Pas</button></div></div>`;
    } else if (r.phase === 'trump' && myTurn()) {
      mid = '<div class="bpanel"><div class="bttl">Kozu seç</div><div class="bsuits">' +
        [0, 1, 2, 3].map((su) => `<button class="bsuit s${su}" data-trump="${su}"><span>${SUITS[su]}</span><small>${SUIT_TR[su]}</small></button>`).join('') + '</div></div>';
    } else if (r.phase === 'bury') {
      mid = myTurn() ? `<div class="bpanel"><div class="bttl">Gömü elinde: 4 kart seç ve göm</div><div class="bsub">Yeni gelen kartlar parlıyor. Gömülen kartlar el sayılmaz.</div></div>`
        : `<div class="bwait">${nm(r.bidder)} gömüyü aldı, kart gömüyor…</div>`;
    } else if (r.phase === 'trump') {
      mid = `<div class="bwait">${nm(r.bidder)} kozu seçiyor…</div>`;
    } else if (r.phase === 'bid') {
      mid = r.turn >= 0 ? `<div class="bwait">İhale sırası: ${nm(r.turn)}</div>` : '';
    } else {
      // Ortadaki el (biten el bir süre görünür)
      let cards = r.trick;
      let done = null;
      if (!cards.length && trickShow && Date.now() < trickShow.until) { cards = trickShow.cards; done = trickShow.winner; }
      mid = '<div class="btrick" id="cgtrick">' + cards.map((x, k) => `<div class="tc p-${trickPos(v, x.seat)}${done === x.seat ? ' won' : ''}" style="z-index:${k + 1}">${pcard(x.card, 'pile')}</div>`).join('') +
        (cards.length ? '' : '<div class="tempty">' + (r.turn >= 0 ? (r.actor === v.me ? 'Eli sen aç' : nm(r.turn) + ' açacak') : '') + '</div>') + '</div>';
    }
    // Eşlide açık el (ihaleyi alanın eşi)
    let dummy = '';
    if (r.dummy >= 0 && r.dummyHand.length && r.dummy !== v.me) {
      const play = myTurn() && r.turn === r.dummy;
      const ok = new Set(play ? r.playable : []);
      dummy = `<div class="bdummy${play ? ' live' : ''}"><div class="dttl">${esc(window.Dil.ek(v.seats[r.dummy] ? v.seats[r.dummy].name : '', 'in'))} açık eli${play ? ' · sıra onda, sen oyna' : ''}</div><div class="dcards">` +
        sortHand('batak', r.dummyHand).map((id) => `<button class="dc${ok.has(id) ? ' ok' : play ? ' no' : ''}" data-dc="${id}">${pcard(id, 'mini')}</button>`).join('') + '</div></div>';
    }
    return info + dummy + mid;
  }

  // Son olayın kısa açıklaması (durum satırında)
  function cardLabel(g, id) {
    if (g === 'pisti' || g === 'batak') return RANKS[prk(id)] + SUITS[pst(id)];
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
        if (g === 'batak') return vb(e.seat, cardLabel(g, e.card) + ' attı', cardLabel(g, e.card) + ' attın');
        return vb(e.seat, cardLabel(g, e.card) + ' attı', cardLabel(g, e.card) + ' attın') + (e.card >= 100 ? ' → ' + UCOL_TR[e.color] : '');
      case 'sweep': return `Yerde kalan ${e.count} kart ${me(e.seat) ? 'senin oldu' : nm(e.seat) + ' aldı'}`;
      case 'draw': return vb(e.seat, `${e.count} kart çekti`, `${e.count} kart çektin`);
      case 'skip': return me(e.seat) ? 'Sıran geçti' : `${nm(e.seat)} sırası geçti`;
      case 'reverse': return 'Yön değişti';
      case 'pass': return vb(e.seat, 'pas geçti', 'pas geçtin');
      case 'uno': return `${nm(e.seat)}: SON!`;
      case 'caught': return me(e.seat) ? 'SON demedin, 2 kart ceza' : `${nm(e.seat)} SON demedi, 2 kart ceza`;
      case 'reshuffle': return 'Yerdeki kartlar karıştırılıp desteye kondu';
      case 'bid': return e.amount ? `${nm(e.seat)}: ${e.amount}` : `${nm(e.seat)}: pas`;
      case 'contract': return `İhaleyi ${me(e.seat) ? 'sen' : nm(e.seat)} ${e.amount} ile ${me(e.seat) ? 'aldın' : 'aldı'}`;
      case 'kitty': return `${nm(e.seat)} gömüyü aldı`;
      case 'bury': return `${nm(e.seat)} 4 kart gömdü`;
      case 'trump': return `Koz ${SUIT_TR[e.suit]} ${SUITS[e.suit]}`;
      case 'trick': return `Eli ${me(e.winner) ? 'sen aldın' : nm(e.winner) + ' aldı'}`;
    }
    return '';
  }

  function statusHTML(v) {
    const r = v.round, esc = C.esc;
    let main = '';
    if (v.phase === 'playing' && r.game === 'batak') {
      const nm = (s) => esc(v.seats[s] ? v.seats[s].name : '');
      if (r.phase === 'bid') main = myTurn() ? 'İhale sende: sayı seç ya da pas de' : `İhale: ${nm(r.turn)} düşünüyor`;
      else if (r.phase === 'bury') main = myTurn() ? `Gömmek için 4 kart seç (${buryPick.size}/4)` : `${nm(r.bidder)} kart gömüyor`;
      else if (r.phase === 'trump') main = myTurn() ? 'Kozu seç' : `${nm(r.bidder)} kozu seçiyor`;
      else if (myTurn()) main = r.turn === r.dummy ? `${esc(window.Dil.ek(v.seats[r.dummy] ? v.seats[r.dummy].name : '', 'in'))} elinden oyna` : (r.trick.length ? 'Sıra sende: kart at' : 'Sıra sende: eli aç');
      else main = v.me === r.dummy ? 'Kartlarını eşin oynuyor' : 'Sıra: ' + nm(r.turn);
    } else if (v.phase === 'playing') {
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
    if (r.game === 'batak') {
      if (r.phase === 'bury' && myTurn()) h += `<button class="btn primary" data-cg="bury"${buryPick.size === 4 ? '' : ' disabled'}>Göm <small>${buryPick.size}/4</small></button>`;
      else if (r.phase === 'play' || r.phase === 'trump' || r.phase === 'bury') {
        const mine = r.team ? r.tricks[me] + r.tricks[(me + 2) % 4] : r.tricks[me];
        h += `<div class="mine-info"><div class="cap mine" data-cap="${me}"><span class="capx"></span><b>${r.tricks[me]}</b></div><div><small>${r.team ? 'Takımın aldığı el' : 'Aldığın el'}</small><span class="pst">${mine}${me === r.bidder || (r.team && (me + 2) % 4 === r.bidder) ? ' / ' + r.contract : ''}</span></div></div>`;
      }
      if (r.trump >= 0) h += `<div class="ktrump">Koz ${suitBadge(r.trump, true)}</div>`;
      if (v.completed > 0) h += `<div class="myscore"><small>Puanın</small><b>${v.totals[me]}</b><small>${v.completed}/${r.rounds} el</small></div>`;
      return h;
    }
    if (r.game === 'pisti') {
      const c = r.capturedCounts[me], p = r.pistiCount[me];
      h += `<div class="mine-info"><div class="cap mine" data-cap="${me}">${c ? pback('sm') : '<span class="capx"></span>'}<b>${c}</b></div><div><small>Aldığın kart</small>${p ? `<span class="pst">${p} pişti · +${r.pistiPoints[me]}</span>` : ''}</div></div>`;
    } else {
      const mine = myTurn();
      if (mine && !r.drew) h += `<button class="btn primary" data-cg="draw">${r.pending ? r.pending + ' kart çek' : 'Kart çek'}</button>`;
      if (mine && r.drew) h += '<button class="btn primary" data-cg="pass">Pas</button>';
      if (r.hand.length <= 2 && r.hand.length > 0 && !r.uno[me]) h += `<button class="btn unobtn${r.hand.length === 2 && mine ? ' hot' : ''}" data-cg="uno">SON!</button>`;
      if (r.vulnerable >= 0 && r.vulnerable !== me) h += `<button class="btn catchbtn" data-cg="catch">Yakala! <small>${C.esc(v.seats[r.vulnerable] ? v.seats[r.vulnerable].name : '')} SON demedi</small></button>`;
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
    const gap = Math.round(handGap(ids.length) * 10) / 10;
    if (g === 'batak') {
      const bury = r.phase === 'bury' && mine;
      const fresh = new Set(r.kittyCards || []);
      const live = mine && r.phase === 'play' && r.turn === v.me;
      return ids.map((id, i) => `<button class="hc${bury ? (buryPick.has(id) ? ' pick' : '') : live ? (ok.has(id) ? ' ok' : ' no') : ''}${fresh.has(id) ? ' kitty' : ''}${!bury && sel === id ? ' sel' : ''}" data-hc="${id}" style="margin-left:${i ? gap : 0}px;z-index:${i + 1}">${face(g, id)}</button>`).join('');
    }
    return ids.map((id, i) => `<button class="hc${ok.has(id) ? ' ok' : mine && g === 'uno' ? ' no' : ''}${sel === id ? ' sel' : ''}" data-hc="${id}" style="margin-left:${i ? gap : 0}px;z-index:${i + 1}">${face(g, id)}</button>`).join('');
  }

  // Elde çok kart varsa üst üste bindir
  // Ekran boyu değişince (döndürme, düğmeler) eldeki kartları yeniden sığdırır
  function fitHand() {
    const el = $('#cghand');
    const w = el.clientWidth;
    if (!w || w === handW) return;
    handW = w;
    const cards = $$('.hc', el);
    const gap = Math.round(handGap(cards.length) * 10) / 10;
    cards.forEach((c, i) => { c.style.marginLeft = (i ? gap : 0) + 'px'; });
    dirty(el);
  }

  // =============== Çizim ===============
  function render(v, ctx) {
    C = ctx;
    bind();
    const r = v.round, g = r.game;
    const cg = $('#cg');
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
    // Önce ölçümler (tek seferde), sonra yazmalar: telefon sayfayı bir kez yerleştirir
    const rects = evs.length && !fresh ? capture() : null;
    const hw = $('#cghand').clientWidth;
    if (hw) handW = hw;
    cg.classList.toggle('game-uno', g === 'uno');
    cg.classList.toggle('game-pisti', g === 'pisti');
    cg.classList.toggle('game-batak', g === 'batak');
    if (g === 'batak') {
      if (r.phase !== 'bury') buryPick.clear();
      const tr = evs.filter((e) => e.type === 'trick').pop();
      if (tr && !fresh) {
        trickShow = { cards: tr.cards, winner: tr.winner, until: Date.now() + (reduceMotion ? 900 : 1500) };
        clearTimeout(trickTimer);
        trickTimer = setTimeout(() => { trickShow = null; if (V && C) { dirty($('#cgc')); render(V, C); } }, (reduceMotion ? 900 : 1500) + 30);
      }
    }
    if (sizes()) handW = $('#cghand').clientWidth || handW; // boyut ya da yön değişti: eli yeniden ölç
    const pos = positions(v);
    ['top', 'left', 'right'].forEach((p) => {
      const seat = Object.keys(pos).find((s) => pos[s] === p);
      setHTML($('#cgs-' + p), seat !== undefined ? seatHTML(v, +seat, p) : '');
    });
    setHTML($('#cgc'), g === 'uno' ? centerUno(v) : g === 'batak' ? centerBatak(v) : centerPisti(v));
    // Eşli batakta açık el varsa yatay ekranda el ile yan yana dizilir
    $('#cgc').classList.toggle('withdummy', g === 'batak' && !!$('#cgc .bdummy'));
    setHTML($('#cgst'), statusHTML(v));
    setHTML($('#cghand'), handHTML(v));
    setHTML($('#cgact'), actionsHTML(v));
    $('#cghand').classList.toggle('turn', myTurn());
    if (!handW) requestAnimationFrame(fitHand);
    animate(evs, rects, fresh);
  }

  function capture() {
    const o = { hand: {}, pile: [], pileBox: null, seat: {}, deck: null, trick: {}, dummy: {} };
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
    $$('#cgtrick .tc .pc').forEach((el) => { o.trick[el.dataset.card] = el.getBoundingClientRect(); });
    $$('#cgc [data-dc]').forEach((el) => { o.dummy[el.dataset.dc] = el.getBoundingClientRect(); });
    return o;
  }

  // =============== Animasyon ===============
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  function centerOf(r) { return { left: r.left + r.width / 2, top: r.top + r.height / 2 }; }

  // Efektler sıraya alınır: önce bütün ölçümler yapılır, sonra hepsi birden sayfaya eklenir.
  // (Ölç-ekle-ölç-ekle yapınca telefon her seferinde sayfayı baştan yerleştirir; takılmanın asıl sebebi bu.)
  let fxQ = null;
  const later = (fn) => { if (fxQ) fxQ.push(fn); else fn(); };

  // Bir kartı bir yerden bir yere uçurur
  function fly(html, from, to, o) {
    o = o || {};
    if (!from || !to || !from.width || !to.width) return;
    later(() => flyNow(html, from, to, o));
  }
  function flyNow(html, from, to, o) {
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
    later(() => { $('#fx').appendChild(el); setTimeout(() => el.remove(), (delay || 0) + 1700); });
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
    const ring = document.createElement('div');
    ring.className = 'pring';
    ring.style.left = c.left + 'px';
    ring.style.top = c.top + 'px';
    ring.style.animationDelay = delay + 'ms';
    later(() => {
      $('#fx').appendChild(el);
      setTimeout(() => el.remove(), delay + 2300);
      $('#fx').appendChild(ring);
      setTimeout(() => ring.remove(), delay + 1200);
    });
    if (!reduceMotion) confetti(c, delay, points >= 20 ? 30 : 20);
    setTimeout(() => {
      const t = $('#cgmid');
      if (t) { t.classList.remove('shake2'); void t.offsetWidth; t.classList.add('shake2'); }
      if (mine && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate([40, 60, 120]); } catch (e) {} }
    }, delay);
  }

  function confetti(c, delay, n) {
    later(() => confettiNow(c, delay, n));
  }
  function confettiNow(c, delay, n) {
    const colors = ['#e3b04b', '#f8f2df', '#e05252', '#7fc4ec', '#8fe0a0', '#ffd166'];
    const fx = $('#fx');
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'conf';
      p.style.background = colors[i % colors.length];
      p.style.left = c.left + 'px';
      p.style.top = c.top + 'px';
      fx.appendChild(p);
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

  // Küçük, ucuz efektler (sadece transform/opacity: telefonu yormaz)
  function pop(el, delay, k) {
    if (!el || !el.animate) return;
    later(() => el.animate([{ transform: 'scale(1)' }, { transform: `scale(${k || 1.12})`, offset: .35 }, { transform: 'scale(1)' }], { duration: 380, delay: delay || 0, easing: 'ease-out' }));
  }
  // Kart atan oyuncunun adı hafifçe zıplar
  function popSeat(seat, delay) {
    if (seat !== V.me) pop($(`#cg .cseat[data-seat="${seat}"] .who`), delay, 1.09);
  }
  // Renk kartı atılınca seçilen renk yerden halka halka yayılır
  function ripple(col, delay) {
    const box = rectOf($('#cgpile'));
    if (!box || col == null || col < 0) return;
    const c = centerOf(box);
    later(() => {
      for (let k = 0; k < 2; k++) {
        const el = document.createElement('div');
        el.className = 'cripple c-' + UCOL[col];
        el.style.left = c.left + 'px';
        el.style.top = c.top + 'px';
        $('#fx').appendChild(el);
        const a = el.animate([{ transform: 'scale(.3)', opacity: .9 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 750, delay: delay + k * 160, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
        a.onfinish = () => el.remove();
      }
    });
  }

  function animate(evs, rects, fresh) {
    if (reduceMotion || !evs.length) return;
    const g = V.round.game;
    fxQ = [];
    try {
      if (fresh) {
        // yeni el: sadece dağıtımı göster
        if (evs[0].type === 'deal' && evs.length <= 3) dealAnim(0);
      } else {
        let t = 0;
        rects.flown = new Set();
        evs.slice(-4).forEach((ev) => { t = runEvent(g, ev, rects, t); });
        celebrate(g, t);
      }
    } finally {
      const q = fxQ;
      fxQ = null;
      q.forEach((f) => f());
    }
  }

  function celebrate(g, t) {
    const res = V.round.result;
    if (g === 'batak' && V.phase === 'roundEnd' && res) {
      const b = rectOf($('#cgc'));
      const mineSide = res.bidder === V.me || (res.team && res.bidder % 2 === V.me % 2);
      if (b) {
        if (res.made && mineSide) { confetti(centerOf(b), t + 1500, 26); floatText('İhale tuttu!', b, t + 1500, 'win'); }
        else floatText(res.made ? 'İhale tuttu' : 'Battı!', b, t + 1500, res.made ? 'small' : 'bad');
      }
      return;
    }
    // Renk: eli bitiren kutlanır
    if (g === 'uno' && V.phase === 'roundEnd' && res && res.winner >= 0) {
      if (res.winner === V.me) {
        const b = rectOf($('#cgc'));
        if (b) { confetti(centerOf(b), t + 150, 26); floatText('Elini bitirdin!', b, t + 150, 'win'); }
      } else bubble(res.winner, 'Bitti!', t + 150, 'uno');
    }
  }

  function dealAnim(t) {
    const g = V.round.game;
    let deck = rectOf($('#cgdeck'));
    if (!deck) {
      // Destesi görünmeyen oyunlar (batak): masanın ortasından kart boyunda
      const c = rectOf($('#cgc'));
      if (!c) return;
      const w = cardW * .8 || 50;
      deck = { left: c.left + c.width / 2 - w / 2, top: c.top + c.height / 2 - w * .7, width: w, height: w * 1.43 };
    }
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

  function runBatak(ev, rects, t) {
    const me = V.me, r = V.round;
    if (ev.type === 'play') {
      const target = $(`#cgtrick .pc[data-card="${ev.card}"]`);
      const from = ev.seat === me ? rects.hand[ev.card] || rectOf($('#cghand')) : rects.dummy[ev.card] || seatRect(ev.seat, rects);
      if (target) {
        popSeat(ev.seat, t);
        fly(pcard(ev.card, 'pile'), from, rectOf(target), { hide: target, delay: t, dur: 380, fromScale: ev.seat === me || rects.dummy[ev.card] ? 1 : .45, rot0: ev.seat === me ? 0 : -18 });
      }
      return t + 260;
    }
    if (ev.type === 'trick') {
      const dest = capRect(ev.winner) || seatRect(ev.winner, rects);
      const at = t + (reduceMotion ? 300 : 1050);
      later(() => setTimeout(() => {
        const box = $('#cgtrick');
        if (!box) return;
        $$('.tc', box).forEach((tc) => {
          const c = tc.firstElementChild;
          if (!c) return;
          const rc = c.getBoundingClientRect();
          flyNow(c.outerHTML, rc, dest, { dur: 460, toScale: .35, toOpacity: .1, w: rc.width, h: rc.height, rot1: 25 });
          tc.style.visibility = 'hidden';
        });
        pop($(`#cg [data-cap="${ev.winner}"]`), 420, 1.3);
      }, at));
      bubble(ev.winner, '+1 el', at + 200, ev.winner === me ? '' : 'small');
      return t + 200;
    }
    if (ev.type === 'bid') { bubble(ev.seat, ev.amount ? String(ev.amount) : 'Pas', t, ev.amount ? '' : 'small'); return t + 120; }
    if (ev.type === 'contract') { floatText(`İhale ${V.seats[ev.seat] ? V.seats[ev.seat].name : ''}: ${ev.amount}`, rectOf($('#cgc')), t + 150, 'win'); return t + 300; }
    if (ev.type === 'trump') { floatText(`Koz ${SUITS[ev.suit]} ${SUIT_TR[ev.suit]}`, rectOf($('#cgc')), t + 100, 'win'); ripple(ev.suit === 1 || ev.suit === 2 ? 0 : 3, t + 120); return t + 300; }
    if (ev.type === 'kitty' && ev.seat !== me) {
      const to = seatRect(ev.seat, rects), from = rectOf($('#cgc'));
      for (let i = 0; i < 4; i++) fly(pback('pile'), from, to, { delay: t + i * 80, dur: 420, toScale: .4, toOpacity: 0, w: 50, h: 70 });
      return t + 400;
    }
    if (ev.type === 'bury') {
      const from = seatRect(ev.seat, rects) || rectOf($('#cghand')), to = rectOf($('#cgc'));
      for (let i = 0; i < 4; i++) fly(pback('pile'), from, to, { delay: t + i * 80, dur: 420, fromScale: .5, toScale: .6, toOpacity: 0, w: 50, h: 70 });
      return t + 400;
    }
    if (ev.type === 'deal') { dealAnim(t); return t + 500; }
    return t;
  }

  function runEvent(g, ev, rects, t) {
    const me = V.me;
    if (g === 'batak') return runBatak(ev, rects, t);
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
      popSeat(ev.seat, t);
      fly(html, from, to, { hide: target, delay: t, dur: 430, fromScale, rot0: ev.seat === me ? 0 : -25, rot1: ((ev.card * 37) % 17) - 8, w: tw, h: th });
      if (g === 'uno' && ev.card >= 100) ripple(ev.color, t + 380);
      if (g === 'pisti' && ev.capture) {
        const dest = capRect(ev.seat);
        const land = t + 440;
        rects.pile.forEach((pc, i) => {
          fly(pc.html, pc.rect, dest, { delay: land + i * 30, dur: 520, toScale: .35, toOpacity: .1, w: pc.rect.width, h: pc.rect.height, rot1: 40 });
        });
        if (pileBox) fly(html, { left: pileBox.left + (pileBox.width - tw) / 2, top: pileBox.top + (pileBox.height - th) / 2, width: tw, height: th }, dest, { delay: land + rects.pile.length * 30, dur: 520, toScale: .35, toOpacity: .1, w: tw, h: th, rot1: -30 });
        if (ev.pisti) burst(ev.pisti, t + 380, ev.seat === me, ev.card);
        else floatText(`+${ev.capture} kart`, dest, land + 250, 'small');
        pop($(`#cg [data-cap="${ev.seat}"]`), land + 480, 1.25);
        return t + 1000;
      }
      return t + 380;
    }
    if (ev.type === 'sweep') {
      const dest = capRect(ev.seat);
      rects.pile.forEach((pc, i) => fly(pc.html, pc.rect, dest, { delay: t + i * 30, dur: 520, toScale: .35, toOpacity: .1, w: pc.rect.width, h: pc.rect.height }));
      floatText(`Yerdekiler: +${ev.count}`, dest, t + 300, 'small');
      pop($(`#cg [data-cap="${ev.seat}"]`), t + 500, 1.25);
      return t + 700;
    }
    if (ev.type === 'draw') {
      const from = rectOf($('#cgdeck')) || rects.deck;
      const n = Math.min(ev.count, 5);
      if (ev.seat === me) {
        // çektiğin kartlar yüzü açık, elindeki yerlerine uçar
        const fresh = V.round.hand.filter((id) => !rects.hand[id] && !rects.flown.has(id)).slice(0, ev.count);
        fresh.forEach((id, i) => {
          rects.flown.add(id);
          const el = $(`#cghand [data-hc="${id}"]`);
          if (el && i < 6) fly(face(g, id), from, rectOf(el), { hide: el, delay: t + i * 110, dur: 480, fromScale: .62, rot0: -16, rot1: 0 });
        });
      } else {
        const to = seatRect(ev.seat);
        popSeat(ev.seat, t);
        for (let i = 0; i < n; i++) fly(uback('pile'), from, to, { delay: t + i * 90, dur: 420, toScale: .4, toOpacity: 0, w: from && from.width, h: from && from.height });
      }
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
    if (ev.type === 'uno') { bubble(ev.seat, 'SON!', t, 'uno'); return t + 150; }
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
    if (!myTurn()) { C.toast(r.game === 'batak' && V.me === r.dummy ? 'Kartlarını eşin oynuyor.' : 'Sıra sende değil.'); return; }
    if (r.game === 'batak') {
      if (r.phase !== 'play') return;
      if (r.turn !== V.me) { C.toast('Şimdi eşinin açık elinden oynamalısın (ortadaki kartlar).'); return; }
      if (r.playable.indexOf(id) < 0) {
        if (!r.trick.length) C.toast('Koz kırılmadan kozla el açılmaz.');
        else {
          const led = pst(r.trick[0].card);
          const has = r.hand.some((c) => pst(c) === led);
          C.toast(has ? `${SUIT_TR[led]} atmalısın; yerdekini geçebiliyorsan geçmelisin.` : 'Rengin yok: koz atmalısın; yerdeki kozu geçebiliyorsan geçmelisin.');
        }
        return;
      }
      sel = null;
      C.api('play', { card: id });
      return;
    }
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
    const r = V && V.round;
    if (r && r.game === 'batak' && r.phase === 'bury') {
      if (!myTurn()) return;
      if (buryPick.has(id)) buryPick.delete(id);
      else if (buryPick.size < 4) buryPick.add(id);
      else { C.toast('4 kart seçtin. Birini bırakmak için ona dokun.'); return; }
      dirty($('#cghand')); dirty($('#cgact')); dirty($('#cgst'));
      render(V, C);
      return;
    }
    if (r && r.game === 'batak' && r.phase !== 'play') return;
    if (sel === id) { playCard(id); return; }
    sel = id;
    $$('#cghand .hc').forEach((el) => el.classList.toggle('sel', +el.dataset.hc === id));
    const p = $('#cgpile');
    if (p) p.classList.toggle('can', myTurn());
    if (myTurn() && V.round.game === 'pisti') { const m = $('#cgst .main span'); if (m) m.textContent = 'Atmak için karta tekrar dokun ya da yere dokun'; }
    dirty($('#cghand')); dirty($('#cgc')); dirty($('#cgst'));
  }

  function doAction(a) {
    if (a === 'bury') {
      if (buryPick.size !== 4) { C.toast('Gömmek için 4 kart seç.'); return; }
      const cards = [...buryPick];
      buryPick.clear();
      C.api('bury', { cards });
      return;
    }
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
    const bd = t.closest('[data-bid]');
    if (bd) { const n = +bd.dataset.bid; C.api(n ? 'bid' : 'pass', n ? { amount: n } : null); return; }
    const tr = t.closest('[data-trump]');
    if (tr) { C.api('trump', { suit: +tr.dataset.trump }); return; }
    const dc = t.closest('[data-dc]');
    if (dc) {
      const r = V.round, id = +dc.dataset.dc;
      if (!myTurn() || r.turn !== r.dummy) { C.toast('Bu kartlar eşin açık eli; sırası gelince ihaleyi alan oynar.'); return; }
      if (r.playable.indexOf(id) < 0) { C.toast('Bu kart şimdi atılamaz (renge uy, geçebiliyorsan geç, rengin yoksa koz at).'); return; }
      C.api('play', { card: id });
      return;
    }
    if (t.closest('#cgtrick')) {
      if (sel !== null) playCard(sel);
      else if (myTurn() && V.round.phase === 'play') C.toast('Önce elinden bir kart seç.');
      return;
    }
    if (t.closest('#cgpile')) {
      if (sel !== null) playCard(sel);
      else if (myTurn()) C.toast('Önce elinden bir kart seç.');
      return;
    }
    if (t.closest('#cgdeck') && V && V.round.game === 'uno') { doAction('draw'); return; }
    if (!t.closest('#cgh') && sel !== null) {
      sel = null;
      $$('#cghand .hc.sel').forEach((el) => el.classList.remove('sel'));
      dirty($('#cghand')); dirty($('#cgc')); dirty($('#cgst'));
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
    // Ekran dönünce ya da boyut değişince masa yeni ölçülerle yeniden çizilir (sadece değişen yerler)
    window.addEventListener('resize', () => { if (V && C && !$('#cg').classList.contains('hidden')) render(V, C); });
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
    if (v.phase === 'roundEnd' && r.result && r.game === 'batak') {
      const res = r.result;
      h += `<h2>${esc(res.note)}</h2><p class="sub">${v.completed} / ${res.rounds} el · Koz ${SUITS[r.trump] || ''} ${SUIT_TR[r.trump] || ''} · tutturan aldığı el kadar, batan eksi ihale yazar</p>`;
      h += '<table class="score"><tr><th>Oyuncu</th><th class="num">İhale</th><th class="num">Aldığı el</th><th class="num">Bu el</th><th class="num">Toplam</th></tr>';
      const order = res.team ? [0, 2, 1, 3] : seats;
      order.forEach((i, k) => {
        const tot = res.team ? v.totals[i] : v.totals[i];
        h += `<tr class="${i === res.bidder ? (res.made ? 'win' : 'lose') : ''}"><td>${dot(i)}<b>${name(i)}</b></td><td class="num">${i === res.bidder ? res.contract : ''}</td><td class="num">${res.tricks[i]}</td>` +
          (res.team ? (k % 2 === 0 ? `<td class="num ${res.total[i] < 0 ? 'lossv' : 'gain'}" rowspan="2">${res.total[i]}</td><td class="num" rowspan="2">${tot}</td>` : '') : `<td class="num ${res.total[i] < 0 ? 'lossv' : 'gain'}">${res.total[i]}</td><td class="num">${tot}</td>`) + '</tr>';
      });
      h += '</table>';
      h += `<p class="sub" style="margin-top:8px">${res.team ? 'Eşlide puan takımca yazılır; karşı takım en az 2 el almazsa eksi ihale yazar.' : 'Hiç el almayan eksi ihale yazar.'}</p>`;
      h += `<div class="btns"><button class="btn" data-m="scores">Puan tablosu</button><button class="btn primary" data-do2="next">${res.gameOver ? 'Sonuçları gör' : 'Sonraki el'}</button></div>`;
    } else if (v.phase === 'gameEnd' && r.game === 'batak') {
      if (r.team) {
        const tt = [v.totals[0], v.totals[1]];
        const w = tt[0] >= tt[1] ? 0 : 1;
        const nm = (t2) => `${name(t2)} ve ${name(t2 + 2)}`;
        h += `<h2>Oyun bitti! Kazanan: ${nm(w)}</h2><p class="sub">En yüksek puanlı takım kazanır.</p><div class="podium">`;
        [w, 1 - w].forEach((t2, k) => { h += `<div class="pl${k === 0 ? ' first' : ''}">${nm(t2)}<b>${tt[t2]}</b></div>`; });
      } else {
        const rank = seats.slice().sort((a, b) => v.totals[b] - v.totals[a]);
        h += `<h2>Oyun bitti! Kazanan: ${name(rank[0])}</h2><p class="sub">En yüksek puan kazanır.</p><div class="podium">`;
        rank.forEach((s2, k) => { h += `<div class="pl${k === 0 ? ' first' : ''}">${k + 1}. ${name(s2)}<b>${v.totals[s2]}</b></div>`; });
      }
      h += '</div><div class="btns"><button class="btn" data-m="scores">El el puanlar</button><button class="btn primary" data-do2="reset">Yeni oyun</button></div>';
    } else if (v.phase === 'roundEnd' && r.result) {
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
    if (game === 'batak') {
      const tip = st.batakTip || 'ihale';
      const g = tip === 'gommeli';
      const e = tip === 'esli';
      return '<h2>Batak kuralları</h2><ul class="rules">' +
        `<li>52 kart, As en büyük (A, K, Q, J, 10 … 2). ${g ? '3 kişi: herkese 16 kart, 4 kart yere kapalı (gömü).' : '4 kişi: herkese 13 kart.'}${e ? ' Karşılıklı oturanlar eş.' : ''}</li>` +
        `<li>İhale dağıtandan sonraki oyuncudan başlar; her teklif öncekinden büyük olmalı, pas diyen bir daha giremez. En az ${g || e ? 8 : 5}, en çok ${g ? 16 : 13}. Herkes pas derse ihale ilk konuşana ${g || e ? "7'den" : "4'ten"} kalır.</li>` +
        (g ? '<li>İhaleyi alan gömüdeki 4 kartı eline alır, elinden istediği 4 kartı gömer (gömülen kartlar el sayılmaz), sonra kozu söyler.</li>' : '<li>İhaleyi alan kozu söyler.</li>') +
        (e ? '<li>Koz söylenince ihaleyi alanın eşinin kartları masaya açılır; o kartları da ihaleyi alan oynar.</li>' : '') +
        '<li>İlk eli ihaleyi alan açar; eli alan bir sonraki eli açar.</li>' +
        '<li>Açılan renge uymak zorunlu. Yerdeki en büyük kartı geçebiliyorsan geçmek zorundasın (el kozla kesildiyse açılan renkte bu zorunluluk kalkar).</li>' +
        '<li>Rengin yoksa koz atmak zorunlu; yerde koz varsa ve geçebiliyorsan daha büyük koz atarsın. Rengin de kozun da yoksa istediğini atarsın.</li>' +
        (e ? '<li>Eşlide kozla el açılabilir.</li>' : '<li>Koz kırılmadan (yere koz düşmeden) kozla el açılmaz; elinde sadece koz kaldıysa açabilirsin.</li>') +
        `<li>Puan: ihaleyi alan tutturursa aldığı el kadar yazar, tutturamazsa eksi ihale. ${e ? 'Karşı takım en az 2 el almalı; alırsa aldığı el kadar, alamazsa eksi ihale.' : 'Diğerleri aldığı el kadar yazar; hiç el almayan eksi ihale yazar.'}</li>` +
        `<li>${st.batakEl || 7} el oynanır; en yüksek puan kazanır.</li>` +
        '<li>Kart atmak için iki kez dokun, ya da seçip ortaya dokun, ya da yukarı sürükle.</li></ul>';
    }
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
    return '<h2>Renk kuralları</h2><ul class="rules">' +
      '<li>Herkese 7 kart dağıtılır. Sıranda yerdeki kartla aynı renkte, aynı sayıda ya da aynı işarette bir kart atarsın.</li>' +
      '<li>Atacak kartın yoksa desteden bir kart çekersin; çektiğin kart uyuyorsa hemen atabilir ya da pas geçebilirsin.</li>' +
      '<li>⊘ Pas: sıradaki oyuncu atlanır. ⇄ Yön: oyunun yönü değişir (iki kişide pas gibi). +2: sıradaki 2 kart çeker ve atlanır.</li>' +
      '<li>Renk kartı (çark): istediğin rengi seçersin. +4: rengi seçersin, sıradaki 4 kart çeker ve atlanır.</li>' +
      (st.unoStack ? '<li>Biriktirme açık: +2 gelince +2 ya da +4, +4 gelince +4 atarak cezayı sıradakine aktarabilirsin.</li>' : '') +
      '<li>Elinde 2 kart kalınca "SON!" düğmesine bas. Demeden 1 karta inersen biri "Yakala!" derse 2 kart çekersin.</li>' +
      '<li>Elini ilk bitiren, rakiplerin elindeki kartların puanını alır: sayılar kendi değeri, Pas/Yön/+2 20, Renk kartı ve +4 50 puan.</li>' +
      `<li>${st.unoTarget || 200} puana ilk ulaşan kazanır.</li></ul>`;
  }

  window.CardUI = { render, overlay, rulesHTML, pcard, ucard };
})();
