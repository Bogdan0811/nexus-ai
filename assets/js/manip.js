/* NEXUS AI — Детектор манипуляций (UNDERSTAND + PREDICT)
   NX.Manip.analyze(input) разбирает реплики звонящего по порядку и находит стадии социальной инженерии:
   имитация авторитета → страх → срочность → изоляция → доступ (коды, программы) → банковское приложение → перевод денег.
   Последовательность важнее отдельных слов: совпадение со сценарием считается по стадиям и их порядку.
   Детерминированно, без сети и без lookbehind. RU + KZ.
   Индекс риска 0–100 — это не вероятность: он складывается из найденных стадий и их сочетаний.
   «Совпадение со сценарием: N из M стадий» — доля стадий шаблона, найденных в разговоре. */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});

  const STAGES = [
    { id: 'authority', label: 'Имитация авторитета' },
    { id: 'fear', label: 'Манипуляция страхом' },
    { id: 'urgency', label: 'Искусственная срочность' },
    { id: 'isolation', label: 'Изоляция жертвы' },
    { id: 'access', label: 'Попытка получить доступ' },
    { id: 'app', label: 'Просьба открыть банковское приложение' },
    { id: 'money', label: 'Перевод денег' },
  ];
  const STAGE_LABEL = {};
  STAGES.forEach((s) => (STAGE_LABEL[s.id] = s.label));

  /* Шаблоны сценариев: стадии в ожидаемом порядке. rank — место стадии в сценарии
     (одинаковый rank — порядок между ними не важен, например «приложение» и «код»). */
  const TEMPLATES = [
    {
      id: 'fake_bank_support', label: 'Ложная служба безопасности банка', en: 'Fake Bank Support',
      stages: ['authority', 'fear', 'urgency', 'isolation', 'app', 'access', 'money'], rank: [0, 1, 1, 2, 3, 3, 4],
      summary: '«Сотрудник банка» сообщает о подозрительной операции, просит не класть трубку, открыть приложение, назвать код и перевести деньги на «безопасный счёт»',
    },
    {
      id: 'fake_police', label: 'Лжеправоохранители', en: 'Fake Police',
      stages: ['authority', 'fear', 'isolation', 'urgency', 'money'], rank: [0, 1, 2, 2, 3],
      summary: '«Следователь» пугает уголовным делом, требует хранить «тайну следствия» и перевести сбережения на «специальный счёт»',
    },
    {
      id: 'relative_in_trouble', label: '«Родственник в беде»', en: 'Relative in Trouble',
      stages: ['authority', 'fear', 'urgency', 'isolation', 'money'], rank: [0, 1, 2, 2, 3],
      summary: 'Звонящий выдаёт себя за родственника или «следователя», сообщает о беде, просит никому не говорить и срочно перевести деньги',
    },
    {
      id: 'investment', label: 'Инвестиционный обман', en: 'Investment Scam',
      stages: ['authority', 'urgency', 'access', 'money'], rank: [0, 1, 2, 3],
      summary: '«Брокер» обещает гарантированный доход, торопит, просит установить приложение или показать экран и внести депозит',
    },
    {
      id: 'remote_access', label: 'Удалённый доступ к телефону', en: 'Remote Access Scam',
      stages: ['authority', 'fear', 'access', 'app', 'money'], rank: [0, 1, 2, 3, 4],
      summary: '«Поддержка» пугает блокировкой, просит установить программу удалённого доступа, открыть банковское приложение и подтвердить операцию',
    },
    {
      id: 'prize_compensation', label: 'Приз / компенсация', en: 'Prize / Compensation',
      stages: ['authority', 'urgency', 'access', 'money'], rank: [0, 1, 2, 3],
      summary: 'Звонящий обещает выплату или приз, торопит, просит данные карты или код и «комиссию» за получение',
    },
  ];
  const TPL = {};
  TEMPLATES.forEach((t) => (TPL[t.id] = t));
  const NONE_TYPE = { id: 'none', label: 'Признаков сценария атаки нет', en: 'No attack pattern' };

  const ADVICE = {
    authority: 'Звонящий может назваться сотрудником банка, полиции или родственником. Положите трубку и перезвоните сами по официальному номеру.',
    fear: 'Следующим шагом будут пугать: «подозрительная операция», «уголовное дело», «беда с близким». Это повод остановиться, а не торопиться.',
    urgency: 'Дальше начнут торопить: «у нас несколько минут». Настоящий банк всегда даёт время подумать.',
    isolation: 'Попросят не класть трубку и никому не рассказывать — это главный признак обмана. Расскажите близким.',
    app: 'Попросят открыть банковское приложение во время звонка. Не открывайте его по просьбе звонящего.',
    access: 'Попросят код из SMS, данные карты или установить программу. Не называйте коды и ничего не устанавливайте.',
    money: 'Дальше попросят перевести деньги на «безопасный» или «специальный» счёт. Такого счёта не существует.',
  };

  /* ---------------- нормализация и разбор реплик ---------------- */
  const L = 'а-яәғқңөұүһіa-z'; // буквы RU + KZ + латиница (после toLowerCase)
  const T = '[' + L + ']*'; // окончание слова
  const S = '(?:^|[^' + L + '0-9])'; // начало слова без lookbehind
  const E = '(?:[^' + L + ']|$)'; // конец слова
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„]/g, ' ');
  const rx = (src) => new RegExp(src, 'i');

  // Фразы, которыми говорит настоящий банк или близкий: такие клаузы не считаются просьбами
  const PROTECT = [
    rx('никогда не (спрашива|проси|запрашива|треб|звон|присыла|предлага)'),
    // «ешқашан» само по себе («никогда») не защита: только «ешқашан … сұрамайды / талап етпейді»
    rx('ешқашан[^.!?;,]{0,40}(сұрама|талап етпе|сұратпа|хабарласпа)'),
    rx('(ничего|никаких' + T + ') [' + L + ' ]{0,20}(называть|сообщать|говорить|платить|переводить|диктовать|вводить)[' + L + ' ]{0,12}не (нужно|надо|требуется)'),
    rx('(платить|называть|сообщать|переводить|диктовать) [' + L + ' ]{0,10}не (нужно|надо|требуется)|не (нужно|надо) (ничего )?(платить|называть|сообщать|переводить|диктовать)'),
    rx('(положите|кладите|клади) трубку и (сами )?(перезвон|звони)|перезвоните (сами )?(в банк )?по (номеру|телефону) (на|с) (обороте|карте|сайте|официальн)'),
    rx('код' + T + '[' + L + ' -]{0,15}никому не (сообщайте|говорите|называйте|передавайте|показывайте|диктуйте)|никому не (сообщайте|говорите|называйте|передавайте|показывайте|диктуйте)[' + L + ' ]{0,15}код'),
    rx('код' + T + '[' + L + ' -]{0,10}ешкімге (айтпаңыз|бермеңіз|көрсетпеңіз)'),
    rx('асықпаңыз|не торопитесь|спокойно подумайте'),
    rx('төлем' + T + ' қажеті жоқ'),
  ];
  // уловка мошенника: «никому не говорите код, кроме меня»
  const TRICK = rx('кроме (меня|нас|сотрудник|специалист|оператор|следовател)|только (мне|нам)' + E + '|только (сотрудник|специалист|оператор|следовател|менеджер)|то есть мне|маған ғана|бізге ғана|қызметкерге ғана');
  // внутри предложения защитной считается только своя часть (до запятой, тире, двоеточия),
  // иначе одна успокаивающая фраза («банк никогда не спрашивает коды, но сейчас продиктуйте код») прячет просьбу
  const SUBCLAUSE = /[^,:—–]+[,:—–]*/g;

  const CODE = '(код|пароль|пин|cvv|cvc|цифр)';
  const ASK_RU = '(продиктуй|назови|назовит|скажи|скажит|сообщи|введи|введит|отправь|пришли|напиши)';
  const P = {
    authority: [
      { re: rx('служб' + T + ' [' + L + ' ]{0,15}(безопасности|поддержки|мониторинга|социальн)'), why: 'называет себя службой безопасности или поддержки' },
      { re: rx('отдел' + T + ' (безопасности|финансов|мониторинг|социальн|выплат|по борьбе)'), why: 'называет себя отделом банка или госоргана' },
      { re: rx('(сотрудник|специалист|менеджер)' + T + ' (банка|службы|национальн|отдела|поддержки)|старш' + T + ' специалист'), why: 'представляется сотрудником банка' },
      { re: rx('следовател|полици|прокуратур|прокурор|финпол|' + S + '(кнб|афм)' + E + '|департамент' + T + ' (полиции|финансов|юстиции)|' + S + '(капитан|майор|лейтенант|подполковник)' + E), why: 'называет себя сотрудником правоохранительных органов' },
      { re: rx('национальн' + T + ' банк|нацбанк|агентств' + T + ' (по|финансов)'), why: 'ссылается на Национальный банк или госагентство' },
      { re: rx('техническ' + T + ' поддержк|оператор' + T + ' (сотов|связи|мобильн)'), why: 'представляется технической поддержкой или оператором связи' },
      { re: rx('официальн' + T + ' (партнер|представител|брокер)|финансов' + T + ' (аналитик|консультант|советник)|' + S + 'брокер|лицензи|(персональн' + T + '|ваш' + T + ') (менеджер|консультант|аналитик)|менеджер' + T + ' по (инвестиц|работе с клиент)'), why: 'называет себя официальным финансовым партнёром' },
      { re: rx('социальн' + T + ' (выплат|фонд)|' + S + 'енпф|госорган|правительств'), why: 'ссылается на госорган и выплаты' },
      { re: rx(S + 'это я' + E + '|не узнал|с чужого (телефона|номера)|(мой|телефон) (разбился|разбил|сломал|потерял)|у меня новый номер'), why: 'выдаёт себя за родственника с чужого номера' },
      { re: rx('қауіпсіздік қызмет|банк' + T + ' қызметкер|тергеуш|' + S + 'полиция|қаржылық мониторинг|агенттіг|техникалық қолдау|қолдау қызмет|ұлттық банк|байланыс оператор'), why: 'KZ: называет себя сотрудником банка, полиции или поддержки' },
      { re: rx('бұл менмін|телефоным (сынып|сынды|бұзылды|жоғалды)|досымның нөмір|жаңа нөмір'), why: 'KZ: выдаёт себя за родственника с чужого номера' },
    ],
    fear: [
      { re: rx('подозрительн' + T + ' (операц|списан|перевод|вход|покупк|активност|транзакц)'), why: 'сообщает о «подозрительной операции»' },
      { re: rx('попытк' + T + ' (списа|входа|оформ|снят|взлом)|мошенник' + T + ' (уже|получили|оформ|пытаются|могут)|доступ к вашему (счету|аккаунту|приложению)|взлом'), why: 'пугает тем, что мошенники уже получили доступ' },
      { re: rx(S + '(за)?блокир|спишут|потеряете|лишитесь|арест' + T + ' (счет|имуществ)|замороз'), why: 'угрожает блокировкой или потерей денег' },
      { re: rx('уголовн' + T + ' дел|возбужден' + T + ' [' + L + ' ]{0,12}дел|против вас|соучаст|снять подозрени|привлеч' + T + ' (к ответствен|как)|задержал|задержан'), why: 'пугает уголовным делом' },
      { re: rx('кредит' + T + ' на ваше имя|на ваше имя [' + L + '0-9 ]{0,30}(кредит|заявк)|(поступил|подан|оформлен|одобрен)' + T + ' [' + L + ' ]{0,12}заявк' + T + ' на кредит|оформ' + T + ' [' + L + ' ]{0,12}кредит'), why: '«на вас оформляют кредит»' },
      { re: rx('авари|' + S + 'дтп' + E + '|сбил' + T + ' (человек|пешеход)|в больниц|попал' + T + ' в (беду|аварию|полицию|дтп)|виновник'), why: 'сообщает о беде с близким' },
      { re: rx('срок' + T + ' действия[' + L + ' -]{0,25}истека|истекает'), why: 'пугает окончанием срока и отключением' },
      { re: rx('пытаются (вывести|списать|снять|оформить|получить)|вывести (ваши )?(деньги|средства)|ваши данные (использовал|утекли|похитил|попали)|утечк' + T + ' данн|вход [' + L + ' ]{0,25}с (чужого|нового|неизвестного|другого) устройств|чуж' + T + ' устройств'), why: 'пугает тем, что деньги или данные уже в опасности' },
      { re: rx('(грозит|угрожает|светит) [' + L + ' ]{0,20}(ответствен|штраф|арест|срок|суд)|ответственност|преступн' + T + ' (групп|схем|деятельн)|финансировани' + T + ' (террор|преступ|экстрем)'), why: 'угрожает ответственностью перед законом' },
      { re: rx('у меня (проблем|беда|неприятност)|забрали в (полицию|участок|отдел)|мне (очень )?страшно|помоги' + T + ',? (пожалуйста|срочно)'), why: 'изображает беду, чтобы вызвать панику' },
      { re: rx('қауіп төн|жауапкершілік|қылмыстық топ|мерзімі (бітеді|аяқталады)[' + L + ' ,]{0,30}бұғат'), why: 'KZ: угрожает ответственностью или опасностью' },
      { re: rx('күдікті|бұғатта|жоғалады|жоғалтасыз|қылмыстық іс|несие рәсімдел|заңсыз несие|қиын жағдай|ұстап алды|қамап|бөгде құрылғы|шешілгелі|' + S + 'апат'), why: 'KZ: пугает подозрительной операцией, блокировкой или бедой' },
    ],
    urgency: [
      { re: rx('срочно|немедленно|сейчас же|сегодня же|прямо сейчас|как можно скорее|в течение (\\d+|часа|пятнадцати|десяти|пяти|нескольких|получаса|минуты|суток)|несколько минут|только сегодня|до \\d{1,2}[:.]\\d{2}|пока (не поздно|ее не одобрили|не одобрили|не списали)|времени (мало|нет|почти нет)|ограничен|сгорит|успеть|последн' + T + ' (день|шанс)'), why: 'торопит и не даёт времени подумать' },
      { re: rx('до конца (дня|часа|суток|недели)|(предложение|акция|выплата) [' + L + ' ]{0,15}до (завтра|вечера|понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья)|в ближайш' + T + ' (час|минут|полчаса)|перейдет другому|не теряйте времени|счет идет на минуты|иначе (будет поздно|не успеете)'), why: 'ставит жёсткий срок' },
      { re: rx('шұғыл|тез арада|тезірек|бүгін ғана|бүгінге дейін|уақыт шектеулі|' + S + 'дереу'), why: 'KZ: торопит (шұғыл, тез арада)' },
    ],
    isolation: [
      { re: rx('не (кладите|вешайте|отключайтесь|прерывайте|бросайте)|оставайтесь на линии'), why: 'просит не класть трубку' },
      { re: rx('никому не (говорите|рассказывайте|сообщайте|говори|рассказывай)'), why: 'просит никому не рассказывать' },
      { re: rx('не (обсуждайте|сообщайте|говорите|рассказывайте)[' + L + ' ]{0,30}(сотрудник|родствен|близк|отделени|банк|муж|детям|отцу|папе)'), why: 'запрещает обсуждать разговор с близкими или банком' },
      { re: rx('тайн' + T + ' следстви|не имеете права разглаш|разглаш|конфиденциальн|в сговоре|особенно (отцу|папе|мужу|родственникам|детям)|(отцу|папе|мужу|жене|детям|родственникам) не (говори|рассказывай)'), why: 'требует хранить «тайну» и не доверять никому' },
      { re: rx('нельзя (никому )?(сообщать|говорить|рассказывать|разглашать)|закрыт' + T + ' (проверк|расследован)'), why: 'запрещает рассказывать о разговоре' },
      { re: rx('не (ходите|обращайтесь|звоните) в (отделение|банк|полицию)'), why: 'отговаривает обращаться в банк' },
      { re: rx('телефонды қоймаңыз|ешкімге айтпа|тергеу құпия|отбасыңызға да|әкеме айтпа|шешеме айтпа|ешкімге (хабарламаңыз|білдірмеңіз)'), why: 'KZ: просит не класть трубку и никому не говорить' },
    ],
    access: [
      { re: rx(CODE + T + '[\\s\\S]{0,60}' + ASK_RU + '|' + ASK_RU + T + '[\\s\\S]{0,40}' + CODE), why: 'просит назвать код или цифры' },
      { re: rx('подтверд' + T + ' [' + L + ' ]{0,20}код'), why: 'просит подтвердить операцию кодом' },
      { re: rx('номер' + T + ' карт' + T + '[\\s\\S]{0,30}(срок|cvv|cvc|код)|данные карт|реквизит' + T + ' карт|срок действия карт'), why: 'просит данные карты' },
      { re: rx('(установите|скачайте|загрузите|поставьте) [' + L + ' ]{0,30}(приложени|программ)|anydesk|rustdesk|teamviewer|quick ?support|aspia|демонстраци' + T + ' экран|удаленн' + T + ' (доступ|помощ|подключ)|доступ к (экрану|телефону)'), why: 'просит установить программу или показать экран' },
      { re: rx('(перейдите|пройдите|откройте) по ссылке'), why: 'просит перейти по ссылке' },
      { re: rx('(код|құпия сөз)' + T + '[\\s\\S]{0,40}(айтыңыз|айтыңызшы|айтшы|жіберіңіз|енгізіңіз)|растау код'), why: 'KZ: просит назвать код' },
      { re: rx('бағдарлама' + T + ' орнат|қосымша' + T + ' (жүктеп ал|орнат)|қашықтан қосыл|карта деректер|карта нөмір|экран' + T + ' көрсет'), why: 'KZ: просит установить программу или данные карты' },
    ],
    app: [
      { re: rx('(откройте|зайдите|войдите|запустите|авторизуйтесь)[\\s\\S]{0,25}(приложени|мобильн' + T + ' банк|личн' + T + ' кабинет|интернет-банк|онлайн-банк)|раздел' + T + ' (перевод|платеж)'), why: 'просит открыть банковское приложение' },
      { re: rx('қосымша' + T + ' (ашыңыз|кіріңіз)'), why: 'KZ: просит открыть банковское приложение' },
    ],
    money: [
      // повелительное наклонение — всегда просьба; инфинитив — только с «нужно / надо / необходимо» («оплатить можно в приложении» — не просьба)
      { re: rx(S + '(переведите|перечислите|отправьте деньги|внесите|оплатите|снимите|пополните|задекларируйте|возместите)'), why: 'требует перевести или внести деньги' },
      { re: rx('(нужно|надо|необходимо|должны|должен|должна|требуется|придется|обязаны)[\\s\\S]{0,35}(перевести|перечислить|снять|внести|оплатить|возместить|задекларировать|пополнить)'), why: 'требует перевести или внести деньги' },
      { re: rx(S + '(переведи|перекинь|скинь|кинь|займи|одолжи|отправь|оплати|положи)' + E + '[\\s\\S]{0,30}(\\d|деньг|денег|карт|сч)'), why: 'просит перевести деньги на чужую карту' },
      { re: rx('(безопасн|резервн|защищенн|специальн|встречн|проверочн|временн|контрольн|транзитн)' + T + ' (счет|кредит|ячейк)'), why: '«безопасный счёт» — такого не существует' },
      { re: rx('номер карты я [' + L + ' ]{0,15}(скажу|продиктую|пришлю)'), why: 'готовится продиктовать номер карты для перевода' },
      { re: rx('аударыңыз|аудару керек|аударып жібер|аударамыз|төлеңіз|төлеу керек|салыңыз|қауіпсіз шот|теңге керек|ақша' + T + ' керек'), why: 'KZ: требует перевести деньги' },
    ],
  };
  // обещание выгоды — не стадия шаблона, но усиливает давление и индекс риска
  const LURE = [
    { re: rx('гарантирова' + T + ' (доход|доходност|прибыл)|(доход|доходность|прибыль) гарантир|удва' + T + ' (деньг|вклад|капитал|сумм)|' + S + 'удво' + T + '|ничем не рискуете|без риска|пассивн' + T + ' доход|от \\d+ ?%|\\d+ ?% в (месяц|день|неделю)|удво' + T + ' (деньг|вклад)'), why: 'обещает гарантированный высокий доход' },
    { re: rx('компенсаци|положена (выплата|компенсация)|выигр|победител|стали обладател|' + S + 'приз' + E + '|призов|розыгрыш|подарок|выплат' + T + ' (положен|одобрен)'), why: 'обещает выплату, компенсацию или приз' },
    { re: rx('ұтыс|жүлде|ұтып алдыңыз|сыйлық|өтемақы|кепілдендірілген табыс'), why: 'KZ: обещает приз или компенсацию' },
  ];

  /* «Звонит настоящий банк»: звонящий называет себя банком. Сам по себе не стадия и не меняет индекс:
     нужен, чтобы сказать «Банк сейчас вам не звонил», когда в приложении нет отметки о звонке банка. */
  const BANK_CLAIM = rx('(вас беспокоит|беспокоит|звоню из|звоним из|говорит|на связи|' + S + 'это)[^.!?]{0,30}банк|' + S + 'банк' + T + ' [' + L + '-]+,? меня зовут|(служб|отдел|сотрудник|специалист|менеджер)' + T + '[^.!?]{0,40}банк|банк' + T + ' (қызмет|қауіпсіздік)|банктің|банктен|бұл [^.!?]{0,20}банк');
  // уловка: «у вас в приложении сейчас отметка, что звонит банк» — отметку видно только в приложении, звонящий на неё не ссылается
  const BADGE_CLAIM = rx('(отметк|значок|галочк|бейдж|пометк)' + T + '[^.!?]{0,40}(приложени|экран)|(в|у вас в) приложении[^.!?]{0,30}(отметк|значок|галочк|видно|видите|показано|высвет)|провер' + T + ' (отметк|значок|галочк)|қосымша' + T + '[^.!?]{0,30}(белгі|таңба)');

  // Признаки «темы» звонка — по ним выбирается тип атаки вместе с совпадением стадий
  const TOPIC = {
    fake_bank_support: [[rx('банк'), 1], [rx(S + 'карт|картаң'), 1], [rx('сч[е]т|' + S + 'шот'), 1], [rx('служб' + T + ' безопасност|қауіпсіздік қызмет'), 3], [rx('кредит|несие'), 1], [rx('вашего банка|банк' + T + ' қызметкер'), 2], [rx('подозрительн|күдікті'), 2], [rx('приложени' + T + ' банк|банк қосымша'), 1]],
    fake_police: [[rx('следовател|тергеуш'), 3], [rx('полици|' + S + 'полиция'), 2], [rx('уголовн|қылмыстық'), 2], [rx('тайн' + T + ' следств|тергеу құпия'), 3], [rx(S + '(кнб|афм)' + E + '|агентств|агенттіг|прокурат'), 2], [rx('соучаст|задерж'), 2], [rx(S + '(капитан|майор|лейтенант)' + E), 2], [rx('национальн' + T + ' банк|ұлттық банк'), 1], [rx('специальн' + T + ' сч'), 1]],
    relative_in_trouble: [[rx(S + '(мам|сынок|доченьк|внуч|бабушк)|' + S + 'апа' + E), 3], [rx(S + 'это я' + E + '|бұл менмін|не узнал'), 3], [rx('чужого (телефона|номера)|досымның нөмір|телефоным|разбился|новый номер'), 3], [rx('авари|' + S + 'дтп' + E + '|сбил|больниц|виновник|пострадавш'), 2], [rx('отцу|папе|әкеме'), 2], [rx('ваш (сын|внук)|ваша дочь'), 2]],
    investment: [[rx('инвест'), 3], [rx('бирж'), 2], [rx('брокер|трейд|торгов'), 2], [rx('доходност|пассивн' + T + ' доход|прибыл'), 3], [rx('крипт|биткоин|usdt'), 3], [rx('%'), 1], [rx('депозит'), 1]],
    remote_access: [[rx('anydesk|rustdesk|teamviewer|quick ?support|aspia'), 4], [rx('демонстрац' + T + ' экран|удаленн' + T + ' (доступ|подключ)|қашықтан'), 3], [rx('оператор' + T + ' (сотов|связи|мобильн)|сим-карт'), 3], [rx('техническ' + T + ' поддержк|техникалық қолдау'), 2], [rx('скачайте|установите|орнатыңыз'), 2], [rx('бағдарлама'), 2], [rx('экран'), 1]],
    prize_compensation: [[rx('компенсац|өтемақы'), 3], [rx('выплат'), 2], [rx('выигр|' + S + 'приз|розыгрыш|ұтыс|жүлде|ұтып'), 3], [rx('подар|сыйлық'), 2], [rx('госпошлин|комисси|жеткізу ақы|доставк'), 2], [rx('вклад'), 1]],
  };

  const W = { authority: 12, fear: 18, urgency: 12, isolation: 22, access: 35, app: 15, money: 30 };
  const W_LURE = 22;
  const combine = (ws) => Math.round(100 * (1 - ws.reduce((p, w) => p * (1 - Math.max(0, Math.min(95, w)) / 100), 1)));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function toLines(input) {
    if (input == null) return [];
    if (Array.isArray(input)) return input.map((x) => (x && typeof x === 'object' ? String(x.text == null ? '' : x.text) : String(x == null ? '' : x))).filter((s) => s.trim());
    const s = String(input);
    let parts = s.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean);
    // одна длинная строка — делим на предложения, чтобы видеть порядок стадий
    if (parts.length === 1) parts = (parts[0].match(/[^.!?]+[.!?]*/g) || [parts[0]]).map((x) => x.trim()).filter(Boolean);
    return parts;
  }
  function clauseAt(orig, idx) {
    let a = idx, b = idx;
    while (a > 0 && !/[.!?;\n]/.test(orig.charAt(a - 1))) a--;
    while (b < orig.length && !/[.!?;\n]/.test(orig.charAt(b))) b++;
    let q = orig.slice(a, Math.min(orig.length, b + 1)).trim();
    if (q.length > 120) {
      const from = Math.max(0, idx - a - 50);
      q = (from > 0 ? '…' : '') + q.slice(from, from + 110).trim() + '…';
    }
    return q;
  }

  // Разбор одной реплики: защитные клаузы (честные предупреждения) вырезаются пробелами той же длины
  function scanLine(orig) {
    const n = norm(orig);
    let txt = '';
    let protective = 0;
    const protectQuotes = [];
    const re = /[^.!?;]+[.!?;]*/g;
    let m, last = 0;
    while ((m = re.exec(n))) {
      txt += n.slice(last, m.index);
      const seg = m[0];
      const isProt = PROTECT.some((p) => p.test(seg)) && !TRICK.test(seg);
      if (isProt) {
        // вырезаем только защитные части предложения; остальное (просьба кода, перевода) анализируется
        let out = '', any = false, qs = [], sm;
        SUBCLAUSE.lastIndex = 0;
        let sl = 0;
        while ((sm = SUBCLAUSE.exec(seg))) {
          out += seg.slice(sl, sm.index);
          if (PROTECT.some((p) => p.test(sm[0]))) { any = true; qs.push(orig.substr(m.index + sm.index, sm[0].length).replace(/[,:—–\s]+$/, '').trim()); out += sm[0].replace(/[^\s]/g, ' '); } else out += sm[0];
          sl = sm.index + sm[0].length;
        }
        out += seg.slice(sl);
        if (!any) { out = seg.replace(/[^\s]/g, ' '); qs = [orig.substr(m.index, seg.length).trim()]; } // защитная фраза пересекает запятую — вырезаем предложение целиком
        protective++; protectQuotes.push(qs.join(' … ')); txt += out;
      } else txt += seg;
      last = m.index + seg.length;
    }
    txt += n.slice(last);
    const hits = {};
    Object.keys(P).forEach((id) => {
      for (let i = 0; i < P[id].length; i++) {
        const mm = P[id][i].re.exec(txt);
        if (mm) {
          // индекс начала значимой части (пропускаем символ-границу S)
          let at = mm.index;
          while (at < txt.length && /[^а-яәғқңөұүһіa-z0-9%]/i.test(txt.charAt(at))) at++;
          hits[id] = { why: P[id][i].why, quote: clauseAt(orig, Math.min(at, orig.length - 1)) };
          break;
        }
      }
    });
    let lure = null;
    for (let i = 0; i < LURE.length; i++) { const mm = LURE[i].re.exec(txt); if (mm) { lure = { why: LURE[i].why, quote: clauseAt(orig, Math.min(mm.index + 1, orig.length - 1)) }; break; } }
    const bc = BANK_CLAIM.exec(txt);
    const bankClaim = bc ? { quote: clauseAt(orig, Math.min(bc.index + 1, orig.length - 1)) } : null;
    const bg = BADGE_CLAIM.exec(txt);
    const badgeClaim = bg ? { quote: clauseAt(orig, Math.min(bg.index + 1, orig.length - 1)) } : null;
    return { hits, lure, protective, protectQuotes, norm: txt, bankClaim, badgeClaim };
  }

  function pickTemplate(scans, found) {
    let best = null;
    TEMPLATES.forEach((t) => {
      let topic = 0;
      scans.forEach((sc, i) => {
        const k = i < 2 ? 1.5 : 1; // предлог задаётся в начале разговора
        TOPIC[t.id].forEach(([re, w]) => { if (re.test(sc.norm)) topic += w * k; });
      });
      const matched = t.stages.filter((s) => found[s]).length;
      const score = topic + (matched / t.stages.length) * 3;
      if (!best || score > best.score) best = { t, score, topic, matched };
    });
    return best;
  }
  function orderOk(t, found) {
    const seq = t.stages.map((s, i) => ({ s, r: t.rank[i] })).filter((x) => found[x.s]).sort((a, b) => found[a.s].line - found[b.s].line || a.r - b.r);
    for (let i = 1; i < seq.length; i++) if (seq[i].r < seq[i - 1].r) return false;
    return true;
  }

  function evaluate(scans, opts) {
    const found = {}; // stage → {line, quote, why}
    const counts = {};
    let lure = null, lureCount = 0, protective = 0;
    const protectQuotes = [];
    scans.forEach((sc, i) => {
      Object.keys(sc.hits).forEach((id) => {
        counts[id] = (counts[id] || 0) + 1;
        if (!found[id]) found[id] = { line: i, quote: sc.hits[id].quote, why: sc.hits[id].why };
      });
      if (sc.lure) { lureCount++; if (!lure) lure = { line: i, quote: sc.lure.quote, why: sc.lure.why }; }
      protective += sc.protective;
      sc.protectQuotes.forEach((q) => protectQuotes.push(q));
    });
    const has = (id) => !!found[id];
    const ids = STAGES.map((s) => s.id).filter(has);
    const manipulations = ids.reduce((s, id) => s + counts[id], 0) + lureCount;
    let base = combine(ids.map((id) => W[id]).concat(lure ? [W_LURE] : []));
    base += Math.min(8, 2 * (manipulations - ids.length - (lure ? 1 : 0)));
    const critical = has('access') || has('money');
    const lureOn = !!lure;
    let bonus = 0;
    const combos = [];
    if (has('authority') && (has('fear') || lureOn)) { bonus += 12; combos.push(has('fear') ? 'авторитет + угроза' : 'авторитет + обещание выгоды'); }
    if (has('urgency') && (has('fear') || lureOn)) { bonus += 8; combos.push('угроза или выгода + спешка'); }
    if (has('isolation') && (has('authority') || has('fear'))) { bonus += 8; combos.push('изоляция после давления'); }
    if (critical && (has('fear') || has('urgency') || has('isolation') || lureOn)) { bonus += 10; combos.push('просьба кода/перевода на фоне давления'); }
    const tp = ids.length || lureOn ? pickTemplate(scans, found) : null;
    let scenario = null;
    if (tp) {
      const inOrder = orderOk(tp.t, found);
      scenario = { template: tp.t.id, label: tp.t.label, matched: tp.matched, of: tp.t.stages.length, inOrder };
      if (inOrder && tp.matched >= 3) bonus += 6;
    }
    let riskIndex = base + bonus;
    // защитные фразы не снижают индекс и не гасят тревогу, если уже прозвучала просьба кода или перевода:
    // «не торопитесь» мошенник может вставить нарочно
    const protEff = critical ? 0 : protective;
    if (protEff) riskIndex = Math.min(riskIndex - 15 * protEff, 30);
    riskIndex = clamp(Math.round(riskIndex), 0, 100);
    // классические связки социальной инженерии: «авторитет + угроза/выгода» и «угроза/выгода + спешка».
    // «Авторитет + угроза» без спешки, изоляции или просьбы — так начинает и настоящий банк, поэтому это ещё не тревога
    // (индекс ~40 даёт «Будьте внимательны»), тревога — когда добавляется давление или просьба
    const pressureOn = has('urgency') || has('isolation') || lureOn || critical || has('app');
    const classic = !protEff && ((has('authority') && (has('fear') || lureOn) && pressureOn) || (has('urgency') && (has('fear') || lureOn)));
    const baseAlert = riskIndex >= 50 || classic || (critical && ids.length >= 2 && riskIndex >= 40);
    // «Звонит настоящий банк»: отметка о звонке пришла в приложение (opts.verified) — тревога только на просьбе кода,
    // доступа или перевода: такого не просит даже настоящий банк. Индекс риска не меняется, меняется уровень.
    let bankClaim = null, badgeClaim = null;
    scans.forEach((sc, i) => {
      if (sc.bankClaim && !bankClaim) bankClaim = { line: i, quote: sc.bankClaim.quote };
      if (sc.badgeClaim && !badgeClaim) badgeClaim = { line: i, quote: sc.badgeClaim.quote };
    });
    const verified = !!(opts && opts.verified === true);
    let alert = verified ? critical : baseAlert;
    if (badgeClaim) alert = true; // звонящий ссылается на «отметку в приложении» — сам по себе признак манипуляции
    return { found, counts, ids, lure, manipulations, riskIndex, scenario, tp, protective, protEff, protectQuotes, alert, baseAlert, combos, critical, verified, bankClaim, badgeClaim };
  }

  function pressureOf(ev) {
    const c = ev.counts;
    const ws = [];
    if (c.fear) ws.push(35);
    if (c.urgency) ws.push(25);
    if (c.isolation) ws.push(40);
    if (ev.lure) ws.push(15);
    const repeats = (c.fear || 0) + (c.urgency || 0) + (c.isolation || 0) - ws.length + (ev.lure ? 1 : 0);
    let score = ws.length ? combine(ws) + 5 * Math.max(0, repeats) : 0;
    if (ev.protEff) score = Math.max(0, score - 20 * ev.protEff);
    score = clamp(Math.round(score), 0, 100);
    return { level: score >= 65 ? 'высокое' : score >= 35 ? 'среднее' : 'низкое', score };
  }

  function nextOf(ev) {
    if (!ev.tp || ev.riskIndex < 25) return null;
    const t = ev.tp.t;
    if (ev.found.money) return null;
    let maxRank = -1;
    t.stages.forEach((s, i) => { if (ev.found[s]) maxRank = Math.max(maxRank, t.rank[i]); });
    const order = t.stages.map((s, i) => ({ s, r: t.rank[i] })).sort((a, b) => a.r - b.r);
    const nx = order.find((x) => !ev.found[x.s] && x.r >= maxRank) || order.find((x) => !ev.found[x.s]);
    return nx ? { id: nx.s, label: STAGE_LABEL[nx.s], advice: ADVICE[nx.s] } : null;
  }

  /* opts.verified: true — в приложении активна отметка «Сейчас вам действительно звонит банк»;
     false — приложение знает, что отметки нет (тогда звонящему «из банка» добавляется фактор «Банк сейчас вам не звонил»);
     не задано — как раньше (бенчмарк без отметки). */
  function analyze(input, opts) {
    const o = opts || {};
    const lines = toLines(input);
    const scans = lines.map(scanLine);
    // тревога по ходу разговора: на какой реплике детектор поднял бы тревогу
    const timeline = [];
    let alertLine = null;
    for (let k = 0; k < scans.length; k++) {
      const e = evaluate(scans.slice(0, k + 1), o);
      timeline.push({ line: k, riskIndex: e.riskIndex, alert: e.alert, critical: e.critical, stages: e.ids.slice() });
      if (alertLine == null && e.alert) alertLine = k;
    }
    const ev = evaluate(scans, o);
    const stages = STAGES.filter((s) => ev.found[s.id]).map((s) => ({ id: s.id, label: s.label, line: ev.found[s.id].line, quote: ev.found[s.id].quote, why: ev.found[s.id].why }))
      .sort((a, b) => a.line - b.line || STAGES.findIndex((x) => x.id === a.id) - STAGES.findIndex((x) => x.id === b.id));
    const attack = ev.tp && (ev.riskIndex >= 25 || ev.critical) ? ev.tp.t : null;
    const attackType = attack ? { id: attack.id, label: attack.label, en: attack.en } : Object.assign({}, NONE_TYPE);
    const scenario = attack && ev.scenario ? ev.scenario : { template: null, label: '', matched: 0, of: 0, inOrder: false };
    const pressure = pressureOf(ev);
    const next = attack ? nextOf(ev) : null;
    const why = [];
    stages.forEach((s) => why.push(s.label + ': ' + s.why + (s.quote ? ' — «' + s.quote + '»' : '')));
    if (ev.lure) why.push('Обещание выгоды: ' + ev.lure.why + ' — «' + ev.lure.quote + '»');
    if (attack) why.push('Совпадение со сценарием «' + attack.label + '»: ' + scenario.matched + ' из ' + scenario.of + ' стадий' + (scenario.inOrder ? ', в типичном порядке' : ', порядок нетипичный'));
    if (ev.combos.length && ev.riskIndex >= 25) why.push('Сочетания признаков: ' + ev.combos.join('; '));
    if (ev.protEff) why.push('Звонящий сам предупреждает о мошенниках или советует перезвонить по официальному номеру — так говорит настоящий банк: «' + ev.protectQuotes[0] + '»');
    else if (ev.protective) why.push('Успокаивающие фразы («' + ev.protectQuotes[0] + '») не снижают индекс: звонящий всё равно просит код, доступ или перевод');
    const noBankCall = o.verified === false && ev.bankClaim ? { line: ev.bankClaim.line, quote: ev.bankClaim.quote } : null;
    if (noBankCall) why.push(NO_BANK_CALL + ': звонящий называет себя банком — «' + noBankCall.quote + '», а отметки о звонке банка в приложении нет');
    if (ev.badgeClaim) why.push('Звонящий ссылается на «отметку в приложении» — «' + ev.badgeClaim.quote + '». Отметку видно только в приложении, настоящему сотруднику незачем о ней говорить: это признак манипуляции');
    if (ev.verified) why.push(ev.critical ? 'Отметка «звонит банк» есть, но звонящий просит код, доступ или перевод — этого не просит даже настоящий банк' : 'В приложении есть отметка «Сейчас вам действительно звонит банк» — уровень «проверенный звонок»; просьба кода или перевода всё равно поднимет тревогу');
    const level = ev.alert ? 'alert' : ev.verified ? 'verified' : ev.riskIndex >= 25 ? 'caution' : 'calm';
    let recommendation;
    if (ev.verified && !ev.alert) recommendation = 'Это проверенный звонок банка: отметка пришла в приложение. Но даже настоящий сотрудник не просит коды из SMS, установку программ и переводы — если попросят, положите трубку.';
    else if (ev.verified && ev.alert) recommendation = 'Отметка «звонит банк» не отменяет главного правила: банк никогда не просит коды и переводы. Положите трубку и перезвоните по номеру на обороте карты.';
    else if (ev.riskIndex >= 50 || ev.alert) recommendation = 'Положите трубку. Перезвоните в банк сами по номеру на обороте карты. Не называйте коды, ничего не устанавливайте и не переводите деньги по просьбе звонящего.';
    else if (ev.riskIndex >= 25) recommendation = 'Будьте внимательны: в разговоре есть признаки давления. Не называйте коды и не переводите деньги, пока не перезвоните по официальному номеру.';
    else recommendation = 'Явных признаков манипуляции нет. Если попросят код из SMS, установить программу или перевести деньги — положите трубку.';
    return {
      attackType, stages, sequence: stages.map((s) => s.id), manipulations: ev.manipulations,
      pressure, scenario, riskIndex: ev.riskIndex, next, recommendation, why,
      alert: ev.alert, alertLine, timeline, lines: lines.length,
      protectiveCues: ev.protective, lure: ev.lure ? { line: ev.lure.line, quote: ev.lure.quote } : null,
      critical: !!ev.critical, verified: ev.verified, level, noBankCall,
      bankClaim: ev.bankClaim ? { line: ev.bankClaim.line, quote: ev.bankClaim.quote } : null,
      badgeClaim: ev.badgeClaim ? { line: ev.badgeClaim.line, quote: ev.badgeClaim.quote } : null,
    };
  }
  const NO_BANK_CALL = 'Банк сейчас вам не звонил';

  NX.Manip = {
    version: 1,
    STAGES: STAGES.map((s) => Object.assign({}, s)),
    TEMPLATES: TEMPLATES.map((t) => ({ id: t.id, label: t.label, en: t.en, stages: t.stages.slice(), rank: t.rank.slice(), summary: t.summary })),
    ADVICE: Object.assign({}, ADVICE),
    NO_BANK_CALL,
    analyze(input, opts) {
      try { return analyze(input, opts); } catch (e) {
        if (typeof console !== 'undefined') console.error(e);
        return { attackType: Object.assign({}, NONE_TYPE), stages: [], sequence: [], manipulations: 0, pressure: { level: 'низкое', score: 0 }, scenario: { template: null, label: '', matched: 0, of: 0, inOrder: false }, riskIndex: 0, next: null, recommendation: 'Не удалось разобрать разговор. Если попросят код или перевод — положите трубку.', why: [], alert: false, alertLine: null, timeline: [], lines: 0, protectiveCues: 0, lure: null };
      }
    },
    template(id) { const t = TPL[id]; return t ? { id: t.id, label: t.label, en: t.en, stages: t.stages.slice(), rank: t.rank.slice(), summary: t.summary } : null; },
    stageLabel(id) { return STAGE_LABEL[id] || ''; },
  };
})();
