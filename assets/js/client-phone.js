/* NEXUS AI · client-phone.js — «Близкие» на настоящем телефоне в кабинете клиента.
   В «Правила → Близкие» кнопка «Подключить телефон (QR)». Каждый новый запрос на проверку
   (удержанный перевод, звонок мошенника) уходит на телефон; ответ с телефона = кнопка в кабинете.
   Связь — NX.Relay (api/relay.php, иначе ntfy.sh). Данные синтетические, реквизиты на телефон не уходят. */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});
  if (!NX.Relay || new URLSearchParams(location.search).get('embed') === '1') return; // на сцене телефон подключает сама сцена
  const esc = NX.esc || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  let room = '';
  try { room = localStorage.getItem('nexus_ai_client_phone_room') || ''; } catch (e) { /* ignore */ }
  if (!/^[a-z0-9]{6,24}$/.test(room)) { room = NX.Relay.newRoom(); try { localStorage.setItem('nexus_ai_client_phone_room', room); } catch (e) { /* ignore */ } }
  const P = { joined: false, sent: {}, open: {} };
  let R = null;
  const who = () => (NX.ClientTC && NX.ClientTC.persona && NX.ClientTC.persona() === 'mom') ? 'aigerim' : 'aigerim';
  const url = () => new URL('phone.html?room=' + room + '&who=' + who(), location.href).href;

  function relay() {
    if (R) return R;
    R = NX.Relay.join(room, 'stage');
    R.on((m) => {
      if (!m || !m.type) return;
      if (m.type === 'hello') {
        const first = !P.joined; P.joined = true; paint();
        if (first && box && !box.hidden) setTimeout(() => { box.hidden = true; }, 1200); // окно с QR закрывается само
        if (first && NX.toast) NX.toast('Телефон подключён', 'Запросы «Близкие» теперь приходят на телефон', 'ok', 'users');
        Object.keys(P.open).forEach((id) => R.send(P.open[id])); // отправить ещё раз то, что ждёт ответа
      } else if (m.type === 'answer' && m.req && P.open[m.req] && NX.ClientTC) {
        delete P.open[m.req];
        NX.ClientTC.decide(m.req, m.v === 'ok' ? 'approve' : 'reject');
        R.send({ type: 'saved', text: m.v === 'ok' ? 'Ответ принят. При признаках мошенничества банк всё равно проверит операцию.' : 'Перевод удержан: деньги остаются на счёте. Банк проверит получателя.' });
      }
    });
    R.send({ type: 'ping' });
    return R;
  }
  // следим за списком запросов: новый ожидающий → на телефон; решённый в кабинете → «ответ уже дан»
  function tick() {
    if (!NX.ClientTC || !R) return;
    let list = [];
    try { list = NX.ClientTC.list(); } catch (e) { return; }
    list.forEach((it) => {
      if (it.status === 'pending' && it.isTx && !P.sent[it.id]) {
        P.sent[it.id] = 1;
        P.open[it.id] = { type: 'request', req: it.id, amountText: it.amountText ? '≈ ' + it.amountText.replace(/^≈\s*/, '') : '', ward: it.ward };
        if (P.joined) R.send(P.open[it.id]);
      } else if (it.status !== 'pending' && P.open[it.id]) {
        delete P.open[it.id];
        R.send({ type: 'answered', text: 'В кабинете уже ответили. Перевод ' + (it.status === 'reject' ? 'удержан.' : 'под проверкой банка.') });
      }
    });
  }

  // ---- карточка в «Близких» и окно с QR ----
  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '';
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), b = 2, s = 8, N = (n + 2 * b) * s;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += 'M' + (x + b) * s + ' ' + (y + b) * s + 'h' + s + 'v' + s + 'h-' + s + 'z';
    return '<svg viewBox="0 0 ' + N + ' ' + N + '" role="img" aria-label="QR-код: телефон близкого"><rect width="' + N + '" height="' + N + '" fill="#FBFBF8"/><path fill="#0A0F1C" d="' + d + '"/></svg>';
  }
  let card = null, box = null;
  function paint() {
    if (card) {
      const st = card.querySelector('.cp-st');
      if (st) st.innerHTML = P.joined ? '<span class="badge ok">подключён</span> Запросы на проверку придут на телефон' : 'Телефон не подключён';
      const b = card.querySelector('.cp-btn'); if (b) b.textContent = P.joined ? 'Показать QR ещё раз' : 'Подключить телефон (QR)';
    }
    if (box && !box.hidden) {
      const st = box.querySelector('.sp-st');
      if (st) st.innerHTML = P.joined ? '<b style="color:var(--ok)">Подключён.</b> Нажмите «Демо: маме звонит мошенник» — запрос придёт на телефон.' : 'Ждём подключения… Связь: ' + esc(R ? ({ php: 'сервер сайта', ntfy: 'ntfy.sh', connecting: 'подключаемся', offline: 'нет' }[R.mode] || R.mode) : '—');
    }
  }
  function openBox() {
    relay();
    if (!box) {
      box = document.createElement('div');
      box.className = 'sp-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Телефон близкого');
      box.innerHTML = '<div class="sp-card"><button type="button" class="sp-x" aria-label="Закрыть">×</button>' +
        '<h3>Телефон близкого</h3>' +
        '<p>Отсканируйте QR телефоном. Когда маме позвонит мошенник и она начнёт перевод, запрос на проверку придёт на этот телефон — с вибрацией и звуком.</p>' +
        '<div class="sp-qr">' + qrSvg(url()) + '</div><p class="sp-url">' + esc(url()) + '</p><p class="sp-st"></p></div>';
      document.body.appendChild(box);
      box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('.sp-x')) box.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box) box.hidden = true; });
    }
    box.hidden = false; paint();
  }
  function mount() {
    const anchor = document.querySelector('#view-family .tc-card');
    if (!anchor || card) return;
    card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-h"><h3>Телефон близкого</h3><button class="btn sm cp-btn" type="button">Подключить телефон (QR)</button></div><p class="small muted cp-st"></p>';
    anchor.insertAdjacentElement('afterend', card);
    card.querySelector('.cp-btn').addEventListener('click', openBox);
    const css = document.createElement('style');
    css.textContent = '.sp-modal{position:fixed;inset:0;background:rgba(5,7,13,.78);display:grid;place-items:center;z-index:1000;padding:16px}.sp-modal[hidden]{display:none}' +
      '.sp-card{position:relative;background:var(--panel);border:1px solid var(--line2);border-radius:20px;padding:28px;max-width:420px;width:100%;max-height:calc(100vh - 32px);overflow:auto;text-align:center;display:flex;flex-direction:column;gap:12px}' +
      '.sp-card h3{margin:0;font-size:20px}.sp-card p{margin:0;color:var(--muted);font-size:15px;line-height:1.5}' +
      '.sp-qr{display:grid;place-items:center}.sp-qr svg{width:min(240px,42vh);height:auto;border-radius:12px}' +
      '.sp-url{font-family:var(--mono,monospace);font-size:12px!important;word-break:break-all}' +
      '.sp-x{position:absolute;top:10px;right:10px;width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);color:var(--text);font-size:22px;cursor:pointer}';
    document.head.appendChild(css);
    paint();
  }
  function start() { mount(); relay(); setInterval(() => { tick(); paint(); }, 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
