/* =====================================================================
   NEXUS AI — Защита звонка (Live Call Shield) + NEXUS Decoy
   1) Защита звонка: распознаёт речь звонящего во время разговора
      (Web Speech API) и поднимает тревогу до просьбы кода из SMS.
      Детектор манипуляций (NX.Manip): тип атаки, стадии с цитатами, давление,
      «совпадение со сценарием N из M», прогноз следующего шага → bus manip_update.
   2) NEXUS Decoy: номер-ловушка банка. ИИ-приманка тянет время и
      выясняет реквизиты, куда мошенник просит перевести деньги. Реквизиты
      уходят в Fraud Fusion Center со статусом «на проверке».
      Приманка сама никаких цифр, ссылок и данных клиента не называет.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.NX) return;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => NX.esc(s);
  const ic = (n, size) => (NX.icon ? NX.icon(n, '', size || 16) : '');
  const userName = () => (NX.state && NX.state.user && NX.state.user.name) || 'Клиент';
  const firstName = () => userName().split(' ')[0] || 'клиент';

  // old — чип уже был на экране: при перерисовке (смена статуса, новый реквизит) не проигрываем iocIn заново
  function iocChip(ioc, statusHtml, old) {
    const st = statusHtml || '<span class="badge warn">' + esc(NX.iocs.label(ioc.status || 'suspected')) + '</span>';
    return '<div class="ioc-chip"' + (old ? ' style="animation:none"' : '') + '><span class="k">' + esc((NX.IOC_KIND && NX.IOC_KIND[ioc.kind]) || ioc.kind) + '</span><span class="v">' + esc(ioc.raw || ioc.value) + '</span><span class="st">' + st + '</span></div>';
  }

  // Блоки с .ioc-chip перерисовываются по таймеру (Decoy, раз в секунду) и на каждое промежуточное
  // распознавание речи; у .ioc-chip анимация появления iocIn. Одинаковую разметку не переписываем,
  // иначе чипы каждый раз заново проявляются из прозрачности.
  const lastHtml = new WeakMap();
  function setIfChanged(el, html) {
    if (!el) return false;
    const key = String(html).replace(/ style="animation:none"/g, ''); // пометки «уже показан» в сравнение не входят
    if (lastHtml.get(el) === key && (key === '' || el.firstChild)) return false;
    el.innerHTML = html;
    lastHtml.set(el, key);
    return true;
  }
  const iocKey = (i) => i.kind + ':' + i.value;

  // «статус «на проверке»» / «статусы: на проверке, подтверждён корреляцией» — по реальным записям стоп-листа
  function statusSummary(sts) {
    const uniq = sts.filter((s, i) => s && sts.indexOf(s) === i).map((s) => NX.iocs.label(s));
    return uniq.length ? (uniq.length === 1 ? 'статус «' + uniq[0] + '»' : 'статусы: ' + uniq.join(', ')) : 'статус «на проверке»';
  }

  /* ================= ЗАЩИТА ЗВОНКА ================= */
  // Сценарий демо-звонка. Реквизиты — вымышленные; домен .test зарезервирован для примеров.
  function script() {
    return [
      { who: 's', text: 'Здравствуйте, ' + firstName() + '? Вас беспокоит служба безопасности банка, старший специалист Данияр Каримов.' },
      { who: 'c', text: 'Да, здравствуйте.' },
      { who: 's', text: 'По вашей карте зафиксирована подозрительная операция на двести сорок девять тысяч тенге в Шымкенте. Это вы совершали?' },
      { who: 'c', text: 'Нет, не я…' },
      { who: 's', text: 'Значит, мошенники получили доступ к вашему счёту. Действовать нужно срочно, у нас всего несколько минут.' },
      { who: 's', code: true, text: 'Сейчас вам придёт код из SMS, продиктуйте его мне, чтобы я отменил операцию. И не кладите трубку, это конфиденциальная процедура, никому не говорите.' },
      { who: 'c', text: 'Подождите, а зачем вам код?' },
      { who: 's', text: 'Для защиты средств переведите деньги на безопасный счёт KZ33 9KZT 0031 7702 4419. Он оформлен на ваше имя. Если не получается, на номер +7 747 210 33 18.' },
    ];
  }
  // Честный звонок банка «карта готова» (синтетический, как h02 в корпусе бенча): показывает разницу с отметкой и без неё
  function honestScript() {
    return [
      { who: 's', text: 'Добрый день, ' + firstName() + '? Это ваш банк, меня зовут Айжан. Звоню по вашей заявке на кредитную карту.' },
      { who: 'c', text: 'Да, слушаю.' },
      { who: 's', text: 'Заявка одобрена, карту можно забрать в отделении на Абая с понедельника.' },
      { who: 's', text: 'Возьмите с собой удостоверение личности. Если удобнее, можем доставить курьером.' },
      { who: 's', text: 'Напоминаю: сотрудники банка никогда не спрашивают коды из SMS и не просят переводить деньги. Хорошего дня!' },
    ];
  }
  /* «Звонит настоящий банк»: отметка из приложения (client.js → NX.BankCall). undefined — кабинет без модуля (как раньше),
     true — активна отметка, false — приложение знает, что банк сейчас не звонит */
  function bankCallState() {
    try {
      if (!NX.BankCall || typeof NX.BankCall.active !== 'function') return undefined;
      return !!NX.BankCall.active();
    } catch (e) { return undefined; }
  }
  const SH = { active: false, mode: null, lines: [], start: 0, tick: null, alerted: false, alertAt: 0, rec: null, run: 0, pushed: new Set(), shownIocs: new Set(), fails: 0, restarts: [] };

  function setTimer() { const el = $('#callTimer'); if (!el) return; const s = Math.floor((Date.now() - SH.start) / 1000); el.textContent = NX.pad(Math.floor(s / 60)) + ':' + NX.pad(s % 60); }
  const HL = /(служб[а-яё]* безопасност[а-яё]*|подозрительн[а-яё]* операци[а-яё]*|срочно|код[а-яё]* из (?:sms|смс)|продиктуйте|не кладите трубку|никому не говорите|конфиденциальн[а-яё]* процедур[а-яё]*|безопасн[а-яё]* сч[её]т[а-яё]*|защищ[её]нн[а-яё]* сч[её]т[а-яё]*|KZ\d{2}[0-9A-Z ]{10,}|\+7[\d ]{10,})/gi;
  function highlight(text) { return esc(text).replace(HL, '<mark>$1</mark>'); }
  function renderTranscript(interim) {
    const box = $('#transcript');
    if (!box) return;
    box.innerHTML = SH.lines.map((l) => '<div class="tline ' + l.who + '"><div class="who">' + (l.who === 's' ? 'Звонящий' : 'Клиент') + '</div>' + highlight(l.text) + '</div>').join('') +
      (interim ? '<div class="tline s interim"><div class="who">' + (SH.mode === 'demo' ? 'Звонящий · демо-сценарий…' : 'Звонящий · распознаётся…') + '</div>' + esc(interim) + '</div>' : '');
    box.scrollTop = box.scrollHeight;
  }
  const callerFinal = () => SH.lines.filter((l) => l.who === 's').map((l) => l.text).join('. ');

  /* ---------- Детектор манипуляций (NX.Manip, manip.js): тип атаки, стадии с цитатами, давление, прогноз ---------- */
  const MANIP = () => (NX.Manip && typeof NX.Manip.analyze === 'function' ? NX.Manip : null);
  function runManip(partial) {
    const M = MANIP();
    if (!M) return null;
    const lines = SH.lines.filter((l) => l.who === 's').map((l) => ({ text: l.text, ts: l.ts || Date.now() }));
    if (partial && String(partial).trim()) lines.push({ text: String(partial).trim(), ts: Date.now() });
    if (!lines.length) { SH.manip = null; return null; }
    let res = null;
    const bc = bankCallState();
    try { res = M.analyze(lines, bc === undefined ? undefined : { verified: bc }); } catch (e) { console.error('[shield] Manip.analyze', e); res = null; }
    if (res) { res.at = Date.now(); res.partial = !!(partial && String(partial).trim()); }
    SH.manip = res;
    emitManip(res);
    return res;
  }
  // bus manip_update — только при изменении результата и не чаще 2 раз в секунду (последнее состояние не теряется)
  function manipPayload(m) {
    return { client: userName(), attackType: m.attackType, stages: (m.stages || []).map((s) => ({ id: s.id, label: s.label, line: s.line, quote: s.quote })), pressure: m.pressure, scenario: m.scenario, next: m.next, riskIndex: m.riskIndex, alert: !!m.alert, session: SH.session || null, mode: SH.mode,
      verified: !!m.verified, level: m.level || null, critical: !!m.critical, noBankCall: m.noBankCall || null, badgeClaim: m.badgeClaim || null };
  }
  function emitManip(m) {
    if (!m) return;
    const p = manipPayload(m);
    const key = JSON.stringify([p.attackType && p.attackType.id, p.stages.map((s) => s.id + ':' + s.line), p.pressure, p.scenario, p.next && p.next.id, p.riskIndex, p.verified, p.level, !!p.noBankCall, !!p.badgeClaim]);
    if (key === SH.manipKey) return;
    SH.manipKey = key;
    SH.manipPending = p;
    const wait = 500 - (Date.now() - (SH.manipEmitAt || 0));
    if (wait <= 0) flushManip();
    else if (!SH.manipTimer) SH.manipTimer = setTimeout(flushManip, wait);
  }
  function flushManip() {
    clearTimeout(SH.manipTimer); SH.manipTimer = null;
    const p = SH.manipPending; SH.manipPending = null;
    if (!p) return;
    SH.manipEmitAt = Date.now();
    try { NX.bus.emit('manip_update', p); } catch (e) { console.error('[shield] manip_update', e); }
  }
  function manipTemplate(m) {
    const M = MANIP();
    const id = m && m.scenario && m.scenario.template;
    if (!M || !id) return null;
    try { return typeof M.template === 'function' ? M.template(id) : (M.TEMPLATES || []).find((t) => t.id === id) || null; } catch (e) { return null; }
  }
  const stageLabel = (id) => { try { return (MANIP() && MANIP().stageLabel && MANIP().stageLabel(id)) || id; } catch (e) { return id; } };
  // «Звонит настоящий банк»: фактор «Банк сейчас вам не звонил», уровень «проверенный звонок», уловка с «отметкой»
  function bankNote(m) {
    if (!m) return '';
    const why = '<button class="btn sm ghost" type="button" data-shield-why>' + esc('Почему так') + '</button>';
    if (m.badgeClaim) return '<div class="bc-note warn small"><b>' + esc('Звонящий ссылается на «отметку в приложении»') + '</b> — «' + esc(m.badgeClaim.quote) + '». ' + esc('Отметку видно только в приложении, настоящему сотруднику незачем о ней говорить: это признак манипуляции.') + ' ' + why + '</div>';
    if (m.verified) return '<div class="bc-note' + (m.alert ? ' warn' : '') + ' small"><b>' + esc(m.alert ? 'Отметка «звонит банк» есть, но звонящий просит код, доступ или перевод' : 'Проверенный звонок банка') + '</b> — ' +
      esc(m.alert ? 'такого не просит даже настоящий банк. Тревога поднята.' : 'отметка пришла в приложение. Индекс риска считается как обычно; тревога поднимется, если попросят код из SMS, установку программы или перевод.') + ' ' + why + '</div>';
    if (m.noBankCall) return '<div class="bc-note warn small"><b>' + esc((MANIP() && MANIP().NO_BANK_CALL) || 'Банк сейчас вам не звонил') + '</b> — ' + esc('звонящий называет себя банком («' + m.noBankCall.quote + '»), а отметки о звонке банка в приложении нет.') + ' ' + why + '</div>';
    return '';
  }
  function renderManip(m, alerted) {
    const box = $('#manipPanel');
    const inAlert = alerted == null ? SH.alerted : !!alerted;
    if (!box) return;
    if (!MANIP()) {
      setIfChanged(box, '<p class="small muted">Детектор манипуляций не загрузился — обновите страницу. Индекс риска звонка продолжает работать.</p>');
      return;
    }
    const lines = SH.lines.filter((l) => l.who === 's').length;
    if (!m || (!m.stages.length && !m.lure)) {
      setIfChanged(box, bankNote(m) + '<div class="mp-empty">' + ic('brain', 22) + '<div><b>' + (SH.active ? 'Приёмов мошенника пока нет' : 'NEXUS ждёт звонка') + '</b><p class="small muted">' +
        (SH.active ? 'Проверено ' + NX.countOf(lines, ['реплика', 'реплики', 'реплик']) + ' звонящего.'
          : 'Во время звонка здесь появятся шаги схемы и следующий шаг мошенника.') + '</p></div></div>');
      return;
    }
    const at = m.attackType || {};
    const sc = m.scenario || {};
    const pr = m.pressure || { level: 'низкое', score: 0 };
    const lvl = m.verified && !m.alert ? 'low' : m.riskIndex >= 50 || m.alert ? 'high' : m.riskIndex >= 25 ? 'med' : 'low';
    // шаги схемы и следующий шаг показывает карточка тревоги; до тревоги — здесь (одна карточка, без повторов)
    const nx = inAlert ? null : nextStage(m);
    setIfChanged(box, bankNote(m) +
      '<p class="small"><b>' + esc(at.label || 'Схема ещё не ясна') + '</b></p>' +
      (inAlert ? '<p class="small muted">' + esc('Шаги схемы, следующий шаг мошенника и что делать — в карточке тревоги.') + '</p>' : stepperHtml(m)) +
      (nx ? '<div class="mp-next">' + ic('target', 16) + '<div><b>Следующий шаг мошенника: «' + esc(nx.label) + '»</b>' + (nx.advice ? '<div class="small">' + esc(nx.advice) + '</div>' : '') + '</div></div>' : '') +
      (m.recommendation && !inAlert ? '<div class="verdict ' + lvl + ' mt-s mp-rec"><div class="vi">' + ic(lvl === 'low' ? 'shieldCheck' : 'alert', 20) + '</div><div><h4>Что делать</h4><div class="small">' + esc(m.recommendation) + '</div></div></div>' : '') +
      (NX.ui && NX.ui.details ? NX.ui.details('<p class="tiny muted">Совпадение со схемой: ' + (sc.of ? esc(sc.matched) + ' из ' + esc(sc.of) + ' шагов' : '—') + ' · давление: ' + esc(pr.level) + ' · оценка ' + esc(m.riskIndex || 0) + ' из 100. Правила на русском и казахском работают на телефоне, без сети. «N из M» — доля шагов схемы, а не вероятность.</p>') : ''));
  }

  function analyze(partial) {
    const callerText = callerFinal() + (partial ? '. ' + partial : '');
    const r = NX.scanText(callerText);
    const m = runManip(partial);
    // индекс звонка — максимум из словарного анализа NEXUS Core и детектора манипуляций (последовательность стадий)
    const score = callerText.trim() ? Math.max(r.score, m ? m.riskIndex || 0 : 0) : 0;
    const scen = m && m.scenario && m.scenario.of && m.attackType && m.attackType.label ? m.attackType.label : r.category;
    if (m && scen && r.score < (m.riskIndex || 0)) r.category = scen;
    const col = NX.riskColor(score);
    const g = $('#shieldGauge');
    const rw = NX.ui && NX.ui.riskWord ? NX.ui.riskWord(score) : { word: score >= 55 ? 'высокий' : score >= 25 ? 'средний' : 'низкий' };
    if (g) setIfChanged(g, NX.gaugeSVG(score, col, 120, 11) + '<div class="center"><div><div class="num" style="color:' + col + ';font-size:17px">' + esc(callerText.trim() ? rw.word : '—') + '</div><div class="tiny muted">риск</div></div></div>');
    // тревога: индекс ≥ 55, как раньше. При отметке «звонит банк» — только просьба кода, доступа или перевода
    // (m.alert в режиме verified); ссылка звонящего на «отметку в приложении» — тревога в любом режиме
    const verified = !!(m && m.verified);
    const alertOn = callerText.trim() ? (verified ? !!(m && m.alert) : score >= 55 || !!(m && m.badgeClaim)) : false;
    const inAlert = alertOn || SH.alerted;
    renderManip(m, inAlert);
    // вердикт крупно — только в карточке тревоги; здесь — уровень риска словом
    const v = $('#shieldVerdict');
    if (v) v.textContent = inAlert ? 'Риск звонка: ' + rw.word : verified && SH.active ? 'Проверенный звонок банка' : score >= 25 ? 'Подозрительный звонок' : SH.active ? 'Пока всё спокойно' : 'Звонок не начат';
    const sub = $('#shieldSub');
    if (sub) sub.textContent = verified && !alertOn && SH.active ? 'Отметка в приложении · коды и переводы банк не просит даже сейчас' : score >= 25 ? 'Схема: ' + scen : 'NEXUS оценивает звонок после каждой фразы';
    const rs = $('#shieldReasons');
    if (rs) {
      // после тревоги главные причины уже в карточке тревоги: здесь — только остальные признаки
      const shownInAlert = inAlert ? alertReasons(r) : [];
      const list = r.reasons.filter((x) => x.w > 0 && shownInAlert.indexOf(x.why) < 0).slice(0, 3);
      setIfChanged(rs, list.length ? list.map((x) => '<li><span class="ri" style="color:' + (x.w >= 30 ? 'var(--danger)' : 'var(--warn)') + '">' + ic('alert', 14) + '</span><span>' + esc(x.why) + '</span></li>').join('')
        : '<li class="muted">' + esc(inAlert ? 'Главные признаки — в карточке тревоги, других пока нет' : 'Пока ничего подозрительного') + '</li>');
    }
    // реквизиты берём только из полностью произнесённых фраз — иначе номер обрежется на середине
    const iocs = NX.extractIocs(callerFinal());
    const box = $('#shieldIocs');
    if (iocs.length) {
      if (alertOn) {
        const fresh = iocs.filter((i) => !SH.pushed.has(i.kind + ':' + i.value));
        fresh.forEach((i) => SH.pushed.add(i.kind + ':' + i.value));
        if (fresh.length) {
          const added = NX.iocs.add(fresh, 'Защита звонка', { client: userName(), session: SH.session, quote: callerFinal().slice(-180) }) || [];
          const seen = added.seen || [];
          const sts = fresh.map((f) => NX.iocs.status(f.kind, NX.normIoc ? NX.normIoc(f.kind, f.value != null ? f.value : f.raw) : f.value) || 'suspected');
          NX.toast('Реквизиты звонящего → банк', NX.countOf(fresh.length, ['реквизит', 'реквизита', 'реквизитов']) + ' переданы в банк · ' + statusSummary(sts) + (seen.length ? ' · ' + seen.length + ' уже был в стоп-листе' : ''), 'ok');
        }
      }
      setIfChanged(box, '<div class="small muted mb">Реквизиты, названные звонящим:</div><div class="col gap-s">' + iocs.map((i) => {
        const st = NX.iocs.status(i.kind, i.value);
        return iocChip(i, st ? '<span class="badge ' + (st === 'suspected' ? 'warn' : 'high') + '">' + esc(NX.iocs.label(st)) + '</span>' : '<span class="badge plain">наблюдение</span>', SH.shownIocs.has(iocKey(i)));
      }).join('') + '</div>');
      if (box) iocs.forEach((i) => SH.shownIocs.add(iocKey(i)));
    } else setIfChanged(box, '');
    if (alertOn && !SH.alerted) raiseAlert(r, score);
    else if (SH.alerted && SH.active) updateAlert(r, score);
    return score;
  }
  // «Голос из спокойного времени» (client.js → NX.cxAnchorCard) и строка о статьях конституции для тревоги
  function anchorCard() { try { return typeof NX.cxAnchorCard === 'function' ? NX.cxAnchorCard() : ''; } catch (e) { return ''; } }
  function protectLine() {
    const set = NX.state && NX.state.settings;
    let callArt = null;
    try {
      const s = NX.Constitution && typeof NX.Constitution.get === 'function' ? NX.Constitution.get() : null;
      callArt = s && (s.articles || []).find((a) => a.kind === 'call_guard' && a.enabled !== false);
    } catch (e) { callArt = null; }
    if (callArt) return 'Ваше правило «Защита во время звонка»: пока идёт звонок, переводы новым получателям удерживаются для проверки, а ослабить защиту нельзя.';
    return set && set.scamCallProtect ? 'Переводы с вашего счёта во время звонка удерживаются для проверки.' : 'Переводы с вашего счёта сейчас требуют дополнительного подтверждения.';
  }
  // верхняя часть плашки тревоги: пересчитывается после каждой фразы, чтобы совпадать с индикатором и панелью манипуляций
  // карточка тревоги: вердикт крупно, шаги схемы, ≤3 простые причины, что будет дальше
  function alertReasons(r) {
    const m = SH.manip;
    const reasons = [];
    if (m && m.noBankCall) reasons.push(((MANIP() && MANIP().NO_BANK_CALL) || 'Банк сейчас вам не звонил') + ': в приложении нет отметки о звонке банка');
    else if (m && m.verified) reasons.push('Отметка «звонит банк» есть, но просьба кода, доступа или перевода — главный признак обмана');
    (r.reasons || []).filter((x) => x.w > 0 && !x.good).forEach((x) => { if (reasons.length < 3 && reasons.indexOf(x.why) < 0) reasons.push(x.why); });
    return reasons;
  }
  function alertLiveHtml(r, score) {
    const m = SH.manip;
    const reasons = alertReasons(r);
    if (!reasons.length) reasons.push(r.category || 'Сценарий похож на мошеннический');
    const st = stepperHtml(m);
    return '<h4 class="call-verdict-big">' + ic('alert', 20) + ' Это мошенник — положите трубку</h4>' + st +
      '<ul class="call-reasons">' + reasons.slice(0, 3).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
      '<p class="small" style="margin:6px 0 10px;color:var(--text)">Банк никогда не просит коды из SMS и не переводит деньги на «безопасный счёт». ' + esc(protectLine()) + '</p>';
  }
  // шаги схемы мошенника: пройденные, следующий (прогноз по шаблону) и ещё не начатые
  // следующий шаг — по порядку шаблона: первый не прозвучавший шаг ПОСЛЕ последнего прозвучавшего.
  // Шаги до него, которых не было, — «не прозвучало» (мошенник их пропустил), а не «следующий».
  function nextStage(m) {
    if (!m) return null;
    const tpl = manipTemplate(m);
    if (!tpl || !(tpl.stages || []).length) return m.next || null;
    const found = {}; (m.stages || []).forEach((s) => { found[s.id] = true; });
    let last = -1; tpl.stages.forEach((id, i) => { if (found[id]) last = i; });
    const id = tpl.stages.slice(last + 1).find((x) => !found[x]);
    if (!id) return null;
    return m.next && m.next.id === id ? m.next : { id, label: stageLabel(id), advice: '' };
  }
  function stepperHtml(m) {
    if (!m || !(m.stages || []).length) return '';
    const found = {}; (m.stages || []).forEach((s) => { found[s.id] = s; });
    const tpl = manipTemplate(m);
    const nx = nextStage(m);
    let last = -1; if (tpl) tpl.stages.forEach((id, i) => { if (found[id]) last = i; });
    const steps = tpl ? tpl.stages.map((id, i) => ({ id, label: stageLabel(id), hit: found[id], next: !!(nx && nx.id === id), skip: !found[id] && i < last })) : (m.stages || []).map((s) => ({ id: s.id, label: s.label, hit: s, next: false, skip: false }));
    return '<div class="mp-seq" aria-label="Шаги схемы">' + steps.map((s, i) => '<div class="mp-step' + (s.hit ? ' hit' : '') + (s.next ? ' next' : '') + (s.skip ? ' skip' : '') + '"><span class="mp-dot">' + (s.hit ? ic('check', 12) : s.next ? ic('target', 12) : i + 1) + '</span><span class="mp-step-l">' + esc(s.label) + '</span><span class="mp-step-s">' + (s.hit ? 'было' : s.next ? 'следующий шаг мошенника' : s.skip ? 'не прозвучало' : 'ещё нет') + '</span></div>').join('') + '</div>';
  }
  function updateAlert(r, score) {
    const live = $('#callAlertLive');
    if (live) setIfChanged(live, alertLiveHtml(r, score));
  }
  function raiseAlert(r, score) {
    SH.alerted = true; SH.alertAt = Date.now();
    try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([300, 120, 300, 120, 600]); } catch (e) { /* ignore */ }
    const box = $('#callAlert');
    const m = SH.manip;
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = '<div id="callAlertLive">' + alertLiveHtml(r, score) + '</div>' +
        '<div class="row wrap"><button class="btn primary" type="button" id="alertHang">Положить трубку</button><button class="btn" type="button" id="alertDecoy">' + ic('target', 14) + ' Передать звонок роботу-приманке</button><button class="btn ghost sm" type="button" data-why="core">Почему?</button></div>';
      $('#alertHang').onclick = () => { stop('Клиент положил трубку по сигналу NEXUS'); NX.toast('Звонок завершён', 'Вы защищены. Не перезванивайте на этот номер.', 'ok'); };
      $('#alertDecoy').onclick = () => { const session = SH.session; stop('Звонок переадресован на номер-ловушку банка'); if (NX.go) NX.go('decoy'); startInteractive({ session }); };
    }
    const quote = SH.lines.filter((l) => l.who === 's').slice(-1).map((l) => l.text)[0] || '';
    NX.addEvent({ type: 'scam_call', source: 'Защита звонка', severity: 'high', title: 'Звонок мошенника распознан во время разговора', details: r.category + ' · индекс риска ' + score });
    NX.bus.emit('shield_alert', { client: userName(), score, category: r.category, quote, mode: SH.mode,
      manip: m ? { attackType: m.attackType, stagesBeforeAlert: (m.stages || []).length, scenario: m.scenario, pressure: m.pressure, next: m.next, riskIndex: m.riskIndex } : null,
      lineNo: SH.lines.filter((l) => l.who === 's').length });
    NX.toast('Мошеннический звонок', 'NEXUS предупредил клиента до передачи кода', 'high');
  }
  function begin(mode) {
    stop(null, true);
    SH.active = true; SH.mode = mode; SH.lines = []; SH.alerted = false; SH.alertAt = 0; SH.start = Date.now(); SH.run++; SH.pushed = new Set(); SH.shownIocs = new Set(); SH.fails = 0; SH.restarts = [];
    SH.manip = null; SH.manipKey = null;
    SH.session = NX.uid('call'); // один инцидент: звонок и его передача приманке — один источник, а не два
    const al = $('#callAlert'); if (al) al.classList.add('hidden');
    const pc = $('.phone-card'); if (pc) pc.classList.add('live');
    const cs = $('#callStatus'); if (cs) cs.textContent = mode === 'mic' ? 'Говорите — NEXUS распознаёт речь звонящего' : 'Идёт демо-звонок · NEXUS анализирует реплики звонящего';
    setButtons(true);
    SH.tick = setInterval(setTimer, 500); setTimer();
    NX.bus.emit('call_state', { active: true, source: 'shield', client: userName() });
    renderTranscript(); analyze();
  }
  function setButtons(active) {
    const st = $('#shieldStop'), d = $('#shieldDemo'), m = $('#shieldMic');
    if (st) st.disabled = !active;
    if (d) d.disabled = active;
    if (m) m.disabled = active;
    // одна главная кнопка на экране: во время звонка главная — «Положить трубку» в карточке тревоги
    if (d) d.classList.toggle('primary', !active);
    const hang = $('#alertHang');
    if (hang) { hang.classList.toggle('primary', !!active); hang.disabled = !active; }
  }
  // stop() можно звать без аргументов (сброс, отзыв согласия, сцена)
  function stop(reason, silent) {
    const was = SH.active;
    SH.active = false; SH.run++;
    clearInterval(SH.tick); SH.tick = null;
    try { if (NX.tts) NX.tts.cancel(); else if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (SH.rec) { const rec = SH.rec; SH.rec = null; try { rec.onend = null; rec.onresult = null; rec.onerror = null; rec.abort ? rec.abort() : rec.stop(); } catch (e) { /* ignore */ } }
    const pc = $('.phone-card'); if (pc) pc.classList.remove('live');
    setButtons(false);
    const cs = $('#callStatus');
    if (was && !silent && cs) cs.textContent = (typeof reason === 'string' && reason) || 'Звонок завершён';
    if (SH.manipPending) flushManip();
    if (was) {
      NX.bus.emit('shield_end', { client: userName(), alerted: SH.alerted, durationMs: Date.now() - SH.start });
      NX.bus.emit('call_state', { active: false, source: 'shield', client: userName() });
    }
  }
  // Говорим только русским голосом; если его нет — молча, по таймеру (английский голос читает кириллицу как кашу)
  function ruVoice() {
    try { return (window.speechSynthesis && window.speechSynthesis.getVoices().find((x) => /^ru/i.test(x.lang))) || null; } catch (e) { return null; }
  }
  const lineMs = (text) => Math.max(2500, text.length * 62);
  function speak(text, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(fallback); resolve(); } };
      const fallback = setTimeout(fin, lineMs(text) + 1500);
      try {
        // общий модуль озвучки: лучший «живой» голос браузера, звонящий — мужской голос, если есть
        if (NX.tts) {
          NX.tts.speak(text, { role: o.role || 'scammer', rate: o.rate }).then((r) => {
            if (r && r.ok) fin(); else { clearTimeout(fallback); setTimeout(fin, lineMs(text)); }
          }, () => { clearTimeout(fallback); setTimeout(fin, lineMs(text)); });
          return;
        }
        const v = ruVoice();
        if (!v || !('speechSynthesis' in window) || NX.flags && NX.flags.mute) { clearTimeout(fallback); setTimeout(fin, lineMs(text)); return; }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ru-RU'; u.voice = v; u.rate = o.rate || 1.05; u.pitch = o.pitch || 1;
        u.onend = fin; u.onerror = fin;
        window.speechSynthesis.speak(u);
      } catch (e) { /* таймер завершит */ }
    });
  }
  // runDemo({ honest: true }) — честный звонок банка «карта готова»; без аргумента (или с Event от кнопки) — звонок мошенника
  async function runDemo(opts) {
    const honest = !!(opts && opts.honest === true);
    begin('demo');
    const cs0 = $('#callStatus'); if (cs0 && honest) cs0.textContent = 'Идёт демо-звонок банка «карта готова» · NEXUS анализирует реплики звонящего';
    const run = SH.run;
    for (const line of honest ? honestScript() : script()) {
      if (run !== SH.run) return;
      if (line.who === 'c') { await sleep(700); if (run !== SH.run) return; SH.lines.push(line); renderTranscript(); continue; }
      if (line.code && SH.alertAt) {
        // тревога пришла раньше просьбы кода — это и есть выигрыш по времени
        const leadSec = Math.round((Date.now() - SH.alertAt) / 100) / 10;
        NX.bus.emit('shield_lead', { client: userName(), leadSec });
      }
      // «живое» распознавание: слова появляются по мере произнесения
      const words = line.text.split(' ');
      const spoken = speak(line.text);
      const per = lineMs(line.text) / words.length;
      for (let i = 1; i <= words.length; i++) {
        if (run !== SH.run) return;
        const partial = words.slice(0, i).join(' ');
        renderTranscript(partial);
        if (i % 4 === 0) analyze(partial);
        await sleep(per * 0.92);
      }
      await spoken;
      if (run !== SH.run) return;
      SH.lines.push(Object.assign({ ts: Date.now() }, line)); renderTranscript(); analyze();
      await sleep(350);
    }
    if (run === SH.run) stop(SH.alerted ? 'Звонок завершён · NEXUS защитил клиента' : 'Звонок завершён');
  }
  function runMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { NX.toast('Распознавание речи недоступно', 'Откройте сайт в Chrome или Edge либо запустите демо-звонок', 'warn'); return; }
    begin('mic');
    const run = SH.run;
    const rec = new SR();
    rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      SH.fails = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (!t) continue;
        if (e.results[i].isFinal) SH.lines.push({ who: 's', text: t.charAt(0).toUpperCase() + t.slice(1), ts: Date.now() }); else interim += t + ' ';
      }
      renderTranscript(interim.trim());
      analyze(interim.trim());
    };
    rec.onerror = (e) => {
      const err = e && e.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') { NX.toast('Нет доступа к микрофону', 'Разрешите микрофон для сайта (нужен HTTPS или localhost)', 'warn'); stop('Нет доступа к микрофону'); return; }
      if (err === 'network' || err === 'audio-capture') SH.fails++;
    };
    // перезапуск с паузой; без сети или микрофона — не крутимся в бесконечном цикле
    rec.onend = () => {
      if (!SH.active || SH.mode !== 'mic' || run !== SH.run || SH.rec !== rec) return;
      const now = Date.now();
      SH.restarts = SH.restarts.filter((t) => now - t < 15000);
      SH.restarts.push(now);
      if (SH.fails >= 3 || SH.restarts.length > 6) {
        NX.toast('Распознавание речи остановлено', SH.fails ? 'Сервис распознавания недоступен (нет интернета?). Запустите демо-звонок.' : 'Микрофон не слышит речь. Проверьте устройство или запустите демо-звонок.', 'warn');
        stop('Распознавание речи остановлено');
        return;
      }
      setTimeout(() => { if (SH.active && SH.rec === rec) { try { rec.start(); } catch (er) { /* ignore */ } } }, Math.min(4000, 250 * Math.pow(2, SH.fails)));
    };
    SH.rec = rec;
    try { rec.start(); } catch (e) { NX.toast('Не удалось запустить микрофон', e.message, 'warn'); stop(); }
  }
  function micWithConsent() {
    if (NX.Consent && typeof NX.Consent.require === 'function') NX.Consent.require(runMic);
    else runMic();
  }

  /* ================= NEXUS DECOY ================= */
  // Автодемо: реплики «мошенника» короткие и обезличенные, реквизиты вымышленные.
  const SCAM_AUTO = [
    'Здравствуйте! Это служба безопасности банка. С вашей карты прямо сейчас пытаются списать деньги, нужно срочно их защитить.',
    'Назовите код, который придёт вам в SMS.',
    'Хорошо, давайте по-другому. Переведите деньги на защищённый счёт KZ33 9KZT 0031 7702 4419, он оформлен на вас.',
    'Получатель — Сейтказы Арман, это наш сотрудник.',
    'Если с карты не получается — переведите на номер +7 747 210 33 18.',
    'Давайте быстрее, деньги сейчас спишут!',
    'Всё, некогда мне с вами… Позвоню позже.',
  ];
  // Офлайн-движок приманки и пост-фильтр — общий модуль assets/js/decoy-engine.js (NX.DecoyEngine),
  // тот же, что на сцене и в самопроверке bench.html. Никаких цифр, ссылок и данных клиента.
  const DE = NX.DecoyEngine;
  const LINES = DE.LINES;
  const SECONDS_PER_REPLICA = 25; // оценка для голосового звонка — та же, что на сцене
  const DC = { running: false, mode: null, run: 0, t0: 0, lines: 0, replies: 0, iocs: [], shownIocs: new Set(), history: [], slots: {}, used: {}, lastPool: null, finalSaid: false, llm: false, chain: Promise.resolve(), idleAt: 0, apTimer: null };

  function filterReply(t) { return DE.filter(t, DC.replies); }
  function offlineReply(text, found) { return DE.reply(DC, text, found); }
  async function llmReply() {
    if (!DC.llm) return null;
    let ctrl = null;
    try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
    const timer = setTimeout(() => { try { if (ctrl) ctrl.abort(); } catch (e) { /* ignore */ } }, 5000);
    try {
      const r = await fetch(NX.llmEndpoint || 'api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ mode: 'decoy', messages: DC.history.slice(-12).map((m) => ({ role: m.role, content: typeof NX.maskPII === 'function' ? NX.maskPII(String(m.content || '')) : m.content })) }) /* ПДн маскируются и в браузере, и на сервере */, signal: ctrl ? ctrl.signal : undefined });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && typeof j.reply === 'string' && j.reply.trim()) return j.reply;
      if (NX.llmMarkDown) NX.llmMarkDown((j && j.error) || 'http_' + r.status);
    } catch (e) {
      if (NX.llmMarkDown) NX.llmMarkDown(e && e.name === 'AbortError' ? 'timeout' : 'network');
    } finally { clearTimeout(timer); }
    DC.llm = false;
    setEngine();
    return null;
  }
  function setEngine() {
    const el = $('#decoyEngine');
    if (el) el.textContent = 'Движок приманки: ' + (DC.llm ? 'Claude (LLM) + пост-фильтр' : 'офлайн-движок (RU/KZ)');
  }
  function addMsg(who, text, engine, auto) {
    const log = $('#decoyLog');
    if (!log) return;
    const empty = log.querySelector('.empty'); if (empty) empty.remove();
    const el = document.createElement('div');
    el.className = 'msg ' + (who === 'scam' ? 'scam' : 'decoy');
    const head = who === 'scam' ? 'Мошенник' + (DC.mode === 'interactive' ? (auto ? ' · автопилот' : ' · вы') : '') : 'Гульнара-апа · приманка';
    el.innerHTML = '<div class="who">' + esc(head) + (engine ? '<span class="eng">' + esc(engine) + '</span>' : '') + '</div>' + (who === 'scam' ? highlight(text) : esc(text));
    log.appendChild(el); log.scrollTop = log.scrollHeight;
  }
  function addSys(html) {
    const log = $('#decoyLog');
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'msg sys tiny muted';
    el.style.cssText = 'align-self:center;background:transparent;border:1px dashed var(--line);max-width:100%';
    el.innerHTML = html;
    log.appendChild(el); log.scrollTop = log.scrollHeight;
  }
  function typingDots() {
    const log = $('#decoyLog');
    if (!log) return { remove() {} };
    const t = document.createElement('div');
    t.className = 'msg decoy';
    t.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    log.appendChild(t); log.scrollTop = log.scrollHeight;
    return { remove() { if (t.parentNode) t.parentNode.removeChild(t); } };
  }
  function minutes() { return (DC.lines + DC.replies) * SECONDS_PER_REPLICA / 60; }
  function updateStats() {
    const t = $('#decoyTime'); if (t) t.textContent = Math.max(0, Math.round(minutes())) + ' мин';
    const m = $('#decoyMsgs');
    const n = DC.lines + DC.replies;
    if (m) m.textContent = n ? NX.countOf(n, ['реплика', 'реплики', 'реплик']) + ' · оценка 25 с на реплику голосом · реально прошло ' + Math.round((Date.now() - DC.t0) / 1000) + ' с' : '0 реплик';
    const c = $('#decoyIocCount'); if (c) c.textContent = DC.iocs.length;
    const box = $('#decoyIocs');
    // тик раз в секунду: чипы переписываем, только когда изменился список или статус реквизита
    setIfChanged(box, DC.iocs.length ? DC.iocs.map((i) => {
      const st = NX.iocs.status(i.kind, i.value) || i.status || 'suspected';
      const cls = st === 'suspected' ? 'warn' : st === 'revoked' || st === 'expired' ? 'plain' : 'high';
      return iocChip(i, '<span class="badge ' + cls + '">' + esc(NX.iocs.label(st)) + '</span>' + (i.seenBefore ? ' <span class="tiny muted">уже был в стоп-листе</span>' : ''), DC.shownIocs.has(iocKey(i)));
    }).join('') : '<p class="small muted">Реквизиты появятся здесь, как только мошенник их назовёт.</p>');
    if (box) DC.iocs.forEach((i) => DC.shownIocs.add(iocKey(i)));
  }
  function pushIocs(found, text) {
    const fresh = found.filter((x) => !DC.iocs.some((y) => y.kind === x.kind && y.value === x.value));
    if (!fresh.length) return;
    let added = [];
    try { added = NX.iocs.add(fresh, 'NEXUS Decoy', { client: userName(), session: DC.session, quote: text.slice(0, 180) }) || []; } catch (e) { console.error(e); }
    const seen = added.seen || [];
    fresh.forEach((f) => {
      const norm = NX.normIoc ? NX.normIoc(f.kind, f.value != null ? f.value : f.raw) : f.value;
      const rec = added.find((a) => a.kind === f.kind && a.value === norm) || seen.find((a) => a.kind === f.kind && a.value === norm);
      DC.iocs.push(Object.assign({}, f, { value: norm || f.value, status: NX.iocs.status(f.kind, norm || f.value) || (rec ? rec.status : 'suspected'), seenBefore: !!seen.find((a) => a.kind === f.kind && a.value === norm), firstSeen: rec && rec.firstSeen }));
    });
    const st = statusSummary(DC.iocs.slice(-fresh.length).map((i) => i.status));
    const s = seen.length ? ' · ' + seen.length + ' уже в стоп-листе с ' + NX.hm(seen[0].firstSeen || Date.now()) : '';
    NX.toast('Реквизит извлечён', fresh.map((f) => ((NX.IOC_KIND && NX.IOC_KIND[f.kind]) || f.kind) + ': ' + (f.raw || f.value)).join(', ') + ' → банк · ' + st + s, 'ok');
    addSys(ic('dna', 12) + ' ' + esc(NX.countOf(fresh.length, ['реквизит', 'реквизита', 'реквизитов'])) + ' → банк · ' + esc(st) + (seen.length ? ' · уже был в стоп-листе' : ''));
  }
  // одна реплика мошенника → (реквизиты) → ответ приманки
  function handleScam(raw, auto) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!text || !DC.running) return Promise.resolve();
    const run = DC.run;
    DC.idleAt = Date.now();
    DC.lines++;
    let found = [];
    try { found = NX.extractIocs(text) || []; } catch (e) { found = []; }
    addMsg('scam', text, null, auto);
    if (found.length) pushIocs(found, text);
    updateStats();
    DC.chain = DC.chain.then(async () => {
      if (run !== DC.run) return;
      // реплика попадает в историю внутри очереди: каждый запрос к LLM заканчивается своей репликой мошенника
      DC.history.push({ role: 'user', content: text });
      recheckLlm();
      const dots = typingDots();
      const minWait = sleep(900 + Math.min(900, text.length * 8));
      let reply = null, engine = 'офлайн';
      const fromLlm = await llmReply();
      if (fromLlm) { reply = filterReply(fromLlm); engine = 'Claude'; }
      await minWait;
      dots.remove();
      if (run !== DC.run) return;
      if (!reply) reply = filterReply(offlineReply(text, found));
      DC.replies++;
      DC.history.push({ role: 'assistant', content: reply });
      addMsg('decoy', reply, engine);
      updateStats();
    }).catch((e) => console.error('[decoy]', e));
    return DC.chain;
  }
  function inputBar() {
    let bar = $('#decoyInputBar');
    if (bar) return bar;
    const log = $('#decoyLog');
    if (!log || !log.parentNode) return null;
    bar = document.createElement('form');
    bar.id = 'decoyInputBar';
    // поле и кнопки — переносимые группы (constitution.css → .decoy-bar): на 320–420 px поле занимает
    // всю строку, кнопки уходят под него; на широком экране всё в одну строку
    bar.className = 'decoy-bar';
    bar.style.cssText = 'padding-top:10px;border-top:1px solid var(--line);margin-top:8px';
    bar.innerHTML = '<input class="input decoy-bar-in" id="decoyScamInput" maxlength="400" autocomplete="off" placeholder="Вы — мошенник: представьтесь, попросите код, назовите счёт или номер…" aria-label="Реплика мошенника">' +
      '<div class="decoy-bar-acts"><button class="btn primary sm" type="submit">' + ic('send', 14) + ' Сказать</button>' +
      '<button class="btn sm" type="button" id="decoyAuto" title="Реплики мошенника пойдут по сценарию">Автопилот</button>' +
      '<button class="btn sm danger" type="button" id="decoyFinish">Завершить</button></div>';
    log.parentNode.insertBefore(bar, log.nextSibling);
    bar.onsubmit = (e) => { e.preventDefault(); const i = $('#decoyScamInput'); const v = i.value; i.value = ''; stopAuto(); handleScam(v, false); };
    $('#decoyAuto').onclick = () => runAuto();
    $('#decoyFinish').onclick = () => finish();
    return bar;
  }
  // LLM недоступен — не замораживаем это на всю сессию: перепроверяем не чаще раза в 30 с
  function recheckLlm(force) {
    if (!NX.llmStatus || (NX.flags && NX.flags.llmOff)) return;
    if (!force && (DC.llm || Date.now() - (DC.llmCheckedAt || 0) < 30000)) return;
    DC.llmCheckedAt = Date.now();
    const run = DC.run;
    NX.llmStatus({ timeout: 4000, force: !!force }).then((s) => { if (DC.running && run === DC.run) { DC.llm = !!(s && s.ok); setEngine(); } }).catch(() => {});
  }
  function resetSession(mode, opts) {
    stopAuto();
    DC.session = (opts && opts.session) || NX.uid('decoy');
    DC.running = true; DC.mode = mode; DC.run++; DC.t0 = Date.now(); DC.idleAt = Date.now();
    DC.lines = 0; DC.replies = 0; DC.iocs = []; DC.shownIocs = new Set(); DC.history = []; DC.slots = {}; DC.used = {}; DC.accs = []; DC.lastPool = null; DC.finalSaid = false; DC.chain = Promise.resolve();
    const log = $('#decoyLog'); if (log) log.innerHTML = '';
    const res = $('#decoyResult'); if (res && res.dataset.orig == null) res.dataset.orig = res.innerHTML;
    if (res && res.dataset.orig != null) res.innerHTML = res.dataset.orig;
    // во время сеанса главная кнопка — «Сказать»; «Сыграйте мошенника» и «Автодемо» не нужны (есть «Автопилот»)
    const btn = $('#decoyStart'); if (btn) { btn.disabled = true; btn.classList.remove('primary'); }
    const ab = $('#decoyAutoStart'); if (ab) ab.classList.add('hidden');
    const st = $('#decoyState'); if (st) st.textContent = 'приманка на линии';
    DC.llm = false; DC.llmCheckedAt = 0; setEngine();
    recheckLlm(true);
    updateStats();
    NX.bus.emit('decoy_start', { client: userName(), mode });
    NX.addEvent({ type: 'decoy', source: 'NEXUS Decoy', severity: 'med', title: 'Звонок мошенника переадресован на номер-ловушку', details: 'Робот-приманка «Гульнара-апа» на линии' });
    if (DC.tick) clearInterval(DC.tick);
    DC.tick = setInterval(() => { if (DC.running) updateStats(); }, 1000);
  }
  // Интерактив: мошенника играет судья (текстом)
  function startInteractive(opts) {
    const o = opts && typeof opts === 'object' && !opts.target ? opts : {}; // при вызове из onclick приходит Event
    if (DC.running && DC.mode === 'interactive') { const i = $('#decoyScamInput'); if (i) i.focus(); return; }
    if (DC.running) stopDecoy();
    resetSession('interactive', o);
    const bar = inputBar(); if (bar) bar.classList.remove('hidden');
    addMsg('decoy', LINES.ru.open[0], 'офлайн');
    DC.replies++;
    addSys('Сыграйте мошенника: напишите реплику. Реквизиты для теста — любые вымышленные, например KZ97 9KZT 1234 5678 9012 или +7 701 000 00 00.');
    setTimeout(() => { const i = $('#decoyScamInput'); if (i) { try { i.focus(); } catch (e) { /* ignore */ } } }, 200);
  }
  // Автопилот внутри интерактива: оставшиеся реплики по сценарию
  async function runAuto() {
    if (!DC.running) resetSession('interactive');
    stopAuto();
    const token = (DC.apToken = (DC.apToken || 0) + 1);
    const run = DC.run;
    const btn = $('#decoyAuto'); if (btn) btn.disabled = true;
    for (let i = 0; i < SCAM_AUTO.length; i++) {
      if (token !== DC.apToken || run !== DC.run || !DC.running) break;
      await sleep(700);
      await handleScam(SCAM_AUTO[i], true);
      await sleep(600);
    }
    if (btn) btn.disabled = false;
    if (token === DC.apToken && run === DC.run && DC.running && DC.mode === 'auto') finish();
  }
  function stopAuto() { DC.apToken = (DC.apToken || 0) + 1; const b = $('#decoyAuto'); if (b) b.disabled = false; }
  // Автодемо без ввода (кнопка «Передать мошенника приманке»)
  function startAuto() {
    if (DC.running) stopDecoy();
    resetSession('auto');
    const bar = $('#decoyInputBar'); if (bar) bar.classList.add('hidden');
    runAuto();
  }
  function finish() {
    if (!DC.running) return;
    const n = DC.iocs.length;
    const mins = Math.max(1, Math.round(minutes()));
    const durationMs = Date.now() - DC.t0;
    closeSession('мошенник отключился');
    NX.bus.emit('decoy_end', { client: userName(), iocs: n, durationMs, lines: DC.lines });
    if (n) {
      NX.inbox.push({
        id: NX.uid('inc'), ts: Date.now(), client: userName(), type: 'NEXUS Decoy · разведданные',
        title: 'Номер-ловушка: ' + NX.countOf(n, ['реквизит', 'реквизита', 'реквизитов']) + ' мошенника', score: 90, amount: 0,
        account: DC.iocs[0].raw || DC.iocs[0].value, source: 'NEXUS Decoy', status: 'new',
        factors: DC.iocs.map((i) => ((NX.IOC_KIND && NX.IOC_KIND[i.kind]) || i.kind) + ': ' + (i.raw || i.value) + ' · ' + NX.iocs.label(NX.iocs.status(i.kind, i.value) || 'suspected')),
        chain: [{ t: 'Звонок мошенника распознан', ts: DC.t0 }, { t: 'Звонок переадресован на номер-ловушку', ts: DC.t0 + 1000 }, { t: 'Извлечено реквизитов: ' + n + ' (' + statusSummary(DC.iocs.map((i) => NX.iocs.status(i.kind, i.value) || 'suspected')) + ')', ts: Date.now() - 1000 }, { t: 'Ожидает корреляции с графом связей и решения аналитика', ts: Date.now() }],
      });
    }
    NX.addEvent({ type: 'decoy_done', source: 'NEXUS Decoy', severity: 'low', title: 'Сеанс номера-ловушки завершён', details: NX.countOf(n, ['реквизит', 'реквизита', 'реквизитов']) + ' · ≈' + mins + ' мин времени мошенника (оценка)' });
    const res = $('#decoyResult');
    if (res) {
      res.innerHTML = '<div class="immune"><div class="small muted">Итог сеанса</div><div class="big">' + ic('dna', 22) + ' ' + esc(NX.countOf(n, ['реквизит', 'реквизита', 'реквизитов'])) + ' в банк</div>' +
        '<p class="small mt-s">Мошенник потратил ≈<b>' + mins + ' мин</b> (оценка: 25 с на реплику) на робота-приманку, а не на реальных клиентов. ' +
        (n ? 'Реквизиты в стоп-листе, ' + esc(statusSummary(DC.iocs.map((i) => NX.iocs.status(i.kind, i.value) || 'suspected'))) + '. После корреляции с графом связей или решения аналитика переводы на них <b>удерживаются для проверки</b> у любого клиента банка.' : 'Реквизитов мошенник не назвал — сеанс всё равно отнял у него время.') + '</p>' +
        '<div class="row wrap mt">' + (n ? '<button class="btn sm" type="button" id="tryImmune">Проверить в «Проверить»</button>' : '') + '<a class="btn sm" href="bank.html#graph" target="nexus_bank">Граф связей в банке ' + NX.icon('external', { size: 14, cls: 'nx-ext' }) + '</a></div></div>';
      const t = $('#tryImmune');
      if (t) t.onclick = () => {
        if (NX.go) NX.go('scam');
        const ta = $('#scamText'), b = $('#scanTextBtn');
        if (ta) ta.value = 'Здравствуйте, это банк. Для защиты средств переведите деньги на счёт ' + (DC.iocs[0].raw || DC.iocs[0].value);
        if (b) b.click();
      };
    }
    NX.toast('Сеанс номера-ловушки завершён', NX.countOf(n, ['реквизит', 'реквизита', 'реквизитов']) + ' · ≈' + mins + ' мин мошенника', 'ok');
  }
  function closeSession(state) {
    DC.running = false; DC.run++;
    stopAuto();
    if (DC.tick) { clearInterval(DC.tick); DC.tick = null; }
    const btn = $('#decoyStart'); if (btn) { btn.disabled = false; btn.classList.add('primary'); }
    const ab = $('#decoyAutoStart'); if (ab) ab.classList.remove('hidden');
    const st = $('#decoyState'); if (st) st.textContent = state || 'ожидание';
    const bar = $('#decoyInputBar'); if (bar) bar.classList.add('hidden');
  }
  // stop(): тихо (сброс данных, сцена) — без инцидента
  function stopDecoy() { if (DC.running) closeSession('остановлено'); }

  function init() {
    if (!$('#view-shield')) return;
    const d = $('#shieldDemo'); if (d) d.onclick = runDemo;
    if (d && !$('#shieldDemoBank')) {
      const hb = document.createElement('button');
      hb.className = 'btn'; hb.type = 'button'; hb.id = 'shieldDemoBank';
      hb.innerHTML = ic('phone', 16) + ' ' + esc('Демо: звонок настоящего банка');
      hb.title = 'Честный звонок «карта готова» — сравните поведение с отметкой «звонит банк» из Fraud Fusion Center и без неё';
      hb.onclick = () => runDemo({ honest: true });
      d.parentNode.insertBefore(hb, d.nextSibling);
    }
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-shield-why]') : null;
      if (!t) return;
      e.preventDefault();
      if (NX.Why && typeof NX.Why.open === 'function') NX.Why.open({ manip: SH.manip || undefined, callActive: SH.active, unknownNumber: !(SH.manip && SH.manip.verified) });
    });
    const m = $('#shieldMic'); if (m) m.onclick = micWithConsent;
    const s = $('#shieldStop'); if (s) s.onclick = () => stop('Звонок завершён');
    const ds = $('#decoyStart');
    if (ds) {
      ds.onclick = startInteractive;
      if (!$('#decoyAutoStart')) {
        const a = document.createElement('button');
        a.className = 'btn'; a.type = 'button'; a.id = 'decoyAutoStart'; a.textContent = 'Автодемо';
        a.title = 'Реплики мошенника пойдут по сценарию — без ввода';
        a.onclick = startAuto;
        ds.parentNode.insertBefore(a, ds.nextSibling);
      }
      ds.innerHTML = ic('target', 16) + ' Сыграйте мошенника';
    }
    analyze();
    renderManip(null);
    try { if (window.speechSynthesis) { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => {}; } } catch (e) { /* прогрев голосов */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  NX.Shield = {
    runDemo, runMic: micWithConsent, stop,
    // отметка «звонит банк» появилась или снята (client.js): пересчитать идущий или последний звонок
    refresh: () => { if (SH.active || SH.lines.length) { SH.manipKey = null; analyze(); } },
    status: () => ({ active: SH.active, mode: SH.mode, alerted: SH.alerted, manip: SH.manip ? { attackType: SH.manip.attackType, stages: (SH.manip.stages || []).length, riskIndex: SH.manip.riskIndex } : null }),
    // последний результат NX.Manip.analyze для текущего (или последнего) звонка; client.js → NX.Stage.manip()
    manip: () => (SH.manip ? JSON.parse(JSON.stringify(SH.manip)) : null),
  };
  // startInteractive намеренно не экспортируется: сцена (stage.js) тогда остаётся на своём пульте судьи
  const Decoy = { start: startInteractive, interactive: startInteractive, startAuto, say: (t) => handleScam(t, false), finish, stop: stopDecoy, status: () => ({ running: DC.running, mode: DC.mode, iocs: DC.iocs.length, lines: DC.lines, replies: DC.replies }) };
  NX.Decoy = Decoy;
})();
