/* NEXUS AI · stage-phone.js — «Телефон судьи»: судья сканирует QR и становится Ерланом, сыном Сауле Д.
   На шаге 4 запрос «Близкие» приходит на его настоящий телефон (вибрация + звук), ответ возвращается на сцену.
   Связь — NX.Relay (api/relay.php на хостинге, иначе ntfy.sh). Если телефон не подключён, сцена работает как раньше.
   Хуки в stage.js: NX.StagePhone.request / answered / reset / connected; ответ — NX.StageApi.trustAnswer. */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});
  if (!NX.Relay) return;
  const esc = NX.esc || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  let room = '';
  try { room = sessionStorage.getItem('nexus_ai_phone_room') || ''; } catch (e) { /* ignore */ }
  if (!/^[a-z0-9]{6,24}$/.test(room)) { room = NX.Relay.newRoom(); try { sessionStorage.setItem('nexus_ai_phone_room', room); } catch (e) { /* ignore */ } }

  const P = { joined: false, lastSeen: 0, pending: null, reqSeq: 0 };
  let R = null;
  function relay() {
    if (!R) {
      R = NX.Relay.join(room, 'stage');
      R.on(onMsg);
      R.send({ type: 'ping' });
    }
    return R;
  }
  const phoneUrl = () => new URL('phone.html?room=' + room, location.href).href;

  function onMsg(m) {
    if (!m || !m.type) return;
    if (m.type === 'hello') {
      const first = !P.joined;
      P.joined = true; P.lastSeen = Date.now(); paint();
      if (first && box && !box.hidden) setTimeout(closeBox, 1200); // телефон подключён — окно с QR больше не нужно
      if (first && window.NX && NX.toast) NX.toast('Телефон судьи подключён', 'Запрос «Близкие» на шаге 4 придёт на этот телефон', 'ok', 'phone');
      if (P.pending) R.send(P.pending); // телефон подключился после запроса — отправляем ещё раз
    } else if (m.type === 'answer') {
      P.lastSeen = Date.now();
      if (P.pending && m.req === P.pending.req && NX.StageApi && NX.StageApi.trustPending()) {
        P.pending = null;
        NX.StageApi.trustAnswer(m.v === 'ok' ? 'ok' : 'check', 'судья с телефона');
      }
    }
  }

  // ---- кнопка в шапке и окно с QR ----
  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '';
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), b = 2, s = 8, N = (n + 2 * b) * s;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += 'M' + (x + b) * s + ' ' + (y + b) * s + 'h' + s + 'v' + s + 'h-' + s + 'z';
    return '<svg viewBox="0 0 ' + N + ' ' + N + '" width="260" height="260" role="img" aria-label="QR-код: телефон судьи"><rect width="' + N + '" height="' + N + '" fill="#FBFBF8"/><path fill="#0A0F1C" d="' + d + '"/></svg>';
  }
  let btn = null, box = null;
  function paint() {
    if (btn) {
      btn.classList.toggle('on', P.joined);
      btn.querySelector('.t').textContent = P.joined ? 'Телефон судьи ✓' : 'Телефон судьи';
      btn.title = P.joined ? 'Телефон судьи подключён' : 'Подключить телефон судьи по QR';
    }
    if (box) {
      const st = box.querySelector('.sp-st');
      if (st) st.innerHTML = P.joined ? '<b style="color:var(--ok)">Подключён.</b> Судья — Ерлан, сын Сауле Д. На шаге 4 запрос придёт ему на телефон.' : 'Ждём подключения… Связь: ' + esc(R ? ({ php: 'сервер сайта', ntfy: 'ntfy.sh', connecting: 'подключаемся', offline: 'нет' }[R.mode] || R.mode) : '—');
    }
  }
  function openBox() {
    relay();
    if (!box) {
      box = document.createElement('div');
      box.className = 'sp-modal';
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Телефон судьи');
      box.innerHTML = '<div class="sp-card"><button type="button" class="sp-x" aria-label="Закрыть">×</button>' +
        '<h3>Станьте участником демо</h3>' +
        '<p>Отсканируйте QR телефоном. Вы станете <b>Ерланом, сыном Сауле-апа</b>. Когда ей позвонит мошенник, решать будете вы — на своём телефоне.</p>' +
        '<div class="sp-qr">' + qrSvg(phoneUrl()) + '</div>' +
        '<p class="sp-url">' + esc(phoneUrl()) + '</p>' +
        '<p class="sp-st"></p></div>';
      document.body.appendChild(box);
      box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('.sp-x')) closeBox(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box && !box.hidden) closeBox(); });
    }
    box.hidden = false; paint();
    const x = box.querySelector('.sp-x'); if (x) x.focus();
  }
  function closeBox() { if (box) box.hidden = true; if (btn) btn.focus(); }
  function mount() {
    const tools = document.querySelector('.st-tools');
    if (!tools || btn) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'st-tool st-phone-btn'; btn.id = 'btnPhone';
    btn.innerHTML = '<span class="k" aria-hidden="true">QR</span><span class="t">Телефон судьи</span>';
    btn.addEventListener('click', openBox);
    tools.insertBefore(btn, tools.firstChild);
    const css = document.createElement('style');
    css.textContent = '.st-phone-btn.on{border-color:var(--ok);color:var(--ok)}' +
      '.sp-modal{position:fixed;inset:0;background:rgba(5,7,13,.78);display:grid;place-items:center;z-index:1000;padding:16px}' +
      '.sp-modal[hidden]{display:none}' +
      '.sp-card{position:relative;background:var(--panel);border:1px solid var(--line2);border-radius:20px;padding:28px;max-width:440px;width:100%;max-height:calc(100vh - 32px);overflow:auto;text-align:center;display:flex;flex-direction:column;gap:12px}' +
      '.sp-qr svg{width:min(260px,42vh);height:auto}' +
      '.sp-card h3{margin:0;font-family:var(--display,Unbounded),Arial,sans-serif;font-size:22px}' +
      '.sp-card p{margin:0;color:var(--muted);font-size:15px;line-height:1.5}' +
      '.sp-qr{display:grid;place-items:center}.sp-qr svg{border-radius:12px;max-width:100%;height:auto}' +
      '.sp-url{font-family:var(--mono,monospace);font-size:12px!important;word-break:break-all}' +
      '.sp-x{position:absolute;top:10px;right:10px;width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);color:var(--text);font-size:22px;cursor:pointer}';
    document.head.appendChild(css);
    paint();
  }

  NX.StagePhone = {
    room: () => room,
    url: phoneUrl,
    connected: () => P.joined,
    open: openBox,
    request(o) {
      if (!P.joined) return;
      P.reqSeq++;
      P.pending = { type: 'request', req: room + '-' + P.reqSeq, amountText: (o && o.amountText) || '' };
      relay().send(P.pending);
    },
    answered(v, by) {
      if (by === 'судья с телефона') { relay().send({ type: 'saved', text: v === 'check' ? 'Вы остановили перевод. Деньги мамы на её счёте — на экране сцены это видно.' : 'Ответ принят. Решение остаётся за банком.' }); return; }
      if (P.pending) { relay().send({ type: 'answered', text: 'На сцене ответили раньше (' + by + '). Перевод остаётся удержанным.' }); P.pending = null; }
    },
    reset() { P.pending = null; if (R) R.send({ type: 'reset' }); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  // связь поднимаем сразу: телефон может подключиться, пока ведущий рассказывает вступление
  relay();
  setInterval(paint, 1500);
})();
