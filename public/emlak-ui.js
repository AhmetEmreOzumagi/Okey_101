/* İstanbul Emlak — telefon arayüzü. app.js çağırır: EmlakUI.render(view, yardımcılar) */
(function () {
  'use strict';
  const D = window.EmlakData;
  const ek = (w, k) => window.Dil.ek(w, k);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const SEAT_COLORS = ['#ef4b3f', '#3b82f6', '#22a75f', '#f5b400'];
  const money = (n) => '₺' + Math.round(n).toLocaleString('tr-TR');
  const B = D.BOARD;

  let C = null, V = null, built = false, roundId = null, seenEv = 0;
  let pawnPos = [0, 0, 0, 0];
  let pawnBusy = [0, 0, 0, 0]; // bu zamana kadar piyon animasyonda
  let shownMoney = null, moneyTarget = null, moneyRaf = 0;
  let openM = null; // açık pencere: { kind: 'deed' | 'props' | 'trade' | 'offer', pos }
  let tradeDraft = null;
  let bidStep = 10;

  // =============== Tahta ===============
  function cellRC(i) {
    if (i <= 10) return { r: 11, c: 11 - i };
    if (i <= 20) return { r: 11 - (i - 10), c: 1 };
    if (i <= 30) return { r: 1, c: 1 + (i - 20) };
    return { r: 1 + (i - 30), c: 11 };
  }
  const sideOf = (i) => (i % 10 === 0 ? 'k' : i < 10 ? 'b' : i < 20 ? 'l' : i < 30 ? 't' : 'r');
  const ICON = { chance: '?', chest: '🏛', tax: '💰', go: '', jail: '', park: '🅿', gotojail: '🚓' };
  function iconFor(sq, i) {
    if (sq.type === 'rail') return /Havalimanı|Gökçen/.test(sq.name) ? '✈' : '🚆';
    if (sq.type === 'util') return sq.icon === 'elec' ? '💡' : '💧';
    return ICON[sq.type] || '';
  }
  const shortName = (n) => n.replace(' Havalimanı', ' Havl.').replace('Haydarpaşa Garı', 'Haydarpaşa').replace('Sirkeci Garı', 'Sirkeci').replace(' İdaresi', '');
  // Dar karelerde uzun adlar hece yerinden bölünsün (yumuşak tire)
  const hy = (n) => n.replace(/^(.{3,}?)(köy|ada|bostan|bahçe|paşa|düzü|yurt|kapı|beyli|gan|ya)$/i, '$1&shy;$2');
  // En uzun hecesi 7+ harf olan adlar biraz küçük yazılır
  const lng = (n) => (Math.max(...hy(n).split(/&shy;|\s/).map((x) => x.length)) >= 7 ? ' lng' : '');

  function cellHTML(i) {
    const sq = B[i], rc = cellRC(i), sd = sideOf(i);
    const st = `grid-row:${rc.r};grid-column:${rc.c}`;
    if (sd === 'k') {
      let inner = '';
      if (sq.type === 'go') inner = '<div class="kgo"><b>BAŞLA</b><small>geçince ₺200</small><span class="karr">◀</span></div>';
      else if (sq.type === 'jail') inner = '<div class="kjail"><div class="kbars"><span>HAPİS</span></div><small>ziyaret</small></div>';
      else if (sq.type === 'park') inner = '<div class="kpark"><span class="kic">🅿</span><b>OTOPARK</b><small class="kpot" id="empot"></small></div>';
      else inner = '<div class="kgoj"><span class="kic">🚓</span><b>HAPSE GİR</b></div>';
      return `<div class="emc k" id="emc-${i}" data-pos="${i}" style="${st}">${inner}</div>`;
    }
    let body = '';
    if (sq.type === 'street') {
      const g = D.GROUPS[sq.group];
      body = `<i class="band" style="background:${g.color}"></i><div class="ct"><span class="nm${lng(sq.name)}">${hy(sq.name)}</span><span class="pr">${money(sq.price)}</span></div><div class="hs"></div>`;
    } else if (sq.type === 'rail' || sq.type === 'util') {
      body = `<div class="ct"><span class="ic">${iconFor(sq, i)}</span><span class="nm${lng(shortName(sq.name))}">${hy(shortName(sq.name))}</span><span class="pr">${money(sq.price)}</span></div>`;
    } else if (sq.type === 'tax') {
      body = `<div class="ct"><span class="ic">💰</span><span class="nm">${sq.name}</span><span class="pr">${money(sq.amount)}</span></div>`;
    } else {
      body = `<div class="ct ${sq.type}"><span class="ic">${iconFor(sq, i)}</span><span class="nm">${sq.name}</span></div>`;
    }
    return `<div class="emc s-${sd} ${sq.type}" id="emc-${i}" data-pos="${i}" style="${st}">${body}<i class="own"></i></div>`;
  }

  const SKYLINE = '<svg class="sky" viewBox="0 0 300 70" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
    // Galata Kulesi, camiler, minareler ve Boğaz köprüsü silüeti
    '<path d="M0 70 V58 H18 V50 H26 V58 H40 V44 h4 V30 l4 -10 l4 10 V44 h4 V58 H70 V52 a14 14 0 0 1 28 0 V58 H104 V22 l2 -10 l2 10 V58 H112 V48 a20 20 0 0 1 40 0 V58 H156 V22 l2 -10 l2 10 V58 H170 V54 H190 V60 H300 V70 Z" fill="currentColor" opacity=".55"/>' +
    '<path d="M196 60 L210 28 L224 60 M262 60 L276 28 L290 60 M200 52 Q243 30 286 52" stroke="currentColor" stroke-width="2" fill="none" opacity=".55"/>' +
    '<path d="M207 34 L196 60 M213 34 L224 60 M273 34 L262 60 M279 34 L290 60 M210 30 Q243 52 276 30" stroke="currentColor" stroke-width="1" fill="none" opacity=".4"/></svg>';

  function build() {
    if (built) return;
    built = true;
    let cells = '';
    for (let i = 0; i < 40; i++) cells += cellHTML(i);
    $('#em').innerHTML =
      '<div id="emwrap"><div id="emb"><div class="emgrid">' + cells +
      '<div class="emcenter"><div class="emlogo">' + SKYLINE + '<b>İSTANBUL</b><span>EMLAK</span></div>' +
      '<div class="emdecks"><div class="edeck chance" id="emdeck-chance"><b>?</b><span>ŞANS</span></div><div class="edeck chest" id="emdeck-chest"><b>🏛</b><span>KAMU FONU</span></div></div>' +
      '<div class="emdice" id="emdice"><div class="die" data-v="1"></div><div class="die" data-v="1"></div></div>' +
      '<div class="emmsg" id="emmsg"></div></div>' +
      '</div><div id="emtok">' + [0, 1, 2, 3].map((i) => `<div class="pawn p${i}" id="pawn-${i}" style="--pc:${SEAT_COLORS[i]}"><i></i></div>`).join('') + '</div>' +
      '<div id="emcard" class="hidden"></div></div>' +
      '<div id="emp"><div id="emtime" class="timebar"><i></i></div><div id="empl"></div><div id="emact"></div><div id="emlog"></div></div></div>' +
      '<button id="emMenu" class="iconbtn" aria-label="Menü"><i></i><i></i><i></i></button><div id="emfx"></div>';
    for (const die of $$('#emdice .die')) die.innerHTML = '<i></i>'.repeat(9);
    $('#em').addEventListener('click', onClick);
    window.addEventListener('resize', () => { if (V && !$('#em').classList.contains('hidden')) { sizes(true); placeAll(true); } });
  }

  function sizes(force) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const land = vw > vh * 1.05;
    const S = Math.floor(land ? Math.min(vh - 10, vw - 250) : Math.min(vw - 10, vh - 290));
    const key = S + ':' + land;
    const em = $('#em');
    if (!force && em.__sz === key) return;
    em.__sz = key;
    em.classList.toggle('land', land);
    em.style.setProperty('--S', Math.max(240, S) + 'px');
  }

  // =============== Piyonlar ===============
  function cellCenter(i) {
    const el = $('#emc-' + i), box = $('#emb');
    if (!el || !box) return { x: 0, y: 0 };
    const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2, w: a.width, h: a.height };
  }
  // Aynı karede birden çok piyon: köşelere dağıt
  function offsetFor(seat, pos) {
    const here = [0, 1, 2, 3].filter((s) => V && V.round.active[s] && !V.round.players[s].bankrupt && pawnPos[s] === pos);
    if (here.length <= 1) return { dx: 0, dy: 0 };
    const k = here.indexOf(seat);
    const d = Math.max(5, (cellCenter(pos).w || 30) * 0.2);
    return [{ dx: -d, dy: -d }, { dx: d, dy: -d }, { dx: -d, dy: d }, { dx: d, dy: d }][k] || { dx: 0, dy: 0 };
  }
  function placePawn(seat, pos, dur) {
    const el = $('#pawn-' + seat);
    if (!el) return;
    pawnPos[seat] = pos;
    const c = cellCenter(pos), o = offsetFor(seat, pos);
    el.style.transitionDuration = (dur || 0) + 'ms';
    el.style.transform = `translate(${c.x + o.dx}px, ${c.y + o.dy}px)`;
  }
  function placeAll(force) {
    if (!V) return;
    const r = V.round, now = Date.now();
    for (let s = 0; s < 4; s++) {
      const el = $('#pawn-' + s);
      if (!el) continue;
      const on = r.active[s] && !r.players[s].bankrupt;
      el.classList.toggle('hidden', !on);
      el.classList.toggle('turn', V.phase === 'playing' && r.turn === s);
      el.classList.toggle('jailed', !!r.players[s].jail);
      if (!on) continue;
      if (pawnBusy[s] > now && !force) continue;
      if (force || pawnBusy[s] <= now) pawnPos[s] = pawnBusy[s] > now ? pawnPos[s] : r.players[s].pos;
    }
    for (let s = 0; s < 4; s++) if (r.active[s] && !r.players[s].bankrupt && (pawnBusy[s] <= now || force)) placePawn(s, pawnPos[s], force ? 0 : 250);
  }
  // Piyonu kare kare yürüt
  function walk(seat, from, steps, t, via) {
    const el = $('#pawn-' + seat);
    if (!el) return 0;
    const n = Math.abs(steps);
    const dir = steps < 0 ? -1 : 1;
    const stepMs = reduceMotion ? 0 : n > 12 ? 70 : 125;
    const total = n * stepMs + 200;
    pawnBusy[seat] = Math.max(pawnBusy[seat], Date.now() + t + total + 50);
    for (let k = 1; k <= n; k++) {
      setTimeout(() => {
        const p = (from + dir * k + 40) % 40;
        placePawn(seat, p, stepMs);
        if (!reduceMotion) { el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop'); }
      }, t + k * stepMs);
    }
    if (!n) setTimeout(() => placePawn(seat, (from + 40) % 40, 0), t);
    return total;
  }
  function glide(seat, to, t, ms) {
    pawnBusy[seat] = Math.max(pawnBusy[seat], Date.now() + t + ms + 60);
    setTimeout(() => placePawn(seat, to, ms), t);
    return ms;
  }

  // =============== Kareler ===============
  function updateCells(v) {
    const r = v.round;
    for (let i = 0; i < 40; i++) {
      const el = $('#emc-' + i);
      if (!el) continue;
      const o = r.owner[i];
      el.classList.toggle('owned', o >= 0);
      el.classList.toggle('mort', !!r.mortgaged[i]);
      el.classList.toggle('offer', r.offer === i || (r.auction && r.auction.pos === i));
      if (o >= 0) el.style.setProperty('--oc', SEAT_COLORS[o]); else el.style.removeProperty('--oc');
      const hs = el.querySelector('.hs');
      if (hs) {
        const h = r.houses[i];
        const want = h === 5 ? '<i class="hotel"></i>' : '<i class="house"></i>'.repeat(h);
        if (hs.__h !== want) { hs.__h = want; hs.innerHTML = want; }
      }
    }
    const pot = $('#empot');
    if (pot) pot.textContent = r.otopark && r.pot ? money(r.pot) : '';
  }

  // =============== Panel ===============
  const nameOf = (v, s) => (v.seats[s] ? v.seats[s].name : 'Koltuk ' + (s + 1));
  function setHTML(el, html) {
    if (!el || el.__h === html) return false;
    el.__h = html;
    el.innerHTML = html;
    return true;
  }
  function playersHTML(v) {
    const r = v.round, esc = C.esc;
    let h = '';
    for (let s = 0; s < 4; s++) {
      if (!r.active[s]) continue;
      const p = r.players[s], seat = v.seats[s];
      const owned = D.OWNABLE.filter((q) => r.owner[q] === s);
      const chips = D.GROUPS.map((g, gi) => {
        const n = D.groupMembers(gi).filter((q) => r.owner[q] === s).length;
        return n ? `<i class="gc${D.ownsGroup(r, s, gi) ? ' full' : ''}" style="background:${g.color}" title="${g.name}">${n > 1 ? n : ''}</i>` : '';
      }).join('') + (owned.filter((q) => B[q].type === 'rail').length ? `<i class="gc rail">🚆${owned.filter((q) => B[q].type === 'rail').length}</i>` : '') +
        (owned.filter((q) => B[q].type === 'util').length ? `<i class="gc util">${owned.filter((q) => B[q].type === 'util').length === 2 ? '💡💧' : B[owned.find((q) => B[q].type === 'util')].icon === 'elec' ? '💡' : '💧'}</i>` : '');
      const badges = (p.jail ? '<span class="eb jail">hapiste</span>' : '') + (p.jailCards ? `<span class="eb card">çıkış kartı ×${p.jailCards}</span>` : '') +
        (seat && seat.bot ? '<span class="eb">bot</span>' : '') + (seat && !seat.online ? '<span class="eb off">bağlantı yok</span>' : '');
      h += `<div class="epl${r.turn === s && v.phase === 'playing' ? ' turn' : ''}${p.bankrupt ? ' broke' : ''}${s === v.me ? ' me' : ''}" data-player="${s}">` +
        `<span class="ed" style="--pc:${SEAT_COLORS[s]}"></span><div class="en"><b>${esc(nameOf(v, s))}${s === v.me ? ' <small>(sen)</small>' : ''}</b>` +
        `<div class="eg">${p.bankrupt ? '<span class="eb off">iflas</span>' : chips + badges}</div></div>` +
        `<div class="em"><b class="emoney" data-m="${s}">${money(shownMoney ? shownMoney[s] : p.money)}</b><small>servet ${money(r.worths[s])}</small></div></div>`;
    }
    return h;
  }

  function deedMini(pos) {
    const sq = B[pos];
    const head = sq.type === 'street' ? `<div class="dh" style="background:${D.GROUPS[sq.group].color}"><small>${D.GROUPS[sq.group].name}</small><b>${sq.name}</b></div>`
      : `<div class="dh plain"><b>${iconFor(sq, pos)} ${sq.name}</b></div>`;
    return `<button class="deedmini" data-pos="${pos}">${head}<span>${money(sq.price)}</span></button>`;
  }

  function actionsHTML(v) {
    const r = v.round, me = v.me, esc = C.esc;
    const mine = r.actor === me && v.phase === 'playing';
    const p = r.players[me];
    const nm = (s) => esc(nameOf(v, s));
    if (v.phase !== 'playing') return '';
    let h = '';
    const turnName = nm(r.turn);
    // Gelen takas teklifi
    if (r.trade) {
      const t = r.trade;
      const list = (side) => side.props.map((q) => `<span class="tp" style="--gc:${B[q].type === 'street' ? D.GROUPS[B[q].group].color : '#555'}">${esc(B[q].name)}${r.mortgaged[q] ? ' (ipotekli)' : ''}</span>`).join('') +
        (side.money ? `<span class="tp money">${money(side.money)}</span>` : '') + (side.cards ? `<span class="tp">${side.cards} çıkış kartı</span>` : '');
      h += `<div class="etrade"><div class="tt">${nm(t.from)} → ${nm(t.to)} takas teklifi</div>` +
        `<div class="tside"><small>${t.from === me ? 'Veriyorsun' : esc(ek(nameOf(v, t.from), 'in')) + ' verdiği'}</small>${list(t.give) || '<span class="tp">—</span>'}</div>` +
        `<div class="tside"><small>${t.from === me ? 'İstiyorsun' : t.to === me ? 'Senden istediği' : esc(ek(nameOf(v, t.from), 'in')) + ' istediği'}</small>${list(t.get) || '<span class="tp">—</span>'}</div>`;
      if (t.to === me) h += '<div class="ebtns"><button class="btn primary" data-ea="acceptTrade">Kabul et</button><button class="btn" data-ea="rejectTrade">Reddet</button></div>';
      else if (t.from === me) h += '<div class="ebtns"><span class="ewait">Cevap bekleniyor…</span><button class="btn" data-ea="rejectTrade">Geri çek</button></div>';
      else h += `<div class="ewait">${nm(t.to)} düşünüyor…</div>`;
      return h + '</div>';
    }
    if (r.phase === 'auction' && r.auction) {
      const a = r.auction;
      h += `<div class="eauct"><div class="tt">Açık artırma</div>${deedMini(a.pos)}<div class="ahigh">${a.highSeat >= 0 ? `En yüksek: <b>${money(a.high)}</b> · ${nm(a.highSeat)}` : 'Henüz teklif yok (en az ₺10)'}</div>`;
      if (a.bidder === me) {
        const base = Math.max(a.high, 0);
        const opts = [10, 50, 100].map((inc) => Math.max(10, base + inc)).filter((x, i, arr) => arr.indexOf(x) === i);
        h += '<div class="ebtns">' + opts.map((x) => `<button class="btn${x <= p.money ? ' primary' : ''}" data-ea="bid:${x}"${x <= p.money ? '' : ' disabled'}>${money(x)}</button>`).join('') +
          '<button class="btn" data-ea="passBid">Çekil</button></div>';
      } else h += `<div class="ewait">Sıra ${esc(ek(nameOf(v, a.bidder), 'de'))}…</div>`;
      return h + '</div>';
    }
    if (!mine) {
      let w = r.phase === 'buy' ? `${turnName} ${esc(ek(B[r.offer].name, 'i'))} almayı düşünüyor` : r.phase === 'debt' ? `${turnName} borcunu ödemek için para arıyor` : `Sıra ${esc(ek(nameOf(v, r.turn), 'de'))}`;
      if (r.players[me] && r.players[me].bankrupt) w = 'İflas ettin; oyunu izliyorsun.';
      return `<div class="ewait big">${w}</div>` + (r.players[me] && !r.players[me].bankrupt ? '<div class="ebtns"><button class="btn" data-ea="props">Mülklerim</button></div>' : '');
    }
    if (r.phase === 'roll') {
      if (p.jail) {
        h += `<div class="einfo">Hapistesin (${p.jail}. tur). Çift atarsan çıkarsın; 3. turda çıkamazsan ₺50 ödeyip çıkarsın.</div><div class="ebtns">` +
          `<button class="btn primary" data-ea="roll">Çift dene</button><button class="btn" data-ea="payJail"${p.money >= 50 ? '' : ' disabled'}>₺50 öde</button>` +
          (p.jailCards ? '<button class="btn" data-ea="useCard">Kartı kullan</button>' : '') + '</div>';
      } else h += `<div class="ebtns"><button class="btn primary big" data-ea="roll">🎲 Zar at${r.doubles ? ' (çift: tekrar)' : ''}</button></div>`;
      h += '<div class="ebtns sm"><button class="btn" data-ea="props">Mülklerim</button><button class="btn" data-ea="trade">Takas</button></div>';
      return h;
    }
    if (r.phase === 'buy') {
      const sq = B[r.offer];
      h += `<div class="ebuy">${deedMini(r.offer)}<div class="ebtns"><button class="btn primary" data-ea="buy"${p.money >= sq.price ? '' : ' disabled'}>Satın al ${money(sq.price)}</button><button class="btn" data-ea="decline">Açık artırma</button></div>` +
        (p.money < sq.price ? '<div class="einfo">Paran yetmiyor: ipotek ederek para bulabilir ya da açık artırmaya bırakabilirsin.</div><div class="ebtns sm"><button class="btn" data-ea="props">Mülklerim</button></div>' : '') + '</div>';
      return h;
    }
    if (r.phase === 'debt' && r.debt) {
      const d = r.debt;
      h += `<div class="edebt"><b>${money(d.amount)}</b> ödemen gerekiyor${d.to >= 0 ? ` (${esc(ek(nameOf(v, d.to), 'e'))})` : ''}. Elinde ${money(p.money)} var.</div>` +
        '<div class="einfo">Bina satarak ya da ipotek ederek para bul.</div>' +
        `<div class="ebtns"><button class="btn primary" data-ea="payDebt"${p.money >= d.amount ? '' : ' disabled'}>Öde</button><button class="btn" data-ea="props">Mülklerim</button><button class="btn danger" data-ea="bankrupt">İflas et</button></div>`;
      return h;
    }
    if (r.phase === 'done') {
      h += '<div class="ebtns"><button class="btn primary big" data-ea="end">Turu bitir</button></div>' +
        '<div class="ebtns sm"><button class="btn" data-ea="props">Mülklerim</button><button class="btn" data-ea="trade">Takas</button></div>';
    }
    return h;
  }

  function msgText(v) {
    const r = v.round, esc = C.esc;
    const roundTxt = r.turnsLimit ? `Tur ${Math.min(r.roundNo, r.turnsLimit)} / ${r.turnsLimit}` : `Tur ${r.roundNo}`;
    // Son zar ve gidilen kare
    let txt = '';
    for (let i = r.events.length - 1; i >= 0; i--) {
      const e = r.events[i];
      if (e.type === 'turn' || e.type === 'deal') break;
      if (e.type === 'roll' && !e.util) {
        const mv = r.events.slice(i + 1).find((x) => x.type === 'move' && x.seat === e.seat);
        txt = `${esc(nameOf(v, e.seat))} ${e.dice[0]} + ${e.dice[1]} attı${e.dice[0] === e.dice[1] ? ' (çift!)' : ''}${mv ? ` → ${esc(B[mv.to].name)}` : ''}`;
        break;
      }
    }
    if (!txt && v.log.length) txt = esc(v.log[v.log.length - 1].text);
    // "200 ₺" satır sonunda bölünmesin
    return `<small>${roundTxt}</small><span>${txt.replace(/(\d) ₺/g, '$1\u00a0₺')}</span>`;
  }

  // =============== Zar ===============
  function setDie(el, n) { el.dataset.v = n; }
  function rollDice(d, t) {
    const dice = $$('#emdice .die');
    if (!dice.length) return 0;
    if (reduceMotion) { setTimeout(() => { setDie(dice[0], d[0]); setDie(dice[1], d[1]); }, t); return 100; }
    const ms = 650;
    setTimeout(() => {
      $('#emdice').classList.remove('roll'); void $('#emdice').offsetWidth; $('#emdice').classList.add('roll');
      let k = 0;
      const iv = setInterval(() => {
        dice.forEach((el) => setDie(el, 1 + Math.floor(Math.random() * 6)));
        if (++k > 7) { clearInterval(iv); setDie(dice[0], d[0]); setDie(dice[1], d[1]); $('#emdice').classList.toggle('dbl', d[0] === d[1]); }
      }, 70);
    }, t);
    return ms;
  }

  // =============== Efektler ===============
  function floatAt(text, x, y, t, cls) {
    const el = document.createElement('div');
    el.className = 'eft ' + (cls || '');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    setTimeout(() => { $('#emfx').appendChild(el); setTimeout(() => el.remove(), 1600); }, t);
  }
  function floatCell(pos, text, t, cls) {
    const el = $('#emc-' + pos);
    if (!el) return;
    const r = el.getBoundingClientRect();
    floatAt(text, r.left + r.width / 2, r.top + r.height / 2, t, cls);
  }
  function floatPlayer(seat, text, t, cls) {
    const el = $(`#empl [data-player="${seat}"] .em`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    floatAt(text, r.left + r.width / 2, r.top + r.height / 2, t, cls);
  }
  function flash(pos, t, cls) {
    setTimeout(() => {
      const el = $('#emc-' + pos);
      if (!el) return;
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), 1300);
    }, t);
  }
  function confetti(t) {
    if (reduceMotion) return;
    const box = $('#emb').getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const colors = ['#e3b04b', '#f8f2df', '#e05252', '#7fc4ec', '#8fe0a0', '#ffd166'];
    setTimeout(() => {
      for (let i = 0; i < 36; i++) {
        const p = document.createElement('i');
        p.className = 'conf';
        p.style.background = colors[i % colors.length];
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        $('#emfx').appendChild(p);
        const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 160;
        const an = p.animate([
          { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 40}px)) rotate(${Math.random() * 600}deg)`, opacity: 1, offset: .6 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.1}px), calc(-50% + ${Math.sin(a) * d + 90}px)) rotate(${Math.random() * 720}deg)`, opacity: 0 },
        ], { duration: 1300 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
        an.onfinish = () => p.remove();
      }
    }, t);
  }

  // Şans / Kamu Fonu kartı: desteden çıkıp ortada döner
  let cardHide = 0;
  function showCard(ev, t) {
    setTimeout(() => {
      const box = $('#emcard');
      const chance = ev.deck === 'chance';
      box.innerHTML = `<div class="ecard ${chance ? 'chance' : 'chest'}"><div class="ecin"><div class="ecf back"><b>${chance ? '?' : '🏛'}</b><span>${chance ? 'ŞANS' : 'KAMU FONU'}</span></div>` +
        `<div class="ecf front"><div class="ech">${chance ? 'ŞANS' : 'KAMU FONU'}</div><p>${C.esc(ev.text)}</p><small>${C.esc(nameOf(V, ev.seat))} çekti · kapatmak için dokun</small></div></div></div>`;
      box.classList.remove('hidden');
      const deck = $('#emdeck-' + ev.deck);
      if (deck && !reduceMotion) { deck.classList.remove('pull'); void deck.offsetWidth; deck.classList.add('pull'); }
      clearTimeout(cardHide);
      cardHide = setTimeout(() => box.classList.add('hidden'), 3600);
    }, t);
  }

  function animate(evs, fresh) {
    if (!evs.length) return;
    const r = V.round, me = V.me;
    let t = 0;
    if (fresh) return;
    evs.forEach((ev) => {
      switch (ev.type) {
        case 'roll': t += rollDice(ev.dice, t); break;
        case 'move':
          if (ev.via === 'jail') {
            t += glide(ev.seat, ev.to, t, reduceMotion ? 0 : 700);
          } else if (ev.via === 'card' && Math.abs(ev.steps) > 12) {
            t += walk(ev.seat, ev.from, ev.steps, t, ev.via);
          } else t += walk(ev.seat, ev.from, ev.steps, t, ev.via);
          break;
        case 'go': floatCell(0, '+₺' + ev.amount, t - 150, 'gain'); floatPlayer(ev.seat, '+₺' + ev.amount, t, 'gain'); break;
        case 'pay':
          floatPlayer(ev.from, '−' + money(ev.amount), t, 'loss');
          if (ev.to >= 0) floatPlayer(ev.to, '+' + money(ev.amount), t + 150, 'gain');
          if (ev.reason === 'rent') floatCell(r.players[ev.from] ? pawnTarget(ev.from) : 0, 'Kira ' + money(ev.amount), t, 'loss');
          t += 250;
          break;
        case 'gain': floatPlayer(ev.seat, '+' + money(ev.amount), t, 'gain'); break;
        case 'pot': floatCell(20, '+' + money(ev.amount), t, 'gain big'); floatPlayer(ev.seat, '+' + money(ev.amount), t, 'gain'); break;
        case 'buy': flash(ev.pos, t, 'sold'); floatCell(ev.pos, ev.auction ? 'Açık artırma!' : 'Satıldı!', t, 'stamp'); t += 300; break;
        case 'card': showCard(ev, t); t += 1700; break;
        case 'jail': floatCell(10, 'Hapis!', t, 'loss big'); flash(10, t, 'jailfx'); break;
        case 'build': flash(ev.pos, t, 'built'); floatCell(ev.pos, ev.houses === 5 ? '🏨 Otel!' : '🏠 +1', t, 'gain'); break;
        case 'sell': flash(ev.pos, t, 'mortfx'); break;
        case 'mortgage': case 'unmortgage': flash(ev.pos, t, 'mortfx'); floatPlayer(ev.seat, (ev.type === 'mortgage' ? '+' : '−') + money(ev.amount), t, ev.type === 'mortgage' ? 'gain' : 'loss'); break;
        case 'auction': flash(ev.pos, t, 'sold'); break;
        case 'bid': floatPlayer(ev.seat, money(ev.amount), t, 'bid'); break;
        case 'bidPass': floatPlayer(ev.seat, 'Çekildi', t, 'small'); break;
        case 'trade': floatPlayer(ev.from, 'Takas!', t, 'gain'); floatPlayer(ev.to, 'Takas!', t, 'gain'); break;
        case 'bankrupt': floatPlayer(ev.seat, 'İFLAS', t, 'loss big'); break;
        case 'end': confetti(t + 300); break;
        case 'jailcard': floatPlayer(ev.seat, 'Kart kullandı', t, 'small'); break;
        default:
      }
    });
    // Animasyonlar bitince piyonları durumla eşitle
    setTimeout(() => placeAll(false), t + 120);
    if (evs.some((e) => e.type === 'roll' && e.seat === me)) { /* kendi zarın: kart açılırsa okumak için süre */ }
  }
  function pawnTarget(seat) { return V.round.players[seat].pos; }

  // =============== Pencereler ===============
  function rentRows(sq) {
    if (sq.type === 'street') {
      const lbl = ['Boş arsa', 'Grup tamamsa', '1 ev', '2 ev', '3 ev', '4 ev', 'Otel'];
      const vals = [sq.rents[0], sq.rents[0] * 2, sq.rents[1], sq.rents[2], sq.rents[3], sq.rents[4], sq.rents[5]];
      return lbl.map((l, i) => `<tr><td>${l}</td><td class="num">${money(vals[i])}</td></tr>`).join('');
    }
    if (sq.type === 'rail') return D.RAIL_RENT.map((x, i) => `<tr><td>${i + 1} istasyon</td><td class="num">${money(x)}</td></tr>`).join('');
    return '<tr><td>Bir idare</td><td class="num">zar × 4</td></tr><tr><td>İki idare</td><td class="num">zar × 10</td></tr>';
  }
  function deedHTML(pos) {
    const v = V, r = v.round, sq = B[pos], esc = C.esc;
    if (!sq.price) {
      const info = { go: 'BAŞLA\'dan geçen ya da üstüne gelen ₺200 alır.', jail: 'Hapis. Ziyarete gelen bir şey ödemez.', park: r.otopark ? 'Otopark kumbarası: vergiler ve cezalar burada birikir; gelen hepsini alır.' : 'Otopark: bir şey olmaz, dinlen.', gotojail: 'Doğruca hapse girersin; BAŞLA\'dan geçmezsin.', tax: `${money(sq.amount)} öde.`, chance: 'Şans kartı çekersin.', chest: 'Kamu Fonu kartı çekersin.' }[sq.type] || '';
      return `<div class="deed plain"><div class="dhd"><b>${iconFor(sq, pos)} ${esc(sq.name)}</b></div><p>${info}</p></div>`;
    }
    const o = r.owner[pos];
    const head = sq.type === 'street' ? `<div class="dhd" style="background:${D.GROUPS[sq.group].color}"><small>TAPU · ${esc(D.GROUPS[sq.group].name)}</small><b>${esc(sq.name)}</b></div>`
      : `<div class="dhd plain"><small>TAPU</small><b>${iconFor(sq, pos)} ${esc(sq.name)}</b></div>`;
    let h = `<div class="deed">${head}`;
    if (sq.type === 'street') h += `<div class="dreal">${esc(sq.ilce)} · gerçek konut fiyatı ${money(sq.m2)}/m²</div>`;
    h += `<table class="dtab">${rentRows(sq)}</table><div class="dfoot">`;
    if (sq.type === 'street') h += `<span>Ev ${money(sq.house)} · Otel: 4 ev + ${money(sq.house)}</span>`;
    h += `<span>İpotek ${money(sq.mortgage)} · kaldırma ${money(D.unmortgageCost(pos))}</span><span>Fiyat ${money(sq.price)}</span></div>`;
    h += `<div class="downer">${o >= 0 ? `Sahibi: <b style="color:${SEAT_COLORS[o]}">${esc(nameOf(v, o))}</b>${r.houses[pos] ? ` · ${r.houses[pos] === 5 ? 'otel' : r.houses[pos] + ' ev'}` : ''}${r.mortgaged[pos] ? ' · <b>ipotekli</b>' : ''}` : 'Bankada (sahipsiz)'}</div>`;
    if (o === v.me && manageOk()) h += manageBtns(pos);
    return h + '</div>';
  }
  function manageOk() {
    const r = V.round;
    return V.phase === 'playing' && r.turn === V.me && ['roll', 'done', 'debt'].includes(r.phase) && !r.trade;
  }
  function manageBtns(pos) {
    const r = V.round, me = V.me, sq = B[pos];
    const b = (act, label, why) => `<button class="btn${why ? '' : ' primary'}" data-ea="${act}:${pos}"${why ? ` disabled title="${C.esc(why)}"` : ''}>${label}</button>`;
    let h = '<div class="dman">';
    if (sq.type === 'street') {
      h += b('build', r.houses[pos] === 4 ? 'Otel kur' : '+ Ev', D.canBuild(r, me, pos));
      h += b('sell', r.houses[pos] === 5 ? 'Oteli sat' : '− Ev sat', D.canSell(r, me, pos));
    }
    h += r.mortgaged[pos] ? b('unmortgage', 'İpoteği kaldır', D.canUnmortgage(r, me, pos)) : b('mortgage', 'İpotek et', D.canMortgage(r, me, pos));
    return h + '</div>';
  }
  function propsHTML() {
    const v = V, r = v.round, me = v.me, esc = C.esc;
    const mine = D.OWNABLE.filter((q) => r.owner[q] === me);
    let h = `<h2>Mülklerim</h2><p class="sub">Paran ${money(r.players[me].money)} · bankada ${r.bankHouses} ev, ${r.bankHotels} otel${manageOk() ? '' : ' · bina ve ipotek işleri kendi sıranda yapılır'}</p>`;
    if (!mine.length) h += '<p>Henüz mülkün yok.</p>';
    else {
      h += '<div class="plist">';
      mine.forEach((q) => {
        const sq = B[q];
        const col = sq.type === 'street' ? D.GROUPS[sq.group].color : '#4a4a4a';
        const rent = r.mortgaged[q] ? 'ipotekli' : 'kira ' + (sq.type === 'util' ? (D.utilsOwned(r, me) === 2 ? 'zar×10' : 'zar×4') : money(D.rentFor(r, q, 7)));
        h += `<div class="prow"><button class="pname" data-pos="${q}"><i style="background:${col}"></i>${esc(sq.name)}<small>${r.houses[q] ? (r.houses[q] === 5 ? ' 🏨' : ' ' + '🏠'.repeat(r.houses[q])) : ''} ${rent}</small></button>` +
          (manageOk() ? manageBtns(q) : '') + '</div>';
      });
      h += '</div>';
    }
    return h + '<div class="btns"><button class="btn primary" data-ea="closeM">Kapat</button></div>';
  }

  function tradeHTML() {
    const v = V, r = v.round, me = v.me, esc = C.esc;
    const others = [0, 1, 2, 3].filter((s) => s !== me && r.active[s] && !r.players[s].bankrupt);
    if (!tradeDraft || !others.includes(tradeDraft.to)) tradeDraft = { to: others[0], give: [], get: [], gm: 0, tm: 0, gc: 0, tc: 0 };
    const td = tradeDraft;
    const tradable = (s) => D.OWNABLE.filter((q) => r.owner[q] === s && !(B[q].type === 'street' && D.groupMembers(B[q].group).some((x) => r.houses[x] > 0)));
    const plist = (s, arr, key) => tradable(s).map((q) => {
      const sq = B[q], col = sq.type === 'street' ? D.GROUPS[sq.group].color : '#4a4a4a';
      return `<button class="tpk${arr.includes(q) ? ' on' : ''}" data-tp="${key}:${q}"><i style="background:${col}"></i>${esc(sq.name)}${r.mortgaged[q] ? ' <small>ipotekli</small>' : ''}</button>`;
    }).join('') || '<small class="none">Takas edilebilecek mülk yok</small>';
    const mStep = (key, val, max) => `<div class="tmoney"><button class="btn" data-tm="${key}:-50">−50</button><button class="btn" data-tm="${key}:-10">−10</button><b>${money(val)}</b><button class="btn" data-tm="${key}:10">+10</button><button class="btn" data-tm="${key}:50">+50</button><small>en çok ${money(max)}</small></div>`;
    let h = '<h2>Takas teklifi</h2><div class="tpl">' + others.map((s) => `<button class="btn${s === td.to ? ' primary' : ''}" data-tto="${s}">${esc(nameOf(v, s))}</button>`).join('') + '</div>';
    h += `<div class="tcols"><div class="tcol"><h3>Sen veriyorsun</h3>${plist(me, td.give, 'g')}${mStep('gm', td.gm, r.players[me].money)}` +
      (r.players[me].jailCards ? `<button class="tpk${td.gc ? ' on' : ''}" data-tc="g">Hapisten çıkış kartı</button>` : '') + '</div>' +
      `<div class="tcol"><h3>${esc(ek(nameOf(v, td.to), 'den'))} istiyorsun</h3>${plist(td.to, td.get, 't')}${mStep('tm', td.tm, r.players[td.to].money)}` +
      (r.players[td.to].jailCards ? `<button class="tpk${td.tc ? ' on' : ''}" data-tc="t">Hapisten çıkış kartı</button>` : '') + '</div></div>';
    h += '<p class="sub">Binası olan gruptaki arsalar takas edilemez (önce binalar satılır). İpotekli mülk ipotekli olarak geçer.</p>';
    h += '<div class="btns"><button class="btn" data-ea="closeM">Vazgeç</button><button class="btn primary" data-ea="sendTrade">Teklif gönder</button></div>';
    return h;
  }

  function openModal(kind, pos) {
    openM = { kind, pos };
    refreshModal(true);
  }
  function refreshModal(first) {
    if (!openM) return;
    const m = $('#modal');
    if (!first && (m.classList.contains('hidden') || !m.__em)) { openM = null; return; }
    let html = '';
    if (openM.kind === 'deed') html = deedHTML(openM.pos) + '<div class="btns"><button class="btn primary" data-ea="closeM">Kapat</button></div>';
    else if (openM.kind === 'props') html = propsHTML();
    else if (openM.kind === 'trade') html = tradeHTML();
    const card = m.querySelector('.card');
    if (!first && card && card.__h === html) return;
    if (first || !card) {
      C.modal(html, (mm) => { mm.__em = true; mm.querySelector('.card').classList.add('emmodal'); bindModal(mm); });
      const c2 = m.querySelector('.card');
      if (c2) c2.__h = html;
    } else { card.innerHTML = html; card.__h = html; }
  }
  // Pencere tıklamaları (bir kez bağlanır; sadece emlak pencerelerinde çalışır)
  function bindModal(mm) {
    if (mm.__emBound) return;
    mm.__emBound = true;
    mm.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.emmodal')) onClick(e); });
  }
  function closeModal() {
    openM = null;
    const m = $('#modal');
    if (m) m.__em = false;
    C.closeModal();
  }

  // =============== Dokunma ===============
  function onClick(e) {
    const t = e.target;
    if (t.closest('#emMenu')) { C.showMenu(); return; }
    if (t.closest('#emcard')) { $('#emcard').classList.add('hidden'); return; }
    const ea = t.closest('[data-ea]');
    if (ea) {
      e.stopPropagation();
      if (ea.disabled) return;
      return doAct(ea.dataset.ea);
    }
    const tto = t.closest('[data-tto]');
    if (tto) { e.stopPropagation(); tradeDraft = { to: +tto.dataset.tto, give: [], get: [], gm: 0, tm: 0, gc: 0, tc: 0 }; refreshModal(); return; }
    const tp = t.closest('[data-tp]');
    if (tp) {
      e.stopPropagation();
      const [k, q] = tp.dataset.tp.split(':');
      const arr = k === 'g' ? tradeDraft.give : tradeDraft.get;
      const i = arr.indexOf(+q);
      if (i >= 0) arr.splice(i, 1); else arr.push(+q);
      refreshModal();
      return;
    }
    const tm = t.closest('[data-tm]');
    if (tm) {
      e.stopPropagation();
      const [k, d] = tm.dataset.tm.split(':');
      const r = V.round;
      const max = k === 'gm' ? r.players[V.me].money : r.players[tradeDraft.to].money;
      tradeDraft[k] = Math.max(0, Math.min(max, tradeDraft[k] + Number(d)));
      refreshModal();
      return;
    }
    const tc = t.closest('[data-tc]');
    if (tc) { e.stopPropagation(); const k = tc.dataset.tc === 'g' ? 'gc' : 'tc'; tradeDraft[k] = tradeDraft[k] ? 0 : 1; refreshModal(); return; }
    const pos = t.closest('[data-pos]');
    if (pos && !t.closest('.dman')) { e.stopPropagation(); openModal('deed', +pos.dataset.pos); return; }
    const pl = t.closest('[data-player]');
    if (pl) {
      const s = +pl.dataset.player;
      const owned = D.OWNABLE.filter((q) => V.round.owner[q] === s);
      if (s === V.me) openModal('props');
      else C.modal(`<h2>${C.esc(ek(nameOf(V, s), 'in'))} mülkleri</h2><div class="plist">` + (owned.map((q) => `<div class="prow"><button class="pname" data-pos="${q}"><i style="background:${B[q].type === 'street' ? D.GROUPS[B[q].group].color : '#4a4a4a'}"></i>${C.esc(B[q].name)}<small>${V.round.houses[q] ? (V.round.houses[q] === 5 ? ' 🏨' : ' ' + '🏠'.repeat(V.round.houses[q])) : ''}${V.round.mortgaged[q] ? ' ipotekli' : ''}</small></button></div>`).join('') || '<p>Mülkü yok.</p>') +
        '</div><div class="btns"><button class="btn primary" id="closeM">Kapat</button></div>', (m) => { m.querySelector('#closeM').onclick = C.closeModal; m.querySelector('.card').classList.add('emmodal'); bindModal(m); });
    }
  }

  function doAct(a) {
    const [act, arg] = a.split(':');
    switch (act) {
      case 'closeM': closeModal(); return;
      case 'props': openModal('props'); return;
      case 'trade': tradeDraft = null; openModal('trade'); return;
      case 'sendTrade': {
        const td = tradeDraft;
        if (!td) return;
        closeModal();
        C.api('offer', { to: td.to, give: { props: td.give, money: td.gm, cards: td.gc }, get: { props: td.get, money: td.tm, cards: td.tc } });
        return;
      }
      case 'bid': C.api('bid', { amount: +arg }); return;
      case 'build': case 'sell': case 'mortgage': case 'unmortgage':
        C.api(act, { pos: +arg }).then(() => refreshModal());
        return;
      case 'bankrupt':
        C.confirmBox('İflas mı?', 'Bütün mülklerin alacaklıya (ya da bankaya) geçer ve oyundan çıkarsın.', 'İflas et', true).then((y) => y && C.api('bankrupt'));
        return;
      default: C.api(act);
    }
  }

  // =============== Para sayacı ===============
  function tickMoney() {
    moneyRaf = 0;
    if (!shownMoney || !moneyTarget) return;
    let busy = false;
    for (let s = 0; s < 4; s++) {
      const d = moneyTarget[s] - shownMoney[s];
      if (Math.abs(d) < 1) { shownMoney[s] = moneyTarget[s]; continue; }
      shownMoney[s] += d * 0.18;
      busy = true;
    }
    $$('#empl .emoney').forEach((el) => { el.textContent = money(shownMoney[+el.dataset.m]); });
    if (busy) moneyRaf = requestAnimationFrame(tickMoney);
  }

  // =============== Çizim ===============
  function render(v, ctx) {
    C = ctx;
    build();
    const r = v.round;
    const prevV = V;
    V = v;
    sizes(false);
    let fresh = false;
    if (roundId !== r.id) {
      fresh = true;
      roundId = r.id;
      seenEv = r.evId;
      pawnPos = r.players.map((p) => p.pos);
      pawnBusy = [0, 0, 0, 0];
      shownMoney = r.players.map((p) => p.money);
    }
    const evs = r.events.filter((e) => e.id > seenEv);
    seenEv = r.evId;
    moneyTarget = r.players.map((p) => p.money);
    updateCells(v);
    setHTML($('#empl'), playersHTML(v));
    setHTML($('#emact'), actionsHTML(v));
    setHTML($('#emmsg'), msgText(v));
    setHTML($('#emlog'), v.log.slice(-3).reverse().map((l) => `<div>${C.esc(l.text)}</div>`).join(''));
    if (r.dice && fresh) { const ds = $$('#emdice .die'); setDie(ds[0], r.dice[0]); setDie(ds[1], r.dice[1]); }
    if (fresh) requestAnimationFrame(() => placeAll(true));
    animate(evs, fresh);
    if (!evs.some((e) => e.type === 'move')) placeAll(false);
    if (!moneyRaf) moneyRaf = requestAnimationFrame(tickMoney);
    refreshModal(false);
    // Bana takas teklifi geldiyse panel zaten gösteriyor; telefon titresin
    if (r.trade && r.trade.to === v.me && !(prevV && prevV.round.trade)) { try { if (navigator.vibrate) navigator.vibrate([60, 60, 60]); } catch (e) {} }
  }

  function myMove(v) {
    const r = v && v.round;
    return !!r && v.phase === 'playing' && r.actor === v.me;
  }

  // =============== Kurallar ===============
  function rulesHTML(st) {
    return '<h2>İstanbul Emlak kuralları</h2><ul class="rules">' +
      `<li>2-4 kişi. Herkes ${money(st.emlakPara || 1500)} ile BAŞLA'dan çıkar. İki zar atıp o kadar ilerlersin; BAŞLA'dan geçince ₺200 alırsın.</li>` +
      '<li>Sahipsiz bir mülke gelirsen fiyatını ödeyip alabilirsin; almazsan açık artırmaya çıkar (sen de katılırsın, en az ₺10).</li>' +
      '<li>Başkasının mülküne gelen kira öder. Bir renk grubunun hepsi seninse boş arsada kira iki kat. İstasyon kirası sahip olunan istasyon sayısına göre (₺25-200), idare kirası zar × 4 (ikisi birden sende ise × 10).</li>' +
      '<li>Bir grubun hepsi senin olunca ev kurarsın; evler eşit kurulur (bir arsada iki ev için gruptaki hepsinde bir ev olmalı). 4 evden sonra otel. Bankada 32 ev, 12 otel var.</li>' +
      '<li>Çift atarsan bir daha atarsın; üst üste üç çift hapse sokar. "Hapse gir" karesi ve kartı da hapse sokar.</li>' +
      '<li>Hapisten çıkmak için: ₺50 öde, çıkış kartı kullan ya da çift dene. Üçüncü denemede de çift gelmezse ₺50 ödeyip çıkarsın. Hapisteyken kira toplamaya devam edersin.</li>' +
      '<li>Paraya sıkışırsan binaları yarı fiyatına satar, mülkleri ipotek edersin (fiyatın yarısı). İpotekli mülkten kira alınmaz; ipotek %10 fazlasıyla kaldırılır.</li>' +
      '<li>Kendi sıranda başka oyuncuya takas teklif edebilirsin: mülk, para ve hapisten çıkış kartı.</li>' +
      '<li>Borcunu ödeyemeyen iflas eder: oyuncuya borçluysa her şeyi ona, bankaya borçluysa mülkleri bankaya geçer.</li>' +
      (st.emlakOtopark ? '<li>Otopark kumbarası açık: vergiler ve cezalar ortada birikir, Otopark\'a gelen hepsini alır.</li>' : '<li>Otopark\'ta bir şey olmaz (resmî kural).</li>') +
      `<li>${st.emlakTur ? `${st.emlakTur} tur sonunda en zengin (para + mülk + bina) kazanır.` : 'Herkes iflas edene kadar oynanır; son kalan kazanır.'}</li>` +
      '<li>Semtler ucuzdan pahalıya gerçek konut m² fiyatlarına göre dizildi ve fiyatlandı (Emlakjet, Ekim 2026). Bir kareye dokununca tapusunu görürsün.</li></ul>';
  }

  // =============== Oyun sonu ===============
  function overlayHTML(v) {
    const r = v.round, res = r.result, esc = C.esc;
    if (!res) return '';
    const order = res.order;
    let h = `<h2>${esc(res.note)}</h2><p class="sub">${res.why === 'turns' ? 'Servet: para + mülk fiyatı (ipotekliyse yarısı) + binaların maliyeti' : 'Son kalan kazanır'}</p><div class="podium">`;
    order.forEach((s, k) => { h += `<div class="pl${k === 0 ? ' first' : ''}"><span class="ed" style="--pc:${SEAT_COLORS[s]}"></span> ${k + 1}. ${esc(nameOf(v, s))}<b>${r.players[s].bankrupt ? 'iflas' : money(res.worths[s])}</b></div>`; });
    return h + '</div>';
  }

  window.EmlakUI = { render, myMove, rulesHTML, overlayHTML, COLORS: SEAT_COLORS };
})();
