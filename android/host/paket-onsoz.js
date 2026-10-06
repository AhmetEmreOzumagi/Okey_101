/* host.js'in başı. Node'un require() düzeninin küçük bir benzeri: her oyun dosyası bir modül
   olarak sarılır, require('./game.js') gibi çağrılar dosya adına göre çözülür. Node'un crypto
   modülü yerine tarayıcının crypto.getRandomValues'ı kullanan küçük bir yedek var. */
(function () {
  var __tanimlar = {};
  var __onbellek = {};
  function __modul(ad, fn) { __tanimlar[ad] = fn; }
  function require(yol) {
    var ad = String(yol).split('/').pop();
    var m = __onbellek[ad];
    if (m) return m.exports;
    var fn = __tanimlar[ad];
    if (!fn) throw new Error('Modül bulunamadı: ' + yol);
    m = { exports: {} };
    __onbellek[ad] = m;
    fn(m, m.exports, require);
    return m.exports;
  }

  __modul('crypto', function (module) {
    'use strict';
    var c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (!c) throw new Error('crypto.getRandomValues yok');
    var tek = new Uint32Array(1);
    function u32() { c.getRandomValues(tek); return tek[0]; }
    // crypto.randomInt(n) ya da randomInt(min, max): [min, max) arasında eşit dağılımlı tam sayı
    function randomInt(min, max) {
      if (max === undefined) { max = min; min = 0; }
      var aralik = max - min;
      if (!(aralik > 0) || aralik > 4294967296) throw new RangeError('Geçersiz aralık');
      var sinir = 4294967296 - (4294967296 % aralik); // eşit dağılım için reddetme yöntemi
      var x;
      do { x = u32(); } while (x >= sinir);
      return min + (x % aralik);
    }
    // crypto.randomBytes(n).toString('hex')
    function randomBytes(n) {
      var u = new Uint8Array(n);
      c.getRandomValues(u);
      return {
        length: n,
        toString: function () {
          var s = '';
          for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
          return s;
        },
      };
    }
    module.exports = { randomInt: randomInt, randomBytes: randomBytes, getRandomValues: function (a) { return c.getRandomValues(a); } };
  });
