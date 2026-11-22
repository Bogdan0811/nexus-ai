/* NEXUS AI · relay.js — связь между сценой и телефоном судьи (разные устройства).
   BroadcastChannel работает только внутри одного браузера, поэтому для телефона нужен посредник:
   1) свой сервер: api/relay.php (PHP на хостинге) — опрос раз в секунду;
   2) запасной вариант: публичный канал ntfy.sh со случайным именем комнаты (только события демо, без данных людей).
   API:
     const r = NX.Relay.join(room, me)   // me: 'stage' | 'phone'
     r.send(obj)                          // отправить другой стороне
     r.on(fn)                             // fn(obj) — сообщения другой стороны
     r.mode                               // 'php' | 'ntfy' | 'connecting' | 'offline'
     r.close()
     NX.Relay.newRoom() → случайный id из 10 символов */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});
  const NTFY = 'https://ntfy.sh/';

  function newRoom() {
    const a = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    try { const b = new Uint8Array(10); crypto.getRandomValues(b); b.forEach((x) => { s += a[x % a.length]; }); }
    catch (e) { for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)]; }
    return s;
  }
  let phpOk = null;
  function probePhp() {
    if (phpOk !== null) return Promise.resolve(phpOk);
    return fetch('api/relay.php?ping=1', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null).then((j) => (phpOk = !!(j && j.relay)))
      .catch(() => (phpOk = false));
  }

  function join(room, me) {
    const other = me === 'stage' ? 'phone' : 'stage';
    const subs = [];
    const R = { mode: 'connecting', room, me, closed: false };
    const emit = (m) => { subs.forEach((fn) => { try { fn(m); } catch (e) { console.error('[relay]', e); } }); };
    let since = 0, timer = null, es = null, queue = [];
    const seen = new Set();
    const deliver = (m) => { if (!m || typeof m !== 'object') return; const id = m._id; if (id) { if (seen.has(id)) return; seen.add(id); } emit(m); };

    R.on = (fn) => { subs.push(fn); return R; };
    R.send = (obj) => {
      const m = Object.assign({ _id: newRoom(), _t: Date.now(), _from: me }, obj);
      if (R.mode === 'connecting') { queue.push(m); return; }
      post(m);
    };
    function post(m) {
      if (R.mode === 'php') {
        fetch('api/relay.php?room=' + room + '&ch=' + other, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {});
      } else if (R.mode === 'ntfy') {
        fetch(NTFY + 'nexusai-' + room + '-' + other, { method: 'POST', body: JSON.stringify(m) }).catch(() => {});
      }
    }
    function pollPhp() {
      if (R.closed) return;
      fetch('api/relay.php?room=' + room + '&ch=' + me + '&since=' + since, { cache: 'no-store' })
        .then((r) => r.json()).then((j) => {
          if (j && j.ok) { (j.msgs || []).forEach((x) => deliver(x.data)); since = Math.max(since, j.seq || 0); }
        }).catch(() => {}).then(() => { if (!R.closed) timer = setTimeout(pollPhp, 1000); });
    }
    function startNtfy() {
      try {
        es = new EventSource(NTFY + 'nexusai-' + room + '-' + me + '/sse');
        es.onmessage = (ev) => {
          try { const j = JSON.parse(ev.data); if (j && j.event === 'message' && j.message) deliver(JSON.parse(j.message)); } catch (e) { /* чужой формат — пропускаем */ }
        };
        es.onerror = () => { /* EventSource переподключается сам */ };
      } catch (e) { R.mode = 'offline'; }
    }
    probePhp().then((ok) => {
      if (R.closed) return;
      if (ok) {
        R.mode = 'php';
        // на сервере уже могли лежать старые сообщения: начинаем с текущего номера
        fetch('api/relay.php?room=' + room + '&ch=' + me + '&since=999999999', { cache: 'no-store' })
          .then((r) => r.json()).then((j) => { since = (j && j.seq) || 0; }).catch(() => {}).then(pollPhp);
      } else if (typeof EventSource === 'function') { R.mode = 'ntfy'; startNtfy(); }
      else R.mode = 'offline';
      const q = queue; queue = []; q.forEach(post);
    });
    R.close = () => { R.closed = true; clearTimeout(timer); if (es) { try { es.close(); } catch (e) { /* ignore */ } } };
    return R;
  }

  NX.Relay = { join, newRoom };
})();
