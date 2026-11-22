// =====================================================================
// NEXUS AI — маскирование персональных данных перед LLM (ИСТОЧНИК ИСТИНЫ)
// Используется в server/nexus-chat.mjs: каждое сообщение и снимок контекста маскируются
// на сервере ещё раз, даже если браузер уже это сделал (защита в глубину).
// Клиентская копия — NX.maskPII в assets/js/core.js (блок <nx-mask-pii>).
// Паритет проверяет `node scripts/mask-parity.mjs`: обе копии должны дать
// одинаковый результат на корпусе assets/data/attack-corpus.js и sms-corpus.js.
// Меняете правило здесь — перенесите его в core.js и запустите проверку.
// Без зависимостей: модуль импортируют и сервер, и скрипт проверки.
// =====================================================================

// Порядок важен: IBAN и карты раньше телефонов, ИИН (12 цифр) после длинных номеров.
export const MASK_RULES = [
  [/\bKZ[0-9*•]{2}(?:[  ]?[0-9A-Z*•]{4}){2,5}/g, "[счёт]"],
  [/\b\d{4}(?:[  -]?(?:\d{4}|[•*]{4})){3}\b/g, "[карта]"],
  [/\b\d{13,19}\b/g, "[номер]"],
  [/[•*]{4}[  ]?\d{4}\b/g, "[карта]"],
  [/(?:\+7|\b8)[  (-]*\d{3}[  )-]*(?:\d{3}|\*{3}|•{3})[  -]*\d{2}[  -]*\d{2}\b/g, "[телефон]"],
  [/[•*]{5,}\d{0,4}/g, "[номер]"],
  [/\b\d{12}\b/g, "[ИИН]"],
];

const LETTER = "A-Za-zА-Яа-яЁё";
// слова из подписей получателей, которые не являются именами
export const NAME_STOP = ["Арендодатель", "Пример", "Инвест", "Мама", "Сын", "Дочь", "Сестра", "Брат"];

// Имена → основы: «Гульнара» → «Гульнар», чтобы ловить «Гульнаре», «Гульнарой».
export function nameStems(names) {
  const stems = [];
  (Array.isArray(names) ? names : []).forEach((n) => {
    (String(n == null ? "" : n).match(/[А-ЯЁA-Z][а-яёa-z]{2,}/g) || []).forEach((w) => {
      if (NAME_STOP.indexOf(w) >= 0) return;
      const s = w.length > 4 && /[аяоеиуыь]$/.test(w) ? w.slice(0, -1) : w;
      if (stems.indexOf(s) < 0) stems.push(s);
    });
  });
  return stems.sort((a, b) => b.length - a.length);
}

// text → строка с метками [счёт], [карта], [номер], [телефон], [ИИН], [имя].
// opts.stems — основы имён (nameStems); сервер имён клиента не знает и маскирует только номера.
export function maskPII(text, opts) {
  let s = String(text == null ? "" : text);
  MASK_RULES.forEach((r) => {
    s = s.replace(r[0], r[1]);
  });
  const stems = opts && Array.isArray(opts.stems) ? opts.stems.filter((w) => typeof w === "string" && w.length >= 3) : [];
  if (stems.length) {
    const alt = stems.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const rx = new RegExp("(^|[^" + LETTER + "])(?:" + alt + ")[" + LETTER + "]*(?:[ \\u00a0][А-ЯЁA-Z]\\.)?", "g");
    s = s.replace(rx, "$1[имя]");
  }
  return s;
}
