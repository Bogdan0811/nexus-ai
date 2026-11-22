/* =====================================================================
   NEXUS AI — Fraud Fusion Center · кибер + антифрод
   Устройство, звонок, сообщение и перевод в одном инциденте.
   Жизненный цикл IOC (подозрение → корреляция → решение аналитика
   в четыре глаза), граф связей с PPR, честные метрики.
   Поток операций синтетический (выборка 1:1000). Концепт команды
   NEXUS AI, не является продуктом банка-организатора.
   v4 (spec 2.4): разделы Сейчас · Мониторинг · Граф · Счета · Инциденты · Аналитика,
   стандартное окно банка (stdModal), подтверждение hold с основанием.
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  NX.page = 'bank';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = NX.esc;
  const KEYS = NX.KEYS || {};
  const BANK_KEY = KEYS.bank || 'nexus_ai_bank_v1';
  const INBOX_KEY = KEYS.inbox || 'nexus_ai_inbox_v1';
  const BANK_V = 2;
  const PAGE_T0 = Date.now();
  const TRANSPORT = 'BroadcastChannel' in window ? 'BroadcastChannel' : 'localStorage';
  const F = {
    inc: ['инцидент', 'инцидента', 'инцидентов'],
    acc: ['счёт', 'счёта', 'счетов'],
    susAcc: ['подозрительный счёт', 'подозрительных счёта', 'подозрительных счетов'],
    ioc: ['реквизит', 'реквизита', 'реквизитов'],
    net: ['сеть', 'сети', 'сетей'],
    op: ['операция', 'операции', 'операций'],
    tr: ['перевод', 'перевода', 'переводов'],
    victim: ['пострадавший', 'пострадавших', 'пострадавших'],
    sender: ['отправитель', 'отправителя', 'отправителей'],
    caseF: ['кейс', 'кейса', 'кейсов'],
    entry: ['запись', 'записи', 'записей'],
  };
  const cnt = (n, f) => NX.countOf(n, f);
  const mask = (s) => (NX.Graph && NX.Graph.mask ? NX.Graph.mask(s) : String(s == null ? '' : s));
  // демо-номера из базы дропов показываем с частичной маской
  const dispAcc = (acc) => { const s = String(acc == null ? '' : acc); try { return NX.findMule && NX.findMule(s) ? mask(s) : s; } catch (e) { return s; } };

  const VIEWS = {
    overview: ['Сейчас', 'Что требует внимания аналитика прямо сейчас'],
    monitor: ['Мониторинг', 'Каждая операция получает оценку риска · синтетический поток, выборка 1:1000'],
    graph: ['Граф', 'Путь денег от пострадавших через дропов к обналу'],
    accounts: ['Счета', 'Дропы, транзитные счета и точки обнала · синтетические данные'],
    incidents: ['Инциденты', 'Кейсы для аналитика: сигналы с устройства клиента, обращения и удержанные переводы'],
    analytics: ['Аналитика', 'Тренды, каналы атак, обмен сигналами и проверка модели'],
  };
  // старые адреса: #now → «Сейчас»
  const VIEW_ALIAS = { now: ['overview', null] };
  const THREATS = ['Социальная инженерия', 'Фишинг', 'Захват аккаунта', 'Дроп-счета', 'Инвестиционный скам', 'Синтез голоса (deepfake)'];
  // палитра для canvas/SVG и подложек с альфой: общие токены единой тёмной дизайн-системы (:root в style.css),
  // читаются через getComputedStyle; второе значение — тёмный запасной hex (только 6-значные: к ним дописывается альфа)
  const PAL = (function () {
    const T = {
      ink: ['--text', '#E8ECF7'], muted: ['--muted', '#95A1BE'], slate: ['--muted', '#95A1BE'], grid: ['--panel3', '#1A2440'],
      accent: ['--accent', '#6366F1'], ok: ['--ok', '#2DD4A3'], warn: ['--warn', '#FFB020'], danger: ['--danger', '#FF5470'],
      violet: ['--accent2', '#8B5CF6'], pink: ['--accent3', '#22D3EE'], blue: ['--info', '#38BDF8'],
      accentInk: ['--accent-ink', '#A5B4FC'], okInk: ['--ok-ink', '#5EEAC0'], warnInk: ['--warn-ink', '#FFC861'], dangerInk: ['--danger-ink', '#FF8A9E'], violetInk: ['--violet-ink', '#C4B5FD'],
    };
    let cs = null;
    try { cs = window.getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    const out = {};
    Object.keys(T).forEach((k) => {
      let v = cs ? String(cs.getPropertyValue(T[k][0]) || '').trim() : '';
      if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      out[k] = /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : T[k][1];
    });
    return out;
  })();
  const rgbaOf = (hex, a) => 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' + parseInt(hex.slice(5, 7), 16) + ',' + a + ')';
  const THREAT_COLORS = [PAL.danger, PAL.warn, PAL.violet, PAL.pink, PAL.blue, PAL.accent];
  const CHANNELS = ['Мобильное приложение', 'Интернет-банк', 'P2P по номеру', 'POS-терминал', 'QR-оплата', 'Банкомат'];
  const CITIES = ['Алматы', 'Астана', 'Шымкент', 'Караганда', 'Актобе', 'Павлодар', 'Усть-Каменогорск', 'Атырау', 'Костанай', 'Тараз'];
  const FIRST = ['Алихан', 'Мадина', 'Руслан', 'Асель', 'Даурен', 'Жанар', 'Ильяс', 'Камила', 'Бауыржан', 'Олжас', 'Айым', 'Тимур', 'Дана', 'Арман', 'Лаура', 'Нурлан', 'Әсем', 'Ержан', 'Зарина', 'Санжар', 'Гаухар', 'Аскар', 'Меруерт', 'Ринат', 'Айжан'];
  const LAST = ['Б.', 'К.', 'Т.', 'Н.', 'С.', 'О.', 'М.', 'Е.', 'А.', 'Д.', 'Р.', 'Ж.', 'И.', 'Ш.'];
  // вымышленные сотрудники для демонстрации принципа «четырёх глаз»
  // no — табельный номер демо-сотрудника (синтетический): его видит клиент в отметке «Сейчас вам действительно звонит банк»
  const ROLES = { analyst: { name: 'А. Касымов', title: 'Аналитик', no: '1042' }, senior: { name: 'Д. Нурланова', title: 'Старший аналитик', no: '2087' } };

  /* ---------------- состояние панели ---------------- */
  function seedBank() {
    const now = Date.now();
    const M = NX.MULE_ACCOUNTS;
    const mk = (o) => Object.assign({ id: NX.uid('inc'), status: 'new', chain: [], factors: [], notes: [], synthetic: true }, o);
    return {
      v: BANK_V,
      incidents: [
        mk({ ts: now - 4 * 60000, client: 'Алия Щ., 66 лет', type: 'Социальная инженерия', title: 'Перевод 640 000 ₸ на «безопасный счёт» во время звонка', score: 91, amount: 640000, account: M[1].account, source: 'Проверка перевода', factors: ['Звонок 31 мин во время операции', 'Получатель в базе дропов банка', 'Сумма в 9 раз выше обычной'], chain: [{ t: 'Входящий звонок с неизвестного номера', ts: now - 35 * 60000 }, { t: 'Попытка перевода 640 000 ₸ — удержан для проверки', ts: now - 4 * 60000 }] }),
        mk({ ts: now - 17 * 60000, client: 'Ильяс М.', type: 'Захват аккаунта', title: 'Вход с эмулятора и смена номера телефона', score: 86, amount: 0, account: '—', source: 'Кибер-сигналы устройства', status: 'progress', factors: ['Эмулятор Android', 'Новый IP (VPN)', 'Смена номера через 3 мин после входа'], notes: [{ ts: now - 10 * 60000, t: 'Взят в работу', by: 'А. Касымов (аналитик)' }] }),
        mk({ ts: now - 42 * 60000, client: 'Камила Е.', type: 'Фишинг', title: 'Ввод данных карты на gift-bonus-kz.test', score: 78, amount: 49990, account: 'gift-bonus-kz.test', source: 'Проверка ссылок', factors: ['Домен-двойник (демо-домен)', 'Оплата сразу после перехода по ссылке'] }),
        mk({ ts: now - 75 * 60000, client: 'Даурен С.', type: 'Инвестиционный скам', title: 'Серия переводов ИП «Капитал Профит» (вымышл.)', score: 82, amount: 1200000, account: 'KZ77 8KZT 2210 0004 1190', source: 'Граф связей', status: 'resolved', factors: ['Получатель — узел дроп-сети', '4 перевода за 2 дня'], notes: [{ ts: now - 60 * 60000, t: 'Мошенничество подтверждено. Операции по счёту получателя приостановлены (hold), подготовлен черновик сообщения в АФМ.', by: 'А. Касымов (аналитик)' }] }),
        mk({ ts: now - 2.2 * 3600000, client: 'Олжас Р.', type: 'Синтез голоса (deepfake)', title: 'Звонок «сына» с признаками синтеза голоса', score: 74, amount: 300000, account: M[3].account, source: 'Защита звонка', status: 'resolved', notes: [{ ts: now - 2 * 3600000, t: 'Клиент предупреждён, перевод отменён.', by: 'Д. Нурланова (старший аналитик)' }] }),
        mk({ ts: now - 3.5 * 3600000, client: 'Арман И.', type: 'Дроп-счета', title: 'Аномальная входящая активность: 9 отправителей за 6 ч', score: 69, amount: 2150000, account: 'KZ58 3KZT 7720 0003 4410', source: 'NEXUS Core', status: 'false_positive', notes: [{ ts: now - 3 * 3600000, t: 'Сбор денег на свадьбу, подтверждено клиентом.', by: 'А. Касымов (аналитик)' }] }),
      ],
      imported: [],
      // только «живые» счётчики демо; синтетический поток пересчитывается при каждой загрузке
      stats: { iocHeld: 0, iocPrevented: 0, liveHeld: 0, livePrevented: 0, falseHeld: 0, falseHeldSum: 0, attempts: 0, attemptsSum: 0 },
      holds: [], held: [], seen: [], pending: [], audit: [], iocMeta: {}, lastIoc: null, role: 'analyst',
    };
  }
  let B = null;
  try { B = JSON.parse(localStorage.getItem(BANK_KEY) || 'null'); } catch (e) { B = null; }
  if (!B || B.v !== BANK_V || !Array.isArray(B.incidents) || !B.stats) B = seedBank();
  (function normalize() {
    ['imported', 'holds', 'held', 'seen', 'pending', 'audit'].forEach((k) => { if (!Array.isArray(B[k])) B[k] = []; });
    if (!B.iocMeta || typeof B.iocMeta !== 'object') B.iocMeta = {};
    ['iocHeld', 'iocPrevented', 'liveHeld', 'livePrevented', 'falseHeld', 'falseHeldSum', 'attempts', 'attemptsSum'].forEach((k) => { if (typeof B.stats[k] !== 'number') B.stats[k] = 0; });
    if (!ROLES[B.role]) B.role = 'analyst';
    // финансовая конституция клиента: журнал срабатываний и изменений, счётчики, запросы доверенному лицу
    if (!B.cons || typeof B.cons !== 'object') B.cons = {};
    if (!Array.isArray(B.cons.log)) B.cons.log = [];
    if (!B.cons.stats || typeof B.cons.stats !== 'object') B.cons.stats = {};
    ['fired', 'stopped', 'stoppedSum', 'confirms', 'refused', 'weakenReq', 'guardianReq', 'guardianReject', 'protectiveOn'].forEach((k) => { if (typeof B.cons.stats[k] !== 'number') B.cons.stats[k] = 0; });
    if (!B.cons.stats.byN || typeof B.cons.stats.byN !== 'object') B.cons.stats.byN = {};
    if (!B.cons.guard || typeof B.cons.guard !== 'object') B.cons.guard = {};
    if (!B.cons.prot || typeof B.cons.prot !== 'object') B.cons.prot = null;
    // 3.0: цикл защиты, проверки связанных со Scam Chain счетов, Trust Circle, «Заблокировать всё», CrossBank
    if (!Array.isArray(B.cycle)) B.cycle = [];
    if (!B.chainRev || typeof B.chainRev !== 'object') B.chainRev = {};
    if (!Array.isArray(B.chainLog)) B.chainLog = [];
    if (!Array.isArray(B.tc)) B.tc = [];
    if (!B.em || typeof B.em !== 'object') B.em = null;
    if (!B.xb || typeof B.xb !== 'object') B.xb = {};
    if (!B.xb.shared || typeof B.xb.shared !== 'object') B.xb.shared = {};
    if (!B.xb.checked || typeof B.xb.checked !== 'object') B.xb.checked = {};
    if (typeof B.xb.t0 !== 'number') B.xb.t0 = Date.now();
    // заметки демо-кейсов из seedBank — заготовка, а не журнал: в «первую реакцию» не входят
    const seedNotes = new Set();
    try { seedBank().incidents.forEach((i) => (i.notes || []).forEach((n) => seedNotes.add(i.title + '|' + n.t))); } catch (e) { /* ignore */ }
    B.incidents.forEach((i) => { if (i && i.synthetic && !i.stage && Array.isArray(i.notes)) i.notes.forEach((n) => { if (n && !n.seed && seedNotes.has(i.title + '|' + n.t)) n.seed = true; }); });
  })();
  let dead = false; // идёт сброс — ничего не сохраняем
  function saveB() {
    if (dead || (NX.isResetting && NX.isResetting())) return false;
    try { localStorage.setItem(BANK_KEY, JSON.stringify(B)); return true; } catch (e) { return false; }
  }

  // синтетический поток (в память, не сохраняется — пересчитывается при загрузке)
  const S = {
    processed: 0, flagged: 0, blocked: 0, prevented: 0, tp: 0, fp: 0, fn: 0, tn: 0,
    threat: THREATS.map(() => 0), channels: CHANNELS.map(() => 0),
    hours: (function () { const r = NX.rng(99); return Array.from({ length: 24 }, (_, h) => Math.round((h >= 9 && h <= 21 ? 8 : 3) + r() * 8 + (h >= 18 && h <= 21 ? 6 : 0))); })(),
  };

  /* ---------------- роли и журнал аудита ---------------- */
  const roleOf = () => (ROLES[B.role] ? B.role : 'analyst');
  const otherRole = (r) => (r === 'senior' ? 'analyst' : 'senior');
  const signer = (r) => { const x = ROLES[r || roleOf()]; return x.name + ' (' + x.title.toLowerCase() + ')'; };
  const AUDIT_RU = {
    ioc_confirm_request: 'Запрошено подтверждение реквизита (подпись 1 из 2)', ioc_confirm: 'Реквизит подтверждён (две подписи)', ioc_revoke: 'Реквизит снят как ложное срабатывание',
    ioc_corroborate: 'Корреляция с дроп-сетью в графе', afc_package: 'Сформирован пакет для АФЦ НБРК (симуляция, не отправлен)', account_hold: 'Операции по счёту приостановлены (hold 72 ч)',
    ring_hold_request: 'Запрошено приостановление операций сети (подпись 1 из 2)', ring_hold: 'Операции сети приостановлены (две подписи)', str_draft: 'Сформирован черновик сообщения в АФМ (не отправлен)',
    role_switch: 'Смена роли', incident_status: 'Статус инцидента', second_client_hold: 'Перевод второго клиента на реквизит из стоп-листа', incident_create: 'Создан инцидент',
    ioc_revoke_request: 'Запрошено снятие реквизита (подпись 1 из 2)', hold_release: 'Удержания сняты: реквизит признан ложным срабатыванием',
    link_review: 'Цепочка дропов: связанный счёт взят на проверку', link_clear: 'Цепочка дропов: подозрение со связанного счёта снято', link_restore: 'Цепочка дропов: связанный счёт возвращён в мониторинг',
    xbank_check: 'CrossBank: входящий индикатор сверен (симуляция)', xbank_share: 'CrossBank: индикатор передан (симуляция)',
  };
  // источник записи стоп-листа, когда аналитик вручную приостановил операции по счёту
  const HOLD_SRC = 'Аналитик · удержание счёта';
  const isHoldRec = (r) => !!(r && (r.analystHold || r.source === HOLD_SRC));
  // реквизиты без синтетической истории в графе: ручное удержание и счета продавцов из споров (safe-deal.js)
  const noSynth = (r) => isHoldRec(r) || !!(r && r.noSynthHistory);
  // нормализованный ключ счёта: '87085551290' и '+7 708 555 12 90' — один и тот же реквизит
  function accKey(a) {
    const s = String(a == null ? '' : a).trim();
    if (!s) return '';
    try { const p = NX.parseAccount(s); return p && p.value ? p.kind + ':' + p.value : s; } catch (e) { return s; }
  }
  const SYNTH_NOTE = (NX.Graph && NX.Graph.SYNTH_NOTE) || 'в демо история счёта в графе сгенерирована; в проде — реальные операции';
  function audit(action, ref, label, why, extra) {
    const r = roleOf();
    B.audit.push(Object.assign({ id: NX.uid('au'), ts: Date.now(), who: ROLES[r].name, role: ROLES[r].title, action, ref: ref || '', label: label || '', why: why || '' }, extra || {}));
    if (B.audit.length > 400) B.audit = B.audit.slice(-400);
    saveB();
  }

  /* ---------------- IOC: чтение и статусы ---------------- */
  const iocKey = (r) => r.kind + ':' + r.value;
  const effSt = (r) => (!r ? null : r.status === 'revoked' ? 'revoked' : r.expiresAt && Date.now() > r.expiresAt ? 'expired' : r.status || 'suspected');
  const active = (st) => (NX.iocActive ? NX.iocActive(st) : st === 'suspected' || st === 'corroborated' || st === 'confirmed');
  const strong = (st) => st === 'corroborated' || st === 'confirmed';
  const dispIoc = (r) => String((r && (r.raw || r.value)) || '');
  const srcList = (r) => ((r && r.sources && r.sources.length ? r.sources : [r && r.source]).filter(Boolean));
  const srcText = (r) => srcList(r).join(' + ') || 'NEXUS';
  const stLabel = (st) => (NX.IOC_STATUS && NX.IOC_STATUS[st]) || st || '';
  // [текст (*-ink, ≥ 4,5:1), подложка]; рамка — текст + альфа '66'
  const ST_STYLE = { suspected: [PAL.warnInk, 'var(--warn-soft)'], corroborated: [PAL.dangerInk, 'var(--danger-soft)'], confirmed: [PAL.dangerInk, rgbaOf(PAL.danger, 0.16)], revoked: [PAL.muted, 'var(--panel2)'], expired: [PAL.muted, 'var(--panel2)'] };
  function stChip(st) {
    const s = ST_STYLE[st] || ST_STYLE.suspected;
    return '<span class="ioc-st ioc-st-' + esc(st || 'suspected') + '" style="display:inline-flex;align-items:center;font-size:12px;font-weight:650;padding:2px 8px;border-radius:999px;white-space:nowrap;color:' + s[0] + ';background:' + s[1] + ';border:1px solid ' + s[0] + '66">' + esc(stLabel(st || 'suspected')) + '</span>';
  }
  const safeParse = (s) => { try { return NX.parseAccount(s); } catch (e) { return null; } };
  // фактор может прийти строкой или объектом {t, d} из scoreTransfer
  const factorText = (f) => (typeof f === 'string' ? f : f && typeof f === 'object' ? String(f.t || f.text || '') : String(f == null ? '' : f));
  // записи из сообщений шины — на случай, если localStorage другой вкладки ещё не синхронизировался
  const overrides = new Map();
  function remember(item) {
    if (!item || !item.kind || !item.value) return;
    const k = iocKey(item), prev = overrides.get(k);
    if (!prev || (item.lastChange || 0) >= (prev.lastChange || 0)) overrides.set(k, item);
  }
  function iocList() {
    let list = [];
    try { list = NX.iocs.all(); } catch (e) { list = []; }
    if (overrides.size) {
      const byKey = new Map(list.map((r) => [iocKey(r), r]));
      overrides.forEach((o, k) => {
        const r = byKey.get(k);
        if (!r) list.unshift(o);
        else if ((o.lastChange || 0) > (r.lastChange || 0)) list[list.indexOf(r)] = o;
        else overrides.delete(k); // хранилище догнало
      });
    }
    return list;
  }
  const sortIocs = (list) => list.slice().sort((a, b) => (b.firstSeen || b.ts || 0) - (a.firstSeen || a.ts || 0));
  function findIoc(x) {
    const list = iocList();
    if (!list.length) return null;
    if (x && typeof x === 'object') {
      if (x.id) { const r = list.find((i) => i.id === x.id); if (r) return r; }
      if (x.kind && (x.value || x.raw)) { const v = NX.normIoc(x.kind, x.value || x.raw); const r = list.find((i) => i.kind === x.kind && i.value === v); if (r) return r; }
      x = x.raw || x.value || '';
    }
    if (typeof x === 'string' && x.trim()) {
      const s = x.trim();
      let r = list.find((i) => i.id === s || i.value === s || i.raw === s || iocKey(i) === s);
      if (r) return r;
      const p = safeParse(s);
      if (p && p.value) { r = list.find((i) => i.kind === p.kind && i.value === p.value); if (r) return r; }
      let ex = [];
      try { ex = NX.extractIocs(s); } catch (e) { ex = []; }
      for (let k = 0; k < ex.length; k++) { r = list.find((i) => i.kind === ex[k].kind && i.value === ex[k].value); if (r) return r; }
      return null;
    }
    // без аргумента — самый свежий действующий реквизит (счёт/номер приоритетнее домена)
    const act = sortIocs(list.filter((i) => active(effSt(i))));
    // мерчант из Leak Radar — не реквизит перевода: «последним реквизитом» для сцены не считается
    const pay = act.filter((i) => i.kind !== 'merchant');
    return pay.find((i) => i.kind !== 'domain') || pay[0] || null;
  }
  function findIocByKey(key) {
    const k = String(key || ''), p = k.indexOf(':');
    if (p < 0) return null;
    const kind = k.slice(0, p), value = k.slice(p + 1);
    return iocList().find((i) => i.kind === kind && i.value === value) || null;
  }
  function iocForAccount(acc) {
    const s = String(acc == null ? '' : acc).trim();
    if (!s || s === '—') return null;
    const list = iocList();
    if (!list.length) return null;
    const p = safeParse(s);
    if (p && p.value) { const r = list.find((i) => i.kind === p.kind && i.value === p.value); if (r) return r; }
    let ex = [];
    try { ex = NX.extractIocs(s); } catch (e) { ex = []; }
    for (let k = 0; k < ex.length; k++) { const r = list.find((i) => i.kind === ex[k].kind && i.value === ex[k].value); if (r) return r; }
    return null;
  }
  const brief = (r) => (!r ? null : { id: r.id, kind: r.kind, value: r.value, raw: dispIoc(r), status: effSt(r), label: stLabel(effSt(r)), sources: srcList(r), firstSeen: r.firstSeen || r.ts || null });
  function quoteOf(r) {
    if (!r) return '';
    const q = [r.quote, r.utterance, r.context, r.phrase, r.text, r.line].find((x) => typeof x === 'string' && x.trim());
    return q ? q.trim().slice(0, 180) : '';
  }
  function mmss(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (s >= 3600) return Math.floor(s / 3600) + ' ч ' + NX.pad(Math.floor((s % 3600) / 60)) + ' мин';
    return Math.floor(s / 60) + ':' + NX.pad(s % 60);
  }

  let current = 'overview';
  function go(view) {
    let anchor = null;
    if (VIEW_ALIAS[view]) { anchor = VIEW_ALIAS[view][1]; view = VIEW_ALIAS[view][0]; }
    if (!VIEWS[view]) view = 'overview';
    current = view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const t = $('#viewTitle'), s = $('#viewSub');
    if (t) t.textContent = VIEWS[view][0];
    if (s) s.textContent = VIEWS[view][1];
    try { window.history.replaceState(null, '', '#' + view); } catch (e) { /* ignore */ }
    if (NX.closeSidebar) NX.closeSidebar();
    render();
    if (anchor) {
      const el = document.getElementById(anchor);
      if (el && el.scrollIntoView) setTimeout(() => { try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ignore */ } }, 60);
    }
  }
  function render() {
    const fn = { overview: renderOverview, monitor: () => renderMonitor(false), accounts: renderAccounts, incidents: renderIncidents, graph: () => { renderChainPanel(); syncLegend(); }, analytics: renderAnalyticsView }[current];
    try { if (fn) fn(); } catch (e) { console.error(e); }
    const n = B.incidents.filter((i) => i.status === 'new').length;
    const b = $('#incBadge');
    if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
  }

  /* ================= ПОТОК ОПЕРАЦИЙ (синтетика) ================= */
  const stream = [];
  const alerts = [];
  const buckets = []; // 30-секундные корзины за 30 минут
  const BUCKET = 30000;
  const FRAUD_RATE = 0.004; // доля мошеннических операций в синтетическом потоке
  let paused = false, secCount = 0, tps = 0, lastAuto = 0, streamTimer = null, lastTickAt = Date.now();
  const hoverPause = { alerts: false, mini: false, mon: false };
  let txSeq = 0;
  const txBase = 100000 + Math.floor(Math.random() * 800000);
  const nextTxId = () => 'TX' + (txBase + ++txSeq);
  const lg = (mu, s) => Math.exp(mu + s * (Math.random() + Math.random() + Math.random() - 1.5) * 1.4);
  const W8 = { newRecipient: 14, newDevice: 28, geo: 18, night: 10, mule: 70, remote: 42, call: 36, velocity: 14, bigAmount: 20 };
  const LBL = { newRecipient: 'новый получатель', newDevice: 'новое устройство', geo: 'гео-аномалия', night: 'ночь', mule: 'дроп-счёт', remote: 'удалённый доступ', call: 'звонок во время операции', velocity: 'серия операций', bigAmount: 'крупная сумма' };

  function advanceBuckets(now) {
    if (!buckets.length || now - buckets[buckets.length - 1].ts > 60 * BUCKET) {
      buckets.length = 0;
      for (let i = 59; i >= 0; i--) buckets.push({ ts: now - i * BUCKET, all: 0, high: 0 });
      return;
    }
    let last = buckets[buckets.length - 1];
    while (now - last.ts >= BUCKET) { last = { ts: last.ts + BUCKET, all: 0, high: 0 }; buckets.push(last); if (buckets.length > 60) buckets.shift(); }
  }
  function bucketFor(ts) {
    advanceBuckets(Math.max(ts, buckets.length ? buckets[buckets.length - 1].ts : ts));
    for (let i = buckets.length - 1; i >= 0; i--) if (ts >= buckets[i].ts) return buckets[i];
    return buckets[0];
  }
  function randomTo() {
    return Math.random() < 0.5
      ? '+7 7' + Math.floor(Math.random() * 90 + 10) + ' *** ' + Math.floor(Math.random() * 90 + 10) + ' ' + Math.floor(Math.random() * 90 + 10)
      : 'KZ' + Math.floor(Math.random() * 90 + 10) + ' •••• ' + Math.floor(1000 + Math.random() * 8999);
  }
  function genTx(ts) {
    const fraud = Math.random() < FRAUD_RATE;
    const p = (a, b) => Math.random() < (fraud ? b : a);
    const f = { newRecipient: p(0.22, 0.9), newDevice: p(0.04, 0.55), geo: p(0.04, 0.4), night: p(0.06, 0.35), mule: p(0, 0.42), remote: p(0.005, 0.25), call: p(0.02, 0.5), velocity: p(0.03, 0.3) };
    const amount = Math.round((fraud ? 120000 + Math.random() * 1800000 : lg(9.9, 1)) / 10) * 10;
    f.bigAmount = amount > 400000;
    const facts = Object.keys(f).filter((k) => f[k]);
    let score = facts.length ? NX.combine(facts.map((k) => W8[k])) : 2;
    score = NX.clamp(Math.round(score + (Math.random() - 0.5) * 10), 1, 99);
    const decision = score >= 80 ? 'block' : score >= 60 ? 'hold' : score >= 30 ? 'stepup' : 'pass';
    const ch = fraud ? NX.pick(['Мобильное приложение', 'P2P по номеру', 'Интернет-банк', 'Мобильное приложение']) : NX.pick(CHANNELS);
    const threat = fraud ? (f.mule ? (f.call ? 0 : 3) : f.newDevice ? 2 : f.call ? (Math.random() < 0.2 ? 5 : 0) : Math.random() < 0.5 ? 1 : 4) : -1;
    return {
      id: nextTxId(), ts: ts || Date.now(), client: NX.pick(FIRST) + ' ' + NX.pick(LAST), to: f.mule ? mask(NX.pick(NX.MULE_ACCOUNTS).account) : randomTo(),
      amount, channel: ch, city: f.geo ? NX.pick(['Бишкек', 'Ташкент', 'Стамбул', 'Шымкент', 'VPN · NL']) : NX.pick(CITIES), device: f.newDevice ? 'новое' : 'известное',
      facts: facts.map((k) => LBL[k]), score, decision, fraud, threat, live: false,
    };
  }
  // операция клиента из кабинета: строится явно (не через genTx — иначе мог унаследовать чужие признаки)
  function clientTxRow(p) {
    const score = Math.round(Number(p.score) || 0);
    const ok = !p.status || p.status === 'ok';
    const hit = iocForAccount(p.to);
    const facts = ['операция из кабинета'];
    if (hit) facts.push('реквизит в стоп-листе: ' + stLabel(effSt(hit)));
    return {
      id: nextTxId(), ts: Date.now(), client: String(p.client || 'Клиент') + ' (LIVE)', to: String(p.to || '—'), amount: Number(p.amount) || 0, score,
      channel: 'Мобильное приложение', city: 'Алматы', device: 'известное', facts, fraud: false, threat: -1, immune: false, rule: false, live: true,
      decision: ok ? (score >= 30 ? 'stepup' : 'pass') : score >= 60 ? 'block' : 'hold',
    };
  }
  function ingest(tx, opts) {
    const o = opts || {};
    stream.unshift(tx); if (stream.length > 300) stream.pop();
    S.processed++;
    if (!o.warm) secCount++;
    const held = tx.decision === 'block' || tx.decision === 'hold';
    // живые операции демо считаются отдельно (B.stats), чтобы не смешивать их с синтетикой
    if (!tx.live) {
      if (tx.score >= 30) S.flagged++;
      if (held) S.blocked++;
      if (tx.fraud && held) { S.tp++; S.prevented += tx.amount; } else if (!tx.fraud && held) S.fp++; else if (tx.fraud) S.fn++; else S.tn++;
      if (tx.fraud && tx.threat >= 0) { S.threat[tx.threat]++; S.hours[new Date(tx.ts).getHours()]++; }
      if (held) { const ci = CHANNELS.indexOf(tx.channel); if (ci >= 0) S.channels[ci]++; }
    }
    const bk = bucketFor(tx.ts); bk.all++; if (held) bk.high++;
    if (held) {
      alerts.unshift({ id: 'a_' + tx.id, ts: tx.ts, title: (tx.decision === 'block' ? 'Удержан для проверки: перевод ' : 'Пауза и звонок клиенту: перевод ') + NX.fmt(tx.amount), sub: tx.client + ' → ' + tx.to, score: tx.score, facts: tx.facts, tx });
      if (alerts.length > 40) alerts.pop();
      if (!o.warm && tx.fraud && tx.score >= 85 && Date.now() - lastAuto > 75000) {
        lastAuto = Date.now();
        B.incidents.unshift({ id: NX.uid('inc'), ts: Date.now(), client: tx.client, type: THREATS[tx.threat] || 'Социальная инженерия', title: 'Авто-инцидент: ' + tx.facts.slice(0, 2).join(' + ') + ' · ' + NX.fmt(tx.amount), score: tx.score, amount: tx.amount, account: tx.to, source: 'NEXUS Core · синтетический поток', status: 'new', factors: tx.facts.slice(), chain: [{ t: 'Операция ' + tx.id + ' · ' + tx.channel, ts: tx.ts }], notes: [], synthetic: true });
        if (B.incidents.length > 80) B.incidents.pop();
      }
    }
  }
  // 30 минут истории синтетического потока — через тот же генератор, чтобы график и счётчики сходились
  function warmUp() {
    const now = Date.now();
    advanceBuckets(now);
    const start = buckets[0].ts;
    for (let b = 0; b < buckets.length - 1; b++) { // текущая корзина наполняется живым потоком
      const n = 36 + Math.round(Math.random() * 14);
      for (let i = 0; i < n; i++) {
        const ts = Math.min(now - 50, start + b * BUCKET + Math.random() * BUCKET);
        ingest(genTx(ts), { warm: true });
      }
    }
    stream.sort((a, b) => b.ts - a.ts);
    alerts.sort((a, b) => b.ts - a.ts);
  }
  function renderStreamViews() {
    if (current === 'overview') { renderKpis(false); renderAlerts(false); const hc = $('#heroCount'); if (hc) hc.textContent = cnt(S.processed, F.op); }
    else if (current === 'monitor') renderMonitor(true);
  }
  function streamTick() {
    if (dead) return;
    const modalOpen = NX.isModalOpen && NX.isModalOpen();
    if (!document.hidden) {
      if (!paused && !modalOpen) {
        const n = Math.random() < 0.3 ? 2 : 1;
        for (let i = 0; i < n; i++) ingest(genTx());
        renderStreamViews();
      }
      lastTickAt = Date.now();
    }
    streamTimer = setTimeout(streamTick, 650 + Math.random() * 700);
  }
  // вкладка снова видима: досинхронизировать поток за время в фоне и перерисовать
  function catchUp() {
    const now = Date.now(), gap = now - lastTickAt;
    if (dead) return;
    if (!paused && gap > 3000) {
      const n = Math.min(60, Math.round((gap / 1000) * 1.4));
      for (let i = 0; i < n; i++) ingest(genTx(lastTickAt + ((i + 1) / (n + 1)) * gap), { warm: true });
      stream.sort((a, b) => b.ts - a.ts);
    }
    lastTickAt = now;
    advanceBuckets(now);
    render();
    drawFlow();
  }
  function updateTps() {
    tps = secCount / 2; secCount = 0;
    const el = $('#tpsLabel');
    if (!el) return;
    const modal = NX.isModalOpen && NX.isModalOpen();
    el.textContent = (paused ? 'поток на паузе' : (modal ? 'пауза: открыто окно · ' : '') + tps.toFixed(1).replace('.', ',') + ' опер./с');
  }

  /* ================= OVERVIEW ================= */
  let kpiHtml = '';
  function responseTime() {
    const d = [];
    // только реальные действия в этой панели: заготовленные заметки демо-кейсов (seed) не считаются
    B.incidents.forEach((i) => { const n = (i.notes || []).filter((x) => x && !x.seed && x.ts > i.ts)[0]; if (n) d.push(n.ts - i.ts); });
    if (!d.length) return null;
    const avg = d.reduce((a, b) => a + b, 0) / d.length, min = avg / 60000;
    return { n: d.length, text: min < 1 ? Math.max(1, Math.round(avg / 1000)) + ' с' : (min < 10 ? String(Math.round(min * 10) / 10).replace('.', ',') : String(Math.round(min))) + ' мин' };
  }
  function renderKpis(force) {
    const el = $('#kpis'); if (!el) return;
    const s = B.stats;
    const open = B.incidents.filter((i) => i.status === 'new' || i.status === 'progress').length;
    const rt = responseTime();
    const live = s.livePrevented + s.iocPrevented;
    // 4 KPI «Сейчас»: число + одна строка; порог удержания — во всплывающей подсказке
    const html = [
      ['Проверено операций', NX.num(S.processed) + ' ' + NX.ui.tagDemo('демо'), 'синтетический поток, выборка 1:1000', 'list', 'Поток операций сгенерирован симулятором: 1 операция в демо ≈ 1000 настоящих'],
      ['Удержано подозрительных', NX.num(S.blocked + s.liveHeld + s.iocHeld), 'переводы ждут проверки аналитика', 'shield', 'Перевод удерживается, если оценка риска 60 из 100 и выше или получатель в стоп-листе с подтверждением'],
      ['Сохранено денег клиентов, ₸', NX.fmt(S.prevented + live), live ? 'из них в живом демо: ' + NX.fmt(live) : 'по синтетическому потоку', 'shieldCheck', 'Сумма удержанных переводов, которые симулятор пометил как мошеннические, плюс удержанные переводы живого демо. Попытки без перевода и снятые ложные удержания не входят'],
      ['Открытых инцидентов', NX.num(open), rt ? 'первая реакция в среднем ' + rt.text : 'ждут решения аналитика', 'folder', 'Новые и взятые в работу кейсы. Время реакции — по журналу этой панели, заготовленные заметки демо-кейсов не учитываются'],
    ].map((k) => '<div class="card kpi" title="' + esc(k[4]) + '"><div class="label"><span style="width:16px;height:16px;display:inline-flex">' + NX.icon(k[3], '', 16) + '</span>' + esc(k[0]) + '</div><div class="value">' + k[1] + '</div><div class="delta muted">' + esc(k[2]) + '</div></div>').join('');
    if (!force && html === kpiHtml) return;
    kpiHtml = html; el.innerHTML = html;
  }
  // «Сейчас» · C слева: очередь кейсов, которым нужен ответ аналитика (топ-5)
  const riskW = (score) => { const r = NX.ui.riskWord(score); return '<span class="risk-word ' + r.level + '" title="' + esc('оценка риска ' + Math.round(Number(score) || 0) + ' из 100') + '">' + esc(r.word) + '</span>'; };
  let queueHtml = '';
  function renderQueue() {
    const box = $('#queue'); if (!box) return;
    const open = B.incidents.filter((i) => i.status === 'new' || i.status === 'progress');
    const live = (i) => (i.fromClient || i.stage ? 1 : 0);
    const top = open.slice().sort((a, b) => live(b) - live(a) || (b.ts || 0) - (a.ts || 0)).slice(0, 5);
    const html = top.map((i) => '<div class="li q-row" data-inc="' + esc(i.id) + '" role="button" tabindex="0"><div class="ic">' + NX.icon(KIND_ICON[i.kind] || (i.fromClient ? 'brain' : 'folder'), '', 18) + '</div><div class="grow" style="min-width:0"><div class="t">' + esc(i.title) + '</div><div class="s">' + esc(i.client) + ' · ' + esc(NX.ago(i.ts)) + '</div></div>' + (i.kind && !(Number(i.score) > 0) ? '<span class="badge info plain">' + esc(KIND_RU[i.kind] || 'обращение') + '</span>' : riskW(i.score)) + '</div>').join('') ||
      '<div class="empty">Очередь пуста: все кейсы разобраны</div>';
    if (html !== queueHtml) { box.innerHTML = html; queueHtml = html; }
    const nt = $('#queueNote');
    if (nt) nt.textContent = open.length > 5 ? 'и ещё ' + cnt(open.length - 5, F.inc) : '';
  }
  // «Сейчас» · C справа: 4 плитки «Новые функции» — 1 число и 1 ссылка
  const TILES = [
    { id: 'leak', name: 'Карты для магазинов', count: () => B.incidents.filter(isLeakKind).length, unit: ['сигнал утечки', 'сигнала утечки', 'сигналов утечки'], go: 'mount:leakRadarMount', icon: 'card' },
    { id: 'deal', name: 'Безопасная сделка', count: () => B.incidents.filter((i) => i.kind === 'sd_dispute').length, unit: ['спор', 'спора', 'споров'], go: 'mount:sdBankMount', icon: 'shieldCheck' },
    { id: 'mule_exit', name: 'Не стань дропом', count: () => B.incidents.filter((i) => i.kind === 'mule_exit' && !i.mxDispute).length, unit: ['клиент вышел из схемы', 'клиента вышли из схемы', 'клиентов вышли из схемы'], go: 'kind:mule_exit', icon: 'users' },
    // заявки на кредит: credit-lock.js пишет в инцидент поле frozen (сколько заявок заморожено замком; 0 — замок был выключен)
    { id: 'credit_lock', name: 'Кредитный замок', count: () => B.incidents.filter((i) => i.kind === 'credit_lock').reduce((a, i) => a + (i.frozen != null ? Number(i.frozen) || 0 : 1), 0), unit: ['заявка заморожена', 'заявки заморожены', 'заявок заморожено'], go: 'kind:credit_lock', icon: 'lock' },
  ];
  let tilesHtml = '';
  function renderTiles() {
    const box = $('#featTiles'); if (!box) return;
    const feats = (NX.ui && NX.ui.FEATURES) || [];
    const html = TILES.map((t) => {
      const f = feats.find((x) => x.id === t.id);
      const ready = !f || f.ready !== false;
      const n = t.count();
      return '<button type="button" class="ft" data-tile="' + esc(t.go) + '"><span class="ft-h">' + NX.icon(t.icon, '', 16) + esc(t.name) + '</span><span class="ft-n">' + NX.num(n) + '</span><span class="ft-s">' + esc(NX.plural(n, t.unit)) + (ready ? '' : ' · готовится') + '</span><span class="ft-go">' + esc(t.go.indexOf('kind:') === 0 ? 'Инциденты →' : 'Открыть →') + '</span></button>';
    }).join('');
    if (html !== tilesHtml) { box.innerHTML = html; tilesHtml = html; }
  }
  function openTile(target) {
    const g = String(target || '');
    if (g.indexOf('kind:') === 0) { go('incidents'); setIncFilter(null, g.slice(5)); return; }
    if (g.indexOf('mount:') === 0) {
      const d = $('#nowMore'); if (d) d.open = true;
      const el = document.getElementById(g.slice(6));
      if (el && el.scrollIntoView) setTimeout(() => { try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ignore */ } }, 40);
    }
  }
  // «Сейчас» · A: тихое состояние героя — «Атак нет · N операций проверено» + «Запустить атаку»
  function quietHeroHTML() {
    // стоп-лист без атаки — ссылкой в этой же строке (на «Сейчас» нет места под отдельную карточку)
    let nIoc = 0; try { nIoc = iocList().map(effSt).filter(active).length; } catch (e) { nIoc = 0; }
    const imm = nIoc || B.pending.length ? ' <button type="button" class="link-btn small" data-imm-open="1">стоп-лист: ' + esc(cnt(nIoc, F.ioc)) + (B.pending.length ? ' · ждут подписи: ' + B.pending.length : '') + '</button>' : '';
    return '<div class="now-hero quiet mb"><div class="grow" style="min-width:0"><b>Атак нет</b><span class="muted"> · <span id="heroCount">' + esc(cnt(S.processed, F.op)) + '</span> проверено</span> ' + NX.ui.tagDemo('синтетика') + imm + '</div><button type="button" class="btn primary bank-act" data-run-attack="1">' + NX.icon('play', { size: 16 }) + 'Запустить атаку</button></div>';
  }
  // «▶ Запустить атаку»: существующий сценарий захвата аккаунта из кабинета клиента (NX.Stage.runDemoCore)
  function runAttack() {
    let w = null;
    try { w = window.open('', 'nexus_client'); } catch (e) { w = null; }
    if (!w) { NX.toast('Не удалось открыть кабинет клиента', 'Разрешите всплывающие окна для этой страницы или откройте «Кабинет клиента» вручную', 'warn', 'info'); return; }
    let fresh = false;
    try { fresh = !w.NX || !w.NX.Stage || !/client\.html/.test(String(w.location.pathname)); } catch (e) { fresh = true; }
    if (fresh) { try { w.location.href = 'client.html?demo=1'; } catch (e) { /* ignore */ } }
    NX.toast('Атака запущена в кабинете клиента', 'Соседняя вкладка: SMS, ссылка, вход с нового устройства, попытка поднять лимит · синтетические данные', 'info', 'alert');
    let tries = 0;
    const tick = () => {
      tries++;
      let ok = false;
      try { if (w.NX && w.NX.Stage && typeof w.NX.Stage.runDemoCore === 'function' && w.document.readyState === 'complete') { w.NX.Stage.runDemoCore(); ok = true; } } catch (e) { ok = false; }
      if (!ok && tries < 40) setTimeout(tick, 300);
      else if (!ok) NX.toast('Кабинет клиента не ответил', 'Откройте кабинет клиента и запустите демо там', 'warn', 'info');
    };
    setTimeout(tick, fresh ? 700 : 50);
    try { window.focus(); } catch (e) { /* ignore */ }
  }
  const decBadge = (d) => ({ block: '<span class="badge high">удержан</span>', hold: '<span class="badge med">пауза · звонок</span>', stepup: '<span class="badge info">доп. подтверждение</span>', pass: '<span class="badge ok">пропущен</span>' }[d] || '<span class="badge info">—</span>');
  const rowCls = (t) => (t.score >= 60 ? 'row-high' : t.score >= 30 ? 'row-med' : '');
  const miniRow = (t, fresh) => '<tr class="' + (fresh ? 'stream-row-new ' : '') + rowCls(t) + '" data-tx="' + esc(t.id) + '" tabindex="0" style="cursor:pointer"><td class="mono small">' + NX.time(t.ts) + '</td><td>' + esc(t.client) + '</td><td>' + NX.fmt(t.amount) + '</td><td class="hide-m muted">' + esc(t.channel) + '</td><td>' + NX.badge(t.score) + '</td></tr>';
  let miniTop = null;
  function renderMiniStream(full) {
    const tb = $('#miniStream'); if (!tb) return;
    if (!full && hoverPause.mini) return;
    if (full || !miniTop || !tb.children.length) {
      tb.innerHTML = stream.slice(0, 9).map((t) => miniRow(t, false)).join('');
      miniTop = stream[0] ? stream[0].id : null;
      return;
    }
    const fresh = [];
    for (let i = 0; i < stream.length && fresh.length < 9; i++) { if (stream[i].id === miniTop) break; fresh.push(stream[i]); }
    if (!fresh.length) return;
    tb.insertAdjacentHTML('afterbegin', fresh.map((t) => miniRow(t, true)).join(''));
    while (tb.children.length > 9) tb.removeChild(tb.lastElementChild);
    miniTop = stream[0].id;
  }
  let alertKey = '';
  function renderAlerts(force) {
    const box = $('#alerts'); if (!box) return;
    const live = B.incidents.filter((i) => i.status === 'new' && (i.fromClient || i.stage));
    const top = alerts.slice(0, 12);
    // события конституции клиента за последние 30 минут закреплены над синтетическим потоком
    const cons = consPinned();
    const key = cons.map((e) => e.id + ':' + e.title).join(',') + '|' + live.map((i) => i.id).join(',') + '|' + top.map((a) => a.id).join(',');
    if (!force && (key === alertKey || hoverPause.alerts)) return;
    alertKey = key;
    box.innerHTML = cons.map(consRowHTML).join('') +
      live.map((i) => '<div class="li" style="cursor:pointer" data-inc="' + esc(i.id) + '" role="button" tabindex="0"><div class="ic" style="background:var(--danger-soft);color:var(--danger-ink)">' + NX.icon(KIND_ICON[i.kind] || 'brain', '', 18) + '</div><div class="grow"><div class="t">' + esc(i.title) + '</div><div class="s">' + esc(i.client) + ' · ' + esc(i.type) + ' · ' + esc(NX.ago(i.ts)) + '</div></div>' + scoreBadge(i) + '</div>').join('') +
      top.map((a) => '<div class="li"' + (a.tx ? ' style="cursor:pointer" data-tx="' + esc(a.tx.id) + '" role="button" tabindex="0"' : '') + '><div class="ic" style="background:var(--danger-soft);color:var(--danger-ink)">' + NX.icon(a.call ? 'phone' : 'alert', '', 18) + '</div><div class="grow"><div class="t">' + esc(a.title) + '</div><div class="s">' + esc(a.sub) + ' · ' + esc((a.facts || []).slice(0, 2).join(', ')) + '</div></div><span class="tiny muted">' + NX.hm(a.ts) + '</span></div>').join('') ||
      '<div class="empty">Нет алертов</div>';
  }
  function threatIndex(type) {
    const t = String(type || '');
    if (/ATO|Захват/i.test(t)) return 2;
    if (/дроп/i.test(t)) return 3;
    if (/фишинг/i.test(t)) return 1;
    if (/инвест/i.test(t)) return 4;
    if (/deepfake|синтез|голос/i.test(t)) return 5;
    return 0;
  }
  function renderThreatBars(el) {
    if (!el) return;
    const c = THREATS.map(() => 0);
    B.incidents.forEach((i) => { c[threatIndex(i.type)]++; });
    S.threat.forEach((v, k) => (c[k] += v));
    const mx = Math.max.apply(null, c.concat([1]));
    el.innerHTML = THREATS.map((t, i) => '<div class="bar-row"><span class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t) + '</span><div class="bar"><i style="width:' + (c[i] / mx) * 100 + '%;background:' + THREAT_COLORS[i] + '"></i></div><span class="v">' + c[i] + '</span></div>').join('') +
      '<p class="tiny muted mt-s">По инцидентам в очереди и синтетическому потоку.</p>';
  }
  function drawFlow() {
    const cv = $('#flowChart'); if (!cv || current !== 'analytics' || dead) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    advanceBuckets(Date.now());
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const W = r.width, H = r.height, pad = 24;
    const mx = Math.max.apply(null, buckets.map((b) => b.all).concat([10]));
    const mh = Math.max.apply(null, buckets.map((b) => b.high).concat([4]));
    g.clearRect(0, 0, W, H);
    g.strokeStyle = PAL.grid; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = pad / 2 + ((H - pad * 1.5) * i) / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const X = (i) => (i / Math.max(1, buckets.length - 1)) * W;
    const Y = (v) => H - pad - (v / mx) * (H - pad * 1.6);
    const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, rgbaOf(PAL.accent, 0.3)); grad.addColorStop(1, rgbaOf(PAL.accent, 0));
    g.beginPath(); g.moveTo(0, H - pad); buckets.forEach((b, i) => g.lineTo(X(i), Y(b.all))); g.lineTo(W, H - pad); g.closePath(); g.fillStyle = grad; g.fill();
    g.beginPath(); buckets.forEach((b, i) => (i ? g.lineTo(X(i), Y(b.all)) : g.moveTo(0, Y(b.all)))); g.strokeStyle = PAL.accent; g.lineWidth = 2; g.stroke();
    const bw = Math.max(2, W / buckets.length - 3);
    buckets.forEach((b, i) => { if (!b.high) return; const h = (b.high / mh) * (H - pad * 1.6) * 0.55; g.fillStyle = PAL.danger; g.fillRect(X(i) - bw / 2, H - pad - h, bw, h); });
    g.fillStyle = PAL.muted; g.font = '12px Inter, sans-serif';
    g.textAlign = 'left'; g.fillText('−30 мин', 2, H - 6); if (W >= 300) g.fillText('синтетический поток · выборка 1:1000', 2, 12);
    g.textAlign = 'right'; g.fillText('сейчас', W - 2, H - 6);
  }
  function renderOverview() {
    renderLive(); renderCycle(); renderImmunity(false); renderKpis(true); renderQueue(); renderTiles(); renderAlerts(true); renderConsPanel(); renderTc();
    const cc = $('#consCount'); if (cc) cc.textContent = B.cons.stats.fired ? 'сработало правил: ' + NX.num(B.cons.stats.fired) : '';
  }
  function renderAnalyticsView() { drawFlow(); renderThreatBars($('#threatBars')); renderAnalytics(); }

  /* ---------- живые сигналы от клиентской части ---------- */
  const liveState = { call: null, attack: null, hold: null, cons: null, manip: null, em: true };
  const closeBtn = (k) => '<button type="button" class="btn sm ghost" data-live-close="' + k + '" aria-label="Скрыть" title="Скрыть">' + NX.icon('x') + '</button>';
  // Баннеры перерисовываются целиком на каждое событие; анимация появления (.live-in) —
  // только у баннера, которого не было в прошлой отрисовке, идентичная разметка не пишется вовсе.
  let liveHtmlPrev = null, liveKeysPrev = new Set();
  function renderLive() {
    const box = $('#liveAttack'); if (!box) return;
    renderCycle(); // индикатор стадий гаснет вместе с атакой
    const ib = $('#immunity'); if (ib) ib.classList.toggle('hidden', !(immForce || isAttackLive()));
    const segs = [];
    const em = emHTML();
    if (em) segs.push(['em:' + (B.em && B.em.at), em]);
    if (liveState.cons) segs.push(['cons', consLiveHTML()]);
    if (liveState.hold) segs.push(['hold:' + (liveState.hold.ts || ''), holdCardHTML(liveState.hold)]);
    let html = '';
    const c = liveState.call;
    if (c) {
      const head = c.ended
        ? '<span class="dot" style="background:var(--muted);color:var(--muted)"></span><b>Защита звонка: звонок клиенту ' + esc(c.client || '') + ' завершён</b>'
        : '<span class="dot pulse" style="background:var(--danger);color:var(--danger)"></span><b>LIVE · Защита звонка: ' + (c.score != null ? 'мошеннический звонок' : 'идёт звонок') + ' клиенту ' + esc(c.client || '') + '</b>';
      const meta = [];
      if (c.score != null) meta.push(esc(c.category || 'вишинг'));
      if (c.lead != null) meta.push('предупредили за ' + c.lead + ' с до просьбы кода');
      if (c.ended) meta.push('звонок завершён' + (c.durationMs ? ' · длительность ' + esc(mmss(c.durationMs)) : '') + (c.alerted === false ? ' · тревога не поднималась' : ''));
      if (c.ts) meta.push(NX.hm(c.ts));
      html += '<div class="live-banner mb"' + (c.ended ? ' style="border-color:var(--line2);background:var(--bg2)"' : '') + '><div class="row between wrap"><div class="row gap-s">' + head + '</div><div class="row gap-s">' + (c.score != null ? '<span class="badge ' + (c.ended ? 'plain' : 'high') + '">индекс риска ' + c.score + '</span>' : '') + closeBtn('call') + '</div></div>' +
        (meta.length ? '<div class="small muted mt-s">' + meta.join(' · ') + '</div>' : '') +
        (c.quote ? '<div class="small mt-s">«' + esc(String(c.quote).slice(0, 200)) + '»</div>' : '') +
        (liveState.manip ? manipHTML(liveState.manip) : '') +
        (c.decoy ? '<div class="notice mt-s">Звонок переадресован на номер-ловушку банка (' + NX.hm(c.decoyTs) + '): робот-приманка NEXUS ведёт разговор, приманка не знает данных клиента и не совершает операций. Реквизиты, названные мошенником, поступят в стоп-лист со статусом «на проверке».' + (c.decoyEnd ? ' Сессия ловушки завершена.' : '') + '</div>' : '') + '</div>';
    }
    if (c) { segs.push(['call', html]); html = ''; }
    else if (liveState.manip) {
      const m = liveState.manip;
      segs.push(['manip', '<div class="live-banner mb"><div class="row between wrap"><div class="row gap-s"><span class="dot pulse" style="background:var(--danger);color:var(--danger)"></span><b>LIVE · Детектор манипуляций: звонок клиенту ' + esc(m.client || '') + '</b></div><div class="row gap-s"><span class="badge high">индекс риска ' + m.riskIndex + '</span>' + closeBtn('manip') + '</div></div>' + manipHTML(m) + '</div>']);
    }
    const a = liveState.attack;
    if (a) {
      html += '<div class="live-banner mb"><div class="row between wrap"><div class="row gap-s"><span class="dot pulse" style="background:var(--danger);color:var(--danger)"></span><b>LIVE · NEXUS Core отслеживает цепочку атаки на клиента ' + esc(a.client || '') + '</b></div><div class="row gap-s"><span class="badge high">индекс риска ' + a.risk + '</span>' + closeBtn('attack') + '</div></div>' +
        '<div class="step-list mt">' + a.steps.map((s) => '<div class="step ' + (s.i >= 3 ? 'alert' : 'done') + '"><div class="n">' + (s.i + 1) + '</div><div class="grow"><b>' + esc(s.t) + '</b><div class="small muted">' + NX.time(s.ts) + (s.amount ? ' · ' + NX.fmt(s.amount) : '') + '</div></div>' + (s.score ? NX.badge(s.score) : '') + '</div>').join('') + '</div>' +
        (a.incidentId ? '<div class="row wrap mt"><button type="button" class="btn danger" data-inc="' + esc(a.incidentId) + '">Открыть инцидент</button><button type="button" class="btn" data-live-graph="1">Показать в графе связей</button></div>' : '') + '</div>';
      segs.push(['attack', html]);
    }
    // герой «Сейчас»: заголовок «Атака прямо сейчас», пока идёт звонок/атака/удержание; без событий — тихое состояние
    // нет идущей атаки (звонок завершён, «Заблокировать всё» снято, журнал правил без атаки) — тихое состояние:
    // закрытые случаи живут в «Инцидентах», а не в герое «Сейчас» (2.4-A)
    if (!isAttackLive()) { segs.length = 0; segs.push(['quiet', quietHeroHTML()]); }
    else segs.unshift(['hdr', '<div class="now-hero-h"><span class="dot pulse" style="background:var(--danger);color:var(--danger)"></span><b>Атака прямо сейчас</b><span class="tiny muted">живое демо · синтетические данные</span></div>']);
    const raw = segs.map((s) => s[1]).join('');
    const keys = new Set(segs.map((s) => s[0]));
    if (raw === liveHtmlPrev && box.childElementCount === segs.length) { liveKeysPrev = keys; return; }
    const out = segs.map((s) => liveKeysPrev.has(s[0]) ? s[1] : s[1].replace('class="live-banner', 'class="live-banner live-in')).join('');
    liveHtmlPrev = raw; liveKeysPrev = keys;
    box.innerHTML = out;
  }
  // идёт ли атака прямо сейчас: активный звонок, цепочка атаки, удержанный перевод, детектор манипуляций или включённое «Заблокировать всё»
  function isAttackLive() {
    const c = liveState.call;
    return !!((c && !c.ended) || liveState.attack || liveState.hold || (liveState.manip && !(c && c.ended)) || (B.em && B.em.active && liveState.em !== null));
  }
  // начало текущей атаки: самое раннее время среди живых сигналов (минус минута на события, записанные чуть раньше)
  function attackSince() {
    const ts = [];
    const c = liveState.call;
    if (c && !c.ended && c.ts) ts.push(c.ts);
    if (liveState.hold && liveState.hold.ts) ts.push(liveState.hold.ts);
    if (liveState.attack && liveState.attack.steps && liveState.attack.steps.length) ts.push(Math.min.apply(null, liveState.attack.steps.map((s) => s.ts || Date.now())));
    if (B.em && B.em.active && B.em.at) ts.push(B.em.at);
    return ts.length ? Math.min.apply(null, ts) - 60000 : 0;
  }
  function closeLive(k) { if (k in liveState) liveState[k] = null; renderLive(); renderCycle(); }
  function leadOf(p) {
    const v = [p.leadSec, p.lead, p.secondsBeforeCode, p.beforeCodeSec, p.leadS].find((x) => typeof x === 'number' && isFinite(x));
    return v == null ? null : Math.max(0, Math.round(v));
  }
  function handleShieldAlert(p) {
    const score = Math.round(Number(p.score) || 0);
    alerts.unshift({ id: NX.uid('sh'), ts: Date.now(), title: 'Защита звонка: звонок мошенника · индекс риска ' + score, sub: String(p.client || 'Клиент') + ' · ' + String(p.category || 'вишинг'), score, facts: ['распознано в речи'], tx: null, call: true });
    if (alerts.length > 40) alerts.pop();
    const prev = liveState.call && !liveState.call.ended ? liveState.call : null;
    const lead = leadOf(p);
    liveState.call = Object.assign(prev || {}, { client: p.client, score, category: p.category, quote: p.quote, lead: lead != null ? lead : prev ? prev.lead : null, ts: Date.now(), ended: false });
    renderLive();
    if (current === 'overview') renderAlerts(true);
    if (!prev) logCycle('detect', 'Защита звонка: мошеннический звонок клиенту ' + String(p.client || '') + ' · индекс риска ' + score);
    NX.toast('Защита звонка', String(p.client || 'Клиент') + ': мошеннический звонок распознан во время разговора', 'high', 'phone');
  }
  // shield_lead {client, leadSec}: за сколько секунд до просьбы кода клиента предупредили
  function handleShieldLead(p) {
    const lead = leadOf(p);
    if (lead == null) return;
    if (liveState.call && !liveState.call.ended) liveState.call.lead = lead;
    else liveState.call = { client: p.client, lead, ts: Date.now() };
    renderLive();
  }
  // shield_end {client, alerted, durationMs}: звонок завершён — баннер больше не «LIVE»
  function handleShieldEnd(p) {
    const c = liveState.call;
    if (!c) return; // звонок без тревоги — в панели его не было
    c.ended = true;
    c.endTs = Date.now();
    if (typeof p.durationMs === 'number' && isFinite(p.durationMs)) c.durationMs = Math.max(0, p.durationMs);
    if (typeof p.alerted === 'boolean') c.alerted = p.alerted;
    renderLive();
  }
  // bank_call_cleared {client, callId, reason}: клиент снял отметку «звонит банк» в приложении (или истёк её срок)
  function handleBankCallCleared(p) {
    const cid = String(p.callId || '');
    if (!cid) return;
    const i = (B.incidents || []).find((x) => x.bankCall && x.bankCall.callId === cid);
    if (!i) return;
    const wasOpen = !!document.getElementById('iBankCallEnd');
    delete i.bankCall;
    i.notes = i.notes || [];
    i.notes.push({ ts: Date.now(), t: p.reason === 'ttl' ? 'Срок отметки «звонит банк» в приложении клиента истёк' : 'Клиент отметил в приложении, что звонок закончился · отметка снята', by: 'приложение клиента' });
    saveB();
    if (wasOpen) openIncident(i.id);
  }
  function handleDecoyStart(p) {
    liveState.call = Object.assign(liveState.call || { client: p.client, ts: Date.now() }, { decoy: true, decoyTs: Date.now(), decoyEnd: false });
    renderLive();
    logCycle('investigate', 'Робот-приманка: мошенник передан номеру-ловушке, идёт сбор реквизитов');
    NX.toast('Робот-приманка: звонок на номере-ловушке', String(p.client || 'Клиент') + ' — мошенник передан приманке, идёт сбор реквизитов', 'warn', 'target');
  }

  /* ================= ФИНАНСОВАЯ КОНСТИТУЦИЯ КЛИЕНТА ================= */
  // Персональные правила защиты от манипуляций, которые клиент установил сам (NX.Constitution в кабинете).
  // Это не банковские лимиты: банк исполняет волю клиента и видит, какая статья сработала.
  // Панель получает события по шине (constitution_hit / constitution_change / protective_mode /
  // guardian_request / guardian_response) и читает подписанную редакцию из общего хранилища демо (только чтение).
  const CONS_KEY = (NX.Constitution && NX.Constitution.KEY) || KEYS.constitution || 'nexus_ai_constitution_v1';
  const CONS_WINDOW = 30 * 60000; // «живое» окно: баннер, закреплённые алерты, связь с инцидентом
  const CONS_DEFAULT = {
    1: ['new_recipient_limit', 'Не переводить более 100 000 ₸ новым получателям без дополнительной проверки'],
    2: ['flagged_accounts', 'Не разрешать переводы на счета, отмеченные как подозрительные'],
    3: ['amount_spike', 'При резком изменении суммы требовать повторного подтверждения'],
    4: ['plan_deviation', 'Если операция сильно отличается от запланированной — включать защитный режим'],
    5: ['guardian_help', 'Доверенное лицо может помочь проверить ситуацию (клиент подключил заранее)'],
    6: ['call_guard', 'Во время телефонного звонка — переводы новым получателям только после проверки'],
    7: ['anchor', 'Правило 24 часов: ослабить статью можно только через 24 часа и с уведомлением доверенного лица; во время звонка — нельзя'],
  };
  const CONS_WHERE = { new_recipient_limit: 'новому получателю', flagged_accounts: 'на счёт из стоп-листа', amount_spike: 'с резким скачком суммы', plan_deviation: 'вне финансового плана клиента', call_guard: 'новому получателю во время звонка', night_guard: 'в ночное время' };
  const DEC_RANK = { allow: 0, confirm: 1, hold: 2, protect: 3 };
  const DEC_RU = { confirm: 'дополнительная проверка', hold: 'удержан для проверки', protect: 'защитный режим', allow: 'разрешён' };
  const DEC_CLS = { confirm: 'warn', hold: 'high', protect: 'high', allow: 'ok' };
  const TONE_IC = { high: ['var(--danger-soft)', 'var(--danger-ink)'], warn: ['var(--warn-soft)', 'var(--warn-ink)'], ok: ['var(--ok-soft)', 'var(--ok-ink)'], info: ['var(--accent-soft)', 'var(--accent-ink)'] };
  const consIco = (size) => '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12.5l2 2 4-4"/><path d="M9 18h6"/></svg>';
  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  // кем включён защитный режим: 0 — самим клиентом вручную
  const protBy = (n) => (n === 0 ? ' вручную клиентом' : n != null ? ' статьёй ' + n : '');
  const artNum = (v) => { const n = Number(v); return v != null && v !== '' && isFinite(n) ? n : null; };

  // подписанная редакция конституции клиента (кабинет пишет её в общее хранилище демо)
  let consCache = { raw: undefined, doc: null };
  function consDoc() {
    let raw = null;
    try { raw = localStorage.getItem(CONS_KEY); } catch (e) { raw = null; }
    if (raw === consCache.raw) return consCache.doc;
    let doc = null;
    try { doc = raw ? JSON.parse(raw) : null; } catch (e) { doc = null; }
    if (doc && !Array.isArray(doc.articles) && doc.state && Array.isArray(doc.state.articles)) doc = doc.state;
    if (!doc || !Array.isArray(doc.articles)) doc = null;
    consCache = { raw, doc };
    return doc;
  }
  function articleInfo(n) {
    const doc = consDoc();
    const a = doc && n != null ? doc.articles.find((x) => x && Number(x.n) === n) : null;
    if (a) return { n, kind: str(a.kind), title: str(a.title) || str(a.text), enabled: a.enabled !== false, builtin: !!a.builtin };
    const d = CONS_DEFAULT[n];
    return d ? { n, kind: d[0], title: d[1], enabled: true, builtin: true } : { n, kind: '', title: '', enabled: true, builtin: false };
  }
  function guardianOf(g) {
    if (!g) return null;
    if (typeof g === 'string') return g.trim() ? { name: g.trim(), relation: '' } : null;
    if (typeof g === 'object' && str(g.name)) return { name: str(g.name), relation: str(g.relation) };
    return null;
  }
  function consGuardian() {
    const doc = consDoc();
    if (doc && doc.guardian && doc.guardian.enabled !== false) {
      const g = guardianOf(doc.guardian);
      if (g) return g;
    }
    // params.auto: имя зависит от персоны клиента и вычисляется в constitution.js (doc.guardian); имя по умолчанию из params не берём —
    // иначе клиент и доверенное лицо в карточке могут оказаться одним человеком
    if (doc) { const a = doc.articles.find((x) => x && x.kind === 'guardian_help' && x.enabled !== false); if (a && a.params && a.params.auto === false) return guardianOf(a.params); }
    return null;
  }
  const gName = (g) => (g ? g.name + (g.relation ? ' (' + g.relation + ')' : '') : 'доверенное лицо');
  function artLabel(ns, cap) {
    const l = ns.filter((n) => n != null);
    if (!l.length) return cap ? 'Статья конституции' : 'статья конституции';
    const s = l.length === 1 ? String(l[0]) : l.slice(0, -1).join(', ') + ' и ' + l[l.length - 1];
    return (l.length === 1 ? (cap ? 'Статья ' : 'статья ') : (cap ? 'Статьи ' : 'статьи ')) + s;
  }
  function normHits(list) {
    return (Array.isArray(list) ? list : []).map((h) => {
      if (!h || typeof h !== 'object') return null;
      const n = artNum(h.n);
      const info = articleInfo(n);
      return { n, title: str(h.title) || info.title, decision: DEC_RANK[h.decision] != null ? h.decision : null, kind: str(h.kind) || info.kind };
    }).filter(Boolean);
  }
  const topDec = (hits) => hits.reduce((d, h) => ((DEC_RANK[h.decision] || 0) > (DEC_RANK[d] || 0) ? h.decision : d), 'allow');
  const uniqNs = (hits) => hits.map((h) => h.n).filter((n, i, a) => n != null && a.indexOf(n) === i).sort((a, b) => a - b);
  function hitTitle(hits, decision, amount) {
    const main = hits.filter((h) => h.decision === decision);
    const use = main.length ? main : hits;
    const ns = uniqNs(use), many = ns.length > 1;
    const kind = (use[0] && use[0].kind) || '';
    const where = CONS_WHERE[kind] ? ' ' + CONS_WHERE[kind] : '';
    const sum = amount > 0 ? ' ' + NX.fmt(amount) : '';
    const head = artLabel(ns, true) + ' конституции клиента ';
    if (decision === 'protect') return head + (many ? 'включили' : 'включила') + ' защитный режим: перевод' + sum + where;
    if (decision === 'hold') return head + (many ? 'удержали' : 'удержала') + ' перевод' + sum + where;
    if (decision === 'confirm') return head + (many ? 'запросили ' : 'запросила ') + (kind === 'amount_spike' ? 'повторное подтверждение' : 'дополнительную проверку') + ' перевода' + sum + where;
    return head + (many ? 'сработали' : 'сработала') + (sum ? ': перевод' + sum : '');
  }
  const clientKey = (s) => (str(s).toLowerCase().replace(/[^a-zа-яёәғқңөұүһі0-9]+/g, ' ').trim().split(' ')[0] || '');
  const sameClient = (a, b) => { const x = clientKey(a), y = clientKey(b); return !x || !y || x === y; };
  function consLog(entry) {
    const e = Object.assign({ id: NX.uid('ce'), ts: Date.now(), client: '', tone: 'info', title: '', sub: '' }, entry);
    B.cons.log.unshift(e);
    if (B.cons.log.length > 80) B.cons.log.length = 80;
    liveState.cons = { client: e.client, ts: e.ts };
    return e;
  }
  // последний инцидент клиента рядом по времени (для таймлайна)
  function nearIncident(client, ts, amount, win) {
    return B.incidents.find((i) => (i.fromClient || i.stage) && !(i.stage && i.synthetic && /Сауле/.test(String(i.client || ''))) && Math.abs((i.ts || 0) - ts) <= (win || 180000) && sameClient(i.client, client) && (!amount || !(Number(i.amount) > 0) || Number(i.amount) === amount)) || null;
  }
  function linkHit(e) {
    const inc = nearIncident(e.client, e.ts, e.amount, 180000);
    if (!inc) return;
    e.incId = inc.id;
    if (!inc.constitution || !Array.isArray(inc.constitution.hits) || !inc.constitution.hits.length) inc.constitution = { hits: e.hits, decision: e.decision, via: 'bus' };
  }
  // статьи, сработавшие в инциденте: явное поле от кабинета → факторы «Статья N вашей конституции…» → событие шины
  function consFor(i) {
    if (!i) return null;
    if (i.constitution && Array.isArray(i.constitution.hits) && i.constitution.hits.length) {
      const hits = normHits(i.constitution.hits);
      if (hits.length) return { hits, decision: DEC_RANK[i.constitution.decision] != null ? i.constitution.decision : topDec(hits) };
    }
    const fromF = [];
    (i.factors || []).forEach((f) => {
      const m = /Стать[яи]\s+(\d+)\s+(?:вашей\s+)?конституци/i.exec(factorText(f));
      if (m && !fromF.some((h) => h.n === Number(m[1]))) fromF.push({ n: Number(m[1]), decision: null });
    });
    if (fromF.length) {
      // решение каждой статьи в факторах не передаётся — показываем «сработала», без домыслов
      const held = /^Удержан/i.test(String(i.title || ''));
      return { hits: normHits(fromF), decision: held ? 'hold' : null };
    }
    return null;
  }
  function attachCons(inc) {
    if (!inc || !inc.fromClient) return;
    const e = B.cons.log.find((x) => x.type === 'hit' && !x.incId && Math.abs(x.ts - (inc.ts || 0)) <= 180000 && sameClient(x.client, inc.client) && (!x.amount || !(Number(inc.amount) > 0) || Number(inc.amount) === x.amount));
    if (e) {
      e.incId = inc.id;
      // событие шины точнее факторов (в нём все статьи и их решения); явное поле от кабинета — главнее всего
      if (!inc.constitution || !Array.isArray(inc.constitution.hits) || !inc.constitution.hits.length) inc.constitution = { hits: e.hits, decision: e.decision, via: 'bus' };
    }
    B.cons.log.forEach((x) => { if (x.type !== 'hit' && !x.incId && x.tone === 'high' && Math.abs(x.ts - (inc.ts || 0)) <= CONS_WINDOW && sameClient(x.client, inc.client)) x.incId = inc.id; });
  }
  // события конституции, относящиеся к инциденту (связанные явно или того же клиента в окне ±30 мин)
  function consEventsFor(i) {
    if (!i || !(i.fromClient || i.stage)) return [];
    if (i.stage && /Сауле/.test(String(i.client || ''))) return B.cons.log.filter((e) => e.incId === i.id);
    return B.cons.log.filter((e) => e.incId === i.id || (!e.incId && Math.abs(e.ts - (i.ts || 0)) <= CONS_WINDOW && sameClient(e.client, i.client))).slice(0, 12);
  }
  function protNow() {
    const p = B.cons.prot;
    if (p && p.active && (!p.until || p.until > Date.now())) return p;
    const doc = consDoc();
    const d = doc && doc.protective;
    if (d && d.active && (!d.until || Number(d.until) > Date.now())) return { active: true, reason: str(d.reason), articleN: artNum(d.articleN), until: Number(d.until) || null, client: '' };
    return null;
  }
  function consPinned() {
    const now = Date.now();
    return B.cons.log.filter((e) => (e.tone === 'high' || e.tone === 'warn') && now - e.ts <= CONS_WINDOW).slice(0, 4);
  }
  function consKpiDelta() {
    const s = B.cons.stats, parts = [];
    if (s.stopped) parts.push('<span class="danger-text">удержано переводов: ' + NX.num(s.stopped) + (s.stoppedSum ? ' · ' + NX.fmt(s.stoppedSum) : '') + '</span>');
    if (s.confirms) parts.push('доп. проверок: ' + NX.num(s.confirms));
    if (s.refused) parts.push('<span class="warn-text">отклонено попыток ослабить защиту: ' + NX.num(s.refused) + '</span>');
    if (protNow()) parts.push('<span class="danger-text">защитный режим включён</span>');
    return parts.length ? parts.join('<span class="muted"> · </span>') : '<span class="muted">правила, которые клиент установил сам · срабатываний пока нет</span>';
  }
  function consRowHTML(e) {
    const t = TONE_IC[e.tone] || TONE_IC.info;
    return '<div class="li cons-row" data-cons="' + esc(e.id) + '" role="button" tabindex="0"><div class="ic" style="background:' + t[0] + ';color:' + t[1] + '">' + consIco(18) + '</div><div class="grow"><div class="t">' + esc(e.title) + '</div><div class="s">' + esc([e.sub, NX.ago(e.ts)].filter(Boolean).join(' · ')) + '</div></div><span class="badge plain cons-tag">конституция</span></div>';
  }
  function decBadgeCons(d, kind) { return d ? '<span class="badge ' + (DEC_CLS[d] || 'plain') + '">' + esc(d === 'confirm' && kind === 'amount_spike' ? 'повторное подтверждение' : DEC_RU[d] || d) + '</span>' : '<span class="badge plain">сработала</span>'; }
  function artRowHTML(h) {
    return '<div class="cons-art"><span class="cons-n ' + esc(h.decision || '') + '">' + (h.n != null ? h.n : '•') + '</span><div class="grow"><div class="small"><b>' + (h.n != null ? 'Статья ' + h.n + '.' : 'Статья.') + '</b> ' + esc(h.title || 'правило клиента') + '</div></div>' + decBadgeCons(h.decision, h.kind) + '</div>';
  }
  function consLiveHTML() {
    const lc = liveState.cons;
    if (!lc) return '';
    const evs = B.cons.log.filter((e) => Date.now() - e.ts <= CONS_WINDOW && sameClient(e.client, lc.client));
    if (!evs.length) return '';
    const hit = evs.find((e) => e.type === 'hit');
    const prot = protNow();
    const g = consGuardian();
    const gq = evs.find((e) => e.type === 'guardian_req' || e.type === 'guardian_resp');
    const refused = evs.filter((e) => e.type === 'change' && e.action === 'refused').length;
    const client = lc.client || (hit && hit.client) || 'клиента';
    const incId = (hit && hit.incId) || (evs.find((e) => e.incId) || {}).incId || null;
    const chips = [];
    if (prot) chips.push('<span class="cons-chip high">' + NX.icon('lock', '', 14) + 'Защитный режим включён' + protBy(prot.articleN) + (prot.until ? ' · до ' + esc(prot.until - Date.now() > 12 * 3600000 ? NX.dateTime(prot.until) : NX.hm(prot.until)) : '') + '</span>');
    if (gq) chips.push('<span class="cons-chip ' + (gq.type === 'guardian_resp' ? (gq.verdict === 'reject' ? 'high' : 'ok') : 'warn') + '">' + NX.icon('users', '', 14) + esc(gq.type === 'guardian_resp' ? (gq.verdict === 'reject' ? 'Доверенное лицо: «Это мошенники»' : 'Доверенное лицо подтвердило операцию') : 'Запрос доверенному лицу: ' + gName(gq.guardian || g)) + '</span>');
    else if (g) chips.push('<span class="cons-chip">' + NX.icon('users', '', 14) + 'Доверенное лицо: ' + esc(gName(g)) + '</span>');
    if (refused) chips.push('<span class="cons-chip warn">' + NX.icon('shield', '', 14) + 'Правило 24 часов: отклонено попыток ослабить защиту — ' + refused + '</span>');
    return '<div class="live-banner cons-live mb"><div class="row between wrap"><div class="row gap-s" style="min-width:0"><span class="dot pulse" style="background:var(--accent);color:var(--accent)"></span><b>LIVE · Финансовая конституция клиента ' + esc(client) + '</b></div><div class="row gap-s">' + (hit ? decBadgeCons(hit.decision) : '') + closeBtn('cons') + '</div></div>' +
      (hit ? '<div class="row wrap gap-l mt-s" style="align-items:flex-end"><div><div class="cons-amt">' + (hit.amount ? NX.fmt(hit.amount) : '—') + '</div><div class="small">' + esc(hit.client || 'Клиент') + (hit.recipient ? ' → <span class="mono">' + esc(dispAcc(hit.recipient)) + '</span>' : '') + '</div></div><div class="small grow" style="min-width:200px">' + esc(hit.title) + '</div></div>' +
        '<div class="col mt-s" style="gap:6px">' + hit.hits.map(artRowHTML).join('') + '</div>' : '') +
      (chips.length ? '<div class="cons-chips mt-s">' + chips.join('') + '</div>' : '') +
      '<div class="list mt-s cons-mini">' + evs.filter((e) => e !== hit).slice(0, 3).map((e) => '<div class="li"><span class="mono tiny muted">' + NX.time(e.ts) + '</span><div class="grow"><div class="small" style="white-space:normal">' + esc(e.title) + '</div>' + (e.sub ? '<div class="tiny muted">' + esc(e.sub) + '</div>' : '') + '</div></div>').join('') + '</div>' +
      '<p class="tiny muted mt-s">Это правила самого клиента, установленные заранее в спокойной обстановке, а не лимиты банка. Банк исполняет их и видит, какая статья сработала.</p>' +
      '<div class="row wrap gap-s mt-s">' + (incId ? '<button type="button" class="btn sm" data-inc="' + esc(incId) + '">Открыть инцидент</button>' : '') + '<button type="button" class="btn sm ghost" data-cons-log="1">' + consIco(16) + 'Журнал конституции</button></div></div>';
  }
  function consDocSummaryHTML(compact) {
    const doc = consDoc();
    const prot = protNow();
    const g = consGuardian();
    if (!doc) {
      return '<p class="small muted">Редакция конституции появится здесь, когда клиент сохранит её в кабинете. Срабатывания статей приходят в панель по шине событий.</p>' + (prot ? '<div class="notice mt-s">Защитный режим включён' + protBy(prot.articleN) + '</div>' : '');
    }
    const arts = doc.articles.filter(Boolean);
    const on = arts.filter((a) => a.enabled !== false).length;
    const hash = str(doc.hash);
    const pend = (Array.isArray(doc.pending) ? doc.pending : []).filter((c) => c && (c.status || 'pending') === 'pending');
    let html = '<dl class="kv"><dt>Правила подписаны</dt><dd>' + (doc.signedAt ? esc(NX.dateTime(Number(doc.signedAt))) : 'да') + '</dd>' +
      '<dt>Правил</dt><dd>' + NX.num(arts.length) + ' · включено ' + NX.num(on) + '</dd>' +
      '<dt>Близкий человек</dt><dd>' + (g ? esc(gName(g)) : '<span class="muted">не подключено</span>') + '</dd>' +
      '<dt>Защитный режим</dt><dd>' + (prot ? '<span class="danger-text">включён' + protBy(prot.articleN) + (prot.until ? ' · до ' + esc(NX.dateTime(prot.until)) : '') + '</span>' : 'выключен') + '</dd></dl>' +
      (hash && !compact ? '<div class="cons-hash mt-s" title="Отпечаток правил: по нему видно, что их не меняли без клиента">отпечаток: ' + esc(hash.slice(0, 16) + '…') + '</div>' : '');
    if (pend.length) {
      html += '<div class="notice warn mt-s"><b>Ожидают 24 ч (правило 24 часов):</b> ' + pend.slice(0, 3).map((c) => {
        const a = doc.articles.find((x) => x && x.id === c.articleId);
        return esc((a ? 'ослабление статьи ' + a.n : 'ослабление статьи') + (c.effectiveAt ? ' — вступит в силу ' + NX.dateTime(Number(c.effectiveAt)) : ''));
      }).join('; ') + '. Ослабление защиты в период ожидания — повод для звонка клиенту с официального номера.</div>';
    }
    return html;
  }
  function renderConsPanel() {
    const box = $('#consPanel'); if (!box) return;
    const log = B.cons.log.slice(0, 5);
    box.innerHTML = consDocSummaryHTML(true) + '<div class="divider"></div>' +
      (log.length ? '<div class="list">' + log.map(consRowHTML).join('') + '</div>' : '<div class="small muted">Срабатываний пока нет. Когда правило клиента удержит перевод или мошенник попытается уговорить клиента ослабить защиту во время звонка, событие появится здесь, в алертах и в инциденте.</div>');
  }
  function openConsLog(focusId) {
    const doc = consDoc();
    const s = B.cons.stats;
    const arts = doc ? doc.articles.filter(Boolean).slice().sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0)) : Object.keys(CONS_DEFAULT).map((n) => ({ n: Number(n), title: CONS_DEFAULT[n][1], enabled: true, builtin: true }));
    const hist = doc && Array.isArray(doc.history) ? doc.history.slice(-6).reverse() : [];
    const evs = B.cons.log.map((e) => '<div class="li' + (e.id === focusId ? ' cons-focus' : '') + '"' + (e.incId ? ' data-inc="' + esc(e.incId) + '" role="button" tabindex="0" style="cursor:pointer"' : '') + '><div class="ic" style="background:' + (TONE_IC[e.tone] || TONE_IC.info)[0] + ';color:' + (TONE_IC[e.tone] || TONE_IC.info)[1] + '">' + consIco(16) + '</div><div class="grow"><div class="small" style="white-space:normal"><b>' + esc(e.title) + '</b></div><div class="tiny muted">' + esc([NX.dateTime(e.ts), e.sub].filter(Boolean).join(' · ')) + (e.incId ? ' · открыть инцидент →' : '') + '</div></div></div>').join('') || '<div class="empty">Событий пока нет</div>';
    bmodal('<div class="row between wrap"><h3>Финансовая конституция клиента</h3><span class="badge plain">' + esc(cnt(B.cons.log.length, F.entry)) + '</span></div>' +
      '<p class="small muted">Персональные правила защиты от манипуляций, которые клиент установил сам. Это не банковские лимиты: удержание по статье — исполнение воли клиента. Банк видит срабатывания, подписанную редакцию и журнал поправок.</p>' +
      '<div class="grid g2 mt"><div>' + consDocSummaryHTML(false) + '</div><div><div class="small muted mb" style="margin-bottom:6px">Статьи · сработало в этой панели</div><div class="col" style="gap:6px">' + arts.map((a) => '<div class="cons-art' + (a.enabled === false ? ' off' : '') + '"><span class="cons-n">' + esc(str(a.n) || '•') + '</span><div class="grow small">' + esc(str(a.title) || str(a.text)) + (a.enabled === false ? ' <span class="tag">выключена</span>' : '') + '</div><span class="mono small">' + NX.num(s.byN[a.n] || 0) + '</span></div>').join('') + '</div></div></div>' +
      (hist.length ? '<h4 class="mt mb" style="font-size:13px">История поправок</h4><div class="list">' + hist.map((h) => '<div class="li"><span class="mono tiny muted">' + esc(h.ts ? NX.dateTime(Number(h.ts)) : '') + '</span><div class="grow small" style="white-space:normal">' + (h.version ? 'Редакция №' + esc(str(h.version)) + ' · ' : '') + esc(str(h.summary)) + '</div></div>').join('') + '</div>' : '') +
      '<h4 class="mt mb" style="font-size:13px">Журнал событий в Fraud Fusion Center</h4><div class="list" style="max-height:44vh;overflow:auto">' + evs + '</div>' +
      '<p class="tiny muted mt-s">В демо редакция читается из общего хранилища браузера; в проде — подписанный документ в профиле клиента, банк получает только срабатывания и отпечаток.</p>' +
      '<div class="row mt" style="justify-content:flex-end"><button type="button" class="btn" data-close>Закрыть</button></div>', { wide: true });
  }
  function consClick(id) {
    const e = B.cons.log.find((x) => x.id === id);
    if (e && e.incId && B.incidents.some((i) => i.id === e.incId)) openIncident(e.incId);
    else openConsLog(id);
  }
  function refreshCons() {
    if (current === 'overview') { renderLive(); renderKpis(true); renderAlerts(true); renderConsPanel(); renderTc(); const cw = $('#consWhy'); if (cw) cw.innerHTML = consWhyHTML(); }
    else if (current === 'incidents') renderIncidents();
  }
  function onConsHit(p) {
    const hits = normHits(p.hits);
    if (!hits.length) return;
    const decision = DEC_RANK[p.decision] != null && p.decision !== 'allow' ? p.decision : topDec(hits);
    const amount = Math.max(0, Number(p.amount) || 0);
    const s = B.cons.stats;
    s.fired += hits.length;
    hits.forEach((h) => { if (h.n != null) s.byN[h.n] = (s.byN[h.n] || 0) + 1; });
    if (decision === 'hold' || decision === 'protect') { s.stopped++; s.stoppedSum += amount; } else if (decision === 'confirm') s.confirms++;
    const client = str(p.client), recipient = str(p.recipient);
    const e = consLog({ type: 'hit', client, hits, decision, amount, recipient, tone: decision === 'confirm' ? 'warn' : 'high', title: hitTitle(hits, decision, amount), sub: (client || 'Клиент') + (recipient ? ' → ' + dispAcc(recipient) : '') });
    linkHit(e);
    saveB();
    logCycle('protect', e.title, e.incId ? { inc: e.incId } : null);
    refreshCons();
    NX.toast('Финансовая конституция клиента', e.title, decision === 'confirm' ? 'warn' : 'high', 'shieldCheck');
  }
  function onConsChange(p) {
    const n = artNum(p.articleN), a = str(p.action), summary = str(p.summary);
    const acc = n != null ? 'статью ' + n : 'статью конституции';
    const gen = n != null ? 'статьи ' + n : 'статьи конституции';
    const eff = Number(p.effectiveAt) || 0;
    const g = consGuardian();
    const s = B.cons.stats;
    let title, tone = 'info';
    if (a === 'refused' && p.held === true) {
      // уже запрошенное ослабление дошло до срока во время звонка/атаки — оно удержано, это не новая попытка
      const why = (str(p.reason) + ' ' + str(p.refused)).toLowerCase();
      title = 'Правило 24 часов: ослабление ' + gen + ' удержано — ' + (/attack|атак/.test(why) ? 'NEXUS Core видит признаки атаки' : 'идёт звонок') + ', вступит в силу, когда угроза пройдёт';
      tone = 'warn';
    } else if (a === 'refused') {
      s.refused++;
      const why = (str(p.reason) + ' ' + str(p.refused) + ' ' + summary).toLowerCase();
      const during = /attack|атак/.test(why) ? ' во время сигнала атаки NEXUS Core' : /call|звон/.test(why) || (liveState.call && !liveState.call.ended) ? ' во время звонка' : '';
      // «доверенное лицо уведомлено» — только если запрос опекуну действительно ушёл: флаг в payload
      // или событие guardian_request этого клиента за последние 20 с (иначе допишет onGuardianReq)
      const cl = str(p.client);
      const gr = p.guardianRequested || p.guardianNotified || p.guardianRequestId ? true
        : B.cons.log.find((x) => x.type === 'guardian_req' && !x.refLinked && Date.now() - x.ts < 20000 && (!cl || !x.client || x.client === cl));
      if (gr && gr !== true) gr.refLinked = true;
      title = 'Правило 24 часов: попытка ослабить ' + acc + during + ' отклонена' + (gr ? ' · доверенное лицо уведомлено' : '');
      tone = 'high';
    } else if (a === 'weaken_requested') {
      s.weakenReq++;
      title = 'Клиент запросил ослабление ' + gen + ' — вступит в силу ' + (eff ? NX.dateTime(eff) : 'через 24 ч') + ' (правило 24 часов)' + ((p.guardianNotified != null ? !!p.guardianNotified : !!g) ? ', доверенное лицо уведомлено' : ', доверенное лицо не подключено');
      tone = 'warn';
    } else if (a === 'weaken_applied') title = 'Ослабление ' + gen + ' вступило в силу после периода ожидания';
    else if (a === 'weaken_cancelled') { title = 'Ослабление ' + gen + ' отменено — защита сохранена'; tone = 'ok'; }
    else if (a === 'strengthen') { title = 'Клиент усилил ' + acc + ' — действует сразу'; tone = 'ok'; }
    else if (a === 'add') { title = 'В конституцию добавлена ' + (n != null ? 'статья ' + n : 'новая статья'); tone = 'ok'; }
    else if (a === 'remove') title = (n != null ? 'Статья ' + n : 'Статья') + ' исключена из конституции';
    else title = 'Изменение конституции клиента' + (n != null ? ' · статья ' + n : '');
    const e = consLog({ type: 'change', action: a, client: str(p.client), n, tone, title, sub: summary, effectiveAt: eff || null });
    if (tone === 'high') { const inc = nearIncident(e.client, e.ts, 0, CONS_WINDOW); if (inc) e.incId = inc.id; }
    saveB();
    if (a === 'refused') logCycle('protect', title, e.incId ? { inc: e.incId } : null);
    refreshCons();
    if (a === 'refused') NX.toast('Правило 24 часов', title, p.held === true ? 'warn' : 'high', p.held === true ? 'clock' : 'shield');
    else if (a === 'weaken_requested') NX.toast('Конституция клиента', title, 'warn', 'clock');
  }
  function onProtective(p) {
    const active = !!p.active, n = artNum(p.articleN), until = Number(p.until) || null;
    B.cons.prot = { client: str(p.client), active, reason: str(p.reason), articleN: n, until, ts: Date.now() };
    if (active) B.cons.stats.protectiveOn++;
    const title = active
      ? 'Защитный режим включён ' + (n === 0 ? 'клиентом вручную' : n != null ? 'статьёй ' + n + ' конституции клиента' : 'по конституции клиента') + (until ? ' · до ' + NX.dateTime(until) : '')
      : 'Защитный режим клиента выключен';
    consLog({ type: 'protective', client: str(p.client), n, active, tone: active ? 'high' : 'ok', title, sub: str(p.reason) });
    saveB();
    if (active) logCycle('protect', title);
    refreshCons();
    NX.toast(active ? 'Защитный режим клиента' : 'Защитный режим выключен', title, active ? 'high' : 'ok', 'lock');
  }
  function onGuardianReq(p) {
    const id = str(p.id) || NX.uid('gr');
    const g = guardianOf(p.guardian) || consGuardian();
    const amount = Math.max(0, Number(p.amount) || 0), n = artNum(p.articleN);
    B.cons.guard[id] = { id, client: str(p.client), guardian: g, reason: str(p.reason), articleN: n, amount, ts: Date.now(), verdict: null };
    const keys = Object.keys(B.cons.guard);
    if (keys.length > 40) keys.slice(0, keys.length - 40).forEach((k) => delete B.cons.guard[k]);
    B.cons.stats.guardianReq++;
    // отказ якоря секундой раньше: уведомление доверенному лицу подтверждено — дописываем в алерт
    const ref = B.cons.log.find((e) => e.type === 'change' && e.action === 'refused' && Date.now() - e.ts < 20000 && e.title.indexOf('доверенное лицо уведомлено') < 0);
    if (ref) ref.title += ' · доверенное лицо уведомлено';
    const sub = [str(p.reason), amount ? 'перевод ' + NX.fmt(amount) : '', n != null ? 'статья ' + n : ''].filter(Boolean).join(' · ');
    consLog({ type: 'guardian_req', gid: id, client: str(p.client), guardian: g, n, amount, refLinked: !!ref, tone: 'warn', title:'Доверенному лицу ' + gName(g) + ' отправлен запрос на проверку ситуации', sub });
    tcAdd({ id, client: str(p.client) || clientFromState(), guardian: g, amount, reason: str(p.reason), source: 'client' });
    saveB();
    logCycle('protect', 'Близкие: запрос на проверку отправлен доверенному лицу ' + gName(g));
    refreshCons();
  }
  function onGuardianResp(p) {
    const id = str(p.id), rec = B.cons.guard[id] || null;
    const verdict = p.verdict === 'reject' ? 'reject' : 'approve';
    const by = str(p.by);
    const g = (rec && rec.guardian) || consGuardian();
    const who = g ? g.name : 'Доверенное лицо';
    if (rec) { rec.verdict = verdict; rec.by = by; rec.rts = Date.now(); }
    if (verdict === 'reject') B.cons.stats.guardianReject++;
    const title = verdict === 'reject' ? who + ': «Это мошенники» — включён защитный режим' : who + ': «Всё в порядке» — операция клиента подтверждена';
    const sub = by === 'demo' ? 'в демо ответ дан кнопкой за доверенное лицо' : by && by !== 'guardian' ? 'ответ: ' + by : 'ответ доверенного лица';
    const e = consLog({ type: 'guardian_resp', gid: id, client: str(p.client) || (rec && rec.client) || '', guardian: g, verdict, tone: verdict === 'reject' ? 'high' : 'ok', title, sub });
    if (verdict === 'reject') { const inc = nearIncident(e.client, e.ts, 0, CONS_WINDOW); if (inc) e.incId = inc.id; }
    tcResolve(id, verdict === 'reject' ? 'hold' : 'ok', by || 'guardian');
    saveB();
    logCycle('protect', 'Близкие: ' + who + (verdict === 'reject' ? ' — «Нужна проверка — удержать»' : ' — «Всё в порядке — я рядом»'), e.incId ? { inc: e.incId } : null);
    refreshCons();
    NX.toast('Доверенное лицо ответило', e.title, verdict === 'reject' ? 'high' : 'ok', 'users');
  }
  function consWhyHTML() {
    const s = B.cons.stats;
    const ns = Object.keys(s.byN).map(Number).filter((n) => isFinite(n)).sort((a, b) => a - b);
    const mx = Math.max.apply(null, ns.map((n) => s.byN[n]).concat([1]));
    const ic = (n) => '<span class="cons-why-ic">' + (n === 'cons' ? consIco(18) : NX.icon(n, '', 18)) + '</span>';
    const pts = [
      ['clock', 'Решение принято заранее, а не под давлением', 'Мошенник управляет жертвой в моменте: срочность, страх, «безопасный счёт». Статью клиент пишет в спокойной обстановке, а якорь Одиссея не даёт ослабить её во время звонка — уговорить «отключить защиту» не получится.'],
      ['target', 'Персональный порог вместо общего лимита', 'Для пенсионерки 100 000 ₸ новому получателю — аномалия, для предпринимателя — обычный день. Проверка включается там, где её ждёт сам клиент, и не задевает остальных.'],
      ['shieldCheck', 'Удержание — воля клиента, а не решение банка', 'Клиент заранее согласился на паузу и проверку, поэтому удержание по статье не выглядит как «банк заморозил мои деньги» — его проще объяснить и сложнее оспорить под диктовку мошенника.'],
      ['users', 'Второе мнение рядом', 'Доверенное лицо, которое клиент подключил сам, подтверждает или останавливает операцию — это тот самый собеседник, которого мошенник просит исключить («никому не говорите»).'],
      ['cons', 'Объяснимо для аналитика', 'В инциденте видно, какая статья сработала и почему; каждая редакция подписана отпечатком SHA-256, поправки ведутся в журнале. Попытка ослабить статью во время звонка — отдельный сильный сигнал атаки.'],
    ];
    return '<div class="grid g2 cons-why">' + pts.map((p) => '<div class="cons-why-item">' + ic(p[0]) + '<div><b>' + esc(p[1]) + '</b><div class="small muted mt-s">' + esc(p[2]) + '</div></div></div>').join('') +
      '<div class="cons-why-item"><div style="width:100%"><b>Срабатывания статей в этой панели</b><div class="tiny muted mb" style="margin-bottom:6px">живые события демо, не оценка эффекта</div>' +
        (ns.length ? ns.map((n) => '<div class="bar-row"><span class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(articleInfo(n).title) + '">Статья ' + n + '</span><div class="bar"><i style="width:' + (s.byN[n] / mx) * 100 + '%;background:' + PAL.accent + '"></i></div><span class="v">' + NX.num(s.byN[n]) + '</span></div>').join('') +
          '<div class="tiny muted mt-s">Удержано переводов: ' + NX.num(s.stopped) + ' · доп. проверок: ' + NX.num(s.confirms) + ' · отклонено попыток ослабить: ' + NX.num(s.refused) + ' · ответов «Это мошенники»: ' + NX.num(s.guardianReject) + '</div>'
          : '<div class="small muted">Пока нет срабатываний. Проведите перевод в кабинете клиента или запустите сцену — статьи появятся здесь.</div>') +
      '</div></div></div>' +
      '<h4 class="mt mb" style="font-size:13px">Как измерить эффект на пилоте</h4><ol class="small" style="margin:0;padding-left:18px;line-height:1.6">' +
        '<li>A/B в сегменте 60+: потери от социальной инженерии у клиентов с конституцией и без неё при одинаковых правилах банка.</li>' +
        '<li>Доля удержаний по статьям, подтверждённых как мошенничество, и доля отменённых самим клиентом после проверки.</li>' +
        '<li>Попытки ослабить статью во время звонка — как ранний сигнал атаки для антифрода.</li>' +
        '<li>Время ответа доверенного лица и доля ответов «Это мошенники».</li>' +
        '<li>Жалобы на удержания — в сравнении с удержаниями по правилам банка.</li>' +
      '</ol><p class="tiny muted mt-s">Цифр эффекта здесь нет намеренно: честную оценку даст только пилот на данных банка.</p>';
  }

  /* ================= MONITOR ================= */
  function hasSelection() { try { const s = window.getSelection && window.getSelection(); return !!s && String(s).length > 0; } catch (e) { return false; } }
  // фильтр по умолчанию — «Удержанные и высокий риск»
  let monFilter = 'focus';
  const MON_F = {
    focus: (t) => t.decision === 'block' || t.decision === 'hold' || NX.level(t.score).key === 'high',
    all: () => true,
    held: (t) => t.decision === 'block' || t.decision === 'hold',
    high: (t) => NX.level(t.score).key === 'high',
    med: (t) => NX.level(t.score).key === 'med',
  };
  function renderMonitor(fromStream) {
    const body = $('#monBody');
    if (!body) return;
    if (fromStream && (hoverPause.mon || hasSelection())) return;
    const q = ($('#monSearch') ? $('#monSearch').value : '').toLowerCase();
    const pass = MON_F[monFilter] || MON_F.all;
    const rows = stream.filter((t) => pass(t) && (!q || (t.client + ' ' + t.to + ' ' + t.city + ' ' + t.id + ' ' + t.channel).toLowerCase().indexOf(q) >= 0));
    const mc = $('#monCount');
    if (mc) mc.textContent = 'Показано ' + Math.min(rows.length, 120) + ' из ' + stream.length + ' в буфере · синтетический поток, выборка 1:1000 · строка открывает подробности';
    // 7 колонок; на телефоне строка превращается в карточку (подписи — из data-l)
    body.innerHTML = rows.slice(0, 120).map((t, i) => '<tr class="' + (fromStream && i === 0 ? 'stream-row-new ' : '') + rowCls(t) + '" data-tx="' + esc(t.id) + '" tabindex="0" style="cursor:pointer"><td class="mono small" data-l="Время">' + NX.time(t.ts) + '</td><td data-l="Клиент">' + esc(t.client) + '</td><td class="mono small" data-l="Получатель">' + esc(t.to) + '</td><td class="num" data-l="Сумма">' + NX.fmt(t.amount) + '</td><td class="small" data-l="Канал">' + esc(t.channel) + '</td><td data-l="Риск">' + riskW(t.score) + '</td><td data-l="Решение">' + decBadge(t.decision) + '</td></tr>').join('') ||
      '<tr><td colspan="7" class="muted">Под фильтр сейчас ничего не попало</td></tr>';
  }
  function setMonFilter(f) {
    if (!MON_F[f]) return;
    monFilter = f;
    $$('#monChips [data-mf]').forEach((b) => { const on = b.dataset.mf === f; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    renderMonitor(false);
  }
  /* ---------- стандартное окно банка (spec 2.4) ----------
     Липкая шапка: заголовок H3, тип (бейдж), риск, «×» с aria-label. Тело: разделы. Липкий подвал: до 3 действий
     (primary · secondary · ghost) и меню «Ещё ▾». На ≤ 560 px — лист на весь экран, действия закреплены внизу.
     Кнопки передаются готовой разметкой (у каждой свой id — обработчики вешает вызывающий). */
  function stdModal(o) {
    const more = (o.more || []).filter(Boolean);
    const meta = [o.type ? '<span class="badge plain">' + esc(o.type) + '</span>' : '', o.riskHtml || '', o.statusHtml || ''].filter(Boolean).join('');
    const html = '<div class="bm-h"><div class="bm-ht"><h3 id="bmTitle">' + esc(o.title || '') + '</h3>' + (meta ? '<div class="bm-meta">' + meta + '</div>' : '') + '</div>' +
      '<button type="button" class="nx-x" data-close aria-label="Закрыть окно">×</button></div>' +
      '<div class="bm-b">' + (o.body || '') + '</div>' +
      '<div class="bm-f">' + (more.length ? '<details class="bm-more"><summary class="btn ghost sm">Ещё' + NX.icon('chevron-down', { size: 16 }) + '</summary><div class="bm-menu" role="menu">' + more.join('') + '</div></details>' : '<span></span>') +
      '<div class="bm-acts">' + [o.ghost, o.secondary, o.primary].filter(Boolean).join('') + '</div></div>';
    const box = NX.modal(html, { wide: o.wide !== false, onClose: o.onClose });
    if (box) {
      box.classList.add('bm');
      if (o.drawer) box.classList.add('drawer');
      box.setAttribute('aria-labelledby', 'bmTitle');
      const x = box.querySelector('.bm-h .nx-x'); if (x) x.onclick = () => NX.closeModal();
    }
    return box;
  }
  // остальные окна банка: «×» в шапке (общий для всех окон панели)
  function bmodal(html, opts) {
    const box = NX.modal('<button type="button" class="nx-x bm-x" aria-label="Закрыть окно">×</button>' + html, opts);
    const x = box && box.querySelector('.bm-x'); if (x) x.onclick = () => NX.closeModal();
    return box;
  }
  const mBtn = (id, label, cls, opts) => { const p = opts || {}; return '<button type="button" class="btn' + (cls ? ' ' + cls : '') + '" id="' + id + '"' + (p.dis ? ' disabled' : '') + (p.title ? ' title="' + esc(p.title) + '"' : '') + (p.role ? ' role="' + p.role + '"' : '') + '>' + (p.icon ? NX.icon(p.icon) : '') + esc(label) + '</button>'; };
  const sec = (title, body) => '<section class="bm-s"><h4>' + esc(title) + '</h4>' + body + '</section>';
  function openTx(id) {
    let t = stream.find((x) => x.id === id);
    if (!t) { const a = alerts.find((x) => x.tx && x.tx.id === id); t = a ? a.tx : null; }
    if (!t) return;
    const box = stdModal({
      title: 'Перевод ' + NX.fmt(t.amount), type: t.live ? 'живое демо' : 'синтетика', riskHtml: riskW(t.score), statusHtml: decBadge(t.decision), drawer: true, wide: false,
      body: sec('Что произошло', '<dl class="kv"><dt>Время</dt><dd>' + NX.time(t.ts) + '</dd><dt>Клиент</dt><dd>' + esc(t.client) + '</dd><dt>Получатель</dt><dd class="mono small">' + esc(t.to) + '</dd><dt>Канал</dt><dd>' + esc(t.channel) + '</dd><dt>ID</dt><dd class="mono small">' + esc(t.id) + '</dd><dt>Гео / устройство</dt><dd>' + esc(t.city + ' · ' + t.device) + '</dd></dl>') +
        sec('Почему NEXUS так решил', t.facts.length ? '<ul class="bm-why">' + t.facts.slice(0, 3).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '<p class="small muted">Особых признаков нет.</p>') +
        NX.ui.details('<dl class="kv"><dt>Оценка риска</dt><dd>' + Math.round(t.score) + ' из 100</dd>' + (t.facts.length > 3 ? '<dt>Ещё признаки</dt><dd>' + esc(t.facts.slice(3).join(', ')) + '</dd>' : '') + '<dt>Источник</dt><dd>' + (t.live ? 'живая операция демо' : 'синтетический поток, выборка 1:1000') + '</dd></dl>'),
      primary: mBtn('txInc', 'Создать инцидент', 'primary'),
      ghost: '<button type="button" class="btn ghost" data-close>Закрыть</button>',
    });
    const cl = box && box.querySelector('.bm-acts [data-close]'); if (cl) cl.onclick = () => NX.closeModal();
    const b = $('#txInc', box);
    if (b) b.onclick = () => {
      const inc = { id: NX.uid('inc'), ts: Date.now(), client: t.client, type: THREATS[t.threat] || 'Социальная инженерия', title: 'Операция ' + t.id + ' · ' + NX.fmt(t.amount) + ' → ' + t.to, score: t.score, amount: t.amount, account: t.to, source: t.live ? 'Живая операция демо' : 'NEXUS Core · синтетический поток', status: 'new', factors: t.facts.slice(), chain: [{ t: 'Операция ' + t.id + ' · ' + t.channel, ts: t.ts }], notes: [{ ts: Date.now(), t: 'Инцидент создан вручную', by: signer() }], synthetic: !t.live };
      B.incidents.unshift(inc);
      audit('incident_create', 'inc:' + inc.id, inc.title, 'из операции ' + t.id, { dup: true });
      NX.closeModal(); NX.toast('Инцидент создан', inc.title, 'ok', 'folder'); render();
    };
  }

  /* ================= АКТИВНАЯ ЗАЩИТА · РАЗВЕДКА УГРОЗ (IOC) ================= */
  function roleSwitchHTML() {
    const r = roleOf();
    return '<div class="tabs nx-role" style="display:inline-flex" role="group" aria-label="Роль сотрудника">' + Object.keys(ROLES).map((k) => '<button type="button" class="tab' + (k === r ? ' active' : '') + '" data-role="' + k + '" aria-pressed="' + (k === r ? 'true' : 'false') + '">' + (k === 'analyst' ? 'Аналитик' : 'Старший') + '</button>').join('') + '</div><div class="tiny muted mt-s">' + esc(signer(r)) + '</div>';
  }
  function iocChip(r, st) {
    const m = B.iocMeta[iocKey(r)] || {};
    return '<button type="button" class="ioc-chip" data-ioc="' + esc(r.id) + '" style="display:inline-flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;padding:8px 10px;border-radius:12px;border:1px solid var(--line2);background:var(--bg2);color:var(--text);cursor:pointer;max-width:100%;font:inherit">' +
      '<span class="row" style="gap:6px;flex-wrap:wrap"><span class="tiny muted">' + esc(NX.IOC_KIND[r.kind] || r.kind) + '</span><b class="mono small" style="word-break:break-all">' + esc(dispIoc(r)) + '</b>' + stChip(st) + '</span>' +
      '<span class="tiny muted">' + (m.lat != null ? 'доставлен за ' + m.lat + ' мс · ' : '') + esc(srcText(r)) + ' · ' + esc(NX.ago(r.firstSeen || r.ts)) + '</span></button>';
  }
  function pendingRow(p) {
    const mine = p.role === roleOf();
    const what = p.kind === 'ioc_confirm' ? 'Подтвердить реквизит: ' : p.kind === 'ioc_revoke' ? 'Снять реквизит (ложное срабатывание): ' : 'Приостановить операции сети: ';
    return '<div class="li"><div class="grow"><div class="t">' + esc(what) + esc(p.label) + '</div><div class="s">подпись 1: ' + esc(p.by) + ' · ' + esc(NX.ago(p.ts)) + (p.kind === 'ioc_revoke' && p.why ? ' · основание: ' + esc(p.why) : '') + '</div></div>' +
      (mine ? '<span class="tiny muted">нужна подпись: ' + esc(ROLES[otherRole(p.role)].title.toLowerCase()) + '</span>' : '<button type="button" class="btn sm ok" data-approve="' + esc(p.id) + '">Подпись 2 из 2</button>') + '</div>';
  }
  function auditLine(a) {
    return '<div class="li"><span class="mono tiny muted">' + NX.time(a.ts) + '</span><div class="grow"><div class="small">' + esc(AUDIT_RU[a.action] || a.action) + (a.label ? ' · ' + esc(a.label) : '') + '</div><div class="tiny muted">' + esc(a.who + (a.role ? ' (' + String(a.role).toLowerCase() + ')' : '')) + (a.why ? ' · ' + esc(a.why) : '') + '</div></div></div>';
  }
  let immHtmlPrev = null, immChipsPrev = new Set();
  var immForce = false; // var: renderLive читает флаг и до этой строки // аналитик открыл стоп-лист ссылкой из тихого героя
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-imm-open]') : null;
    if (!t) return;
    e.preventDefault();
    immForce = true; renderImmunity(false);
    const d = document.querySelector('#immunity details.imm-more');
    if (d) { d.open = true; try { d.scrollIntoView({ block: 'nearest' }); } catch (er) { /* ignore */ } }
  });
  function renderImmunity(flash) {
    const box = $('#immunity'); if (!box) return;
    // без атаки карточка на «Сейчас» скрыта (строка-ссылка в герое), во время атаки — свёрнутая сводка
    box.classList.toggle('hidden', !(immForce || isAttackLive()));
    if (current === 'overview') { try { renderLive(); } catch (e) { /* ignore */ } }
    const list = sortIocs(iocList());
    if (!list.length && !B.seen.length && !B.pending.length) { box.innerHTML = ''; immHtmlPrev = null; immChipsPrev = new Set(); return; }
    const sts = list.map(effSt);
    const by = (s) => sts.filter((x) => x === s).length;
    const nAct = sts.filter(active).length;
    const last = B.lastIoc;
    const seen = B.seen.slice(0, 3).map((s) => '<span class="tag" style="white-space:normal">уже в стоп-листе · ' + esc(s.raw) + ' · ' + esc((s.sources && s.sources.length ? s.sources.join(' + ') : s.seenBy) || 'NEXUS') + (s.firstSeen ? ', получен ' + esc(NX.ago(s.firstSeen)) : '') + (s.seenBy ? ' · повторно: ' + esc(s.seenBy) : '') + '</span>').join('');
    const pend = B.pending.map(pendingRow).join('');
    const aud = B.audit.slice(-3).reverse().map(auditLine).join('');
    // анимация появления — только у карточки, впервые появившейся в блоке, и у новых реквизитов;
    // подсветка нового IOC — отдельным классом (box-shadow), фон-градиент карточки не трогается
    const chipKeys = new Set(list.slice(0, 10).map(iocKey));
    const isNewChip = (r) => !immChipsPrev.has(iocKey(r));
    const chips2 = list.slice(0, 10).map((r, i) => {
      const h = iocChip(r, sts[i]);
      return isNewChip(r) ? h.replace('class="ioc-chip"', 'class="ioc-chip ioc-new"') : h;
    }).join('');
    const hadCard = !!box.querySelector('.immune');
    // на «Сейчас» (без прокрутки на 1366×768) — одна строка-сводка; вся карточка — по раскрытию
    const prevDet = box.querySelector('details.imm-more');
    const wasOpen = !!(prevDet && prevDet.open);
    const sumLine = 'стоп-лист: ' + cnt(nAct, F.ioc) + (by('suspected') ? ' · на проверке: ' + by('suspected') : '') + (B.pending.length ? ' · ждут второй подписи: ' + B.pending.length : '');
    const html = '<details class="more imm-more mb"><summary>' + NX.icon('dna', '', 16) + ' Активная защита · ' + esc(sumLine) + '</summary><div class="more-b">' +
      '<div class="immune' + (hadCard ? '' : ' immune-in') + '">' +
      '<div class="row between wrap gap-l" style="align-items:flex-start">' +
        '<div class="grow" style="min-width:260px">' +
          '<div class="row wrap gap-s">' + NX.icon('dna', '', 20) + '<b>Активная защита · разведка угроз</b><span class="badge ok">стоп-лист: ' + esc(cnt(nAct, F.ioc)) + '</span>' +
            (by('suspected') ? '<span class="badge warn">на проверке: ' + by('suspected') + '</span>' : '') + (by('corroborated') ? '<span class="badge high">корреляция: ' + by('corroborated') + '</span>' : '') + (by('confirmed') ? '<span class="badge high">аналитиком: ' + by('confirmed') + '</span>' : '') + (by('revoked') ? '<span class="badge info">снято: ' + by('revoked') + '</span>' : '') + '</div>' +
          '<p class="small muted mt-s">Реквизиты, которые мошенники назвали в звонке-ловушке или во время звонка клиенту. Подозрение ≠ блокировка: один источник — только предупреждение и усиленная проверка перевода; удержание — после корреляции (граф связей, база дропов или 2+ независимых источника); окончательное решение — аналитик в четыре глаза. У каждой записи есть срок проверки и путь обжалования.</p>' +
          '<p class="tiny muted mt-s">Корреляция по графу в демо: для нового счёта или номера ' + esc(SYNTH_NOTE) + ', поэтому связь с дроп-сетью находится почти всегда.</p>' +
          (chips2 ? '<div class="row wrap gap-s mt-s">' + chips2 + '</div>' : '') +
          (seen ? '<div class="row wrap gap-s mt-s">' + seen + '</div>' : '') +
          (pend ? '<div class="mt"><div class="small muted">Ожидают второй подписи</div><div class="list">' + pend + '</div></div>' : '') +
        '</div>' +
        '<div class="col" style="min-width:210px;gap:12px">' +
          '<div><div class="small muted">Удержано переводов на эти реквизиты</div><div class="big danger-text">' + NX.num(B.stats.iocHeld) + '</div><div class="tiny muted">предотвращено ' + NX.fmt(B.stats.iocPrevented) + (B.stats.falseHeld ? ' · снято как ложные: ' + NX.num(B.stats.falseHeld) + ' (' + NX.fmt(B.stats.falseHeldSum) + ')' : '') + '</div></div>' +
          '<div><div class="small muted">Доставка реквизита в банк</div><div class="big">' + (last && last.lat != null ? last.lat + ' мс' : '—') + '</div><div class="tiny muted">' + TRANSPORT + ' · в проде Kafka, SLA &lt; 1 с</div></div>' +
          '<div><div class="small muted mb" style="margin-bottom:6px">Роль</div>' + roleSwitchHTML() + '</div>' +
        '</div>' +
      '</div>' +
      (aud ? '<div class="divider"></div><div class="row between wrap"><span class="small muted">Журнал аудита · записи только добавляются</span><button type="button" class="btn sm ghost" data-audit="1">Весь журнал</button></div><div class="list">' + aud + '</div>' : '') +
      '</div></div></details>';
    // сравниваем разметку без одноразовых классов анимации: та же картинка — не переписываем DOM
    const cmp = html.replace(' immune-in', '').split('class="ioc-chip ioc-new"').join('class="ioc-chip"');
    if (!(hadCard && cmp === immHtmlPrev)) {
      box.innerHTML = wasOpen ? html.replace('<details class="more imm-more mb">', '<details class="more imm-more mb" open>') : html;
      immHtmlPrev = cmp;
    }
    immChipsPrev = chipKeys;
    if (flash) {
      const card = box.querySelector('.immune');
      if (card) { card.classList.remove('immune-flash'); void card.offsetWidth; card.classList.add('immune-flash'); }
    }
  }
  function openAudit() {
    const rows = B.audit.slice().reverse().map(auditLine).join('') || '<div class="empty">Записей пока нет</div>';
    bmodal('<div class="row between wrap"><h3>Журнал аудита</h3><span class="badge plain">' + esc(cnt(B.audit.length, F.entry)) + '</span></div><p class="small muted">Кто, когда и почему изменил статус реквизита, инцидента или счёта. Записи только добавляются.</p><div class="list mt" style="max-height:60vh;overflow:auto">' + rows + '</div><div class="row mt" style="justify-content:flex-end"><button type="button" class="btn" data-close>Закрыть</button></div>', { wide: true });
  }

  // новый реквизит от приманки / Защиты звонка
  const corrTimers = {};
  function handleIocs(p, msg) {
    const items = (p && p.items) || [];
    if (!items.length) return;
    const t0 = Number(p.t0) || (msg && msg.ts) || Date.now();
    const lat = Math.max(0, Date.now() - t0);
    items.forEach((it) => {
      if (!it || !it.kind) return;
      remember(it);
      B.iocMeta[iocKey(it)] = { lat, at: Date.now(), via: TRANSPORT, client: String(p.client || ''), source: String(p.source || it.source || '') };
      const st = effSt(it);
      // ручное удержание аналитиком — не разведданные: синтетическую историю ему не строим
      const res = NX.Graph ? NX.Graph.addIoc(it, { status: st, history: !noSynth(it) }) : null;
      if (res && res.node && res.corroborated && active(st)) scheduleCorroboration(it, res);
    });
    B.lastIoc = { key: iocKey(items[0]), lat, at: Date.now() };
    saveB();
    if (NX.Graph && NX.Graph.detected) renderRings(NX.Graph.detect());
    renderImmunity(true);
    if (current === 'graph' && NX.Graph && NX.Graph.selected) nodePanel(NX.Graph.selected);
    const first = items[0];
    NX.toast('Реквизит в стоп-листе за ' + lat + ' мс', cnt(items.length, F.ioc) + ' · ' + (p.source || 'NEXUS') + ' · статус: ' + stLabel(effSt(first)), 'warn', 'dna');
    logCycle('investigate', 'Стоп-лист: ' + cnt(items.length, F.ioc) + ' от «' + (p.source || 'NEXUS') + '» · ' + stLabel(effSt(first)));
    if (current === 'graph') renderChainPanel();
    NX.bus.emit('ioc_received', { items: items.map(brief), latencyMs: lat, transport: TRANSPORT, source: p.source || '', client: p.client || '', t0 });
  }
  function handleSeen(p) {
    const items = (p && p.items) || [];
    if (!items.length) return;
    items.forEach((it) => {
      remember(it);
      B.seen.unshift({ ts: Date.now(), kind: it.kind, value: it.value, raw: String(it.matched || it.raw || it.value || ''), seenBy: String(it.seenBy || p.source || ''), sources: srcList(it).slice(), firstSeen: it.firstSeen || it.ts || null, status: effSt(it) });
      if (NX.Graph) NX.Graph.setIocStatus(it.kind, it.value, effSt(it));
    });
    B.seen = B.seen.slice(0, 20);
    saveB();
    renderImmunity(false);
    const it = items[0];
    NX.toast('Реквизит уже в стоп-листе', dispIoc(it) + ' · ' + srcText(it) + (it.firstSeen ? ', получен ' + NX.ago(it.firstSeen) : ''), 'info', 'dna');
  }
  function handleIocUpdate(p, local) {
    const it = p && p.item;
    if (!it || !it.kind) return;
    remember(it);
    const st = effSt(it);
    if (NX.Graph) {
      NX.Graph.setIocStatus(it.kind, it.value, st);
      if (!local && NX.Graph.detected) renderRings(NX.Graph.detect());
    }
    renderImmunity(false);
    if (current === 'graph' && NX.Graph && NX.Graph.selected) nodePanel(NX.Graph.selected);
    if (!local && p.from !== st) NX.toast('Реквизит в стоп-листе: ' + stLabel(st), dispIoc(it) + ' · ' + srcText(it), strong(st) ? 'high' : 'info', 'dna');
  }
  function scheduleCorroboration(it, res, delay) {
    const k = iocKey(it);
    if (corrTimers[k]) return;
    corrTimers[k] = setTimeout(() => { delete corrTimers[k]; corroborateFromGraph(it, res, 0); }, delay == null ? 1400 : delay);
  }
  // Корреляция по графу: если узел реквизита связан с известной дроп-сетью — +сигнал 'graph' (α += 2)
  function corroborateFromGraph(it, res, attempt) {
    if (dead || !it || !NX.Graph) return null;
    const k = iocKey(it);
    if (corrTimers[k]) { clearTimeout(corrTimers[k]); delete corrTimers[k]; }
    let rec = null;
    try { rec = NX.iocs.find(it.kind, it.value); } catch (e) { rec = null; }
    if (!rec) {
      // запись ещё не синхронизировалась из другой вкладки — повторить
      if ((attempt || 0) < 3) setTimeout(() => corroborateFromGraph(it, res, (attempt || 0) + 1), 800);
      return null;
    }
    const before = effSt(rec);
    if (!active(before)) return rec;
    const r2 = res && res.node && NX.Graph.nodes.indexOf(res.node) >= 0 ? res : NX.Graph.addIoc(rec, { status: before, history: !noSynth(rec) });
    if (!r2 || !r2.node || !NX.Graph.inNetwork(r2.node)) return rec;
    if ((rec.signals || []).indexOf('graph') >= 0) { NX.Graph.setIocStatus(rec.kind, rec.value, before); return rec; }
    const path = NX.Graph.explainPath(r2.node, NX.Graph.hub);
    const synth = NX.Graph.isSynthetic ? NX.Graph.isSynthetic(r2.node) : !!r2.node.synthHistory;
    const why = 'Связь с известной дроп-сетью в графе' + (path ? ': ' + path.text : '') + (synth ? ' (' + SYNTH_NOTE + ')' : '');
    const upd = NX.iocs.corroborate(rec.value, { signal: 'graph', by: 'Граф связей (корреляция)', why, synthetic: synth }, rec.kind);
    const cur = upd || rec;
    remember(cur);
    const after = effSt(cur);
    NX.Graph.setIocStatus(rec.kind, rec.value, after);
    audit('ioc_corroborate', iocKey(rec), dispIoc(rec), why, { who: 'NEXUS · граф связей', role: 'система', dup: true });
    if (after !== before) NX.toast('Реквизит в стоп-листе: ' + stLabel(after), dispIoc(rec) + ' · связь с дроп-сетью в графе' + (synth ? ' (демо: история счёта сгенерирована)' : ''), 'high', 'graph');
    if (NX.Graph.detected) renderRings(NX.Graph.detect());
    renderImmunity(false);
    if (current === 'graph' && NX.Graph.selected) nodePanel(NX.Graph.selected);
    return cur;
  }
  function scheduleReplayCorrelation() {
    if (!NX.Graph) return;
    let i = 0;
    iocList().forEach((r) => {
      const st = effSt(r);
      if (st !== 'suspected' || (r.signals || []).indexOf('graph') >= 0) return;
      const n = NX.Graph.findIoc(r.kind, r.value);
      if (n && NX.Graph.inNetwork(n)) scheduleCorroboration(r, { node: n }, 1500 + 300 * i++);
    });
  }

  // решения аналитика
  function confirmIocStep(r, why) {
    const key = iocKey(r), role = roleOf();
    const st = effSt(r);
    if (st === 'confirmed') { NX.toast('Уже подтверждён', dispIoc(r) + ' · ' + stLabel(st), 'info', 'check'); return 'done'; }
    if (!active(st)) { NX.toast('Реквизит не действует', stLabel(st) + ' — подтверждение недоступно', 'warn', 'info'); return 'inactive'; }
    const p = B.pending.find((x) => x.kind === 'ioc_confirm' && x.ref === key);
    if (!p) {
      B.pending.push({ id: NX.uid('ap'), kind: 'ioc_confirm', ref: key, label: dispIoc(r), role, by: signer(role), ts: Date.now(), why: why || '' });
      audit('ioc_confirm_request', key, dispIoc(r), why || '');
      NX.toast('Подпись 1 из 2', 'Подтверждение реквизита ждёт второй подписи: ' + ROLES[otherRole(role)].title.toLowerCase(), 'info', 'users');
      renderImmunity(false);
      return 'requested';
    }
    if (p.role === role) { NX.toast('Нужна вторая подпись', 'Подтвердить должен другой сотрудник — переключите роль на «' + ROLES[otherRole(role)].title + '»', 'warn', 'users'); return 'same'; }
    const by = p.by + ' + ' + signer(role);
    const res = NX.iocs.confirm(r.value, by, why || p.why || 'Подтверждено в четыре глаза', r.kind, { allowRevoked: true });
    if (!res) { NX.toast('Не удалось подтвердить', 'Запись реквизита ещё синхронизируется — повторите через секунду', 'warn', 'info'); return 'fail'; }
    remember(res);
    B.pending = B.pending.filter((x) => x !== p);
    audit('ioc_confirm', key, dispIoc(r), by, { dup: true });
    if (NX.Graph) { NX.Graph.setIocStatus(r.kind, r.value, 'confirmed'); if (NX.Graph.detected) renderRings(NX.Graph.detect()); }
    NX.toast('Реквизит подтверждён аналитиком', dispIoc(r) + ' · две подписи', 'ok', 'shieldCheck');
    renderImmunity(false);
    return 'confirmed';
  }
  // Снятие реквизита. Запись, подтверждённую аналитиком в четыре глаза, снимают тоже две подписи
  // (pending 'ioc_revoke'); на проверке / корреляция — решение одного аналитика.
  function revokeIoc(r, why) {
    const key = iocKey(r), role = roleOf();
    const st = effSt(r);
    const pr = B.pending.find((x) => x.kind === 'ioc_revoke' && x.ref === key);
    const reason = why || (pr && pr.why) || '';
    if (!reason) { NX.toast('Укажите основание', 'Для снятия реквизита нужна причина — она попадёт в журнал', 'warn', 'info'); return false; }
    let by = signer(role);
    if (st === 'confirmed') {
      if (!pr) {
        B.pending.push({ id: NX.uid('ap'), kind: 'ioc_revoke', ref: key, label: dispIoc(r), role, by: signer(role), ts: Date.now(), why: reason });
        audit('ioc_revoke_request', key, dispIoc(r), reason);
        NX.toast('Подпись 1 из 2', 'Снятие подтверждённого реквизита ждёт второй подписи: ' + ROLES[otherRole(role)].title.toLowerCase(), 'info', 'users');
        renderImmunity(false);
        return 'requested';
      }
      if (pr.role === role) { NX.toast('Нужна вторая подпись', 'Снять подтверждённый реквизит должен другой сотрудник — переключите роль на «' + ROLES[otherRole(role)].title + '»', 'warn', 'users'); return 'same'; }
      by = pr.by + ' + ' + signer(role);
    }
    const res = NX.iocs.revoke(r.value, by, reason, r.kind);
    if (!res) { NX.toast('Не удалось снять', 'Запись реквизита не найдена — повторите через секунду', 'warn', 'info'); return false; }
    remember(res);
    B.pending = B.pending.filter((p) => !((p.kind === 'ioc_confirm' || p.kind === 'ioc_revoke') && p.ref === key));
    audit('ioc_revoke', key, dispIoc(r), reason + (st === 'confirmed' ? ' · ' + by : ''), { dup: true });
    const rel = releaseHolds(res, reason);
    if (NX.Graph) { NX.Graph.setIocStatus(r.kind, r.value, 'revoked'); if (NX.Graph.detected) renderRings(NX.Graph.detect()); }
    NX.toast('Реквизит снят', dispIoc(r) + ' · ложное срабатывание, ограничения не применяются' + (rel.n ? ' · снято удержаний: ' + rel.n + ' (' + NX.fmt(rel.sum) + ')' : ''), 'info', 'check');
    renderImmunity(false);
    render();
    if (liveState.hold) renderLive();
    return true;
  }
  // Реквизит признан ложным срабатыванием: его удержания больше не «предотвращённое мошенничество».
  function releaseHolds(r, why) {
    const out = { n: 0, sum: 0 };
    if (!r || !r.kind) return out;
    const key = iocKey(r), now = Date.now();
    const incIds = [];
    B.holds.forEach((h) => {
      if (h.released || h.kind !== r.kind || h.value !== r.value) return;
      h.released = true; h.releasedAt = now; h.releaseWhy = String(why || '');
      out.n++; out.sum += Number(h.amount) || 0;
      if (h.incidentId) incIds.push(h.incidentId);
    });
    if (out.n) {
      B.stats.iocHeld = Math.max(0, B.stats.iocHeld - out.n);
      B.stats.iocPrevented = Math.max(0, B.stats.iocPrevented - out.sum);
      B.stats.falseHeld += out.n;
      B.stats.falseHeldSum += out.sum;
      audit('hold_release', key, dispIoc(r), cnt(out.n, F.tr) + ' · ' + NX.fmt(out.sum) + (why ? ' · ' + why : ''), { dup: true });
    }
    incIds.forEach((id) => {
      const inc = B.incidents.find((i) => i.id === id);
      if (inc && inc.status !== 'false_positive') setStatus(inc, 'false_positive', 'Реквизит получателя снят как ложное срабатывание — удержание перевода снято');
    });
    // ручное удержание счёта по этому реквизиту тоже снимается
    B.held = B.held.filter((acc) => {
      if (accKey(acc) !== key) return true;
      const nd = NX.Graph ? NX.Graph.byAccount(acc) : null;
      if (nd) { nd.manualHold = false; if (!nd.iocValue) nd.blocked = false; }
      return false;
    });
    if (NX.Graph) { const nd = NX.Graph.findIoc(r.kind, r.value); if (nd) nd.manualHold = false; }
    if (liveState.hold && liveState.hold.iocId === r.id) liveState.hold.released = true;
    saveB();
    return out;
  }
  function approve(id) {
    const p = B.pending.find((x) => x.id === id);
    if (!p) return;
    if (p.kind === 'ioc_confirm') {
      const r = findIocByKey(p.ref);
      if (r) confirmIocStep(r, p.why);
      else { B.pending = B.pending.filter((x) => x !== p); saveB(); NX.toast('Запрос снят', 'Реквизит больше не найден в стоп-листе', 'info', 'info'); }
    } else if (p.kind === 'ioc_revoke') {
      const r = findIocByKey(p.ref);
      if (r) revokeIoc(r, p.why);
      else { B.pending = B.pending.filter((x) => x !== p); saveB(); NX.toast('Запрос снят', 'Реквизит больше не найден в стоп-листе', 'info', 'info'); }
    } else if (p.kind === 'ring_hold') {
      if (NX.Graph && !NX.Graph.detected) renderRings(NX.Graph.detect());
      ringHoldStep(p.ref.slice(5));
    }
    renderImmunity(false);
    if (modalRefresh && NX.isModalOpen()) modalRefresh();
  }

  let modalRefresh = null;
  const IOC_ACTION_RU = { suspected: 'Получен, на проверке', corroborate: 'Корреляция', corroborated: 'Статус: подтверждён корреляцией', confirmed: 'Подтверждён аналитиком', revoked: 'Снят: ложное срабатывание', expired: 'Срок проверки истёк', hold: 'Удержание счёта аналитиком (одна подпись)' };
  const POLICY = {
    suspected: 'Один источник: переводы на реквизит проходят усиленную проверку (подтверждение, пауза, звонок клиенту), без удержания. Удержание — после корреляции или решения аналитика.',
    corroborated: 'Подтверждён корреляцией: переводы на реквизит удерживаются для проверки (hold до 72 ч). Окончательное решение — аналитик в четыре глаза.',
    confirmed: 'Подтверждён аналитиком (две подписи): переводы удерживаются, реквизит можно передать в Антифрод-центр НБРК.',
    revoked: 'Снят как ложное срабатывание: ограничения не применяются. Владелец счёта может обжаловать решение через отделение или колл-центр.',
    expired: 'Срок проверки истёк: реквизит не влияет на решения, пока его снова не назовёт мошенник.',
  };
  function openIoc(ref) {
    const r = findIoc(ref) || findIocByKey(ref);
    if (!r) { NX.toast('Реквизит не найден', 'Возможно, стоп-лист был сброшен', 'info', 'info'); return; }
    const st = effSt(r), key = iocKey(r), role = roleOf();
    const m = B.iocMeta[key] || {};
    const node = NX.Graph ? NX.Graph.findIoc(r.kind, r.value) : null;
    const path = node && NX.Graph.hub ? NX.Graph.explainPath(node, NX.Graph.hub) : null;
    const allHolds = B.holds.filter((h) => h.kind === r.kind && h.value === r.value);
    const holds = allHolds.filter((h) => !h.released);
    const released = allHolds.length - holds.length;
    const heldSum = holds.reduce((a, h) => a + (h.amount || 0), 0);
    const pend = B.pending.find((x) => x.kind === 'ioc_confirm' && x.ref === key);
    const pendRev = B.pending.find((x) => x.kind === 'ioc_revoke' && x.ref === key);
    const synth = !!(node && NX.Graph.isSynthetic && NX.Graph.isSynthetic(node));
    let revokeBtn = '';
    if (st !== 'revoked') {
      if (st !== 'confirmed') revokeBtn = '<button type="button" class="btn" id="iocRevoke">' + NX.icon('x') + 'Снять (ложное срабатывание)</button>';
      else if (!pendRev) revokeBtn = '<button type="button" class="btn" id="iocRevoke">' + NX.icon('x') + 'Снять · подпись 1 из 2</button>';
      else if (pendRev.role === role) revokeBtn = '<button type="button" class="btn" disabled>Снятие ждёт второй подписи: ' + esc(ROLES[otherRole(role)].title.toLowerCase()) + '</button>';
      else revokeBtn = '<button type="button" class="btn" id="iocRevoke">' + NX.icon('x') + 'Утвердить снятие · подпись 2 из 2</button>';
    }
    const hist = (r.history || []).map((h) => ({ ts: h.ts, t: (IOC_ACTION_RU[h.action] || h.action) + (h.why ? ': ' + h.why : ''), by: h.by }));
    B.audit.filter((a) => a.ref === key && !a.dup).forEach((a) => hist.push({ ts: a.ts, t: (AUDIT_RU[a.action] || a.action) + (a.why ? ': ' + a.why : ''), by: a.who + (a.role ? ' (' + String(a.role).toLowerCase() + ')' : '') }));
    hist.sort((a, b) => a.ts - b.ts);
    const quote = quoteOf(r);
    let confirmBtn;
    if (st === 'confirmed') confirmBtn = '<button type="button" class="btn ok" disabled>Подтверждён (две подписи)</button>';
    else if (!active(st)) confirmBtn = '';
    else if (!pend) confirmBtn = '<button type="button" class="btn danger" id="iocConfirm">' + NX.icon('users') + 'Подтвердить · подпись 1 из 2</button>';
    else if (pend.role === role) confirmBtn = '<button type="button" class="btn" disabled>Ждёт второй подписи: ' + esc(ROLES[otherRole(role)].title.toLowerCase()) + '</button>';
    else confirmBtn = '<button type="button" class="btn danger" id="iocConfirm">' + NX.icon('shieldCheck') + 'Утвердить · подпись 2 из 2</button>';
    const conf = typeof r.conf === 'number' ? r.conf : (r.alpha || 1) / ((r.alpha || 1) + (r.beta || 3));
    // стандартное окно: подтвердить (primary) · показать в графе (secondary) · снять (ghost); АФЦ — в «Ещё ▾»
    const ghostRevoke = revokeBtn.replace('class="btn"', 'class="btn ghost"');
    const primConfirm = confirmBtn.replace('class="btn danger"', 'class="btn primary"');
    const box = stdModal({
      title: 'Реквизит в стоп-листе', type: NX.IOC_KIND[r.kind] || r.kind, statusHtml: stChip(st),
      body: '<div class="mono" style="font-size:16px;word-break:break-all">' + esc(dispIoc(r)) + '</div>' +
        sec('Что произошло', '<dl class="kv">' +
          '<dt>Источники</dt><dd>' + esc(srcText(r)) + '</dd>' +
          '<dt>Получен</dt><dd>' + esc(NX.dateTime(r.firstSeen || r.ts)) + ' · ' + esc(NX.ago(r.firstSeen || r.ts)) + '</dd>' +
          '<dt>Удержано переводов</dt><dd>' + holds.length + (heldSum ? ' · ' + NX.fmt(heldSum) : '') + (released ? ' · снято как ложные: ' + released : '') + '</dd>' +
          '<dt>Проверка до</dt><dd>' + (r.expiresAt ? esc(NX.dateTime(r.expiresAt)) : '—') + '</dd></dl>' +
          (quote ? '<div class="small mt-s">«' + esc(quote) + '» <span class="tiny muted">— фраза мошенника</span></div>' : '')) +
        sec('Что это значит', '<div class="notice' + (st === 'suspected' ? ' warn' : '') + '">' + esc(r.kind === 'merchant' && NX.LeakRadar && NX.LeakRadar.iocPolicy ? NX.LeakRadar.iocPolicy(st, r.value) : POLICY[st] || '') + '</div>' +
          (!strong(st) && NX.iocHeld && NX.iocHeld(r) ? '<div class="notice warn mt-s">Счёт удержан аналитиком (hold до ' + esc(NX.dateTime(r.hold.until)) + ', ' + esc(r.hold.by || 'аналитик') + '): переводы клиентов на реквизит удерживаются. Это решение одного аналитика — статус «подтверждён аналитиком» требует второй подписи.</div>' : '') +
          (path ? '<div class="small mt-s"><span class="muted">Путь в графе:</span> ' + esc(path.text) + '</div>' : r.kind === 'domain' ? '<div class="small muted mt-s">Сайт не участвует в денежных потоках — корреляция по графу невозможна, нужен второй независимый источник.</div>' : '') +
          (pendRev ? '<div class="notice mt-s">Снятие запрошено: ' + esc(pendRev.by) + ' · основание: ' + esc(pendRev.why || '—') + '. Вторую подпись ставит другой сотрудник.</div>' : '') +
          (pend ? '<div class="notice mt-s">Подпись 1: ' + esc(pend.by) + ' · ' + esc(NX.ago(pend.ts)) + '. Вторую подпись ставит другой сотрудник.</div>' : '')) +
        sec('Журнал', '<div class="list small" style="max-height:200px;overflow:auto">' + (hist.map((h) => '<div class="li"><span class="mono tiny muted">' + NX.time(h.ts) + '</span><div class="grow"><div>' + esc(h.t) + '</div><div class="tiny muted">' + esc(h.by || '') + '</div></div></div>').join('') || '<span class="muted">Пока пусто</span>') + '</div>' +
          '<div class="row wrap between mt-s" style="align-items:flex-end"><div>' + roleSwitchHTML() + '</div><div class="field grow" style="min-width:min(220px,100%);margin:0"><input class="input" id="iocWhy" placeholder="Основание решения (для снятия — обязательно)…" aria-label="Основание решения"></div></div>') +
        NX.ui.details('<dl class="kv"><dt>Доставка в банк</dt><dd>' + (m.lat != null ? m.lat + ' мс · ' + esc(m.via || TRANSPORT) : '—') + '</dd>' +
          '<dt>Доверие</dt><dd>' + String(Math.round(conf * 100) / 100).replace('.', ',') + ' · Beta(α=' + (r.alpha || 1) + ', β=' + (r.beta || 3) + ')</dd></dl>' +
          (synth ? '<p class="tiny muted mt-s">Корреляция по графу: ' + esc(SYNTH_NOTE) + '.</p>' : '')),
      primary: primConfirm, secondary: node ? '<button type="button" class="btn" id="iocGraph">' + NX.icon('graph') + 'Показать в графе</button>' : '', ghost: ghostRevoke,
      more: ['<button type="button" class="btn ghost sm bm-mi" id="iocAfc">' + NX.icon('send') + 'Реквизит в АФЦ (симуляция)</button>'],
      onClose: () => { modalRefresh = null; },
    });
    modalRefresh = () => openIoc(r.id);
    const why = () => { const el = $('#iocWhy', box); return el ? el.value.trim() : ''; };
    const bg = $('#iocGraph', box); if (bg) bg.onclick = () => { NX.closeModal(); focusGraphOnIoc(r); };
    const ba = $('#iocAfc', box); if (ba) ba.onclick = () => openAfc(r, null);
    const br = $('#iocRevoke', box); if (br) br.onclick = () => { if (revokeIoc(r, why())) openIoc(r.id); };
    const bc = $('#iocConfirm', box); if (bc) bc.onclick = () => { confirmIocStep(r, why()); openIoc(r.id); };
  }

  /* ---------- передача в АФЦ НБРК и STR (симуляция) ---------- */
  function afcPackage(r, inc) {
    const iso = (t) => (t ? new Date(t).toISOString() : null);
    const st = r ? effSt(r) : null;
    const node = r && NX.Graph ? NX.Graph.findIoc(r.kind, r.value) : null;
    const path = node ? NX.Graph.explainPath(node, NX.Graph.hub) : null;
    const ppr = node ? NX.Graph.ppr(node, { top: 5 }) : [];
    const holds = r ? B.holds.filter((h) => h.kind === r.kind && h.value === r.value && !h.released) : [];
    const parsed = !r && inc ? safeParse(inc.account) : null;
    const synth = !!(node && NX.Graph.isSynthetic && NX.Graph.isSynthetic(node));
    return {
      format: 'nexus.ioc-share · демо-формат (симуляция)',
      created_at: new Date().toISOString(),
      sender: 'Fraud Fusion Center банка-участника (концепт команды)',
      recipient: 'Антифрод-центр НБРК — симуляция, ничего не отправляется',
      prepared_by: signer(),
      ioc: r
        ? { type: r.kind, value: dispIoc(r), normalized: r.value, status: st, status_label: stLabel(st), confidence: r.conf, sources: srcList(r), first_seen: iso(r.firstSeen || r.ts), last_seen: iso(r.lastSeen), review_until: iso(r.expiresAt) }
        : { type: parsed ? parsed.kind : 'unknown', value: inc ? dispAcc(inc.account) : '', normalized: parsed ? parsed.value : null, status: 'not_in_stoplist', status_label: 'нет в стоп-листе NEXUS' },
      evidence: {
        incident: inc ? { id: inc.id, type: inc.type, amount_kzt: inc.amount || 0, risk_index_0_100: Number(inc.score) || 0, created_at: iso(inc.ts), source: inc.source } : null,
        graph_path: path ? path.text : null,
        graph_history: synth ? 'synthetic_demo — ' + SYNTH_NOTE : node ? 'graph' : null,
        related_accounts_ppr: ppr.map((x) => ({ label: x.node.label, account: NX.Graph.disp(x.node), relative_score: x.rel })),
        held_transfers: holds.length,
        held_amount_kzt: holds.reduce((a, h) => a + (h.amount || 0), 0),
      },
      approvals: r ? (r.history || []).filter((h) => h.action === 'confirmed' || h.action === 'corroborated').map((h) => ({ at: iso(h.ts), by: h.by, why: h.why })) : [],
      note: 'Синтетические данные демо. В проде — обмен по регламенту АФЦ НБРК через комплаенс банка.',
    };
  }
  function copyText(s) {
    const done = () => NX.toast('Скопировано', 'Текст в буфере обмена', 'ok', 'check');
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = s; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) done(); else NX.toast('Не удалось скопировать', 'Выделите текст и скопируйте вручную', 'warn', 'info');
      } catch (e) { NX.toast('Не удалось скопировать', 'Выделите текст и скопируйте вручную', 'warn', 'info'); }
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s).then(done, fallback); return; } } catch (e) { /* ignore */ }
    fallback();
  }
  function openAfc(r, inc) {
    const pkg = afcPackage(r, inc);
    const json = JSON.stringify(pkg, null, 2);
    const ref = r ? iocKey(r) : inc ? 'inc:' + inc.id : '';
    audit('afc_package', ref, r ? dispIoc(r) : inc ? inc.title : '', 'симуляция, не отправлен');
    if (inc) { inc.notes = inc.notes || []; inc.notes.push({ ts: Date.now(), t: 'Сформирован пакет для АФЦ НБРК (симуляция, не отправлен)', by: signer() }); saveB(); }
    const st = r ? effSt(r) : null;
    const box = bmodal('<h3>Передача в Антифрод-центр НБРК</h3><p class="small muted">Симуляция: пакет формируется, но никуда не отправляется. В проде — обмен через комплаенс банка по регламенту АФЦ.</p>' +
      (st === 'suspected' ? '<div class="notice warn mt-s">Реквизит на проверке (один источник). Передавать рекомендуем после корреляции или подтверждения аналитиком.</div>' : '') +
      (!r ? '<div class="notice warn mt-s">Реквизита нет в стоп-листе NEXUS — в пакете только данные инцидента.</div>' : '') +
      '<pre class="mono" id="afcJson" style="white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:48vh;overflow:auto;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:12px">' + esc(json) + '</pre>' +
      '<div class="row wrap mt" style="justify-content:flex-end">' + (r ? '<button type="button" class="btn" id="afcBack">← К карточке реквизита</button>' : inc ? '<button type="button" class="btn" id="afcBack">← К инциденту</button>' : '') + '<button type="button" class="btn" id="afcCopy">Скопировать JSON</button><button type="button" class="btn primary" data-close>Готово</button></div>', { wide: true });
    const bb = $('#afcBack', box); if (bb) bb.onclick = () => (r ? openIoc(r.id) : openIncident(inc.id));
    const bc = $('#afcCopy', box); if (bc) bc.onclick = () => copyText(json);
    NX.toast('Пакет для АФЦ НБРК сформирован', 'Симуляция: ничего не отправлено', 'info', 'send');
  }
  function openStr(i) {
    const hit = iocForAccount(i.account);
    const lines = [
      'ЧЕРНОВИК · сообщение о подозрительной операции · не отправлено',
      'Адресат: АФМ РК — через подразделение комплаенса банка (ПОД/ФТ)',
      'Подготовлен: ' + NX.dateTime(Date.now()) + ' · ' + signer(),
      '',
      '1. Операция',
      '   Дата и время: ' + NX.dateTime(i.ts),
      '   Сумма: ' + (i.amount ? NX.fmt(i.amount) : 'нет (попытка без суммы)'),
      '   Клиент-инициатор: ' + String(i.client || ''),
      '   Реквизит получателя: ' + dispAcc(i.account),
      '2. Основания подозрения',
      '   Схема: ' + String(i.type || ''),
      '   Источник сигнала: ' + String(i.source || ''),
      '   Индекс риска NEXUS: ' + (Number(i.score) || 0) + ' из 100',
    ].concat((i.factors || []).map((f) => '   — ' + factorText(f)))
      .concat(['3. Хронология'])
      .concat((i.chain || []).map((c) => '   ' + NX.time(c.ts) + ' — ' + String(c.t)))
      .concat([
        '4. Стоп-лист NEXUS: ' + (hit ? stLabel(effSt(hit)) + ' · источники: ' + srcText(hit) : 'реквизит не в стоп-листе'),
        '5. Меры банка: ' + (i.status === 'resolved' ? 'операции по счёту получателя приостановлены (hold), реквизит на проверке' : 'операция удержана для проверки; дальнейшие меры — по решению комплаенса'),
        '',
        'Данные синтетические (демо). Форма упрощена; итоговая — по требованиям АФМ.',
      ]);
    const text = lines.join('\n');
    i.notes = i.notes || [];
    i.notes.push({ ts: Date.now(), t: 'Сформирован черновик сообщения в АФМ (не отправлен)', by: signer() });
    audit('str_draft', 'inc:' + i.id, i.title, 'черновик, не отправлен');
    const box = bmodal('<h3>Черновик сообщения в АФМ</h3><p class="small muted">Сообщение о подозрительной операции для комплаенса. В прототипе ничего не отправляется; текст можно отредактировать и скопировать.</p>' +
      '<textarea class="input mono" id="strText" rows="16" style="width:100%;font-size:12px;margin-top:12px;resize:vertical">' + esc(text) + '</textarea>' +
      '<div class="row wrap mt" style="justify-content:flex-end"><button type="button" class="btn" id="strBack">← К инциденту</button><button type="button" class="btn" id="strCopy">Скопировать</button><button type="button" class="btn primary" data-close>Готово</button></div>', { wide: true });
    const bb = $('#strBack', box); if (bb) bb.onclick = () => openIncident(i.id);
    const bc = $('#strCopy', box); if (bc) bc.onclick = () => { const ta = $('#strText', box); copyText(ta ? ta.value : text); };
  }

  /* ================= GRAPH ================= */
  let lastPpr = [];
  function nodePanel(n) {
    const box = $('#nodePanel'); if (!box || !NX.Graph) return;
    const Gr = NX.Graph;
    if (!n) { lastPpr = []; Gr.setHighlight(null); box.innerHTML = '<div class="empty">Выберите узел на графе, чтобы увидеть детали счёта</div>'; return; }
    const nb = Gr.neighbors(n);
    const det = Gr.detected;
    const rec = n.iocValue ? findIoc({ kind: n.iocKind, value: n.iocValue }) : null;
    const st = rec ? effSt(rec) : n.iocStatus || null;
    const showPpr = !!n.iocValue || n.knownDrop || (det && n.flagged);
    let path = null;
    if (showPpr) {
      lastPpr = Gr.ppr(n, { top: 10 });
      path = Gr.hub && n !== Gr.hub ? Gr.explainPath(n, Gr.hub) : null;
      Gr.setHighlight({ seed: n, nodes: lastPpr.map((x) => x.node), path });
    } else { lastPpr = []; Gr.setHighlight(null); }
    const roleBadge = det ? roleB(n.role) : '';
    const canHold = !n.merchant && ((det && n.flagged) || !!n.iocValue || n.knownDrop);
    box.innerHTML = '<div class="row between wrap"><h3>' + esc(n.label) + '</h3><div class="row gap-s">' + (n.iocValue ? stChip(st) : '') + roleBadge + '</div></div><div class="mono small muted mt-s">' + esc(Gr.disp(n)) + '</div>' +
      '<dl class="kv mt"><dt>Входящие</dt><dd>' + NX.fmt(n.inSum) + ' (' + nb.in.length + ')</dd><dt>Исходящие</dt><dd>' + NX.fmt(n.outSum) + ' (' + nb.out.length + ')</dd><dt>Уникальных отправителей</dt><dd>' + new Set(nb.in.map((e) => e.s)).size + '</dd><dt>Доля транзита</dt><dd>' + (n.inSum ? Math.round((n.outSum / n.inSum) * 100) + '%' : '—') + '</dd>' + (det ? '<dt>Риск</dt><dd>' + (n.merchant ? '<span class="small muted">нет: магазин оценивается по числу независимых клиентов</span>' : riskW(n.risk || 0)) + '</dd>' : '') + '</dl>' +
      (n.synthHistory ? '<p class="tiny muted mt-s">Связь с сетью и корреляция по графу: ' + esc(SYNTH_NOTE) + ' (рёбра «синтет.» не входят в суммы сетей).</p>' : '') +
      (n.recipient ? '<p class="tiny muted mt-s">Получатель удержанного перевода: в графе нет его истории и связи с известными сетями.</p>' : '') +
      (showPpr && lastPpr.length ? '<div class="divider"></div><div class="small"><b>Связанные счета</b></div><div class="tiny muted mb" style="margin-bottom:6px" title="Связанность считается по денежным потокам между счетами">чем выше в списке, тем теснее связь · нажмите, чтобы увидеть путь</div><div class="list" style="max-height:220px;overflow:auto">' +
        lastPpr.map((x, k) => '<div class="li" data-ppr="' + k + '" style="cursor:pointer;padding:7px 0"><span class="tag">#' + (k + 1) + '</span><div class="grow"><div class="t">' + esc(x.node.label) + '</div><div class="s">' + esc(Gr.disp(x.node)) + (det ? ' · ' + esc(Gr.ROLE_RU[x.node.role] || '') : '') + '</div></div><span class="small mono">' + x.rel + '</span></div>').join('') + '</div>' +
        '<div class="small mt-s" id="pprPath">' + (path ? '<span class="muted">Путь к хабу сети:</span> ' + esc(path.text) : '') + '</div>' : '') +
      '<div class="divider"></div><div class="small muted mb" style="margin-bottom:6px">Связи</div><div class="list" style="max-height:180px;overflow:auto">' + nb.in.concat(nb.out).slice(0, 14).map((e) => { const other = e.s === n ? e.t : e.s; return '<div class="li"><span class="small">' + (e.s === n ? '→ ' : '← ') + esc(other.label) + (e.held ? ' <span class="badge med">удержан</span>' : '') + (e.synthetic ? ' <span class="tag">синтет.</span>' : '') + '</span><span class="grow"></span><span class="small mono">' + NX.fmt(e.amount) + '</span></div>'; }).join('') + '</div>' +
      '<div class="row wrap mt">' + (rec ? '<button type="button" class="btn sm" data-ioc="' + esc(rec.id) + '">' + NX.icon('dna') + 'Карточка реквизита</button>' : '') +
        (canHold ? (n.blocked ? '<button type="button" class="btn sm" disabled>Операции приостановлены (hold)</button>' : '<button type="button" class="btn sm danger" data-hold="' + esc(n.id) + '">' + NX.icon('lock') + 'Приостановить операции (hold 72 ч)</button>') : '') + '</div>';
  }
  // бейдж роли узла — классы на токенах (bank-extra.css .role-b.r-*), без инлайн-цветов
  const roleB = (role) => '<span class="badge plain role-b r-' + esc(String(role || 'unknown')) + '">' + esc((NX.Graph && NX.Graph.ROLE_RU[role]) || '') + '</span>';
  // легенда графа: 5 базовых ролей всегда; «реквизит в стоп-листе», «магазин», recruit и factory — только если такие узлы есть
  let legendKey = '';
  function syncLegend() {
    const lg = $('#graphLegend'); if (!lg || !NX.Graph) return;
    const N = NX.Graph.nodes || [];
    const has = { ioc: N.some((n) => n.iocValue && !n.merchant), merchant: N.some((n) => n.merchant), recruit: N.some((n) => n.role === 'recruit' || n.truth === 'recruit'), factory: N.some((n) => n.role === 'factory' || n.truth === 'factory') };
    const key = Object.keys(has).map((k) => (has[k] ? k : '')).join(',');
    if (key === legendKey) return;
    legendKey = key;
    $$('[data-lg]', lg).forEach((el) => { el.hidden = !has[el.dataset.lg]; });
  }
  function pickPpr(k) {
    const Gr = NX.Graph; if (!Gr) return;
    const seed = Gr.selected, x = lastPpr[k];
    if (!seed || !x) return;
    const path = Gr.explainPath(seed, x.node);
    Gr.setHighlight({ seed, nodes: lastPpr.map((y) => y.node), path });
    const el = $('#pprPath');
    if (el) el.innerHTML = path ? '<span class="muted">Путь:</span> ' + esc(path.text) : '<span class="muted">Путь не найден</span>';
    $$('#nodePanel [data-ppr]').forEach((b) => { b.style.background = Number(b.dataset.ppr) === k ? 'var(--accent-soft)' : ''; });
  }
  // Ручной hold действует и на переводы клиентов: счёт попадает в общий стоп-лист
  // (NX.iocs.add с источником «Аналитик · удержание счёта» + confirm), который читает NX.scoreTransfer.
  // Счета из базы дропов и реквизиты с корреляцией/подтверждением уже удерживаются — их не трогаем.
  function enforceHold(account, node, why) {
    let p = null;
    if (node && node.iocValue && node.iocKind) p = { kind: node.iocKind, value: node.iocValue, raw: String(node.account || node.iocValue) };
    else p = safeParse(account);
    if (!p || !p.value || ['iban', 'phone', 'card', 'crypto'].indexOf(p.kind) < 0) return null;
    try { if (NX.findMule(p.kind, p.value)) return null; } catch (e) { /* ignore */ }
    let rec = null;
    try { rec = NX.iocs.find(p.kind, p.value); } catch (e) { rec = null; }
    if (rec && (strong(effSt(rec)) || (NX.iocHeld && NX.iocHeld(rec)))) return rec;
    try {
      NX.iocs.add([{ kind: p.kind, value: p.value, raw: p.raw || String(account) }], HOLD_SRC, { session: 'analyst_hold:' + p.kind + ':' + p.value, client: '', analystHold: true });
      rec = NX.iocs.find(p.kind, p.value);
      // реквизит из разведки с независимым вторым источником стал «подтверждён корреляцией» — этого достаточно
      // для удержания. Иначе — удержание одним аналитиком (hold 72 ч): переводы удерживаются, но статус
      // «подтверждён аналитиком» не ставится — для него нужны две подписи (confirmIocStep).
      if (!rec || !strong(effSt(rec))) rec = (NX.iocs.hold ? NX.iocs.hold(p.value, signer() + ' · удержание счёта', why || 'Операции по счёту приостановлены аналитиком (hold 72 ч)', p.kind) : null) || rec;
    } catch (e) { return null; }
    if (!rec) return null;
    remember(rec);
    // узел уже есть в графе — помечаем его реквизитом стоп-листа (без синтетической истории)
    if (NX.Graph && node && !node.iocValue) { try { NX.Graph.addIoc(rec, { status: effSt(rec), history: false }); } catch (e) { /* ignore */ } }
    else if (NX.Graph) NX.Graph.setIocStatus(rec.kind, rec.value, effSt(rec));
    return rec;
  }
  function holdAccount(account, why, opts) {
    const o = opts || {};
    if (!account || account === '—') return false;
    const key = accKey(account);
    if (!B.held.some((a) => a === account || accKey(a) === key)) B.held.push(account);
    const node = o.node || (NX.Graph ? NX.Graph.byAccount(account) : null);
    if (node) { node.manualHold = true; node.blocked = true; }
    const rec = enforceHold(account, node, why);
    if (!o.noAudit) audit('account_hold', 'acc:' + account, node ? node.label + ' · ' + NX.Graph.disp(node) : dispAcc(account), (why || '') + (rec ? ' · в стоп-листе: ' + stLabel(effSt(rec)) : ''));
    B.incidents.filter((i) => i.fromClient && i.account && i.account !== '—' && accKey(i.account) === key && (i.status === 'new' || i.status === 'progress')).forEach((i) => setStatus(i, 'blocked', 'Операции по счёту получателя приостановлены (hold 72 ч)'));
    saveB();
    if (!o.silent) NX.toast('Операции по счёту приостановлены', (node ? node.label + ' · ' : '') + 'hold 72 ч · ' + signer() + (rec ? ' · переводы клиентов на счёт удерживаются' : ''), 'ok', 'lock');
    if (!o.noAudit) logCycle('investigate', 'Аналитик приостановил операции по счёту ' + (node ? node.label : dispAcc(account)) + ' (hold 72 ч)');
    if (rec) renderImmunity(false);
    if (current === 'graph') renderChainPanel();
    return true;
  }
  // «Hold» сначала спрашивает подтверждение: основание (обязательно) и срок 72 ч
  function holdNodeById(id) {
    const n = NX.Graph ? NX.Graph.node(id) : null;
    if (!n || n.blocked) return;
    const box = stdModal({
      title: 'Приостановить операции по счёту?', type: 'hold 72 ч', wide: false,
      body: '<p><b>' + esc(n.label) + '</b> · <span class="mono small">' + esc(NX.Graph.disp(n)) + '</span></p>' +
        '<p class="small mt-s">Входящие и исходящие операции по счёту будут приостановлены на <b>72 часа</b>. Переводы клиентов на этот счёт удерживаются. Решение одного аналитика; подтверждение реквизита в стоп-листе — двумя подписями.</p>' +
        '<div class="field mt"><label class="small muted" for="holdWhy">Основание (обязательно)</label><input class="input" id="holdWhy" placeholder="Например: веер входящих от незнакомых отправителей и транзит за минуты"></div>' +
        '<p class="tiny muted mt-s">Действует: ' + esc(signer()) + '. Решение попадёт в журнал аудита.</p>',
      primary: mBtn('holdGo', 'Приостановить на 72 ч', 'danger', { icon: 'lock' }),
      ghost: '<button type="button" class="btn ghost" data-close>Отмена</button>',
    });
    const cl = box && box.querySelector('.bm-acts [data-close]'); if (cl) cl.onclick = () => NX.closeModal();
    const inp = $('#holdWhy', box);
    try { if (inp) inp.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    const go2 = $('#holdGo', box);
    if (go2) go2.onclick = () => {
      const why = inp ? inp.value.trim() : '';
      if (why.length < 3) { if (inp) { inp.classList.add('err'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); } NX.toast('Нужно основание', 'Коротко опишите, почему приостанавливаете операции', 'warn', 'info'); return; }
      NX.closeModal();
      holdAccount(n.account, why, { node: n });
      if (NX.Graph.selected === n) nodePanel(n);
      if (current === 'accounts') renderAccounts();
    };
  }
  function ringHoldStep(id) {
    if (!NX.Graph) return;
    const ring = (NX.Graph.rings || []).find((r) => r.id === id);
    if (!ring) { NX.toast('Сеть не найдена', 'Повторите анализ графа', 'warn', 'graph'); return; }
    const ref = 'ring:' + ring.id, role = roleOf();
    const p = B.pending.find((x) => x.kind === 'ring_hold' && x.ref === ref);
    if (!p) {
      B.pending.push({ id: NX.uid('ap'), kind: 'ring_hold', ref, label: ring.id + ' · ' + ring.name, role, by: signer(role), ts: Date.now(), why: '' });
      audit('ring_hold_request', ref, ring.id + ' · ' + ring.name, cnt(ring.nodes.length, F.acc));
      NX.toast('Подпись 1 из 2', 'Приостановление операций сети ' + ring.id + ' ждёт второй подписи: ' + ROLES[otherRole(role)].title.toLowerCase(), 'info', 'users');
    } else if (p.role === role) {
      NX.toast('Нужна вторая подпись', 'Утвердить должен другой сотрудник — переключите роль на «' + ROLES[otherRole(role)].title + '»', 'warn', 'users');
      return;
    } else {
      B.pending = B.pending.filter((x) => x !== p);
      ring.nodes.forEach((n) => { if (!n.manualHold) holdAccount(n.account, 'Приостановление операций сети ' + ring.id, { silent: true, node: n, noAudit: true }); });
      audit('ring_hold', ref, ring.id + ' · ' + ring.name, p.by + ' + ' + signer(role) + ' · ' + cnt(ring.nodes.length, F.acc));
      NX.toast('Операции сети ' + ring.id + ' приостановлены', cnt(ring.nodes.length, F.acc) + ' · hold 72 ч · две подписи', 'ok', 'graph');
      logCycle('investigate', 'Операции сети ' + ring.id + ' приостановлены · две подписи');
    }
    saveB();
    renderRings(NX.Graph.rings);
    if (current === 'graph') renderChainPanel();
    renderImmunity(false);
    if (NX.Graph.selected) nodePanel(NX.Graph.selected);
    if (current === 'accounts') renderAccounts();
  }
  function renderRings(rings) {
    const box = $('#rings'); if (!box || !NX.Graph) return;
    const role = roleOf();
    box.innerHTML = rings.length ? rings.map((r) => {
      const p = B.pending.find((x) => x.kind === 'ring_hold' && x.ref === 'ring:' + r.id);
      const all = r.nodes.length && r.nodes.every((n) => n.blocked);
      let btn;
      if (all) btn = '<button type="button" class="btn sm" disabled>' + NX.icon('check', { size: 16 }) + 'Операции сети приостановлены</button>';
      else if (!p) btn = '<button type="button" class="btn sm danger" data-ring="' + esc(r.id) + '">Приостановить операции сети · подпись 1 из 2</button>';
      else if (p.role === role) btn = '<button type="button" class="btn sm" disabled>Ждёт второй подписи: ' + esc(ROLES[otherRole(role)].title.toLowerCase()) + '</button>';
      else btn = '<button type="button" class="btn sm danger" data-ring="' + esc(r.id) + '">Утвердить приостановление · подпись 2 из 2</button>';
      return '<div class="member mb" style="flex-direction:column;align-items:stretch;gap:8px"><div class="row between wrap"><b>' + esc(r.id) + ' · ' + esc(r.name) + '</b><span class="badge high">' + esc(cnt(r.nodes.length, F.acc)) + '</span></div>' +
        '<dl class="kv"><dt>Пострадавших</dt><dd>' + r.victims.length + '</dd><dt>Похищено / удержано</dt><dd>' + NX.fmt(r.stolen) + (r.syntheticAmount ? '<div class="tiny muted">без синтетической истории реквизитов из разведки (' + NX.fmt(r.syntheticAmount) + ')</div>' : '') + '</dd><dt>Вывод</dt><dd>' + esc(r.cashout.join(', ') || '—') + '</dd></dl>' +
        '<div class="row wrap gap-s">' + r.nodes.map((n) => '<span class="tag role-t r-' + esc(n.role) + '">' + esc(n.label) + '</span>').join('') + '</div>' + btn + '</div>';
    }).join('') + '<p class="tiny muted">Синтетические данные; для новых реквизитов из разведки ' + esc(SYNTH_NOTE) + '. Приостановление операций сети — только с двумя подписями; по одному счёту решает аналитик.</p>' : '<p class="small muted">Схем не найдено</p>';
  }
  function runDetect(quick) {
    const btn = $('#detectBtn');
    const finish = () => {
      const rings = NX.Graph.detect();
      renderRings(rings);
      if (btn) { btn.disabled = false; btn.innerHTML = NX.icon('search') + 'Найти схемы снова'; }
      const total = rings.reduce((a, r) => a + r.nodes.length, 0), vict = rings.reduce((a, r) => a + r.victims.length, 0);
      if (!quick) NX.toast('Найдено схем: ' + rings.length, cnt(total, F.susAcc) + ', ' + cnt(vict, F.victim), 'high', 'graph');
      if (NX.Graph.selected) nodePanel(NX.Graph.selected);
      if (!quick) { const ch = chainsNow(); if (ch.length && !chainSel) { chainSel = ch[0].start.id; highlightChain(ch[0]); } logCycle('predict', 'Цепочка дропов: найдено цепочек — ' + ch.length + (ch[0] ? ', ' + ch[0].id + ': ' + ch[0].hops + ' ' + NX.plural(ch[0].hops, ['переход', 'перехода', 'переходов']) + ' до обнала' : '')); }
      renderChainPanel();
      return rings;
    };
    if (quick) return finish();
    if (btn) { btn.disabled = true; btn.innerHTML = NX.icon('search') + 'Анализ потоков…'; }
    setTimeout(finish, 900);
    return null;
  }
  function replayGraph() {
    if (!NX.Graph) return;
    sortIocs(iocList()).reverse().forEach((r) => {
      // ручное удержание без узла в графе — отдельный узел не рисуем (hold восстановится по B.held)
      if (isHoldRec(r) && !NX.Graph.byAccount(r.raw || r.value)) return;
      NX.Graph.addIoc(r, { status: effSt(r), history: !noSynth(r) });
    });
    B.incidents.filter((i) => (i.stage ? /^Удержан/.test(String(i.title || '')) && Number(i.amount) > 0 : i.fromClient && transferKind(i) === 'held')).reverse().forEach((i) => NX.Graph.addVictim(String(i.victimLabel || i.client || 'Клиент').split(' (')[0], i.amount, i.account, i.victimAccount));
    try { if (MX()) MX().replayGraph(); } catch (e) { console.error(e); } // узлы «Не стань дропом»
    try { if (CL()) CL().replayGraph(); } catch (e) { console.error(e); } // «Кредитный замок»: устройство-фабрика заявок
    B.held.forEach((acc) => { const n = NX.Graph.byAccount(acc); if (n) { n.manualHold = true; n.blocked = true; } });
  }
  function initGraph() {
    const cv = $('#graphCanvas');
    if (!cv || !NX.Graph) return;
    NX.Graph.init(cv, $('#graphTip'));
    replayGraph();
    NX.Graph.onSelect(nodePanel);
    const db = $('#detectBtn'); if (db) db.onclick = () => runDetect(false);
    const gr = $('#graphReset');
    if (gr) gr.onclick = () => {
      NX.Graph.build(); replayGraph(); nodePanel(null); chainSel = null;
      const rb = $('#rings'); if (rb) rb.innerHTML = '<p class="small muted">Граф перестроен. Нажмите «Найти схемы».</p>';
      renderChainPanel();
    };
  }

  /* ================= ACCOUNTS ================= */
  function renderAccounts() {
    const body = $('#accBody'); if (!body || !NX.Graph) return;
    const res = NX.Graph.analyzeOnly();
    // мерчант Leak Radar — не счёт и не получатель переводов: в «Подозрительные счета» не входит
    const list = res.nodes.filter((x) => !x.n.merchant && (x.flagged || x.n.iocValue)).sort((a, b) => (b.risk || 0) - (a.risk || 0));
    const sum = list.reduce((a, x) => a + x.n.inSum, 0);
    const k = $('#accKpis');
    if (k) k.innerHTML = [['Подозрительных счетов', list.length], ['Дропов', list.filter((x) => x.role === 'mule').length], ['Сетей', res.rings.length], ['Оборот через сети (синтетика)', NX.fmt(sum)]].map((x) => '<div class="card kpi"><div class="label">' + x[0] + '</div><div class="value">' + x[1] + '</div></div>').join('');
    body.innerHTML = list.map((x) => {
      const n = x.n, m = x.metrics || { senders: 0, ratio: 0 };
      const sig = accSignals(x);
      // колонка «Статус» объединена с действием: hold — бейдж, на проверке — статус + кнопка
      const act = n.blocked ? '<span class="badge high">hold 72 ч</span>' : (n.iocValue ? stChip(n.iocStatus) + ' ' : '') + '<button type="button" class="btn sm danger" data-hold="' + esc(n.id) + '">Hold</button>';
      return '<tr class="' + ((x.risk || 0) >= 60 ? 'row-high' : 'row-med') + '" data-acc="' + esc(n.id) + '" tabindex="0" style="cursor:pointer"><td class="mono small" data-l="Счёт">' + esc(NX.Graph.disp(n)) + '</td><td class="acc-own" data-l="Владелец" title="' + esc(n.label) + '">' + esc(n.label) + '</td><td data-l="Роль">' + roleB(x.role) + '</td><td class="num" data-l="Отправителей">' + m.senders + '</td><td class="num" data-l="Оборот 48 ч">' + NX.fmt(n.inSum) + '</td><td class="small acc-sig" data-l="Сигналы" title="' + esc(sig.join(' · ')) + '">' + sig.slice(0, 2).map((s) => '<span class="tag">' + esc(s) + '</span>').join(' ') + (sig.length > 2 ? ' <span class="tiny muted">+' + (sig.length - 2) + '</span>' : '') + '</td><td data-l="Риск">' + riskW(x.risk || 0) + '</td><td data-l="Действие" class="acc-act">' + act + '</td></tr>';
    }).join('') || '<tr><td colspan="8" class="muted">Подозрительных счетов нет</td></tr>';
  }
  function accSignals(x) {
    const n = x.n, m = x.metrics || { senders: 0, ratio: 0 };
    const sig = [];
    if (m.senders >= 3) sig.push('веер входящих: ' + cnt(m.senders, F.sender));
    if (m.ratio >= 0.85) sig.push('быстрый транзит: дальше ушло ' + Math.round(m.ratio * 100) + '%');
    if (x.role === 'cashout') sig.push('вывод в обнал или криптовалюту');
    let mule = null; try { mule = NX.findMule(n.account); } catch (e) { mule = null; }
    if (mule) sig.push('в базе дропов банка');
    if (n.iocValue) sig.push('реквизит назвал мошенник (стоп-лист)');
    return sig;
  }
  // карточка счёта: почему отмечен, «Показать в графе», история
  function openAccount(id) {
    if (!NX.Graph) return;
    const n = NX.Graph.node(id); if (!n) return;
    const res = NX.Graph.analyzeOnly();
    const x = res.nodes.find((y) => y.n === n) || { n, role: n.role, risk: n.risk, metrics: n.metrics };
    const sig = accSignals(x);
    const nb = NX.Graph.neighbors(n);
    const hist = nb.in.concat(nb.out).slice(0, 12).map((e) => { const other = e.s === n ? e.t : e.s; return '<div class="li"><span class="small">' + (e.s === n ? '→ ' : '← ') + esc(other.label) + (e.synthetic ? ' <span class="tag">синтет.</span>' : '') + (e.held ? ' <span class="badge med">удержан</span>' : '') + '</span><span class="grow"></span><span class="small mono">' + NX.fmt(e.amount) + '</span></div>'; }).join('');
    const key = accKey(n.account);
    const aud = B.audit.filter((a) => a.ref === 'acc:' + n.account || (a.ref && a.ref.indexOf('acc:') === 0 && accKey(a.ref.slice(4)) === key)).slice(-5).reverse().map(auditLine).join('');
    const box = stdModal({
      title: n.label, type: (NX.Graph.ROLE_RU[x.role] || 'счёт'), riskHtml: riskW(x.risk || 0), statusHtml: n.blocked ? '<span class="badge high">hold 72 ч</span>' : n.iocValue ? stChip(n.iocStatus) : '',
      body: '<div class="mono small muted">' + esc(NX.Graph.disp(n)) + '</div>' +
        sec('Почему счёт отмечен', sig.length ? '<ul class="bm-why">' + sig.slice(0, 3).map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '<p class="small muted">Счёт связан с найденной схемой.</p>') +
        sec('История', (hist ? '<div class="list small">' + hist + '</div>' : '<p class="small muted">Операций в графе нет.</p>') + (aud ? '<h4 class="mt-s">Решения аналитиков</h4><div class="list">' + aud + '</div>' : '')) +
        NX.ui.details('<dl class="kv"><dt>Оценка риска</dt><dd>' + Math.round(x.risk || 0) + ' из 100</dd><dt>Входящие</dt><dd>' + NX.fmt(n.inSum) + ' (' + nb.in.length + ')</dd><dt>Исходящие</dt><dd>' + NX.fmt(n.outSum) + ' (' + nb.out.length + ')</dd>' + (sig.length > 3 ? '<dt>Ещё сигналы</dt><dd>' + esc(sig.slice(3).join(', ')) + '</dd>' : '') + '</dl>' + (n.synthHistory ? '<p class="tiny muted mt-s">' + esc(SYNTH_NOTE) + '.</p>' : '')),
      primary: n.blocked ? mBtn('accHeld', 'Операции приостановлены', '', { dis: true }) : mBtn('accHold', 'Hold 72 ч', 'danger', { icon: 'lock' }),
      secondary: mBtn('accGraph', 'Показать в графе', '', { icon: 'graph' }),
    });
    const bg = $('#accGraph', box); if (bg) bg.onclick = () => { NX.closeModal(); go('graph'); try { NX.Graph.select(n); NX.Graph.focus(n, { ms: 4000, k: 1.1 }); } catch (e) { /* ignore */ } nodePanel(n); };
    const bh = $('#accHold', box); if (bh) bh.onclick = () => holdNodeById(n.id);
  }

  /* ================= INCIDENTS ================= */
  const STATUS = { new: ['Новый', 'high'], progress: ['В работе', 'med'], resolved: ['Решён', 'ok'], false_positive: ['Ложное срабатывание', 'info'], blocked: ['Операции получателя приостановлены', 'ok'] };
  const stInfo = (s) => STATUS[s] || [String(s || 'Новый'), 'info'];
  let incFilter = '';
  function setStatus(inc, status, note) {
    inc.status = status === 'blocked' ? 'resolved' : status;
    inc.notes = inc.notes || [];
    const text = note || stInfo(status)[0];
    inc.notes.push({ ts: Date.now(), t: text, by: signer() });
    audit('incident_status', 'inc:' + inc.id, inc.title, text, { dup: true });
    if (inc.fromClient && !inc.kind) NX.bus.emit('incident_update', { id: inc.id, status, title: inc.title, note: text });
    if (inc.fromClient || inc.stage) logCycle('investigate', 'Инцидент «' + String(inc.title || '').slice(0, 70) + '»: ' + text, { inc: inc.id });
    render();
  }
  let incKind = '';
  function renderIncidents() {
    const box = $('#incList'); if (!box) return;
    const kindOk = (i) => !incKind || (incKind === 'leak' ? isLeakKind(i) : i.kind === incKind);
    const list = B.incidents.filter((i) => (!incFilter || i.status === incFilter) && kindOk(i));
    const c = $('#incCount'); if (c) c.textContent = cnt(list.length, F.inc);
    const EMPTY = {
      safe_return: 'Обращений о возврате денег пока нет. Когда клиент нажмёт «Меня обманули» и отправит заявление, кейс появится здесь с хронологией и доказательствами.',
      emergency: 'Обращений «Заблокировать всё» пока нет. Когда клиент нажмёт эту кнопку, здесь появится кейс с выбранными действиями.',
      mule_exit: 'Пока ни один клиент не сообщил о вербовке в дропы.',
      credit_lock: 'Попыток оформить заём на чужое имя пока нет.',
    };
    // строка: заголовок, клиент и время; справа — сумма, слово риска (или тип обращения) и статус
    box.innerHTML = list.map((i) => {
      const si = stInfo(i.status);
      const cf = consFor(i);
      const riskHtml = i.kind && !(Number(i.score) > 0) ? '<span class="small muted">' + esc(KIND_RU[i.kind] || 'обращение') + '</span>' : riskW(i.score);
      return '<div class="card pad-s inc-card' + ((i.fromClient || i.stage) && i.status === 'new' ? ' inc-live' : '') + '" style="cursor:pointer" data-inc="' + esc(i.id) + '" role="button" tabindex="0"><div class="row wrap between"><div class="row gap-s grow" style="min-width:min(240px,100%)"><div class="ic" style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--panel3);flex:none">' + (cf ? consIco(18) : NX.icon(KIND_ICON[i.kind] || (i.fromClient ? 'brain' : 'folder'), '', 18)) + '</div><div class="grow" style="min-width:0"><b>' + esc(i.title) + '</b><div class="small muted">' + esc(i.client) + ' · ' + esc(i.type) + ' · ' + esc(NX.ago(i.ts)) + '</div></div></div><div class="row wrap gap-s">' + (i.amount ? '<b class="tnum inc-amt">' + NX.fmt(i.amount) + '</b>' : '') + riskHtml + '<span class="badge ' + si[1] + '">' + esc(si[0]) + '</span></div></div></div>';
    }).join('') || '<div class="empty card">' + esc(EMPTY[incKind] || 'Инцидентов нет') + '</div>';
  }
  function setIncFilter(st, kind) {
    if (st != null) incFilter = st;
    if (kind != null) incKind = kind;
    $$('#incTabs [data-st]').forEach((b) => { const on = (b.dataset.st || '') === incFilter; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    const sel = $('#incKind'); if (sel && sel.value !== incKind) sel.value = incKind;
    renderIncidents();
  }
  function openIncident(id) {
    const i = B.incidents.find((x) => x.id === id);
    if (!i) return;
    const si = stInfo(i.status);
    const hit = iocForAccount(i.account);
    const hst = hit ? effSt(hit) : null;
    const hasAcc = i.account && i.account !== '—';
    const score = Number(i.score) || 0;
    // финансовая конституция клиента: какие статьи сработали и что происходило с правилами вокруг инцидента
    const cf = consFor(i);
    const cev = consEventsFor(i);
    const tl = (i.chain || []).map((c, k) => ({ t: c.t, ts: c.ts, cls: k === i.chain.length - 1 ? 'high' : 'med' }))
      .concat(cev.map((e) => ({ t: 'Конституция клиента: ' + e.title, ts: e.ts, cls: (e.tone === 'high' ? 'high' : e.tone === 'ok' ? 'ok' : 'med') + ' tl-cons' })))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const consHTML = cf
      ? '<h4 class="mt-s">' + consIco(16) + ' Сработавшие правила клиента</h4><div class="col" style="gap:6px">' + cf.hits.map(artRowHTML).join('') + '</div><p class="tiny muted mt-s">Эти правила клиент установил сам заранее, в спокойной обстановке. Удержание по правилу — исполнение воли клиента, а не решение банка.</p>'
      : cev.length ? '<p class="small muted mt-s">Правила клиента на этот перевод не срабатывали; события с правилами в это время — в цепочке событий.</p>' : '';
    const factors = (i.factors || []).map(factorText).filter(Boolean);
    const whyTitle = i.kind === 'safe_return' ? 'Связи с данными банка' : i.kind === 'emergency' ? 'Контекст в момент обращения' : 'Почему NEXUS так решил';
    const d = dnaOf(i);
    const what = '<p class="small">' + esc(i.title) + '</p>' +
      '<dl class="kv mt-s"><dt>Клиент</dt><dd>' + esc(i.client) + '</dd><dt>Сумма</dt><dd>' + (i.amount ? NX.fmt(i.amount) : '—') + '</dd><dt>Получатель</dt><dd class="mono small" style="word-break:break-all">' + esc(dispAcc(i.account)) + '</dd><dt>Источник</dt><dd>' + esc(i.source) + '</dd><dt>Создан</dt><dd>' + esc(NX.dateTime(i.ts)) + '</dd>' + (hit ? '<dt>Стоп-лист</dt><dd><span data-ioc="' + esc(hit.id) + '" role="button" tabindex="0" style="cursor:pointer">' + stChip(hst) + '</span></dd>' : '') + '</dl>' +
      (i.kind ? kindSummaryHTML(i) : '') + incExtraHTML(i) +
      (i.details ? '<div class="notice mt-s" style="word-break:break-word">' + esc(i.details) + '</div>' : '');
    const why = (factors.length ? '<ul class="bm-why">' + factors.slice(0, 3).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '<p class="small muted">Причины не указаны.</p>') + consHTML;
    const journal = '<div class="list small">' + ((i.notes || []).map((n) => '<div class="li"><span class="mono tiny muted">' + NX.time(n.ts) + '</span><div class="grow"><div>' + esc(n.t) + '</div>' + (n.by ? '<div class="tiny muted">' + esc(n.by) + '</div>' : '') + '</div></div>').join('') || '<span class="muted">Пока пусто</span>') + '</div>' +
      '<div class="field mt-s"><input class="input" id="incNote" placeholder="Комментарий аналитика…" aria-label="Комментарий аналитика"></div>';
    // «Подробнее»: число риска, остальные причины, цепочка событий, «ваш обычный перевод», кто действует
    const more = NX.ui.details(
      (score ? '<dl class="kv"><dt>Оценка риска</dt><dd>' + score + ' из 100</dd></dl>' : '') +
      (factors.length > 3 ? '<h4 class="mt-s">Ещё причины</h4><div class="row wrap gap-s">' + factors.slice(3).map((f) => '<span class="tag">' + esc(f) + '</span>').join('') + '</div>' : '') +
      (tl.length ? '<h4 class="mt-s">' + (i.kind === 'safe_return' ? 'Хронология · из событий кабинета за 24 ч, отмечена клиентом' : 'Цепочка событий') + '</h4><div class="timeline">' + tl.map((c) => '<div class="tl-item ' + c.cls + '"><div class="t">' + esc(c.t) + '</div><div class="s">' + (c.ts ? NX.time(c.ts) : '') + '</div></div>').join('') + '</div>' : '') +
      (d ? '<h4 class="mt-s">' + NX.icon('dna', '', 16) + ' Ваш обычный перевод · сравнение</h4>' + dnaHTML(d) : '') +
      '<p class="tiny muted mt-s">Действует: ' + esc(signer()) + '. Приостановление операций по одному счёту — решение аналитика; по сети и подтверждение реквизита в стоп-листе — две подписи. Кейс ' + esc(i.id) + (i.synthetic ? ' · синтетический' : '') + '.</p>');
    const acts = incActions(i, hasAcc);
    const box = stdModal({
      title: i.type || 'Инцидент', type: i.kind ? (KIND_RU[i.kind] || 'обращение') : i.fromClient ? 'живое демо' : i.synthetic ? 'синтетика' : '',
      riskHtml: score ? riskW(score) : '', statusHtml: '<span class="badge ' + si[1] + '">' + esc(si[0]) + '</span>',
      body: sec('Что произошло', what) + sec(whyTitle, why) + sec('Журнал', journal) + more,
      primary: acts.primary, secondary: acts.secondary, ghost: acts.ghost, more: acts.more,
      onClose: () => { modalRefresh = null; },
    });
    modalRefresh = () => openIncident(id);
    const note = () => { const el = $('#incNote', box); return el ? el.value.trim() : ''; };
    const on = (sel, fn) => { const el = $(sel, box); if (el) el.onclick = fn; };
    on('#iProg', () => { setStatus(i, 'progress', note() || 'Взят в работу'); saveB(); openIncident(id); });
    on('#iFp', () => { setStatus(i, 'false_positive', note() || 'Признан ложным срабатыванием'); saveB(); if (MX()) MX().bankVerdict(i, 'fp'); NX.closeModal(); NX.toast('Инцидент закрыт', 'Ложное срабатывание · кейс сохранён в обучающую выборку', 'info', 'check'); });
    on('#iFraud', () => {
      const why = note() || 'Мошенничество подтверждено';
      setStatus(i, 'resolved', why + (hasAcc ? ' · операции по счёту получателя приостановлены (hold 72 ч)' : ''));
      if (hasAcc) holdAccount(i.account, why, { silent: true });
      const hit2 = iocForAccount(i.account) || hit;
      const hst2 = hit2 ? effSt(hit2) : null;
      if (hit2 && active(hst2) && hst2 !== 'confirmed') confirmIocStep(hit2, 'Мошенничество подтверждено в инциденте');
      if (MX()) MX().bankVerdict(i, 'fraud');
      saveB();
      NX.closeModal();
      NX.toast('Мошенничество подтверждено', hasAcc ? 'Операции получателя приостановлены (hold 72 ч)' + (i.fromClient ? ', клиент уведомлён' : '') : 'Инцидент решён', 'ok', 'lock');
    });
    on('#iContact', () => {
      const msgText = i.kind === 'credit_lock'
        ? 'Антифрод-центр банка: заявки на заём от вашего имени отклонены. Никому не называйте коды из SMS — по ним мошенник подаёт заявки. Мы перезвоним с номера, указанного на обороте карты.'
        : i.kind === 'mule_exit'
        ? 'Антифрод-центр банка: спасибо, что сообщили сами. Не пересылайте чужие деньги и не передавайте данные карты. Если «куратор» пишет или звонит — не отвечайте. Мы перезвоним с номера, указанного на обороте карты.'
        : i.kind === 'safe_return'
        ? 'Антифрод-центр банка: ваше обращение «Меня обманули» получено и проверяется. Не переводите деньги «для возврата» и не сообщайте коды — банк никогда их не просит. Мы свяжемся с вами с номера, указанного на обороте карты.'
        : i.kind === 'emergency'
          ? 'Антифрод-центр банка: «Заблокировать всё» включён, новые переводы и добавление получателей приостановлены. Положите трубку, если вам звонят «из банка» или «из полиции». Мы перезвоним с номера, указанного на обороте карты.'
          : 'Антифрод-центр банка: мы удержали подозрительную операцию для проверки. Никому не сообщайте коды из SMS. Если вам звонят «из банка» — положите трубку: мы перезвоним с номера, указанного на обороте карты.';
      if (i.fromClient) NX.bus.emit('bank_message', { text: msgText });
      i.notes = i.notes || [];
      i.notes.push({ ts: Date.now(), t: i.fromClient ? 'Отправлено уведомление в кабинет клиента' : 'Звонок клиенту поставлен в очередь (официальный номер)', by: signer() });
      saveB();
      NX.toast('Клиент уведомлён', i.fromClient ? 'Сообщение доставлено в кабинет клиента' : 'Звонок поставлен в очередь колл-центра', 'ok', 'phone');
      openIncident(id);
    });
    // «Звонит настоящий банк»: шаг «обратный звонок» — звонок с официального номера + отметка в приложении клиента на TTL
    on('#iBankCall', () => {
      const ttl = BANK_CALL_TTL;
      const r = ROLES[roleOf()];
      // тема — по типу инцидента: «удержанная операция» только там, где перевод действительно удержан
      const KIND_TOPIC = {
        safe_return: 'ваше обращение «Меня обманули»', emergency: 'обращение «Заблокировать всё»',
        credit_lock: 'проверка заявок на заём' + (i.amount ? ' на ' + NX.fmt(i.amount) : ''),
        sd_dispute: 'спор по безопасной сделке' + (i.amount ? ' на ' + NX.fmt(i.amount) : ''),
        mule_exit: 'ваше сообщение о переводах от незнакомых людей',
      };
      const topic = KIND_TOPIC[i.kind] || (i.amount && i.heldTransfer !== false ? 'проверка удержанной операции на ' + NX.fmt(i.amount) : i.amount ? 'проверка операции на ' + NX.fmt(i.amount) : 'проверка инцидента');
      const callId = NX.uid('bcall');
      const ts = Date.now();
      NX.bus.emit('bank_call', { client: i.client, callId, employeeId: r.no, topic, ts, ttl });
      i.bankCall = { callId, until: ts + ttl * 1000, employeeId: r.no };
      i.notes = i.notes || [];
      i.notes.push({ ts, t: 'Обратный звонок с официального номера · отметка «Сейчас вам действительно звонит банк» отправлена в приложение клиента на ' + Math.round(ttl / 60) + ' мин (сотрудник №' + r.no + ', тема: ' + topic + ')', by: signer() });
      saveB();
      NX.toast('Отметка о звонке отправлена', (i.fromClient ? 'Клиент ' + i.client + ' видит в приложении: звонит банк, сотрудник №' + r.no + ' · ' + Math.round(ttl / 60) + ' мин'
        : 'Клиент ' + i.client + ' синтетический: кабинет этого демо показывает отметку только своему владельцу') + ' · симуляция', 'ok', 'phone');
      openIncident(id);
    });
    on('#iBankCallEnd', () => {
      if (i.bankCall) NX.bus.emit('bank_call_end', { client: i.client, callId: i.bankCall.callId, ts: Date.now() });
      i.notes = i.notes || [];
      i.notes.push({ ts: Date.now(), t: 'Обратный звонок завершён · отметка в приложении клиента снята', by: signer() });
      delete i.bankCall;
      saveB();
      openIncident(id);
    });
    on('#iStr', () => openStr(i));
    on('#iAfc', () => openAfc(hit, i));
    // Возврат денег: статусы для клиента (bus safe_return_update), реквизиты из заявления — в стоп-лист
    on('#srChecking', () => { srUpdate(i, 'checking', note()); openIncident(id); });
    on('#srNeed', () => { srUpdate(i, 'need_info', note()); openIncident(id); });
    on('#srResult', () => { srUpdate(i, 'result', note()); openIncident(id); });
    on('#srIoc', () => { srToStopList(i); openIncident(id); });
    // «Заблокировать всё»
    on('#emDone', () => { setStatus(i, 'resolved', note() || 'Обращение «Заблокировать всё» закрыто: клиент проинструктирован, подозрительных операций нет'); saveB(); openIncident(id); });
  }

  /* ================= ANALYTICS ================= */
  function renderAnalytics() {
    const cw = $('#consWhy');
    if (cw) cw.innerHTML = consWhyHTML();
    const hb = $('#hourBars');
    if (hb) {
      const hr = S.hours, mh = Math.max.apply(null, hr.concat([1]));
      hb.innerHTML = '<svg viewBox="0 0 480 170" style="width:100%;height:auto" role="img" aria-label="Подозрительные операции по часам суток">' + hr.map((v, h) => { const bh = (v / mh) * 130; return '<rect x="' + (h * 20 + 2) + '" y="' + (140 - bh) + '" width="16" height="' + bh + '" rx="3" fill="' + (h >= 18 && h <= 21 ? PAL.danger : PAL.violet) + '" opacity=".85"><title>' + h + ':00 — ' + v + '</title></rect>' + (h % 3 === 0 ? '<text x="' + (h * 20 + 10) + '" y="160" text-anchor="middle" fill="' + PAL.muted + '" font-size="10">' + h + '</text>' : ''); }).join('') + '</svg><p class="small muted">Синтетический профиль для демонстрации визуализации. На пилоте строится по истории операций и подтверждённых инцидентов банка.</p>';
    }
    const cc = $('#channelChart');
    if (cc) {
      const tot = S.channels.reduce((a, b) => a + b, 0);
      cc.innerHTML = tot ? CHANNELS.map((c, i) => '<div class="bar-row"><span class="muted">' + esc(c) + '</span><div class="bar"><i style="width:' + (S.channels[i] / tot) * 100 + '%;background:' + THREAT_COLORS[i] + '"></i></div><span class="v">' + Math.round((S.channels[i] / tot) * 100) + '%</span></div>').join('') + '<p class="tiny muted mt-s">Удержанные операции синтетического потока по каналам.</p>' : '<p class="small muted">В синтетическом потоке пока нет удержанных операций.</p>';
    }
    const mq = $('#modelQuality');
    if (mq) {
      mq.innerHTML = '<div class="notice warn">Синтетическая разметка потока — демонстрация пайплайна, не оценка качества. Метки и признаки создаёт один и тот же симулятор (доля мошенничества 0,4%), поэтому точность и полнота на нём ничего не говорят о модели.</div>' +
        '<div class="grid g2 mt" style="gap:8px;font-size:12px"><div class="card pad-s"><div class="muted">Удержано · мошенничество (метка симулятора)</div><b>' + NX.num(S.tp) + '</b></div><div class="card pad-s"><div class="muted">Удержано · легитимные</div><b>' + NX.num(S.fp) + '</b></div><div class="card pad-s"><div class="muted">Пропущено · мошенничество</div><b>' + NX.num(S.fn) + '</b></div><div class="card pad-s"><div class="muted">Пропущено · легитимные</div><b>' + NX.num(S.tn) + '</b></div></div>' +
        '<h4 class="mt mb" style="font-size:13px">План валидации на данных банка</h4><ol class="small" style="margin:0;padding-left:18px;line-height:1.6">' +
          '<li>Бэктест на 6 месяцах истории операций и подтверждённых инцидентов (out-of-time).</li>' +
          '<li title="PR-AUC и recall при FPR 0,1%">Метрики: сколько мошенничества ловим при очень редких ложных удержаниях; доля ложных удержаний у клиентов 60+.</li>' +
          '<li>Теневой режим: решения записываются и сверяются, клиентов не затрагивают.</li>' +
          '<li>Калибровка индекса риска (Platt / isotonic) и пороги по сегментам.</li>' +
          '<li>Сравнение с действующими правилами антифрода и наблюдение, не «поплыла» ли модель со временем.</li>' +
        '</ol><p class="tiny muted mt-s">Честный бенчмарк текстового детектора на размеченном командой корпусе RU+KZ: <a href="bench.html">bench.html</a>.</p>';
    }
    const pv = $('#prevented');
    if (pv) {
      const s = B.stats;
      const live = s.livePrevented + s.iocPrevented;
      pv.innerHTML = '<div class="kpi"><div class="label">Удержано до списания</div><div class="value grad-text" style="font-size:34px">' + NX.fmt(S.prevented + live) + '</div><div class="delta muted">синтетический поток: ' + NX.fmt(S.prevented) + ' · живые операции демо: ' + NX.fmt(live) + '</div></div>' +
        '<dl class="kv mt"><dt>Удержано на реквизиты из стоп-листа</dt><dd>' + esc(cnt(s.iocHeld, F.tr)) + ' · ' + NX.fmt(s.iocPrevented) + '</dd><dt>Удержано по сигналам Core из кабинета</dt><dd>' + esc(cnt(s.liveHeld, F.tr)) + ' · ' + NX.fmt(s.livePrevented) + '</dd>' +
        (s.attempts ? '<dt>Предотвращённые попытки (перевода не было)</dt><dd>' + NX.num(s.attempts) + ' · планировалось ' + NX.fmt(s.attemptsSum) + ' — не входит в «удержано»</dd>' : '') +
        (s.falseHeld ? '<dt>Сняты как ложные удержания</dt><dd>' + esc(cnt(s.falseHeld, F.tr)) + ' · ' + NX.fmt(s.falseHeldSum) + ' — не входит в «удержано»</dd>' : '') + '</dl><div class="divider"></div>' +
        B.incidents.slice(0, 5).map((i) => '<div class="li"><div class="grow"><div class="t">' + esc(i.type) + '</div><div class="s">' + esc(i.client) + '</div></div><span class="small">' + (i.amount ? NX.fmt(i.amount) : '—') + '</span></div>').join('');
    }
    renderSummary();
    renderXbank();
  }
  function renderSummary() {
    const box = $('#aiSummary'); if (!box) return;
    const c = THREATS.map(() => 0);
    // те же данные, что в карточке «Типы угроз»: инциденты в очереди + синтетический поток
    B.incidents.forEach((i) => { c[threatIndex(i.type)]++; });
    S.threat.forEach((v, k) => (c[k] += v));
    const tot = c.reduce((a, b) => a + b, 0) || 1;
    const mxc = Math.max.apply(null, c);
    const ti = c.indexOf(mxc);
    const tied = c.filter((x) => x === mxc).length;
    const rings = NX.Graph ? (NX.Graph.detected ? NX.Graph.rings : NX.Graph.analyzeOnly().rings) : [];
    const list = iocList(), sts = list.map(effSt);
    const nAct = sts.filter(active).length;
    const liveInc = B.incidents.filter((i) => i.fromClient).length;
    const s = B.stats;
    const ic = (n) => '<span style="display:inline-flex;width:16px;height:16px;vertical-align:-3px;margin-right:6px;color:var(--accent)">' + NX.icon(n, '', 16) + '</span>';
    const lines = [
      ic('chart') + 'Синтетический поток (выборка 1:1000): обработано <b>' + esc(cnt(S.processed, F.op)) + '</b>, удержано для проверки <b>' + NX.num(S.blocked) + '</b>, удержано до списания <b>' + NX.fmt(S.prevented) + '</b>.',
      ic('target') + (!mxc ? 'Инцидентов по типам угроз пока нет.' : tied > 1
        ? 'Явного основного вектора нет: поровну (по ' + mxc + ') — ' + esc(THREATS.filter((t, k) => c[k] === mxc).join(', ')) + ' (инциденты в очереди и синтетический поток).'
        : 'Основной вектор по инцидентам в очереди и синтетическому потоку — <b>' + esc(THREATS[ti]) + '</b> (' + Math.round((c[ti] / tot) * 100) + '% случаев, как в карточке «Типы угроз»).'),
      ic('graph') + 'В графе связей: <b>' + esc(cnt(rings.length, ['мошенническая сеть', 'мошеннические сети', 'мошеннических сетей'])) + '</b>' + (rings[0] ? ', крупнейшая — ' + esc(cnt(rings[0].nodes.length, F.acc)) + ' и ' + esc(cnt(rings[0].victims.length, F.victim)) + ' на ' + NX.fmt(rings[0].stolen) : '') + ' (синтетические данные).',
      list.length ? ic('dna') + 'Активная защита: в стоп-листе <b>' + esc(cnt(nAct, F.ioc)) + '</b> (на проверке — ' + sts.filter((x) => x === 'suspected').length + ', подтверждено корреляцией — ' + sts.filter((x) => x === 'corroborated').length + ', аналитиком — ' + sts.filter((x) => x === 'confirmed').length + '); удержано <b>' + esc(cnt(s.iocHeld, F.tr)) + '</b> на эти реквизиты.' : null,
      liveInc ? ic('brain') + 'Инциденты из клиентских модулей: <b>' + NX.num(liveInc) + '</b> — сигналы с устройства (звонок, сообщение, ссылка), которых нет в транзакционном мониторинге.' : null,
      B.cons.stats.fired || B.cons.stats.refused ? '<span style="display:inline-flex;width:16px;height:16px;vertical-align:-3px;margin-right:6px;color:var(--accent)">' + consIco(16) + '</span>Финансовая конституция клиента: сработало статей — <b>' + NX.num(B.cons.stats.fired) + '</b>, удержано переводов — <b>' + NX.num(B.cons.stats.stopped) + '</b>' + (B.cons.stats.stoppedSum ? ' на ' + NX.fmt(B.cons.stats.stoppedSum) : '') + ', отклонено попыток ослабить защиту — <b>' + NX.num(B.cons.stats.refused) + '</b>.' : null,
    ].filter(Boolean);
    const recs = [
      'Приостановить операции по счетам сети «Безопасный счёт» (hold 72 ч, две подписи) и подготовить сообщение в АФМ',
      'Проверить счета, связанные с цепочкой дропов: связь ≠ вина — решение аналитика, снятое подозрение фиксируется в журнале',
      'Передать подтверждённые реквизиты из стоп-листа в Антифрод-центр НБРК',
      'Предложить клиентам 60+ свои правила защиты с близким человеком и правилом 24 часов',
      tied > 1 || !mxc ? 'Отправить push-предупреждение о самых частых схемах клиентам из группы риска' : 'Отправить push-предупреждение о схеме «' + THREATS[ti].toLowerCase() + '» клиентам из группы риска',
    ];
    box.innerHTML = '<div class="col gap-s">' + lines.map((l) => '<div>' + l + '</div>').join('') + '</div><p class="tiny muted mt-s">Сводка собрана по данным панели (шаблон, без LLM).</p><h4 class="mt mb" style="font-size:13px">Рекомендации</h4><div class="grid g2" style="gap:8px">' + recs.map((r) => '<div class="feat" style="padding:10px 12px;background:var(--bg2);border-radius:10px;border:1px solid var(--line)">' + esc(r) + '</div>').join('') + '</div>';
  }

  /* ================= ВХОДЯЩИЕ ОТ КЛИЕНТА ================= */
  function recordHold(o) {
    const r = o.rec;
    B.holds.unshift({ id: NX.uid('hold'), ts: Date.now(), client: String(o.client || ''), amount: Number(o.amount) || 0, kind: r.kind, value: r.value, raw: dispIoc(r), status: effSt(r), source: srcText(r), firstSeen: r.firstSeen || r.ts || null, via: o.via || 'client', incidentId: o.incidentId || null });
    B.holds = B.holds.slice(0, 50);
    B.stats.iocHeld++;
    B.stats.iocPrevented += Number(o.amount) || 0;
  }
  // Инцидент о переводе клиента: 'held' — перевод был и удержан; 'attempt' — перевода не было
  // (ATO-демо: удержана смена лимита, сумма — лишь планировавшийся перевод); null — не про перевод.
  function transferKind(i) {
    if (!i || !(Number(i.amount) > 0)) return null;
    const type = String(i.type || ''), title = String(i.title || '');
    if (!/дроп|ATO|Захват|Перевод|Вишинг|Социальн/i.test(type + ' ' + title)) return null;
    if (i.heldTransfer === true) return 'held';
    if (i.heldTransfer === false || i.demo === true) return 'attempt';
    if (/ATO|Захват/i.test(type) && !/перевод/i.test(title)) return 'attempt';
    return 'held';
  }
  function importInbox(silent, extraItems) {
    let inbox = [];
    try { inbox = NX.inbox.all(); } catch (e) { inbox = []; }
    (extraItems || []).forEach((it) => { if (it && it.id && !inbox.some((x) => x && x.id === it.id)) inbox.unshift(it); });
    let added = 0;
    inbox.slice().reverse().forEach((item) => {
      if (!item || !item.id || B.imported.indexOf(item.id) >= 0) return;
      B.imported.push(item.id);
      const inc = Object.assign({ notes: [], factors: [], chain: [] }, item, { fromClient: true });
      if (!Array.isArray(inc.notes)) inc.notes = [];
      if (!Array.isArray(inc.factors)) inc.factors = [];
      if (!Array.isArray(inc.chain)) inc.chain = [];
      if (!inc.ts) inc.ts = Date.now();
      B.incidents.unshift(inc);
      try { attachCons(inc); } catch (e) { console.error(e); }
      added++;
      const amount = Number(item.amount) || 0;
      const tk = transferKind(item);
      if (tk === 'held' && NX.Graph) NX.Graph.addVictim(String(item.client || 'Клиент').split(' (')[0], amount, item.account);
      if (tk === 'attempt' && (Number(item.score) || 0) >= 60) { B.stats.attempts++; B.stats.attemptsSum += amount; }
      else if (tk === 'held' && (Number(item.score) || 0) >= 60) {
        const hit = iocForAccount(item.account);
        if (hit && strong(effSt(hit))) recordHold({ client: item.client, amount, rec: hit, via: 'client', incidentId: item.id });
        else { B.stats.liveHeld++; B.stats.livePrevented += amount; }
      }
      if (!silent) {
        const d = dnaOf(inc);
        if (d) logCycle('understand', 'Сравнение с обычным переводом · индекс ' + Math.round(Number(d.index) || 0) + ' — ' + dnaTierLabel(d) + ': ' + String(item.client || 'клиент'), { inc: inc.id });
        else logCycle('detect', 'Инцидент от клиента: ' + String(item.title || ''), { inc: inc.id });
        NX.toast('Новый инцидент от клиента', String(item.title || ''), 'high', 'brain');
      }
    });
    if (B.imported.length > 500) B.imported = B.imported.slice(-500);
    if (B.incidents.length > 120) B.incidents = B.incidents.slice(0, 120);
    if (added) { saveB(); render(); }
  }

  /* =====================================================================
     NEXUS AI 3.0 · цикл DETECT → UNDERSTAND → PREDICT → PROTECT → INVESTIGATE → RECOVER
     ===================================================================== */
  const KIND_ICON = { safe_return: 'reset', emergency: 'shield', leak_merchant: 'card', leak_honey: 'target', sd_dispute: 'shieldCheck', mule_exit: 'users', credit_lock: 'lock' }; // в наборе иконок нет 'user' — берём 'users'
  const KIND_RU = { safe_return: 'обращение клиента', emergency: 'обращение клиента', leak_merchant: 'Карты для магазинов · симуляция', leak_honey: 'Карты для магазинов · симуляция', sd_dispute: 'Безопасная сделка · симуляция', mule_exit: 'Не стань дропом · демо', credit_lock: 'Кредитный замок · демо' };
  const isLeakKind = (i) => !!(i && (i.kind === 'leak_merchant' || i.kind === 'leak_honey'));
  const LR = () => (NX.LeakRadar && typeof NX.LeakRadar.bankIncidentHTML === 'function' ? NX.LeakRadar : null);
  const SD = () => (NX.SafeDeal && typeof NX.SafeDeal.bankIncidentHTML === 'function' ? NX.SafeDeal : null); // safe-deal.js
  const MX = () => (NX.MuleExit && typeof NX.MuleExit.bankIncidentHTML === 'function' ? NX.MuleExit : null); // mule-exit.js
  const CL = () => (NX.CreditLock && typeof NX.CreditLock.bankIncidentHTML === 'function' ? NX.CreditLock : null); // credit-lock.js
  // у обращений клиента (Возврат денег, Emergency) нет индекса риска — показываем тип, а не «0 · низкий»
  function scoreBadge(i) {
    if (i && i.kind && !(Number(i.score) > 0)) return '<span class="badge info plain">' + esc(KIND_RU[i.kind] || 'обращение') + '</span>';
    return NX.badge(Number(i && i.score) || 0);
  }
  function clientFromState() {
    try { const u = NX.state && NX.state.user; return u && u.name ? String(u.name) : 'Клиент'; } catch (e) { return 'Клиент'; }
  }

  /* ---------- полоса цикла защиты на обзоре ---------- */
  const CYCLE = [
    ['detect', 'DETECT', 'Обнаружить', 'Звонок, SMS, ссылка, подозрительное поведение'],
    ['understand', 'UNDERSTAND', 'Понять', 'Сценарий атаки и давление, сравнение с обычным переводом клиента'],
    ['predict', 'PREDICT', 'Предсказать', 'Следующий шаг мошенника, цепочка дропов'],
    ['protect', 'PROTECT', 'Защитить', 'Правила клиента, правило 24 часов, «Близкие», «Заблокировать всё»'],
    ['investigate', 'INVESTIGATE', 'Расследовать', 'Граф, стоп-лист, инциденты'],
    ['recover', 'RECOVER', 'Вернуть', 'Возврат денег: хронология, доказательства, статус'],
  ];
  const CYCLE_GO = { detect: ['monitor', 'Мониторинг'], understand: ['overview', 'Сейчас'], predict: ['graph', 'Граф'], protect: ['overview', 'Сейчас'], investigate: ['incidents', 'Инциденты'], recover: ['incidents', 'Инциденты'] };
  const CYCLE_WINDOW = 2 * 3600000;
  const CYCLE_LIVE = 15 * 60000;
  function logCycle(st, t, ref) {
    if (dead || !CYCLE.some((c) => c[0] === st)) return;
    const text = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 170);
    if (!text) return;
    const dup = B.cycle.find((e) => e.st === st && e.t === text && Date.now() - e.ts < 8000);
    if (dup) return;
    B.cycle.unshift({ id: NX.uid('cy'), ts: Date.now(), st, t: text, ref: ref || null });
    if (B.cycle.length > 80) B.cycle.length = 80;
    saveB();
    if (current === 'overview') renderCycle();
  }
  let cycHtml = '';
  function renderCycle() {
    const box = $('#cycleStrip'); if (!box) return;
    const now = Date.now();
    // одна строка-индикатор: видна, только пока идёт атака (isAttackLive), и считает события этой атаки
    // (за 15 минут); рутинные действия аналитика без атаки индикатор не зажигают
    const since = attackSince();
    const recent = isAttackLive() ? B.cycle.filter((e) => now - e.ts <= CYCLE_LIVE && e.ts >= since) : [];
    if (!recent.length) { if (cycHtml) { box.innerHTML = ''; cycHtml = ''; } return; }
    const lastSt = recent[0].st;
    const html = '<div class="cyc-line mb" role="group" aria-label="Стадии защиты: где сейчас атака"><span class="tiny muted">Стадии:</span>' +
      CYCLE.map((c) => {
        const evs = recent.filter((e) => e.st === c[0]);
        return '<button type="button" class="cyc-c' + (evs.length ? ' has' : '') + (c[0] === lastSt ? ' now' : '') + '" data-cycle="' + c[0] + '" title="' + esc(evs[0] ? evs[0].t : c[3]) + '">' + esc(c[2]) + (evs.length ? ' · ' + evs.length : '') + '</button>';
      }).join('<span class="cyc-sep" aria-hidden="true">›</span>') + '</div>';
    if (html === cycHtml && box.firstChild) return;
    cycHtml = html; box.innerHTML = html;
  }
  function openCycle(st) {
    const c = CYCLE.find((x) => x[0] === st); if (!c) return;
    const evs = B.cycle.filter((e) => e.st === st).slice(0, 30);
    const g = CYCLE_GO[st];
    const box = bmodal('<div class="row between wrap"><h3>Стадия «' + esc(c[2]) + '»</h3><span class="badge plain">' + esc(cnt(evs.length, ['событие', 'события', 'событий'])) + '</span></div><p class="small muted">' + esc(c[3]) + '.</p>' +
      '<div class="list mt" style="max-height:52vh;overflow:auto">' + (evs.map((e) => '<div class="li"' + (e.ref && e.ref.inc ? ' data-inc="' + esc(e.ref.inc) + '" role="button" tabindex="0" style="cursor:pointer"' : '') + '><span class="mono tiny muted">' + NX.time(e.ts) + '</span><div class="grow"><div class="small" style="white-space:normal">' + esc(e.t) + '</div>' + (e.ref && e.ref.inc ? '<div class="tiny muted">открыть инцидент →</div>' : '') + '</div></div>').join('') || '<div class="empty">Событий этой стадии пока нет</div>') + '</div>' +
      '<div class="row wrap mt" style="justify-content:flex-end"><button type="button" class="btn" data-close>Закрыть</button><button type="button" class="btn primary" id="cycGo">Перейти: ' + esc(g[1]) + '</button></div>', { wide: true });
    const b = $('#cycGo', box); if (b) b.onclick = () => { NX.closeModal(); go(g[0]); };
  }

  /* ---------- детектор манипуляций (bus manip_update от shield.js) ---------- */
  const MANIP_STAGES = { authority: 'Имитация авторитета', fear: 'Манипуляция страхом', urgency: 'Искусственная срочность', isolation: 'Изоляция жертвы', access: 'Попытка получить доступ', app: 'Просьба открыть банковское приложение', money: 'Перевод денег' };
  const PRESSURE_CLS = { 'высокое': 'high', 'среднее': 'warn', 'низкое': 'info' };
  function stageLabel(id, fb) {
    try {
      const S2 = NX.Manip && NX.Manip.STAGES;
      const s = Array.isArray(S2) ? S2.find((x) => x && x.id === id) : S2 && typeof S2 === 'object' ? S2[id] : null;
      if (s && (s.label || typeof s === 'string')) return String(s.label || s);
    } catch (e) { /* ignore */ }
    return str(fb) || MANIP_STAGES[id] || String(id || '');
  }
  // упорядоченные стадии шаблона сценария (если NX.Manip загружен); 'app/access' — альтернативы одной позиции
  function templateSeq(m) {
    const tid = (m.scenario && str(m.scenario.template)) || (m.attackType && str(m.attackType.id));
    if (!tid) return null;
    let T = null;
    try {
      const TT = NX.Manip && NX.Manip.TEMPLATES;
      if (Array.isArray(TT)) T = TT.find((t) => t && t.id === tid) || null;
      else if (TT && typeof TT === 'object') T = TT[tid] || null;
    } catch (e) { T = null; }
    const raw = T && (T.stages || T.sequence || T.order);
    if (!Array.isArray(raw)) return null;
    const out = [];
    raw.forEach((x) => {
      const ids = Array.isArray(x) ? x : typeof x === 'string' ? x.split('/') : x && x.id ? [x.id] : [];
      ids.forEach((id) => { if (id && out.indexOf(String(id)) < 0) out.push(String(id)); });
    });
    return out.length ? out : null;
  }
  function handleManip(p) {
    const at0 = p.attackType;
    const at = at0 && typeof at0 === 'object' ? { id: str(at0.id), label: str(at0.label), en: str(at0.en) } : at0 ? { id: str(at0), label: str(at0), en: '' } : null;
    const stages = (Array.isArray(p.stages) ? p.stages : []).map((s) => (typeof s === 'string' ? { id: s } : s)).filter((s) => s && s.id).map((s) => ({ id: str(s.id), label: str(s.label), quote: str(s.quote) }));
    if (!stages.length && !(at && at.label)) return;
    const prev = liveState.manip;
    const riskIndex = NX.clamp(Math.round(Number(p.riskIndex) || 0), 0, 100);
    const next = p.next && typeof p.next === 'object' && (p.next.id || p.next.label) ? { id: str(p.next.id), label: str(p.next.label) || stageLabel(str(p.next.id)), advice: str(p.next.advice) } : null;
    const pr = p.pressure && typeof p.pressure === 'object' ? { level: str(p.pressure.level), score: p.pressure.score != null ? Math.round(Number(p.pressure.score) || 0) : null } : null;
    const sc = p.scenario && typeof p.scenario === 'object' ? { template: str(p.scenario.template), matched: Number(p.scenario.matched) || 0, of: Number(p.scenario.of) || 0, inOrder: !!p.scenario.inOrder } : null;
    const key = (at ? at.id : '') + '|' + stages.map((s) => s.id).join(',');
    const m = { client: str(p.client) || (prev && prev.client) || (liveState.call && liveState.call.client) || '', attackType: at, stages, pressure: pr, scenario: sc, next, riskIndex, ts: Date.now(), key };
    liveState.manip = m;
    if (!prev || prev.key !== key) {
      logCycle('understand', 'Детектор манипуляций: ' + (at && at.label ? at.label : 'сценарий атаки') + ' · ' + cnt(stages.length, ['стадия', 'стадии', 'стадий']) + (pr && pr.level ? ' · давление ' + pr.level : ''));
      if (!prev) NX.toast('Детектор манипуляций', (m.client ? m.client + ': ' : '') + (at && at.label ? at.label : 'сценарий атаки') + ' · ' + cnt(stages.length, ['стадия', 'стадии', 'стадий']), 'high', 'brain');
    }
    if (next && (!prev || !prev.next || prev.next.id !== next.id)) logCycle('predict', 'Прогноз следующего шага мошенника: ' + next.label);
    renderLive();
  }
  function manipHTML(m) {
    const hitIds = m.stages.map((s) => s.id);
    const seq = (templateSeq(m) || []).slice();
    hitIds.forEach((id) => { if (seq.indexOf(id) < 0) seq.push(id); });
    const nextId = m.next && m.next.id;
    if (nextId && seq.indexOf(nextId) < 0) seq.push(nextId);
    const pr = m.pressure, sc = m.scenario;
    const meta = [];
    if (m.attackType && m.attackType.label) meta.push('<span class="badge high plain">Тип атаки: ' + esc(m.attackType.label) + (m.attackType.en && m.attackType.en !== m.attackType.label ? ' · ' + esc(m.attackType.en) : '') + '</span>');
    if (pr && pr.level) meta.push('<span class="badge ' + (PRESSURE_CLS[pr.level] || 'warn') + ' plain">Давление: ' + esc(pr.level) + (pr.score != null ? ' · ' + pr.score + ' из 100' : '') + '</span>');
    if (sc && sc.of) meta.push('<span class="badge violet plain">Совпадение со сценарием: ' + sc.matched + ' из ' + sc.of + ' стадий' + (sc.inOrder ? ' · в порядке шаблона' : '') + '</span>');
    meta.push('<span class="badge plain">индекс риска ' + m.riskIndex + ' из 100</span>');
    const track = seq.map((id, k) => {
      const s = m.stages.find((x) => x.id === id);
      const hit = !!s, nx = !hit && id === nextId;
      const tip = s && s.quote ? '«' + s.quote.slice(0, 140) + '»' : hit ? 'стадия распознана' : nx ? 'прогноз по шаблону сценария' : 'стадия шаблона ещё не наблюдалась';
      return (k ? '<span class="mp-sep" aria-hidden="true">→</span>' : '') + '<span class="mp-st' + (hit ? ' hit' : nx ? ' next' : '') + '" title="' + esc(tip) + '">' + (hit ? NX.icon('check', '', 12) : nx ? NX.icon('clock', '', 12) : '') + esc(stageLabel(id, s && s.label)) + (nx ? '<i>прогноз</i>' : '') + '</span>';
    }).join('');
    const lastQ = m.stages.slice().reverse().find((s) => s.quote);
    return '<div class="mp-box"><div class="row between wrap" style="gap:8px"><b class="small">Детектор манипуляций · UNDERSTAND + PREDICT</b><span class="reality work">работает в прототипе · локальная модель сценариев</span></div>' +
      '<div class="mp-meta mt-s">' + meta.join('') + '</div>' +
      (track ? '<div class="mp-track" aria-label="Стадии сценария атаки">' + track + '</div>' : '') +
      (lastQ ? '<div class="mp-quote">Последний признак в речи звонящего: «' + esc(lastQ.quote.slice(0, 180)) + '»</div>' : '') +
      (m.next && m.next.label ? '<div class="mp-next"><b>Прогноз следующего шага:</b> ' + esc(m.next.label) + (m.next.advice ? ' — ' + esc(m.next.advice) : '') + '</div>' : '') +
      '<p class="tiny muted mt-s">«Совпадение N из M» — доля стадий шаблона, а не вероятность мошенничества. Анализ речи — в браузере по согласию клиента; для обычных звонков нужна мобильная интеграция.</p></div>';
  }

  /* ---------- «Заблокировать всё» (bus emergency_shield от rescue.js) ---------- */
  const EM_ACTS = [['blockNewTransfers', 'Новые переводы заблокированы'], ['pauseRecipients', 'Добавление получателей приостановлено'], ['endSessions', 'Подозрительные сеансы завершены'], ['notify', 'Банк и доверенное лицо уведомлены']];
  const EM_BY = { guardian: 'подтверждено доверенным лицом', bank: 'подтверждено банком', demo: 'демо-кнопка', client: 'клиентом после подтверждения' };
  function handleEmergency(p) {
    const on = p.active !== false;
    const now = Date.now();
    if (on) {
      const client = str(p.client) || clientFromState();
      const at = Number(p.at) || now;
      const acts = p.actions && typeof p.actions === 'object' ? p.actions : {};
      // запрос клиента на снятие защиты (rescue.js requestRelease) — показываем аналитику, сам он защиту не снимает
      if (p.releaseRequested) {
        if (!B.em || !B.em.active) return;
        if (B.em.releaseAt) return;
        B.em.releaseAt = now; B.em.releaseGuardian = str(p.guardian);
        const rinc = B.incidents.find((i) => i.id === B.em.incidentId);
        if (rinc) rinc.chain.push({ t: 'Клиент просит снять «Заблокировать всё»' + (B.em.releaseGuardian ? ' · запрос доверенному лицу ' + B.em.releaseGuardian : ''), ts: now });
        saveB();
        logCycle('protect', '«Заблокировать всё»: ' + B.em.client + ' просит снять защиту', rinc ? { inc: rinc.id } : null);
        NX.toast('Запрос на снятие «Заблокировать всё»', B.em.client + ' просит снять защиту. Перед решением позвоните клиенту с официального номера', 'warn', 'shield');
        render(); renderLive();
        return;
      }
      if (B.em && B.em.active && B.em.at === at) return; // повтор того же события
      let inc = B.incidents.find((i) => i.kind === 'emergency' && i.status !== 'resolved' && i.status !== 'false_positive' && sameClient(i.client, client));
      const ctx = [];
      if (liveState.call && !liveState.call.ended) ctx.push('Во время активного звонка, распознанного Защитой звонка' + (liveState.call.score != null ? ' (индекс риска ' + liveState.call.score + ')' : ''));
      if (liveState.manip && liveState.manip.attackType && liveState.manip.attackType.label) ctx.push('Детектор манипуляций: ' + liveState.manip.attackType.label);
      if (!inc) {
        inc = { id: NX.uid('inc'), kind: 'emergency', ts: at, client, type: '«Заблокировать всё»', title: '«Заблокировать всё»: защита денег включена клиентом', score: null, amount: 0, account: '—', source: 'Кабинет клиента · «Заблокировать всё»', status: 'new', factors: ctx.slice(), chain: [], notes: [], fromClient: true };
        B.incidents.unshift(inc);
        if (B.incidents.length > 120) B.incidents.length = 120;
      } else ctx.forEach((x) => { if (inc.factors.indexOf(x) < 0) inc.factors.push(x); });
      inc.emActions = acts;
      inc.chain.push({ t: 'Клиент нажал «Защитить мои деньги» — «Заблокировать всё» включён', ts: at });
      EM_ACTS.forEach((a) => inc.chain.push({ t: (acts[a[0]] ? '' : 'Не выбрано клиентом: ') + a[1], ts: at }));
      B.em = { client, actions: acts, at, active: true, incidentId: inc.id };
      liveState.em = true;
      saveB();
      logCycle('protect', '«Заблокировать всё» включён: ' + client + ' — ' + EM_ACTS.filter((a) => acts[a[0]]).length + ' из 4 действий', { inc: inc.id });
      NX.toast('«Заблокировать всё»', client + ': защита денег включена · новые переводы приостановлены', 'high', 'shield');
    } else {
      if (!B.em) return;
      const by = str(p.by);
      B.em.active = false; B.em.offAt = now; B.em.by = by;
      const inc = B.incidents.find((i) => i.id === B.em.incidentId);
      if (inc) inc.chain.push({ t: '«Заблокировать всё» снят' + (EM_BY[by] ? ' — ' + EM_BY[by] : by ? ' — ' + by : ''), ts: now });
      liveState.em = true;
      saveB();
      logCycle('protect', '«Заблокировать всё» снят' + (EM_BY[by] ? ' — ' + EM_BY[by] : ''), inc ? { inc: inc.id } : null);
      NX.toast('«Заблокировать всё» снят', String(B.em.client || 'Клиент') + (EM_BY[by] ? ' · ' + EM_BY[by] : ''), 'info', 'shield');
    }
    render();
    renderLive();
  }
  // решение банка: снять «Заблокировать всё» клиента (rescue.js принимает {active:false, by:'bank'})
  function emRelease() {
    const e = B.em;
    if (!e || !e.active) return;
    NX.bus.emit('emergency_shield', { client: e.client, active: false, by: 'bank', at: Date.now() });
    handleEmergency({ client: e.client, active: false, by: 'bank' }); // своё сообщение onBus не обрабатывает (local)
  }
  function emHTML() {
    const e = B.em;
    if (!e || liveState.em === null) return '';
    if (!e.active && (!e.offAt || Date.now() - e.offAt > CONS_WINDOW)) return '';
    const acts = e.actions || {};
    return '<div class="live-banner mb ' + (e.active ? 'em-live' : 'em-off') + '"><div class="row between wrap"><div class="row gap-s">' + (e.active ? '<span class="dot pulse" style="background:var(--danger);color:var(--danger)"></span>' : '<span class="dot" style="background:var(--muted);color:var(--muted)"></span>') +
      '<b>' + (e.active ? 'LIVE · «Заблокировать всё» · ' + esc(e.client) + ': защита денег включена' : '«Заблокировать всё» клиента ' + esc(e.client) + ' снят' + (EM_BY[e.by] ? ' — ' + esc(EM_BY[e.by]) : '')) + '</b></div><div class="row gap-s"><span class="tiny muted">' + NX.hm(e.active ? e.at : e.offAt) + '</span>' + closeBtn('em') + '</div></div>' +
      '<div class="em-acts">' + EM_ACTS.map((a) => '<span class="em-act ' + (acts[a[0]] ? 'on' : 'off') + '">' + NX.icon(acts[a[0]] ? 'check' : 'x', '', 13) + esc(a[1]) + '</span>').join('') + '</div>' +
      '<p class="small mt-s">' + (e.active ? 'Защитный режим конституции включён. Снять «Заблокировать всё» можно только через подтверждение доверенного лица или банка.' : 'Обычный режим восстановлен.') + '</p>' +
      (e.active && e.releaseAt ? '<div class="notice warn mt-s small"><b>Клиент просит снять защиту</b> · ' + esc(NX.hm(e.releaseAt)) + (e.releaseGuardian ? ' · запрос доверенному лицу: ' + esc(e.releaseGuardian) : '') + ' · перед решением позвоните клиенту с официального номера: рядом не должно быть «сотрудника банка» на линии.</div>' : '') +
      '<div class="row wrap gap-s mt-s" style="align-items:center"><span class="grow"></span>' +
      (e.active ? '<button type="button" class="btn sm ghost" data-em-release="1">Снять защиту — решение банка</button>' : '') +
      (e.incidentId ?'<button type="button" class="btn sm" data-inc="' + esc(e.incidentId) + '">Открыть обращение</button>' : '') + '</div></div>';
  }

  /* ---------- Возврат денег (bus safe_return_case / safe_return_update) ---------- */
  const SR_ST = { registered: 'Инцидент зарегистрирован', sent: 'Информация передана в банк', checking: 'Операция проверяется', need_info: 'Запрошено дополнительное подтверждение', result: 'Результат рассмотрения' };
  const SR_ORDER = ['registered', 'sent', 'checking', 'need_info', 'result'];
  const SR_INC = { registered: 'new', sent: 'new', checking: 'progress', need_info: 'progress', result: 'resolved' };
  const SR_NOTE = {
    checking: 'аналитик сверяет хронологию, получателя и доказательства из заявления.',
    need_info: 'пришлите, пожалуйста, скриншот перевода и номер, с которого звонили.',
    result: 'рассмотрение завершено, решение и дальнейшие шаги направлены клиенту. Возврат средств не гарантирован и зависит от результата проверки.',
  };
  const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
  function normEvidence(ev) {
    const e = ev && typeof ev === 'object' ? ev : {};
    const list = (v) => arr(v).map((x) => (typeof x === 'string' ? x.trim() : x && typeof x === 'object' ? str(x.value || x.text || x.url || x.number || x.name) : str(x))).filter(Boolean).slice(0, 12);
    const files = arr(e.files).map((f) => (typeof f === 'string' ? { name: f, size: null } : f && typeof f === 'object' ? { name: str(f.name) || 'файл', size: Number(f.size) || null } : null)).filter(Boolean).slice(0, 10);
    const sms = arr(e.sms).map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? str(x.text) : '')).filter(Boolean).join('\n\n').slice(0, 2000);
    return { sms, links: list(e.links), phones: list(e.phones), files };
  }
  const fmtSize = (b) => (!b ? '' : b >= 1048576 ? String(Math.round(b / 104857.6) / 10).replace('.', ',') + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ');
  function srFactors(inc) {
    const f = [];
    const hit = iocForAccount(inc.account);
    if (hit) f.push('Получатель уже в стоп-листе: ' + stLabel(effSt(hit)) + ' · ' + srcText(hit));
    const ch = chainForAccount(inc.account);
    if (ch) f.push('Получатель — узел цепочки ' + ch.id + (ch.ringName ? ' (' + ch.ringName + ')' : ''));
    const ev = inc.evidence || {};
    ev.phones.concat(ev.links).forEach((x) => { const h = iocForAccount(x); if (h && f.length < 6) f.push('Из доказательств в стоп-листе: ' + dispIoc(h) + ' · ' + stLabel(effSt(h))); });
    if (!f.length) f.push('Совпадений со стоп-листом и цепочками пока нет — реквизиты из заявления можно внести на проверку');
    return f;
  }
  function handleSafeReturn(p) {
    const caseId = str(p.caseId); if (!caseId) return;
    const status = SR_ST[p.status] ? p.status : 'sent';
    let inc = B.incidents.find((i) => i.kind === 'safe_return' && i.caseId === caseId);
    const isNew = !inc;
    const amount = Math.max(0, Number(p.amount) || 0);
    if (!inc) {
      inc = { id: NX.uid('inc'), kind: 'safe_return', caseId, ts: Date.now(), client: str(p.client) || clientFromState(), type: 'Возврат денег · «Меня обманули»', title: '', score: null, amount, account: str(p.recipient) || '—', source: 'Кабинет клиента · Возврат денег', status: SR_INC[status], factors: [], chain: [], notes: [], fromClient: true, srStatus: status, srHist: [] };
      B.incidents.unshift(inc);
      if (B.incidents.length > 120) B.incidents.length = 120;
    }
    if (amount) inc.amount = amount;
    if (str(p.recipient)) inc.account = str(p.recipient);
    inc.title = 'Возврат денег: клиент сообщил о мошенничестве' + (inc.amount ? ' · ' + NX.fmt(inc.amount) : '') + (inc.account && inc.account !== '—' ? ' → ' + dispAcc(inc.account) : '');
    const tl = arr(p.timeline).map((x) => (x && typeof x === 'object' ? { t: str(x.t || x.text || x.title), ts: Number(x.ts) || null } : typeof x === 'string' ? { t: x, ts: null } : null)).filter((x) => x && x.t).slice(0, 40);
    if (tl.length) inc.chain = tl;
    if (p.evidence) inc.evidence = normEvidence(p.evidence);
    else if (!inc.evidence) inc.evidence = normEvidence(null);
    // статус от клиента не откатывает решение аналитика назад
    const cur = SR_ORDER.indexOf(inc.srStatus || 'registered');
    if (isNew || SR_ORDER.indexOf(status) > cur) {
      inc.srStatus = status;
      inc.status = SR_INC[status];
      inc.srHist.push({ ts: Date.now(), status, by: 'клиент', note: str(p.note) });
    }
    inc.factors = srFactors(inc);
    saveB();
    if (isNew) {
      logCycle('recover', 'Возврат денег: ' + inc.client + ' — «Меня обманули»' + (inc.amount ? ', ' + NX.fmt(inc.amount) : ''), { inc: inc.id });
      NX.toast('Возврат денег: новое обращение', inc.client + (inc.amount ? ' · ' + NX.fmt(inc.amount) : '') + ' · хронология и доказательства приложены', 'high', 'reset');
    } else logCycle('recover', 'Возврат денег ' + caseId + ': ' + SR_ST[inc.srStatus], { inc: inc.id });
    render();
    if (modalRefresh && NX.isModalOpen()) modalRefresh();
  }
  function srUpdate(inc, status, noteText) {
    if (!inc || inc.kind !== 'safe_return' || !SR_ST[status]) return;
    const note = noteText || SR_NOTE[status] || SR_ST[status];
    inc.srStatus = status;
    inc.srHist = inc.srHist || [];
    inc.srHist.push({ ts: Date.now(), status, by: signer(), note });
    inc.status = SR_INC[status];
    inc.notes = inc.notes || [];
    inc.notes.push({ ts: Date.now(), t: SR_ST[status] + ': ' + note, by: signer() });
    audit('incident_status', 'inc:' + inc.id, inc.title, SR_ST[status], { dup: true });
    NX.bus.emit('safe_return_update', { caseId: inc.caseId, status, note: noteText || SR_ST[status] + ': ' + note });
    saveB();
    logCycle('recover', 'Возврат денег ' + inc.caseId + ': ' + SR_ST[status] + ' (аналитик)', { inc: inc.id });
    NX.toast('Статус отправлен клиенту', SR_ST[status], 'ok', 'send');
    render();
  }
  // RECOVER → INVESTIGATE: реквизиты из заявления пострадавшего попадают в стоп-лист «на проверке» —
  // следующий клиент, который захочет перевести на них деньги, получит усиленную проверку
  function srToStopList(inc) {
    const ev = inc.evidence || normEvidence(null);
    const text = [inc.account && inc.account !== '—' ? inc.account : ''].concat(ev.phones, ev.links).filter(Boolean).join('\n');
    let items = [];
    try { items = NX.extractIocs(text) || []; } catch (e) { items = []; }
    if (!items.length) { const p = safeParse(inc.account); if (p && p.value) items = [{ kind: p.kind, value: p.value, raw: inc.account }]; }
    if (!items.length) { NX.toast('Нет реквизитов', 'В заявлении нет счёта, номера или ссылки для стоп-листа', 'info', 'info'); return; }
    let fresh = [];
    try { fresh = NX.iocs.add(items, 'Возврат денег · заявление клиента', { session: 'sr:' + inc.caseId, client: inc.client }) || []; } catch (e) { fresh = []; }
    const seen = fresh.seen || [];
    if (fresh.length) handleIocs({ items: fresh, source: 'Возврат денег · заявление клиента', client: inc.client, t0: Date.now() });
    if (seen.length) handleSeen({ items: seen, source: 'Возврат денег · заявление клиента' });
    inc.notes = inc.notes || [];
    inc.notes.push({ ts: Date.now(), t: 'Реквизиты из заявления внесены в стоп-лист: новых — ' + fresh.length + ', уже были — ' + seen.length, by: signer() });
    inc.factors = srFactors(inc);
    saveB();
    if (!fresh.length && !seen.length) NX.toast('Стоп-лист не изменился', 'Реквизиты из заявления сняты аналитиком ранее или не распознаны', 'info', 'info');
  }
  function srHTML(i) {
    const ev = i.evidence || normEvidence(null);
    const cur = SR_ORDER.indexOf(i.srStatus || 'registered');
    const steps = SR_ORDER.map((s, k) => '<span class="sr-st' + (k < cur ? ' done' : k === cur ? ' cur' : '') + '">' + esc(SR_ST[s]) + '</span>').join('');
    const evRows = [];
    if (ev.sms) evRows.push('<dt>SMS / сообщения</dt><dd><div class="sr-sms">' + esc(ev.sms) + '</div></dd>');
    if (ev.links.length) evRows.push('<dt>Ссылки</dt><dd class="mono small">' + ev.links.map((x) => esc(x)).join('<br>') + '</dd>');
    if (ev.phones.length) evRows.push('<dt>Номера</dt><dd class="mono small">' + ev.phones.map((x) => esc(x)).join('<br>') + '</dd>');
    if (ev.files.length) evRows.push('<dt>Файлы</dt><dd class="small">' + ev.files.map((f) => esc(f.name) + (f.size ? ' <span class="muted">· ' + esc(fmtSize(f.size)) + '</span>' : '')).join('<br>') + '<div class="tiny muted">хранятся на устройстве клиента; в банк передаются имя и размер</div></dd>');
    const hist = (i.srHist || []).slice().reverse().slice(0, 6).map((h) => '<div class="li"><span class="mono tiny muted">' + NX.time(h.ts) + '</span><div class="grow"><div class="small" style="white-space:normal">' + esc(SR_ST[h.status] || h.status) + (h.note ? ' — ' + esc(h.note) : '') + '</div><div class="tiny muted">' + esc(h.by || '') + '</div></div></div>').join('');
    return '<h4 class="mt mb" style="font-size:13px">' + NX.icon('reset', '', 16) + ' Возврат денег · статус обращения</h4><div class="sr-steps">' + steps + '</div>' +
      '<p class="tiny muted mt-s">Возврат денег помогает быстро запустить процедуру: фиксация, хронология, доказательства и заявление. Возврат денег не гарантируется — решение принимается по результату проверки. Обращение по спорной операции в продукте требует интеграции с API банка.</p>' +
      '<h4 class="mt mb" style="font-size:13px">Доказательства · сводка</h4>' + (evRows.length ? '<dl class="sr-ev">' + evRows.join('') + '</dl>' : '<p class="small muted">Клиент не приложил доказательств — их можно запросить кнопкой «Запросить подтверждение».</p>') +
      (hist ? '<h4 class="mt mb" style="font-size:13px">История статусов</h4><div class="list">' + hist + '</div>' : '');
  }
  function emIncHTML(i) {
    const acts = i.emActions || {};
    const on = B.em && B.em.incidentId === i.id ? B.em : null;
    return '<h4 class="mt mb" style="font-size:13px">' + NX.icon('shield', '', 16) + ' «Заблокировать всё» · выбранные клиентом действия</h4><div class="em-acts">' + EM_ACTS.map((a) => '<span class="em-act ' + (acts[a[0]] ? 'on' : 'off') + '">' + NX.icon(acts[a[0]] ? 'check' : 'x', '', 13) + esc(a[1]) + '</span>').join('') + '</div>' +
      '<p class="small mt-s">' + (on && on.active ? 'Сейчас защита активна. Снять её можно только через подтверждение доверенного лица или банка — после контрольного звонка клиенту с официального номера.' : on ? 'Защита снята' + (EM_BY[on.by] ? ' — ' + esc(EM_BY[on.by]) : '') + '.' : 'Статус защиты — в кабинете клиента.') + '</p>' +
      '<div class="row wrap gap-s mt-s"><span class="reality sim">в прототипе — симуляция</span><span class="reality api">блокировка переводов и сессий — требует интеграции с API банка</span></div>';
  }
  function kindSummaryHTML(i) {
    if (i.kind === 'safe_return') return '<div class="notice"><b>' + esc(SR_ST[i.srStatus] || 'Обращение') + '</b><br>Кейс ' + esc(i.caseId || '') + ' · клиент сообщил о мошенничестве сам. Индекса риска у обращения нет.</div>';
    if (i.kind === 'emergency') return '<div class="notice warn"><b>Клиент сам включил защиту</b><br>«Заблокировать всё» — решение клиента в моменте опасности. Индекса риска у обращения нет.</div>';
    if (isLeakKind(i) && LR()) { try { return LR().bankIncidentSummary(i); } catch (e) { console.error(e); } }
    if (i.kind === 'sd_dispute' && SD()) { try { return SD().bankIncidentSummary(i); } catch (e) { console.error(e); } }
    if (i.kind === 'mule_exit' && MX()) { try { return MX().bankIncidentSummary(i); } catch (e) { console.error(e); } }
    if (i.kind === 'credit_lock' && CL()) { try { return CL().bankIncidentSummary(i); } catch (e) { console.error(e); } }
    return '';
  }
  function incExtraHTML(i) {
    let h = '';
    if (isLeakKind(i) && LR()) { try { h += LR().bankIncidentHTML(i); } catch (e) { console.error(e); } }
    if (i.kind === 'sd_dispute' && SD()) { try { h += SD().bankIncidentHTML(i); } catch (e) { console.error(e); } }
    if (i.kind === 'mule_exit' && MX()) { try { h += MX().bankIncidentHTML(i); } catch (e) { console.error(e); } }
    if (i.kind === 'credit_lock' && CL()) { try { h += CL().bankIncidentHTML(i); } catch (e) { console.error(e); } }
    if (i.kind === 'safe_return') h += srHTML(i);
    if (i.kind === 'emergency') h += emIncHTML(i);
    // сравнение с обычным переводом клиента — в «Подробнее» окна инцидента (openIncident)
    if (i.tcId) h += tcInlineHTML(i.tcId);
    const ch = chainForAccount(i.account);
    if (ch) h += '<div class="notice mt">Получатель — узел цепочки <b>' + esc(ch.id) + '</b>' + (ch.ringName ? ' (' + esc(ch.ringName) + ')' : '') + ': ' + esc(cnt(ch.hops, ['переход', 'перехода', 'переходов'])) + ' до обнала' + (ch.minutesToCashout != null ? ', около ' + ch.minutesToCashout + ' мин' : '') + '. <button type="button" class="btn sm" data-show-chain="' + esc(i.account) + '" style="margin-left:6px">Показать цепочку</button></div>';
    return h;
  }
  const BANK_CALL_TTL = 600; // с: сколько живёт отметка «звонит банк» в приложении клиента
  // кнопка шага «обратный звонок»: пока отметка жива — «Завершить звонок»; TTL считается и в приложении клиента
  // пояснение к отметке «звонит банк» — подсказкой на кнопке, а не сноской
  const BANK_CALL_TIP = '«Позвонить клиенту с официального номера» — симуляция: в продукте отметка приходит с сервера банка в приложение, номер звонящего не учитывается. Отметка видна только в приложении клиента; если звонящий сам ссылается на «отметку», NEXUS считает это признаком манипуляции. Даже при отметке просьба кода или перевода поднимает тревогу.';
  function bankCallBtn(i, b) {
    const live = i.bankCall && i.bankCall.until > Date.now();
    return live ? b('iBankCallEnd', 'Завершить звонок · снять отметку (до ' + NX.time(i.bankCall.until) + ')', '', 'phone', false, BANK_CALL_TIP)
      : b('iBankCall', 'Позвонить клиенту с официального номера', '', 'phone', false, BANK_CALL_TIP);
  }
  // стандартный подвал: primary · secondary · ghost + «Ещё ▾»; id кнопок прежние (обработчики в openIncident, #iBankCall читает сцена)
  function incActions(i, hasAcc) {
    const b = (id, label, cls, icon, dis, tip) => '<button type="button" class="btn' + (cls ? ' ' + cls : '') + '" id="' + id + '"' + (dis ? ' disabled' : '') + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + (icon ? NX.icon(icon) : '') + esc(label) + '</button>';
    const m = (id, label, icon, dis) => b(id, label, 'ghost sm bm-mi', icon, dis);
    const prog = (asMenu) => (asMenu ? m : (id, l, ic, dis) => b(id, l, '', ic, dis))('iProg', 'Взять в работу', 'folder', i.status === 'progress');
    const fp = b('iFp', 'Ложное срабатывание', 'ghost', '', i.status === 'false_positive');
    const call = bankCallBtn(i, b);
    if (isLeakKind(i)) {
      const primary = b('iFraud', i.kind === 'leak_merchant' ? 'Подтвердить компрометацию' : 'Подтвердить утечку', 'primary', 'lock', i.status === 'resolved');
      // инцидент по магазину объединяет нескольких клиентов — звонка «одному клиенту» у него нет
      return i.kind === 'leak_merchant' ? { primary, secondary: prog(false), ghost: fp, more: [] } : { primary, secondary: call, ghost: fp, more: [prog(true)] };
    }
    // спор по безопасной сделке: решение по конверту — кнопками в карточке сделки (safe-deal.js)
    // «Не стань дропом»: клиент сообщил сам; «Подтвердить: вербовка» — куратору hold 72 ч и реквизит на подтверждение
    if (i.kind === 'mule_exit') return { primary: b('iFraud', 'Подтвердить: вербовка', 'primary', 'lock', i.status === 'resolved', 'Счёт куратора — hold 72 ч, реквизит — на подтверждение в стоп-лист'), secondary: b('iContact', 'Связаться с клиентом', '', 'phone'), ghost: fp, more: [prog(true)] };
    // «Кредитный замок»: клиент ответил «Нет, это не я»; подтверждение — счёт выдачи на hold 72 ч и реквизит на подтверждение
    if (i.kind === 'credit_lock') return { primary: b('iFraud', 'Подтвердить: заём на чужое имя', 'primary', 'lock', i.status === 'resolved', 'Счёт выдачи — hold 72 ч, реквизит — на подтверждение в стоп-лист'), secondary: call, ghost: fp, more: [prog(true), b('iContact', 'Сообщение в кабинет клиента', 'ghost sm bm-mi', 'chat')] };
    if (i.kind === 'sd_dispute') return { primary: b('iFraud', 'Подтвердить мошенничество продавца', 'primary', 'lock', !hasAcc, 'Счёт продавца — hold 72 ч'), secondary: call, ghost: fp, more: [prog(true)] };
    if (i.kind === 'safe_return') {
      const cur = i.srStatus || 'registered';
      return {
        primary: b('srResult', 'Результат рассмотрения', 'primary', 'check', cur === 'result'), secondary: call,
        ghost: b('srNeed', 'Запросить подтверждение', 'ghost', '', cur === 'need_info'),
        more: [m('srChecking', 'Операция проверяется', 'search', cur === 'checking'), m('srIoc', 'Реквизиты из заявления — в стоп-лист', 'dna'), m('iStr', 'Сообщение в АФМ (черновик)', 'folder')],
      };
    }
    if (i.kind === 'emergency') return { primary: b('emDone', 'Закрыть обращение', 'primary', 'check', i.status === 'resolved'), secondary: call, ghost: b('iProg', 'Взять в работу', 'ghost', '', i.status === 'progress'), more: [] };
    return {
      primary: b('iFraud', 'Подтвердить фрод', 'primary', 'lock', i.status === 'resolved', hasAcc ? 'Получатель — hold 72 ч, реквизит — на подтверждение в стоп-лист' : ''),
      secondary: call, ghost: fp,
      more: [prog(true), m('iStr', 'Сообщение в АФМ (черновик)', 'folder'), m('iAfc', 'Реквизит в АФЦ (симуляция)', 'send', !hasAcc)],
    };
  }

  /* ---------- Trust Circle: запрос доверенному лицу без реквизитов ---------- */
  const TC_ST = { pending: ['ожидает ответа', 'warn'], hold: ['«Нужна проверка — удержать»', 'high'], ok: ['«Всё в порядке — я рядом»', 'ok'] };
  function approxAmount(a) {
    const n = Number(a) || 0;
    if (!n) return '';
    if (n >= 1000000) return '≈ ' + String(Math.round(n / 100000) / 10).replace('.', ',') + ' млн ₸';
    if (n >= 100000) return '≈ ' + Math.round(n / 10000) * 10 + ' тыс ₸';
    return '≈ ' + Math.max(1, Math.round(n / 1000)) + ' тыс ₸';
  }
  function tcAdd(o) {
    const g = guardianOf(o.guardian) || { name: 'Доверенное лицо', relation: '' };
    const id = str(o.id) || NX.uid('tc');
    const ex = B.tc.find((x) => x.id === id);
    if (ex) return ex;
    let client = str(o.client) || 'Клиент';
    if (/Айгерим/i.test(g.name) && client === 'Клиент') client = 'Гульнара-апа, 63';
    const amountText = approxAmount(o.amount);
    const who = client.split(',')[0];
    const call = o.call !== false && (o.source === 'second_client' || (liveState.call && !liveState.call.ended) || /звон/i.test(str(o.reason)));
    const msg = 'Клиент ' + who + (call ? ' разговаривает с предполагаемым мошенником' + (amountText ? ' и' : '') : '') + (amountText ? ' пытается отправить ' + amountText + ' новому получателю.' : call ? '. Нужна проверка ситуации.' : ': нужна проверка ситуации — ' + (str(o.reason) || 'операция под давлением') + '.');
    const e = { id, ts: Date.now(), client, guardian: g, amount: Number(o.amount) || 0, amountText, msg, reason: str(o.reason), status: 'pending', source: o.source || 'client', incId: o.incId || null };
    B.tc.unshift(e);
    if (B.tc.length > 30) B.tc.length = 30;
    if (current === 'overview') renderTc();
    return e;
  }
  function tcResolve(id, verdict, by) {
    const e = B.tc.find((x) => x.id === id);
    if (!e || e.status !== 'pending') return e || null;
    e.status = verdict === 'hold' ? 'hold' : 'ok';
    e.rts = Date.now(); e.by = by || '';
    if (e.incId) {
      const inc = B.incidents.find((i) => i.id === e.incId);
      if (inc) {
        inc.chain = inc.chain || [];
        inc.chain.push({ t: 'Близкие: ' + gName(e.guardian) + ' — ' + TC_ST[e.status][0], ts: e.rts });
        inc.notes = inc.notes || [];
        inc.notes.push({ ts: e.rts, t: e.status === 'hold' ? gName(e.guardian) + ' просит удержать: перевод остаётся удержанным, аналитик звонит клиенту с официального номера' : gName(e.guardian) + ' рядом с клиентом. Удержание автоматически не снимается: реквизит получателя в стоп-листе, нужен контрольный звонок клиенту', by: by === 'demo' ? 'Trust Circle · ответ в демо' : 'Trust Circle' });
      }
    }
    if (liveState.hold && liveState.hold.tcId === id) renderLive();
    return e;
  }
  function tcRespond(id, verdict) {
    const e = id ? B.tc.find((x) => x.id === id) : B.tc.find((x) => x.source === 'second_client' && x.status === 'pending');
    if (!e) return { ok: false, reason: 'no_request' };
    if (e.status !== 'pending') return { ok: false, reason: 'already', status: e.status };
    tcResolve(e.id, verdict === 'ok' || verdict === 'approve' ? 'ok' : 'hold', 'demo');
    NX.bus.emit('trust_circle_response', { id: e.id, verdict: e.status, by: 'demo', client: e.client, incidentId: e.incId });
    saveB();
    logCycle('protect', 'Близкие: ' + gName(e.guardian) + ' — ' + TC_ST[e.status][0], e.incId ? { inc: e.incId } : null);
    NX.toast('Близкие', gName(e.guardian) + ': ' + TC_ST[e.status][0], e.status === 'hold' ? 'high' : 'ok', 'users');
    render();
    renderLive();
    if (modalRefresh && NX.isModalOpen()) modalRefresh();
    return { ok: true, id: e.id, status: e.status };
  }
  function tcRowHTML(e, withBtns) {
    const st = TC_ST[e.status] || TC_ST.pending;
    const demo = e.source === 'second_client' && e.status === 'pending';
    return '<div class="tc-row ' + (e.status === 'pending' ? '' : e.status) + '"><div class="ic">' + NX.icon('users', '', 18) + '</div><div class="grow">' +
      '<div class="small"><b>' + esc(gName(e.guardian)) + '</b> <span class="muted">· доверенное лицо клиента ' + esc(e.client) + '</span></div>' +
      '<div class="tc-msg mt-s"><q>' + esc(e.msg) + '</q></div>' +
      '<div class="row wrap gap-s mt-s"><span class="badge ' + st[1] + '">' + esc(st[0]) + '</span><span class="tiny muted">' + esc(NX.ago(e.rts || e.ts)) + (e.by === 'demo' ? ' · ответ в демо' : '') + '</span>' + (e.incId ? '<button type="button" class="btn sm ghost" data-inc="' + esc(e.incId) + '">Инцидент</button>' : '') + '</div>' +
      (demo && withBtns !== false ? '<div class="row wrap gap-s mt-s"><span class="tiny muted">Ответ ' + esc(e.guardian.name) + ' (демо):</span><button type="button" class="btn sm danger" data-tc="' + esc(e.id) + '" data-tc-v="hold">Нужна проверка — удержать</button><button type="button" class="btn sm ok" data-tc="' + esc(e.id) + '" data-tc-v="ok">Всё в порядке — я рядом</button></div>' : '') +
      '</div></div>';
  }
  function tcInlineHTML(id) {
    const e = B.tc.find((x) => x.id === id);
    if (!e) return '';
    return '<div class="mt-s" style="border-top:1px solid var(--line);padding-top:6px"><div class="tiny muted">«Близкие» · доверенное лицо видит только это сообщение: без реквизитов и без доступа к деньгам</div>' + tcRowHTML(e) + '</div>';
  }
  let tcHtml = '';
  function renderTc() {
    const box = $('#tcPanel'); if (!box) return;
    const html = (B.tc.length ? '<div>' + B.tc.slice(0, 4).map((e) => tcRowHTML(e)).join('') + '</div>' : '<p class="small muted">Запросов пока нет. Когда клиент с подключённым доверенным лицом попытается перевести деньги под давлением, доверенное лицо получит запрос на проверку.</p>') +
      '<p class="tiny muted mt-s">Доверенное лицо не видит реквизитов (сумма округлена, получатель — «новый получатель») и не распоряжается деньгами: оно подтверждает «нужна проверка» или «всё в порядке».</p>';
    if (html === tcHtml && box.firstChild) return;
    tcHtml = html; box.innerHTML = html;
  }

  /* ---------- Transaction DNA в инцидентах и удержаниях ---------- */
  const DNA_TIER = { normal: 'обычная операция', check: 'дополнительная проверка', cooling: 'период охлаждения', hold: 'удержание и проверка банком' };
  function dnaOf(x) {
    const d = x && (x.dna || x.transactionDna);
    return d && typeof d === 'object' && (d.index != null || Array.isArray(d.factors)) ? d : null;
  }
  function dnaTier(d) {
    if (d && DNA_TIER[d.tier]) return d.tier;
    const n = Math.round(Number(d && d.index) || 0);
    return n >= 80 ? 'hold' : n >= 60 ? 'cooling' : n >= 30 ? 'check' : 'normal';
  }
  const dnaTierLabel = (d) => str(d && d.tierLabel) || DNA_TIER[dnaTier(d)];
  const dnaExplain = (d) => (Array.isArray(d && d.explain) ? d.explain.map(str).filter(Boolean).join(' ') : str(d && d.explain));
  function dnaHTML(d) {
    const idx = NX.clamp(Math.round(Number(d.index) || 0), 0, 100);
    const tier = dnaTier(d);
    const cls = { hold: 'high', cooling: 'warn', check: 'warn', normal: 'ok' }[tier];
    const fs = (Array.isArray(d.factors) ? d.factors : []).filter((f) => f && typeof f === 'object');
    const rows = fs.map((f) => '<div class="fl">' + esc(str(f.label) || str(f.key)) + (str(f.detail) ? '<span>' + esc(str(f.detail)) + '</span>' : '') + '</div><div class="fp">' + (Number(f.points) ? '+' + Math.round(Number(f.points)) : '') + '</div>').join('');
    const ex = dnaExplain(d);
    const prof = str(d.profileSummary) || (d.profile && typeof d.profile === 'object' ? str(d.profile.summary) : str(d.profile));
    return '<div class="dna-box"><div class="dna-top">' + NX.icon('dna', '', 20) + '<b>Обычный перевод клиента</b><span class="dna-idx">' + idx + ' <small>индекс риска 0–100</small></span><span class="badge ' + cls + '">' + esc(dnaTierLabel(d)) + '</span></div>' +
      (prof ? '<div class="tiny muted mt-s">Профиль клиента: ' + esc(prof) + '</div>' : '') +
      (rows ? '<div class="dna-f">' + rows + '</div>' : '') +
      (ex ? '<div class="dna-explain"><b>Почему именно сейчас:</b> ' + esc(ex) + '</div>' : '') +
      '<p class="tiny muted mt-s">Итог — не сумма баллов: факторы объединяются с учётом пересечений, сочетание «звонок + новый получатель + крупная сумма» усиливает индекс. У клиента всегда есть безопасный путь подтвердить легитимную операцию: контрольный вопрос, охлаждение, доверенное лицо.</p></div>';
  }

  /* ---------- Scam Chain: цепочки счетов и распространение риска ---------- */
  let chainSel = null; // id стартового узла выбранной цепочки
  function chainsNow() {
    if (!NX.Graph || typeof NX.Graph.chains !== 'function' || !NX.Graph.detected) return [];
    try { return NX.Graph.chains(); } catch (e) { console.error(e); return []; }
  }
  function chainForAccount(acc) {
    if (!NX.Graph || !acc || acc === '—' || !NX.Graph.detected) return null;
    const n = NX.Graph.byAccount(acc);
    if (!n) return null;
    return chainsNow().find((c) => c.path.indexOf(n) >= 0) || null;
  }
  function chainConfirmed(ch) {
    const ns = ch.path;
    if (ns.some((n) => n.iocValue && n.iocStatus === 'confirmed')) return { level: 'confirmed', label: 'подтверждён аналитиком', cls: 'high' };
    if (ns.some((n) => n.iocValue && n.iocStatus === 'corroborated')) return { level: 'corroborated', label: 'подтверждён корреляцией', cls: 'high' };
    if (ns.some((n) => n.knownDrop)) return { level: 'known', label: 'счета из базы дропов банка', cls: 'high' };
    return { level: 'suspected', label: 'на проверке', cls: 'warn' };
  }
  const LINK_W = { device: 0.45, from_chain: 0.3, to_chain: 0.22 };
  function propagate(ch) {
    if (!ch || !NX.Graph || typeof NX.Graph.linked !== 'function') return [];
    const conf = chainConfirmed(ch);
    const mult = conf.level === 'suspected' ? 0.6 : 1;
    return NX.Graph.linked(ch).map((l) => {
      const n = l.node;
      const base = NX.clamp(Math.round(n.risk || 5), 1, 29);
      let keep = 1 - base / 100;
      l.via.forEach((v) => { let w = LINK_W[v.type] || 0.15; if ((v.count || 1) >= 2) w += 0.08 * Math.min(2, v.count - 1); keep *= 1 - w * mult; });
      const raised = Math.min(74, Math.round((1 - keep) * 100)); // ниже порога удержания: связь ≠ вина
      const rv = B.chainRev[accKey(n.account)] || null;
      const why = l.via.map((v) => v.type === 'device' ? 'общее устройство ' + v.device + ' со счётом «' + v.with.label + '»'
        : v.type === 'from_chain' ? 'получал переводы со счёта «' + v.with.label + '» · ' + NX.fmt(v.amount) + ((v.count || 1) > 1 ? ' × ' + v.count : '')
        : 'переводил на счёт «' + v.with.label + '» · ' + NX.fmt(v.amount));
      const status = rv ? rv.status : 'raised';
      return { node: n, label: n.label, account: NX.Graph.disp(n), key: accKey(n.account), base, raised, index: status === 'cleared' ? base : raised, why, status, review: rv };
    }).sort((a, b) => b.raised - a.raised);
  }
  function highlightChain(ch) {
    if (!ch || !NX.Graph) return;
    NX.Graph.setHighlight({ seed: ch.start, nodes: ch.path.slice(), path: { nodes: ch.path.slice(), edges: ch.edges.slice() } });
  }
  const PROP_ST = { raised: ['риск повышен', 'warn'], review: ['на проверке аналитиком', 'info'], cleared: ['подозрение снято', 'ok'] };
  function chainNodeHTML(x, sel) {
    const n = x.node;
    const badges = [];
    if (n.iocValue) badges.push(stChip(n.iocStatus || 'suspected'));
    if (n.blocked) badges.push('<span class="badge high">hold</span>');
    if (n.knownDrop) badges.push('<span class="tag">база дропов</span>');
    if (n.device) badges.push('<span class="tag">' + esc(n.device) + '</span>');
    const dw = n.role === 'cashout' ? 'конечная точка: вывод из системы' : x.dwellMin != null ? 'на счёте ' + x.dwellMin + ' мин до перевода дальше' : 'время на счёте неизвестно';
    return '<button type="button" class="ch-node r-' + esc(n.role) + (sel ? ' sel' : '') + '" data-chain-node="' + esc(n.id) + '" aria-label="' + esc(x.step + ': ' + n.label + ' — показать в графе') + '"><span class="ch-step">' + esc(x.step) + '</span><span class="ch-name">' + esc(n.label) + '</span><span class="ch-acc">' + esc(NX.Graph.disp(n)) + '</span><span class="ch-sum">' + NX.fmt(x.amountIn) + '</span>' + (x.amountOther ? '<span class="ch-dw">из них ' + esc(NX.fmt(x.amountPath)) + ' по этой цепочке, ещё ' + esc(NX.fmt(x.amountOther)) + ' с других счетов схемы</span>' : '') + '<span class="ch-dw">' + esc(dw) + '</span>' + (badges.length ? '<span class="ch-badges">' + badges.join('') + '</span>' : '') + '</button>';
  }
  function chainArrowHTML(amount, time, syn) {
    return '<div class="ch-arrow" aria-hidden="true"><span class="am">' + NX.fmt(amount) + '</span><span class="ln' + (syn ? ' syn' : '') + '"></span><span class="tm' + (time ? '' : ' muted') + '">' + esc(time || '—') + '</span></div>';
  }
  let chainHtml = '';
  function renderChainPanel() {
    const box = $('#chainPanel'); if (!box) return;
    const head = (extra) => '<div class="ch-head"><div style="min-width:0;flex:1 1 320px"><h3>Путь денег</h3><div class="small muted mt-s">Пострадавшие → первый дроп (много входящих) → транзитные счета → обнал. Куда деньги уйдут дальше и какие счета связаны со схемой.</div></div><div class="row gap-s wrap">' + (extra || '') + '</div></div>';
    if (!NX.Graph) { box.innerHTML = head() + '<p class="small muted mt">Граф связей недоступен.</p>'; chainHtml = ''; return; }
    if (!NX.Graph.detected) {
      const html = head() + '<p class="small muted mt">Нажмите «Найти схемы» над графом: NEXUS ищет веерные поступления, быстрое перемещение денег (минуты между входом и выходом), повторяющиеся связи и общие устройства.</p>';
      if (html !== chainHtml) { box.innerHTML = html; chainHtml = html; }
      return;
    }
    const list = chainsNow();
    if (!list.length) { const html = head() + '<p class="small muted mt">Цепочек не найдено.</p>'; if (html !== chainHtml) { box.innerHTML = html; chainHtml = html; } return; }
    let ch = list.find((c) => c.start.id === chainSel) || list[0];
    chainSel = ch.start.id;
    const conf = chainConfirmed(ch);
    const tabs = '<div class="ch-tabs" role="tablist" aria-label="Обнаруженные цепочки">' + list.map((c) => '<button type="button" role="tab" class="ch-tab' + (c === ch ? ' active' : '') + '" aria-selected="' + (c === ch) + '" data-chain="' + esc(c.start.id) + '">' + esc(c.id) + ' · ' + esc(c.start.label) + ' · ' + esc(cnt(c.hops, ['переход', 'перехода', 'переходов'])) + '</button>').join('') + '</div>';
    // путь: жертвы → узлы
    const vSum = ch.victimEdges.reduce((a, e) => a + e.amount, 0);
    const vNames = ch.victims.slice(0, 2).map((v) => v.label).join(', ') + (ch.victims.length > 2 ? ' и ещё ' + (ch.victims.length - 2) : '');
    const heldSum = (ch.heldEdges || []).reduce((a, e) => a + e.amount, 0);
    let path = '<div class="ch-node r-victim" role="group" aria-label="Жертвы"><span class="ch-step">Жертвы</span><span class="ch-name">' + esc(cnt(ch.victims.length, F.victim)) + '</span><span class="ch-acc">' + esc(vNames || '—') + '</span><span class="ch-sum">' + NX.fmt(vSum) + '</span><span class="ch-dw">' + (ch.lastIn ? 'последний приём в ' + NX.hm(ch.lastIn) : 'время приёма неизвестно') + '</span>' + (heldSum ? '<span class="ch-badges"><span class="badge ok">удержано до списания: ' + NX.fmt(heldSum) + '</span></span>' : '') + (ch.syntheticAmount ? '<span class="ch-badges"><span class="tag">синтет. история</span></span>' : '') + '</div>';
    ch.nodes.forEach((x, k) => {
      const prev = k === 0 ? null : ch.nodes[k - 1];
      const syn = k === 0 ? ch.victimEdges.some((e) => e.synthetic) : !!(x.inEdge && x.inEdge.synthetic);
      const time = k === 0 ? (ch.lastIn ? 'вход ' + NX.hm(ch.lastIn) : '') : prev && prev.dwellMin != null ? 'через ' + prev.dwellMin + ' мин' : '';
      path += chainArrowHTML(k === 0 ? vSum : x.inEdge.amount, time, syn) + chainNodeHTML(x, NX.Graph.selected === x.node);
    });
    const sig = [];
    sig.push('<span class="ch-chip' + (ch.senders >= 3 ? ' hot' : '') + '">' + NX.icon('users', '', 14) + 'Веерные поступления: ' + esc(cnt(ch.senders, F.sender)) + ' на один счёт</span>');
    const fast = ch.nodes.filter((x) => x.dwellMin != null && x.dwellMin <= 30).length;
    sig.push('<span class="ch-chip' + (fast ? ' hot' : '') + '">' + NX.icon('clock', '', 14) + 'Быстрое перемещение: ' + (ch.minutesToCashout != null ? ch.minutesToCashout + ' мин от последнего приёма до обнала' : 'время не определено') + '</span>');
    if (ch.repeated) sig.push('<span class="ch-chip">' + NX.icon('reset', '', 14) + 'Повторяющиеся связи: ' + ch.repeated + '</span>');
    ch.shared.forEach((s) => sig.push('<span class="ch-chip hot">' + NX.icon('devices', '', 14) + 'Общее устройство ' + esc(s.device) + ': ' + esc(s.nodes.map((n) => n.label).join(', ')) + '</span>'));
    if (ch.synthetic) sig.push('<span class="ch-chip">' + NX.icon('info', '', 14) + 'Часть рёбер — синтетическая история реквизита из разведки</span>');
    const kpis = '<div class="ch-sum-row"><div class="ch-kpi"><div class="l">Переходов до обнала</div><div class="v">' + ch.hops + (ch.reachesCashout ? '' : ' <span class="tiny muted">обнал не найден</span>') + '</div></div><div class="ch-kpi"><div class="l">От приёма до обнала</div><div class="v">' + (ch.minutesToCashout != null ? ch.minutesToCashout + ' мин' : '—') + '</div></div><div class="ch-kpi"><div class="l">Вход цепочки</div><div class="v">' + NX.fmt(ch.amount + ch.syntheticAmount) + '</div></div><div class="ch-kpi"><div class="l">Статус схемы</div><div class="v" style="font-size:13px;font-family:var(--font)"><span class="badge ' + conf.cls + '">' + esc(conf.label) + '</span></div></div></div>';
    // распространение риска
    const prop = propagate(ch);
    const propHTML = '<div class="prop"><div class="prop-h"><b>Распространение риска на связанные счета</b><span class="row gap-s wrap"><span class="nguilt">' + NX.icon('info', '', 12) + 'связь ≠ вина</span><button type="button" class="btn sm ghost" data-chain-log="1">Журнал проверок</button></span></div>' +
      '<p class="small muted mt-s">Счёт, связанный с подтверждённой схемой, получает повышенный индекс риска ещё до жалоб новых жертв: его следующие операции проходят усиленную проверку. Это не блокировка и не обвинение — решение принимает аналитик.</p>' +
      (prop.length ? prop.map((p) => {
        const st = PROP_ST[p.status] || PROP_ST.raised;
        const btns = p.status === 'raised'
          ? '<button type="button" class="btn sm" data-prop-check="' + esc(p.key) + '">' + NX.icon('search') + 'Проверить</button><button type="button" class="btn sm ok" data-prop-clear="' + esc(p.key) + '">Снять подозрение</button>'
          : p.status === 'review'
            ? '<button type="button" class="btn sm ok" data-prop-clear="' + esc(p.key) + '">Снять подозрение</button><button type="button" class="btn sm danger" data-hold="' + esc(p.node.id) + '"' + (p.node.blocked ? ' disabled' : '') + '>' + NX.icon('lock') + (p.node.blocked ? 'hold' : 'Hold 72 ч') + '</button>'
            : '<button type="button" class="btn sm ghost" data-prop-restore="' + esc(p.key) + '">Вернуть в мониторинг</button>';
        return '<div class="prop-row' + (p.status === 'cleared' ? ' cleared' : '') + '"><div><div class="nm">' + esc(p.label) + '</div><div class="ac">' + esc(p.account) + '</div><span class="badge ' + st[1] + ' mt-s">' + esc(st[0]) + '</span></div><div class="why">' + p.why.map(esc).join('<br>') + (p.review && p.review.note ? '<br><span class="tiny">' + esc(p.review.by) + ': ' + esc(p.review.note) + '</span>' : '') + '</div><div class="prop-idx"><span class="nums">' + (p.status === 'cleared' ? p.base + ' <span class="muted">было ' + p.raised + '</span>' : '<s>' + p.base + '</s> → <b>' + p.raised + '</b>') + ' / 100</span><span class="prop-bar"><i style="width:' + p.index + '%"></i></span></div><div class="prop-act">' + btns + '</div></div>';
      }).join('') : '<p class="small muted">Связанных счетов вне цепочки не найдено.</p>') + '</div>';
    const ring = ch.ringId && NX.Graph.rings ? NX.Graph.rings.find((r) => r.id === ch.ringId) : null;
    const allHeld = ring && ring.nodes.length && ring.nodes.every((n) => n.blocked);
    const pend = ring ? B.pending.find((x) => x.kind === 'ring_hold' && x.ref === 'ring:' + ring.id) : null;
    const ringBtn = ring ? (allHeld ? '<button type="button" class="btn sm" disabled>Операции сети ' + esc(ring.id) + ' приостановлены</button>' : pend && pend.role === roleOf() ? '<button type="button" class="btn sm" disabled>Приостановление сети ждёт второй подписи</button>' : '<button type="button" class="btn sm danger" data-ring="' + esc(ring.id) + '">' + NX.icon('lock') + 'Приостановить операции сети ' + esc(ring.id) + (pend ? ' · подпись 2 из 2' : ' · подпись 1 из 2') + '</button>') : '';
    const html = head('<span class="badge ' + conf.cls + ' plain">схема: ' + esc(conf.label) + '</span>') + tabs +
      '<div class="ch-path" aria-label="Путь денег по цепочке ' + esc(ch.id) + '">' + path + '</div>' + kpis + '<div class="ch-sig">' + sig.join('') + '</div>' +
      '<div class="row wrap gap-s mt">' + ringBtn + '<button type="button" class="btn sm" data-chain-focus="' + esc(ch.start.id) + '">' + NX.icon('graph') + 'Подсветить в графе</button>' + (ch.start.iocValue ? '<button type="button" class="btn sm" data-ioc="' + esc((findIoc({ kind: ch.start.iocKind, value: ch.start.iocValue }) || {}).id || '') + '">' + NX.icon('dna') + 'Карточка реквизита</button>' : '') + '</div>' +
      propHTML +
      '<p class="tiny muted mt-s">Синтетические счета и суммы; id устройств синтетические. ' + (ch.synthetic ? 'Для нового реквизита из разведки ' + esc(SYNTH_NOTE) + '. ' : '') + 'В продукте цепочки строятся по реальным операциям банка; обмен с другими банками — через АФЦ НБРК.</p>';
    if (html !== chainHtml) { box.innerHTML = html; chainHtml = html; }
  }
  function chainLogAdd(p, action, note) {
    const e = { id: NX.uid('cl'), ts: Date.now(), key: p.key, label: p.label, account: p.account, action, note, by: signer() };
    B.chainLog.unshift(e);
    if (B.chainLog.length > 100) B.chainLog.length = 100;
    return e;
  }
  function findProp(key) {
    const ch = chainsNow().find((c) => c.start.id === chainSel) || chainsNow()[0];
    return ch ? propagate(ch).find((p) => p.key === key) || null : null;
  }
  const PROP_RU = { review: 'Взят на проверку', clear: 'Подозрение снято', restore: 'Возвращён в мониторинг' };
  function propAction(key, action) {
    const p = findProp(key);
    if (!p) { NX.toast('Счёт не найден', 'Цепочка изменилась — обновите анализ графа', 'info', 'graph'); return; }
    const note = action === 'review' ? 'Связь со схемой проверяется: история операций, владелец, устройство'
      : action === 'clear' ? 'Связь проверена: признаков участия в схеме нет, индекс риска возвращён к обычному'
        : 'Подозрение восстановлено для мониторинга';
    if (action === 'restore') delete B.chainRev[key];
    else B.chainRev[key] = { status: action === 'review' ? 'review' : 'cleared', ts: Date.now(), by: signer(), note };
    chainLogAdd(p, action, note);
    audit('link_' + action, 'acc:' + p.account, p.label, note, { dup: true });
    saveB();
    logCycle('investigate', 'Цепочка дропов · ' + p.label + ': ' + PROP_RU[action].toLowerCase() + ' (связь ≠ вина)');
    NX.toast(PROP_RU[action], p.label + ' · ' + note, action === 'clear' ? 'ok' : 'info', action === 'clear' ? 'check' : 'search');
    renderChainPanel();
  }
  function openChainLog() {
    const rows = B.chainLog.map((e) => '<div class="li"><span class="mono tiny muted">' + NX.time(e.ts) + '</span><div class="grow"><div class="small" style="white-space:normal"><b>' + esc(PROP_RU[e.action] || e.action) + '</b> · ' + esc(e.label) + ' <span class="mono tiny muted">' + esc(e.account) + '</span></div><div class="tiny muted">' + esc(e.by) + ' · ' + esc(e.note) + '</div></div></div>').join('') || '<div class="empty">Записей пока нет. Решения «Проверить» и «Снять подозрение» по связанным счетам появятся здесь.</div>';
    bmodal('<div class="row between wrap"><h3>Журнал проверок связанных счетов</h3><span class="nguilt">связь ≠ вина</span></div><p class="small muted">Кто, когда и почему проверил счёт, связанный со Scam Chain, или снял с него подозрение. Записи только добавляются.</p><div class="list mt" style="max-height:56vh;overflow:auto">' + rows + '</div><div class="row mt" style="justify-content:flex-end"><button type="button" class="btn" data-close>Закрыть</button></div>', { wide: true });
  }
  function selectChain(startId, focus) {
    chainSel = startId;
    const ch = chainsNow().find((c) => c.start.id === startId);
    if (ch) { highlightChain(ch); if (focus && NX.Graph) NX.Graph.focus(ch.start, { ms: 4000, k: 1 }); }
    renderChainPanel();
  }
  function chainNodeClick(id) {
    const n = NX.Graph ? NX.Graph.node(id) : null;
    if (!n) return;
    NX.Graph.select(n);
    const ch = chainsNow().find((c) => c.start.id === chainSel);
    if (ch) NX.Graph.setHighlight({ seed: n, nodes: ch.path.slice(), path: { nodes: ch.path.slice(), edges: ch.edges.slice() } });
    NX.Graph.focus(n, { ms: 4000, k: 1.1 });
    renderChainPanel();
    const gw = $('#graphWrap');
    if (gw && gw.scrollIntoView) { try { gw.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ } }
  }
  function chainResult(ch, extra) {
    const prop = propagate(ch);
    return Object.assign({
      ok: true, chainId: ch.id, ringId: ch.ringId, ringName: ch.ringName,
      nodes: ch.nodes.map((x) => ({ id: x.node.id, label: x.node.label, account: NX.Graph.disp(x.node), role: x.role, step: x.step, amountIn: x.amountIn, dwellMin: x.dwellMin, ioc: x.node.iocValue ? x.node.iocStatus || 'suspected' : null, blocked: !!x.node.blocked, device: x.node.device || null })),
      hops: ch.hops, minutesToCashout: ch.minutesToCashout, victims: ch.victims.length, heldAmount: (ch.heldEdges || []).reduce((a, e) => a + e.amount, 0),
      signals: { fanIn: ch.senders, repeated: ch.repeated, sharedDevices: ch.shared.map((s) => s.device) },
      status: chainConfirmed(ch).label,
      linkedAccounts: prop.length,
      propagated: prop.map((p) => ({ label: p.label, account: p.account, base: p.base, index: p.index, raised: p.raised, status: p.status, why: p.why, note: 'связь ≠ вина' })),
      synthetic: ch.synthetic, graphNote: ch.synthetic ? SYNTH_NOTE : '',
    }, extra || {});
  }
  // NX.BankStage.showChain(value?) — реквизит (или счёт) → его цепочка; без аргумента — цепочка свежего реквизита
  // из стоп-листа или главная цепочка сети
  function showChain(value, opts) {
    const o = opts || {};
    if (!NX.Graph || typeof NX.Graph.chains !== 'function') return { ok: false, reason: 'no_graph' };
    if (!o.stay) go('graph');
    let rec = null, focus = null;
    if (value != null || iocList().length) rec = findIoc(value == null ? null : value);
    if (rec && rec.kind !== 'domain') focus = focusGraphOnIoc(rec, { stay: true });
    if (!NX.Graph.detected) runDetect(true); else renderRings(NX.Graph.detect());
    const list = chainsNow();
    let ch = null;
    if (rec) { const node = NX.Graph.findIoc(rec.kind, rec.value); if (node) ch = list.find((c) => c.path.indexOf(node) >= 0) || null; }
    if (!ch && value != null && typeof value === 'string') { const node = NX.Graph.byAccount(value); if (node) ch = list.find((c) => c.path.indexOf(node) >= 0) || null; }
    if (!ch) ch = list[0] || null;
    if (!ch) { renderChainPanel(); return { ok: false, reason: 'no_chain' }; }
    chainSel = ch.start.id;
    highlightChain(ch);
    NX.Graph.focus(ch.start, { ms: 5000, k: 1 });
    renderChainPanel();
    const card = $('#chainCard');
    if (card && 'open' in card) card.open = true;
    if (card && card.scrollIntoView && current === 'graph') { try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ignore */ } }
    const res = chainResult(ch, { ioc: focus && focus.ioc ? focus.ioc : rec ? brief(rec) : null, iocStatus: focus ? focus.status : null });
    logCycle('predict', 'Цепочка дропов ' + ch.id + ': ' + cnt(ch.hops, ['переход', 'перехода', 'переходов']) + ' до обнала' + (ch.minutesToCashout != null ? ' за ' + ch.minutesToCashout + ' мин' : '') + (res.linkedAccounts ? ' · связанных счетов с повышенным риском: ' + res.linkedAccounts + ' (связь ≠ вина)' : ''));
    return res;
  }

  /* ---------- CrossBank Intelligence: обмен обезличенными индикаторами (симуляция) ---------- */
  // Отпечаток реквизита: демо-хеш FNV-1a (2 × 32 бит) от нормализованного вида; в проде — HMAC-SHA-256 с общим ключом обмена.
  function fnv(s, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }
  const xhash = (key) => { const s = String(key || ''); const h = fnv(s, 2166136261) + fnv(s, 0x811c9dc5 ^ 0x5bd1e995); return h.slice(0, 4) + ' ' + h.slice(4, 8) + ' ' + h.slice(8, 12) + ' ' + h.slice(12, 16); };
  function xbIncoming() {
    const M = NX.MULE_ACCOUNTS || [];
    const t0 = B.xb.t0;
    return [
      { id: 'xin1', bank: 'Банк A', key: M[0] ? accKey(M[0].account) : 'iban:demo-a', scheme: 'Fake Bank Support · дроп-счёт', status: 'подтверждён аналитиком', ts: t0 - 18 * 60000 },
      { id: 'xin2', bank: 'АФЦ НБРК', key: accKey('gift-bonus-kz.test'), scheme: 'Фишинг · сайт-двойник', status: 'подтверждён корреляцией', ts: t0 - 52 * 60000 },
      { id: 'xin3', bank: 'Банк B', key: 'phone:77019990417', scheme: 'Инвестиционный скам · номер звонящего', status: 'на проверке', ts: t0 - 2.4 * 3600000 },
    ];
  }
  function localKeys() {
    const m = new Map();
    iocList().forEach((r) => { if (active(effSt(r))) m.set(iocKey(r), 'реквизит в стоп-листе: ' + dispIoc(r) + ' · ' + stLabel(effSt(r))); });
    if (NX.Graph) NX.Graph.nodes.forEach((n) => { if (n.knownDrop || n.flagged || n.iocValue) { const k = accKey(n.account); if (k && !m.has(k)) m.set(k, 'узел графа «' + n.label + '»' + (n.knownDrop ? ' · база дропов банка' : '')); } });
    B.incidents.forEach((i) => { if (i.account && i.account !== '—') { const k = accKey(i.account); if (k && !m.has(k)) m.set(k, 'получатель в инциденте «' + String(i.title || '').slice(0, 60) + '»'); } });
    return m;
  }
  function xbOutgoing() {
    return sortIocs(iocList()).filter((r) => strong(effSt(r)) && r.kind !== 'domain').slice(0, 5).map((r) => {
      const node = NX.Graph ? NX.Graph.findIoc(r.kind, r.value) : null;
      const ch = node ? chainsNow().find((c) => c.path.indexOf(node) >= 0) : null;
      const kind = { iban: 'счёт', phone: 'номер', card: 'карта', crypto: 'кошелёк' }[r.kind] || 'реквизит';
      return { key: iocKey(r), hash: xhash(iocKey(r)), scheme: (ch ? 'Цепочка дропов ' + ch.id + ' · ' : '') + 'социальная инженерия · ' + kind, status: stLabel(effSt(r)), shared: B.xb.shared[iocKey(r)] || null };
    });
  }
  function renderXbank() {
    const box = $('#xbank'); if (!box) return;
    const inc = xbIncoming(), out = xbOutgoing();
    box.innerHTML = '<p class="small muted">Обезличенные индикаторы: отпечаток реквизита, тип схемы, статус и источник. ФИО, суммы и данные клиентов не передаются. Входящий индикатор сверяется с данными банка только по отпечатку.</p>' +
      '<div class="xb-grid mt"><div><div class="xb-h"><b>Входящие</b><span class="tiny muted">от банков-участников и АФЦ</span></div>' +
      inc.map((x) => {
        const c = B.xb.checked[x.id];
        return '<div class="xb-row"><div style="min-width:0"><div class="xb-hash">' + esc(xhash(x.key)) + '</div><div class="xb-sub">' + esc(x.scheme) + ' · ' + esc(x.status) + ' · источник: ' + esc(x.bank) + ' · ' + esc(NX.ago(x.ts)) + '</div>' + (c ? '<div class="xb-sub" style="color:' + (c.match ? 'var(--danger-ink)' : 'var(--ok-ink)') + '">' + esc(c.match ? 'Совпадение: ' + c.match : 'Совпадений в данных банка нет') + '</div>' : '') + '</div>' +
          (c ? '<span class="badge ' + (c.match ? 'high' : 'ok') + '">' + (c.match ? 'совпадение' : 'нет совпадений') + '</span>' : '<button type="button" class="btn sm" data-xb-check="' + esc(x.id) + '">Сверить</button>') + '</div>';
      }).join('') + '</div>' +
      '<div><div class="xb-h"><b>Исходящие</b><span class="tiny muted">подтверждённые реквизиты стоп-листа</span></div>' +
      (out.length ? out.map((x) => '<div class="xb-row"><div style="min-width:0"><div class="xb-hash">' + esc(x.hash) + '</div><div class="xb-sub">' + esc(x.scheme) + ' · ' + esc(x.status) + ' · источник: банк-участник (концепт)' + (x.shared ? ' · передан ' + esc(NX.ago(x.shared)) : '') + '</div></div>' + (x.shared ? '<span class="badge ok">передан</span>' : '<button type="button" class="btn sm" data-xb-share="' + esc(x.key) + '">' + NX.icon('send') + 'Передать</button>') + '</div>').join('')
        : '<p class="small muted">Пока нечего передавать: исходящими становятся реквизиты, подтверждённые корреляцией или аналитиком.</p>') + '</div></div>' +
      '<div class="notice warn mt">Симуляция · требует правовой основы и согласованного формата обмена (АФЦ НБРК, банки-участники). Отпечаток в демо — FNV-1a; в продукте — HMAC-SHA-256 с общим ключом, без возможности восстановить реквизит.</div>';
  }
  function xbCheck(id) {
    const x = xbIncoming().find((y) => y.id === id); if (!x) return;
    const m = localKeys().get(x.key) || null;
    B.xb.checked[id] = { ts: Date.now(), match: m };
    audit('xbank_check', 'xb:' + id, xhash(x.key), m ? 'совпадение: ' + m : 'совпадений нет', { dup: true });
    saveB();
    if (m) logCycle('investigate', 'CrossBank: индикатор от «' + x.bank + '» совпал — ' + m);
    NX.toast(m ? 'CrossBank: совпадение' : 'CrossBank: совпадений нет', m ? x.bank + ' · ' + m : x.bank + ' · отпечаток не найден в данных банка', m ? 'high' : 'ok', 'search');
    renderXbank();
  }
  function xbShare(key) {
    const x = xbOutgoing().find((y) => y.key === key); if (!x) return;
    B.xb.shared[key] = Date.now();
    audit('xbank_share', key, x.hash, 'обезличенный индикатор передан (симуляция)', { dup: true });
    saveB();
    logCycle('investigate', 'CrossBank: обезличенный индикатор ' + x.hash + ' передан участникам обмена (симуляция)');
    NX.toast('Индикатор передан (симуляция)', x.hash + ' · ' + x.scheme, 'info', 'send');
    renderXbank();
  }

  /* ================= API ДЛЯ СЦЕНЫ (stage.html) ================= */
  // Граф: автофокус на реквизите, корреляция с дроп-сетью, PPR и объясняющий путь.
  function focusGraphOnIoc(value, opts) {
    const o = opts || {};
    if (!o.stay) go('graph');
    const rec = findIoc(value == null ? null : value);
    if (!rec) { NX.toast('Нет реквизитов для фокуса', 'Стоп-лист пока пуст', 'info', 'graph'); return { ok: false, reason: 'no_ioc' }; }
    if (!NX.Graph) return { ok: false, reason: 'no_graph', ioc: brief(rec) };
    const res = NX.Graph.addIoc(rec, { status: effSt(rec), history: !noSynth(rec) });
    if (!res || !res.node) {
      renderImmunity(false);
      return { ok: false, reason: (res && res.reason) || 'not_in_graph', ioc: brief(rec), status: effSt(rec), label: stLabel(effSt(rec)) };
    }
    if (!NX.Graph.detected) runDetect(true);
    const upd = corroborateFromGraph(rec, res, 0) || rec;
    const node = res.node;
    NX.Graph.select(node); // nodePanel: PPR + подсветка пути
    NX.Graph.focus(node, { ms: 5000, k: o.k || 1.1 });
    const path = NX.Graph.explainPath(node, NX.Graph.hub);
    const st = effSt(upd);
    const synth = NX.Graph.isSynthetic ? NX.Graph.isSynthetic(node) : !!node.synthHistory;
    return {
      ok: true, ioc: brief(upd), status: st, label: stLabel(st), corroborated: strong(st), path: path ? path.text : null,
      // корреляция по графу держится на сгенерированной истории счёта (демо) — сцена должна это сказать
      graphSynthetic: synth, graphNote: synth ? SYNTH_NOTE : '',
      ppr: lastPpr.map((x) => ({ label: x.node.label, account: NX.Graph.disp(x.node), role: x.node.role, score: Math.round(x.score * 10000) / 10000, rel: x.rel })),
    };
  }
  function holdCardHTML(h) {
    const held = h.decision === 'hold' && !h.released;
    const tone = held ? [rgbaOf(PAL.ok, 0.4), 'var(--ok)'] : h.decision === 'stepup' ? [rgbaOf(PAL.warn, 0.42), 'var(--warn)'] : ['var(--line2)', 'var(--line3)'];
    const title = h.released ? 'Удержание снято' : held ? 'Удержан до потери' : h.decision === 'stepup' ? 'Усиленная проверка перевода' : 'Перевод не удержан';
    const sub = h.released ? 'Реквизит снят как ложное срабатывание: удержание перевода снято, в «предотвращено» он больше не входит.' : held ? 'Перевод удержан для проверки (hold до 72 ч), клиенту — звонок с официального номера банка.' : h.decision === 'stepup' ? 'Реквизит на проверке (один источник): перевод не удерживается — пауза, подтверждение и звонок клиенту.' : 'Реквизит не в активном стоп-листе — действует обычный скоринг.';
    return '<div class="live-banner mb" id="holdCard" style="border-color:' + tone[0] + ';border-left-color:' + tone[1] + ';background:var(--panel)">' +
      '<div class="row between wrap"><div class="row gap-s">' + NX.icon(held ? 'shieldCheck' : 'alert', '', 20) + '<b>' + esc(title) + '</b>' + stChip(h.status) + '</div><div class="row gap-s"><span class="tiny muted">' + NX.time(h.ts) + '</span>' + closeBtn('hold') + '</div></div>' +
      '<div class="row wrap gap-l mt-s" style="align-items:flex-end"><div><div class="cons-amt">' + NX.fmt(h.amount) + '</div><div class="small">' + esc(h.client) + ' → <span class="mono">' + esc(h.raw) + '</span></div></div>' +
      '<div class="small muted grow" style="min-width:220px">Реквизит получен <b>' + esc(mmss(h.ageMs)) + '</b> назад' + (h.fromDecoy ? ' из звонка-ловушки' : '') + ' (' + esc(h.source) + ')' + (h.latencyMs != null ? ' · реквизит доставлен в банк за <b>' + h.latencyMs + ' мс</b>' : '') + ' · индекс риска ' + h.score + '</div></div>' +
      (h.quote ? '<div class="small mt-s">«' + esc(h.quote) + '» <span class="tiny muted">— фраза мошенника из звонка-ловушки</span></div>' : '') +
      '<p class="small mt-s">' + esc(sub) + '</p>' +
      (h.dna ? dnaHTML(h.dna) : '') +
      (h.tcId ? tcInlineHTML(h.tcId) : '') +
      '<p class="tiny muted mt-s">Второй клиент синтетический (демо). Решение вычислено, а не задано сценарием: берётся самое строгое из статуса реквизита в стоп-листе и Transaction DNA; индекс риска — тем же скорингом, что и в кабинете клиента.' + (h.dna && h.dna.callAssumed ? ' Сигнал «идёт звонок» в демо задан сценарием сцены; в продукте его даёт мобильный SDK.' : '') +
        (h.graphSynthetic ? ' Статус «подтверждён корреляцией» получен по графу связей, а ' + esc(SYNTH_NOTE) + '.' : '') + '</p>' +
      '<div class="row wrap gap-s mt-s">' + (h.incidentId ? '<button type="button" class="btn sm" data-inc="' + esc(h.incidentId) + '">Открыть инцидент</button>' : '') + (h.iocId ? '<button type="button" class="btn sm" data-ioc="' + esc(h.iocId) + '">Карточка реквизита</button>' : '') + '</div></div>';
  }
  // Индекс риска перевода синтетического клиента — тем же NX.scoreTransfer и тем же профилем,
  // что client.js secondClient (баланс 1 450 000 ₸, три перевода 25–35 тыс. ₸, без сигналов Core).
  function stageProfileState() {
    const now = Date.now(), DAY = 86400000;
    return {
      version: 2,
      user: { name: 'Сауле Д.', short: 'Сауле', balance: 1450000, savings: 0, card: '', cardBlocked: false },
      transactions: [25000, 30000, 35000].map((a, i) => ({ id: 'syn' + i, ts: now - (9 + i * 14) * DAY, type: 'transfer', category: 'Переводы', merchant: 'Перевод', amount: -a })),
      events: [], devices: [], family: [], subsCancelled: [], scoreHistory: [], goal: { name: '', target: 1, saved: 0 },
      settings: { twoFA: true, pushAlerts: true, biometrics: false, nightLimit: false, geoLock: false, remoteAccessBlock: true, transferLimit: 1000000, scamCallProtect: false, coolingPeriod: true },
    };
  }
  // Transaction DNA второго клиента: NX.DNA.assess на том же синтетическом профиле (если dna.js загружен),
  // иначе — r.dna из NX.scoreTransfer. ctx.callActive по умолчанию true: в сюжете сцены Сауле Д. говорит с мошенником.
  function stageDna(account, amount, o, sc) {
    if (NX.DNA && typeof NX.DNA.assess === 'function') {
      const tmp = stageProfileState(), saved = NX.state;
      try {
        NX.state = tmp;
        let prof = null;
        try { prof = typeof NX.DNA.profile === 'function' ? NX.DNA.profile(tmp) : null; } catch (e) { prof = null; }
        const callActive = o.callActive !== false;
        // реквизит из стоп-листа — тот же фактор, что в NX.scoreTransfer (flagged_recipient)
        const iocSt = sc && sc.ioc && typeof sc.ioc === 'object' ? String(sc.ioc.status || '') : '';
        const recipientFlag = sc && sc.mule ? 'mule' : /^(confirmed|corroborated|suspected)$/.test(iocSt) ? iocSt : null;
        const flagBasis = sc && sc.ioc && typeof sc.ioc === 'object' && !sc.mule ? String(sc.ioc.basis || '') : '';
        const d = NX.DNA.assess({ amount, newRecipient: true, recipient: account, hour: new Date().getHours(), recipientFlag, recipientFlagBasis: flagBasis, recipientFlagSynthetic: !!(sc && sc.ioc && sc.ioc.syntheticGraph) },{ callActive, scamSignal: false, weakenAttempt: false, emergency: false });
        if (d && typeof d === 'object') return Object.assign({}, d, { profileSummary: prof && prof.summary ? String(prof.summary) : '', callAssumed: callActive });
      } catch (e) { /* модуль DNA другого пакета — не роняем панель */ } finally { NX.state = saved; }
    }
    return sc && sc.dna && typeof sc.dna === 'object' ? sc.dna : null;
  }
  function stageScore(account, amount) {
    if (typeof NX.scoreTransfer !== 'function') return null;
    const tmp = stageProfileState();
    const saved = NX.state;
    try {
      NX.state = tmp;
      const r = NX.scoreTransfer({ amount, account, recipientId: null, purpose: '' });
      return r && typeof r.score === 'number' ? r : null;
    } catch (e) { return null; } finally { NX.state = saved; }
  }
  // «Второй клиент» переводит на тот же реквизит: решение — по статусу IOC в стоп-листе.
  function secondClientTransfer(ioc, opts) {
    const o = opts || {};
    let rec = findIoc(ioc == null ? null : ioc);
    if (!rec) { NX.toast('Нет реквизита в стоп-листе', 'Сначала мошенник должен назвать реквизит в звонке-ловушке', 'info', 'info'); return { ok: false, reason: 'no_ioc' }; }
    const amount = Number(o.amount) || 380000;
    const client = String(o.client || 'Сауле Д., 67 · Шымкент');
    const city = String(o.city || 'Шымкент');
    let st = effSt(rec);
    // проверка по графу в момент решения (как в проде: корреляция до списания)
    if (st === 'suspected' && rec.kind !== 'domain') { const u = corroborateFromGraph(rec, null, 3); if (u) { rec = u; st = effSt(u); } }
    // индекс риска — тем же NX.scoreTransfer, что и в кабинете (client.js secondClient), на синтетическом профиле
    const sc = stageScore(dispIoc(rec), amount);
    const dna = stageDna(dispIoc(rec), amount, o, sc);
    const dTier = dna ? String(dna.tier || '') : '';
    // самое строгое из статуса реквизита в стоп-листе и уровня Transaction DNA
    const decision = strong(st) || dTier === 'hold' ? 'hold' : st === 'suspected' || dTier === 'cooling' || dTier === 'check' ? 'stepup' : 'pass';
    const now = Date.now();
    const m = B.iocMeta[iocKey(rec)] || {};
    const firstSeen = rec.firstSeen || rec.ts || now;
    const fromDecoy = /decoy|ловушк|приман/i.test(srcText(rec));
    const gnode = NX.Graph ? NX.Graph.findIoc(rec.kind, rec.value) : null;
    const graphSynthetic = strong(st) && (rec.signals || []).indexOf('graph') >= 0 && !!(gnode && NX.Graph.isSynthetic && NX.Graph.isSynthetic(gnode));
    const score = sc ? sc.score : NX.combine([decision === 'hold' ? 80 : decision === 'stepup' ? 40 : 0, 18].filter((x) => x > 0));
    const scoreFacts = sc ? sc.factors.filter((f) => f && !f.rule && f.key !== 'ioc' && f.key !== 'ioc_suspected').slice(0, 3).map(factorText) : ['Новый получатель'];
    const dnaFacts = dna ? ['Отклонение от обычного перевода: индекс ' + Math.round(Number(dna.index) || 0) + ' — ' + dnaTierLabel(dna)].concat((dna.factors || []).filter(Boolean).slice(0, 4).map((f) => 'Обычный перевод · ' + (str(f.label) || str(f.key)) + (str(f.detail) ? ': ' + str(f.detail) : ''))) : [];
    const facts = [active(st) ? 'реквизит в стоп-листе: ' + stLabel(st) : 'реквизит: ' + stLabel(st), 'источник: ' + srcText(rec)].concat(graphSynthetic ? ['корреляция по графу: ' + SYNTH_NOTE] : [], dnaFacts.length ? dnaFacts : scoreFacts);
    const tx = { id: nextTxId(), ts: now, client: client + ' (синтет.)', to: dispIoc(rec), amount, score, channel: 'Мобильное приложение', city, device: 'известное', facts, fraud: false, threat: -1, live: true, iocHit: true, decision: decision === 'hold' ? 'block' : decision === 'stepup' ? 'stepup' : 'pass' };
    ingest(tx);
    const inc = {
      id: NX.uid('inc'), ts: now, client: client + ' (синтетический клиент)', type: 'Социальная инженерия',
      title: (decision === 'hold' ? 'Удержан до потери: ' : decision === 'stepup' ? 'Усиленная проверка: ' : 'Перевод: ') + NX.fmt(amount) + ' → реквизит ' + (fromDecoy ? 'из звонка-ловушки' : 'из стоп-листа'),
      score, amount, account: dispIoc(rec), source: 'Стоп-лист NEXUS · ' + srcText(rec), status: decision === 'pass' ? 'resolved' : 'new',
      factors: facts, details: quoteOf(rec) ? 'Фраза мошенника: «' + quoteOf(rec) + '»' : '',
      chain: [
        { t: 'Реквизит назван мошенником (' + srcText(rec) + ')', ts: firstSeen },
        m.lat != null ? { t: 'реквизит доставлен в банк за ' + m.lat + ' мс', ts: firstSeen + m.lat } : null,
        strong(st) ? { t: 'Статус реквизита: ' + stLabel(st) + (graphSynthetic ? ' (граф связей: ' + SYNTH_NOTE + ')' : ''), ts: rec.lastChange || now } : null,
        dna ? { t: 'Отклонение от обычного перевода: индекс ' + Math.round(Number(dna.index) || 0) + ' — ' + dnaTierLabel(dna), ts: now - 1 } : null,
        { t: 'Попытка перевода ' + NX.fmt(amount) + ' — ' + (decision === 'hold' ? 'удержан для проверки' : decision === 'stepup' ? 'усиленная проверка' : 'пропущен'), ts: now },
      ].filter(Boolean),
      notes: [], synthetic: true, stage: true, victimLabel: 'Сауле Д., 67', victimAccount: 'KZ•• •••• •••• 7731 (синтет.)',
      dna: dna || undefined,
    };
    B.incidents.unshift(inc);
    // Trust Circle второго клиента: сын Ерлан получает запрос на проверку без реквизитов и без доступа к деньгам
    let tc = null;
    if (decision !== 'pass' && o.trustCircle !== false) {
      tc = tcAdd({ id: NX.uid('tc'), client: 'Сауле Д., 67', guardian: { name: 'Ерлан', relation: 'сын' }, amount, reason: 'перевод новому получателю удержан для проверки', source: 'second_client', incId: inc.id, call: !dna || dna.callAssumed !== false });
      inc.tcId = tc.id;
      inc.chain.push({ t: 'Близкие: запрос на проверку отправлен доверенному лицу — Ерлан (сын)', ts: now + 1 });
      NX.bus.emit('trust_circle_request', { id: tc.id, client: tc.client, guardian: 'Ерлан', relation: 'сын', message: tc.msg, masked: { amount: tc.amountText, recipient: 'новый получатель' }, incidentId: inc.id, secondClient: true });
    }
    if (decision === 'hold') recordHold({ client, amount, rec, via: 'second_client', incidentId: inc.id });
    audit('second_client_hold', iocKey(rec), dispIoc(rec), NX.fmt(amount) + ' · ' + (decision === 'hold' ? 'удержан' : decision === 'stepup' ? 'усиленная проверка' : 'пропущен'), { who: 'NEXUS · стоп-лист', role: 'система' });
    if (NX.Graph && decision === 'hold') {
      const node = NX.Graph.findIoc(rec.kind, rec.value);
      NX.Graph.addVictim('Сауле Д., 67', amount, node || dispIoc(rec), inc.victimAccount);
    }
    saveB();
    const info = { ok: true, decision, held: decision === 'hold', amount, client, city, score, ioc: brief(rec), status: st, label: stLabel(st), ageMs: now - firstSeen, latencyMs: m.lat != null ? m.lat : null, quote: quoteOf(rec), incidentId: inc.id, ts: now, graphSynthetic, graphNote: graphSynthetic ? SYNTH_NOTE : '',
      dna: dna ? { index: Math.round(Number(dna.index) || 0), tier: dTier || null, tierLabel: dnaTierLabel(dna), explain: dnaExplain(dna), factors: (dna.factors || []).filter(Boolean).map((f) => ({ key: str(f.key), label: str(f.label), points: Number(f.points) || 0, detail: str(f.detail) })), profile: dna.profileSummary || '', callAssumed: !!dna.callAssumed } : null,
      trustCircle: tc ? { id: tc.id, guardian: 'Ерлан (сын)', status: tc.status, message: tc.msg } : null };
    liveState.hold = { ts: now, decision, amount, client, raw: dispIoc(rec), status: st, source: rec.source || srcText(rec), fromDecoy, ageMs: info.ageMs, latencyMs: info.latencyMs, quote: info.quote, score, incidentId: inc.id, iocId: rec.id, graphSynthetic, dna: dna || null, tcId: tc ? tc.id : null };
    if (dna) logCycle('understand', 'Отклонение от обычного перевода второго клиента: индекс ' + info.dna.index + ' — ' + info.dna.tierLabel, { inc: inc.id });
    logCycle('protect', (decision === 'hold' ? 'Удержан до потери: ' : decision === 'stepup' ? 'Усиленная проверка: ' : 'Пропущен: ') + NX.fmt(amount) + ' · Сауле Д., 67 → реквизит из стоп-листа', { inc: inc.id });
    if (tc) logCycle('protect', 'Близкие: запрос на проверку — Ерлан (сын)', { inc: inc.id });
    if (!o.stay) go('overview'); else render();
    renderLive();
    const card = $('#holdCard');
    if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ } }
    NX.toast(decision === 'hold' ? 'Удержан до потери' : decision === 'stepup' ? 'Усиленная проверка перевода' : 'Перевод пропущен', NX.fmt(amount) + ' · ' + client + ' → ' + dispIoc(rec) + ' · реквизит получен ' + mmss(info.ageMs) + ' назад', decision === 'hold' ? 'ok' : 'warn', decision === 'hold' ? 'shieldCheck' : 'alert');
    NX.bus.emit('second_client_tx', info);
    return info;
  }
  NX.BankStage = {
    focusGraphOnIoc,
    secondClientTransfer,
    openIoc: (v) => openIoc(v),
    latestIoc: () => brief(findIoc(null)),
    lastLatency: () => (B.lastIoc && B.lastIoc.lat != null ? B.lastIoc.lat : null),
    go: (v) => go(v),
    // 3-минутный показ (stage ?short=1): открыть свежий инцидент клиента (по имени) — в окне кнопка «Позвонить клиенту с официального номера»
    openIncidentFor: (client) => {
      const first = String(client || '').trim().split(/\s+/)[0] || '';
      const list = B.incidents.filter((i) => !first || String(i.client || '').indexOf(first) >= 0).sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
      const i = list.find((x) => x.fromClient) || list[0];
      if (!i) return { ok: false, reason: 'no_incident' };
      go('incidents');
      openIncident(i.id);
      return { ok: true, id: i.id, client: i.client, live: !!(i.bankCall && i.bankCall.until > Date.now()) };
    },
    // финансовая конституция клиента глазами банка (только чтение): счётчики и последнее событие
    constitutionStats: () => {
      const s = B.cons.stats, last = B.cons.log[0] || null, prot = protNow();
      return { fired: s.fired, stopped: s.stopped, stoppedSum: s.stoppedSum, confirms: s.confirms, refused: s.refused, guardianRequests: s.guardianReq, guardianRejects: s.guardianReject, protective: !!prot, byArticle: Object.assign({}, s.byN), last: last ? { type: last.type, title: last.title, ts: last.ts, incidentId: last.incId || null } : null };
    },
    openConstitution: () => { go('overview'); openConsLog(); },
    // 3.0: Scam Chain (PREDICT + INVESTIGATE) → {chainId, nodes, hops, minutesToCashout, linkedAccounts, propagated, …}
    showChain: (v, opts) => showChain(v, opts),
    chains: () => chainsNow().map((c) => chainResult(c)),
    // Trust Circle второго клиента: ответ сына Ерлана в демо ('hold' — «Нужна проверка — удержать», 'ok' — «Всё в порядке — я рядом»)
    trustCircleRespond: (verdict, id) => tcRespond(id || null, verdict),
    trustCircle: () => B.tc.slice(0, 10).map((e) => ({ id: e.id, client: e.client, guardian: gName(e.guardian), message: e.msg, status: e.status, source: e.source, incidentId: e.incId })),
    // цикл DETECT → RECOVER: последние живые события по стадиям
    cycle: () => B.cycle.slice(0, 30).map((e) => ({ stage: e.st, text: e.t, ts: e.ts })),
    safeReturnCases: () => B.incidents.filter((i) => i.kind === 'safe_return').map((i) => ({ caseId: i.caseId, status: i.srStatus, incidentId: i.id, amount: i.amount, client: i.client })),
  };

  /* Расширения панели (leak-radar.js): инцидент по внешнему ключу, IOC из этой же вкладки, цикл защиты.
     make(copy|null) → поля инцидента; статус и журнал аналитика не перезаписываются, заметки — только новые (по key). */
  NX.BankExt = {
    upsertIncident(extKey, make) {
      if (dead || !extKey || typeof make !== 'function') return null;
      let inc = B.incidents.find((i) => i.extKey === extKey);
      const isNew = !inc;
      const patch = make(inc ? JSON.parse(JSON.stringify(inc)) : null) || {};
      const addNotes = Array.isArray(patch.addNotes) ? patch.addNotes : [];
      delete patch.addNotes;
      // setStatus: решение расширения (например, конверт закрыт) переводит открытый инцидент в этот статус
      const setSt = STATUS[patch.setStatus] ? patch.setStatus : null;
      delete patch.setStatus;
      if (!inc) {
        inc = Object.assign({ id: NX.uid('inc'), ts: Date.now(), status: 'new', chain: [], factors: [], notes: [] }, patch, { extKey });
        B.incidents.unshift(inc);
        if (B.incidents.length > 120) B.incidents.length = 120;
      } else {
        Object.keys(patch).forEach((k) => { if (['id', 'extKey', 'status', 'notes', 'ts'].indexOf(k) < 0) inc[k] = patch[k]; });
        if (patch.reopen && (inc.status === 'resolved' || inc.status === 'false_positive')) inc.status = 'progress';
      }
      if (setSt && inc.status !== setSt && (inc.status === 'new' || inc.status === 'progress')) inc.status = setSt;
      if (!Array.isArray(inc.notes)) inc.notes = [];
      addNotes.forEach((n) => { if (n && n.key && !inc.notes.some((x) => x.key === n.key)) inc.notes.push({ ts: Number(n.ts) || Date.now(), t: String(n.t || ''), by: String(n.by || 'NEXUS · Карты для магазинов'), key: n.key }); });
      saveB();
      render();
      if (modalRefresh && NX.isModalOpen()) modalRefresh();
      return { id: inc.id, isNew };
    },
    incidentId: (extKey) => { const i = B.incidents.find((x) => x.extKey === extKey); return i ? i.id : null; },
    openIncident: (id) => { if (B.incidents.some((x) => x.id === id)) { go('incidents'); openIncident(id); return true; } return false; },
    // NX.iocs.add в этой же вкладке: шина не доставляет себе 'ioc' — узел графа и иммунитет обновляем напрямую
    ingestIocs: (p) => handleIocs(p || {}, null),
    logCycle: (st, t, ref) => logCycle(st, t, ref),
    go: (v) => go(v),
    current: () => current,
    signer: () => signer(),
  };

  /* ================= РОЛЬ ================= */
  function renderRoleSidebar() {
    let host = $('#roleSwitch');
    if (!host) {
      const card = $('.sidebar-foot .card');
      if (card) { host = document.createElement('div'); host.id = 'roleSwitch'; host.className = 'mt-s'; card.appendChild(host); }
    }
    if (host) host.innerHTML = roleSwitchHTML();
    const nm = $('#analystName') || $('.sidebar-foot .card b');
    if (nm) nm.textContent = 'Смена №2 · ' + ROLES[roleOf()].name;
    const rl = $('#analystRole') || $('.sidebar-foot .card .small.muted');
    if (rl) rl.textContent = ROLES[roleOf()].title;
  }
  function setRole(k) {
    if (!ROLES[k] || k === roleOf()) return;
    B.role = k;
    audit('role_switch', 'role', ROLES[k].title, signer(k));
    renderRoleSidebar();
    renderImmunity(false);
    if (NX.Graph && NX.Graph.detected) renderRings(NX.Graph.rings);
    if (modalRefresh && NX.isModalOpen()) modalRefresh();
    NX.toast('Роль: ' + ROLES[k].title, signer(k), 'info', 'users');
  }

  /* ================= СБРОС ================= */
  function askReset() {
    const box = bmodal('<h3>Сбросить демо?</h3><p class="small muted mt-s">Все демо-данные вернутся к исходному состоянию — и здесь, в панели банка (инциденты, стоп-лист реквизитов, журнал), и в кабинете клиента во всех открытых вкладках. Согласие на анализ звонка сохраняется.</p><div class="row wrap mt" style="justify-content:flex-end"><button type="button" class="btn" data-close>Отмена</button><button type="button" class="btn danger" id="rstGo">' + NX.icon('reset') + 'Сбросить</button></div>');
    const b = $('#rstGo', box);
    if (b) b.onclick = () => { dead = true; clearTimeout(streamTimer); NX.resetAll(); };
  }
  function onRemoteReset(p) {
    if (p && p.t0 && p.t0 < PAGE_T0) return; // этот сброс уже учтён: страница загружена после него
    dead = true;
    clearTimeout(streamTimer);
    setTimeout(() => { try { window.location.reload(); } catch (e) { /* ignore */ } }, 60);
  }

  /* ================= ШИНА ================= */
  function onBus(msg, local) {
    if (!msg || dead) return;
    const p = msg.payload || {};
    if (msg.type === 'ioc_update') { handleIocUpdate(p, local); return; } // свои изменения тоже перерисовываем
    if (local) return;
    switch (msg.type) {
      case 'attack_start':
        liveState.attack = { client: p.client, steps: [], risk: 0, incidentId: null };
        renderLive();
        logCycle('detect', 'NEXUS Core: начата атака на клиента ' + String(p.client || ''));
        NX.toast('Начата атака на клиента', String(p.client || '') + ' · NEXUS Core отслеживает цепочку', 'high', 'alert');
        break;
      case 'attack_step':
        if (!liveState.attack) liveState.attack = { client: p.client, steps: [], risk: 0, incidentId: null };
        liveState.attack.steps.push({ i: Number(p.i) || 0, t: String(p.t || ''), amount: p.amount, score: p.score, ts: Date.now() });
        liveState.attack.risk = Math.max(liveState.attack.risk, Math.round(Number(p.risk) || 0), Math.round(Number(p.score) || 0));
        renderLive();
        if (current !== 'overview') NX.toast('Шаг атаки ' + ((Number(p.i) || 0) + 1), String(p.t || ''), (Number(p.i) || 0) >= 3 ? 'high' : 'warn');
        break;
      case 'incident':
        importInbox(false, [p]);
        if (p.demo) { if (!liveState.attack) liveState.attack = { client: p.client, steps: [], risk: Number(p.score) || 0, incidentId: null }; liveState.attack.incidentId = p.id; renderLive(); }
        break;
      case 'client_tx': ingest(clientTxRow(p)); if (current === 'overview') { renderMiniStream(false); renderKpis(false); renderAlerts(false); } break;
      case 'ioc': handleIocs(p, msg); break;
      case 'ioc_seen': handleSeen(p); break;
      case 'shield_alert': handleShieldAlert(p); break;
      case 'shield_lead': handleShieldLead(p); break;
      case 'shield_end': handleShieldEnd(p); break;
      case 'bank_call_cleared': handleBankCallCleared(p); break;
      case 'decoy_start': handleDecoyStart(p); break;
      case 'decoy_end':
      case 'decoy_stop':
        if (liveState.call) { liveState.call.decoyEnd = true; renderLive(); }
        break;
      case 'card': if (p.blocked) NX.toast('Клиент заблокировал карту', String(p.client || ''), 'warn', 'lock'); break;
      // финансовая конституция клиента (NX.Constitution в кабинете)
      case 'constitution_hit': onConsHit(p); break;
      case 'constitution_change': onConsChange(p); break;
      case 'protective_mode': onProtective(p); break;
      case 'guardian_request': onGuardianReq(p); break;
      case 'guardian_response': onGuardianResp(p); break;
      // 3.0: детектор манипуляций, «Заблокировать всё», Возврат денег, Trust Circle второго клиента
      case 'manip_update': handleManip(p); break;
      case 'emergency_shield': handleEmergency(p); break;
      case 'safe_return_case': handleSafeReturn(p); break;
      case 'safe_return_update': { // ответ из другой вкладки банка
        const inc = B.incidents.find((i) => i.kind === 'safe_return' && i.caseId === str(p.caseId));
        if (inc && SR_ST[p.status] && inc.srStatus !== p.status) { inc.srStatus = p.status; inc.status = SR_INC[p.status]; (inc.srHist = inc.srHist || []).push({ ts: Date.now(), status: p.status, by: 'другая вкладка панели', note: str(p.note) }); saveB(); render(); }
        break;
      }
      case 'trust_circle_response': {
        const e = tcResolve(str(p.id), p.verdict === 'ok' || p.verdict === 'approve' ? 'ok' : 'hold', str(p.by) || 'guardian');
        if (e) { saveB(); logCycle('protect', 'Близкие: ' + gName(e.guardian) + ' — ' + TC_ST[e.status][0], e.incId ? { inc: e.incId } : null); render(); renderLive(); }
        break;
      }
      case 'reset': onRemoteReset(p); break;
      default: break;
    }
  }

  /* ================= INIT ================= */
  function onDocClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    let el;
    if ((el = t.closest('[data-goto]'))) { go(el.dataset.goto); return; }
    if ((el = t.closest('[data-run-attack]'))) { runAttack(); return; }
    if ((el = t.closest('[data-tile]'))) { openTile(el.dataset.tile); return; }
    if ((el = t.closest('[data-role]'))) { setRole(el.dataset.role); return; }
    if ((el = t.closest('[data-approve]'))) { approve(el.dataset.approve); return; }
    if ((el = t.closest('[data-live-close]'))) { closeLive(el.dataset.liveClose); return; }
    if ((el = t.closest('[data-live-graph]'))) { go('graph'); if (NX.Graph && !NX.Graph.detected) runDetect(false); return; }
    if ((el = t.closest('[data-audit]'))) { openAudit(); return; }
    if ((el = t.closest('[data-cons-log]'))) { openConsLog(); return; }
    if ((el = t.closest('[data-cons]'))) { consClick(el.dataset.cons); return; }
    if ((el = t.closest('[data-cycle]'))) { openCycle(el.dataset.cycle); return; }
    if ((el = t.closest('[data-chain-detect]'))) { runDetect(false); return; }
    if ((el = t.closest('[data-chain]'))) { selectChain(el.dataset.chain, true); return; }
    if ((el = t.closest('[data-chain-node]'))) { chainNodeClick(el.dataset.chainNode); return; }
    if ((el = t.closest('[data-chain-focus]'))) { selectChain(el.dataset.chainFocus, true); const gw = $('#graphWrap'); if (gw && gw.scrollIntoView) { try { gw.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (er) { /* ignore */ } } return; }
    if ((el = t.closest('[data-chain-log]'))) { openChainLog(); return; }
    if ((el = t.closest('[data-prop-check]'))) { propAction(el.dataset.propCheck, 'review'); return; }
    if ((el = t.closest('[data-prop-clear]'))) { propAction(el.dataset.propClear, 'clear'); return; }
    if ((el = t.closest('[data-prop-restore]'))) { propAction(el.dataset.propRestore, 'restore'); return; }
    if ((el = t.closest('[data-show-chain]'))) { NX.closeModal(); showChain(el.dataset.showChain); return; }
    if ((el = t.closest('[data-tc]'))) { tcRespond(el.dataset.tc, el.dataset.tcV); return; }
    if ((el = t.closest('[data-em-release]'))) { emRelease(); return; }
    if ((el = t.closest('[data-xb-check]'))) { xbCheck(el.dataset.xbCheck); return; }
    if ((el = t.closest('[data-xb-share]'))) { xbShare(el.dataset.xbShare); return; }
    if ((el = t.closest('[data-gzoom]'))) {
      if (NX.Graph) { const z = el.dataset.gzoom; if (z === 'in') NX.Graph.zoom(1.25); else if (z === 'out') NX.Graph.zoom(0.8); else NX.Graph.fit(); }
      return;
    }
    if ((el = t.closest('[data-ppr]'))) { pickPpr(Number(el.dataset.ppr)); return; }
    if ((el = t.closest('[data-ring]'))) { ringHoldStep(el.dataset.ring); return; }
    if ((el = t.closest('[data-hold]'))) { holdNodeById(el.dataset.hold); return; }
    if ((el = t.closest('[data-acc]'))) { openAccount(el.dataset.acc); return; }
    if ((el = t.closest('[data-ioc]'))) { openIoc(el.dataset.ioc); return; }
    if ((el = t.closest('[data-inc]'))) { openIncident(el.dataset.inc); return; }
    if ((el = t.closest('[data-tx]'))) { openTx(el.dataset.tx); return; }
  }
  function onDocKey(e) {
    if (e.key === 'Escape') { const sb = $('.sidebar'); if (sb && sb.classList.contains('open') && NX.closeSidebar) NX.closeSidebar(); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target;
    if (!t || !t.closest || t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
    if (t.closest('[data-inc],[data-tx],[data-acc],[data-ioc],[data-cons],[data-cons-log]')) { e.preventDefault(); onDocClick(e); }
  }
  function initHoverPause() {
    [['#alerts', 'alerts'], ['#miniStream', 'mini'], ['#monBody', 'mon']].forEach((x) => {
      const el = $(x[0]); if (!el) return;
      const host = el.closest('.table-wrap') || el;
      host.addEventListener('mouseenter', () => { hoverPause[x[1]] = true; });
      // строка в фокусе с клавиатуры: поток не перерисовывается, чтобы фокус не пропал
      host.addEventListener('focusin', () => { hoverPause[x[1]] = true; });
      host.addEventListener('focusout', (ev) => { if (!host.contains(ev.relatedTarget)) hoverPause[x[1]] = false; });
      host.addEventListener('mouseleave', () => {
        hoverPause[x[1]] = false;
        if (x[1] === 'alerts' && current === 'overview') renderAlerts(true);
        else if (x[1] === 'mini' && current === 'overview') renderMiniStream(true);
        else if (x[1] === 'mon' && current === 'monitor') renderMonitor(false);
      });
    });
  }
  function init() {
    NX.initShell();
    $$('.nav-btn[data-view]').forEach((b) => (b.onclick = () => go(b.dataset.view)));
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
    $$('#incTabs [data-st]').forEach((b) => (b.onclick = () => setIncFilter(b.dataset.st || '', null)));
    const ik = $('#incKind'); if (ik) ik.addEventListener('change', () => setIncFilter(null, ik.value || ''));
    $$('#monChips [data-mf]').forEach((b) => (b.onclick = () => setMonFilter(b.dataset.mf)));
    const ms = $('#monSearch'); if (ms) ms.addEventListener('input', () => renderMonitor(false));
    // пилюля «опер./с» — пауза и продолжение синтетического потока
    const stg = $('#tpsPill');
    if (stg) stg.onclick = () => { paused = !paused; stg.setAttribute('aria-pressed', paused ? 'true' : 'false'); updateTps(); };
    const ra = $('#runAttack'); if (ra) ra.onclick = runAttack;
    const rs = $('#regenSummary'); if (rs) rs.onclick = renderSummary;
    ['#bankReset', '#bankResetM'].forEach((id) => { const br = $(id); if (br) br.onclick = askReset; });
    // на сцене (?embed=1) блок «Ещё» на «Сейчас» раскрыт: сцена прокручивает к картам для магазинов и сделкам
    if (document.documentElement.classList.contains('nx-embed')) { const nm = $('#nowMore'); if (nm) nm.open = true; }
    else if (window.innerWidth <= 900) { const cc = $('#chainCard'); if (cc) cc.open = false; }
    renderRoleSidebar();
    initHoverPause();
    initGraph();
    warmUp();
    importInbox(true);
    NX.bus.on(onBus);
    window.addEventListener('storage', (e) => {
      if (dead) return;
      if (e.key === INBOX_KEY) importInbox(false);
      // кабинет подписал новую редакцию конституции / включил защитный режим
      else if (e.key === CONS_KEY) { if (current === 'overview') { renderConsPanel(); renderKpis(true); if (liveState.cons) renderLive(); const cw = $('#consWhy'); if (cw) cw.innerHTML = consWhyHTML(); } }
    });
    { const last = B.cons.log[0]; if (last && Date.now() - last.ts <= CONS_WINDOW) liveState.cons = { client: last.client, ts: last.ts }; }
    window.addEventListener('resize', drawFlow);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); });
    setInterval(drawFlow, 3000);
    setInterval(() => { updateTps(); saveB(); }, 2000);
    setInterval(() => { if (!dead && current === 'overview' && !hoverPause.alerts) renderAlerts(true); }, 30000);
    const h = location.hash.slice(1);
    go(VIEWS[h] || VIEW_ALIAS[h] ? h : 'overview');
    window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if ((VIEWS[v] && v !== current) || VIEW_ALIAS[v]) go(v); });
    // время «N мин назад» в Trust Circle и полосе цикла обновляется без мигания (одинаковая разметка не пишется)
    setInterval(() => { if (!dead && current === 'overview') { renderCycle(); renderTc(); } }, 30000);
    scheduleReplayCorrelation();
    updateTps();
    streamTick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
