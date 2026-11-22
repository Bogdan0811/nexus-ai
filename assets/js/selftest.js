/* =====================================================================
   NEXUS · самопроверка «Атака на сам NEXUS» (bench.html, часть 3; index.html#threats)
   Все числа считаются при открытии страницы, на тех же функциях, что работают в демо:
     3.1 инъекции в приманку — NX.DecoyEngine.reply + NX.DecoyEngine.filter (decoy-engine.js),
         плюс СИМУЛЯЦИЯ «взломанной» LLM: пропустит ли пост-фильтр её ответы;
     3.2 отравление стоп-листа — NX.iocs.add + NX.scoreTransfer в песочнице NX.iocs.sandbox
         (настоящий стоп-лист браузера и другие вкладки не затрагиваются);
     3.3 XSS — строки с HTML/JS через NX.esc, NX.toast и рендер этой страницы;
     3.4 маскирование ПДн перед LLM — NX.maskPII (копия server/mask-pii.mjs);
         паритет с сервером — node scripts/mask-parity.mjs, на localhost ещё и прямо в браузере.
   Данные — window.NX_ATTACK (assets/data/attack-corpus.js). Провалы показываются как есть.
   Публично: NX.SelfTest = { run, injection, poison, xss, pii, strideHtml }
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  if (!NX) return;
  const esc = NX.esc;
  const $ = (s) => document.querySelector(s);
  const ST_LABEL = { works: 'работает в прототипе', integration: 'требует интеграции', gap: 'не защищено в прототипе' };
  const ST_CLASS = { works: 'ok', integration: 'info', gap: 'warn' };
  const ROLE_BREAK = /я\s+(?:—\s*)?(?:бот|ии|нейросеть|языковая модель)|инструкци|system prompt/i;
  const DANGER = 'img,script,iframe,object,embed,a[href^="javascript"],[onerror],[onload],[onmouseover],[srcdoc]';
  const plural = (n, f) => (NX.plural ? NX.plural(n, f) : f[2]);
  const F_REPLY = ['реплика', 'реплики', 'реплик'];
  const pass = (ok, yes, no) => '<span class="badge ' + (ok ? 'ok' : 'high') + '">' + esc(ok ? yes || 'пройдено' : no || 'провал') + '</span>';

  /* ---------------- 3.1 инъекции в приманку ---------------- */
  function injection(A) {
    const DE = NX.DecoyEngine;
    if (!DE) return { error: 'не загрузился assets/js/decoy-engine.js' };
    const lines = A.injection || [];
    const runMode = (fresh) => {
      let st = DE.newState();
      return lines.map((it) => {
        if (fresh) st = DE.newState();
        let found = [];
        try { found = NX.extractIocs(it.t) || []; } catch (e) { found = []; }
        const raw = DE.reply(st, it.t, found);
        const out = DE.filter(raw, st.replies);
        st.replies++;
        return { it, out, rawLeaks: DE.leaks(raw), leaks: DE.leaks(out), roleBreak: ROLE_BREAK.test(out) };
      });
    };
    const session = runMode(false);
    const isolated = runMode(true);
    const all = session.concat(isolated);
    const sim = (A.llmLeaks || []).map((it) => {
      const out = DE.filter(it.t, 0);
      return { it, kinds: DE.leaks(it.t), blocked: DE.NEUTRAL.indexOf(out) >= 0 };
    });
    return {
      lines: lines.length, replies: all.length, session,
      leaked: all.filter((r) => r.leaks.length).length,
      rawLeaked: all.filter((r) => r.rawLeaks.length).length,
      roleBreaks: all.filter((r) => r.roleBreak).length,
      sim, simBlocked: sim.filter((s) => s.blocked).length,
    };
  }

  /* ---------------- 3.2 отравление стоп-листа ---------------- */
  function poison(A) {
    const P = A.poison;
    if (!P || !NX.iocs || typeof NX.iocs.sandbox !== 'function') return { error: 'нет NX.iocs.sandbox в core.js' };
    try {
      return NX.iocs.sandbox(() => {
        const parsed = NX.parseAccount(P.victim.account);
        if (!parsed) return { error: 'реквизит жертвы не распознан' };
        const added = [];
        P.lines.forEach((line) => { added.push((NX.extractIocs(line) || []).length); NX.iocs.add(NX.extractIocs(line), 'NEXUS Decoy', { session: P.session, client: P.client }); });
        const snap = () => {
          const recs = NX.iocs.all().filter((r) => r.kind === parsed.kind && r.value === parsed.value);
          const rec = recs[0] || null;
          const d = NX.scoreTransfer({ amount: P.amount, account: P.victim.account });
          const iocHold = (d.rules || []).some((r) => r.key === 'ioc' && r.decision === 'block');
          // показываем только вклад правила стоп-листа: остальные правила scoreTransfer читают живое
          // состояние демо (звонок, Emergency Shield, DNA клиента) и в песочницу не входят
          const iocRule = (d.rules || []).find((r) => r.key === 'ioc') || (d.rules || []).find((r) => r.key === 'ioc_suspected');
          return {
            records: recs.length, status: NX.iocs.status(parsed.kind, parsed.value), sources: rec ? NX.iocIndependentSources(rec) : 0,
            ttlH: rec && rec.expiresAt ? Math.round((rec.expiresAt - rec.lastChange) / 3600000) : null,
            decision: iocRule ? iocRule.decision : 'none', iocHold, suspectedRule: (d.rules || []).some((r) => r.key === 'ioc_suspected'),
          };
        };
        const one = snap();
        NX.iocs.add(NX.extractIocs(P.lines[0]), P.second.source, { session: P.second.session, client: P.second.client });
        const two = snap();
        const ok = one.records === 1 && one.sources === 1 && one.status === 'suspected' && !one.iocHold;
        return { ok, one, two, mentions: P.lines.length, extracted: added };
      });
    } catch (e) {
      console.error('[selftest] poison', e);
      return { error: String((e && e.message) || e) };
    }
  }

  /* ---------------- 3.3 XSS ---------------- */
  function xss(A, opts) {
    const tpl = document.createElement('template');
    return (A.xss || []).map((p) => {
      tpl.innerHTML = '<div>' + esc(p) + '</div>';
      const div = tpl.content.firstChild;
      const escOk = !!div && div.children.length === 0 && div.textContent === p;
      let toastOk = null;
      if (opts && opts.toast && typeof NX.toast === 'function') {
        const el = NX.toast(p, p, 'info', p);
        if (el) {
          toastOk = !el.querySelector(DANGER) && el.textContent.indexOf(p) >= 0;
          clearTimeout(el._nxTimer);
          if (el.parentNode) el.parentNode.removeChild(el);
        }
      }
      return { p, escOk, toastOk };
    });
  }

  /* ---------------- 3.4 маскирование ПДн ---------------- */
  function pii(A) {
    if (typeof NX.maskPII !== 'function') return { error: 'нет NX.maskPII в core.js' };
    const rows = (A.pii || []).map((p) => {
      const stems = NX.maskPII.stems(p.names || []);
      const out = NX.maskPII(p.t, { stems });
      const miss = (p.expect || []).filter((tok) => out.indexOf(tok) < 0);
      return { p, out, miss, residual: /\d{4,}/.test(out) };
    });
    return { rows, ok: rows.filter((r) => !r.miss.length && !r.residual).length };
  }
  // паритет с сервером прямо в браузере: только на локальном сервере (на деплое /server закрыт)
  function isLocal() { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }
  function parity(A) {
    if (!isLocal()) return Promise.resolve({ skipped: true });
    let url;
    try { url = new URL('server/mask-pii.mjs', document.baseURI).href; } catch (e) { return Promise.resolve({ skipped: true }); }
    return import(url).then((m) => {
      const texts = [];
      const walk = (v) => { if (typeof v === 'string') { if (v.trim().length >= 4) texts.push(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k])); };
      walk(A);
      const C = window.NX_CORPUS;
      if (C) walk(C);
      const names = [];
      (A.pii || []).forEach((p) => (p.names || []).forEach((n) => names.push(n)));
      const sStems = m.nameStems(names);
      const cStems = NX.maskPII.stems(names);
      let n = 0, diff = 0;
      Array.from(new Set(texts)).forEach((t) => {
        [false, true].forEach((withNames) => {
          n++;
          if (m.maskPII(t, withNames ? { stems: sStems } : undefined) !== NX.maskPII(t, withNames ? { stems: cStems } : undefined)) diff++;
        });
      });
      if (JSON.stringify(sStems) !== JSON.stringify(cStems)) diff++;
      return { n, diff };
    }).catch((e) => ({ error: String((e && e.message) || e) }));
  }

  /* ---------------- STRIDE ---------------- */
  function statusBadge(s) { return '<span class="badge ' + (ST_CLASS[s] || 'plain') + '">' + esc(ST_LABEL[s] || s) + '</span>'; }
  function strideHtml(A) {
    const rows = (A && A.stride) || [];
    return '<div class="stride">' + rows.map((r) =>
      '<article class="stride-row" id="stride-' + esc(r.id) + '">' +
        '<div class="stride-h"><span class="tag mono">' + esc(r.letters) + '</span><h4>' + esc(r.asset) + '</h4></div>' +
        '<p class="small muted">' + esc(r.threat) + '</p>' +
        '<ul class="stride-i">' + (r.items || []).map((it) => '<li>' + statusBadge(it.s) + '<span>' + esc(it.t) + '</span></li>').join('') + '</ul>' +
        '<div class="stride-c">' + (r.code || []).map((c) => '<code>' + esc(c) + '</code>').join('') + '</div>' +
      '</article>').join('') + '</div>';
  }
  function statusList(items) {
    return '<ul class="stride-i">' + (items || []).map((it) => '<li>' + statusBadge(it.s) + '<span>' + esc(it.t) + '</span></li>').join('') + '</ul>';
  }

  /* ---------------- рендер bench.html ---------------- */
  function renderBench(A, R) {
    const box = $('#selftestRoot');
    if (!box) return;
    const I = R.inj, P = R.poison, X = R.xss, M = R.pii;
    const xEsc = X.filter((x) => x.escOk).length;
    const xToast = X.filter((x) => x.toastOk === true).length;
    const xToastN = X.filter((x) => x.toastOk !== null).length;
    const main = M.rows ? M.rows.find((r) => r.p.main) || M.rows[0] : null;
    const kpi = (label, value, note, ok) => '<div class="card kpi"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="ci">' + pass(ok) + ' ' + esc(note) + '</div></div>';
    let html = '<section class="kpis mt">' +
      (I.error ? kpi('3.1 · утечки из приманки', '—', I.error, false) : kpi('3.1 · утечки из приманки', I.leaked + ' из ' + I.replies, 'ответов офлайн-движка с цифрами, IBAN, ссылкой или e-mail', I.leaked === 0)) +
      (I.error ? '' : kpi('3.1 · пост-фильтр, симуляция LLM', I.simBlocked + ' из ' + I.sim.length, 'ответов «взломанной» LLM заменено', I.simBlocked === I.sim.length)) +
      (P.error ? kpi('3.2 · отравление стоп-листа', '—', P.error, false) : kpi('3.2 · отравление стоп-листа', P.one.iocHold ? 'удержание' : 'без удержания', P.mentions + ' повтора в одной сессии → ' + P.one.records + ' запись, ' + P.one.sources + ' источник', P.ok)) +
      kpi('3.3 · XSS', X.filter((x) => x.escOk && x.toastOk !== false).length + ' из ' + X.length, 'строк с HTML/JS выведены как текст', xEsc === X.length && xToast === xToastN) +
      '</section>';

    // 3.1
    if (!I.error) {
      const fails = I.sim.filter((s) => !s.blocked);
      html += '<section class="card mt" id="st-inject"><div class="card-h"><h3>3.1 · Инъекции в приманку</h3><span class="hint">NX.DecoyEngine · ' + esc(I.lines) + ' реплик × 2 режима</span></div>' +
        '<p class="small muted">' + esc(I.lines) + ' реплик «мошенника» пытаются вывести приманку из роли или заставить её назвать цифры, счёт, ссылку, e-mail. Прогон дважды: одним разговором и каждая реплика с чистого листа. Ответ проверяется тем же пост-фильтром, что стоит на сервере и в демо.</p>' +
        '<div class="st-grid mt-s">' +
          '<div><b>' + esc(I.leaked) + '</b><span>утечек после пост-фильтра из ' + esc(I.replies) + ' ' + esc(plural(I.replies, F_REPLY)) + '</span></div>' +
          '<div><b>' + esc(I.rawLeaked) + '</b><span>утечек в ответах движка до фильтра</span></div>' +
          '<div><b>' + esc(I.roleBreaks) + '</b><span>ответов с выходом из роли («я бот», «инструкции»)</span></div>' +
        '</div>' +
        '<details class="callx mt-s"><summary><b>Разговор с приманкой</b><span class="cmeta">' + esc(I.session.length) + ' реплик</span></summary><ol class="clines mt-s">' +
          I.session.map((r, i) => '<li class="' + (r.leaks.length || r.roleBreak ? 'al' : '') + '"><span class="no">' + (i + 1) + '</span><span class="tx"><b>Мошенник:</b> ' + esc(r.it.t) + '<br><span class="muted"><b>Приманка:</b> ' + esc(r.out) + '</span></span></li>').join('') +
        '</ol></details>' +
        '<h4 class="mt">Симуляция: что, если LLM всё-таки подчинилась</h4>' +
        '<p class="small muted">Ответы ниже написала команда: так могла бы ответить модель, если бы инъекция сработала. Сама модель так не отвечала, это проверка последней линии защиты.</p>' +
        '<p class="small">' + pass(!fails.length, 'все заменены', 'пропущено: ' + fails.length) + ' пост-фильтр заменил ' + esc(I.simBlocked) + ' из ' + esc(I.sim.length) + '.</p>' +
        (fails.length ? '<ul class="st-miss">' + fails.map((s) => '<li><span class="tag">' + esc(s.it.id) + '</span> ' + esc(s.it.t) + '</li>').join('') + '</ul>' +
          '<p class="small muted">Пропуски — честное слабое место: пост-фильтр ловит цифры, IBAN, ссылки и e-mail, но не числа словами и не выход из роли. От этого защищает только системный промпт приманки; правило под этот корпус мы не подгоняли.</p>' : '') +
        '</section>';
    }

    // 3.2
    if (!P.error) {
      const st = (s) => esc(NX.iocs.label(s) || s || '—');
      const dec = (d) => esc({ allow: 'пропустить', confirm: 'подтвердить', block: 'удержать', cool: 'охлаждение', none: 'нет' }[d] || d || '—');
      html += '<section class="card mt" id="st-poison"><div class="card-h"><h3>3.2 · Отравление стоп-листа</h3><span class="hint">NX.iocs.sandbox · стоп-лист в памяти</span></div>' +
        '<p class="small muted">Мошенник ' + esc(P.mentions) + ' раза диктует приманке счёт невиновного человека (' + esc(A.poison.victim.owner) + '), чтобы банк заблокировал чужие деньги. Затем клиентка пытается перевести ' + esc(NX.fmt ? NX.fmt(A.poison.amount) : A.poison.amount) + ' на этот счёт. Прогон идёт в песочнице: настоящий стоп-лист этого браузера и вкладки банка не меняются.</p>' +
        '<div class="table-wrap mt-s"><table class="table st-table"><thead><tr><th>Шаг</th><th>Записей</th><th>Независимых источников</th><th>Статус</th><th>Правило стоп-листа</th></tr></thead><tbody>' +
          '<tr><td>' + esc(P.mentions) + ' повтора, одна сессия</td><td class="mono">' + esc(P.one.records) + '</td><td class="mono">' + esc(P.one.sources) + '</td><td>' + st(P.one.status) + (P.one.ttlH != null ? '<div class="tiny muted">срок проверки ' + esc(P.one.ttlH) + ' ч</div>' : '') + '</td><td>' + dec(P.one.decision) + (P.one.iocHold ? ' · <b>удержание из-за стоп-листа</b>' : ' · стоп-лист не удерживает') + '</td></tr>' +
          '<tr><td>+ второй клиент, другая сессия</td><td class="mono">' + esc(P.two.records) + '</td><td class="mono">' + esc(P.two.sources) + '</td><td>' + st(P.two.status) + '</td><td>' + dec(P.two.decision) + (P.two.iocHold ? ' · <b>удержание из-за стоп-листа</b>' : ' · стоп-лист не удерживает') + '</td></tr>' +
        '</tbody></table></div>' +
        '<p class="tiny muted">В колонке — только решение правила стоп-листа. Итоговое решение по переводу зависит ещё от звонка, Emergency Shield и DNA клиента в этом браузере; эти данные в песочницу не входят, поэтому здесь не показаны.</p>' +
        '<p class="small mt-s">' + pass(P.ok) + ' Ожидание для одной сессии: одна запись, один источник, статус «на проверке», без удержания.</p>' +
        '<p class="small muted">Вторая строка — остаточный риск, а не провал теста: два независимых клиента по правилам дают «подтверждён корреляцией» и удержание. Сговор двух «жертв» это обходит; защита — срок 30 дней, обратный звонок с официального номера и обжалование владельцем счёта.</p>' +
        '</section>';
    }

    // 3.3
    html += '<section class="card mt" id="st-xss"><div class="card-h"><h3>3.3 · XSS через тексты мошенника</h3><span class="hint">NX.esc · NX.toast · эта страница</span></div>' +
      '<p class="small muted">Мошенник может вписать HTML и JavaScript в SMS, имя получателя или реплику. Каждая строка проходит через NX.esc в инертный шаблон, через настоящий NX.toast и выводится на этой странице. Если бы обработчик сработал, он записал бы счётчик в <span class="mono">window.__nxXss</span>.</p>' +
      '<div class="table-wrap mt-s"><table class="table st-table"><thead><tr><th>Строка</th><th>NX.esc</th><th>NX.toast</th></tr></thead><tbody>' +
        X.map((x) => '<tr><td class="mono small">' + esc(x.p) + '</td><td>' + pass(x.escOk, 'текст', 'HTML') + '</td><td>' + (x.toastOk === null ? '<span class="badge plain">не проверялся</span>' : pass(x.toastOk, 'текст', 'HTML')) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="small mt-s" id="stXssLive">Проверяем, не сработал ли обработчик…</p>' +
      '<p class="small muted">Проверены три рендерера. Остальные экраны используют тот же NX.esc; это проверено чтением кода, а не этим тестом.</p>' +
      '</section>';

    // 3.4
    if (!M.error && main) {
      html += '<section class="card mt" id="st-pii"><div class="card-h"><h3>3.4 · Маскирование ПДн перед LLM</h3><span class="hint">NX.maskPII · копия server/mask-pii.mjs</span></div>' +
        '<p class="small muted">Перед отправкой в /api/chat номера счетов, карт, телефонов, ИИН и имена заменяются метками: в браузере и ещё раз на сервере. Имена берутся из списка, который знает кабинет (клиент, семья, получатели); здесь — из корпуса.</p>' +
        '<div class="two-col mt-s"><div><div class="label-s">До</div><div class="st-quote">' + esc(main.p.t) + '</div></div><div><div class="label-s">После · уходит в LLM</div><div class="st-quote ok">' + esc(main.out) + '</div></div></div>' +
        '<p class="small mt-s">' + pass(M.ok === M.rows.length) + ' ' + esc(M.ok) + ' из ' + esc(M.rows.length) + ' реплик: все ожидаемые метки на месте и не осталось 4+ цифр подряд.</p>' +
        (M.rows.filter((r) => r.miss.length || r.residual).length ? '<ul class="st-miss">' + M.rows.filter((r) => r.miss.length || r.residual).map((r) => '<li><span class="tag">' + esc(r.p.id) + '</span> ' + esc(r.out) + (r.miss.length ? ' <span class="muted">нет: ' + esc(r.miss.join(', ')) + '</span>' : '') + '</li>').join('') + '</ul>' : '') +
        '<p class="small" id="stParity">Паритет с сервером: проверяем…</p>' +
        '</section>';
    }

    // STRIDE
    html += '<section class="card mt" id="st-stride"><div class="card-h"><h3>Модель угроз STRIDE</h3><span class="hint">статус у каждого утверждения</span></div>' +
      '<p class="small muted">S — подмена, T — изменение данных, R — отказ от действий, I — утечка, D — отказ в обслуживании, E — повышение прав. «Не защищено в прототипе» — слабые места, которые мы показываем сами.</p>' +
      strideHtml(A) + '</section>';

    box.innerHTML = html;
    if (NX.renderIcons) NX.renderIcons(box);
  }

  function liveXss(root) {
    const injected = root ? root.querySelectorAll(DANGER).length : 0;
    const fired = Number(window.__nxXss) || 0;
    return { injected, fired, ok: !injected && !fired };
  }

  /* ---------------- рендер index.html#threats ---------------- */
  function renderIndex(A, R) {
    const live = $('#threatsLive');
    if (live) {
      const I = R.inj, P = R.poison, X = R.xss, M = R.pii;
      const cell = (v, t, ok) => '<div' + (ok ? '' : ' class="hold"') + '><b>' + esc(v) + '</b><span>' + esc(t) + '</span></div>';
      live.innerHTML =
        (I.error ? '' : cell(I.leaked + ' из ' + I.replies, 'утечек цифр, IBAN, ссылок из приманки на ' + I.lines + ' инъекциях', I.leaked === 0)) +
        (I.error ? '' : cell(I.simBlocked + ' из ' + I.sim.length, 'ответов «взломанной» LLM заменил пост-фильтр (симуляция)', I.simBlocked === I.sim.length)) +
        (P.error ? '' : cell(P.one.iocHold ? 'удержание' : 'без удержания', P.mentions + ' повтора чужого счёта в одной сессии → «' + NX.iocs.label(P.one.status) + '»', P.ok)) +
        cell(X.filter((x) => x.escOk).length + ' из ' + X.length, 'строк с HTML/JS выведены как текст', X.every((x) => x.escOk)) +
        (M.error ? '' : cell(M.ok + ' из ' + M.rows.length, 'реплик с ПДн замаскированы перед LLM', M.ok === M.rows.length));
    }
    const sb = $('#threatsStride');
    if (sb) sb.innerHTML = strideHtml(A);
    const pv = $('#threatsPrivacy');
    if (pv && A.privacy) pv.innerHTML = A.privacy.map((g) => '<div class="lt"><h4>' + esc(g.title) + '</h4>' + statusList(g.items) + '</div>').join('');
  }

  function run() {
    const A = window.NX_ATTACK;
    const onBench = !!$('#selftestRoot');
    if (!A) {
      const box = $('#selftestRoot') || $('#threatsLive');
      if (box) box.innerHTML = '<div class="notice warn">Не загрузился корпус атак (assets/data/attack-corpus.js).</div>';
      return null;
    }
    const R = { inj: injection(A), poison: poison(A), xss: xss(A, { toast: onBench }), pii: pii(A) };
    if (onBench) {
      renderBench(A, R);
      const root = $('#selftestRoot');
      // onerror у картинки срабатывает асинхронно — проверяем один раз после загрузки
      setTimeout(() => {
        const L = liveXss(root);
        const el = $('#stXssLive');
        if (el) el.innerHTML = pass(L.ok, 'ни один обработчик не сработал', 'сработало') + ' Опасных элементов в разметке этой части: ' + esc(L.injected) + ', срабатываний обработчиков: ' + esc(L.fired) + '.';
      }, 500);
      parity(A).then((res) => {
        const el = $('#stParity');
        if (!el) return;
        if (res.skipped) el.innerHTML = '<span class="badge plain">не в браузере</span> Паритет с сервером проверяет <span class="mono">node scripts/mask-parity.mjs</span>: на сайте серверный код закрыт, в браузере сравнение идёт только на локальном сервере.';
        else if (res.error) el.innerHTML = pass(false, '', 'не проверено') + ' Не удалось загрузить server/mask-pii.mjs: ' + esc(res.error);
        else el.innerHTML = pass(res.diff === 0, 'паритет', 'расхождение') + ' Сервер и браузер сравнены прямо здесь: ' + esc(res.n) + ' прогонов по корпусу, расхождений ' + esc(res.diff) + '.';
      });
    } else renderIndex(A, R);
    return R;
  }

  NX.SelfTest = { run, injection, poison, xss, pii, parity, strideHtml };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
