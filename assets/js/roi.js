/* =====================================================================
   NEXUS AI — ROI-калькулятор для сцены жюри (stage.html, шаг 6)
   window.NX.ROI = { FIELDS, DEFAULTS, compute(params), fmtMoney(n), mount(el, opts) }
   mount() → { set, get, result, addDemoCase(c) → true | 'dup' | false, reset(), setIocYield(y, note) }
   «Предотвращённые потери» — деньги клиентов, не выручка банка: окупаемость для банка не считается.
   Все входные значения — ДОПУЩЕНИЯ, которые двигает зритель. Цифры по РК
   (доля вишинга, средний ущерб) выведены из публикаций СМИ со ссылкой на
   ведомства (docs/QA.md → «Проблема в цифрах РК») и подписаны как оценка.
   Это не данные банка и не прогноз. Инновации в банкинге и кибербезопасность · концепт команды, не продукт банка-организатора.
   ===================================================================== */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});

  const nf = (typeof Intl !== 'undefined' && Intl.NumberFormat) ? new Intl.NumberFormat('ru-RU') : null;
  const num = (n) => (nf ? nf.format(Math.round(n)) : String(Math.round(n)));
  const esc = (s) => (NX.esc ? NX.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dec1 = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
  const plural = (n, f) => (NX.plural ? NX.plural(n, f) : f[2]);

  // Деньги крупно: «12,3 млрд ₸», «45,6 млн ₸», «380 000 ₸»
  function fmtMoney(n) {
    const v = Number(n) || 0;
    const a = Math.abs(v), sign = v < 0 ? '−' : '';
    if (a >= 1e9) return sign + dec1(a / 1e9) + ' млрд ₸';
    if (a >= 1e6) return sign + dec1(a / 1e6) + ' млн ₸';
    return sign + num(a) + ' ₸';
  }

  // kind: 'int' — целое, 'pct' — проценты, 'money' — тенге
  const FIELDS = [
    { key: 'clients', label: 'Клиентов 60+ под защитой', kind: 'int', min: 10000, max: 3000000, step: 10000, def: 1000000, main: true,
      note: 'масштаб для обсуждения; пилот — 10 000 клиентов с согласием' },
    { key: 'victimRate', label: 'Теряют деньги из-за мошенников за год', kind: 'pct', min: 0.1, max: 3, step: 0.1, def: 0.6,
      note: 'оценка команды: 26,3 тыс. дел ÷ 20,7% обратившихся ÷ ~20 млн жителей ≈ 0,6%' },
    { key: 'vishShare', label: 'Доля вишинга и звонков «из банка»', kind: 'pct', min: 5, max: 60, step: 0.5, def: 23.5,
      note: 'публикация: 23,5% случаев — КПСиСУ ГП РК через Informburo.kz' },
    { key: 'avgLoss', label: 'Средний ущерб на случай', kind: 'money', min: 50000, max: 2000000, step: 5000, def: 425000,
      note: 'оценка команды: 11,2 млрд ₸ ÷ 26,3 тыс. дел ≈ 426 тыс. ₸ (янв–ноя 2025, через СМИ)' },
    { key: 'lossConv', label: 'Конверсия звонка мошенника в потерю', kind: 'pct', min: 1, max: 30, step: 1, def: 5,
      note: 'допущение команды: сколько звонков заканчиваются переводом' },
    { key: 'intercept', label: 'Доля перехвата NEXUS', kind: 'pct', min: 1, max: 40, step: 1, def: 30,
      note: 'допущение команды, не замер; проверяется пилотом' },
    { key: 'llmCost', label: 'Стоимость LLM-сессии ловушки', kind: 'money', min: 0, max: 1000, step: 10, def: 120,
      note: 'допущение команды; в продукте — LLM в контуре банка' },
    { key: 'sdkCost', label: 'SDK на клиента в месяц', kind: 'money', min: 0, max: 100, step: 1, def: 5,
      note: 'допущение команды: SDK, конституция и Защита звонка на устройстве' },
    { key: 'fixedCost', label: 'Внедрение и сопровождение в год', kind: 'money', min: 0, max: 500000000, step: 5000000, def: 60000000,
      note: 'допущение команды: команда, инфраструктура, номер-ловушка' },
  ];
  const DEFAULTS = {};
  FIELDS.forEach((f) => { DEFAULTS[f.key] = f.def; });

  // Чистая функция расчёта. Все проценты — в процентах (23.5 = 23,5%).
  function compute(input) {
    const p = Object.assign({}, DEFAULTS, input || {});
    const clients = Math.max(0, Number(p.clients) || 0);
    const victims = clients * (Number(p.victimRate) || 0) / 100;          // клиентов теряют деньги за год
    const vishVictims = victims * (Number(p.vishShare) || 0) / 100;       // из них — через звонок
    const conv = Math.max(0.01, Number(p.lossConv) || 0) / 100;
    const scamCalls = vishVictims / conv;                                 // звонков мошенников этим клиентам
    const intercept = (Number(p.intercept) || 0) / 100;
    const prevented = vishVictims * intercept * (Number(p.avgLoss) || 0); // ₸/год не ушли мошенникам
    const caught = vishVictims * intercept;                               // случаев перехвачено
    const sessions = scamCalls * intercept;                               // перехваченных звонков → номер-ловушка
    const llmCost = sessions * (Number(p.llmCost) || 0);
    const sdkCost = clients * (Number(p.sdkCost) || 0) * 12;
    const fixedCost = Math.max(0, Number(p.fixedCost) || 0);
    const costs = llmCost + sdkCost + fixedCost;
    const net = prevented - costs;
    const roi = costs > 0 ? prevented / costs : null;
    const monthlyNet = (prevented - llmCost - sdkCost) / 12;
    let paybackMonths = null;
    if (monthlyNet > 0) paybackMonths = fixedCost > 0 ? fixedCost / monthlyNet : 0;
    const iocYield = Math.max(0, Number(p.iocYield) || 1);                // реквизитов на сессию ловушки
    const iocPerWeek = (sessions * iocYield) / 52;
    // затраты банка на один перехваченный случай (prevented — деньги клиентов, не выручка банка)
    const costPerCase = caught > 0 ? costs / caught : null;
    // net и paybackMonths оставлены для совместимости API: в UI net — «сбережено клиентам сверх затрат», paybackMonths не показывается
    return { params: p, clients, victims, vishVictims, scamCalls, caught, prevented, sessions, llmCost, sdkCost, fixedCost, costs, net, roi, paybackMonths, costPerCase, iocPerWeek, iocYield };
  }

  function fmtField(f, v) {
    if (f.kind === 'pct') return dec1(v) + '%';
    if (f.kind === 'money') return f.key === 'fixedCost' ? fmtMoney(v) : num(v) + ' ₸';
    return num(v);
  }
  const fid = (uid, k) => 'roi_' + uid + '_' + k;

  /* -------- UI: mount(el, {getDemoCase, onChange, toast, iocYield, iocYieldNote}) -------- */
  let seq = 0;
  function mount(el, opts) {
    if (!el) return null;
    const o = opts || {};
    const uid = ++seq;
    const vals = Object.assign({}, DEFAULTS, o.values || {});
    const cases = [];
    if (o.iocYield) vals.iocYield = o.iocYield;

    const field = (f) => '<div class="roi-field' + (f.main ? ' main' : '') + '">' +
      '<div class="roi-fh"><label for="' + fid(uid, f.key) + '">' + esc(f.label) + '</label><output id="' + fid(uid, f.key) + '_v">' + esc(fmtField(f, vals[f.key])) + '</output></div>' +
      '<input type="range" id="' + fid(uid, f.key) + '" data-roi="' + f.key + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + vals[f.key] + '">' +
      '<div class="roi-note">' + esc(f.note) + '</div></div>';

    el.innerHTML = '<div class="roi">' +
      '<div class="roi-inputs">' +
        '<div class="roi-presets"><span class="roi-cap">Масштаб</span>' +
          '<button type="button" class="btn sm" data-roi-preset="10000">Пилот · 10 тыс.</button>' +
          '<button type="button" class="btn sm" data-roi-preset="100000">100 тыс.</button>' +
          '<button type="button" class="btn sm" data-roi-preset="1000000">1 млн</button>' +
          '<button type="button" class="btn sm ghost" data-roi-reset>Сбросить допущения</button></div>' +
        '<div class="roi-assume">Все ползунки — допущения и оценки команды для обсуждения, не данные банка и не прогноз. Двигайте их — расчёт пересчитывается сразу.</div>' +
        FIELDS.map(field).join('') +
      '</div>' +
      '<div class="roi-out" aria-live="polite">' +
        '<div class="roi-big"><div class="roi-cap">Предотвращённые потери клиентов</div><div class="roi-val ok" id="' + fid(uid, 'prev') + '">—</div><div class="roi-sub" id="' + fid(uid, 'prevSub') + '"></div></div>' +
        '<div class="roi-grid">' +
          '<div><div class="roi-cap">Затраты в год</div><div class="roi-num" id="' + fid(uid, 'cost') + '">—</div><div class="roi-sub" id="' + fid(uid, 'costSub') + '"></div></div>' +
          '<div><div class="roi-cap">Сбережено клиентам сверх затрат</div><div class="roi-num" id="' + fid(uid, 'net') + '">—</div><div class="roi-sub" id="' + fid(uid, 'roiX') + '"></div></div>' +
          '<div><div class="roi-cap">Затраты на 1 перехваченный случай</div><div class="roi-num" id="' + fid(uid, 'pay') + '">—</div><div class="roi-sub" id="' + fid(uid, 'paySub') + '"></div></div>' +
          '<div><div class="roi-cap">IOC до первой жертвы</div><div class="roi-num" id="' + fid(uid, 'ioc') + '">—</div><div class="roi-sub" id="' + fid(uid, 'iocSub') + '"></div></div>' +
        '</div>' +
        '<div class="roi-case"><button type="button" class="btn sm primary" data-roi-case>Добавить кейс из демо</button><div class="roi-cases" id="' + fid(uid, 'cases') + '"></div></div>' +
        '<p class="roi-foot">Формула: клиенты × доля потерпевших × доля вишинга × доля перехвата × средний ущерб. Эффект — деньги клиентов, которые не ушли мошенникам; это не выручка банка, и окупаемость для банка здесь не считается (меньше компенсаций, обращений и репутационных потерь — в расчёт не входят). Все ползунки — допущения для обсуждения, не данные банка и не прогноз; цифры РК — по публикациям СМИ со ссылкой на ведомства.</p>' +
      '</div></div>';

    const $id = (k) => el.querySelector('#' + fid(uid, k));
    const setText = (k, t) => { const n = $id(k); if (n) n.textContent = t; };

    function render() {
      const r = compute(vals);
      setText('prev', fmtMoney(r.prevented) + ' / год');
      setText('prevSub', 'перехвачено ≈ ' + num(r.caught) + ' ' + plural(Math.round(r.caught), ['случай', 'случая', 'случаев']) + ' из ' + num(r.vishVictims) + ' через звонок');
      setText('cost', fmtMoney(r.costs));
      setText('costSub', 'SDK ' + fmtMoney(r.sdkCost) + ' · LLM ' + fmtMoney(r.llmCost) + ' · внедрение ' + fmtMoney(r.fixedCost));
      const netEl = $id('net');
      if (netEl) { netEl.textContent = (r.net > 0 ? '+' : '') + fmtMoney(r.net); netEl.className = 'roi-num ' + (r.net >= 0 ? 'ok' : 'bad'); }
      setText('roiX', (r.roi == null ? 'затраты не заданы' : 'на 1 ₸ затрат банка — ' + dec1(r.roi) + ' ₸ предотвращённых потерь клиентов') + '; не доход банка');
      setText('pay', r.costPerCase == null ? '—' : fmtMoney(r.costPerCase));
      setText('paySub', r.costPerCase == null ? 'нет перехваченных случаев' : 'затраты в год ÷ перехваченные случаи; средний ущерб на случай — ' + fmtMoney(vals.avgLoss));
      setText('ioc', '≈ ' + num(r.iocPerWeek) + ' / нед');
      setText('iocSub', num(r.sessions) + ' ' + plural(Math.round(r.sessions), ['сессия', 'сессии', 'сессий']) + ' ловушки в год · ' + dec1(r.iocYield) + ' IOC на сессию' + (o.iocYieldNote ? ' (' + o.iocYieldNote + ')' : ' (допущение)'));
      FIELDS.forEach((f) => { const out = $id(f.key + '_v'); if (out) out.textContent = fmtField(f, vals[f.key]); });
      if (typeof o.onChange === 'function') { try { o.onChange(r); } catch (e) { /* ignore */ } }
      return r;
    }
    function setVal(key, v, fromInput) {
      const f = FIELDS.find((x) => x.key === key);
      if (!f) { vals[key] = v; return render(); }
      const val = clamp(Number(v) || 0, f.min, f.max);
      vals[key] = val;
      if (!fromInput) { const inp = $id(key); if (inp) inp.value = String(val); }
      return render();
    }
    function renderCases() {
      const box = $id('cases');
      if (!box) return;
      box.innerHTML = cases.length ? cases.map((c) => '<span class="roi-chip">' + esc(c.client || 'Кейс из демо') + ' · ' + esc(fmtMoney(c.amount)) + (c.held ? ' удержано' : '') + '</span>').join('') +
        '<div class="roi-sub">' + (cases.length > 1 ? 'Средний ущерб в расчёте заменён средним по ' + cases.length + ' кейсам со сцены.' : 'Средний ущерб в расчёте заменён суммой кейса со сцены.') + '</div>' : '';
    }
    // исходное значение допущения: из настроек монтирования, иначе по умолчанию
    const initVal = (f) => (o.values && o.values[f.key] != null ? clamp(Number(o.values[f.key]) || 0, f.min, f.max) : f.def);
    // true — добавлен; 'dup' — этот же перевод уже в расчёте (по id кейса, иначе по клиенту и сумме); false — нет кейса
    function addDemoCase(c) {
      if (!c || !(Number(c.amount) > 0)) return false;
      const amount = Number(c.amount), client = c.client || '';
      const dup = cases.some((x) => (c.id != null && x.id != null) ? x.id === c.id : (x.client === client && x.amount === amount));
      if (dup) return 'dup';
      cases.push({ id: c.id != null ? c.id : null, amount, client, held: c.held !== false });
      // средний ущерб — среднее по всем кейсам со сцены, а не сумма последнего
      const avg = cases.reduce((s, x) => s + x.amount, 0) / cases.length;
      setVal('avgLoss', Math.round(avg / 5000) * 5000);
      renderCases();
      return true;
    }
    // сброс к исходному состоянию (R на сцене): допущения по умолчанию, без кейсов и без IOC/сессию из демо
    const initYield = o.iocYield, initYieldNote = o.iocYieldNote;
    function reset() {
      cases.length = 0;
      FIELDS.forEach((f) => {
        vals[f.key] = initVal(f);
        const inp = $id(f.key); if (inp) inp.value = String(vals[f.key]);
      });
      if (initYield) vals.iocYield = initYield; else delete vals.iocYield;
      o.iocYieldNote = initYieldNote;
      renderCases();
      return render();
    }

    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-roi')) setVal(t.getAttribute('data-roi'), t.value, true);
    });
    el.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!t || !el.contains(t)) return;
      if (t.hasAttribute('data-roi-preset')) { setVal('clients', Number(t.getAttribute('data-roi-preset'))); return; }
      if (t.hasAttribute('data-roi-reset')) {
        // допущения к исходным и кейсы со сцены из расчёта: иначе плашка «заменён суммой кейса» врёт, а повторное добавление даёт «dup»
        // (IOC/сессию из демо — замер, не допущение: оставляем)
        cases.length = 0;
        FIELDS.forEach((f) => { vals[f.key] = initVal(f); const inp = $id(f.key); if (inp) inp.value = String(vals[f.key]); });
        renderCases();
        render();
        return;
      }
      if (t.hasAttribute('data-roi-case')) {
        const c = typeof o.getDemoCase === 'function' ? o.getDemoCase() : null;
        const added = addDemoCase(c);
        const say = (title, msg) => { if (typeof o.toast === 'function') o.toast(title, msg); else if (NX.toast) NX.toast(title, msg, 'info'); };
        if (added === 'dup') say('Кейс уже в расчёте', 'Один перевод учитывается один раз');
        else if (!added) say('Кейса из демо пока нет', 'Сначала пройдите шаг 4: перевод второго клиента на реквизит из ловушки');
      }
    });
    render();
    return {
      el,
      set: setVal,
      get: () => Object.assign({}, vals),
      result: () => compute(vals),
      addDemoCase,
      reset,
      setIocYield(y, note) { if (Number(y) > 0) { vals.iocYield = Number(y); o.iocYieldNote = note || o.iocYieldNote; render(); } },
    };
  }

  NX.ROI = { FIELDS, DEFAULTS, compute, fmtMoney, mount };
})();
