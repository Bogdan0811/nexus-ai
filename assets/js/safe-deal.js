/* =====================================================================
   NEXUS AI — Безопасная сделка · деньги ждут в банке до получения товара (покупка у частного лица на сайте объявлений)
   - покупатель платит не продавцу, а в «конверт» банка: продавец видит, что деньги зарезервированы,
     но забрать их может только после подтверждения получения или события «вручено» от доставки (симуляция)
   - срок конверта истёк, а товар не вручён → деньги автоматически возвращаются покупателю
   - спор покупателя → инцидент в Fusion Center; ПРИЗНАННЫЕ банком претензии (решение «вернуть покупателю»)
     НЕЗАВИСИМЫХ покупателей к одному счёту продавца (порог DISPUTE_N) → счёт продавца входит в жизненный цикл
     IOC общего стоп-листа (core.js NX.iocs). Открытые и отклонённые споры в стоп-лист не попадают.
   - встроенные проверки: ссылка/сообщение продавца (NX.scanText, NX.analyzeUrl), «переведите напрямую»,
     счёт продавца по стоп-листу, базе дропов и «Ваш обычный перевод»
   - телефон продавца (симуляция): «деньги зарезервированы банком», код сделки, проверка кода против
     поддельного скриншота «я уже оплатил»
   API: NX.SafeDeal. Шина: safe_deal_created, safe_deal_update, safe_deal_dispute, safe_deal_seller_flagged,
   safe_deal_state. Хранилище: nexus_ai_safedeal_v1 (сброс сцены его очищает).
   Симуляция на синтетических данных; в продукте требует договора эскроу и правовой базы.
   Концепт команды, не продукт банка-организатора. Площадки объявлений и доставки — обобщённые, без брендов.
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  if (!NX || !NX.bus) return;

  const esc = (v) => NX.esc(v);
  const ic = (n, s) => (NX.icon ? NX.icon(n, '', s || 16) : '');
  const $ = (s, r) => (r || document).querySelector(s);
  const FLAGS = NX.flags || {};
  const EMBED = !!FLAGS.embed;
  // сцена (stage.html, шаг 7 «Не только звонки») временно включает раздел и во встроенном режиме
  let stageOn = false;
  const HIDE = () => EMBED && !stageOn;
  const WANT_DEAL = (() => { try { return window.location.hash === '#deal'; } catch (e) { return false; } })();
  const PAGE = () => NX.page || '';
  const KEY = 'nexus_ai_safedeal_v1';
  if (NX.KEYS) NX.KEYS.safedeal = KEY;
  const MIN = 60000;
  const DEMO_TTL = 10 * MIN; // срок конверта в демо; в продукте — по договору (например, 5 дней после отправки)
  const DISPUTE_N = 2; // споры стольких НЕЗАВИСИМЫХ покупателей против одного счёта → IOC
  const SRC = 'Безопасная сделка · спор покупателя';
  const SIM_LABEL = 'Симуляция; в продукте требует договора эскроу и правовой базы';
  const q = (s) => '«' + s + '»';

  const STATUS = {
    reserved: ['Деньги в конверте банка', 'info'],
    shipped: ['Отправлено · ждём вручения', 'info'],
    disputed: ['Спор · деньги заморожены', 'high'],
    released: ['Выплачено продавцу', 'ok'],
    refunded: ['Возвращено покупателю', 'ok'],
  };
  const OPEN = (d) => d && (d.status === 'reserved' || d.status === 'shipped');
  const REASONS = {
    not_delivered: 'Товар не пришёл',
    not_as_described: 'Товар не соответствует описанию',
    extra_payment: 'Продавец требует доплату вне сделки',
    other: 'Другое',
  };

  // проверки текста продавца
  const DIRECT_RE = /(напрямую|на\s+(мою\s+|эту\s+)?карт[уы]|на\s+(мой\s+)?номер|мимо\s+(сделки|конверта|банка)|без\s+(безопасной\s+)?сделки|через\s+(безопасную\s+)?сделку[^.!?\n]{0,25}не\s+(делаю|работаю|буду)|сделк[аиу]\s+не\s+(делаю|буду)|предоплат|скинь(те)?\b|переведите\s+сразу)/i;
  // «оплата доставки» сама по себе — обычная фраза («оплата при доставке»); признак схемы — только вместе со ссылкой
  const PAY_DELIVERY_RE = /(оплат[а-яё]*[^.!?\n]{0,20}доставк|доставк[а-яё]*[^.!?\n]{0,30}оплат)/i;
  const LINK_WORD_RE = /ссылк/i;
  const FAKE_PAY_RE = /(получ[а-яё]*\s+(деньги|оплату|средства)[^.!?\n]{0,25}ссылк|данные\s+карты|cvv|cvc|срок\s+действия\s+карты|код\s+из\s+(sms|смс)|подтверд[а-яё]*\s+получение\s+(средств|оплаты|денег))/i;
  const PRESSURE_RE = /(быстрее|срочно|сегодня\s+же|есть\s+(ещё|еще|другой)\s+покупател|последн\w+\s+шанс|бронь\s+сгорит)/i;
  // домен выдаёт себя за «безопасную сделку» или «доставку»: настоящий конверт по ссылкам не работает
  const IMPERSONATE = ['sdelka', 'sdelk', 'safedeal', 'safe-deal', 'escrow', 'garant', 'dostavka', 'delivery', 'oplata', 'pay'];

  // обобщённые примеры (синтетика)
  const SAMPLES = {
    honest: { label: 'Обычный продавец', name: 'Арман С. (синтет.)', account: '+7 702 118 40 52', item: 'Велосипед б/у', amount: 85000,
      text: 'Добрый день! Велосипед в наличии, могу отправить доставкой завтра. Оплата через безопасную сделку банка — без проблем.' },
    fake: { label: 'Фейковая «оплата доставки»', name: 'Дина К. (синтет.)', account: '+7 771 904 12 66', item: 'Детская коляска', amount: 62000,
      text: 'Здравствуйте! Оформила доставку через сервис. Оплатите заказ и доставку по ссылке: http://dostavka-bezopasnaya-sdelka.test/pay?order=8812 — введите данные карты, деньги будут на удержании.' },
    direct: { label: '«Переведите на карту напрямую»', name: 'Ерболат Т. (синтет.)', account: '+7 747 220 31 09', item: 'Смартфон б/у', amount: 140000,
      text: 'Через сделку банка не делаю, долго ждать. Переведите на карту напрямую 4400 4301 2288 1947, отправлю сразу. Решайте быстрее, есть ещё покупатель.' },
    mule: { label: 'Продавец из базы дропов', name: 'Нурлан А. (синтет.)', account: (NX.MULE_ACCOUNTS && NX.MULE_ACCOUNTS[1] ? NX.MULE_ACCOUNTS[1].account : '+7 708 555 12 90'), item: 'Игровая приставка', amount: 120000,
      text: 'Вещь новая, торг уместен. Оплата переводом.' },
  };
  // Fusion Center: споры двух синтетических покупателей против одного продавца
  // несколько синтетических продавцов: повторный запуск берёт следующего, если предыдущий уже в стоп-листе
  const SIM_SELLERS = [
    { name: 'Продавец «Ноутбук б/у» (синтет.)', account: '+7 705 000 41 27' },
    { name: 'Продавец «Ноутбук б/у» №2 (синтет.)', account: '+7 705 000 52 38' },
    { name: 'Продавец «Ноутбук б/у» №3 (синтет.)', account: '+7 705 000 63 49' },
  ];
  const SIM_BUYERS = [
    { name: 'Мадина Ж. (синтет.)', item: 'Ноутбук б/у', amount: 185000 },
    { name: 'Олжас Б. (синтет.)', item: 'Ноутбук б/у', amount: 172000 },
    { name: 'Жанна Т. (синтет.)', item: 'Ноутбук б/у', amount: 179000 },
  ];

  /* ---------------- хранилище ---------------- */
  const resetting = () => !!(NX.isResetting && NX.isResetting());
  const blank = () => ({ v: 1, deals: [] });
  const pending = new Map(); // сделки из шины, которые ещё не видны в localStorage этой вкладки
  function load() {
    let s = null;
    try { s = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || s.v !== 1 || !Array.isArray(s.deals)) s = blank();
    s.deals = s.deals.filter((d) => d && d.id && d.seller);
    pending.forEach((d, id) => {
      const i = s.deals.findIndex((x) => x.id === id);
      if (i < 0) s.deals.unshift(d);
      else if ((Number(s.deals[i].upd) || 0) < (Number(d.upd) || 0)) s.deals[i] = d;
      else pending.delete(id);
    });
    return s;
  }
  function save(s) {
    if (resetting()) return false;
    try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, deals: s.deals.slice(0, 80) })); return true; } catch (e) { return false; }
  }
  // fn(deal, state) → false отменяет изменение
  function mutate(id, fn) {
    const s = load();
    const d = s.deals.find((x) => x.id === id);
    if (!d) return null;
    if (fn(d, s) === false) return null;
    d.upd = Date.now();
    save(s);
    pending.delete(id);
    return d;
  }
  const me = () => { try { return (NX.state && NX.state.user && NX.state.user.name) || 'Клиент'; } catch (e) { return 'Клиент'; } };
  const byId = (id) => load().deals.find((d) => d.id === id) || null;
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const byCode = (code) => { const k = normCode(code); return k ? load().deals.find((d) => normCode(d.code) === k) || null : null; };
  const sellerKey = (sel) => (sel && sel.kind && sel.value ? sel.kind + ':' + sel.value : 'raw:' + String(sel && sel.account || ''));

  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function rnd(n) {
    try { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; } catch (e) { return Math.floor(Math.random() * n); }
  }
  function genCode() {
    for (let k = 0; k < 20; k++) {
      let s = ''; for (let i = 0; i < 4; i++) s += ABC[rnd(ABC.length)];
      const c = 'SD-' + s + '-' + (10 + rnd(90));
      if (!byCode(c)) return c;
    }
    return 'SD-' + Date.now().toString(36).toUpperCase().slice(-4) + '-' + (10 + rnd(90));
  }
  // маскирование счёта для показа: последние 4 цифры
  function maskAcc(a) {
    const s = String(a || '');
    const d = s.replace(/\D/g, '');
    if (/^KZ/i.test(s.replace(/\s/g, ''))) return 'KZ•• •••• ' + s.replace(/\s/g, '').slice(-4);
    if (d.length >= 13 && s.trim().charAt(0) !== '+') return '•••• ' + d.slice(-4);
    if (d.length >= 10) return '+7 ••• ••• ' + d.slice(-4, -2) + ' ' + d.slice(-2);
    return s;
  }
  function fmtLeft(ms) {
    const v = Math.max(0, Math.round(ms / 1000));
    if (v >= 3600) return Math.floor(v / 3600) + ' ч ' + Math.floor((v % 3600) / 60) + ' мин';
    return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
  }
  const hist = (d, t, by) => { d.history = (d.history || []).concat([{ ts: Date.now(), t: String(t), by: by || '' }]).slice(-30); };

  /* ---------------- проверки продавца ---------------- */
  function assess(oIn) {
    const o = oIn || {};
    const text = String(o.text || '');
    const amount = Math.max(0, Math.round(Number(o.amount) || 0));
    const acc = o.account ? NX.parseAccount(o.account) : null;
    const accOk = !!(acc && acc.kind !== 'domain');
    let mule = null, rec = null, st = null;
    if (accOk) {
      try { mule = NX.findMule(acc.kind, acc.value); } catch (e) { mule = null; }
      try { rec = NX.iocs.find(acc.kind, acc.value); st = rec ? NX.iocs.status(acc.kind, acc.value) : null; } catch (e) { rec = null; st = null; }
    }
    const active = st && NX.iocActive ? NX.iocActive(st) : false;
    const flag = mule ? 'mule' : active ? st : null;
    let dna = null;
    if (NX.DNA && amount > 0) {
      const basis = rec && NX.iocIndependentSources && NX.iocIndependentSources(rec) >= 2 ? 'sources' : '';
      try { dna = NX.DNA.assess({ amount, newRecipient: true, recipient: o.name || 'продавец', recipientFlag: flag, recipientFlagBasis: basis, balance: NX.state && NX.state.user ? NX.state.user.balance : 0 }, {}); } catch (e) { dna = null; }
    }
    const scan = text.trim() ? NX.scanText(text) : null;
    const urls = (text.trim() ? NX.extractUrls(text) : []).map((u) => {
      const r = NX.analyzeUrl(u);
      const host = String(r.domain || '').toLowerCase();
      const imp = !r.official && IMPERSONATE.some((w) => host.indexOf(w) >= 0);
      return { url: u, domain: host, score: r.score, official: !!r.official, flags: (r.flags || []).filter((f) => !f.good).map((f) => f.why), imp };
    });
    const fakePay = FAKE_PAY_RE.test(text) || (PAY_DELIVERY_RE.test(text) && (urls.length > 0 || LINK_WORD_RE.test(text)));
    const direct = DIRECT_RE.test(text);
    const pressure = PRESSURE_RE.test(text);
    const otherAcc = text.trim() ? NX.extractIocs(text).filter((x) => x.kind !== 'domain' && (!accOk || !(x.kind === acc.kind && x.value === acc.value))) : [];
    const linkRisk = urls.some((u) => !u.official && (u.imp || u.score >= 25)) || fakePay;
    const blocked = !!mule || st === 'corroborated' || st === 'confirmed';
    // споры против этого счёта: открытые (банк ещё не решил) — только предупреждение, не блокировка
    const dagg = accOk ? aggFor({ kind: acc.kind, value: acc.value }) : null;
    const disputes = { pending: dagg ? dagg.pendingBuyers.length : 0, confirmed: dagg ? dagg.cBuyers.length : 0, fromDisputes: !!(rec && (rec.sources || []).indexOf(SRC) >= 0) };
    return { acc: accOk ? acc : null, accRaw: String(o.account || ''), mule, ioc: rec, iocStatus: st, iocActive: active, dna, scan, urls, fakePay, direct, pressure, otherAcc, linkRisk, blocked, amount, disputes };
  }

  /* ---------------- сделки ---------------- */
  function emit(type, d, extra) { NX.bus.emit(type, Object.assign({ deal: d, synthetic: true }, extra || {})); }

  // o: {name, account, item, amount, text, buyer?, sim?}
  function reserve(oIn) {
    const o = oIn || {};
    const a = assess(o);
    const buyer = o.buyer || me();
    const own = buyer === me() && PAGE() === 'client';
    const name = String(o.name || '').trim() || 'Продавец';
    const item = String(o.item || '').trim() || 'Товар с сайта объявлений';
    if (!a.acc) return { ok: false, reason: 'account', text: 'Укажите телефон, карту или IBAN продавца' };
    if (!(a.amount > 0)) return { ok: false, reason: 'amount', text: 'Укажите сумму' };
    if (a.blocked) return { ok: false, reason: 'blocked', text: 'Конверт на этот реквизит не откроется: ' + (a.mule ? 'счёт в базе дропов банка' : 'счёт в стоп-листе (' + NX.iocs.label(a.iocStatus) + ')') };
    // «Заблокировать всё» у покупателя: новые переводы на паузе — конверт тоже не открывается
    let emOn = false;
    try { emOn = !!(own && NX.Emergency && typeof NX.Emergency.isActive === 'function' && NX.Emergency.isActive()); } catch (e) { emOn = false; }
    if (emOn) return { ok: false, reason: 'emergency', text: 'Включено «Заблокировать всё»: новые переводы на паузе, пока доверенное лицо или банк не снимут защиту' };
    if (own && NX.state.user.balance < a.amount) return { ok: false, reason: 'balance', text: 'Недостаточно средств на счёте' };
    const now = Date.now();
    const d = {
      id: NX.uid('sd'), code: genCode(), ts: now, upd: now, buyer, item, amount: a.amount,
      seller: { name, account: a.acc.raw || a.accRaw, kind: a.acc.kind, value: a.acc.value },
      status: 'reserved', deadline: now + DEMO_TTL, track: null, dispute: null, credited: false,
      checks: { scan: a.scan ? a.scan.score : null, link: a.linkRisk, direct: a.direct, ioc: a.iocStatus, dna: a.dna ? Math.round(a.dna.index) : null, dnaTier: a.dna ? a.dna.tierLabel : '' },
      sim: o.sim || PAGE() || 'client', synthetic: true, history: [],
    };
    hist(d, 'Покупатель внёс ' + NX.fmt(d.amount) + ' в конверт банка · продавец видит резерв, но забрать деньги не может', buyer);
    const s = load();
    s.deals.unshift(d);
    save(s);
    if (own) {
      NX.state.user.balance -= d.amount;
      NX.state.transactions.unshift({ id: NX.uid('tx'), category: 'Переводы', merchant: 'Безопасная сделка ' + d.code + ' · в конверте', amount: -d.amount, ts: now, type: 'escrow', escrow: d.code });
      NX.save();
      try { NX.addEvent({ type: 'safe_deal', source: 'Безопасная сделка', severity: 'low', manual: true, title: 'Деньги в конверте: ' + item, details: NX.fmt(d.amount) + ' · код ' + d.code + ' · продавец ' + name + ' · симуляция' }); } catch (e) { /* ignore */ }
      activeId = d.id;
    }
    emit('safe_deal_created', d);
    if (PAGE() === 'bank') syncBank();
    renderAll(true);
    return { ok: true, deal: d };
  }

  function act(id, action, extra) {
    const x = extra || {};
    let prevStatus = null;
    const d = mutate(id, (d) => {
      prevStatus = d.status;
      const now = Date.now();
      if (action === 'ship') {
        if (d.status !== 'reserved') return false;
        d.status = 'shipped';
        d.track = 'TRK-' + String(10000000 + rnd(89999999));
        hist(d, 'Продавец отправил товар · трек ' + d.track + ' (симуляция службы доставки)', d.seller.name);
      } else if (action === 'deliver') {
        if (!OPEN(d)) return false;
        d.status = 'released'; d.releasedAt = now;
        hist(d, 'Служба доставки: «вручено получателю» (симуляция) → деньги из конверта выплачены продавцу', 'Служба доставки');
      } else if (action === 'confirm') {
        if (!OPEN(d)) return false;
        d.status = 'released'; d.releasedAt = now;
        hist(d, 'Покупатель подтвердил получение → деньги из конверта выплачены продавцу', d.buyer);
      } else if (action === 'dispute') {
        if (!OPEN(d)) return false;
        d.status = 'disputed';
        d.dispute = { ts: now, reason: REASONS[x.reason] ? x.reason : 'not_delivered', by: d.buyer, verdict: null, ioc: null, leftMs: Math.max(0, d.deadline - now) };
        hist(d, 'Покупатель открыл спор: ' + REASONS[d.dispute.reason] + ' · деньги заморожены до решения банка', d.buyer);
      } else if (action === 'expire') {
        if (!OPEN(d)) return false;
        d.status = 'refunded'; d.refundedAt = now;
        hist(d, 'Срок конверта истёк, товар не вручён → деньги автоматически возвращены покупателю', 'NEXUS · конверт');
      } else if (action === 'refund') {
        if (d.status !== 'disputed') return false;
        d.status = 'refunded'; d.refundedAt = now;
        if (d.dispute) { d.dispute.verdict = 'buyer'; d.dispute.decidedAt = now; d.dispute.decidedBy = x.by || 'Аналитик'; }
        hist(d, 'Решение банка по спору: деньги из конверта возвращены покупателю', x.by || 'Аналитик');
      } else if (action === 'release') {
        if (d.status !== 'disputed') return false;
        d.status = 'released'; d.releasedAt = now;
        if (d.dispute) { d.dispute.verdict = 'seller'; d.dispute.decidedAt = now; d.dispute.decidedBy = x.by || 'Аналитик'; }
        hist(d, 'Решение банка по спору: претензия не подтвердилась — деньги выплачены продавцу', x.by || 'Аналитик');
      } else return false;
      return true;
    });
    if (!d) return null;
    if (action === 'dispute') emit('safe_deal_dispute', d, { reason: d.dispute.reason });
    else emit('safe_deal_update', d, { action, from: prevStatus });
    if (action === 'dispute' || action === 'refund' || action === 'release') checkSeller(d.seller);
    settle();
    if (PAGE() === 'bank') syncBank();
    renderAll(true);
    return d;
  }

  // кабинет покупателя: возврат из конверта зачисляется на счёт (один раз).
  // Не зависит от видимости раздела: на сцене конверт может истечь уже после шага 7, когда раздел снова скрыт.
  function settle() {
    if (PAGE() !== 'client' || resetting()) return;
    const mine = load().deals.filter((d) => d.buyer === me() && d.status === 'refunded' && !d.credited);
    if (!mine.length) return;
    mine.forEach((d0) => {
      const d = mutate(d0.id, (d) => { if (d.credited || d.status !== 'refunded') return false; d.credited = true; return true; });
      if (!d) return;
      NX.state.user.balance += d.amount;
      NX.state.transactions.unshift({ id: NX.uid('tx'), category: 'Переводы', merchant: 'Возврат из конверта · безопасная сделка ' + d.code, amount: d.amount, ts: Date.now(), type: 'escrow', escrow: d.code });
      NX.save();
      try { NX.addEvent({ type: 'safe_deal', source: 'Безопасная сделка', severity: 'low', manual: true, title: 'Деньги из конверта вернулись', details: NX.fmt(d.amount) + ' · ' + d.code + ' · симуляция' }); } catch (e) { /* ignore */ }
      if (!HIDE()) NX.toast('Деньги вернулись на счёт', NX.fmt(d.amount) + ' · конверт ' + d.code + ' закрыт · симуляция', 'ok', 'reset');
      emit('safe_deal_state', d, { action: 'credited' });
    });
    try { if (NX.ClientUI && NX.ClientUI.refresh) NX.ClientUI.refresh(); } catch (e) { console.error(e); }
  }

  /* ---------------- споры по продавцу → жизненный цикл IOC ---------------- */
  function sellerAgg(sIn) {
    const s = sIn || load();
    const by = {};
    s.deals.forEach((d) => {
      const k = sellerKey(d.seller);
      const a = by[k] || (by[k] = { key: k, name: d.seller.name, account: d.seller.account, kind: d.seller.kind, value: d.seller.value, deals: [], disputes: [], buyers: [], confirmed: [], cBuyers: [], pendingBuyers: [], dismissed: 0, sum: 0 });
      a.deals.push(d);
      if (d.dispute) {
        if (d.dispute.verdict === 'seller') { a.dismissed++; return; }
        a.disputes.push(d);
        if (a.buyers.indexOf(d.buyer) < 0) a.buyers.push(d.buyer);
        a.sum += d.amount;
        // в стоп-лист идут только претензии, которые банк признал (решение в пользу покупателя), по любой причине;
        // открытый спор — повод для проверки, а не обвинение
        if (d.dispute.verdict === 'buyer') { a.confirmed.push(d); if (a.cBuyers.indexOf(d.buyer) < 0) a.cBuyers.push(d.buyer); }
        else if (a.pendingBuyers.indexOf(d.buyer) < 0) a.pendingBuyers.push(d.buyer);
      }
    });
    return Object.keys(by).map((k) => {
      const a = by[k];
      try { a.iocStatus = a.kind && a.value ? NX.iocs.status(a.kind, a.value) : null; a.ioc = a.kind && a.value ? NX.iocs.find(a.kind, a.value) : null; } catch (e) { a.iocStatus = null; a.ioc = null; }
      a.flagged = a.cBuyers.length >= DISPUTE_N;
      a.last = Math.max.apply(null, a.deals.map((d) => d.upd || d.ts));
      return a;
    }).sort((x, y) => y.cBuyers.length - x.cBuyers.length || y.buyers.length - x.buyers.length || y.last - x.last);
  }
  const aggFor = (sel, s) => sellerAgg(s).find((a) => a.key === sellerKey(sel)) || null;
  function checkSeller(sel) {
    if (!sel || !sel.kind || !sel.value || resetting()) return null;
    const a = aggFor(sel);
    if (!a || !a.flagged) return a;
    // только признанные банком претензии; отклонённые и ещё не решённые споры в стоп-лист не попадают
    const todo = a.confirmed.filter((d) => d.dispute && !d.dispute.ioc);
    if (!todo.length) return a;
    let freshAll = [];
    todo.forEach((d0) => {
      const d = mutate(d0.id, (d) => { if (!d.dispute || d.dispute.ioc || d.dispute.verdict !== 'buyer') return false; d.dispute.ioc = Date.now(); return true; });
      if (!d) return;
      try {
        const fresh = NX.iocs.add([{ kind: sel.kind, value: sel.value, raw: sel.account, noSynthHistory: true, sdSeller: String(sel.name || '') }], SRC, { session: 'sd:' + d.id, client: d.buyer }) || [];
        freshAll = freshAll.concat(fresh);
      } catch (e) { console.error('[safe-deal] ioc', e); }
    });
    if (PAGE() === 'bank' && freshAll.length && NX.BankExt) {
      try { NX.BankExt.ingestIocs({ items: freshAll, source: SRC, client: a.buyers.join(', '), t0: Date.now() }); } catch (e) { console.error(e); }
    }
    const st = NX.iocs.status(sel.kind, sel.value);
    NX.bus.emit('safe_deal_seller_flagged', { seller: { name: a.name, account: a.account, kind: a.kind }, buyers: a.cBuyers.slice(), threshold: DISPUTE_N, iocStatus: st, synthetic: true });
    if (PAGE() === 'bank') {
      NX.toast('Продавец — в стоп-лист', q(a.name) + ' · признанные претензии ' + a.cBuyers.length + ' независимых покупателей · ' + NX.iocs.label(st), 'high', 'dna');
      try { NX.BankExt.logCycle('investigate', 'Безопасная сделка: банк признал претензии ' + a.cBuyers.length + ' покупателей к одному продавцу → стоп-лист (' + NX.iocs.label(st) + ')'); } catch (e) { /* ignore */ }
    }
    return aggFor(sel);
  }

  /* ---------------- таймер: обратный отсчёт и автоматический возврат ---------------- */
  let tickTimer = null;
  function tick() {
    if (resetting()) return;
    const now = Date.now();
    document.querySelectorAll('[data-sd-cd]').forEach((el) => {
      const left = Number(el.getAttribute('data-sd-cd')) - now;
      const t = left > 0 ? fmtLeft(left) : 'срок истёк';
      if (el.textContent !== t) el.textContent = t;
    });
    const due = load().deals.filter((d) => OPEN(d) && d.deadline && d.deadline <= now);
    due.forEach((d) => act(d.id, 'expire'));
  }

  /* ---------------- разметка: только при изменении (без анимаций) ---------------- */
  function put(el, html) { if (el && el._sdHtml !== html) { el.innerHTML = html; el._sdHtml = html; } }
  const stBadge = (st) => '<span class="badge ' + (STATUS[st] ? STATUS[st][1] : 'plain') + '">' + esc(STATUS[st] ? STATUS[st][0] : st) + '</span>';
  function iocChip(st) {
    if (!st) return '<span class="badge plain">нет в стоп-листе</span>';
    const cls = st === 'suspected' ? 'warn' : st === 'corroborated' || st === 'confirmed' ? 'high' : 'info';
    return '<span class="badge ' + cls + '">' + esc(NX.iocs.label(st)) + '</span>';
  }
  const dots = (n) => '<span class="sd-dots" aria-hidden="true">' + Array.from({ length: DISPUTE_N }, (_, k) => '<i class="' + (k < n ? 'on' : '') + '"></i>').join('') + '</span>';
  // что работает / что симулировано / что требует интеграции — в общем поповере «Что работает в прототипе» (NX.ui.FEATURES)
  function realityHTML() {
    return '<p class="tiny muted mt-s">' + esc(SIM_LABEL) + '. <button type="button" class="tag-demo tag-demo-btn" data-nx-honesty aria-haspopup="dialog">' + esc('что работает в прототипе') + '</button></p>';
  }

  /* ---------------- кабинет клиента ---------------- */
  let mode = 'normal';
  let activeId = null;
  let checkedCode = '';
  let shotCode = '';
  let formDraft = null;
  function setMode(m) {
    mode = m === 'deal' && !HIDE() ? 'deal' : 'normal';
    const nb = $('#trNormal'), sv = $('#sdView');
    if (nb) nb.classList.toggle('hidden', mode === 'deal');
    if (sv) sv.classList.toggle('hidden', mode !== 'deal');
    document.querySelectorAll('#sdModes [data-sd-mode]').forEach((b) => { const on = b.getAttribute('data-sd-mode') === mode; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    if (mode === 'deal') renderClient();
    return mode;
  }
  function formVal() {
    const g = (id) => { const el = $(id); return el ? el.value : ''; };
    return { name: g('#sdName'), account: g('#sdAccount'), item: g('#sdItem'), amount: +String(g('#sdAmount')).replace(/\D/g, '') || 0, text: g('#sdText') };
  }
  function fillForm(o) {
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('#sdName', o.name || ''); set('#sdAccount', o.account || ''); set('#sdItem', o.item || '');
    set('#sdAmount', o.amount ? NX.num(o.amount) : ''); set('#sdText', o.text || '');
    renderChecks();
  }
  function staticClientHTML() {
    return '<div class="grid g2 sd-grid"><div class="col gap-l">' +
      '<div class="card sd-hero"><div class="card-h"><h3>' + ic('shieldCheck', 18) + ' Покупка у частного лица</h3></div>' +
      '<p class="small">Деньги ждут в банке до получения товара: продавец видит, что они зарезервированы, и получает их после вручения. Не вручили до срока — деньги вернутся сами.</p>' +
      '<form id="sdForm" class="col mt" autocomplete="off">' +
        '<div class="row wrap gap-s"><span class="tiny muted">Примеры (синтетика):</span>' + Object.keys(SAMPLES).map((k) => '<button type="button" class="chip" data-sd="sample" data-sd-k="' + k + '">' + esc(SAMPLES[k].label) + '</button>').join('') + '</div>' +
        '<div class="grid g2 sd-fields"><div class="field"><label for="sdName">Продавец</label><input class="input" id="sdName" maxlength="60" placeholder="Имя из объявления"></div>' +
        '<div class="field"><label for="sdAccount">Телефон, карта или IBAN продавца</label><input class="input mono" id="sdAccount" maxlength="40" placeholder="+7 7__ ___ __ __"></div>' +
        '<div class="field"><label for="sdItem">Товар</label><input class="input" id="sdItem" maxlength="60" placeholder="Например: велосипед б/у"></div>' +
        '<div class="field"><label for="sdAmount">Сумма, ₸</label><input class="input" id="sdAmount" inputmode="numeric" placeholder="0"></div></div>' +
        '<div class="field"><label for="sdText">Ссылка или сообщение продавца <span class="tiny muted">(необязательно — проверим до оплаты)</span></label><textarea class="input sd-text" id="sdText" rows="3" maxlength="600" placeholder="Вставьте ссылку на «оплату доставки» или текст сообщения"></textarea></div>' +
        '<div id="sdChecks" aria-live="polite"></div>' +
        '<button class="btn primary block" type="submit">' + ic('lock', 16) + 'Оплатить через банк</button>' +
        '<p class="tiny muted">Деньги списываются с вашего счёта в конверт, а не продавцу.</p>' +
      '</form></div>' +
      '<div id="sdDeals"></div>' +
      '</div><div class="col gap-l">' +
      '<div class="card sd-phone-card"><details class="more sd-seller"' + (EMBED ? ' open' : '') + '><summary>Показать, что видит продавец</summary><div class="more-b">' +
        '<div class="sd-phone"><div class="sd-phone-top"><span class="tiny muted">Приложение банка продавца</span><span class="tiny muted">NEXUS</span></div>' +
          '<div id="sdPhoneDeal"></div>' +
          '<form id="sdCodeForm" class="sd-codeform" autocomplete="off"><label class="tiny muted" for="sdCodeInput">Проверить код сделки от покупателя</label><div class="row gap-s"><input class="input mono grow" id="sdCodeInput" maxlength="14" placeholder="SD-XXXX-00"><button class="btn sm" type="submit">' + ic('search', 14) + 'Проверить</button></div></form>' +
          '<div id="sdCodeResult" aria-live="polite"></div>' +
          '<button type="button" class="btn sm block mt-s" data-sd="fake-shot">' + ic('image', 14) + 'Покупатель прислал скриншот «Оплачено»</button>' +
          '<div id="sdShot" aria-live="polite"></div>' +
        '</div>' +
        '<p class="tiny muted mt-s">Так продавец видит сделку в своём приложении банка. Статус проверяется по коду внутри приложения, поэтому поддельная картинка «оплачено» его не обманет.</p></div></details></div>' +
      '<div class="card"><div class="card-h"><h3>Как это работает</h3></div>' +
        '<div class="feat">Вы платите в конверт банка. Продавец видит резерв и код сделки, но вывести деньги не может</div>' +
        '<div class="feat">Деньги уходят продавцу, когда вы подтвердили получение или доставка отметила «вручено»</div>' +
        '<div class="feat">Товар не вручили до срока — деньги автоматически возвращаются. Спор замораживает конверт до решения банка</div>' +
        '<div class="feat">Претензии разных покупателей к одному продавцу, которые банк признал, — сигнал в стоп-лист NEXUS. Открытый или отклонённый спор продавца не обвиняет</div>' +
        '</div>' +
      '</div></div>';
  }
  function ensureStatic() {
    const sv = $('#sdView');
    if (!sv || sv._sdStatic) return sv;
    sv.innerHTML = staticClientHTML();
    sv._sdStatic = true;
    const am = $('#sdAmount'); if (am) am.addEventListener('input', (e) => { const d = e.target.value.replace(/\D/g, ''); e.target.value = d ? NX.num(+d) : ''; });
    let deb = null;
    ['#sdName', '#sdAccount', '#sdItem', '#sdAmount', '#sdText'].forEach((id) => { const el = $(id); if (el) el.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(renderChecks, 220); }); });
    const f = $('#sdForm'); if (f) f.onsubmit = (e) => { e.preventDefault(); submit(); };
    const cf = $('#sdCodeForm'); if (cf) cf.onsubmit = (e) => { e.preventDefault(); const el = $('#sdCodeInput'); checkedCode = el ? el.value.trim() : ''; renderPhone(); };
    if (formDraft) fillForm(formDraft);
    return sv;
  }
  function submit() {
    const o = formVal();
    const r = reserve(o);
    if (!r.ok) { NX.toast(r.reason === 'blocked' ? 'Конверт не открыт' : 'Не получилось', r.text, r.reason === 'blocked' ? 'high' : 'warn', r.reason === 'blocked' ? 'lock' : 'info'); renderChecks(); return; }
    NX.toast('Деньги в конверте банка', NX.fmt(r.deal.amount) + ' · код сделки ' + r.deal.code + ' — сообщите его продавцу · симуляция', 'ok', 'lock');
    formDraft = null;
    fillForm({});
  }

  function checkRow(level, title, body) {
    const icn = level === 'ok' ? 'check' : level === 'danger' ? 'alert' : level === 'warn' ? 'info' : 'clock';
    return '<div class="sd-check ' + level + '"><span class="sd-check-ic">' + ic(icn, 16) + '</span><div class="grow" style="min-width:0"><b>' + esc(title) + '</b>' + body + '</div></div>';
  }
  function checksHTML(o) {
    const has = o.account || o.text || o.amount;
    if (!has) return '<div class="sd-checks"><p class="small muted">Заполните продавца и сумму или выберите пример — NEXUS проверит ссылку, сообщение и счёт продавца до оплаты.</p></div>';
    const a = assess(o);
    const rows = [];
    // 1. ссылка и сообщение
    if (!String(o.text || '').trim()) rows.push(checkRow('idle', 'Ссылка и сообщение продавца', '<div class="small muted">Не вставлены. Если продавец прислал ссылку на «оплату» или «доставку» — вставьте её сюда.</div>'));
    else {
      const items = [];
      a.urls.forEach((u) => {
        if (u.official) return;
        if (u.imp) items.push('Сайт ' + q(u.domain) + ' выдаёт себя за «безопасную сделку» или «доставку». Настоящий конверт открывается только в приложении банка — по ссылкам он не работает');
        u.flags.slice(0, 3).forEach((f) => items.push(u.domain + ': ' + f));
      });
      if (a.fakePay) items.push('Просят оплатить «доставку» по ссылке или ввести данные карты — так выглядит фейковая страница оплаты');
      if (a.scan) a.scan.reasons.filter((r) => !r.good && r.w >= 15 && !/^Подозрительная ссылка/.test(r.why)).slice(0, 3).forEach((r) => items.push(r.why));
      const uniq = items.filter((x, i) => items.indexOf(x) === i).slice(0, 6);
      // просьба платить мимо конверта, чужой реквизит или давление — уже признак схемы, даже при низком индексе текста
      const offEscrow = a.direct || a.otherAcc.length > 0 || a.pressure;
      const lvl = a.linkRisk || (a.scan && a.scan.score >= 55) ? 'danger' : (a.scan && a.scan.score >= 25) || offEscrow ? 'warn' : 'ok';
      rows.push(checkRow(lvl, lvl === 'danger' ? (a.linkRisk ? 'Похоже на фейковую страницу оплаты — не переходите' : 'В сообщении признаки мошеннической схемы') : lvl === 'warn' ? 'В сообщении есть подозрительные признаки' : 'Ссылка и сообщение: явных признаков схемы нет',
        (a.scan && NX.ui && NX.ui.riskWord ? '<div class="tiny muted">Риск сообщения: ' + NX.ui.riskWord(a.scan.score).html + '</div>' : '') +
        (uniq.length && lvl !== 'ok' ? '<ul class="sd-list">' + uniq.slice(0, 3).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
        (a.scan || uniq.length > 3 ? '<details class="more"><summary>Подробнее</summary><div class="more-b">' + (uniq.length > 3 && lvl !== 'ok' ? '<ul class="sd-list">' + uniq.slice(3).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + (a.scan ? '<div class="tiny muted">Индекс риска сообщения ' + esc(String(a.scan.score)) + ' из 100</div>' : '') + '</div></details>' : '')));
    }
    // 2. оплата мимо конверта
    if (a.direct || a.otherAcc.length) {
      rows.push(checkRow('danger', 'Продавец просит перевести мимо конверта — это классическая схема',
        '<ul class="sd-list"><li>Прямой перевод частному лицу почти невозможно вернуть: после него у покупателя нет ни денег, ни товара</li>' +
        '<li>«Сделку не делаю, долго», «есть ещё покупатель», «переведите сразу» — давление, чтобы вы не успели проверить</li>' +
        (a.otherAcc.length ? '<li>' + esc('В сообщении другой реквизит (' + a.otherAcc.map((x) => maskAcc(x.raw)).join(', ') + '), не тот, что вы указали — деньги ушли бы на неизвестный счёт') + '</li>' : '') +
        '<li>Честному продавцу конверт ничем не мешает: он видит, что деньги зарезервированы, и получает их после вручения</li></ul>' +
        '<div class="sd-reply"><span class="tiny muted">Ответ продавцу:</span> <span class="small">«Оплачу только через безопасную сделку банка: деньги будут зарезервированы, вы увидите это в приложении и получите их после вручения.»</span></div>'));
    } else if (String(o.text || '').trim()) rows.push(checkRow('ok', 'Оплата мимо конверта не требуется', ''));
    // 3. счёт продавца
    if (!a.acc) rows.push(checkRow('idle', 'Счёт продавца', '<div class="small muted">Укажите телефон, карту или IBAN продавца.</div>'));
    else {
      const parts = [];
      // риск — словом; цифры индекса — только в «Подробнее» (2.1.4)
      parts.push('<div class="row wrap gap-s sd-chips"><span class="tiny muted">Стоп-лист:</span>' + (a.mule ? '<span class="badge high">база дропов банка</span>' : iocChip(a.iocStatus)) + '</div>' +
        (a.dna && NX.ui && NX.ui.riskWord ? '<div class="tiny muted">Сравнение с вашими переводами: ' + NX.ui.riskWord(a.dna.index).html + '</div>' : ''));
      if (a.mule) parts.push('<div class="small">' + esc('Счёт ' + maskAcc(a.acc.raw) + ' есть в базе дропов банка (синтетические данные): ' + a.mule.note + '.') + '</div>');
      else if (a.iocActive) parts.push('<div class="small">' + esc(a.iocStatus === 'suspected' ? 'Счёт на проверке в стоп-листе NEXUS (один источник) — сам по себе продавца не обвиняет. В конверте деньги в безопасности до вручения.' : 'Счёт в стоп-листе NEXUS: ' + NX.iocs.label(a.iocStatus) + (a.disputes.fromDisputes ? ' · банк признал претензии покупателей к этому счёту' : '') + '.') + '</div>');
      const dsp = a.disputes;
      if (!a.blocked && dsp.pending) parts.push('<div class="small">' + esc('Против этого продавца открыты споры: ' + NX.countOf(dsp.pending, ['покупатель', 'покупателя', 'покупателей']) + '. Банк ещё не решил — это не обвинение (товар мог не подойти), но платите только в конверт.') + '</div>');
      // в конверте индекс DNA — подсказка: текст про удержание обычного перевода (tier.action) здесь не показываем
      if (a.dna) {
        const why = String(a.dna.explain || '').replace(' ' + String(a.dna.action || '') + '.', '').trim();
        parts.push('<details class="more"><summary>Подробнее</summary><div class="more-b"><div class="tiny muted">' + esc('«Ваш обычный перевод»: индекс ' + Math.round(a.dna.index) + ' из 100. ' + why + (a.blocked ? ' Конверт не откроется из-за стоп-листа, а не из-за индекса.' : ' В конверте деньги не уходят продавцу сразу, поэтому индекс здесь — подсказка, а не удержание.')) + '</div></div></details>');
      }
      rows.push(checkRow(a.blocked ? 'danger' : a.iocActive || dsp.pending ? 'warn' : 'ok', a.blocked ? 'Конверт на этот счёт не откроется' : 'Счёт продавца: стоп-лист и «Ваш обычный перевод»', parts.join('')));
    }
    const verdict = a.blocked
      ? '<div class="notice danger mt-s"><b>Оплата невозможна.</b> ' + esc(a.mule ? 'Счёт продавца есть в базе дропов банка — он связан со схемой мошенников.' : a.disputes.fromDisputes ? 'Банк признал претензии нескольких независимых покупателей к этому счёту — он в стоп-листе.' : 'Счёт продавца в стоп-листе NEXUS (' + NX.iocs.label(a.iocStatus) + ').') + ' Не переводите ему деньги и другим способом.</div>'
      : a.direct || a.linkRisk ? '<div class="notice warn mt-s"><b>Платите только в конверт.</b> Не переходите по ссылкам продавца и не переводите напрямую: в конверте деньги вернутся, если товар не вручат.</div>' : '';
    return '<div class="sd-checks">' + rows.join('') + verdict + '</div>';
  }
  function renderChecks() {
    const box = $('#sdChecks'); if (!box) return;
    const o = formVal();
    formDraft = o;
    put(box, checksHTML(o));
  }

  function dealCardHTML(d) {
    const left = d.deadline - Date.now();
    const st = d.status;
    const steps = [
      ['Деньги в конверте', true],
      ['Продавец отправил', st === 'shipped' || st === 'released' || !!d.track],
      [st === 'refunded' ? 'Возврат покупателю' : st === 'disputed' ? 'Спор · решение банка' : 'Деньги у продавца', st === 'released' || st === 'refunded'],
    ];
    const actions = OPEN(d)
      ? '<div class="row wrap gap-s mt-s">' +
        '<button type="button" class="btn ok sm" data-sd="confirm" data-sd-id="' + esc(d.id) + '">' + ic('check', 14) + 'Товар получен — выплатить</button>' +
        '<button type="button" class="btn sm" data-sd="deliver" data-sd-id="' + esc(d.id) + '">' + ic('send', 14) + 'Доставка: «вручено» (симуляция)</button>' +
        '<button type="button" class="btn danger sm" data-sd="dispute" data-sd-id="' + esc(d.id) + '">' + ic('alert', 14) + 'Открыть спор</button>' +
        '<button type="button" class="btn ghost sm" data-sd="expire" data-sd-id="' + esc(d.id) + '">' + ic('clock', 14) + 'Перемотать: срок истёк</button></div>'
      : '';
    const sub = OPEN(d) ? 'Автовозврат, если не вручат, через <b class="mono" data-sd-cd="' + d.deadline + '">' + esc(left > 0 ? fmtLeft(left) : 'срок истёк') + '</b> <span class="tiny muted">(в демо — 10 минут; в продукте — срок по договору)</span>'
      : st === 'disputed' ? 'Спор: ' + esc(REASONS[d.dispute && d.dispute.reason] || '') + ' · деньги заморожены, срок остановлен до решения банка'
        : st === 'released' ? 'Сделка завершена: деньги выплачены продавцу' : 'Сделка закрыта: деньги вернулись на ваш счёт';
    return '<div class="card sd-deal' + (st === 'disputed' ? ' dispute' : '') + '"><div class="card-h"><h3>' + esc(d.item) + '</h3>' + stBadge(st) + '</div>' +
      '<div class="sd-dealtop"><div><div class="tiny muted">В конверте</div><div class="sd-amt">' + esc(NX.fmt(d.amount)) + '</div></div>' +
      '<div><div class="tiny muted">Код сделки для продавца</div><div class="row gap-s"><span class="sd-code mono">' + esc(d.code) + '</span><button type="button" class="btn ghost sm" data-sd="copy" data-sd-code="' + esc(d.code) + '" aria-label="Скопировать код">' + ic('folder', 14) + '</button></div></div></div>' +
      '<div class="small mt-s">' + esc('Продавец: ' + d.seller.name + ' · ' + maskAcc(d.seller.account)) + (d.track ? ' · <span class="mono">' + esc(d.track) + '</span>' : '') + '</div>' +
      '<div class="sd-steps mt-s">' + steps.map((s) => '<span class="sd-step' + (s[1] ? ' done' : '') + '">' + (s[1] ? ic('check', 12) : '') + esc(s[0]) + '</span>').join('') + '</div>' +
      '<p class="small mt-s">' + sub + '</p>' + actions +
      '<div class="list small mt-s">' + d.history.slice().reverse().slice(0, 4).map((h) => '<div class="li"><span class="mono tiny muted">' + NX.hm(h.ts) + '</span><div class="grow" style="min-width:0"><div class="sd-wrap">' + esc(h.t) + '</div></div></div>').join('') + '</div></div>';
  }
  function renderDeals() {
    const box = $('#sdDeals'); if (!box) return;
    const mine = load().deals.filter((d) => d.buyer === me());
    if (!mine.length) { put(box, ''); return; }
    if (!activeId || !mine.some((d) => d.id === activeId)) activeId = (mine.find((d) => OPEN(d) || d.status === 'disputed') || mine[0]).id;
    const cur = mine.find((d) => d.id === activeId);
    const others = mine.filter((d) => d.id !== activeId).slice(0, 6);
    put(box, dealCardHTML(cur) + (others.length ? '<div class="card"><div class="card-h"><h3>Мои сделки</h3><span class="hint">' + esc(NX.countOf(mine.length, ['сделка', 'сделки', 'сделок'])) + '</span></div><div class="list">' +
      others.map((d) => '<button type="button" class="li sd-li" data-sd="pick" data-sd-id="' + esc(d.id) + '"><div class="grow" style="min-width:0"><div class="t sd-wrap">' + esc(d.item + ' · ' + NX.fmt(d.amount)) + '</div><div class="s sd-wrap">' + esc(d.code + ' · ' + d.seller.name + ' · ' + NX.ago(d.ts)) + '</div></div>' + stBadge(d.status) + '</button>').join('') + '</div></div>' : ''));
  }

  function codeStatusHTML(d, code) {
    if (!d) {
      return '<div class="sd-verify bad">' + ic('x', 16) + '<div><b>' + esc('Сделки ' + (code || '') + ' нет в банке') + '</b><div class="small">Денег в конверте нет. Не отправляйте товар: скриншот или ссылка «оплачено» — не доказательство оплаты.</div></div></div>';
    }
    if (d.status === 'reserved' || d.status === 'shipped') {
      return '<div class="sd-verify good">' + ic('shieldCheck', 16) + '<div><b>' + esc('Деньги зарезервированы банком: ' + NX.fmt(d.amount)) + '</b><div class="small">' + esc(d.item + ' · ' + (d.status === 'shipped' ? 'товар отправлен, ждём вручения' : 'можно отправлять товар')) + '</div></div></div>';
    }
    if (d.status === 'disputed') return '<div class="sd-verify warn">' + ic('alert', 16) + '<div><b>Спор по сделке</b><div class="small">' + esc('Деньги заморожены до решения банка: ' + (REASONS[d.dispute && d.dispute.reason] || '')) + '</div></div></div>';
    if (d.status === 'released') return '<div class="sd-verify good">' + ic('check', 16) + '<div><b>' + esc('Выплачено продавцу: ' + NX.fmt(d.amount)) + '</b><div class="small">Сделка завершена.</div></div></div>';
    return '<div class="sd-verify bad">' + ic('reset', 16) + '<div><b>Сделка закрыта: деньги возвращены покупателю</b><div class="small">Не отправляйте товар по этому коду.</div></div></div>';
  }
  function renderPhone() {
    const box = $('#sdPhoneDeal'); if (!box) return;
    const all = load().deals;
    const d = all.find((x) => x.id === activeId) || all.find((x) => x.buyer === me()) || null;
    if (!d) put(box, '<div class="sd-phone-empty"><div class="small muted">Сделок пока нет. Когда покупатель внесёт деньги в конверт, здесь появится резерв и код сделки.</div></div>');
    else {
      const open = OPEN(d);
      put(box, '<div class="sd-phone-deal"><div class="tiny muted">' + esc('Сделка ' + d.code + ' · покупатель ' + String(d.buyer).split(' ')[0]) + '</div>' +
        '<div class="sd-phone-amt">' + esc(NX.fmt(d.amount)) + '</div>' +
        '<div class="sd-phone-st ' + (d.status === 'disputed' || d.status === 'refunded' ? 'bad' : 'good') + '">' + ic(d.status === 'released' ? 'check' : d.status === 'refunded' ? 'reset' : d.status === 'disputed' ? 'alert' : 'lock', 14) + esc(d.status === 'reserved' || d.status === 'shipped' ? 'Деньги зарезервированы банком' : STATUS[d.status][0]) + '</div>' +
        '<div class="small">' + esc(d.item) + '</div>' +
        (open ? '<div class="tiny muted mt-s">Вывести нельзя до подтверждения покупателя или отметки доставки «вручено». Если не вручить до срока — деньги вернутся покупателю: <span class="mono" data-sd-cd="' + d.deadline + '">' + esc(fmtLeft(d.deadline - Date.now())) + '</span></div>' : '') +
        (d.status === 'reserved' ? '<button type="button" class="btn sm block mt-s" data-sd="ship" data-sd-id="' + esc(d.id) + '">' + ic('send', 14) + 'Я отправил товар · трек-номер</button>' : '') +
        (d.track ? '<div class="tiny muted mt-s">Трек: <span class="mono">' + esc(d.track) + '</span></div>' : '') + '</div>');
    }
    const res = $('#sdCodeResult');
    if (res) put(res, checkedCode ? '<div class="mt-s">' + codeStatusHTML(byCode(checkedCode), checkedCode) + '</div>' : '');
    const shot = $('#sdShot');
    if (shot) {
      put(shot, shotCode ? '<div class="sd-shot-wrap mt-s"><div class="tiny muted">Картинка от «покупателя» (подделка, симуляция):</div>' +
        '<div class="sd-shot" aria-label="Поддельный скриншот"><div class="sd-shot-stamp">' + ic('check', 18) + 'ОПЛАЧЕНО</div><div class="small">Безопасная сделка</div><div class="mono small">' + esc(shotCode) + '</div><div class="sd-shot-amt">' + esc(NX.fmt(shotAmount)) + '</div><div class="tiny">Деньги поступят после отправки товара</div></div>' +
        '<div class="tiny muted mt-s">Проверка того же кода в приложении банка:</div>' + codeStatusHTML(byCode(shotCode), shotCode) +
        '<p class="tiny muted mt-s">Картинку «оплачено» можно нарисовать за минуту, а статус конверта в банке подделать нельзя. Отправляйте товар, только когда приложение показывает резерв.</p></div>' : '');
    }
  }
  let shotAmount = 0;
  function fakeShot() {
    let c = '';
    for (let k = 0; k < 10 && (!c || byCode(c)); k++) { let s = ''; for (let i = 0; i < 4; i++) s += ABC[rnd(ABC.length)]; c = 'SD-' + s + '-' + (10 + rnd(90)); }
    shotCode = c;
    const o = formVal();
    shotAmount = o.amount || 85000;
    renderPhone();
  }

  function renderClient() {
    if (PAGE() !== 'client' || HIDE()) return;
    const sv = $('#sdView'); if (!sv) return;
    if (mode !== 'deal') return;
    ensureStatic();
    renderChecks();
    renderDeals();
    renderPhone();
  }

  function openDispute(id) {
    const d = byId(id); if (!d || !OPEN(d)) return;
    const box = NX.modal('<h3>Открыть спор по сделке</h3><p class="small muted mt-s">' + esc(d.code + ' · ' + d.item + ' · ' + NX.fmt(d.amount)) + '</p>' +
      '<div class="field mt"><label for="sdReason">Что случилось</label><select class="input" id="sdReason">' + Object.keys(REASONS).map((k) => '<option value="' + k + '">' + esc(REASONS[k]) + '</option>').join('') + '</select></div>' +
      '<p class="small mt-s">Деньги останутся в конверте и не уйдут продавцу, пока банк не разберётся. Спор попадёт аналитику в Fusion Center. Спор продавца не обвиняет: в стоп-лист он попадает, только если банк признал претензии разных покупателей.</p>' +
      '<div class="row wrap mt" style="justify-content:flex-end"><button type="button" class="btn" data-close>Отмена</button><button type="button" class="btn danger" id="sdDisputeGo">' + ic('alert', 15) + 'Открыть спор</button></div>');
    const b = $('#sdDisputeGo', box);
    if (b) b.onclick = () => {
      const sel = $('#sdReason', box);
      const r = act(id, 'dispute', { reason: sel ? sel.value : 'not_delivered' });
      NX.closeModal();
      if (r) NX.toast('Спор открыт', 'Деньги заморожены в конверте · обращение передано в банк · симуляция', 'warn', 'alert');
    };
  }

  /* ---------------- Fusion Center ---------------- */
  const synced = {}; // id сделки → подпись последней синхронизации инцидента
  const knownDeals = new Set();
  function syncBank() {
    if (PAGE() !== 'bank' || !NX.BankExt || resetting()) return;
    const s = load();
    const aggs = sellerAgg(s);
    s.deals.forEach((d) => {
      if (!knownDeals.has(d.id)) {
        knownDeals.add(d.id);
        if (Date.now() - d.ts < 5 * MIN) { try { NX.BankExt.logCycle('protect', 'Безопасная сделка: ' + NX.fmt(d.amount) + ' в конверте · ' + String(d.buyer).split(' (')[0] + ' → ' + d.seller.name); } catch (e) { /* ignore */ } }
      }
      if (!d.dispute) return;
      const a = aggs.find((x) => x.key === sellerKey(d.seller));
      const sig = d.upd + '|' + (a ? a.buyers.length + ':' + a.cBuyers.length + ':' + a.iocStatus : '');
      if (synced[d.id] === sig) return;
      synced[d.id] = sig;
      const done = d.status === 'refunded' || d.status === 'released';
      const res = NX.BankExt.upsertIncident('sd:' + d.id, () => ({
        kind: 'sd_dispute', sdId: d.id, synthetic: true, score: null, account: d.seller.account, amount: d.amount,
        type: 'Безопасная сделка · спор покупателя',
        title: 'Спор по сделке ' + d.code + ': ' + (REASONS[d.dispute.reason] || '') + ' · ' + q(d.item),
        client: d.buyer, source: 'Безопасная сделка · деньги ждут в банке до получения товара (симуляция)', fromClient: d.sim === 'client',
        factors: [
          'Деньги в конверте банка — продавцу не ушли',
          a ? 'Признанные банком претензии к продавцу: ' + a.cBuyers.length + ' из порога ' + DISPUTE_N + ' независимых покупателей · открытых споров: ' + a.pendingBuyers.length : 'Споры против продавца: 1',
          d.checks && d.checks.dna != null ? '«Ваш обычный перевод» при оплате: ' + d.checks.dna + ' из 100' : '«Ваш обычный перевод» не считался',
          d.checks && d.checks.link ? 'При оплате NEXUS предупреждал о подозрительной ссылке продавца' : d.checks && d.checks.direct ? 'Продавец просил перевести мимо конверта' : 'Подозрительных ссылок при оплате не было',
        ],
        chain: (d.history || []).map((h) => ({ t: h.t, ts: h.ts })),
        setStatus: done ? 'resolved' : undefined,
        addNotes: d.dispute.decidedAt ? [{ key: 'verdict', ts: d.dispute.decidedAt, t: d.dispute.verdict === 'buyer' ? 'Решение: претензия признана, деньги из конверта возвращены покупателю · претензия учитывается в стоп-листе по продавцу' : 'Решение: претензия не подтвердилась, деньги выплачены продавцу · спор не учитывается в стоп-листе', by: d.dispute.decidedBy || 'Аналитик' }].concat(a && a.flagged && d.dispute.verdict === 'buyer' ? [{ key: 'ioc', ts: Date.now(), t: 'Признанные претензии ' + a.cBuyers.length + ' независимых покупателей к одному счёту: счёт продавца передан в стоп-лист (' + (a.iocStatus ? NX.iocs.label(a.iocStatus) : 'ожидает синхронизации') + ')', by: 'NEXUS · Безопасная сделка' }] : [])
          : [],
      }));
      if (res && res.isNew) { try { NX.BankExt.logCycle('investigate', 'Безопасная сделка: спор ' + d.code + ' · ' + String(d.buyer).split(' (')[0] + ' — ' + (REASONS[d.dispute.reason] || ''), { inc: res.id }); } catch (e) { /* ignore */ } }
    });
  }
  function bankIncidentSummary(i) {
    const d = byId(i.sdId);
    const a = d ? aggFor(d.seller) : null;
    return '<div class="notice' + (a && a.flagged ? ' danger' : ' warn') + '"><b>' + esc(d ? STATUS[d.status][0] : 'Сделка не найдена') + '</b><br>' +
      esc('Индекса риска нет: конверт защищает деньги покупателя, а продавец попадает в стоп-лист только по признанным банком претензиям ' + DISPUTE_N + ' независимых покупателей.') + '</div>';
  }
  function bankIncidentHTML(i) {
    const d = byId(i.sdId);
    if (!d) return '<p class="small muted mt">Данные сделки не найдены (сброс?).</p>';
    const a = aggFor(d.seller);
    const n = a ? a.cBuyers.length : 0;
    const pend = a ? a.pendingBuyers.length : 0;
    const c = d.checks || {};
    const rec = a && a.ioc;
    return '<h4 class="mt mb sd-h4">' + ic('shieldCheck') + ' Безопасная сделка · конверт ' + esc(d.code) + '</h4>' +
      '<dl class="kv sd-kv"><dt>Статус конверта</dt><dd>' + stBadge(d.status) + '</dd><dt>Товар</dt><dd>' + esc(d.item) + '</dd><dt>Продавец</dt><dd>' + esc(d.seller.name) + ' · <span class="mono">' + esc(maskAcc(d.seller.account)) + '</span></dd>' +
      '<dt>Причина спора</dt><dd>' + esc(REASONS[d.dispute && d.dispute.reason] || '—') + '</dd>' + (d.track ? '<dt>Трек</dt><dd class="mono">' + esc(d.track) + '</dd>' : '') +
      '<dt>Проверки при оплате</dt><dd class="small">' + esc('сообщение ' + (c.scan != null ? c.scan + '/100' : 'не вставлено') + ' · стоп-лист: ' + (c.ioc ? NX.iocs.label(c.ioc) : 'нет') + ' · DNA ' + (c.dna != null ? c.dna + '/100' : '—')) + '</dd></dl>' +
      '<div class="sd-meter mt-s">' + dots(n) + '<span class="small">' + esc('Признанные претензии: ' + NX.countOf(n, ['покупатель', 'покупателя', 'покупателей']) + ' · порог ' + DISPUTE_N + ' · открытые споры: ' + pend) + '</span>' + iocChip(a ? a.iocStatus : null) +
      (rec ? '<button type="button" class="btn sm" data-ioc="' + esc(rec.id) + '">' + ic('dna', 14) + 'Продавец в стоп-листе</button>' : '') + '</div>' +
      (a && a.dismissed ? '<p class="tiny muted mt-s">' + esc('Неподтверждённых споров (решены в пользу продавца): ' + a.dismissed + ' — в стоп-листе не учитываются.') + '</p>' : '') +
      (d.status === 'disputed' ? '<div class="row wrap gap-s mt-s"><button type="button" class="btn ok sm" data-sd="bank-refund" data-sd-id="' + esc(d.id) + '">' + ic('reset', 14) + 'Вернуть деньги покупателю</button><button type="button" class="btn sm" data-sd="bank-release" data-sd-id="' + esc(d.id) + '">' + ic('check', 14) + 'Претензия не подтвердилась — выплатить продавцу</button></div>' : '') +
      '<p class="tiny muted mt-s">Спор — не обвинение: товар мог не подойти по размеру. В стоп-лист счёт продавца уходит, только когда банк признал претензии независимых покупателей (решение «вернуть покупателю»), дальше — обычный путь реквизита в стоп-листе: корреляция, решение аналитиков в четыре глаза, обжалование.</p>' + realityHTML(true);
  }
  function renderBank(el) {
    if (!el) return;
    if (HIDE()) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const s = load();
    const open =s.deals.filter((d) => OPEN(d) || d.status === 'disputed');
    const held = open.reduce((x, d) => x + d.amount, 0);
    const disputes = s.deals.filter((d) => d.status === 'disputed');
    const aggs = sellerAgg(s).filter((a) => a.buyers.length || a.dismissed);
    const running = simRun ? 'Идёт симуляция: покупатель ' + Math.min(simRun.step + 1, simRun.total) + ' из ' + simRun.total : '';
    const rows = s.deals.slice(0, 8).map((d) => '<div class="sd-brow' + (d.status === 'disputed' ? ' dispute' : '') + '"><div class="grow" style="min-width:0"><b class="mono small">' + esc(d.code) + '</b> <span class="small sd-wrap">' + esc(d.item + ' · ' + NX.fmt(d.amount)) + '</span>' +
      '<div class="tiny muted sd-wrap">' + esc(String(d.buyer).split(' (')[0] + ' → ' + d.seller.name + ' · ' + maskAcc(d.seller.account) + ' · ' + NX.ago(d.upd || d.ts)) + '</div></div>' +
      '<div class="row wrap gap-s sd-bside">' + stBadge(d.status) + (d.dispute ? '<button type="button" class="btn sm" data-sd="bank-inc" data-sd-id="' + esc(d.id) + '">Инцидент</button>' : '') + '</div></div>').join('');
    const sellers = aggs.map((a) => '<div class="sd-brow' + (a.flagged ? ' dispute' : '') + '"><div class="grow" style="min-width:0"><b class="small sd-wrap">' + esc(a.name) + '</b> <span class="mono tiny muted">' + esc(maskAcc(a.account)) + '</span><div class="tiny muted sd-wrap">' + esc('спорят: ' + (a.buyers.map((b) => String(b).split(' (')[0]).join(', ') || '—') + (a.dismissed ? ' · не подтвердилось: ' + a.dismissed : '')) + '</div></div>' +
      '<div class="row wrap gap-s sd-bside">' + dots(a.cBuyers.length) + iocChip(a.iocStatus) + (a.flagged ? '<span class="badge high">в стоп-листе по признанным претензиям</span>' : '<span class="badge plain">' + esc('признано ' + a.cBuyers.length + ' из ' + DISPUTE_N + (a.pendingBuyers.length ? ' · открыто ' + a.pendingBuyers.length : '')) + '</span>') + '</div></div>').join('');
    put(el, '<div class="card-h"><h3>' + ic('shieldCheck', 18) + ' Безопасная сделка · деньги ждут в банке до получения товара</h3></div>' +
      '<p class="small muted">Покупки у частных лиц на сайтах объявлений: деньги покупателя ждут в конверте банка до вручения. Спор замораживает конверт и приходит сюда. Признанные банком претензии ' + DISPUTE_N + ' независимых покупателей к одному счёту продавца — сигнал в общий стоп-лист; открытый или отклонённый спор продавца не обвиняет.</p>' +
      '<div class="sd-stats mt-s"><div><div class="tiny muted">В конвертах сейчас</div><b>' + esc(NX.fmt(held)) + '</b><div class="tiny muted">' + esc(NX.countOf(open.length, ['сделка', 'сделки', 'сделок'])) + '</div></div><div><div class="tiny muted">Открытые споры</div><b>' + disputes.length + '</b></div><div><div class="tiny muted">Продавцы со спорами</div><b>' + aggs.filter((a) => a.buyers.length).length + '</b></div></div>' +
      '<div class="row wrap gap-s mt-s"><button class="btn primary" type="button" data-sd="bank-sim"' + (simRun ? ' disabled' : '') + '>' + ic('play', 15) + 'Симуляция: споры покупателей с одним продавцом</button>' + (running ? '<span class="small sd-run">' + esc(running) + '</span>' : '') + '</div>' +
      (sellers ? '<h4 class="mt mb sd-h4">Продавцы со спорами</h4><div class="sd-blist">' + sellers + '</div>' : '') +
      (rows ? '<h4 class="mt mb sd-h4">Последние сделки</h4><div class="sd-blist">' + rows + '</div>' : '<div class="empty">Сделок пока нет. Покупатель открывает конверт в кабинете клиента: «Перевод» → «Покупка у частного лица». Или запустите симуляцию.</div>') +
      realityHTML(true));
  }

  // симуляция в Fusion Center: если у продавца клиента уже есть спор — добавляем независимых покупателей к нему
  let simRun = null;
  function simulateDisputes(stepMs) {
    if (simRun) return simRun.promise;
    const s = load();
    // на счёт уже в стоп-листе конверт не откроется — такого продавца пропускаем
    const usable = (sel) => !assess({ account: sel.account }).blocked && !(aggFor(NX.parseAccount(sel.account) || {}, s) || {}).flagged;
    const open0 = s.deals.find((d) => d.status === 'disputed' && d.sim === 'client');
    const open = open0 && usable(open0.seller) ? open0 : null;
    const seller = open ? { name: open.seller.name, account: open.seller.account } : SIM_SELLERS.find(usable) || null;
    if (!seller) {
      NX.toast('Симуляция не запущена', 'Все синтетические продавцы уже в стоп-листе. Сбросьте демо, чтобы повторить', 'warn', 'info');
      return Promise.resolve({ ok: false, reason: 'no_seller' });
    }
    const a = aggFor(NX.parseAccount(seller.account) || {}, s);
    const need = Math.max(1, DISPUTE_N - (a ? a.cBuyers.length : 0));
    const buyers = SIM_BUYERS.filter((b) => !(a && a.buyers.indexOf(b.name) >= 0)).slice(0, need);
    if (!buyers.length) { NX.toast('Симуляция не запущена', 'Нет свободных синтетических покупателей для этого продавца', 'warn', 'info'); return Promise.resolve({ ok: false, reason: 'no_buyers' }); }
    const gap = Math.max(200, Number(stepMs) || 1400);
    simRun = { step: 0, total: buyers.length, results: [] };
    renderAll();
    simRun.promise = new Promise((resolve) => {
      const tickSim = () => {
        if (!simRun || resetting()) { simRun = null; resolve(null); return; }
        const b = buyers[simRun.step];
        const r = reserve({ buyer: b.name, name: seller.name, account: seller.account, item: open ? open.item : b.item, amount: b.amount, text: '', sim: 'bank' });
        if (r.ok) {
          act(r.deal.id, 'dispute', { reason: 'not_delivered' });
          // симуляция решения аналитика: претензия признана → учитывается в стоп-листе по продавцу
          act(r.deal.id, 'refund', { by: 'Аналитик (симуляция)' });
        } else {
          NX.toast('Симуляция остановлена', String(r.text || r.reason || ''), 'warn', 'info');
          simRun.results.push(r);
          const out = { seller: seller.name, results: simRun.results.slice(), agg: null, ok: false };
          simRun = null; renderAll(); resolve(out); return;
        }
        simRun.results.push(byId(r.deal.id));
        simRun.step++;
        if (simRun.step >= simRun.total) {
          const sel = r.ok ? r.deal.seller : null;
          const out = { seller: seller.name, results: simRun.results.slice(), agg: sel ? aggFor(sel) : null };
          simRun = null;
          renderAll();
          resolve(out);
          return;
        }
        renderAll();
        setTimeout(tickSim, gap);
      };
      setTimeout(tickSim, 300);
    });
    return simRun.promise;
  }

  function renderAll(force) {
    try {
      if (PAGE() === 'client') { if (mode === 'deal' || force) renderClient(); }
      else if (PAGE() === 'bank') renderBank($('#sdBankMount'));
    } catch (e) { console.error('[safe-deal] render', e); }
  }

  /* ---------------- действия ---------------- */
  function copy(text) {
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).catch(() => {}); ok = true; } } catch (e) { ok = false; }
    NX.toast(ok ? 'Код скопирован' : 'Код сделки', text + ' — сообщите его продавцу. Ссылки нет: продавец проверяет код в своём приложении банка', 'info', 'lock');
  }
  function onClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-sd],[data-sd-mode]') : null;
    if (!t) return;
    if (t.hasAttribute('data-sd-mode')) { setMode(t.getAttribute('data-sd-mode')); return; }
    const a = t.getAttribute('data-sd');
    const id = t.getAttribute('data-sd-id');
    if (a === 'open') { if (NX.go) NX.go('transfer'); setMode('deal'); }
    else if (a === 'sample') { const smp = SAMPLES[t.getAttribute('data-sd-k')]; if (smp) fillForm(smp); }
    else if (a === 'ship') { const d = act(id, 'ship'); if (d) NX.toast('Продавец отправил товар', 'Трек ' + d.track + ' · деньги по-прежнему в конверте · симуляция', 'info', 'send'); }
    else if (a === 'deliver') { const d = act(id, 'deliver'); if (d) NX.toast('Доставка: «вручено»', 'Деньги из конверта выплачены продавцу · симуляция', 'ok', 'check'); }
    else if (a === 'confirm') { const d = act(id, 'confirm'); if (d) NX.toast('Сделка завершена', 'Деньги выплачены продавцу · симуляция', 'ok', 'check'); }
    else if (a === 'dispute') openDispute(id);
    else if (a === 'expire') act(id, 'expire');
    else if (a === 'pick') { activeId = id; renderClient(); }
    else if (a === 'copy') copy(t.getAttribute('data-sd-code') || '');
    else if (a === 'fake-shot') fakeShot();
    else if (a === 'bank-sim') simulateDisputes();
    else if (a === 'bank-inc') {
      syncBank();
      const iid = NX.BankExt && NX.BankExt.incidentId('sd:' + id);
      if (iid) NX.BankExt.openIncident(iid);
    } else if (a === 'bank-refund' || a === 'bank-release') {
      const by = NX.BankExt ? NX.BankExt.signer() : 'Аналитик';
      const d = act(id, a === 'bank-refund' ? 'refund' : 'release', { by });
      if (d) NX.toast(a === 'bank-refund' ? 'Деньги возвращены покупателю' : 'Деньги выплачены продавцу', d.code + ' · решение отправлено в кабинет покупателя · симуляция', 'ok', a === 'bank-refund' ? 'reset' : 'check');
    }
  }

  /* ---------------- шина и синхронизация вкладок ---------------- */
  function onBus(msg, local) {
    if (!msg || !msg.type || String(msg.type).indexOf('safe_deal_') !== 0) return;
    const p = msg.payload || {};
    if (!local && p.deal && p.deal.id) pending.set(p.deal.id, p.deal);
    if (!local) {
      const d = p.deal;
      if (PAGE() === 'bank') {
        if (msg.type === 'safe_deal_dispute' && d) NX.toast('Безопасная сделка: спор', String(d.buyer).split(' (')[0] + ' · ' + d.code + ' · ' + (REASONS[d.dispute && d.dispute.reason] || ''), 'warn', 'alert');
        else if (msg.type === 'safe_deal_created' && d) NX.toast('Безопасная сделка: деньги в конверте', NX.fmt(d.amount) + ' · ' + d.code + ' · симуляция', 'info', 'lock');
        else if (msg.type === 'safe_deal_seller_flagged') NX.toast('Продавец — в стоп-лист', String(p.seller && p.seller.name || '') + ' · признанные претензии ' + (p.buyers ? p.buyers.length : DISPUTE_N) + ' независимых покупателей', 'high', 'dna');
        syncBank();
      } else if (PAGE() === 'client' && d && d.buyer === me() && msg.type === 'safe_deal_update' && d.dispute && d.dispute.decidedAt && (p.action === 'refund' || p.action === 'release')) {
        NX.toast('Банк решил спор', d.code + ': ' + (p.action === 'refund' ? 'деньги возвращаются вам' : 'деньги выплачены продавцу'), 'info', 'building');
      } else if (PAGE() === 'client' && d && msg.type === 'safe_deal_update' && p.action === 'ship' && d.buyer === me()) {
        NX.toast('Продавец отправил товар', d.code + ' · трек ' + d.track + ' · симуляция', 'info', 'send');
      }
      settle();
    }
    renderAll();
  }

  function initClientChrome() {
    const modes = $('#sdModes');
    const nc = $('#ncOverview'); // карточка «Не только звонки» на обзоре кабинета
    if (nc) nc.classList.toggle('hidden', EMBED);
    if (HIDE()) { if (modes) modes.classList.add('hidden'); return; }
    if (modes) modes.classList.remove('hidden');
  }
  function init() {
    document.addEventListener('click', onClick);
    NX.bus.on(onBus);
    window.addEventListener('storage', (e) => { if (e.key === KEY) { if (PAGE() === 'bank') syncBank(); settle(); renderAll(); } });
    if (PAGE() === 'client') {
      initClientChrome(); settle();
      // client.html#deal (ссылки с лендинга): сразу «Перевод» → «Покупка у частного лица»
      const openDeal = () => setTimeout(() => { try {
        // через маршрут «deal» кабинета: он включает «Покупку» и оставляет в адресе #deal (перезагрузка не теряет режим)
        if (NX.go) NX.go('deal');
        setMode('deal');
        if (window.location.hash !== '#deal') window.history.replaceState(null, '', '#deal');
      } catch (e) { console.error('[safe-deal] #deal', e); } }, 0);
      if (WANT_DEAL && !EMBED) openDeal();
      if (!EMBED) window.addEventListener('hashchange', () => { if (window.location.hash === '#deal') openDeal(); });
    }
    if (PAGE() === 'bank') { load().deals.forEach((d) => knownDeals.add(d.id)); syncBank(); }
    renderAll();
    if (!EMBED && (PAGE() === 'client' || PAGE() === 'bank')) tickTimer = setInterval(tick, 1000);
  }

  NX.SafeDeal = {
    KEY, DISPUTE_THRESHOLD: DISPUTE_N, DEMO_TTL, SIM_LABEL, SAMPLES, REASONS,
    assess, reserve, setMode, mode: () => mode,
    ship: (id) => act(id, 'ship'), deliver: (id) => act(id, 'deliver'), confirm: (id) => act(id, 'confirm'),
    dispute: (id, reason) => act(id, 'dispute', { reason }), expire: (id) => act(id, 'expire'),
    resolve: (id, verdict, by) => act(id, verdict === 'seller' ? 'release' : 'refund', { by }),
    verifyCode: (code) => { const d = byCode(code); return d ? { found: true, code: d.code, status: d.status, label: STATUS[d.status][0], amount: d.amount, reserved: d.status === 'reserved' || d.status === 'shipped' } : { found: false, code: String(code || '') }; },
    deals: () => load().deals.slice(), get: byId,
    sellers: () => sellerAgg(), checkSeller,
    simulateDisputes, running: () => !!simRun,
    renderClient, renderBank, bankIncidentHTML, bankIncidentSummary, syncBank,
    // заполнить форму примером (honest | fake | direct | mule) → результат проверок assess()
    fill: (k) => { const smp = SAMPLES[k]; if (!smp) return null; if (mode === 'deal' && PAGE() === 'client') { ensureStatic(); fillForm(smp); } return assess(smp); },
    // stage.html, шаг 7: включить (true) / снова скрыть (false) раздел во встроенном режиме
    stageShow: (on) => {
      stageOn = !!on;
      if (PAGE() === 'client') { initClientChrome(); if (!stageOn && EMBED) setMode('normal'); }
      if (stageOn && !tickTimer && (PAGE() === 'client' || PAGE() === 'bank')) tickTimer = setInterval(tick, 1000);
      renderAll(true);
      return stageOn;
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
