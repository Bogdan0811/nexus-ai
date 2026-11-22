/* =====================================================================
   NEXUS AI — «Кредитный замок» (NX.CreditLock), spec v4 · 1B
   Один переключатель — и на клиента нельзя оформить кредит. Мошенник с чужим кодом из SMS подаёт
   заявки, NEXUS их замораживает и показывает банку, откуда идёт атака.

   Клиент (client.html, «Правила → Кредиты», #view-credit):
   - переключатель «Выключен | Только с моего телефона | Полный запрет»; включить — сразу,
     ослабить — только через 24 ч и никогда во время звонка (локальный таймер, ссылка «демо: снять сразу»;
     звонок — NX.Constitution.isCallActive() и активная «Защита звонка»)
   - «Демо: на меня пытаются оформить кредит»: 3 заявки вымышленных МФО за «4 минуты» (в демо ~6 с)
     с нового устройства в другом городе, выдача — на чужой вымышленный IBAN KZ00 9999 …
   - замок включён → «Заморожено замком»; выключен → «Удержаны для проверки» и кнопка «Включить замок»
   - пуш и окно «Это вы оформляете заём …?»: «Нет, это не я» → заявки отклонены, IBAN — в стоп-лист
   Банк (bank.html): инцидент kind 'credit_lock', узел графа «Устройство-фабрика заявок» (role factory)
   с рёбрами к клиенту и 5 синтетическим клиентам, ребро к счёту выдачи; плитка на «Сейчас» (bank.js).
   Шина (всегда synthetic:true): credit_lock_change, credit_lock_attempt, credit_lock_response.
   Стоп-лист: NX.iocs.add([{kind:'iban', …}], 'Кредитный замок', {session:'cl:'+batchId, client, device}).
   Корреляция — только существующим путём графа банка (bank.js handleIocs → синтетическая история,
   сигнал 'graph' с synthetic:true и пометкой «история сгенерирована»). Новых видов реквизитов нет.
   Хранилище: nexus_ai_creditlock_v1 (сброс демо его очищает). Заявки, МФО и устройство вымышленные.
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  if (!NX || !NX.bus) return;

  const esc = (v) => NX.esc(v);
  const ic = (n, s) => (NX.icon ? NX.icon(n, '', s || 16) : '');
  const $ = (s, r) => (r || document).querySelector(s);
  const PAGE = () => NX.page || '';
  const KEY = 'nexus_ai_creditlock_v1';
  const SIG_KEY = 'nexus_ai_creditlock_signal'; // sessionStorage: был ли в этой сессии подозрительный звонок / проверка / приманка
  if (NX.KEYS) NX.KEYS.creditlock = KEY;
  const MIN = 60000, HOUR = 3600000;
  const COOL_MS = 24 * HOUR;
  const SRC = 'Кредитный замок';
  const STEP_MS = 2000; // 3 заявки примерно за 6 с (в демо время ускорено: «за 4 минуты»)
  if (NX.ui && typeof NX.ui.markReady === 'function') NX.ui.markReady('credit_lock');
  const HONEST = (() => { const f = NX.ui && NX.ui.FEATURES ? NX.ui.FEATURES.find((x) => x.id === 'credit_lock') : null; return (f && f.label) || 'Концепт интеграции: в демо нет подключения к кредитному бюро и госсервисам. Заявки и МФО вымышленные. Государственный механизм добровольного отказа от займов в РК существует — NEXUS добавляет к нему контекст атаки и связь со схемой, а не заменяет его.'; })();

  /* ---------------- сценарий (фиксированный, вымышленный) ---------------- */
  const MODES = [['off', 'Выключен'], ['phone', 'Только с моего телефона'], ['full', 'Полный запрет']];
  const RANK = { off: 0, phone: 1, full: 2 };
  const MODE_RU = { off: 'выключен', phone: 'только с моего телефона', full: 'полный запрет' };
  // порядок прихода: первой — заявка 150 000 ₸ в МФО «Б» (о ней спрашивает пуш)
  const APPS = [['МФО „Б“', 150000], ['МФО „А“', 200000], ['МФО „В“', 120000]];
  const TOTAL = APPS.reduce((a, x) => a + x[1], 0); // 470 000 ₸
  const SPAN_MIN = 4;
  function fnv(s) { let h = 2166136261; const str = String(s); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const DEVICE = { id: 'dev-' + fnv('android|shymkent|nexus-demo').toString(16).slice(0, 6), os: 'Android', city: 'Шымкент', isNew: true };
  const DEVICE_RU = 'Android · Шымкент · новое устройство';
  // вымышленный IBAN (KZ00 и 9999 — несуществующий диапазон), не счёт клиента
  const PAYOUT = (() => {
    const raw = 'KZ00 9999 0000 0471 2286';
    let p = null; try { p = NX.parseAccount(raw); } catch (e) { p = null; }
    return { kind: 'iban', value: p ? p.value : raw.replace(/\s/g, ''), raw };
  })();
  const R = {
    lock: 'Включите замок, чтобы такие заявки блокировались автоматически',
    device: 'новое устройство в другом городе',
    payout: 'деньги просят выдать на чужой счёт',
    signal: 'недавно был подозрительный звонок или запрос кода',
  };
  const burstText = (n, span) => NX.countOf(n, ['заявка', 'заявки', 'заявок']) + ' за ' + NX.countOf(Math.max(1, span), ['минуту', 'минуты', 'минут']);

  /* ---------------- хранилище ---------------- */
  const resetting = () => !!(NX.isResetting && NX.isResetting());
  const blank = () => ({ v: 1, mode: 'off', changedAt: 0, unlock: null, batches: [] });
  function load() {
    let s = null;
    try { s = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || s.v !== 1) s = blank();
    if (!RANK.hasOwnProperty(s.mode)) s.mode = 'off';
    if (!Array.isArray(s.batches)) s.batches = [];
    s.batches = s.batches.filter((b) => b && b.id);
    return s;
  }
  function save(s) {
    if (resetting()) return false;
    try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, mode: s.mode, changedAt: s.changedAt, unlock: s.unlock || null, batches: s.batches.slice(0, 12) })); return true; } catch (e) { return false; }
  }
  function mutateBatch(id, fn) {
    const s = load();
    const b = s.batches.find((x) => x.id === id);
    if (!b) return null;
    if (fn(b, s) === false) return null;
    b.upd = Date.now();
    save(s);
    return b;
  }
  const byId = (id) => load().batches.find((b) => b.id === id) || null;
  const me = () => { try { return (NX.state && NX.state.user && NX.state.user.name) || 'Клиент'; } catch (e) { return 'Клиент'; } };
  const mine = () => load().batches.filter((b) => b.client === me());
  const OPEN_ST = ['arriving', 'asking'];
  const activeBatch = () => mine().find((b) => OPEN_ST.indexOf(b.status) >= 0) || null;
  const latestBatch = () => mine()[0] || null;
  const brief = (b) => JSON.parse(JSON.stringify(b));
  function emit(type, payload) { NX.bus.emit(type, Object.assign({ client: me(), synthetic: true }, payload || {})); }

  /* ---------------- сигналы сессии (звонок, «Проверить», робот-приманка) ---------------- */
  function hasSignal() { try { return window.sessionStorage.getItem(SIG_KEY) === '1'; } catch (e) { return false; } }
  function markSignal() { if (resetting()) return; try { window.sessionStorage.setItem(SIG_KEY, '1'); } catch (e) { /* ignore */ } }

  /* ---------------- звонок и правило 24 часов ---------------- */
  function callNow() {
    try { if (NX.Constitution && typeof NX.Constitution.isCallActive === 'function' && NX.Constitution.isCallActive()) return true; } catch (e) { /* ignore */ }
    try { const ss = NX.Shield && typeof NX.Shield.status === 'function' ? NX.Shield.status() : null; if (ss && ss.active) return true; } catch (e) { /* ignore */ }
    return false;
  }
  const CALL_REFUSAL = 'Во время звонка замок не снимается. Мошенники часто просят отключить защиту, пока они на линии. Положите трубку и попробуйте позже.';
  let notice = null; // { kind, text } — одна строка под переключателем
  function setNotice(kind, text) { notice = text ? { kind, text, ts: Date.now() } : null; }
  // включить или усилить — сразу; ослабить — запрос на 24 ч и никогда во время звонка
  function setMode(next, by) {
    if (!RANK.hasOwnProperty(next)) return { ok: false };
    const s = load();
    const prev = s.mode;
    if (next === prev) { if (s.unlock) { s.unlock = null; save(s); setNotice('', ''); renderAll(); } return { ok: true, mode: prev }; }
    if (RANK[next] > RANK[prev]) {
      s.mode = next; s.changedAt = Date.now(); s.unlock = null;
      // заявки, которые висели «на проверке» без замка, теперь заморожены замком
      s.batches.forEach((b) => { if (b.client === me() && OPEN_ST.indexOf(b.status) >= 0 && !b.frozen) { b.lockModeAt = b.lockMode; b.frozen = true; b.lockMode = next; b.frozenLater = true; b.frozenAt = Date.now(); b.upd = Date.now(); } });
      save(s);
      emit('credit_lock_change', { mode: next, prev });
      setNotice('ok', next === 'full' ? 'Замок включён. Заявки на ваше имя будут заморожены.' : 'Замок включён: заявки с чужих устройств будут заморожены.');
      if (by !== 'silent') NX.toast('Кредитный замок включён', MODE_RU[next], 'ok', 'lock');
      renderAll();
      return { ok: true, mode: next };
    }
    // ослабление
    if (callNow()) {
      setNotice('danger', CALL_REFUSAL);
      NX.toast('Замок не снят', 'Во время звонка ослабить замок нельзя', 'warn', 'phone');
      renderAll();
      return { ok: false, refused: 'call', reason: CALL_REFUSAL };
    }
    const at = Date.now();
    s.unlock = { target: next, at, until: at + COOL_MS };
    save(s);
    setNotice('', '');
    NX.toast('Замок ослабнет через 24 часа', 'Передумали — отмените в «Правила → Кредиты»', 'info', 'clock');
    renderAll();
    return { ok: true, pending: true, until: s.unlock.until };
  }
  // срок прошёл или «демо: снять сразу» — применить, если сейчас нет звонка
  function applyUnlock(force) {
    const s = load();
    if (!s.unlock) return false;
    if (!force && Date.now() < s.unlock.until) return false;
    if (callNow()) { setNotice('danger', CALL_REFUSAL); renderAll(); return false; }
    const prev = s.mode, next = s.unlock.target;
    s.mode = next; s.changedAt = Date.now(); s.unlock = null;
    save(s);
    emit('credit_lock_change', { mode: next, prev, afterCooling: true, demoSkip: !!force });
    setNotice('', next === 'off' ? 'Замок снят.' : 'Замок ослаблен: ' + MODE_RU[next] + '.');
    renderAll();
    return true;
  }
  function cancelUnlock() { const s = load(); if (!s.unlock) return; s.unlock = null; save(s); setNotice('ok', 'Запрос отменён, замок остаётся.'); renderAll(); }

  /* ---------------- демо: заявки на чужое имя ---------------- */
  let timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); if (resetting()) return; try { fn(); } catch (e) { console.error('[credit-lock]', e); } }, ms); timers.push(t); return t; };
  function reasonsFor(b, held) {
    const out = held ? [R.lock, R.device, R.payout] : [R.device, R.payout];
    if (!held) out.push(b.signal ? R.signal : burstText(Math.max(2, (b.apps || []).length), SPAN_MIN));
    return out.slice(0, 3);
  }
  function allReasons(b) {
    const out = [R.device, burstText(APPS.length, SPAN_MIN), R.payout];
    if (b.signal) out.push(R.signal);
    return out;
  }
  function start() {
    if (PAGE() !== 'client') return null;
    const cur = activeBatch();
    if (cur) { if (cur.status === 'asking') openSheet(cur.id); else NX.toast('Заявки уже поступают', 'Подождите несколько секунд · демо', 'info', 'clock'); return cur; }
    const s = load();
    const now = Date.now();
    const b = {
      id: 'cl' + now.toString(36).slice(-6), client: me(), ts: now, upd: now, status: 'arriving',
      lockMode: s.mode, frozen: s.mode !== 'off', signal: hasSignal(),
      device: Object.assign({}, DEVICE), payout: Object.assign({}, PAYOUT), apps: [], answer: null, answeredAt: null,
    };
    s.batches.unshift(b); save(s);
    try { if (NX.go) NX.go('credit'); } catch (e) { /* ignore */ }
    NX.toast('Демо: на вас пытаются оформить кредит', 'Сейчас придут заявки с чужого устройства', 'info', 'card');
    schedule(b);
    renderAll();
    return b;
  }
  function schedule(b) {
    let t = 600;
    APPS.forEach((a, k) => { if ((b.apps || []).some((x) => x.k === k)) return; later(() => addApp(b.id, k), t); t += STEP_MS; });
    later(() => ask(b.id), t + 200);
  }
  function addApp(id, k) {
    const a = APPS[k];
    const now = Date.now();
    // в демо время ускорено: 3 заявки «за 4 минуты», последняя — сейчас
    const ts = now - Math.round((SPAN_MIN * (APPS.length - 1 - k)) / (APPS.length - 1)) * MIN;
    const b = mutateBatch(id, (b) => {
      if (b.apps.some((x) => x.k === k) || OPEN_ST.indexOf(b.status) < 0) return false;
      b.apps.push({ k, id: b.id + '-' + (k + 1), lender: a[0], amount: a[1], ts });
    });
    if (!b) return;
    const app = b.apps.find((x) => x.k === k);
    emit('credit_lock_attempt', {
      id: app.id, batchId: b.id, lender: app.lender, amount: app.amount, ts: app.ts,
      device: Object.assign({}, b.device), payout: { kind: 'iban', value: b.payout.value, raw: b.payout.raw },
      frozen: !!b.frozen, reasons: reasonsFor(b, !b.frozen), mode: b.lockMode, n: b.apps.length, of: APPS.length,
    });
    renderAll();
  }
  function ask(id) {
    const b = mutateBatch(id, (b) => { if (b.status !== 'arriving') return false; b.status = 'asking'; b.askedAt = Date.now(); });
    if (!b) return;
    const first = b.apps[0];
    NX.toast('NEXUS: заявка на заём', 'Это вы оформляете заём ' + NX.fmt(first ? first.amount : APPS[0][1]) + ' в ' + (first ? first.lender : APPS[0][0]) + '?', 'warn', 'lock');
    openSheet(id);
    renderAll();
  }
  function answer(id, ans) {
    const b0 = byId(id);
    if (!b0 || b0.status !== 'asking') return null;
    const s = load();
    if (ans === 'me' && s.mode !== 'off') {
      // замок включён: «Да, это я» не проводит заявку — сначала снять замок (через 24 ч)
      sheetMsg = s.mode === 'full' ? 'Сначала снимите замок (через 24 ч)' : 'Заявки с нового устройства замок не пропускает. Оформите заём со своего телефона или снимите замок (через 24 ч)';
      renderSheet(id);
      return { ok: false, reason: sheetMsg };
    }
    if (ans === 'not_me') {
      // в стоп-лист — только счёт выдачи; устройство — поле записи (pickMeta), без нового вида реквизита.
      // Сначала стоп-лист, потом статус пакета: банк строит узел счёта выдачи раньше, чем ребро к нему от устройства
      try { NX.iocs.add([{ kind: 'iban', value: b0.payout.value, raw: b0.payout.raw }], SRC, { session: 'cl:' + b0.id, client: b0.client, device: b0.device.id }); } catch (e) { console.error('[credit-lock] iocs.add', e); }
    }
    const b = mutateBatch(id, (b) => { b.status = ans === 'not_me' ? 'not_me' : 'me'; b.answer = ans; b.answeredAt = Date.now(); });
    if (!b) return null;
    emit('credit_lock_response', { ids: b.apps.map((x) => x.id), batchId: b.id, answer: ans, frozen: !!b.frozen, batch: brief(b) });
    sheetMsg = '';
    renderSheet(id);
    renderAll();
    return { ok: true };
  }

  /* ---------------- клиент: окно «Это вы?» ---------------- */
  let sheetId = null, sheetMsg = '';
  function sheetEl() {
    let el = $('#clSheet');
    if (!el && document.body) { el = document.createElement('div'); el.id = 'clSheet'; el.className = 'sheet cl-sheet'; el.setAttribute('hidden', ''); document.body.appendChild(el); }
    return el;
  }
  function onSheetKey(e) { if (e.key === 'Escape' && sheetId) { e.stopPropagation(); closeSheet(); } }
  function openSheet(id) {
    const el = sheetEl(); if (!el) return;
    sheetId = id; sheetMsg = '';
    renderSheet(id);
    el.classList.add('open'); el.removeAttribute('hidden');
    document.addEventListener('keydown', onSheetKey, true);
    const f = el.querySelector('.sheet-f .btn.primary') || el.querySelector('.nx-x');
    try { if (f) f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeSheet() {
    const el = $('#clSheet');
    if (el) { el.classList.remove('open'); el.setAttribute('hidden', ''); }
    sheetId = null; sheetMsg = '';
    document.removeEventListener('keydown', onSheetKey, true);
  }
  function appsList(b) {
    return '<ul class="cl-apps">' + b.apps.map((a) => '<li><span class="mono tiny muted">' + esc(NX.hm(a.ts)) + '</span><span>' + esc(a.lender) + '</span><b>' + esc(NX.fmt(a.amount)) + '</b></li>').join('') + '</ul>';
  }
  function detailsHTML(b) {
    const body = '<h4 class="small mb-s">Все причины</h4><ul class="cl-reasons">' + allReasons(b).map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' +
      '<dl class="kv mt-s small"><dt>Устройство</dt><dd>' + esc(DEVICE_RU + ' · ' + b.device.id) + '</dd><dt>Счёт выдачи</dt><dd class="mono" style="word-break:break-all">' + esc(b.payout.raw) + ' <span class="tiny muted">не ваш · вымышленный</span></dd>' +
      '<dt>Замок</dt><dd>' + esc(MODE_RU[b.lockMode] || '—') + '</dd></dl>' +
      '<p class="tiny muted mt-s">' + esc(HONEST) + ' Пакет ' + esc(b.id) + '.</p>';
    return NX.ui && NX.ui.details ? NX.ui.details(body) : '<details class="more"><summary>Подробнее</summary><div class="more-b">' + body + '</div></details>';
  }
  function renderSheet(id) {
    const el = $('#clSheet');
    if (!el || (sheetId && sheetId !== id)) return;
    const b = byId(id);
    if (!b) { closeSheet(); return; }
    const first = b.apps[0] || { amount: APPS[0][1], lender: APPS[0][0] };
    let title = '', body = '', foot = '';
    const state = b.frozen ? '<p class="cl-state frozen">' + ic('lock', 16) + '<span>' + esc('Все заявки заморожены замком. Деньги никто не получил.') + '</span></p>'
      : '<p class="cl-state held">' + ic('clock', 16) + '<span>' + esc('Замок выключен, поэтому заявки только удержаны для проверки.') + '</span></p>';
    if (b.status === 'asking' || b.status === 'arriving') {
      title = 'Это вы оформляете заём ' + NX.fmt(first.amount) + ' в ' + first.lender + '?';
      const rest = b.apps.slice(1);
      body = state +
        (rest.length ? '<p class="small">' + esc('И ещё ' + NX.countOf(rest.length, ['заявка', 'заявки', 'заявок']) + ' за ' + SPAN_MIN + ' минуты: ' + rest.map((a) => NX.fmt(a.amount)).join(' и ') + '.') + '</p>' : '') +
        '<ul class="cl-reasons">' + reasonsFor(b, !b.frozen).map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' +
        (sheetMsg ? '<div class="notice warn small" role="alert">' + esc(sheetMsg) + '</div>' : '') +
        detailsHTML(b);
      foot = '<button type="button" class="btn ghost" data-cl="me">Да, это я</button><button type="button" class="btn primary" data-cl="not_me">Нет, это не я</button>';
    } else if (b.status === 'not_me') {
      title = 'Заявки отклонены';
      body = '<div class="cl-final" role="status"><b>' + esc('Заявки отклонены. Банк получил данные об атаке. Ваша кредитная история не пострадала (демо)') + '</b></div>' +
        appsList(b) +
        (b.frozen ? '' : '<p class="small">' + esc(R.lock + '.') + '</p>') + detailsHTML(b);
      foot = b.frozen || load().mode !== 'off' ? '<button type="button" class="btn primary" data-cl="close">Готово</button>'
        : '<button type="button" class="btn ghost" data-cl="close">Позже</button><button type="button" class="btn primary" data-cl="lock-on">Включить замок</button>';
    } else if (b.status === 'me') {
      title = 'Заявки отправлены на обычную проверку';
      body = '<p>' + esc('Вы подтвердили, что оформляете заём сами. Заявки пойдут на обычную проверку (демо). Если это были не вы — сообщите в «Помощь».') + '</p>' + detailsHTML(b);
      foot = '<button type="button" class="btn primary" data-cl="close">Понятно</button>';
    }
    const html = '<div class="sheet-box cl-box" role="dialog" aria-modal="true" aria-labelledby="clTitle">' +
      '<div class="sheet-h"><h3 id="clTitle">' + esc(title) + '</h3><button type="button" class="nx-x" data-cl="close" aria-label="Закрыть">' + NX.icon('x', { size: 20 }) + '</button></div>' +
      '<div class="sheet-b">' + body + '</div>' + (foot ? '<div class="sheet-f">' + foot + '</div>' : '') + '</div>';
    if (el._clHtml !== html) {
      const det = el.querySelector('details.more');
      const wasOpen = !!(det && det.open);
      el.innerHTML = html; el._clHtml = html;
      if (wasOpen) { const d2 = el.querySelector('details.more'); if (d2) d2.open = true; }
    }
  }

  /* ---------------- клиент: «Правила → Кредиты» ---------------- */
  function fmtUntil(ts) { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' в ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function cardHTML() {
    const s = load();
    const on = s.mode !== 'off';
    const seg = NX.ui && NX.ui.seg ? NX.ui.seg(MODES.map((m) => ({ id: m[0], label: m[1] })), s.mode, { label: 'Кредитный замок', id: 'clSeg' })
      : '<div class="seg" id="clSeg">' + MODES.map((m) => '<button type="button" data-seg="' + m[0] + '"' + (m[0] === s.mode ? ' class="on"' : '') + '>' + esc(m[1]) + '</button>').join('') + '</div>';
    const head = on ? '<p class="cl-lead on">' + ic('lock', 18) + '<span>' + esc(s.mode === 'full' ? 'Оформить кредит на вас сейчас нельзя.' : 'Кредит можно оформить только с вашего телефона.') + '</span></p>'
      : '<p class="cl-lead">' + esc('Замок выключен. Если мошенник узнает код из SMS, он сможет подать заявку на заём от вашего имени.') + '</p>';
    const unlock = s.unlock ? '<div class="notice small cl-unlock">' + esc((s.unlock.target === 'off' ? 'Замок снимется ' : 'Замок ослабнет ') + fmtUntil(s.unlock.until) + '. Если вас об этом попросили по телефону — отмените.') +
      '<div class="row wrap gap-s mt-s"><button type="button" class="btn sm" data-cl="unlock-cancel">Отменить</button><button type="button" class="link-btn tiny" data-cl="unlock-now">демо: снять сразу</button></div></div>' : '';
    const nt = notice && Date.now() - notice.ts < 5 * MIN ? '<div class="notice ' + (notice.kind === 'danger' ? 'danger' : notice.kind === 'ok' ? 'cl-ok' : '') + ' small" role="status">' + esc(notice.text) + '</div>' : '';
    const b = latestBatch();
    const heldOpen = b && !b.frozen && OPEN_ST.indexOf(b.status) >= 0;
    // одна главная кнопка: без замка — «Включить замок»; с замком — демо
    const primaryOn = !on && !heldOpen ? '<button type="button" class="btn primary" data-cl="lock-on">Включить замок</button>' : '';
    const busy = b && OPEN_ST.indexOf(b.status) >= 0; // пока идут заявки, главная кнопка — в ленте («Ответить» / «Включить замок»)
    const demoBtn = '<button type="button" class="btn' + (on && !busy ? ' primary' : '') + '" data-cl="demo">Демо: на меня пытаются оформить кредит</button>';
    return '<div class="card std cl-card"><div class="card-h"><h3>Кредитный замок</h3></div>' +
      '<p class="small muted">Один переключатель — и на вас нельзя оформить кредит.</p>' +
      seg +
      '<p class="tiny muted cl-rule">Снять замок можно через 24 часа и никогда — во время звонка.</p>' +
      head + unlock + nt +
      '<div class="card-f row wrap gap-s">' + primaryOn + demoBtn + '</div></div>';
  }
  function feedHTML() {
    const b = latestBatch();
    if (!b || !b.apps.length) return '';
    const frozen = !!b.frozen;
    const n = b.apps.length;
    const span = n > 1 ? Math.max(1, Math.round((b.apps[n - 1].ts - b.apps[0].ts) / MIN)) : 0;
    const st = b.status === 'not_me' ? 'Отклонено' : b.status === 'me' ? 'На обычной проверке' : frozen ? 'Заморожено замком' : 'Удержаны для проверки';
    const stCls = b.status === 'not_me' ? 'ok' : b.status === 'me' ? 'plain' : frozen ? 'info' : 'warn';
    const rs = reasonsFor(b, !frozen);
    const rows = b.apps.map((a) => '<li><span class="cl-l"><b>' + esc(a.lender) + '</b><span class="tiny muted">' + esc(NX.hm(a.ts)) + ' · ' + esc(DEVICE_RU) + '</span></span><b class="cl-a">' + esc(NX.fmt(a.amount)) + '</b><span class="badge ' + stCls + '">' + esc(st) + '</span></li>').join('');
    const heldCta = !frozen && OPEN_ST.indexOf(b.status) >= 0;
    const asking = b.status === 'asking';
    return '<div class="card std cl-feed"><div class="card-h"><h3>Заявки на ваше имя</h3>' + (NX.ui && NX.ui.tagDemo ? NX.ui.tagDemo('демо') : '') + '</div>' +
      '<p class="small muted">' + esc(span ? burstText(n, span) + ', устройство не ваше' : 'Заявка с устройства, которого у вас нет') + '</p>' +
      '<ul class="cl-list">' + rows + '</ul>' +
      (b.status === 'not_me' ? '<p class="small mt-s">' + esc('Заявки отклонены. Банк получил данные об атаке. Ваша кредитная история не пострадала (демо).') + '</p>'
        : '<ul class="cl-reasons mt-s">' + rs.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>') +
      (heldCta || asking ? '<div class="card-f row wrap gap-s">' + (heldCta ? '<button type="button" class="btn primary" data-cl="lock-on">Включить замок</button>' : '') + (asking ? '<button type="button" class="btn' + (heldCta ? '' : ' primary') + '" data-cl="open">Ответить: это вы?</button>' : '') + '</div>' : '') +
      '</div>';
  }
  function renderClient(mountEl) {
    const m = mountEl || $('#view-credit');
    if (!m) return;
    if (m.querySelector('#creditMount')) { const old = m.querySelector('#creditMount'); old.remove(); }
    const html = '<div class="cl-wrap">' + cardHTML() + feedHTML() + '</div>';
    if (m._clHtml !== html) { m.innerHTML = html; m._clHtml = html; }
  }
  function refreshClient() { try { if (NX.ClientUI && NX.ClientUI.refresh) NX.ClientUI.refresh(); } catch (e) { console.error(e); } }
  function renderAll() {
    if (PAGE() !== 'client') return;
    renderClient();
    if (sheetId) renderSheet(sheetId);
    refreshClient();
  }
  // NX.ClientUI.statusProviders: одна строка статуса «Главной»
  function statusProvider() {
    const b = latestBatch();
    if (!b || !b.apps.length) return null;
    const n = NX.countOf(b.apps.length, ['заявка', 'заявки', 'заявок']);
    if (OPEN_ST.indexOf(b.status) >= 0) {
      return b.frozen ? { kind: 'danger', text: 'Заморожено ' + n + ' на кредит', link: { text: 'посмотреть', goto: 'credit' }, rank: 2 }
        : { kind: 'danger', text: 'Удержаны ' + n + ' на кредит на ваше имя', link: { text: 'посмотреть', goto: 'credit' }, rank: 2 };
    }
    if (b.status === 'not_me' && Date.now() - (b.answeredAt || b.upd) < 24 * HOUR) return { kind: 'calm', text: 'Заявки на кредит отклонены · банк знает об атаке', rank: 0 };
    return null;
  }

  /* ---------------- банк ---------------- */
  const clKey = (id) => 'cl:' + id;
  const stFor = (b) => { try { return NX.iocs.status('iban', (b && b.payout ? b.payout.value : PAYOUT.value)); } catch (e) { return null; } };
  function incPatch(b) {
    const timeline = b.apps.map((a) => ({ t: 'Заявка ' + NX.fmt(a.amount) + ' в ' + a.lender + ' (вымышленная) · ' + DEVICE_RU + ' · ' + (b.frozen && !b.frozenLater ? 'заморожена замком' : 'удержана для проверки (замок был выключен)'), ts: a.ts }))
      .concat(b.frozenLater && b.frozenAt ? [{ t: 'Клиент включил замок позже — заявки, ещё не рассмотренные, заморожены', ts: b.frozenAt }] : [])
      .concat(b.answeredAt ? [{ t: 'Клиент: «Нет, это не я» — заявки отклонены, счёт выдачи передан в стоп-лист', ts: b.answeredAt }] : []);
    const notes = [{ key: 'cl_answer', ts: b.answeredAt || b.upd, t: 'Клиент ответил «Нет, это не я». ' + NX.countOf(b.apps.length, ['заявка', 'заявки', 'заявок']) + ' на ' + NX.fmt(b.apps.reduce((a, x) => a + x.amount, 0)) + ' отклонены. Устройство ' + b.device.id + ', счёт выдачи — в стоп-листе', by: 'NEXUS · Кредитный замок' }];
    return {
      kind: 'credit_lock', clId: b.id, synthetic: true, score: null, heldTransfer: false,
      account: b.payout.raw, amount: b.apps.reduce((a, x) => a + x.amount, 0),
      frozen: b.frozen ? b.apps.length : 0,
      type: 'Кредитный замок',
      title: 'Попытка оформить заём на чужое имя',
      client: b.client, source: 'Кредитный замок · кабинет клиента (демо)', fromClient: true,
      factors: [
        NX.countOf(b.apps.length, ['заявка', 'заявки', 'заявок']) + ' за ' + SPAN_MIN + ' минуты в разные МФО',
        'Новое устройство в другом городе: ' + DEVICE_RU,
        'Деньги просят выдать на чужой счёт',
      ].concat(b.signal ? ['Перед заявками у клиента был подозрительный звонок или запрос кода'] : []),
      chain: timeline,
      addNotes: notes,
    };
  }
  const synced = {};
  function syncBank(bIn) {
    if (PAGE() !== 'bank' || !NX.BankExt || resetting()) return;
    const list = bIn ? [bIn] : load().batches;
    list.forEach((b) => {
      if (!b || b.answer !== 'not_me') return; // инцидент — когда клиент ответил «Нет, это не я»
      const sig = b.upd + '|' + b.status;
      if (synced[b.id] === sig) return;
      synced[b.id] = sig;
      const res = NX.BankExt.upsertIncident(clKey(b.id), () => incPatch(b));
      if (res && res.isNew) { try { NX.BankExt.logCycle('investigate', 'Кредитный замок: ' + String(b.client).split(' ')[0] + ' — заявки на чужое имя с устройства ' + b.device.id); } catch (e) { /* ignore */ } }
      addGraph(b);
    });
  }
  function addGraph(b) {
    if (!NX.Graph || typeof NX.Graph.addCreditLock !== 'function' || !b) return null;
    try { return NX.Graph.addCreditLock({ id: b.id, client: b.client, device: b.device, payout: b.payout, apps: b.apps }); } catch (e) { console.error('[credit-lock] graph', e); return null; }
  }
  function replayGraph() { load().batches.forEach((b) => { if (b.answer === 'not_me') addGraph(b); }); }
  function bankIncidentSummary(i) {
    const b = byId(i.clId);
    const st = stFor(b);
    return '<div class="notice warn"><b>' + esc('Клиент ответил: «Нет, это не я»') + '</b><br>' +
      esc((b && b.frozen && !b.frozenLater ? 'Заявки были заморожены кредитным замком клиента. ' : b && b.frozenLater ? 'Заявки пришли при выключенном замке и удерживались для проверки; клиент включил замок позже, и они заморожены. ' : 'Замок был выключен: заявки удерживались для проверки. ') + 'Индекса риска у обращения нет. Счёт выдачи: ' + (st ? NX.iocs.label(st) : 'ещё не в стоп-листе') + '.') + '</div>';
  }
  function bankIncidentHTML(i) {
    const b = byId(i.clId);
    if (!b) return '<p class="small muted mt">Данные пакета заявок не найдены (сброс?).</p>';
    const st = stFor(b);
    let rec = null; try { rec = NX.iocs.find('iban', b.payout.value); } catch (e) { rec = null; }
    const rows = b.apps.map((a) => '<li><span class="mono tiny">' + esc(NX.hm(a.ts)) + '</span><span>' + esc(a.lender) + ' <span class="tiny muted">вымышл.</span></span><b>' + esc(NX.fmt(a.amount)) + '</b><span class="tiny muted">' + esc(b.frozenLater ? 'удержана → заморожена' : b.frozen ? 'заморожена' : 'удержана') + '</span></li>').join('');
    return '<h4 class="mt mb cl-h4">' + ic('lock') + ' Кредитный замок · пакет ' + esc(b.id) + '</h4>' +
      '<ul class="mx-tl cl-tl">' + rows + '</ul>' +
      '<dl class="kv mt-s small"><dt>Устройство</dt><dd>' + esc(DEVICE_RU + ' · ' + b.device.id) + '</dd><dt>Замок клиента</dt><dd>' + esc(b.frozenLater ? (MODE_RU[b.lockModeAt] || 'выключен') + ' при заявках → ' + (MODE_RU[b.lockMode] || '—') + ' позже' : MODE_RU[b.lockMode] || '—') + '</dd></dl>' +
      '<div class="row wrap gap-s mt-s"><span class="small">' + esc('Счёт выдачи ' + b.payout.raw + ': ') + '<span class="badge ' + (st === 'corroborated' || st === 'confirmed' ? 'high' : st ? 'warn' : 'plain') + '">' + esc(st ? NX.iocs.label(st) : 'не в стоп-листе') + '</span></span>' +
      (rec ? '<button type="button" class="btn sm" data-ioc="' + esc(rec.id) + '">' + ic('dna', 14) + 'Карточка реквизита</button>' : '') +
      '<button type="button" class="btn sm" data-cl-graph="' + esc(b.id) + '">' + ic('graph', 14) + 'Показать в графе</button></div>' +
      '<p class="tiny muted mt-s">' + esc('В графе устройство отмечено как «Устройство-фабрика заявок»: с него же — заявки ещё 5 клиентов (синтетика). ' + HONEST) + '</p>';
  }
  function onBankClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-cl-graph]') : null;
    if (!t) return;
    const b = byId(t.getAttribute('data-cl-graph'));
    const res = b ? addGraph(b) : null;
    try { NX.closeModal(); } catch (er) { /* ignore */ }
    if (NX.BankExt) NX.BankExt.go('graph');
    if (res && res.node && NX.Graph) setTimeout(() => { try { NX.Graph.focus(res.node, { ms: 5000, k: 1.2 }); NX.Graph.select(res.node); } catch (er) { /* ignore */ } }, 60);
  }

  /* ---------------- клики клиента ---------------- */
  function onClientClick(e) {
    const segB = e.target && e.target.closest ? e.target.closest('#clSeg [data-seg]') : null;
    if (segB) { e.preventDefault(); setMode(segB.getAttribute('data-seg')); return; }
    const t = e.target && e.target.closest ? e.target.closest('[data-cl]') : null;
    if (!t) return;
    const a = t.getAttribute('data-cl');
    e.preventDefault();
    if (a === 'demo') { closeSheet(); start(); }
    else if (a === 'lock-on') { setMode('full'); if (sheetId) renderSheet(sheetId); }
    else if (a === 'unlock-cancel') cancelUnlock();
    else if (a === 'unlock-now') applyUnlock(true);
    else if (a === 'open') { const b = activeBatch(); if (b) openSheet(b.id); }
    else if (a === 'close') closeSheet();
    else if ((a === 'not_me' || a === 'me') && sheetId) answer(sheetId, a);
  }

  /* ---------------- шина ---------------- */
  function onBus(msg, local) {
    if (!msg || !msg.type) return;
    const p = msg.payload || {};
    // сигналы этой сессии для причины «недавно был подозрительный звонок или запрос кода»
    if (PAGE() === 'client' && (msg.type === 'shield_alert' || msg.type === 'decoy_start')) markSignal();
    if (msg.type === 'reset') { timers.forEach(clearTimeout); timers = []; try { window.sessionStorage.removeItem(SIG_KEY); } catch (e) { /* ignore */ } return; }
    // банк: счёт выдачи появился в графе позже пакета — дорисовать ребро «устройство → счёт выдачи» (addCreditLock идемпотентен)
    if (PAGE() === 'bank' && !local && (msg.type === 'ioc' || msg.type === 'ioc_seen') && ((p.items || []).some((it) => it && it.kind === 'iban' && it.value === PAYOUT.value))) {
      setTimeout(() => { if (!resetting()) replayGraph(); }, 50);
      return;
    }
    if (String(msg.type).indexOf('credit_lock_') !== 0) return;
    if (PAGE() === 'client' && !local) { renderAll(); return; }
    if (local || PAGE() !== 'bank') return;
    const who = String(p.client || '').split(' ')[0];
    if (msg.type === 'credit_lock_attempt' && p.n === 1) {
      try { NX.BankExt && NX.BankExt.logCycle('detect', 'Кредитный замок: заявки на имя ' + who + ' с нового устройства ' + (p.device ? p.device.id : '') + ' — ' + (p.frozen ? 'заморожены' : 'удержаны')); } catch (e) { /* ignore */ }
      NX.toast('Кредитный замок: заявка ' + (p.frozen ? 'заморожена' : 'удержана'), who + ' · ' + (p.lender || '') + ' · ' + NX.fmt(p.amount || 0) + ' · демо', 'warn', 'lock');
    } else if (msg.type === 'credit_lock_response' && p.answer === 'not_me') {
      NX.toast('Клиент: «Нет, это не я»', who + ' · заявки отклонены · счёт выдачи — в стоп-лист', 'high', 'lock');
      syncBank(p.batch || null);
    }
  }

  function init() {
    NX.bus.on(onBus);
    if (PAGE() === 'client') {
      document.addEventListener('click', onClientClick, true);
      if (NX.ClientUI) {
        NX.ClientUI.statusProviders = NX.ClientUI.statusProviders || [];
        NX.ClientUI.statusProviders.push(statusProvider);
        // «Проверить»: подозрительное сообщение — тоже сигнал сессии; общий ответ не меняем
        const prevHook = NX.ClientUI.scanHook;
        NX.ClientUI.scanHook = function (res, input) {
          try { if (res && Number(res.score) >= 55) markSignal(); } catch (e) { /* ignore */ }
          return typeof prevHook === 'function' ? prevHook.call(this, res, input) : null;
        };
      }
      // сценарий прервали перезагрузкой: досылаем недошедшие шаги
      const b = activeBatch();
      if (b && b.status === 'arriving') schedule(b);
      renderClient();
      refreshClient();
      setInterval(() => { try { const s = load(); if (s.unlock && Date.now() >= s.unlock.until) applyUnlock(false); } catch (e) { /* ignore */ } }, 15000);
      window.addEventListener('storage', (e) => { if (e.key === KEY) { renderClient(); if (sheetId) renderSheet(sheetId); refreshClient(); } });
    }
    if (PAGE() === 'bank') {
      document.addEventListener('click', onBankClick);
      syncBank();
      window.addEventListener('storage', (e) => { if (e.key === KEY) syncBank(); });
    }
  }

  NX.CreditLock = {
    KEY, TOTAL, PAYOUT, DEVICE, HONEST, APPS: APPS.map((a) => ({ lender: a[0], amount: a[1] })),
    load, save, emit, mode: () => load().mode, setMode, applyUnlock, cancelUnlock, callNow,
    start, answer, openSheet, closeSheet, batches: () => load().batches.slice(), get: byId, active: activeBatch,
    renderClient, renderBank: syncBank, bankIncidentHTML, bankIncidentSummary, replayGraph, statusProvider,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
