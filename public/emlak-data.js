/* İstanbul Emlak tahtası ve kuralların yardımcıları. Hem sunucu (emlak.js) hem telefon arayüzü (emlak-ui.js) kullanır.
   r: oyun durumu ya da görünüm ({ owner, houses, mortgaged, players: [{ money }], bankHouses, bankHotels }). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmlakData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const P = (r, seat) => r.players[seat];
  const JAIL_FINE = 50;
  // ---------- Tahta ----------
  // Semtler ucuzdan pahalıya; m2: ortalama konut satış ilan fiyatı (TL/m²), Emlakjet mahalle ve ilçe verisi,
  // Ekim 2026 (Endeksa Mart 2026 ile karşılaştırıldı). Yaklaşık olanlar (~): birden çok mahallenin ortalaması.
  // Fiyatlar bu oranlara göre hesaplanır: en pahalı semt (Etiler) 400 ₺, diğerleri m² fiyatıyla orantılı.
  // Gruplar hem fiyat hem semt olarak bir arada: Batı ucu, Tarihi Yarımada, Anadolu sahili, Adalar,
  // Bakırköy sahili, Boğaz (Avrupa), Bağdat Caddesi, Zirve.
  const SEMT_KAYNAK = 'Emlakjet konut m² ilan fiyatları, Ekim 2026; Endeksa Mart 2026 ile karşılaştırıldı';
  const SEMTLER = [
    { name: 'Esenyurt', ilce: 'Esenyurt', m2: 35400 },
    { name: 'Beylikdüzü', ilce: 'Beylikdüzü', m2: 51300 },
    { name: 'Kumkapı', ilce: 'Fatih', m2: 52000 }, // ~
    { name: 'Samatya', ilce: 'Fatih', m2: 53800 },
    { name: 'Balat', ilce: 'Fatih', m2: 61200 },
    { name: 'Pendik', ilce: 'Pendik', m2: 72100 },
    { name: 'Kartal', ilce: 'Kartal', m2: 85200 },
    { name: 'Maltepe', ilce: 'Maltepe', m2: 93100 },
    { name: 'Büyükada', ilce: 'Adalar', m2: 120000 }, // ~
    { name: 'Heybeliada', ilce: 'Adalar', m2: 129500 },
    { name: 'Kınalıada', ilce: 'Adalar', m2: 135700 },
    { name: 'Florya', ilce: 'Bakırköy', m2: 152400 },
    { name: 'Ataköy', ilce: 'Bakırköy', m2: 160000 }, // ~
    { name: 'Yeşilköy', ilce: 'Bakırköy', m2: 187500 },
    { name: 'Yeniköy', ilce: 'Sarıyer', m2: 182600 },
    { name: 'Arnavutköy', ilce: 'Beşiktaş', m2: 185500 },
    { name: 'Emirgan', ilce: 'Sarıyer', m2: 210000 },
    { name: 'Suadiye', ilce: 'Kadıköy', m2: 210000 },
    { name: 'Caddebostan', ilce: 'Kadıköy', m2: 245500 },
    { name: 'Fenerbahçe', ilce: 'Kadıköy', m2: 262000 },
    { name: 'Bebek', ilce: 'Beşiktaş', m2: 279700 },
    { name: 'Etiler', ilce: 'Beşiktaş', m2: 331900 },
  ];
  const GROUP_SIZES = [2, 3, 3, 3, 3, 3, 3, 2];
  const GROUPS = [
    { name: 'Batı ucu', color: '#8b5a2b', house: 50 },
    { name: 'Tarihi Yarımada', color: '#8fd3f4', house: 50 },
    { name: 'Anadolu sahili', color: '#d63b8f', house: 100 },
    { name: 'Adalar', color: '#f39a1e', house: 100 },
    { name: 'Bakırköy sahili', color: '#e0322f', house: 150 },
    { name: 'Boğaz', color: '#f4d03f', house: 150 },
    { name: 'Bağdat Caddesi', color: '#1f9d55', house: 200 },
    { name: 'Zirve', color: '#1f4fa8', house: 200 },
  ];
  // Klasik oyunun 22 arsasının fiyat ve kira tabloları (boş arsa, 1-4 ev, otel). Semtin fiyatı farklıysa
  // kiralar aynı oranda büyür/küçülür; böylece oyunun dengesi korunur.
  const SLOT = [
    [60, [2, 10, 30, 90, 160, 250]], [60, [4, 20, 60, 180, 320, 450]],
    [100, [6, 30, 90, 270, 400, 550]], [100, [6, 30, 90, 270, 400, 550]], [120, [8, 40, 100, 300, 450, 600]],
    [140, [10, 50, 150, 450, 625, 750]], [140, [10, 50, 150, 450, 625, 750]], [160, [12, 60, 180, 500, 700, 900]],
    [180, [14, 70, 200, 550, 750, 950]], [180, [14, 70, 200, 550, 750, 950]], [200, [16, 80, 220, 600, 800, 1000]],
    [220, [18, 90, 250, 700, 875, 1050]], [220, [18, 90, 250, 700, 875, 1050]], [240, [20, 100, 300, 750, 925, 1100]],
    [260, [22, 110, 330, 800, 975, 1150]], [260, [22, 110, 330, 800, 975, 1150]], [280, [24, 120, 360, 850, 1025, 1200]],
    [300, [26, 130, 390, 900, 1100, 1275]], [300, [26, 130, 390, 900, 1100, 1275]], [320, [28, 150, 450, 1000, 1200, 1400]],
    [350, [35, 175, 500, 1100, 1300, 1500]], [400, [50, 200, 600, 1400, 1700, 2000]],
  ];
  const STREET_POS = [1, 3, 6, 8, 9, 11, 13, 14, 16, 18, 19, 21, 23, 24, 26, 27, 29, 31, 32, 34, 37, 39];
  const RAILS = [
    { pos: 5, name: 'Sirkeci Garı' }, { pos: 15, name: 'Haydarpaşa Garı' },
    { pos: 25, name: 'Sabiha Gökçen' }, { pos: 35, name: 'İstanbul Havalimanı' },
  ];
  const UTILS = [{ pos: 12, name: 'Elektrik İdaresi', icon: 'elec' }, { pos: 28, name: 'Su İdaresi', icon: 'water' }];
  const RAIL_RENT = [25, 50, 100, 200];
  
  const round10 = (x) => Math.max(10, Math.round(x / 10) * 10);
  const roundRent = (x) => (x < 20 ? Math.max(1, Math.round(x)) : Math.round(x / 5) * 5);
  
  function buildBoard() {
    const b = new Array(40).fill(null);
    b[0] = { type: 'go', name: 'BAŞLA' };
    b[10] = { type: 'jail', name: 'Hapis' };
    b[20] = { type: 'park', name: 'Otopark' };
    b[30] = { type: 'gotojail', name: 'Hapse gir' };
    b[4] = { type: 'tax', name: 'Gelir Vergisi', amount: 200 };
    b[38] = { type: 'tax', name: 'Lüks Vergisi', amount: 100 };
    [2, 17, 33].forEach((p) => { b[p] = { type: 'chest', name: 'Kamu Fonu' }; });
    [7, 22, 36].forEach((p) => { b[p] = { type: 'chance', name: 'Şans' }; });
    RAILS.forEach((r) => { b[r.pos] = { type: 'rail', name: r.name, price: 200, mortgage: 100 }; });
    UTILS.forEach((u) => { b[u.pos] = { type: 'util', name: u.name, icon: u.icon, price: 150, mortgage: 75 }; });
    const maxM2 = Math.max(...SEMTLER.map((x) => x.m2));
    let k = 0;
    GROUP_SIZES.forEach((n, g) => {
      for (let j = 0; j < n; j++, k++) {
        const semt = SEMTLER[k];
        const price = round10((400 * semt.m2) / maxM2);
        const [slotPrice, slotRents] = SLOT[k];
        const rents = slotRents.map((x) => roundRent((x * price) / slotPrice));
        b[STREET_POS[k]] = { type: 'street', name: semt.name, ilce: semt.ilce, m2: semt.m2, group: g, price, rents, house: GROUPS[g].house, mortgage: price / 2 };
      }
    });
    return b;
  }
  const BOARD = buildBoard();
  const OWNABLE = BOARD.map((x, i) => (x && (x.type === 'street' || x.type === 'rail' || x.type === 'util') ? i : -1)).filter((i) => i >= 0);
  const groupMembers = (g) => STREET_POS.filter((p) => BOARD[p].group === g);
  const MOST_EXPENSIVE = 39;
  const RED3 = 24;
  const PINK1 = 11;
  const RAIL1 = 5;
  
  // ---------- Kartlar ----------
  // Etkiler klasik oyunun kartlarıyla aynıdır; metinler İstanbul'a uyarlanmıştır.
  const CHANCE = [
    { text: 'Etiler\'de bir rezidans görmeye gidiyorsun: Etiler\'e ilerle.', act: { t: 'goto', to: MOST_EXPENSIVE } },
    { text: 'BAŞLA\'ya ilerle, 200 ₺ al.', act: { t: 'goto', to: 0 } },
    { text: 'Yeşilköy\'de deniz kenarında ev bakmaya gidiyorsun: Yeşilköy\'e ilerle. BAŞLA\'dan geçersen 200 ₺ al.', act: { t: 'goto', to: RED3 } },
    { text: 'Pendik\'te çay bahçesine davetlisin: Pendik\'e ilerle. BAŞLA\'dan geçersen 200 ₺ al.', act: { t: 'goto', to: PINK1 } },
    { text: 'Treni yakalaman lazım: en yakın istasyona ilerle. Sahibine kiranın iki katını öde; sahipsizse satın alabilirsin.', act: { t: 'nearest', kind: 'rail' } },
    { text: 'Uçağa yetişmen lazım: en yakın istasyona ilerle. Sahibine kiranın iki katını öde; sahipsizse satın alabilirsin.', act: { t: 'nearest', kind: 'rail' } },
    { text: 'Faturayı yatırmaya gidiyorsun: en yakın idareye ilerle. Sahibi varsa zar at, zarın 10 katını öde; sahipsizse satın alabilirsin.', act: { t: 'nearest', kind: 'util' } },
    { text: 'Bankadan temettü geldi: 50 ₺ al.', act: { t: 'money', amount: 50 } },
    { text: 'Hapisten çıkış kartı. Sakla ya da takasla.', act: { t: 'jailcard' } },
    { text: 'Köprü trafiği: 3 kare geri git.', act: { t: 'back', n: 3 } },
    { text: 'Doğruca hapse gir. BAŞLA\'dan geçme, 200 ₺ alma.', act: { t: 'jail' } },
    { text: 'Binalarına deprem güçlendirmesi: her ev için 25 ₺, her otel için 100 ₺ öde.', act: { t: 'repair', house: 25, hotel: 100 } },
    { text: 'Sahil yolunda hız cezası: 15 ₺ öde.', act: { t: 'money', amount: -15 } },
    { text: 'Sirkeci Garı\'ndan trene bineceksin: Sirkeci Garı\'na git. BAŞLA\'dan geçersen 200 ₺ al.', act: { t: 'goto', to: RAIL1 } },
    { text: 'Site yönetim kuruluna başkan seçildin: her oyuncuya 50 ₺ öde.', act: { t: 'each', amount: -50 } },
    { text: 'Konut kredinin vadesi doldu: 150 ₺ al.', act: { t: 'money', amount: 150 } },
  ];
  const CHEST = [
    { text: 'BAŞLA\'ya ilerle, 200 ₺ al.', act: { t: 'goto', to: 0 } },
    { text: 'Banka hesabına yanlışlıkla para yatırdı: 200 ₺ al.', act: { t: 'money', amount: 200 } },
    { text: 'Doktor muayenesi: 50 ₺ öde.', act: { t: 'money', amount: -50 } },
    { text: 'Borsada hisselerini sattın: 50 ₺ al.', act: { t: 'money', amount: 50 } },
    { text: 'Hapisten çıkış kartı. Sakla ya da takasla.', act: { t: 'jailcard' } },
    { text: 'Doğruca hapse gir. BAŞLA\'dan geçme, 200 ₺ alma.', act: { t: 'jail' } },
    { text: 'Tatil birikimin doldu: 100 ₺ al.', act: { t: 'money', amount: 100 } },
    { text: 'Vergi iadesi: 20 ₺ al.', act: { t: 'money', amount: 20 } },
    { text: 'Doğum günün kutlu olsun: her oyuncudan 10 ₺ al.', act: { t: 'each', amount: 10 } },
    { text: 'Hayat sigortası poliçen olgunlaştı: 100 ₺ al.', act: { t: 'money', amount: 100 } },
    { text: 'Hastane masrafı: 100 ₺ öde.', act: { t: 'money', amount: -100 } },
    { text: 'Okul taksiti: 50 ₺ öde.', act: { t: 'money', amount: -50 } },
    { text: 'Danışmanlık ücreti: 25 ₺ al.', act: { t: 'money', amount: 25 } },
    { text: 'Kentsel dönüşüm payı: her ev için 40 ₺, her otel için 115 ₺ öde.', act: { t: 'repair', house: 40, hotel: 115 } },
    { text: 'Mahallenin en güzel balkonu yarışmasında ikinci oldun: 10 ₺ al.', act: { t: 'money', amount: 10 } },
    { text: 'Uzak bir akrabandan miras: 100 ₺ al.', act: { t: 'money', amount: 100 } },
  ];

  function ownsGroup(r, seat, g) {
    return groupMembers(g).every((p) => r.owner[p] === seat);
  }
  function railsOwned(r, seat) {
    return RAILS.filter((x) => r.owner[x.pos] === seat).length;
  }
  function utilsOwned(r, seat) {
    return UTILS.filter((x) => r.owner[x.pos] === seat).length;
  }
  
  // Kira: arsa (grup tamamsa boş arsa 2 kat), istasyon (sayıya göre), idare (zar × 4 ya da × 10)
  function rentFor(r, pos, dice, opt) {
    const sq = BOARD[pos];
    const o = r.owner[pos];
    if (o < 0 || r.mortgaged[pos]) return 0;
    opt = opt || {};
    if (sq.type === 'street') {
      const h = r.houses[pos];
      if (h > 0) return sq.rents[h];
      return ownsGroup(r, o, sq.group) ? sq.rents[0] * 2 : sq.rents[0];
    }
    if (sq.type === 'rail') {
      const rent = RAIL_RENT[railsOwned(r, o) - 1];
      return opt.double ? rent * 2 : rent;
    }
    if (sq.type === 'util') {
      const mult = opt.util10 || utilsOwned(r, o) === 2 ? 10 : 4;
      return mult * dice;
    }
    return 0;
  }
  
  // Net servet: para + mülk (ipotekliyse ipotek değeri) + binalar (maliyet)
  function worth(r, seat) {
    let w = P(r, seat).money;
    OWNABLE.forEach((p) => {
      if (r.owner[p] !== seat) return;
      const sq = BOARD[p];
      w += r.mortgaged[p] ? sq.mortgage : sq.price;
      if (sq.type === 'street') w += r.houses[p] * sq.house;
    });
    return w;
  }
  // Satarak/ipotekleyerek toplanabilecek en çok para (iflas kontrolü)
  function liquidity(r, seat) {
    let w = P(r, seat).money;
    OWNABLE.forEach((p) => {
      if (r.owner[p] !== seat) return;
      const sq = BOARD[p];
      if (sq.type === 'street') w += (r.houses[p] * sq.house) / 2;
      if (!r.mortgaged[p]) w += sq.mortgage;
    });
    return w;
  }

  function canBuild(r, seat, pos) {
    const sq = BOARD[pos];
    if (!sq || sq.type !== 'street') return 'Buraya bina yapılmaz.';
    if (r.owner[pos] !== seat) return 'Bu arsa senin değil.';
    if (!ownsGroup(r, seat, sq.group)) return 'Ev kurmak için grubun bütün arsaları senin olmalı.';
    const g = groupMembers(sq.group);
    if (g.some((q) => r.mortgaged[q])) return 'Gruptaki ipotekli arsayı önce kurtar.';
    const h = r.houses[pos];
    if (h >= 5) return 'Burada zaten otel var.';
    if (g.some((q) => r.houses[q] < h)) return 'Evleri eşit kurmalısın: önce gruptaki diğer arsalara.';
    if (h === 4 && r.bankHotels < 1) return 'Bankada otel kalmadı.';
    if (h < 4 && r.bankHouses < 1) return 'Bankada ev kalmadı.';
    if (P(r, seat).money < sq.house) return `Paran yetmiyor (${sq.house} ₺).`;
    return null;
  }
  function canSell(r, seat, pos) {
    const sq = BOARD[pos];
    if (!sq || sq.type !== 'street' || r.owner[pos] !== seat) return 'Bu arsa senin değil.';
    const h = r.houses[pos];
    if (h < 1) return 'Burada bina yok.';
    const g = groupMembers(sq.group);
    if (g.some((q) => r.houses[q] > h)) return 'Evleri eşit satmalısın: önce gruptaki diğer arsalardan.';
    return null;
  }
  function canMortgage(r, seat, pos) {
    const sq = BOARD[pos];
    if (!sq || r.owner[pos] !== seat) return 'Bu mülk senin değil.';
    if (r.mortgaged[pos]) return 'Zaten ipotekli.';
    if (sq.type === 'street' && groupMembers(sq.group).some((q) => r.houses[q] > 0)) return 'Önce bu gruptaki binaları sat.';
    return null;
  }
  const unmortgageCost = (pos) => Math.ceil(BOARD[pos].mortgage * 1.1);
  function canUnmortgage(r, seat, pos) {
    if (r.owner[pos] !== seat || !r.mortgaged[pos]) return 'İpotekli bir mülkün değil.';
    if (P(r, seat).money < unmortgageCost(pos)) return `Paran yetmiyor (${unmortgageCost(pos)} ₺).`;
    return null;
  }

  return {
    BOARD, GROUPS, SEMTLER, SEMT_KAYNAK, CHANCE, CHEST, OWNABLE, STREET_POS, RAILS, UTILS, RAIL_RENT,
    MOST_EXPENSIVE, RED3, PINK1, RAIL1, JAIL_FINE,
    groupMembers, ownsGroup, railsOwned, utilsOwned, rentFor, worth, liquidity,
    canBuild, canSell, canMortgage, canUnmortgage, unmortgageCost,
  };
});
