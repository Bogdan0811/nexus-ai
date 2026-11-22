/* =====================================================================
   NEXUS AI — сцена для жюри (stage.html), цикл DETECT → UNDERSTAND → PREDICT → PROTECT → INVESTIGATE → RECOVER
   - два iframe одного origin: client.html?embed=1&persona=mom (телефон) и bank.html?embed=1
   - степпер 0–8, горячие клавиши, автопилот (A), «Подготовить сцену» (R)
   - индикатор связи клиент↔банк (ping/pong по шине раз в 3 с)
   - шаг 1: Защита звонка + детектор манипуляций (bus manip_update / NX.Stage.manip; без них — NX.Manip сцены по расшифровке)
   - шаг 2: пульт судьи «Сыграйте мошенника»: реплики судьи → реквизиты в стоп-лист (NX.iocs.add),
     ответы приманки — Claude (/api/chat, mode decoy) или офлайн-движок, с пост-фильтром цифр
   - шаг 3: Цепочка дропов (NX.BankStage.showChain; без него — focusGraphOnIoc)
   - шаг 4: второй клиент Сауле Д., 67 — «Обычный перевод», удержание, запрос сыну Ерлану
   - шаг 5: мошенник уговаривает поднять лимит → Правило 24 часов (NX.Stage.constitutionAttack; без него —
     NX.Constitution.requestChange); захват аккаунта (ATO) — дополнительная кнопка
   - шаг 6: Fraud Fusion Center — схема целиком, «Заблокировать всё» (NX.Stage.emergency), «Меня обманули»
   - живые замеры: время до тревоги, стадий манипуляции до тревоги, запас до кода, доставка IOC,
     реплик до реквизита, индекс DNA второго перевода, решение по переводу, якорь
   - шаг 7: «Не только звонки» — Leak Radar и Безопасная сделка (stage-more.js), в ?short=1 пропускается
   - слайды шагов 0 и 8 (в шаге 0 — цикл и 6 тем брифа); ROI-калькулятор (roi.js) — только с ?full=1
   - ?short=1 — 3-минутный показ: 5 битов на тех же шагах (без шагов 3 и 5), свой автопилот на 3:00 (см. autoShortPath)
   - мобильная сцена ≤ 900px: вкладки «Телефон / Банк», нижняя панель ← действие →
   Код внутри iframe не меняется: только вызовы NX.Stage / NX.BankStage / NX.Shield / NX.Constitution
   (с проверкой наличия), чтение DOM и подключение assets/css/stage.css.
   Инновации в банкинге и кибербезопасность · концепт команды, не продукт банка-организатора.
   Все данные синтетические.
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  if (!NX) {
    document.addEventListener('DOMContentLoaded', () => { document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif;color:var(--text,#E8ECF7);background:var(--bg,#05070D)">Не загрузился assets/js/core.js — сцена не может работать. Проверьте, что сайт открыт через сервер (serve.ps1 или деплой).</p>'; });
    return;
  }
  NX.page = 'stage';

  /* ---------------- помощники ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => NX.esc(v);
  const FL = NX.flags || {};
  const qp = (k) => { try { return NX.params ? NX.params.get(k) : null; } catch (e) { return null; } };
  const NO_INJECT = qp('inject') === '0';
  const perf = () => (window.performance && performance.now ? performance.now() : Date.now());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const secTxt = (ms) => (Math.round(Math.abs(ms) / 100) / 10).toFixed(1).replace('.', ',') + ' с';
  const msTxt = (ms) => (ms < 1 ? '< 1' : String(Math.round(ms))) + ' мс';
  const mmss = (ms) => { const s = Math.max(0, Math.round((Number(ms) || 0) / 1000)); return Math.floor(s / 60) + ':' + NX.pad(s % 60); };
  const mmss2 = (ms) => { const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000)); return NX.pad(Math.floor(s / 60)) + ':' + NX.pad(s % 60); };
  const ic = (name, size) => NX.icon(name, '', size || 16);
  // якорь (в наборе NX.icon его нет)
  const anchorIc = (size) => '<svg width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21M8 11h8M4.5 13.5A7.5 7.5 0 0 0 12 21a7.5 7.5 0 0 0 7.5-7.5M4.5 13.5l-1.5 1.5M19.5 13.5l1.5 1.5"/></svg>';
  const MQ = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;
  const isMobile = () => !!(MQ && MQ.matches);
  function waitFor(fn, ms, step) {
    const t0 = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        let ok = false;
        try { ok = !!fn(); } catch (e) { ok = false; }
        if (ok) return resolve(true);
        if (Date.now() - t0 >= ms) return resolve(false);
        setTimeout(tick, step || 120);
      };
      tick();
    });
  }
  function toast(title, text, kind, icon) { try { return NX.toast(title, text || '', kind || 'info', icon); } catch (e) { return null; } }
  let lastErr = 0;
  function errToast(title, text) {
    const now = Date.now();
    if (now - lastErr < 6000) return;
    lastErr = now;
    toast(title, text || 'Ошибка перехвачена, демо продолжается. Подробности — в консоли.', 'warn', 'alert');
  }
  window.addEventListener('unhandledrejection', (e) => { console.error('[stage] unhandled', e && e.reason); errToast('Сбой в сцене перехвачен'); });

  const CLIENT_NAME = 'Гульнара Сапарова';
  const CLIENT_LABEL = 'Гульнара-апа, 63';
  const GUARDIAN = 'Айгерим'; // дочь, доверенное лицо (статья 5 конституции)
  const SECOND = { amount: 380000, client: 'Сауле Д., 67 · Шымкент', city: 'Шымкент', label: 'Сауле Д., 67, Шымкент', short: 'Сауле Д., 67' };
  const SON = 'Ерлан'; // сын Сауле Д., доверенное лицо второго клиента (Близкие)
  // синтетический профиль Сауле Д. для «Обычный перевод» (если банк не вернул r.dna)
  const SAULE_PROFILE = { txCount: 46, typical: { p25: 5000, median: 12000, p75: 20000 }, maxToNew: 25000, knownRecipients: 4, dayShare: 0.93, usualHours: [9, 20], summary: 'обычно 5–20 тыс ₸ · 4 знакомых получателя · днём' };
  const PHONE_VW = 360;   // виртуальная ширина телефона (CSS px внутри iframe)
  const BANK_VW = 920;    // минимальная виртуальная ширина панели банка
  const IDLE_MS = 20000;  // судья молчит дольше — автопилот
  const ACC_KINDS = ['iban', 'phone', 'card', 'crypto'];
  const ROLE_RU = { client: 'клиент', victim: 'пострадавший', mule: 'дроп', transit: 'транзит', cashout: 'обнал', unknown: 'не определено' };

  /* ---------------- шаги ---------------- */
  /* Карточка шага: title — одна строка «на что смотреть», cap — до 25 слов, note — заметки ведущего
     (длинные оговорки: SDK, официальный номер, возврат денег); заметки открываются клавишей N или в справке «?». */
  const STEPS_FULL = [
    { short: 'Вступление', title: 'Проблема и цикл защиты', layout: 'slides', slides: ['title', 'problem', 'cycle'] },
    { short: 'Звонок маме', title: 'Тревога раньше, чем мошенник попросит код', layout: 'client', action: 'Запустить демо-звонок', phase: 'DETECT · UNDERSTAND · PREDICT',
      cap: 'Гульнаре-апа (63) звонит «служба безопасности банка». NEXUS узнаёт схему давления по порядку фраз, предупреждает до просьбы кода, дочь получает пуш.',
      note: 'Детектор манипуляций распознаёт стадии давления по порядку — авторитет, страх, изоляция, доступ, — определяет тип атаки и прогнозирует следующий шаг мошенника. Звонящему «из банка» без отметки в приложении NEXUS отвечает «Банк сейчас вам не звонил»; когда звонит настоящий банк, панель банка ставит отметку (симуляция) — тревоги нет, но просьба кода или перевода всё равно её поднимет. Звонок в демо синтетический: обычные телефонные звонки браузер не слышит, в продукте нужен мобильный SDK.' },
    { short: 'Номер-ловушка', title: 'Сыграйте мошенника', layout: 'decoy', action: 'Открыть номер-ловушку', phase: 'DETECT · INVESTIGATE',
      cap: 'Звонок переадресован на номер-ловушку банка. Придумайте свой «безопасный счёт» — приманка тянет время и записывает реквизиты, сама цифр не называет.',
      note: 'Мошенника играет судья или автопилот (J). Приманка не знает данных клиентки и не совершает операций; пост-фильтр убирает из её ответов цифры, IBAN, ссылки и e-mail. Названный реквизит сразу уходит в стоп-лист банка со статусом «на проверке».' },
    { short: 'Цепочка дропов', title: 'Банк находит этот счёт в цепочке дропов', layout: 'bank', action: 'Показать цепочку счетов', phase: 'INVESTIGATE · PREDICT',
      cap: 'Жертвы → дроп-счёт → транзит → обнал. Риск переходит на связанные счета до жалоб новых жертв. Связь — не вина: решает аналитик.',
      note: 'Панель банка находит реквизит из ловушки в цепочке: веерные поступления на дроп-счёт, перемещение за минуты. Подозрение можно снять, каждое решение — в журнале. В демо история счетов сгенерирована, поэтому связь с дроп-сетью — иллюстрация механизма, а не находка.' },
    { short: 'Второй клиент', title: 'Тот же счёт удерживает перевод другой клиентки', layout: 'bank', action: 'Перевод Сауле Д.', phase: 'UNDERSTAND · PROTECT',
      cap: 'Сауле Д., 67 (синтетический клиент) переводит 380 000 ₸ на тот же реквизит. Перевод удержан, сын Ерлан получает запрос проверить.',
      note: 'Решение — самое строгое из стоп-листа, правил клиента и сравнения с её обычными переводами (профиль «обычный перевод»). Сын получает запрос без реквизитов: только суть и округлённая сумма; деньгами он не распоряжается.' },
    { short: 'Правило 24 часов', title: 'Ослабить защиту во время звонка нельзя', layout: 'client', action: 'Мошенник просит поднять лимит', phase: 'PROTECT',
      cap: 'Мошенник уговаривает Гульнару-апа поднять лимит. Правило 24 часов отклоняет изменение, всплывает голос дочери, Айгерим получает уведомление.',
      note: 'Ослабить любое правило можно только через 24 часа; во время звонка — нельзя совсем. «Голос из спокойного времени» записан заранее. Кнопка «Если клиент поддался» показывает захват аккаунта с нового устройства: смену лимита тоже удерживает NEXUS Core.' },
    { short: 'Схема целиком', title: 'Схема целиком и «Заблокировать всё»', layout: 'client', action: 'Включить «Заблокировать всё»', phase: 'INVESTIGATE · PROTECT · RECOVER',
      cap: 'Новые переводы и получатели на паузе, банк и Айгерим уведомлены. Если деньги уже ушли — «Меня обманули» собирает обращение за минуты.',
      note: 'Банк видит звонок, ловушку, цепочку счетов, удержание второго клиента и попытку ослабить защиту. В прототипе «Заблокировать всё» — защитный режим кабинета; блокировка реальных переводов и сеансов требует API банка. «Меня обманули» — быстрый запуск процедуры, возврат денег не гарантируется.' },
    // шаг 7 — два модуля вне звонка (assets/js/stage-more.js): карты для магазинов и безопасная сделка; в ?short=1 пропускается
    { short: 'Не только звонки', title: 'Утечка карты и покупка с рук — тот же стоп-лист', layout: 'bank', action: 'Карта: утечка у магазина', phase: 'DETECT · INVESTIGATE · PROTECT', more: true,
      cap: 'Своя карта для каждого магазина показывает, где утекли данные. Безопасная сделка держит деньги в банке до вручения товара. Всё — симуляция.',
      note: 'Номер Гульнары-апа знал только «Сайт объявлений», а им попытались оплатить в другом месте — вероятный источник утечки. Банк сводит сигналы независимых клиентов; по одному сигналу магазин не обвиняется. Фейковую «ссылку доставки» NEXUS ловит до оплаты. Требует интеграции: виртуальные карты в процессинге, договор и счёт для сделок, API доставки.' },
    // финал: что работает / новые защиты / пилот; ROI-калькулятор (допущения команды) — только с ?full=1
    { short: 'Финал', title: 'Что работает и что дальше', layout: 'slides', slides: FL.full ? ['finale', 'newfeat', 'roi', 'pilot'] : ['finale', 'newfeat', 'pilot'] },
  ];
  /* ?short=1 — 3-минутный показ (видео и отборочный тур): 5 битов на тех же индексах шагов 0–8.
     Шаги 3 (цепочка дропов — одной фразой в бите 4) и 5 (правило 24 часов) пропускаются; шаг 6 — 10 секунд панели банка:
     «Звонит настоящий банк» и маскирование ПДн; шаг 7 (не только звонки) пропускается; шаг 8 — один финальный слайд. «Заблокировать всё» и «Меня обманули» — в Q&A. */
  const SHORT = qp('short') === '1';
  function shortSteps(F) {
    const s = F.map((x) => Object.assign({}, x));
    s[0] = { short: 'Проблема', title: 'Проблема и 6 тем брифа', layout: 'slides', slides: ['problem', 'topics'], beat: 1 };
    s[1] = Object.assign(s[1], { beat: 2, cap: 'Гульнаре-апа (63) звонит «служба безопасности банка». NEXUS предупреждает до просьбы кода, дочь получает пуш. Звонок синтетический.' });
    s[2] = Object.assign(s[2], { beat: 3, cap: 'Звонок переадресован на номер-ловушку. Приманка выспрашивает реквизиты, сама цифр не называет. Названный счёт сразу уходит в стоп-лист банка.' });
    s[3] = Object.assign(s[3], { skip: true });
    s[4] = Object.assign(s[4], { beat: 4, cap: 'Сауле Д., 67 (синтетический клиент) переводит 380 000 ₸ на тот же реквизит. Перевод удержан, сын получает запрос проверить.',
      note: s[4].note + ' Цепочка дропов одной фразой: тот же реквизит банк находит в цепочке дроп-счетов и повышает риск связанных счетов (подробно — шаг 3 полной сцены).' });
    s[5] = Object.assign(s[5], { skip: true });
    s[6] = { short: 'Панель банка', title: 'Честный звонок банка — с отметкой', layout: 'bank', action: 'Позвонить клиенту с официального номера', phase: 'INVESTIGATE · PROTECT', beat: 5,
      cap: 'Аналитик перезванивает клиентке с официального номера — в её приложении отметка «Сейчас вам действительно звонит банк» (симуляция).',
      note: 'Аналитик открывает инцидент этого показа (удержанный перевод). Ниже — реплика мошенника из этого показа до и после маскирования ПДн, которое стоит перед любым запросом к LLM.' };
    s[7] = Object.assign(s[7], { skip: true }); // «Не только звонки» — только в полной сцене
    s[8] = { short: 'Финал', title: 'Что работает и что дальше', layout: 'slides', slides: ['finale'], beat: 5 };
    return s;
  }
  const STEPS = SHORT ? shortSteps(STEPS_FULL) : STEPS_FULL;
  const LAST = STEPS.length - 1;
  const MORE = STEPS.findIndex((x) => x.more); // шаг «Не только звонки» (7)
  const isMore = (n) => n === MORE && !SHORT && !!NX.StageMore;
  const BEAT_RU = ['Проблема', 'Звонок маме', 'Номер-ловушка', 'Второй клиент', 'Банк и финал'];
  const BEATS = SHORT ? BEAT_RU.map((short, i) => ({ n: i + 1, short, first: STEPS.findIndex((x) => x.beat === i + 1) })) : null;
  const isSkip = (n) => !!(STEPS[n] && STEPS[n].skip);
  // ближайший непропускаемый шаг от n в направлении dir (+1 / −1)
  function stepFrom(n, dir) {
    let i = clamp(n, 0, LAST);
    while (isSkip(i) && i + dir >= 0 && i + dir <= LAST) i += dir;
    if (isSkip(i)) { i = clamp(n, 0, LAST); while (isSkip(i) && i - dir >= 0 && i - dir <= LAST) i -= dir; }
    return i;
  }
  // клавиши 1–5 в коротком показе — биты; 0 — начало
  const keyStep = (d) => (!SHORT ? d : d <= 0 ? 0 : d <= BEATS.length ? BEATS[d - 1].first : LAST);

  /* ---------------- состояние сцены ---------------- */
  const S = {
    step: 0, sub: 0, ran: {}, auto: null, prepping: false, framesUp: false, pendingEnter: true, used: false,
    llm: null, ruVoice: null, kkVoice: null,
    call: null, judge: null, iocs: [], metrics: null, lastCase: null, ato: null, bankFocus: null, push: null, second: null,
  };
  function freshCall() { return { t0: 0, alertAt: 0, score: null, category: '', phrase: null, finals: 0, codeAt: 0, codePhrase: null, total: 0, ended: false, poll: null, started: false, consentWait: false }; }
  function freshJudge() {
    return {
      open: false, mode: 'console', t0: 0, lines: 0, replies: 0, history: [], chain: Promise.resolve(),
      slots: { acc: false, owner: false, alt: false, site: false, askedOwner: false }, accs: [], used: {}, lastPool: '', finalSaid: false,
      idleAt: 0, apRunning: false, apToken: 0, apIdx: 0, apIban: '', lang: 'ru', rec: null, recOn: false, recFails: 0,
      voice: true, timer: null,
    };
  }
  function freshMetrics() { return { tta: null, lead: null, iocLat: null, iocLatSrc: '', linesToIoc: null, secondMs: null, secondAge: null, secondDecision: null, stagesAtAlert: null, stagesOf: null, stagesSrc: '', dnaIndex: null, dnaTier: '' }; }
  // детектор манипуляций (шаг 1): последний результат и его источник
  const freshManip = () => ({ res: null, src: '', at: 0, pendingAlert: false, lastLocal: '' });
  // Близкие второго клиента (шаг 4): запрос сыну Ерлану
  const freshTrust = () => ({ at: 0, answer: '', answeredAt: 0, by: '' });
  // шаг 6: «Заблокировать всё» и «Меня обманули»
  const freshFusion = () => ({ shield: null, shieldAt: 0, via: '', recoverShown: false, bankView: '', caseId: '' });
  // шаг 5, часть 1: попытка мошенника ослабить конституцию во время звонка
  function freshAnchor() { return { started: false, done: false, skipped: false, via: '', t0: 0, ms: null, refused: null, articleN: null, anchorShown: false, guardian: null, protective: null, raw: null }; }
  const freshAto = () => ({ started: false, requested: false, steps: [], done: false, anchorRefused: false });
  // короткий показ, бит 5: «Звонит настоящий банк» + пример маскирования
  const freshVcall = () => ({ started: false, at: 0, incId: '', client: '', reason: '', clicked: false, already: false, bus: null, mask: null });
  // начальные значения сразу: сообщения шины могут прийти до init()
  S.call = freshCall(); S.judge = freshJudge(); S.metrics = freshMetrics(); S.ato = freshAto(); S.anchor = freshAnchor();
  S.manip = freshManip(); S.trust = freshTrust(); S.fusion = freshFusion(); S.chain = null; S.vcall = freshVcall();
  S.mTab = 'phone'; S.mTabUserStep = -1;
  S.state = null; // последняя строка статуса шага: {step, html, kind}
  // id прогона сцены: meta.session для NX.iocs.add (реплики одного прогона — не независимые источники)
  const newRunId = () => 'stage-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  S.runId = newRunId();
  let lastResultHtml = '';
  let resultScrollT = 0, lastResultStep = -1;
  let roiInst = null;
  function resetSession() {
    if (S.judge) { stopMic(true); S.judge.apToken++; if (S.judge.timer) clearInterval(S.judge.timer); }
    if (S.call && S.call.poll) clearInterval(S.call.poll);
    S.runId = newRunId();
    if (roiInst && typeof roiInst.reset === 'function') { try { roiInst.reset(); } catch (e) { console.error('[stage] roi reset', e); } }
    S.maxStep = 0;
    S.ran = {}; S.call = freshCall(); S.judge = freshJudge(); S.iocs = []; S.metrics = freshMetrics();
    S.lastCase = null; S.ato = freshAto(); S.anchor = freshAnchor(); S.bankFocus = null; S.push = null; S.second = null; S.used = false; S.state = null;
    S.manip = freshManip(); S.trust = freshTrust(); S.fusion = freshFusion(); S.chain = null; S.vcall = freshVcall();
    if (NX.StagePhone) { try { NX.StagePhone.reset(); } catch (e) { /* ignore */ } }
    if (NX.StageMore) NX.StageMore.reset();
    if (S.manipPoll) { clearInterval(S.manipPoll); S.manipPoll = null; }
    S.judge.voice = !!S.ruVoice;
    const log = $('#judgeLog'); if (log) log.innerHTML = '';
    const inp = $('#judgeInput'); if (inp) inp.value = '';
    ['#pushCard', '#resultCard', '#judgeCard'].forEach((id) => { const el = $(id); if (el) { el.classList.add('hidden'); if (id !== '#judgeCard') el.innerHTML = ''; } });
    setRibbon(null);
    updateJudgeUi();
    renderMetrics();
  }

  /* ---------------- iframe ---------------- */
  const FR = {
    client: { el: $('#frClient'), host: $('#hostClient'), cover: $('#coverClient'), dot: $('#dotClient'), file: 'client.html', hash: 'shield', vw: PHONE_VW, name: 'кабинет клиента', loaded: false, ready: false, lastPong: 0, token: '', scale: 1 },
    bank: { el: $('#frBank'), host: $('#hostBank'), cover: $('#coverBank'), dot: $('#dotBank'), file: 'bank.html', hash: 'overview', vw: BANK_VW, name: 'панель банка', loaded: false, ready: false, lastPong: 0, token: '', scale: 1 },
  };
  function frameUrl(k, token) {
    const f = FR[k];
    const q = ['embed=1'];
    if (k === 'client') q.push('persona=mom');
    if (FL.llmOff) q.push('llm=off');
    if (FL.present) q.push('present=1');
    if (token) q.push('_r=' + token);
    return f.file + '?' + q.join('&') + '#' + f.hash;
  }
  function win(k) { try { return FR[k].el ? FR[k].el.contentWindow : null; } catch (e) { return null; } }
  function fnx(k) { const w = win(k); try { return w && w.NX ? w.NX : null; } catch (e) { return null; } }
  function fdoc(k) { try { return FR[k].el ? FR[k].el.contentDocument : null; } catch (e) { return null; } }
  function api(k, path) {
    const nx = fnx(k);
    if (!nx) return null;
    const parts = path.split('.');
    let ctx = nx, cur = nx;
    for (let i = 0; i < parts.length; i++) {
      ctx = cur;
      try { cur = cur != null ? cur[parts[i]] : undefined; } catch (e) { cur = undefined; }
    }
    return typeof cur === 'function' ? { fn: cur, ctx } : null;
  }
  const has = (k, path) => !!api(k, path);
  const warned = {};
  function missing(k, path) {
    const label = (k === 'client' ? 'Кабинет' : 'Банк') + ': NX.' + path;
    if (warned[label]) return;
    warned[label] = 1;
    if (!fnx(k)) toast((k === 'client' ? 'Кабинет клиента' : 'Панель банка') + ' ещё загружается', 'Действие «' + path + '» пропущено — повторите через пару секунд', 'warn', 'clock');
    else toast('Функция недоступна', label + ' — шаг продолжается без неё', 'warn', 'info');
    if (!fnx(k)) setTimeout(() => { delete warned[label]; }, 4000);
  }
  function call(k, path, args, opts) {
    const a = api(k, path);
    if (!a) { if (!(opts && opts.quiet)) missing(k, path); return undefined; }
    try {
      const r = a.fn.apply(a.ctx, args || []);
      if (r && typeof r.then === 'function' && typeof r.catch === 'function') r.catch((e) => { console.error('[stage] ' + path, e); errToast('Сбой в ' + FR[k].name + ' перехвачен'); });
      return r;
    } catch (e) {
      console.error('[stage] ' + k + ' NX.' + path, e);
      errToast('Сбой в ' + FR[k].name + ' перехвачен', 'NX.' + path + ' — демо продолжается');
      return undefined;
    }
  }
  function frameReady(k) {
    const nx = fnx(k);
    if (!nx) return false;
    if (k === 'client') { try { return !!(nx.Stage && typeof nx.Stage.status === 'function' && nx.Stage.status().ready); } catch (e) { return false; } }
    return !!(nx.BankStage || nx.page === 'bank');
  }
  const bothReady = () => frameReady('client') && frameReady('bank');

  // подключить stage.css и классы в документ iframe, перехват клавиш и ошибок
  function prepFrame(k) {
    const d = fdoc(k);
    if (!d || !d.documentElement || !d.head) return false;
    let href = '';
    try { href = d.location.href; } catch (e) { return false; }
    if (!href || href === 'about:blank') return false;
    const de = d.documentElement;
    // мобильная сцена: банк показывает собственную мобильную раскладку (см. stage.css, раздел 2)
    const mob = isMobile();
    if (de.classList.contains('nx-stage-mobile') !== mob) de.classList.toggle('nx-stage-mobile', mob);
    if (de.classList.contains('nx-stage-frame')) return true;
    de.classList.add('nx-stage-frame', 'nx-stage-' + k);
    if (!NO_INJECT && !d.querySelector('link[data-nx-stage]')) {
      const l = d.createElement('link');
      l.rel = 'stylesheet'; l.href = 'assets/css/stage.css'; l.setAttribute('data-nx-stage', '1');
      d.head.appendChild(l);
    }
    try { d.addEventListener('keydown', (e) => onKey(e, k)); } catch (e) { /* ignore */ }
    try { win(k).addEventListener('error', (ev) => { if (ev && ev.message && ev.message !== 'Script error.') { console.warn('[stage] ошибка в ' + FR[k].name + ': ' + ev.message + ' (' + String(ev.filename || '').split('/').pop() + ':' + ev.lineno + ')'); errToast('Сбой в ' + FR[k].name + ' перехвачен'); } }); } catch (e) { /* ignore */ }
    return true;
  }
  setInterval(() => { prepFrame('client'); prepFrame('bank'); }, 120);

  function fitFrame(k) {
    const f = FR[k];
    if (!f.host || !f.el) return;
    const W = f.host.clientWidth, H = f.host.clientHeight;
    if (!W || !H) return;
    // ПК: телефон — виртуальные 360 px, банк — не уже 920 px; мобильный: оба экрана по ширине панели (не уже 360 px)
    const s = isMobile() ? W / Math.max(W, 360) : k === 'client' ? W / f.vw : Math.min(1, W / f.vw);
    f.scale = s;
    f.el.style.width = Math.round(W / s) + 'px';
    f.el.style.height = Math.round(H / s) + 'px';
    f.el.style.transform = 'scale(' + s.toFixed(4) + ')';
  }
  function fitAll() { fitFrame('client'); fitFrame('bank'); }
  function layoutScale() {
    const w = window.innerWidth || 1366, h = window.innerHeight || 768;
    const root = document.documentElement;
    if (isMobile()) {
      // мобильная сцена: обычный rem, раскладка — в stage.css
      root.style.setProperty('--stage-scale', '1');
      fitAll();
      setTimeout(fitAll, 400);
      return;
    }
    const s = clamp(Math.min(w / 1366, h / 768), 0.72, 1.35);
    root.style.setProperty('--stage-scale', s.toFixed(3));
    const rem = 16 * s * (FL.present ? 17 / 16 : 1);
    const grid = $('#stGrid');
    const gh = grid ? grid.clientHeight : h - 3.6 * rem;
    const shellH = gh - 2 * 0.7 * rem - 1.6 * rem;
    const pw = clamp(Math.round(shellH * 0.5), 230, 440);
    root.style.setProperty('--phone-w', Math.min(pw, Math.max(230, Math.floor(w * 0.3))) + 'px');
    fitAll();
    setTimeout(fitAll, 400); // после анимации колонок
  }
  window.addEventListener('resize', layoutScale);
  function onMqChange() { prepFrame('client'); prepFrame('bank'); applyLayout(); layoutScale(); }
  if (MQ) { try { MQ.addEventListener('change', onMqChange); } catch (e) { try { MQ.addListener(onMqChange); } catch (er) { /* ignore */ } } }
  if (window.ResizeObserver) {
    try { const ro = new ResizeObserver(fitAll); ro.observe(FR.client.host); ro.observe(FR.bank.host); } catch (e) { /* ignore */ }
  }

  function cover(k, on, text) {
    const c = FR[k].cover;
    if (!c) return;
    if (text) { const sp = c.querySelector('span'); if (sp) sp.textContent = text; }
    c.classList.toggle('off', !on);
  }
  function loadFrame(k, token) {
    const f = FR[k];
    f.loaded = false; f.ready = false; f.token = token || '';
    cover(k, true, k === 'client' ? 'Загрузка кабинета…' : 'Загрузка панели банка…');
    f.el.src = frameUrl(k, token);
  }
  ['client', 'bank'].forEach((k) => {
    const f = FR[k];
    if (!f.el) return;
    f.el.addEventListener('load', () => {
      let href = '';
      try { href = f.el.contentWindow.location.href; } catch (e) { href = ''; }
      if (f.token && href.indexOf('_r=' + f.token) < 0) return; // промежуточная загрузка до нашей
      f.token = '';
      f.loaded = true;
      prepFrame(k);
      fitFrame(k);
      if (!S.prepping) cover(k, false);
      waitFor(() => frameReady(k), 6000).then(() => onFrameUp(k));
    });
  });
  function onFrameUp(k) {
    if (S.prepping) return;
    if (k === 'client') call('client', 'Stage.setPersona', ['mom'], { quiet: true });
    if (bothReady()) {
      const first = !S.framesUp;
      S.framesUp = true;
      if (S.pendingEnter) { S.pendingEnter = false; enterStep(S.step); }
      if (first) checkScene();
    } else S.pendingEnter = true;
  }

  /* ---------------- шина ---------------- */
  NX.bus.on(onBus);
  function onBus(msg, local) {
    if (!msg || local) return;
    const p = msg.payload || {};
    switch (msg.type) {
      case 'pong': if (p.page && FR[p.page]) { FR[p.page].lastPong = Date.now(); updateLink(); } break;
      case 'ready': if (p.page && FR[p.page]) { FR[p.page].ready = true; FR[p.page].lastPong = Date.now(); updateLink(); } break;
      case 'shield_alert': onShieldAlert(p); break;
      case 'guardian_push': onGuardianPush(p); break;
      case 'ioc_received': onIocReceived(p); break;
      case 'ioc': onIocExternal(p, msg, false); break;
      case 'ioc_seen': onIocExternal(p, msg, true); break;
      case 'ioc_update': onIocUpdate(p); break;
      case 'attack_start': S.ato.started = true; S.ato.steps = []; renderResult(); break;
      case 'attack_step': onAttackStep(p); break;
      case 'constitution_change': onConstChange(p); break;
      case 'guardian_request': onGuardianRequest(p); break;
      case 'protective_mode': onProtective(p); break;
      case 'manip_update': onManipUpdate(p); break;
      case 'emergency_shield': onEmergencyBus(p); break;
      case 'safe_return_case': onSafeReturnCase(p); break;
      case 'trust_circle_response':
        // ответ дан в панели банка — сцена показывает его же
        if (S.trust && S.trust.at && !S.trust.answer && (!S.trust.bankId || !p.id || String(p.id) === S.trust.bankId)) trustAnswer(p.verdict === 'ok' ? 'ok' : 'check', 'банк');
        break;
      case 'bank_call': if (SHORT) onBankCall(p); break;
      case 'reset': onExternalReset(); break;
      default: break;
    }
  }
  function ping() { NX.bus.emit('ping', { from: 'stage' }); setTimeout(updateLink, 1500); }
  setInterval(ping, 3000);
  function setChip(id, cls, text, title) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'st-chip' + (cls ? ' ' + cls : '');
    el.textContent = text;
    if (title != null) el.title = title;
    updateReady();
  }
  // одна точка готовности в шапке вместо четырёх чипов: худшее состояние, подробности — в подсказке и в справке «?»
  const CHIP_IDS = ['chipLink', 'chipLlm', 'chipVoice', 'chipScene'];
  function chipStates() {
    return CHIP_IDS.map((id) => { const el = document.getElementById(id); return el ? { cls: (el.className.match(/\b(ok|warn|bad|busy)\b/) || [''])[0], text: el.textContent, title: el.title || '' } : null; }).filter(Boolean);
  }
  function updateReady() {
    const dot = document.getElementById('stReady');
    if (!dot) return;
    const st = chipStates();
    // связь и сцена — критичные; LLM и звук — нет (без них демо идёт офлайн и текстом)
    const crit = st.filter((c, i) => i === 0 || i === 3);
    const k = crit.some((c) => c.cls === 'bad') ? 'bad' : st.some((c) => c.cls === 'busy') ? 'busy' : crit.some((c) => c.cls === 'warn') ? 'warn' : 'ok';
    dot.className = 'st-ready ' + k;
    const lbl = { ok: 'Сцена готова', warn: 'Проверьте сцену', bad: 'Нет связи', busy: 'Подготовка…' }[k];
    const t = dot.querySelector('.t'); if (t) t.textContent = lbl;
    dot.title = lbl + ' — ' + st.map((c) => c.text).join(' · ') + '. Подробнее — «?»';
  }
  function updateLink() {
    const now = Date.now();
    const okC = now - FR.client.lastPong < 7000, okB = now - FR.bank.lastPong < 7000;
    if (FR.client.dot) FR.client.dot.className = 'st-dot ' + (okC ? 'ok' : 'bad');
    if (FR.bank.dot) FR.bank.dot.className = 'st-dot ' + (okB ? 'ok' : 'bad');
    if (okC && okB) setChip('chipLink', 'ok', 'Связь клиент–банк', 'Оба экрана отвечают на пинг по шине (BroadcastChannel / localStorage)');
    else if (S.prepping) setChip('chipLink', 'busy', 'Связь…', 'Идёт подготовка сцены');
    else setChip('chipLink', 'bad', 'Связь клиент–банк: нет', (okC ? '' : 'Кабинет клиента не отвечает. ') + (okB ? '' : 'Панель банка не отвечает. ') + 'Нажмите R');
  }

  /* ---------------- LLM, голос, состояние сцены ---------------- */
  const LLM_REASON = { not_configured: 'ключ API не настроен', local_static_server: 'локальный сервер без LLM', timeout: 'таймаут', network: 'нет сети', disabled_by_flag: '?llm=off', auth: 'ошибка ключа', rate_limited: 'лимит запросов', model_not_found: 'модель недоступна' };
  function checkLlm(force) {
    if (FL.llmOff) { S.llm = { ok: false, reason: 'disabled_by_flag' }; setChip('chipLlm', 'warn', 'LLM выкл. · офлайн', 'Запущено с ?llm=off — приманка на офлайн-движке. L — включить'); updateJudgeUi(); return; }
    setChip('chipLlm', 'busy', 'LLM…');
    NX.llmStatus({ timeout: 2500, force: !!force }).then((r) => {
      S.llm = r || { ok: false };
      if (S.llm.ok) setChip('chipLlm', 'ok', /gemini/i.test(S.llm.model || '') ? 'Gemini' : 'Claude', 'LLM доступен: ' + (S.llm.model || '') + '. L — выключить');
      else setChip('chipLlm', 'warn', 'LLM: офлайн', 'Офлайн-движок: ' + (LLM_REASON[S.llm.reason] || S.llm.reason || 'недоступен') + '. Для зрителя разницы нет');
      updateJudgeUi();
    });
  }
  function initVoices() {
    if (!('speechSynthesis' in window)) { setChip('chipVoice', 'warn', 'Без озвучки', 'Браузер не поддерживает синтез речи — демо идёт текстом'); return; }
    const upd = () => {
      let vs = [];
      try { vs = window.speechSynthesis.getVoices() || []; } catch (e) { vs = []; }
      S.ruVoice = (NX.tts && NX.tts.pick('granny', 'ru')) || vs.find((v) => /^ru/i.test(v.lang)) || null;
      S.kkVoice = (NX.tts && NX.tts.pick('granny', 'kz')) || vs.find((v) => /^kk/i.test(v.lang)) || null;
      if (S.kkVoice && !/^kk/i.test(S.kkVoice.lang || '')) S.kkVoice = null;
      const vi = NX.tts ? NX.tts.info('ru') : null;
      const rec = !!(NX.tts && NX.tts.hasRecordings && NX.tts.hasRecordings());
      if (rec) S.ruVoice = S.ruVoice || { name: 'ElevenLabs', lang: 'ru-RU' };
      if (rec) setChip('chipVoice', 'ok', 'Живой голос', 'Реплики демо записаны нейросетевыми голосами ElevenLabs; свои фразы судьи читает голос браузера' + (vi && vi.voice ? ' (' + vi.name + ')' : ''));
      else if (S.ruVoice && vi && vi.quality === 'natural') setChip('chipVoice', 'ok', 'Живой голос', vi.hint + ': ' + S.ruVoice.name);
      else if (S.ruVoice) setChip('chipVoice', 'warn', 'Озвучка ru', (vi ? vi.hint : 'Русский голос') + ' · сейчас: ' + S.ruVoice.name);
      else setChip('chipVoice', 'warn', 'Без озвучки', 'Нет русского голоса — демо идёт текстом');
      if (S.judge && !S.judge.opened) S.judge.voice = !!S.ruVoice;
      updateJudgeUi();
    };
    upd();
    try { window.speechSynthesis.addEventListener('voiceschanged', upd); } catch (e) { window.speechSynthesis.onvoiceschanged = upd; }
  }
  function checkScene() {
    let n = 0, inc = 0;
    try { n = NX.iocs.all().length; } catch (e) { n = 0; }
    try { inc = NX.inbox.all().length; } catch (e) { inc = 0; }
    if (n || inc) setChip('chipScene', 'warn', 'Данные прогона · R', 'В стоп-листе ' + NX.countOf(n, ['реквизит', 'реквизита', 'реквизитов']) + ', во входящих банка ' + NX.countOf(inc, ['инцидент', 'инцидента', 'инцидентов']) + '. Нажмите R, чтобы очистить сцену');
    else setChip('chipScene', 'ok', 'Сцена готова', 'Стоп-лист и входящие пусты');
  }
  function markUsed() { if (!S.used) { S.used = true; setChip('chipScene', '', 'Идёт показ · R — сброс', 'R — подготовить сцену заново'); } }

  /* ---------------- подготовка сцены (R) ---------------- */
  // o.keepAuto — сброс по просьбе самого автопилота (A): автопилот не останавливаем
  async function prepareScene(o) {
    if (S.prepping) return;
    S.prepping = true;
    const t0 = perf();
    if (o && o.keepAuto) { if (S.judge && S.judge.apRunning) stopJudgeAuto(false); } else cancelAuto(true);
    closeDecoy(true);
    resetSession();
    setChip('chipScene', 'busy', 'Подготовка…');
    updateLink();
    cover('client', true, 'Сброс сцены…'); cover('bank', true, 'Сброс сцены…');
    try { NX.resetAll({ reload: false }); } catch (e) { console.error('[stage] resetAll', e); }
    try { if (NX.closeModal) NX.closeModal(); } catch (e) { /* ignore */ }
    await sleep(150);
    const token = Date.now().toString(36);
    loadFrame('client', token); loadFrame('bank', token);
    const ok = await waitFor(() => FR.client.loaded && FR.bank.loaded && bothReady(), 9000);
    S.prepping = false;
    cover('client', false); cover('bank', false);
    S.framesUp = bothReady();
    call('client', 'Stage.setPersona', ['mom'], { quiet: true });
    const sec = (perf() - t0) / 1000;
    let left = 0;
    try { left = NX.iocs.all().length + NX.inbox.all().length; } catch (e) { left = 0; }
    if (ok && !left) {
      setChip('chipScene', 'ok', 'Сцена готова', 'Очищено за ' + String(sec.toFixed(1)).replace('.', ',') + ' с');
      toast('Сцена готова', 'Оба экрана очищены и перезагружены за ' + String(sec.toFixed(1)).replace('.', ',') + ' с', 'ok', 'check');
    } else {
      setChip('chipScene', 'warn', 'Сцена: проверьте', ok ? 'После сброса остались данные' : 'Один из экранов загрузился не полностью');
      toast('Сцена подготовлена не полностью', ok ? 'В хранилище остались данные — нажмите R ещё раз' : 'Один из экранов не ответил — нажмите R ещё раз', 'warn');
    }
    ping();
    goStep(S.step > 0 ? 1 : 0, 0, { force: true });
  }
  let extResetAt = 0;
  function onExternalReset() {
    if (S.prepping || Date.now() - extResetAt < 3000) return;
    extResetAt = Date.now();
    cancelAuto(true);
    closeDecoy(true);
    resetSession();
    FR.client.loaded = false; FR.bank.loaded = false;
    S.framesUp = false; S.pendingEnter = true;
    cover('client', true, 'Сцена сбрасывается…'); cover('bank', true, 'Сцена сбрасывается…');
    toast('Сцена сброшена', 'Сброс пришёл из кабинета или панели банка', 'info', 'reset');
    setTimeout(() => {
      // если экраны не перезагрузились сами — перезагрузить
      if (!FR.client.loaded) loadFrame('client', Date.now().toString(36) + 'c');
      if (!FR.bank.loaded) loadFrame('bank', Date.now().toString(36) + 'b');
    }, 2500);
    goStep(S.step > 0 ? 1 : 0, 0, { force: true, noEnter: true });
  }

  /* ---------------- навигация по шагам ---------------- */
  function goStep(n, sub, o) {
    const opts = o || {};
    n = clamp(Number(n) || 0, 0, STEPS.length - 1);
    if (isSkip(n)) n = stepFrom(n, n >= S.step ? 1 : -1);
    const prev = S.step;
    const changed = prev !== n;
    if (changed) leaveStep(prev, n);
    S.step = n;
    S.maxStep = Math.max(S.maxStep || 0, n);
    const sl = STEPS[n].slides;
    S.sub = sl ? clamp(sub == null ? 0 : sub, 0, sl.length - 1) : 0;
    applyLayout();
    renderStepper();
    renderStepCard();
    renderSlides();
    if ((changed || opts.force) && !opts.noEnter) enterStep(n);
    renderResult();
    renderMetrics();
    // мобильный: новый шаг или слайд — к началу страницы, к карточке шага
    if (isMobile() && (changed || (sl && sub != null))) { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); } }
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#s=' + n + (sl ? '.' + S.sub : '')); } catch (e) { /* ignore */ }
  }
  function next() {
    const sl = STEPS[S.step].slides;
    if (sl && S.sub < sl.length - 1) return goStep(S.step, S.sub + 1);
    if (S.step < STEPS.length - 1) return goStep(stepFrom(S.step + 1, 1), 0);
    return undefined;
  }
  function prev() {
    const sl = STEPS[S.step].slides;
    if (sl && S.sub > 0) return goStep(S.step, S.sub - 1);
    if (S.step > 0) { const pi = stepFrom(S.step - 1, -1); const p = STEPS[pi]; return goStep(pi, p.slides ? p.slides.length - 1 : 0); }
    return undefined;
  }
  function primary() {
    const st = S.step;
    if (STEPS[st].slides) return next();
    if (st === 1) { if (!S.call.started || (S.call.ended && !S.call.alertAt)) return runCall(); return next(); }
    if (st === 2) {
      if (!S.judge.open) return openDecoy();
      if (!S.iocs.length && !S.judge.apRunning) return startJudgeAuto('space');
      // автопилот уже идёт, реквизита ещё нет: не уходим к банку без IOC
      if (!S.iocs.length && S.judge.apRunning) { toast('Автопилот мошенника уже идёт', 'Реквизит прозвучит в 3-й реплике. → — пропустить шаг без реквизита', 'info', 'play'); return undefined; }
      return next();
    }
    if (st === 4 && S.ran[4] && S.second && S.second.ok && !S.trust.answer) return trustAnswer('check', 'ведущий');
    if (st === 5) return primary5();
    if (st === 6 && SHORT) return S.vcall.started ? next() : runVerified();
    if (st === 6) return primary6();
    if (isMore(st)) return NX.StageMore.primary();
    if (!S.ran[st]) return runStep(st);
    return next();
  }
  // шаг 5: якорь (мошенник уговаривает ослабить конституцию), затем дальше; ATO — отдельной кнопкой
  function primary5() {
    const A = S.anchor;
    if (!A.started) return runAnchor();
    if (!A.done) { toast('Правило 24 часов проверяет изменение', 'Результат появится через пару секунд', 'info', 'clock'); return undefined; }
    if (S.ato.requested && !S.ato.done) { toast('Захват аккаунта идёт в телефоне', '→ — перейти дальше, не дожидаясь конца', 'info', 'play'); return undefined; }
    return next();
  }
  // шаг 6: «Заблокировать всё» → «Меня обманули» → дальше
  function primary6() {
    const F = S.fusion;
    if (!F.shield) return runFusion();
    if (!F.recoverShown) return showRecover();
    return next();
  }
  function runStep(n) {
    if (n === 1) return runCall();
    if (n === 2) return openDecoy();
    if (n === 3) return runBank();
    if (n === 4) return runSecond();
    if (n === 5) return primary5();
    if (n === 6) return SHORT ? runVerified() : primary6();
    return undefined;
  }
  function leaveStep(p, n) {
    if (p === 1 && S.manipPoll) { clearInterval(S.manipPoll); S.manipPoll = null; }
    if (p === 2 && n !== 2) closeDecoy(false);
    if (p === 5 && n !== 5 && ((S.ato && S.ato.done) || (S.anchor.done && !S.ato.requested))) call('client', 'closeModal', [], { quiet: true });
    // уходим с шага 5: «звонок» из сцены якоря (5а) не должен жить дальше (отказы «во время звонка», галка SDK в переводе)
    if (p === 5 && n !== 5 && (S.anchor.started || S.ato.requested)) call('client', 'Stage.setCallActive', [false], { quiet: true });
    if (isMore(p) && n !== p) NX.StageMore.leave();
    // короткий показ: окно инцидента в банке не остаётся открытым после бита 5
    if (SHORT && p === 6 && n !== 6 && S.vcall.started) call('bank', 'closeModal', [], { quiet: true });
  }
  function enterStep(n) {
    if (!S.framesUp || !bothReady()) { S.pendingEnter = true; return; }
    renderPush();
    if (n === 1) {
      call('client', 'Stage.setPersona', ['mom'], { quiet: true });
      call('client', 'Stage.goto', ['shield']);
      call('bank', 'BankStage.go', ['overview'], { quiet: true });
    } else if (n === 2) {
      call('bank', 'BankStage.go', ['overview'], { quiet: true });
      if (!S.judge.open) openDecoy();
    } else if (n === 3) {
      if (!S.ran[3]) call('bank', 'BankStage.go', ['graph'], { quiet: true });
    } else if (n === 4) {
      if (!S.ran[4]) call('bank', 'BankStage.go', ['overview'], { quiet: true });
    } else if (n === 5) {
      if (!S.ran[5]) call('client', 'Stage.goto', ['overview'], { quiet: true });
    } else if (n === 6 && SHORT) {
      if (!S.ran[6]) { call('client', 'Stage.goto', ['overview'], { quiet: true }); call('bank', 'BankStage.go', ['incidents'], { quiet: true }); }
    } else if (n === 6) {
      if (!S.ran[6]) { call('client', 'Stage.goto', ['overview'], { quiet: true }); call('bank', 'BankStage.go', ['overview'], { quiet: true }); }
    } else if (isMore(n)) {
      call('client', 'closeModal', [], { quiet: true }); call('bank', 'closeModal', [], { quiet: true });
      NX.StageMore.enter();
    } else if (n === LAST) {
      refreshDynamicSlides();
    }
    setRibbon(n >= 2 && n <= 4 && S.judge.open ? 'decoy' : null);
  }
  function applyLayout() {
    const b = document.body;
    const lay = STEPS[S.step].layout;
    ['lay-slides', 'lay-client', 'lay-decoy', 'lay-bank'].forEach((c) => b.classList.toggle(c, c === 'lay-' + lay));
    $('#judgeCard').classList.toggle('hidden', !(S.step === 2 && S.judge.open && S.judge.mode === 'console'));
    // мобильная вкладка по умолчанию — экран, где сейчас главное; выбор ведущего держится до смены шага
    if (S.mTabUserStep !== S.step) setMTab(lay === 'bank' ? 'bank' : 'phone', false);
    setTimeout(fitAll, 30); setTimeout(fitAll, 420);
  }
  function setMTab(t, user) {
    const tab = t === 'bank' ? 'bank' : 'phone';
    S.mTab = tab;
    if (user) S.mTabUserStep = S.step;
    const b = document.body;
    b.classList.toggle('m-tab-phone', tab === 'phone');
    b.classList.toggle('m-tab-bank', tab === 'bank');
    const tp = $('#mTabPhone'), tb = $('#mTabBank');
    if (tp) tp.setAttribute('aria-selected', String(tab === 'phone'));
    if (tb) tb.setAttribute('aria-selected', String(tab === 'bank'));
    setTimeout(fitAll, 30);
  }

  /* ---------------- верх: степпер ---------------- */
  function renderStepper() {
    const nav = $('#stepper');
    if (!nav) return;
    // короткий показ: в степпере 5 битов, кнопка ведёт на первый шаг бита
    if (BEATS) nav.innerHTML = BEATS.map((b) => {
      const on = STEPS[S.step].beat === b.n;
      const done = !on && STEPS.some((s, k) => s.beat === b.n && S.ran[k]);
      return '<button type="button" class="st-step' + (on ? ' active' : '') + (done ? ' done' : '') + '" data-step="' + b.first + '" title="' + esc('Бит ' + b.n + '. ' + b.short) + '"' + (on ? ' aria-current="step"' : '') + '><span class="n">' + b.n + '</span><span class="lbl">' + esc(b.short) + '</span></button>';
    }).join('');
    else nav.innerHTML = STEPS.map((s, i) => {
      const gated = isGated(i);
      const cls = 'st-step' + (i === S.step ? ' active' : '') + (S.ran[i] && i !== S.step ? ' done' : '') + (gated ? ' gated' : '') + (i === 0 || i === LAST ? ' ico' : '');
      const lbl = s.short;
      // вступление и финал — значки, шаги демо — 1–7
      const n = i === 0 ? ic('play', 14) : i === LAST ? ic('flag', 14) : String(i);
      const tip = gated ? 'сначала завершите шаг' : (i === 0 ? 'Вступление' : i === LAST ? 'Финал' : 'Шаг ' + i + ' из ' + (LAST - 1)) + '. ' + s.title;
      return '<button type="button" class="' + cls + '" data-step="' + i + '" title="' + esc(tip) + '"' + (gated ? ' aria-disabled="true"' : '') + (i === S.step ? ' aria-current="step"' : '') + '><span class="n" aria-hidden="true">' + n + '</span><span class="lbl">' + esc(lbl) + '</span></button>';
    }).join('');
    if (isMobile()) {
      const act = nav.querySelector('.st-step.active');
      const x = act ? Math.max(0, act.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft - 16) : 0;
      if (act) { try { nav.scrollTo({ left: x, behavior: 'smooth' }); } catch (e) { nav.scrollLeft = x; } }
    }
  }

  /* ---------------- центр: карточка шага ---------------- */
  function renderStepCard() {
    const box = $('#stepCard');
    if (!box) return;
    const s = STEPS[S.step];
    const kicker = SHORT ? '3 минуты · бит ' + s.beat + ' из ' + BEATS.length
      : S.step === 0 ? 'Вступление' : S.step === LAST ? 'Финал' : 'Шаг ' + S.step + ' из ' + (LAST - 1);
    // пуш с действием заменяет карточку шага (не стоит под ней): остаётся одна строка «на что смотреть»
    box.classList.toggle('st-collapsed', pushActive());
    let actions = '';
    const mob = isMobile();
    const key = mob ? '' : ' · Space';
    if (s.slides) actions = '<button type="button" class="btn primary sm" data-act="primary">' + (S.step === 0 ? 'Начать демо →' : 'Дальше →') + '</button>';
    else {
      actions = '<button type="button" class="btn primary sm" data-act="primary">' + esc(primaryLabel()) + key + '</button>';
      if (S.step === 2 && mob) actions += '<button type="button" class="btn sm" data-act="judgeAuto">' + (S.judge.apRunning ? 'Остановить автопилот' : 'Автопилот мошенника') + '</button>';
      // «Почему?» — только после завершения цепочки захвата аккаунта: во время прогона закрытие окна в телефоне прервёт атаку
      if (S.step === 5 && S.ato && S.ato.done) actions += '<button type="button" class="btn sm" data-act="why">Почему?</button>';
      if (S.step === 5 && S.anchor.done && !S.anchor.skipped && !S.ato.requested) actions += '<button type="button" class="btn sm" data-act="ato">Если клиент поддался</button>';
      if (S.step === 3 && S.ran[3]) actions += '<button type="button" class="btn sm" data-act="openIoc">Карточка реквизита</button>';
      if (S.step === 6 && S.fusion.shield) actions += '<button type="button" class="btn sm" data-act="bankInc">Инциденты банка</button>';
    }
    const capSlides = SHORT ? (mob ? 'Слайды листаются кнопками внизу. 3-минутный показ — 5 битов.' : 'Слайды: ← → или Space. 3-минутный показ — 5 битов, A — автопилот на 3:00.')
      : mob ? 'Слайды листаются кнопками внизу. Демо — 7 шагов + финал.' : 'Слайды: ← → или Space. Демо — 7 шагов + финал.';
    box.innerHTML = '<div class="st-kicker">' + esc(kicker) + '</div><h2>' + esc(s.title) + '</h2>' +
      (s.cap ? '<p class="st-cap">' + esc(s.cap) + '</p>' : '<p class="st-cap">' + esc(capSlides) + '</p>') +
      '<div class="st-actions">' + actions + '</div><div class="st-state hidden" id="stepState"></div>';
    if (S.state && S.state.step === S.step) paintState();
    renderMBar();
  }
  // мобильная нижняя панель: ← действие шага →
  function renderMBar() {
    const bar = $('#mBar');
    if (!bar) return;
    const s = STEPS[S.step];
    const main = $('#mBarMain');
    let lbl;
    if (s.slides) lbl = S.step === 0 ? (S.sub < s.slides.length - 1 ? 'Дальше' : 'Начать демо') : (S.sub < s.slides.length - 1 ? 'Дальше' : 'Финал');
    else lbl = primaryLabel();
    if (main) { main.textContent = lbl; main.title = lbl; main.disabled = !!(s.slides && S.step === STEPS.length - 1 && S.sub >= s.slides.length - 1); }
    const pv = bar.querySelector('[data-act="prev"]'), nx = bar.querySelector('[data-act="next"]');
    if (pv) pv.disabled = S.step === 0 && S.sub === 0;
    if (nx) nx.disabled = S.step === STEPS.length - 1 && (!s.slides || S.sub >= s.slides.length - 1);
    // на телефоне степпер живёт здесь: «Шаг 3/7»
    const ms = $('#mStep');
    if (ms) ms.textContent = SHORT ? 'Бит ' + s.beat + '/' + BEATS.length : S.step === 0 ? 'Начало' : S.step === LAST ? 'Финал' : 'Шаг ' + S.step + '/' + (LAST - 1);
  }
  // вперёд можно на следующий шаг; дальше — только после него («сначала завершите шаг»)
  function isGated(i) { return !SHORT && i > (S.maxStep || 0) + 1; }
  // пуш с действием (опекун во время звонка, запрос сыну Сауле Д.) заменяет карточку шага
  function pushActive() {
    if (S.step === 1) return !!S.push;
    if (S.step === 4) return !!(S.second && S.second.ok && S.trust && S.trust.at && !S.trust.answer);
    return false;
  }
  function primaryLabel() {
    const st = S.step;
    if (st === 1) return S.call.started && !(S.call.ended && !S.call.alertAt) ? 'Дальше: номер-ловушка' : STEPS[1].action;
    if (st === 2) return !S.judge.open ? STEPS[2].action : (S.iocs.length ? 'Дальше: банк' : S.judge.apRunning ? 'Автопилот идёт…' : 'Автопилот сейчас');
    if (st === 4 && S.ran[4] && S.second && S.second.ok && !S.trust.answer) return 'Ерлан: нужна проверка';
    if (st === 4 && S.ran[4]) return SHORT ? 'Дальше: панель банка' : 'Дальше: правило 24 часов';
    if (st === 6 && SHORT) return S.vcall.started ? 'Дальше: финал' : STEPS[6].action;
    if (st === 5) {
      const A = S.anchor;
      if (!A.started) return STEPS[5].action;
      if (!A.done) return 'Правило проверяет…';
      if (S.ato.requested && !S.ato.done) return 'Захват аккаунта идёт…';
      return 'Дальше: схема целиком';
    }
    if (st === 6) {
      if (!S.fusion.shield) return STEPS[6].action;
      if (!S.fusion.recoverShown) return '«Меня обманули»: если деньги ушли';
      return MORE > 0 ? 'Дальше: не только звонки' : 'Дальше: финал';
    }
    if (isMore(st)) return NX.StageMore.label();
    if (S.ran[st]) return 'Дальше';
    return STEPS[st].action || 'Дальше';
  }
  // html — уже экранированный текст (только литералы сцены и esc(...))
  function setState(html, kind, step) {
    S.state = { step: step == null ? S.step : step, html, kind: kind || '' };
    if (S.state.step === S.step) paintState();
  }
  function paintState() {
    const el = $('#stepState');
    const st = S.state;
    if (!el || !st) return;
    el.className = 'st-state' + (st.kind ? ' ' + st.kind : '');
    const icon = st.kind === 'ok' ? 'check' : st.kind === 'bad' || st.kind === 'warn' ? 'alert' : 'clock';
    el.innerHTML = ic(icon, 16) + '<span>' + st.html + '</span>';
  }

  /* ================= ШАГ 1: ЗВОНОК ================= */
  const CODE_RE = /(^|[^а-яё])(код|кода|коды|смс|пароль)|sms/i;
  function runCall() {
    if (!bothReady()) { setState('Ждём загрузку кабинета и панели банка…', 'warn'); waitFor(bothReady, 8000).then((ok) => { if (ok) runCall(); else setState('Экраны не загрузились — нажмите R', 'bad'); }); return; }
    S.ran[1] = true; markUsed();
    call('client', 'Stage.setPersona', ['mom'], { quiet: true });
    call('client', 'Stage.goto', ['shield']);
    call('bank', 'BankStage.go', ['overview'], { quiet: true });
    if (!has('client', 'Shield.runDemo')) { setState('Защита звонка недоступна в кабинете — переходите к шагу 2', 'bad'); renderStepCard(); return; }
    const start = () => {
      if (S.call.poll) clearInterval(S.call.poll);
      S.call = freshCall();
      S.call.started = true; S.call.t0 = Date.now();
      S.metrics.tta = null; S.metrics.lead = null; S.metrics.stagesAtAlert = null; S.metrics.stagesOf = null; S.metrics.stagesSrc = '';
      S.manip = freshManip();
      call('client', 'Shield.runDemo');
      renderStepCard();
      setState('Идёт демо-звонок · детектор манипуляций разбирает речь звонящего…', '');
      S.call.poll = setInterval(pollCall, 200);
      if (S.manipPoll) clearInterval(S.manipPoll);
      S.manipPoll = setInterval(manipTick, 500);
      renderResult();
    };
    const cnx = fnx('client');
    const consent = cnx && cnx.Consent;
    let hasConsent = true;
    try { hasConsent = !consent || typeof consent.has !== 'function' || consent.has(); } catch (e) { hasConsent = true; }
    if (hasConsent) return start();
    if (S.auto) {
      call('client', 'Stage.consent', [true], { quiet: true });
      // окно согласия могло открыться при входе в кабинет: после согласия закрыть его (безвредно, если окна нет)
      call('client', 'closeModal', [], { quiet: true });
      toast('Согласие на анализ звонка', 'В автопилоте согласие дано ведущим (демо)', 'info', 'shieldCheck'); return start(); }
    if (typeof consent.require !== 'function') return start();
    S.call.consentWait = true;
    renderStepCard();
    setState('В телефоне — экран согласия на анализ звонка. Нажмите «Согласен, включить защиту».', 'warn');
    try {
      consent.require(start).then((ok) => { if (!ok) setState('Согласие не дано — анализ звонка не запущен. Space — спросить ещё раз.', 'warn'); });
    } catch (e) { start(); }
    return undefined;
  }
  function pollCall() {
    const c = S.call;
    const d = fdoc('client');
    if (!d) return;
    const lines = d.querySelectorAll('#transcript .tline.s');
    let finals = 0;
    for (let i = 0; i < lines.length; i++) {
      const el = lines[i];
      const interim = el.classList.contains('interim');
      if (!interim) finals++;
      if (!c.codeAt) {
        const who = el.querySelector('.who');
        let t = el.textContent || '';
        if (who) t = t.slice((who.textContent || '').length);
        if (CODE_RE.test(t)) { c.codeAt = Date.now(); c.codePhrase = interim ? finals + 1 : finals; computeLead(); renderResult(); renderMetrics(); }
      }
    }
    c.finals = finals;
    const pcard = d.querySelector('.phone-card');
    const live = !!(pcard && pcard.classList.contains('live'));
    if ((Date.now() - c.t0 > 2500 && !live) || Date.now() - c.t0 > 90000) {
      clearInterval(c.poll); c.poll = null;
      c.ended = true; c.total = finals;
      manipTick();
      if (S.manipPoll) { clearInterval(S.manipPoll); S.manipPoll = null; }
      if (c.alertAt) setState('Звонок завершён. Тревога ' + (S.metrics.lead != null && S.metrics.lead > 0 ? 'за ' + secTxt(S.metrics.lead) + ' до просьбы кода' : 'зафиксирована') + '. Space — номер-ловушка.', 'ok', 1);
      else setState('Звонок завершён без тревоги. Space — повторить.', 'warn', 1);
      renderStepCard();
      renderResult(); renderMetrics();
    }
  }
  function computeLead() {
    const c = S.call;
    if (c.alertAt && c.codeAt) S.metrics.lead = c.codeAt - c.alertAt;
  }
  function onShieldAlert(p) {
    const c = S.call;
    if (!c || c.alertAt) return;
    c.alertAt = Date.now();
    c.score = p.score != null ? Math.round(Number(p.score) || 0) : null;
    c.category = String(p.category || '');
    const d = fdoc('client');
    if (d) {
      const lines = d.querySelectorAll('#transcript .tline.s');
      let finals = 0, interim = false;
      for (let i = 0; i < lines.length; i++) { if (lines[i].classList.contains('interim')) interim = true; else finals++; }
      c.phrase = interim ? finals + 1 : Math.max(1, finals);
    }
    if (c.t0) S.metrics.tta = c.alertAt - c.t0;
    computeLead();
    // «стадий манипуляции до тревоги»: сколько стадий детектор уже распознал в момент тревоги
    manipTick();
    captureStagesAtAlert();
    setState('Тревога: индекс риска ' + (c.score != null ? c.score : '—') + (c.phrase ? ' на фразе ' + c.phrase : '') + (S.metrics.stagesAtAlert != null ? ' · ' + NX.countOf(S.metrics.stagesAtAlert, ['стадия', 'стадии', 'стадий']) + ' манипуляции' : '') + '. Айгерим получает пуш.', 'bad', 1);
    renderStepCard(); renderResult(); renderMetrics();
  }

  /* ---------- детектор манипуляций (UNDERSTAND + PREDICT) ---------- */
  const STAGE_RU = { authority: 'Имитация авторитета', fear: 'Манипуляция страхом', urgency: 'Искусственная срочность', isolation: 'Изоляция жертвы', access: 'Попытка получить доступ', app: 'Просьба открыть банковское приложение', money: 'Перевод денег' };
  function stageLabel(id) {
    try { const st = (NX.Manip && NX.Manip.STAGES) || []; const f = st.find((x) => x.id === id); if (f && f.label) return String(f.label); } catch (e) { /* ignore */ }
    return STAGE_RU[id] || String(id || '');
  }
  // приводим результат NX.Manip (из кабинета, шины или сцены) к одному виду
  function normManip(p) {
    if (!p || typeof p !== 'object') return null;
    const stages = (Array.isArray(p.stages) ? p.stages : []).filter(Boolean).map((s) => (typeof s === 'string'
      ? { id: s, label: stageLabel(s), quote: '', line: null }
      : { id: String(s.id || ''), label: String(s.label || stageLabel(s.id)), quote: String(s.quote || ''), line: s.line != null ? Number(s.line) : null }));
    const at = p.attackType && typeof p.attackType === 'object' ? p.attackType : null;
    const sc = p.scenario && typeof p.scenario === 'object' ? p.scenario : null;
    const pr = p.pressure && typeof p.pressure === 'object' ? p.pressure : null;
    const nx = p.next && typeof p.next === 'object' && p.next.label ? p.next : null;
    return {
      attackType: at && (at.label || at.en) ? { id: String(at.id || ''), label: String(at.label || at.en), en: String(at.en || '') } : null,
      stages,
      pressure: pr ? { level: String(pr.level || ''), score: Math.round(Number(pr.score) || 0) } : null,
      scenario: sc ? { template: String(sc.template || ''), matched: Math.round(Number(sc.matched) || 0), of: Math.round(Number(sc.of) || 0), inOrder: !!sc.inOrder } : null,
      riskIndex: p.riskIndex != null && isFinite(Number(p.riskIndex)) ? Math.round(Number(p.riskIndex)) : null,
      next: nx ? { id: String(nx.id || ''), label: String(nx.label), advice: String(nx.advice || '') } : null,
      recommendation: String(p.recommendation || ''),
    };
  }
  function setManip(res, src) {
    if (!res) return;
    const M = S.manip;
    // результат кабинета приоритетнее разбора сцены
    if (src === 'scene' && M.src === 'client' && Date.now() - M.at < 4000) return;
    if (src === 'scene' && !res.stages.length && !M.res) return;
    M.res = res; M.src = src; M.at = Date.now();
    if (M.pendingAlert && res.stages.length) captureStagesAtAlert();
    renderResult(); renderMetrics();
  }
  function onManipUpdate(p) {
    if (!S.call || !S.call.started) return;
    if (p && p.client && /сауле/i.test(String(p.client))) return; // только звонок Гульнаре-апа
    setManip(normManip(p), 'client');
  }
  // реплики звонящего из расшифровки в телефоне (для разбора сценой, если кабинет не прислал результат)
  function callerLines() {
    const d = fdoc('client');
    if (!d) return [];
    const out = [];
    d.querySelectorAll('#transcript .tline.s').forEach((el) => {
      if (el.classList.contains('interim')) return;
      const who = el.querySelector('.who');
      let t = el.textContent || '';
      if (who) t = t.slice((who.textContent || '').length);
      t = t.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    });
    return out;
  }
  function manipTick() {
    if (!S.call || !S.call.started) return;
    const r = call('client', 'Stage.manip', [], { quiet: true });
    if (r && typeof r === 'object' && typeof r.then !== 'function') { const n = normManip(r); if (n && (n.stages.length || n.attackType)) { setManip(n, 'client'); return; } }
    if (!NX.Manip || typeof NX.Manip.analyze !== 'function') return;
    const lines = callerLines();
    const key = lines.join('\n');
    if (!lines.length || key === S.manip.lastLocal) return;
    S.manip.lastLocal = key;
    let res = null;
    try { res = normManip(NX.Manip.analyze(lines)); } catch (e) { console.error('[stage] manip', e); res = null; }
    setManip(res, 'scene');
  }
  function captureStagesAtAlert() {
    const M = S.metrics, R = S.manip.res;
    if (M.stagesAtAlert != null) return;
    if (!R || !R.stages.length) { S.manip.pendingAlert = !!(S.call && S.call.alertAt); return; }
    // если результат пришёл позже тревоги (шина не чаще 2 раз/с) — берём не позднее 1,5 с после неё
    if (S.call && S.call.alertAt && S.manip.at - S.call.alertAt > 1500) { S.manip.pendingAlert = false; return; }
    M.stagesAtAlert = R.stages.length;
    M.stagesOf = R.scenario && R.scenario.of ? R.scenario.of : null;
    M.stagesSrc = S.manip.src;
    S.manip.pendingAlert = false;
  }
  // риск словом: те же пороги 25 / 55, что NX.ui.riskWord и NX.scoreTransfer; число — в заметках ведущего и bench.html
  const riskWordOf = (score) => { try { if (NX.ui && NX.ui.riskWord) return NX.ui.riskWord(score).word; } catch (e) { /* ignore */ } const s = Number(score) || 0; return s >= 55 ? 'высокий' : s >= 25 ? 'средний' : 'низкий'; };
  function manipHtml() {
    const R = S.manip.res;
    if (!R) return '';
    const track = R.stages.map((s, i) => '<span class="st-stage on" title="' + esc(s.quote ? '«' + s.quote + '»' : s.label) + '"><i>' + (i + 1) + '</i>' + esc(s.label) + '</span>').join('');
    return '<div class="title indigo">' + ic('brain', 18) + esc(R.attackType && R.attackType.label ? R.attackType.label : 'Схема давления') + '</div>' +
      (track ? '<div class="st-stages">' + track + '</div>' : '<p class="st-sub">Этапов давления пока нет — NEXUS слушает дальше.</p>') +
      (R.next ? '<p class="st-next">' + ic('target', 14) + '<span><b>Дальше попросят:</b> ' + esc(R.next.label) + '</span></p>' : '');
  }
  function onGuardianPush(p) {
    S.push = { ward: String(p.ward || CLIENT_LABEL), guardian: String(p.guardian || 'Айгерим Нурланова'), score: p.score, category: String(p.category || ''), quote: String(p.quote || ''), at: Date.now() };
    renderPush();
  }
  function syncCollapse() { const sc = $('#stepCard'); if (sc) sc.classList.toggle('st-collapsed', pushActive()); }
  function renderPush() {
    const box = $('#pushCard');
    if (!box) return;
    if (S.step === 4) { renderTrustPush(box); syncCollapse(); return; }
    // пуш опекуну — только на шаге 1: на шаге 2 звонок уже у номера-ловушки
    if (!S.push || S.step !== 1) { box.classList.add('hidden'); syncCollapse(); return; }
    const p = S.push;
    const g = p.guardian.split(' ')[0] || 'Опекун';
    const html = '<div class="st-push-app"><span>' + ic('users', 12) + ' Телефон дочери</span><span>' + esc(NX.hm(p.at)) + '</span></div>' +
      '<b>' + esc(g) + ', маме звонит мошенник</b>' +
      '<p>Риск: ' + esc(riskWordOf(p.score)) + (S.metrics.lead != null ? (S.metrics.lead > 0 ? ' · за ' + secTxt(S.metrics.lead) + ' до кода' : ' · после кода') : '') + '</p>' +
      '<div class="st-actions"><button type="button" class="btn sm primary" data-act="toDecoy">Звонок → номер-ловушка</button></div>';
    if (box.innerHTML !== html) box.innerHTML = html;
    box.classList.remove('hidden');
    syncCollapse();
  }
  // Близкие второго клиента: запрос на проверку сыну Сауле Д. — без реквизитов, сумма округлена
  function renderTrustPush(box) {
    const r = S.second, T = S.trust;
    if (!r || !r.ok || !T.at) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    // сумма округлена так же, как в Близкие банка: доверенное лицо не видит точных данных
    const amtTxt = '≈ ' + Math.max(10, Math.round((Number(r.amount) || SECOND.amount) / 10000) * 10) + ' тыс ₸';
    let foot;
    if (!T.answer) foot = '<div class="st-actions"><button type="button" class="btn sm primary" data-act="trustCheck">Нужна проверка</button><button type="button" class="btn sm" data-act="trustOk">Я рядом</button></div>';
    else if (T.answer === 'check') foot = '<p class="st-trust-ans ok">' + ic('check', 14) + '<span>' + esc(SON) + ': «Нужна проверка» — перевод остаётся удержанным' + (T.by === 'автопилот' ? ' (ответил автопилот)' : T.by === 'судья с телефона' ? ' — ответ пришёл с телефона судьи' : '') + '.</span></p>';
    else foot = '<p class="st-trust-ans">' + ic('info', 14) + '<span>' + esc(SON) + ': «Всё в порядке, я рядом». Решение всё равно за банком.</span></p>';
    // ответ дан — от пуша остаётся одна строка ответа
    const html = T.answer ? foot : '<div class="st-push-app"><span>' + ic('users', 12) + ' Телефон сына</span><span>' + esc(NX.hm(T.at)) + '</span></div>' +
      '<b>' + esc(SON) + ', маме звонит мошенник?</b>' +
      '<p>' + esc(amtTxt) + ' новому получателю во время звонка — удержано.</p>' +
      foot;
    if (box.innerHTML !== html) box.innerHTML = html;
    box.classList.remove('hidden');
  }
  // для stage-phone.js: ответ с телефона судьи
  NX.StageApi = Object.assign(NX.StageApi || {}, {
    trustAnswer: (v, by) => trustAnswer(v, by),
    trustPending: () => !!(S.trust && S.trust.at && !S.trust.answer),
  });
  // автопилот: если телефон судьи подключён — ждём его ответа до 25 с
  async function waitPhoneAnswer(alive) {
    if (!NX.StagePhone || !NX.StagePhone.connected()) return;
    const t0 = Date.now();
    while (alive() && S.trust.at && !S.trust.answer && Date.now() - t0 < 25000) await new Promise((r) => setTimeout(r, 250));
  }
  function trustAnswer(v, by) {
    const T = S.trust;
    if (!T.at || T.answer) return;
    T.answer = v === 'ok' ? 'ok' : 'check'; T.answeredAt = Date.now(); T.by = by || 'судья';
    if (NX.StagePhone) { try { NX.StagePhone.answered(T.answer, T.by); } catch (e) { console.error('[stage-phone]', e); } }
    // ответ — в инцидент банка (Близкие в Fraud Fusion Center), если панель это умеет
    if (by !== 'банк') {
      // NX.BankStage.trustCircleRespond(verdict 'ok' | 'hold', id?)
      if (has('bank', 'BankStage.trustCircleRespond')) call('bank', 'BankStage.trustCircleRespond', [T.answer === 'ok' ? 'ok' : 'hold', T.bankId || null], { quiet: true });
    }
    renderPush(); renderStepCard(); renderResult();
    if (T.answer === 'check') setState(esc(SON) + ' попросил проверку: удержание подтверждено, перевод ждёт решения аналитика. Space — дальше.', 'ok', 4);
    else setState(esc(SON) + ' рядом с мамой — но решение остаётся за банком: реквизит в стоп-листе. Space — дальше.', 'ok', 4);
    toast('Близкие · ' + SON, T.answer === 'check' ? 'Нужна проверка — удержание подтверждено' : 'Всё в порядке — я рядом · решение за банком', 'ok', 'users');
  }

  /* ================= ШАГ 2: «СЫГРАЙТЕ МОШЕННИКА» ================= */
  // Реплики приманки (офлайн-движок) и пост-фильтр — общий модуль assets/js/decoy-engine.js (NX.DecoyEngine):
  // тот же код проверяет самопроверка bench.html (часть 3). Приманка играет Гульнару-апа, 63:
  // тянет время и выспрашивает, куда переводить; сама никаких цифр и данных не называет.
  const DE = NX.DecoyEngine;
  const LINES = DE.LINES;
  const KZ_RE = DE.KZ_RE;
  function filterReply(t) { return DE.filter(t, S.judge.replies || 0); }
  const foundKey = DE.foundKey;
  function decoyOffline(text, found) { return DE.reply(S.judge, text, found); }
  async function llmDecoy(history) {
    if (FL.llmOff || !S.llm || !S.llm.ok || typeof fetch !== 'function') return null;
    let ctrl = null;
    try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
    const timer = setTimeout(() => { try { if (ctrl) ctrl.abort(); } catch (e) { /* ignore */ } }, 5000);
    try {
      const r = await fetch(NX.llmEndpoint || 'api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ mode: 'decoy', messages: history.slice(-12).map((m) => ({ role: m.role, content: typeof NX.maskPII === 'function' ? NX.maskPII(String(m.content || '')) : m.content })) }) /* ПДн маскируются и в браузере, и на сервере */, signal: ctrl ? ctrl.signal : undefined });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && typeof j.reply === 'string' && j.reply.trim()) return { text: j.reply, filtered: !!j.filtered };
      NX.llmMarkDown((j && j.error) || 'http_' + r.status);
      S.llm = { ok: false, reason: 'request_failed' };
    } catch (e) {
      NX.llmMarkDown(e && e.name === 'AbortError' ? 'timeout' : 'network');
      S.llm = { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally { clearTimeout(timer); }
    setChip('chipLlm', 'warn', 'LLM: офлайн', 'Запрос к LLM не удался — приманка перешла на офлайн-движок, перепроверка через 30 с');
    setTimeout(() => checkLlm(true), 30000);
    updateJudgeUi();
    return null;
  }

  function setRibbon(kind) {
    const r = $('#phoneRibbon');
    if (!r) return;
    if (!kind) { r.classList.add('hidden'); return; }
    r.innerHTML = '<b>' + ic('shieldCheck', 14) + ' Звонок переадресован на номер-ловушку банка</b>Клиентка в безопасности — с мошенником говорит ИИ-приманка.';
    r.classList.remove('hidden');
  }
  function openDecoy() {
    if (!bothReady()) { setState('Ждём загрузку экранов…', 'warn'); waitFor(bothReady, 8000).then((ok) => { if (ok && S.step === 2) openDecoy(); }); return; }
    const J = S.judge;
    if (J.open) return;
    S.ran[2] = true; markUsed();
    const reopen = !!J.opened; // вернулись на шаг 2: продолжаем ту же сессию ловушки
    // клиентка кладёт трубку: звонок уходит на номер-ловушку
    call('client', 'Shield.stop', ['Клиентка положила трубку — звонок переадресован на номер-ловушку банка'], { quiet: true });
    NX.bus.emit('call_state', { active: false, source: 'stage', client: CLIENT_NAME });
    J.open = true; J.opened = true; J.idleAt = Date.now();
    if (!J.t0) J.t0 = Date.now();
    else if (J.t1) J.t0 += Date.now() - J.t1; // время вне шага 2 не считается временем сессии
    J.t1 = 0;
    J.mode =has('client', 'Decoy.startInteractive') ? 'client' : 'console';
    if (J.mode === 'client') {
      call('client', 'Stage.goto', ['decoy']);
      if (!reopen) call('client', 'Decoy.startInteractive');
      setState('Пульт мошенника — в телефоне: судья пишет или говорит реплики там.', '', 2);
    } else {
      call('client', 'Stage.goto', ['overview'], { quiet: true });
      NX.bus.emit('decoy_start', { client: CLIENT_NAME, source: 'stage' });
      if (!reopen) addMsg('decoy', LINES.ru.open[0], null, null);
      setState(S.iocs.length ? 'Реквизит уже в стоп-листе. Space — дальше, к банку.' : 'Судья, вы — мошенник: просто начните печатать (или M — говорить). Представьтесь, попросите код, назовите свой счёт или номер. Молчание &gt; 20 с — автопилот.', S.iocs.length ? 'ok' : '', 2);
    }
    setRibbon('decoy');
    if (J.timer) clearInterval(J.timer);
    J.timer = setInterval(judgeTick, 1000);
    applyLayout();
    renderStepCard();
    updateJudgeUi();
    renderMetrics();
    // поле реплики НЕ фокусируется само: иначе горячие клавиши J / M / A / R / цифры печатались бы в него.
    // Фокус — по клику в поле или по первой печатной клавише (см. onKey → forwardToJudge).
  }
  function closeDecoy(silent) {
    const J = S.judge;
    if (!J || !J.open) return;
    J.open = false;
    J.t1 = Date.now(); // реальное время сессии замораживается на закрытии
    J.apToken++; J.apRunning = false;
    stopMic(true);
    if (J.timer) { clearInterval(J.timer); J.timer = null; }
    const ap = $('#judgeAp'); if (ap) ap.classList.add('hidden');
    const inp = $('#judgeInput'); if (inp) inp.value = '';
    try { if (NX.tts) NX.tts.cancel(); else if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (J.mode === 'console') NX.bus.emit('decoy_end', { client: CLIENT_NAME, source: 'stage', iocs: S.iocs.length, durationMs: J.t1 - J.t0, lines: J.lines });
    else call('client', 'Decoy.stop', [], { quiet: true });
    if (!silent) updateJudgeUi();
  }
  function judgeTick() {
    const J = S.judge;
    if (!J.open) return;
    const t = $('#judgeTimer'); if (t) t.textContent = mmss2(Date.now() - J.t0);
    const eq = $('#judgeEquiv');
    const replicas = J.lines + J.replies;
    if (eq) eq.textContent = replicas ? NX.countOf(replicas, ['реплика', 'реплики', 'реплик']) + ' · ≈ ' + Math.max(1, Math.round(replicas * 25 / 60)) + ' мин голосом (оценка: 25 с/реплику)' : '';
    const ap = $('#judgeAp');
    const idle = Date.now() - J.idleAt;
    const inp = $('#judgeInput');
    const typing = inp && inp.value.trim().length > 0;
    if (S.step === 2 && !J.apRunning && !S.iocs.length && !typing && !J.recOn) {
      const left = IDLE_MS - idle;
      if (left <= 0) startJudgeAuto('idle');
      else if (ap && left <= 12000) { ap.classList.remove('hidden'); ap.innerHTML = 'Судья молчит — автопилот через <b>' + Math.ceil(left / 1000) + '</b> с · J — сразу'; }
      else if (ap) ap.classList.add('hidden');
    } else if (ap && !J.apRunning) ap.classList.add('hidden');
    renderMetrics();
  }
  function hlScam(text, found) {
    let h = esc(text);
    (found || []).forEach((f) => { const r = esc(f.raw || f.value); if (r && h.indexOf(r) >= 0) h = h.split(r).join('<mark>' + r + '</mark>'); });
    return h;
  }
  function addMsg(who, text, found, engine, auto) {
    const log = $('#judgeLog');
    if (!log) return null;
    const el = document.createElement('div');
    el.className = 'st-msg ' + (who === 'scam' ? 'scam' : 'decoy');
    const head = who === 'scam' ? 'Мошенник' + (auto ? ' · автопилот' : ' · судья') : 'Гульнара-апа · приманка';
    el.innerHTML = '<div class="who">' + esc(head) + (engine ? '<span class="st-eng">' + esc(engine) + '</span>' : '') + '</div>' + (who === 'scam' ? hlScam(text, found) : esc(text));
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function addSys(html) {
    const log = $('#judgeLog');
    if (!log) return null;
    const el = document.createElement('div');
    el.className = 'st-msg sys';
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function addTyping() {
    const log = $('#judgeLog');
    if (!log) return { remove() {} };
    const el = document.createElement('div');
    el.className = 'st-msg decoy';
    el.innerHTML = '<span class="st-typing"><i></i><i></i><i></i></span>';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return { remove() { if (el.parentNode) el.parentNode.removeChild(el); } };
  }
  const stBadge = (st) => '<span class="st-ioc-status ' + esc(st || 'suspected') + '">' + esc(NX.iocs.label(st || 'suspected')) + '</span>';
  const iocKey = (r) => r.kind + ':' + r.value;
  function trackIoc(rec, lineNo, seen, source) {
    const key = iocKey(rec);
    let t = S.iocs.find((x) => x.key === key);
    if (!t) {
      t = { key, id: rec.id, kind: rec.kind, value: rec.value, raw: rec.raw || rec.matched || rec.value, status: rec.status || 'suspected', t0: Date.now(), lineNo: lineNo || null, seen: !!seen, source: source || 'Робот-приманка', latency: null, stEls: [], latEls: [], quote: rec.quote || '' };
      S.iocs.push(t);
    } else t.status = rec.status || t.status;
    return t;
  }
  function judgeSend(raw, o) {
    const opts = o || {};
    const J = S.judge;
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!text) return Promise.resolve();
    if (!J.open) openDecoy();
    if (J.mode !== 'console') return Promise.resolve();
    if (!opts.auto && J.apRunning) stopJudgeAuto(false);
    J.idleAt = Date.now();
    J.lines++;
    const lineNo = J.lines;
    let found = [];
    try { found = NX.extractIocs(text) || []; } catch (e) { found = []; }
    addMsg('scam', text, found, null, opts.auto);
    if (found.length) pushIocs(found, text, lineNo, !!opts.auto);
    J.chain = J.chain.then(() => decoyRespond(J, text, found)).catch((e) => { console.error('[stage] decoy', e); });
    renderMetrics();
    return J.chain;
  }
  function pushIocs(found, text, lineNo, auto) {
    // снимок до добавления: какие источники и статус уже были у реквизита (для честной подписи «второй источник»)
    const before = {};
    found.forEach((f) => {
      const key = foundKey(f);
      let rec = null;
      try { rec = NX.iocs.find(f.kind, key.slice(f.kind.length + 1)); } catch (e) { rec = null; }
      if (rec) before[key] = { sources: (rec.sources || [rec.source]).filter(Boolean), status: statusOf(rec) };
    });
    let res = [];
    try { res = NX.iocs.add(found, 'Робот-приманка', { client: CLIENT_NAME, session: S.runId, quote: text.slice(0, 180), via: 'stage' }) || []; } catch (e) { console.error('[stage] iocs.add', e); res = []; }
    const seen = (res && res.seen) || [];
    const seenNote = (r) => {
      const b = before[r.kind + ':' + r.value];
      const by = String(r.seenBy || 'Робот-приманка');
      const prevSrc = b ? b.sources : [];
      const list = esc(prevSrc.join(', ') || 'стоп-лист');
      if (prevSrc.indexOf(by) >= 0) return 'повтор того же реквизита — тот же источник, статус не меняется';
      const stNow = statusOf(r);
      if (b && b.status === 'suspected' && (stNow === 'corroborated' || stNow === 'confirmed')) return 'уже был в стоп-листе (' + list + ') — второй независимый источник, статус: «' + esc(NX.iocs.label(stNow)) + '»';
      return 'уже был в стоп-листе (' + list + ') — источник добавлен, статус не меняется (тот же инцидент или нужен независимый источник)';
    };
    const list = res.map((r) => ({ r, seen: false })).concat(seen.map((r) => ({ r, seen: true })));
    if (!list.length) return;
    if (S.metrics.linesToIoc == null) S.metrics.linesToIoc = lineNo;
    list.forEach((x) => {
      const t = trackIoc(x.r, lineNo, x.seen, 'Робот-приманка');
      if (t.auto == null) t.auto = !!auto;
      const el = addSys('<div class="st-ioc">' + ic('dna', 14) + '<b>' + esc(NX.IOC_KIND[t.kind] || t.kind) + ' → стоп-лист банка:</b> <span class="v">' + esc(t.raw) + '</span> <span data-st></span></div>' +
        '<div class="st-sub" data-lat>' + (x.seen ? seenNote(x.r) : 'доставка в банк…') + '</div>');
      if (el) {
        const stEl = el.querySelector('[data-st]'), latEl = el.querySelector('[data-lat]');
        if (stEl) { stEl.innerHTML = stBadge(t.status); t.stEls.push(stEl); }
        if (latEl && !x.seen) t.latEls.push(latEl);
      }
    });
    const ap = $('#judgeAp'); if (ap && !S.judge.apRunning) ap.classList.add('hidden');
    renderStepCard();
    setState('Реквизит получен на ' + lineNo + '-й реплике и уже в стоп-листе банка. Space — дальше, к банку.', 'ok');
    renderMetrics();
  }
  async function decoyRespond(J, text, found) {
    if (!J.open || S.judge !== J) return; // сцену сбросили или ловушку закрыли
    J.history.push({ role: 'user', content: text });
    const offline = decoyOffline(text, found);
    const typing = addTyping();
    const minDelay = sleep(650 + Math.min(900, text.length * 6));
    let reply = null, engine = 'офлайн-движок';
    if (S.llm && S.llm.ok && !FL.llmOff) {
      const r = await Promise.race([llmDecoy(J.history), sleep(5000).then(() => null)]);
      if (r && r.text) { reply = r.text; const nm = /gemini/i.test((S.llm && S.llm.model) || '') ? 'Gemini' : 'Claude'; engine = r.filtered ? nm + ' · пост-фильтр' : nm; }
    }
    await minDelay;
    typing.remove();
    if (!J.open || S.judge !== J) return;
    if (!reply) reply = offline;
    const clean = filterReply(reply);
    if (clean !== String(reply).trim() && /^(Claude|Gemini)$/.test(engine)) engine = engine + ' · пост-фильтр';
    addMsg('decoy', clean, null, engine);
    J.history.push({ role: 'assistant', content: clean });
    J.replies++;
    speak(clean);
    renderMetrics();
  }
  function speak(text) {
    const J = S.judge;
    if (!J.voice) return;
    if (NX.tts) { NX.tts.speak(text, { role: 'granny', lang: KZ_RE.test(text) ? 'kz' : 'ru' }); return; }
    const kz = KZ_RE.test(text);
    const v = kz ? (S.kkVoice || S.ruVoice) : S.ruVoice;
    if (!v) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 0.9; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch (e) { /* без озвучки */ }
  }

  // автопилот мошенника: синтетический IBAN с корректной контрольной суммой и вымышленным кодом банка
  function mod97(s) {
    let rem = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const v = c >= 65 ? String(c - 55) : s.charAt(i);
      for (let j = 0; j < v.length; j++) rem = (rem * 10 + (v.charCodeAt(j) - 48)) % 97;
    }
    return rem;
  }
  function makeIban() {
    let d = '';
    for (let i = 0; i < 12; i++) d += String(Math.floor(Math.random() * 10));
    const bban = '9KZT' + d;
    const chk = 98 - mod97(bban + 'KZ00');
    const iban = 'KZ' + NX.pad(chk) + bban;
    return iban.replace(/(.{4})/g, '$1 ').trim();
  }
  function apLines() {
    const J = S.judge;
    if (!J.apIban) J.apIban = makeIban();
    return [
      'Здравствуйте, это служба безопасности банка. По вашему счёту подозрительная операция, деньги нужно срочно защитить.',
      'Сейчас придёт код из SMS — продиктуйте его, чтобы мы отменили операцию.',
      'Тогда переведите сбережения на защищённый счёт ' + J.apIban + '. Он оформлен на вас.',
      'Получатель — наш сотрудник Данияр, он всё оформит. Только быстрее, времени мало!',
    ];
  }
  async function typeInto(text, tok) {
    const inp = $('#judgeInput');
    if (!inp) return;
    const per = clamp(1200 / Math.max(1, text.length), 8, 28);
    for (let i = 1; i <= text.length; i += 2) {
      if (tok !== S.judge.apToken) return;
      inp.value = text.slice(0, i);
      await sleep(per * 2);
    }
    inp.value = '';
  }
  async function startJudgeAuto(why) {
    const J = S.judge;
    if (!J.open) openDecoy();
    if (J.apRunning || !J.open) return;
    if (J.mode === 'client') {
      if (has('client', 'Decoy.startAuto')) call('client', 'Decoy.startAuto');
      else if (has('client', 'Decoy.start')) call('client', 'Decoy.start');
      J.apRunning = true;
      updateJudgeUi();
      return;
    }
    J.apRunning = true;
    const tok = ++J.apToken;
    updateJudgeUi(); renderStepCard();
    if (why === 'idle') toast('Автопилот мошенника', 'Судья молчит 20 с — реплики идут по сценарию. J или своя реплика — остановить', 'info', 'play');
    const lines = apLines();
    for (let i = J.apIdx; i < lines.length; i++) {
      if (tok !== J.apToken || !J.open) return;
      await typeInto(lines[i], tok);
      if (tok !== J.apToken || !J.open) return;
      J.apIdx = i + 1;
      await judgeSend(lines[i], { auto: true });
      await sleep(1100);
    }
    if (tok === J.apToken) { J.apRunning = false; updateJudgeUi(); renderStepCard(); }
  }
  function stopJudgeAuto(notify) {
    const J = S.judge;
    if (!J.apRunning) return;
    J.apToken++; J.apRunning = false;
    const inp = $('#judgeInput'); if (inp && notify !== false) inp.value = '';
    J.idleAt = Date.now();
    if (J.mode === 'client') call('client', 'Decoy.stop', [], { quiet: true });
    updateJudgeUi(); renderStepCard();
    if (notify) toast('Автопилот мошенника выключен', 'Говорит судья', 'info');
  }
  function toggleJudgeAuto() {
    if (S.step !== 2) goStep(2);
    if (S.judge.apRunning) stopJudgeAuto(true); else startJudgeAuto('key');
  }
  function sendFromInput() {
    const inp = $('#judgeInput');
    if (!inp) return;
    const v = inp.value;
    inp.value = '';
    judgeSend(v);
  }

  // микрофон судьи (Web Speech): ошибки сети/устройства — тост и стоп; перезапуск с backoff, не больше 5 попыток
  function toggleMic() {
    if (S.step !== 2) goStep(2);
    const J = S.judge;
    if (J.mode === 'client') { toast('Микрофон — в телефоне', 'Пульт мошенника открыт в кабинете клиентки', 'info'); return; }
    if (J.recOn) { stopMic(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Распознавание речи недоступно', 'Откройте сцену в Chrome или Edge; реплики можно печатать', 'warn', 'mic'); return; }
    if (window.isSecureContext === false) { toast('Микрофону нужен https или localhost', 'Запустите через serve.ps1 или деплой; реплики можно печатать', 'warn', 'mic'); return; }
    if (!J.open) openDecoy();
    J.recOn = true; J.recFails = 0;
    startRec();
  }
  function startRec() {
    const J = S.judge;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !J.recOn) return;
    let rec;
    try { rec = new SR(); } catch (e) { stopMic(true); toast('Не удалось включить микрофон', String(e && e.message || ''), 'warn', 'mic'); return; }
    rec.lang = J.lang === 'kz' ? 'kk-KZ' : 'ru-RU';
    rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      if (J.rec !== rec) return;
      try { if (NX.tts ? NX.tts.speaking() : (window.speechSynthesis && window.speechSynthesis.speaking)) return; } catch (er) { /* ignore */ }
      J.recFails = 0;
      J.idleAt = Date.now();
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = String(e.results[i][0].transcript || '').trim();
        if (!t) continue;
        if (e.results[i].isFinal) { const inp = $('#judgeInput'); if (inp) inp.value = ''; judgeSend(t.charAt(0).toUpperCase() + t.slice(1)); }
        else interim += t + ' ';
      }
      if (interim) { const inp = $('#judgeInput'); if (inp) inp.value = interim.trim(); }
    };
    rec.onerror = (e) => {
      const er = e && e.error;
      if (er === 'not-allowed' || er === 'service-not-allowed') { stopMic(true); toast('Нет доступа к микрофону', 'Разрешите микрофон для сайта (нужен https или localhost)', 'warn', 'mic'); }
      else if (er === 'network') { stopMic(true); toast('Распознаванию речи нужен интернет', 'Судья может печатать реплики — приманка ответит офлайн', 'warn', 'mic'); }
      else if (er === 'audio-capture') { stopMic(true); toast('Микрофон не найден', 'Проверьте подключение микрофона или печатайте реплики', 'warn', 'mic'); }
      else if (er === 'language-not-supported') { stopMic(true); toast('Язык распознавания не поддерживается', 'Переключите RU / KZ', 'warn', 'mic'); }
    };
    rec.onend = () => {
      if (!J.recOn || J.rec !== rec) return;
      J.recFails++;
      if (J.recFails > 5) { stopMic(true); toast('Микрофон остановлен', 'Распознавание несколько раз прервалось — печатайте реплики', 'warn', 'mic'); return; }
      const delay = Math.min(2000, 500 * J.recFails);
      setTimeout(() => { if (J.recOn && J.rec === rec) startRec(); }, delay);
    };
    J.rec = rec;
    try { rec.start(); } catch (e) { stopMic(true); toast('Не удалось включить микрофон', 'Повторите или печатайте реплики', 'warn', 'mic'); return; }
    updateJudgeUi();
  }
  function stopMic(silent) {
    const J = S.judge;
    if (!J) return;
    const was = J.recOn;
    J.recOn = false;
    const r = J.rec; J.rec = null;
    if (r) { try { r.onend = null; r.onresult = null; r.stop(); } catch (e) { /* ignore */ } }
    if (was && !silent) toast('Микрофон выключен', '', 'info', 'mic');
    updateJudgeUi();
  }
  function updateJudgeUi() {
    const J = S.judge;
    if (!J) return;
    const mic = $('#judgeMic'); if (mic) { mic.classList.toggle('on', !!J.recOn); mic.textContent = J.recOn ? 'Слушаю… нажмите, чтобы выключить' : 'Говорить голосом · M'; }
    const lang = $('#judgeLang'); if (lang) lang.textContent = J.lang === 'kz' ? 'KZ' : 'RU';
    const auto = $('#judgeAuto'); if (auto) { auto.classList.toggle('on', !!J.apRunning); auto.textContent = J.apRunning ? 'Стоп автопилот · J' : 'Автопилот · J'; }
    const vb = $('#judgeVoice'); if (vb) { vb.classList.toggle('on', !!J.voice); vb.textContent = J.voice ? 'Озвучка вкл.' : 'Без озвучки'; vb.disabled = !S.ruVoice; vb.title = S.ruVoice ? 'Озвучивать реплики приманки' : 'Нет русского голоса — только текст'; }
    const eng = $('#judgeEngine');
    if (eng) eng.textContent = 'Движок приманки: ' + (S.llm && S.llm.ok && !FL.llmOff ? (/gemini/i.test(S.llm.model || '') ? 'Gemini' : 'Claude') + ' (LLM) + пост-фильтр цифр' : 'офлайн (детерминированный)');
    const ap = $('#judgeAp');
    if (ap && J.apRunning) { ap.classList.remove('hidden'); ap.innerHTML = 'Автопилот: реплики мошенника по сценарию · J или своя реплика — стоп'; }
  }

  /* внешние реквизиты (из Защиты звонка / интерактива в телефоне) и статусы */
  function onIocExternal(p, msg, seen) {
    const items = (p && p.items) || [];
    if (!items.length) return;
    const src = String(p.source || '');
    if (S.step === 2 && S.judge.open && S.judge.mode === 'client' && /decoy/i.test(src)) {
      items.forEach((r) => trackIoc(r, null, seen, src));
      setState('Реквизит из ловушки уже в стоп-листе банка. Space — дальше, к банку.', 'ok', 2);
      renderStepCard(); renderMetrics();
    }
  }
  function onIocReceived(p) {
    const lat = Number(p.latencyMs);
    if (!isFinite(lat)) return;
    const items = p.items || [];
    let mine = false;
    items.forEach((b) => {
      const t = S.iocs.find((x) => x.kind === b.kind && x.value === b.value);
      if (t && t.latency == null) {
        mine = true;
        t.latency = lat;
        t.latEls.forEach((el) => { el.textContent = 'доставлен в банк за ' + msTxt(lat) + ' (' + (p.transport || 'шина') + '; в проде Kafka, SLA < 1 с)'; });
      }
    });
    if (mine || S.metrics.iocLat == null) { S.metrics.iocLat = lat; S.metrics.iocLatSrc = String(p.transport || ''); }
    renderMetrics();
  }
  function onIocUpdate(p) {
    const it = p && p.item;
    if (!it || !it.kind) return;
    const t = S.iocs.find((x) => x.kind === it.kind && x.value === it.value);
    let st = it.status;
    try { st = NX.iocs.status(it.kind, it.value) || it.status; } catch (e) { st = it.status; }
    if (t) { t.status = st; t.stEls.forEach((el) => { el.innerHTML = stBadge(st); }); }
    if (S.bankFocus && S.bankFocus.key === it.kind + ':' + it.value) {
      S.bankFocus.status = st;
      if (st === 'corroborated' || st === 'confirmed') setState('Статус реквизита: «' + esc(NX.iocs.label(st)) + '». Перевод на него теперь удерживается для проверки.' + (st === 'corroborated' ? ' В демо история счёта в графе сгенерирована, в проде — реальные операции.' : ''), 'ok', 3);
      renderStepCard(); renderResult();
    }
  }
  function statusOf(t) { try { return NX.iocs.status(t.kind, t.value) || t.status || null; } catch (e) { return t.status || null; } }
  function pickTarget() {
    const mine = S.iocs.filter((t) => ACC_KINDS.indexOf(t.kind) >= 0);
    if (mine.length) return mine[0];
    if (S.iocs.length) return S.iocs[0];
    let list = [];
    try { list = NX.iocs.active(); } catch (e) { list = []; }
    const acc = list.filter((r) => ACC_KINDS.indexOf(r.kind) >= 0);
    const fromDecoy = acc.find((r) => (r.sources || [r.source]).some((s) => /decoy/i.test(String(s || ''))));
    const r = fromDecoy || acc[0] || list[0];
    if (r) return { key: iocKey(r), kind: r.kind, value: r.value, raw: r.raw || r.value, status: r.status, quote: r.quote || '', origin: originOf(r.sources || [r.source]), stEls: [], latEls: [] };
    const b = call('bank', 'BankStage.latestIoc', [], { quiet: true });
    if (b && b.kind) return { key: b.kind + ':' + b.value, kind: b.kind, value: b.value, raw: b.raw || b.value, status: b.status, origin: originOf(b.sources || [b.source]), stEls: [], latEls: [] };
    return null;
  }
  // откуда реквизит: 'decoy' — звонок-ловушка, 'shield' — Защита звонка клиентке, 'list' — прочий стоп-лист
  function originOf(sources) {
    const s = (sources || []).map((x) => String(x || ''));
    if (s.some((x) => /decoy|ловушк/i.test(x))) return 'decoy';
    if (s.some((x) => /защита звонка|shield/i.test(x))) return 'shield';
    return 'list';
  }
  function originTxt(t) {
    const o = t && (t.origin || (t.source ? originOf([t.source]) : 'decoy'));
    return o === 'decoy' ? 'из звонка-ловушки' : o === 'shield' ? 'из звонка клиентке (Защита звонка)' : 'из стоп-листа';
  }

  /* ================= ШАГ 3: БАНК ================= */
  function runBank() {
    if (!bothReady()) { setState('Ждём загрузку панели банка…', 'warn'); return; }
    S.ran[3] = true; markUsed();
    const t = pickTarget();
    if (!t) {
      S.bankFocus = { ok: false, reason: 'no_ioc' };
      S.ran[3] = false; // шаг не выполнен: после шага 2 Space/Enter запустит его снова
      setState('В стоп-листе пока нет реквизитов — вернитесь на шаг 2 (← или 2).', 'warn');
      renderResult(); renderStepCard();
      return;
    }
    let r = null;
    // Цепочка дропов (контракт §2.6): цепочка счетов и распространение риска; без неё — прежний фокус графа
    let ch = null;
    if (has('bank', 'BankStage.showChain')) {
      ch = normChain(call('bank', 'BankStage.showChain', [t.value]));
      if (!ch && t.raw && t.raw !== t.value) ch = normChain(call('bank', 'BankStage.showChain', [t.raw], { quiet: true }));
    }
    if (!ch && has('bank', 'BankStage.focusGraphOnIoc')) r = call('bank', 'BankStage.focusGraphOnIoc', [{ kind: t.kind, value: t.value, raw: t.raw }, { k: 1.1 }]);
    else if (!ch) { missing('bank', 'BankStage.focusGraphOnIoc'); call('bank', 'BankStage.go', ['graph'], { quiet: true }); }
    S.chain = ch;
    const st = (ch && ch.iocStatus) || (r && r.status) || statusOf(t);
    S.bankFocus = { key: t.kind + ':' + t.value, t, r: r || null, ok: !!(ch || (r && r.ok)), reason: r && r.reason, status: st };
    if (ch) setState('Реквизит — звено цепочки ' + esc(ch.chainId || '') + ': ' + esc(NX.countOf(ch.hops || ch.nodes.length, ['переход', 'перехода', 'переходов'])) + (ch.minutesToCashout != null ? ', до обнала ' + esc(minTxt(ch.minutesToCashout)) : '') + '. Риск распространён на ' + esc(NX.countOf(ch.linkedCount, ['связанный счёт', 'связанных счёта', 'связанных счетов'])) + ' — связь не равна вине, решает аналитик.', 'ok');
    else if (r && r.ok) setState((r.corroborated ? 'Реквизит связан с дроп-сетью: статус «' + esc(NX.iocs.label(st)) + '».' : 'Реквизит в графе — идёт корреляция с дроп-сетью…') + ' Панель банка пока не показывает цепочку счетов целиком. В демо история счёта в графе сгенерирована.', r.corroborated ? 'ok' : '');
    else setState(r && r.reason === 'no_money_links' ? 'Сайт не участвует в денежных потоках — для подтверждения нужен второй независимый источник.' : 'Граф недоступен — статус реквизита показан по стоп-листу.', 'warn');
    renderStepCard(); renderResult(); renderMetrics();
  }
  const minTxt = (m) => { const v = Math.round(Number(m) || 0); return v < 60 ? NX.countOf(v, ['минута', 'минуты', 'минут']) : Math.floor(v / 60) + ' ч ' + NX.pad(v % 60) + ' мин'; };
  function firstNum(arr) { const v = (arr || []).find((x) => x != null && x !== '' && typeof x !== 'boolean' && isFinite(Number(x))); return v == null ? null : Number(v); }
  const CHAIN_ROLE = { victim: 'жертва', mule: 'дроп-счёт', drop: 'дроп-счёт', transit: 'транзит', cashout: 'обнал', client: 'клиент', ioc: 'реквизит из ловушки' };
  // приводим ответ NX.BankStage.showChain к одному виду (форма узлов у банка может отличаться)
  function normChain(c) {
    if (!c || typeof c !== 'object' || c.ok === false) return null;
    const nodes = (Array.isArray(c.nodes) ? c.nodes : []).filter(Boolean).map((n) => {
      if (typeof n === 'string') return { label: n, role: '', amount: null, min: null };
      const role = String(n.role || n.type || '');
      return {
        label: String(n.account || n.masked || n.label || n.raw || n.value || n.id || ''),
        role, roleRu: String(n.roleLabel || CHAIN_ROLE[role] || ROLE_RU[role] || role),
        amount: firstNum([n.amountIn, n.amount]),
        min: firstNum([n.minutesFromPrev, n.dtMin, n.delayMin]),
        dwell: firstNum([n.dwellMin]),
        count: firstNum([n.inbound, n.count]),
        hit: !!(n.ioc || n.isIoc || n.focus || n.match),
        blocked: !!n.blocked,
      };
    });
    if (!nodes.length) return null;
    const linked = c.linkedAccounts;
    const linkedCount = Array.isArray(linked) ? linked.length : isFinite(Number(linked)) ? Number(linked) : 0;
    const prop = (Array.isArray(c.propagated) ? c.propagated : []).filter(Boolean).slice(0, 4).map((p) => (typeof p === 'string' ? { label: p, index: null, note: '' } : {
      label: String(p.account || p.masked || p.label || p.value || p.id || ''),
      index: firstNum([p.index, p.riskIndex, p.risk, p.after, p.score]),
      before: firstNum([p.before, p.base]),
      note: String(p.why || p.reason || p.status || ''),
    }));
    return { chainId: String(c.chainId || c.id || ''), ringName: String(c.ringName || ''), nodes, hops: Number(c.hops) || Math.max(0, nodes.length - 1), minutesToCashout: firstNum([c.minutesToCashout]), linkedCount: linkedCount || prop.length, propagated: prop, chainStatus: String(c.status || ''), victims: firstNum([c.victims]), synthetic: !!c.synthetic, iocStatus: c.iocStatus || null };
  }
  function chainHtml() {
    const C = S.chain, f = S.bankFocus;
    // по строке на счёт: роль · хвост реквизита · сумма; время перехода — в подсказке
    const tail = (s) => { const v = String(s || ''); return v.length > 12 ? '•• ' + v.replace(/\s+/g, '').slice(-4) : v; };
    const nodes = C.nodes.map((n, i) => '<li class="' + (n.hit ? 'alert' : 'on') + '"' + (i && C.nodes[i].min != null && isFinite(C.nodes[i].min) ? ' title="через ' + esc(Math.round(C.nodes[i].min)) + ' мин"' : '') + '><span class="m">' + (i ? '↓' : '·') + '</span><span><b>' + esc(n.roleRu || 'счёт') + '</b> <span class="mono">' + esc(tail(n.label)) + '</span>' + (n.amount != null ? ' · ' + esc(NX.fmt(n.amount)) : '') + '</span></li>').join('');
    return '<div class="title">' + ic('graph', 18) + 'Цепочка дропов</div>' +
      (f && f.t ? '<p>Реквизит из ловушки: ' + stBadge(f.status) + '</p>' : '') +
      '<ul class="st-list">' + nodes + '</ul>' +
      '<div class="st-kv">' + (C.minutesToCashout != null ? '<span>До обнала: <b>' + esc(minTxt(C.minutesToCashout)) + '</b></span>' : '') + '<span>Связанных счетов: <b>' + esc(C.linkedCount) + '</b></span></div>' +
      '<p class="st-sub">Связь — не вина: решает аналитик. История счетов сгенерирована.</p>';
  }

  /* ================= ШАГ 4: ВТОРОЙ КЛИЕНТ ================= */
  function runSecond() {
    if (!bothReady()) { setState('Ждём загрузку панели банка…', 'warn'); return; }
    S.ran[4] = true; markUsed();
    const t = pickTarget();
    if (!t) {
      S.second = { ok: false, reason: 'no_ioc' };
      S.ran[4] = false; // шаг не выполнен: после шага 2 Space/Enter запустит его снова
      setState('Нет реквизита из ловушки — пройдите шаг 2: судья должен назвать счёт или номер.', 'warn');
      renderResult(); renderStepCard();
      return;
    }
    const tgt = { kind: t.kind, value: t.value, raw: t.raw };
    const t0 = perf();
    let r = null, via = 'bank';
    if (has('bank', 'BankStage.secondClientTransfer')) r = call('bank', 'BankStage.secondClientTransfer', [tgt, { amount: SECOND.amount, client: SECOND.client, city: SECOND.city }]);
    const ms = perf() - t0;
    if (!r || !r.ok) {
      if (has('client', 'Stage.secondClient')) {
        via = 'client';
        const t1 = perf();
        const c = call('client', 'Stage.secondClient', [t.raw || t.value, { amount: SECOND.amount, report: true, silent: true }]);
        if (c) {
          const dec = c.decision === 'block' ? 'hold' : c.decision === 'confirm' ? 'stepup' : 'pass';
          r = { ok: true, decision: dec, held: dec === 'hold', amount: c.amount, client: c.client, score: c.score, status: c.iocStatus, label: c.iocLabel, ageMs: c.iocFirstSeen ? Date.now() - c.iocFirstSeen : null, latencyMs: null, quote: t.quote || '', ioc: { raw: c.account }, decisionMs: c.decisionMs != null ? c.decisionMs : perf() - t1, dna: c.dna || null };
        }
      } else if (!has('bank', 'BankStage.secondClientTransfer')) missing('bank', 'BankStage.secondClientTransfer');
    }
    if (!r || !r.ok) {
      S.second = { ok: false, reason: (r && r.reason) || 'failed' };
      setState('Перевод второго клиента не выполнен — проверьте стоп-лист (шаг 2).', 'warn');
      renderResult(); renderStepCard();
      return;
    }
    const decMs = r.decisionMs != null ? r.decisionMs : ms;
    const orig = originTxt(t);
    S.second = Object.assign({}, r, { via, ms: decMs, raw: (r.ioc && r.ioc.raw) || t.raw, quote: r.quote || t.quote || '', originTxt: orig });
    S.metrics.secondMs = decMs; S.metrics.secondAge = r.ageMs; S.metrics.secondDecision = r.decision;
    if (r.latencyMs != null && S.metrics.iocLat == null) S.metrics.iocLat = r.latencyMs;
    // «Обычный перевод»: из ответа банка (r.dna), иначе — тем же NX.DNA на синтетическом профиле Сауле Д.
    const dna = normDna(r.dna) || secondDna(r, t);
    S.second.dna = dna;
    if (dna) { S.metrics.dnaIndex = dna.index; S.metrics.dnaTier = dna.tierLabel; }
    S.lastCase = { id: 'case-' + S.runId + '-' + Date.now().toString(36), amount: r.amount || SECOND.amount, client: SECOND.label, held: r.decision === 'hold' };
    // Близкие: запрос на проверку сыну Сауле Д. (если перевод не пропущен)
    S.trust = freshTrust();
    if (r.decision !== 'pass') S.trust.at = Date.now();
    if (r.trustCircle && r.trustCircle.id) { S.trust.bankId = String(r.trustCircle.id); S.trust.msg = String(r.trustCircle.message || ''); }
    // телефон судьи (stage-phone.js): тот же запрос приходит на настоящий телефон в зале
    if (S.trust.at && NX.StagePhone) { try { NX.StagePhone.request({ amountText: '≈ ' + Math.max(10, Math.round((Number(r.amount) || SECOND.amount) / 10000) * 10) + ' тыс ₸' }); } catch (e) { console.error('[stage-phone]', e); } }
    renderPush();
    if (r.decision === 'hold') setState((t.auto === false ? 'Удержан для проверки до потери. Реквизит, который придумал судья, только что защитил другого человека.' : 'Удержан для проверки до потери. Реквизит ' + esc(orig) + ' только что защитил другого человека.') + ' ' + esc(SON) + ' получил запрос проверить.', 'ok');
    else if (r.decision === 'stepup') setState('Реквизит пока «на проверке» — перевод на усиленной проверке, без удержания (защита от отравления стоп-листа).', 'warn');
    else setState('Реквизит не в активном стоп-листе — действует обычный скоринг.', 'warn');
    renderStepCard(); renderResult(); renderMetrics();
  }

  /* ---------- «Обычный перевод» второго перевода ---------- */
  const TIER_RU = { normal: 'обычная операция', check: 'дополнительная проверка', cooling: 'период охлаждения', hold: 'удержание и проверка банком' };
  function normDna(d) {
    if (!d || typeof d !== 'object' || d.index == null || !isFinite(Number(d.index))) return null;
    const factors = (Array.isArray(d.factors) ? d.factors : []).filter((f) => f && (f.label || f.key)).map((f) => ({ key: String(f.key || ''), label: String(f.label || f.key), points: Math.round(Number(f.points) || 0), detail: String(f.detail || '') }));
    const tier = String(d.tier || '');
    const prof = typeof d.profile === 'string' ? d.profile : d.profileSummary ? String(d.profileSummary) : '';
    return { index: clamp(Math.round(Number(d.index)), 0, 100), tier, tierLabel: String(d.tierLabel || TIER_RU[tier] || ''), explain: String(d.explain || ''), factors, src: d.src || 'bank', profile: prof, callAssumed: d.callAssumed !== false };
  }
  function dnaEngine() {
    // DNA сцены, затем банка, затем кабинета — один и тот же engine-пакет (assets/js/dna.js)
    const cands = [NX, fnx('bank'), fnx('client')];
    for (let i = 0; i < cands.length; i++) { try { const D = cands[i] && cands[i].DNA; if (D && typeof D.assess === 'function') return D; } catch (e) { /* ignore */ } }
    return null;
  }
  function secondDna(r, t) {
    const D = dnaEngine();
    if (!D) return null;
    const h = new Date().getHours();
    const tx = { amount: Number(r.amount) || SECOND.amount, newRecipient: true, recipient: (r.ioc && r.ioc.raw) || t.raw || t.value, hour: h, profile: SAULE_PROFILE, client: SECOND.short };
    // звонок с неизвестного номера во время перевода — сигнал SDK (в демо — симуляция), подозрительного текста у Сауле Д. нет
    const ctx = { callActive: true, scamSignal: false, weakenAttempt: false, emergency: false, profile: SAULE_PROFILE };
    try { const d = normDna(D.assess(tx, ctx)); if (d) d.src = 'scene'; return d; } catch (e) { console.error('[stage] DNA', e); return null; }
  }
  function dnaHtml(d) {
    if (!d) return '';
    // «обычный перевод» — источник причин, без собственного индекса на экране (индекс — в заметках и bench.html)
    return '<div class="st-dna"><div class="st-dna-h">' + ic('dna', 16) + '<b>Не похоже на её обычные переводы</b></div>' +
      (d.factors.length ? '<ul class="st-list">' + d.factors.slice(0, 3).map((f) => '<li class="on"><span class="m">·</span><span>' + esc(f.label) + '</span></li>').join('') + '</ul>' : '') +
      '</div>';
  }

  /* ================= ШАГ 5: ЯКОРЬ ОДИССЕЯ → ATO ================= */
  const ANCHOR_DEFAULT_TEXT = 'Мама, это Айгерим. Если ты это видишь — тебе звонят мошенники. Положи трубку и перезвони мне. Банк никогда не просит коды.';
  const SCAM_ASK = '«Гульнара-апа, поднимите лимит до 2 000 000 ₸, иначе деньги спишут — я подожду на линии»';
  function clientConstitution() { const nx = fnx('client'); try { return nx && nx.Constitution ? nx.Constitution : null; } catch (e) { return null; } }
  function anchorText() {
    const C = clientConstitution();
    try { const a = C && C.get ? C.get().anchor : null; if (a && a.text) return { text: String(a.text), author: String(a.author || '') }; } catch (e) { /* ignore */ }
    return { text: ANCHOR_DEFAULT_TEXT, author: 'Айгерим, дочь' };
  }
  async function runAnchor() {
    if (!bothReady()) { setState('Ждём загрузку кабинета…', 'warn'); waitFor(bothReady, 8000).then((ok) => { if (ok && S.step === 5 && !S.anchor.started) runAnchor(); }); return; }
    S.ran[5] = true; markUsed();
    const A = S.anchor = freshAnchor();
    A.started = true; A.t0 = perf();
    call('bank', 'BankStage.go', ['overview'], { quiet: true });
    let r;
    try {
      if (has('client', 'Stage.constitutionAttack')) { A.via = 'stage'; r = call('client', 'Stage.constitutionAttack'); }
      else if (has('client', 'Constitution.requestChange')) { A.via = 'engine'; r = anchorViaEngine(); }
      else {
        // конституции в кабинете нет — шаг 5 показывает прежнюю цепочку захвата аккаунта
        A.via = 'none'; A.skipped = true; A.done = true;
        setState('Финансовая конституция в кабинете недоступна — показываем цепочку захвата аккаунта: смену лимита удерживает NEXUS Core.', 'warn');
        renderStepCard(); renderResult(); renderMetrics();
        runAto();
        return;
      }
      setState('Мошенник на линии: ' + esc(SCAM_ASK), 'warn');
      renderStepCard(); renderResult(); renderMetrics();
      if (r && typeof r.then === 'function') r = await Promise.race([r, sleep(12000).then(() => ({ timeout: true }))]);
    } catch (e) {
      console.error('[stage] constitutionAttack', e);
      r = { error: true };
    }
    if (S.anchor !== A) return; // сцену сбросили
    applyAnchor(A, r || {});
  }
  // запасной путь: кабинет без NX.Stage.constitutionAttack, но с движком конституции
  function anchorViaEngine() {
    const C = clientConstitution();
    let art = null;
    try { art = ((C.get() || {}).articles || []).find((x) => x.kind === 'new_recipient_limit' || x.id === 'a_new_limit') || null; } catch (e) { art = null; }
    const id = art ? art.id : 'a_new_limit';
    const n = art && art.n ? art.n : 1;
    const cur = art && art.params && Number(art.params.amount) > 0 ? Number(art.params.amount) : 100000;
    const res = C.requestChange(id, { params: Object.assign({}, art && art.params, { amount: Math.max(cur * 10, 2000000) }) }, { callActive: true, underAttack: true }) || {};
    let guardian = false, reverted = false;
    if (res.refused) {
      try { if (typeof C.requestGuardian === 'function') { C.requestGuardian({ purpose: 'weaken', reason: 'Во время звонка просили ослабить статью ' + n + ' конституции', articleN: n }); guardian = true; } } catch (e) { guardian = false; }
    } else if (res.applied && art) {
      // якорь выключен — ослабление применилось; откатываем сразу (понижение порога — усиление, действует мгновенно)
      try { const back = C.requestChange(id, { params: Object.assign({}, art.params) }, {}) || {}; reverted = !!back.applied; } catch (e) { reverted = false; }
    } else if (res.delayed && res.changeId && typeof C.cancelChange === 'function') {
      try { C.cancelChange(res.changeId); reverted = true; } catch (e) { reverted = false; }
    }
    return { refused: res.refused || false, articleN: n, anchorShown: false, guardianNotified: guardian, delayed: !!res.delayed, applied: !!res.applied, reverted, anchorOff: !!res.applied };
  }
  function applyAnchor(A, r) {
    if (r.error === 'no_constitution' || r.error === 'no_article') {
      // кабинет загружен без конституции — шаг 5 показывает прежнюю цепочку захвата аккаунта
      A.skipped = true; A.done = true; A.raw = r;
      setState('Финансовая конституция в кабинете недоступна — показываем цепочку захвата аккаунта: смену лимита удерживает NEXUS Core.', 'warn', 5);
      renderStepCard(); renderResult(); renderMetrics();
      runAto();
      return;
    }
    A.raw = r;
    if (r.guardianRequest && !A.guardian) A.guardian = { name: GUARDIAN, at: Date.now() };
    A.ms = A.ms != null ? A.ms : perf() - A.t0;
    if (r.refused) A.refused = r.refused;
    if (r.articleN != null) A.articleN = Number(r.articleN) || A.articleN;
    if (A.articleN == null) A.articleN = 1;
    if (r.anchorShown) A.anchorShown = true;
    if (!A.guardian && (r.guardianNotified || r.guardian)) A.guardian = { name: GUARDIAN, at: Date.now() };
    A.done = true;
    paintAnchorState();
    renderStepCard(); renderResult(); renderMetrics();
  }
  function paintAnchorState() {
    const A = S.anchor;
    if (!A.done || A.skipped) return;
    if (A.refused) {
      const parts = ['ослабление отклонено якорем'];
      if (A.anchorShown) parts.push('голос дочери показан');
      if (A.guardian) parts.push(GUARDIAN + ' уведомлена');
      setState(esc(parts.join(' · ').replace(/^./, (c) => c.toUpperCase())) + '. Space — дальше, к Fraud Fusion Center.', 'ok', 5);
    } else if (A.raw && A.raw.timeout) setState('Кабинет не ответил вовремя — повторите шаг (5) или идите дальше (Space).', 'warn', 5);
    else if (A.raw && A.raw.error) setState('Сбой в кабинете перехвачен — идите дальше (Space).', 'warn', 5);
    else if (A.raw && A.raw.anchorOff) setState('Правило 24 часов выключен — ослабление применилось' + (A.raw.reverted ? ', и мы его сразу откатили' : '') + '. Space — дальше.', 'warn', 5);
    else setState('Якорь не отклонил изменение' + (A.raw && A.raw.delayed ? ': ослабление отложено' + (A.raw.reverted ? ' и отменено' : '') + (A.raw.guardianNotified ? ', доверенное лицо уведомлено' : '') : '') + '. Space — дальше.', 'warn', 5);
  }
  function onConstChange(p) {
    if (!p || p.action !== 'refused') return;
    const A = S.anchor;
    if (A.started && !A.skipped) {
      if (!A.refused) A.refused = 'call';
      if (p.articleN != null) A.articleN = Number(p.articleN) || A.articleN;
      if (A.ms == null && A.t0) A.ms = perf() - A.t0;
    }
    if (S.ato.requested && !S.ato.done) S.ato.anchorRefused = true;
    if (A.done) paintAnchorState();
    renderResult(); renderMetrics();
  }
  function onGuardianRequest(p) {
    const A = S.anchor;
    if (!A.started || A.skipped) return;
    if (p && p.trustCircleDemo) return; // демо-запрос Близкие из кабинета дочери — не ответ якоря
    const g = p && p.guardian;
    const name = typeof g === 'string' ? g : (g && g.name) || GUARDIAN;
    A.guardian = { name: String(name).split(' ')[0] || GUARDIAN, at: Date.now() };
    if (A.done) paintAnchorState();
    renderResult(); renderMetrics();
  }
  function onProtective(p) {
    const A = S.anchor;
    if (!A.started || A.skipped || !p) return;
    A.protective = p.active ? { articleN: p.articleN, until: p.until, reason: String(p.reason || '') } : null;
    renderResult();
  }
  function anchorHtml() {
    const A = S.anchor;
    if (A.skipped) return '<div class="title warn">' + ic('info', 18) + 'Финансовая конституция недоступна</div><p>Кабинет загружен без модуля конституции — шаг 5 показывает цепочку захвата аккаунта, где смену лимита удерживает NEXUS Core.</p>';
    const n = A.articleN || 1;
    const li = (ok, text, wait) => '<li class="' + (ok ? 'good' : wait ? 'on' : '') + '"><span class="m">' + (ok ? ic('check', 14) : wait ? '…' : '·') + '</span><span>' + text + '</span></li>';
    const v = anchorText();
    const pending = !A.done;
    let h = '<div class="title indigo">' + anchorIc(18) + 'Правило 24 часов</div>' +
      '<ul class="st-list checks">' +
        li(!!A.refused, 'Ослабление правила ' + esc(n) + ' отклонено: идёт звонок', pending) +
        li(A.anchorShown, 'Показан голос дочери, записанный заранее', pending) +
        li(!!A.guardian, esc((A.guardian && A.guardian.name) || GUARDIAN) + ' уведомлена', pending) +
      '</ul>';
    if (A.anchorShown) h += '<div class="st-voice"><div class="vh"><span class="wave"><i></i><i></i><i></i><i></i><i></i></span>Голос из спокойного времени</div>«' + esc(v.text.length > 110 ? v.text.slice(0, 108) + '…' : v.text) + '»</div>';
    return h;
  }
  function atoHtml() {
    const names = ['SMS «службы безопасности»', 'Переход по ссылке', 'Вход с нового устройства', 'Перевод со сбережений на карту', 'Попытка поднять лимит', 'Решение NEXUS Core'];
    const viaAnchor = S.ato.anchorRefused || (S.anchor.refused && !S.anchor.skipped);
    return '<div class="title">' + ic('brain', 18) + 'Если клиент поддался: захват аккаунта</div><ul class="st-list">' +
      names.map((n, i) => { const s = S.ato.steps[i]; const alert = s && (s.stage === 'alert' || i >= 4); return '<li class="' + (s ? (alert ? 'alert' : 'on') : '') + '"><span class="m">' + (s ? esc(NX.hm(s.at)) : '··:··') + '</span><span>' + esc(s ? s.t : n) + '</span></li>'; }).join('') + '</ul>' +
      (S.ato.done ? '<p><b>Смена лимита удержана — до перевода.</b>' + (viaAnchor ? ' С нового устройства правило 24 часов тоже не обойти.' : '') + '</p>' : '');
  }
  function runAto() {
    if (!bothReady()) { setState('Ждём загрузку кабинета…', 'warn'); return; }
    S.ran[5] = true; markUsed();
    S.ato = freshAto();
    S.ato.requested = true;
    // окно якоря в телефоне закрываем: цепочка захвата аккаунта открывает своё
    if (S.anchor.done && !S.anchor.skipped) call('client', 'closeModal', [], { quiet: true });
    call('client', 'Stage.goto', ['overview'], { quiet: true });
    call('bank', 'BankStage.go', ['overview'], { quiet: true });
    // 5б — атакующий с нового устройства, а не звонок: флаг звонка из 5а не должен попасть в контекст ATO
    call('client', 'Stage.setCallActive', [false], { quiet: true });
    if (!has('client', 'Stage.runDemoCore')) { missing('client', 'Stage.runDemoCore'); S.ato.done = true; setState('Демо захвата аккаунта недоступно в кабинете — Space, дальше.', 'bad'); renderStepCard(); renderResult(); return; }
    const ok = call('client', 'Stage.runDemoCore');
    if (ok === false) setState('Демо уже идёт или не запустилось — закройте окно в телефоне и повторите', 'warn');
    else setState('Цепочка атаки идёт в телефоне; банк видит каждый шаг.', '');
    renderStepCard(); renderResult();
  }
  function onAttackStep(p) {
    const i = Number(p.i) || 0;
    S.ato.started = true;
    S.ato.steps[i] = { t: String(p.t || ''), score: p.score != null ? p.score : p.risk, stage: p.stage || '', at: Date.now() };
    const total = Number(p.total) || 6;
    if (i >= total - 1 && !S.ato.done) { S.ato.done = true; if (S.step === 5) { renderStepCard(); setState('Атака остановлена на шаге смены лимита — до перевода. «Почему?» — объяснение факторов.', 'ok'); } }
    renderResult();
  }

  /* ================= ШАГ 6: FRAUD FUSION CENTER · EMERGENCY SHIELD · SAFE RETURN ================= */
  const EM_ACTIONS = [
    ['blockNewTransfers', 'Новые переводы заблокированы'],
    ['pauseRecipients', 'Добавление получателей приостановлено'],
    ['endSessions', 'Подозрительные сеансы завершены'],
    ['notify', 'Банк и Айгерим уведомлены'],
  ];
  const EM_ALL = { blockNewTransfers: true, pauseRecipients: true, endSessions: true, notify: true };
  async function runFusion() {
    if (!bothReady()) { setState('Ждём загрузку экранов…', 'warn'); waitFor(bothReady, 8000).then((ok) => { if (ok && S.step === 6 && !S.fusion.shield) runFusion(); }); return; }
    S.ran[6] = true; markUsed();
    const F = S.fusion;
    if (F.shield || F.busy) return;
    F.busy = true;
    // после шага 5 «звонок» уже не идёт
    call('client', 'Stage.setCallActive', [false], { quiet: true });
    call('client', 'closeModal', [], { quiet: true });
    let res;
    try {
      if (has('client', 'Stage.emergency')) { F.via = 'stage'; res = call('client', 'Stage.emergency'); }
      else if (has('client', 'Emergency.activate')) { F.via = 'engine'; call('client', 'Stage.goto', ['overview'], { quiet: true }); res = call('client', 'Emergency.activate', [Object.assign({}, EM_ALL)]); if (!res || typeof res !== 'object') res = { actions: Object.assign({}, EM_ALL) }; }
      else F.via = 'none';
      if (res && typeof res.then === 'function') res = await Promise.race([res, sleep(6000).then(() => null)]);
    } catch (e) { console.error('[stage] emergency', e); res = null; }
    F.busy = false;
    if (S.fusion !== F) return; // сцену сбросили
    const acts = (res && res.actions && typeof res.actions === 'object') ? res.actions : (F.via !== 'none' && res ? Object.assign({}, EM_ALL) : null);
    F.shield = { ok: F.via !== 'none' && !!acts, actions: acts || {} };
    F.shieldAt = Date.now();
    // банк: схема целиком (если панель умеет), иначе обзор Fraud Fusion Center
    if (has('bank', 'BankStage.showScheme')) { call('bank', 'BankStage.showScheme'); F.bankView = 'scheme'; }
    else { call('bank', 'BankStage.go', ['overview'], { quiet: true }); F.bankView = 'overview'; }
    if (F.shield.ok) setState('«Заблокировать всё» включён одним нажатием: переводы и получатели на паузе, банк и Айгерим уведомлены. В прототипе — симуляция, в банке нужен API. Space — «Меня обманули».', 'ok', 6);
    else setState('«Заблокировать всё» в этой сборке кабинета недоступен — показываем схему в банке. Space — «Меня обманули».', 'warn', 6);
    renderStepCard(); renderResult(); renderMetrics();
  }
  function showRecover() {
    const F = S.fusion;
    F.recoverShown = true;
    const ok = has('client', 'Stage.goto');
    if (ok) call('client', 'Stage.goto', ['recover']);
    call('bank', 'BankStage.go', ['incidents'], { quiet: true });
    F.bankView = 'incidents';
    const hasSR = (() => { const nx = fnx('client'); try { return !!(nx && nx.SafeReturn && typeof nx.SafeReturn.render === 'function'); } catch (e) { return false; } })();
    if (hasSR) setState('«Меня обманули» в телефоне: что случилось, хронология звонка и переводов за 24 ч, доказательства, готовое заявление и статус обращения. Это быстрый запуск процедуры, а не гарантия возврата денег. Space — экономика и пилот.', 'ok', 6);
    else setState('Раздел «Меня обманули» («Меня обманули») в этой сборке кабинета недоступен. Его путь: фиксация, хронология, доказательства, заявление, статус. Space — экономика и пилот.', 'warn', 6);
    renderStepCard(); renderResult();
  }
  function onEmergencyBus(p) {
    const F = S.fusion;
    if (!p) return;
    if (p.active === false) { if (F.shield) F.shield.off = true; }
    else { F.busAt = Date.now(); if (F.shield && p.actions && typeof p.actions === 'object') F.shield.actions = p.actions; }
    if (S.step === 6) renderResult();
  }
  const SR_STATUS = { registered: 'Инцидент зарегистрирован', sent: 'Информация передана в банк', checking: 'Операция проверяется', need_info: 'Запрошено дополнительное подтверждение', result: 'Результат рассмотрения' };
  function onSafeReturnCase(p) {
    if (!p || !p.caseId) return;
    const F = S.fusion;
    F.caseId = String(p.caseId); F.caseStatus = String(p.status || '');
    if (S.step === 6) renderResult();
  }
  /* ---------- короткий показ, бит 5: «Звонит настоящий банк» + маскирование ---------- */
  // реплика мошенника этого показа с реквизитом: до и после NX.maskPII (та же функция, что в кабинете перед LLM)
  function maskExample() {
    if (typeof NX.maskPII !== 'function') return null;
    const t = S.iocs.find((x) => x.quote);
    let line = t ? String(t.quote) : '';
    if (!line) { const h = (S.judge.history || []).find((m) => m.role === 'user' && NX.extractIocs && (NX.extractIocs(m.content) || []).length); line = h ? String(h.content) : ''; }
    if (!line) return null;
    let stems = [];
    try { stems = NX.maskPII.stems([CLIENT_NAME, GUARDIAN]); } catch (e) { stems = []; }
    let out = line;
    try { out = NX.maskPII(line, { stems }); } catch (e) { console.error('[stage] maskPII', e); return null; }
    return { before: line, after: out, changed: out !== line };
  }
  function runVerified() {
    if (!bothReady()) { setState('Ждём загрузку экранов…', 'warn'); waitFor(bothReady, 8000).then((ok) => { if (ok && S.step === 6 && !S.vcall.started) runVerified(); }); return; }
    const V = S.vcall;
    if (V.started) return;
    S.ran[6] = true; markUsed();
    V.started = true; V.at = Date.now();
    call('client', 'Stage.setCallActive', [false], { quiet: true });
    call('client', 'closeModal', [], { quiet: true });
    call('client', 'Stage.goto', ['overview'], { quiet: true });
    V.mask = maskExample();
    // инцидент клиентки, если банк его завёл; в демо обычно это удержанный перевод Сауле Д. из бита 4 —
    // банк перезванивает ей с официального номера (шаг «обратный звонок»)
    let r = null;
    if (has('bank', 'BankStage.openIncidentFor')) {
      r = call('bank', 'BankStage.openIncidentFor', [CLIENT_NAME]);
      if (!r || !r.ok) r = call('bank', 'BankStage.openIncidentFor', [SECOND.client]);
    }
    if (!r || !r.ok) {
      V.reason = (r && r.reason) || 'no_api';
      call('bank', 'BankStage.go', ['incidents'], { quiet: true });
      setState('Инцидента по этому показу в панели банка нет — кнопку «Позвонить клиенту с официального номера» можно показать в любом инциденте. Space — финал.', 'warn', 6);
    } else {
      V.incId = String(r.id || '');
      V.client = String(r.client || '');
      V.already = !!r.live;
      const who = /сауле/i.test(V.client) ? SECOND.short : 'Гульнаре-апа';
      if (r.live) setState('Отметка о звонке банка уже действует. Space — финал.', 'ok', 6);
      else {
        setState('Аналитик открыл инцидент и звонит клиентке (' + esc(who) + ') с официального номера…', '', 6);
        // аналитик нажимает кнопку в окне инцидента — тот же обработчик, что и при ручном клике
        setTimeout(() => {
          if (S.vcall !== V || S.step !== 6) return;
          const d = fdoc('bank');
          const b = d && d.getElementById('iBankCall');
          if (b) { V.clicked = true; b.click(); }
          else setState('Кнопка «Позвонить клиенту с официального номера» не найдена в окне инцидента. Space — финал.', 'warn', 6);
          renderResult();
        }, 1600);
      }
    }
    renderStepCard(); renderResult();
  }
  function onBankCall(p) {
    const V = S.vcall;
    if (!V || !V.started || !p) return;
    // только звонок по инциденту, который открыл бит 5
    if (V.client && p.client && String(p.client) !== V.client) return;
    const mom = String(p.client || '').indexOf(String(CLIENT_NAME).split(' ')[0]) >= 0;
    V.bus = { client: String(p.client || ''), mom, employeeId: String(p.employeeId || ''), topic: String(p.topic || ''), ttl: Number(p.ttl) || 0, ts: Number(p.ts) || Date.now() };
    setState((mom ? 'В телефоне Гульнары-апа' : 'В приложении ' + esc(SECOND.short)) + ': «Сейчас вам действительно звонит банк»' + (V.bus.employeeId ? ', сотрудник №' + esc(V.bus.employeeId) : '') + ' · симуляция. Space — финал.', 'ok', 6);
    if (S.step === 6) { renderStepCard(); renderResult(); }
  }
  function verifiedHtml() {
    const V = S.vcall, B = V.bus, M = V.mask;
    let h = '<div class="title ok">' + ic('phone', 18) + 'Звонит настоящий банк · симуляция</div>';
    if (B) {
      h += '<p class="st-trust-ans ok">' + ic('shieldCheck', 14) + '<span>«Сейчас вам действительно звонит банк» · сотрудник №' + esc(B.employeeId || '—') + (B.topic ? ' · тема: ' + esc(B.topic) : '') + (B.ttl ? ' · ' + esc(Math.round(B.ttl / 60)) + ' мин' : '') + '</span></p>' +
        '';
    }
    else if (V.already) h += '<p>Отметка о звонке банка у клиентки уже действует.</p>';
    else if (V.reason) h += '<p>Инцидента по этому показу в панели банка нет — отметку не отправляли.</p>';
    else h += '<p>' + (V.clicked ? 'Отметка отправлена в приложение клиентки…' : 'Аналитик нажимает «Позвонить клиенту с официального номера»…') + '</p>';
    h += '<div class="sep"></div><div class="title">' + ic('lock', 18) + 'Что уходит в LLM</div>';
    if (M) {
      const cut = (x) => { const s = String(x || ''); return s.length > 64 ? s.slice(0, 62) + '…' : s; };
      h += '<p class="mono st-mask">' + esc(cut(M.before)) + '</p>' +
        '<p class="st-sub">→ после маскирования:</p><p class="mono st-mask">' + esc(cut(M.after)) + '</p>';
    } else h += '<p class="st-sub">Пример маскирования появится после бита 3.</p>';
    return h;
  }
  function fusionHtml() {
    const F = S.fusion, M = S.metrics, R = S.manip.res, C = S.chain, A = S.anchor, r2 = S.second;
    const det = S.call.alertAt ? 'тревога' + (M.lead != null && M.lead > 0 ? ' за ' + esc(secTxt(M.lead)) + ' до кода' : '') : 'звонок не запускали';
    const und = (R && R.attackType ? esc(R.attackType.label) : 'тип атаки не определён');
    const pre = R && R.next ? 'дальше: ' + esc(R.next.label) : C ? 'путь денег до обнала' : '—';
    const pro = [];
    if (r2 && r2.ok) pro.push(r2.decision === 'hold' ? 'перевод Сауле Д. удержан' : 'перевод Сауле Д. на проверке');
    if (A.refused) pro.push('лимит не ослаблен');
    if (F.shield && F.shield.ok) pro.push('всё заблокировано');
    const inv = S.iocs.length ? esc(NX.countOf(S.iocs.length, ['реквизит', 'реквизита', 'реквизитов'])) + ' в стоп-листе' : 'реквизитов нет';
    const rec = F.caseId ? 'обращение ' + esc(F.caseId) : F.recoverShown ? '«Меня обманули» открыто' : 'следующим нажатием';
    // цикл этого показа: 6 строк по-русски (английский код этапа — в подсказке)
    const R6 = [['Обнаружить', 'DETECT'], ['Понять', 'UNDERSTAND'], ['Предсказать', 'PREDICT'], ['Защитить', 'PROTECT'], ['Расследовать', 'INVESTIGATE'], ['Восстановить', 'RECOVER']];
    const rowR = (i, ok, text) => '<li class="' + (ok ? 'good' : '') + '" title="' + R6[i][1] + '"><span class="ph">' + esc(R6[i][0]) + '</span><span>' + text + '</span></li>';
    let h = '<div class="title">' + ic('shield', 18) + 'Цикл защиты этого показа</div><ul class="st-cycle">' +
      rowR(0, !!S.call.alertAt, det) + rowR(1, !!(R && R.attackType), und) + rowR(2, !!(R && R.next) || !!C, pre) +
      rowR(3, pro.length > 0, pro.length ? pro.join(' · ') : 'ещё не запускали') + rowR(4, S.iocs.length > 0, inv) + rowR(5, F.recoverShown || !!F.caseId, rec) + '</ul>';
    if (F.shield && !F.shield.ok) h += '<p class="st-sub">«Заблокировать всё» в этой сборке кабинета недоступно.</p>';
    return h;
  }

  /* ---------------- карточка результата шага ---------------- */
  function renderResult() {
    const box = $('#resultCard');
    if (!box) return;
    let html = '', cls = 'st-card st-result';
    const st = S.step;
    if (st === 1 && S.push) renderPush(); // запас до кода появляется позже пуша
    if (st === 1 && S.call && (S.call.alertAt || S.manip.res)) {
      const c = S.call, lead = S.metrics.lead;
      // тревога и запас до кода — в пуше дочери и в полосе замеров; здесь — только схема и следующий шаг
      if (c.alertAt && !S.push) {
        html = '<div class="title bad">' + ic('alert', 18) + 'Тревога ' + (lead != null && lead > 0 ? 'до просьбы кода' : 'во время звонка') + '</div>';
      }
      const mh = manipHtml();
      if (mh) html += (html ? '<div class="sep"></div>' : '') + mh;
    } else if (st === 3 && S.bankFocus) {
      const f = S.bankFocus;
      if (!f.t) html = '<div class="title">' + ic('info', 18) + 'Стоп-лист пуст</div><p>Сначала шаг 2: судья должен назвать счёт, номер или карту.</p>';
      else if (S.chain) html = chainHtml();
      else {
        const r = f.r || {};
        const ppr = (r.ppr || []).slice(0, 3);
        html = '<div class="title">' + ic('graph', 18) + 'Реквизит в графе связей</div>' +
          '<p><span class="mono">' + esc(f.t.raw) + '</span> ' + stBadge(f.status) + '</p>' +
          (r.path ? '<p><span class="st-sub">Путь в графе:</span> ' + esc(r.path) + '</p>' : '') +
          (ppr.length ? '<p class="st-sub">Связанные счета по графу:</p><ul class="st-list">' + ppr.map((x) => '<li><span class="m">' + esc(x.account || '') + '</span><span>' + esc(ROLE_RU[x.role] || x.role || '') + (x.label ? ' · ' + esc(x.label) : '') + '</span></li>').join('') + '</ul>' : '') +
          '<p class="st-sub">Одно подозрение счёт не замораживает: решают аналитик и старший. История счёта в демо сгенерирована.</p>';
      }
    } else if (st === 4 && S.second) {
      const r = S.second;
      if (!r.ok) html = '<div class="title">' + ic('info', 18) + 'Перевод не выполнен</div><p>Нет реквизита из ловушки в стоп-листе. Вернитесь на шаг 2.</p>';
      else {
        const held = r.decision === 'hold';
        cls += held ? ' held' : r.decision === 'stepup' ? ' stepup' : '';
        html = '<div class="title ' + (held ? 'ok' : 'warn') + '">' + ic(held ? 'shieldCheck' : 'alert', 18) + esc((held ? 'Удержано до потери: ' : r.decision === 'stepup' ? 'Проверка перевода: ' : 'Не удержано: ') + NX.fmt(r.amount || SECOND.amount)) + '</div>' +
          '<p>' + esc(SECOND.short) + ' → реквизит из ловушки ' + stBadge(r.status) + '</p>' +
          dnaHtml(r.dna) +
          (STEPS[LAST].slides.indexOf('roi') >= 0 ? '<div class="st-actions"><button type="button" class="btn sm" data-act="roiCase">В ROI-калькулятор</button></div>' : '');
      }
    } else if (st === 6 && SHORT && S.vcall.started) {
      html = verifiedHtml();
      if (S.vcall.bus) cls += ' held';
    } else if (st === 6 && S.ran[6]) {
      html = fusionHtml();
      if (S.fusion.shield && S.fusion.shield.ok) cls += ' held';
    } else if (isMore(st)) {
      html = NX.StageMore.resultHtml();
      if (html && /class="title/.test(html)) cls += ' held';
    } else if (st === 5 && (S.anchor.started || S.ato.requested || S.ato.started)) {
      const A = S.anchor;
      if (A.started) {
        html = anchorHtml();
        if (A.done && A.refused) cls += ' anchor';
      }
      if (S.ato.requested || S.ato.started) html += (html ? '<div class="sep"></div>' : '') + atoHtml();
    }
    const changed = html !== lastResultHtml;
    lastResultHtml = html;
    box.className = cls + (html ? '' : ' hidden');
    // одинаковый HTML не переписываем (фокус кнопок, без лишней перерисовки на каждом тике)
    if (changed || (html && !box.firstChild) || (!html && box.firstChild)) box.innerHTML = html;
    // результат шага — в зоне видимости центральной колонки
    const sameStep = lastResultStep === st;
    lastResultStep = st;
    // при смене шага goStep сам ведёт окно к карточке шага — не перебиваем
    if (html && changed && isMobile() && sameStep) {
      // мобильный: #paneMid — display:contents, карточка результата идёт под экраном телефона/банка — докрутить окно к ней
      if (resultScrollT) clearTimeout(resultScrollT);
      resultScrollT = setTimeout(() => {
        resultScrollT = 0;
        if (box.classList.contains('hidden')) return;
        const r = box.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (r.top >= 0 && r.top < vh - 120) return; // уже на экране
        try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { try { box.scrollIntoView(false); } catch (e2) { /* ignore */ } }
      }, 350);
    } else if (html && changed) {
      const mid = $('#paneMid');
      if (mid && mid.scrollHeight > mid.clientHeight + 4) {
        const top = box.offsetTop - mid.offsetTop - 8;
        if (top > mid.scrollTop + mid.clientHeight - 120 || top < mid.scrollTop) { try { mid.scrollTo({ top: Math.max(0, top - 60), behavior: 'smooth' }); } catch (e) { mid.scrollTop = Math.max(0, top - 60); } }
      }
    }
  }

  /* ---------------- живые замеры ---------------- */
  // снимок для bench.html «Замеры демо (сцена)»: localStorage nexus_ai_stage_metrics_v1 (сбрасывается NX.resetAll)
  let lastMetricsJson = '';
  function saveMetrics() {
    try {
      const M = S.metrics || {}, c = S.call || {}, R = (S.manip && S.manip.res) || null;
      const decTxt = { hold: 'удержан для проверки', stepup: 'дополнительная проверка', pass: 'пропущен' };
      const snap = {};
      const put = (k, v) => { if (v != null && v !== '' && !(typeof v === 'number' && !isFinite(v))) snap[k] = v; };
      put('alertMs', M.tta); put('alertLine', c.phrase); put('codeLine', c.codePhrase);
      if (c.phrase != null && c.codePhrase != null) put('leadLines', c.codePhrase - c.phrase);
      put('manipStages', M.stagesAtAlert); put('manipOf', M.stagesOf);
      if (R && R.attackType && R.attackType.id !== 'none') put('attackType', R.attackType.label);
      put('iocLatencyMs', M.iocLat); put('secondDecisionMs', M.secondMs);
      if (M.secondDecision) put('secondDecision', decTxt[M.secondDecision] || String(M.secondDecision));
      put('dnaIndex', M.dnaIndex); put('dnaTier', M.dnaTier);
      if (!Object.keys(snap).length) return;
      const j = JSON.stringify(snap);
      if (j === lastMetricsJson) return;
      lastMetricsJson = j;
      snap.ts = Date.now();
      window.localStorage.setItem('nexus_ai_stage_metrics_v1', JSON.stringify(snap));
    } catch (e) { /* хранилище недоступно — замеры остаются только на сцене */ }
  }
  function renderMetrics() {
    const box = $('#metricsCard');
    if (!box || !S.metrics) return;
    saveMetrics();
    const M = S.metrics;
    const m = (label, val, sub, hit, extra) => '<div class="st-m' + (hit ? ' hit' : '') + (extra ? ' ' + extra : '') + '"><div class="l">' + esc(label) + '</div><div class="v">' + esc(val) + '</div><div class="s">' + esc(sub || '') + '</div></div>';
    const A = S.anchor;
    const aOn = A.started && !A.skipped;
    const aVal = !aOn ? '—' : !A.done && !A.refused ? 'проверка…' : A.refused ? 'отклонено' : 'не сработал';
    const aSub = A.skipped ? 'конституция в кабинете недоступна' : A.refused ? 'ослабление статьи ' + (A.articleN || 1) + ' во время звонка' + (A.ms != null ? ' · ' + msTxt(A.ms) : '') : 'попытка ослабить конституцию';
    const c = S.call || {};
    const dec = M.secondDecision === 'hold' ? 'удержан' : M.secondDecision === 'stepup' ? 'проверка' : M.secondDecision === 'pass' ? 'пропущен' : '—';
    const stVal = M.stagesAtAlert != null ? String(M.stagesAtAlert) + (M.stagesOf ? ' из ' + M.stagesOf : '') : '—';
    const stSub = M.stagesAtAlert != null ? 'распознано к моменту тревоги' + (M.stagesSrc === 'scene' ? ' · разбор сцены' : '') : 'детектор манипуляций, шаг 1';
    // полоса из 3 чисел (полный набор замеров — в bench.html, часть 2: сцена пишет их в localStorage)
    const html3 = '<h3>Живые замеры · в этом браузере</h3><div class="st-mstrip">' +
      m('До кода', M.lead != null ? (M.lead > 0 ? secTxt(M.lead) : 'после кода') : '—', '', M.lead != null && M.lead > 0) +
      m('В банке', M.iocLat != null ? msTxt(M.iocLat) : '—', '', M.iocLat != null) +
      m('2-й перевод', dec, '', M.secondDecision === 'hold') +
      '</div>';
    if (html3) { if (box._h !== html3) { box.innerHTML = html3; box._h = html3; } return; }
    const html = '<h3>Живые замеры <small>в этом браузере, не сценарий</small></h3><div class="st-mgrid">' +
      m('Время до тревоги', M.tta != null ? secTxt(M.tta) : '—', c.phrase ? 'фраза ' + c.phrase + ' звонящего' + ' · от начала звонка' : 'от начала звонка', M.tta != null) +
      m('Стадий манипуляции до тревоги', stVal, stSub, M.stagesAtAlert != null) +
      m('Запас до просьбы кода', M.lead != null ? (M.lead > 0 ? secTxt(M.lead) : 'после кода') : '—', M.lead != null && M.lead <= 0 ? 'тревога через ' + secTxt(-M.lead) + ' после' : 'тревога раньше просьбы кода', M.lead != null && M.lead > 0) +
      m('В банке', M.iocLat != null ? msTxt(M.iocLat) : '—', (M.iocLatSrc || 'BroadcastChannel') + ' · в проде Kafka', M.iocLat != null) +
      m('Реплик до реквизита', M.linesToIoc != null ? String(M.linesToIoc) : '—', 'реплик мошенника до первого реквизита', M.linesToIoc != null) +
      m('Индекс DNA второго перевода', M.dnaIndex != null ? M.dnaIndex + ' / 100' : '—', M.dnaIndex != null ? (M.dnaTier || '«Обычный перевод»') : SECOND.short + ' · «Обычный перевод»', M.dnaIndex != null) +
      m('Перевод второго клиента', dec, M.secondMs != null ? 'решение за ' + msTxt(M.secondMs) + (M.secondAge != null ? ' · через ' + mmss(M.secondAge) + ' после реквизита' : '') : SECOND.label, M.secondDecision === 'hold') +
      (SHORT ? '' : m('Правило 24 часов', aVal, aSub + (aOn && A.guardian ? ' · ' + GUARDIAN + ' уведомлена' : ''), aOn && !!A.refused, 'anchor')) +
      '</div>';
    // одинаковую разметку не переписываем (таймер ловушки тикает раз в секунду)
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
  }

  /* ================= СЛАЙДЫ ================= */
  const SRC_INFORMBURO = 'https://informburo.kz/novosti/rekordnoe-kolicestvo-skolko-slucaev-mosennicestva-v-seti-zaregistrirovali-v-kazaxstane-v-2025-godu';
  const SRC_BIZMEDIA = 'https://bizmedia.kz/2025-06-11-za-pervyj-god-raboty-antifrod-czentrom-predotvrashhyon-ushherb-na-summu-svyshe-25-mlrd-tenge/';
  const SRC_FINRATINGS = 'https://finratings.kz/news/13359-49-mlrd-tenge-spaseny-kak-banki-rk-blokiruiut-moshennikov/';
  const a = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
  function liveChips() {
    const M = S.metrics, out = [];
    if (M.tta != null) out.push('тревога через <b>' + secTxt(M.tta) + '</b> от начала звонка');
    if (M.stagesAtAlert != null) out.push('<b>' + esc(NX.countOf(M.stagesAtAlert, ['стадия', 'стадии', 'стадий'])) + '</b> манипуляции до тревоги');
    if (M.lead != null && M.lead > 0) out.push('за <b>' + secTxt(M.lead) + '</b> до просьбы кода');
    if (M.linesToIoc != null) out.push('реквизит на <b>' + M.linesToIoc + '-й</b> реплике мошенника');
    if (M.iocLat != null) out.push('Реквизит доставлен в банк за <b>' + esc(msTxt(M.iocLat)) + '</b>');
    if (S.chain) out.push('цепочка: <b>' + esc(NX.countOf(S.chain.hops, ['переход', 'перехода', 'переходов'])) + '</b>, связанных счетов — <b>' + esc(S.chain.linkedCount) + '</b>');
    if (M.dnaIndex != null) out.push('индекс DNA второго перевода <b>' + esc(M.dnaIndex) + '/100</b>');
    if (M.secondDecision === 'hold') out.push('перевод <b>' + esc(NX.fmt(SECOND.amount)) + '</b> удержан до потери' + (M.secondAge != null ? ' через <b>' + esc(mmss(M.secondAge)) + '</b>' : ''));
    const A = S.anchor;
    if (A.started && !A.skipped && A.refused) out.push('ослабление конституции <b>отклонено якорем</b>' + (A.ms != null ? ' за <b>' + esc(msTxt(A.ms)) + '</b>' : ''));
    if (S.fusion.shield && S.fusion.shield.ok) out.push('<b>«Заблокировать всё»</b> включён одним нажатием');
    return out.length ? '<div class="sl-live">' + out.map((x) => '<span>' + x + '</span>').join('') + '</div><p class="sl-foot">Замеры этого показа в этом браузере (шина BroadcastChannel), не заданы сценарием.</p>' : '<p class="sl-foot">Живые замеры этого показа появятся после ' + (SHORT ? 'битов 2–5' : 'шагов 1–6') + '.</p>';
  }
  const FOOT = 'Концепт команды NEXUS AI. Не является продуктом банка-организатора. Все данные синтетические.';
  // цикл защиты — 6 значков на слайде вступления
  const CYCLE = [
    ['search', 'Обнаружить', 'звонок и SMS'],
    ['brain', 'Понять', 'схему давления'],
    ['target', 'Предсказать', 'следующий шаг'],
    ['shieldCheck', 'Защитить', 'удержать перевод'],
    ['graph', 'Расследовать', 'найти дропов'],
    ['folder', 'Восстановить', 'обращение за минуты'],
  ];
  // 6 тем брифа «Инновации в банкинге и кибербезопасность» — дословно (слайд 3-минутного показа)
  const TOPICS = [
    'Выявление мошенничества и антифрод',
    'Защита клиентов и финансовых данных',
    'Кибербезопасность банковских систем',
    'Повышение безопасности финансовых операций',
    'Новые цифровые сервисы и технологии для банков',
    'Другие инновационные решения в сфере FinTech',
  ];
  /* короткий показ: цифры бенча для финального слайда считаются здесь, в браузере, тем же NX.Bench
     (assets/js/bench.js) на том же корпусе звонков (assets/data/call-scenarios.js), что bench.html и лендинг */
  let benchRes = null, benchState = 'loading';
  function loadScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => resolve(true); s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  function loadBench() {
    const need = [];
    if (!Array.isArray(window.NX_CALLS)) need.push('assets/data/call-scenarios.js');
    if (!NX.Bench) need.push('assets/js/bench.js');
    need.reduce((p, src) => p.then((ok) => (ok ? loadScript(src) : false)), Promise.resolve(true)).then(() => {
      const B = NX.Bench, calls = window.NX_CALLS;
      if (!B || typeof B.evalCalls !== 'function' || !Array.isArray(calls) || !calls.length) { benchState = 'fail'; }
      else {
        try {
          const t0 = perf();
          const s = B.callSummary(B.evalCalls(calls, 55));
          const v = typeof B.verifiedSummary === 'function' ? B.verifiedSummary(calls, 55) : null;
          benchRes = { s, v, n: calls.length, ms: perf() - t0 };
          benchState = 'ok';
        } catch (e) { console.error('[stage] bench', e); benchState = 'fail'; }
      }
      const el = document.querySelector('.st-slide[data-id="finale"]');
      if (el) el.innerHTML = SLIDES.finale();
    });
  }
  function benchCard() {
    if (benchState === 'loading') return '<li>Бенч считается…</li>';
    if (benchState !== 'ok' || !benchRes) return '<li>Бенч — в bench.html</li>';
    const s = benchRes.s;
    return '<li><b>Бенч:</b> тревога до кода — ' + esc(s.withCode ? s.before + ' из ' + s.withCode : '—') + ' звонков (' + a('bench.html', 'bench.html') + ')</li>';
  }
  /* Слайды: ≤ 40 слов, одна мысль. Длинные оговорки — в заметках ведущего (N) и docs/PRESENTER.md. */
  const SLIDES = {
    title: () => '<div class="sl-kicker">Концепт команды NEXUS AI</div>' +
      '<h1 class="sl-h1">Атака на одного человека <span class="sl-grad">предотвращает потерю денег</span> другим</h1>' +
      '<p class="sl-lead">NEXUS слышит мошенника во время звонка и не даёт перевести деньги.</p>' +
      '<p class="sl-foot">Все данные синтетические. Не продукт банка-организатора.</p>',
    problem: () => '<div class="sl-kicker">Проблема в РК</div>' +
      '<h2 class="sl-h2">Чаще всего звонят «из банка»</h2>' +
      '<div class="sl-grid sl-g2">' +
        '<div class="sl-card"><div class="sl-num">26,3 тыс.</div><p>случаев интернет-мошенничества за январь–ноябрь 2025</p></div>' +
        '<div class="sl-card hl"><div class="sl-num acc">23,5%</div><p>из них — звонки и SMS от имени банков и полиции</p></div>' +
      '</div>' +
      '<div class="sl-src">Генпрокуратура РК через ' + a(SRC_INFORMBURO, 'Informburo.kz, 31.12.2025') + '</div>' +
      '<div class="sl-thesis">Реквизиты дропов банк узнаёт после жертвы. <b>NEXUS — до неё.</b></div>',
    cycle: () => '<div class="sl-kicker">Как работает</div>' +
      '<h2 class="sl-h2">Один цикл защиты</h2>' +
      '<div class="sl-icons">' + CYCLE.map((c) => '<div class="sl-ic"><span class="sl-ico">' + ic(c[0], 26) + '</span><div><b>' + esc(c[1]) + '</b><small>' + esc(c[2]) + '</small></div></div>').join('') + '</div>' +
      '<div class="sl-thesis">Реквизит из одного звонка <b>защищает следующего клиента.</b></div>',
    topics: () => '<div class="sl-kicker">6 тем брифа</div>' +
      '<h2 class="sl-h2">Один цикл <span class="sl-grad">закрывает все шесть</span></h2>' +
      '<ol class="sl-topics">' + TOPICS.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ol>',
    finale: () => '<div class="sl-kicker">Честно о прототипе</div>' +
      '<h2 class="sl-h2">' + (SHORT ? 'Что работает и что дальше' : 'Что работает и что нужно банку') + '</h2>' +
      '<ul class="sl-bul">' +
        '<li><b>Работает:</b> детектор давления, приманка, стоп-лист, правила клиента.</li>' +
        (SHORT ? '' : '<li><b>Симуляция:</b> звонки, клиенты, счета.</li>') +
        '<li><b>Нужно от банка:</b> SDK, номер-ловушка, процессинг.</li>' +
        (SHORT ? '<li><b>Пилот:</b> 90 дней в тени, платит банк.</li>' : '') +
        benchCard() +
      '</ul>' + (SHORT ? '<p class="sl-foot">Данные синтетические.</p>' : ''),
    newfeat: () => '<div class="sl-kicker">Ещё две защиты</div>' +
      '<h2 class="sl-h2">В кабинете клиента — и сразу в банке</h2>' +
      '<div class="sl-grid sl-g2">' +
        '<div class="sl-card vi"><h4>Не стань дропом</h4><p>Счёт превращают в транзит — NEXUS показывает безопасный выход.</p></div>' +
        '<div class="sl-card vi"><h4>Кредитный замок</h4><p>Один переключатель — и заём на вас не оформить.</p></div>' +
      '</div>' +
      '<p class="sl-foot">Демо: Помощь и Правила → Кредиты. Данные синтетические.</p>',
    pilot: () => '<div class="sl-kicker">Пилот</div><h2 class="sl-h2">90 дней в тени: <span class="sl-grad">сначала замеры</span></h2>' +
      '<div class="sl-card"><h4>Что просим</h4><ul class="sl-bul"><li>SDK в приложении банка</li><li>доступ «в тени» к решению по переводу</li><li>обезличенная история операций</li></ul></div>' +
      '<p class="sl-thesis">Платит банк, клиент — ничего.</p>' +
      '<p class="sl-new">Ещё две защиты: «Не стань дропом» и «Кредитный замок» — в кабинете.</p>',
    roi: () => '<div class="sl-kicker">Экономика · допущения команды</div><h2 class="sl-h2">Сколько потерь клиентов не случится</h2><div id="roiMount"></div>',
  };
  function buildSlides() {
    const body = $('#slidesBody');
    if (!body) return;
    const all = [];
    STEPS.forEach((s, si) => { (s.slides || []).forEach((id, i) => all.push({ si, i, id })); });
    body.innerHTML = all.map((x) => '<section class="st-slide' + (x.id === 'roi' || x.id === 'reality' ? ' top' : '') + '" data-slide="' + x.si + '.' + x.i + '" data-id="' + x.id + '">' + SLIDES[x.id]() + '</section>').join('');
    mountRoi();
  }
  function mountRoi() {
    const el = $('#roiMount');
    if (!el || !NX.ROI || typeof NX.ROI.mount !== 'function') { if (el) el.innerHTML = '<p class="sl-foot">ROI-калькулятор не загрузился (assets/js/roi.js).</p>'; return; }
    roiInst = NX.ROI.mount(el, {
      getDemoCase: () => S.lastCase,
      toast: (t, x) => toast(t, x, 'info', 'info'),
    });
  }
  function refreshDynamicSlides() {
    ['arch', 'pilot', 'finale'].forEach((id) => {
      const el = document.querySelector('.st-slide[data-id="' + id + '"]');
      if (el) el.innerHTML = SLIDES[id]();
    });
    if (roiInst && S.iocs.length && roiInst.setIocYield) roiInst.setIocYield(Math.max(1, S.iocs.length), 'в демо: ' + NX.countOf(S.iocs.length, ['реквизит', 'реквизита', 'реквизитов']) + ' за сессию');
  }
  function renderSlides() {
    const layer = $('#slides');
    if (!layer) return;
    const s = STEPS[S.step];
    if (!s.slides) { layer.classList.add('hidden'); return; }
    layer.classList.remove('hidden');
    const key = S.step + '.' + S.sub;
    const id = s.slides[S.sub];
    if (id === 'pilot' || id === 'arch' || id === 'finale') {
      const el = document.querySelector('.st-slide[data-id="' + id + '"]');
      if (el) el.innerHTML = SLIDES[id]();
    }
    document.querySelectorAll('.st-slide').forEach((el) => el.classList.toggle('active', el.getAttribute('data-slide') === key));
    const dots = $('#slideDots');
    if (dots) dots.innerHTML = s.slides.map((_, i) => '<i class="' + (i === S.sub ? 'on' : '') + '"></i>').join('');
  }

  /* ================= АВТОПИЛОТ ВСЕГО ДЕМО (A) ================= */
  // в этой сессии уже что-то запускали или в хранилище остались данные прошлого прогона
  function sceneDirty() {
    if (S.used || Object.keys(S.ran || {}).length) return true;
    if ((S.call && S.call.started) || (S.judge && (S.judge.open || S.judge.opened || S.judge.lines || S.judge.apIdx)) || (S.iocs && S.iocs.length)) return true;
    if (S.second || S.bankFocus || S.anchor.started || S.ato.requested || S.ato.started || S.fusion.shield || S.fusion.recoverShown) return true;
    if (NX.StageMore && NX.StageMore.ran()) return true;
    try { return NX.iocs.all().length + NX.inbox.all().length > 0; } catch (e) { return false; }
  }
  // слайды шага n по очереди: ms на слайд
  async function autoSlides(n, ms, alive) {
    const sl = STEPS[n].slides || [];
    goStep(n, 0);
    for (let i = 1; i < sl.length; i++) { await sleep(ms); if (!alive()) return false; goStep(n, i); }
    await sleep(ms); return alive();
  }
  /* Автопилот 3-минутного показа (?short=1): 5 битов. Каждый бит заканчивается на своей отметке хронометража
     (SHORT_MARKS, секунды от нажатия A) — под закадровый текст; переменные части (звонок, ловушка) идут
     в реальном времени, а пауза после них добирает время до отметки (но не меньше минимальной). Если что-то
     затянулось, бит держится минимум и показ идёт дальше. Возвращает длительность в мс или null (остановлен). */
  const SHORT_MARKS = { problem: 17, topics: 38, call: 80, decoy: 116, second: 146, fusion: 158, end: 180 };
  async function autoShortPath(alive, tA) {
    const hold = async (ms) => { await sleep(ms); return alive(); };
    // пауза до отметки mark (с), но не меньше minMs
    const until = (mark, minMs) => hold(Math.max(minMs || 0, tA + mark * 1000 - Date.now()));
    const M = SHORT_MARKS;
    // бит 1: проблема и 6 тем брифа
    goStep(0, 0); if (!(await until(M.problem, 8000))) return null;
    goStep(0, 1); if (!(await until(M.topics, 10000))) return null;
    // бит 2: звонок маме — тревога до просьбы кода
    goStep(1); if (!(await hold(800))) return null;
    runCall();
    await waitFor(() => !alive() || S.call.alertAt || S.call.ended, 60000); if (!alive()) return null;
    await waitFor(() => !alive() || S.call.codeAt || S.call.ended, 20000); if (!alive()) return null;
    if (!(await until(M.call, 2500))) return null;
    // бит 3: номер-ловушка — реквизит в стоп-лист
    goStep(2); if (!(await hold(1000))) return null;
    startJudgeAuto('auto');
    await waitFor(() => !alive() || S.iocs.length > 0, 45000); if (!alive()) return null;
    if (!(await until(M.decoy, 3500))) return null;
    // бит 4: Сауле Д. — удержание и Близкие (Цепочка дропов — одной фразой в подписи)
    goStep(4); if (!(await hold(700))) return null;
    runSecond();
    if (!(await until(M.second - 10, 5000))) return null;
    await waitPhoneAnswer(alive);
    if (S.second && S.second.ok && S.trust.at && !S.trust.answer) trustAnswer('check', 'автопилот');
    if (!(await until(M.second, 3500))) return null;
    // бит 5: ~10 секунд Fusion Center — «Звонит настоящий банк» и маскирование, затем финальный слайд
    goStep(6); if (!(await hold(700))) return null;
    runVerified();
    if (!(await until(M.fusion, 9000))) return null;
    goStep(LAST, 0);
    if (!(await until(M.end, 12000))) return null;
    return Date.now() - tA;
  }
  async function autoAll() {
    if (S.auto) { cancelAuto(false); return; }
    const tok = {};
    S.auto = tok;
    const btn = $('#btnAuto'); if (btn) btn.classList.add('on');
    const alive = () => S.auto === tok;
    const tA = Date.now();
    toast(SHORT ? 'Автопилот 3-минутного показа' : 'Автопилот демо', 'Шаги идут сами; любая клавиша навигации — стоп', 'info', 'play');
    try {
      if (!(await waitFor(() => !alive() || bothReady(), 9000)) || !alive()) return;
      // автопилот всегда идёт с чистой сцены: если что-то уже показывали — тот же сброс, что по R
      if (S.prepping) { await waitFor(() => !alive() || !S.prepping, 12000); if (!alive()) return; }
      if (sceneDirty()) {
        await prepareScene({ keepAuto: true }); if (!alive()) return;
        if (!(await waitFor(() => !alive() || (!S.prepping && S.framesUp && bothReady()), 9000)) || !alive()) return;
        await sleep(600); if (!alive()) return;
      }
      if (SHORT) {
        const ms = await autoShortPath(alive, tA);
        if (ms == null || !alive()) return;
        S.lastAutoMs = ms;
        try { document.body.setAttribute('data-auto-ms', String(ms)); } catch (e) { /* ignore */ }
        console.info('[stage] автопилот 3-минутного показа: ' + mmss(ms) + ' (' + ms + ' мс)');
        toast('Автопилот завершён за ' + mmss(ms), 'Биты 1–5 пройдены. A — ещё раз с чистой сцены, R — сброс', 'ok', 'check');
        return;
      }
      // 0: вступление — название, проблема, цикл, конституция
      if (!(await autoSlides(0, 5000, alive))) return;
      goStep(1); await sleep(900); if (!alive()) return;
      runCall();
      await waitFor(() => !alive() || S.call.alertAt || S.call.ended, 60000); if (!alive()) return;
      // дождаться просьбы кода: на сцене видно, что тревога пришла раньше неё (метрика «Запас до просьбы кода»)
      await waitFor(() => !alive() || S.call.codeAt || S.call.ended, 20000); if (!alive()) return;
      await sleep(2500); if (!alive()) return;
      goStep(2); await sleep(1200); if (!alive()) return;
      startJudgeAuto('auto');
      await waitFor(() => !alive() || S.iocs.length > 0, 45000); if (!alive()) return;
      await sleep(4500); if (!alive()) return;
      goStep(3); await sleep(700); if (!alive()) return;
      runBank();
      await waitFor(() => !alive() || S.chain || (S.bankFocus && S.bankFocus.t && NX.iocActive(statusOf(S.bankFocus.t)) && statusOf(S.bankFocus.t) !== 'suspected'), 6000); if (!alive()) return;
      await sleep(5500); if (!alive()) return; // зал читает цепочку счетов
      goStep(4); await sleep(700); if (!alive()) return;
      runSecond();
      await sleep(5500); if (!alive()) return; // «Обычный перевод» и удержание
      // Близкие: сын Сауле Д. просит проверку
      await waitPhoneAnswer(alive); if (!alive()) return;
      if (S.second && S.second.ok && S.trust.at && !S.trust.answer) { trustAnswer('check', 'автопилот'); await sleep(3500); if (!alive()) return; }
      goStep(5); await sleep(700); if (!alive()) return;
      // мошенник уговаривает ослабить конституцию → Правило 24 часов (без конституции — цепочка захвата аккаунта)
      runAnchor();
      await waitFor(() => !alive() || S.anchor.done, 15000); if (!alive()) return;
      if (S.anchor.skipped) { await waitFor(() => !alive() || S.ato.done, 25000); if (!alive()) return; }
      await sleep(6500); if (!alive()) return; // зал читает «Голос из спокойного времени»
      goStep(6); await sleep(900); if (!alive()) return;
      await runFusion(); if (!alive()) return;
      await sleep(6500); if (!alive()) return; // схема целиком + «Заблокировать всё»
      showRecover();
      await sleep(6000); if (!alive()) return; // «Меня обманули»
      // 7: не только звонки — маячок и CPP, конверт и телефон продавца, фейковая ссылка доставки
      if (MORE > 0 && NX.StageMore) {
        goStep(MORE); await sleep(800); if (!alive()) return;
        if (!(await NX.StageMore.auto(alive))) return;
      }
      if (!(await autoSlides(LAST, 6500, alive))) return;
      toast('Автопилот завершён', 'Вступление, 7 шагов и финал пройдены. A — ещё раз с чистой сцены, R — сброс', 'ok', 'check');
    } catch (e) {
      console.error('[stage] autopilot', e);
      errToast('Автопилот остановлен из-за сбоя');
    } finally {
      if (S.auto === tok) { S.auto = null; if (btn) btn.classList.remove('on'); }
    }
  }
  function cancelAuto(silent) {
    if (!S.auto) return;
    S.auto = null;
    const btn = $('#btnAuto'); if (btn) btn.classList.remove('on');
    if (S.judge && S.judge.apRunning) stopJudgeAuto(false);
    if (!silent) toast('Автопилот остановлен', 'Продолжайте вручную: → / Space', 'info');
  }
  function manual() { if (S.auto) cancelAuto(false); }

  /* ---------------- прочие действия ---------------- */
  function toggleFull() {
    const d = document, el = d.documentElement;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
      else if (el.requestFullscreen) { const p = el.requestFullscreen(); if (p && p.catch) p.catch(() => toast('Полный экран недоступен', 'Нажмите F11', 'info')); }
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else toast('Полный экран недоступен', 'Нажмите F11', 'info');
    } catch (e) { toast('Полный экран недоступен', 'Нажмите F11', 'info'); }
    setTimeout(layoutScale, 300);
  }
  // L: переключить LLM на месте, без перезагрузки сцены — живые замеры, стоп-лист и лог судьи сохраняются
  function toggleLlm() {
    const off = !FL.llmOff;
    FL.llmOff = off; // FL — это NX.flags: NX.llmStatus сразу видит новый режим
    [document.documentElement, document.body].forEach((el) => { try { if (el) el.classList.toggle('nx-llm-off', off); } catch (e) { /* ignore */ } });
    // экраны в iframe: тот же флаг, чтобы их ассистенты тоже перешли в нужный режим (при R он попадёт в URL экранов)
    ['client', 'bank'].forEach((k) => {
      const nx = fnx(k);
      try { if (nx && nx.flags) nx.flags.llmOff = off; } catch (e) { /* ignore */ }
    });
    // адрес сцены: ?llm=off переживёт перезагрузку страницы
    try {
      const p = new URLSearchParams(window.location.search);
      if (off) p.set('llm', 'off'); else p.delete('llm');
      p.delete('fresh');
      const q = p.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + (window.location.hash || ''));
    } catch (e) { /* ignore */ }
    checkLlm(true);
    updateJudgeUi();
    toast(off ? 'LLM выключен' : 'Включаем LLM', off ? 'Приманка — на офлайн-движке. Данные демо на месте, сцена не перезагружалась' : 'Проверяем доступность LLM. Данные демо на месте, сцена не перезагружалась', 'info');
  }
  function toggleFocusBank() {
    document.body.classList.toggle('focus-bank');
    toast(document.body.classList.contains('focus-bank') ? 'Крупно: банк' : 'Обычная раскладка', 'Z — переключить', 'info');
    setTimeout(fitAll, 30); setTimeout(fitAll, 420);
  }
  function apiRow(ok, text) { return '<div><span class="' + (ok ? 'y' : 'n') + '">' + ic(ok ? 'check' : 'x', 14) + '</span> ' + esc(text) + '</div>'; }
  // заметки ведущего: длинные оговорки шага (на сцене — только строка и короткая подпись); то же — в docs/PRESENTER.md
  function notesHtml() {
    const s = STEPS[S.step];
    if (!s || !s.note) return '';
    return '<div class="st-help-h">Заметки ведущего · ' + esc(S.step === 0 ? 'вступление' : S.step === LAST ? 'финал' : 'шаг ' + S.step) + '</div><p class="st-cap" style="margin-top:.4rem">' + esc(s.note) + '</p>';
  }
  function showNotes() {
    const h = notesHtml();
    NX.modal('<h3>' + esc(STEPS[S.step].title) + '</h3>' + (h || '<p class="st-sub">Для этого шага заметок нет.</p>') +
      '<div class="st-help-foot"><p>N — заметки, ? — справка.</p><button type="button" class="btn primary" data-close>Понятно</button></div>');
  }
  function showHelp() {
    const story = SHORT ? [
      ['1', 'Проблема в цифрах РК и 6 тем брифа'],
      ['2', 'Звонок маме: тревога до просьбы кода, пуш дочери'],
      ['3', 'Номер-ловушка: судья или автопилот играет мошенника, реквизит — в стоп-лист'],
      ['4', 'Сауле Д., 67: перевод на тот же реквизит удержан, сыну — запрос проверить; цепочка дропов — одной фразой'],
      ['5', '10 секунд панели банка: звонок клиенту с официального номера и маскирование ПДн; финальный слайд — что работает, что нужно'],
      ['Q&A', 'Правило 24 часов, «Заблокировать всё», «Меня обманули», «Не стань дропом», «Кредитный замок» — в полной сцене и в кабинете'],
    ] : [
      ['0', 'Вступление: название, проблема в двух числах, цикл защиты'],
      ['1', 'Звонок маме: тревога до просьбы кода, следующий шаг мошенника, пуш дочери'],
      ['2', 'Номер-ловушка: судья играет мошенника, приманка добывает счёт, реквизит уходит в стоп-лист'],
      ['3', 'Банк: счёт в цепочке дропов, риск на связанных счетах'],
      ['4', 'Сауле Д., 67: перевод удержан, сын Ерлан получает запрос проверить'],
      ['5', 'Мошенник уговаривает поднять лимит → правило 24 часов отклоняет, голос дочери'],
      ['6', 'Банк видит схему целиком; «Заблокировать всё» у клиентки; «Меня обманули» — если деньги ушли'],
      ['7', 'Не только звонки: карта для магазина выдаёт утечку; безопасная сделка ловит фейковую ссылку доставки (симуляция)'],
      ['8', 'Финал: что работает и что нужно; ещё две защиты — «Не стань дропом» и «Кредитный замок»; пилот 90 дней' + (FL.full ? '; ROI (допущения)' : '')],
    ];
    const rows = [
      ['→ / ←', 'следующий / предыдущий шаг или слайд'],
      ['Space', 'выполнить шаг, затем дальше; на шаге 2 — автопилот мошенника, если судья молчит; на шаге 4 — ответ Ерлана; на шаге 6 — щит, затем «Меня обманули»'],
      ['0–8', 'перейти к шагу (0 — вступление, 8 — финал) — без проверки «сначала завершите шаг»'],
      ['N', 'заметки ведущего к текущему шагу (оговорки: SDK, официальный номер, возврат денег)'],
      ['R', 'подготовить сцену: очистить оба экрана, «Сцена готова»'],
      ['A', 'автопилот всего демо (любая навигация — стоп)'],
      ['J', 'судья / автопилот мошенника'],
      ['M', 'микрофон судьи (Chrome / Edge, https или localhost)'],
      ['L', 'LLM вкл. / выкл. (?llm=off) — на месте, без перезагрузки сцены'],
      ['F', 'полный экран'],
      ['Z', 'крупно панель банка'],
      ['Печать', 'на шаге 2 первая буква открывает поле реплики; кириллица — всегда текст, горячие клавиши там — в латинской раскладке'],
      ['Enter', 'в поле реплики — отправить за мошенника; Esc — выйти из поля'],
    ];
    const cAtk = has('client', 'Stage.constitutionAttack'), cEng = has('client', 'Constitution.requestChange');
    const api = '<div class="st-help-h">Интерфейсы экранов</div><div class="st-api">' +
      apiRow(has('client', 'Stage.runDemoCore'), 'Кабинет: NX.Stage (персона, переходы, ATO, второй клиент)') +
      apiRow(has('client', 'Shield.runDemo'), 'Кабинет: NX.Shield.runDemo (демо-звонок)') +
      apiRow(has('client', 'Decoy.startInteractive'), 'Кабинет: NX.Decoy.startInteractive' + (has('client', 'Decoy.startInteractive') ? '' : ' — нет, используется пульт судьи на сцене')) +
      apiRow(cAtk, 'Кабинет: NX.Stage.constitutionAttack (Правило 24 часов)' + (cAtk ? '' : cEng ? ' — нет, шаг 5 вызывает движок конституции напрямую' : ' — нет, шаг 5 показывает цепочку захвата аккаунта')) +
      apiRow(cEng, 'Кабинет: NX.Constitution (финансовая конституция)') +
      apiRow(has('bank', 'BankStage.focusGraphOnIoc'), 'Банк: NX.BankStage.focusGraphOnIoc') +
      apiRow(has('client', 'Stage.manip') || !!(NX.Manip && NX.Manip.analyze), 'Детектор манипуляций: ' + (has('client', 'Stage.manip') ? 'NX.Stage.manip в кабинете' : NX.Manip && NX.Manip.analyze ? 'нет NX.Stage.manip — разбор сценой (NX.Manip)' : 'NX.Manip не загружен')) +
      apiRow(has('client', 'Stage.emergency'), 'Кабинет: NX.Stage.emergency («Заблокировать всё»)' + (has('client', 'Stage.emergency') ? '' : has('client', 'Emergency.activate') ? ' — нет, вызывается NX.Emergency.activate' : ' — нет')) +
      apiRow(has('bank', 'BankStage.showChain'), 'Банк: NX.BankStage.showChain (Цепочка дропов)' + (has('bank', 'BankStage.showChain') ? '' : ' — нет, шаг 3 показывает граф')) +
      apiRow(!!dnaEngine(), '«Обычный перевод» (NX.DNA)') +
      apiRow(has('bank', 'BankStage.secondClientTransfer'), 'Банк: NX.BankStage.secondClientTransfer') +
      (FL.full ? apiRow(!!(NX.ROI && NX.ROI.mount), 'ROI-калькулятор (roi.js)') : '') + '</div>';
    const keys = isMobile()
      ? '<p class="st-cap" style="margin-top:.6rem">На телефоне горячие клавиши не нужны: внизу — «←», действие шага и «→», над экраном — вкладки «Телефон / Банк». R — «Подготовить» и A — «Автопилот» в шапке.</p>'
      : '<div class="st-help-h">Горячие клавиши</div><div class="st-keys">' + rows.map((r) => '<kbd>' + esc(r[0]) + '</kbd><span>' + esc(r[1]) + '</span>').join('') + '</div>';
    NX.modal('<h3>Сцена NEXUS AI' + (SHORT ? ' · 3 минуты' : '') + '</h3><p class="st-sub">' + (SHORT ? 'Пять битов за 3 минуты (видео и отборочный тур). Автопилот (A) проходит их сам с чистой сцены и держит финальный слайд до отметки 3:00. Клавиши 1–5 — биты.' : '7 шагов + финал, примерно 5 минут. Автопилот (A) проходит их сам, каждый раз с чистой сцены.') + '</p>' +
      '<div class="st-help-h">Готовность сцены</div><div class="st-api">' + chipStates().map((c) => '<div><span class="' + (c.cls === 'ok' ? 'y' : 'n') + '">' + ic(c.cls === 'ok' ? 'check' : 'alert', 14) + '</span> ' + esc(c.text) + (c.title ? ' <span class="muted">— ' + esc(c.title) + '</span>' : '') + '</div>').join('') + '</div>' +
      notesHtml() +
      '<div class="st-help-h">Сюжет</div><div class="st-help-story">' + story.map((r) => '<div><b>' + esc(r[0]) + '.</b> ' + esc(r[1]) + '</div>').join('') + '</div>' +
      keys + api +
      '<div class="st-help-foot"><p>Сбой на сцене: R (сброс за ~3 с) или A (автопилот). Нет звука — демо идёт текстом. LLM недоступен — офлайн-приманка.</p><button type="button" class="btn primary" data-close>Понятно</button></div>');
  }
  function checkScamInClient() {
    const t = S.second && S.second.raw ? S.second.raw : (pickTarget() || {}).raw;
    if (!t) return;
    call('client', 'Stage.goto', ['scam']);
    setTimeout(() => {
      const d = fdoc('client');
      const ta = d && d.getElementById('scamText');
      const btn = d && d.getElementById('scanTextBtn');
      if (!ta || !btn) { toast('Раздел «Проверить» недоступен', '', 'warn'); return; }
      ta.value = 'Для защиты средств переведите деньги на счёт ' + t;
      try { ta.dispatchEvent(new (win('client').Event)('input', { bubbles: true })); } catch (e) { /* ignore */ }
      btn.click();
    }, 250);
  }

  /* ---------------- клавиатура ---------------- */
  const KEYMAP = { KeyR: 'r', KeyA: 'a', KeyJ: 'j', KeyL: 'l', KeyF: 'f', KeyM: 'm', KeyZ: 'z', KeyH: 'h', KeyN: 'n' };
  // поля, где клавиши — это ввод текста; ползунки, флажки и кнопки-инпуты навигацию не глотают
  const NON_TEXT_INPUT = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'];
  const CYR_RE = /[Ѐ-ӿ]/;
  // пульт судьи открыт на шаге 2, поле реплики не в фокусе
  const judgeConsoleOpen = () => S.step === 2 && S.judge && S.judge.open && S.judge.mode === 'console' && !!$('#judgeCard') && !$('#judgeCard').classList.contains('hidden');
  // первая печатная клавиша на шаге 2 — фокус в поле реплики и сам символ туда же
  function forwardToJudge(ch) {
    const inp = $('#judgeInput');
    if (!inp) return false;
    if (S.judge.apRunning) { stopJudgeAuto(false); inp.value = ''; } // судья перехватывает реплику у автопилота
    try { inp.focus(); } catch (e) { /* ignore */ }
    const v = String(inp.value || '');
    const max = Number(inp.getAttribute('maxlength')) || 400;
    if (v.length < max) {
      inp.value = v + ch;
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { /* ignore */ }
    }
    try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { S.judge.idleAt = Date.now(); }
    return true;
  }
  function onKey(e, src) {
    if (!e || e.defaultPrevented) return;
    const t = e.target;
    const tag = t && t.tagName ? t.tagName : '';
    const itype = tag === 'INPUT' ? String(t.type || 'text').toLowerCase() : '';
    const typing = (tag === 'INPUT' && NON_TEXT_INPUT.indexOf(itype) < 0) || tag === 'TEXTAREA' || tag === 'SELECT' || !!(t && t.isContentEditable);
    const k = e.key;
    if (typing) {
      // кликер ведущего (PageDown/PageUp) работает из любого поля
      if (k === 'PageDown' || k === 'PageUp') {
        e.preventDefault(); try { t.blur(); } catch (er) { /* ignore */ }
        manual(); if (k === 'PageDown') next(); else prev();
        return;
      }
      if (src === 'stage' && t.id === 'judgeInput') {
        const empty = !String(t.value || '').trim();
        // стрелки и пробел — навигация, когда поле реплики пустое
        if (empty && (k === 'ArrowRight' || k === ' ')) { e.preventDefault(); try { t.blur(); } catch (er) { /* ignore */ } manual(); if (k === ' ') primary(); else next(); return; }
        if (empty && k === 'ArrowLeft') { e.preventDefault(); try { t.blur(); } catch (er) { /* ignore */ } manual(); prev(); return; }
        if (k === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); }
        else if (k === 'Escape') { try { t.blur(); } catch (er) { /* ignore */ } }
        else S.judge.idleAt = Date.now();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (src === 'stage' && NX.isModalOpen && NX.isModalOpen()) return; // справка открыта: Esc закрывает
    if (src !== 'stage') { const fn = fnx(src); try { if (fn && fn.isModalOpen && fn.isModalOpen() && (k === ' ' || k === 'Enter' || k === 'Escape')) return; } catch (er) { /* ignore */ } }
    const onBtn = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || (tag === 'INPUT' && itype !== 'range') || !!(src !== 'stage' && t && t.closest && t.closest('[tabindex],[role="button"],[data-inc],[data-tx]'));
    // шаг 2, поле реплики не в фокусе: печатная клавиша, которая не горячая (латинские R/A/J/L/F/M/Z/H, 0–7, ?),
    // открывает поле и печатается в него. Кириллица на шаге 2 — всегда текст судьи (чтобы «Код…» не сбросил сцену).
    if (src === 'stage' && k && k.length === 1 && k !== ' ' && judgeConsoleOpen()) {
      const cyr = CYR_RE.test(k);
      const hot = !cyr && (!!KEYMAP[e.code] || /^[0-8?]$/.test(k));
      if (!hot && forwardToJudge(k)) { e.preventDefault(); e.stopPropagation(); return; }
    }
    const letter = KEYMAP[e.code] || (k && k.length === 1 ? k.toLowerCase() : '');
    let handled = true;
    if (k === 'ArrowRight' || k === 'PageDown') { manual(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { manual(); prev(); }
    else if (k === ' ' || k === 'Spacebar') { if (onBtn) handled = false; else { manual(); primary(); } }
    else if (/^[0-8]$/.test(k)) { manual(); goStep(keyStep(Number(k)), 0); }
    else if (k === '?' ) showHelp();
    else if (letter === 'r') prepareScene();
    else if (letter === 'a') autoAll();
    else if (letter === 'j') { manual(); toggleJudgeAuto(); }
    else if (letter === 'l') toggleLlm();
    else if (letter === 'f') toggleFull();
    else if (letter === 'm') toggleMic();
    else if (letter === 'z') toggleFocusBank();
    else if (letter === 'h') showHelp();
    else if (letter === 'n') showNotes();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }
  document.addEventListener('keydown', (e) => onKey(e, 'stage'));

  /* ---------------- клики ---------------- */
  function onAct(act) {
    if (act === 'primary') { manual(); primary(); }
    else if (act === 'next') { manual(); next(); }
    else if (act === 'prev') { manual(); prev(); }
    else if (act === 'toDecoy') { manual(); goStep(2); }
    else if (act === 'callMom') toast('Звонок маме', 'Айгерим перезванивает Гульнаре-апа (симуляция)', 'info', 'phone');
    else if (act === 'judgeAuto') toggleJudgeAuto();
    else if (act === 'why') {
      // во время ATO-прогона openWhy закрыл бы окно атаки и оборвал цепочку
      if (S.step === 5 && S.ato && !S.ato.done) { toast('Дождитесь конца цепочки', '«Почему?» откроется после решения NEXUS Core', 'info', 'clock'); return; }
      call('client', 'Stage.openWhy', ['last']);
    }
    else if (act === 'trustCheck') { manual(); trustAnswer('check', 'судья'); }
    else if (act === 'trustOk') { manual(); trustAnswer('ok', 'судья'); }
    else if (act === 'ato') { manual(); if (S.step === 5 && !S.ato.requested) runAto(); }
    else if (act === 'bankInc') { call('bank', 'BankStage.go', ['incidents']); S.fusion.bankView = 'incidents'; if (isMobile()) setMTab('bank', true); }
    else if (act === 'openIoc') { const f = S.bankFocus; if (f && f.t) call('bank', 'BankStage.openIoc', [f.t.value]); }
    else if (act === 'checkScam') checkScamInClient();
    else if (act === 'roiCase') {
      if (STEPS[LAST].slides.indexOf('roi') < 0) return;
      goStep(LAST, STEPS[LAST].slides.indexOf('roi'));
      if (roiInst && S.lastCase) {
        const added = roiInst.addDemoCase(S.lastCase);
        if (added === 'dup') toast('Кейс уже в расчёте', NX.fmt(S.lastCase.amount) + ' · ' + S.lastCase.client + ' — один перевод учитывается один раз', 'info', 'info');
        else if (added) toast('Кейс добавлен в ROI', NX.fmt(S.lastCase.amount) + ' · ' + S.lastCase.client, 'ok', 'check');
      }
    }
  }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const st = t.closest('[data-step]');
    if (st) {
      const n = Number(st.getAttribute('data-step'));
      if (isGated(n)) { toast('Сначала завершите шаг', 'Следующий шаг — ' + stepFrom(Math.min(LAST, (S.maxStep || 0) + 1), 1) + '. Ведущему: цифры 0–8 переходят без проверки', 'info', 'info'); return; }
      manual(); goStep(n, 0); return;
    }
    if (t.closest('#stReady')) { showHelp(); return; }
    const mt = t.closest('[data-mtab]');
    if (mt) { setMTab(mt.getAttribute('data-mtab'), true); return; }
    const cap = t.closest('.st-stepcard .st-cap');
    if (cap && isMobile()) { cap.classList.toggle('open'); return; }
    const act = t.closest('[data-act]');
    if (act) { onAct(act.getAttribute('data-act')); }
  });
  // после клика мышью кнопка не держит фокус: иначе Space «нажимал» бы её снова (R, автопилот, микрофон)
  // вместо шага демо. Слушатель в фазе всплытия — срабатывает после обработчиков самих кнопок.
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button, summary, a[href]') : null;
    if (b && document.activeElement === b) { try { b.blur(); } catch (er) { /* ignore */ } }
  });
  function bind(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
  bind('btnPrep', () => prepareScene());
  bind('btnAuto', () => autoAll());
  bind('btnFull', () => toggleFull());
  bind('btnHelp', () => showHelp());
  bind('slidePrev', () => { manual(); prev(); });
  bind('slideNext', () => { manual(); next(); });
  bind('judgeSend', () => { sendFromInput(); const i = $('#judgeInput'); if (i) { try { i.focus(); } catch (e) { /* ignore */ } } });
  bind('judgeMic', () => toggleMic());
  bind('judgeAuto', () => toggleJudgeAuto());
  bind('judgeLang', () => {
    const J = S.judge;
    J.lang = J.lang === 'kz' ? 'ru' : 'kz';
    if (J.recOn) { stopMic(true); J.recOn = true; J.recFails = 0; startRec(); }
    updateJudgeUi();
    toast('Язык распознавания: ' + (J.lang === 'kz' ? 'казахский' : 'русский'), 'Приманка отвечает на языке реплики', 'info');
  });
  bind('judgeVoice', () => { const J = S.judge; J.voice = !J.voice; if (!J.voice) { try { if (NX.tts) NX.tts.cancel(); else window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } } updateJudgeUi(); });
  const ji = $('#judgeInput');
  // программная печать автопилота (typeInto) событие input не порождает — сюда приходит только судья
  if (ji) ji.addEventListener('input', () => {
    S.judge.idleAt = Date.now();
    if (S.judge.apRunning) { /* судья начал печатать — перехватывает реплику */ stopJudgeAuto(false); }
    manual(); // и автопилот всего демо: дальше ведёт судья
  });

  /* ---------------- старт ---------------- */
  function parseHash() {
    const m = /s=(\d)(?:\.(\d+))?/.exec(window.location.hash || '');
    if (!m) return { step: 0, sub: 0 };
    return { step: clamp(Number(m[1]), 0, STEPS.length - 1), sub: Number(m[2] || 0) };
  }
  // часы в статус-баре телефона
  function tickClock() { const el = $('#phoneTime'); if (el) { const d = new Date(); el.textContent = d.getHours() + ':' + NX.pad(d.getMinutes()); } }
  function init() {
    // шаг 7 «Не только звонки» (stage-more.js): только вызовы API экранов через тот же call()
    if (NX.StageMore) NX.StageMore.init({
      step: MORE, call, has, fdoc, fnx, isMobile, toast,
      isCurrent: () => S.step === MORE,
      setState: (html, kind, step) => setState(html, kind, step),
      refresh: () => { S.ran[MORE] = true; markUsed(); renderStepCard(); renderResult(); },
      setMTab: (t) => setMTab(t, false),
      next: () => next(),
    });
    tickClock(); setInterval(tickClock, 15000);
    resetSession();
    buildSlides();
    if (SHORT) { try { document.body.classList.add('st-short'); } catch (e) { /* ignore */ } }
    loadBench(); // финальный слайд: «тревога до кода» тем же NX.Bench, что bench.html
    initVoices();
    checkLlm(false);
    setInterval(() => checkLlm(false), 60000);
    const h = parseHash();
    S.step = h.step; S.sub = h.sub;
    goStep(h.step, h.sub, { noEnter: true });
    S.pendingEnter = true;
    layoutScale();
    loadFrame('client'); loadFrame('bank');
    ping();
    updateLink();
    setTimeout(() => {
      if (!FR.client.loaded || !FR.bank.loaded) toast('Экраны загружаются дольше обычного', 'Проверьте, что сайт открыт через сервер (serve.ps1 или деплой), а не через file://', 'warn', 'clock');
    }, 9000);
    if (window.location.protocol === 'file:') toast('Сцена открыта как файл', 'Для связи клиента и банка откройте её через serve.ps1 (localhost) или деплой', 'warn', 'info');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
