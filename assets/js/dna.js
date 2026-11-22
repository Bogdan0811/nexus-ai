/* NEXUS AI — Transaction DNA (UNDERSTAND)
   Профиль обычных переводов клиента и оценка нового перевода относительно этого профиля и контекста
   (звонок, сигналы мошенничества, попытка ослабить защиту, Emergency Shield).
   Индекс 0–100 — не вероятность: факторы объединяются как noisy-OR (1 − Π(1 − pᵢ)), а за опасные
   сочетания добавляется бонус. Необычное ≠ запрещённое: у клиента всегда есть безопасный путь
   подтвердить свою операцию (контрольный вопрос, период охлаждения, доверенное лицо). */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});

  const TIERS = [
    { id: 'normal', from: 0, to: 29, label: 'Обычная операция', action: 'Перевод проходит как обычно' },
    { id: 'check', from: 30, to: 59, label: 'Дополнительная проверка', action: 'Нужно подтвердить перевод: ответить на контрольный вопрос' },
    { id: 'cooling', from: 60, to: 79, label: 'Период охлаждения', action: 'Перевод отправится после 60 секунд паузы и повторного подтверждения' },
    { id: 'hold', from: 80, to: 100, label: 'Удержание и проверка банком', action: 'Перевод удержан для проверки банком; подтвердить его может доверенное лицо или банк' },
  ];
  const tierOf = (i) => (i >= 80 ? TIERS[3] : i >= 60 ? TIERS[2] : i >= 30 ? TIERS[1] : TIERS[0]);
  const SAFE_PATH = 'Если перевод ваш и вы уверены: ответьте на контрольный вопрос, дождитесь окончания периода охлаждения или попросите доверенное лицо подтвердить операцию. Деньги никуда не пропадут.';

  const DAY = 86400000, HOUR = 3600000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nf = (() => { try { return new Intl.NumberFormat('ru-RU'); } catch (e) { return null; } })();
  const num = (n) => (nf ? nf.format(Math.round(Number(n) || 0)) : String(Math.round(Number(n) || 0))).replace(/[  ]/g, ' ');
  const money = (n) => (typeof NX.fmt === 'function' ? NX.fmt(n) : num(n) + ' ₸');
  const thousands = (n) => { const v = Number(n) || 0; return v >= 1e6 ? String(Math.round(v / 1e5) / 10).replace('.', ',') + ' млн' : v >= 1000 ? num(Math.round(v / 1000)) + ' тыс' : num(v); };
  const ratioText = (r) => (r >= 10 ? String(Math.round(r)) : String(Math.round(r * 10) / 10).replace('.', ','));
  const plural = (n, f) => (typeof NX.plural === 'function' ? NX.plural(n, f) : f[2]);
  // «в 12 раз», «в 3 раза», «в 2,5 раза»
  const times = (r) => { const s = ratioText(r); return 'в ' + s + ' ' + (s.indexOf(',') >= 0 ? 'раза' : plural(Number(s), ['раз', 'раза', 'раз'])); };
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const round100 = (v) => Math.round(v / 100) * 100;

  const DEFAULT_TYPICAL = { p25: 5000, median: 20000, p75: 50000 };

  /* ---------------- профиль ---------------- */
  function profile(stateArg) {
    const st = stateArg || NX.state || {};
    const all = Array.isArray(st.transactions) ? st.transactions : [];
    const now = Date.now();
    // исходящие переводы за последние 180 дней (удержанные и заблокированные не считаются «обычными»;
    // перевод, подтверждённый через охлаждение или удержание, тоже не становится нормой — иначе первый перевод мошенникам ослабит защиту для второго)
    const tx = all.filter((t) => t && t.type === 'transfer' && Number(t.amount) < 0 && t.status !== 'blocked' && t.status !== 'held' && t.dnaTier !== 'cooling' && t.dnaTier !== 'hold' && (!t.ts || now - t.ts < 180 * DAY));
    const amounts = tx.map((t) => -Number(t.amount)).sort((a, b) => a - b);
    const few = amounts.length < 3;
    const typical = few ? Object.assign({}, DEFAULT_TYPICAL) : { p25: round100(quantile(amounts, 0.25)), median: round100(quantile(amounts, 0.5)), p75: round100(quantile(amounts, 0.75)) };
    // получатели: id известного получателя, иначе имя
    const keyOf = (t) => String(t.recipient || t.recipientId || t.merchant || '').trim().toLowerCase();
    const chrono = tx.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const seen = {};
    let maxToNew = 0;
    const byRecipient = {};
    chrono.forEach((t) => {
      const k = keyOf(t); if (!k) return;
      const a = -Number(t.amount);
      if (!seen[k]) { seen[k] = 1; maxToNew = Math.max(maxToNew, a); }
      const r = byRecipient[k] || (byRecipient[k] = { count: 0, max: 0 });
      r.count++; r.max = Math.max(r.max, a);
    });
    const knownRecipients = Object.keys(seen).length;
    const hours = tx.filter((t) => t.ts).map((t) => new Date(t.ts).getHours()).sort((a, b) => a - b);
    const day = hours.filter((h) => h >= 8 && h < 22).length;
    const dayShare = hours.length ? Math.round((day / hours.length) * 100) / 100 : 1;
    let usualHours = [8, 22];
    if (hours.length >= 5) usualHours = [Math.max(0, Math.floor(quantile(hours, 0.1)) - 1), Math.min(24, Math.ceil(quantile(hours, 0.9)) + 1)];
    else if (hours.length) usualHours = [Math.min(8, hours[0]), Math.max(22, hours[hours.length - 1] + 1)];
    const when = dayShare >= 0.8 ? 'днём' : dayShare >= 0.5 ? 'чаще днём' : 'в разное время';
    const range = thousands(typical.p25) === thousands(typical.p75) ? 'около ' + thousands(typical.median) + ' ₸' : thousands(typical.p25).replace(' тыс', '') + '–' + thousands(typical.p75) + ' ₸';
    const summary = few
      ? 'мало истории переводов · применяются осторожные пороги'
      : 'обычно ' + range + ' · ' + knownRecipients + ' ' + plural(knownRecipients, ['знакомый получатель', 'знакомых получателя', 'знакомых получателей']) + ' · ' + when;
    return { txCount: amounts.length, typical, maxToNew: Math.round(maxToNew), knownRecipients, dayShare, usualHours, summary, byRecipient, range: few ? 'до ' + thousands(typical.p75) + ' ₸ по осторожному порогу' : range, fewHistory: few };
  }

  /* ---------------- оценка перевода ---------------- */
  const FLAG = {
    mule: { points: 80, label: 'Получатель в базе дропов банка', detail: 'Счёт уже связан с мошеннической схемой' },
    confirmed: { points: 80, label: 'Получатель в стоп-листе: подтверждён аналитиком', detail: 'Реквизит связан со схемой мошенников' },
    corroborated: { points: 80, label: 'Получатель в стоп-листе: подтверждён корреляцией', detail: 'Реквизит подтверждён корреляцией сигналов' },
    suspected: { points: 30, label: 'Получатель на проверке в стоп-листе', detail: 'Один источник — сам по себе перевод не удерживает' },
  };

  function assess(txIn, ctxIn) {
    const tx = txIn || {};
    const ctx = ctxIn || {};
    const prof = ctx.profile || profile(ctx.state);
    const amount = Math.max(0, Number(tx.amount) || 0);
    const ts = Number(tx.now) || Date.now();
    const hour = tx.hour != null && isFinite(Number(tx.hour)) ? Number(tx.hour) : new Date(ts).getHours();
    const isNew = !!tx.newRecipient;
    const factors = [];
    const add = (key, points, label, detail, extra) => factors.push(Object.assign({ key, points, label, detail }, extra || {}));
    const t = prof.typical;

    if (isNew) {
      add('new_recipient', 20, 'Новый получатель', 'Вы ещё не переводили ' + (tx.recipient ? '«' + String(tx.recipient).slice(0, 40) + '»' : 'этому получателю') +
        (prof.maxToNew ? '; самый крупный ваш перевод новому получателю — ' + money(prof.maxToNew) : ''));
    }
    // необычная сумма — по профилю: выше p75 более чем вдвое (и не мелочь)
    const ref = Math.max(t.median, 1);
    const ratio = amount / ref;
    // привычная сумма для этого получателя (аренда, помощь родным) или перевод по плану конституции — не аномалия
    const rk = !isNew && tx.recipientId ? String(tx.recipientId).toLowerCase() : '';
    const hist = rk && prof.byRecipient ? prof.byRecipient[rk] : null;
    const usualForRecipient = !!(hist && amount <= hist.max * 1.5);
    if (!usualForRecipient && !ctx.planned && amount >= 20000 && amount > Math.max(t.p75 * 2, t.median * 3)) {
      const pts = ratio >= 10 ? 45 : ratio >= 5 ? 35 : 25;
      add('amount', pts, 'Необычная для вас сумма', times(ratio).replace(/^в/, 'В') + ' больше вашего обычного перевода (' + (prof.range || money(t.median)) + ')', { ratio: Math.round(ratio * 10) / 10, median: t.median });
    }
    const [hFrom, hTo] = prof.usualHours;
    if (hour < hFrom || hour >= hTo) add('hour', 10, 'Нетипичное время', 'Перевод ' + (hour < 6 ? 'ночью' : hour < 11 ? 'утром' : hour < 18 ? 'днём' : 'вечером') + ' (около ' + hour + ' ч), а вы обычно переводите с ' + String(hFrom).padStart(2, '0') + ':00 до ' + String(hTo % 24).padStart(2, '0') + ':00');
    if (ctx.callActive) add('call', 30, 'Во время перевода идёт звонок', 'Мошенники диктуют действия по телефону — перевод во время разговора с незнакомым номером опасен');
    if (ctx.scamSignal) add('scam_signal', 30, 'Недавно был сигнал мошенничества', 'За последние 60 минут NEXUS распознал мошеннический звонок или сообщение');
    if (ctx.weakenAttempt) add('weaken', 25, 'Недавняя попытка ослабить защиту', 'За последние 60 минут кто-то пытался поднять лимит или отключить статью конституции');
    const flag = tx.recipientFlag && FLAG[tx.recipientFlag];
    if (flag) {
      // объяснение зависит от того, на чём держится статус: «несколько источников» нельзя писать, если это связь в графе
      let detail = flag.detail;
      if (tx.recipientFlag === 'corroborated') {
        if (tx.recipientFlagBasis === 'sources') detail = 'Реквизит пришёл из нескольких независимых источников';
        else if (tx.recipientFlagBasis === 'graph') detail = 'Реквизит связан со схемой по графу связей' + (tx.recipientFlagSynthetic ? ' (в демо история счетов синтетическая)' : '') + '; связь ≠ вина — нужна проверка аналитиком';
        else if (tx.recipientFlagBasis === 'mule') detail = 'Реквизит совпал с базой дропов банка';
      }
      add('flagged_recipient', flag.points, flag.label, detail, { flag: tx.recipientFlag });
    }
    const balance = Number(tx.balance) || 0;
    if (balance > 0 && amount > balance * 0.5 && amount >= 50000) add('balance_share', 15, 'Больше половины остатка', 'Перевод ' + Math.round((amount / balance) * 100) + '% средств на счёте — мошенники стремятся вывести всё сразу');
    if (ctx.emergency) add('emergency', isNew ? 50 : 20, 'Включено «Заблокировать всё»', isNew ? 'В защитном режиме переводы новым получателям удерживаются' : 'Защитный режим: переводы проходят только после подтверждения');

    // noisy-OR + бонус за сочетания
    const has = (k) => factors.some((f) => f.key === k);
    const pressure = has('call') || has('scam_signal');
    const anomaly = has('amount');
    let index = Math.round(100 * (1 - factors.reduce((p, f) => p * (1 - clamp(f.points, 0, 95) / 100), 1)));
    const combos = [];
    if (pressure && isNew && anomaly) { index += 15; combos.push({ key: 'combo_call_new_amount', points: 15, label: 'Сочетание: звонок + новый получатель + крупная сумма', detail: 'Так выглядит перевод под диктовку мошенника' }); }
    else if ((pressure || has('weaken')) && (isNew || anomaly)) { index += 8; combos.push({ key: 'combo_pressure', points: 8, label: 'Сочетание: давление + необычный перевод', detail: (pressure ? 'Сигнал звонка' : 'Попытка ослабить защиту') + ' совпадает с ' + (isNew ? 'новым получателем' : 'необычной суммой') }); }
    if (has('weaken') && pressure) { index += 5; combos.push({ key: 'combo_weaken_call', points: 5, label: 'Сочетание: звонок + попытка ослабить защиту', detail: 'Классический шаг: мошенник уговаривает поднять лимит' }); }
    combos.forEach((c) => factors.push(Object.assign({ combo: true }, c)));
    index = clamp(index, 0, 100);
    let tier = tierOf(index);
    // Emergency Shield: новые получатели — всегда удержание
    if (ctx.emergency && isNew && tier.id !== 'hold') { tier = TIERS[3]; }
    // ограничение сверху (например, реквизит только «на проверке»: без других причин — не удержание)
    let capped = false;
    const capIdx = TIERS.findIndex((x) => x.id === ctx.maxTier);
    if (capIdx >= 0 && !ctx.emergency && TIERS.indexOf(tier) > capIdx) { tier = TIERS[capIdx]; capped = true; }
    factors.sort((a, b) => (a.combo ? 1 : 0) - (b.combo ? 1 : 0) || b.points - a.points);
    let why = explain(factors, tier, prof, amount, ctx);
    if (capped) why += ' Реквизит пока только на проверке (один источник), поэтому без удержания.';
    return { factors, index, tier: tier.id, tierLabel: tier.label, action: tier.action, explain: why, safePath: tier.id === 'normal' ? '' : SAFE_PATH, capped, profile: prof };
  }

  // «Почему именно сейчас» — простыми словами
  function explain(factors, tier, prof, amount, ctx) {
    if (!factors.length) return 'Перевод похож на ваши обычные: ' + prof.summary + '.';
    const k = (key) => factors.find((f) => f.key === key);
    const parts = [];
    const am = k('amount');
    if (am) parts.push('сумма ' + money(amount) + ' ' + times(am.ratio) + ' больше ваших обычных переводов');
    if (k('new_recipient')) parts.push('получатель новый');
    const fl = k('flagged_recipient');
    if (fl) parts.push(fl.flag === 'suspected' ? 'реквизит на проверке в стоп-листе' : 'реквизит уже связан со схемой мошенников');
    if (k('call')) parts.push('во время перевода идёт звонок');
    if (k('scam_signal')) parts.push('за последний час был сигнал мошенничества');
    if (k('weaken')) parts.push('недавно пытались ослабить вашу защиту');
    if (k('hour')) parts.push('время нетипично для вас');
    if (k('balance_share')) parts.push('это больше половины остатка');
    if (k('emergency')) parts.push('включено «Заблокировать всё»');
    const s = parts.join(', ');
    const head = s.charAt(0).toUpperCase() + s.slice(1) + '.';
    const many = factors.filter((f) => !f.combo).length >= 3 || factors.some((f) => f.combo);
    return head + (many ? ' Такое сочетание почти не встречается в ваших операциях.' : '') + ' ' + tier.action + '.';
  }

  NX.DNA = {
    version: 1,
    TIERS: TIERS.map((x) => Object.assign({}, x)),
    SAFE_PATH,
    profile,
    assess(tx, ctx) {
      try { return assess(tx, ctx); } catch (e) {
        if (typeof console !== 'undefined') console.error(e);
        return { factors: [], index: 0, tier: 'normal', tierLabel: TIERS[0].label, action: TIERS[0].action, explain: 'Профиль операций недоступен — применяются обычные правила.', safePath: '', profile: null };
      }
    },
    tierOf(index) { const x = tierOf(Number(index) || 0); return Object.assign({}, x); },
  };
})();
