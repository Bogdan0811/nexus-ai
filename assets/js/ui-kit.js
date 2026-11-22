/* =====================================================================
   NEXUS AI · ui-kit — общие компоненты интерфейса (spec v4, 2.1 и 2.9)
   Подключается на всех 5 страницах сразу после core.js:
   index.html, client.html, bank.html, stage.html, bench.html.

   NX.ui.FEATURES        единый массив статусов функций для поповера «Что работает в прототипе»
   NX.ui.honestyHTML()   содержимое поповера (3 группы: работает / данные симулированы / нужна интеграция)
   NX.ui.honestyPopover(anchor?)  открыть/закрыть поповер у элемента; любой [data-nx-honesty] открывает его по клику
   NX.ui.honestyTag(text?)        HTML тега «демо-данные» для топбара (кнопка с data-nx-honesty)
   NX.ui.details(body, opts?)     HTML <details class="more"> с summary «Подробнее»
   NX.ui.riskWord(score)          { level:'low'|'mid'|'high', word, html } — пороги 25 / 55, как в NX.scoreTransfer
   NX.ui.tagDemo(text?)           HTML маленького серого тега «демо» рядом с синтетическим числом
   NX.ui.statusLine(kind, text, link?)  HTML строки статуса (calm / warn / danger)
   NX.ui.seg(items, active, opts?)      HTML сегментного переключателя .seg
   NX.ui.sheet(opts)              полноэкранный на телефоне лист с закреплёнными кнопками; возвращает { el, close }
   NX.ui.markReady(id)            отметить функцию как готовую (для «Не стань дропом» и «Кредитного замка»)

   Иконки (v5): одна линейная семья в стиле Lucide — stroke currentColor 1.75, viewBox 24, по умолчанию 20px, aria-hidden.
   NX.icon(name, opts?)           строка <svg class="nx-ic">; opts = { size: 20, label: '', cls: '', stroke: 1.75 }.
                                  label → role="img" + aria-label + <title> (иконка без текста рядом). Кнопке-иконке
                                  ставьте aria-label на саму кнопку, иконку оставляйте без label.
                                  Старая форма NX.icon(name, cls, size) из core.js поддерживается (без size — без width/height,
                                  размер задаёт CSS, как раньше). Неизвестное имя → прежний рисунок core.js / client.js.
   NX.iconFor(category, opts?)    <svg> по категории операции: Супермаркет/Продукты → cart, Такси/АЗС/Транспорт → car,
                                  Кафе → coffee, Аптека/Здоровье → pill, Онлайн-покупки/электроника → package,
                                  Переводы: входящий → arrow-down-left, исходящий → arrow-up-right; Доход → arrow-down-left,
                                  Подписки → refresh, Коммунальные → home, Развлечения → tv; иначе card.
                                  opts = 'in' | 'out' | сумма (знак задаёт направление) | { dir, amount, size, label, cls }.
   NX.iconNameFor(category, dir?) то же, но возвращает имя иконки.
   NX.ICONS                       все доступные имена.
   Имена: shield shield-check shield-alert phone phone-off smartphone card wallet banknote send lock unlock users user
     alert alert-octagon check check-circle x x-circle info help search link image message mail bell bank graph chart
     trending-up activity clock calendar eye eye-off bot mic store cart car fuel coffee pill package home settings refresh
     rotate-ccw play pause stop arrow-right arrow-left arrow-up-right arrow-down-left chevron-right chevron-down plus minus
     menu external file download upload sparkle zap key fingerprint gift briefcase truck flag globe heart tv cpu scale.
     Синонимы: shieldCheck, phoneOff, checkCircle, arrowRight …, reset → rotate-ccw, bolt → zap, credit-card → card,
     landmark → bank, triangle-alert → alert. Прочие имена core.js (book, folder, dna, target, qr …) рисуются как раньше.
     Пример: btn.innerHTML = NX.icon('phone-off', { size: 16 }) + 'Положить трубку';
             '<span class="ic">' + NX.iconFor(tx.category, tx.amount) + '</span>'

   Правила: весь текст проходит через NX.esc; аргументы с именем *Html / body — уже готовая разметка вызывающего.
   Без анимаций появления: компоненты открываются только по действию пользователя.
   ===================================================================== */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});
  const esc = typeof NX.esc === 'function' ? NX.esc
    : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- иконки: одна линейная семья (Lucide-style, ISC), stroke currentColor 1.75, viewBox 24 ----------
     NX.icon(name, opts?) → строка <svg> (API — в шапке файла). Старая форма NX.icon(name, cls, size) из core.js работает как раньше.
     Неизвестное ui-kit имя → рисунок core.js (book, folder, dna …) той же толщины линии; client.js добавляет свои поверх. */
  const ICON = {
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    'shield-alert': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'phone-off': '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><path d="M22 2 2 22"/>',
    smartphone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'alert-octagon': '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.31 2a2 2 0 0 1 1.42.59l4.68 4.68A2 2 0 0 1 22 8.69v6.62a2 2 0 0 1-.59 1.42l-4.68 4.68a2 2 0 0 1-1.42.59H8.69a2 2 0 0 1-1.42-.59l-4.68-4.68A2 2 0 0 1 2 15.31V8.69a2 2 0 0 1 .59-1.42l4.68-4.68A2 2 0 0 1 8.69 2z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
    bank: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>',
    graph: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7 7.5l3.8 8.2M17 7.5l-3.8 8.2M7.5 6h9"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    'trending-up': '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="m2 2 20 20"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    fuel: '<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
    coffee: '<path d="M10 2v2M14 2v2M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>',
    pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.7 4.73a2 2 0 0 0 2 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    play: '<path d="M6 3l14 9-14 9z"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    'arrow-down-left': '<path d="M17 7 7 17"/><path d="M17 17H7V7"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    sparkle: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
    fingerprint: '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .13-5.35 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
    briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    tv: '<rect width="20" height="15" x="2" y="7" rx="2"/><path d="m17 2-5 5-5-5"/>',
    cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  };
  /* синонимы: старые имена core.js (camelCase) и привычные имена Lucide */
  const ICON_ALIAS = {
    shieldCheck: 'shield-check', shieldAlert: 'shield-alert', phoneOff: 'phone-off', alertOctagon: 'alert-octagon',
    checkCircle: 'check-circle', xCircle: 'x-circle', arrowRight: 'arrow-right', arrowLeft: 'arrow-left',
    arrowUpRight: 'arrow-up-right', arrowDownLeft: 'arrow-down-left', eyeOff: 'eye-off', trendingUp: 'trending-up',
    'triangle-alert': 'alert', warning: 'alert', 'octagon-alert': 'alert-octagon', 'credit-card': 'card', landmark: 'bank',
    'message-square': 'message', 'circle-help': 'help', question: 'help', 'circle-check': 'check-circle', 'circle-x': 'x-circle',
    'refresh-cw': 'refresh', reset: 'rotate-ccw', bolt: 'zap', 'bar-chart': 'chart', 'external-link': 'external',
    'file-text': 'file', sparkles: 'sparkle', spark: 'sparkle', 'shopping-cart': 'cart',
  };
  const coreIcon = typeof NX.icon === 'function' ? NX.icon : null;
  function icon(name, opts) {
    let o;
    if (opts && typeof opts === 'object') o = opts;
    else o = { cls: typeof opts === 'string' ? opts : '', size: arguments[2], legacy: true };
    const key = Object.prototype.hasOwnProperty.call(ICON_ALIAS, name) ? ICON_ALIAS[name] : name;
    const body = Object.prototype.hasOwnProperty.call(ICON, key) ? ICON[key] : null;
    const size = o.size != null && o.size !== '' ? o.size : (o.legacy ? null : 20);
    const cls = 'nx-ic' + (o.cls || o.class ? ' ' + esc(o.cls || o.class) : '');
    const sw = Number(o.stroke) > 0 ? Number(o.stroke) : 1.75;
    if (body == null) {
      // неизвестно ui-kit → прежний рисунок core.js (book, anchor, folder, dna …), той же толщины линии
      if (!coreIcon) return '';
      return String(coreIcon(name, cls, size || undefined)).replace('stroke-width="1.8"', 'stroke-width="' + sw + '"');
    }
    const a11y = o.label ? ' role="img" aria-label="' + esc(o.label) + '"' : ' aria-hidden="true" focusable="false"';
    return '<svg class="' + cls + '"' + (size ? ' width="' + esc(size) + '" height="' + esc(size) + '"' : '') +
      ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"' + a11y + '>' +
      (o.label ? '<title>' + esc(o.label) + '</title>' : '') + body + '</svg>';
  }
  icon._nxKit = true;

  /* категория операции → имя иконки. Порядок важен: первое совпадение побеждает */
  const CATEGORY_ICON = [
    [/перевод|transfer|аударым/i, null], // направление решает dir
    [/супермаркет|продукт|бакалея|гастроном|grocery/i, 'cart'],
    [/такси|азс|бензин|топлив|транспорт|авто|парковк|метро|автобус|taxi/i, 'car'],
    [/кафе|ресторан|кофе|кофейн|фастфуд|cafe|coffee/i, 'coffee'],
    [/аптек|здоров|медиц|клиник|pharm/i, 'pill'],
    [/доставк|курьер/i, 'truck'],
    [/онлайн|электрон|маркетплейс|интернет-магаз|покупк|техник|marketplace/i, 'package'],
    [/зарплат|аванс|salary/i, 'briefcase'],
    [/доход|пополнен|кэшбэк|кешбэк|возврат|income|refund/i, 'arrow-down-left'],
    [/подписк|subscription/i, 'refresh'],
    [/коммунал|жкх|квартплат|аренд/i, 'home'],
    [/связь|мобильн|интернет|телефон/i, 'phone'],
    [/развлеч|кино|игр|стрим|музык/i, 'tv'],
    [/подар/i, 'gift'],
    [/кредит|заём|займ|ипотек|loan/i, 'bank'],
    [/наличн|банкомат|снятие|atm/i, 'banknote'],
    [/магазин|одежд|shop|store/i, 'store'],
    [/близк|семь|family/i, 'users'],
  ];
  function dirOf(o) {
    if (o == null) return null;
    if (typeof o === 'string') return /^(in|incoming|вход)/i.test(o) ? 'in' : /^(out|outgoing|исход)/i.test(o) ? 'out' : null;
    if (typeof o === 'number') return o > 0 ? 'in' : o < 0 ? 'out' : null;
    if (typeof o === 'object') { if (o.dir) return dirOf(o.dir); if (typeof o.amount === 'number') return dirOf(o.amount); }
    return null;
  }
  function iconNameFor(category, dir) {
    const c = String(category == null ? '' : category);
    const d = dirOf(dir);
    for (let i = 0; i < CATEGORY_ICON.length; i++) {
      if (CATEGORY_ICON[i][0].test(c)) return CATEGORY_ICON[i][1] || (d === 'in' ? 'arrow-down-left' : 'arrow-up-right');
    }
    return d === 'in' ? 'arrow-down-left' : 'card';
  }
  function iconFor(category, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    return icon(iconNameFor(category, opts), { size: o.size, label: o.label, cls: o.cls || o.class, stroke: o.stroke });
  }
  NX.icon = icon;
  NX.iconFor = iconFor;
  NX.iconNameFor = iconNameFor;
  NX.ICONS = Array.from(new Set((NX.ICONS || []).concat(Object.keys(ICON), Object.keys(ICON_ALIAS))));

  /* ---------- единый источник честности ----------
     Одна строка на функцию в каждой группе. ready:false — функция ещё не собрана в прототипе,
     в поповере она помечена «готовится», пока соответствующий пакет не вызовет NX.ui.markReady(id). */
  const FEATURES = [
    { id: 'call', name: 'Защита звонка', ready: true,
      works: 'оценка риска после каждой фразы, этапы схемы, совет положить трубку',
      sim: 'демо-звонок озвучен синтезом речи, мошенника играет жюри или автопилот',
      integ: 'факт звонка из приложения банка; разбор речи на телефоне — только Android и по согласию' },
    { id: 'decoy', name: 'Робот-приманка', ready: true,
      works: 'ведёт разговор и выспрашивает реквизиты; без сети отвечает по шаблонам',
      sim: 'номер-ловушка — вкладка этого браузера',
      integ: 'номер-ловушка у оператора связи и юридическая экспертиза до пилота' },
    { id: 'transfer', name: 'Проверка перевода', ready: true,
      works: 'решение по переводу: пропустить, переспросить, подождать минуту, задержать; «ваш обычный перевод»',
      sim: 'история операций и профиль клиента',
      integ: 'задержка настоящего перевода в процессинге банка' },
    { id: 'scan', name: 'Проверка сообщения и ссылки', ready: true,
      works: 'разбор текста, ссылки и QR-кода на русском и казахском',
      sim: 'сообщения для проверки написала команда',
      integ: 'проверка ссылок по базам банка и партнёров' },
    { id: 'rules', name: 'Мои правила', ready: true,
      works: 'правила клиента; ослабить — только через 24 ч и не во время звонка',
      sim: 'правила и их история хранятся в этом браузере',
      integ: 'хранение правил на сервере банка' },
    { id: 'family', name: 'Близкие', ready: true,
      works: 'запрос доверенному человеку без номеров счетов и карт',
      sim: 'близкий человек — вторая вкладка того же браузера',
      integ: 'уведомления в приложении банка' },
    { id: 'stoplist', name: 'Стоп-лист и цепочка дропов', ready: true,
      works: 'статусы реквизитов, проверка вторым аналитиком, защита от ложных жалоб',
      sim: 'граф счетов и поток операций синтетические',
      integ: 'обмен данными с антифрод-центром Нацбанка' },
    { id: 'help', name: 'Помощь, если обманули', ready: true,
      works: 'заявление с хронологией и доказательствами; кнопка «Заблокировать всё»',
      sim: 'статусы обращения двигает демо-кнопка',
      integ: 'блокировка карт и спор по операции в системах банка' },
    { id: 'leak', name: 'Карты для магазинов', ready: true,
      works: 'отдельная карта для каждого магазина и вывод, где утекли данные',
      sim: 'номера карт, попытки списания и база утечек',
      integ: 'виртуальные карты в процессинге и отказ при оплате у чужого магазина' },
    { id: 'deal', name: 'Безопасная сделка', ready: true,
      works: 'деньги ждут в банке до получения товара; проверка ссылки и счёта продавца',
      sim: 'продавцы, доставка и срок сделки 10 минут',
      integ: 'договор и правовая база, отдельный счёт в банке, службы доставки' },
    { id: 'mule_exit', name: 'Не стань дропом', ready: false,
      works: 'признаки транзита чужих денег и безопасный выход из схемы с сообщением банку',
      sim: 'переводы и отправители синтетические, пороги подобраны вручную и не обучены на реальных данных',
      integ: 'решение о блокировке принимает банк; текст о законе — справочный',
      label: 'Транзакции и отправители синтетические, пороги подобраны вручную, не обучены на реальных данных. Решение о блокировке принимает банк. Текст о законе — справочный.' },
    { id: 'credit_lock', name: 'Кредитный замок', ready: false,
      works: 'запрет на займы одним переключателем и заморозка подозрительных заявок',
      sim: 'заявки и микрофинансовые организации вымышленные',
      integ: 'нет подключения к кредитному бюро и госсервисам; государственный механизм отказа от займов существует, NEXUS добавляет к нему контекст атаки',
      label: 'Концепт интеграции: в демо нет подключения к кредитному бюро и госсервисам. Заявки и МФО вымышленные. Государственный механизм добровольного отказа от займов в РК существует — NEXUS добавляет к нему контекст атаки и связь со схемой, а не заменяет его.' },
  ];
  const GROUPS = [
    { key: 'works', title: 'Работает в прототипе', cls: 'ok' },
    { key: 'sim', title: 'Данные симулированы', cls: 'warn' },
    { key: 'integ', title: 'Нужна интеграция с банком', cls: 'info' },
  ];

  function honestyHTML() {
    const groups = GROUPS.map((g) =>
      '<section class="nx-hon-g ' + g.cls + '"><h4>' + esc(g.title) + '</h4><ul>' +
      FEATURES.map((f) => '<li><b>' + esc(f.name) + '</b>' +
        (f.ready ? '' : ' <span class="tag-demo">готовится</span>') +
        '<span> — ' + esc(f[g.key]) + '</span></li>').join('') +
      '</ul></section>').join('');
    return '<p class="nx-hon-lead">Концепт команды NEXUS AI. Все данные в демо синтетические.</p>' + groups +
      '<p class="nx-hon-foot">Не является продуктом банка-организатора.</p>';
  }

  /* ---------- поповер ---------- */
  let pop = null, popAnchor = null;
  function closePopover() {
    if (!pop) return;
    pop.remove(); pop = null;
    if (popAnchor) { popAnchor.setAttribute('aria-expanded', 'false'); try { popAnchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    popAnchor = null;
    document.removeEventListener('keydown', onPopKey, true);
    document.removeEventListener('pointerdown', onPopOutside, true);
    window.removeEventListener('resize', placePopover);
  }
  function onPopKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } }
  function onPopOutside(e) {
    if (!pop) return;
    if (pop.contains(e.target) || (popAnchor && popAnchor.contains(e.target))) return;
    closePopover();
  }
  function placePopover() {
    if (!pop) return;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (vw < 560 || !popAnchor) { pop.classList.add('as-sheet'); pop.style.left = pop.style.top = ''; return; }
    pop.classList.remove('as-sheet');
    const r = popAnchor.getBoundingClientRect();
    const w = Math.min(460, vw - 32);
    let left = Math.min(Math.max(16, r.right - w), vw - w - 16);
    let top = r.bottom + 8;
    const h = pop.offsetHeight;
    if (top + h > vh - 16) top = Math.max(16, vh - 16 - h);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function honestyPopover(anchor) {
    const same = pop && popAnchor === (anchor || null);
    closePopover();
    if (same) return null;
    popAnchor = anchor || null;
    pop = document.createElement('div');
    pop.className = 'nx-pop';
    pop.id = 'nxHonesty';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.setAttribute('aria-labelledby', 'nxHonestyT');
    pop.innerHTML = '<div class="nx-pop-h"><h3 id="nxHonestyT">' + esc('Что работает в прототипе') + '</h3>' +
      '<button type="button" class="nx-x" aria-label="' + esc('Закрыть') + '">×</button></div>' +
      '<div class="nx-pop-b">' + honestyHTML() + '</div>';
    document.body.appendChild(pop);
    pop.querySelector('.nx-x').addEventListener('click', closePopover);
    if (popAnchor) { popAnchor.setAttribute('aria-expanded', 'true'); popAnchor.setAttribute('aria-controls', 'nxHonesty'); }
    placePopover();
    document.addEventListener('keydown', onPopKey, true);
    document.addEventListener('pointerdown', onPopOutside, true);
    window.addEventListener('resize', placePopover);
    try { pop.querySelector('.nx-x').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    return pop;
  }
  function honestyTag(text) {
    return '<button type="button" class="tag-demo tag-demo-btn" data-nx-honesty aria-haspopup="dialog" aria-expanded="false">' +
      esc(text || 'демо-данные') + '</button>';
  }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-nx-honesty]') : null;
    if (!t) return;
    e.preventDefault();
    honestyPopover(t);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target && e.target.closest ? e.target.closest('[data-nx-honesty]') : null;
    if (!t || t.tagName === 'BUTTON' || t.tagName === 'A') return; // у кнопки и ссылки Enter уже даёт click
    e.preventDefault();
    e.stopPropagation(); // горячие клавиши сцены (Space = дальше) не должны сработать
    honestyPopover(t);
  }, true);

  /* ---------- мелкие компоненты (возвращают HTML) ---------- */
  function details(body, opts) {
    const o = opts || {};
    return '<details class="more' + (o.cls ? ' ' + esc(o.cls) : '') + '"' + (o.open ? ' open' : '') + (o.id ? ' id="' + esc(o.id) + '"' : '') + '>' +
      '<summary>' + esc(o.summary || 'Подробнее') + '</summary><div class="more-b">' + (body == null ? '' : String(body)) + '</div></details>';
  }
  const RISK_WORDS = { low: 'низкий', mid: 'средний', high: 'высокий' };
  function riskWord(score) {
    const s = Number(score) || 0;
    const level = s >= 55 ? 'high' : s >= 25 ? 'mid' : 'low';
    const word = RISK_WORDS[level];
    return { level, word, html: '<span class="risk-word ' + level + '">' + esc(word) + '</span>' };
  }
  function tagDemo(text) { return '<span class="tag-demo">' + esc(text || 'демо') + '</span>'; }
  function statusLine(kind, text, link) {
    const k = kind === 'danger' || kind === 'warn' ? kind : 'calm';
    let a = '';
    if (link && link.text) {
      a = link.href ? '<a class="status-go" href="' + esc(link.href) + '">' + esc(link.text) + ' →</a>'
        : '<button type="button" class="status-go"' + (link.id ? ' id="' + esc(link.id) + '"' : '') + '>' + esc(link.text) + ' →</button>';
    }
    return '<div class="status-line ' + k + '" role="status"><span class="status-dot" aria-hidden="true"></span><span class="status-t">' + esc(text) + '</span>' + a + '</div>';
  }
  function seg(items, active, opts) {
    const o = opts || {};
    return '<div class="seg" role="tablist"' + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') + (o.id ? ' id="' + esc(o.id) + '"' : '') + '>' +
      (items || []).map((it) => {
        const on = it.id === active;
        return '<button type="button" role="tab" data-seg="' + esc(it.id) + '" aria-selected="' + (on ? 'true' : 'false') + '"' + (on ? ' class="on"' : '') + '>' + esc(it.label) + '</button>';
      }).join('') + '</div>';
  }

  /* ---------- лист (sheet) ----------
     opts: { title, body (готовая разметка), actions:[{label, kind:'primary'|'danger'|'ghost'|'', id, onClick(close)}], onClose, id, dismissable } */
  function sheet(opts) {
    const o = opts || {};
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'sheet open';
    if (o.id) wrap.id = o.id;
    const tid = (o.id || 'nxSheet') + 'T';
    const acts = (o.actions || []).map((a, i) =>
      '<button type="button" class="btn' + (a.kind ? ' ' + esc(a.kind) : '') + '" data-i="' + i + '"' + (a.id ? ' id="' + esc(a.id) + '"' : '') + '>' + esc(a.label) + '</button>').join('');
    wrap.innerHTML = '<div class="sheet-box" role="dialog" aria-modal="true" aria-labelledby="' + esc(tid) + '">' +
      '<div class="sheet-h"><h3 id="' + esc(tid) + '">' + esc(o.title || '') + '</h3>' +
      (o.dismissable === false ? '' : '<button type="button" class="nx-x" aria-label="' + esc('Закрыть') + '">×</button>') + '</div>' +
      '<div class="sheet-b">' + (o.body == null ? '' : String(o.body)) + '</div>' +
      (acts ? '<div class="sheet-f">' + acts + '</div>' : '') + '</div>';
    let closed = false;
    function onKey(e) { if (e.key === 'Escape' && o.dismissable !== false) { e.stopPropagation(); close(); } }
    function close() {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      if (typeof o.onClose === 'function') o.onClose();
    }
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap && o.dismissable !== false) { close(); return; }
      const x = e.target.closest('.nx-x'); if (x) { close(); return; }
      const b = e.target.closest('.sheet-f [data-i]'); if (!b) return;
      const a = (o.actions || [])[+b.getAttribute('data-i')];
      if (a && typeof a.onClick === 'function') a.onClick(close); else close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    const first = wrap.querySelector('.sheet-f .btn.primary') || wrap.querySelector('.nx-x') || wrap.querySelector('.sheet-f .btn');
    try { if (first) first.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    return { el: wrap, close };
  }

  function markReady(id) {
    const f = FEATURES.find((x) => x.id === id);
    if (f) f.ready = true;
    return !!f;
  }

  NX.ui = {
    version: 1,
    FEATURES, GROUPS,
    honestyHTML, honestyPopover, closeHonesty: closePopover, honestyTag,
    details, riskWord, tagDemo, statusLine, seg, sheet, markReady,
  };
})();
