/* Küçük QR kod üretici (bayt modu, M düzeltme seviyesi, sürüm 1-10). İnternetsiz çalışır. */
(function (root) {
  'use strict';
  // [düzey M] blok başına hata düzeltme kod sözcüğü ve blok sayısı, sürüm 0..10
  var ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var FORMAT_M = 0; // M seviyesinin format bitleri

  function numRawDataModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function numDataCodewords(ver) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  function rsMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = rsMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function (coef, i) { result[i] ^= rsMul(coef, factor); });
    });
    return result;
  }

  function utf8(str) {
    var out = [];
    var s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function encode(text) {
    var data = utf8(text);
    var ver;
    for (ver = 1; ver <= 10; ver++) {
      var ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + data.length * 8 <= numDataCodewords(ver) * 8) break;
    }
    if (ver > 10) throw new Error('Metin QR için çok uzun');
    var size = ver * 4 + 17;
    var cap = numDataCodewords(ver) * 8;

    // bit dizisi
    var bits = [];
    var push = function (val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);
    push(data.length, ver <= 9 ? 8 : 16);
    data.forEach(function (b) { push(b, 8); });
    push(0, Math.min(4, cap - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
      codewords.push(v);
    }

    // hata düzeltme ve harmanlama
    var numBlocks = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
    var rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    var numShort = numBlocks - (rawCodewords % numBlocks);
    var shortLen = Math.floor(rawCodewords / numBlocks);
    var blocks = [], div = rsDivisor(eccLen), pos = 0;
    for (i = 0; i < numBlocks; i++) {
      var dat = codewords.slice(pos, pos + shortLen - eccLen + (i < numShort ? 0 : 1));
      pos += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i !== shortLen - eccLen || j >= numShort) all.push(blocks[j][i]);
      }
    }

    // matris
    var mod = [], fn = [];
    for (i = 0; i < size; i++) {
      mod.push(new Array(size).fill(false));
      fn.push(new Array(size).fill(false));
    }
    var set = function (x, y, dark) { mod[y][x] = dark; fn[y][x] = true; };

    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    var finder = function (cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, d !== 2 && d !== 4);
        }
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    var align = [];
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2;
      var step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      align = [6];
      for (var p = size - 7; align.length < na; p -= step) align.splice(1, 0, p);
      for (i = 0; i < na; i++) for (j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) {
          set(align[i] + ax, align[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
        }
      }
    }

    var drawFormat = function (mask) {
      var d = (FORMAT_M << 3) | mask, rem = d;
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var b = ((d << 10) | rem) ^ 0x5412;
      var bit = function (n) { return ((b >>> n) & 1) !== 0; };
      for (var t = 0; t <= 5; t++) set(8, t, bit(t));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (t = 9; t < 15; t++) set(14 - t, 8, bit(t));
      for (t = 0; t < 8; t++) set(size - 1 - t, 8, bit(t));
      for (t = 8; t < 15; t++) set(8, size - 15 + t, bit(t));
      set(8, size - 8, true);
    };
    drawFormat(0);

    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var vb = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bt = ((vb >>> i) & 1) !== 0;
        var a = size - 11 + (i % 3), bb = Math.floor(i / 3);
        set(a, bb, bt); set(bb, a, bt);
      }
    }

    // veri yerleştirme (zikzak)
    var idx = 0, total = all.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && idx < total) {
            mod[y][x] = ((all[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0;
            idx++;
          }
        }
      }
    }

    var maskFn = [
      function (x, y) { return (x + y) % 2 === 0; },
      function (x, y) { return y % 2 === 0; },
      function (x) { return x % 3 === 0; },
      function (x, y) { return (x + y) % 3 === 0; },
      function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
      function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
      function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
    ];
    var applyMask = function (m) {
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
        if (!fn[yy][xx] && maskFn[m](xx, yy)) mod[yy][xx] = !mod[yy][xx];
      }
    };
    var penalty = function () {
      var s = 0, yy, xx, run, c;
      for (yy = 0; yy < size; yy++) {
        run = 1;
        for (xx = 1; xx < size; xx++) {
          if (mod[yy][xx] === mod[yy][xx - 1]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1;
        }
      }
      for (xx = 0; xx < size; xx++) {
        run = 1;
        for (yy = 1; yy < size; yy++) {
          if (mod[yy][xx] === mod[yy - 1][xx]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1;
        }
      }
      for (yy = 0; yy < size - 1; yy++) for (xx = 0; xx < size - 1; xx++) {
        c = mod[yy][xx];
        if (c === mod[yy][xx + 1] && c === mod[yy + 1][xx] && c === mod[yy + 1][xx + 1]) s += 3;
      }
      var dark = 0;
      for (yy = 0; yy < size; yy++) for (xx = 0; xx < size; xx++) if (mod[yy][xx]) dark++;
      var tot = size * size;
      s += (Math.ceil(Math.abs(dark * 20 - tot * 10) / tot) - 1) * 10;
      return s;
    };
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var sc = penalty();
      if (sc < bestScore) { bestScore = sc; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return mod;
  }

  function svg(text) {
    var m = encode(text), n = m.length, q = 4, path = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) path += 'M' + (x + q) + ',' + (y + q) + 'h1v1h-1z';
    var s = n + q * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  var api = { encode: encode, svg: svg };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QR = api;
})(typeof self !== 'undefined' ? self : this);
