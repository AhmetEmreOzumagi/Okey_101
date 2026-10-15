/* Türkçe özel isim ekleri (ünlü uyumu ve sertleşmeyle): Dil.ek('Esenyurt', 'i') → "Esenyurt'u".
   Hem sunucu (Node) hem telefon (tarayıcı) kullanır. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dil = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VOW = 'aıoueiöüâîûAIOUEİÖÜÂÎÛ', BACK = 'aıouâûAIOUÂÛ', ROUND = 'ouöüûOUÖÜÛ', HARD = 'fstkçşhpFSTKÇŞHP';
  function info(w) {
    w = String(w || '').trim();
    var lv = '';
    for (var i = w.length - 1; i >= 0; i--) if (VOW.indexOf(w[i]) >= 0) { lv = w[i]; break; }
    var last = w.charAt(w.length - 1);
    // Rakamla biten isimler (Bot 2) için okunuşa göre yaklaşık
    // sıfır, bir, iki, üç, dört, beş, altı, yedi, sekiz, dokuz: [son ünlü, son harf]
    if (/[0-9]$/.test(w)) { var d = { 0: 'ır', 1: 'ir', 2: 'ii', 3: 'üç', 4: 'öt', 5: 'eş', 6: 'ıı', 7: 'ii', 8: 'iz', 9: 'uz' }[last]; lv = d[0]; last = d[1]; }
    return { back: !lv || BACK.indexOf(lv) >= 0, round: ROUND.indexOf(lv) >= 0, vowel: VOW.indexOf(last) >= 0, hard: HARD.indexOf(last) >= 0 };
  }
  // kind: 'i' (belirtme: Esenyurt'u), 'e' (yönelme: Etiler'e), 'de' (bulunma: Pendik'te), 'den' (ayrılma), 'in' (ilgi: Ayşe'nin)
  // Tamlama (iyelik ekli) adlar: Sirkeci Garı, Elektrik İdaresi, İstanbul Havalimanı → araya "n" girer (Garı'nı, Garı'na)
  var TAMLAMA = /(\s|^)(Garı|İdaresi|Havalimanı|Vergisi|Fonu)$/;
  function suffix(w, kind) {
    var x = info(w), i4 = x.back ? (x.round ? 'u' : 'ı') : (x.round ? 'ü' : 'i'), a2 = x.back ? 'a' : 'e';
    if (TAMLAMA.test(String(w).trim())) {
      switch (kind) {
        case 'i': return 'n' + i4;
        case 'e': return 'n' + a2;
        case 'de': return 'nd' + a2;
        case 'den': return 'nd' + a2 + 'n';
        case 'in': return 'n' + i4 + 'n';
        default: return '';
      }
    }
    switch (kind) {
      case 'i': return (x.vowel ? 'y' : '') + i4;
      case 'e': return (x.vowel ? 'y' : '') + a2;
      case 'de': return (x.hard ? 't' : 'd') + a2;
      case 'den': return (x.hard ? 't' : 'd') + a2 + 'n';
      case 'in': return (x.vowel ? 'n' : '') + i4 + 'n';
      default: return '';
    }
  }
  function ek(w, kind) { return String(w) + "'" + suffix(w, kind); }
  return { ek: ek, suffix: suffix };
});
