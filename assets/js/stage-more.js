/* =====================================================================
   NEXUS AI — сцена (stage.html), шаг 7 полной сцены «Не только звонки»
   Два модуля вне звонка, вживую в тех же iframe кабинета и Fraud Fusion Center:
   7а Leak Radar · карты-маячки: маячок Гульнары-апа сработал у «Сайт объявлений» → в банке ещё
      2 синтетических клиента (симуляция) → порог CPP: магазин — общая точка компрометации
   7б Безопасная сделка · P2P-эскроу: деньги в конверте банка → телефон продавца видит
      «Деньги зарезервированы банком» → продавец присылает «ссылку доставки» → NEXUS ловит её до оплаты
   В коротком показе (?short=1) этого шага нет. Логика модулей — в leak-radar.js и safe-deal.js;
   здесь только вызовы их API в iframe (NX.LeakRadar, NX.SafeDeal) через контекст stage.js.
   Всё — симуляция на синтетических данных. Концепт команды, не продукт банка-организатора.
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  if (!NX) return;
  const esc = (v) => NX.esc(v);
  const ic = (n, s) => (NX.icon ? NX.icon(n, '', s || 16) : '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MID = 'M-0233'; // «Сайт объявлений» (обобщённое название, не бренд)
  const MNAME = 'Сайт объявлений';
  const CPP_GAP = 1500;
  // клиенты 2–3 — синтетические (те же имена, что в симуляции Leak Radar на обзоре банка)
  const SIM2 = [
    { client: 'Асель Н. (синтет.)', via: 'dump', where: 'Фрагмент базы утечек от партнёра (синтетика)', amount: 0 },
    { client: 'Тимур Х. (синтет.)', via: 'fraud_attempt', where: 'Сайт онлайн-игр · попытка привязать карту', amount: 15000 },
  ];
  let C = null; // контекст stage.js: {step, call, has, fdoc, setState, refresh, setMTab, toast, isMobile, next}

  const fresh = () => ({ phase: 'idle', leak: null, cpp: null, deal: null, seller: '', emOff: false, fake: null, busy: false });
  let M = fresh();

  const call = (k, p, a) => (C ? C.call(k, p, a || [], { quiet: true }) : undefined);
  const here = () => !!(C && C.isCurrent());
  function state(html, kind) { if (C) C.setState(html, kind || '', C.step); }
  function refresh() { if (C) C.refresh(); }

  // прокрутка внутри iframe: ближайший прокручиваемый предок элемента или окно iframe (страница сцены не двигается)
  function scrollIn(k, sel) {
    const d = C && C.fdoc(k);
    const el = d && d.querySelector(sel);
    if (!el) return false;
    let p = el.parentElement;
    const w = d.defaultView;
    while (p && p !== d.body && p !== d.documentElement) {
      const cs = w.getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) break;
      p = p.parentElement;
    }
    const scroller = p && p !== d.body && p !== d.documentElement ? p : null;
    try {
      if (scroller) {
        const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
        scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      } else {
        const top = el.getBoundingClientRect().top + (w.scrollY || 0) - 12;
        w.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    } catch (e) { /* ignore */ }
    return true;
  }
  function show(on) {
    ['client', 'bank'].forEach((k) => { call(k, 'LeakRadar.stageShow', [on]); call(k, 'SafeDeal.stageShow', [on]); });
  }
  function bankCpp() {
    const list = call('bank', 'LeakRadar.cpp') || [];
    return Array.isArray(list) ? list.find((a) => a && a.mid === MID) || null : null;
  }
  const statusLabel = (st) => { try { return st ? NX.iocs.label(st) : 'нет в стоп-листе'; } catch (e) { return String(st || ''); } };

  /* ---------- 7а: Leak Radar ---------- */
  async function runLeak() {
    if (M.busy || M.phase !== 'idle') return;
    M.busy = true; M.phase = 'leak';
    show(true);
    call('client', 'Stage.goto', ['leak']);
    call('bank', 'BankStage.go', ['overview']);
    call('client', 'LeakRadar.enable');
    const hit = call('client', 'LeakRadar.simulate', [{ mid: MID, via: 'other_merchant', amount: 34990, where: 'Неизвестный зарубежный интернет-магазин · оплата без присутствия карты', sim: 'client' }]);
    M.leak = hit && typeof hit === 'object' ? hit : null;
    if (!M.leak) {
      M.busy = false; M.phase = 'leakDone';
      state('Модуль «Карты для магазинов» в кабинете не загрузился (assets/js/leak-radar.js) — Space: безопасная сделка.', 'warn');
      refresh();
      return;
    }
    state('Номер •••• ' + esc(M.leak.last4Old) + ' знал только «' + esc(MNAME) + '», а им попытались оплатить в другом месте: попытка отклонена, карта заменена на •••• ' + esc(M.leak.last4New) + '. Банк: магазин «на проверке» — по одному сигналу не обвиняется. Дальше — сигналы ещё двух синтетических клиентов (симуляция)…', '');
    refresh();
    await sleep(1600);
    if (M.phase !== 'leak') { M.busy = false; return; } // сцену сбросили
    if (here()) setTimeout(() => scrollIn('bank', '#leakRadarMount'), 60);
    // маячки ещё двух синтетических клиентов у того же магазина — тем же NX.LeakRadar.simulate в панели банка
    let out = null;
    for (let i = 0; i < SIM2.length; i++) {
      if (M.phase !== 'leak') break;
      try { out = call('bank', 'LeakRadar.simulate', [Object.assign({ mid: MID, sim: 'bank' }, SIM2[i])]) || out; } catch (e) { console.error('[stage-more] beacon', e); }
      await sleep(CPP_GAP);
    }
    M.busy = false;
    if (M.phase !== 'leak') return; // сцену сбросили
    M.phase = 'leakDone';
    const a = bankCpp();
    M.cpp = a ? { clients: a.clients.length, cpp: !!a.cpp, status: a.iocStatus, window: a.windowDays } : (out ? { clients: 0, cpp: !!out.compromised, status: out.iocStatus, window: null } : null);
    if (M.cpp && M.cpp.cpp) state('Карты ' + esc(M.cpp.clients) + ' разных клиентов указывают на «' + esc(MNAME) + '»: вероятное место утечки, инцидент «Утечка у магазина». Клиенты 2–3 синтетические. Space — безопасная сделка.', 'ok');
    else state('Сигналы пришли, но трёх независимых клиентов в этом прогоне нет' + (M.cpp ? ' (' + esc(M.cpp.clients) + ' из 3)' : '') + '. Space — безопасная сделка.', 'warn');
    refresh();
  }

  /* ---------- 7б: Безопасная сделка ---------- */
  function phoneText() {
    const d = C && C.fdoc('client');
    const el = d && d.querySelector('#sdPhoneDeal');
    return el ? String(el.textContent || '') : '';
  }
  async function runDeal() {
    if (M.busy || M.phase !== 'leakDone') return;
    M.busy = true; M.phase = 'deal';
    show(true);
    // после шага 6 у клиентки включён «Заблокировать всё»: новые переводы на паузе — в демо его снимает доверенное лицо
    let em = false;
    try { em = !!call('client', 'Emergency.isActive'); } catch (e) { em = false; }
    if (em) { const r = call('client', 'Emergency.deactivate', ['demo_guardian', { toast: false }]); M.emOff = !!(r && r.ok); }
    call('client', 'closeModal');
    call('client', 'Stage.goto', ['transfer']);
    call('client', 'SafeDeal.setMode', ['deal']);
    if (C && C.isMobile()) C.setMTab('phone');
    const smp = (() => { const nx = C && C.fnx('client'); try { return nx && nx.SafeDeal && nx.SafeDeal.SAMPLES ? nx.SafeDeal.SAMPLES.honest : null; } catch (e) { return null; } })();
    const r = smp ? call('client', 'SafeDeal.reserve', [Object.assign({}, smp)]) : null;
    M.busy = false;
    if (!r || !r.ok || !r.deal) {
      M.phase = 'dealDone';
      state('Конверт не открылся' + (r && r.text ? ': ' + esc(r.text) : ' — модуль «Безопасная сделка» в кабинете недоступен') + '. Space — дальше.', 'warn');
      refresh();
      return;
    }
    M.deal = { code: r.deal.code, amount: r.deal.amount, item: r.deal.item, seller: r.deal.seller ? r.deal.seller.name : '' };
    call('client', 'toast', ['Деньги в конверте банка', NX.fmt(r.deal.amount) + ' · код сделки ' + r.deal.code + ' · симуляция', 'ok', 'lock']);
    await sleep(400);
    scrollIn('client', '.sd-phone-card');
    scrollIn('bank', '#sdBankMount');
    M.seller = /зарезервированы банком/i.test(phoneText()) ? 'reserved' : 'unknown';
    M.phase = 'dealDone';
    state((M.emOff ? 'Защиту сняла Айгерим (доверенное лицо, демо) — дальше обычный день. ' : '') +
      'Гульнара-апа покупает «' + esc(M.deal.item) + '» у частного лица: ' + esc(NX.fmt(M.deal.amount)) + ' ушли не продавцу, а в конверт банка, код ' + esc(M.deal.code) + '. ' +
      (M.seller === 'reserved' ? 'Телефон продавца (симуляция) показывает «Деньги зарезервированы банком» — забрать их можно только после вручения.' : 'Телефон продавца — справа в кабинете.') + ' Space — продавец присылает «ссылку доставки».', 'ok');
    refresh();
  }
  function runFake() {
    if (M.busy || M.phase !== 'dealDone') return;
    M.phase = 'fake';
    const a = call('client', 'SafeDeal.fill', ['fake']);
    M.fake = a && typeof a === 'object' ? { caught: !!a.linkRisk, domains: (a.urls || []).filter((u) => u.imp || u.score >= 25).map((u) => u.domain), fakePay: !!a.fakePay } : { caught: false, domains: [], fakePay: false };
    setTimeout(() => scrollIn('client', '#sdChecks'), 80);
    M.phase = 'done';
    if (M.fake.caught) state('Другой продавец прислал «оплату доставки» по ссылке ' + (M.fake.domains[0] ? '«' + esc(M.fake.domains[0]) + '»' : '') + ' с просьбой ввести данные карты. NEXUS ловит её до оплаты: сайт выдаёт себя за доставку и безопасную сделку, а настоящий конверт работает только в приложении банка. Space — финал.', 'ok');
    else state('Проверка ссылки в этой сборке не сработала — покажите её в кабинете вручную. Space — дальше.', 'warn');
    refresh();
  }

  /* ---------- API для stage.js ---------- */
  function primary() {
    if (M.busy) { if (C) C.toast('Шаг ещё идёт', 'Результат появится через пару секунд', 'info', 'clock'); return; }
    if (M.phase === 'idle') return runLeak();
    if (M.phase === 'leakDone') return runDeal();
    if (M.phase === 'dealDone') return runFake();
    if (C) C.next();
    return undefined;
  }
  function label() {
    if (M.phase === 'idle') return 'Карта: утечка у магазина';
    if (M.phase === 'leak' || M.busy) return 'Карты срабатывают…';
    if (M.phase === 'leakDone') return 'Безопасная сделка: в конверт';
    if (M.phase === 'dealDone') return 'Продавец прислал ссылку';
    return 'Дальше: финал';
  }
  function enter() {
    show(true);
    if (M.phase === 'idle') { call('client', 'Stage.goto', ['leak']); call('bank', 'BankStage.go', ['overview']); setTimeout(() => scrollIn('bank', '#leakRadarMount'), 300); }
  }
  function leave() {
    show(false);
    call('client', 'SafeDeal.setMode', ['normal']);
  }
  function resultHtml() {
    if (M.phase === 'idle') return '';
    const row = (ok, t, s) => '<li class="' + (ok ? 'ok' : '') + '">' + ic(ok ? 'check' : 'clock', 14) + '<span><b>' + esc(t) + '</b>' + (s ? '<br><span class="st-sub">' + esc(s) + '</span>' : '') + '</span></li>';
    const L = M.leak, P = M.cpp, D = M.deal, F = M.fake;
    let h = '<div class="title">' + ic('card', 18) + 'Не только звонки · симуляция</div><ul class="sm-list">';
    h += row(!!L, L ? 'Карта: утечка у «' + MNAME + '»' : 'Карта срабатывает…', L ? 'попытка ' + NX.fmt(L.amount || 0) + ' отклонена · •••• ' + L.last4Old + ' → •••• ' + L.last4New : '');
    if (M.phase !== 'leak') h += row(!!(P && P.cpp), P && P.cpp ? NX.countOf(P.clients, ['разный клиент', 'разных клиента', 'разных клиентов']) + ' → вероятное место утечки' : 'Трёх независимых клиентов нет', P ? 'магазин в стоп-листе: ' + statusLabel(P.status) : '');
    else h += row(false, 'Карты других клиентов…', 'симуляция в панели банка');
    if (D) h += row(true, 'Безопасная сделка: ' + NX.fmt(D.amount) + ' в конверте', M.seller === 'reserved' ? 'продавец видит «Деньги зарезервированы банком»' : '');
    if (F) h += row(F.caught, F.caught ? 'Фейковая «ссылка доставки» поймана до оплаты' : 'Ссылка не распознана', F.domains[0] || '');
    h += '</ul>';
    return h;
  }
  async function auto(alive) {
    await runLeak(); if (!alive()) return false;
    await sleep(5500); if (!alive()) return false;
    await runDeal(); if (!alive()) return false;
    await sleep(6000); if (!alive()) return false;
    runFake();
    await sleep(6500);
    return alive();
  }

  NX.StageMore = {
    init: (ctx) => { C = ctx; },
    reset: () => { M = fresh(); },
    ran: () => M.phase !== 'idle',
    busy: () => M.busy,
    primary, label, enter, leave, resultHtml, auto,
  };
})();
