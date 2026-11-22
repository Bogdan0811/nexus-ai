/* =====================================================================
   NEXUS Decoy · офлайн-движок приманки и пост-фильтр (общий для сцены и кабинета)
   Один источник для stage.js (шаг 2 «Сыграйте мошенника»), shield.js (NX.Decoy в кабинете)
   и самопроверки bench.html (часть 3): бенчмарк проверяет ровно тот код, что работает в демо.
   Приманка только тянет время и переспрашивает: в репликах нет цифр, ссылок и данных клиента.
   Пост-фильтр (то же правило на сервере — DECOY_FORBIDDEN в server/nexus-chat.mjs) заменяет
   любую реплику с 4+ цифрами, IBAN, ссылкой или e-mail на нейтральную.
   Состояние диалога хранит вызывающий код: {slots, used, lastPool, finalSaid, accs, replies}.
   ===================================================================== */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});

  const LINES = {
    ru: {
      open: ['Алло… Слушаю вас. Кто это?'],
      who: ['Ой, здравствуйте. А вы из какого банка, сынок? Как вас зовут — я запишу.', 'Из банка? А отдел какой? Внучка велела всегда спрашивать фамилию.'],
      code: ['Код? Телефон в другой комнате… А зачем код, если деньги спасать надо? Куда их переводить-то?', 'Внучка говорила, код никому нельзя. Давайте я лучше сама переведу — скажите, на какой счёт?'],
      askAcc: ['Хорошо-хорошо. Продиктуйте счёт медленно, я на бумажку записываю.', 'Куда переводить-то, балам? Скажите ещё раз, ручка плохо пишет.', 'Подождите, очки найду… Вот. Диктуйте, куда переводить.'],
      askOwner: ['Записала. А на чьё имя этот счёт? Внучка сказала всегда спрашивать.', 'Так… А получатель кто, как фамилия? Я в тетрадку впишу.'],
      askAlt: ['А если туда не получится — есть другой счёт или номер телефона? Приложение у меня капризное.', 'Последнее не расслышала… Может, ещё какой-нибудь номер есть, на всякий случай?'],
      pressure: ['Не торопите меня, у меня давление. Сейчас, чайник выключу.', 'Сынок, не кричи, я же стараюсь. Сейчас всё сделаем, только не спеши.'],
      final: ['Всё записала. Сейчас внучка придёт, она в этом лучше разбирается. Вы подождите, не кладите трубку.'],
    },
    kz: {
      who: ['Сәлеметсіз бе, балам. Қай банктен хабарласып тұрсыз? Атыңыз кім, жазып алайын.'],
      code: ['Код па? Немерем кодты ешкімге айтпа деген… Ақшаны қайда аудару керек, соны айтшы.'],
      askAcc: ['Балам, шот нөмірін қайталап айтшы, көзілдірігімді іздеп жатырмын.', 'Асықпай айтшы, қағазға жазып отырмын.'],
      askOwner: ['Жаздым. Бұл шот кімнің атына ашылған?'],
      askAlt: ['Басқа шот не телефон нөмірі бар ма? Қосымша ашылмай тұр.'],
      pressure: ['Айқайламашы, балам, қысымым көтеріліп кетті. Шайнекті өшіріп келейін.'],
      final: ['Бәрін жаздым. Қазір немерем келеді, сол көмектеседі. Күте тұрыңыз.'],
    },
  };
  const NEUTRAL = ['Ой, подождите, очки никак не найду… Повторите медленнее, куда переводить-то?', 'Плохо слышно, сынок. Продиктуй ещё раз, я на бумажку записываю.'];
  const KZ_RE = /[әғқңөұүһі]/i;
  const CODE_RE = /(^|[^а-яё])(код|кода|коды|смс|пароль|cvv)|sms|кодты|құпия/i;
  const PRESS_RE = /быстр|срочн|скорее|немедленн|некогда|тез|жылдам|шұғыл/i;
  const WHO_RE = /банк|служб|полиц|следовател|прокурат|қызмет/i;
  // пост-фильтр любой реплики приманки (офлайн и LLM): никаких 4+ цифр подряд, IBAN, ссылок, e-mail
  const FORBIDDEN = [
    { key: 'digits', label: '4+ цифр', re: /(?:\d[\s-]?){4,}/ },
    { key: 'iban', label: 'IBAN', re: /(^|[^a-z])KZ\d{2}/i },
    { key: 'url', label: 'ссылка', re: /https?:\/\//i },
    { key: 'www', label: 'ссылка', re: /(^|\s)www\./i },
    { key: 'domain', label: 'домен', re: /[a-z0-9-]+\.(?:kz|ru|com|net|org|top|xyz|online|site|info|me|io|app|link|shop|click|live|test)(?![a-z])/i },
    { key: 'email', label: 'e-mail', re: /[^\s@]+@[^\s@]+\.[^\s@]+/ },
  ];

  const newState = () => ({ slots: {}, used: {}, lastPool: null, finalSaid: false, accs: [], replies: 0 });
  // какие запрещённые элементы есть в тексте: [] — чисто
  function leaks(text) {
    const s = String(text || '');
    return FORBIDDEN.filter((f) => f.re.test(s)).map((f) => f.key);
  }
  function filter(text, i) {
    let s = String(text || '').replace(/^\s*(?:Гульнара[^:\n]{0,20}|Приманка|NEXUS Decoy|Decoy)\s*:\s*/i, '').trim().slice(0, 400);
    if (!s || leaks(s).length) s = NEUTRAL[Math.abs(Number(i) || 0) % NEUTRAL.length];
    return s;
  }
  function pickLine(st, lang, pool) {
    const arr = (LINES[lang] && LINES[lang][pool]) || LINES.ru[pool] || NEUTRAL;
    const key = lang + ':' + pool;
    const i = st.used[key] || 0;
    st.used[key] = i + 1;
    return arr[i % arr.length];
  }
  function foundKey(f) {
    let v = f.value != null ? f.value : f.raw;
    try { if (NX.normIoc) v = NX.normIoc(f.kind, v) || v; } catch (e) { /* ignore */ }
    return f.kind + ':' + String(v == null ? '' : v);
  }
  // Реплика приманки на реплику мошенника. found — реквизиты из NX.extractIocs(text).
  function reply(st, text, found) {
    if (!st.slots) st.slots = {};
    if (!st.used) st.used = {};
    if (!Array.isArray(st.accs)) st.accs = [];
    const sl = st.slots;
    const t = String(text || '');
    const lang = KZ_RE.test(t) ? 'kz' : 'ru';
    if (sl.askedOwner && !sl.owner && st.lastPool === 'askOwner') sl.owner = true;
    const accs = (found || []).filter((f) => f && f.kind !== 'domain');
    const accNow = accs.length > 0;
    if (accNow) {
      // «другой счёт» — только если назван НОВЫЙ реквизит, а не повтор того же
      const fresh = accs.map(foundKey).filter((k) => st.accs.indexOf(k) < 0);
      if (sl.acc && fresh.length) sl.alt = true;
      sl.acc = true;
      fresh.forEach((k) => { if (st.accs.indexOf(k) < 0) st.accs.push(k); });
    }
    if ((found || []).some((f) => f && f.kind === 'domain')) sl.site = true;
    const turn = (st.replies || 0) + 1;
    let pool;
    if ((sl.acc && sl.owner && sl.alt) || turn >= 9) pool = st.finalSaid ? (st.lastPool === 'pressure' ? 'askAlt' : 'pressure') : 'final';
    else if (accNow) pool = sl.owner ? 'askAlt' : 'askOwner';
    else if (CODE_RE.test(t) && !sl.acc) pool = 'code';
    else if (turn === 1 && WHO_RE.test(t)) pool = 'who';
    else if (PRESS_RE.test(t) && st.lastPool !== 'pressure') pool = 'pressure';
    else if (!sl.acc) pool = 'askAcc';
    else if (!sl.owner) pool = 'askOwner';
    else pool = 'askAlt';
    if (pool === 'final') st.finalSaid = true;
    if (pool === 'askOwner') sl.askedOwner = true;
    st.lastPool = pool;
    return pickLine(st, lang, pool);
  }

  NX.DecoyEngine = { LINES, NEUTRAL, FORBIDDEN, KZ_RE, newState, reply, filter, leaks, foundKey, isKz: (t) => KZ_RE.test(String(t || '')) };
})();
