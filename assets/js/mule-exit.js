/* =====================================================================
   NEXUS AI — «Не стань дропом» (NX.MuleExit), spec v4 · 1A
   Если счёт клиента превращают в транзит для чужих денег, NEXUS не блокирует молча,
   а ставит перевод «дальше» на паузу и показывает безопасный выход из схемы.

   Клиент (client.html):
   - вход A: «Демо: мне предложили подработку» (панель жюри ?demo=1) и Помощь → карточка
     «Мне предлагают подработку с картой»; вход B: «Платежи → Проверить» с текстом вербовки
     (scanHook → карточка «Это вербовка дропов»)
   - 6 входящих переводов от незнакомых людей (600 мс между ними), сообщение куратора,
     попытка переслать 306 000 ₸ → transitScore ≥ 70 → пауза и лист #view-mule
   - «Выйти из схемы безопасно»: ① перевод отменён ② деньги возвращены отправителям тем же путём
     ③ банк получил сообщение (+ по желанию — запрос близкому из «Правила → Близкие»)
   - «Это ошибка — я знаю этих людей»: запрос в банк, пауза остаётся до ответа банка
   Банк (bank.html): инцидент kind 'mule_exit', узлы графа (6 отправителей → вербуемый → куратор),
   плитка «Не стань дропом» на «Сейчас» (bank.js).
   Шина (всегда synthetic:true): mule_exit_alert, mule_exit_resolved, mule_exit_dispute; ответ банка — mule_exit_bank.
   Стоп-лист: только реквизит куратора (NX.iocs.add, источник «Не стань дропом»). Отправители — пострадавшие,
   в стоп-лист не попадают. Куратор — второй счёт синтетической базы дропов (NX.MULE_ACCOUNTS[1], как m2 в graph.js),
   поэтому статус «подтверждён корреляцией» даёт уже существующий сигнал «База дропов банка».
   Хранилище: nexus_ai_muleexit_v1 (сброс демо его очищает). Все переводы и люди синтетические.
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  if (!NX || !NX.bus) return;

  const esc = (v) => NX.esc(v);
  const ic = (n, s) => (NX.icon ? NX.icon(n, '', s || 16) : '');
  const $ = (s, r) => (r || document).querySelector(s);
  const PAGE = () => NX.page || '';
  const KEY = 'nexus_ai_muleexit_v1';
  if (NX.KEYS) NX.KEYS.muleexit = KEY;
  const MIN = 60000;
  const SRC = 'Не стань дропом';
  const STEP_MS = 600; // пауза между входящими переводами в демо
  if (NX.ui && typeof NX.ui.markReady === 'function') NX.ui.markReady('mule_exit');
  const HONEST = (() => { const f = NX.ui && NX.ui.FEATURES ? NX.ui.FEATURES.find((x) => x.id === 'mule_exit') : null; return (f && f.label) || 'Транзакции и отправители синтетические, пороги подобраны вручную, не обучены на реальных данных. Решение о блокировке принимает банк. Текст о законе — справочный.'; })();

  /* ---------------- сценарий (фиксированный, синтетика) ---------------- */
  const SENDERS = [['Айгерим С.', 48000], ['Нурлан Б.', 62500], ['Данияр К.', 35000], ['Мадина Т.', 71000], ['Ержан Ж.', 54000], ['Салтанат М.', 69500]];
  const TOTAL = SENDERS.reduce((a, s) => a + s[1], 0); // 340 000 ₸
  const SHARE = 0.9;
  const ONWARD = Math.round(TOTAL * SHARE); // 306 000 ₸
  const SPAN_MIN = 40; // переводы «пришли» за 40 минут (в демо время ускорено)
  // куратор — известный дроп из синтетической базы (NX.MULE_ACCOUNTS[1] = graph.js m2)
  const CURATOR = (() => {
    const m = NX.MULE_ACCOUNTS && NX.MULE_ACCOUNTS[1];
    const raw = m ? m.account : '+7 708 555 12 90';
    let p = null; try { p = NX.parseAccount(raw); } catch (e) { p = null; }
    return { kind: p ? p.kind : 'phone', value: p ? p.value : '+77085551290', raw };
  })();
  // = sms-corpus.js, схема mule_recruit, h07
  const RECRUIT_TEXT = (() => {
    try { const c = window.NX_CORPUS; const it = c && (c.train || []).concat(c.holdout || []).find((x) => x.id === 'h07'); if (it) return it.t; } catch (e) { /* ignore */ }
    return 'Подработка для студентов: нужна ваша карта на неделю, будем принимать на неё переводы, вам 10% от суммы. Пишите в телеграм.';
  })();
  const FOLLOW_UP = 'Перекинь 90% на карту куратора по номеру ' + CURATOR.raw + ', 10% твои. Только быстро, в течение 10 минут.';

  /* ---------------- распознавание вербовки (только для этой функции; NX.scanText не меняется) ---------------- */
  // \b и \w в JS без флага u знают только ASCII: границы слов для кириллицы — через lookaround.
  // flow — только пересылка чужих денег дальше (не «переводы доступны», не «премия 10%»)
  const RX = {
    job: /(подработ|заработ|вакан|работ[ауы]?(?![а-яё])|жұмыс|podrabot)/i,
    acc: /(карт[уаыо]|сч[её]т|реквизит|karta|карточк)/i,
    flow: /(принима[а-яё]*[^.!?\n]{0,25}перевод|перекин|пересыла|пересылк|перевод[а-яё]*\s+дальше|перевед[а-яё]*\s+(дальше|куратор)|обнал|скинуть\s+дальше|\d+\s*%\s*(от\s+)?(суммы|перевод|оборот)|процент[а-яё]*\s+(от|с)\s+(суммы|перевод|оборот))/i,
    drop: /(^|[^а-яёa-z0-9_])дроп/i,
    pay: /(\d+\s*%|процент)/i,
    chat: /(телеграм|telegram|ватсап|whatsapp|t\.me)/i,
  };
  function isRecruit(text) {
    const t = String(text || '');
    if (!t.trim()) return false;
    if (RX.drop.test(t) && RX.acc.test(t)) return true;
    return RX.job.test(t) && RX.acc.test(t) && RX.flow.test(t);
  }
  function recruitReasons(text) {
    const t = String(text || '');
    const out = [];
    if (RX.acc.test(t)) out.push('Просят вашу карту или счёт, чтобы принимать на них переводы');
    if (RX.pay.test(t)) out.push('Обещают процент от чужих денег за пересылку');
    if (RX.chat.test(t)) out.push('Зовут в мессенджер, где сложнее проверить, кто пишет');
    if (out.length < 3 && RX.flow.test(t)) out.push('Просят пересылать поступившие деньги дальше');
    return out.slice(0, 3);
  }

  /* ---------------- оценка транзита: 0–100, клиенту — одно слово ---------------- */
  const LEVELS = [[70, 'high', 'похоже на схему дропа'], [40, 'mid', 'подозрительно'], [0, 'low', 'низкий']];
  const levelOf = (score) => { const l = LEVELS.find((x) => score >= x[0]) || LEVELS[2]; return { level: l[1], word: l[2] }; };
  function accountAgeDays() {
    try {
      const tx = (NX.state && NX.state.transactions) || [];
      const first = tx.reduce((m, t) => (t && t.ts && t.ts < m ? t.ts : m), Date.now());
      return Math.floor((Date.now() - first) / 86400000);
    } catch (e) { return 999; }
  }
  // state: { incoming:[{from, amount, ts}], attempt:{amount, ts, recipientNew, own}, message, profile:{ageDays, student} }
  function transitScore(state) {
    const s = state || {};
    const now = (s.attempt && s.attempt.ts) || Date.now();
    const inc = (s.incoming || []).filter((x) => x && now - (Number(x.ts) || now) <= 24 * 60 * MIN);
    const senders = new Set(inc.map((x) => x.from)).size;
    const inSum = inc.reduce((a, x) => a + (Number(x.amount) || 0), 0);
    const last = inc.reduce((m, x) => Math.max(m, Number(x.ts) || 0), 0);
    const a = s.attempt || null;
    const prof = s.profile || {};
    const factors = [
      { key: 'senders', w: 30, on: senders >= 5, t: 'Не меньше 5 разных незнакомых отправителей за 24 часа', d: 'сейчас: ' + senders },
      { key: 'onward', w: 30, on: !!(a && inSum > 0 && a.amount >= 0.8 * inSum && (!last || now - last <= 10 * MIN)), t: 'Попытка отправить дальше 80% и больше поступивших денег в течение 10 минут', d: a && inSum ? Math.round((a.amount / inSum) * 100) + '% от ' + NX.fmt(inSum) : 'перевода дальше нет' },
      { key: 'new_rcpt', w: 15, on: !!(a && a.recipientNew && !a.own), t: 'Получатель новый и это не ваш собственный счёт', d: a ? (a.recipientNew ? 'новый получатель' : 'знакомый получатель') : '—' },
      { key: 'message', w: 20, on: isRecruit(s.message), t: 'Сообщение похоже на вербовку дропов', d: s.message ? 'есть сообщение с предложением' : 'сообщения нет' },
      { key: 'young', w: 5, on: (prof.ageDays != null && prof.ageDays !== '' && Number(prof.ageDays) >= 0 && Number(prof.ageDays) < 90) || !!prof.student, t: 'Счёт моложе 90 дней или профиль «студент»', d: 'возраст счёта: ' + (prof.ageDays != null ? prof.ageDays + ' дн.' : '—') + (prof.student ? ', студент' : '') },
    ];
    const score = Math.min(100, factors.reduce((x, f) => x + (f.on ? f.w : 0), 0));
    const lv = levelOf(score);
    return { score, level: lv.level, word: lv.word, factors };
  }

  /* ---------------- хранилище ---------------- */
  const resetting = () => !!(NX.isResetting && NX.isResetting());
  const blank = () => ({ v: 1, cases: [] });
  const pending = new Map(); // кейсы из шины, ещё не видные в localStorage этой вкладки
  function load() {
    let s = null;
    try { s = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || s.v !== 1 || !Array.isArray(s.cases)) s = blank();
    s.cases = s.cases.filter((c) => c && c.id);
    pending.forEach((c, id) => {
      const i = s.cases.findIndex((x) => x.id === id);
      if (i < 0) s.cases.unshift(c);
      else if ((Number(s.cases[i].upd) || 0) < (Number(c.upd) || 0)) s.cases[i] = c;
      else pending.delete(id);
    });
    return s;
  }
  function save(s) {
    if (resetting()) return false;
    try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, cases: s.cases.slice(0, 20) })); return true; } catch (e) { return false; }
  }
  function mutate(id, fn) {
    const s = load();
    const c = s.cases.find((x) => x.id === id);
    if (!c) return null;
    if (fn(c, s) === false) return null;
    c.upd = Date.now();
    save(s);
    pending.delete(id);
    return c;
  }
  const byId = (id) => load().cases.find((c) => c.id === id) || null;
  const me = () => { try { return (NX.state && NX.state.user && NX.state.user.name) || 'Клиент'; } catch (e) { return 'Клиент'; } };
  const OPEN_ST = ['incoming', 'message', 'paused', 'dispute', 'exiting'];
  const mine = () => load().cases.filter((c) => c.client === me());
  const activeCase = () => mine().find((c) => OPEN_ST.indexOf(c.status) >= 0) || null;
  const latestCase = () => mine()[0] || null;
  const hist = (c, t) => { c.history = (c.history || []).concat([{ ts: Date.now(), t: String(t) }]).slice(-30); };
  const pub = (c) => ({ from: c.from, amount: c.amount, ts: c.ts });
  const brief = (c) => JSON.parse(JSON.stringify(c));
  function emit(type, c, extra) {
    NX.bus.emit(type, Object.assign({ caseId: c.id, client: c.client, synthetic: true, case: brief(c) }, extra || {}));
  }

  /* ---------------- клиент: сценарий ---------------- */
  let timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); if (resetting()) return; try { fn(); } catch (e) { console.error('[mule-exit]', e); } }, ms); timers.push(t); return t; };
  const S = () => NX.state;
  function refreshClient() { try { if (NX.ClientUI && NX.ClientUI.refresh) NX.ClientUI.refresh(); } catch (e) { console.error(e); } }

  // вход A / B: запустить сценарий (или вернуться к уже идущему)
  function start(source) {
    if (PAGE() !== 'client') return null;
    const cur = activeCase();
    if (cur) {
      if (cur.status === 'paused' || cur.status === 'dispute' || cur.status === 'exiting') openSheet(cur.id);
      else NX.toast('Сценарий уже идёт', 'Переводы поступают на ваш счёт · демо', 'info', 'clock');
      return cur;
    }
    const now = Date.now();
    const c = {
      id: 'mx' + now.toString(36).slice(-6), client: me(), ts: now, upd: now, status: 'incoming', source: source || 'demo',
      incoming: [], message: null, attempt: null, score: null, level: null, word: null, factors: [],
      steps: { cancel: false, return: false, report: false, guardian: false }, history: [],
    };
    hist(c, 'Начало сценария: ' + (source === 'scan' ? 'проверка сообщения о подработке' : 'предложение подработки'));
    const s = load(); s.cases.unshift(c); save(s);
    try { if (NX.go) NX.go('overview'); } catch (e) { /* ignore */ }
    NX.toast('Демо: вам предложили подработку', 'Сейчас на карту начнут приходить переводы от незнакомых людей', 'info', 'users');
    schedule(c);
    return c;
  }
  // шаги сценария: недошедшие входящие переводы → сообщение куратора → попытка переслать дальше
  function schedule(c) {
    let t = 500;
    SENDERS.forEach((sd, k) => { if (c.incoming.some((x) => x.k === k)) return; later(() => addIncoming(c.id, k), t); t += STEP_MS; });
    if (!c.message) { later(() => addMessage(c.id), t + 500); t += 500; }
    later(() => attempt(c.id, { amount: ONWARD, account: CURATOR.raw, recipientNew: true, own: false, auto: true }), t + 1600);
  }
  function resume(c) { schedule(c); }
  function addIncoming(id, k) {
    const sd = SENDERS[k];
    const now = Date.now();
    // время в демо ускорено: 6 переводов «за 40 минут», последний — сейчас
    const ts = now - Math.round((SPAN_MIN * (SENDERS.length - 1 - k)) / (SENDERS.length - 1)) * MIN;
    const txId = NX.uid('tx');
    const c = mutate(id, (c) => {
      if (['incoming', 'message', 'paused'].indexOf(c.status) < 0) return false; // кейс уже закрыт или выходим
      if (c.incoming.some((x) => x.k === k)) return false;
      c.incoming.push({ k, from: sd[0], amount: sd[1], ts, txId, returned: false });
      hist(c, 'Входящий перевод ' + NX.fmt(sd[1]) + ' от ' + sd[0]);
    });
    if (!c) return;
    const st = S();
    st.user.balance += sd[1];
    st.transactions.unshift({ id: txId, ts, category: 'Переводы', merchant: sd[0] + ' · демо', amount: sd[1], type: 'transfer_in', mx: id });
    NX.save();
    refreshClient();
  }
  function addMessage(id) {
    const c = mutate(id, (c) => { if (c.message || ['incoming', 'message', 'paused'].indexOf(c.status) < 0) return false; c.message = { text: RECRUIT_TEXT, follow: FOLLOW_UP, ts: Date.now() }; if (c.status === 'incoming') c.status = 'message'; hist(c, 'Сообщение «куратора»: перекинуть 90% дальше'); });
    if (!c) return;
    NX.toast('Новое сообщение', FOLLOW_UP, 'warn', 'chat');
    refreshClient();
  }
  // попытка переслать деньги дальше → оценка транзита → пауза и лист
  function attempt(id, o) {
    const c0 = byId(id);
    if (!c0 || ['incoming', 'message', 'dispute', 'paused'].indexOf(c0.status) < 0) return null;
    const a = { amount: Math.round(Number(o.amount) || 0), account: String(o.account || ''), ts: Date.now(), recipientNew: o.recipientNew !== false, own: !!o.own };
    const r = transitScore({ incoming: c0.incoming, attempt: a, message: c0.message ? c0.message.text + ' ' + c0.message.follow : '', profile: { ageDays: accountAgeDays(), student: false } });
    if (o.auto) NX.toast('Демо: вы соглашаетесь', 'И пробуете перевести ' + NX.fmt(a.amount) + ' куратору', 'info', 'send');
    if (r.score < 70) return { paused: false, score: r.score, word: r.word };
    const c = mutate(id, (c) => {
      c.attempt = a; c.score = r.score; c.level = r.level; c.word = r.word; c.factors = r.factors;
      if (c.status !== 'dispute') c.status = 'paused';
      hist(c, 'Попытка перевести ' + NX.fmt(a.amount) + ' куратору — перевод на паузе, деньги не ушли');
    });
    if (!c) return null;
    emit('mule_exit_alert', c, { score: c.score, level: c.level, incoming: c.incoming.map(pub), curator: { kind: CURATOR.kind, value: CURATOR.value, raw: CURATOR.raw } });
    openSheet(id);
    refreshClient();
    return { paused: true, score: r.score, word: r.word, caseId: id };
  }
  // перевод из «Платежи → Перевод» во время сценария: client.js submitTransfer → true = перевод на паузе
  function interceptTransfer(inp) {
    if (PAGE() !== 'client' || !inp) return false;
    const c = activeCase();
    if (!c || c.status === 'exiting' || !c.incoming.length || inp.recipientId) return false;
    const r = attempt(c.id, { amount: inp.amount, account: inp.account, recipientNew: true, own: false });
    return !!(r && r.paused);
  }

  /* ---------------- выход из схемы ---------------- */
  function exit(id) {
    const c0 = byId(id);
    if (!c0 || ['paused', 'dispute'].indexOf(c0.status) < 0) return null;
    // сценарий больше не идёт: отменяем запланированные входящие, сообщение и авто-попытку
    timers.forEach((t) => clearTimeout(t)); timers = [];
    mutate(id, (c) => { c.status = 'exiting'; c.steps.cancel = true; hist(c, 'Клиент выбрал «Выйти из схемы безопасно»: перевод куратору отменён'); });
    renderSheet(id);
    later(() => {
      const st = S();
      let back = 0;
      const c = mutate(id, (c) => {
        c.incoming.forEach((x) => {
          if (x.returned) return;
          x.returned = true; back += x.amount;
          st.transactions.unshift({ id: NX.uid('tx'), ts: Date.now(), category: 'Переводы', merchant: 'Возврат: ' + x.from + ' · демо', amount: -x.amount, type: 'mx_return', mx: id });
        });
        c.steps.return = true; c.returned = (c.returned || 0) + back;
        hist(c, 'Деньги возвращены отправителям тем же путём: ' + NX.fmt(back) + ' (демо)');
      });
      if (!c) return;
      st.user.balance -= back;
      NX.save();
      refreshClient();
      renderSheet(id);
    }, 450);
    later(() => report(id), 950);
    return true;
  }
  function report(id) {
    const c = mutate(id, (c) => { c.steps.report = true; c.status = 'resolved'; c.reportedAt = Date.now(); hist(c, 'Клиент сам сообщил банку о вербовке'); });
    if (!c) return;
    // в стоп-лист — только куратор; отправители — пострадавшие
    try { NX.iocs.add([{ kind: CURATOR.kind, value: CURATOR.value, raw: CURATOR.raw }], SRC, { session: 'mx:' + c.id, client: c.client }); } catch (e) { console.error('[mule-exit] iocs.add', e); }
    emitResolved(c);
    renderSheet(id);
    refreshClient();
  }
  function emitResolved(c) {
    const steps = ['cancel', 'return', 'report'].concat(c.steps.guardian ? ['guardian'] : []);
    emit('mule_exit_resolved', c, { steps, returned: c.returned || TOTAL });
  }
  function callGuardian(id) {
    const c0 = byId(id); if (!c0) return;
    let g = null;
    try { g = NX.Constitution && NX.Constitution.get ? NX.Constitution.get().guardian : null; } catch (e) { g = null; }
    let sent = false;
    if (g && g.enabled && NX.Constitution && typeof NX.Constitution.requestGuardian === 'function') {
      try { sent = !!NX.Constitution.requestGuardian({ purpose: 'check', reason: 'Мне предложили подработку: принимать на карту чужие переводы. Я вышел из схемы — помогите спокойно разобраться' }); } catch (e) { console.error('[mule-exit] guardian', e); sent = false; }
    }
    if (sent) NX.toast('Запрос отправлен', (g.name || 'Близкий') + ' получит сообщение без номеров счетов и карт', 'ok', 'users');
    else NX.toast('Позовите взрослого', 'Близкий человек в «Правила → Близкие» не назначен. Расскажите о ситуации тому, кому доверяете', 'info', 'users');
    const c = mutate(id, (c) => { c.steps.guardian = true; hist(c, sent ? 'Клиент позвал близкого из «Близких»' : 'Клиенту предложено рассказать близкому'); });
    if (c && c.status === 'resolved') emitResolved(c);
    renderSheet(id);
  }
  function dispute(id) {
    const c = mutate(id, (c) => { if (c.status !== 'paused') return false; c.status = 'dispute'; c.disputedAt = Date.now(); hist(c, 'Клиент: «Это ошибка — я знаю этих людей». Запрос в банк, пауза остаётся до ответа'); });
    if (!c) return;
    emit('mule_exit_dispute', c);
    renderSheet(id);
    refreshClient();
  }
  // ответ банка (bank.js → mule_exit_bank): release — пауза снята; confirm — банк подтвердил вербовку
  function onBankVerdict(p) {
    const c0 = byId(p.caseId);
    if (!c0 || c0.client !== me()) return;
    if (p.verdict === 'release' && c0.status === 'dispute') {
      mutate(c0.id, (c) => { c.status = 'released'; hist(c, 'Банк проверил запрос и снял паузу'); });
      NX.toast('Банк снял паузу', 'Перевод снова доступен. Если сомневаетесь — не отправляйте', 'info', 'building');
    } else if (p.verdict === 'confirm') {
      if (c0.status === 'dispute') mutate(c0.id, (c) => { c.status = 'paused'; hist(c, 'Банк подтвердил: это вербовка'); });
      NX.toast('Банк подтвердил: это вербовка', c0.status === 'resolved' ? 'Спасибо, что сообщили сами' : 'Выйдите из схемы: верните деньги отправителям', 'warn', 'building');
    }
    renderSheet(c0.id);
    refreshClient();
  }

  /* ---------------- клиент: лист #view-mule ---------------- */
  let sheetId = null;
  function sheetEl() {
    let el = $('#view-mule');
    if (!el && document.body) { el = document.createElement('div'); el.id = 'view-mule'; el.className = 'sheet mx-sheet'; document.body.appendChild(el); }
    return el;
  }
  function onSheetKey(e) { if (e.key === 'Escape' && sheetId) { e.stopPropagation(); closeSheet(); } }
  function openSheet(id) {
    const el = sheetEl(); if (!el) return;
    sheetId = id;
    renderSheet(id);
    el.classList.add('open');
    el.removeAttribute('hidden');
    document.addEventListener('keydown', onSheetKey, true);
    const f = el.querySelector('.sheet-f .btn.primary') || el.querySelector('.nx-x');
    try { if (f) f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeSheet() {
    const el = $('#view-mule');
    if (el) { el.classList.remove('open'); el.setAttribute('hidden', ''); }
    sheetId = null;
    document.removeEventListener('keydown', onSheetKey, true);
  }
  // факты и причины берутся только из сработавших факторов кейса (c.factors), а не из констант
  const spanOf = (c) => { const n = c.incoming.length; return n > 1 ? Math.max(1, Math.round((Math.max.apply(null, c.incoming.map((x) => x.ts)) - Math.min.apply(null, c.incoming.map((x) => x.ts))) / MIN)) : 0; };
  const incomingFact = (c) => { const span = spanOf(c); return NX.countOf(c.incoming.length, ['перевод', 'перевода', 'переводов']) + ' от незнакомых людей' + (span ? ' за ' + NX.countOf(span, ['минуту', 'минуты', 'минут']) : ''); };
  const onF = (c, key) => (c.factors || []).some((f) => f.key === key && f.on);
  const sharePct = (c) => { const s = c.incoming.reduce((a, x) => a + (Number(x.amount) || 0), 0); return c.attempt && s ? Math.round((c.attempt.amount / s) * 100) : 0; };
  const facts = (c) => {
    const out = [incomingFact(c)];
    if (onF(c, 'onward')) out.push(c.message ? 'Вас просят сразу отправить почти всё дальше' : 'Почти все поступившие деньги сразу пытаются отправить дальше');
    if (onF(c, 'message')) out.push('Сообщение похоже на вербовку дропов');
    if (out.length < 3 && onF(c, 'new_rcpt')) out.push('Получатель новый, и это не ваш счёт');
    return out.slice(0, 3);
  };
  function detailsHTML(c) {
    const fl = (c.factors || []).map((f) => '<li class="' + (f.on ? 'on' : 'off') + '"><span class="mx-w">' + (f.on ? '+' + f.w : '0') + '</span><span>' + esc(f.t) + '<span class="tiny muted"> · ' + esc(f.d || '') + '</span></span></li>').join('');
    const inc = c.incoming.map((x) => '<li><span class="mono tiny">' + esc(NX.hm(x.ts)) + '</span><span>' + esc(x.from) + '</span><b>' + esc(NX.fmt(x.amount)) + '</b></li>').join('');
    const body = (c.score != null ? '<div class="row between small"><span>Оценка транзита</span><b class="mono">' + esc(c.score + ' из 100') + '</b></div><p class="tiny muted">Пороги: до 40 — низкий, 40–69 — подозрительно, от 70 — похоже на схему дропа. Подобраны вручную.</p>' : '') +
      (fl ? '<h4 class="mt-s mb-s small">Что посчитал NEXUS</h4><ul class="mx-factors">' + fl + '</ul>' : '') +
      (inc ? '<h4 class="mt-s mb-s small">Входящие переводы (синтетика)</h4><ul class="mx-inc">' + inc + '</ul>' : '') +
      '<p class="tiny muted mt-s">' + esc(HONEST) + ' Кейс ' + esc(c.id) + '.</p>';
    return NX.ui && NX.ui.details ? NX.ui.details(body) : '<details class="more"><summary>Подробнее</summary><div class="more-b">' + body + '</div></details>';
  }
  function stepRow(done, title, sub) {
    return '<li class="' + (done ? 'done' : 'wait') + '"><span class="mx-tick" aria-hidden="true">' + (done ? ic('check', 14) : '') + '</span><span><b>' + esc(title) + '</b>' + (sub ? '<span class="tiny muted">' + esc(sub) + '</span>' : '') + '</span><span class="sr-only">' + (done ? 'готово' : 'выполняется') + '</span></li>';
  }
  function renderSheet(id) {
    const el = $('#view-mule');
    if (!el || (sheetId && sheetId !== id)) return;
    const c = byId(id);
    if (!c) { closeSheet(); return; }
    let title = '', body = '', foot = '';
    const paused = '<p class="mx-paused">' + ic('lock', 16) + '<span>' + esc('Перевод ' + NX.fmt(c.attempt ? c.attempt.amount : ONWARD) + ' куратору на паузе. Деньги на вашем счёте.') + '</span></p>';
    const meaning = '<div class="mx-mean"><b>Что это значит</b><p>' + esc('Эти деньги, скорее всего, украли у других людей. Тот, кто пересылает их дальше, в РК может получить уголовное дело — даже если не знал.') + '</p><p class="tiny muted">справка, не юридическая консультация</p></div>';
    if (c.status === 'paused' || c.status === 'message' || c.status === 'incoming') {
      title = 'Похоже, ваш счёт используют для чужих денег';
      body = paused + '<ul class="mx-facts">' + facts(c).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' + meaning + detailsHTML(c);
      foot = '<button type="button" class="btn ghost" data-mx="dispute">Это ошибка — я знаю этих людей</button><button type="button" class="btn primary" data-mx="exit">Выйти из схемы безопасно</button>';
    } else if (c.status === 'dispute') {
      title = 'Запрос отправлен в банк';
      body = paused + '<p>' + esc('Вы написали, что знаете отправителей. Банк проверит переводы и ответит в приложении. Пока банк не ответил, перевод дальше остаётся на паузе.') + '</p><p class="small muted">' + esc('В демо ответ даёт аналитик в панели банка.') + '</p>' + meaning + detailsHTML(c);
      foot = '<button type="button" class="btn ghost" data-mx="exit">Всё-таки выйти из схемы</button><button type="button" class="btn primary" data-mx="close">Понятно</button>';
    } else if (c.status === 'exiting' || c.status === 'resolved') {
      const done = c.status === 'resolved';
      title = done ? 'Вы вышли из схемы' : 'Выходим из схемы';
      body = '<ol class="mx-steps">' +
        stepRow(c.steps.cancel, 'Перевод куратору отменён', 'деньги не ушли дальше') +
        stepRow(c.steps.return, 'Вернуть деньги отправителям тем же путём', c.steps.return ? NX.fmt(c.returned || TOTAL) + ' вернулись на те же счета, откуда пришли (демо)' : 'возврат по тем же переводам, на другую карту — нельзя') +
        stepRow(c.steps.report, 'Сообщить банку', c.steps.report ? 'банк получил ваше сообщение' : '') +
        '</ol>' +
        (done ? '<div class="mx-final" role="status"><b>' + esc('Вы вышли из схемы. Деньги возвращены отправителям (демо). Банк знает, что вы сообщили сами') + '</b></div>' : '') +
        (done ? '<p class="small mt-s">' + (c.steps.guardian ? ic('check', 14) + ' ' + esc('Близкий человек в курсе') : esc('Можно позвать взрослого, которому вы доверяете: он поможет спокойно разобраться.')) + '</p>' : '') +
        detailsHTML(c);
      foot = done ? (c.steps.guardian ? '' : '<button type="button" class="btn ghost" data-mx="guardian">Позвать взрослого из «Близких»</button>') + '<button type="button" class="btn primary" data-mx="close">Готово</button>' : '';
    } else if (c.status === 'released') {
      title = 'Банк снял паузу';
      body = '<p>' + esc('Банк проверил ваш запрос. Перевод снова доступен. Если вас торопят или обещают процент за пересылку — не отправляйте.') + '</p>' + detailsHTML(c);
      foot = '<button type="button" class="btn primary" data-mx="close">Понятно</button>';
    }
    const html = '<div class="sheet-box mx-box" role="dialog" aria-modal="true" aria-labelledby="mxTitle">' +
      '<div class="sheet-h"><h3 id="mxTitle">' + esc(title) + '</h3><button type="button" class="nx-x" data-mx="close" aria-label="Закрыть">' + NX.icon('x', { size: 20 }) + '</button></div>' +
      '<div class="sheet-b">' + body + '</div>' + (foot ? '<div class="sheet-f">' + foot + '</div>' : '') + '</div>';
    // одинаковую разметку не переписываем (открытый «Подробнее» не схлопывается)
    if (el._mxHtml !== html) {
      const det = el.querySelector('details.more');
      const wasOpen = !!(det && det.open);
      el.innerHTML = html; el._mxHtml = html;
      if (wasOpen) { const d2 = el.querySelector('details.more'); if (d2) d2.open = true; }
    }
  }

  /* ---------------- клиент: карточки и строка статуса ---------------- */
  function entryHTML() {
    return '<div class="card std mx-entry"><div class="card-h"><h3>Мне предлагают подработку с картой</h3></div>' +
      '<p class="small muted">Если просят принимать на вашу карту чужие переводы и пересылать дальше за процент — это схема дропов. NEXUS покажет, как выйти из неё безопасно.</p>' +
      '<div class="card-f row wrap gap-s"><button type="button" class="btn" data-mx="check">Проверить предложение о подработке</button><button type="button" class="btn ghost" data-mx="demo">Демо: мне предложили подработку</button></div></div>';
  }
  function renderClient() {
    const m = $('#muleEntryMount');
    if (m) { const h = entryHTML(); if (m._mxHtml !== h) { m.innerHTML = h; m._mxHtml = h; } }
    if (sheetId) renderSheet(sheetId);
  }
  // NX.ClientUI.statusProviders: одна строка статуса «Главной»
  function statusProvider() {
    const c = latestCase();
    if (!c) return null;
    if (c.status === 'incoming' || c.status === 'message') return { kind: 'warn', text: 'На счёт приходят переводы от незнакомых людей', rank: 2 };
    if (c.status === 'paused' || c.status === 'exiting') return { kind: 'danger', text: 'Счёт используют для чужих денег', link: { text: 'разобраться', goto: 'mule' }, rank: 3 };
    if (c.status === 'dispute') return { kind: 'warn', text: 'Перевод на паузе: ждём ответа банка', link: { text: 'подробнее', goto: 'mule' }, rank: 2 };
    if (c.status === 'resolved' && Date.now() - (c.reportedAt || c.upd) < 24 * 3600000) return { kind: 'calm', text: 'Счёт в порядке · вы сообщили банку', rank: 0 };
    return null;
  }
  // Платежи → Проверить: при вербовке — карточка «Это вербовка дропов» поверх общего ответа
  function scanHook(res, input) {
    // NX.scanText не возвращает схему; карточка — только когда сошлись работа + карта + пересылка дальше
    // (одно слово «зарплата» или «переводы» карточку не вызывает)
    if (!(res && res.scheme === 'mule_recruit') && !isRecruit(input)) return null;
    const rs = recruitReasons(input);
    return {
      collapseRest: true,
      html: '<div class="mx-scan" data-mx-scan="mule_recruit"><div class="verdict high"><div class="vi">' + ic('alert', 26) + '</div><div class="grow"><h4>Это вербовка дропов</h4><div class="small muted">Вам предлагают пропускать через свою карту чужие деньги</div></div></div>' +
        (rs.length ? '<ul class="call-reasons mt-s">' + rs.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
        '<p class="small mt-s"><b>Что делать:</b> не соглашайтесь и не давайте данные карты. Если переводы уже пришли — не пересылайте их дальше.</p>' +
        '<div class="row wrap mt"><button type="button" class="btn" data-mx="demo-scan">Посмотреть, что будет, если согласиться</button></div>' +
        '<p class="tiny muted mt-s">Покажем на синтетических переводах, ваши деньги не тронем.</p></div>',
    };
  }

  /* ---------------- банк ---------------- */
  const mxKey = (id) => 'mx:' + id;
  const stFor = () => { try { return NX.iocs.status(CURATOR.kind, CURATOR.value); } catch (e) { return null; } };
  function incPatch(c) {
    const disputed = c.status === 'dispute' || (c.status === 'released' && !c.reportedAt);
    const timeline = c.incoming.map((x) => ({ t: 'Входящий перевод ' + NX.fmt(x.amount) + ' от незнакомого отправителя «' + x.from + '» (синтетика)', ts: x.ts }))
      .concat(c.attempt ? [{ t: 'Попытка отправить ' + NX.fmt(c.attempt.amount) + ' куратору — пауза, деньги не ушли', ts: c.attempt.ts }] : [])
      .concat(c.disputedAt ? [{ t: 'Клиент: «Это ошибка — я знаю этих людей»', ts: c.disputedAt }] : [])
      .concat(c.reportedAt ? [{ t: 'Клиент вышел сам: перевод отменён, деньги возвращены отправителям (демо), банк получил сообщение', ts: c.reportedAt }] : []);
    const notes = [];
    if (c.reportedAt) notes.push({ key: 'mx_report', ts: c.reportedAt, t: 'Клиент вышел из схемы сам: перевод куратору отменён, ' + NX.fmt(c.returned || TOTAL) + ' возвращены отправителям тем же путём (демо). Реквизит куратора передан в стоп-лист', by: 'NEXUS · Не стань дропом' });
    if (c.steps && c.steps.guardian) notes.push({ key: 'mx_guardian', ts: c.upd, t: 'Клиент позвал близкого человека', by: 'NEXUS · Не стань дропом' });
    if (c.disputedAt) notes.push({ key: 'mx_dispute', ts: c.disputedAt, t: 'Клиент оспаривает паузу: говорит, что знает отправителей. Пауза остаётся до ответа банка', by: 'NEXUS · Не стань дропом' });
    return {
      kind: 'mule_exit', mxId: c.id, mxDispute: disputed, synthetic: true, score: null, heldTransfer: false,
      account: CURATOR.raw, amount: c.attempt ? c.attempt.amount : ONWARD,
      type: 'Не стань дропом',
      title: disputed ? 'Клиент оспаривает паузу перевода · Не стань дропом' : 'Клиент сообщил о вербовке в дропы',
      client: c.client, source: 'Не стань дропом · кабинет клиента (демо)', fromClient: true,
      factors: [incomingFact(c)]
        .concat(onF(c, 'onward') ? ['Попытка сразу отправить ' + sharePct(c) + '% поступивших денег' + (onF(c, 'new_rcpt') ? ' новому получателю' : '')] : [])
        .concat(onF(c, 'message') ? ['Сообщение похоже на вербовку дропов'] : [])
        .concat(!onF(c, 'onward') && onF(c, 'new_rcpt') ? ['Получатель новый и не принадлежит клиенту'] : [])
        .concat(onF(c, 'young') ? ['Счёт моложе 90 дней или профиль «студент»'] : []),
      chain: timeline,
      reopen: !disputed && !!c.reportedAt,
      addNotes: notes,
    };
  }
  const synced = {};
  function syncBank(cIn) {
    if (PAGE() !== 'bank' || !NX.BankExt || resetting()) return;
    const list = cIn ? [cIn] : load().cases;
    list.forEach((c) => {
      if (!c.reportedAt && c.status !== 'dispute' && !c.disputedAt) return; // инцидент — только когда клиент сообщил или оспорил
      const sig = c.upd + '|' + c.status;
      if (synced[c.id] === sig) return;
      synced[c.id] = sig;
      const res = NX.BankExt.upsertIncident(mxKey(c.id), () => incPatch(c));
      if (res && res.isNew) { try { NX.BankExt.logCycle('investigate', 'Не стань дропом: ' + String(c.client).split(' ')[0] + ' — ' + (c.reportedAt ? 'клиент вышел из схемы сам' : 'клиент оспаривает паузу'), { inc: res.id }); } catch (e) { /* ignore */ } }
      addGraph(c);
    });
  }
  function addGraph(c) {
    if (!NX.Graph || typeof NX.Graph.addMuleExit !== 'function' || !c || !c.incoming || !c.incoming.length) return null;
    try { return NX.Graph.addMuleExit({ id: c.id, client: c.client, incoming: c.incoming, attempt: c.attempt, curator: CURATOR }); } catch (e) { console.error('[mule-exit] graph', e); return null; }
  }
  // bank.js replayGraph (после перестройки графа)
  function replayGraph() { load().cases.forEach((c) => { if (c.reportedAt || c.disputedAt) addGraph(c); }); }
  function bankIncidentSummary(i) {
    const c = byId(i.mxId);
    const st = stFor();
    return '<div class="notice ' + (c && c.reportedAt ? 'warn' : '') + '"><b>' + esc(c && c.reportedAt ? 'Клиент вышел из схемы сам' : 'Клиент оспаривает паузу') + '</b><br>' +
      esc('Индекса риска у обращения нет. Отправители — пострадавшие, в стоп-лист не попадают. Реквизит куратора: ' + (st ? NX.iocs.label(st) : 'ещё не в стоп-листе') + '.') + '</div>';
  }
  function bankIncidentHTML(i) {
    const c = byId(i.mxId);
    if (!c) return '<p class="small muted mt">Данные кейса не найдены (сброс?).</p>';
    const st = stFor();
    let rec = null; try { rec = NX.iocs.find(CURATOR.kind, CURATOR.value); } catch (e) { rec = null; }
    const rows = c.incoming.map((x) => '<li><span class="mono tiny">' + esc(NX.hm(x.ts)) + '</span><span>' + esc(x.from) + ' <span class="tiny muted">синтетика</span></span><b>' + esc(NX.fmt(x.amount)) + '</b><span class="tiny ' + (x.returned ? 'mx-ok' : 'muted') + '">' + esc(x.returned ? 'возвращено' : 'на счёте клиента') + '</span></li>').join('');
    const disputeBox = c.status === 'dispute' ? '<div class="notice mt-s small">' + esc('Клиент говорит, что знает отправителей. Перевод на паузе до решения: «Ложное срабатывание» снимает паузу, «Подтвердить: вербовка» оставляет её и сообщает клиенту.') + '</div>' : '';
    return '<h4 class="mt mb mx-h4">' + ic('users') + ' Не стань дропом · кейс ' + esc(c.id) + '</h4>' +
      '<ul class="mx-tl">' + rows + '</ul>' +
      '<p class="small mt-s">' + esc(c.attempt ? 'Попытка отправить ' + NX.fmt(c.attempt.amount) + ' куратору (' + Math.round((c.attempt.amount / TOTAL) * 100) + '% поступлений) — пауза, деньги не ушли.' : 'Перевода дальше не было.') + '</p>' +
      (c.reportedAt ? '<p class="small"><b>' + esc('Клиент вышел сам') + '</b> ' + esc('· ' + NX.fmt(c.returned || TOTAL) + ' возвращены отправителям тем же путём (демо)' + (c.steps && c.steps.guardian ? ' · позвал близкого' : '')) + '</p>' : '') +
      disputeBox +
      '<div class="row wrap gap-s mt-s"><span class="small">' + esc('Реквизит куратора ' + CURATOR.raw + ': ') + '<span class="badge ' + (st === 'corroborated' || st === 'confirmed' ? 'high' : st ? 'warn' : 'plain') + '">' + esc(st ? NX.iocs.label(st) : 'не в стоп-листе') + '</span></span>' +
      (rec ? '<button type="button" class="btn sm" data-ioc="' + esc(rec.id) + '">' + ic('dna', 14) + 'Карточка реквизита</button>' : '') +
      '<button type="button" class="btn sm" data-mx-graph="' + esc(c.id) + '">' + ic('graph', 14) + 'Показать в графе</button></div>' +
      '<p class="tiny muted mt-s">' + esc('Клиент — не дроп: он остановил цепочку сам. В графе он отмечен как «Вербуемый · сообщил сам», куратор — счёт из базы дропов. ' + HONEST) + '</p>';
  }
  // bank.js: решение аналитика по инциденту → ответ в кабинет клиента
  function bankVerdict(i, verdict) {
    if (!i || i.kind !== 'mule_exit' || !i.mxId) return;
    NX.bus.emit('mule_exit_bank', { caseId: i.mxId, client: i.client, verdict: verdict === 'fp' ? 'release' : 'confirm', synthetic: true });
  }
  function onBankClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-mx-graph]') : null;
    if (!t) return;
    const c = byId(t.getAttribute('data-mx-graph'));
    const res = c ? addGraph(c) : null;
    try { NX.closeModal(); } catch (er) { /* ignore */ }
    if (NX.BankExt) NX.BankExt.go('graph');
    if (res && res.node && NX.Graph) setTimeout(() => { try { NX.Graph.focus(res.node, { ms: 5000, k: 1.2 }); NX.Graph.select(res.node); } catch (er) { /* ignore */ } }, 60);
  }

  /* ---------------- клики клиента ---------------- */
  function onClientClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-mx], [data-goto="mule"]') : null;
    if (!t) return;
    if (t.hasAttribute('data-goto')) {
      e.preventDefault(); e.stopPropagation();
      const c = latestCase(); if (c) openSheet(c.id);
      return;
    }
    const a = t.getAttribute('data-mx');
    if (a === 'demo' || a === 'demo-scan') { e.preventDefault(); closeSheet(); start(a === 'demo-scan' ? 'scan' : 'demo'); }
    else if (a === 'check') {
      e.preventDefault();
      try { if (NX.go) NX.go('scam'); } catch (er) { /* ignore */ }
      setTimeout(() => { const ta = $('#scamText'); if (ta) { if (!ta.value.trim()) ta.placeholder = 'Вставьте сообщение с предложением подработки'; try { ta.focus({ preventScroll: false }); } catch (er) { /* ignore */ } } }, 40);
    } else if (a === 'close') { e.preventDefault(); closeSheet(); }
    else if (a === 'exit' && sheetId) { e.preventDefault(); exit(sheetId); }
    else if (a === 'dispute' && sheetId) { e.preventDefault(); dispute(sheetId); }
    else if (a === 'guardian' && sheetId) { e.preventDefault(); callGuardian(sheetId); }
  }

  /* ---------------- шина ---------------- */
  function onBus(msg, local) {
    if (!msg || !msg.type) return;
    const p = msg.payload || {};
    if (msg.type === 'mule_exit_bank') { if (!local && PAGE() === 'client') onBankVerdict(p); return; }
    if (String(msg.type).indexOf('mule_exit_') !== 0) return;
    if (!local && p.case && p.case.id) pending.set(p.case.id, p.case);
    if (local || PAGE() !== 'bank') return;
    const who = String(p.client || '').split(' ')[0];
    if (msg.type === 'mule_exit_alert') {
      try { NX.BankExt && NX.BankExt.logCycle('detect', 'Не стань дропом: у клиента ' + who + ' признаки транзита чужих денег — перевод дальше на паузе'); } catch (e) { /* ignore */ }
      NX.toast('Не стань дропом: перевод на паузе', who + ' · признаки транзита чужих денег · демо', 'warn', 'users');
    } else if (msg.type === 'mule_exit_resolved') {
      NX.toast('Клиент вышел из схемы сам', who + ' · деньги возвращены отправителям (демо) · куратор — в стоп-лист', 'high', 'users');
    } else if (msg.type === 'mule_exit_dispute') {
      NX.toast('Клиент оспаривает паузу', who + ' · «знаю этих людей» · нужен ответ аналитика', 'warn', 'users');
    }
    syncBank(p.case || null);
  }

  function init() {
    NX.bus.on(onBus);
    if (PAGE() === 'client') {
      document.addEventListener('click', onClientClick, true);
      if (NX.ClientUI) {
        NX.ClientUI.statusProviders = NX.ClientUI.statusProviders || [];
        NX.ClientUI.statusProviders.push(statusProvider);
        NX.ClientUI.scanHook = scanHook;
      }
      renderClient();
      // сценарий прервали перезагрузкой: досылаем недошедшие шаги
      const c = activeCase();
      if (c && (c.status === 'incoming' || c.status === 'message')) resume(c);
      if (c && c.status === 'exiting') { if (!c.steps.return) exit2(c.id); else report(c.id); }
      refreshClient();
      window.addEventListener('storage', (e) => { if (e.key === KEY) { renderClient(); refreshClient(); } });
    }
    if (PAGE() === 'bank') {
      document.addEventListener('click', onBankClick);
      syncBank();
      window.addEventListener('storage', (e) => { if (e.key === KEY) syncBank(); });
    }
  }
  // восстановление после перезагрузки посреди выхода: шаги 2–3 повторяются
  function exit2(id) { mutate(id, (c) => { c.status = 'paused'; }); exit(id); }

  NX.MuleExit = {
    KEY, TOTAL, ONWARD, CURATOR, RECRUIT_TEXT, FOLLOW_UP, HONEST, SENDERS: SENDERS.map((s) => ({ from: s[0], amount: s[1] })),
    load, save, emit, transitScore, isRecruit,
    start, attempt, interceptTransfer, exit, dispute, callGuardian,
    openSheet, closeSheet, cases: () => load().cases.slice(), get: byId, active: activeCase,
    renderClient, renderBank: syncBank, bankIncidentHTML, bankIncidentSummary, bankVerdict, replayGraph, statusProvider, scanHook,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
