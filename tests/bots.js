'use strict';
/* Deneme için: masaya botlar oturtur, sıraları gelince oynarlar.  node tests/bots.js 3 */
const http = require('http');
const E = require('../public/engine.js');
const PORT = parseInt(process.env.PORT || '8101', 10);
const N = parseInt(process.argv[2] || '3', 10);
const DELAY = parseInt(process.env.BOT_DELAY || '600', 10);

function post(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', () => resolve({ ok: false }));
    req.end(data);
  });
}

function sse(token, onView) {
  http.get({ host: '127.0.0.1', port: PORT, path: '/events?token=' + token }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line && !chunk.startsWith('event: ping')) onView(JSON.parse(line.slice(6)));
      }
    });
  });
}

const names = (process.env.BOT_NAMES ? process.env.BOT_NAMES.split(',') : ['Bot Ayşe', 'Bot Can', 'Bot Deniz']).slice(0, N);
(async () => {
  for (const name of names) {
    const j = await post({ type: 'join', name });
    if (!j.ok) { console.log(name, j.error); continue; }
    const me = { name, token: j.token, busy: false, v: null };
    const tick = () => {
      const v = me.v;
      if (me.busy || !v || v.phase !== 'playing' || !v.round || v.round.turn !== v.me) return;
      me.busy = true;
      setTimeout(async () => {
        const v2 = me.v, r = v2.round;
        try {
          if (v2.phase === 'playing' && r.turn === v2.me) {
            if (r.tphase === 'draw') {
              if (r.stockCount) await post({ type: 'draw', token: me.token });
              else await post({ type: 'endStock', token: me.token });
            } else {
              if (!r.opened[v2.me]) {
                const s = E.suggestMelds(r.hand, r.okey);
                if (s.value >= r.req.runs) await post({ type: 'open', token: me.token, mode: 'runs', melds: s.melds });
              }
              const pick = r.hand.find((id) => !E.isWild(id, r.okey) && !E.isLayable(id, r.melds, r.okey));
              await post({ type: 'discard', token: me.token, tile: pick === undefined ? r.hand[0] : pick });
            }
          }
        } finally {
          me.busy = false;
          setTimeout(tick, 50);
        }
      }, DELAY);
    };
    sse(j.token, (v) => { me.v = v; tick(); });
    console.log(name, 'oturdu');
  }
})();
