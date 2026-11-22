/* =====================================================================
   NEXUS AI — граф связей транзакций (Fraud Fusion Center)
   Force-directed layout на canvas, выявление дроп-сетей, корреляция
   реквизитов из разведки угроз (IOC) с известной дроп-сетью,
   Personalized PageRank и объяснимый путь seed → хаб → счёт.
   Все счета и суммы синтетические.
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  // Палитра = общие токены единой тёмной дизайн-системы (:root в style.css), читаются через getComputedStyle;
  // в скобках — тёмные запасные значения. Только 6-значные hex: к ним дописывается альфа ('33').
  const PAL_TOKENS = {
    ink: ['--text', '#E8ECF7'], muted: ['--muted', '#95A1BE'], slate: ['--muted', '#95A1BE'], surface: ['--panel', '#0E1424'],
    edge: ['--edge', '#46557A'], blocked: ['--muted2', '#7A87A8'],
    accent: ['--accent', '#6366F1'], violet: ['--accent2', '#8B5CF6'], cyan: ['--accent3', '#22D3EE'],
    warn: ['--warn', '#FFB020'], danger: ['--danger', '#FF5470'],
    accentInk: ['--accent-ink', '#A5B4FC'], violetInk: ['--violet-ink', '#C4B5FD'], cyanInk: ['--cyan-ink', '#67E8F9'],
    warnInk: ['--warn-ink', '#FFC861'], dangerInk: ['--danger-ink', '#FF8A9E'],
  };
  const PAL = {};
  const COLORS = {};      // заливка узлов по роли (canvas, подложки бейджей с альфой)
  const COLORS_INK = {};  // текст по роли: ≥ 4,5:1 на тёмной поверхности
  const STATUS_COLORS = {};
  const STATUS_INK = {};
  function hex6(v, fb) {
    let s = String(v || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
    const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return '#' + [m[1], m[2], m[3]].map((x) => ('0' + Math.max(0, Math.min(255, +x)).toString(16)).slice(-2)).join('').toUpperCase();
    return fb;
  }
  // 'rgba(r,g,b,a)' из 6-значного hex — для полупрозрачных рёбер и колец
  function rgba(hex, a) {
    const h = hex6(hex, '#95A1BE');
    return 'rgba(' + parseInt(h.slice(1, 3), 16) + ',' + parseInt(h.slice(3, 5), 16) + ',' + parseInt(h.slice(5, 7), 16) + ',' + a + ')';
  }
  function readPalette() {
    let cs = null;
    try { cs = window.getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    Object.keys(PAL_TOKENS).forEach((k) => {
      const tk = PAL_TOKENS[k];
      PAL[k] = hex6(cs ? cs.getPropertyValue(tk[0]) : '', tk[1]);
    });
    Object.assign(COLORS, { client: PAL.slate, victim: PAL.warn, mule: PAL.danger, transit: PAL.violet, cashout: PAL.cyan, unknown: PAL.slate, merchant: PAL.accent, recruit: PAL.warn, factory: PAL.violet });
    Object.assign(COLORS_INK, { client: PAL.muted, victim: PAL.warnInk, mule: PAL.dangerInk, transit: PAL.violetInk, cashout: PAL.cyanInk, unknown: PAL.muted, merchant: PAL.accentInk, recruit: PAL.warnInk, factory: PAL.violetInk });
    Object.assign(STATUS_COLORS, { suspected: PAL.warn, corroborated: PAL.danger, confirmed: PAL.danger, revoked: PAL.muted, expired: PAL.muted });
    Object.assign(STATUS_INK, { suspected: PAL.warnInk, corroborated: PAL.dangerInk, confirmed: PAL.dangerInk, revoked: PAL.muted, expired: PAL.muted });
  }
  readPalette();
  const ROLE_RU = { client: 'Клиент', victim: 'Пострадавший', mule: 'Дроп', transit: 'Транзитный счёт', cashout: 'Точка обнала', unknown: 'Не определено', merchant: 'Магазин · Карты для магазинов', recruit: 'Вербуемый · сообщил сам', factory: 'Устройство-фабрика заявок' };
  const STATUS_SHORT = { suspected: 'на проверке', corroborated: 'корреляция', confirmed: 'подтверждён', revoked: 'снят', expired: 'истёк' };
  const KIND_LABEL = { iban: 'Счёт', phone: 'Номер', card: 'Карта', crypto: 'Кошелёк', domain: 'Сайт' };
  const NAMES = ['Алихан Б.', 'Мадина К.', 'Руслан Т.', 'Асель Н.', 'Даурен С.', 'Жанар О.', 'Ильяс М.', 'Камила Е.', 'Бауыржан А.', 'Сауле Д.', 'Олжас Р.', 'Айым Ж.', 'Тимур Х.', 'Дана Б.', 'Арман И.', 'Лаура С.', 'Нурсултан К.', 'Әсем Т.', 'Ержан П.', 'Зарина У.', 'Санжар Ш.', 'Гаухар Л.', 'Аскар Ф.', 'Меруерт В.', 'Ринат Г.', 'Айжан Ы.', 'Самат Э.', 'Карина Ю.', 'Нуржан Я.', 'Аружан Ц.', 'Болат Ч.', 'Алия Щ.', 'Марлен Ж.', 'Фатима Р.', 'Габит Н.', 'Индира М.', 'Ербол К.', 'Салтанат А.'];

  const G = (NX.Graph = { nodes: [], edges: [], detected: false, selected: null, rings: [], listeners: [], highlight: null, hub: null });
  let cv = null, g = null, W = 0, H = 0, dpr = 1, alpha = 1, hover = null, drag = null, moved = false, t0 = 0, scanT = -1;
  let focusNode = null, focusUntil = 0, focusK = null, fitK = 1;
  const view = { x: 0, y: 0, k: 1 };
  const K_MIN = 0.3, K_MAX = 3;
  const clampK = (k) => Math.max(K_MIN, Math.min(K_MAX, k));

  function hashStr(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function acct(r) { return 'KZ' + Math.floor(10 + r() * 89) + ' ' + Math.floor(1000 + r() * 8999) + ' •••• ' + Math.floor(1000 + r() * 8999); }

  // Частичная маска демо-номеров: '+7 708 555 12 90' → '+7 7•• ••• 12 90'. IBAN/прочее — как есть.
  function mask(acc) {
    const s = String(acc == null ? '' : acc);
    let p = null;
    try { p = NX.parseAccount ? NX.parseAccount(s) : null; } catch (e) { p = null; }
    if (p && p.kind === 'phone' && p.value && p.value.length === 12) {
      const d = p.value.slice(2);
      return '+7 ' + d.charAt(0) + '•• ••• ' + d.slice(6, 8) + ' ' + d.slice(8, 10);
    }
    return s;
  }
  G.mask = mask;
  // как показывать счёт узла: реквизиты из разведки — как их назвал мошенник, демо-номера — с маской
  G.disp = (n) => (!n ? '' : n.fromIoc ? String(n.account || '') : mask(n.account));
  // Честная оговорка для всех мест, где решение опирается на корреляцию по графу для нового реквизита
  G.SYNTH_NOTE = 'в демо история счёта в графе сгенерирована; в проде — реальные операции';
  // связь узла с сетью держится на синтетической истории (рёбра synthetic:true);
  // узлы известной сети (база дропов) связаны с ней и без неё
  G.isSynthetic = function (x) {
    const n = asNode(x);
    if (!n) return false;
    if (n.synthHistory) return true;
    return !n.knownDrop && G.edges.some((e) => e.synthetic && (e.s === n || e.t === n));
  };

  function nodeKey(n) {
    if (n._key === undefined) {
      let p = null;
      try { p = NX.parseAccount ? NX.parseAccount(n.account) : null; } catch (e) { p = null; }
      n._key = p && p.value ? p.kind + ':' + p.value : '';
    }
    return n._key;
  }
  function recomputeSums() {
    G.nodes.forEach((n) => { n.inSum = 0; n.outSum = 0; });
    G.edges.forEach((e) => { e.s.outSum += e.amount; e.t.inSum += e.amount; });
    G.nodes.forEach((n) => {
      const r = 5 + Math.min(14, Math.log10(1 + (n.inSum + n.outSum) / 10000) * 3.2);
      n.r = n.live ? Math.max(r, n.iocValue ? 10 : 9) : r;
    });
  }

  G.build = function () {
    const r = NX.rng(4242);
    const nodes = [], edges = [];
    const add = (o) => { const n = Object.assign({ x: (r() - 0.5) * 600, y: (r() - 0.5) * 400, vx: 0, vy: 0, risk: 5, role: 'unknown', truth: 'client', blocked: false }, o); nodes.push(n); return n; };
    const link = (s, t, amount, fraud, extra) => edges.push(Object.assign({ s, t, amount, fraud: !!fraud, ts: Date.now() - Math.floor(r() * 48 * 3600000), count: 1 + Math.floor(r() * 3) }, extra || {}));
    const M = NX.MULE_ACCOUNTS;
    const clients = [];
    for (let i = 0; i < 24; i++) clients.push(add({ id: 'c' + i, label: NAMES[i], account: acct(r), truth: 'client' }));
    for (let i = 0; i < 34; i++) { const a = NX.pick(clients, r), b = NX.pick(clients, r); if (a !== b) link(a, b, Math.round((5 + r() * 140) * 1000)); }
    // Сеть A — «Безопасный счёт» (известна банку по прошлым расследованиям: база дропов)
    const m1 = add({ id: 'm1', label: M[0].name, account: M[0].account, truth: 'mule', knownDrop: true });
    const m2 = add({ id: 'm2', label: M[1].name, account: M[1].account, truth: 'mule', knownDrop: true });
    const m3 = add({ id: 'm3', label: 'Ержан Д.', account: 'KZ12 3KZT 5590 0001 7782', truth: 'mule' });
    const t1 = add({ id: 't1', label: M[3].name, account: M[3].account, truth: 'transit', knownDrop: true });
    const t2 = add({ id: 't2', label: M[2].name, account: M[2].account, truth: 'transit', knownDrop: true });
    const c1 = add({ id: 'x1', label: 'Криптообменник (офшор)', account: 'USDT TRC-20 · TQ9x…f3Lm', truth: 'cashout', knownDrop: true });
    const c2 = add({ id: 'x2', label: 'Обнал · банкоматы Шымкент', account: 'Карты-«пустышки» ×6', truth: 'cashout', knownDrop: true });
    const victimsA = [];
    for (let i = 0; i < 11; i++) { const v = add({ id: 'v' + i, label: NAMES[24 + i] || 'Клиент ' + i, account: acct(r), truth: 'victim' }); victimsA.push(v); }
    victimsA.forEach((v, i) => { const m = [m1, m2, m3][i % 3]; link(v, m, Math.round((180 + r() * 1400) * 1000), true); if (r() < 0.5) link(v, NX.pick(clients, r), Math.round((10 + r() * 60) * 1000)); });
    const inSum = (n) => edges.filter((e) => e.t === n).reduce((a, e) => a + e.amount, 0);
    link(m1, t1, Math.round(inSum(m1) * 0.93), true); link(m2, t1, Math.round(inSum(m2) * 0.5), true); link(m2, t2, Math.round(inSum(m2) * 0.45), true); link(m3, t2, Math.round(inSum(m3) * 0.95), true);
    link(t1, c1, Math.round(inSum(t1) * 0.7), true); link(t1, c2, Math.round(inSum(t1) * 0.27), true); link(t2, c1, Math.round(inSum(t2) * 0.96), true);
    // Сеть B — инвестиционный скам
    const m4 = add({ id: 'm4', label: 'ИП «Капитал Профит» (вымышл.)', account: 'KZ77 8KZT 2210 0004 1190', truth: 'mule' });
    for (let i = 0; i < 5; i++) { const v = add({ id: 'w' + i, label: NAMES[(i * 5 + 3) % 24].replace(/.$/, '') + 'а.', account: acct(r), truth: 'victim' }); link(v, m4, Math.round((90 + r() * 600) * 1000), true); }
    link(m4, c1, Math.round(inSum(m4) * 0.9), true);
    // ---- Scam Chain (дополнение 3.0, без изменения rng-последовательности выше) ----
    // Транзит №3 между хабом и криптообменником: путь «дроп №1 → транзит №2 → транзит №3 → обнал».
    const t3 = add({ id: 't3', label: 'ТОО «Арна Трейд» (вымышл.)', account: 'KZ40 6KZT 3310 0009 2281', truth: 'transit', x: 210, y: -40 });
    const e13 = edges.find((e) => e.s === t1 && e.t === c1);
    if (e13) { e13.t = t3; link(t3, c1, Math.round(e13.amount * 0.97), true); }
    // Синтетические id устройств: общий телефон у двух дропов, общий ноутбук у транзитных счетов
    m1.device = 'DEV-7F3A'; m2.device = 'DEV-7F3A'; m3.device = 'DEV-2B91'; t1.device = 'DEV-19C2'; t3.device = 'DEV-19C2'; t2.device = 'DEV-5D04';
    // Связанные счета (для распространения риска): не участвуют в схеме по денежному паттерну
    const l1 = add({ id: 'l1', label: 'Асылбек Т.', account: 'KZ63 9KZT 1180 0002 4417', truth: 'client', device: 'DEV-7F3A', x: -160, y: -150 });
    const l2 = add({ id: 'l2', label: 'ИП «Нур Сервис» (вымышл.)', account: 'KZ29 4KZT 6650 0007 3302', truth: 'client', x: 260, y: 130 });
    const l3 = add({ id: 'l3', label: 'Диана К.', account: 'KZ85 2KZT 9040 0005 1876', truth: 'client', x: -40, y: 190 });
    link(clients[3], l1, 22000, false);
    link(t1, l2, 48000, false, { count: 3 });
    link(m1, l3, 35000, false, { count: 2 });
    // Время движения денег по сети A (минуты между входом и выходом) — согласованная синтетическая хронология
    const now = Date.now(), T0 = now - 95 * 60000, MIN = 60000;
    G.chainT0 = T0;
    edges.forEach((e) => {
      if (!e.fraud || [m1, m2, m3].indexOf(e.t) < 0 || !/^v\d+$/.test(e.s.id)) return;
      const k = parseInt(e.s.id.slice(1), 10) || 0;
      e.ts = T0 - (3 + 4 * (k % 3) + 41 * Math.floor(k / 3)) * MIN;
    });
    const setTs = (s, t, m) => { const e = edges.find((x) => x.s === s && x.t === t); if (e) e.ts = T0 + m * MIN; };
    setTs(m1, t1, 9); setTs(m2, t1, 12); setTs(m2, t2, 13); setTs(m3, t2, 11);
    setTs(t1, t3, 17); setTs(t1, c2, 19); setTs(t3, c1, 24); setTs(t2, c1, 22);
    setTs(m1, l3, -300); setTs(t1, l2, -1400);
    { const inM4 = edges.filter((e) => e.t === m4); const last = Math.max.apply(null, inM4.map((e) => e.ts).concat([now - 6 * 3600000])); const e4 = edges.find((e) => e.s === m4 && e.t === c1); if (e4) e4.ts = Math.min(now - 30 * MIN, last + 38 * MIN); }
    G.nodes = nodes; G.edges = edges; G.detected = false; G.rings = []; G.selected = null; G.highlight = null;
    G.hub = t1;
    recomputeSums();
    view.x = 0; view.y = 0; focusNode = null;
    alpha = 1;
  };

  /* ---------------- алгоритм выявления сетей ---------------- */
  G.detect = function () {
    const N = G.nodes, E = G.edges;
    const ins = new Map(), outs = new Map();
    N.forEach((n) => { ins.set(n, []); outs.set(n, []); });
    E.forEach((e) => { outs.get(e.s).push(e); ins.get(e.t).push(e); });
    const flagged = new Set();
    const isRevoked = (n) => n.iocValue && (n.iocStatus === 'revoked' || n.iocStatus === 'expired');
    N.forEach((n) => {
      const senders = new Set(ins.get(n).map((e) => e.s)).size;
      const ratio = n.inSum ? n.outSum / n.inSum : 0;
      n.metrics = { senders, ratio, inSum: n.inSum, outSum: n.outSum };
      // fixedRole (mule-exit.js: вербуемый и его отправители) — роль известна из сообщения клиента, алгоритм её не меняет
      n.role = n.merchant ? 'merchant' : n.fixedRole || 'unknown';
      if (n.merchant || n.fixedRole || isRevoked(n)) return;
      if (senders >= 3 && ratio >= 0.7 && n.inSum >= 800000) { n.role = 'mule'; flagged.add(n); }
    });
    // транзит: получает от ≥2 флагнутых и быстро отправляет дальше
    let changed = true;
    while (changed) {
      changed = false;
      N.forEach((n) => {
        if (flagged.has(n) || n.merchant || n.fixedRole || isRevoked(n)) return;
        const fromF = ins.get(n).filter((e) => flagged.has(e.s));
        if (!fromF.length) return;
        const ratio = n.inSum ? n.outSum / n.inSum : 0;
        if (fromF.length >= 2 && ratio >= 0.7) { n.role = 'transit'; flagged.add(n); changed = true; }
        else if (ratio < 0.1 && fromF.reduce((a, e) => a + e.amount, 0) > 500000) { n.role = 'cashout'; flagged.add(n); changed = true; }
        else if (fromF.length >= 1 && ratio >= 0.85 && ins.get(n).every((e) => flagged.has(e.s))) { n.role = 'transit'; flagged.add(n); changed = true; }
      });
    }
    // реквизиты из разведки, уже подтверждённые (корреляцией или аналитиком), но без денежного паттерна
    N.forEach((n) => { if (n.iocValue && !n.merchant && !n.fixedRole && !flagged.has(n) && (n.iocStatus === 'corroborated' || n.iocStatus === 'confirmed')) { n.role = n.truth; flagged.add(n); } });
    // жертвы: отправители в дроп-счета
    N.forEach((n) => { if (n.merchant || n.fixedRole) return; if (!flagged.has(n) && outs.get(n).some((e) => flagged.has(e.t) && e.t.role === 'mule')) n.role = 'victim'; else if (!flagged.has(n)) n.role = 'client'; });
    E.forEach((e) => (e.fraudDetected = flagged.has(e.t) && (flagged.has(e.s) || e.s.role === 'victim')));
    E.forEach((e) => { if (e.mx) e.fraudDetected = !e.held; }); // потоки «Не стань дропом» видны всегда, в суммы сетей не входят
    N.forEach((n) => {
      n.risk = { mule: 88 + Math.min(10, n.metrics.senders), transit: 84, cashout: 95, victim: 45, client: 4 + (hashStr(n.id) % 10), unknown: 10, merchant: null, recruit: 40, factory: 90 }[n.role];
      n.flagged = flagged.has(n);
    });
    // компоненты связности по фрод-подграфу
    const seen = new Set(); const rings = [];
    flagged.forEach((start) => {
      if (seen.has(start)) return;
      if (start.role === 'cashout') return; // точки обнала общие для разных сетей — не склеиваем через них
      const comp = []; const stack = [start]; seen.add(start);
      while (stack.length) {
        const n = stack.pop(); comp.push(n);
        if (n.role === 'cashout') continue;
        E.forEach((e) => {
          if (!e.fraudDetected) return;
          [[e.s, e.t], [e.t, e.s]].forEach(([a, b]) => {
            if (a !== n || !flagged.has(b)) return;
            if (b.role === 'cashout') { if (comp.indexOf(b) < 0 && stack.indexOf(b) < 0) stack.push(b); return; }
            if (!seen.has(b)) { seen.add(b); stack.push(b); }
          });
        });
      }
      // синтетическая история реквизитов из разведки (synthetic:true) в суммы и число пострадавших не входит
      const victims = new Set(); let stolen = 0, synthetic = 0;
      E.forEach((e) => {
        if (!e.fraudDetected || e.s.role !== 'victim' || comp.indexOf(e.t) < 0) return;
        if (e.synthetic) { synthetic += e.amount; return; }
        victims.add(e.s); stolen += e.amount;
      });
      rings.push({ id: 'R' + (rings.length + 1), nodes: comp, victims: Array.from(victims), stolen, syntheticAmount: synthetic, cashout: comp.filter((n) => n.role === 'cashout').map((n) => n.label) });
    });
    rings.sort((a, b) => b.stolen - a.stolen);
    rings.forEach((r, i) => {
      r.id = 'NET-' + String(i + 1).padStart(2, '0');
      const hasHub = G.hub && r.nodes.indexOf(G.hub) >= 0;
      r.name = hasHub ? 'Сеть «Безопасный счёт»' : r.nodes.some((n) => n.id === 'm4') ? 'Сеть «Инвестиционный скам»' : 'Сеть #' + (i + 1);
    });
    G.rings = rings; G.detected = true; scanT = performance.now();
    alpha = Math.max(alpha, 0.6);
    return rings;
  };

  // анализ без визуального раскрытия (для таблицы счетов)
  G.analyzeOnly = function () {
    const snapN = G.nodes.map((n) => [n.role, n.risk, n.flagged, n.metrics]);
    const snapE = G.edges.map((e) => e.fraudDetected);
    const det = G.detected, rings = G.rings, st = scanT, a = alpha;
    const res = G.detect();
    const out = G.nodes.map((n) => ({ n, role: n.role, risk: n.risk, metrics: n.metrics, flagged: n.flagged }));
    if (!det) {
      G.nodes.forEach((n, i) => { n.role = snapN[i][0]; n.risk = snapN[i][1]; n.flagged = snapN[i][2]; n.metrics = snapN[i][3]; });
      G.edges.forEach((e, i) => (e.fraudDetected = snapE[i]));
      G.detected = det; G.rings = rings; scanT = st; alpha = a;
    }
    return { rings: res, nodes: out };
  };

  /* ---------------- Scam Chain: путь денег жертва → дроп №1 → транзит → … → обнал ---------------- */
  // Признаки: веерные поступления на вход цепочки, быстрое перемещение (минуты между входом и выходом),
  // повторяющиеся связи (count ≥ 2), общие устройства (синтетические id). Работает поверх G.detect().
  const STEP_RU = (role, k) => (role === 'cashout' ? 'Обнал' : role === 'transit' ? 'Транзит №' + (k + 1) : k === 0 ? 'Дроп-счёт №1' : 'Дроп №' + (k + 1));
  function chainFrom(start, ins, outs) {
    const path = [start], edges = [], seen = new Set([start]);
    let cur = start;
    while (cur.role !== 'cashout' && path.length < 7) {
      const nx = (outs.get(cur) || []).filter((e) => e.fraud && !e.held && e.t.flagged && !seen.has(e.t)).sort((a, b) => b.amount - a.amount)[0];
      if (!nx) break;
      edges.push(nx); path.push(nx.t); seen.add(nx.t); cur = nx.t;
    }
    if (edges.length < 1) return null;
    const firstOut = edges[0];
    const vin = (ins.get(start) || []).filter((e) => e.fraud && !e.s.flagged);
    const moved = vin.filter((e) => !e.held && e.ts <= firstOut.ts);
    const held = vin.filter((e) => e.held);
    const lastIn = moved.length ? Math.max.apply(null, moved.map((e) => e.ts)) : null;
    const nodes = path.map((n, k) => {
      const inE = k === 0 ? null : edges[k - 1], outE = edges[k] || null;
      const dwellFrom = k === 0 ? lastIn : inE ? inE.ts : null;
      const dwellMin = outE && dwellFrom != null && outE.ts >= dwellFrom ? Math.round((outE.ts - dwellFrom) / 60000) : null;
      // на счёт транзита приходят деньги и с других счетов схемы: показываем весь приход, а не только ребро пути,
      // иначе выходит, что счёт отправил больше, чем получил
      const pathIn = inE ? inE.amount : moved.reduce((a, e) => a + e.amount, 0);
      const allIn = inE ? (ins.get(n) || []).filter((e) => e.fraud && !e.held).reduce((a, e) => a + e.amount, 0) : pathIn;
      const amountIn = Math.max(pathIn, allIn);
      return { node: n, step: STEP_RU(n.role, k), role: n.role, inEdge: inE, outEdge: outE, dwellMin, amountIn, amountPath: pathIn, amountOther: Math.max(0, amountIn - pathIn) };
    });
    const last = edges[edges.length - 1];
    const minutesToCashout = lastIn != null && last.ts >= lastIn ? Math.round((last.ts - lastIn) / 60000) : null;
    // общие устройства внутри цепочки и с внешними счетами
    const devs = {};
    G.nodes.forEach((n) => { if (n.device) (devs[n.device] = devs[n.device] || []).push(n); });
    const shared = [];
    path.forEach((n) => { if (n.device && devs[n.device].length > 1 && !shared.some((s) => s.device === n.device)) shared.push({ device: n.device, nodes: devs[n.device] }); });
    const repeated = edges.filter((e) => (e.count || 1) >= 2).length + vin.filter((e) => (e.count || 1) >= 2).length;
    return {
      start, path, edges, nodes, victims: moved.map((e) => e.s), victimEdges: moved, heldEdges: held, lastIn, hops: edges.length, minutesToCashout,
      senders: new Set(vin.map((e) => e.s)).size, repeated, shared,
      synthetic: edges.some((e) => e.synthetic) || moved.some((e) => e.synthetic),
      amount: moved.filter((e) => !e.synthetic).reduce((a, e) => a + e.amount, 0), syntheticAmount: moved.filter((e) => e.synthetic).reduce((a, e) => a + e.amount, 0),
      reachesCashout: path[path.length - 1].role === 'cashout',
    };
  }
  G.chains = function () {
    if (!G.detected) G.detect();
    const ins = new Map(), outs = new Map();
    G.nodes.forEach((n) => { ins.set(n, []); outs.set(n, []); });
    G.edges.forEach((e) => { if (outs.has(e.s)) outs.get(e.s).push(e); if (ins.has(e.t)) ins.get(e.t).push(e); });
    const revoked = (n) => n.iocValue && (n.iocStatus === 'revoked' || n.iocStatus === 'expired');
    const starts = G.nodes.filter((n) => n.flagged && !revoked(n) && n.role !== 'cashout' && n.role !== 'transit' &&
      (ins.get(n) || []).some((e) => e.fraud && !e.s.flagged));
    const list = starts.map((s) => chainFrom(s, ins, outs)).filter(Boolean);
    list.sort((a, b) => (b.start.iocValue ? 1 : 0) - (a.start.iocValue ? 1 : 0) || b.hops - a.hops || b.amount - a.amount);
    list.forEach((c, i) => {
      c.id = 'CH-' + String(i + 1).padStart(2, '0');
      const ring = (G.rings || []).find((r) => r.nodes.indexOf(c.start) >= 0);
      c.ringId = ring ? ring.id : null; c.ringName = ring ? ring.name : null;
    });
    G.chainList = list;
    return list;
  };
  // Счета вне цепочки, связанные с ней: общее устройство, переводы с/на счета цепочки (без жертв и самой цепочки)
  G.linked = function (chain) {
    if (!chain) return [];
    const inChain = new Set(chain.path);
    const victims = new Set(chain.victims.concat((chain.heldEdges || []).map((e) => e.s)));
    const out = new Map();
    const push = (n, via) => {
      if (inChain.has(n) || victims.has(n) || n.flagged || n.role === 'victim') return;
      if (!out.has(n)) out.set(n, { node: n, via: [] });
      out.get(n).via.push(via);
    };
    chain.path.forEach((c) => {
      if (c.device) G.nodes.forEach((n) => { if (n !== c && n.device === c.device) push(n, { type: 'device', with: c, device: c.device }); });
      G.edges.forEach((e) => {
        if (e.fraud) return;
        if (e.s === c) push(e.t, { type: 'from_chain', with: c, amount: e.amount, count: e.count || 1, ts: e.ts });
        else if (e.t === c) push(e.s, { type: 'to_chain', with: c, amount: e.amount, count: e.count || 1, ts: e.ts });
      });
    });
    return Array.from(out.values());
  };

  /* ---------------- узлы из разведки угроз (IOC) ---------------- */
  function asNode(x) {
    if (!x) return null;
    if (typeof x === 'object') return G.nodes.indexOf(x) >= 0 ? x : (x.id ? G.nodes.find((n) => n.id === x.id) || null : null);
    const s = String(x);
    return G.nodes.find((n) => n.id === s) || G.nodes.find((n) => n.iocValue === s) || G.nodes.find((n) => n.account === s) || null;
  }
  G.node = asNode;
  // узел по счёту в любом написании ('87085551290', '+7 708 555 12 90', IBAN с пробелами)
  G.byAccount = function (acc) {
    if (!acc) return null;
    const direct = asNode(acc);
    if (direct) return direct;
    let p = null;
    try { p = NX.parseAccount(acc); } catch (e) { p = null; }
    if (!p || !p.value) return null;
    return G.findIoc(p.kind, p.value) || G.nodes.find((n) => nodeKey(n) === p.kind + ':' + p.value) || null;
  };
  G.findIoc = function (kind, value) {
    if (value === undefined) { value = kind; kind = null; }
    return G.nodes.find((n) => n.iocValue && n.iocValue === value && (!kind || n.iocKind === kind)) || null;
  };
  function applyStatus(n, st) {
    if (!n) return;
    n.iocStatus = st || n.iocStatus || 'suspected';
    // corroborated/confirmed → переводы на реквизит удерживаются для проверки; снят/истёк → ограничений нет (кроме ручного hold)
    if (n.iocStatus === 'corroborated' || n.iocStatus === 'confirmed') n.blocked = true;
    else n.blocked = !!n.manualHold;
    if (n.merchant) n.blocked = false; // Leak Radar: мерчант не получатель переводов
  }
  G.setIocStatus = function (kind, value, st) {
    const n = G.findIoc(kind, value);
    if (n) { applyStatus(n, st); if (st === 'revoked' || st === 'expired') n.flagged = false; }
    return n;
  };
  // связь узла с известной дроп-сетью: деньги уходят/приходят с узла известной сети (база дропов)
  // и при этом веерный приём (≥3 отправителей) — или это сам узел известной сети
  function inNetwork(n) {
    n = asNode(n);
    if (!n) return false;
    if (n.knownDrop) return true;
    const inn = G.edges.filter((e) => e.t === n), out = G.edges.filter((e) => e.s === n);
    const senders = new Set(inn.map((e) => e.s)).size;
    const touchesKnown = inn.concat(out).some((e) => { const o = e.s === n ? e.t : e.s; return o !== n && !!o.knownDrop; });
    const fedByKnown = inn.some((e) => !!e.s.knownDrop);
    return touchesKnown && (senders >= 3 || fedByKnown);
  }
  G.inNetwork = inNetwork;

  // Новый реквизит из звонка-ловушки / Защиты звонка → узел графа.
  // opts: {status, history:false (без синтетической истории)}.
  // Рёбра синтетической истории помечены synthetic:true и не входят в суммы сетей (ring.stolen).
  // Возвращает {node, corroborated, existed, hub, synthetic, path, reason?}
  G.addIoc = function (ioc, opts) {
    const o = opts || {};
    if (!ioc || !ioc.kind) return { node: null, corroborated: false, existed: false, reason: 'bad_ioc' };
    const value = ioc.value || NX.normIoc(ioc.kind, ioc.raw);
    if (!value) return { node: null, corroborated: false, existed: false, reason: 'bad_ioc' };
    const st = o.status || ioc.status || 'suspected';
    const hub = G.hub && G.nodes.indexOf(G.hub) >= 0 ? G.hub : G.nodes.find((n) => n.id === 't1') || G.nodes[0] || null;
    const result = (node, existed) => {
      const corr = node ? inNetwork(node) : false;
      return { node, corroborated: corr, existed, hub, synthetic: node ? G.isSynthetic(node) : false, path: corr && hub && node !== hub ? G.explainPath(node, hub) : null };
    };
    let n = G.findIoc(ioc.kind, value);
    if (n) { applyStatus(n, st); if (n.merchant) n.blocked = false; return result(n, true); }
    // домен — не счёт: денежных связей нет, корреляция по графу невозможна (остаётся «на проверке»)
    if (ioc.kind === 'domain') return { node: null, corroborated: false, existed: false, hub, reason: 'no_money_links' };
    // мерчант из Leak Radar (leak-radar.js) — точка возможной компрометации данных карт, а не счёт дропа:
    // отдельный узел без денежных рёбер и без синтетической истории; в дроп-сети и в «Обнаруженные сети» не входит,
    // статус меняется только по независимым клиентам (core.js) и решению аналитика
    if (ioc.kind === 'merchant') {
      const hm = hashStr('merchant:' + value), rm = NX.rng(hm);
      const anchor = G.nodes.find((x) => /^c\d+$/.test(x.id)) || hub;
      n = {
        id: 'mrc_' + hm.toString(36), label: 'Магазин · ' + String(ioc.merchant || ioc.raw || value).replace(/\s*·\s*M-\d+$/, ''),
        account: ioc.raw || value, iocValue: value, iocKind: 'merchant', iocSource: String(ioc.source || ''),
        x: (anchor ? anchor.x : 0) + (rm() - 0.5) * 220, y: (anchor ? anchor.y : 0) + (rm() - 0.5) * 220, vx: 0, vy: 0,
        // индекса риска у мерчанта нет (risk: null): решение — по числу независимых клиентов (Leak Radar)
        risk: null, role: 'merchant', truth: 'merchant', merchant: true, inSum: 0, outSum: 0, r: 10,
        live: true, fromIoc: true, blocked: false, flagged: false, synthHistory: false,
      };
      G.nodes.push(n);
      recomputeSums();
      applyStatus(n, st);
      n.blocked = false; // мерчант — не получатель переводов: статус IOC не означает удержание
      alpha = Math.max(alpha, 0.6);
      return { node: n, corroborated: false, existed: false, hub, synthetic: false, path: null, reason: 'merchant' };
    }
    // реквизит уже есть в графе (например, номер из базы дропов)
    const known = G.nodes.find((x) => !x.iocValue && nodeKey(x) === ioc.kind + ':' + value);
    if (known) {
      known.iocValue = value; known.iocKind = ioc.kind; known.live = true; known.iocSource = ioc.source || '';
      applyStatus(known, st);
      recomputeSums(); alpha = Math.max(alpha, 0.6);
      return result(known, true);
    }
    if (!hub) return { node: null, corroborated: false, existed: false, reason: 'empty_graph' };
    const h = hashStr(ioc.kind + ':' + value);
    const rr = NX.rng(h);
    const src = String(ioc.source || '');
    const tag = /shield|защит/i.test(src) ? 'звонок клиенту' : /decoy|ловушк|приман/i.test(src) ? 'ловушка' : 'разведка';
    const isCash = ioc.kind === 'crypto';
    n = {
      id: 'ioc_' + h.toString(36) + '_' + G.nodes.length, label: (KIND_LABEL[ioc.kind] || 'Реквизит') + ' · ' + tag,
      account: ioc.raw || value, iocValue: value, iocKind: ioc.kind, iocSource: src,
      x: hub.x + (rr() - 0.5) * 140, y: hub.y + (rr() - 0.5) * 140, vx: 0, vy: 0,
      risk: 50, role: 'unknown', truth: isCash ? 'cashout' : 'mule', inSum: 0, outSum: 0, r: 10,
      live: true, fromIoc: true, blocked: false, flagged: false, synthHistory: o.history !== false,
    };
    G.nodes.push(n);
    if (o.history !== false) {
      // Детерминированная синтетическая история счёта (демо): 3 перевода от пострадавших сети за 7 дней
      // и транзит на хаб сети. В проде на этом месте — реальная история операций по реквизиту.
      const now = Date.now();
      // хронология согласована с сетью: последний приём за ~14 мин до транзита на хаб, транзит — до выхода хаба дальше
      const T0 = G.chainT0 || now - 95 * 60000;
      if (isCash) {
        G.edges.push({ s: hub, t: n, amount: Math.round(Math.max(300000, hub.inSum * 0.12)), fraud: true, ts: T0 + 20 * 60000, count: 2, synthetic: true, note: 'вывод с транзитного счёта сети (синтетическая история)' });
      } else {
        const pool = G.nodes.filter((x) => /^v\d+$/.test(x.id));
        const picked = [];
        for (let i = 0; i < pool.length && picked.length < 3; i++) { const v = pool[(h + i * 5) % pool.length]; if (picked.indexOf(v) < 0) picked.push(v); }
        let inflow = 0;
        picked.forEach((v, i) => {
          const amount = Math.round((260 + rr() * 190) * 1000);
          inflow += amount;
          const jit = Math.floor(rr() * 3600000);
          G.edges.push({ s: v, t: n, amount, fraud: true, ts: i === 0 ? T0 - 8 * 60000 : now - i * 2 * 86400000 - jit, count: 1, synthetic: true, note: 'приём от пострадавшего · синтетическая история за 7 дней' });
        });
        G.edges.push({ s: n, t: hub, amount: Math.round(inflow * 0.9), fraud: true, ts: T0 + 6 * 60000, count: 3, synthetic: true, note: 'транзит на хаб сети · синтетическая история' });
      }
    }
    recomputeSums();
    applyStatus(n, st);
    alpha = Math.max(alpha, 0.9);
    return result(n, false);
  };

  // пострадавший / клиент, чей перевод удержан: ребро к получателю (узел, id или счёт).
  // Получатель, которого нет в графе, становится отдельным узлом «Новый получатель» —
  // без привязки к известной сети (раньше такой перевод ошибочно рисовался на дроп m1).
  G.addVictim = function (name, amount, muleAccount, victimAccount) {
    const accStr = muleAccount && typeof muleAccount !== 'object' ? String(muleAccount).trim() : '';
    let mule = asNode(muleAccount);
    if (!mule && accStr) {
      let p = null;
      try { p = NX.parseAccount(accStr); } catch (e) { p = null; }
      if (p && p.value) mule = G.findIoc(p.kind, p.value) || G.nodes.find((n) => nodeKey(n) === p.kind + ':' + p.value) || null;
    }
    if (!mule) {
      if (!accStr || accStr === '—' || !G.nodes.length) return null;
      const h = hashStr('rcpt:' + accStr);
      const rr = NX.rng(h);
      mule = {
        id: 'rcpt_' + h.toString(36) + '_' + G.nodes.length, label: 'Новый получатель', account: accStr,
        x: (rr() - 0.5) * 300, y: (rr() - 0.5) * 220, vx: 0, vy: 0, risk: 20, role: 'unknown', truth: 'unknown',
        inSum: 0, outSum: 0, r: 9, live: true, blocked: false, flagged: false, recipient: true,
      };
      G.nodes.push(mule);
    }
    let v = G.nodes.find((n) => n.label === name);
    if (!v) {
      const acc = victimAccount || (NX.state && NX.state.user ? NX.state.user.card : 'KZ•• •••• ••••');
      v = { id: 'live_' + Date.now() + '_' + G.nodes.length, label: name, account: acc, x: mule.x - 80, y: mule.y + 40, vx: 0, vy: 0, risk: 50, role: G.detected ? 'victim' : 'unknown', truth: 'victim', inSum: 0, outSum: 0, r: 9, live: true };
      G.nodes.push(v);
    }
    const e = { s: v, t: mule, amount: Number(amount) || 0, fraud: true, fraudDetected: G.detected && !!mule.flagged, held: true, ts: Date.now(), count: 1 };
    G.edges.push(e);
    recomputeSums();
    alpha = Math.max(alpha, 0.8);
    return v;
  };

  // «Не стань дропом» (mule-exit.js): клиент, которого вербовали, сам сообщил банку.
  // Отдельные узлы, как магазины Leak Radar: роль задана полем fixedRole, G.detect её не перезаписывает.
  // 6 отправителей (victim) → вербуемый (recruit, не mule: цепочку он остановил) ⇢ куратор (существующий узел базы дропов,
  // его рёбра к транзиту и обналу — те же, что в сети). Попытка перевода куратору — пунктир (held): деньги не ушли.
  // Суммы этих рёбер в «Похищено» сетей не входят. c: {id, client, incoming:[{from, amount, ts}], attempt:{amount, ts}, curator:{kind, value}}
  G.addMuleExit = function (c) {
    if (!c || !c.id || !G.nodes.length) return null;
    const key = 'mx_' + c.id;
    const cur = c.curator ? (G.findIoc(c.curator.kind, c.curator.value) || G.nodes.find((n) => nodeKey(n) === c.curator.kind + ':' + c.curator.value) || null) : null;
    let rc = G.nodes.find((n) => n.id === key);
    if (rc) return { node: rc, curator: cur, existed: true };
    const base = cur || G.hub || G.nodes[0];
    rc = {
      id: key, label: String(c.client || 'Клиент').split(' (')[0].split(' ')[0] + ' · сообщил сам', account: 'счёт клиента (демо)',
      x: base.x - 170, y: base.y + 110, vx: 0, vy: 0, risk: 40, role: 'recruit', truth: 'recruit', fixedRole: 'recruit',
      inSum: 0, outSum: 0, r: 10, live: false, blocked: false, flagged: false, muleExit: c.id,
    };
    G.nodes.push(rc);
    const inc = c.incoming || [];
    inc.forEach((x, k) => {
      const a = (k / Math.max(1, inc.length)) * Math.PI * 2 + 0.4;
      const v = {
        id: key + '_v' + k, label: String(x.from || 'Отправитель'), account: 'отправитель · синтетика',
        x: rc.x + Math.cos(a) * 95, y: rc.y + Math.sin(a) * 95, vx: 0, vy: 0, risk: 45, role: 'victim', truth: 'victim', fixedRole: 'victim',
        inSum: 0, outSum: 0, r: 7, live: false, blocked: false, flagged: false, muleExit: c.id,
      };
      G.nodes.push(v);
      G.edges.push({ s: v, t: rc, amount: Number(x.amount) || 0, fraud: true, mx: true, ts: Number(x.ts) || Date.now(), count: 1, note: 'перевод незнакомого отправителя · синтетика' });
    });
    if (cur && c.attempt) G.edges.push({ s: rc, t: cur, amount: Number(c.attempt.amount) || 0, fraud: true, mx: true, held: true, ts: Number(c.attempt.ts) || Date.now(), count: 1, note: 'попытка перевода куратору — отменена клиентом' });
    recomputeSums();
    alpha = Math.max(alpha, 0.8);
    return { node: rc, curator: cur, existed: false };
  };

  // «Кредитный замок» (credit-lock.js): заявки на займы от чужого имени с одного нового устройства.
  // Узел «Устройство-фабрика заявок» (fixedRole 'factory', G.detect роль не меняет) → клиент, ответивший «Нет, это не я»,
  // и ещё 5 синтетических клиентов (рёбра с подписью «синтетика»); пунктир (held) — заявки не исполнены, денег не было.
  // Ребро к счёту выдачи: узел реквизита из стоп-листа (его связь с сетью — синтетическая история bank.js/G.addIoc).
  // c: {id, client, device:{id, os, city}, payout:{kind, value, raw}, apps:[{lender, amount, ts}]}
  const CL_SYNTH = ['Клиент А · синтетика', 'Клиент Б · синтетика', 'Клиент В · синтетика', 'Клиент Г · синтетика', 'Клиент Д · синтетика'];
  G.addCreditLock = function (c) {
    if (!c || !c.id || !c.device || !c.device.id || !G.nodes.length) return null;
    const fkey = 'cl_' + c.device.id;
    const payout = c.payout ? (G.findIoc(c.payout.kind, c.payout.value) || G.nodes.find((n) => nodeKey(n) === c.payout.kind + ':' + c.payout.value) || null) : null;
    let f = G.nodes.find((n) => n.id === fkey);
    const existed = !!f;
    const total = (c.apps || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
    if (!f) {
      const base = payout || G.hub || G.nodes[0];
      f = {
        id: fkey, label: 'Устройство ' + c.device.id + ' · ' + (c.device.os || 'Android') + ' · ' + (c.device.city || ''), account: 'устройство · ' + c.device.id + ' (демо)',
        x: base.x + 170, y: base.y - 130, vx: 0, vy: 0, risk: 90, role: 'factory', truth: 'factory', fixedRole: 'factory',
        inSum: 0, outSum: 0, r: 11, live: false, blocked: false, flagged: false, creditLock: c.device.id,
      };
      G.nodes.push(f);
      CL_SYNTH.forEach((name, k) => {
        const a = ((k + 1) / (CL_SYNTH.length + 1)) * Math.PI * 2 + 0.3;
        const rr = NX.rng(hashStr(fkey + ':' + k));
        const v = {
          id: fkey + '_s' + k, label: name, account: 'клиент · синтетика',
          x: f.x + Math.cos(a) * 105, y: f.y + Math.sin(a) * 105, vx: 0, vy: 0, risk: 45, role: 'victim', truth: 'victim', fixedRole: 'victim',
          inSum: 0, outSum: 0, r: 7, live: false, blocked: false, flagged: false, creditLock: c.device.id,
        };
        G.nodes.push(v);
        G.edges.push({ s: f, t: v, amount: Math.round((100 + rr() * 200) * 1000), fraud: true, cl: true, held: true, synthetic: true, ts: Date.now() - Math.floor(rr() * 6) * 86400000, count: 1, note: 'заявка на заём от имени клиента · синтетика' });
      });
    }
    const ckey = fkey + '_c_' + c.id;
    let cn = G.nodes.find((n) => n.id === ckey);
    if (!cn) {
      cn = {
        id: ckey, label: String(c.client || 'Клиент').split(' (')[0].split(' ')[0] + ' · «это не я»', account: 'клиент кабинета (демо)',
        x: f.x - 105, y: f.y + 20, vx: 0, vy: 0, risk: 45, role: 'victim', truth: 'victim', fixedRole: 'victim',
        inSum: 0, outSum: 0, r: 9, live: true, blocked: false, flagged: false, creditLock: c.device.id,
      };
      G.nodes.push(cn);
      G.edges.push({ s: f, t: cn, amount: total, fraud: true, cl: true, held: true, ts: Date.now(), count: (c.apps || []).length || 1, note: 'заявки на займы от имени клиента — заморожены или отклонены' });
    }
    if (payout && !G.edges.some((e) => e.cl && e.s === f && e.t === payout)) {
      G.edges.push({ s: f, t: payout, amount: total, fraud: true, cl: true, held: true, ts: Date.now(), count: 1, note: 'выдачу займов просили на этот счёт — денег не было' });
    }
    recomputeSums();
    alpha = Math.max(alpha, 0.8);
    return { node: f, client: cn, payout, existed };
  };

  /* ---------------- Personalized PageRank и объяснимый путь ---------------- */
  function adjacency() {
    const adj = new Map();
    G.nodes.forEach((n) => adj.set(n, []));
    G.edges.forEach((e) => {
      if (!adj.has(e.s) || !adj.has(e.t) || e.s === e.t) return;
      adj.get(e.s).push({ o: e.t, e }); adj.get(e.t).push({ o: e.s, e });
    });
    return adj;
  }
  // PPR: случайное блуждание по денежным потокам (рёбра неориентированные, вес ~ log суммы × число операций),
  // с вероятностью alpha=0,15 возврат в seed; 30 итераций степенного метода. Возвращает топ счетов-получателей.
  G.ppr = function (seed, opts) {
    const o = opts || {};
    const s = asNode(seed);
    const N = G.nodes;
    if (!s || !N.length) return [];
    const idx = new Map(); N.forEach((n, i) => idx.set(n, i));
    const s0 = idx.get(s);
    const nb = N.map(() => []);
    G.edges.forEach((e) => {
      const a = idx.get(e.s), b = idx.get(e.t);
      if (a == null || b == null || a === b) return;
      const w = Math.log(1 + (e.amount || 0) / 10000) * (e.count || 1) + 0.01;
      nb[a].push([b, w]); nb[b].push([a, w]);
    });
    const deg = nb.map((l) => l.reduce((acc, x) => acc + x[1], 0));
    const a = o.alpha == null ? 0.15 : o.alpha;
    const iters = o.iters || 30;
    let r = new Float64Array(N.length); r[s0] = 1;
    for (let it = 0; it < iters; it++) {
      const nx = new Float64Array(N.length);
      let dangling = 0;
      for (let i = 0; i < N.length; i++) {
        const ri = r[i];
        if (!ri) continue;
        if (!deg[i]) { dangling += ri; continue; }
        const m = ((1 - a) * ri) / deg[i];
        const l = nb[i];
        for (let k = 0; k < l.length; k++) nx[l[k][0]] += m * l[k][1];
      }
      nx[s0] += a + (1 - a) * dangling;
      r = nx;
    }
    const res = [];
    N.forEach((n, i) => {
      if (i === s0 || !(r[i] > 0)) return;
      if (!o.all && !(n.inSum > 0)) return; // только счета, на которые приходили деньги
      if (n.iocValue && (n.iocStatus === 'revoked' || n.iocStatus === 'expired')) return;
      res.push({ node: n, score: r[i] });
    });
    res.sort((x, y) => y.score - x.score);
    const top = res.slice(0, o.top || 10);
    const mx = top.length ? top[0].score : 1;
    top.forEach((x) => (x.rel = Math.max(1, Math.round((x.score / mx) * 100))));
    return top;
  };
  // Кратчайший путь (BFS по денежным связям). Возвращает {nodes, edges, text, hops} или null.
  G.explainPath = function (seed, target) {
    const s = asNode(seed), t = asNode(target === undefined ? G.hub : target);
    if (!s || !t) return null;
    if (s === t) return { nodes: [s], edges: [], text: s.label, hops: 0 };
    const adj = adjacency();
    const prev = new Map(); prev.set(s, null);
    const q = [s]; let found = false;
    while (q.length && !found) {
      const n = q.shift();
      const list = adj.get(n) || [];
      for (let k = 0; k < list.length; k++) {
        const x = list[k];
        if (prev.has(x.o)) continue;
        prev.set(x.o, { from: n, e: x.e });
        if (x.o === t) { found = true; break; }
        q.push(x.o);
      }
    }
    if (!found) return null;
    const nodes = [t], edges = [];
    let cur = t;
    while (prev.get(cur)) { const p = prev.get(cur); edges.unshift(p.e); nodes.unshift(p.from); cur = p.from; }
    let text = nodes[0].label;
    for (let i = 1; i < nodes.length; i++) { const e = edges[i - 1]; text += (e.s === nodes[i - 1] ? ' → ' : ' ← ') + nodes[i].label; }
    return { nodes, edges, text, hops: edges.length };
  };

  // Подсветка: {seed, nodes:[...], path:{nodes, edges}} или null
  G.setHighlight = function (h) { G.highlight = h || null; };
  G.clearHighlight = function () { G.highlight = null; };
  // Плавно навести камеру на узел (ms — сколько держать фокус, k — масштаб)
  G.focus = function (x, opts) {
    const n = asNode(x);
    if (!n) return false;
    const o = opts || {};
    focusNode = n; focusUntil = performance.now() + (o.ms || 4000); focusK = o.k || Math.max(view.k, 1);
    alpha = Math.max(alpha, 0.2);
    return true;
  };
  G.resetView = function () { view.x = 0; view.y = 0; focusNode = null; };
  // Масштаб (кнопки «+ / −» над графом и щипок двумя пальцами) и «вписать граф в окно»
  G.zoom = function (f) { focusNode = null; view.k = clampK(view.k * (Number(f) || 1)); return view.k; };
  G.fit = function () { view.x = 0; view.y = 0; focusNode = null; view.k = fitK; return view.k; };

  /* ---------------- физика ---------------- */
  function tick() {
    const N = G.nodes, E = G.edges;
    if (alpha < 0.005 && !drag) return;
    for (let i = 0; i < N.length; i++) {
      const a = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const b = N[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 160000) continue;
        const f = (900 / d2) * alpha, d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.vx -= dx * f * 6; a.vy -= dy * f * 6; b.vx += dx * f * 6; b.vy += dy * f * 6;
      }
    }
    E.forEach((e) => {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const L = e.fraud ? 70 : 110, k = 0.02 * alpha;
      const f = (d - L) * k;
      e.s.vx += (dx / d) * f; e.s.vy += (dy / d) * f; e.t.vx -= (dx / d) * f; e.t.vy -= (dy / d) * f;
    });
    N.forEach((n) => {
      n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.006 * alpha;
      if (n === drag) { n.vx = n.vy = 0; return; }
      n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
    });
    alpha *= 0.992;
  }
  function stepFocus(now) {
    if (!focusNode || drag) return;
    if (now > focusUntil || G.nodes.indexOf(focusNode) < 0) { focusNode = null; return; }
    view.x += (-focusNode.x - view.x) * 0.1;
    view.y += (-focusNode.y - view.y) * 0.1;
    if (focusK) view.k += (focusK - view.k) * 0.08;
  }

  /* ---------------- отрисовка ---------------- */
  const toScreen = (n) => [W / 2 + (n.x + view.x) * view.k, H / 2 + (n.y + view.y) * view.k];
  function color(n) { if (n.blocked) return PAL.blocked; if (n.fixedRole) return COLORS[n.role] || COLORS.unknown; return G.detected ? COLORS[n.role] || COLORS.unknown : COLORS.unknown; }
  function draw(now) {
    if (!g || !W || !H) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const sel = G.selected;
    const t = (now - t0) / 1000;
    const hl = G.highlight;
    const hlNodes = hl && hl.nodes ? new Set(hl.nodes) : null;
    const pathEdges = hl && hl.path && hl.path.edges ? new Set(hl.path.edges) : null;
    const pathNodes = hl && hl.path && hl.path.nodes ? new Set(hl.path.nodes) : null;
    // рёбра
    G.edges.forEach((e) => {
      const p1 = toScreen(e.s), p2 = toScreen(e.t);
      const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
      const fr = (G.detected && e.fraudDetected) || (!!e.mx && !e.held);
      const near = sel && (e.s === sel || e.t === sel);
      const onPath = pathEdges && pathEdges.has(e);
      g.strokeStyle = onPath ? rgba(PAL.accent, 0.95) : fr ? rgba(PAL.danger, near ? 0.95 : 0.6) : near ? rgba(PAL.accent, 0.8) : rgba(PAL.edge, 0.75);
      g.lineWidth = Math.max(0.7, Math.min(4, Math.log10(e.amount / 10000 + 1) * 1.4)) * (onPath ? 2 : near ? 1.5 : 1);
      if (e.held) g.setLineDash([5, 4]); else g.setLineDash([]);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.setLineDash([]);
      // стрелка
      const ang = Math.atan2(y2 - y1, x2 - x1), rr = e.t.r * view.k + 3;
      const ax = x2 - Math.cos(ang) * rr, ay = y2 - Math.sin(ang) * rr;
      g.fillStyle = g.strokeStyle;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax - Math.cos(ang - 0.4) * 7, ay - Math.sin(ang - 0.4) * 7); g.lineTo(ax - Math.cos(ang + 0.4) * 7, ay - Math.sin(ang + 0.4) * 7); g.fill();
      // частицы денег по фрод-рёбрам и по объясняющему пути
      if ((fr || onPath) && !e.held) {
        for (let p = 0; p < 2; p++) {
          const q = (t * 0.45 + p * 0.5 + (e.amount % 97) / 97) % 1;
          g.fillStyle = onPath ? PAL.accentInk : PAL.dangerInk;
          g.beginPath(); g.arc(x1 + (x2 - x1) * q, y1 + (y2 - y1) * q, 1.8, 0, Math.PI * 2); g.fill();
        }
      }
    });
    // волна сканирования
    if (scanT > 0) {
      const p = (now - scanT) / 1400;
      if (p > 0 && p < 1) { g.strokeStyle = rgba(PAL.accent, (1 - p) * 0.5); g.lineWidth = 2; g.beginPath(); g.arc(W / 2, H / 2, p * Math.max(W, H) * 0.8, 0, Math.PI * 2); g.stroke(); }
    }
    // узлы
    G.nodes.forEach((n) => {
      const ps = toScreen(n), x = ps[0], y = ps[1], r = n.r * view.k;
      const c = color(n);
      if (G.detected && n.flagged && !n.blocked) {
        const pulse = 1 + 0.25 * Math.sin(t * 3 + n.r);
        g.fillStyle = c + '2E'; g.beginPath(); g.arc(x, y, r * 2 * pulse, 0, Math.PI * 2); g.fill();
      }
      if (hlNodes && hlNodes.has(n)) { g.strokeStyle = rgba(PAL.warn, 0.95); g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 4, 0, Math.PI * 2); g.stroke(); }
      if (hl && hl.seed === n) { g.strokeStyle = rgba(PAL.accent, 0.9); g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, r + 9 + Math.sin(t * 4) * 2.5, 0, Math.PI * 2); g.stroke(); }
      if (n.live && !n.iocValue) { g.strokeStyle = PAL.accent; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 5 + Math.sin(t * 4) * 2, 0, Math.PI * 2); g.stroke(); }
      if (n.iocValue) {
        g.strokeStyle = STATUS_COLORS[n.iocStatus] || STATUS_COLORS.suspected; g.lineWidth = 2.5;
        if (n.iocStatus === 'suspected') g.setLineDash([4, 3]);
        g.beginPath(); g.arc(x, y, r + 5 + Math.sin(t * 4) * 1.5, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      // тёмная обводка цвета панели отделяет узел от рёбер
      g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = PAL.surface; g.lineWidth = 1.5; g.stroke();
      if (n === sel || n === hover) { g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 3, 0, Math.PI * 2); g.stroke(); }
      if (n.blocked) { g.strokeStyle = PAL.danger; g.lineWidth = 2; g.beginPath(); g.moveTo(x - r * 0.6, y - r * 0.6); g.lineTo(x + r * 0.6, y + r * 0.6); g.moveTo(x + r * 0.6, y - r * 0.6); g.lineTo(x - r * 0.6, y + r * 0.6); g.stroke(); }
      const showLabel = (G.detected && n.flagged) || n.fixedRole === 'recruit' || n.fixedRole === 'factory' || n === sel || n === hover || n.live || (hlNodes && hlNodes.has(n)) || (pathNodes && pathNodes.has(n));
      if (showLabel) {
        // светлая подпись с тёмным ореолом — читается поверх рёбер и сетки
        g.font = '600 12px Inter, sans-serif'; g.textAlign = 'center'; g.lineJoin = 'round';
        g.strokeStyle = rgba(PAL.surface, 0.92); g.lineWidth = 3.5; g.strokeText(n.label, x, y + r + 14);
        g.fillStyle = PAL.ink; g.fillText(n.label, x, y + r + 14);
        if (n.iocValue) {
          const stTxt = STATUS_SHORT[n.iocStatus] || '';
          g.font = '600 11px Inter, sans-serif'; g.strokeText(stTxt, x, y + r + 27);
          g.fillStyle = STATUS_INK[n.iocStatus] || STATUS_INK.suspected;
          g.fillText(stTxt, x, y + r + 27);
        }
      }
    });
  }
  let errLogged = false;
  function loop() {
    const now = performance.now();
    try { tick(); stepFocus(now); draw(now); } catch (e) { if (!errLogged) { console.error('graph draw', e); errLogged = true; } }
    requestAnimationFrame(loop);
  }

  function resize() {
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    if (W && H) {
      const prevFit = fitK;
      fitK = Math.min(1.25, Math.max(0.45, Math.min(W / 820, H / 600)));
      // пользователь не менял масштаб вручную — подстраиваемся под новый размер окна
      if (Math.abs(view.k - prevFit) < 1e-6 || !resized) view.k = fitK;
      resized = true;
    }
  }
  let resized = false;
  function pick(mx, my, slop) {
    let best = null, bd = 1e9;
    const s = slop == null ? 6 : slop;
    G.nodes.forEach((n) => { const p = toScreen(n); const d = Math.hypot(p[0] - mx, p[1] - my); if (d < n.r * view.k + s && d < bd) { bd = d; best = n; } });
    return best;
  }
  function tipHTML(n) {
    const st = n.iocValue ? '<div class="tiny" style="color:' + (STATUS_INK[n.iocStatus] || PAL.warnInk) + '">Стоп-лист: ' + NX.esc((NX.IOC_STATUS && NX.IOC_STATUS[n.iocStatus]) || n.iocStatus || '') + '</div>' : '';
    return '<b>' + NX.esc(n.label) + '</b><div class="muted mono tiny">' + NX.esc(G.disp(n)) + '</div><div class="tiny">Вход: ' + NX.fmt(n.inSum) + ' · Выход: ' + NX.fmt(n.outSum) + '</div>' + (G.detected || n.fixedRole ? '<div class="tiny" style="color:' + (COLORS_INK[n.role] || COLORS_INK.unknown) + '">' + NX.esc(ROLE_RU[n.role] || '') + '</div>' : '') + st + (n.device ? '<div class="tiny muted">устройство ' + NX.esc(n.device) + ' (синтет. id)</div>' : '') + (n.synthHistory ? '<div class="tiny muted">' + NX.esc(G.SYNTH_NOTE) + '</div>' : '');
  }
  G.init = function (canvas, tip) {
    if (!canvas || !canvas.getContext) return;
    cv = canvas; g = cv.getContext('2d');
    readPalette();
    G.build(); resize(); t0 = performance.now();
    // пересчёт в следующем кадре: изменение размера canvas внутри колбэка вызывало «ResizeObserver loop»
    let roRaf = 0;
    if (window.ResizeObserver) new window.ResizeObserver(() => { if (roRaf) return; roRaf = requestAnimationFrame(() => { roRaf = 0; resize(); }); }).observe(cv);
    else window.addEventListener('resize', resize);
    const pos = (e) => { const r = cv.getBoundingClientRect(); const p = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e; return [p.clientX - r.left, p.clientY - r.top]; };
    let tipTimer = 0;
    const hideTip = () => { clearTimeout(tipTimer); if (tip) tip.style.display = 'none'; };
    const showTip = (n, mx, my) => {
      if (!tip || !n) return;
      tip.innerHTML = tipHTML(n);
      tip.style.display = 'block';
      const tw = tip.offsetWidth || 240, th = tip.offsetHeight || 80;
      tip.style.left = Math.max(4, Math.min(mx + 14, W - tw - 4)) + 'px';
      tip.style.top = Math.max(4, Math.min(my + 14, H - th - 4)) + 'px';
    };
    const toWorld = (mx, my) => [(mx - W / 2) / view.k - view.x, (my - H / 2) / view.k - view.y];

    if (window.PointerEvent) {
      // Pointer Events: мышь, перо и палец одним кодом. Узел — перетаскивание, пустое место — сдвиг графа,
      // два пальца — масштаб, касание без движения — выбор узла (на касании показываем подсказку).
      cv.style.touchAction = 'none';
      const pts = new Map();
      let pan = null, pinch = null, downAt = null, downType = 'mouse';
      const SLOP = { mouse: 3, pen: 5, touch: 8 };
      const two = () => { const v = Array.from(pts.values()); return [v[0], v[1]]; };
      cv.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!W) resize(); // окно графа только что стало видимым — ResizeObserver мог ещё не сработать
        if (!W) return;
        const p = pos(e);
        try { cv.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
        pts.set(e.pointerId, p);
        if (pts.size === 2) {
          const ab = two();
          pinch = { d: Math.max(10, Math.hypot(ab[0][0] - ab[1][0], ab[0][1] - ab[1][1])), k: view.k };
          drag = null; pan = null; moved = true; focusNode = null; hideTip();
          return;
        }
        if (pts.size > 2) return;
        downType = e.pointerType || 'mouse'; downAt = p; moved = false;
        const n = pick(p[0], p[1], downType === 'touch' ? 16 : 6);
        if (n) { drag = n; focusNode = null; alpha = Math.max(alpha, 0.3); }
        else { pan = { x: p[0], y: p[1], vx: view.x, vy: view.y }; focusNode = null; }
        e.preventDefault();
      });
      cv.addEventListener('pointermove', (e) => {
        if (!W) return;
        const p = pos(e), mx = p[0], my = p[1];
        if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
        if (pinch && pts.size >= 2) {
          const ab = two();
          view.k = clampK(pinch.k * (Math.hypot(ab[0][0] - ab[1][0], ab[0][1] - ab[1][1]) / pinch.d));
          return;
        }
        const far = downAt && Math.hypot(mx - downAt[0], my - downAt[1]) > (SLOP[downType] || 4);
        if (drag) {
          if (!moved && !far) return;
          moved = true; hideTip();
          const w = toWorld(mx, my); drag.x = w[0]; drag.y = w[1]; alpha = Math.max(alpha, 0.2);
          return;
        }
        if (pan) {
          if (!moved && !far) return;
          moved = true; hideTip();
          view.x = pan.vx + (mx - pan.x) / view.k; view.y = pan.vy + (my - pan.y) / view.k;
          cv.style.cursor = 'grabbing';
          return;
        }
        if (e.pointerType !== 'mouse') return;
        hover = pick(mx, my);
        cv.style.cursor = hover ? 'pointer' : 'grab';
        if (hover) showTip(hover, mx, my); else hideTip();
      });
      const end = (e) => {
        const had = pts.has(e.pointerId);
        pts.delete(e.pointerId);
        try { cv.releasePointerCapture(e.pointerId); } catch (er) { /* ignore */ }
        if (pinch) { if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; pan = null; } return; }
        if (!had) return;
        const tap = !moved && e.type === 'pointerup';
        if (drag && tap) {
          select(drag);
          if (downType !== 'mouse' && downAt) { const n = drag; showTip(n, downAt[0], downAt[1]); clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 3200); }
        } else if (pan && tap) { select(null); hideTip(); }
        drag = null; pan = null; downAt = null;
        cv.style.cursor = 'grab';
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag && !pan) { hover = null; hideTip(); } });
    } else {
      // старые браузеры: мышь + touch-события
      const down = (e) => { const p = pos(e); const n = pick(p[0], p[1], e.touches ? 16 : 6); moved = false; if (n) { drag = n; focusNode = null; alpha = Math.max(alpha, 0.3); e.preventDefault(); } };
      const move = (e) => {
        if (!W) return;
        const p = pos(e), mx = p[0], my = p[1];
        if (drag) { moved = true; const w = toWorld(mx, my); drag.x = w[0]; drag.y = w[1]; alpha = Math.max(alpha, 0.2); e.preventDefault(); return; }
        if (e.target !== cv) { if (hover) { hover = null; hideTip(); } return; }
        hover = pick(mx, my);
        cv.style.cursor = hover ? 'pointer' : 'grab';
        if (hover) showTip(hover, mx, my); else hideTip();
      };
      const up = () => { if (drag && !moved) select(drag); drag = null; };
      cv.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      cv.addEventListener('touchstart', down, { passive: false }); cv.addEventListener('touchmove', move, { passive: false }); cv.addEventListener('touchend', up);
      cv.addEventListener('mouseleave', () => { hover = null; hideTip(); });
      cv.addEventListener('click', (e) => { if (!moved) { const p = pos(e); const n = pick(p[0], p[1]); if (!n) select(null); } });
    }
    requestAnimationFrame(loop);
  };
  function select(n) { G.selected = n || null; G.listeners.forEach((f) => { try { f(G.selected); } catch (e) { console.error(e); } }); }
  G.select = function (x) { select(x ? asNode(x) : null); };
  G.onSelect = (f) => G.listeners.push(f);
  G.ROLE_RU = ROLE_RU; G.COLORS = COLORS; G.STATUS_COLORS = STATUS_COLORS;
  G.COLORS_INK = COLORS_INK; G.STATUS_INK = STATUS_INK; G.PAL = PAL; G.readPalette = readPalette;
  G.neighbors = (n) => ({ in: G.edges.filter((e) => e.t === n), out: G.edges.filter((e) => e.s === n) });
})();
