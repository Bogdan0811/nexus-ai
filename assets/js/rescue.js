/* =====================================================================
   NEXUS AI 3.0 — PROTECT + RECOVER
   NX.Emergency  — «Заблокировать всё»: одна кнопка «Защитить мои деньги»
   NX.SafeReturn — «Меня обманули»: фиксация, хронология, доказательства, заявление, статус
   NX.Why        — «Почему именно сейчас»: объяснение простыми словами из сигналов

   Зависимости: core.js (NX.state, NX.bus, NX.esc, NX.modal …). Необязательные:
   constitution.js (защитный режим, доверенное лицо), manip.js (NX.Manip), dna.js (NX.DNA) —
   без них модуль работает в упрощённом виде.
   Честность: в прототипе всё — симуляция в браузере; удержание реальных переводов,
   завершение сеансов и обращение по спорной операции требуют интеграции с API банка.
   Safe Return не обещает возврат денег — он помогает быстро и полно запустить процедуру.
   ===================================================================== */
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});

  /* ---------------- утилиты ---------------- */
  const esc = (s) => (NX.esc ? NX.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const ic = (name, size) => (NX.icon ? NX.icon(name, '', size || 18) : '');
  const now = () => Date.now();
  const HOUR = 3600000, DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const dmy = (ts) => { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); };
  const dt = (ts) => dmy(ts) + ', ' + hm(ts);
  const money = (n) => (NX.fmt ? NX.fmt(n) : Math.round(n) + ' ₸');
  const uid = (p) => (NX.uid ? NX.uid(p) : p + '_' + Math.random().toString(36).slice(2, 9));
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const S = () => NX.state || {};
  const CX = () => (NX.Constitution && typeof NX.Constitution.get === 'function' ? NX.Constitution : null);
  const toast = (t, d, k, i) => { try { if (NX.toast) NX.toast(t, d, k, i); } catch (e) { /* ignore */ } };
  const emit = (type, payload) => { try { if (NX.bus) NX.bus.emit(type, payload); } catch (e) { console.error(e); } };
  const saveState = () => { try { if (NX.save) NX.save(); } catch (e) { /* ignore */ } };
  const addEvent = (ev) => { try { if (NX.addEvent) return NX.addEvent(ev); } catch (e) { console.error(e); } return null; };
  const clientName = () => { const u = S().user || {}; return u.name || 'Клиент'; };
  const cxTry = (fn, dflt) => { try { return fn(); } catch (e) { console.error(e); return dflt; } };
  const fire = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* ignore */ } };
  const parseAmount = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.,]/g, '').replace(',', '.')); return isFinite(n) && n > 0 ? Math.round(n) : 0; };
  // заменяет innerHTML, только если разметка изменилась (не перезапускает анимации появления)
  const setHtml = (el, html) => { if (el && el._nxrHtml !== html) { el.innerHTML = html; el._nxrHtml = html; } };

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  const resetting = () => !!(NX.isResetting && NX.isResetting());

  function guardianInfo() {
    const c = CX();
    const g = c ? cxTry(() => c.get().guardian, null) : null;
    if (g && g.name) return { name: g.name, relation: g.relation || 'доверенное лицо', enabled: g.enabled !== false };
    const f = (S().family || []).find((x) => x && x.guardian);
    if (f) return { name: f.name, relation: f.relation || 'доверенное лицо', enabled: true };
    return { name: 'доверенное лицо', relation: '', enabled: false };
  }
  const shortName = (n) => String(n || '').split(' ')[0] || 'доверенное лицо';

  /* =====================================================================
     МЕНЯ ОБМАНУЛИ — ЗАБЛОКИРОВАТЬ ВСЁ
     ===================================================================== */
  const ACTIONS = [
    { key: 'blockNewTransfers', icon: 'lock', title: 'Заблокировать новые переводы', on: 'Новые переводы заблокированы', text: 'Переводы новым получателям удерживаются для проверки, остальные — только с повторным подтверждением', reality: 'proto' },
    { key: 'pauseRecipients', icon: 'users', title: 'Приостановить добавление получателей', on: 'Добавление получателей приостановлено', text: 'Нельзя добавить новый счёт, карту или шаблон, пока защита включена', reality: 'proto' },
    { key: 'endSessions', icon: 'devices', title: 'Завершить подозрительные сеансы', on: 'Сеансы на других устройствах завершены', text: 'Все входы, кроме этого устройства, завершаются — если мошенник получил доступ, он потеряет его', reality: 'api' },
    { key: 'notify', icon: 'bolt', title: 'Уведомить банк и доверенное лицо', on: 'Банк и доверенное лицо уведомлены', text: '', reality: 'sim' },
  ];
  const REALITY = {
    proto: { cls: 'ok', t: 'Работает в прототипе' },
    sim: { cls: 'info', t: 'На симулированных данных' },
    api: { cls: 'warn', t: 'Требует интеграции с API банка' },
  };
  const BY_LABEL = { guardian: 'подтвердило доверенное лицо', bank: 'снято банком', demo_guardian: 'демо: ответ за доверенное лицо', demo_bank: 'демо: решение банка' };
  const mounts = [];

  function emState() { const e = S().emergency; return e && typeof e === 'object' ? e : null; }
  function isActive() { const e = emState(); return !!(e && e.active); }
  function normActions(a) {
    const all = { blockNewTransfers: true, pauseRecipients: true, endSessions: true, notify: true };
    if (a == null) return all;
    const out = { blockNewTransfers: false, pauseRecipients: false, endSessions: false, notify: false };
    if (Array.isArray(a)) a.forEach((k) => { if (k in out) out[k] = true; });
    else if (typeof a === 'object') Object.keys(out).forEach((k) => { out[k] = !!a[k]; });
    return out;
  }
  function actionText(a) {
    if (a.key !== 'notify') return a.text;
    const g = guardianInfo();
    return 'Fraud Fusion Center банка получит сигнал, ' + (g.enabled ? g.name + (g.relation ? ' (' + g.relation + ')' : '') : 'доверенное лицо') + ' — сообщение, что вам нужна поддержка';
  }

  function activate(actions) {
    const acts = normActions(actions);
    if (!Object.keys(acts).some((k) => acts[k])) return null;
    const st = S();
    const at = now();
    const c = CX();
    const prevProtective = c ? !!cxTry(() => c.isProtective(), false) : false;
    const was = emState();
    // защитный режим конституции (статья 0 — включён самим клиентом)
    let protective = null;
    if (c && typeof c.enterProtective === 'function') protective = cxTry(() => c.enterProtective('«Заблокировать всё»', 0), null);
    // симуляция завершения сеансов: все устройства, кроме текущего
    let ended = 0;
    if (acts.endSessions && Array.isArray(st.devices)) st.devices.forEach((d) => { if (d && !d.current && !d.sessionEnded) { d.sessionEnded = at; ended++; } });
    const g = guardianInfo();
    st.emergency = {
      id: (was && was.active && was.id) || uid('em'), active: true, at: (was && was.active && was.at) || at, updatedAt: at, actions: acts,
      by: 'client', protectivePrev: was && was.active ? !!was.protectivePrev : prevProtective, protectiveUntil: protective && protective.until ? protective.until : null,
      sessionsEnded: ended + (was && was.active ? Number(was.sessionsEnded) || 0 : 0), guardian: acts.notify && g.enabled ? g.name : null, release: null,
    };
    // в журнал (и потом в заявление Safe Return) — только то, что реально произошло: завершение сеансов требует API банка
    const list = ACTIONS.filter((a) => acts[a.key]).map((a) => (a.key === 'endSessions' ? (ended ? 'в прототипе отмечены завершёнными сеансы на других устройствах: ' + ended + ' (в банке требует API)' : 'других сеансов не было') : a.on));
    addEvent({ type: 'emergency_shield', source: 'Emergency Shield', severity: 'high', title: 'Включено «Заблокировать всё»', details: list.join(', ') });
    saveState();
    emit('emergency_shield', { client: clientName(), active: true, actions: acts, at: st.emergency.at, guardian: st.emergency.guardian, sessionsEnded: st.emergency.sessionsEnded, simulated: true });
    toast('«Заблокировать всё» включено', 'Новые переводы и получатели заблокированы. Снять защиту можно только через доверенное лицо или банк.', 'ok', 'shieldCheck');
    refreshAll();
    return clone(st.emergency);
  }

  // by: 'guardian' | 'bank' | 'demo_guardian' | 'demo_bank'. Без подтверждения — отказ.
  function deactivate(by, opts) {
    const o = opts || {};
    const e = emState();
    if (!e || !e.active) return { ok: true, already: true };
    if (!BY_LABEL[by]) return { ok: false, reason: 'need_confirmation', text: 'Снять «Заблокировать всё» можно только с подтверждением доверенного лица или банка' };
    const c = CX();
    // защитный режим выключаем, только если его включил «Заблокировать всё»
    if (c && !e.protectivePrev && cxTry(() => c.isProtective(), false)) {
      const map = { guardian: 'guardian', demo_guardian: 'demo', bank: 'bank', demo_bank: 'bank' };
      let r = cxTry(() => c.exitProtective(map[by]), null);
      if (r && r.ok === false) r = cxTry(() => c.exitProtective(by === 'guardian' ? 'guardian' : 'demo'), null);
    }
    const st = S();
    st.emergency = { id: e.id, active: false, at: e.at, actions: e.actions, endedAt: now(), endedBy: by, sessionsEnded: e.sessionsEnded || 0, release: null };
    addEvent({ type: 'emergency_off', source: 'Emergency Shield', severity: 'low', title: '«Заблокировать всё» снято', details: BY_LABEL[by] });
    saveState();
    if (o.emit !== false) emit('emergency_shield', { client: clientName(), active: false, by, at: now() });
    if (o.toast !== false) toast('«Заблокировать всё» снято', BY_LABEL[by].charAt(0).toUpperCase() + BY_LABEL[by].slice(1) + '. Обычные лимиты снова действуют.', 'info', 'shield');
    refreshAll();
    return { ok: true };
  }

  // запрос на снятие защиты доверенному лицу
  function requestRelease() {
    const e = emState();
    if (!e || !e.active) return null;
    if (e.release && e.release.id) return e.release;
    const c = CX();
    const g = guardianInfo();
    let id = null;
    if (c && g.enabled && typeof c.requestGuardian === 'function') {
      id = cxTry(() => c.requestGuardian({ purpose: 'emergency_off', reason: clientName().split(' ')[0] + ' просит снять «Заблокировать всё». Убедитесь, что рядом нет «сотрудника банка» по телефону и деньги никто не торопит переводить', articleN: 5 }), null);
    }
    e.release = { id: id || uid('rel'), ts: now(), guardian: g.enabled ? g.name : null, viaConstitution: !!id };
    saveState();
    emit('emergency_shield', { client: clientName(), active: true, releaseRequested: true, guardian: e.release.guardian, at: e.at });
    refreshAll();
    return e.release;
  }
  function cancelRelease() { const e = emState(); if (e && e.release) { e.release = null; saveState(); refreshAll(); } }

  /* ---------- кнопка ---------- */
  function buttonHtml(compact) {
    const e = emState();
    const on = !!(e && e.active);
    if (compact) {
      return '<button class="nxr-sos sm' + (on ? ' on' : '') + '" type="button" data-nxr-em-open aria-haspopup="dialog" title="' + (on ? '«Заблокировать всё» включено — подробнее' : '«Заблокировать всё» — защитить мои деньги') + '">' +
        '<span class="nxr-sos-ic">' + ic(on ? 'shieldCheck' : 'shield', 16) + '</span><span class="nxr-sos-t"><b>' + (on ? 'Защита вкл.' : 'SOS') + '</b></span></button>';
    }
    if (on) {
      const n = ACTIONS.filter((a) => e.actions && e.actions[a.key]).length;
      return '<button class="nxr-sos on" type="button" data-nxr-em-open aria-haspopup="dialog">' +
        '<span class="nxr-sos-ic">' + ic('shieldCheck', 26) + '</span>' +
        '<span class="nxr-sos-t"><b>«Заблокировать всё» включено</b><span>с ' + esc(hm(e.at)) + ' · ' + n + ' ' + (n === 1 ? 'мера' : n < 5 ? 'меры' : 'мер') + ' защиты · ' + (e.release ? 'ждём подтверждения на снятие' : 'новые переводы удерживаются') + '</span></span>' +
        '<span class="nxr-sos-go">Подробнее</span></button>';
    }
    return '<button class="nxr-sos" type="button" data-nxr-em-open aria-haspopup="dialog">' +
      '<span class="nxr-sos-ic">' + ic('shield', 26) + '</span>' +
      '<span class="nxr-sos-t"><b>Меня обманули — заблокировать всё</b><span>Остановить новые переводы и чужие входы одним нажатием</span></span>' +
      '<span class="nxr-sos-go">' + ic('bolt', 16) + '</span></button>';
  }
  function mount(el, opts) {
    if (!el) return null;
    const o = opts || {};
    const compact = o.compact != null ? !!o.compact : el.getAttribute && el.getAttribute('data-emergency-mount') === 'compact';
    let m = mounts.find((x) => x.el === el);
    if (!m) { m = { el, compact }; mounts.push(m); } else m.compact = compact;
    setHtml(el, buttonHtml(compact));
    return el;
  }
  function refreshMounts() {
    for (let i = mounts.length - 1; i >= 0; i--) {
      const m = mounts[i];
      if (!m.el.isConnected && document.readyState === 'complete') { mounts.splice(i, 1); continue; }
      setHtml(m.el, buttonHtml(m.compact));
    }
  }

  /* ---------- лист ---------- */
  let sheetOpen = false;
  function realityTag(k) { const r = REALITY[k]; return '<span class="nxr-real ' + r.cls + '">' + esc(r.t) + '</span>'; }
  function honestNote() {
    return '<div class="nxr-honest">' + ic('info', 16) + '<div><b>Честно о прототипе:</b> здесь всё — симуляция в браузере. Удержание переводов работает в правилах прототипа; в банке реальную блокировку операций, завершение сеансов и уведомления выполняет API банка — это требует интеграции.</div></div>';
  }
  function sheetOffHtml() {
    return '<div class="nxr-sheet">' +
      '<div class="nxr-sheet-h"><span class="nxr-sheet-ic">' + ic('shield', 24) + '</span><div><h3>«Заблокировать всё»</h3><p class="muted small">Вам звонят и торопят? Кажется, что-то не так? Включите защиту сейчас — разобраться можно потом.</p></div></div>' +
      '<div class="nxr-opts" role="group" aria-label="Меры защиты">' +
      ACTIONS.map((a) => '<label class="nxr-opt"><input type="checkbox" data-nxr-act="' + a.key + '" checked><span class="nxr-opt-ic">' + ic(a.icon, 18) + '</span><span class="nxr-opt-b"><b>' + esc(a.title) + '</b><span>' + esc(actionText(a)) + '</span>' + realityTag(a.reality) + '</span></label>').join('') +
      '</div>' +
      '<div class="nxr-lock">' + ic('lock', 16) + '<span>Снять защиту можно <b>только с подтверждением доверенного лица или банка</b> — даже если мошенник по телефону уговорит вас её отключить.</span></div>' +
      honestNote() +
      '<div class="nxr-sheet-f"><button class="btn" type="button" data-close>Отмена</button><button class="btn nxr-btn-shield" type="button" data-nxr-em-go>' + ic('shieldCheck', 18) + ' Защитить</button></div>' +
      '</div>';
  }
  function sheetOnHtml() {
    const e = emState();
    const g = guardianInfo();
    const acts = ACTIONS.filter((a) => e.actions && e.actions[a.key]);
    const rel = e.release;
    const relBlock = rel
      ? '<div class="nxr-release wait"><div class="row" style="gap:10px;align-items:flex-start">' + ic('clock', 18) + '<div><b>Запрос на снятие отправлен' + (rel.guardian ? ': ' + esc(rel.guardian) : ' в банк') + '</b><div class="small muted">' + esc(hm(rel.ts)) + ' · защита действует, пока ' + (rel.guardian ? 'доверенное лицо не подтвердит, что всё в порядке' : 'банк не подтвердит снятие') + '</div></div></div>' +
        '<div class="nxr-demo-row"><span class="nxr-demo-tag">демо</span>' + (rel.guardian ? '<button class="btn sm" type="button" data-nxr-em-demo="guardian">Ответ доверенного лица: «Всё в порядке»</button>' : '') + '<button class="btn sm" type="button" data-nxr-em-demo="bank">Решение банка: снять</button><button class="btn sm ghost" type="button" data-nxr-em-cancel>Отозвать запрос</button></div></div>'
      : '<div class="nxr-release"><b>Как снять защиту</b><p class="small muted">Только через ' + (g.enabled ? 'доверенное лицо — ' + esc(g.name) + (g.relation ? ' (' + esc(g.relation) + ')' : '') + ', — или банк' : 'банк (доверенное лицо не назначено)') + '. Так мошенник не сможет «уговорить» вас отключить её во время звонка.</p>' +
        '<div class="row wrap" style="gap:8px"><button class="btn sm" type="button" data-nxr-em-release>' + ic('users', 16) + ' Запросить снятие</button>' +
        '<span class="nxr-demo-row inline"><span class="nxr-demo-tag">демо</span><button class="btn sm ghost" type="button" data-nxr-em-demo="bank">Решение банка: снять</button></span></div></div>';
    return '<div class="nxr-sheet">' +
      '<div class="nxr-sheet-h on"><span class="nxr-sheet-ic">' + ic('shieldCheck', 24) + '</span><div><h3>«Заблокировать всё» включено</h3><p class="muted small">С ' + esc(dt(e.at)) + '. Ваши деньги под защитой — можно спокойно разобраться.</p></div></div>' +
      '<ul class="nxr-active">' + acts.map((a) => '<li>' + ic('check', 16) + '<span><b>' + esc(a.on) + '</b>' + (a.key === 'endSessions' ? ' <span class="muted small">· ' + (e.sessionsEnded ? 'других устройств: ' + e.sessionsEnded : 'других сеансов не было') + '</span>' : '') + (a.key === 'notify' && e.guardian ? ' <span class="muted small">· ' + esc(e.guardian) + '</span>' : '') + '</span>' + realityTag(a.reality) + '</li>').join('') + '</ul>' +
      '<div class="nxr-todo"><b>Что сделать сейчас</b><ol>' +
      '<li>Положите трубку. Не называйте коды из SMS и не устанавливайте программы по просьбе звонящего.</li>' +
      '<li>Сами перезвоните в банк по номеру на обороте карты.</li>' +
      '<li>Если деньги уже ушли — оформите обращение «Меня обманули»: чем раньше, тем больше шансов остановить средства.</li></ol>' +
      '<button class="btn sm" type="button" data-nxr-goto-recover>' + ic('folder', 16) + ' Меня обманули</button></div>' +
      relBlock + honestNote() +
      '<div class="nxr-sheet-f"><button class="btn primary" type="button" data-close>Понятно</button></div>' +
      '</div>';
  }
  function open() {
    if (!NX.modal) return false;
    const box = NX.modal(isActive() ? sheetOnHtml() : sheetOffHtml(), { onClose: () => { sheetOpen = false; } });
    sheetOpen = !!box;
    if (box) wireSheet(box);
    return !!box;
  }
  function wireSheet(box) {
    const go = box.querySelector('[data-nxr-em-go]');
    const boxes = Array.prototype.slice.call(box.querySelectorAll('[data-nxr-act]'));
    const sync = () => { if (go) go.disabled = !boxes.some((b) => b.checked); };
    boxes.forEach((b) => b.addEventListener('change', sync));
    if (go) go.onclick = () => {
      const acts = {};
      boxes.forEach((b) => { acts[b.getAttribute('data-nxr-act')] = b.checked; });
      if (!activate(acts)) return;
      rerenderSheet();
    };
    const rel = box.querySelector('[data-nxr-em-release]');
    if (rel) rel.onclick = () => {
      const r = requestRelease();
      if (r) toast('Запрос отправлен', r.guardian ? r.guardian + ' получит запрос на снятие защиты' : 'Банк получит запрос на снятие защиты', 'info', 'users');
      rerenderSheet();
    };
    const cancel = box.querySelector('[data-nxr-em-cancel]');
    if (cancel) cancel.onclick = () => { cancelRelease(); rerenderSheet(); };
    box.querySelectorAll('[data-nxr-em-demo]').forEach((b) => (b.onclick = () => {
      const who = b.getAttribute('data-nxr-em-demo');
      const e = emState();
      if (who === 'guardian' && e && e.release && e.release.viaConstitution && CX()) {
        // настоящий путь через «Близкие»: ответ доверенного лица → guardian_response → снятие
        const res = cxTry(() => CX().resolveGuardian(e.release.id, 'approve', 'demo'), null);
        if (!res || !res.ok) deactivate('demo_guardian');
        else if (isActive()) deactivate('demo_guardian');
      } else deactivate(who === 'guardian' ? 'demo_guardian' : 'demo_bank');
      // защита снята — лист больше не нужен (тост уже сообщил)
      if (!isActive() && NX.closeModal) NX.closeModal(); else rerenderSheet();
    }));
    const rec = box.querySelector('[data-nxr-goto-recover]');
    if (rec) rec.onclick = () => {
      if (NX.closeModal) NX.closeModal();
      if (typeof NX.go === 'function') cxTry(() => NX.go('recover'));
      else { const v = document.getElementById('view-recover') || document.getElementById('safeReturnMount'); if (v && v.scrollIntoView) v.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
  }
  function rerenderSheet() {
    if (!sheetOpen) return;
    const m = document.getElementById('modal');
    if (!m || !m.classList.contains('open') || !m.querySelector('.nxr-sheet')) { sheetOpen = false; return; }
    const box = m.querySelector('.modal-box');
    if (!box) return;
    box.innerHTML = isActive() ? sheetOnHtml() : sheetOffHtml();
    box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => NX.closeModal()));
    wireSheet(box);
  }

  function refreshAll() {
    refreshMounts();
    rerenderSheet();
    SR.refresh();
    fire('nx:emergency', { active: isActive(), emergency: clone(emState()) });
  }

  NX.Emergency = {
    ACTIONS: ACTIONS.map((a) => ({ key: a.key, title: a.title })),
    mount, open, activate, deactivate, isActive, requestRelease,
    get() { return clone(emState()); },
    buttonHtml,
  };

  /* =====================================================================
     NX.Why — «Почему именно сейчас»
     ctx: { callActive|call, callNumber, unknownNumber, newRecipient, recipient, amount, tx, dna, manip,
            weakenAttempt, scamSignal, linkClick, remote, newDevice, emergency, auto(true) }
     ===================================================================== */
  let lastManip = null; // последнее bus 'manip_update'
  const MANIP_TTL = 15 * 60000;

  function coreSignals() {
    try { return NX.Core && NX.Core.signals ? NX.Core.signals() : null; } catch (e) { return null; }
  }
  function weakenRecent() {
    const t = now();
    const evs = (S().events || []).filter((e) => e && !e.resolved && t - e.ts < HOUR && /limit_change|weaken|protect_off/.test(String(e.type || '')));
    if (evs.length) return { ts: evs[0].ts, t: evs[0].title || 'попытка изменить лимиты' };
    const c = CX();
    const hist = c ? cxTry(() => c.get().history || [], []) : [];
    const h = hist.filter((x) => x && t - x.ts < HOUR && (x.kind === 'refused' || x.kind === 'weaken_requested')).pop();
    return h ? { ts: h.ts, t: h.summary || '' } : null;
  }
  function manipFromCtx(ctx) {
    if (ctx.manip && typeof ctx.manip === 'object') return ctx.manip;
    if (ctx.callLines && NX.Manip && typeof NX.Manip.analyze === 'function') return cxTry(() => NX.Manip.analyze(ctx.callLines), null);
    if (lastManip && now() - lastManip.ts < MANIP_TTL) return lastManip.data;
    if (NX.Stage && typeof NX.Stage.manip === 'function') { const m = cxTry(() => NX.Stage.manip(), null); if (m && typeof m === 'object' && (m.attackType || m.stages)) return m; }
    return null;
  }
  function dnaFromCtx(ctx, sig) {
    if (ctx.dna && typeof ctx.dna === 'object') return ctx.dna;
    const tx = ctx.tx || (ctx.amount ? { amount: Number(ctx.amount) || 0, newRecipient: !!ctx.newRecipient, recipient: ctx.recipient, hour: new Date().getHours() } : null);
    if (!tx || !NX.DNA || typeof NX.DNA.assess !== 'function') return null;
    return cxTry(() => NX.DNA.assess(tx, { callActive: !!sig.liveCall, scamSignal: !!(sig.scam || (sig.call && !sig.liveCall)),weakenAttempt: !!sig.weaken, emergency: isActive() }), null);
  }
  const stageLabel = (s) => (s && (s.label || s.id)) || '';

  function explain(ctxIn) {
    const ctx = ctxIn || {};
    const auto = ctx.auto !== false;
    const core = auto ? coreSignals() : null;
    const cxCall = auto && CX() && typeof CX().isCallActive === 'function' ? !!cxTry(() => CX().isCallActive(), false) : false;
    // идущий сейчас звонок (флаг перевода или SDK) и недавно распознанный звонок мошенника (событие Core за 60 мин) — разные сигналы
    const liveCall = !!(ctx.callActive || ctx.call || ctx.onCall || cxCall);
    const recentCall = !liveCall && !!(core && core.call);
    const sig = {
      call: liveCall || recentCall,
      liveCall,
      scam: !!(ctx.scamSignal || (core && core.scam)),
      link: !!(ctx.linkClick || (core && core.link)),
      remote: !!(ctx.remote || (core && core.remote)),
      device: !!(ctx.newDevice || (core && core.newDevice)),
      weaken: ctx.weakenAttempt != null ? (ctx.weakenAttempt ? (typeof ctx.weakenAttempt === 'object' ? ctx.weakenAttempt : { t: '' }) : null) : (auto ? weakenRecent() : null),
    };
    const items = [];
    const add = (key, icon, level, text) => { if (text && !items.some((i) => i.key === key)) items.push({ key, icon, level, text }); };
    const manip = manipFromCtx(ctx);
    const dna = dnaFromCtx(ctx, sig);
    const amount = Number(ctx.amount || (ctx.tx && ctx.tx.amount)) || 0;
    const newRec = ctx.newRecipient != null ? !!ctx.newRecipient : !!(ctx.tx && ctx.tx.newRecipient);

    if (sig.call && !sig.liveCall) {
      add('call', 'phone', 'high', 'Недавно NEXUS распознал звонок мошенника — после такого звонка обманщики часто перезванивают и торопят с переводом.');
    } else if (sig.call) {
      const num = ctx.callNumber ? ' ' + String(ctx.callNumber) : '';
      add('call', 'phone', 'high', (ctx.unknownNumber === false ? 'Сейчас идёт звонок' + num : 'Сейчас идёт звонок с неизвестного номера' + num) + ' — мошенники ведут человека по телефону, пока он сам переводит деньги.');
    }
    if (manip) {
      const at = manip.attackType || {};
      const sc = manip.scenario || {};
      const stages = Array.isArray(manip.stages) ? manip.stages : [];
      const names = stages.map(stageLabel).filter(Boolean);
      if ((at.label && at.id !== 'none') || names.length) {
        let t = 'Разговор похож на сценарий' + (at.label && at.id !== 'none' ? ' «' + at.label + '»' : ' мошенничества');
        if (sc.of) t += ': совпадение ' + (Number(sc.matched) || names.length) + ' из ' + sc.of + ' стадий';
        if (names.length) t += ' (' + names.join(' → ').toLowerCase() + ')';
        if (manip.pressure && manip.pressure.level) t += ', давление ' + manip.pressure.level;
        add('manip', 'brain', 'high', t + '.');
      }
      // «Звонит настоящий банк» (manip.js + отметка из приложения)
      if (manip.badgeClaim) add('badge_claim', 'alert', 'high', 'Звонящий ссылается на «отметку в приложении» — отметку видно только в приложении, настоящему сотруднику незачем о ней говорить. Это признак манипуляции.');
      if (manip.noBankCall) add('no_bank_call', 'phone', 'high', ((NX.Manip && NX.Manip.NO_BANK_CALL) || 'Банк сейчас вам не звонил') + ': звонящий называет себя банком' + (manip.noBankCall.quote ? ' («' + String(manip.noBankCall.quote).slice(0, 90) + '»)' : '') + ', а отметки о звонке банка в приложении нет.');
      else if (manip.verified) add('bank_call_verified', 'shieldCheck', manip.alert ? 'high' : 'low', manip.alert ? 'Отметка «звонит банк» есть, но звонящий просит код, доступ или перевод — этого не просит даже настоящий банк.' : 'Сейчас вам действительно звонит банк (отметка в приложении, симуляция). Коды и переводы банк не просит даже на таком звонке.');
      if (manip.next && manip.next.label) add('manip_next', 'target', 'med', 'Следующий шаг по этому сценарию — «' + manip.next.label + '»' + (manip.next.advice ? '. ' + String(manip.next.advice).replace(/\.\s*$/, '') : '') + '.');
    }
    if (newRec) add('new_recipient', 'users', 'med', 'Получатель новый: вы ещё ни разу не переводили на этот счёт' + (ctx.recipient ? ' (' + String(ctx.recipient).slice(0, 40) + ')' : '') + '.');
    let profileSummary = '';
    if (NX.DNA && typeof NX.DNA.profile === 'function') { const p = cxTry(() => NX.DNA.profile(), null); profileSummary = (p && p.summary) || ''; }
    if (dna && Array.isArray(dna.factors)) {
      dna.factors.forEach((f) => {
        const k = String(f.key || '');
        const text = (f.label || '') + (f.detail ? ': ' + f.detail : '');
        if (/recip/.test(k)) { if (!newRec) add('new_recipient', 'users', 'med', text + '.'); return; }
        if (/call/.test(k) && sig.call) return;
        if (/weak/.test(k)) { if (!sig.weaken) sig.weaken = { t: '' }; return; }
        if (/amount|sum/.test(k)) { add('amount', 'dna', 'med', text + (profileSummary && text.indexOf(profileSummary) < 0 ? ' — ваш профиль «Ваш обычный перевод»: ' + profileSummary : '') + '.'); return; }
        if (/hour|time|night/.test(k)) { add('time', 'clock', 'low', text + '.'); return; }
        if (/combo|cross|mix/.test(k)) { add('combo', 'alert', 'high', text + '.'); return; }
        if (text) add('dna_' + k, 'dna', 'med', text + '.');
      });
    } else if (amount && ctx.unusualAmount) {
      add('amount', 'dna', 'med', 'Сумма ' + money(amount) + ' нетипична для вас' + (profileSummary ? ' (обычно: ' + profileSummary + ')' : '') + '.');
    }
    if (sig.weaken) add('weaken', 'lock', 'high', 'За последний час была попытка ослабить защиту' + (sig.weaken.t ? ' (' + String(sig.weaken.t).replace(/\.\s*$/, '').slice(0, 90) + ')' : '') + ' — так часто делают по подсказке звонящего.');
    if (sig.scam) add('scam', 'chat', 'high', 'Недавно пришло мошенническое сообщение — атака могла начаться с SMS или мессенджера.');
    if (sig.link) add('link', 'link', 'med', 'Был переход по подозрительной ссылке.');
    if (sig.remote) add('remote', 'devices', 'high', 'На устройстве замечена программа удалённого доступа — кто-то может управлять телефоном вместо вас.');
    if (sig.device) add('device', 'devices', 'med', 'Недавно был вход с нового устройства.');
    if (sig.call && newRec && (amount >= 100000 || items.some((i) => i.key === 'amount'))) add('combo', 'alert', 'high', 'Вместе «звонок + новый получатель + крупная сумма» — главный признак социальной инженерии. По отдельности такие признаки бывают и у честных операций.');
    if (isActive() || ctx.emergency) add('emergency', 'shieldCheck', 'med', 'Включено «Заблокировать всё»: новые переводы и получатели удерживаются, пока доверенное лицо или банк не снимут защиту.');

    // сначала сигналы по важности, «сочетание» и «Заблокировать всё» — в конце как вывод
    const order = { high: 0, med: 1, low: 2 };
    const tail = { combo: 10, emergency: 11 };
    items.sort((a, b) => ((tail[a.key] || order[a.level]) - (tail[b.key] || order[b.level])));
    const res = {
      title: 'Почему именно сейчас',
      bullets: items.map((i) => i.text),
      items,
      dna: dna ? { index: dna.index, tier: dna.tier, tierLabel: dna.tierLabel } : null,
      manip: manip ? { attackType: manip.attackType || null, riskIndex: manip.riskIndex != null ? manip.riskIndex : null } : null,
      advice: items.length
        ? 'Если это действительно вы и всё в порядке — подтвердите спокойно: контрольный вопрос, короткая пауза и при необходимости доверенное лицо. Мошенники торопят — мы нет.'
        : 'Особых признаков риска сейчас нет: операция похожа на ваши обычные.',
      empty: !items.length,
    };
    if (dna && dna.explain) res.summary = String(dna.explain);
    return res;
  }
  function whyHtml(res) {
    const r = res && res.bullets ? res : explain(res || {});
    const head = '<div class="nxr-why-h">' + ic('info', 18) + '<b>' + esc(r.title) + '</b>' + (r.dna && r.dna.index != null ? '<span class="nxr-real ' + (r.dna.index >= 80 ? 'danger' : r.dna.index >= 60 ? 'warn' : r.dna.index >= 30 ? 'info' : 'ok') + '">«Ваш обычный перевод» · индекс риска ' + esc(r.dna.index) + '/100</span>' : '') + '</div>';
    const list = r.items.length ? '<ul class="nxr-why-list">' + r.items.map((i) => '<li class="' + i.level + '">' + ic(i.icon, 16) + '<span>' + esc(i.text) + '</span></li>').join('') + '</ul>' : '';
    return '<div class="nxr-why">' + head + (r.summary ? '<p class="small">' + esc(r.summary) + '</p>' : '') + list + '<p class="small muted">' + esc(r.advice) + '</p></div>';
  }
  function whyOpen(ctx) {
    if (!NX.modal) return false;
    NX.modal(whyHtml(explain(ctx)) + '<div class="nxr-sheet-f"><button class="btn primary" type="button" data-close>Понятно</button></div>');
    return true;
  }
  NX.Why = { explain, html: whyHtml, open: whyOpen };

  /* =====================================================================
     SAFE RETURN — «Меня обманули»
     ===================================================================== */
  const KEY = 'nexus_ai_recover_v1';
  const STATUSES = [
    { id: 'registered', label: 'Инцидент зарегистрирован', hint: 'Обращение сохранено, ему присвоен номер.' },
    { id: 'sent', label: 'Информация передана в банк', hint: 'Хронология, доказательства и заявление — у специалиста по спорным операциям.' },
    { id: 'checking', label: 'Операция проверяется', hint: 'Банк проверяет перевод и счёт получателя, при необходимости связывается с банком получателя.' },
    { id: 'need_info', label: 'Запрошено дополнительное подтверждение', hint: 'Банку нужны уточнения — ответьте здесь или в отделении.' },
    { id: 'result', label: 'Результат рассмотрения', hint: 'Банк сообщил итог проверки и дальнейшие шаги.' },
  ];
  const ST_IDX = {}; STATUSES.forEach((s, i) => { ST_IDX[s.id] = i; });
  const CHANNELS = [
    { id: 'call', t: 'Телефонный звонок' }, { id: 'sms', t: 'SMS' }, { id: 'messenger', t: 'Мессенджер (WhatsApp, Telegram)' },
    { id: 'link', t: 'Сайт или ссылка' }, { id: 'ads', t: 'Объявление, соцсети, маркетплейс' }, { id: 'other', t: 'Другое' },
  ];
  const chLabel = (id) => (CHANNELS.find((c) => c.id === id) || CHANNELS[CHANNELS.length - 1]).t;
  const STEPS = ['Что случилось', 'Хронология', 'Доказательства', 'Заявление', 'Отправка'];
  const DEMO_NOTES = {
    checking: 'Специалист по спорным операциям взял обращение в работу (демо).',
    need_info: 'Уточните, пожалуйста: сообщали ли вы кому-либо код из SMS и с какого номера был звонок? (демо-запрос)',
    result: 'Проверка завершена (демо). Возможность возврата зависит от того, успели ли средства уйти со счёта получателя; итог банк сообщает официально.',
  };

  function blank() { return { v: 1, cases: [], draft: null }; }
  function load() {
    try { const r = JSON.parse(lsGet(KEY) || 'null'); if (r && Array.isArray(r.cases)) return r; } catch (e) { /* ignore */ }
    return blank();
  }
  let store = load();
  function persist() { if (resetting()) return false; return lsSet(KEY, JSON.stringify(store)); }

  function toLocalInput(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fromLocalInput(v) { const t = new Date(String(v || '')).getTime(); return isFinite(t) ? t : now(); }
  function newDraft() { return { step: 1, when: toLocalInput(now() - 20 * 60000), amount: '', recipient: '', channel: 'call', what: '', sel: {}, manual: [], sms: '', links: '', phones: '', files: [], statement: '', edited: false, consent: false, touched: false }; }
  function draft() { if (!store.draft) store.draft = newDraft(); return store.draft; }

  /* ---------- хронология из NX.state и конституции ---------- */
  const EV_ICON = { scam_call: 'phone', voice_fake: 'mic', sms: 'chat', scan: 'shield', link_click: 'link', new_device: 'devices', remote_access: 'devices', emergency_shield: 'shield', emergency_off: 'shield', limit_change_attempt: 'lock', limit_change_held: 'lock', decoy: 'target', decoy_done: 'target', guardian_push: 'users', family_alert: 'users', login: 'lock', sessions_killed: 'devices', safe_return: 'folder' };
  const DEFAULT_OFF_EV = ['login', 'scan_manual', 'device_check', 'savings', 'internal', 'internal_transfer', 'bank_update', 'safe_return', 'emergency_off'];
  const CX_ON = ['refused', 'weaken_requested', 'weaken_applied', 'protective_on', 'guardian'];
  // демо-события и запросы «Близкие» о другом человеке не отмечаются в заявлении по умолчанию (клиент может отметить сам)
  const DEMO_RE = /(^|[\s(·])(демо|demo)([\s)·.,]|$)/i;
  const OTHER_PERSON_EV = ['trust_circle', 'family_alert'];
  function autoTimeline(sinceTs) {
    const t0 = sinceTs || now() - DAY;
    const out = [];
    (S().events || []).forEach((e) => {
      if (!e || !(e.ts >= t0)) return;
      if (e.type === 'transfer' || e.type === 'transfer_blocked') return; // переводы — из операций
      const t = (e.title || 'Событие') + (e.details ? ' — ' + e.details : '');
      out.push({ key: 'ev:' + e.id, ts: e.ts, t, src: e.source || 'NEXUS', icon: EV_ICON[e.type] || (e.severity === 'high' ? 'alert' : 'info'), on: DEFAULT_OFF_EV.indexOf(e.type) < 0 && OTHER_PERSON_EV.indexOf(e.type) < 0 && !e.simulated && !DEMO_RE.test(t) && (e.severity === 'high' || e.severity === 'med' || /call|sms|link|device|remote|limit|emergency|decoy|guardian|family/.test(String(e.type))) });
    });
    (S().transactions || []).forEach((x) => {
      if (!x || !(x.ts >= t0) || !(x.type === 'transfer' || x.type === 'transfer_blocked') || !(x.amount < 0)) return;
      const blocked = x.type === 'transfer_blocked' || x.status === 'blocked';
      out.push({ key: 'tx:' + x.id, ts: x.ts, t: (blocked ? 'Перевод удержан для проверки: ' : 'Перевод выполнен: ') + money(-x.amount) + ' → ' + (x.merchant || 'получатель'), src: 'Операции', icon: 'send', on: true, tx: { amount: -x.amount, to: x.merchant || '', blocked } });
    });
    const c = CX();
    const hist = c ? cxTry(() => c.get().history || [], []) : [];
    hist.forEach((h) => {
      if (!h || !(h.ts >= t0) || h.kind === 'sign') return;
      out.push({ key: 'cx:' + (h.id || h.ts), ts: h.ts, t: 'Конституция: ' + String(h.summary || h.kind).replace(' вами вручную', ' мной вручную'), src: 'Финансовая конституция', icon: 'book', on: CX_ON.indexOf(h.kind) >= 0 && !DEMO_RE.test(String(h.summary || '')) });
    });
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }
  function lastOutgoing() {
    const t0 = now() - DAY;
    return (S().transactions || []).find((x) => x && x.ts >= t0 && x.type === 'transfer' && x.amount < 0 && x.status !== 'blocked') || null;
  }
  function selectedTimeline(d) {
    const auto = autoTimeline(fromLocalInput(d.when) - 6 * HOUR < now() - DAY ? fromLocalInput(d.when) - 6 * HOUR : now() - DAY);
    const picked = auto.filter((i) => (d.sel[i.key] != null ? d.sel[i.key] : i.on)).map((i) => ({ ts: i.ts, t: i.t }));
    return picked.concat((d.manual || []).map((m) => ({ ts: m.ts, t: m.t, manual: true }))).sort((a, b) => a.ts - b.ts);
  }
  const lines = (s) => String(s || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const PHONE_RE = /(?:\+7|8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g;
  function evidenceOf(d) {
    return { sms: String(d.sms || '').trim(), links: lines(d.links), phones: lines(d.phones), files: (d.files || []).map((f) => ({ name: f.name, size: f.size, type: f.type || '' })) };
  }
  function fileSize(n) { n = Number(n) || 0; return n >= 1048576 ? (Math.round(n / 104857.6) / 10).toString().replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }

  /* ---------- заявление ---------- */
  function statementText(d, caseId) {
    const u = S().user || {};
    const amount = parseAmount(d.amount);
    const when = fromLocalInput(d.when);
    const tl = selectedTimeline(d);
    const ev = evidenceOf(d);
    const L = [];
    L.push('ЗАЯВЛЕНИЕ О МОШЕННИЧЕСКОЙ ОПЕРАЦИИ');
    L.push('');
    L.push('Кому: в банк, обслуживающий мой счёт (служба по спорным операциям)');
    L.push('От: ' + (u.name || '________________') + (u.phone ? ', телефон ' + u.phone : '') + (u.card ? ', карта ' + u.card : ''));
    L.push('Дата составления: ' + dt(now()));
    L.push('Номер обращения: ' + (caseId || 'будет присвоен после отправки'));
    L.push('');
    L.push('1. Что произошло');
    L.push(dt(when) + ' через канал «' + chLabel(d.channel) + '» со мной связалось лицо, которое ввело меня в заблуждение. ' +
      (amount ? 'В результате был выполнен перевод ' + money(amount) + (d.recipient ? ' получателю: ' + String(d.recipient).trim() : ' (получатель мне неизвестен)') + '.' : 'Сумма ущерба уточняется.') +
      ' Я не давал(а) согласия на перевод средств мошенникам и сообщаю об операции сразу, как узнал(а) о ней.');
    if (String(d.what || '').trim()) L.push('Обстоятельства: ' + String(d.what).trim());
    L.push('');
    L.push('2. Хронология событий');
    if (tl.length) tl.forEach((i) => L.push('  ' + dt(i.ts) + ' — ' + i.t + (i.manual ? ' (со слов заявителя)' : '')));
    else L.push('  Отдельные события не зафиксированы; см. описание выше.');
    L.push('');
    L.push('3. Доказательства');
    L.push('  Текст сообщения: ' + (ev.sms ? '«' + ev.sms.replace(/\s+/g, ' ').slice(0, 600) + '»' : 'нет'));
    L.push('  Ссылки: ' + (ev.links.length ? ev.links.join(', ') : 'нет'));
    L.push('  Номера телефонов: ' + (ev.phones.length ? ev.phones.join(', ') : 'нет'));
    L.push('  Файлы (хранятся у меня, предоставлю по запросу): ' + (ev.files.length ? ev.files.map((f) => f.name + ' (' + fileSize(f.size) + ')').join(', ') : 'нет'));
    L.push('');
    L.push('4. Прошу');
    L.push('  — проверить операцию и принять меры, предусмотренные процедурой по спорным операциям, в том числе связаться с банком получателя;');
    L.push('  — передать реквизиты получателя для проверки на причастность к мошенничеству;');
    L.push('  — сообщить мне о результате рассмотрения обращения.');
    L.push('Мне известно, что подача обращения не гарантирует возврат средств. Параллельно сообщаю о случае в полицию (102).');
    L.push('');
    L.push('Подпись: ____________________     Дата: ' + dmy(now()));
    L.push('');
    L.push('Составлено в NEXUS AI (концепт команды, прототип на синтетических данных; не является продуктом банка).');
    return L.join('\r\n');
  }
  function statementOf(d) { return d.edited && d.statement ? d.statement : statementText(d); }
  function download(text, name) {
    try {
      const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 400);
      toast('Файл сохранён', name, 'ok', 'check');
      return true;
    } catch (e) { console.error(e); toast('Не удалось сохранить файл', 'Скопируйте текст заявления кнопкой «Скопировать»', 'warn'); return false; }
  }
  function copy(text) {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta);
        toast(ok ? 'Текст скопирован' : 'Не удалось скопировать', ok ? 'Заявление в буфере обмена' : 'Выделите текст заявления вручную', ok ? 'ok' : 'warn');
      } catch (e) { toast('Не удалось скопировать', 'Выделите текст заявления вручную', 'warn'); }
    };
    try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(() => toast('Текст скопирован', 'Заявление в буфере обмена', 'ok', 'check'), fallback); return; } } catch (e) { /* ignore */ }
    fallback();
  }
  const fileName = (id) => 'zayavlenie-' + (id || 'nexus-' + dmy(now()).split('.').reverse().join('')) + '.txt';

  /* ---------- кейсы ---------- */
  function caseNo() {
    const d = new Date();
    return 'SR-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + String(Math.floor(1000 + Math.random() * 9000));
  }
  function casePayload(c, extra) {
    return Object.assign({ client: c.client, caseId: c.id, status: c.status, statusLabel: (STATUSES[ST_IDX[c.status]] || {}).label, amount: c.amount, recipient: c.recipient, channel: c.channel, when: c.when, timeline: c.timeline, evidence: c.evidence }, extra || {});
  }
  function setStatus(id, status, note, by) {
    const c = store.cases.find((x) => x.id === id);
    if (!c || ST_IDX[status] == null) return null;
    if (c.status === status && !note) return c;
    c.status = status; c.updatedAt = now();
    c.history.push({ status, ts: now(), note: note ? String(note).slice(0, 400) : '', by: by || 'bank' });
    persist();
    return c;
  }
  function submit() {
    const d = draft();
    const id = caseNo();
    const c = {
      id, client: clientName(), createdAt: now(), updatedAt: now(), status: 'registered',
      history: [{ status: 'registered', ts: now(), note: '', by: 'client' }],
      amount: parseAmount(d.amount), recipient: String(d.recipient || '').trim(), channel: d.channel, channelLabel: chLabel(d.channel), when: fromLocalInput(d.when), what: String(d.what || '').trim(),
      timeline: selectedTimeline(d).map((i) => ({ ts: i.ts, t: i.t })), evidence: evidenceOf(d), replies: [],
    };
    c.statement = d.edited && d.statement ? d.statement.replace('Номер обращения: будет присвоен после отправки', 'Номер обращения: ' + id) : statementText(d, id);
    store.cases.unshift(c);
    store.cases = store.cases.slice(0, 30);
    store.draft = null;
    persist();
    addEvent({ type: 'safe_return', source: 'Safe Return', severity: 'med', title: 'Обращение «Меня обманули» ' + id, details: (c.amount ? money(c.amount) + (c.recipient ? ' → ' + c.recipient : '') + ' · ' : '') + c.timeline.length + ' событий в хронологии' });
    emit('safe_return_case', casePayload(c));
    setTimeout(() => {
      const cc = setStatus(id, 'sent', 'Обращение доставлено в Fraud Fusion Center банка (в прототипе — панель банка этого демо).', 'system');
      if (cc) { emit('safe_return_case', casePayload(cc)); SR.refresh(); }
    }, 1200);
    return c;
  }

  /* ---------- отрисовка ---------- */
  const SR = { roots: [], openCase: null, err: '' };
  function stepperHtml(step) {
    return '<ol class="nxr-steps" aria-label="Шаги обращения">' + STEPS.map((s, i) => {
      const n = i + 1;
      const cls = n < step ? 'done' : n === step ? 'cur' : '';
      return '<li class="' + cls + '"' + (n === step ? ' aria-current="step"' : '') + '><button type="button" data-nxr-step="' + n + '"' + (n > step ? ' disabled' : '') + '><span class="n">' + (n < step ? ic('check', 14) : n) + '</span><span class="l">' + esc(s) + '</span></button></li>';
    }).join('') + '</ol>';
  }
  // подпись связана с полем через for/id — экранные дикторы называют поле
  function field(label, html, hint) {
    const m = /^<(input|select|textarea)\b[^>]*data-nxr-f="([a-z0-9_-]+)"/i.exec(html);
    const id = m ? 'nxr-f-' + m[2] : '';
    const ctl = id ? html.replace(/^<(input|select|textarea)\b/i, '<$1 id="' + id + '"') : html;
    return '<div class="field"><label' + (id ? ' for="' + id + '"' : '') + '>' + esc(label) + '</label>' + ctl + (hint ? '<span class="small muted">' + esc(hint) + '</span>' : '') + '</div>';
  }
  function step1(d) {
    const lo = lastOutgoing();
    const pre = lo && !d.touched ? '<button class="nxr-prefill" type="button" data-nxr-prefill="' + esc(lo.id) + '">' + ic('send', 16) + '<span>Это перевод <b>' + esc(money(-lo.amount)) + ' → ' + esc(lo.merchant || 'получатель') + '</b> в ' + esc(hm(lo.ts)) + '? <u>Заполнить по нему</u></span></button>' : '';
    return '<h3>Когда и что случилось</h3><p class="small muted">Заполните, что помните. Точность важнее красоты — детали можно добавить позже.</p>' + pre +
      '<div class="nxr-form">' +
      field('Когда это произошло', '<input class="input" type="datetime-local" data-nxr-f="when" value="' + esc(d.when) + '" max="' + esc(toLocalInput(now() + 60000)) + '">') +
      field('Сумма, ₸', '<input class="input" inputmode="numeric" data-nxr-f="amount" value="' + esc(d.amount) + '" placeholder="Например, 150 000" autocomplete="off">') +
      field('Кому ушли деньги', '<input class="input" data-nxr-f="recipient" value="' + esc(d.recipient) + '" placeholder="Имя, IBAN, номер карты или телефона — если знаете" autocomplete="off">') +
      field('Как с вами связались', '<select class="input" data-nxr-f="channel">' + CHANNELS.map((c) => '<option value="' + c.id + '"' + (c.id === d.channel ? ' selected' : '') + '>' + esc(c.t) + '</option>').join('') + '</select>') +
      '</div>' +
      field('Коротко: что вам говорили и что вы сделали', '<textarea class="input" rows="3" data-nxr-f="what" placeholder="Например: позвонили «из службы безопасности банка», сказали, что на меня оформляют кредит, попросили перевести деньги на «безопасный счёт»">' + esc(d.what) + '</textarea>') +
      (SR.err ? '<p class="nxr-err" role="alert">' + esc(SR.err) + '</p>' : '');
  }
  function step2(d) {
    const since = fromLocalInput(d.when) - 6 * HOUR < now() - DAY ? fromLocalInput(d.when) - 6 * HOUR : now() - DAY;
    const items = autoTimeline(since);
    const list = items.length
      ? '<ul class="nxr-tl">' + items.map((i) => {
        const on = d.sel[i.key] != null ? d.sel[i.key] : i.on;
        return '<li><label class="nxr-tl-row' + (on ? ' on' : '') + '"><input type="checkbox" data-nxr-sel="' + esc(i.key) + '"' + (on ? ' checked' : '') + '><span class="t">' + esc(hm(i.ts)) + '<small>' + esc(dmy(i.ts).slice(0, 5)) + '</small></span><span class="i">' + ic(i.icon, 16) + '</span><span class="b">' + esc(i.t) + '<small>' + esc(i.src) + '</small></span></label></li>';
      }).join('') + '</ul>'
      : '<div class="nxr-empty">' + ic('clock', 20) + '<span>За последние сутки NEXUS не зафиксировал событий. Добавьте важные моменты вручную — например, время звонка.</span></div>';
    const manual = (d.manual || []).length
      ? '<ul class="nxr-tl manual">' + d.manual.map((m, i) => '<li><div class="nxr-tl-row on"><span class="t">' + esc(hm(m.ts)) + '<small>' + esc(dmy(m.ts).slice(0, 5)) + '</small></span><span class="i">' + ic('list', 16) + '</span><span class="b">' + esc(m.t) + '<small>добавлено вами</small></span><button class="btn icon sm ghost" type="button" data-nxr-man-del="' + i + '" aria-label="Удалить событие">' + ic('x', 16) + '</button></div></li>').join('') + '</ul>'
      : '';
    return '<h3>Хронология</h3><p class="small muted">NEXUS собрал события за последние 24 часа: звонки, тревоги, переводы и изменения конституции. Отметьте те, что относятся к случаю.</p>' + list + manual +
      '<div class="nxr-add"><input class="input" type="time" data-nxr-man-time value="' + esc(hm(now())) + '" aria-label="Время события"><input class="input" data-nxr-man-text placeholder="Например: звонок с номера +7 707 …, представились банком" aria-label="Что произошло"><button class="btn sm" type="button" data-nxr-man-add>' + ic('list', 16) + ' Добавить</button></div>';
  }
  function step3(d) {
    const files = (d.files || []).length
      ? '<ul class="nxr-files">' + d.files.map((f, i) => '<li>' + ic(/^image\//.test(f.type) ? 'image' : 'folder', 16) + '<span>' + esc(f.name) + ' <small>' + esc(fileSize(f.size)) + '</small></span><button class="btn icon sm ghost" type="button" data-nxr-file-del="' + i + '" aria-label="Убрать файл">' + ic('x', 16) + '</button></li>').join('') + '</ul>'
      : '';
    return '<h3>Доказательства</h3><p class="small muted">Сохраните всё, что осталось: текст SMS, ссылки, номера, скриншоты переписки и перевода.</p>' +
      field('Текст SMS или сообщения', '<textarea class="input" rows="3" data-nxr-f="sms" placeholder="Вставьте текст сообщения целиком">' + esc(d.sms) + '</textarea>') +
      '<div class="row wrap" style="gap:8px;margin:-4px 0 12px"><button class="btn sm ghost" type="button" data-nxr-extract>' + ic('search', 16) + ' Найти ссылки и номера в тексте</button></div>' +
      '<div class="nxr-form">' +
      field('Ссылки', '<textarea class="input" rows="2" data-nxr-f="links" placeholder="По одной в строке">' + esc(d.links) + '</textarea>') +
      field('Номера телефонов', '<textarea class="input" rows="2" data-nxr-f="phones" placeholder="С какого номера звонили или писали">' + esc(d.phones) + '</textarea>') +
      '</div>' +
      '<div class="field"><label>Скриншоты и файлы</label><label class="nxr-drop">' + ic('upload', 18) + '<span><b>Выбрать файлы</b><small>Файлы не покидают устройство: в обращение попадают только имя и размер. Оригиналы сохраните — банк запросит их при необходимости.</small></span><input type="file" multiple accept="image/*,.pdf,.txt,.doc,.docx" data-nxr-files></label>' + files + '</div>';
  }
  function step4(d) {
    return '<h3>Готовое заявление</h3><p class="small muted">Текст собран из ваших ответов. Его можно поправить, скачать и приложить к обращению в банк и в полицию (102).</p>' +
      '<textarea class="input nxr-statement" rows="14" data-nxr-statement spellcheck="false">' + esc(statementOf(d)) + '</textarea>' +
      '<div class="row wrap mt-s" style="gap:8px"><button class="btn sm" type="button" data-nxr-dl>' + ic('upload', 16) + ' Скачать .txt</button><button class="btn sm" type="button" data-nxr-copy>' + ic('list', 16) + ' Скопировать</button>' + (d.edited ? '<button class="btn sm ghost" type="button" data-nxr-regen>' + ic('reset', 16) + ' Вернуть автоматический текст</button>' : '') + '</div>';
  }
  function step5(d) {
    const ev = evidenceOf(d);
    const tl = selectedTimeline(d);
    const amount = parseAmount(d.amount);
    const nEv = (ev.sms ? 1 : 0) + ev.links.length + ev.phones.length + ev.files.length;
    return '<h3>Отправить в банк</h3><p class="small muted">Проверьте и отправьте. Банк увидит обращение вместе с хронологией и доказательствами.</p>' +
      '<dl class="nxr-sum"><div><dt>Сумма</dt><dd>' + esc(amount ? money(amount) : '—') + '</dd></div><div><dt>Получатель</dt><dd>' + esc(d.recipient || 'не указан') + '</dd></div><div><dt>Когда</dt><dd>' + esc(dt(fromLocalInput(d.when))) + '</dd></div><div><dt>Канал</dt><dd>' + esc(chLabel(d.channel)) + '</dd></div><div><dt>Хронология</dt><dd>' + tl.length + ' ' + (tl.length % 10 === 1 && tl.length % 100 !== 11 ? 'событие' : [2, 3, 4].indexOf(tl.length % 10) >= 0 && [12, 13, 14].indexOf(tl.length % 100) < 0 ? 'события' : 'событий') + '</dd></div><div><dt>Доказательства</dt><dd>' + nEv + '</dd></div></dl>' +
      '<div class="nxr-honest">' + ic('info', 16) + '<div><b>Обращение не гарантирует возврат денег.</b> Оно помогает быстро и полно запустить процедуру: чем раньше банк получит факты, тем выше шанс остановить средства у получателя. В прототипе обращение уходит в панель банка этого демо; в банке — требует интеграции с API по спорным операциям.</div></div>' +
      '<label class="check mt"><input type="checkbox" data-nxr-consent' + (d.consent ? ' checked' : '') + '> Подтверждаю, что сведения указаны верно, и согласен(на) на их передачу в банк для проверки операции</label>' +
      (SR.err ? '<p class="nxr-err" role="alert">' + esc(SR.err) + '</p>' : '');
  }
  function wizardHtml() {
    const d = draft();
    const step = Math.min(5, Math.max(1, Number(d.step) || 1));
    const body = [step1, step2, step3, step4, step5][step - 1](d);
    const nav = '<div class="nxr-nav">' +
      (step > 1 ? '<button class="btn" type="button" data-nxr-back>Назад</button>' : (d.touched ? '<button class="btn ghost" type="button" data-nxr-clear>Очистить</button>' : '<span></span>')) +
      (step < 5 ? '<button class="btn primary" type="button" data-nxr-next>Далее</button>' : '<button class="btn primary" type="button" data-nxr-send' + (d.consent ? '' : ' disabled') + '>' + ic('send', 16) + ' Отправить в банк</button>') +
      '</div>';
    return '<div class="card nxr-wiz"><div class="card-h"><h3>Новое обращение</h3><span class="hint">шаг ' + step + ' из 5 · ' + esc(STEPS[step - 1].toLowerCase()) + '</span></div>' + stepperHtml(step) + '<div class="nxr-step" data-step="' + step + '">' + body + '</div>' + nav + '</div>';
  }
  function trackHtml(c) {
    const cur = ST_IDX[c.status] || 0;
    return '<ol class="nxr-track">' + STATUSES.map((s, i) => {
      const h = c.history.filter((x) => x.status === s.id).pop();
      const cls = i < cur ? 'done' : i === cur ? 'cur' : '';
      return '<li class="' + cls + '"><span class="dot">' + (i < cur ? ic('check', 12) : '') + '</span><span class="lb">' + esc(s.label) + (h ? '<small>' + esc(hm(h.ts)) + '</small>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }
  function caseHtml(c) {
    const cur = STATUSES[ST_IDX[c.status] || 0];
    const opened = SR.openCase === c.id;
    const notes = c.history.filter((h) => h.note).slice(-3).reverse();
    const ev = c.evidence || { links: [], phones: [], files: [] };
    const lastH = c.history[c.history.length - 1] || {};
    const needInfo = c.status === 'need_info' && lastH.by !== 'client';
    const replied = c.status === 'need_info' && lastH.by === 'client';
    const canNext = (ST_IDX[c.status] || 0) < STATUSES.length - 1 && c.status !== 'registered';
    return '<article class="nxr-case' + (c.status === 'result' ? ' fin' : '') + '" data-case="' + esc(c.id) + '">' +
      '<div class="nxr-case-h"><div><b class="mono">' + esc(c.id) + '</b><div class="small muted">' + esc(dt(c.createdAt)) + ' · ' + esc(c.channelLabel || chLabel(c.channel)) + '</div></div><div class="nxr-case-amt">' + esc(c.amount ? money(c.amount) : '—') + '<small>' + esc(c.recipient || 'получатель не указан') + '</small></div></div>' +
      trackHtml(c) +
      '<div class="nxr-case-st"><span class="badge ' + (c.status === 'need_info' ? 'warn' : c.status === 'result' ? 'ok' : 'info') + '">' + esc(cur.label) + '</span><span class="small muted">' + esc(replied ? 'Ваш ответ передан в банк — ждём решения специалиста.' : cur.hint) + '</span></div>' +
      (notes.length ? '<ul class="nxr-notes">' + notes.map((n) => '<li><span class="small muted">' + esc(hm(n.ts)) + ' · ' + (n.by === 'client' ? 'вы' : n.by === 'system' ? 'NEXUS' : n.by === 'demo' ? 'банк (демо)' : 'банк') + '</span>' + esc(n.note) + '</li>').join('') + '</ul>' : '') +
      (needInfo ? '<div class="nxr-reply"><textarea class="input" rows="2" data-nxr-reply="' + esc(c.id) + '" placeholder="Ваш ответ банку"></textarea><button class="btn sm primary" type="button" data-nxr-reply-send="' + esc(c.id) + '">Отправить ответ</button></div>' : '') +
      '<div class="row wrap nxr-case-f"><button class="btn sm" type="button" data-nxr-case-dl="' + esc(c.id) + '">' + ic('upload', 16) + ' Заявление .txt</button><button class="btn sm ghost" type="button" data-nxr-case-toggle="' + esc(c.id) + '" aria-expanded="' + opened + '">' + (opened ? 'Скрыть детали' : 'Детали') + '</button>' +
      (canNext ? '<span class="nxr-demo-row inline"><span class="nxr-demo-tag">демо</span><button class="btn sm ghost" type="button" data-nxr-case-next="' + esc(c.id) + '" title="В продукте статус меняет банк">Следующий статус</button></span>' : '') + '</div>' +
      (opened ? '<div class="nxr-case-d"><b class="small">Хронология</b>' + (c.timeline.length ? '<ul class="nxr-mini">' + c.timeline.map((i) => '<li><span class="mono">' + esc(hm(i.ts)) + '</span> ' + esc(i.t) + '</li>').join('') + '</ul>' : '<p class="small muted">нет событий</p>') +
        '<b class="small">Доказательства</b><ul class="nxr-mini">' + (ev.sms ? '<li>SMS: «' + esc(ev.sms.slice(0, 160)) + (ev.sms.length > 160 ? '…' : '') + '»</li>' : '') + (ev.links || []).map((l) => '<li>Ссылка: ' + esc(l) + '</li>').join('') + (ev.phones || []).map((p) => '<li>Номер: ' + esc(p) + '</li>').join('') + (ev.files || []).map((f) => '<li>Файл: ' + esc(f.name) + ' (' + esc(fileSize(f.size)) + ', хранится у вас)</li>').join('') + (!ev.sms && !(ev.links || []).length && !(ev.phones || []).length && !(ev.files || []).length ? '<li class="muted">не приложены</li>' : '') + '</ul></div>' : '') +
      '</article>';
  }
  function casesHtml() {
    const list = store.cases;
    return '<div class="card nxr-cases"><div class="card-h"><h3>Мои обращения</h3><span class="hint">' + (list.length ? list.length + ' · статус обновляет банк' : 'пока нет') + '</span></div>' +
      (list.length ? list.map(caseHtml).join('') : '<div class="nxr-empty">' + ic('folder', 20) + '<span>Здесь появятся обращения и их статус: от регистрации до результата рассмотрения.</span></div>') + '</div>';
  }
  function introHtml() {
    const on = isActive();
    return '<div class="card nxr-intro"><div class="nxr-intro-h"><span class="nxr-sheet-ic">' + ic('folder', 22) + '</span><div><h3>Меня обманули: что делать прямо сейчас</h3><p class="small muted">Не вините себя — мошенники работают профессионально. Важна скорость: первые часы решают, успеет ли банк остановить деньги.</p></div></div>' +
      '<ol class="nxr-now">' +
      '<li><b>Защитите счёт.</b> ' + (on ? '«Заблокировать всё» уже включён — новые переводы и получатели заблокированы.' : 'Включите «Заблокировать всё» — он остановит новые переводы и выкинет чужие сеансы.') + '</li>' +
      '<li><b>Позвоните в банк</b> по номеру на обороте карты и сообщите об операции.</li>' +
      '<li><b>Не верьте «возврату».</b> Если перезвонят и пообещают вернуть деньги за «комиссию» — это та же схема.</li>' +
      '<li><b>Оформите обращение ниже</b> — NEXUS соберёт хронологию и заявление за пару минут. Его же можно отнести в полицию (102).</li></ol>' +
      '<div class="nxr-intro-sos" data-nxr-sos-slot></div></div>';
  }
  function renderRoot(r) {
    if (!r.el || !r.el.isConnected) return;
    if (!r.built) {
      r.el.classList.add('nxr-recover');
      r.el.innerHTML = '<div class="nxr-col" data-nxr-intro></div><div class="nxr-grid"><div data-nxr-wiz></div><div data-nxr-cases></div></div>';
      r.built = true;
      wireRoot(r);
    }
    setHtml(r.el.querySelector('[data-nxr-intro]'), introHtml());
    const slot = r.el.querySelector('[data-nxr-sos-slot]');
    if (slot) mount(slot);
    setHtml(r.el.querySelector('[data-nxr-wiz]'), wizardHtml());
    setHtml(r.el.querySelector('[data-nxr-cases]'), casesHtml());
  }
  function refresh(part) {
    SR.roots = SR.roots.filter((r) => r.el && (r.el.isConnected || document.readyState !== 'complete'));
    SR.roots.forEach((r) => {
      if (!r.built) return renderRoot(r);
      if (!part || part === 'intro') { setHtml(r.el.querySelector('[data-nxr-intro]'), introHtml()); const slot = r.el.querySelector('[data-nxr-sos-slot]'); if (slot) mount(slot); }
      if (!part || part === 'wiz') setHtml(r.el.querySelector('[data-nxr-wiz]'), wizardHtml());
      if (!part || part === 'cases') setHtml(r.el.querySelector('[data-nxr-cases]'), casesHtml());
    });
  }
  SR.refresh = () => { try { refresh(); } catch (e) { console.error(e); } };
  function render(el) {
    if (!el) return null;
    let r = SR.roots.find((x) => x.el === el);
    if (!r) { r = { el, built: false }; SR.roots.push(r); }
    renderRoot(r);
    return el;
  }
  function validateStep(d) {
    if (d.step === 1) {
      if (!parseAmount(d.amount)) return 'Укажите сумму перевода — хотя бы примерно.';
      if (fromLocalInput(d.when) > now() + 5 * 60000) return 'Время не может быть в будущем.';
    }
    return '';
  }
  function goStep(n, r) {
    const d = draft();
    d.step = Math.min(5, Math.max(1, n));
    SR.err = '';
    persist();
    refresh('wiz');
    const wiz = r && r.el.querySelector('.nxr-wiz');
    if (wiz && wiz.getBoundingClientRect && wiz.getBoundingClientRect().top < 0) wiz.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function wireRoot(r) {
    const el = r.el;
    el.addEventListener('input', (e) => {
      const t = e.target;
      const d = draft();
      const f = t.getAttribute && t.getAttribute('data-nxr-f');
      if (f) { d[f] = t.value; d.touched = true; if (SR.err && d.step === 1) { SR.err = ''; const er = el.querySelector('.nxr-err'); if (er) er.remove(); } persist(); return; }
      if (t.hasAttribute && t.hasAttribute('data-nxr-statement')) { d.statement = t.value; d.edited = true; persist(); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      const d = draft();
      if (t.hasAttribute('data-nxr-sel')) { d.sel[t.getAttribute('data-nxr-sel')] = t.checked; d.touched = true; const row = t.closest('.nxr-tl-row'); if (row) row.classList.toggle('on', t.checked); persist(); return; }
      if (t.hasAttribute('data-nxr-consent')) { d.consent = t.checked; SR.err = ''; persist(); const b = el.querySelector('[data-nxr-send]'); if (b) b.disabled = !t.checked; return; }
      if (t.hasAttribute('data-nxr-files')) {
        const fl = Array.prototype.slice.call(t.files || []);
        fl.forEach((f) => { if (!d.files.some((x) => x.name === f.name && x.size === f.size)) d.files.push({ name: String(f.name).slice(0, 120), size: f.size, type: f.type || '' }); });
        d.files = d.files.slice(0, 20); d.touched = true;
        try { t.value = ''; } catch (er) { /* ignore */ }
        persist(); refresh('wiz');
        return;
      }
      if (t.getAttribute('data-nxr-f') === 'when' || t.getAttribute('data-nxr-f') === 'channel') { d[t.getAttribute('data-nxr-f')] = t.value; d.touched = true; persist(); }
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (!b || !el.contains(b)) return;
      const d = draft();
      const A = (k) => b.getAttribute(k);
      if (b.hasAttribute('data-nxr-em-open')) return; // обрабатывает общий обработчик
      if (A('data-nxr-step')) { const n = Number(A('data-nxr-step')); if (n < d.step) goStep(n, r); return; }
      if (b.hasAttribute('data-nxr-next')) { const er = validateStep(d); if (er) { SR.err = er; refresh('wiz'); const f = el.querySelector('[data-nxr-f="amount"]'); if (f) f.focus(); return; } goStep(d.step + 1, r); return; }
      if (b.hasAttribute('data-nxr-back')) { goStep(d.step - 1, r); return; }
      if (b.hasAttribute('data-nxr-clear')) { store.draft = newDraft(); SR.err = ''; persist(); refresh('wiz'); return; }
      if (A('data-nxr-prefill')) {
        const tx = (S().transactions || []).find((x) => x.id === A('data-nxr-prefill'));
        if (tx) { d.amount = String(-tx.amount); d.recipient = tx.merchant || ''; d.when = toLocalInput(tx.ts); d.touched = true; persist(); refresh('wiz'); }
        return;
      }
      if (b.hasAttribute('data-nxr-man-add')) {
        const tIn = el.querySelector('[data-nxr-man-time]'), xIn = el.querySelector('[data-nxr-man-text]');
        const text = xIn ? String(xIn.value || '').trim() : '';
        if (!text) { if (xIn) xIn.focus(); toast('Опишите событие', 'Например: «звонок с номера +7 707 …»', 'warn'); return; }
        const base = new Date(fromLocalInput(d.when));
        const parts = String((tIn && tIn.value) || hm(now())).split(':');
        base.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
        let ts = base.getTime(); if (ts > now()) ts -= DAY;
        d.manual.push({ ts, t: text.slice(0, 200) }); d.touched = true;
        persist(); refresh('wiz');
        return;
      }
      if (A('data-nxr-man-del') != null) { d.manual.splice(Number(A('data-nxr-man-del')), 1); persist(); refresh('wiz'); return; }
      if (A('data-nxr-file-del') != null) { d.files.splice(Number(A('data-nxr-file-del')), 1); persist(); refresh('wiz'); return; }
      if (b.hasAttribute('data-nxr-extract')) {
        const text = String(d.sms || '');
        if (!text.trim()) { toast('Сначала вставьте текст', 'Ссылки и номера ищутся в тексте SMS', 'warn'); return; }
        let urls = [];
        try { urls = NX.extractUrls ? NX.extractUrls(text) : []; } catch (er) { urls = []; }
        if (!urls.length) urls = text.match(/(?:https?:\/\/|www\.)[^\s"'<>]+|\b[a-z0-9-]+\.(?:kz|ru|com|net|org|xyz|top|click|online|site|info|me|io)(?:\/[^\s"'<>]*)?/gi) || [];
        urls = urls.map((u) => String(u && u.url ? u.url : u).replace(/[).,;!?]+$/, ''));
        const phones = (text.match(PHONE_RE) || []).map((p) => p.trim());
        const addUniq = (field, arr) => { const have = lines(d[field]); let n = 0; arr.forEach((v) => { if (have.indexOf(v) < 0) { have.push(v); n++; } }); d[field] = have.join('\n'); return n; };
        const n1 = addUniq('links', urls), n2 = addUniq('phones', phones);
        d.touched = true; persist(); refresh('wiz');
        toast(n1 + n2 ? 'Найдено в тексте' : 'Ничего не найдено', n1 + n2 ? 'Ссылок: ' + n1 + ', номеров: ' + n2 : 'Добавьте ссылки и номера вручную, если они были', n1 + n2 ? 'ok' : 'info');
        return;
      }
      if (b.hasAttribute('data-nxr-dl')) { download(statementOf(d), fileName()); return; }
      if (b.hasAttribute('data-nxr-copy')) { copy(statementOf(d)); return; }
      if (b.hasAttribute('data-nxr-regen')) { d.edited = false; d.statement = ''; persist(); refresh('wiz'); return; }
      if (b.hasAttribute('data-nxr-send')) {
        if (!d.consent) { SR.err = 'Отметьте согласие на передачу сведений в банк.'; refresh('wiz'); return; }
        const er = validateStep(Object.assign({}, d, { step: 1 }));
        if (er) { SR.err = er; d.step = 1; persist(); refresh('wiz'); return; }
        const c = submit();
        SR.openCase = null;
        refresh();
        toast('Обращение ' + c.id + ' зарегистрировано', 'Передаём в банк хронологию, доказательства и заявление', 'ok', 'folder');
        const card = el.querySelector('[data-case="' + c.id + '"]');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (A('data-nxr-case-dl')) { const c = store.cases.find((x) => x.id === A('data-nxr-case-dl')); if (c) download(c.statement || '', fileName(c.id)); return; }
      if (A('data-nxr-case-toggle')) { SR.openCase = SR.openCase === A('data-nxr-case-toggle') ? null : A('data-nxr-case-toggle'); refresh('cases'); return; }
      if (A('data-nxr-case-next')) {
        const c = store.cases.find((x) => x.id === A('data-nxr-case-next'));
        if (!c) return;
        const next = STATUSES[(ST_IDX[c.status] || 0) + 1];
        if (!next) return;
        setStatus(c.id, next.id, DEMO_NOTES[next.id] || '', 'demo');
        emit('safe_return_case', casePayload(c, { demo: true }));
        refresh('cases');
        return;
      }
      if (A('data-nxr-reply-send')) {
        const id = A('data-nxr-reply-send');
        const ta = el.querySelector('[data-nxr-reply="' + id + '"]');
        const text = ta ? String(ta.value || '').trim() : '';
        if (!text) { if (ta) ta.focus(); return; }
        const c = store.cases.find((x) => x.id === id);
        if (!c) return;
        c.replies = (c.replies || []).concat([{ ts: now(), t: text.slice(0, 600) }]);
        c.history.push({ status: c.status, ts: now(), note: text.slice(0, 400), by: 'client' });
        c.updatedAt = now();
        persist();
        emit('safe_return_case', casePayload(c, { reply: text.slice(0, 600) }));
        toast('Ответ отправлен', 'Банк увидит его в обращении ' + id, 'ok');
        refresh('cases');
      }
    });
  }

  NX.SafeReturn = {
    KEY, STATUSES: STATUSES.map((s) => ({ id: s.id, label: s.label })),
    render,
    cases() { return clone(store.cases); },
    get(id) { return clone(store.cases.find((c) => c.id === id) || null); },
    timeline: (since) => autoTimeline(since).map((i) => ({ ts: i.ts, t: i.t, src: i.src })),
    statement: (id) => { const c = store.cases.find((x) => x.id === id); return c ? c.statement : statementText(draft()); },
    update(id, status, note) { const c = setStatus(id, status, note, 'bank'); if (c) SR.refresh(); return clone(c); },
  };

  /* =====================================================================
     ШИНА, ДЕЛЕГИРОВАНИЕ, АВТОМОНТАЖ
     ===================================================================== */
  if (NX.bus && typeof NX.bus.on === 'function') {
    NX.bus.on((msg, local) => {
      if (!msg || !msg.type) return;
      const p = msg.payload || {};
      try {
        switch (msg.type) {
          case 'manip_update':
            lastManip = { ts: now(), data: p };
            break;
          case 'guardian_response': {
            const e = emState();
            if (e && e.active && e.release && e.release.id && p.id === e.release.id) {
              if (p.verdict === 'approve') deactivate(p.by === 'demo' ? 'demo_guardian' : 'guardian');
              else { e.release = null; saveState(); toast('Защита остаётся', (e.guardian || 'Доверенное лицо') + ' не подтвердило снятие — «Заблокировать всё» продолжает действовать', 'warn', 'shield'); refreshAll(); }
            }
            break;
          }
          case 'emergency_shield':
            // банк снимает защиту из своей панели
            if (!local && p.active === false && (p.by === 'bank' || p.by === 'demo_bank') && isActive() && (!p.client || p.client === clientName())) deactivate(p.by, { emit: false });
            break;
          case 'safe_return_update': {
            if (!p.caseId || ST_IDX[p.status] == null) break;
            store = load();
            const c = setStatus(p.caseId, p.status, p.note || '', 'bank');
            if (c) { toast('Обращение ' + c.id, STATUSES[ST_IDX[c.status]].label + (p.note ? ': ' + String(p.note).slice(0, 120) : ''), p.status === 'need_info' ? 'warn' : 'info', 'folder'); refresh('cases'); }
            break;
          }
          case 'protective_mode':
          case 'event':
          case 'constitution_change':
            refreshMounts();
            // новое событие → обновить хронологию, если клиент на шаге 2 и ничего не вводит
            if (store.draft && store.draft.step === 2 && !SR.roots.some((r) => r.el.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) refresh('wiz');
            break;
          case 'reset':
            store = blank();
            refreshAll();
            break;
          default:
        }
      } catch (e) { console.error(e); }
    });
  }
  // другие вкладки (банк / сцена) изменили обращения
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    store = load();
    refresh('cases');
  });
  // любой элемент с [data-emergency-open] или [data-nxr-em-open] открывает лист
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-emergency-open],[data-nxr-em-open]');
    if (!b) return;
    e.preventDefault();
    open();
  });
  function autoMount() {
    const m = document.getElementById('emergencyMount'); if (m) mount(m);
    document.querySelectorAll('[data-emergency-mount]').forEach((el) => mount(el));
    const v = document.getElementById('safeReturnMount') || document.getElementById('view-recover');
    if (v && !SR.roots.some((r) => r.el === v)) render(v);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();
})();
