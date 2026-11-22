/* =====================================================================
   NEXUS AI — Финансовая конституция клиента
   Персональные правила защиты от манипуляций, которые клиент устанавливает сам.
   - статьи по умолчанию (1–7) + «Ночной режим» (выключен), планы, доверенное лицо
   - защитный режим со сроком действия
   - Правило 24 часов: усиление — сразу, ослабление — через 24 ч с уведомлением
     доверенного лица; во время звонка / атаки — отказ
   - «Голос из спокойного времени»: текст или аудио (IndexedDB), TTS только русским голосом
   - «Конституция своими словами»: офлайн-парсер RU + немного KZ
   - подпись SHA-256 (crypto.subtle, иначе простой хеш с пометкой) и журнал поправок
   Грузится после core.js и до client.js. Концепт хакатона, не продукт банка.
   Все данные синтетические.
   ===================================================================== */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});
  if (NX.Constitution && NX.Constitution.__v) return;

  const KEY = 'nexus_ai_constitution_v1';
  const DB_NAME = 'nexus_ai_anchor';
  const DB_STORE = 'audio';
  const DB_KEY = 'anchor';
  const HOUR = 3600000, DAY = 86400000;
  const SCHEMA = 1;
  const GRACE_REMOVE_MS = 10 * 60000; // свою только что добавленную статью можно удалить сразу (исправить опечатку)
  const CALL_FLAG_TTL = 60 * 60000;   // флаг SDK «активный звонок» без подтверждения гаснет через 60 мин

  /* ---------------- безопасное хранилище ---------------- */
  const lsGet = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const now = () => Date.now();
  const uid = (p) => (typeof NX.uid === 'function' ? NX.uid(p) : p + '_' + Math.random().toString(36).slice(2, 10));
  const nf = (() => { try { return new Intl.NumberFormat('ru-RU'); } catch (e) { return null; } })();
  const num = (n) => (nf ? nf.format(Math.round(Number(n) || 0)) : String(Math.round(Number(n) || 0))).replace(/ | /g, ' ');
  const money = (n) => num(n) + ' ₸';
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDT = (ts) => { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtHM = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const fmtDayMonth = (ts) => { const d = new Date(ts); return d.getDate() + ' ' + MONTHS_GEN[d.getMonth()]; };
  const plural = (n, f) => (typeof NX.plural === 'function' ? NX.plural(n, f) : f[2]);
  const hours = (h) => h + ' ' + plural(h, ['час', 'часа', 'часов']);
  const hh = (h) => pad(((Number(h) % 24) + 24) % 24) + ':00';
  const ratioText = (r) => String(Math.round(r * 10) / 10).replace('.', ',');
  const pct = (x) => Math.round((Number(x) || 0) * 100) + '%';

  /* ---------------- персона, звонок ---------------- */
  let persona = NX.flags && NX.flags.persona === 'mom' ? 'mom' : 'self';
  let callFlag = { active: false, ts: 0 };
  function isCallActive() {
    if (!callFlag.active) return false;
    if (now() - callFlag.ts > CALL_FLAG_TTL) { callFlag = { active: false, ts: 0 }; return false; }
    return true;
  }
  function clientName() {
    try { return (NX.state && NX.state.user && NX.state.user.name) || ''; } catch (e) { return ''; }
  }
  function emit(type, payload) {
    try { if (NX.bus && typeof NX.bus.emit === 'function') NX.bus.emit(type, Object.assign({ client: clientName() }, payload || {})); } catch (e) { /* ignore */ }
  }

  /* ---------------- справочник видов статей ---------------- */
  const DECISION_RANK = { allow: 0, confirm: 1, hold: 2, protect: 3 };
  const DECISION_LABEL = { allow: 'без ограничений', confirm: 'дополнительная проверка', hold: 'удержание до проверки', protect: 'защитный режим' };
  const KINDS = {
    new_recipient_limit: { title: 'Лимит для новых получателей', decision: 'confirm' },
    flagged_accounts: { title: 'Подозрительные счета', decision: 'hold' },
    amount_spike: { title: 'Резкий скачок суммы', decision: 'confirm' },
    plan_deviation: { title: 'Отклонение от плана', decision: 'protect' },
    guardian_help: { title: 'Доверенное лицо', decision: null },
    call_guard: { title: 'Защита во время звонка', decision: 'hold' },
    anchor: { title: 'Правило 24 часов', decision: null },
    night_guard: { title: 'Ночной режим', decision: 'confirm' },
    amount_limit: { title: 'Лимит одной операции', decision: 'confirm' },
    crypto_guard: { title: 'Криптовалюта', decision: 'hold' },
    abroad_guard: { title: 'Переводы за границу', decision: 'confirm' },
  };
  const EVAL_KINDS = ['new_recipient_limit', 'flagged_accounts', 'amount_spike', 'plan_deviation', 'call_guard', 'night_guard', 'amount_limit', 'crypto_guard', 'abroad_guard'];
  const decisionOf = (a) => (a && a.decision && DECISION_RANK[a.decision] ? a.decision : (KINDS[a.kind] && KINDS[a.kind].decision) || 'confirm');

  const GUARDIAN_DEFAULT = { mom: { name: 'Айгерим Нурланова', relation: 'дочь' }, self: { name: 'Динара Ж.', relation: 'сестра' } };
  const ANCHOR_DEFAULT = {
    mom: { text: 'Мама, это Айгерим. Если ты это видишь — тебе звонят мошенники. Положи трубку и перезвони мне. Банк никогда не просит коды.', author: 'Айгерим (дочь)', authorKind: 'guardian' },
    self: { text: 'Это я — из спокойного дня. Если ты видишь это сообщение, NEXUS заметил давление. Остановись и положи трубку. Перезвони в банк сам, по номеру на обороте карты. Настоящий банк никогда не просит коды и не торопит.', author: 'Вы', authorKind: 'self' },
  };
  function guardianOf(st) {
    const a = (st.articles || []).find((x) => x.id === 'a_guardian');
    const p = (a && a.params) || {};
    const def = GUARDIAN_DEFAULT[persona];
    const auto = p.auto !== false;
    return { name: auto ? def.name : p.name || def.name, relation: auto ? def.relation : p.relation || def.relation, enabled: !!(a && a.enabled) };
  }

  /* ---------------- тексты статей ---------------- */
  function consequence(a) {
    const p = a.params || {};
    if (p.guardian) return 'только с подтверждения доверенного лица';
    const d = decisionOf(a);
    return d === 'protect' ? 'включать защитный режим' : d === 'hold' ? 'удерживать до проверки' : 'только после дополнительной проверки';
  }
  function condition(a) {
    const p = a.params || {};
    const amt = p.amount > 0 ? ' больше ' + money(p.amount) : '';
    const nw = p.newOnly ? ' новым получателям' : '';
    switch (a.kind) {
      case 'new_recipient_limit': return 'Переводы новым получателям' + amt;
      case 'amount_limit': return (p.newOnly ? 'Переводы новым получателям' : 'Любые переводы') + amt;
      case 'night_guard': return (isNightWindow(p) ? 'Ночью' : 'С ' + hh(p.from) + ' до ' + hh(p.to)) + (isNightWindow(p) ? ' (' + hh(p.from) + '–' + hh(p.to) + ')' : '') + ' переводы' + nw + amt;
      case 'call_guard': return 'Во время телефонного звонка переводы' + (p.newOnly === false ? '' : ' новым получателям') + amt;
      case 'crypto_guard': return 'Переводы на криптобиржи и криптокошельки' + nw + amt;
      case 'abroad_guard': return 'Переводы за границу' + nw + amt;
      case 'amount_spike': return 'Перевод больше чем в ' + ratioText(p.ratio || 3) + ' раза от обычного';
      case 'plan_deviation': return 'Перевод, который отличается от запланированного больше чем на ' + pct(p.tolerance == null ? 0.5 : p.tolerance);
      case 'flagged_accounts': return 'Переводы на счета, отмеченные как подозрительные';
      default: return 'Переводы';
    }
  }
  function isNightWindow(p) { const f = Number(p.from), t = Number(p.to); return f > t || f >= 20 || f <= 1; }
  // Текст статьи 7 зависит от состояния статьи 5: уведомление обещаем, только если доверенное лицо включено
  function anchorText(p, guardianOn) {
    return 'Правило 24 часов: ослабить любое правило можно только через ' + hours(p.delayHours || 24) +
      (guardianOn ? ' и с уведомлением доверенного лица' : ' (доверенное лицо выключено — уведомление не отправляется)') + '; во время звонка — нельзя';
  }
  function guardianOnNow() { try { return state ? guardianOf(state).enabled : true; } catch (e) { return true; } }
  // Текст статьи по её виду и параметрам (встроенные — формулировки конституции по умолчанию)
  function describe(a, ctx) {
    if (!a) return '';
    const p = a.params || {};
    const def = !a.decision || a.decision === (KINDS[a.kind] && KINDS[a.kind].decision);
    if (a.builtin && def && !p.guardian) {
      switch (a.kind) {
        case 'new_recipient_limit': return p.amount > 0 ? 'Не переводить более ' + money(p.amount) + ' новым получателям без дополнительной проверки' : 'Любые переводы новым получателям — только после дополнительной проверки';
        case 'flagged_accounts': return 'Не разрешать переводы на счета, отмеченные как подозрительные';
        case 'amount_spike': return 'При резком изменении суммы требовать повторного подтверждения' + (Number(p.ratio) !== 3 ? ' (сумма больше обычной в ' + ratioText(p.ratio) + ' раза)' : '');
        case 'plan_deviation': return 'Если операция сильно отличается от запланированной — включать защитный режим' + (Number(p.tolerance) !== 0.5 || Number(p.unplannedOver) !== 200000 ? ' (отклонение больше ' + pct(p.tolerance) + ' или незапланированный перевод больше ' + money(p.unplannedOver) + ')' : '');
        case 'call_guard': return 'Во время телефонного звонка — переводы новым получателям только после проверки';
        case 'night_guard': return 'Ночью (' + hh(p.from) + '–' + hh(p.to) + ') — переводы больше ' + money(p.amount) + ' только после проверки';
        default: break;
      }
    }
    if (a.kind === 'guardian_help') return 'Доверенное лицо может помочь проверить ситуацию (функция подключена заранее)';
    if (a.kind === 'anchor') return anchorText(p, ctx && ctx.guardianOn != null ? !!ctx.guardianOn : guardianOnNow());
    return condition(a) + ' — ' + consequence(a);
  }
  // Сводка «7 статей + 1 дополнительная (выключена)»: «Ночной режим» — встроенная дополнительная статья
  function articlesSummary(st) {
    const arts = (st && st.articles) || [];
    const main = arts.filter((a) => !a.optional), opt = arts.filter((a) => a.optional);
    const mainOn = main.filter((a) => a.enabled).length, optOn = opt.filter((a) => a.enabled).length;
    let label = (mainOn === main.length ? '' : mainOn + ' из ') + main.length + ' ' + plural(main.length, ['правило', 'правила', 'правил']);
    if (opt.length) {
      const one = opt.length === 1;
      const state1 = optOn === 0 ? (one ? 'выключена' : 'выключены') : optOn === opt.length ? (one ? 'включена' : 'включены') : 'включено ' + optOn;
      label += ' + ' + opt.length + ' ' + plural(opt.length, ['дополнительная', 'дополнительные', 'дополнительных']) + ' (' + state1 + ')';
    }
    return { main: main.length, mainOn, optional: opt.length, optionalOn: optOn, total: arts.length, enabled: mainOn + optOn, label };
  }

  /* ---------------- состояние по умолчанию ---------------- */
  function defaultArticles(t0) {
    const A = (id, n, kind, params, enabled) => ({ id, n, kind, title: KINDS[kind].title, text: '', enabled: enabled !== false, params, builtin: true, createdAt: t0 });
    const list = [
      A('a_new_limit', 1, 'new_recipient_limit', { amount: 100000 }),
      A('a_flagged', 2, 'flagged_accounts', {}),
      A('a_spike', 3, 'amount_spike', { ratio: 3 }),
      A('a_plan', 4, 'plan_deviation', { tolerance: 0.5, unplannedOver: 200000 }),
      A('a_guardian', 5, 'guardian_help', { name: 'Айгерим Нурланова', relation: 'дочь', auto: true }),
      A('a_call', 6, 'call_guard', {}),
      A('a_anchor', 7, 'anchor', { delayHours: 24 }),
      A('a_night', 8, 'night_guard', { from: 23, to: 7, amount: 50000 }, false),
    ];
    // статья 8 — встроенная дополнительная (выключена по умолчанию, включается в один клик)
    list[list.length - 1].optional = true;
    list.forEach((a) => (a.text = describe(a, { guardianOn: true })));
    return list;
  }
  const PLAN_IDS = { self: ['p_rent', 'p_mom', 'p_sister'], mom: ['p_util', 'p_daughter', 'p_grand'] };
  function defaultPlans(who) {
    if ((who || persona) === 'mom') return [
      { id: 'p_util', label: 'Коммунальные услуги', recipient: 'Астана ЕРЦ (коммунальные услуги)', amount: 35000, day: 10, note: 'Каждый месяц, до 10-го числа' },
      { id: 'p_daughter', label: 'Дочери', recipient: 'Айгерим Н. (дочь)', amount: 30000, note: 'Иногда помогаю, до 30 000 ₸' },
      { id: 'p_grand', label: 'Внучке на день рождения', recipient: 'Алия Н. (внучка)', amount: 20000, note: 'Подарок, один раз' },
    ];
    return [
      { id: 'p_rent', label: 'Аренда квартиры', recipient: 'Арендодатель — Марат Б.', recipientId: 'r3', amount: 220000, day: 1, note: 'Каждый месяц, 1-го числа' },
      { id: 'p_mom', label: 'Маме', recipient: 'Гульнара С. (мама)', recipientId: 'r1', amount: 50000, note: 'До 50 000 ₸ в месяц' },
      { id: 'p_sister', label: 'Сестре на день рождения', recipient: 'Динара Ж. (сестра)', recipientId: 'r4', amount: 30000, note: 'Подарок, один раз' },
    ];
  }
  function defaults() {
    const d = new Date(now() - 4 * DAY); d.setHours(19, 40, 0, 0);
    const t0 = d.getTime();
    const articles = defaultArticles(t0);
    return {
      schema: SCHEMA, version: 1, createdAt: t0, signedAt: t0, hash: '', hashAlgo: 'SHA-256',
      articles, plans: defaultPlans(),
      protective: { active: false, since: null, until: null, reason: '', articleN: null },
      pending: [], requests: [], amendNo: 0,
      history: [{ id: uid('am'), no: 0, ts: t0, version: 1, articleId: null, kind: 'sign', summary: 'Правила подписаны: ' + articlesSummary({ articles }).label + ' — дополнительное правило «Ночной режим» можно включить' }],
      anchor: { kind: 'text', custom: false, text: '', author: '', authorKind: '', recordedAt: t0, hasAudio: false },
      stats: { hits: 0, lastHitAt: null },
    };
  }
  function valid(s) { return s && s.schema === SCHEMA && Array.isArray(s.articles) && Array.isArray(s.history); }
  function upgrade(s) {
    ['plans', 'pending', 'requests', 'history'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
    if (!s.protective) s.protective = { active: false, since: null, until: null, reason: '', articleN: null };
    if (!s.anchor) s.anchor = { kind: 'text', custom: false, text: '', author: '', recordedAt: s.createdAt || now(), hasAudio: false };
    if (!s.stats) s.stats = { hits: 0, lastHitAt: null };
    s.articles.forEach((a) => {
      if (a && a.id === 'a_night' && a.builtin) a.optional = true;
      if (a && a.kind === 'anchor') a.text = describe(a, { guardianOn: guardianOf(s).enabled });
    });
    return s;
  }
  // стандартные планы другой персоны (не тронутые клиентом) заменяем планами текущей
  function fitPlansToPersona(s) {
    const other = persona === 'mom' ? 'self' : 'mom';
    const ids = (s.plans || []).map((p) => p.id).sort().join(',');
    if (ids && ids === PLAN_IDS[other].slice().sort().join(',')) { s.plans = defaultPlans(persona); return true; }
    return false;
  }

  let state = null;
  let lastRaw = null; // последняя строка, которую мы прочитали/записали в localStorage (null — ещё не было)
  function parseRaw(raw) {
    try { const s = JSON.parse(raw); if (valid(s)) return upgrade(s); } catch (e) { /* повреждено */ }
    return null;
  }
  // Актуальное состояние: из localStorage (если другая вкладка изменила), иначе — из памяти.
  // Без хранилища работает в памяти; ключ удалён сбросом — к статьям по умолчанию.
  function sync() {
    const raw = lsGet(KEY);
    if (raw != null) {
      if (raw === lastRaw && state) return state;
      const s = parseRaw(raw);
      if (s) {
        const first = !state;
        state = s; lastRaw = raw;
        if (first && fitPlansToPersona(state)) persist();
        return state;
      }
      if (state && lastRaw != null) return state;
    } else if (state && lastRaw == null) {
      // хранилище недоступно или ещё не записано (шёл сброс) — живём в памяти и пробуем записать
      persist();
      return state;
    }
    state = defaults();
    lastRaw = null;
    persist();
    signInternal();
    return state;
  }
  function persist() {
    try { if (typeof NX.isResetting === 'function' && NX.isResetting()) return false; } catch (e) { /* ignore */ }
    // в хранилище пишем и уже вычисленное доверенное лицо (с учётом персоны и params.auto):
    // банк читает сырое состояние и иначе взял бы имя по умолчанию из params
    try { state.guardian = guardianOf(state); } catch (e) { /* ignore */ }
    const raw = JSON.stringify(state);
    if (lsSet(KEY, raw)) { lastRaw = raw; return true; }
    return false;
  }

  /* ---------------- подписки ---------------- */
  const subs = [];
  function notify(info) {
    const snap = api.get();
    subs.slice().forEach((fn) => { try { fn(snap, info || {}); } catch (e) { console.error(e); } });
  }
  function commit(info) { persist(); notify(info); }

  /* ---------------- подпись SHA-256 ---------------- */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function canonArticles(st) {
    return canon((st.articles || []).map((a) => ({ id: a.id, n: a.n, kind: a.kind, title: a.title, enabled: !!a.enabled, params: a.params || {}, decision: a.decision || null })));
  }
  function cyrb(str, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  function fallbackHash(str) { return { hash: cyrb(str, 1) + cyrb(str, 7) + cyrb(str, 13) + cyrb(str, 29), algo: 'fallback' }; }
  function digest(str) {
    try {
      const c = window.crypto && window.crypto.subtle;
      if (!c || typeof TextEncoder === 'undefined') return Promise.resolve(fallbackHash(str));
      return c.digest('SHA-256', new TextEncoder().encode(str))
        .then((buf) => ({ hash: Array.prototype.map.call(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''), algo: 'SHA-256' }))
        .catch(() => fallbackHash(str));
    } catch (e) { return Promise.resolve(fallbackHash(str)); }
  }
  // пересчитать отпечаток текущей версии (без нового номера версии)
  function signInternal() {
    const ver = state.version;
    const body = canonArticles(state);
    return digest(body).then((h) => {
      sync();
      if (state.version !== ver || canonArticles(state) !== body) return state.hash;
      state.hash = h.hash; state.hashAlgo = h.algo; state.signedAt = now();
      const last = state.history[state.history.length - 1];
      if (last && last.version === ver && !last.hash) last.hash = h.hash;
      commit({ type: 'sign', version: ver });
      return h.hash;
    }).catch(() => state.hash);
  }
  // новая версия после применённой поправки: версия растёт сразу, отпечаток — асинхронно
  function bump() { state.version = (Number(state.version) || 1) + 1; state.hash = ''; }
  function amend(kind, articleId, summary, extra) {
    state.amendNo = (Number(state.amendNo) || 0) + 1;
    const am = Object.assign({ id: uid('am'), no: state.amendNo, ts: now(), version: state.version, articleId: articleId || null, kind, summary }, extra || {});
    state.history.push(am);
    if (state.history.length > 120) state.history = state.history.slice(-120);
    return am;
  }

  /* ---------------- сравнение: усиление или ослабление ---------------- */
  const HIGHER_WEAKER = ['amount', 'ratio', 'tolerance', 'unplannedOver'];
  const AMOUNT_GATED = ['new_recipient_limit', 'amount_limit', 'call_guard', 'night_guard', 'crypto_guard', 'abroad_guard'];
  // значение параметра так, как его применяет evalArticle (больше — слабее)
  function effParam(k, v) {
    const n = Number(v);
    if (k === 'amount') return v == null || !isFinite(n) || n < 0 ? 0 : n;
    if (k === 'ratio') return v == null || !(n > 0) ? 3 : n;
    if (k === 'tolerance') return v == null || !isFinite(n) ? 0.5 : n;
    if (k === 'unplannedOver') return v == null || !(n > 0) ? Infinity : n;
    return isFinite(n) ? n : 0;
  }
  function applyPatch(a, patch) {
    const b = clone(a);
    const pt = patch || {};
    if (pt.enabled !== undefined) b.enabled = !!pt.enabled;
    if (pt.decision !== undefined) b.decision = pt.decision;
    if (pt.title !== undefined) b.title = String(pt.title);
    if (pt.params && typeof pt.params === 'object') b.params = Object.assign({}, b.params || {}, pt.params);
    if (b.kind === 'guardian_help' && pt.params && (pt.params.name !== undefined || pt.params.relation !== undefined)) b.params.auto = false;
    if (pt.text !== undefined) b.text = String(pt.text); else b.text = describe(b);
    return b;
  }
  function weakeningReasons(a, patch) {
    const out = [];
    if (!a) return out;
    const pt = patch || {};
    if (pt.remove) { out.push('remove'); return out; }
    const b = applyPatch(a, pt);
    if (a.enabled && !b.enabled) out.push('disable');
    if (DECISION_RANK[decisionOf(b)] < DECISION_RANK[decisionOf(a)]) out.push('decision');
    const pa = a.params || {}, pb = b.params || {};
    // сравниваем «действующие» значения: нет порога суммы = каждый перевод; unplannedOver ≤ 0 = правило выключено
    HIGHER_WEAKER.forEach((k) => {
      if (pa[k] == null && pb[k] == null) return;
      if (k === 'amount' && AMOUNT_GATED.indexOf(a.kind) < 0) return;
      if (effParam(k, pb[k]) > effParam(k, pa[k])) out.push(k);
    });
    if (a.kind === 'anchor' && (Number(pb.delayHours) || 24) < (Number(pa.delayHours) || 24)) out.push('delayHours');
    if (pa.guardian && !pb.guardian) out.push('guardian');
    if (a.kind === 'call_guard' ? pa.newOnly === false && pb.newOnly !== false : !pa.newOnly && pb.newOnly) out.push('newOnly');
    // окно времени: ослабление, если хотя бы один час, который был под защитой, из окна выпал
    if (a.kind === 'night_guard' && (pb.from !== pa.from || pb.to !== pa.to)) {
      for (let h = 0; h < 24; h++) { if (inWindow(h, pa.from, pa.to) && !inWindow(h, pb.from, pb.to)) { out.push('window'); break; } }
    }
    if (a.kind === 'guardian_help') {
      const ga = guardianOf({ articles: [a] }), gb = guardianOf({ articles: [b] });
      if (ga.name !== gb.name || ga.relation !== gb.relation) out.push('guardian_person');
    }
    return out;
  }
  function changeSummary(a, patch) {
    const n = a.n;
    if (patch && patch.remove) return 'правило «' + a.title + '» удалено';
    const b = applyPatch(a, patch);
    const parts = [];
    if (a.enabled !== b.enabled) parts.push(b.enabled ? 'включено' : 'выключено');
    const pa = a.params || {}, pb = b.params || {};
    if (pa.amount !== pb.amount && pb.amount != null) parts.push(money(pa.amount || 0) + ' → ' + money(pb.amount));
    if (pa.unplannedOver !== pb.unplannedOver && pb.unplannedOver != null) parts.push('без плана: ' + money(pa.unplannedOver || 0) + ' → ' + money(pb.unplannedOver));
    if (pa.ratio !== pb.ratio && pb.ratio != null) parts.push('×' + ratioText(pa.ratio || 0) + ' → ×' + ratioText(pb.ratio));
    if (pa.tolerance !== pb.tolerance && pb.tolerance != null) parts.push(pct(pa.tolerance) + ' → ' + pct(pb.tolerance));
    if (pa.delayHours !== pb.delayHours && pb.delayHours != null) parts.push(pa.delayHours + ' ч → ' + pb.delayHours + ' ч');
    if ((pa.from !== pb.from || pa.to !== pb.to) && pb.from != null) parts.push(hh(pa.from) + '–' + hh(pa.to) + ' → ' + hh(pb.from) + '–' + hh(pb.to));
    if (decisionOf(a) !== decisionOf(b)) parts.push(DECISION_LABEL[decisionOf(a)] + ' → ' + DECISION_LABEL[decisionOf(b)]);
    if (!!pa.guardian !== !!pb.guardian) parts.push(pb.guardian ? 'с подтверждением доверенного лица' : 'без подтверждения доверенного лица');
    if (a.kind === 'guardian_help') { const ga = guardianOf({ articles: [a] }), gb = guardianOf({ articles: [b] }); if (ga.name !== gb.name) parts.push(ga.name + ' → ' + gb.name); }
    if (a.title !== b.title) parts.push('название: «' + b.title + '»');
    return '«' + a.title + '»: ' + (parts.length ? parts.join(', ') : 'уточнена формулировка');
  }

  /* ---------------- вспомогательное для оценки ---------------- */
  const normName = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-яәғқңөұүһі]+/g, ' ').trim();
  const normAcc = (s) => String(s || '').replace(/[\s().-]/g, '').toUpperCase();
  // план действует, только когда прошёл срок Якоря (activeAt снимается в applyDue)
  const planActive = (p) => !!p && !p.activeAt;
  // сопоставление строгое: по id известного получателя, по точному реквизиту или по точному имени — без подстрок
  function matchPlan(st, tx) {
    const plans = (st.plans || []).filter(planActive);
    if (tx.recipientId) { const p = plans.find((x) => x.recipientId && x.recipientId === tx.recipientId); if (p) return p; }
    const nm = normName(tx.recipientName), acc = normAcc(tx.account);
    if (!nm && !acc) return null;
    return plans.find((p) => {
      if (p.recipientId && tx.recipientId) return false; // у обоих есть id, и они разные
      const pa = normAcc(p.account || p.recipient);
      if (acc && pa && acc.length >= 6 && pa === acc) return true;
      const pr = normName(p.recipient);
      return !!(pr && nm && pr.length >= 3 && pr === nm);
    }) || null;
  }
  const CRYPTO_RE = /крипт|биткоин|bitcoin|\bbtc\b|usdt|tether|binance|bybit|\bokx\b|криптобирж|кошел[её]к/i;
  function isCrypto(tx) {
    if (tx.crypto || tx.accountKind === 'crypto') return true;
    if (CRYPTO_RE.test(String(tx.recipientName || '') + ' ' + String(tx.account || ''))) return true;
    const c = String(tx.account || '').replace(/[\s().-]/g, '');
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(c) || /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/.test(c) || /^0x[0-9a-fA-F]{40}$/.test(c);
  }
  function isAbroad(tx) {
    if (tx.abroad) return true;
    const c = String(tx.account || '').replace(/[\s().-]/g, '').toUpperCase();
    if (/^[A-Z]{2}\d{2}[0-9A-Z]{10,30}$/.test(c) && c.slice(0, 2) !== 'KZ') return true;
    return /^\+\d{8,15}$/.test(c) && c.charAt(1) !== '7';
  }
  function inWindow(h, from, to) { const f = Number(from), t = Number(to); if (f === t) return true; return f < t ? h >= f && h < t : h >= f || h < t; }
  const IOC_ACTIVE = ['suspected', 'corroborated', 'confirmed'];
  const IOC_LABEL = { suspected: 'на проверке', corroborated: 'подтверждён корреляцией', confirmed: 'подтверждён аналитиком' };

  function evalArticle(a, tx, st) {
    const p = a.params || {};
    const amount = Number(tx.amount) || 0;
    const newRec = !!tx.newRecipient;
    const over = (lim) => amount > (Number(lim) || 0);
    const tail = p.guardian ? ' — нужно подтверждение доверенного лица' : '';
    if (p.newOnly && a.kind !== 'call_guard' && a.kind !== 'new_recipient_limit' && !newRec) return null;
    switch (a.kind) {
      case 'new_recipient_limit':
        if (!newRec || !over(p.amount)) return null;
        return p.amount > 0 ? 'Новый получатель и сумма ' + money(amount) + ' больше вашего порога ' + money(p.amount) + tail : 'Перевод новому получателю — вы решили проверять каждый такой перевод' + tail;
      case 'amount_limit':
        if (!over(p.amount)) return null;
        return 'Сумма ' + money(amount) + ' больше вашего лимита одной операции ' + money(p.amount) + tail;
      case 'flagged_accounts':
        if (tx.mule) return 'Вы сами запретили переводы на подозрительные счета: получатель есть в базе дропов банка';
        if (tx.ioc && IOC_ACTIVE.indexOf(tx.ioc.status) >= 0) return 'Вы сами запретили переводы на подозрительные счета: реквизит в стоп-листе NEXUS (' + IOC_LABEL[tx.ioc.status] + ')' + (tx.ioc.status === 'suspected' ? '. Это ваше правило, а не заморозка банком' : '');
        return null;
      case 'amount_spike': {
        const avg = Number(tx.avg) || 0;
        const ratio = Number(p.ratio) || 3;
        if (avg <= 0 || amount < 10000 || amount <= ratio * avg) return null;
        // запланированная операция в пределах плана — не «резкий скачок»
        const plan = matchPlan(st, tx);
        if (plan) {
          const pa = (st.articles || []).find((x) => x.kind === 'plan_deviation');
          const tol = pa && pa.params && pa.params.tolerance != null ? Number(pa.params.tolerance) : 0.5;
          if (amount <= (Number(plan.amount) || 0) * (1 + tol)) return null;
        }
        return 'Сумма в ' + ratioText(amount / avg) + '× больше вашего обычного перевода (' + money(avg) + ') — нужно повторное подтверждение' + tail;
      }
      case 'plan_deviation': {
        const tol = p.tolerance == null ? 0.5 : Number(p.tolerance);
        const plan = matchPlan(st, tx);
        if (plan) {
          const lim = (Number(plan.amount) || 0) * (1 + tol);
          if (amount <= lim) return null;
          return 'По плану «' + plan.label + '» — ' + money(plan.amount) + ', а перевод ' + money(amount) + ' (+' + Math.round((amount / plan.amount - 1) * 100) + '%) — включается защитный режим';
        }
        const un = Number(p.unplannedOver) || 0;
        if (!un || amount <= un) return null;
        return 'Незапланированный перевод ' + money(amount) + ' больше ' + money(un) + ' — включается защитный режим';
      }
      case 'call_guard': {
        if (!tx.callActive) return null;
        const newOnly = p.newOnly !== false;
        if (newOnly && !newRec) return null;
        if (!over(p.amount)) return null;
        return 'Идёт телефонный звонок (сигнал SDK)' + (newOnly ? ', а получатель новый' : '') + ' — перевод только после проверки' + tail;
      }
      case 'night_guard': {
        const h = new Date(tx.now || now()).getHours();
        if (!inWindow(h, p.from, p.to) || !over(p.amount)) return null;
        return 'Сейчас ' + fmtHM(tx.now || now()) + ' — действует ваш режим ' + hh(p.from) + '–' + hh(p.to) + (p.amount > 0 ? ', сумма больше ' + money(p.amount) : '') + tail;
      }
      case 'crypto_guard':
        if (!isCrypto(tx) || !over(p.amount)) return null;
        return 'Получатель похож на криптобиржу или криптокошелёк — вы сами ограничили такие переводы' + tail;
      case 'abroad_guard':
        if (!isAbroad(tx) || !over(p.amount)) return null;
        return 'Перевод за границу — вы сами ограничили такие переводы' + tail;
      default: return null;
    }
  }

  function evaluateOn(st, txIn) {
    const tx = Object.assign({}, txIn || {});
    tx.now = Number(tx.now) || now();
    if (tx.callActive === undefined) tx.callActive = isCallActive();
    if (tx.newRecipient === undefined) tx.newRecipient = !tx.known;
    const hits = [];
    (st.articles || []).forEach((a) => {
      if (!a || !a.enabled || EVAL_KINDS.indexOf(a.kind) < 0) return;
      let why = null;
      try { why = evalArticle(a, tx, st); } catch (e) { why = null; }
      if (!why) return;
      const dec = a.params && a.params.guardian ? (DECISION_RANK[decisionOf(a)] >= 2 ? decisionOf(a) : 'hold') : decisionOf(a);
      hits.push({ articleId: a.id, n: a.n, kind: a.kind, title: a.title, decision: dec, why, guardian: !!(a.params && a.params.guardian) });
    });
    const pr = st.protective || {};
    const protective = !!(pr.active && (!pr.until || pr.until > tx.now));
    if (protective && Number(tx.amount) > 0) {
      const n = pr.articleN === 0 ? 0 : (pr.articleN || 4);
      const until = pr.until ? ' до ' + fmtDT(pr.until) : '';
      const lbl = n === 0 ? 'Защитный режим (включён вами вручную)' : 'Защитный режим (ваше правило)';
      if (tx.newRecipient) hits.push({ articleId: 'protective', n, kind: 'protective_mode', title: 'Защитный режим', decision: 'hold', why: lbl + until + ': переводы новым получателям удерживаются до проверки' });
      else if (Number(tx.amount) > 50000) hits.push({ articleId: 'protective', n, kind: 'protective_mode', title: 'Защитный режим', decision: 'confirm', why: lbl + until + ': переводы больше 50 000 ₸ — только с повторным подтверждением' });
    }
    let decision = 'allow';
    hits.forEach((h) => { if (DECISION_RANK[h.decision] > DECISION_RANK[decision]) decision = h.decision; });
    hits.sort((x, y) => DECISION_RANK[y.decision] - DECISION_RANK[x.decision] || x.n - y.n);
    const g = guardianOf(st);
    const ga = (st.articles || []).find((a) => a.id === 'a_guardian');
    // запрос доверенному лицу уходит только при включённой статье 5 (так же решает reportTransfer)
    const gOn = !!(ga && ga.enabled);
    const wantGuardian = DECISION_RANK[decision] >= 2 || hits.some((h) => h.guardian);
    let guardian = null;
    if (wantGuardian && gOn) guardian = { needed: true, enabled: true, name: g.name, relation: g.relation, articleN: ga.n };
    else if (hits.some((h) => h.guardian)) guardian = { needed: false, enabled: false, name: g.name, relation: g.relation, articleN: ga ? ga.n : 5 };
    return {
      hits, decision, protective,
      protectiveTriggered: hits.some((h) => h.decision === 'protect'),
      guardian,
    };
  }

  /* ---------------- атака / звонок: можно ли ослаблять ---------------- */
  function threatState(ctx) {
    const c = ctx || {};
    if (c.callActive || isCallActive()) return 'call';
    if (c.underAttack) return 'attack';
    try {
      const a = NX.Core && typeof NX.Core.assess === 'function' ? NX.Core.assess() : null;
      if (a && a.level && (a.level.key === 'high' || a.level === 'high')) return 'attack';
      if (a && Array.isArray(a.parts) && a.parts.some((p) => p.key === 'call' || p.key === 'remote')) return 'attack';
    } catch (e) { /* ignore */ }
    return null;
  }
  const REFUSAL_TEXT = {
    call: 'Во время телефонного звонка ослабить правила нельзя — мошенник не сможет уговорить вас отключить защиту, пока он на линии',
    attack: 'NEXUS Core видит признаки атаки за последние 60 минут — ослабление правил временно запрещено',
  };
  const anchorArticle = () => state.articles.find((a) => a.id === 'a_anchor');

  /* ---------------- изменения статей ---------------- */
  function doApply(a, patch) {
    const i = state.articles.findIndex((x) => x.id === a.id);
    if (i < 0) return null;
    if (patch && patch.remove) { state.articles.splice(i, 1); refreshAnchorText(); return null; }
    state.articles[i] = applyPatch(state.articles[i], patch);
    refreshAnchorText();
    return state.articles[i];
  }
  // текст статьи 7 следует за статьёй 5 (обещание уведомления — только при включённом доверенном лице)
  function refreshAnchorText() {
    const anc = state.articles.find((x) => x.kind === 'anchor');
    if (anc) anc.text = describe(anc, { guardianOn: guardianOf(state).enabled });
  }
  const PATCH_FIELDS = ['enabled', 'decision', 'title', 'text'];
  // в поправку попадает только то, что действительно меняется: иначе отложенное ослабление
  // вернуло бы старые значения параметров, которые клиент успел усилить
  function diffPatch(a, pt) {
    if (pt.remove) return { remove: true };
    const out = {};
    PATCH_FIELDS.forEach((k) => {
      if (pt[k] === undefined) return;
      const cur = k === 'enabled' ? !!a.enabled : k === 'decision' ? decisionOf(a) : a[k];
      const nxt = k === 'enabled' ? !!pt[k] : k === 'decision' ? decisionOf(Object.assign({}, a, { decision: pt[k] })) : pt[k];
      if (cur !== nxt) out[k] = pt[k];
    });
    if (pt.params && typeof pt.params === 'object') {
      const pa = a.params || {};
      const params = {};
      Object.keys(pt.params).forEach((k) => {
        // имя/отношение доверенного лица сравниваем не с хранимыми params (там может быть «auto»), а оставляем как есть
        if (a.kind === 'guardian_help' && (k === 'name' || k === 'relation')) { params[k] = pt.params[k]; return; }
        if (canon(pt.params[k]) !== canon(pa[k])) params[k] = pt.params[k];
      });
      if (Object.keys(params).length) out.params = params;
    }
    return out;
  }
  const patchEmpty = (p) => !p || (!p.remove && !PATCH_FIELDS.some((k) => p[k] !== undefined) && !(p.params && Object.keys(p.params).length));
  // усиление после запроса ослабления: из ожидающих поправок той же статьи убираем всё, что клиент сейчас усилил
  function rebasePending(a, pt, t) {
    state.pending.filter((ch) => ch.status === 'pending' && ch.articleId === a.id && ch.patch && !ch.patch.remove).forEach((ch) => {
      const p = ch.patch;
      PATCH_FIELDS.forEach((k) => { if (pt[k] !== undefined) delete p[k]; });
      if (pt.params && p.params) { Object.keys(pt.params).forEach((k) => { delete p.params[k]; }); if (!Object.keys(p.params).length) delete p.params; }
      const cur = state.articles.find((x) => x.id === a.id);
      const reasons = cur && !patchEmpty(p) ? weakeningReasons(cur, p) : [];
      if (!reasons.length) {
        ch.status = 'cancelled'; ch.cancelledAt = t; ch.cancelledBy = 'strengthen';
        closeChangeRequest(ch);
        amend('weaken_cancelled', a.id, 'Ожидающее ослабление снято: правило «' + a.title + '» усилено после запроса', { changeId: ch.id });
      } else {
        ch.reasons = reasons;
        ch.summary = changeSummary(cur, p);
      }
    });
  }
  function requestChange(articleId, patch, ctx) {
    try {
      sync();
      const c = ctx || {};
      const a = state.articles.find((x) => x.id === articleId);
      if (!a) return { applied: false, delayed: false, refused: 'not_found', reason: 'Правило не найдено', article: null };
      const pt = diffPatch(a, clone(patch || {}));
      const weak = weakeningReasons(a, pt);
      if (!weak.length) {
        const summary = changeSummary(a, pt);
        const art = doApply(a, pt);
        if (!patchEmpty(pt)) rebasePending(a, pt, now());
        bump();
        amend('strengthen', a.id, summary + ' (усиление, сразу)');
        commit({ type: 'change', action: 'strengthen', articleId: a.id });
        signInternal();
        emit('constitution_change', { action: 'strengthen', articleN: a.n, summary });
        return { applied: true, delayed: false, article: clone(art) };
      }
      const anc = anchorArticle();
      const anchorOn = !!(anc && anc.enabled);
      // своя только что добавленная статья: удалить сразу (исправление ошибки), но не во время звонка
      const grace = pt.remove && !a.builtin && now() - (a.createdAt || 0) < GRACE_REMOVE_MS;
      if (anchorOn) {
        const threat = threatState(c);
        if (threat) {
          const summary = changeSummary(a, pt);
          amend('refused', a.id, 'Отклонено якорем: ' + summary + ' — ' + (threat === 'call' ? 'идёт телефонный звонок' : 'NEXUS Core видит признаки атаки'));
          commit({ type: 'change', action: 'refused', articleId: a.id, refused: threat });
          emit('constitution_change', { action: 'refused', reason: threat, articleN: a.n, summary: summary + ' — ' + REFUSAL_TEXT[threat] });
          return { applied: false, delayed: false, refused: threat, reason: REFUSAL_TEXT[threat], article: clone(a) };
        }
      }
      if (!anchorOn || grace) {
        const summary = changeSummary(a, pt);
        const art = doApply(a, pt);
        bump();
        amend(pt.remove ? 'remove' : 'weaken_applied', a.id, summary + (grace ? ' (своя статья удалена в первые 10 минут)' : ' (якорь выключен — сразу)'));
        commit({ type: 'change', action: pt.remove ? 'remove' : 'weaken_applied', articleId: a.id });
        signInternal();
        emit('constitution_change', { action: pt.remove ? 'remove' : 'weaken_applied', articleN: a.n, summary });
        return { applied: true, delayed: false, article: clone(art) };
      }
      // ослабление через Правило 24 часов
      const delayH = Number(anc.params && anc.params.delayHours) || 24;
      const t = now();
      state.pending.filter((ch) => ch.status === 'pending' && ch.articleId === a.id).forEach((ch) => { ch.status = 'cancelled'; ch.cancelledAt = t; closeChangeRequest(ch); });
      const summary = changeSummary(a, pt);
      const ch = { id: uid('chg'), articleId: a.id, articleN: a.n, patch: pt, kind: 'weaken', reasons: weak, summary, requestedAt: t, effectiveAt: t + delayH * HOUR, by: c.by || 'client', status: 'pending' };
      state.pending.push(ch);
      if (state.pending.length > 40) state.pending = state.pending.slice(-40);
      const g = guardianOf(state);
      amend('weaken_requested', a.id, summary + ' (ослабление: вступит в силу ' + fmtDT(ch.effectiveAt) + (g.enabled ? ', доверенное лицо уведомлено)' : ', доверенное лицо выключено — уведомление не отправлено)'), { changeId: ch.id });
      if (g.enabled) ch.guardianRequestId = addRequest({ purpose: 'weaken', reason: 'Запрошено ослабление: ' + summary + '. Вступит в силу ' + fmtDT(ch.effectiveAt) + ' — отменить можно в любой момент', articleN: anc.n, changeId: ch.id });
      commit({ type: 'change', action: 'weaken_requested', articleId: a.id, changeId: ch.id });
      emit('constitution_change', { action: 'weaken_requested', articleN: a.n, summary, effectiveAt: ch.effectiveAt, guardianNotified: !!g.enabled });
      return { applied: false, delayed: true, effectiveAt: ch.effectiveAt, changeId: ch.id, guardianNotified: !!g.enabled, article: clone(a) };
    } catch (e) {
      console.error(e);
      return { applied: false, delayed: false, refused: 'error', reason: 'Не удалось изменить правило', article: null };
    }
  }
  // запрос доверенному лицу по ослаблению закрывается, когда изменение применено или отменено
  function closeChangeRequest(ch) {
    (state.requests || []).forEach((r) => { if (r.changeId === ch.id && r.status === 'pending') { r.status = 'closed'; r.resolvedAt = now(); r.by = ch.status; } });
  }
  function applyChange(ch, demo) {
    const a = state.articles.find((x) => x.id === ch.articleId);
    ch.status = 'applied'; ch.appliedAt = now();
    delete ch.held;
    closeChangeRequest(ch);
    if (demo) ch.demo = true;
    if (!a) return false;
    // итог считаем по текущей статье: в поправке остались только ещё не усиленные ключи
    const summary = patchEmpty(ch.patch) ? (ch.summary || '') : changeSummary(a, ch.patch);
    doApply(a, ch.patch);
    bump();
    amend(ch.patch && ch.patch.remove ? 'remove' : 'weaken_applied', ch.articleId, summary + (demo ? ' (демо: промотано 24 ч)' : ' (ослабление вступило в силу после ожидания)'), { changeId: ch.id, demo: !!demo });
    emit('constitution_change', { action: ch.patch && ch.patch.remove ? 'remove' : 'weaken_applied', articleN: a.n, summary });
    return true;
  }
  // во время звонка / атаки ослабление не вступает в силу даже по истечении срока — ждёт, пока угроза пройдёт
  function weakenBlockedNow(ctx) {
    const anc = anchorArticle();
    return anc && anc.enabled ? threatState(ctx) : null;
  }
  const HOLD_TEXT = { call: 'идёт телефонный звонок', attack: 'NEXUS Core видит признаки атаки' };
  // отметить отложенную поправку; true — если отметка новая (тогда нужна запись в историю и уведомление)
  function markHeld(ch, threat, t) {
    if (ch.held && ch.held.reason === threat) return false;
    ch.held = { reason: threat, at: t, text: REFUSAL_TEXT[threat] };
    amend('refused', ch.articleId, 'Ослабление не вступило в силу: ' + (ch.summary || 'правило') + ' — ' + HOLD_TEXT[threat] + '. Применится, когда угроза пройдёт', { changeId: ch.id });
    emit('constitution_change', { action: 'refused', held: true, refused: threat, reason: threat, articleN: ch.articleN, summary: (ch.summary || '') + ' — ' + REFUSAL_TEXT[threat] });
    return true;
  }
  function applyDue(ctx) {
    try {
      sync();
      const t = now();
      let n = 0, heldNew = 0, plansOn = 0;
      const due = state.pending.filter((ch) => ch.status === 'pending' && ch.effectiveAt <= t);
      const duePlans = (state.plans || []).filter((p) => p.activeAt && p.activeAt <= t);
      const threat = due.length || duePlans.length ? weakenBlockedNow(ctx) : null;
      due.forEach((ch) => {
        if (threat) { if (markHeld(ch, threat, t)) heldNew++; return; }
        if (applyChange(ch, false)) n++;
      });
      duePlans.forEach((p) => {
        if (threat) { if (!(p.held && p.held.reason === threat)) { p.held = { reason: threat, at: t, text: REFUSAL_TEXT[threat] }; heldNew++; } return; }
        activatePlan(p, false); plansOn++;
      });
      let expired = false;
      const pr = state.protective;
      if (pr && pr.active && pr.until && pr.until <= t) { setProtectiveOff('expired'); expired = true; }
      if (n || expired || heldNew || plansOn) { commit({ type: 'apply_due', applied: n, held: heldNew, plans: plansOn, protectiveExpired: expired }); if (n) signInternal(); }
      return n;
    } catch (e) { console.error(e); return 0; }
  }
  function cancelChange(changeId) {
    sync();
    const ch = state.pending.find((x) => x.id === changeId && x.status === 'pending');
    if (!ch) return false;
    ch.status = 'cancelled'; ch.cancelledAt = now();
    closeChangeRequest(ch);
    const a = state.articles.find((x) => x.id === ch.articleId);
    amend('weaken_cancelled', ch.articleId, 'Отменено ослабление: ' + (ch.summary || (a ? '«' + a.title + '»' : 'правило')), { changeId: ch.id });
    commit({ type: 'change', action: 'weaken_cancelled', changeId });
    emit('constitution_change', { action: 'weaken_cancelled', articleN: a ? a.n : ch.articleN, summary: ch.summary || '' });
    return true;
  }
  // Демо «Промотать 24 ч». Возвращает число применённых поправок (0 — если во время звонка/атаки:
  // поправка остаётся в ожидании, причина — в pendingChanges()[i].held и в lastHold()).
  let lastHoldInfo = null;
  function demoFastForward(changeId, ctx) {
    sync();
    const list = state.pending.filter((ch) => ch.status === 'pending' && (!changeId || ch.id === changeId));
    const plansDue = (state.plans || []).filter((p) => p.activeAt && (!changeId || p.id === changeId));
    lastHoldInfo = null;
    if (!list.length && !plansDue.length) return 0;
    const threat = weakenBlockedNow(ctx);
    if (threat) {
      const t = now();
      let fresh = 0;
      list.forEach((ch) => { if (markHeld(ch, threat, t)) fresh++; });
      lastHoldInfo = { refused: threat, reason: REFUSAL_TEXT[threat] + '. Ослабление останется в ожидании и вступит в силу, когда угроза пройдёт', count: list.length + plansDue.length };
      commit({ type: 'change', action: 'weaken_held', demo: true, refused: threat });
      try { if (typeof NX.toast === 'function') NX.toast('Промотать нельзя', lastHoldInfo.reason, 'warn', 'anchor'); } catch (e) { /* ignore */ }
      return 0;
    }
    let n = 0;
    list.forEach((ch) => { if (applyChange(ch, true)) n++; });
    plansDue.forEach((p) => { activatePlan(p, true); n++; });
    if (n) { commit({ type: 'change', action: 'weaken_applied', demo: true }); signInternal(); }
    return n;
  }

  // номер следующей статьи: после встроенных 1–7 и дополнительной 8 идёт 9, 10…
  // без пропусков: номер последней статьи + 1 (так же считает превью «Будущая статья N» в кабинете)
  function nextArticleN(st) {
    const arts = (st && st.articles) || [];
    return arts.reduce((m, a) => Math.max(m, Number(a.n) || 0), 0) + 1;
  }
  function addArticle(article) {
    try {
      sync();
      const src = article || {};
      if (!src.kind || !KINDS[src.kind] || src.kind === 'anchor' || src.kind === 'guardian_help') return null;
      const n = nextArticleN(state);
      const a = {
        id: uid('art'), n, kind: src.kind, title: String(src.title || KINDS[src.kind].title).slice(0, 80), text: '',
        enabled: true, params: Object.assign({}, src.params || {}), builtin: false, createdAt: now(),
      };
      if (src.decision && DECISION_RANK[src.decision]) a.decision = src.decision;
      if (src.phrase) a.phrase = String(src.phrase).slice(0, 300);
      a.text = src.text ? String(src.text).slice(0, 300) : describe(a);
      state.articles.push(a);
      bump();
      amend('add', a.id, 'Правило «' + a.title + '» добавлено (усиление, сразу)');
      commit({ type: 'change', action: 'add', articleId: a.id });
      signInternal();
      emit('constitution_change', { action: 'add', articleN: n, summary: a.text });
      return clone(a);
    } catch (e) { console.error(e); return null; }
  }
  function removeArticle(id, ctx) { return requestChange(id, { remove: true }, ctx); }
  function setArticleEnabled(id, on, ctx) { return requestChange(id, { enabled: !!on }, ctx); }
  function setGuardian(patch, ctx) {
    const p = patch || {};
    const params = {};
    if (p.name !== undefined) params.name = String(p.name).slice(0, 60);
    if (p.relation !== undefined) params.relation = String(p.relation).slice(0, 40);
    const pt = {};
    if (Object.keys(params).length) pt.params = params;
    if (p.enabled !== undefined) pt.enabled = !!p.enabled;
    return requestChange('a_guardian', pt, ctx);
  }

  /* ---------------- планы ---------------- */
  // Новый план ослабляет статьи 3 и 4 (переводы в пределах плана не считаются скачком/отклонением),
  // поэтому он идёт через Правило 24 часов как любое ослабление: начинает действовать через delayHours,
  // доверенное лицо получает уведомление и может отклонить план. Удаление плана — усиление, сразу.
  function closePlanRequest(p, by) {
    (state.requests || []).forEach((r) => { if (r.planId === p.id && r.status === 'pending') { r.status = 'closed'; r.resolvedAt = now(); r.by = by; } });
  }
  function activatePlan(p, demo) {
    p.activeAt = null; delete p.held;
    closePlanRequest(p, 'applied');
    amend('weaken_applied', null, 'План «' + p.label + '» — ' + p.recipient + ', ' + money(p.amount) + ' начал действовать' + (demo ? ' (демо: промотано 24 ч)' : ' (после ожидания правила 24 часов)'));
    emit('constitution_change', { action: 'weaken_applied', articleN: 4, summary: 'План «' + p.label + '» начал действовать' });
  }
  function knownRecipientId(name) {
    const nm = normName(name);
    const list = Array.isArray(NX.KNOWN_RECIPIENTS) ? NX.KNOWN_RECIPIENTS : [];
    const r = nm ? list.find((x) => normName(x.name) === nm) : null;
    return r ? r.id : null;
  }
  function planView(p) {
    const v = clone(p);
    if (p.activeAt) {
      v.pending = true;
      v.note = (p.held ? 'ждёт: ' + HOLD_TEXT[p.held.reason] : 'начнёт действовать ' + fmtDT(p.activeAt) + ' (Правило 24 часов)') + (p.note ? ' · ' + p.note : '');
    }
    return v;
  }
  const plans = {
    list() { sync(); return state.plans.map(planView); },
    // Раздел «Мои планы» внутри документа конституции: планы — основа статьи 4 «Отклонение от плана».
    // Для каждого плана — порог, после которого включается защитный режим (сумма плана × (1 + допуск)).
    section() {
      sync();
      const art = state.articles.find((a) => a.kind === 'plan_deviation') || null;
      const p = (art && art.params) || {};
      const tol = p.tolerance == null ? 0.5 : Number(p.tolerance);
      const un = Number(p.unplannedOver) || 0;
      const items = state.plans.map((x) => {
        const v = planView(x);
        v.limit = Math.round((Number(x.amount) || 0) * (1 + tol));
        v.limitText = 'больше ' + money(v.limit) + ' — защитный режим';
        v.active = planActive(x);
        return v;
      });
      const activeItems = items.filter((x) => x.active);
      const monthly = activeItems.filter((x) => x.day).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const count = items.length;
      const summary = count
        ? count + ' ' + plural(count, ['план', 'плана', 'планов']) + (monthly ? ' · ежемесячно ' + money(monthly) : '') + (items.length > activeItems.length ? ' · ' + (items.length - activeItems.length) + ' ждёт правила 24 часов' : '')
        : 'Планов пока нет';
      return {
        articleN: art ? art.n : 4,
        article: art ? { id: art.id, n: art.n, title: art.title, enabled: !!art.enabled, text: art.text || describe(art), decision: decisionOf(art) } : null,
        tolerance: tol, tolerancePct: pct(tol), unplannedOver: un, unplannedText: un ? 'Незапланированный перевод больше ' + money(un) + ' — защитный режим' : '',
        items, count, monthly, summary,
        intro: 'Планы — основа правила «' + (art && art.title ? art.title : 'Отклонение от плана') + '»: переводы по плану не считаются необычными. Перевод, который отличается от плана больше чем на ' + pct(tol) + ', включает защитный режим.',
        addNote: 'Новый план начинает действовать через срок правила 24 часов, доверенное лицо получает уведомление. Удалить план можно сразу.',
        empty: 'Добавьте регулярные переводы — аренду, помощь родным, коммунальные платежи. Тогда NEXUS отличит ваши обычные переводы от перевода под диктовку.',
      };
    },
    // какому действующему плану соответствует перевод: {plan, within, limit} или null
    match(tx) {
      sync();
      const t = tx || {};
      const pl = matchPlan(state, { recipientId: t.recipientId || null, recipientName: t.recipientName || t.name || '', account: t.account || '' });
      if (!pl) return null;
      const art = state.articles.find((a) => a.kind === 'plan_deviation');
      const tol = art && art.params && art.params.tolerance != null ? Number(art.params.tolerance) : 0.5;
      const limit = Math.round((Number(pl.amount) || 0) * (1 + tol));
      return { plan: planView(pl), limit, within: (Number(t.amount) || 0) <= limit };
    },
    add(plan, ctx) {
      sync();
      const p = plan || {};
      const anc = anchorArticle();
      const anchorOn = !!(anc && anc.enabled);
      const threat = anchorOn ? threatState(ctx) : null;
      if (threat) return { ok: false, refused: threat, reason: REFUSAL_TEXT[threat].replace('ослабить правила', 'добавлять планы') };
      const amount = Math.round(Number(String(p.amount == null ? '' : p.amount).replace(/[^\d.]/g, '')) || 0);
      const label = String(p.label || '').trim().slice(0, 80);
      const recipient = String(p.recipient || '').trim().slice(0, 80);
      if (!label || !recipient || amount <= 0) return { ok: false, reason: 'Укажите название, получателя и сумму плана' };
      const item = { id: uid('plan'), label, recipient, amount, note: String(p.note || '').slice(0, 120) };
      const rid = p.recipientId ? String(p.recipientId) : knownRecipientId(recipient);
      if (rid) item.recipientId = rid;
      if (p.account) item.account = String(p.account).slice(0, 40);
      if (p.day) item.day = Math.max(1, Math.min(31, Number(p.day) || 1));
      const t = now();
      const delayH = anchorOn ? Number(anc.params && anc.params.delayHours) || 24 : 0;
      if (delayH) item.activeAt = t + delayH * HOUR;
      item.createdAt = t;
      state.plans.push(item);
      const g = guardianOf(state);
      if (delayH) {
        amend('weaken_requested', null, 'План «' + label + '» — ' + recipient + ', ' + money(amount) + ' добавлен: начнёт действовать ' + fmtDT(item.activeAt) +
          (g.enabled ? ', доверенное лицо уведомлено' : ', доверенное лицо выключено — уведомление не отправлено'));
        if (g.enabled) item.guardianRequestId = addRequest({ purpose: 'weaken', reason: 'Добавлен план «' + label + '» — ' + recipient + ', ' + money(amount) + '. Переводы по нему не будут считаться необычными. Начнёт действовать ' + fmtDT(item.activeAt) + ' — отклонить можно в любой момент', articleN: anc.n, planId: item.id });
      } else {
        amend('add', null, 'План «' + label + '» — ' + recipient + ', ' + money(amount) + ' добавлен (якорь выключен — сразу)');
      }
      commit({ type: 'plan', action: 'add', planId: item.id });
      emit('constitution_change', { action: delayH ? 'weaken_requested' : 'weaken_applied', articleN: 4, summary: 'План «' + label + '» — ' + money(amount), effectiveAt: item.activeAt || null, guardianNotified: !!(delayH && g.enabled) });
      return { ok: true, plan: planView(item), delayed: !!delayH, activeAt: item.activeAt || null, guardianNotified: !!(delayH && g.enabled) };
    },
    remove(id) {
      sync();
      const i = state.plans.findIndex((p) => p.id === id);
      if (i < 0) return false;
      const p = state.plans.splice(i, 1)[0];
      closePlanRequest(p, 'cancelled');
      amend('remove', null, 'План «' + p.label + '» удалён' + (p.activeAt ? ' до вступления в силу' : '') + ' (усиление, сразу)');
      commit({ type: 'plan', action: 'remove', planId: id });
      return true;
    },
  };

  /* ---------------- защитный режим ---------------- */
  function enterProtective(reason, articleN, hoursN) {
    sync();
    const t = now();
    const h = Number(hoursN) > 0 ? Number(hoursN) : 24;
    const pr = state.protective || {};
    const until = Math.max(pr.active && pr.until ? pr.until : 0, t + h * HOUR);
    const wasActive = !!(pr.active && (!pr.until || pr.until > t));
    state.protective = { active: true, since: wasActive ? pr.since : t, until, reason: String(reason || pr.reason || 'Сработало ваше правило'), articleN: articleN === 0 ? 0 : (articleN || pr.articleN || 4) };
    const byWho = state.protective.articleN === 0 ? 'Защитный режим включён вами вручную до ' : 'Защитный режим включён вашим правилом до ';
    amend('protective_on', null, (wasActive ? 'Защитный режим продлён до ' : byWho) + fmtDT(until) + ': ' + state.protective.reason);
    commit({ type: 'protective', active: true });
    emit('protective_mode', { active: true, reason: state.protective.reason, articleN: state.protective.articleN, until });
    return clone(state.protective);
  }
  const EXIT_BY = { guardian: 'подтверждено доверенным лицом', expired: 'истёк срок', demo: 'демо: ответ за доверенное лицо', bank: 'снято банком' };
  function setProtectiveOff(by) {
    const pr = state.protective || {};
    state.protective = { active: false, since: null, until: null, reason: '', articleN: null, endedAt: now(), endedBy: by };
    amend('protective_off', null, 'Защитный режим выключен: ' + (EXIT_BY[by] || by));
    emit('protective_mode', { active: false, reason: EXIT_BY[by] || by, articleN: pr.articleN || null, until: null });
  }
  function exitProtective(by) {
    sync();
    const pr = state.protective || {};
    if (!pr.active) return { ok: true, already: true };
    if (!EXIT_BY[by]) return { ok: false, reason: 'need_guardian', text: 'Выйти из защитного режима досрочно можно только с подтверждением доверенного лица — ' + guardianOf(state).name };
    setProtectiveOff(by);
    commit({ type: 'protective', active: false, by });
    return { ok: true };
  }
  function isProtective() {
    sync();
    const pr = state.protective || {};
    if (!pr.active) return false;
    if (pr.until && pr.until <= now()) { setProtectiveOff('expired'); commit({ type: 'protective', active: false, by: 'expired' }); return false; }
    return true;
  }

  /* ---------------- доверенное лицо ---------------- */
  function addRequest(o) {
    const g = guardianOf(state);
    const r = { id: uid('gr'), ts: now(), status: 'pending', purpose: o.purpose || 'check', reason: String(o.reason || 'Нужна ваша проверка'), articleN: o.articleN || 5, guardian: g.name, relation: g.relation };
    if (o.amount) r.amount = Number(o.amount) || 0;
    if (o.recipient) r.recipient = String(o.recipient).slice(0, 80);
    if (o.changeId) r.changeId = o.changeId;
    if (o.planId) r.planId = o.planId;
    state.requests.unshift(r);
    if (state.requests.length > 30) state.requests = state.requests.slice(0, 30);
    amend('guardian', null, 'Запрос доверенному лицу (' + g.name + '): ' + r.reason);
    const payload = { id: r.id, guardian: g.name, reason: r.reason, articleN: r.articleN, purpose: r.purpose };
    try { const u = (window.NX && NX.state && NX.state.user) || {}; if (u.name) payload.client = String(u.name); } catch (e) { /* ignore */ }
    if (r.amount) payload.amount = r.amount;
    emit('guardian_request', payload);
    return r.id;
  }
  function requestGuardian(ctx) {
    sync();
    const c = ctx || {};
    const tx = c.tx || {};
    const id = addRequest({ purpose: c.purpose || 'check', reason: c.reason, articleN: c.articleN, amount: tx.amount || c.amount, recipient: tx.recipient || tx.recipientName || c.recipient });
    commit({ type: 'guardian', action: 'request', id });
    return id;
  }
  function resolveGuardian(id, verdict, by) {
    sync();
    const r = state.requests.find((x) => x.id === id);
    const v = verdict === 'reject' ? 'reject' : 'approve';
    const who = by || 'guardian';
    if (r) { if (r.status !== 'pending') return { ok: false, reason: 'already', verdict: r.status }; r.status = v === 'approve' ? 'approved' : 'rejected'; r.resolvedAt = now(); r.by = who; }
    const g = guardianOf(state);
    amend('guardian', null, g.name + ': ' + (v === 'approve' ? '«Подтверждаю, всё в порядке»' : '«Это мошенники»') + (who === 'demo' ? ' (демо)' : ''));
    emit('guardian_response', { id, verdict: v, by: who });
    if (v === 'reject') {
      if (r && r.changeId) { const ch = state.pending.find((x) => x.id === r.changeId && x.status === 'pending'); if (ch) { ch.status = 'cancelled'; ch.cancelledAt = now(); amend('weaken_cancelled', ch.articleId, 'Доверенное лицо отменило ослабление: ' + (ch.summary || '')); emit('constitution_change', { action: 'weaken_cancelled', articleN: ch.articleN, summary: ch.summary || '' }); } }
      if (r && r.planId) { const i = state.plans.findIndex((p) => p.id === r.planId && p.activeAt); if (i >= 0) { const p = state.plans.splice(i, 1)[0]; amend('weaken_cancelled', null, 'Доверенное лицо отклонило план «' + p.label + '» — ' + p.recipient + ', ' + money(p.amount)); emit('constitution_change', { action: 'weaken_cancelled', articleN: 4, summary: 'План «' + p.label + '» отклонён' }); } }
      commit({ type: 'guardian', action: 'response', id, verdict: v });
      // защитный режим включает доверенное лицо — это статья 5 (а не статья, по которой был запрос)
      enterProtective(g.name + ': нужна проверка — перевод удержан', 5, 24);
    } else {
      const pr = state.protective || {};
      if (pr.active && (!r || r.purpose !== 'weaken')) setProtectiveOff(who === 'demo' ? 'demo' : 'guardian');
      commit({ type: 'guardian', action: 'response', id, verdict: v });
    }
    return { ok: true, verdict: v };
  }
  // запрос больше не нужен (клиент сам отменил перевод): снимаем его без решения доверенного лица
  function withdrawRequest(id, why) {
    sync();
    const r = state.requests.find((x) => x.id === id);
    if (!r || r.status !== 'pending') return false;
    r.status = 'withdrawn'; r.resolvedAt = now(); r.by = 'client'; r.withdrawReason = String(why || '');
    commit({ type: 'guardian', action: 'withdraw', id });
    return true;
  }

  /* ---------------- реакция на результат скоринга перевода ---------------- */
  // Для client.js: после submit перевода — событие на шину, защитный режим, запрос опекуну.
  function reportTransfer(result, inp) {
    try {
      const c = result && result.constitution;
      if (!c || !c.hits || !c.hits.length) return { hits: [], decision: 'allow', protectiveEntered: false, guardianRequestId: null, showAnchor: false };
      sync();
      const i = inp || {};
      const recipient = i.name || i.recipientName || i.account || '';
      const amount = Number(i.amount) || 0;
      state.stats.hits = (Number(state.stats.hits) || 0) + 1; state.stats.lastHitAt = now();
      persist();
      emit('constitution_hit', { hits: c.hits.map((h) => ({ n: h.n, title: h.title, decision: h.decision })), decision: c.decision, amount, recipient });
      let protectiveEntered = false;
      const ph = c.hits.find((h) => h.decision === 'protect');
      if (ph) { enterProtective('Правило «' + ph.title + '»: ' + ph.why, ph.n, 24); protectiveEntered = true; }
      let guardianRequestId = null;
      if (c.guardian && c.guardian.needed && guardianOf(state).enabled) {
        const top = c.hits[0];
        // доверенное лицо не видит реквизитов (§2.5): в тексте и в сохранённом запросе — только «получатель скрыт»
        const masked = recipient ? 'получатель скрыт' : '';
        const step = amount >= 100000 ? 10000 : 1000;
        guardianRequestId = requestGuardian({ reason: 'Перевод ≈' + money(Math.round(amount / step) * step) + (masked ? ' (' + masked + ')' : '') + ' удержан правилом «' + top.title + '». Помогите проверить ситуацию', articleN: top.n, tx: { amount, recipient: masked } });
      }
      notify({ type: 'hit', decision: c.decision });
      return { hits: clone(c.hits), decision: c.decision, protectiveEntered, guardianRequestId, showAnchor: DECISION_RANK[c.decision] >= 2 };
    } catch (e) { console.error(e); return { hits: [], decision: 'allow', protectiveEntered: false, guardianRequestId: null, showAnchor: false }; }
  }

  /* =====================================================================
     «КОНСТИТУЦИЯ СВОИМИ СЛОВАМИ» — офлайн-парсер (RU + немного KZ)
     ===================================================================== */
  const L = 'a-zа-яәғқңөұүһі';
  const WN = {
    один: 1, одна: 1, одну: 1, одной: 1, два: 2, две: 2, двух: 2, три: 3, трех: 3, четыре: 4, пять: 5, пяти: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
    десять: 10, десяти: 10, пятнадцать: 15, двадцать: 20, двадцати: 20, тридцать: 30, тридцати: 30, сорок: 40, сорока: 40, пятьдесят: 50, пятидесяти: 50,
    шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, ста: 100, двести: 200, двухсот: 200, триста: 300, трехсот: 300,
    четыреста: 400, четырехсот: 400, пятьсот: 500, пятисот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
    'бір': 1, 'екі': 2, 'үш': 3, 'төрт': 4, 'бес': 5, 'алты': 6, 'жеті': 7, 'сегіз': 8, 'тоғыз': 9, 'он': 10, 'жиырма': 20, 'отыз': 30,
    'қырық': 40, 'елу': 50, 'алпыс': 60, 'жетпіс': 70, 'сексен': 80, 'тоқсан': 90, 'жүз': 100,
  };
  function multWord(w) {
    if (/^(млн|миллион[а-я]*|million|mln)$/.test(w)) return 1e6;
    if (/^(тыс|тыс\.|тысяч[а-я]*|тысяча|тысячи|мың|мын|thousand)$/.test(w)) return 1e3;
    return 0;
  }
  function normText(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[   ]/g, ' ').replace(/[«»"“”„]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function parseDigits(str, hasMult) {
    const src = String(str);
    // разделители разрядов: «100 000», «100,000», «1.000.000»
    if (/^\d{1,3}(?:[ ,.]\d{3})+$/.test(src) && !(hasMult && /^\d{1,3}[.,]\d{3}$/.test(src))) return parseInt(src.replace(/[ ,.]/g, ''), 10);
    let s = src.replace(/\s/g, '');
    if (/[.,]/.test(s)) {
      const parts = s.split(/[.,]/);
      if (!hasMult && parts.length === 2 && parts[1].length === 3) s = parts.join('');
      else if (parts.length === 2) s = parts[0] + '.' + parts[1];
      else s = parts.join('');
    }
    const v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }
  const RE_AMT = new RegExp('(\\d{1,3}(?:[ ,.]\\d{3})+(?!\\d)|\\d+(?:[.,]\\d+)?)(?:\\s*(млн|миллион[а-я]*|million|mln|тыс[а-я]*|тысяч[а-я]*|мың|мын)\\.?|(\\s*)(к|k|т)(?![' + L + ']))?(\\s*(?:₸|тг|тенге|теңге|kzt))?', 'g');
  function extractAmount(t) {
    const fixed = [[/пол\s*-?\s*миллиона/, 5e5], [/полтора\s+(?:миллиона|млн)/, 1.5e6], [/полторы\s+тысяч/, 1500], [/четверть\s+миллиона/, 250000], [/жарты\s+миллион/, 5e5]];
    for (let i = 0; i < fixed.length; i++) if (fixed[i][0].test(t)) return { value: fixed[i][1], how: 'word' };
    RE_AMT.lastIndex = 0;
    let m;
    while ((m = RE_AMT.exec(t))) {
      // «50к», «50 к», «50 т»; но «100 000 к оплате» — не «тысяч» (отдельная «к» после большого числа)
      let multW = m[2] || m[4] || '';
      if (!m[2] && m[4] && m[3] && /[ ,.]\d{3}/.test(m[1])) multW = '';
      const mult = multW ? (/^(млн|миллион|million|mln)/.test(multW) ? 1e6 : 1e3) : 1;
      const v = parseDigits(m[1], !!multW);
      if (!isFinite(v)) continue;
      const val = Math.round(v * mult);
      if (multW || m[5] || val >= 1000) return { value: val, how: 'digits' };
    }
    const toks = t.split(/[\s,.;:!?()—–-]+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      const mult = multWord(toks[i]);
      if (!mult) continue;
      let acc = 0, j = i - 1;
      const vals = [];
      while (j >= 0 && WN[toks[j]] != null) { vals.unshift(WN[toks[j]]); j--; }
      vals.forEach((v) => { if (v === 100 && acc > 0 && acc < 10) acc *= 100; else acc += v; });
      return { value: (acc || 1) * mult, how: 'word' };
    }
    return null;
  }
  function extractTime(t) {
    let from = null, to = null, s = t;
    const cut = (re) => { s = s.replace(re, ' '); };
    let m = s.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
    if (m && +m[1] <= 24 && +m[3] <= 24) { from = +m[1] % 24; to = +m[3] % 24; cut(m[0]); }
    const PART = '(?:\\s*(часов|часа|час|ч\\.?|утра|дня|вечера|ночи))?';
    if (from == null) {
      m = s.match(new RegExp('(?:^|\\s)с\\s*(\\d{1,2})(?::\\d{2})?' + PART + '\\s*(?:до|по|[-–—])\\s*(\\d{1,2})(?::\\d{2})?(?!\\d)' + PART));
      if (m && +m[1] <= 24 && +m[3] <= 24) { from = dayHour(+m[1], m[2]); to = dayHour(+m[3], m[4]); cut(m[0]); }
    }
    if (from == null) {
      m = s.match(new RegExp('после\\s*(\\d{1,2})(?::\\d{2})?(?![\\d ]*\\d{3})(?!\\d)' + PART));
      if (m && +m[1] <= 24) { from = dayHour(+m[1], m[2]); cut(m[0]); }
    }
    m = s.match(/до\s*(\d{1,2})(?::\d{2})?\s*(утра|часов|часа|ч\.?|дня|вечера|ночи)/);
    if (m && +m[1] <= 24) { to = dayHour(+m[1], m[2]); cut(m[0]); }
    if (/после\s+полуноч/.test(s) && from == null) { from = 0; if (to == null) to = 6; }
    const night = /ноч|ночн|полуноч|түн/.test(t);
    if (from == null && to == null && !night) return { found: false, rest: t };
    // «ночью после 11» / «ночью с 10 до 6»: час без «вечера» в ночной фразе — это вечерний час
    if (night && from != null && from >= 6 && from < 12) from += 12;
    if (from == null) from = 23;
    if (to == null) to = from >= 18 || from <= 3 ? 7 : (from + 8) % 24;
    return { found: true, from, to, rest: s };
  }
  // «11 вечера» → 23, «10 ночи» → 22, «2 ночи» → 2, «12 ночи» → 0, «3 дня» → 15, «12 дня» → 12
  function dayHour(h, part) {
    const w = String(part || '');
    let x = Number(h) % 24;
    if (/вечера/.test(w) && x < 12) x += 12;
    else if (/ночи/.test(w)) { if (x === 12) x = 0; else if (x >= 6 && x < 12) x += 12; }
    else if (/дня/.test(w) && x >= 1 && x <= 7) x += 12;
    else if (/утра/.test(w) && x === 12) x = 0;
    return x;
  }
  function extractRatio(t) {
    const words = { два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, десять: 10, полтора: 1.5 };
    let m = t.match(/в\s*(\d+(?:[.,]\d+)?|два|две|три|четыре|пять|шесть|десять|полтора)\s*раз[а-я]*/);
    if (m) { const v = words[m[1]] || parseFloat(m[1].replace(',', '.')); return { ratio: v, rest: t.replace(m[0], ' ') }; }
    m = t.match(/вдвое|втрое|вчетверо|впятеро/);
    if (m) return { ratio: { вдвое: 2, втрое: 3, вчетверо: 4, впятеро: 5 }[m[0]], rest: t.replace(m[0], ' ') };
    return { ratio: null, rest: t };
  }
  const RE_GUARD = /(после|без|с|со)\s+(звонка|подтвержден[а-я]*|согласи[а-я]*|разрешени[а-я]*|одобрени[а-я]*|проверки)\s+(?:от\s+)?(?:моей\s+|моего\s+|моих\s+)?(доч[а-я]*|сын[а-я]*|опекун[а-я]*|доверенн[а-я]*\s+лиц[а-я]*|айгерим[а-я]*|динар[а-я]*|мам[а-я]*|муж[а-я]*|жен[а-я]*|сестр[а-я]*|брат[а-я]*|родственник[а-я]*|семь[а-я]*|близк[а-я]*)|(доч[а-я]*|сын[а-я]*|опекун[а-я]*|доверенн[а-я]*\s+лиц[а-я]*)\s+(?:долж[а-я]*\s+)?(?:подтверд|одобр|разреш)[а-я]*|подтвержд[а-я]*\s+(?:моей\s+|моего\s+)?(доч|сын|опекун|доверенн)[а-я]*|қызым[а-я]*|ұлым[а-я]*|сенімді\s+адам[а-я]*/;
  function guardianWord(m) {
    const w = (m && (m[3] || m[4] || m[5] || m[0])) || '';
    if (/доч|қыз/.test(w)) return 'дочери';
    if (/сын|ұл/.test(w)) return 'сына';
    if (/мам/.test(w)) return 'мамы';
    if (/муж/.test(w)) return 'мужа';
    if (/жен/.test(w)) return 'жены';
    if (/сестр/.test(w)) return 'сестры';
    if (/брат/.test(w)) return 'брата';
    return 'доверенного лица';
  }
  const TEMPLATES = [
    'Не переводить больше 50 000 ₸ незнакомым без проверки',
    'Ночью переводы больше 20 000 ₸ — только после проверки',
    'Во время звонка — никаких переводов',
    'Запретить переводы на криптобиржи',
    'Переводы больше 300 000 ₸ — только с подтверждения дочери',
    'Переводы за границу — только после проверки',
  ];
  const RE_WEAK_VERB = /(^|\s)(разрешить|разреши|разрешаю|разрешай|отключить|отключи|отключать|выключить|выключи|выключать|убери|убрать|убирать|удалить|удали|удалять|сними|снять|снимать|отменить|отмени|отменять|повысить|повысь|повышать|увеличить|увеличь|увеличивать|поднять|подними|поднимать|ослабить|ослабь|ослаблять)(?=\s|$)/g;
  // объект, ослабление которого запрещено «своими словами»: сама защита, её статьи и пороги
  const RE_WEAK_OBJ = /^(?:\s*(?:мне|мою|мой|мои|моё|мое|все|всю|весь|эту|этот|эти|для\s+меня))*\s*(защит|провер|стать|лимит|порог|огранич|конституц|якор|правил|запрет|режим|уведомлен|доверенн|подтвержд|сумм|блокир|удержан|контрол)/;
  const RE_NEG_BEFORE = /(?:^|\s)(не|нельзя|никогда|никому|запрет[а-я]*|не\s+дай|не\s+давай|не\s+позволяй|не\s+позволь|не\s+разрешай|не\s+надо)\s*$/;
  function isWeakeningPhrase(t) {
    RE_WEAK_VERB.lastIndex = 0;
    let m;
    while ((m = RE_WEAK_VERB.exec(t))) {
      const start = m.index + m[1].length;
      const before = t.slice(Math.max(0, start - 30), start);
      if (RE_NEG_BEFORE.test(before)) continue;
      const verb = m[2];
      const after = t.slice(start + verb.length, start + verb.length + 40);
      if (RE_WEAK_OBJ.test(after)) return true;
      // «повысить/увеличить/ослабить …» — всегда ослабление
      if (/^(повыс|повыш|увелич|подн|ослаб)/.test(verb)) return true;
      // «разрешить …» без условия «только с/после …» — ослабление
      if (/^разреш/.test(verb) && !/только\s+(с|со|после|при|если|через)\s/.test(t.slice(start))) return true;
    }
    return false;
  }
  function fail(reason, extra) { return Object.assign({ ok: false, reason, suggestions: TEMPLATES.slice() }, extra || {}); }

  function parseRuleInner(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return fail('Напишите правило своими словами — например, «Не переводить больше 50 000 ₸ незнакомым без проверки».');
    if (raw.length > 400) return fail('Слишком длинное правило. Сформулируйте его одной фразой — до 400 символов.');
    let t = normText(raw);
    // ослабление нельзя добавить «своими словами»
    // Ослабление — только когда глагол относится к самой защите («отключить защиту», «повысить лимит»).
    // «Отключить переводы за границу», «Разрешить переводы … только с подтверждения дочери»,
    // «Не дай отключить защиту» — это добавление защиты.
    if (isWeakeningPhrase(t)) {
      return fail('Своими словами можно только добавить защиту. Ослабить или выключить правило можно в его настройках — через Правило 24 часов: изменение вступит в силу через 24 часа, а во время звонка будет отклонено.', { weakening: true });
    }
    const notes = [];
    // 1) доверенное лицо
    const gm = t.match(RE_GUARD);
    const guardian = !!gm;
    const gWho = guardian ? guardianWord(gm) : '';
    if (gm) t = t.replace(gm[0], ' ');
    // 2) время
    const tm = extractTime(t);
    t = tm.rest;
    // 3) кратность и проценты
    const rt = extractRatio(t);
    t = rt.rest;
    let tolerance = null;
    const pm = t.match(/(\d{1,3})\s*(%|процент[а-я]*|пайыз)/);
    if (pm) { tolerance = Math.min(5, (+pm[1]) / 100); t = t.replace(pm[0], ' '); }
    t = t.replace(/\d+\s*-?\s*(?:го|е|ого)?\s*числа/g, ' ');
    // 4) сумма
    const am = extractAmount(t);
    const amount = am ? am.value : 0;
    if (/в\s+(день|сутки|месяц|неделю)|за\s+(день|сутки|месяц|неделю)|ежедневно|в\s+месяц/.test(t)) notes.push('сумму понимаю как лимит одной операции — суточный лимит настраивается в разделе «Помощь → Проверка защиты»');
    // 5) признаки
    const newRec = /нов[а-я]*\s+(получател|счет|номер|карт|людям|контакт)|незнаком|неизвестн|чужим|чужие|чужой|первый\s+раз|впервые|жаңа\s+алушы|бейтаныс|таныс\s+емес/.test(t);
    const call = /(во\s+время|при|в\s+момент|пока\s+идет)\s+(телефонн[а-я]*\s+)?(звонк|разговор)|когда\s+(мне\s+)?звонят|когда\s+я\s+(на\s+линии|разговариваю|говорю\s+по\s+телефону)|по\s+телефону|на\s+линии|қоңырау/.test(t);
    const crypto = /крипт|биткоин|bitcoin|btc|usdt|binance|bybit|криптобирж|криптовалют/.test(t);
    const abroad = /за\s+границ|за\s+рубеж|зарубежн|иностранн|в\s+другую\s+страну|международн|шетел/.test(t);
    const spike = rt.ratio != null || /резк[а-я]*|скачок|больше\s+обычного|нетипичн[а-я]*\s+сумм|необычн[а-я]*\s+сумм/.test(t);
    const plan = /запланирован|по\s+плану|не\s+по\s+плану|сверх\s+плана|план[а-я]*/.test(t);
    const flagged = /подозрительн[а-я]*\s+(счет|реквизит|получател|номер|карт)|стоп-?лист|черн[а-я]*\s+списк|отмечен[а-я]*|мошенническ[а-я]*\s+(счет|номер|карт)/.test(t);
    const transferWord = /перев|переч|отправ|плат|списан|снят|аудар|ақша|деньг|сумм|₸|тенге|тг|операц/.test(t) || !!am;
    const newOnlyMod = newRec;
    // 6) решение
    let decision = null;
    if (/защитн[а-я]*\s+режим/.test(t)) decision = 'protect';
    else if (guardian) decision = 'hold';
    else if (/без\s+(доп[а-я]*\s+)?(провер|подтвержд)|только\s+после\s+(доп[а-я]*\s+)?провер|с\s+(доп[а-я]*\s+)?(проверк|подтвержд)|после\s+(доп[а-я]*\s+)?проверк|подтвержд|переспраш|повторн|контрольн|уточня|спрашива|тексер/.test(t)) decision = 'confirm';
    else if (/запре[тщ]|не\s+разреш|нельзя|никогда|никаких|ни\s+одного|не\s+пускать|удерж|блокир|не\s+переводить|не\s+отправлять|(отключ|выключ|закр|останов|прекрат)[а-я]*\s+(все\s+|любые\s+)?(перевод|платеж|оплат|отправк)|не\s+(дай|давай|позволяй)|тыйым|болмайды|рұқсат\s+етпе/.test(t)) decision = 'hold';
    // 7) вид статьи
    let kind = null;
    const params = {};
    if (crypto) { kind = 'crypto_guard'; params.amount = amount; if (newOnlyMod) params.newOnly = true; if (abroad) notes.push('«за границу» — добавьте отдельным правилом'); }
    else if (abroad) { kind = 'abroad_guard'; params.amount = amount; if (newOnlyMod) params.newOnly = true; }
    else if (flagged) { kind = 'flagged_accounts'; }
    else if (call) { kind = 'call_guard'; params.newOnly = newOnlyMod; params.amount = amount; }
    else if (tm.found) { kind = 'night_guard'; params.from = tm.from; params.to = tm.to; params.amount = amount; if (newOnlyMod) params.newOnly = true; }
    else if (spike && !plan) { kind = 'amount_spike'; params.ratio = rt.ratio || 3; }
    else if (plan) { kind = 'plan_deviation'; params.tolerance = tolerance != null ? tolerance : 0.5; params.unplannedOver = amount || 200000; }
    else if (newRec) { kind = 'new_recipient_limit'; params.amount = amount; }
    else if (amount && transferWord) { kind = 'amount_limit'; params.amount = amount; }
    else if (guardian && transferWord) { kind = 'amount_limit'; params.amount = 0; }
    if (!kind) return fail('Не понял, какую защиту добавить. Назовите сумму, получателей или ситуацию — например, «ночью», «во время звонка», «незнакомым».');
    // в тексте есть цифры, а сумму не поняли — не превращаем правило молча в «каждый перевод»
    if (!am && /\d/.test(t) && AMOUNT_GATED.indexOf(kind) >= 0) return fail('Не понял сумму. Напишите её цифрами — например, «больше 100 000 ₸», «100к» или «100 тыс».');
    if (kind === 'amount_limit' && !amount && !guardian) return fail('Не понял сумму. Напишите её цифрами — например, «больше 100 000 ₸», «100к» или «100 тыс».');
    if (guardian) params.guardian = true;
    const dec = decision || KINDS[kind].decision;
    const article = { kind, title: KINDS[kind].title, text: '', params, phrase: raw };
    if (kind === 'night_guard' && !isNightWindow(params)) article.title = 'Окно времени';
    if (dec !== KINDS[kind].decision) article.decision = dec;
    const tmp = Object.assign({ builtin: false }, article, { decision: article.decision });
    article.text = describe(tmp);
    let cons = guardian ? 'удерживать до подтверждения ' + gWho : consequence(tmp);
    if (guardian) article.text = condition(tmp) + ' — только с подтверждения ' + gWho;
    const expl = condition(tmp);
    if (am && am.value >= 1e6 && am.how === 'word') notes.push('сумма понята как ' + money(am.value));
    let explain = 'Понял так: ' + expl.charAt(0).toLowerCase() + expl.slice(1) + ' → ' + cons + '.';
    if (notes.length) explain += ' (' + notes.join('; ') + ')';
    // такая статья уже есть?
    let duplicateOf = null;
    try {
      const st = state || sync();
      const same = st.articles.find((a) => a.enabled && a.kind === kind && canon(Object.assign({}, a.params, { auto: undefined, name: undefined, relation: undefined })) === canon(params) && decisionOf(a) === dec);
      if (same) duplicateOf = same.n;
    } catch (e) { duplicateOf = null; }
    return { ok: true, article, explain, decision: dec, duplicateOf };
  }
  function parseRule(text) {
    try { return parseRuleInner(text); } catch (e) { return fail('Не удалось разобрать правило. Попробуйте сформулировать иначе или выберите шаблон.'); }
  }
  function addFromText(text) {
    const r = parseRule(text);
    if (!r.ok) return r;
    if (r.duplicateOf) return Object.assign({}, r, { ok: false, reason: 'Такое правило уже есть. Новое не добавляю.', suggestions: TEMPLATES.slice() });
    const a = addArticle(r.article);
    if (!a) return fail('Не удалось добавить правило.');
    return { ok: true, article: a, explain: r.explain, decision: r.decision };
  }

  /* =====================================================================
     «ГОЛОС ИЗ СПОКОЙНОГО ВРЕМЕНИ» — якорное сообщение
     ===================================================================== */
  let memAudio = null; // {buf, type} — если IndexedDB недоступна
  let audioUrl = null;
  let playing = null;
  function idbOpen() {
    return new Promise((res, rej) => {
      try {
        if (!window.indexedDB) { rej(new Error('no_idb')); return; }
        const r = window.indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => { try { r.result.createObjectStore(DB_STORE); } catch (e) { /* ignore */ } };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error || new Error('idb_error'));
        r.onblocked = () => rej(new Error('idb_blocked'));
      } catch (e) { rej(e); }
    });
  }
  function idbDo(mode, fn) {
    return idbOpen().then((db) => new Promise((res, rej) => {
      let out;
      try {
        const tx = db.transaction(DB_STORE, mode);
        const st = tx.objectStore(DB_STORE);
        const req = fn(st);
        if (req) req.onsuccess = () => { out = req.result; };
        tx.oncomplete = () => { try { db.close(); } catch (e) { /* ignore */ } res(out); };
        tx.onerror = tx.onabort = () => { try { db.close(); } catch (e) { /* ignore */ } rej(tx.error || new Error('idb_tx')); };
      } catch (e) { try { db.close(); } catch (er) { /* ignore */ } rej(e); }
    }));
  }
  function blobToBuf(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((res, rej) => { try { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(blob); } catch (e) { rej(e); } });
  }
  function revokeUrl() { if (audioUrl) { try { URL.revokeObjectURL(audioUrl); } catch (e) { /* ignore */ } audioUrl = null; } }
  function deleteAudio() {
    memAudio = null; revokeUrl();
    return idbDo('readwrite', (st) => st.delete(DB_KEY)).then(() => true).catch(() => false);
  }
  function anchorView() {
    const st = state || sync();
    const an = st.anchor || {};
    const d = ANCHOR_DEFAULT[persona];
    const custom = !!an.custom;
    const text = custom ? an.text || '' : d.text;
    const authorKind = custom ? an.authorKind || 'self' : d.authorKind;
    const author = custom ? an.author || (authorKind === 'guardian' ? guardianOf(st).name : 'Вы') : d.author;
    const recordedAt = an.recordedAt || st.createdAt || now();
    const who = authorKind === 'guardian' ? author.split(/[\s(]/)[0] : '';
    const caption = authorKind === 'guardian' ? 'Сообщение, которое ' + who + ' записала для вас ' + fmtDayMonth(recordedAt) : 'Сообщение, которое вы записали ' + fmtDayMonth(recordedAt);
    return { kind: an.hasAudio ? 'audio' : text ? 'text' : null, text, author, authorKind, recordedAt, hasAudio: !!an.hasAudio, isDefault: !custom, caption };
  }
  function resolveAuthor(author) {
    if (author === 'guardian') return { author: guardianOf(state).name, authorKind: 'guardian' };
    if (!author || author === 'self') return { author: 'Вы', authorKind: 'self' };
    return { author: String(author).slice(0, 60), authorKind: 'guardian' };
  }
  function pickRuVoice() {
    return new Promise((res) => {
      try {
        const ss = window.speechSynthesis;
        if (!ss || typeof window.SpeechSynthesisUtterance !== 'function') { res(null); return; }
        const pick = () => { try { return (window.NX && NX.tts && NX.tts.pick('calm', 'ru')) || (ss.getVoices() || []).find((v) => /^ru([-_]|$)/i.test(v.lang || '')) || null; } catch (e) { return null; } };
        const v = pick();
        if (v) { res(v); return; }
        let done = false;
        const fin = () => { if (done) return; done = true; res(pick()); };
        try { ss.addEventListener('voiceschanged', fin, { once: true }); } catch (e) { /* ignore */ }
        setTimeout(fin, 900);
      } catch (e) { res(null); }
    });
  }
  const anchor = {
    get() { sync(); return anchorView(); },
    setText(text, author) {
      sync();
      const tx = String(text == null ? '' : text).trim().slice(0, 600);
      if (!tx) return false;
      const au = resolveAuthor(author);
      state.anchor = { kind: 'text', custom: true, text: tx, author: au.author, authorKind: au.authorKind, recordedAt: now(), hasAudio: false };
      deleteAudio();
      amend('add', null, 'Записано новое сообщение «Голос из спокойного времени» (текст, автор: ' + au.author + ')');
      commit({ type: 'anchor' });
      return true;
    },
    setAudio(blob, author) {
      sync();
      if (!blob || !(blob.size > 0)) return Promise.resolve(false);
      const au = resolveAuthor(author);
      const type = blob.type || 'audio/webm';
      return blobToBuf(blob).then((buf) => {
        memAudio = { buf, type };
        revokeUrl();
        return idbDo('readwrite', (st) => st.put({ buf, type, ts: now() }, DB_KEY)).then(() => true).catch(() => false);
      }).then((stored) => {
        sync();
        const prev = state.anchor || {};
        const keepText = prev.custom ? prev.text : anchorView().text;
        state.anchor = { kind: 'audio', custom: true, text: keepText || '', author: au.author, authorKind: au.authorKind, recordedAt: now(), hasAudio: true, stored: !!stored };
        amend('add', null, 'Записано голосовое сообщение «Голос из спокойного времени» (автор: ' + au.author + ')' + (stored ? '' : ' — хранится до перезагрузки страницы'));
        commit({ type: 'anchor' });
        return true;
      }).catch(() => false);
    },
    getAudioUrl() {
      sync();
      if (!(state.anchor && state.anchor.hasAudio)) return Promise.resolve(null);
      if (audioUrl) return Promise.resolve(audioUrl);
      const make = (rec) => {
        if (!rec || !rec.buf) return null;
        try { audioUrl = URL.createObjectURL(new Blob([rec.buf], { type: rec.type || 'audio/webm' })); return audioUrl; } catch (e) { return null; }
      };
      if (memAudio) return Promise.resolve(make(memAudio));
      return idbDo('readonly', (st) => st.get(DB_KEY)).then((rec) => { if (rec) memAudio = rec; return make(rec); }).catch(() => null);
    },
    // Promise<{mode:'audio'|'tts'|'text', text, caption}> — всегда разрешается
    play() {
      const view = anchor.get();
      // reason (для mode 'text'): 'no_voice' — нет русского голоса; 'not-allowed' — браузер заблокировал
      // звук без нажатия (нужно нажать «Озвучить»); 'no_text'; иначе — код ошибки синтеза речи
      const result = (mode, reason) => { const r = { mode, text: view.text, caption: view.caption, author: view.author }; if (reason) { r.reason = reason; r.blocked = reason === 'not-allowed'; } return r; };
      anchor.stop();
      let autoplayBlocked = false;
      const speak = () => pickRuVoice().then((voice) => {
        if (!view.text) return result('text', 'no_text');
        if (!voice) return result('text', autoplayBlocked ? 'not-allowed' : 'no_voice');
        return new Promise((res) => {
          let done = false;
          const fin = (m, why) => { if (done) return; done = true; playing = null; res(result(m, why)); };
          try {
            const u = new window.SpeechSynthesisUtterance(view.text);
            u.voice = voice; u.lang = voice.lang || 'ru-RU'; u.rate = 0.93; u.pitch = 1;
            u.onend = () => fin('tts');
            u.onerror = (e) => { const code = (e && e.error) || 'error'; fin(code === 'interrupted' || code === 'canceled' ? 'tts' : 'text', code === 'interrupted' || code === 'canceled' ? '' : code); };
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(u);
            const guard = setTimeout(() => fin('tts'), Math.min(60000, 4000 + view.text.length * 90));
            playing = { stop() { clearTimeout(guard); try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } fin('tts'); } };
          } catch (e) { fin('text', 'error'); }
        });
      }).catch(() => result('text', 'error'));
      if (!view.hasAudio) return speak();
      return anchor.getAudioUrl().then((url) => {
        if (!url) return speak();
        return new Promise((res) => {
          let done = false, started = false;
          const fin = (r) => { if (done) return; done = true; playing = null; res(r); };
          try {
            const el = new Audio(url);
            const guard = setTimeout(() => fin(result('audio')), 120000);
            el.onended = () => { clearTimeout(guard); fin(result('audio')); };
            el.onerror = () => { clearTimeout(guard); if (!started) speak().then(fin); else fin(result('audio')); };
            playing = { stop() { clearTimeout(guard); try { el.pause(); } catch (e) { /* ignore */ } fin(result('audio')); } };
            const p = el.play();
            if (p && typeof p.then === 'function') p.then(() => { started = true; }).catch((e) => { clearTimeout(guard); if (e && e.name === 'NotAllowedError') autoplayBlocked = true; speak().then(fin); });
            else started = true;
          } catch (e) { speak().then(fin); }
        });
      }).catch(() => speak());
    },
    stop() { if (playing) { const p = playing; playing = null; try { p.stop(); } catch (e) { /* ignore */ } } },
    clear() {
      sync();
      state.anchor = { kind: 'text', custom: false, text: '', author: '', authorKind: '', recordedAt: state.createdAt || now(), hasAudio: false };
      deleteAudio();
      amend('remove', null, 'Сообщение «Голос из спокойного времени» сброшено к стандартному');
      commit({ type: 'anchor' });
      return true;
    },
  };

  /* ---------------- публичный API ---------------- */
  const api = {
    __v: 1,
    KEY, DB_NAME, KINDS, DECISION_LABEL, TEMPLATES,
    get() {
      sync();
      const s = clone(state);
      const t = now();
      if (s.protective && s.protective.active && s.protective.until && s.protective.until <= t) s.protective = { active: false, since: null, until: null, reason: '', articleN: null };
      s.guardian = guardianOf(state);
      s.anchor = anchorView();
      s.articles.forEach((a) => { if (a.optional) a.optionalLabel = 'дополнительная статья (' + (a.enabled ? 'включена' : 'выключена') + ')'; if (a.kind === 'anchor') a.text = describe(a, { guardianOn: s.guardian.enabled }); if (a.kind === 'guardian_help') { a.params = Object.assign({}, a.params, { name: s.guardian.name, relation: s.guardian.relation }); a.text = 'Доверенное лицо (' + s.guardian.name + ', ' + s.guardian.relation + ') может помочь проверить ситуацию — функция подключена заранее'; } });
      s.plans = (state.plans || []).map(planView);
      s.summary = articlesSummary(state);
      s.nextArticleN = nextArticleN(state);
      s.persona = persona;
      s.callActive = isCallActive();
      return s;
    },
    articlesSummary() { return articlesSummary(sync()); },
    nextArticleN() { return nextArticleN(sync()); },
    lastHold() { return lastHoldInfo ? clone(lastHoldInfo) : null; },
    evaluate(tx) {
      try { return evaluateOn(sync(), tx); } catch (e) { console.error(e); return { hits: [], decision: 'allow', protective: false, protectiveTriggered: false, guardian: null }; }
    },
    isWeakening(articleId, patch) {
      try { const a = (state || sync()).articles.find((x) => x.id === articleId); return weakeningReasons(a, patch).length > 0; } catch (e) { return false; }
    },
    requestChange, cancelChange, applyDue, demoFastForward,
    addArticle, removeArticle, setArticleEnabled, setGuardian,
    parseRule, addFromText, describe,
    plans,
    enterProtective, exitProtective, isProtective,
    requestGuardian, resolveGuardian, withdrawRequest,
    guardianRequests() { sync(); return clone(state.requests); },
    pendingChanges() { sync(); return clone(state.pending.filter((c) => c.status === 'pending')); },
    // попытки ослабить защиту за окно (по умолчанию 60 мин): запросы ослабления и отклонённые якорем — для «Ваш обычный перевод»
    weakenAttempts(windowMs) {
      try {
        sync();
        const w = Number(windowMs) > 0 ? Number(windowMs) : HOUR;
        const t = now();
        return clone((state.history || []).filter((h) => h && (h.kind === 'weaken_requested' || h.kind === 'refused') && t - (h.ts || 0) < w && !/^План /.test(String(h.summary || ''))));
      } catch (e) { return []; }
    },
    reportTransfer,
    anchor,
    sign() {
      sync();
      bump();
      amend('sign', null, 'Правила подписаны заново');
      commit({ type: 'sign' });
      return signInternal();
    },
    on(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.push(fn);
      return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    },
    reset() {
      revokeUrl(); memAudio = null;
      deleteAudio();
      state = defaults();
      persist();
      notify({ type: 'reset' });
      return signInternal();
    },
    setCallActive(on) { const was = isCallActive(); callFlag = { active: !!on, ts: now() }; if (was !== !!on) notify({ type: 'call', active: !!on }); return !!on; },
    isCallActive,
    canWeaken(ctx) { const anc = (state || sync()).articles.find((a) => a.id === 'a_anchor'); const th = anc && anc.enabled ? threatState(ctx) : null; return { ok: !th, refused: th, reason: th ? REFUSAL_TEXT[th] : '' }; },
    setPersona(p) {
      const next = p === 'mom' ? 'mom' : 'self';
      if (next !== persona) {
        persona = next;
        sync();
        if (fitPlansToPersona(state)) persist();
        notify({ type: 'persona', persona });
      }
      return persona;
    },
    getPersona() { return persona; },
  };
  NX.Constitution = api;

  /* ---------------- инициализация, другие вкладки, таймер ---------------- */
  sync();
  if (!state.hash) signInternal();
  applyDue();
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY && e.key !== null) return;
      const raw = lsGet(KEY);
      if (raw === lastRaw) return;
      if (raw == null) { state = defaults(); lastRaw = null; memAudio = null; revokeUrl(); notify({ type: 'reset', remote: true }); return; }
      const s = parseRaw(raw);
      if (s) { state = s; lastRaw = raw; memAudio = null; revokeUrl(); notify({ type: 'remote' }); }
    });
  } catch (e) { /* ignore */ }
  try {
    if (NX.bus && typeof NX.bus.on === 'function') NX.bus.on((msg) => {
      if (!msg || !msg.type) return;
      const p = msg.payload || {};
      if (msg.type === 'call_state') api.setCallActive(!!p.active);
      else if (msg.type === 'call_end' || msg.type === 'shield_end' || msg.type === 'shield_stop') api.setCallActive(false);
    });
  } catch (e) { /* ignore */ }
  setInterval(() => { try { applyDue(); } catch (e) { /* ignore */ } }, 15000);
})();
