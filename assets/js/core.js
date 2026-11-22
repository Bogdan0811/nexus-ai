/* =====================================================================
   NEXUS AI Core — общий движок прототипа
   - состояние клиента (синтетические данные), шина событий между вкладками
   - единый сброс сцены (NX.resetAll) и флаг «идёт сброс»
   - Anti-Scam: анализ текста / ссылок, извлечение реквизитов (IOC)
   - жизненный цикл IOC: подозрение → корреляция → подтверждение / снятие
   - Smart Anti-Fraud: скоринг перевода + жёсткие правила из настроек клиента
   - корреляция событий (цепочки атак), CyberScore
   Все данные — синтетические, для демонстрации концепции хакатона.
   Не является продуктом банка-организатора.
   ===================================================================== */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});
  NX.CORE_VERSION = 4; // 3: Финансовая конституция в scoreTransfer; 4: Transaction DNA (r.dna, r.cooling) и Emergency Shield в scoreTransfer

  const KEY_PREFIX = 'nexus_ai_';
  const STORE_KEY = 'nexus_ai_state_v1';
  const INBOX_KEY = 'nexus_ai_inbox_v1';
  const BANK_KEY = 'nexus_ai_bank_v1';
  const IOC_KEY = 'nexus_ai_iocs_v1';
  const BUS_KEY = 'nexus_ai_bus_msg';
  const CONSENT_KEY = 'nexus_ai_consent';
  const RESET_FLAG = 'nexus_ai_resetting';
  const RESET_UNTIL = 'nexus_ai_resetting_until';
  NX.KEYS = { state: STORE_KEY, inbox: INBOX_KEY, bank: BANK_KEY, iocs: IOC_KEY, bus: BUS_KEY, consent: CONSENT_KEY, resetting: RESET_FLAG, resettingUntil: RESET_UNTIL };

  /* ---------------- безопасный доступ к localStorage ---------------- */
  const lsGet = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const lsDel = (k) => { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  /* ---------------- utils ---------------- */
  const nf = new Intl.NumberFormat('ru-RU');
  NX.fmt = (n) => nf.format(Math.round(n)) + ' ₸';
  NX.fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + nf.format(Math.abs(Math.round(n))) + ' ₸';
  NX.num = (n) => nf.format(Math.round(n));
  NX.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  NX.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* <nx-mask-pii> Маскирование ПДн перед LLM — КОПИЯ server/mask-pii.mjs (источник истины).
     Блок самодостаточен: scripts/mask-parity.mjs вырезает его между метками и сравнивает с сервером. */
  NX.maskPII = (function () {
    const MASK_RULES = [
      [/\bKZ[0-9*•]{2}(?:[  ]?[0-9A-Z*•]{4}){2,5}/g, '[счёт]'],
      [/\b\d{4}(?:[  -]?(?:\d{4}|[•*]{4})){3}\b/g, '[карта]'],
      [/\b\d{13,19}\b/g, '[номер]'],
      [/[•*]{4}[  ]?\d{4}\b/g, '[карта]'],
      [/(?:\+7|\b8)[  (-]*\d{3}[  )-]*(?:\d{3}|\*{3}|•{3})[  -]*\d{2}[  -]*\d{2}\b/g, '[телефон]'],
      [/[•*]{5,}\d{0,4}/g, '[номер]'],
      [/\b\d{12}\b/g, '[ИИН]'],
    ];
    const LETTER = 'A-Za-zА-Яа-яЁё';
    const NAME_STOP = ['Арендодатель', 'Пример', 'Инвест', 'Мама', 'Сын', 'Дочь', 'Сестра', 'Брат'];
    function nameStems(names) {
      const stems = [];
      (Array.isArray(names) ? names : []).forEach((n) => {
        (String(n == null ? '' : n).match(/[А-ЯЁA-Z][а-яёa-z]{2,}/g) || []).forEach((w) => {
          if (NAME_STOP.indexOf(w) >= 0) return;
          const s = w.length > 4 && /[аяоеиуыь]$/.test(w) ? w.slice(0, -1) : w;
          if (stems.indexOf(s) < 0) stems.push(s);
        });
      });
      return stems.sort((a, b) => b.length - a.length);
    }
    function maskPII(text, opts) {
      let s = String(text == null ? '' : text);
      MASK_RULES.forEach((r) => { s = s.replace(r[0], r[1]); });
      const stems = opts && Array.isArray(opts.stems) ? opts.stems.filter((w) => typeof w === 'string' && w.length >= 3) : [];
      if (stems.length) {
        const alt = stems.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const rx = new RegExp('(^|[^' + LETTER + '])(?:' + alt + ')[' + LETTER + ']*(?:[ \\u00a0][А-ЯЁA-Z]\\.)?', 'g');
        s = s.replace(rx, '$1[имя]');
      }
      return s;
    }
    maskPII.stems = nameStems;
    return maskPII;
  })();
  /* </nx-mask-pii> */
  NX.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  NX.pad = (n) => String(n).padStart(2, '0');
  NX.time = (ts) => { const d = new Date(ts); return NX.pad(d.getHours()) + ':' + NX.pad(d.getMinutes()) + ':' + NX.pad(d.getSeconds()); };
  NX.hm = (ts) => { const d = new Date(ts); return NX.pad(d.getHours()) + ':' + NX.pad(d.getMinutes()); };
  NX.date = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  NX.dateTime = (ts) => NX.date(ts) + ', ' + NX.hm(ts);
  NX.ago = (ts) => {
    if (!ts) return '—';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 10) return 'только что';
    if (s < 60) return s + ' сек назад';
    if (s < 3600) return Math.round(s / 60) + ' мин назад';
    if (s < 86400) return Math.round(s / 3600) + ' ч назад';
    return Math.round(s / 86400) + ' дн назад';
  };
  // Русские множественные числа: NX.plural(5, ['реквизит', 'реквизита', 'реквизитов']) → 'реквизитов'
  NX.plural = function (n, forms) {
    const f = forms || [];
    const x = Math.abs(Number(n) || 0);
    if (x % 1 !== 0) return f[1];
    const m10 = x % 10, m100 = x % 100;
    if (m10 === 1 && m100 !== 11) return f[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return f[1];
    return f[2];
  };
  // «3 реквизита», «12 инцидентов»
  NX.countOf = (n, forms) => NX.num(n) + ' ' + NX.plural(n, forms);
  NX.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  NX.pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
  // Единые пороги индекса риска 0–100 (как в NX.scanVerdict, Shield и бенчмарке): 55+ — высокий, 25+ — средний
  // Цвета риска = семантика единой тёмной темы (--danger / --warn / --ok)
  NX.RISK_COLORS = { high: '#FF5470', med: '#FFB020', low: '#2DD4A3' };
  NX.level = function (score) {
    if (score >= 55) return { key: 'high', label: 'Высокий риск', color: NX.RISK_COLORS.high, icon: '⛔' };
    if (score >= 25) return { key: 'med', label: 'Средний риск', color: NX.RISK_COLORS.med, icon: '⚠️' };
    return { key: 'low', label: 'Низкий риск', color: NX.RISK_COLORS.low, icon: '✅' };
  };
  NX.riskColor = (s) => (s >= 55 ? NX.RISK_COLORS.high : s >= 25 ? NX.RISK_COLORS.med : NX.RISK_COLORS.low);
  NX.levenshtein = function (a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  };
  // вероятностное объединение весов: 1 - Π(1 - w); результат — индекс риска 0–100
  NX.combine = (weights) => Math.round(100 * (1 - weights.reduce((p, w) => p * (1 - NX.clamp(w, 0, 95) / 100), 1)));

  /* ---------------- флаги URL (?demo=1, ?full=1, ?embed=1, ?present=1, ?fresh=1, ?llm=off) ---------------- */
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { params = null; }
  const pget = (k) => (params ? params.get(k) : null);
  const pflag = (k) => { const v = pget(k); return v === '' || v === '1' || v === 'true' || v === 'on' || v === 'yes'; };
  NX.params = params;
  NX.flags = {
    demo: pflag('demo'),
    full: pflag('full'),
    embed: pflag('embed'),
    present: pflag('present'),
    fresh: pflag('fresh'),
    llmOff: pget('llm') === 'off' || pget('llm') === '0',
    persona: pget('persona') || '',
  };
  // CSS-хуки для страниц: html.nx-embed / nx-demo / nx-full / nx-present (и те же классы на body)
  (function applyFlagClasses() {
    const cls = [];
    ['demo', 'full', 'embed', 'present'].forEach((k) => { if (NX.flags[k]) cls.push('nx-' + k); });
    if (NX.flags.llmOff) cls.push('nx-llm-off');
    if (!cls.length) return;
    const put = (el) => { if (el) cls.forEach((c) => el.classList.add(c)); };
    try { put(document.documentElement); } catch (e) { /* ignore */ }
    if (document.body) put(document.body);
    else document.addEventListener('DOMContentLoaded', () => put(document.body));
  })();

  /* ---------------- справочники ---------------- */
  // icon — имя линейной иконки NX.icon (ui-kit.js), не эмодзи; клиент рисует NX.iconFor(category, amount)
  NX.CATEGORIES = {
    // тона под единую тёмную тему (бренд + семантика), различимы на --panel
    'Продукты': { color: '#2DD4A3', icon: 'cart' },
    'Кафе и рестораны': { color: '#FFB020', icon: 'coffee' },
    'Транспорт': { color: '#38BDF8', icon: 'car' },
    'Подписки': { color: '#8B5CF6', icon: 'refresh' },
    'Коммунальные': { color: '#22D3EE', icon: 'home' },
    'Развлечения': { color: '#F472B6', icon: 'tv' },
    'Здоровье': { color: '#5EEAC0', icon: 'pill' },
    'Онлайн-покупки': { color: '#FF8A5B', icon: 'package' },
    'Переводы': { color: '#95A1BE', icon: 'arrow-up-right' },
    'Доход': { color: '#6366F1', icon: 'arrow-down-left' },
  };
  const MERCHANTS = {
    'Продукты': ['Супермаркет', 'Магазин у дома', 'Гипермаркет', 'Рынок «Зелёный базар»', 'Продуктовый магазин'],
    'Кафе и рестораны': ['Кофейня', 'Пиццерия', 'Кофейня у офиса', 'Кафе национальной кухни', 'Донерная', 'Столовая'],
    'Транспорт': ['Такси', 'Проезд в автобусе', 'АЗС', 'Такси (заказ в приложении)'],
    'Развлечения': ['Кинотеатр', 'Кинотеатр в ТРЦ', 'Боулинг-клуб', 'Магазин игр'],
    'Здоровье': ['Аптека', 'Клиника', 'Аптека у дома'],
    'Онлайн-покупки': ['Маркетплейс', 'Интернет-магазин', 'Интернет-магазин одежды', 'Магазин электроники'],
  };
  const SUBS = [
    { merchant: 'Подписка на сервисы', amount: 1790, day: 3 },
    { merchant: 'Музыкальная подписка', amount: 1890, day: 7 },
    { merchant: 'Облачное хранилище 200 ГБ', amount: 1290, day: 12 },
    { merchant: 'Онлайн-кинотеатр', amount: 2490, day: 15 },
    { merchant: 'Фитнес-клуб', amount: 15000, day: 1 },
    { merchant: 'Облачный VPN', amount: 2200, day: 20 },
  ];
  NX.KNOWN_RECIPIENTS = [
    { id: 'r1', name: 'Гульнара С. (мама)', account: '+7 701 *** 42 18', relation: 'семья' },
    { id: 'r2', name: 'Ерлан К.', account: '+7 707 *** 11 05', relation: 'друг' },
    { id: 'r3', name: 'Арендодатель — Марат Б.', account: 'KZ** **** **** 3391', relation: 'аренда' },
    { id: 'r4', name: 'Динара Ж. (сестра)', account: '+7 747 *** 90 77', relation: 'семья' },
  ];
  // База дропов банка — синтетические реквизиты вымышленной сети (порядок важен: graph.js берёт по индексам)
  NX.MULE_ACCOUNTS = [
    { account: 'KZ86 9KZT 0021 4471 0098', name: 'Сапарбек Т.', note: 'Дроп-счёт, сеть «Safe Account»' },
    { account: '+7 708 555 12 90', name: 'Нурлан А.', note: 'Получатель от 14 жертв за 48 ч' },
    { account: 'KZ41 7KZT 8810 0002 3314', name: 'ТОО «Пример-Инвест» (вымышл.)', note: 'Обнал через криптобиржу' },
    { account: '+7 776 300 44 81', name: 'Азамат Р.', note: 'Транзитный счёт' },
  ];
  NX.OFFICIAL_DOMAINS = ['bcc.kz', 'kaspi.kz', 'halykbank.kz', 'homebank.kz', 'jusan.kz', 'forte.kz', 'bankffin.kz', 'egov.kz', 'gov.kz', 'nationalbank.kz', 'google.com', 'apple.com', 'microsoft.com', 'yandex.kz', 'olx.kz', 'kolesa.kz', 'krisha.kz'];
  // конкретные бренды; общее слово «bank» убрано — оно ложно помечало homebank.kz и другие банки
  const BRAND_WORDS = ['bcc', 'centercredit', 'centrkredit', 'kaspi', 'halyk', 'egov', 'nationalbank', 'olx', 'kolesa', 'demobank'];
  const SHORTENERS = ['bit.ly', 'tinyurl.com', 'goo.gl', 'cutt.ly', 'clck.ru', 'is.gd', 't.co', 'rb.gy', 'shorturl.at', 'u.to', 'qps.ru', 'vk.cc', 'tiny.cc'];
  const RISKY_TLDS = ['xyz', 'top', 'click', 'online', 'site', 'info', 'icu', 'live', 'shop', 'buzz', 'cfd', 'sbs', 'rest', 'win', 'loan', 'work', 'support', 'tk', 'ml', 'ga', 'cf', 'gq', 'pw', 'cc'];
  const DEMO_TLDS = ['test', 'example', 'invalid']; // зарезервированные зоны для демо-доменов
  // Популярные домены, которые никогда не попадают в стоп-лист, даже если их назвал мошенник
  const NEVER_IOC = ['t.me', 'wa.me', 'telegram.org', 'telegram.me', 'whatsapp.com', 'gmail.com', 'mail.ru', 'yandex.ru', 'ya.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'outlook.com', 'icloud.com', 'wildberries.ru', 'wildberries.kz', 'wb.ru', 'ozon.ru', 'ozon.kz', 'kaspi.kz', 'olx.kz', 'youtube.com', 'instagram.com', 'facebook.com', 'vk.com', 'tiktok.com'].concat(SHORTENERS);
  NX.NEVER_IOC = NEVER_IOC;
  const domainIn = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));
  const neverIoc = (host) => !host || domainIn(host, NEVER_IOC) || domainIn(host, NX.OFFICIAL_DOMAINS);

  /* ---------------- начальные данные ---------------- */
  function detectDevice() {
    const ua = navigator.userAgent;
    let os = 'Неизвестная ОС';
    if (/Windows/i.test(ua)) os = 'Windows'; else if (/Android/i.test(ua)) os = 'Android'; else if (/iPhone|iPad/i.test(ua)) os = 'iOS'; else if (/Mac OS/i.test(ua)) os = 'macOS'; else if (/Linux/i.test(ua)) os = 'Linux';
    let br = 'Браузер';
    if (/Edg\//.test(ua)) br = 'Edge'; else if (/OPR\//.test(ua)) br = 'Opera'; else if (/Chrome\//.test(ua)) br = 'Chrome'; else if (/Firefox\//.test(ua)) br = 'Firefox'; else if (/Safari\//.test(ua)) br = 'Safari';
    return { os, browser: br };
  }
  NX.detectDevice = detectDevice;

  function seedState() {
    const r = NX.rng(20251114);
    const now = Date.now();
    const DAY = 86400000;
    const tx = [];
    for (let d = 95; d >= 0; d--) {
      const date = new Date(now - d * DAY);
      const dom = date.getDate();
      const base = new Date(date); base.setHours(9, 0, 0, 0);
      const at = (h) => base.getTime() + h * 3600000 + Math.floor(r() * 3000000);
      if (dom === 5) tx.push({ category: 'Доход', merchant: 'Заработная плата — ТОО «Digital Steppe»', amount: 710000, ts: at(1), type: 'income' });
      if (dom === 20) tx.push({ category: 'Доход', merchant: 'Аванс — ТОО «Digital Steppe»', amount: 300000, ts: at(1), type: 'income' });
      if (dom === 10) tx.push({ category: 'Коммунальные', merchant: 'Коммунальные услуги (Алсеко)', amount: -(26000 + Math.floor(r() * 9000)), ts: at(2), type: 'card' });
      if (dom === 11) tx.push({ category: 'Коммунальные', merchant: 'Мобильная связь и интернет', amount: -8990, ts: at(2), type: 'card' });
      if (dom === 1) tx.push({ category: 'Переводы', merchant: 'Арендодатель — Марат Б.', amount: -220000, ts: at(3), type: 'transfer', recipient: 'r3' });
      SUBS.forEach((s) => { if (dom === s.day) tx.push({ category: 'Подписки', merchant: s.merchant, amount: -s.amount, ts: at(0.5), type: 'card', recurring: true }); });
      const n = 1 + Math.floor(r() * 2.4);
      for (let i = 0; i < n; i++) {
        const cats = ['Продукты', 'Продукты', 'Продукты', 'Кафе и рестораны', 'Кафе и рестораны', 'Транспорт', 'Транспорт', 'Развлечения', 'Здоровье', 'Онлайн-покупки'];
        const c = NX.pick(cats, r);
        const ranges = { 'Продукты': [2500, 18000], 'Кафе и рестораны': [1800, 14000], 'Транспорт': [600, 4500], 'Развлечения': [2500, 12000], 'Здоровье': [1500, 16000], 'Онлайн-покупки': [4000, 25000] };
        const [a, b] = ranges[c];
        // кафе растут в последний месяц — для инсайта
        const boost = c === 'Кафе и рестораны' && d < 30 ? 1.3 : 1;
        tx.push({ category: c, merchant: NX.pick(MERCHANTS[c], r), amount: -Math.round((a + r() * (b - a)) * boost / 10) * 10, ts: at(1 + r() * 12), type: 'card' });
      }
      if (r() < 0.12) {
        const rc = NX.pick(NX.KNOWN_RECIPIENTS.slice(0, 2).concat(NX.KNOWN_RECIPIENTS[3]), r);
        tx.push({ category: 'Переводы', merchant: rc.name, amount: -Math.round((5000 + r() * 45000) / 1000) * 1000, ts: at(8), type: 'transfer', recipient: rc.id });
      }
    }
    tx.forEach((t) => (t.id = NX.uid('tx')));
    tx.sort((a, b) => b.ts - a.ts);
    const dev = detectDevice();
    return {
      version: 2,
      user: { name: 'Айгерим Нурланова', short: 'Айгерим', phone: '+7 701 *** 23 45', iin: '•••••••••456', balance: 1248350, card: '4400 •••• •••• 7781', cardBlocked: false, savings: 2350000 },
      transactions: tx,
      events: [
        { id: NX.uid('ev'), ts: now - 3 * 3600000, type: 'login', source: 'Cyber Security', severity: 'low', title: 'Вход в аккаунт', details: dev.browser + ' · ' + dev.os + ' · доверенное устройство' },
        { id: NX.uid('ev'), ts: now - 26 * 3600000, type: 'scan', source: 'Anti-Scam', severity: 'med', title: 'Проверено подозрительное SMS', details: 'Категория: «Приз / компенсация»' },
      ],
      devices: [
        { id: 'd_cur', name: dev.browser + ' · ' + dev.os, kind: 'web', location: 'Алматы, KZ', lastSeen: now, trusted: true, current: true },
        { id: 'd_ip', name: 'iPhone 14 · iOS 18', kind: 'mobile', location: 'Алматы, KZ', lastSeen: now - 2 * 3600000, trusted: true },
        { id: 'd_old', name: 'Windows · Firefox', kind: 'web', location: 'Астана, KZ', lastSeen: now - 19 * DAY, trusted: false },
      ],
      settings: { twoFA: true, pushAlerts: true, biometrics: true, nightLimit: false, geoLock: false, remoteAccessBlock: true, transferLimit: 1000000, scamCallProtect: false, coolingPeriod: true },
      family: [
        { id: 'f1', name: 'Гульнара Сапарова', relation: 'Мама, 63 года', phone: '+7 701 *** 42 18', protected: true, limit: 150000, alerts: 2, guardian: true },
        { id: 'f2', name: 'Тимур Нурланов', relation: 'Сын, 15 лет', phone: '+7 777 *** 08 31', protected: false, limit: 30000, alerts: 0, guardian: false },
      ],
      subsCancelled: [],
      scans: 7,
      scoreHistory: [61, 63, 62, 66, 68, 67, 71],
      goal: { name: 'Отпуск на Иссык-Куле', target: 900000, saved: 340000 },
    };
  }
  NX.seedState = seedState;

  /* =====================================================================
     СБРОС СЦЕНЫ
     NX.resetAll() — удаляет все ключи nexus_ai_* (кроме согласия), ставит
     флаг «идёт сброс» на 1,5 с, рассылает по шине 'reset' и перезагружает
     вызывающую страницу. Пока NX.isResetting() === true, страницы не должны
     сохранять своё состояние (NX.save уже это соблюдает; bank.js saveB — тоже должен).
     ===================================================================== */
  const RESET_HOLD_MS = 1500;
  function setResetting(ms) {
    lsSet(RESET_FLAG, '1');
    lsSet(RESET_UNTIL, String(Date.now() + (ms || RESET_HOLD_MS)));
    setTimeout(clearResetFlag, (ms || RESET_HOLD_MS) + 50);
  }
  function clearResetFlag() {
    const until = Number(lsGet(RESET_UNTIL) || 0);
    if (until <= Date.now()) { lsDel(RESET_FLAG); lsDel(RESET_UNTIL); }
  }
  NX.isResetting = () => Number(lsGet(RESET_UNTIL) || 0) > Date.now();
  function clearNexusKeys(keepConsent) {
    const keep = [RESET_FLAG, RESET_UNTIL];
    if (keepConsent !== false) keep.push(CONSENT_KEY);
    ['localStorage', 'sessionStorage'].forEach((name) => {
      let store = null;
      try { store = window[name]; } catch (e) { store = null; }
      if (!store) return;
      try {
        const ks = [];
        for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.indexOf(KEY_PREFIX) === 0 && keep.indexOf(k) < 0) ks.push(k); }
        ks.forEach((k) => store.removeItem(k));
      } catch (e) { /* ignore */ }
    });
  }
  // аудио «Голоса из спокойного времени» (Финансовая конституция) хранится в IndexedDB — сброс удаляет и его
  const ANCHOR_DB = 'nexus_ai_anchor';
  function deleteAnchorDb() {
    try { if (window.indexedDB) { const r = window.indexedDB.deleteDatabase(ANCHOR_DB); r.onerror = r.onblocked = function () { /* ignore */ }; } } catch (e) { /* ignore */ }
  }
  NX.KEYS.anchorDb = ANCHOR_DB;
  NX.KEYS.constitution = 'nexus_ai_constitution_v1'; // = NX.Constitution.KEY (constitution.js); банк читает только для показа
  // при загрузке: убрать протухший флаг сброса или дождаться его окончания
  (function () {
    const left = Number(lsGet(RESET_UNTIL) || 0) - Date.now();
    if (left > 0) setTimeout(clearResetFlag, left + 50); else clearResetFlag();
  })();
  // ?fresh=1 — чистый старт этой страницы (параметр убирается из адреса, чтобы перезагрузка не сбрасывала снова)
  if (NX.flags.fresh) {
    setResetting(RESET_HOLD_MS);
    clearNexusKeys(true);
    deleteAnchorDb();
    try {
      params.delete('fresh');
      const q = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- хранилище ---------------- */
  // «Собственное» состояние кабинета (не синтетический профиль другого клиента, который
  // client.js / bank.js временно подставляют в NX.state для скоринга): только к нему применяется
  // Финансовая конституция владельца кабинета.
  const OWN_STATES = typeof WeakSet === 'function' ? new WeakSet() : null;
  const own = (s) => { if (OWN_STATES && s && typeof s === 'object') OWN_STATES.add(s); return s; };
  NX.isOwnState = (s) => !!(OWN_STATES && s && OWN_STATES.has(s));
  function load() {
    try {
      const raw = lsGet(STORE_KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.version === 2) return own(s); }
    } catch (e) { /* ignore */ }
    return own(seedState());
  }
  NX.state = load();
  NX.save = function () {
    if (NX.isResetting()) return false;
    return lsSet(STORE_KEY, JSON.stringify(NX.state));
  };
  NX.resetAll = function (opts) {
    const o = opts || {};
    setResetting(o.holdMs || RESET_HOLD_MS);
    ['Decoy', 'Shield'].forEach((k) => { try { if (NX[k] && typeof NX[k].stop === 'function') NX[k].stop(); } catch (e) { console.error(e); } });
    try { NX.closeModal(); } catch (e) { /* ignore */ }
    clearNexusKeys(o.keepConsent !== false);
    try { if (NX.Constitution && NX.Constitution.anchor) NX.Constitution.anchor.stop(); } catch (e) { /* ignore */ }
    deleteAnchorDb();
    NX.state = own(seedState());
    NX.bus.emit('reset', { t0: Date.now(), page: NX.page || 'unknown' });
    if (o.reload !== false) setTimeout(() => { try { window.location.reload(); } catch (e) { /* ignore */ } }, o.reloadDelay == null ? 80 : o.reloadDelay);
    return true;
  };
  // совместимость: старый сброс без перезагрузки (вызывающий код перезагружает страницу сам)
  NX.reset = function () { return NX.resetAll({ reload: false }); };
  NX.reloadState = function () { NX.state = load(); };

  /* ---------------- шина событий (между вкладками и iframe одного origin) ---------------- */
  const handlers = [];
  let ch = null;
  try { if ('BroadcastChannel' in window) ch = new BroadcastChannel('nexus_ai_bus'); } catch (e) { ch = null; }
  let busMuted = 0; // NX.iocs.sandbox: самопроверка не рассылает события в другие вкладки
  NX.bus = {
    emit(type, payload) {
      const msg = { type, payload, ts: Date.now(), from: NX.page || 'unknown', id: NX.uid('m') };
      if (busMuted) { msg.muted = true; return msg; }
      if (ch) { try { ch.postMessage(msg); } catch (e) { /* ignore */ } }
      lsSet(BUS_KEY, JSON.stringify(msg));
      handlers.forEach((h) => { try { h(msg, true); } catch (e) { console.error(e); } });
      return msg;
    },
    on(fn) { handlers.push(fn); },
    off(fn) { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); },
  };
  // ?fresh=1 очистил хранилище — сообщаем другим открытым вкладкам NEXUS, чтобы они перезагрузились
  // и не записали старое состояние обратно. Обработчиков этой страницы ещё нет, поэтому себе она сигнал не доставит.
  if (NX.flags.fresh) {
    let freshPage = 'unknown';
    try { freshPage = (window.location.pathname.split('/').pop() || '').replace(/\.html?$/i, '') || 'unknown'; } catch (e) { freshPage = 'unknown'; }
    NX.bus.emit('reset', { t0: Date.now(), page: freshPage, fresh: true });
  }
  const seen = new Set();
  function deliver(msg) {
    if (!msg || !msg.id || seen.has(msg.id)) return;
    if (seen.size > 2000) seen.clear();
    seen.add(msg.id);
    handlers.forEach((h) => { try { h(msg, false); } catch (e) { console.error(e); } });
  }
  if (ch) ch.onmessage = (e) => deliver(e.data);
  window.addEventListener('storage', (e) => {
    if (e.key === BUS_KEY && e.newValue) { try { deliver(JSON.parse(e.newValue)); } catch (er) { /* ignore */ } }
  });
  // индикатор связи для stage.html: страница с NX.page отвечает на 'ping' и сообщает 'ready' после загрузки
  NX.bus.on((msg, local) => {
    if (local || !msg) return;
    if (msg.type === 'ping' && NX.page) NX.bus.emit('pong', { page: NX.page, pingId: msg.id, path: window.location.pathname });
  });
  window.addEventListener('load', () => { if (NX.page) NX.bus.emit('ready', { page: NX.page, path: window.location.pathname }); });

  /* «Входящие» банка: инциденты от клиентской части, переживают перезагрузку */
  NX.inbox = {
    all() { try { const l = JSON.parse(lsGet(INBOX_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } },
    push(item) {
      const list = NX.inbox.all(); list.unshift(item);
      lsSet(INBOX_KEY, JSON.stringify(list.slice(0, 100)));
      NX.bus.emit('incident', item);
    },
    clear() { lsDel(INBOX_KEY); },
  };

  /* =====================================================================
     КОЛЛЕКТИВНЫЙ ИММУНИТЕТ — общий стоп-лист реквизитов мошенников (IOC)
     Жизненный цикл (защита от отравления стоп-листа):
       suspected     — один источник: только предупреждение и усиленная проверка перевода
       corroborated  — связь с дроп-сетью (граф / база дропов) или 2+ независимых источника: удержание
       confirmed     — решение аналитика (в UI — в четыре глаза)
       revoked       — снят как ложное срабатывание (обжалование владельцем счёта)
     Доверие: Beta(α, β), α=1, β=3 на старте; conf = α/(α+β).
     ===================================================================== */
  const IOC_KIND = { iban: 'Счёт IBAN', phone: 'Телефон', card: 'Карта', crypto: 'Криптокошелёк', domain: 'Сайт' };
  NX.IOC_KIND = IOC_KIND;
  const IOC_STATUS = { suspected: 'на проверке', corroborated: 'подтверждён корреляцией', confirmed: 'подтверждён аналитиком', revoked: 'снят: ложное срабатывание', expired: 'срок проверки истёк' };
  NX.IOC_STATUS = IOC_STATUS;
  const HOUR = 3600000, DAY_MS = 86400000;
  const IOC_TTL = { suspected: 72 * HOUR, corroborated: 30 * DAY_MS, confirmed: 180 * DAY_MS };
  NX.IOC_TTL = IOC_TTL;
  const IOC_PROTECTED = ['id', 'kind', 'value', 'status', 'alpha', 'beta', 'conf', 'sources', 'signals', 'firstSeen', 'lastSeen', 'lastChange', 'ttl', 'expiresAt', 'history', 'ts', 'source', 'srcMeta'];

  NX.normIoc = (kind, v) => {
    v = String(v == null ? '' : v).trim();
    if (kind === 'phone') { const d = v.replace(/\D/g, ''); return d.length >= 10 ? '+7' + d.slice(-10) : ''; }
    if (kind === 'iban' || kind === 'card') return v.replace(/[\s-]/g, '').toUpperCase();
    if (kind === 'domain') return v.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0].split(':')[0].replace(/\.$/, '');
    if (kind === 'crypto') return v.replace(/\s/g, '');
    return v;
  };
  // Проверка контрольной суммы IBAN (MOD-97, ISO 13616)
  NX.ibanValid = function (iban) {
    const s = String(iban || '').replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[0-9A-Z]{10,30}$/.test(s)) return false;
    if (s.slice(0, 2) === 'KZ' && s.length !== 20) return false;
    const r = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (let i = 0; i < r.length; i++) {
      const c = r.charCodeAt(i);
      const v = c >= 65 ? String(c - 55) : r[i];
      for (let j = 0; j < v.length; j++) rem = (rem * 10 + (v.charCodeAt(j) - 48)) % 97;
    }
    return rem === 1;
  };
  // Поле «счёт получателя» → {kind, value, raw}: IBAN, карта (13–19 цифр), телефон (+7…, 8…, голые 10 цифр), кошелёк
  NX.parseAccount = function (raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    const compact = s.replace(/[\s().-]/g, '');
    if (/^KZ\d{2}[0-9A-Z]{13,30}$/i.test(compact)) return { kind: 'iban', value: compact.toUpperCase(), raw: s };
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(compact)) return { kind: 'crypto', value: compact, raw: s };
    if (/^\+?\d+$/.test(compact)) {
      const d = compact.replace(/\D/g, '');
      const plus = compact.charAt(0) === '+';
      if (!plus && d.length >= 13 && d.length <= 19) return { kind: 'card', value: d, raw: s };
      if (d.length === 10 && d.charAt(0) === '7') return { kind: 'phone', value: '+7' + d, raw: s };
      if (d.length === 11 && (d.charAt(0) === '7' || d.charAt(0) === '8') && d.charAt(1) === '7') return { kind: 'phone', value: '+7' + d.slice(1), raw: s };
    }
    const ex = NX.extractIocs(s);
    return ex.length ? ex[0] : null;
  };
  function muleIndex() {
    return NX.MULE_ACCOUNTS.map((m) => { const p = NX.parseAccount(m.account); return p ? { kind: p.kind, value: p.value, mule: m } : null; }).filter(Boolean);
  }
  // NX.findMule('87085551290') или NX.findMule('phone', '+77085551290') → запись из NX.MULE_ACCOUNTS
  NX.findMule = function (kind, value) {
    const p = value === undefined ? NX.parseAccount(kind) : { kind, value: NX.normIoc(kind, value) };
    if (!p || !p.value) return null;
    const hit = muleIndex().find((m) => m.kind === p.kind && m.value === p.value);
    return hit ? hit.mule : null;
  };

  NX.extractIocs = function (text) {
    let t = String(text || '');
    const out = [];
    const add = (kind, raw) => { const value = NX.normIoc(kind, raw); if (value && !out.some((o) => o.kind === kind && o.value === value)) out.push({ kind, value, raw: String(raw).trim() }); };
    const blank = (m) => new Array(m.length + 1).join(' ');
    // IBAN и карты вырезаем из текста, чтобы их цифры не распознались повторно как телефон/карта
    t = t.replace(/\bKZ\d{2}(?:[\s-]?[0-9A-Z]{4}){3,4}\b/gi, (m) => { add('iban', m); return blank(m); });
    t = t.replace(/\b(?:\d{4}[\s-]?){3}\d{4}\b/g, (m) => { add('card', m); return blank(m); });
    (t.match(/(?:\+7|\b8)[\s(-]*7\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g) || []).forEach((m) => add('phone', m));
    (t.match(/\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g) || []).forEach((m) => add('crypto', m));
    // домен — только явно подозрительный (индекс ≥ 30) и не из списка популярных сервисов
    extractUrls(t).forEach((u) => { const r = NX.analyzeUrl(u); if (!r.official && r.domain && r.score >= 30 && !neverIoc(r.domain)) add('domain', r.domain); });
    return out;
  };

  function iocConf(r) { return Math.round((r.alpha / (r.alpha + r.beta)) * 100) / 100; }
  function upgradeIoc(r) {
    // записи старого формата (без жизненного цикла) становятся «на проверке»
    if (!r || typeof r !== 'object') return null;
    if (!r.status) r.status = 'suspected';
    if (r.alpha == null) r.alpha = 1;
    if (r.beta == null) r.beta = 3;
    if (!Array.isArray(r.sources)) r.sources = r.source ? [r.source] : [];
    if (!Array.isArray(r.signals)) r.signals = [];
    if (!Array.isArray(r.srcMeta)) r.srcMeta = r.sources.map((s) => ({ source: s, session: '', client: '' }));
    if (!r.firstSeen) r.firstSeen = r.ts || Date.now();
    if (!r.ts) r.ts = r.firstSeen;
    if (!r.lastSeen) r.lastSeen = r.firstSeen;
    if (!r.lastChange) r.lastChange = r.firstSeen;
    if (!r.ttl) r.ttl = IOC_TTL[r.status] || IOC_TTL.suspected;
    if (!r.expiresAt) r.expiresAt = r.lastChange + r.ttl;
    if (!Array.isArray(r.history)) r.history = [];
    if (!r.id) r.id = 'ioc_' + r.kind + '_' + r.value;
    r.conf = iocConf(r);
    return r;
  }
  let iocMem = null; // NX.iocs.sandbox: стоп-лист в памяти вместо localStorage
  const iocLoad = () => {
    try { const l = JSON.parse((iocMem ? iocMem.v : lsGet(IOC_KEY)) || '[]'); return Array.isArray(l) ? l.map(upgradeIoc).filter(Boolean) : []; } catch (e) { return []; }
  };
  const iocSave = (list) => { const v = JSON.stringify(list.slice(0, 300)); if (iocMem) { iocMem.v = v; return true; } return lsSet(IOC_KEY, v); };
  function effStatus(r, now) {
    if (!r) return null;
    if (r.status === 'revoked') return 'revoked';
    if (r.expiresAt && (now || Date.now()) > r.expiresAt) return 'expired';
    return r.status;
  }
  const isActive = (st) => st === 'suspected' || st === 'corroborated' || st === 'confirmed';
  NX.iocActive = isActive;
  function matchRec(r, kind, value) {
    if (kind && r.kind !== kind) return false;
    return r.value === value || r.value === NX.normIoc(r.kind, value);
  }
  function setIocStatus(r, status, by, why, now) {
    const prev = r.status;
    r.status = status; r.lastChange = now;
    if (IOC_TTL[status]) { r.ttl = IOC_TTL[status]; r.expiresAt = now + r.ttl; }
    r.history.push({ ts: now, action: status, from: prev, by: by || 'NEXUS', why: why || '' });
    if (r.history.length > 30) r.history = r.history.slice(-30);
    r.conf = iocConf(r);
  }
  /* Независимость источников. meta.session — id одного инцидента (звонок и его передача приманке — один id).
     Источники с одним и тем же session (в том числе тот же meta.client в той же сессии) — это один источник:
     они видны в r.sources, но не повышают доверие и не переводят 'suspected' в 'corroborated'.
     r.srcMeta = [{source, session, client, dependent?}]; сигналы графа и базы дропов — отдельные независимые сигналы. */
  function srcMetaOf(r) {
    if (!Array.isArray(r.srcMeta)) r.srcMeta = (r.sources || []).map((s) => ({ source: s, session: '', client: '' }));
    return r.srcMeta;
  }
  function independentCount(r) {
    const metas = srcMetaOf(r);
    const keys = [];
    // группы независимости: один и тот же клиент (его звонок, приманка, жалоба) — один источник; затем одна сессия
    // считаем по записям srcMeta, а не по названиям: два клиента с одной меткой («NEXUS Decoy», «Safe Return») — два источника
    (r.sources || []).forEach((label) => {
      const ms = metas.filter((x) => x.source === label && !x.dependent);
      if (!ms.length) { if (!metas.some((x) => x.source === label)) ms.push({ source: label, session: '', client: '' }); }
      ms.forEach((m) => {
        const key = m.client ? 'c:' + m.client : m.session ? 's:' + m.session : 'l:' + label;
        if (keys.indexOf(key) < 0) keys.push(key);
      });
    });
    return keys.length;
  }
  NX.iocIndependentSources = (r) => (r ? independentCount(r) : 0);
  // сколько независимых ИСТОЧНИКОВ-сообщений (клиенты, сессии), без сигналов графа и базы дропов
  function reporterCount(r) {
    const metas = srcMetaOf(r);
    const keys = [];
    metas.forEach((m) => {
      if (m.dependent || m.signal || m.source === 'Граф связей' || m.source === 'База дропов банка') return;
      const key = m.client ? 'c:' + m.client : m.session ? 's:' + m.session : 'l:' + m.source;
      if (keys.indexOf(key) < 0) keys.push(key);
    });
    return keys.length;
  }
  // действующее удержание одним аналитиком (NX.iocs.hold)
  NX.iocHeld = (r) => !!(r && r.status !== 'revoked' && r.hold && Number(r.hold.until) > Date.now());
  function promoteIoc(r, by, why, now) {
    r.conf = iocConf(r);
    if (r.status === 'suspected' && (r.conf >= 0.7 || independentCount(r) >= 2)) {
      setIocStatus(r, 'corroborated', by, why || 'Подтверждено корреляцией: ' + r.sources.join(' + '), now);
      return true;
    }
    return false;
  }
  // src: имя источника ('NEXUS Decoy') | 'graph' | 'mule' | {signal:'graph'|'mule'|'source', source, by, why, synthetic?}
  // meta: {session, client} источника (из NX.iocs.add)
  function corroborateRec(r, src, now, meta) {
    const o = typeof src === 'string' ? (src === 'graph' || src === 'mule' ? { signal: src } : { source: src }) : (src || {});
    const signal = o.signal === 'graph' || o.signal === 'mule' ? o.signal : 'source';
    const label = o.source || (signal === 'graph' ? 'Граф связей' : signal === 'mule' ? 'База дропов банка' : 'Источник');
    if (r.status === 'revoked') return { changed: false, promoted: false };
    const mt = meta && typeof meta === 'object' ? meta : {};
    const session = mt.session != null ? String(mt.session) : (o.session != null ? String(o.session) : '');
    const client = mt.client != null ? String(mt.client) : (o.client != null ? String(o.client) : '');
    const metas = srcMetaOf(r);
    let changed = false;
    let dependentOn = null;
    let sameLabelReporter = false; // та же метка источника, но другой клиент и другая сессия — новый независимый отчёт
    const findDep = () => metas.find((x) => (session && x.session && x.session === session) || (client && x.client && x.client === client)) || null;
    if (signal !== 'source') {
      if (r.signals.indexOf(signal) < 0) { r.signals.push(signal); r.alpha += 2; changed = true; }
      if (signal === 'graph' && o.synthetic) r.syntheticGraph = true;
    } else if (r.sources.indexOf(label) < 0) {
      dependentOn = findDep();
      if (!dependentOn) { r.alpha += 1; changed = true; }
    } else if ((session || client) && !findDep()) {
      // независимость решают клиент и сессия, а не текст метки
      sameLabelReporter = true;
      r.alpha += 1;
      metas.push({ source: label, session, client, dependent: false });
      changed = true;
    }
    if (r.sources.indexOf(label) < 0) {
      r.sources.push(label);
      metas.push({ source: label, session: signal === 'source' ? session : '', client: signal === 'source' ? client : '', dependent: !!dependentOn, signal: signal !== 'source' ? signal : undefined });
      changed = true;
    }
    r.lastSeen = now;
    let why = o.why || (signal === 'graph' ? 'Связь с дроп-сетью в графе' : signal === 'mule' ? 'Совпадение с базой дропов банка' : dependentOn ? 'Тот же инцидент, что и «' + dependentOn.source + '» — не независимый источник, статус не повышается' : sameLabelReporter ? 'Независимый отчёт: ' + label + ' (другой клиент или сессия)' : 'Независимый источник: ' + label);
    if (signal === 'graph' && o.synthetic && !/сгенерир/i.test(why)) why += ' (в демо история счетов в графе сгенерирована; в продакшене — реальные транзакции)';
    if (changed) {
      const h = { ts: now, action: 'corroborate', by: o.by || label, why };
      if (dependentOn) h.dependent = true;
      if (signal === 'graph' && o.synthetic) h.synthetic = true;
      r.history.push(h); if (r.history.length > 30) r.history = r.history.slice(-30);
    }
    const promoted = dependentOn ? false : promoteIoc(r, o.by || label, why, now);
    r.conf = iocConf(r);
    return { changed: changed || promoted, promoted, dependent: !!dependentOn };
  }
  function pickMeta(meta) {
    const out = {};
    if (meta && typeof meta === 'object') Object.keys(meta).forEach((k) => { if (IOC_PROTECTED.indexOf(k) < 0) out[k] = meta[k]; });
    return out;
  }
  function mutateIoc(value, kind, action, fn) {
    const now = Date.now();
    const list = iocLoad();
    const r = list.find((x) => matchRec(x, kind || null, value));
    if (!r) return null;
    const prev = r.status;
    if (fn(r, now)) {
      iocSave(list);
      NX.bus.emit('ioc_update', { item: r, action, from: prev, t0: now });
    }
    return r;
  }

  NX.iocs = {
    all() { return iocLoad(); },
    // только действующие (не сняты и не истекли)
    active() { const now = Date.now(); return iocLoad().filter((r) => isActive(effStatus(r, now))); },
    // find(kind, value) или find(value) — запись в любом статусе либо null
    find(kind, value) {
      if (value === undefined) { value = kind; kind = null; }
      return iocLoad().find((r) => matchRec(r, kind, value)) || null;
    },
    get(kind, value) { return NX.iocs.find(kind, value); },
    // 'suspected' | 'corroborated' | 'confirmed' | 'revoked' | 'expired' | null (нет в стоп-листе)
    status(kind, value) { const r = NX.iocs.find(kind, value); return r ? effStatus(r) : null; },
    label(status) { return IOC_STATUS[status] || status || ''; },
    // items: [{kind, value?, raw}] (обычно из NX.extractIocs). Возвращает массив НОВЫХ записей;
    // уже известные действующие реквизиты — в result.seen (и bus 'ioc_seen'); снятые аналитиком — в result.inactive
    // (без 'ioc_seen': они не в стоп-листе). Второй НЕЗАВИСИМЫЙ источник повышает статус;
    // meta.session — id инцидента: источники одной сессии независимыми не считаются.
    add(items, source, meta) {
      const now = Date.now();
      const src = source || 'NEXUS';
      const list = iocLoad();
      const fresh = [], seenItems = [], updated = [], inactive = [];
      const srcSession = meta && meta.session != null ? String(meta.session) : '';
      const srcClient = meta && meta.client != null ? String(meta.client) : '';
      (items || []).forEach((it) => {
        if (!it || !it.kind) return;
        const value = NX.normIoc(it.kind, it.value != null ? it.value : it.raw);
        if (!value) return;
        if (it.kind === 'domain' && neverIoc(value)) return;
        const ex = list.find((x) => x.kind === it.kind && x.value === value);
        if (ex) {
          const before = ex.status;
          if (effStatus(ex, now) === 'expired') setIocStatus(ex, 'suspected', src, 'Повторно замечен после истечения срока проверки', now);
          const res = corroborateRec(ex, src, now, { session: srcSession, client: srcClient });
          const stNow = effStatus(ex, now);
          const snap = Object.assign({}, ex, { status: stNow, seenBy: src, matched: it.raw || value, dependent: !!res.dependent });
          if (isActive(stNow)) seenItems.push(snap); else inactive.push(snap);
          if (res.changed || ex.status !== before) updated.push({ item: ex, from: before });
          return;
        }
        const rec = Object.assign(pickMeta(it), pickMeta(meta), {
          id: NX.uid('ioc'), kind: it.kind, value, raw: String(it.raw || it.value || value).trim(),
          ts: now, firstSeen: now, lastSeen: now, lastChange: now,
          source: src, sources: [src], signals: [], srcMeta: [{ source: src, session: srcSession, client: srcClient }],
          status: 'suspected', alpha: 1, beta: 3, conf: 0.25, ttl: IOC_TTL.suspected, expiresAt: now + IOC_TTL.suspected,
          history: [{ ts: now, action: 'suspected', by: src, why: 'Реквизит извлечён: ' + src }],
        });
        // реквизит уже есть в базе дропов банка — это корреляция
        if (NX.findMule(rec.kind, rec.value)) corroborateRec(rec, { signal: 'mule' }, now);
        list.unshift(rec); fresh.push(rec);
      });
      if (fresh.length || updated.length) iocSave(list);
      const client = (meta && meta.client) || (NX.state && NX.state.user ? NX.state.user.name : '');
      if (fresh.length) NX.bus.emit('ioc', { items: fresh, source: src, client, t0: now });
      if (seenItems.length) NX.bus.emit('ioc_seen', { items: seenItems, source: src, client, t0: now });
      updated.forEach((u) => NX.bus.emit('ioc_update', { item: u.item, action: 'corroborate', from: u.from, t0: now }));
      fresh.seen = seenItems;
      fresh.inactive = inactive;
      return fresh;
    },
    // корреляция: 'graph' (связь с дроп-сетью, α+=2), 'mule' (база дропов, α+=2) или имя 2-го источника (α+=1)
    corroborate(value, sourceOrSignal, kind) {
      return mutateIoc(value, kind, 'corroborate', (r, now) => corroborateRec(r, sourceOrSignal || 'graph', now).changed);
    },
    // ручное решение аналитика (вторую подпись обеспечивает UI банка)
    // opts.allowRevoked — только решение в четыре глаза может вернуть снятый реквизит
    confirm(value, by, why, kind, opts) {
      return mutateIoc(value, kind, 'confirm', (r, now) => {
        if (r.status === 'confirmed') return false;
        if (r.status === 'revoked' && !(opts && opts.allowRevoked)) return false;
        r.alpha += 5;
        setIocStatus(r, 'confirmed', by || 'Аналитик', why || 'Подтверждено аналитиком', now);
        return true;
      });
    },
    // удержание счёта одним аналитиком (hold 72 ч): переводы на реквизит удерживаются, но статус НЕ становится
    // «подтверждён аналитиком» — для этого нужны две подписи (confirm из UI банка)
    hold(value, by, why, kind, ms) {
      return mutateIoc(value, kind, 'hold', (r, now) => {
        if (r.status === 'revoked') return false;
        r.hold = { by: by || 'Аналитик', why: why || 'Операции по счёту приостановлены аналитиком', at: now, until: now + (Number(ms) || 72 * 3600 * 1000) };
        r.lastChange = now;
        r.history.push({ ts: now, action: 'hold', from: r.status, by: r.hold.by, why: r.hold.why + ' · одна подпись, статус не меняется' });
        if (r.history.length > 30) r.history = r.history.slice(-30);
        return true;
      });
    },
    revoke(value, by, why, kind) {
      return mutateIoc(value, kind, 'revoke', (r, now) => {
        if (r.status === 'revoked') return false;
        r.beta += 10;
        setIocStatus(r, 'revoked', by || 'Аналитик', why || 'Снят как ложное срабатывание', now);
        r.revokedAt = now;
        return true;
      });
    },
    clear() { if (iocMem) iocMem.v = '[]'; else lsDel(IOC_KEY); },
    // Самопроверка (bench.html, часть 3): fn() работает с пустым стоп-листом в памяти, шина молчит.
    // Настоящий стоп-лист этого браузера и другие вкладки не затрагиваются. fn — синхронная.
    sandbox(fn) {
      const prevMem = iocMem;
      iocMem = { v: '[]' }; busMuted++;
      try { return fn(); } finally { iocMem = prevMem; busMuted--; }
    },
  };
  // Какие реквизиты из текста уже известны: действующие записи стоп-листа + база дропов (mule:true, ts:null).
  // opts.mules === false — без базы дропов; opts.includeInactive — также снятые/истёкшие.
  NX.iocHits = function (text, opts) {
    const o = opts || {};
    const found = NX.extractIocs(text);
    if (!found.length) return [];
    const now = Date.now();
    const known = iocLoad();
    const out = [];
    found.forEach((x) => {
      const r = known.find((k) => k.kind === x.kind && k.value === x.value);
      const st = r ? effStatus(r, now) : null;
      if (r && (isActive(st) || o.includeInactive)) { out.push(Object.assign({}, r, { status: st, matched: x.raw })); return; }
      if (o.mules !== false) {
        const m = NX.findMule(x.kind, x.value);
        if (m) out.push({ kind: x.kind, value: x.value, raw: m.account, matched: x.raw, source: 'База дропов банка', sources: ['База дропов банка'], status: 'confirmed', mule: true, name: m.name, note: m.note, ts: null, firstSeen: null });
      }
    });
    return out;
  };

  /* ---------------- события Core ---------------- */
  // ev.manual === true — действие самого клиента (ручная проверка); Core такие события не считает атакой
  NX.addEvent = function (ev) {
    const e = Object.assign({ id: NX.uid('ev'), ts: Date.now(), severity: 'low' }, ev);
    if (e.manual) e.manual = true;
    NX.state.events.unshift(e);
    NX.state.events = NX.state.events.slice(0, 200);
    NX.save();
    NX.bus.emit('event', e);
    return e;
  };

  /* =====================================================================
     ANTI-SCAM: анализ текста, ссылок, номеров
     ===================================================================== */
  const PATTERNS = [
    { re: /служб\w*\s+безопасност|отдел\w*\s+безопасност|security\s+(team|department|service)|қауіпсіздік\s+қызмет/i, w: 32, cat: 'Ложная служба безопасности', why: 'Ссылка на «службу безопасности банка» — главный сценарий социальной инженерии' },
    { id: 'codes', re: /(код|пароль|cvv|cvc|пин|pin|sms-код|смс-код)[\s\S]{0,50}(смс|sms|назов|назв|продикт|сообщ|отправ|введ|скаж)|(назов|назв|продикт|сообщите|отправьте|скажите|введите)[\s\S]{0,40}(код|пароль|cvv|cvc|пин)/i, ask: true, w: 42, cat: 'Выманивание кодов', why: 'Просьба сообщить код / пароль / CVV. Банк никогда не запрашивает эти данные' },
    { re: /карт\w*[\s\S]{0,20}(заблокир|блокир|приостановл|огранич)|сч[её]т\w*[\s\S]{0,20}(заблокир|арест|замороз|огранич)|подозрительн\w*\s+(операц|списан|вход|транзакц|попытк)/i, w: 26, cat: 'Ложная блокировка', why: 'Сообщение о блокировке / подозрительной операции — повод вызвать панику' },
    { re: /срочно|немедленно|в\s+течени[еи]\s+\d+\s*(мин|час)|последн\w+\s+предупрежд|сегодня\s+до|шұғыл|тез\s+арада|urgent|immediately|within\s+\d+\s*(min|hour)/i, w: 14, why: 'Давление срочностью — мошенники не дают времени подумать' },
    { re: /безопасн\w*\s+сч[её]т|резервн\w*\s+сч[её]т|защищ[её]нн\w*\s+сч[её]т|специальн\w*\s+сч[её]т|переведите\s+(все|деньги|средства|сбережени)|қауіпсіз\s+шот/i, ask: true, w: 40, cat: 'Ложная служба безопасности', why: '«Безопасный счёт» — несуществующее понятие, деньги уходят мошенникам' },
    { re: /выигр|приз\b|призов|розыгрыш|подарок|подарочн|вы\s+выбраны|компенсаци|возврат\s+средств|ұтыс|сыйлық|winner|you\s+won|free\s+gift|claim\s+your/i, w: 22, cat: 'Приз / компенсация', why: 'Обещание выигрыша или компенсации — приманка для ввода данных карты' },
    { re: /доходност\w*\s*(до\s*)?\d+\s*%|гарантированн\w+\s+(доход|прибыл)|удво\w+\s+(деньг|вклад)|x\d+\s+за\s+\d+/i, w: 34, cat: 'Инвестиционный скам', why: 'Гарантированная высокая доходность — признак финансовой пирамиды' },
    { re: /пассивн\w+\s+доход|арбитраж\w*|крипт\w+|заработ\w*\s+от\s+\d+|доход\s+от\s+\d+/i, w: 26, cat: 'Инвестиционный скам', why: 'Обещание лёгкого заработка / криптоарбитража' },
    { re: /\bмам[аоу]?\b[\s\S]{0,30}(помоги|срочно|деньг|скинь|переведи)|сынок|доченьк|попал[аи]?\s+в\s+(беду|аварию|полицию|дтп)|у\s+меня\s+новый\s+номер|это\s+я[,!]|телефон\s+(разбил|сломал|потерял)|займи|скинь\s+\d+/i, w: 28, cat: '«Родственник в беде»', why: 'Просьба о деньгах от имени родственника с незнакомого номера' },
    { re: /(перейд\w*|нажм\w*|откро\w*|войд\w*|подтверд\w*|обнов\w*|верифиц\w*|авториз\w*)[\s\S]{0,40}(ссылк|по\s+ссылке|link|данн|личн\w+\s+кабинет|аккаунт)/i, ask: true, w: 16, why: 'Призыв перейти по ссылке и ввести данные' },
    { re: /\b(telegram|whatsapp|телеграм\w*|ватсап\w*|вотсап\w*|вайбер\w*|viber)\b|t\.me\//i, w: 9, why: 'Перевод общения в мессенджер, где сложнее проверить собеседника' },
    { re: /anydesk|teamviewer|rustdesk|quick\s*support|rms\s+удал|удал[её]нн\w+\s+(доступ|помощ)|демонстрац\w+\s+экрана|скачайте\s+приложение|установите\s+(приложение|программу)/i, ask: true, w: 40, cat: 'Удалённый доступ', why: 'Просьба установить приложение / дать удалённый доступ к телефону' },
    { re: /\b(егов|egov|налогов\w*|штраф\w*|пенсион\w*|енпф|соцвыплат\w*|пособи\w*|госуслуг\w*)\b/i, w: 10, why: 'Упоминание госорганов и выплат — частый предлог' },
    { re: /предоплат\w*|оплат\w+\s+доставк\w*|доставк\w*\s+оплат|гарант\w*\s+сделк|безопасн\w*\s+сделк/i, ask: true, w: 18, cat: 'Мошенничество с объявлениями', why: 'Предоплата / «безопасная сделка» по ссылке — схема с площадками объявлений' },
    { re: /полици\w*|следовател\w*|прокурат\w*|\bкнб\b|финпол\w*|\bафм\b|задержан\w*|уголовн\w*\s+дел/i, w: 22, cat: 'Лжеправоохранители', why: 'Звонок/сообщение от «полиции» или «следователя» с требованием содействия' },
    { re: /кредит\w*[\s\S]{0,25}(оформлен|на\s+ваше\s+имя|одобрен)|на\s+вас\s+(оформ|пытаются)|заявк\w*\s+на\s+кредит/i, w: 28, cat: 'Ложная служба безопасности', why: '«На вас оформляют кредит» — популярный сценарий давления' },
    { re: /данн\w*\s+карт|номер\s+карт\w*[\s\S]{0,20}(срок|cvv|введите)|реквизит\w*\s+карт|срок\s+действия\s+карт/i, ask: true, w: 25, cat: 'Фишинг', why: 'Запрос реквизитов карты' },
    { re: /новый\s+номер|это\s+я[,!]|телефон\s+(разбил|сломал|потерял)|пишу\s+с\s+(чужого|другого)/i, w: 25, cat: '«Родственник в беде»', why: '«Новый номер» / «разбил телефон» — типичное начало схемы с родственником' },
    { re: /(скинь|скиньте|переведи|переведите|займи|одолжи|кинь)[\s\S]{0,25}\d{3,}|на\s+карту\s+(друга|подруги|знакомого)|потом\s+(всё|все)\s+объясню/i, ask: true, w: 24, cat: '«Родственник в беде»', why: 'Срочная просьба перевести деньги на чужую карту' },
    { id: 'isolation', re: /не\s+(кладите|отключайтесь|прерывайте)|никому\s+не\s+(говорите|рассказывайте)|никому\s+не\s+(сообщайте|говорите|рассказывайте)\s+(о|об|про)\s|оставайтесь\s+на\s+линии|конфиденциальн\w+\s+(процедур|информац|разговор)|не\s+сообщайте\s+(родственникам|близким|в\s+банк)/i, w: 32, cat: 'Ложная служба безопасности', why: 'Требование не класть трубку и никому не рассказывать — изоляция жертвы' },
    { re: /!!!|\$\$\$|💰|🎁|🔥{2,}/, w: 6, why: 'Агрессивное оформление сообщения' },
    { re: /проверочн\w*\s+сч[её]т|сч[её]т[\s-]+дубликат|перезвоните\s+по\s+(номеру|телефону)/i, ask: true, w: 30, cat: 'Ложная служба безопасности', why: '«Проверочный счёт» / «перезвоните по номеру» — уводят с официального канала банка' },
    /* ---- қазақ тілі (KZ). Отрицания вида «кодты ешкімге айтпаңыз» сюда не попадают: «айтпаңыз» ≠ «айтыңыз» ---- */
    { re: /(код\w*|құпия\s*сөз\w*)[\s\S]{0,30}(айтыңыз|айтшы|жіберіңіз|жібер(?![а-яёәғқңөұүһі])|хабарлаңыз|енгізіңіз)/i, ask: true, w: 42, cat: 'Выманивание кодов', why: 'KZ: просьба назвать или отправить код (кодты айтыңыз / жіберіңіз)' },
    { re: /қашықтан\s*қосыл|бағдарлама\w*\s*орнат|қосымша\w*\s*(жүктеп\s*ал|орнат)/i, ask: true, w: 40, cat: 'Удалённый доступ', why: 'KZ: просьба установить программу / удалённое подключение к телефону' },
    { re: /несие\w*\s*(рәсімдел|ресімдел|алын|ашыл)|атыңызға\s*(несие|кредит|займ)/i, w: 28, cat: 'Ложная служба безопасности', why: 'KZ: «на вас оформляют кредит» (несие рәсімделуде)' },
    { re: /өтемақы|ұтып\s*алдыңыз|жүлде/i, w: 22, cat: 'Приз / компенсация', why: 'KZ: обещание компенсации или выигрыша (өтемақы / ұтып алдыңыз)' },
    { re: /ақша\w*\s*керек|аударып\s*жібер|жіберіңізші|салып\s*жібер/i, ask: true, w: 24, cat: '«Родственник в беде»', why: 'KZ: срочная просьба перевести деньги (ақша керек / аударып жібер)' },
    { re: /телефоным\s*(бұзылды|сынды|жоғалды)|жаңа\s*(нөмір|номер)/i, w: 25, cat: '«Родственник в беде»', why: 'KZ: «телефон сломался / новый номер» — начало схемы с родственником' },
    { re: /күдікті\s*(төлем|операция|әрекет|аударым)|(карта|шот)\w*\s*бұғатта/i, w: 26, cat: 'Ложная блокировка', why: 'KZ: «подозрительная операция / карта блокируется»' },
    { re: /банк\s*қызметкері/i, w: 20, cat: 'Ложная служба безопасности', why: 'KZ: звонящий называет себя сотрудником банка (банк қызметкері)' },
    { re: /карта\w*\s*деректер/i, ask: true, w: 25, cat: 'Фишинг', why: 'KZ: запрос данных карты (карта деректері)' },
    { re: /сілтеме\w*\s*(арқылы|өт)/i, ask: true, w: 16, why: 'KZ: призыв перейти по ссылке (сілтеме арқылы)' },
  ];

  /* \w и \b в JS не понимают кириллицу — переводим шаблоны в Unicode-режим.
     Где lookbehind поддерживается — точная эмуляция \b; иначе (Safari < 16.4) — вариант без lookbehind:
     \b в начале слова → (?:^|[^\p{L}\p{N}_]), в конце слова → (?![\p{L}\p{N}_]). */
  const W_CLASS = '[\\p{L}\\p{N}_]', NW_CLASS = '[^\\p{L}\\p{N}_]';
  let HAS_LOOKBEHIND = false;
  try { HAS_LOOKBEHIND = new RegExp('(?' + '<=a)b', 'u').test('ab'); } catch (e) { HAS_LOOKBEHIND = false; }
  NX.HAS_LOOKBEHIND = HAS_LOOKBEHIND;
  function boundaryKind(src, i) { // i — индекс обратного слэша перед «b»
    if (i === 0) return 'start';
    const p = src[i - 1];
    const escaped = i >= 2 && src[i - 2] === '\\' && !(i >= 3 && src[i - 3] === '\\');
    if (escaped) return p === 'd' || p === 'w' ? 'end' : 'start';
    if (p === '(' || p === '|' || p === '^') return 'start';
    if ((p === ':' || p === '=' || p === '!') && (src[i - 2] === '?' || src[i - 2] === '<')) return 'start';
    return 'end';
  }
  function unicodeSource(src, useLookbehind) {
    let out = '', inClass = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') {
        const n = src[i + 1];
        if (n === undefined) { out += c; continue; }
        if (!inClass && n === 'w') { out += W_CLASS; i++; continue; }
        if (!inClass && n === 'W') { out += NW_CLASS; i++; continue; }
        if (!inClass && n === 'b') {
          if (useLookbehind) out += '(?:(?' + '<=' + W_CLASS + ')(?!' + W_CLASS + ')|(?' + '<!' + W_CLASS + ')(?=' + W_CLASS + '))';
          else out += boundaryKind(src, i) === 'start' ? '(?:^|' + NW_CLASS + ')' : '(?!' + W_CLASS + ')';
          i++; continue;
        }
        out += c + n; i++; continue;
      }
      if (c === '[' && !inClass) inClass = true;
      else if (c === ']' && inClass) inClass = false;
      out += c;
    }
    return out;
  }
  // opts.lookbehind === false — принудительно вариант без lookbehind (проверка совместимости со старым Safari)
  NX.uRe = function (re, opts) {
    const flags = 'iu' + (re.flags && re.flags.indexOf('g') >= 0 ? 'g' : '');
    if (HAS_LOOKBEHIND && !(opts && opts.lookbehind === false)) { try { return new RegExp(unicodeSource(re.source, true), flags); } catch (e) { /* пробуем без lookbehind */ } }
    try { return new RegExp(unicodeSource(re.source, false), flags); } catch (e) { return re; }
  };
  PATTERNS.forEach((p) => (p.re = NX.uRe(p.re)));

  // Отрицания вида «никому не сообщайте код» — это предупреждение банка, а не просьба мошенника
  const NEG_ANY_SRC = 'никому\\s+не\\s+(?:сообщайте|говорите|передавайте|показывайте|называйте|диктуйте|пересылайте)|не\\s+(?:сообщайте|говорите|передавайте|показывайте|называйте|диктуйте|пересылайте)(?![а-яё])|ешкімге\\s+(?:айтпаңыз|бермеңіз|хабарламаңыз|көрсетпеңіз)';
  const NEG_CODE_SRC = 'никому\\s+не\\s+(?:сообщайте|говорите|передавайте|показывайте|называйте)\\s+(?:этот\\s+|данный\\s+|ваш\\s+)?(?:код|пароль|cvv|pin|пин)|(?:код|пароль)[^.!?\\n]{0,30}никому\\s+не\\s+(?:сообщайте|говорите|передавайте|показывайте|называйте)';
  const NEG_ANY_RE = new RegExp(NEG_ANY_SRC, 'gi');
  const NEG_ANY_TEST = new RegExp(NEG_ANY_SRC, 'i');
  const NEG_CODE_RE = new RegExp(NEG_CODE_SRC, 'gi');
  const OTP_CODE_RE = /(^|\D)\d{4,6}(\D|$)/;
  const MONEY_ASK_RE = /(переведи|переведите|перечисли|перечислите|отправь(те)?\s+(деньги|средства|сумму)|оплатите|внесите|пополните|безопасн[а-яё]*\s+сч[её]т|аударыңыз|жіберіңіз)/i;

  function extractUrls(text) {
    const re = /((?:https?:\/\/|www\.)[^\s<>"'«»]+|\b[a-z0-9][a-z0-9-]{1,62}(?:\.[a-z0-9-]{1,62})*\.(?:kz|ru|com|net|org|xyz|top|click|online|site|info|icu|live|shop|io|me|cc|ly|gl|to|pw|tk|support|win|loan|buzz|app|link|su|uz|kg|gd|at|test|example)(?:\/[^\s<>"'«»]*)?)/gi;
    const out = [];
    let m;
    while ((m = re.exec(text))) { const u = m[1].replace(/[),.;!?]+$/, ''); if (!out.includes(u)) out.push(u); }
    return out;
  }
  NX.extractUrls = extractUrls;

  NX.analyzeUrl = function (raw) {
    let s = String(raw || '').trim();
    const flags = [];
    if (!s) return { url: s, domain: '', score: 0, flags };
    if (!/^[a-z]+:\/\//i.test(s)) s = 'http://' + s;
    let u;
    try { u = new URL(s); } catch (e) { return { url: raw, domain: raw, score: 40, flags: [{ w: 40, why: 'Некорректный адрес ссылки' }] }; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.');
    const tld = parts[parts.length - 1];
    const reg = parts.slice(-2).join('.');
    const label = parts.length >= 2 ? parts[parts.length - 2] : host;
    const official = domainIn(host, NX.OFFICIAL_DOMAINS);
    if (official) {
      flags.push({ w: 0, why: 'Домен ' + reg + ' — в списке проверенных', good: true });
      if (u.protocol === 'http:' && /^https?:/i.test(raw)) flags.push({ w: 10, why: 'Соединение без HTTPS' });
      return { url: raw, domain: host, score: NX.combine(flags.map((f) => f.w)), flags, official: true };
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) flags.push({ w: 45, why: 'Вместо домена используется IP-адрес' });
    if (host.includes('xn--')) flags.push({ w: 45, why: 'Punycode-домен (возможна подмена символов)' });
    if (SHORTENERS.includes(host)) flags.push({ w: 30, why: 'Сокращённая ссылка скрывает реальный адрес' });
    if (RISKY_TLDS.includes(tld)) flags.push({ w: 28, why: 'Домен в зоне .' + tld + ' — часто используется для фишинга' });
    if (DEMO_TLDS.includes(tld)) flags.push({ w: 28, why: 'Демо-домен в зарезервированной зоне .' + tld + ' (в реальном фишинге — .top, .xyz, .online)' });
    const brand = BRAND_WORDS.find((b) => host.includes(b));
    if (brand) flags.push({ w: 45, why: 'Имитирует бренд «' + brand + '», но не является официальным доменом' });
    const look = ['bcc', 'kaspi', 'halykbank', 'egov', 'centercredit'].find((b) => label !== b && label.length > 2 && NX.levenshtein(label, b) <= (b.length > 5 ? 2 : 1));
    if (look && !brand) flags.push({ w: 50, why: 'Домен «' + label + '» визуально похож на «' + look + '» (тайпсквоттинг)' });
    if ((host.match(/-/g) || []).length >= 2) flags.push({ w: 14, why: 'Много дефисов в домене' });
    if (parts.length >= 4) flags.push({ w: 12, why: 'Глубокая вложенность поддоменов' });
    if (/login|verify|secure|update|confirm|account|bonus|prize|gift|pay|wallet|kyc|auth|support|unblock|refund/i.test(host + u.pathname)) flags.push({ w: 20, why: 'Ключевые слова фишинга в адресе (login / verify / secure…)' });
    if (u.username || String(raw).includes('@')) flags.push({ w: 35, why: 'Символ «@» в ссылке маскирует настоящий адрес' });
    if (u.protocol === 'http:' && /^http:/i.test(raw)) flags.push({ w: 12, why: 'Соединение без HTTPS' });
    if (host.length > 30) flags.push({ w: 8, why: 'Подозрительно длинное имя домена' });
    if (/\.(apk|exe|scr|bat|msi)$/i.test(u.pathname)) flags.push({ w: 50, why: 'Ссылка ведёт на исполняемый файл / APK' });
    if (!flags.length) flags.push({ w: 8, why: 'Домен не найден в базе проверенных — будьте внимательны' });
    return { url: raw, domain: host, score: NX.combine(flags.map((f) => f.w)), flags };
  };

  // Уровень, вердикт и советы по индексу риска 0–100 (общие для SMS, звонков и ручных проверок)
  NX.scanVerdict = function (score) {
    const level = score >= 55 ? 'high' : score >= 25 ? 'med' : 'low';
    const verdict = level === 'high' ? 'Мошенничество: высокий индекс риска' : level === 'med' ? 'Подозрительное сообщение' : 'Явных признаков мошенничества нет';
    const advice = level === 'high'
      ? ['Не переходите по ссылкам и не перезванивайте по номерам из сообщения', 'Никому не сообщайте коды из SMS, CVV и пароли', 'Если вы уже ввели данные — сразу заблокируйте карту в разделе «Помощь → Проверка защиты»', 'Позвоните в банк по номеру на обороте карты']
      : level === 'med'
        ? ['Проверьте отправителя через официальное приложение банка', 'Не торопитесь — мошенники давят срочностью', 'Откройте сайт банка вручную, а не по ссылке']
        : ['Сообщение выглядит безопасным, но всегда проверяйте отправителя', 'Банк не запрашивает коды и пароли ни при каких условиях'];
    return { level, verdict, advice };
  };

  // Оговорки-предупреждения: «банк никогда не просит коды…», «банк ешқашан кодты сұрамайды» — это памятка, а не схема
  const NEG_WARN_RE = /никогда\s+не\s+(?:просят|просит|запрашивают|запрашивает|требуют|требует|звонят|звонит|присылают|присылает|предлагают|предлагает)[^.!?\n]{0,100}|ешқашан[^.!?\n]{0,80}(?:сұрамайды|талап\s+етпейді|хабарласпайды)/gi;
  // Предлоги социальной инженерии (кто «звонит» и под каким поводом)
  const PRETEXT_CATS = ['Ложная служба безопасности', 'Лжеправоохранители', 'Приз / компенсация', 'Инвестиционный скам', '«Родственник в беде»', 'Ложная блокировка', 'Мошенничество с объявлениями'];
  NX.scanText = function (text) {
    const t = String(text || '');
    const tw = t.replace(NEG_WARN_RE, ' ');
    const warnClause = tw !== t;
    const tCodes = tw.replace(NEG_ANY_RE, ' ');
    const tIso = tw.replace(NEG_CODE_RE, ' ');
    const reasons = [];
    const cats = {};
    const addCat = (c, w) => { cats[c] = (cats[c] || 0) + w; };
    const chain = { pretext: [], ask: [], pressure: [] };
    PATTERNS.forEach((p) => {
      const src = p.id === 'codes' ? tCodes : p.id === 'isolation' ? tIso : tw;
      const m = src.match(p.re);
      if (!m) return;
      reasons.push({ w: p.w, why: p.why, match: String(m[0]).trim().slice(0, 40), id: p.id || null });
      if (p.cat) addCat(p.cat, p.w);
      if (p.ask) chain.ask.push(p.cat || 'просьба о действии');
      else if (p.id === 'isolation' || /срочност/.test(p.why)) chain.pressure.push(p.id === 'isolation' ? 'изоляция' : 'срочность');
      else if (p.cat && PRETEXT_CATS.indexOf(p.cat) >= 0 && p.w >= 20) chain.pretext.push(p.cat);
    });
    const urls = extractUrls(t);
    const urlResults = urls.map(NX.analyzeUrl);
    urlResults.forEach((r) => {
      if (r.official) return;
      if (r.score >= 20) { reasons.push({ w: Math.min(70, r.score), why: 'Подозрительная ссылка: ' + r.domain, sub: r.flags.map((f) => f.why) }); addCat('Фишинг', r.score); }
      else reasons.push({ w: 6, why: 'Ссылка на непроверенный домен: ' + r.domain });
    });
    const phones = t.match(/(\+\d[\d\s()-]{8,}\d)/g) || [];
    phones.forEach((p) => {
      const clean = p.replace(/[^\d+]/g, '');
      if (!/^\+7/.test(clean)) reasons.push({ w: 18, why: 'Международный номер ' + p.trim() + ' — звонки из-за рубежа часто мошеннические' });
    });
    // стоп-лист коллективного иммунитета и база дропов (с нормализацией: 8708…, +7 708…, карта без пробелов)
    const hits = NX.iocHits(t);
    hits.forEach((h) => {
      const kind = IOC_KIND[h.kind] || 'Реквизит';
      if (h.mule) {
        reasons.push({ w: 60, key: 'mule', why: kind + ' ' + h.matched + ' есть в базе дропов банка (синтетические данные): ' + h.note });
        addCat('Известная мошенническая сеть', 100);
        return;
      }
      const strong = h.status === 'corroborated' || h.status === 'confirmed';
      reasons.push({
        w: strong ? 70 : 45, key: strong ? 'ioc' : 'ioc_suspected', status: h.status,
        why: 'Коллективный иммунитет: ' + kind + ' ' + h.raw + (strong ? ' — в стоп-листе NEXUS (' + IOC_STATUS[h.status] + ')' : ' — на проверке в стоп-листе NEXUS (один источник)') + '. Источник: ' + (h.sources && h.sources.length ? h.sources.join(', ') : h.source) + ', ' + NX.ago(h.firstSeen || h.ts),
      });
      addCat('Известная мошенническая сеть', strong ? 100 : 50);
    });
    // Связка стадий социальной инженерии: предлог или давление + просьба о действии (код, перевод, установка, данные, ссылка).
    // Каждый признак по отдельности встречается и в честных сообщениях; вместе — это сценарий атаки.
    if (urlResults.some((r) => !r.official && r.score >= 20)) chain.ask.push('ссылка');
    if (MONEY_ASK_RE.test(tw) || NX.extractIocs(t).some((x) => x.kind !== 'domain')) chain.ask.push('перевод');
    if (chain.ask.length && (chain.pretext.length || chain.pressure.length)) {
      const full = chain.pretext.length && chain.pressure.length;
      const lead = chain.pretext[0] || chain.pressure[0];
      reasons.push({ w: full ? 35 : 25, key: 'chain', why: 'Связка признаков: ' + lead + (full && chain.pretext.length ? ' + ' + chain.pressure[0] : '') + ' + просьба о действии (' + chain.ask[0] + ') — цепочка социальной инженерии, а не отдельное слово' });
    }
    if (warnClause && !reasons.length) reasons.push({ w: 0, good: true, key: 'warning', why: 'Похоже на памятку банка: «никогда не просим…» — предупреждение, а не просьба' });
    // настоящее OTP-SMS: короткий код + «никому не сообщайте», без ссылок, номеров, просьб о деньгах и других схем
    const strongOther = reasons.some((r) => r.w >= 20 && r.id !== 'codes' && r.id !== 'isolation' && r.key !== 'chain');
    const benignOtp = OTP_CODE_RE.test(t) && NEG_ANY_TEST.test(t) && !urls.length && !phones.length && !hits.length &&
      !NX.extractIocs(t).length && !MONEY_ASK_RE.test(t) && !strongOther;
    let score = reasons.length ? NX.combine(reasons.map((r) => r.w)) : 0;
    if (benignOtp) {
      score = Math.min(score, 15);
      reasons.push({ w: 0, good: true, key: 'otp_benign', why: 'Похоже на настоящее SMS с одноразовым кодом: код и предупреждение «никому не сообщайте», без ссылок, номеров и просьб о переводе' });
    }
    const catSorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const category = benignOtp ? 'Не выявлено' : catSorted.length ? catSorted[0][0] : score >= 30 ? 'Социальная инженерия' : 'Не выявлено';
    const v = NX.scanVerdict(score);
    reasons.sort((a, b) => b.w - a.w);
    return { score, level: v.level, verdict: v.verdict, category, reasons, urls: urlResults, advice: v.advice, iocHits: hits, benignOtp };
  };

  /* =====================================================================
     NEXUS AI Core — корреляция событий
     Учитываются только события за 60 минут, не помеченные resolved и manual.
     ===================================================================== */
  const WINDOW = 60 * 60 * 1000; // окно корреляции — 60 минут
  const coreRelevant = (e, now) => !!e && !e.resolved && !e.manual && now - e.ts < WINDOW;
  NX.Core = {
    WINDOW,
    signals() {
      const now = Date.now();
      const recent = (NX.state.events || []).filter((e) => coreRelevant(e, now));
      const has = (fn) => recent.find(fn);
      return {
        recent,
        scam: has((e) => (e.type === 'scan' || e.type === 'sms') && e.severity === 'high'),
        link: has((e) => e.type === 'link_click'),
        newDevice: has((e) => e.type === 'new_device'),
        remote: has((e) => e.type === 'remote_access'),
        call: has((e) => e.type === 'scam_call' || e.type === 'voice_fake'),
        passwordChange: has((e) => e.type === 'password_change'),
      };
    },
    // Общая оценка ситуации клиента прямо сейчас
    assess() {
      const s = NX.Core.signals();
      const parts = [];
      if (s.scam) parts.push({ w: 30, key: 'scam', t: 'Получено мошенническое сообщение', ev: s.scam });
      if (s.link) parts.push({ w: 25, key: 'link', t: 'Переход по подозрительной ссылке', ev: s.link });
      if (s.newDevice) parts.push({ w: 30, key: 'device', t: 'Вход с нового устройства', ev: s.newDevice });
      if (s.remote) parts.push({ w: 40, key: 'remote', t: 'Обнаружено ПО удалённого доступа', ev: s.remote });
      if (s.call) parts.push({ w: 30, key: 'call', t: 'Недавно (за 60 мин) распознан звонок мошенника / синтетический голос', ev: s.call });
      if (s.passwordChange) parts.push({ w: 15, key: 'pwd', t: 'Смена пароля', ev: s.passwordChange });
      let score = NX.combine(parts.map((p) => p.w));
      // бонус за цепочку: несколько разнородных сигналов подряд = атака
      if (parts.length >= 2) score = Math.min(100, score + 8 * (parts.length - 1));
      const chain = parts.length >= 2;
      return { score, chain, parts, level: NX.level(score) };
    },
    // Пометить все события окна как разобранные (угроза устранена / демо закрыто). Возвращает их число.
    resolveAll(reason) {
      const now = Date.now();
      let n = 0;
      (NX.state.events || []).forEach((e) => { if (e && !e.resolved && now - e.ts < WINDOW) { e.resolved = true; e.resolvedAt = now; if (reason) e.resolvedReason = reason; n++; } });
      if (n) { NX.save(); NX.bus.emit('core_resolved', { count: n, reason: reason || '' }); }
      return n;
    },
  };

  /* =====================================================================
     SMART ANTI-FRAUD — скоринг перевода
     score — индекс риска 0–100 по факторам; decision — max(решение по индексу, жёсткие правила).
     Правила из настроек клиента и стоп-листа возвращаются в r.rules и как факторы {rule:true, w:0}.
     ===================================================================== */
  const DECISION_RANK = { allow: 0, confirm: 1, block: 2 };
  NX.scoreTransfer = function (input) {
    const inp = input || {};
    const st = NX.state;
    const set = st.settings || {};
    const amount = Number(inp.amount) || 0;
    const acc = String(inp.account || '').trim();
    if (amount <= 0) return { score: 0, factors: [], level: NX.level(0), decision: 'none', scoreDecision: 'none', rules: [], chain: false, mule: null, ioc: null, account: null };
    const factors = [];
    const rules = [];
    const transfers = st.transactions.filter((t) => t.type === 'transfer' && t.amount < 0);
    const avg = transfers.length ? transfers.reduce((s, t) => s + -t.amount, 0) / transfers.length : 30000;
    const known = NX.KNOWN_RECIPIENTS.find((r) => r.id === inp.recipientId);
    const parsed = !known && acc ? NX.parseAccount(acc) : null;
    const mule = parsed ? NX.findMule(parsed.kind, parsed.value) : null;
    if (mule) {
      factors.push({ w: 75, key: 'mule', t: 'Получатель в базе дропов банка', d: mule.note + ' (синтетические данные)' });
      rules.push({ key: 'mule', decision: 'block', t: 'Получатель в базе дропов банка' });
    }
    let ioc = null;
    if (!known && !mule && acc) {
      let rec = parsed ? NX.iocs.find(parsed.kind, parsed.value) : null;
      if (rec && !isActive(effStatus(rec))) rec = null;
      if (!rec) rec = NX.iocHits(acc, { mules: false })[0] || null;
      if (rec) {
        const stt = effStatus(rec);
        ioc = { id: rec.id, kind: rec.kind, value: rec.value, raw: rec.raw, status: stt, label: IOC_STATUS[stt], source: rec.source, sources: (rec.sources || [rec.source]).slice(), firstSeen: rec.firstSeen || rec.ts, ts: rec.ts, conf: rec.conf,
          // на чём держится статус: несколько независимых источников, связь в графе или база дропов (для честного объяснения DNA)
          basis: reporterCount(rec) >= 2 ? 'sources' : (rec.signals || []).indexOf('graph') >= 0 ? 'graph' : (rec.signals || []).indexOf('mule') >= 0 ? 'mule' : '',
          syntheticGraph: !!rec.syntheticGraph };
        const strong = stt === 'corroborated' || stt === 'confirmed';
        const heldOnly = !strong && NX.iocHeld(rec);
        ioc.held = NX.iocHeld(rec);
        if (strong) {
          factors.push({ w: 80, key: 'ioc', t: 'Реквизит в стоп-листе NEXUS: ' + IOC_STATUS[stt], d: 'Источник: ' + ioc.sources.join(', ') + ' · получен ' + NX.ago(ioc.firstSeen) });
          rules.push({ key: 'ioc', decision: 'block', t: 'Получатель в стоп-листе (' + IOC_STATUS[stt] + ')' });
        } else if (heldOnly) {
          factors.push({ w: 80, key: 'ioc', t: 'Счёт получателя удержан аналитиком банка (hold 72 ч)', d: 'Решение одного аналитика; подтверждение в стоп-листе — две подписи' });
          rules.push({ key: 'ioc', decision: 'block', t: 'Счёт получателя удержан аналитиком (hold 72 ч)' });
        } else {
          factors.push({ w: 40, key: 'ioc_suspected', t: 'Реквизит на проверке в стоп-листе NEXUS', d: 'Один источник (' + ioc.source + ', ' + NX.ago(ioc.firstSeen) + ') — усиленная проверка; сам по себе реквизит перевод не удерживает' });
          rules.push({ key: 'ioc_suspected', decision: 'confirm', t: 'Получатель на проверке в стоп-листе' });
        }
      }
    }
    // контрольная сумма — только для неизвестных реквизитов: совпадение с базой дропов или стоп-листом важнее опечатки
    if (parsed && parsed.kind === 'iban' && !mule && !ioc && !NX.ibanValid(parsed.value)) factors.push({ w: 20, key: 'iban_checksum', t: 'IBAN не проходит проверку контрольной суммы', d: 'Возможна опечатка или несуществующий счёт — сверьте реквизиты' });
    if (!known) factors.push({ w: 18, key: 'new_recipient', t: 'Новый получатель', d: 'Вы ещё ни разу не переводили на этот счёт' });
    if (amount > avg * 4) {
      const ratio = Math.round((amount / avg) * 10) / 10;
      factors.push({ w: 22, key: 'amount_ratio', ratio, avg: Math.round(avg), t: 'Сумма нетипична для вас', d: 'В ' + String(ratio).replace('.', ',') + '× больше среднего перевода (' + NX.fmt(avg) + ')' });
    }
    if (amount > st.user.balance * 0.5) factors.push({ w: 18, key: 'half_balance', t: 'Перевод более 50% баланса', d: 'Мошенники стремятся вывести всё сразу' });
    // суточный лимит: выполненные сегодня исходящие переводы (удержанные не считаются) + этот перевод
    const limit = Number(set.transferLimit) || 0;
    const now = inp.now ? new Date(inp.now) : new Date();
    if (limit) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const dayEnd = dayStart + 86400000;
      const spentToday = st.transactions.reduce((s, t) => (t && t.type === 'transfer' && t.amount < 0 && t.status !== 'blocked' && t.ts >= dayStart && t.ts < dayEnd ? s + -t.amount : s), 0);
      const dayTotal = spentToday + amount;
      if (dayTotal > limit) {
        factors.push({ w: 15, key: 'over_limit', spentToday, dayTotal, t: 'Превышен ваш суточный лимит переводов', d: (spentToday > 0 ? 'Сегодня уже переведено ' + NX.fmt(spentToday) + ', с этим переводом — ' + NX.fmt(dayTotal) : 'Сумма ' + NX.fmt(amount)) + ' при лимите ' + NX.fmt(limit) + ' в сутки' });
        rules.push({ key: 'over_limit', decision: 'confirm', t: 'Переводы за сутки выше вашего лимита ' + NX.fmt(limit) });
      }
    }
    const h = now.getHours();
    if (h < 6) factors.push({ w: 12, key: 'night', t: 'Ночное время операции', d: 'Нетипичное время для ваших переводов' });
    if (set.nightLimit && h < 6 && amount > 50000) rules.push({ key: 'night_limit', decision: 'block', t: 'Ночной лимит: не более 50 000 ₸ с 00:00 до 06:00' });
    if (inp.onCall) factors.push({ w: 38, key: 'on_call', t: 'Во время перевода идёт звонок', d: 'Вас могут направлять по телефону' });
    if (inp.thirdParty) factors.push({ w: 30, key: 'third_party', t: 'Перевод по просьбе третьего лица', d: 'Классический признак социальной инженерии' });
    const purpose = String(inp.purpose || '');
    if (/безопасн|резервн|служб|защит|полиц|следоват|инвест|доход|предоплат|кредит|страхов|сохран|деклар/i.test(purpose)) factors.push({ w: 30, key: 'purpose', t: 'Подозрительное назначение платежа', d: '«' + purpose.slice(0, 40) + '»' });
    const recent = st.transactions.filter((t) => t.type === 'transfer' && Date.now() - t.ts < 15 * 60000).length;
    if (recent >= 2) factors.push({ w: 14, key: 'series', t: 'Серия переводов за 15 минут', d: NX.countOf(recent, ['перевод', 'перевода', 'переводов']) + ' подряд' });
    // контекст от NEXUS AI Core
    const core = NX.Core.assess();
    core.parts.forEach((p) => factors.push({ w: Math.round(p.w * 0.9), key: 'core_' + p.key, t: p.t, d: 'Недавний сигнал NEXUS · ' + NX.ago(p.ev.ts), core: true }));
    const coreHas = (k) => core.parts.some((p) => p.key === k);
    // жёсткие правила из настроек «Безопасность»
    if (set.scamCallProtect && (inp.onCall || coreHas('call'))) rules.push({ key: 'scam_call_protect', decision: 'block', t: 'Защита от звонков мошенников: переводы во время подозрительного звонка удерживаются' });
    else if (coreHas('call')) rules.push({ key: 'scam_call', decision: 'confirm', t: 'Недавно распознан звонок мошенника — нужно подтверждение' });
    if (set.remoteAccessBlock && coreHas('remote')) rules.push({ key: 'remote_access', decision: 'block', t: 'Обнаружено ПО удалённого доступа — переводы приостановлены' });
    if (set.geoLock && coreHas('device')) rules.push({ key: 'geo_lock', decision: 'block', t: 'Гео-защита: после входа с нового устройства переводы удерживаются' });
    // Emergency Shield (rescue.js): новые получатели удерживаются, остальные переводы — только с подтверждением
    const em = st.emergency && st.emergency.active ? st.emergency : null;
    if (em) {
      const ea = em.actions || {};
      if (!known) rules.push({ key: 'emergency', decision: 'block', t: '«Заблокировать всё»: переводы новым получателям удерживаются для проверки' });
      else if (ea.blockNewTransfers !== false) rules.push({ key: 'emergency_confirm', decision: 'confirm', t: '«Заблокировать всё»: переводы проходят только после повторного подтверждения' });
    }
    // Transaction DNA (dna.js): профиль обычных переводов клиента + контекст (звонок, сигналы Core, попытки ослабить защиту)
    const ownState = NX.isOwnState(st);
    const Cx = NX.Constitution;
    const sdkCall = ownState && Cx && typeof Cx.isCallActive === 'function' && Cx.isCallActive();
    const callNow = !!(inp.onCall || inp.callActive) || !!sdkCall;
    const flagOf = mule ? 'mule' : ioc && isActive(ioc.status) ? ioc.status : null;
    let dna = null, dnaNoFlag = null;
    if (NX.DNA && typeof NX.DNA.assess === 'function') {
      try {
        const sig = NX.Core.signals();
        let weaken = (sig.recent || []).some((e) => e.type === 'limit_change_attempt' || e.type === 'limit_change_held');
        if (!weaken && ownState && Cx && typeof Cx.weakenAttempts === 'function') weaken = Cx.weakenAttempts(WINDOW).length > 0;
        let planned = false;
        if (ownState && Cx && Cx.plans && typeof Cx.plans.match === 'function') {
          const pm = Cx.plans.match({ recipientId: known ? known.id : null, recipientName: String(inp.name || (known ? known.name : acc) || ''), account: known ? known.account : acc, amount });
          planned = !!(pm && pm.within);
        }
        const dctx = { state: st, callActive: callNow, scamSignal: !!(sig.scam || sig.call), weakenAttempt: weaken, emergency: !!em, planned };
        const dtx = { amount, newRecipient: !known, recipientId: known ? known.id : null, recipient: String(inp.name || (known ? known.name : '') || ''), now: now.getTime(), recipientFlag: flagOf, recipientFlagBasis: ioc && !mule ? ioc.basis : '', recipientFlagSynthetic: !!(ioc && ioc.syntheticGraph), balance: st.user ? st.user.balance : 0 };
        dna = NX.DNA.assess(dtx, dctx);
        // защита от отравления стоп-листа: реквизит «на проверке» сам по себе не доводит DNA до удержания
        if (dna && dna.tier === 'hold' && flagOf === 'suspected') {
          dnaNoFlag = NX.DNA.assess(Object.assign({}, dtx, { recipientFlag: null }), Object.assign({}, dctx, { profile: dna.profile }));
          if (dnaNoFlag.tier !== 'hold') dna = NX.DNA.assess(dtx, Object.assign({}, dctx, { profile: dna.profile, maxTier: 'cooling' }));
        }
      } catch (e) { console.error(e); dna = null; }
    }
    if (dna) {
      if (dna.tier === 'hold') rules.push({ key: 'dna_hold', decision: 'block', dna: true, t: 'Не похоже на ваш обычный перевод — перевод удержан для проверки банком' });
      else if (dna.tier === 'cooling') rules.push({ key: 'dna_cooling', decision: 'confirm', dna: true, t: 'Не похоже на ваш обычный перевод — пауза 60 секунд' });
      else if (dna.tier === 'check') rules.push({ key: 'dna_check', decision: 'confirm', dna: true, t: 'Не похоже на ваш обычный перевод — дополнительная проверка' });
    }
    // Финансовая конституция клиента — его собственные правила против манипуляций (только для своего кабинета).
    // confirm → 'confirm', hold/protect → 'block'. Статья 2 — выбор самого клиента: реквизит «на проверке» удерживается.
    let constitution = null;
    const C = NX.Constitution;
    const useConst = inp.constitution === true || (inp.constitution !== false && NX.isOwnState(st));
    if (useConst && C && typeof C.evaluate === 'function') {
      try {
        const callNow = !!(inp.onCall || inp.callActive) || (typeof C.isCallActive === 'function' && C.isCallActive());
        const ev = C.evaluate({
          amount, known: !!known, newRecipient: !known, recipientId: known ? known.id : null,
          recipientName: String(inp.name || (known ? known.name : acc) || ''), account: known ? known.account : acc,
          accountKind: parsed ? parsed.kind : null, ioc: ioc ? { status: ioc.status } : null, mule: !!mule,
          avg: Math.round(avg), callActive: callNow, now: now.getTime(),
        });
        if (ev && Array.isArray(ev.hits)) {
          constitution = { hits: ev.hits, decision: ev.decision, protective: !!ev.protective, protectiveTriggered: !!ev.protectiveTriggered, guardian: ev.guardian || null };
          ev.hits.forEach((hh) => {
            const key = hh.kind === 'protective_mode' ? 'const_protective' : 'const_' + hh.n;
            rules.push({ key, decision: hh.decision === 'confirm' ? 'confirm' : 'block', t: 'Статья ' + hh.n + ' вашей конституции: ' + hh.title, constitution: true, articleN: hh.n, constDecision: hh.decision, why: hh.why });
          });
        }
      } catch (e) { console.error(e); constitution = null; }
    }

    let score = factors.length ? NX.combine(factors.map((f) => f.w)) : 4;
    if (known && !factors.length) score = 3;
    if (core.chain) score = Math.min(100, score + 10);
    factors.sort((a, b) => b.w - a.w);
    const byScore = (s) => (s >= 60 ? 'block' : s >= 30 ? 'confirm' : 'allow');
    let scoreDecision = byScore(score);
    // Защита от отравления стоп-листа: реквизит «на проверке» (один источник) сам по себе не удерживает перевод.
    // Удержание остаётся, только если его дают остальные факторы без этого реквизита или сработало жёсткое правило.
    let iocCapped = false;
    if (ioc && ioc.status === 'suspected' && scoreDecision === 'block' && !rules.some((r) => r.decision === 'block')) {
      const rest = factors.filter((f) => f.key !== 'ioc_suspected');
      let restScore = rest.length ? NX.combine(rest.map((f) => f.w)) : 4;
      if (core.chain) restScore = Math.min(100, restScore + 10);
      if (byScore(restScore) !== 'block') { scoreDecision = 'confirm'; iocCapped = true; }
    }
    // факторы DNA — после индекса риска: у DNA свой индекс (r.dna.index) и своё решение (правило dna_*),
    // в общий индекс они не складываются повторно (новый получатель, сумма, звонок уже учтены выше)
    if (dna) dna.factors.forEach((f) => factors.push({ w: f.points, key: 'dna_' + f.key, t: f.label, d: f.detail, dna: true, combo: !!f.combo }));
    let decision = scoreDecision;
    rules.forEach((r) => {
      r.applied = DECISION_RANK[r.decision] > DECISION_RANK[scoreDecision];
      if (DECISION_RANK[r.decision] > DECISION_RANK[decision]) decision = r.decision;
    });
    // правила, которые изменили решение, показываем первыми (без веса — они не влияют на индекс)
    rules.filter((r) => r.applied && !r.constitution).reverse().forEach((r) => factors.unshift({
      w: 0, rule: true, key: 'rule_' + r.key, t: 'Правило: ' + r.t,
      d: r.decision === 'block' ? 'Перевод удерживается для проверки независимо от индекса риска' : 'Нужно подтверждение независимо от индекса риска',
    }));
    if (iocCapped) factors.unshift({
      w: 0, rule: true, key: 'rule_ioc_suspected_cap', t: 'Правило: реквизит на проверке (один источник) — без удержания',
      d: 'Индекс риска высокий, но реквизит пока не подтверждён корреляцией или аналитиком — нужно ваше подтверждение, перевод не удерживается',
    });
    // статьи конституции — первыми: это решение самого клиента, принятое заранее, в спокойной обстановке
    let protectiveTriggered = false;
    if (constitution) {
      const cr = rules.filter((r) => r.constitution);
      const g = constitution.guardian;
      if (g && DECISION_RANK[decision] >= DECISION_RANK.block) {
        // обещаем запрос, только если он действительно уйдёт (статья 5 включена)
        if (g.needed && g.enabled !== false) {
          factors.unshift({ w: 0, rule: true, constitution: true, key: 'const_' + (g.articleN || 5), t: 'Статья ' + (g.articleN || 5) + ' вашей конституции: доверенное лицо', d: g.name + ' (' + g.relation + ') получит запрос и поможет проверить ситуацию' });
        } else if (g.enabled === false) {
          factors.unshift({ w: 0, rule: true, constitution: true, key: 'const_' + (g.articleN || 5), t: 'Статья ' + (g.articleN || 5) + ' вашей конституции: доверенное лицо выключено', d: 'Ваше правило требует подтверждения доверенного лица, но статья ' + (g.articleN || 5) + ' выключена — запрос не отправляется. Перевод удерживается до проверки банком' });
        }
      }
      cr.slice().reverse().forEach((r) => factors.unshift({
        w: 0, rule: true, constitution: true, key: r.key, articleN: r.articleN, decision: r.constDecision, applied: !!r.applied,
        t: r.t,
        d: r.why + (r.constDecision === 'protect' ? '. Перевод удерживается, защитный режим включится на 24 часа' : r.decision === 'block' ? '. Перевод удерживается для проверки' : '. Нужно повторное подтверждение'),
      }));
      protectiveTriggered = !!constitution.protectiveTriggered;
    }
    const out = { score, factors, level: NX.level(score), decision, scoreDecision, rules, chain: core.chain, mule, ioc, account: parsed, iocCapped };
    if (constitution) { out.constitution = constitution; out.protectiveTriggered = protectiveTriggered; }
    if (dna) {
      out.dna = { index: dna.index, tier: dna.tier, tierLabel: dna.tierLabel, action: dna.action, explain: dna.explain, safePath: dna.safePath, capped: !!dna.capped, factors: dna.factors.map((f) => Object.assign({}, f)), profile: dna.profile ? { txCount: dna.profile.txCount, typical: dna.profile.typical, maxToNew: dna.profile.maxToNew, knownRecipients: dna.profile.knownRecipients, dayShare: dna.profile.dayShare, usualHours: dna.profile.usualHours, summary: dna.profile.summary } : null };
      if (dna.tier === 'cooling' && decision !== 'block') out.cooling = { seconds: 60, reason: dna.explain };
    }
    if (em) out.emergency = { active: true, at: em.at || null };
    return out;
  };

  /* =====================================================================
     CYBERSCORE (индекс защиты)
     ===================================================================== */
  NX.cyberScore = function () {
    const st = NX.state, s = st.settings;
    const items = [
      { key: 'twoFA', ok: s.twoFA, pts: 15, t: 'Двухфакторная аутентификация', fix: 'Включить 2FA' },
      { key: 'biometrics', ok: s.biometrics, pts: 8, t: 'Вход по биометрии', fix: 'Включить биометрию' },
      { key: 'pushAlerts', ok: s.pushAlerts, pts: 6, t: 'Push-уведомления об операциях', fix: 'Включить уведомления' },
      { key: 'remoteAccessBlock', ok: s.remoteAccessBlock, pts: 10, t: 'Блокировка при удалённом доступе', fix: 'Включить защиту' },
      { key: 'scamCallProtect', ok: s.scamCallProtect, pts: 10, t: 'Защита от звонков мошенников', fix: 'Включить защиту звонков' },
      { key: 'nightLimit', ok: s.nightLimit, pts: 6, t: 'Ночной лимит переводов', fix: 'Включить ночной лимит' },
      { key: 'coolingPeriod', ok: s.coolingPeriod, pts: 7, t: 'Период охлаждения для крупных переводов', fix: 'Включить' },
      { key: 'devices', ok: st.devices.every((d) => d.trusted), pts: 10, t: 'Все устройства доверенные', fix: 'Проверить устройства' },
      { key: 'family', ok: st.family.every((f) => f.protected), pts: 8, t: 'Близкие под семейной защитой', fix: 'Защитить близких' },
      { key: 'limit', ok: s.transferLimit <= 1000000, pts: 6, t: 'Разумный лимит переводов', fix: 'Снизить лимит' },
    ];
    const max = items.reduce((a, i) => a + i.pts, 0);
    const got = items.reduce((a, i) => a + (i.ok ? i.pts : 0), 0);
    const core = NX.Core.assess();
    const threatPenalty = Math.round(core.score * 0.25);
    const base = 14; // за использование проверки сообщений и активный аккаунт
    const score = NX.clamp(Math.round(base + (got / max) * 86 - threatPenalty), 0, 100);
    return { score, items, threatPenalty, grade: score >= 80 ? 'Отлично' : score >= 60 ? 'Хорошо' : score >= 40 ? 'Требует внимания' : 'Под угрозой' };
  };

  /* ---------------- аналитика финансов (раздел за ?full=1) ---------------- */
  NX.finance = function () {
    const tx = NX.state.transactions.filter((t) => t.status !== 'blocked'); // удержанные переводы не являются расходами
    const now = new Date();
    const mStart = (offset) => new Date(now.getFullYear(), now.getMonth() - offset, 1).getTime();
    const inMonth = (t, off) => t.ts >= mStart(off) && t.ts < (off === 0 ? Infinity : mStart(off - 1));
    const sumBy = (off) => {
      const by = {}; let spend = 0, income = 0;
      tx.forEach((t) => {
        if (!inMonth(t, off)) return;
        if (t.amount > 0) income += t.amount; else { spend += -t.amount; by[t.category] = (by[t.category] || 0) + -t.amount; }
      });
      return { by, spend, income };
    };
    const cur = sumBy(0), prev = sumBy(1);
    // окно в 30 дней для более стабильного анализа
    const d30 = Date.now() - 30 * 86400000, d60 = Date.now() - 60 * 86400000;
    const last30 = {}, prev30 = {};
    let spend30 = 0, income30 = 0, spendPrev30 = 0;
    tx.forEach((t) => {
      if (t.amount < 0) {
        if (t.ts >= d30) { last30[t.category] = (last30[t.category] || 0) + -t.amount; spend30 += -t.amount; }
        else if (t.ts >= d60) { prev30[t.category] = (prev30[t.category] || 0) + -t.amount; spendPrev30 += -t.amount; }
      } else if (t.ts >= d30) income30 += t.amount;
    });
    const months = [];
    for (let i = 2; i >= 0; i--) {
      const m = sumBy(i);
      months.push({ label: new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleDateString('ru-RU', { month: 'short' }), spend: m.spend, income: m.income });
    }
    // подписки: повторяющиеся списания одного мерчанта с одной суммой
    const rec = {};
    tx.filter((t) => t.amount < 0 && t.ts >= Date.now() - 95 * 86400000).forEach((t) => {
      const k = t.merchant + '|' + t.amount; rec[k] = rec[k] || { merchant: t.merchant, amount: -t.amount, count: 0, last: 0, category: t.category };
      rec[k].count++; rec[k].last = Math.max(rec[k].last, t.ts);
    });
    const subs = Object.values(rec).filter((r) => r.count >= 3 && r.category === 'Подписки').sort((a, b) => b.amount - a.amount);
    const insights = [];
    Object.keys(last30)
      .filter((c) => c !== 'Переводы' && prev30[c] > 15000 && last30[c] > prev30[c] * 1.15)
      .sort((a, b) => (last30[b] - prev30[b]) - (last30[a] - prev30[a]))
      .slice(0, 2)
      .forEach((c) => insights.push({ icon: 'trending-up', t: 'Расходы на «' + c + '» выросли на ' + Math.round((last30[c] / prev30[c] - 1) * 100) + '%', d: NX.fmt(last30[c]) + ' за 30 дней против ' + NX.fmt(prev30[c]) + ' ранее', kind: 'warn' }));
    const activeSubs = subs.filter((s) => !NX.state.subsCancelled.includes(s.merchant));
    const subTotal = activeSubs.reduce((a, s) => a + s.amount, 0);
    insights.push({ icon: 'refresh', t: 'Подписки: ' + NX.fmt(subTotal) + ' в месяц', d: NX.countOf(activeSubs.length, ['активная', 'активные', 'активных']) + ' · ' + NX.fmt(subTotal * 12) + ' в год', kind: 'info' });
    const rate = income30 ? (income30 - spend30) / income30 : 0;
    insights.push({ icon: rate > 0.2 ? 'check-circle' : 'info', t: 'Норма сбережений: ' + Math.round(rate * 100) + '%', d: rate > 0.2 ? 'Отличный результат — выше рекомендуемых 20%' : 'Рекомендуем откладывать от 20% дохода', kind: rate > 0.2 ? 'ok' : 'warn' });
    const cafe = last30['Кафе и рестораны'] || 0;
    if (cafe > 0) insights.push({ icon: 'coffee', t: 'Сократив кафе на 30%, вы сэкономите ' + NX.fmt(cafe * 0.3 * 12) + ' в год', d: 'Этого хватит на ' + Math.round((cafe * 0.3 * 12) / NX.state.goal.target * 100) + '% цели «' + NX.state.goal.name + '»', kind: 'ok' });
    return { cur, prev, last30, prev30, spend30, income30, spendPrev30, months, subs, subTotal, insights, rate };
  };

  /* ---------------- иконки (inline SVG) ---------------- */
  const P = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/>',
    shieldCheck: '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c3 0 5 2 5 5"/>',
    gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    graph: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7 7l3.5 9M17 7l-3.5 9M7.5 6h9"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v7M14 20h3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    building: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    dna: '<path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12M8 7h8M8 17h8"/>',
    devices: '<rect x="2" y="4" width="14" height="10" rx="1.5"/><path d="M6 18h6"/><rect x="17" y="8" width="5" height="12" rx="1"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    // Финансовая конституция
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6M9 11h4"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14"/><path d="M8.5 10.5h7"/><path d="M4 13a8 8 0 0 0 16 0"/><path d="M2.5 14.5L4 13l1.5 1.5M18.5 14.5L20 13l1.5 1.5"/>',
    sparkle: '<path d="M11 3l1.6 4.9L17.5 9.5l-4.9 1.6L11 16l-1.6-4.9L4.5 9.5l4.9-1.6z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    fingerprint: '<path d="M4.6 8.5A8.5 8.5 0 0 1 19.8 9"/><path d="M6.5 19a11 11 0 0 1-1-4.5V12a6.5 6.5 0 0 1 13 0v1.5"/><path d="M9.5 20.5a14 14 0 0 1-1-5.5V12a3.5 3.5 0 0 1 7 0v2.5a15 15 0 0 1-.8 5"/><path d="M12 11.5V15a11 11 0 0 0 1.2 5"/><path d="M18.4 17.5a17 17 0 0 1-.5 2.5"/>',
  };
  NX.ICONS = Object.keys(P);
  NX.icon = (name, cls = '', size) => '<svg class="' + cls + '"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
  NX.renderIcons = function (root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => { if (!el.dataset.iconDone) { el.insertAdjacentHTML('afterbegin', NX.icon(el.dataset.icon)); el.dataset.iconDone = '1'; } });
  };

  /* ---------------- UI helpers ---------------- */
  // Тосты: не больше 3 одновременно, одинаковые склеиваются («×2»), клик закрывает.
  // icon: имя из NX.ICONS (рисуется SVG) или произвольный символ; по умолчанию — SVG по kind.
  const TOAST_MAX = 3;
  function dismissToast(el) {
    if (!el || el.dataset.leaving) return;
    el.dataset.leaving = '1';
    clearTimeout(el._nxTimer);
    el.style.transition = '0.3s'; el.style.opacity = '0'; el.style.transform = 'translateX(30px)';
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
  }
  function armToast(el, kind) { clearTimeout(el._nxTimer); el._nxTimer = setTimeout(() => dismissToast(el), kind === 'high' ? 7000 : 4500); }
  function toastIcon(kind, icon) {
    if (icon && P[icon]) return NX.icon(icon, '', 18);
    if (icon) return NX.esc(icon);
    return NX.icon({ high: 'alert', ok: 'shieldCheck', warn: 'alert', info: 'shield' }[kind] || 'info', '', 18);
  }
  NX.toast = function (title, text, kind, icon) {
    kind = kind || 'info';
    if (!document.body) return null;
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const key = kind + '|' + String(title == null ? '' : title);
    const live = Array.prototype.filter.call(box.children, (c) => !c.dataset.leaving);
    const same = live.find((c) => c.dataset.key === key);
    if (same) {
      const n = (Number(same.dataset.count) || 1) + 1;
      same.dataset.count = String(n);
      const cnt = same.querySelector('.tcount'); if (cnt) cnt.textContent = ' ×' + n;
      const txt = same.querySelector('.muted'); if (txt) txt.textContent = String(text || '');
      box.appendChild(same); // наверх стопки
      armToast(same, kind);
      return same;
    }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.dataset.key = key;
    el.dataset.count = '1';
    el.setAttribute('role', kind === 'high' ? 'alert' : 'status');
    el.innerHTML = '<div class="ti">' + toastIcon(kind, icon) + '</div><div><b>' + NX.esc(title) + '<span class="tcount"></span></b><span class="muted">' + NX.esc(text || '') + '</span></div>';
    el.onclick = () => dismissToast(el);
    box.appendChild(el);
    live.push(el);
    while (live.length > TOAST_MAX) dismissToast(live.shift());
    armToast(el, kind);
    return el;
  };

  // Модальное окно. opts.locked — Esc и клик по фону не закрывают (кнопки [data-close] и NX.closeModal() — закрывают).
  // opts.onClose — вызывается один раз при любом закрытии/замене окна (для очистки таймеров демо).
  let modalOnClose = null;
  function fireModalClose() {
    const fn = modalOnClose; modalOnClose = null;
    if (fn) { try { fn(); } catch (e) { console.error(e); } }
  }
  NX.modal = function (html, opts) {
    const o = opts || {};
    let m = document.getElementById('modal');
    if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; document.body.appendChild(m); }
    fireModalClose();
    m.innerHTML = '<div class="modal-box ' + (o.wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    m.classList.add('open');
    if (o.locked) m.dataset.locked = '1'; else delete m.dataset.locked;
    modalOnClose = typeof o.onClose === 'function' ? o.onClose : null;
    m.onclick = (e) => { if (e.target === m && !m.dataset.locked) NX.closeModal(); };
    m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => NX.closeModal()));
    return m.firstElementChild;
  };
  NX.closeModal = function () {
    const m = document.getElementById('modal');
    if (m) { m.classList.remove('open'); m.innerHTML = ''; delete m.dataset.locked; }
    fireModalClose();
  };
  NX.isModalOpen = () => { const m = document.getElementById('modal'); return !!(m && m.classList.contains('open')); };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = document.getElementById('modal');
    if (!m || !m.classList.contains('open')) return;
    if (m.dataset.locked) return; // окно демо-атаки и другие «заблокированные» окна Esc не закрывает
    NX.closeModal();
  });

  NX.gaugeSVG = function (value, color, size = 200, stroke = 14) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const off = c * (1 - NX.clamp(value, 0, 100) / 100);
    return '<svg viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(120,135,170,0.18)" style="stroke:var(--line,rgba(120,135,170,0.18))" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" style="transition:stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)"/></svg>';
  };
  NX.meter = (score) => '<div class="meter"><i style="width:' + NX.clamp(score, 2, 100) + '%;background:' + NX.riskColor(score) + '"></i></div>';
  NX.badge = (score) => { const l = NX.level(score); return '<span class="badge ' + l.key + '">' + score + ' · ' + l.label.split(' ')[0] + '</span>'; };

  // Необработанная ошибка скрипта → тост вместо «молча сломанной» страницы (не чаще раза в 8 с)
  let lastErrToast = 0;
  window.addEventListener('error', (e) => {
    if (!e || !e.message || e.message === 'Script error.') return;
    // безвредное предупреждение браузера при подстройке размеров (не ошибка кода)
    if (/ResizeObserver loop/i.test(e.message)) { try { e.stopImmediatePropagation(); e.preventDefault(); } catch (er) { /* ignore */ } return; }
    const now = Date.now();
    if (now - lastErrToast < 8000) return;
    lastErrToast = now;
    try { NX.toast('Сбой в модуле демо', 'Ошибка перехвачена, страница продолжает работу. Подробности — в консоли.', 'warn'); } catch (er) { /* ignore */ }
  });

  /* ---------------- доступность LLM (/api/chat) ---------------- */
  // Общая проверка с таймаутом (по умолчанию 1,5 с) и кэшем: 60 с для «доступен», 30 с для «недоступен».
  // ?llm=off — всегда недоступен. Возвращает Promise<{ok, model, reason}>.
  const llmCache = { at: 0, val: null, pending: null };
  NX.llmStatus = function (opts) {
    const o = opts || {};
    if (NX.flags.llmOff) return Promise.resolve({ ok: false, model: '', reason: 'disabled_by_flag' });
    const ttl = llmCache.val && llmCache.val.ok ? 60000 : 30000;
    if (!o.force && llmCache.val && Date.now() - llmCache.at < ttl) return Promise.resolve(llmCache.val);
    if (llmCache.pending) return llmCache.pending;
    if (typeof fetch !== 'function') return Promise.resolve({ ok: false, model: '', reason: 'no_fetch' });
    let ctrl = null;
    try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
    const timer = setTimeout(() => { try { if (ctrl) ctrl.abort(); } catch (e) { /* ignore */ } }, o.timeout || 1500);
    // где живёт LLM: api/chat (Vercel / Netlify, Claude) или api/chat.php (хостинг с PHP, Gemini)
    const ask = (ep) => fetch(ep, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then((r) => r.json().catch(() => null).then((j) => ({ ep, json: !!j, ok: !!(r.ok && j && j.ok), model: (j && j.model) || '', reason: (j && j.reason) || (r.ok ? '' : 'http_' + r.status) })));
    const req = (o.endpoint ? ask(o.endpoint) : ask('api/chat').then((v) => (v.json ? v : ask('api/chat.php').then((w) => (w.json ? w : v)))))
      .then((v) => { if (v.ok) NX.llmEndpoint = v.ep; return { ok: v.ok, model: v.model, reason: v.reason }; })
      .catch((e) => ({ ok: false, model: '', reason: e && e.name === 'AbortError' ? 'timeout' : 'network' }))
      .then((val) => { clearTimeout(timer); llmCache.val = val; llmCache.at = Date.now(); llmCache.pending = null; return val; });
    llmCache.pending = req;
    return req;
  };
  // После ошибки POST: считаем LLM недоступным до следующей проверки (через 30 с)
  NX.llmMarkDown = function (reason) { llmCache.val = { ok: false, model: '', reason: reason || 'request_failed' }; llmCache.at = Date.now(); };

  // Сайдбар на мобильных
  NX.initShell = function () {
    NX.renderIcons();
    const sb = document.querySelector('.sidebar');
    const scrim = document.querySelector('.scrim');
    const burger = document.querySelector('.burger');
    if (burger && sb) {
      burger.onclick = () => { sb.classList.add('open'); scrim && scrim.classList.add('open'); };
      scrim && (scrim.onclick = () => { sb.classList.remove('open'); scrim.classList.remove('open'); });
    }
    NX.closeSidebar = () => { sb && sb.classList.remove('open'); scrim && scrim.classList.remove('open'); };
  };
})();
