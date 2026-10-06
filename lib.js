'use strict';
/* Bütün oyunların ortak yardımcıları (okey, pişti, renk). */
const crypto = require('crypto');

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const newToken = () => crypto.randomBytes(12).toString('hex');
const randomInt = (n) => crypto.randomInt(n);

function addLog(s, text) {
  s.log.push({ t: Date.now(), text });
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}
const nameOf = (s, i) => (s.seats[i] ? s.seats[i].name : 'Koltuk ' + (i + 1));

// Hamle süresi (ayarlarda 0 ise süresiz)
function startClock(s) {
  const r = s.round;
  if (!r) return;
  const secs = s.settings.turnSecs | 0;
  r.deadline = secs > 0 && s.phase === 'playing' ? Date.now() + secs * 1000 : 0;
}

// Oyundaki koltuklar arasında sıradaki (yön: +1 sağdaki, -1 soldaki)
function nextSeat(active, seat, dir) {
  const d = dir === -1 ? 3 : 1;
  for (let k = 1; k <= 4; k++) {
    const t = (seat + d * k) % 4;
    if (active[t]) return t;
  }
  return seat;
}

module.exports = { GameError, fail, shuffle, newToken, randomInt, addLog, nameOf, startClock, nextSeat };
