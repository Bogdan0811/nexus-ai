/* =====================================================================
   NEXUS AI — Карты для магазинов · карты-маячки (кибер + защита данных)
   - у клиента отдельный виртуальный номер карты на каждого магазина; номер привязан ровно к одному магазину
   - номер всплыл не там (другой магазин, попытка мошенничества, база утечек) → известно, КТО допустил утечку:
     попытка отклонена, карта заморожена и перевыпущена, клиент видит понятное сообщение
   - карта-приманка (honeytoken): никому не передаётся, любая попытка списания — сигнал утечки на стороне клиента
   - Fusion Center: агрегация по клиентам (Common Point of Purchase). Магазин — IOC kind 'merchant' в общем
     стоп-листе core.js: один клиент — «на проверке», независимые клиенты — корреляция; от одного сигнала магазин
     не обвиняется. Порог CPP — маячки CPP_N разных клиентов у одного магазина → инцидент «Утечка у магазина».
   API: NX.LeakRadar (enable, simulate, simulateHoneytoken, simulateCPP, cpp, clientState …)
   Шина: leak_beacon, merchant_compromised, leak_state. Хранилище: nexus_ai_leak_v1.
   Всё — симуляция на синтетических данных: номера карт, попытки списания и база утечек сгенерированы.
   Концепт команды, не продукт банка-организатора. Названия магазинов — обобщённые, не бренды.
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
  // сцена (stage.html, шаг 7 «Не только звонки») временно показывает карточки и во встроенном режиме
  let stageOn = false;
  const HIDE = () => EMBED && !stageOn;
  const PAGE = () => NX.page || '';
  const KEY = 'nexus_ai_leak_v1';
  if (NX.KEYS) NX.KEYS.leak = KEY;
  const DAY = 86400000;
  const CPP_N = 3; // порог общей точки компрометации: маячки N разных клиентов у одного магазина
  const SRC = 'Карты для магазинов · карта-маячок';
  const SIM_LABEL = 'Симуляция: в продукте — виртуальные карты процессинга банка и токенизация; база утечек — через партнёров/АФЦ НБРК';
  if (NX.IOC_KIND && !NX.IOC_KIND.merchant) NX.IOC_KIND.merchant = 'Магазин · Карты для магазинов';

  // обобщённые магазины (не бренды); MID — синтетический
  const MERCHANTS = {
    'M-0417': { name: 'Интернет-магазин техники', cat: 'Электроника · онлайн', icon: 'devices' },
    'M-0233': { name: 'Сайт объявлений', cat: 'Объявления · оплата доставки', icon: 'list' },
    'M-0981': { name: 'Сервис доставки еды', cat: 'Еда · привязанная карта', icon: 'send' },
    'M-0562': { name: 'Онлайн-кинотеатр', cat: 'Подписка', icon: 'play' },
  };
  const ORDER = ['M-0417', 'M-0233', 'M-0981', 'M-0562'];
  // дней с последней оплаты у магазина (синтетика для кабинета)
  const LAST_USE_DAYS = { 'M-0417': 14, 'M-0233': 3, 'M-0981': 1, 'M-0562': 26 };
  const VIA = {
    other_merchant: 'номер пытался использовать другой магазин',
    fraud_attempt: 'попытка мошеннического списания',
    dump: 'номер найден в базе утечек',
    honeytoken: 'попытка списания с карты-приманки',
  };
  const SIM_CLIENTS = ['Асель Н. (синтет.)', 'Тимур Х. (синтет.)', 'Дана Б. (синтет.)'];
  const SIM_STEPS = [
    { via: 'other_merchant', where: 'Неизвестный зарубежный интернет-магазин · оплата без присутствия карты', amount: 124500 },
    { via: 'dump', where: 'Фрагмент базы утечек от партнёра (синтетика)', amount: 0 },
    { via: 'fraud_attempt', where: 'Сайт онлайн-игр · попытка привязать карту', amount: 15000 },
  ];
  const mName = (mid) => (MERCHANTS[mid] ? MERCHANTS[mid].name : String(mid || 'магазин'));
  const q = (s) => '«' + s + '»';
  const days = (n) => (NX.countOf ? NX.countOf(n, ['день', 'дня', 'дней']) : n + ' дн.');

  function hashStr(s) { let h = 5381; const t = String(s || ''); for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h; }
  // последние 4 цифры синтетического номера (полный номер не генерируется и не показывается)
  const last4 = (seed) => String(1000 + (hashStr(seed) % 9000));

  /* ---------------- хранилище ---------------- */
  const resetting = () => !!(NX.isResetting && NX.isResetting());
  const blank = () => ({ v: 1, clients: {}, hits: [], flags: {} });
  const pendingHits = new Map(); // хиты из шины, которых ещё нет в localStorage этой вкладки
  function load() {
    let s = null;
    try { s = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || s.v !== 1 || typeof s.clients !== 'object' || !Array.isArray(s.hits)) s = blank();
    if (!s.flags || typeof s.flags !== 'object') s.flags = {};
    pendingHits.forEach((h, id) => { if (s.hits.some((x) => x.id === id)) pendingHits.delete(id); else s.hits.unshift(h); });
    return s;
  }
  function save(s) {
    if (resetting()) return false;
    try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, clients: s.clients, hits: s.hits.slice(0, 200), flags: s.flags })); return true; } catch (e) { return false; }
  }
  const me = () => { try { return (NX.state && NX.state.user && NX.state.user.name) || 'Клиент'; } catch (e) { return 'Клиент'; } };

  function makeClient(client, now) {
    return {
      enabledAt: now,
      cards: ORDER.map((mid) => {
        const d = LAST_USE_DAYS[mid] != null && client === me() ? LAST_USE_DAYS[mid] : 3 + (hashStr(client + mid) % 25);
        return { id: NX.uid('vc'), mid, last4: last4(client + '|' + mid + '|1'), gen: 1, created: now - (d + 40) * DAY, lastUse: now - d * DAY, status: 'active', old: [] };
      }),
      honey: { last4: last4(client + '|honey'), created: now, old: [] },
    };
  }
  function enable(client) {
    const c = client || me();
    const s = load();
    if (s.clients[c]) return s.clients[c];
    const now = Date.now();
    s.clients[c] = makeClient(c, now);
    save(s);
    if (c === me() && PAGE() === 'client' && NX.addEvent) {
      try { NX.addEvent({ type: 'leak_radar_on', source: 'Leak Radar', severity: 'low', manual: true, title: 'Включены карты-маячки', details: ORDER.length + ' виртуальных номера по одному на магазин + карта-приманка · симуляция' }); } catch (e) { /* ignore */ }
    }
    NX.bus.emit('leak_state', { client: c, action: 'enable' });
    renderAll();
    return s.clients[c];
  }

  /* ---------------- агрегация: общие точки компрометации ---------------- */
  function iocRec(mid) { try { return NX.iocs.find('merchant', mid); } catch (e) { return null; } }
  function iocSt(mid) { try { return NX.iocs.status('merchant', mid); } catch (e) { return null; } }
  function cpp(sIn) {
    const s = sIn || load();
    const by = {};
    s.hits.forEach((h) => {
      if (!h || h.honey || !h.mid) return;
      const a = by[h.mid] || (by[h.mid] = { mid: h.mid, name: mName(h.mid), hits: [], clients: [] });
      a.hits.push(h);
      if (a.clients.indexOf(h.client) < 0) a.clients.push(h.client);
    });
    return Object.keys(by).map((mid) => {
      const a = by[mid];
      const ages = a.hits.map((h) => h.ageDays).filter((x) => typeof x === 'number');
      a.hits.sort((x, y) => x.ts - y.ts);
      a.first = a.hits[0].ts; a.last = a.hits[a.hits.length - 1].ts;
      a.windowDays = ages.length ? [Math.min.apply(null, ages), Math.max.apply(null, ages)] : null;
      a.declinedSum = a.hits.reduce((x, h) => x + (Number(h.amount) || 0), 0);
      a.flag = s.flags[mid] || null;
      a.cpp = a.clients.length >= CPP_N;
      a.iocStatus = iocSt(mid);
      return a;
    }).sort((x, y) => y.last - x.last);
  }

  /* ---------------- срабатывание маячка ---------------- */
  // o: {client, mid, via, where, amount, sim:'client'|'bank'}; honeytoken — o.honey = true (без магазина)
  function simulate(o) {
    const opt = o || {};
    const client = opt.client || me();
    const honey = !!opt.honey;
    const mid = honey ? null : (MERCHANTS[opt.mid] ? opt.mid : 'M-0417');
    enable(client);
    const s = load();
    const rec = s.clients[client];
    const card = honey ? rec.honey : rec.cards.find((c) => c.mid === mid);
    if (!card) return null;
    const now = Date.now();
    const via = honey ? 'honeytoken' : (VIA[opt.via] ? opt.via : 'other_merchant');
    const oldL4 = card.last4;
    const newL4 = last4(client + '|' + (mid || 'honey') + '|' + ((card.gen || 1) + 1) + '|' + now);
    const hit = {
      id: NX.uid('lrh'), ts: now, client, mid, honey, via,
      where: String(opt.where || (honey ? 'Неизвестный интернет-магазин · оплата без присутствия карты' : 'Неизвестный зарубежный интернет-магазин · оплата без присутствия карты')),
      amount: Math.max(0, Math.round(Number(opt.amount != null ? opt.amount : 89990)) || 0),
      last4Old: oldL4, last4New: newL4,
      lastUse: honey ? null : card.lastUse || null,
      ageDays: honey || !card.lastUse ? null : Math.max(0, Math.round((now - card.lastUse) / DAY)),
      declined: true, synthetic: true, sim: opt.sim || PAGE() || 'client',
    };
    // заморозка и перевыпуск: старый номер больше не проходит авторизацию, новый — только у «своего» магазина
    card.old = (card.old || []).concat([{ last4: oldL4, frozenAt: now, hitId: hit.id }]).slice(-5);
    card.last4 = newL4; card.gen = (card.gen || 1) + 1; card.reissuedAt = now;
    // lastUse — последняя ЗАКОННАЯ оплата у магазина; перевыпуск и отклонённая попытка её не меняют
    // (в продукте новый токен передаётся магазину автоматически, но это не оплата)
    s.hits.unshift(hit);
    let compromisedNow = false;
    if (mid) {
      const clients = Array.from(new Set(s.hits.filter((h) => h.mid === mid && !h.honey).map((h) => h.client)));
      if (clients.length >= CPP_N && !s.flags[mid]) { s.flags[mid] = { at: now, clients }; compromisedNow = true; }
    }
    save(s);
    // магазин → IOC в общем стоп-листе: каждый клиент — отдельный независимый источник (session + client)
    let iocFresh = [];
    if (mid) {
      try {
        iocFresh = NX.iocs.add([{ kind: 'merchant', value: mid, raw: q(mName(mid)) + ' · ' + mid, merchant: mName(mid) }], via === 'dump' ? 'Карты для магазинов · база утечек (симуляция)' : SRC, { session: 'lr:' + hit.id, client }) || [];
      } catch (e) { console.error('[leak-radar] ioc', e); }
      if (PAGE() === 'bank' && iocFresh.length && NX.BankExt) {
        try { NX.BankExt.ingestIocs({ items: iocFresh, source: SRC, client, t0: now }); } catch (e) { console.error(e); }
      }
    }
    const status = mid ? iocSt(mid) : null;
    const agg = mid ? cpp(s).find((a) => a.mid === mid) : null;
    if (client === me() && PAGE() === 'client' && NX.addEvent) {
      try {
        NX.addEvent({ type: 'leak_beacon', source: 'Leak Radar', severity: 'med', manual: true,
          title: honey ? 'Попытка списания с карты-приманки' : 'Номер карты для ' + q(mName(mid)) + ' всплыл в чужом месте',
          details: 'Попытка отклонена, деньги не списаны · карта •••• ' + oldL4 + ' заменена на •••• ' + newL4 + ' · симуляция' });
      } catch (e) { /* ignore */ }
    }
    NX.bus.emit('leak_beacon', { hit, merchant: mid ? { id: mid, name: mName(mid) } : null, clients: agg ? agg.clients.length : 0, threshold: CPP_N, iocStatus: status, synthetic: true });
    if (compromisedNow) NX.bus.emit('merchant_compromised', { mid, name: mName(mid), clients: s.flags[mid].clients.slice(), at: now, threshold: CPP_N, iocStatus: status, synthetic: true });
    if (PAGE() === 'client' && client === me()) {
      NX.toast(honey ? 'Сработала карта-приманка' : 'Маячок ' + q(mName(mid)) + ' сработал', 'Попытка отклонена, деньги не списаны · карта заменена · симуляция', 'high', honey ? 'target' : 'card');
    }
    if (PAGE() === 'bank') syncBank();
    renderAll();
    return Object.assign({}, hit, { iocStatus: status, clients: agg ? agg.clients.length : 0, compromised: !!(mid && s.flags[mid]), compromisedNow });
  }
  const simulateHoneytoken = (client) => simulate({ client, honey: true, amount: 4990, where: 'Неизвестный интернет-магазин · оплата без присутствия карты' });

  // Fusion Center: «3 клиента, один магазин» — маячки трёх синтетических клиентов срабатывают по очереди
  let simRun = null;
  function simulateCPP(midIn, stepMs) {
    if (simRun) return simRun.promise;
    const s = load();
    const mid = MERCHANTS[midIn] ? midIn : (ORDER.find((m) => !s.flags[m]) || ORDER[0]);
    const gap = Math.max(200, Number(stepMs) || 1600);
    simRun = { mid, step: 0, results: [] };
    renderAll();
    simRun.promise = new Promise((resolve) => {
      const tick = () => {
        if (!simRun || resetting()) { simRun = null; resolve(null); return; }
        const i = simRun.step;
        const st = SIM_STEPS[i];
        const r = simulate({ client: SIM_CLIENTS[i], mid, via: st.via, where: st.where, amount: st.amount, sim: 'bank' });
        simRun.results.push(r);
        simRun.step = i + 1;
        if (simRun.step >= SIM_CLIENTS.length) {
          const out = { mid, name: mName(mid), results: simRun.results.slice(), compromised: !!load().flags[mid], iocStatus: iocSt(mid) };
          simRun = null;
          renderAll();
          resolve(out);
          return;
        }
        renderAll();
        setTimeout(tick, gap);
      };
      setTimeout(tick, 300);
    });
    return simRun.promise;
  }

  /* ---------------- Fusion Center: инциденты ---------------- */
  const viaShort = (h) => VIA[h.via] || h.via;
  function hitLine(h) {
    return h.client + ': ' + viaShort(h) + (h.amount ? ' · ' + NX.fmt(h.amount) + ' — отклонено' : '') + ' · •••• ' + h.last4Old + ' → •••• ' + h.last4New;
  }
  function syncBank() {
    if (PAGE() !== 'bank' || !NX.BankExt) return;
    const s = load();
    cpp(s).forEach((a) => {
      const n = a.clients.length;
      const res = NX.BankExt.upsertIncident('leak:' + a.mid, () => ({
        kind: 'leak_merchant', lrMid: a.mid, synthetic: true, score: null, account: '—', amount: a.declinedSum,
        type: 'Утечка у магазина · Карты для магазинов',
        title: a.cpp ? q(a.name) + ' — общая точка компрометации: маячки ' + n + ' клиентов' : q(a.name) + ': маячок сработал у ' + n + ' из ' + CPP_N + ' клиентов',
        client: n === 1 ? a.clients[0] : NX.countOf(n, ['клиент', 'клиента', 'клиентов']) + ': ' + a.clients.map((c) => String(c).split(' (')[0]).join(', '),
        source: 'Leak Radar · карты-маячки',
        factors: [
          'Номер каждой карты-маячка знал только ' + q(a.name),
          NX.countOf(n, ['независимый клиент', 'независимых клиента', 'независимых клиентов']) + ' из порога ' + CPP_N,
          a.windowDays ? 'Последние оплаты у магазина: ' + (a.windowDays[0] === a.windowDays[1] ? days(a.windowDays[0]) : 'от ' + a.windowDays[0] + ' до ' + days(a.windowDays[1])) + ' назад' : 'Окно компрометации не определено',
          'Списаний нет: попытки отклонены на авторизации',
        ],
        chain: a.hits.map((h) => ({ t: hitLine(h), ts: h.ts })),
        reopen: a.cpp && !!a.flag,
        addNotes: a.flag ? [{ key: 'cpp', ts: a.flag.at, t: 'Порог CPP достигнут: маячки ' + a.flag.clients.length + ' разных клиентов у одного магазина. Магазин — общая точка компрометации (симуляция).', by: 'NEXUS · Карты для магазинов' }] : [],
      }));
      if (res && res.isNew) {
        try { NX.BankExt.logCycle('detect', 'Карты для магазинов: маячок у ' + q(a.name) + ' · ' + NX.countOf(n, ['клиент', 'клиента', 'клиентов']), { inc: res.id }); } catch (e) { /* ignore */ }
      }
    });
    const honey = {};
    s.hits.forEach((h) => { if (h && h.honey) (honey[h.client] = honey[h.client] || []).push(h); });
    Object.keys(honey).forEach((client) => {
      const list = honey[client].slice().sort((x, y) => x.ts - y.ts);
      NX.BankExt.upsertIncident('leak_honey:' + client, () => ({
        kind: 'leak_honey', synthetic: true, score: null, account: '—', amount: list.reduce((x, h) => x + (Number(h.amount) || 0), 0),
        type: 'Карта-приманка · Карты для магазинов', title: 'Попытка списания с карты-приманки: ' + client, client, source: 'Leak Radar · карта-приманка',
        factors: ['Карту-приманку никому не передавали — законной причины для списания нет', 'Магазин не обвиняется: утечка вероятнее на стороне клиента (устройство, почта, фишинг)', 'Списаний нет: попытка отклонена'],
        chain: list.map((h) => ({ t: hitLine(h) + ' · ' + h.where, ts: h.ts })),
      }));
    });
  }

  const IOC_POLICY = {
    suspected: 'Один клиент — один источник: магазин на проверке и не обвиняется, ограничений для магазина нет. Карта клиента уже заменена. Повышение статуса — только по маячкам других, независимых клиентов.',
    corroborated: 'Маячки двух и более независимых клиентов: подозрение на магазин усилено корреляцией, но это ещё не вывод. Общая точка компрометации — от ' + CPP_N + ' клиентов; уведомление магазина и МПС и передача в АФЦ НБРК — решение аналитиков в четыре глаза.',
    confirmed: 'Подтверждено аналитиками (две подписи): можно уведомить магазин и МПС и передать индикатор в АФЦ НБРК. В прототипе — симуляция.',
    revoked: 'Снят как ложное срабатывание: магазин не считается точкой компрометации.',
    expired: 'Срок проверки истёк без новых сигналов.',
  };
  const CPP_POLICY = 'Порог CPP достигнут: маячки ' + CPP_N + '+ независимых клиентов указывают на магазин как на общую точку компрометации (симуляция). Уведомление магазина и МПС и передача в АФЦ НБРК — решение аналитиков в четыре глаза.';
  // текст политики для статуса IOC магазина; при достигнутом пороге CPP — отдельная формулировка
  function policyFor(st, mid) {
    if (st === 'corroborated' && mid) { const a = cpp().find((x) => x.mid === mid); if (a && a.cpp) return CPP_POLICY; }
    return IOC_POLICY[st] || IOC_POLICY.suspected;
  }
  function stChip(st) {
    if (!st) return '<span class="badge plain">нет в стоп-листе</span>';
    const cls = st === 'suspected' ? 'warn' : st === 'corroborated' || st === 'confirmed' ? 'high' : 'info';
    return '<span class="badge ' + cls + '">' + esc(NX.iocs.label(st)) + '</span>';
  }
  function bankIncidentSummary(i) {
    if (i.kind === 'leak_honey') return '<div class="notice warn"><b>Сработала карта-приманка</b><br>Карту никому не передавали, поэтому попытка списания — сигнал утечки данных клиента. Магазин не обвиняется. Индекса риска нет.</div>';
    const a = cpp().find((x) => x.mid === i.lrMid);
    const n = a ? a.clients.length : 0;
    return '<div class="notice' + (a && a.cpp ? ' danger' : ' warn') + '"><b>' + esc(a && a.cpp ? 'Общая точка компрометации' : n >= 2 ? 'Сигнал на проверке · корреляция усиливается' : 'Сигнал на проверке') + '</b><br>' +
      esc('Маячки ' + NX.countOf(n, ['клиента', 'клиентов', 'клиентов']) + ' при пороге ' + CPP_N + '. Индекса риска нет: решение строится на числе независимых клиентов, а не на одном сигнале.') + '</div>';
  }
  function bankIncidentHTML(i) {
    if (i.kind === 'leak_honey') {
      return '<h4 class="mt mb lr-h4">' + ic('target') + ' Карты для магазинов · карта-приманка</h4>' +
        '<p class="small muted">Что дальше: связаться с клиентом с официального номера, проверить устройство и почту, перевыпустить карты, к которым мог быть доступ.</p>' + realityHTML(true);
    }
    const a = cpp().find((x) => x.mid === i.lrMid);
    if (!a) return '<p class="small muted mt">Данные Карты для магазинов для этого магазина не найдены (сброс?).</p>';
    const rec = iocRec(a.mid);
    const rows = a.hits.map((h) => '<div class="li"><div class="ic">' + ic(h.via === 'dump' ? 'folder' : 'card', 16) + '</div><div class="grow" style="min-width:0"><div class="t lr-wrap">' + esc(String(h.client)) + ' · ' + esc(viaShort(h)) + '</div><div class="s lr-wrap">' + esc(h.where) + (h.ageDays != null ? ' · последняя оплата у магазина ' + esc(days(h.ageDays)) + ' назад' : '') + '</div></div><span class="mono tiny">•••• ' + esc(h.last4Old) + ' → ' + esc(h.last4New) + '</span></div>').join('');
    return '<h4 class="mt mb lr-h4">' + ic('card') + ' Карты для магазинов · маячки у ' + esc(q(a.name)) + '</h4>' +
      '<div class="lr-meter" aria-label="' + esc('Клиентов: ' + a.clients.length + ', порог ' + CPP_N) + '">' + meterHTML(a.clients.length) + '<span class="small">' + esc(NX.countOf(a.clients.length, ['клиент', 'клиента', 'клиентов']) + ' · порог ' + CPP_N) + '</span>' + stChip(a.iocStatus) +
      (rec ? '<button type="button" class="btn sm" data-ioc="' + esc(rec.id) + '">' + ic('dna', 14) + 'Магазин в стоп-листе</button>' : '') + '</div>' +
      '<div class="list small mt-s">' + rows + '</div>' +
      '<p class="small mt-s">' + esc(a.windowDays ? 'Окно компрометации по данным маячков: последние законные оплаты у магазина ' + (a.windowDays[0] === a.windowDays[1] ? days(a.windowDays[0]) : 'от ' + a.windowDays[0] + ' до ' + days(a.windowDays[1])) + ' назад — с этого периода начинается проверка у магазина.' : '') + '</p>' +
      '<div class="row wrap gap-s mt-s"><button type="button" class="btn sm" data-lr="bank-notify" data-lr-mid="' + esc(a.mid) + '">' + ic('send', 14) + 'Уведомить магазин и МПС (симуляция)</button></div>' +
      '<p class="tiny muted mt-s">' + esc(policyFor(a.iocStatus, a.mid)) + '</p>' + realityHTML(true);
  }
  // что работает / что симулировано / что требует интеграции — в общем поповере «Что работает в прототипе» (NX.ui.FEATURES)
  function realityHTML() {
    return '<p class="tiny muted mt-s">' + esc(SIM_LABEL) + '. <button type="button" class="tag-demo tag-demo-btn" data-nx-honesty aria-haspopup="dialog">' + esc('что работает в прототипе') + '</button></p>';
  }
  const meterHTML = (n) => '<span class="lr-dots">' + Array.from({ length: CPP_N }, (_, k) => '<i class="' + (k < n ? 'on' : '') + '"></i>').join('') + '</span>';

  /* ---------------- рендер: только при изменении разметки (без повторных анимаций) ---------------- */
  function put(el, html) { if (el && el._lrHtml !== html) { el.innerHTML = html; el._lrHtml = html; } }

  // клиент: раздел «Карты-маячки»
  function lastHitFor(s, client) { return s.hits.find((h) => h && h.client === client) || null; }
  function alertHTML(h) {
    if (!h) return '';
    if (h.honey) {
      return '<div class="card lr-alert"><div class="lr-alert-h">' + ic('target', 22) + '<div><b>Кто-то пытался списать деньги с карты-приманки</b><div class="small muted">' + esc(NX.ago(h.ts)) + ' · ' + esc(h.where) + (h.amount ? ' · ' + esc(NX.fmt(h.amount)) : '') + '</div></div></div>' +
        '<p class="small">Эту карту никому не передавали — ни один магазин её не знал. Значит, номер утёк не из магазина: вероятнее — с устройства, из почты или через фишинговую форму; бывает и подбор номеров. Магазины по этому сигналу не обвиняются.</p>' +
        '<ul class="lr-steps"><li>' + ic('check', 14) + 'Попытка отклонена — деньги не списаны</li><li>' + ic('check', 14) + 'Приманка заменена: •••• ' + esc(h.last4Old) + ' → •••• ' + esc(h.last4New) + '</li><li>' + ic('check', 14) + 'Банк получил сигнал и проверит другие ваши карты</li></ul>' +
        '<div class="row wrap gap-s mt-s"><button class="btn sm" type="button" data-goto="security">' + ic('search', 14) + 'Проверить устройство</button></div>' +
        '</div>';
    }
    const ago = h.ageDays != null ? days(h.ageDays) + ' назад' : 'недавно';
    // статус магазина — по текущему состоянию банка (агрегация по клиентам и IOC), а не по первому сигналу
    const agg = cpp().find((x) => x.mid === h.mid) || null;
    const st = iocSt(h.mid);
    const nCl = agg ? agg.clients.length : 1;
    const bankLine = st === 'revoked' ? 'Банк проверил магазин и снял подозрение: ложное срабатывание. Ваша карта всё равно заменена'
      : agg && agg.cpp ? 'Банк: маячки ' + NX.countOf(nCl, ['клиента', 'клиентов', 'клиентов']) + ' сработали у этого магазина — он признан общей точкой компрометации, аналитики решают об уведомлении магазина (симуляция)'
        : nCl >= 2 ? 'Банк: маячки ' + nCl + ' разных клиентов у этого магазина — подозрение усилено, проверка продолжается (порог ' + CPP_N + ')'
          : 'Банк получил сигнал: магазин на проверке. По одному сигналу магазин не обвиняется — нужны маячки других клиентов';
    return '<div class="card lr-alert"><div class="lr-alert-h">' + ic('alert', 22) + '<div><b>' + esc('Номер карты для ' + q(mName(h.mid)) + ' всплыл в чужом месте') + '</b><div class="small muted">' + esc('карта уже заменена, деньги не списаны') + '</div></div></div>' +
      '<p class="small">' + esc('Номер •••• ' + h.last4Old + ' знал только ' + q(mName(h.mid)) + '; ваша последняя оплата там — ' + ago + '. Сейчас его использовали в другом месте: ' + h.where + (h.amount ? ', ' + NX.fmt(h.amount) : '') + ' (' + viaShort(h) + ').') + '</p>' +
      '<p class="small">' + esc('Вероятный источник утечки — ' + q(mName(h.mid)) + ' или его страница оплаты. По одному сигналу это не доказано: номер могли перехватить и на вашем устройстве, и в поддельной форме оплаты.') + '</p>' +
      '<ul class="lr-steps"><li>' + ic('check', 14) + 'Попытка отклонена — деньги не списаны</li><li>' + ic('check', 14) + esc('Карта •••• ' + h.last4Old + ' заморожена') + '</li><li>' + ic('check', 14) + esc('Выпущена новая •••• ' + h.last4New + ' — работает только в ' + q(mName(h.mid))) + '</li><li>' + ic('check', 14) + esc(bankLine) + '</li></ul>' +
      '<p class="tiny muted mt-s">Срок «' + esc(ago) + '» — от последней законной оплаты у магазина в синтетической истории, а не дата утечки.</p></div>';
  }
  function cardTile(c, honey) {
    const m = honey ? null : MERCHANTS[c.mid];
    const replaced = c.reissuedAt ? '<div class="tiny lr-ok">' + esc('заменена ' + NX.ago(c.reissuedAt) + ' · старая •••• ' + (c.old && c.old.length ? c.old[c.old.length - 1].last4 : '') + ' заморожена') + '</div>' : '';
    return '<div class="lr-tile' + (honey ? ' honey' : '') + '"><div class="row between gap-s"><span class="lr-ic">' + ic(honey ? 'target' : m.icon, 18) + '</span><span class="mono">•••• ' + esc(c.last4) + '</span></div>' +
      '<b class="lr-wrap">' + esc(honey ? 'Карта-приманка' : m.name) + '</b>' +
      '<div class="tiny muted lr-wrap">' + esc(honey ? 'никому не передавалась · любое списание — сигнал утечки' : m.cat + ' · только для этого магазина') + '</div>' +
      (honey ? '' : '<div class="tiny muted">' + esc(c.lastUse ? 'последняя оплата ' + NX.ago(c.lastUse) : 'ещё не использовалась') + '</div>') + replaced + '</div>';
  }
  function renderClient(el) {
    if (!el) return;
    const s = load();
    const c = me();
    const rec = s.clients[c];
    const h = lastHitFor(s, c);
    const mine = s.hits.filter((x) => x && x.client === c);
    let html = '<div class="grid g-main"><div class="col gap-l">' +
      '<div class="card lr-hero"><div class="card-h"><h3>' + ic('card', 18) + ' Карты для магазинов</h3></div>' +
      '<ol class="lr-3"><li><b>Свой номер для каждого магазина.</b> Он работает только там.</li><li><b>Номер всплыл в другом месте?</b> Оплата отклоняется, деньги не списываются.</li><li><b>Вы видите, где утекли данные,</b> а карта заменяется сама.</li></ol>' +
      (rec
        ? '<div class="row wrap gap-s mt"><button class="btn danger" type="button" data-lr="sim-leak">' + ic('bolt', 15) + 'Симулировать утечку</button><button class="btn" type="button" data-lr="sim-honey">' + ic('target', 15) + 'Попытка списания с приманки</button></div>'
        : '<div class="row wrap gap-s mt"><button class="btn primary" type="button" data-lr="enable">' + ic('shieldCheck', 15) + 'Включить карты-маячки</button></div><p class="tiny muted mt-s">Одно нажатие: ' + ORDER.length + ' виртуальных номера для ваших магазинов и одна карта-приманка. Основная карта не меняется.</p>') +
      '</div>' +
      alertHTML(h);
    if (rec) {
      html += '<div class="card"><div class="card-h"><h3>Мои карты-маячки</h3><span class="hint">номер на каждый магазин</span></div><div class="lr-cards">' +
        rec.cards.map((x) => cardTile(x, false)).join('') + cardTile(rec.honey, true) + '</div>' +
        '<p class="tiny muted mt-s">Номера синтетические, показаны только последние 4 цифры. В продукте магазин получает токен карты, а новый номер после замены передаётся ему автоматически.</p></div>';
    }
    html += '</div><div class="col gap-l">' +
      '<div class="card"><div class="card-h"><h3>Срабатывания</h3><span class="hint">' + esc(NX.countOf(mine.length, ['событие', 'события', 'событий'])) + '</span></div>' +
      (mine.length ? '<div class="list">' + mine.slice(0, 8).map((x) => '<div class="li"><div class="ic">' + ic(x.honey ? 'target' : 'card', 16) + '</div><div class="grow" style="min-width:0"><div class="t lr-wrap">' + esc(x.honey ? 'Карта-приманка' : q(mName(x.mid))) + '</div><div class="s lr-wrap">' + esc(viaShort(x) + ' · ' + NX.ago(x.ts)) + '</div></div><span class="badge ok plain">отклонено</span></div>').join('') + '</div>'
        : '<p class="small muted">Пока ни один номер не всплыл там, где не должен.</p>') + '</div>' +
      '<details class="more"><summary>Подробнее</summary><div class="more-b">' +
      '<div class="feat">Номер привязан к одному магазину: оплата у любого другого отклоняется на авторизации — деньги не списываются</div>' +
      '<div class="feat">Номер всплыл не там — вероятный источник утечки: «свой» магазин или его страница оплаты. Вы видите, какой это магазин и когда была последняя оплата там; номер могли перехватить и на устройстве</div>' +
      '<div class="feat">Банк сводит сигналы разных клиентов. По одному сигналу магазин не обвиняется</div>' +
      '<div class="feat">Карта-приманка никому не передаётся: попытка списания с неё — сигнал утечки на вашей стороне</div>' +
      '</div></details>' +
      '</div></div>';
    put(el, html);
  }
  // клиент: карточка в «Безопасности» — включение одним нажатием
  function renderSecurityCard(el) {
    if (!el) return;
    if (HIDE()) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const s = load();
    const c = me();
    const rec = s.clients[c];
    const h = lastHitFor(s, c);
    put(el, '<div class="card-h"><h3>Карты-маячки</h3><span class="badge warn plain">симуляция</span></div>' +
      '<p class="small muted">Отдельный номер карты для каждого магазина: если данные утекут, вы узнаете, из какого именно, а карта заменится сама.</p>' +
      (rec
        ? '<div class="small mt-s">' + ic('check', 14) + ' ' + esc('Включено: ' + rec.cards.length + ' номера + карта-приманка') + (h ? ' · ' + esc('последнее срабатывание ' + NX.ago(h.ts)) : '') + '</div><button class="btn mt" type="button" data-goto="leak">' + ic('card', 15) + 'Открыть карты-маячки</button>'
        : '<button class="btn primary mt" type="button" data-lr="enable-go">' + ic('shieldCheck', 15) + 'Включить одним нажатием</button>'));
  }
  // банк: карточка на обзоре
  function renderBank(el) {
    if (!el) return;
    if (HIDE()) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const s = load();
    const list = cpp(s);
    const honeyN = s.hits.filter((h) => h && h.honey).length;
    const running = simRun ? 'Идёт симуляция: ' + q(mName(simRun.mid)) + ' · клиент ' + Math.min(simRun.step + 1, CPP_N) + ' из ' + CPP_N : '';
    const rows = list.map((a) => '<div class="lr-mrow' + (a.cpp ? ' cpp' : '') + '"><div class="grow" style="min-width:0"><b class="lr-wrap">' + esc(q(a.name)) + '</b> <span class="mono tiny muted">' + esc(a.mid) + '</span>' +
      '<div class="tiny muted lr-wrap">' + esc(a.clients.map((x) => String(x).split(' (')[0]).join(', ') + ' · ' + NX.ago(a.last)) + '</div></div>' +
      '<div class="row wrap gap-s lr-mside">' + meterHTML(a.clients.length) + stChip(a.iocStatus) + (a.cpp ? '<span class="badge high">общая точка компрометации</span>' : '<span class="badge plain">' + esc(a.clients.length + ' из ' + CPP_N) + '</span>') +
      '<button class="btn sm" type="button" data-lr="bank-inc" data-lr-mid="' + esc(a.mid) + '">Инцидент</button></div></div>').join('');
    put(el, '<div class="card-h"><h3>' + ic('card', 18) + ' Карты для магазинов · утечки у магазинов</h3></div>' +
      '<p class="small muted">Каждая карта-маячок привязана к одному магазину, поэтому сработавший маячок указывает на магазин напрямую — без перебора общих покупок. Общая точка компрометации — маячки ' + CPP_N + ' разных клиентов у одного магазина. Один сигнал магазин не обвиняет: первый клиент — «на проверке», независимые клиенты — корреляция в стоп-листе.</p>' +
      '<div class="row wrap gap-s mt-s"><button class="btn primary" type="button" data-lr="bank-sim"' + (simRun ? ' disabled' : '') + '>' + ic('play', 15) + 'Симуляция: 3 клиента, один магазин</button>' + (running ? '<span class="small lr-run">' + esc(running) + '</span>' : '') + '</div>' +
      (rows ? '<div class="lr-mlist mt">' + rows + '</div>' : '<div class="empty">Маячки пока не срабатывали. Запустите симуляцию или нажмите «Симулировать утечку» в кабинете клиента (Карты-маячки).</div>') +
      (honeyN ? '<p class="small mt-s">' + ic('target', 14) + ' ' + esc('Карты-приманки: ' + NX.countOf(honeyN, ['срабатывание', 'срабатывания', 'срабатываний']) + ' — отдельные инциденты по клиентам, магазин не обвиняется.') + '</p>' : '') +
      realityHTML(true));
  }
  function renderAll() {
    try {
      if (PAGE() === 'client') {
        const v = $('#view-leak');
        if (v && v.classList.contains('active')) renderClient(v);
        const sec = $('#lrSecMount'); if (sec) renderSecurityCard(sec);
        renderBadge();
      } else if (PAGE() === 'bank') {
        renderBank($('#leakRadarMount'));
      }
    } catch (e) { console.error('[leak-radar] render', e); }
  }
  function renderBadge() {
    const b = $('#lrBadge'); if (!b) return;
    const n = load().hits.filter((h) => h && h.client === me()).length;
    b.textContent = n ? String(n) : '';
    b.classList.toggle('hidden', !n);
  }

  /* ---------------- действия ---------------- */
  function onClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-lr]') : null;
    if (!t) return;
    const a = t.dataset.lr;
    if (a === 'enable') { enable(); NX.toast('Карты-маячки включены', ORDER.length + ' номера по одному на магазин и карта-приманка · симуляция', 'ok', 'card'); }
    else if (a === 'enable-go') { enable(); NX.toast('Карты-маячки включены', 'Симуляция · подробности — в разделе «Карты-маячки»', 'ok', 'card'); if (NX.go) NX.go('leak'); }
    else if (a === 'sim-leak') simulate({ mid: 'M-0417', via: 'other_merchant', amount: 89990, sim: 'client' });
    else if (a === 'sim-honey') simulateHoneytoken();
    else if (a === 'bank-sim') simulateCPP();
    else if (a === 'bank-inc') {
      syncBank();
      const id = NX.BankExt && NX.BankExt.incidentId('leak:' + t.dataset.lrMid);
      if (id) NX.BankExt.openIncident(id);
    } else if (a === 'bank-notify' && NX.BankExt) {
      const mid = t.dataset.lrMid;
      NX.BankExt.upsertIncident('leak:' + mid, () => ({ addNotes: [{ key: 'notify:' + Date.now(), t: 'Сформировано уведомление магазину ' + q(mName(mid)) + ' и МПС: окно компрометации и число затронутых карт, без персональных данных клиентов (симуляция, не отправлено)', by: NX.BankExt.signer() }] }));
      NX.toast('Уведомление сформировано', q(mName(mid)) + ' и МПС · симуляция, не отправлено', 'info', 'send');
    }
  }

  /* ---------------- шина и синхронизация вкладок ---------------- */
  function onBus(msg, local) {
    if (!msg || !msg.type) return;
    const p = msg.payload || {};
    if (msg.type === 'leak_beacon') {
      if (!local && p.hit && p.hit.id) pendingHits.set(p.hit.id, p.hit);
      if (PAGE() === 'bank') {
        syncBank();
        if (!local && p.merchant) NX.toast('Карты для магазинов: маячок сработал', q(p.merchant.name) + ' · ' + (p.clients || 1) + ' из ' + CPP_N + ' клиентов · ' + String(p.hit && p.hit.client || ''), 'warn', 'card');
        else if (!local && p.hit && p.hit.honey) NX.toast('Карты для магазинов: карта-приманка', String(p.hit.client || '') + ' · попытка отклонена', 'warn', 'target');
      }
      renderAll();
    } else if (msg.type === 'merchant_compromised') {
      if (PAGE() === 'bank') {
        syncBank();
        NX.toast('Общая точка компрометации', q(String(p.name || '')) + ' · маячки ' + (p.clients ? p.clients.length : CPP_N) + ' разных клиентов · симуляция', 'high', 'card');
        try { NX.BankExt.logCycle('investigate', 'Карты для магазинов: ' + q(String(p.name || '')) + ' — общая точка компрометации (' + (p.clients ? p.clients.length : CPP_N) + ' клиента)'); } catch (e) { /* ignore */ }
      }
      renderAll();
    } else if (msg.type === 'leak_state') {
      renderAll();
    }
  }

  function init() {
    if (EMBED) { const nb = document.querySelector('.nav-btn[data-view="leak"]'); if (nb) nb.classList.add('hidden'); }
    document.addEventListener('click', onClick);
    NX.bus.on(onBus);
    window.addEventListener('storage', (e) => { if (e.key === KEY) { if (PAGE() === 'bank') syncBank(); renderAll(); } });
    if (PAGE() === 'bank') syncBank();
    renderAll();
  }

  NX.LeakRadar = {
    KEY, CPP_THRESHOLD: CPP_N, MERCHANTS, SIM_LABEL,
    enable, simulate, simulateHoneytoken, simulateCPP,
    cpp: () => cpp(),
    clientState: (client) => { const s = load(); return s.clients[client || me()] || null; },
    hits: () => load().hits.slice(),
    running: () => !!simRun,
    renderClient, renderSecurityCard, renderBank, bankIncidentHTML, bankIncidentSummary,
    iocPolicy: (st, mid) => policyFor(st, mid),
    syncBank,
    // stage.html, шаг 7: показать (true) / снова скрыть (false) карточки во встроенном режиме
    stageShow: (on) => { stageOn = !!on; renderAll(); return stageOn; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
