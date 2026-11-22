/* =====================================================================
   NEXUS · честный бенчмарк Anti-Scam (bench.html)
   Прогоняет NX.scanText (assets/js/core.js) по размеченному корпусу
   window.NX_CORPUS (assets/data/sms-corpus.js) прямо в браузере и считает:
   confusion matrix, precision / recall / FPR / F1 с 95% интервалами Уилсона,
   ROC-AUC, PR-AUC (average precision), PR-кривую и гистограмму индекса риска,
   разбивку по языкам и схемам, список ошибок, пересчёт precision на
   реальную долю мошенничества. Никаких заранее посчитанных чисел.
   v3: время до обнаружения на звонках window.NX_CALLS (assets/data/call-scenarios.js):
   на какой реплике тревога, сколько реплик в запасе до просьбы кода, доля звонков
   с тревогой до кода; точность типа атаки NX.Manip; разбивка RU / KZ;
   отдельный блок «Замеры демо (сцена)» из localStorage nexus_ai_stage_metrics_v1.
   Корпус и звонки собраны командой хакатона — это не данные банка.
   Публично: NX.Bench = { run, confusion, metrics, wilson, rocAuc, prCurve, state,
                          evalCall, evalCalls, callSummary, stageMetrics }
   ===================================================================== */
(function () {
  'use strict';
  const NX = window.NX;
  const C = window.NX_CORPUS;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => (NX && NX.esc ? NX.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const plural = (n, f) => (NX && NX.plural ? NX.plural(n, f) : f[2]);
  const F_MSG = ['сообщение', 'сообщения', 'сообщений'];
  const F_ERR = ['ошибка', 'ошибки', 'ошибок'];

  const LANGS = { ru: 'Русский', kk: 'Казахский', mix: 'Смешанный RU+KZ', translit: 'Транслит (латиница)' };
  const SETS = { train: 'Основной корпус', holdout: 'Holdout другого стиля', all: 'Весь корпус' };

  const S = {
    set: 'train',
    thr: 55,
    useStop: false,
    errFilter: 'errors',
    baseRate: 0.01,
    rows: [],
    runMs: 0,
  };

  function fail(msg) {
    const box = $('#benchRoot');
    if (box) box.innerHTML = '<div class="notice warn">' + esc(msg) + '</div>';
  }

  /* ---------------- параметры из адреса: ?set=holdout&thr=40 ---------------- */
  function readParams() {
    const p = NX && NX.params;
    if (!p) return;
    const set = p.get('set');
    if (set && SETS[set]) S.set = set;
    const thr = Number(p.get('thr'));
    if (thr >= 1 && thr <= 99) S.thr = Math.round(thr);
    if (p.get('stoplist') === '1') S.useStop = true;
  }

  function items() {
    if (S.set === 'holdout') return C.holdout.slice();
    if (S.set === 'all') return C.train.concat(C.holdout);
    return C.train.slice();
  }

  /* ---------------- прогон модели ---------------- */
  // Без стоп-листа (по умолчанию) — оцениваем только текстовую модель: подменяем NX.iocHits на время прогона,
  // чтобы реквизиты, оставшиеся в этом браузере после демо, не влияли на результат.
  function withStopList(fn) {
    const orig = NX.iocHits;
    if (!S.useStop) NX.iocHits = function () { return []; };
    try { return fn(); } finally { NX.iocHits = orig; }
  }
  function run() {
    const list = items();
    const now = () => (window.performance && performance.now ? performance.now() : Date.now());
    const t0 = now();
    S.rows = withStopList(() => list.map((it) => {
      const a = now();
      let r;
      try { r = NX.scanText(it.t); } catch (e) { console.error(e); r = { score: 0, level: 'low', reasons: [], error: true }; }
      return { it, score: Number(r.score) || 0, level: r.level, reasons: r.reasons || [], benignOtp: !!r.benignOtp, ms: now() - a, error: !!r.error };
    }));
    S.runMs = now() - t0;
    render();
  }

  /* ---------------- метрики ---------------- */
  function confusion(rows, thr) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    rows.forEach((r) => {
      const pred = r.score >= thr;
      if (r.it.y === 1) { if (pred) tp++; else fn++; }
      else if (pred) fp++; else tn++;
    });
    return { tp, fp, fn, tn };
  }
  const ratio = (a, b) => (b > 0 ? a / b : NaN);
  function metrics(c) {
    const precision = ratio(c.tp, c.tp + c.fp);
    const recall = ratio(c.tp, c.tp + c.fn);
    const fpr = ratio(c.fp, c.fp + c.tn);
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : NaN;
    const acc = ratio(c.tp + c.tn, c.tp + c.tn + c.fp + c.fn);
    return { precision, recall, fpr, f1, acc };
  }
  // 95% доверительный интервал Уилсона для доли k из n
  function wilson(k, n) {
    if (!n) return [NaN, NaN];
    const z = 1.96, p = k / n, z2 = z * z;
    const den = 1 + z2 / n;
    const mid = (p + z2 / (2 * n)) / den;
    const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
    return [Math.max(0, mid - half), Math.min(1, mid + half)];
  }
  // ROC-AUC через статистику Манна — Уитни (ничьи считаются за 0,5)
  function rocAuc(rows) {
    const pos = rows.filter((r) => r.it.y === 1).map((r) => r.score);
    const neg = rows.filter((r) => r.it.y === 0).map((r) => r.score);
    if (!pos.length || !neg.length) return NaN;
    let s = 0;
    pos.forEach((p) => neg.forEach((n) => { s += p > n ? 1 : p === n ? 0.5 : 0; }));
    return s / (pos.length * neg.length);
  }
  // PR-кривая по всем порогам 0…101 и average precision (площадь под ступенчатой PR-кривой)
  function prCurve(rows) {
    const P = rows.filter((r) => r.it.y === 1).length;
    const pts = [];
    let ap = 0, prevR = 0;
    for (let t = 101; t >= 0; t--) {
      const c = confusion(rows, t);
      const rec = P ? c.tp / P : 0;
      const pre = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 1;
      if (c.tp + c.fp > 0) { ap += (rec - prevR) * pre; prevR = rec; }
      pts.push({ t, recall: rec, precision: pre, has: c.tp + c.fp > 0 });
    }
    return { pts, ap: P ? ap : NaN };
  }

  /* ---------------- форматирование ---------------- */
  const pct = (x, d) => (isFinite(x) ? (x * 100).toFixed(d == null ? 1 : d).replace('.', ',') + '%' : '—');
  const dec = (x, d) => (isFinite(x) ? x.toFixed(d == null ? 2 : d).replace('.', ',') : '—');
  const ci = (k, n) => { const w = wilson(k, n); return isFinite(w[0]) ? '95% ДИ ' + pct(w[0], 0) + '–' + pct(w[1], 0) : 'нет данных'; };

  /* ---------------- рендер ---------------- */
  function render() {
    const rows = S.rows;
    const c = confusion(rows, S.thr);
    const m = metrics(c);
    const P = c.tp + c.fn, N = c.fp + c.tn;
    const auc = rocAuc(rows);
    const pr = prCurve(rows);

    $('#thrVal').textContent = String(S.thr);
    $('#thrSlider').value = String(S.thr);
    document.querySelectorAll('[data-set]').forEach((b) => { const on = b.dataset.set === S.set; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $('#useStop').checked = S.useStop;

    const nMsg = rows.length;
    const langs = {};
    rows.forEach((r) => { langs[r.it.lang] = (langs[r.it.lang] || 0) + 1; });
    const kz = (langs.kk || 0) + (langs.mix || 0);
    $('#runInfo').innerHTML =
      esc(SETS[S.set]) + ': <b>' + nMsg + '</b> ' + plural(nMsg, F_MSG) + ' (мошеннических ' + P + ', легитимных ' + N + '; на казахском и смешанных ' + kz + '). ' +
      'Прогон NX.scanText в этом браузере: ' + dec(S.runMs, 0) + ' мс, в среднем ' + dec(nMsg ? S.runMs / nMsg : NaN, 2) + ' мс на сообщение. ' +
      (S.useStop ? 'Стоп-лист этого браузера <b>учитывается</b>.' : 'Стоп-лист не учитывается — оценивается только текстовая модель.') +
      ' Версия корпуса ' + esc(C.version || '—') + '.';

    // KPI
    $('#kPrecision').textContent = pct(m.precision);
    $('#kPrecisionCi').textContent = ci(c.tp, c.tp + c.fp);
    $('#kRecall').textContent = pct(m.recall);
    $('#kRecallCi').textContent = ci(c.tp, P);
    $('#kFpr').textContent = pct(m.fpr);
    $('#kFprCi').textContent = ci(c.fp, N);
    $('#kF1').textContent = dec(m.f1);
    $('#kAuc').textContent = 'ROC-AUC ' + dec(auc) + ' · PR-AUC ' + dec(pr.ap);

    // confusion matrix
    $('#cmTP').textContent = c.tp; $('#cmFN').textContent = c.fn;
    $('#cmFP').textContent = c.fp; $('#cmTN').textContent = c.tn;
    $('#cmThr').textContent = String(S.thr);
    $('#cmNote').textContent = 'Тревога — индекс риска ≥ ' + S.thr + '. Точность (accuracy) ' + pct(m.acc) + ' — на сбалансированном корпусе она мало что говорит, смотрите FPR и recall.';

    renderOps();
    renderBaseRate(m, c);
    renderBreakdown();
    renderErrors();
    drawPR(pr);
    drawHist();
    try { renderCalls(); } catch (e) { console.error(e); }
    renderStage();
  }

  // Две рабочие точки продукта: 25 — «подозрительно» (предупреждение), 55 — «высокий индекс риска»
  function renderOps() {
    const box = $('#opsTable');
    if (!box) return;
    const ops = [
      { thr: 25, name: 'Предупреждение («подозрительное сообщение»)' },
      { thr: 55, name: 'Тревога («высокий индекс риска»)' },
    ];
    if (ops.every((o) => o.thr !== S.thr)) ops.push({ thr: S.thr, name: 'Текущий порог на ползунке' });
    box.innerHTML = '<table class="table"><thead><tr><th>Рабочая точка</th><th class="num">Порог</th><th class="num">Recall</th><th class="num">FPR</th><th class="num">Precision</th></tr></thead><tbody>' +
      ops.map((o) => {
        const c = confusion(S.rows, o.thr), m = metrics(c);
        return '<tr' + (o.thr === S.thr ? ' class="cur"' : '') + '><td>' + esc(o.name) + '</td><td class="mono num">≥ ' + o.thr + '</td><td class="num">' + pct(m.recall) +
          ' <span class="muted">(' + c.tp + '/' + (c.tp + c.fn) + ')</span></td><td class="num">' + pct(m.fpr) + ' <span class="muted">(' + c.fp + '/' + (c.fp + c.tn) + ')</span></td><td class="num">' + pct(m.precision) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderBaseRate(m, c) {
    const p = S.baseRate;
    const N = c.fp + c.tn;
    const adj = (rec, fpr) => (rec * p + fpr * (1 - p) > 0 ? (rec * p) / (rec * p + fpr * (1 - p)) : NaN);
    const point = adj(m.recall, m.fpr);
    const fprHi = wilson(c.fp, N)[1];
    const cons = adj(wilson(c.tp, c.tp + c.fn)[0], fprHi);
    const per1000 = isFinite(m.fpr) ? m.fpr * 1000 : NaN;
    $('#brOut').innerHTML =
      '<div class="br-row"><span>Точечная оценка</span><b>' + pct(point) + '</b></div>' +
      '<div class="br-row"><span>Осторожная оценка (нижняя граница recall, верхняя граница FPR)</span><b>' + pct(cons) + '</b></div>' +
      '<p class="small muted mt-s">При FPR ' + pct(m.fpr) + ' на каждую 1000 легитимных сообщений приходится примерно ' + dec(per1000, 1) +
      ' ложных тревог. В реальном потоке банка мошеннических сообщений намного меньше, чем в корпусе (здесь около ' + pct((c.tp + c.fn) / Math.max(1, c.tp + c.fn + N), 0) +
      '), поэтому precision на проде будет ниже. Это главный аргумент за shadow-режим и калибровку до включения удержаний.</p>';
  }

  function groupStats(key, labelFn) {
    const g = {};
    S.rows.forEach((r) => {
      const k = r.it[key] || '—';
      const x = g[k] || (g[k] = { k, pos: 0, tp: 0, neg: 0, fp: 0 });
      const pred = r.score >= S.thr;
      if (r.it.y === 1) { x.pos++; if (pred) x.tp++; } else { x.neg++; if (pred) x.fp++; }
    });
    return Object.keys(g).map((k) => Object.assign(g[k], { label: labelFn(k) }));
  }
  function bar(v, kind) {
    const w = isFinite(v) ? Math.round(v * 100) : 0;
    return '<div class="mbar"><i class="' + kind + '" style="width:' + w + '%"></i></div>';
  }
  function renderBreakdown() {
    const langs = groupStats('lang', (k) => LANGS[k] || k).sort((a, b) => b.pos + b.neg - (a.pos + a.neg));
    $('#byLang').innerHTML = '<table class="table"><thead><tr><th>Язык</th><th class="num">Recall</th><th></th><th class="num">FPR</th><th></th></tr></thead><tbody>' +
      langs.map((x) => {
        const rec = ratio(x.tp, x.pos), fpr = ratio(x.fp, x.neg);
        return '<tr><td>' + esc(x.label) + '</td>' +
          '<td class="num">' + (x.pos ? pct(rec, 0) + ' <span class="muted">(' + x.tp + ' из ' + x.pos + ')</span>' : '<span class="muted">—</span>') + '</td><td class="wbar">' + (x.pos ? bar(rec, 'ok') : '') + '</td>' +
          '<td class="num">' + (x.neg ? pct(fpr, 0) + ' <span class="muted">(' + x.fp + ' из ' + x.neg + ')</span>' : '<span class="muted">—</span>') + '</td><td class="wbar">' + (x.neg ? bar(fpr, 'bad') : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    const withPos = langs.filter((x) => x.pos > 0);
    const worst = withPos.slice().sort((a, b) => ratio(a.tp, a.pos) - ratio(b.tp, b.pos))[0];
    const best = withPos.slice().sort((a, b) => ratio(b.tp, b.pos) - ratio(a.tp, a.pos))[0];
    const hint = $('#langHint');
    if (hint) hint.textContent = worst && best && worst !== best ? 'слабее всего — ' + worst.label + ' (' + pct(ratio(worst.tp, worst.pos), 0) + ')' : 'recall и FPR по языкам';

    const sch = (k) => (C.schemes && C.schemes[k]) || k;
    const scam = groupStats('scheme', sch).filter((x) => x.pos > 0).sort((a, b) => ratio(a.tp, a.pos) - ratio(b.tp, b.pos) || b.pos - a.pos);
    const legit = groupStats('scheme', sch).filter((x) => x.neg > 0).sort((a, b) => ratio(b.fp, b.neg) - ratio(a.fp, a.neg) || b.neg - a.neg);
    $('#byScheme').innerHTML =
      '<div class="small muted mb-s">Мошеннические схемы — доля распознанных (recall), от худшей к лучшей</div>' +
      scam.map((x) => '<div class="srow"><span class="sl">' + esc(x.label) + '</span>' + bar(ratio(x.tp, x.pos), 'ok') + '<span class="sv">' + x.tp + '/' + x.pos + '</span></div>').join('') +
      '<div class="small muted mb-s mt">Легитимные сообщения — доля ложных тревог</div>' +
      legit.map((x) => '<div class="srow"><span class="sl">' + esc(x.label) + '</span>' + bar(ratio(x.fp, x.neg), 'bad') + '<span class="sv">' + x.fp + '/' + x.neg + '</span></div>').join('');
  }

  function renderErrors() {
    const f = S.errFilter;
    document.querySelectorAll('[data-err]').forEach((b) => { const on = b.dataset.err === f; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const rows = S.rows.filter((r) => {
      const pred = r.score >= S.thr;
      const err = pred !== (r.it.y === 1);
      if (f === 'fn') return r.it.y === 1 && !pred;
      if (f === 'fp') return r.it.y === 0 && pred;
      if (f === 'all') return true;
      return err;
    }).sort((a, b) => (f === 'fp' ? b.score - a.score : f === 'fn' ? a.score - b.score : Math.abs(a.score - S.thr) - Math.abs(b.score - S.thr)));
    const nErr = S.rows.filter((r) => (r.score >= S.thr) !== (r.it.y === 1)).length;
    $('#errCount').textContent = nErr + ' ' + plural(nErr, F_ERR) + ' при пороге ' + S.thr;
    if (!rows.length) {
      $('#errList').innerHTML = '<div class="empty">' + (f === 'all' ? 'Корпус пуст' : 'Нет ошибок этого типа при текущем пороге') + '</div>';
      return;
    }
    const sch = (k) => (C.schemes && C.schemes[k]) || k;
    $('#errList').innerHTML = rows.map((r) => {
      const pred = r.score >= S.thr;
      const ok = pred === (r.it.y === 1);
      const tag = ok ? (r.it.y === 1 ? '<span class="badge ok">верно: тревога</span>' : '<span class="badge ok">верно: пропущено</span>')
        : r.it.y === 1 ? '<span class="badge high">пропуск мошенничества</span>' : '<span class="badge med">ложная тревога</span>';
      const rs = r.reasons.filter((x) => x.w > 0 || x.good).slice(0, 3).map((x) =>
        '<li><span class="w">' + (x.good ? 'OTP' : '+' + esc(x.w)) + '</span>' + esc(x.why) + (x.match ? ' <span class="muted">«' + esc(x.match) + '»</span>' : '') + '</li>').join('');
      return '<div class="err ' + (ok ? '' : r.it.y === 1 ? 'fn' : 'fp') + '">' +
        '<div class="err-h"><span class="tag">' + esc(r.it.id || '') + '</span>' + tag +
        '<span class="badge plain info">' + esc(sch(r.it.scheme)) + '</span><span class="badge plain">' + esc(LANGS[r.it.lang] || r.it.lang) + '</span>' +
        '<span class="err-score" style="color:' + (NX.riskColor ? NX.riskColor(r.score) : 'inherit') + '">индекс ' + r.score + '</span></div>' +
        '<div class="err-t">' + esc(r.it.t) + '</div>' +
        (rs ? '<ul class="err-r">' + rs + '</ul>' : '<div class="small muted">Ни одно правило не сработало.</div>') +
        '</div>';
    }).join('');
  }

  /* ---------------- canvas ---------------- */
  function cssVar(name, fb) {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; } catch (e) { return fb; }
  }
  function prep(cv, h) {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.max(240, cv.clientWidth || cv.parentNode.clientWidth || 400);
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function axes(ctx, x0, y0, x1, y1, xl, yl) {
    const line = cssVar('--line', 'rgba(148, 170, 220, 0.12)');
    const muted = cssVar('--muted', '#95A1BE');
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.font = '500 11px ' + cssVar('--font', 'system-ui');
    ctx.fillStyle = muted;
    for (let i = 0; i <= 4; i++) {
      const gy = y1 + ((y0 - y1) * i) / 4;
      ctx.globalAlpha = i === 0 ? 1 : 0.8;
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(xl, (x0 + x1) / 2, y0 + 30);
    ctx.save(); ctx.translate(x0 - 34, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yl, 0, 0); ctx.restore();
  }

  // столбик со скруглёнными верхними углами (без ctx.roundRect — он есть не во всех браузерах)
  function bar2(ctx, x, y, w, h, r) {
    if (h <= 0 || w <= 0) return;
    const rr = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  }
  function alpha(hex, a) {
    const s = String(hex).trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(s);
    if (!m) {
      const r = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
      return r ? 'rgba(' + r[1] + ',' + r[2] + ',' + r[3] + ',' + a + ')' : hex;
    }
    const n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function drawPR(pr) {
    const cv = $('#prCanvas');
    if (!cv || !cv.getContext) return;
    const g = prep(cv, 280);
    const ctx = g.ctx;
    const L = 46, R = 14, T = 14, B = 40;
    const x0 = L, x1 = g.w - R, y0 = g.h - B, y1 = T;
    const X = (r) => x0 + r * (x1 - x0);
    const Y = (p) => y0 - p * (y0 - y1);
    axes(ctx, x0, y0, x1, y1, 'Recall (доля пойманного мошенничества)', 'Precision');
    const muted = cssVar('--muted', '#95A1BE');
    ctx.fillStyle = muted; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) ctx.fillText((i * 25) + '%', x0 - 6, Y(i / 4) + 4);
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) ctx.fillText((i * 25) + '%', X(i / 4), y0 + 15);

    // базовая линия: доля мошенничества в корпусе
    const P = S.rows.filter((r) => r.it.y === 1).length;
    const base = S.rows.length ? P / S.rows.length : 0;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = cssVar('--muted2', '#7A87A8'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, Y(base)); ctx.lineTo(x1, Y(base)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.fillText('случайный классификатор', x0 + 6, Y(base) - 5);

    // ступенчатая кривая с мягкой заливкой
    const pts = pr.pts.filter((p) => p.has);
    const acc = cssVar('--accent', '#6366F1');
    const path = [];
    let lastR = 0;
    pts.forEach((p, i) => {
      if (i === 0) { path.push([X(0), Y(p.precision)], [X(p.recall), Y(p.precision)]); }
      else { path.push([X(lastR), Y(p.precision)], [X(p.recall), Y(p.precision)]); }
      lastR = p.recall;
    });
    if (path.length) {
      const grad = ctx.createLinearGradient(0, y1, 0, y0);
      grad.addColorStop(0, alpha(acc, 0.18)); grad.addColorStop(1, alpha(acc, 0.02));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(path[0][0], y0);
      path.forEach((q) => ctx.lineTo(q[0], q[1]));
      ctx.lineTo(path[path.length - 1][0], y0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = acc; ctx.lineWidth = 2.25; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(path[0][0], path[0][1]);
      path.forEach((q) => ctx.lineTo(q[0], q[1]));
      ctx.stroke();
    }

    // точка текущего порога
    const cur = pr.pts.find((p) => p.t === S.thr);
    // текстовая альтернатива: precision и recall на нескольких порогах
    const ps = $('#prSummary');
    if (ps) {
      const pick = pr.pts.filter((p) => p.has && (p.t % 20 === 0 || p.t === S.thr));
      ps.textContent = 'PR-кривая. ' + pick.map((p) => 'порог ' + p.t + (p.t === S.thr ? ' (текущий)' : '') + ': precision ' + Math.round(p.precision * 100) + '%, recall ' + Math.round(p.recall * 100) + '%').join('; ') + '.';
    }
    if (cur && cur.has) {
      const danger = cssVar('--danger', '#FF5470');
      const tx = X(cur.recall), ty = Y(cur.precision);
      ctx.fillStyle = alpha(danger, 0.16);
      ctx.beginPath(); ctx.arc(tx, ty, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = danger; ctx.strokeStyle = cssVar('--panel', '#0E1424'); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = cssVar('--text', '#E8ECF7');
      ctx.font = '600 12px ' + cssVar('--font', 'system-ui');
      ctx.textAlign = tx > (x0 + x1) / 2 ? 'right' : 'left';
      ctx.fillText('порог ' + S.thr, tx + (ctx.textAlign === 'right' ? -14 : 14), ty + (ty < y1 + 20 ? 18 : -10));
    }
  }

  function drawHist() {
    const cv = $('#histCanvas');
    if (!cv || !cv.getContext) return;
    const g = prep(cv, 220);
    const ctx = g.ctx;
    const L = 46, R = 14, T = 14, B = 40;
    const x0 = L, x1 = g.w - R, y0 = g.h - B, y1 = T;
    const bins = 10;
    const pos = new Array(bins).fill(0), neg = new Array(bins).fill(0);
    S.rows.forEach((r) => { const b = Math.min(bins - 1, Math.floor(r.score / 10)); if (r.it.y === 1) pos[b]++; else neg[b]++; });
    const max = Math.max(1, Math.max.apply(null, pos.concat(neg)));
    // текстовая альтернатива для экранных дикторов: число сообщений по интервалам индекса
    const hs = $('#histSummary');
    if (hs) hs.textContent = 'Распределение индекса риска по интервалам (легитимные / мошеннические): ' + pos.map((p, b) => (b * 10) + '–' + (b === bins - 1 ? 100 : b * 10 + 9) + ': ' + neg[b] + ' / ' + p).join('; ') + '.';
    axes(ctx, x0, y0, x1, y1, 'Индекс риска 0–100', 'Сообщений');
    const muted = cssVar('--muted', '#95A1BE');
    ctx.fillStyle = muted; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) ctx.fillText(String(Math.round((max * i) / 4)), x0 - 6, y0 - ((y0 - y1) * i) / 4 + 4);
    const bw = (x1 - x0) / bins;
    const danger = cssVar('--danger', '#FF5470'), blue = cssVar('--accent3', '#22D3EE');
    for (let b = 0; b < bins; b++) {
      const bx = x0 + b * bw;
      const half = Math.max(2, bw / 2 - 3);
      const hp = ((y0 - y1) * pos[b]) / max, hn = ((y0 - y1) * neg[b]) / max;
      ctx.fillStyle = blue; bar2(ctx, bx + 2, y0 - hn, half, hn, 4);
      ctx.fillStyle = danger; bar2(ctx, bx + 2 + half + 2, y0 - hp, half, hp, 4);
      ctx.fillStyle = muted; ctx.textAlign = 'center';
      ctx.fillText(String(b * 10), bx, y0 + 15);
    }
    ctx.fillText('100', x1, y0 + 15);
    // линия порога
    const tx = x0 + (S.thr / 100) * (x1 - x0);
    ctx.strokeStyle = cssVar('--warn', '#FFB020'); ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(tx, y1); ctx.lineTo(tx, y0); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = cssVar('--warn-ink', '#FFC861'); ctx.font = '600 11px ' + cssVar('--font', 'system-ui');
    ctx.textAlign = tx > (x0 + x1) / 2 ? 'right' : 'left';
    ctx.fillText('порог ' + S.thr, tx + (ctx.textAlign === 'right' ? -6 : 6), y1 + 10);
  }
  /* ---------------- своё сообщение ---------------- */
  function tryOwn() {
    const ta = $('#ownText');
    const out = $('#ownOut');
    const t = String(ta.value || '').trim();
    if (!t) { out.innerHTML = '<div class="small muted">Вставьте текст SMS или фразу из звонка.</div>'; return; }
    const r = withStopList(() => NX.scanText(t));
    const rs = (r.reasons || []).filter((x) => x.w > 0 || x.good).slice(0, 6).map((x) =>
      '<li><span class="w">' + (x.good ? 'OTP' : '+' + esc(x.w)) + '</span>' + esc(x.why) + '</li>').join('');
    out.innerHTML = '<div class="row gap-s wrap"><b style="font-size:22px;color:' + NX.riskColor(r.score) + '">' + r.score + '</b><span>индекс риска · ' + esc(r.verdict) + '</span>' +
      '<span class="badge ' + (r.score >= S.thr ? 'high' : 'ok') + '">' + (r.score >= S.thr ? 'тревога при пороге ' + S.thr : 'ниже порога ' + S.thr) + '</span></div>' +
      (rs ? '<ul class="err-r mt-s">' + rs + '</ul>' : '<div class="small muted mt-s">Ни одно правило не сработало.</div>');
  }

  /* =====================================================================
     ЗВОНКИ: время до обнаружения и тип атаки (NX_CALLS × NX.scanText × NX.Manip)
     Правило тревоги — как в Защите звонка: после каждой реплики звонящего
     пересчитывается индекс NX.scanText по всему сказанному (порог — ползунок),
     а детектор манипуляций NX.Manip поднимает тревогу по собственному правилу
     (alertLine / timeline); тревога — первая реплика, где сработал любой.
     ===================================================================== */
  const CALL_LANGS = { ru: 'Русский', kk: 'Казахский', kz: 'Казахский', mix: 'Смешанный RU+KZ', translit: 'Транслит' };
  const F_CALL = ['звонок', 'звонка', 'звонков'];
  const F_LINE = ['реплика', 'реплики', 'реплик'];
  const hasManip = () => !!(NX && NX.Manip && typeof NX.Manip.analyze === 'function');
  const lineText = (l) => (typeof l === 'string' ? l : (l && (l.text || l.t || l.say)) || '');
  // реплика клиента (если сценарий хранит обе стороны) в анализ не идёт, но нумерация общая
  const isCaller = (l) => {
    if (!l || typeof l === 'string') return true;
    const w = String(l.who || l.role || l.speaker || '').toLowerCase();
    return !/^(c|client|victim|me|user|клиент)$/.test(w);
  };
  function tplLabel(id) {
    if (!id) return '—';
    const T = NX && NX.Manip && NX.Manip.TEMPLATES;
    let t = null;
    if (Array.isArray(T)) t = T.find((x) => x && x.id === id);
    else if (T && typeof T === 'object') t = T[id];
    return (t && (t.label || t.name || t.ru)) || String(id);
  }
  // opts.verified — прогон «с отметкой»: в приложении активна отметка «звонит банк» (как в Защите звонка):
  // тревога любого движка засчитывается только с реплики, где прозвучала просьба кода, доступа или перевода
  function evalCall(call, thr, opts) {
    const verified = !!(opts && opts.verified);
    const lines = Array.isArray(call && call.lines) ? call.lines : [];
    const said = [], idx = [], coreScores = [];
    let coreAt = null, manipAt = null, last = null, stagesAtAlert = null, maxCore = 0, maxManip = 0;
    const orig = NX.iocHits;
    NX.iocHits = function () { return []; }; // оцениваем только текст, без стоп-листа этого браузера
    try {
      // NX.scanText — по накопленному тексту звонящего, порог — ползунок
      lines.forEach((l, i) => {
        if (!isCaller(l)) return;
        const t = lineText(l).trim();
        if (!t) return;
        said.push(t); idx.push(i);
        let cs = 0;
        try { cs = Number(NX.scanText(said.join('. ')).score) || 0; } catch (e) { cs = 0; }
        maxCore = Math.max(maxCore, cs);
        coreScores.push(cs);
        if (!verified && coreAt == null && cs >= thr) coreAt = i;
      });
    } finally { NX.iocHits = orig; }
    // NX.Manip — один проход: собственное правило тревоги детектора и timeline по репликам
    if (hasManip() && said.length) {
      try { last = NX.Manip.analyze(said.slice(), verified ? { verified: true } : undefined); } catch (e) { last = null; }
      const tl = last && Array.isArray(last.timeline) ? last.timeline : [];
      if (verified) { for (let k = 0; k < coreScores.length; k++) if (coreScores[k] >= thr && tl[k] && tl[k].critical) { coreAt = idx[k]; break; } }
      tl.forEach((p) => { maxManip = Math.max(maxManip, Number(p.riskIndex) || 0); });
      const k = last && Number.isInteger(last.alertLine) ? last.alertLine : null;
      if (k != null && idx[k] != null) { manipAt = idx[k]; stagesAtAlert = tl[k] && Array.isArray(tl[k].stages) ? tl[k].stages.length : null; }
      if (!tl.length && last) maxManip = Number(last.riskIndex) || 0;
    }
    const alerts = [coreAt, manipAt].filter((x) => x != null);
    const alertAt = alerts.length ? Math.min.apply(null, alerts) : null;
    const by = alertAt == null ? null : coreAt === alertAt && manipAt === alertAt ? 'both' : coreAt === alertAt ? 'core' : 'manip';
    const code = Number.isInteger(call && call.codeLine) ? call.codeLine : null;
    const lead = alertAt != null && code != null ? code - alertAt : null;
    const timing = alertAt == null ? 'miss' : code == null ? 'nocode' : lead > 0 ? 'before' : lead === 0 ? 'same' : 'after';
    const scam = Number(call && call.label) === 1;
    const pred = last && last.attackType ? last.attackType : null;
    const typeOk = scam && hasManip() ? !!(pred && pred.id && pred.id === call.template) : null;
    return { call, scam, coreAt, manipAt, alertAt, by, code, lead, timing, final: last, pred, typeOk, stagesAtAlert, maxCore, maxManip, n: lines.length };
  }
  function evalCalls(calls, thr, opts) { return (Array.isArray(calls) ? calls : []).map((c) => evalCall(c, thr == null ? 55 : thr, opts)); }
  /* «Звонит настоящий банк»: честные звонки банка (verified:true в корпусе) без отметки и с отметкой,
     плюс проверка, что отметка не глушит просьбу кода — мошеннические звонки с поддельной отметкой */
  function verifiedSummary(calls, thr) {
    const list = Array.isArray(calls) ? calls : [];
    const bank = list.filter((c) => Number(c && c.label) === 0 && c.verified === true);
    const scamCode = list.filter((c) => Number(c && c.label) === 1 && Number.isInteger(c.codeLine));
    const off = evalCalls(bank, thr), on = evalCalls(bank, thr, { verified: true });
    const spoof = evalCalls(scamCode, thr, { verified: true });
    return {
      n: bank.length,
      without: off.filter((r) => r.alertAt != null).length,
      with: on.filter((r) => r.alertAt != null).length,
      scamN: scamCode.length,
      // при отметке тревога должна быть не позже реплики с просьбой кода/перевода
      scamAlertByCode: spoof.filter((r) => r.alertAt != null && r.alertAt <= r.code).length,
      rowsOff: off, rowsOn: on,
    };
  }
  const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  function callSummary(rows) {
    const scam = rows.filter((r) => r.scam), honest = rows.filter((r) => !r.scam);
    const withCode = scam.filter((r) => r.code != null);
    const before = withCode.filter((r) => r.timing === 'before');
    const alerted = scam.filter((r) => r.alertAt != null);
    const leads = withCode.filter((r) => r.lead != null).map((r) => r.lead);
    const typed = scam.filter((r) => r.typeOk != null);
    return {
      total: rows.length, scam: scam.length, honest: honest.length,
      withCode: withCode.length, before: before.length,
      alerted: alerted.length,
      alertLineMedian: median(alerted.map((r) => r.alertAt + 1)),
      leadMean: mean(leads), leadMedian: median(leads),
      falseAlerts: honest.filter((r) => r.alertAt != null).length,
      typeOk: typed.filter((r) => r.typeOk).length, typed: typed.length,
    };
  }

  const nOr = (x, d) => (isFinite(x) ? dec(x, d == null ? 1 : d) : '—');
  function renderCalls() {
    const box = $('#callsRoot');
    if (!box) return;
    const calls = window.NX_CALLS;
    if (!Array.isArray(calls) || !calls.length) {
      box.innerHTML = '<div class="notice warn">Набор звонков <span class="mono">window.NX_CALLS</span> (assets/data/call-scenarios.js) не загрузился — время до обнаружения посчитать не из чего.</div>';
      return;
    }
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    const rows = evalCalls(calls, S.thr);
    const ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    const s = callSummary(rows);
    S.calls = rows;
    const manipNote = hasManip() ? '' : '<div class="notice warn mt-s">Детектор манипуляций <span class="mono">NX.Manip</span> не загрузился: тревога считается только по NX.scanText, тип атаки не определяется.</div>';
    const kpi = (label, value, sub) => '<div class="card kpi"><div class="label">' + esc(label) + '</div><div class="value">' + value + '</div><div class="ci">' + sub + '</div></div>';
    const html = [];
    html.push('<p class="small muted">' + esc(calls.length + ' ' + plural(calls.length, F_CALL)) + ' (мошеннических ' + s.scam + ', честных ' + s.honest + '). Тревога — первая реплика, на которой сработал любой из движков: <span class="mono">NX.scanText</span> с порогом ползунка (сейчас <b>' + S.thr + '</b>) или детектор манипуляций по собственному правилу (индекс риска ≥ 50 или связка критических стадий). Реплики звонящего пронумерованы с 1. Прогон в этом браузере: ' + dec(ms, 0) + ' мс.</p>' + manipNote);
    html.push('<div class="kpis mt">' +
      kpi('Тревога до просьбы кода', s.withCode ? s.before + ' из ' + s.withCode : '—', s.withCode ? pct(s.before / s.withCode, 0) + ' мошеннических звонков с просьбой кода или перевода' : 'нет звонков с отмеченной просьбой') +
      kpi('Запас до просьбы кода', nOr(s.leadMean) + ' <small style="font-size:max(12px,.5em)">' + esc(plural(Math.round(s.leadMean) || 0, F_LINE)) + '</small>', 'в среднем · медиана ' + nOr(s.leadMedian, 0) + ' · отрицательный — тревога после просьбы') +
      kpi('Реплика тревоги', isFinite(s.alertLineMedian) ? '№ ' + dec(s.alertLineMedian, 0) : '—', 'медиана по ' + s.alerted + ' из ' + s.scam + ' мошеннических звонков с тревогой') +
      kpi('Тип атаки определён верно', s.typed ? s.typeOk + ' из ' + s.typed : '—', s.typed ? pct(s.typeOk / s.typed, 0) + ' · NX.Manip по всему звонку' : 'детектор манипуляций не загружен') +
      '</div>');
    html.push('<div class="row wrap gap-s mt-s"><span class="badge ' + (s.falseAlerts ? 'warn' : 'ok') + '">ложные тревоги на честных звонках: ' + s.falseAlerts + ' из ' + s.honest + '</span>' +
      '<span class="badge plain">пропущено мошеннических: ' + (s.scam - s.alerted) + ' из ' + s.scam + '</span></div>');
    const vs = hasManip() ? verifiedSummary(calls, S.thr) : null;
    if (vs && vs.n) {
      html.push('<div class="row wrap gap-s mt-s" id="verifiedRow"><span class="badge ' + (vs.with ? 'warn' : 'ok') + '" style="white-space:normal;max-width:100%;height:auto">' + esc('ложные тревоги на честных звонках банка: без отметки ' + vs.without + ' из ' + vs.n + ' / с отметкой ' + vs.with + ' из ' + vs.n) + '</span>' +
        (vs.scamN ? '<span class="badge plain" style="white-space:normal;max-width:100%;height:auto">' + esc('мошенник с отметкой «звонит банк»: тревога не позже просьбы кода или перевода — ' + vs.scamAlertByCode + ' из ' + vs.scamN) + '</span>' : '') + '</div>' +
        '<p class="tiny muted mt-s">' + esc('«Звонит настоящий банк» — симуляция: в продукте отметка приходит с сервера банка в приложение, номер звонящего не учитывается. При отметке тревога поднимается только на просьбе кода, доступа или перевода. Разметку verified ставила команда — это проверка логики, не качества. Считается вживую в этом браузере.') + '</p>');
    }

    // RU / KZ
    const groups = {};
    rows.forEach((r) => { const k = r.call.lang || '—'; (groups[k] = groups[k] || []).push(r); });
    html.push('<h4 class="mt">Русский и казахский отдельно</h4><div class="table-wrap"><table class="table"><thead><tr><th>Язык</th><th class="num">Звонков</th><th class="num">Тревога до кода</th><th class="num">Средний запас</th><th class="num">Тип атаки верно</th><th class="num">Ложные тревоги</th></tr></thead><tbody>' +
      Object.keys(groups).sort().map((k) => {
        const g = callSummary(groups[k]);
        return '<tr><td>' + esc(CALL_LANGS[k] || k) + '</td><td class="num">' + g.total + ' <span class="muted">(' + g.scam + ' / ' + g.honest + ')</span></td>' +
          '<td class="num">' + (g.withCode ? g.before + ' из ' + g.withCode + ' <span class="muted">(' + pct(g.before / g.withCode, 0) + ')</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + (isFinite(g.leadMean) ? nOr(g.leadMean) + ' ' + esc(plural(Math.round(Math.abs(g.leadMean)) || 0, F_LINE)) : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + (g.typed ? g.typeOk + ' из ' + g.typed : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + (g.honest ? g.falseAlerts + ' из ' + g.honest : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="small muted mt-s">В скобках — мошеннических / честных. Выборка маленькая: каждый звонок меняет долю на десятки процентов, это ориентир, а не оценка качества.</p>');

    // тип атаки по шаблонам
    const tpl = {};
    rows.filter((r) => r.scam).forEach((r) => { const k = r.call.template || '—'; const x = tpl[k] || (tpl[k] = { n: 0, ok: 0, wrong: {} }); x.n++; if (r.typeOk) x.ok++; else if (r.pred && r.pred.id) x.wrong[r.pred.label || r.pred.id] = 1; });
    if (hasManip()) {
      html.push('<h4 class="mt">Тип атаки по сценариям</h4><div>' + Object.keys(tpl).map((k) => {
        const x = tpl[k], wr = Object.keys(x.wrong);
        return '<div class="srow"><span class="sl" title="' + esc(tplLabel(k)) + '">' + esc(tplLabel(k)) + '</span>' + bar(x.ok / x.n, 'ok') + '<span class="sv">' + x.ok + '/' + x.n + '</span></div>' +
          (wr.length ? '<div class="tiny muted" style="margin:-2px 0 6px">ошибочно: ' + esc(wr.join(', ')) + '</div>' : '');
      }).join('') + '</div>');
    }

    // расшифровки
    const TIMING = { before: ['ok', 'тревога до просьбы'], same: ['warn', 'тревога на реплике с просьбой'], after: ['high', 'тревога после просьбы'], miss: ['high', 'без тревоги'], nocode: ['ok', 'тревога'] };
    html.push('<h4 class="mt">Звонки по репликам</h4><div class="calls">' + rows.map((r) => {
      const c = r.call;
      let badge;
      if (r.scam) { const t = TIMING[r.timing]; badge = '<span class="badge ' + t[0] + '">' + esc(t[1]) + '</span>'; }
      else badge = r.alertAt == null ? '<span class="badge ok">честный · без тревоги</span>' : '<span class="badge med">честный · ложная тревога</span>';
      const meta = [];
      if (r.alertAt != null) meta.push('тревога: № ' + (r.alertAt + 1) + ' (' + ({ core: 'NX.scanText', manip: 'NX.Manip', both: 'оба' })[r.by] + ')');
      if (r.code != null) meta.push('просьба: № ' + (r.code + 1));
      if (r.lead != null) meta.push('запас ' + r.lead + ' ' + plural(Math.abs(r.lead), F_LINE));
      const typeTxt = r.scam && r.typeOk != null
        ? (r.typeOk ? '<span class="badge plain ok">тип верно: ' + esc(r.pred.label || tplLabel(r.pred.id)) + '</span>' : '<span class="badge plain high">тип: ' + esc(r.pred ? (r.pred.label || r.pred.id) : 'не определён') + ' · ожидался ' + esc(tplLabel(c.template)) + '</span>')
        : '';
      const lines = (c.lines || []).map((l, i) => {
        const mk = [];
        if (i === r.alertAt) mk.push('<span class="badge high">тревога</span>');
        if (i === r.code) mk.push('<span class="badge warn">просьба кода / перевода</span>');
        return '<li class="' + (isCaller(l) ? 's' : 'c') + (i === r.alertAt ? ' al' : '') + '"><span class="no">' + (i + 1) + '</span><span class="tx">' + esc(lineText(l)) + (mk.length ? ' ' + mk.join(' ') : '') + '</span></li>';
      }).join('');
      return '<details class="callx" data-id="' + esc(c.id || '') + '"><summary><span class="tag">' + esc(c.id || '') + '</span><span class="badge plain">' + esc(CALL_LANGS[c.lang] || c.lang || '—') + '</span>' + badge + typeTxt +
        '<span class="cmeta">' + esc(meta.join(' · ') || 'индекс не достиг порога: максимум ' + Math.max(r.maxCore, r.maxManip)) + '</span></summary>' +
        '<div class="small muted" style="margin:8px 0 6px">' + esc(r.scam ? 'Сценарий: ' + tplLabel(c.template) : 'Честный звонок' + (c.title || c.name ? ': ' + (c.title || c.name) : '')) +
        (r.stagesAtAlert != null ? ' · стадий манипуляции к тревоге детектора: ' + r.stagesAtAlert : '') + '</div><ol class="clines">' + lines + '</ol></details>';
    }).join('') + '</div>');
    const open = Array.prototype.map.call(box.querySelectorAll('details[open]'), (d) => d.getAttribute('data-id'));
    setHtml(box, html.join(''));
    open.forEach((id) => { box.querySelectorAll('details.callx').forEach((d) => { if (d.getAttribute('data-id') === id) d.open = true; }); });
  }
  // не переписываем одинаковое содержимое (иначе сбрасываются раскрытые <details> и анимации)
  function setHtml(el, html) { if (el && el._nxHtml !== html) { el._nxHtml = html; el.innerHTML = html; } }

  /* ---------------- Transaction DNA: контрольные случаи ---------------- */
  function renderDna() {
    const box = $('#dnaRoot');
    if (!box) return;
    const D = NX && NX.DNA;
    if (!D || typeof D.assess !== 'function') { setHtml(box, '<div class="notice warn">Модуль <span class="mono">NX.DNA</span> (assets/js/dna.js) не загрузился.</div>'); return; }
    let prof = null;
    try { prof = typeof D.profile === 'function' ? D.profile() : null; } catch (e) { prof = null; }
    const typ = prof && prof.typical && prof.typical.median ? prof.typical.median : 15000;
    const p75 = prof && prof.typical && prof.typical.p75 ? prof.typical.p75 : typ;
    // сумма заведомо выше порога «необычной» в NX.DNA (больше max(2×p75, 3×медианы)), подпись — из фактического отношения к медиане
    const unusual = Math.ceil((Math.max(p75 * 2, typ * 3, 20000) * 1.25) / 1000) * 1000;
    const unusualX = String(Math.round((unusual / Math.max(typ, 1)) * 10) / 10).replace('.', ',');
    const cases = [
      { t: 'Обычный перевод знакомому днём', tx: { amount: Math.round(typ), newRecipient: false, hour: 13 }, ctx: {} },
      { t: 'Новый получатель, необычная сумма (≈' + unusualX + '× обычной)',tx: { amount: unusual, newRecipient: true, hour: 15 }, ctx: {} },
      { t: 'Крупная сумма новому получателю во время звонка', tx: { amount: 380000, newRecipient: true, hour: 14 }, ctx: { callActive: true } },
      { t: 'То же + сигнал мошенничества и попытка ослабить защиту', tx: { amount: 380000, newRecipient: true, hour: 23 }, ctx: { callActive: true, scamSignal: true, weakenAttempt: true } },
    ];
    const TIER = { normal: 'ok', check: 'warn', cooling: 'med', hold: 'high' };
    const rows = cases.map((c) => {
      let r = null;
      try { r = D.assess(c.tx, c.ctx); } catch (e) { r = null; }
      if (!r) return '<tr><td>' + esc(c.t) + '</td><td colspan="3" class="muted">ошибка расчёта</td></tr>';
      const f = (r.factors || []).map((x) => esc(x.label) + (x.points != null ? ' <span class="muted">+' + esc(x.points) + '</span>' : '')).join(', ');
      return '<tr><td>' + esc(c.t) + '<div class="tiny muted">' + esc(NX.fmt ? NX.fmt(c.tx.amount) : c.tx.amount) + ' · ' + esc(c.tx.hour) + ':00</div></td><td class="mono num">' + esc(r.index) + '</td><td><span class="badge ' + (TIER[r.tier] || 'plain') + '">' + esc(r.tierLabel || r.tier) + '</span></td><td class="small">' + (f || '<span class="muted">нет факторов</span>') + '</td></tr>';
    });
    setHtml(box, '<p class="small muted">Профиль: ' + esc((prof && prof.summary) || 'демо-клиент этого браузера') + '. Индекс — пересечение факторов (noisy-OR + бонус за сочетания), а не их сумма.</p>' +
      '<div class="table-wrap mt-s"><table class="table"><thead><tr><th>Случай</th><th class="num">Индекс</th><th>Уровень</th><th>Факторы</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>');
  }

  /* =====================================================================
     ЗАМЕРЫ ДЕМО (сцена): stage.js сохраняет живые замеры показа в localStorage
     ключ nexus_ai_stage_metrics_v1 (префикс nexus_ai_ → сбрасывается NX.resetAll)
     ===================================================================== */
  const STAGE_KEY = 'nexus_ai_stage_metrics_v1';
  function stageMetrics() {
    try { const raw = window.localStorage.getItem(STAGE_KEY); const m = raw ? JSON.parse(raw) : null; return m && typeof m === 'object' ? m : null; } catch (e) { return null; }
  }
  function renderStage() {
    const box = $('#stageRoot');
    if (!box) return;
    const m = stageMetrics();
    if (!m) {
      setHtml(box, '<div class="empty"><b>Замеров пока нет.</b> Они появятся после показа сцены в этом браузере: откройте <a href="stage.html">демо для жюри</a> и пройдите шаги 1–6 (или автопилот, клавиша A), затем вернитесь сюда — страница обновится сама.</div>');
      return;
    }
    const sec = (x) => (isFinite(Number(x)) ? dec(Number(x) / 1000, 1) + ' с' : null);
    const msx = (x) => (isFinite(Number(x)) ? Math.round(Number(x)) + ' мс' : null);
    const num = (x) => (x != null && isFinite(Number(x)) ? String(Math.round(Number(x))) : null);
    const items = [
      ['Время до тревоги в звонке', sec(m.alertMs), 'от начала демо-звонка до тревоги Защиты звонка'],
      ['Реплика тревоги', num(m.alertLine) ? '№ ' + num(m.alertLine) : null, m.codeLine != null ? 'просьба кода — на реплике № ' + num(m.codeLine) : 'номер реплики звонящего'],
      ['Запас до просьбы кода', num(m.leadLines) != null ? num(m.leadLines) + ' ' + plural(Math.abs(Number(m.leadLines)), F_LINE) : null, 'сколько реплик осталось до просьбы кода'],
      ['Стадий манипуляции до тревоги', num(m.manipStages) != null ? num(m.manipStages) + (num(m.manipOf) ? ' из ' + num(m.manipOf) : '') : null, m.attackType ? 'сценарий: ' + String(m.attackType) : 'детектор манипуляций'],
      ['Реквизит из ловушки → банк', msx(m.iocLatencyMs), 'доставка по шине BroadcastChannel, с отрисовкой'],
      ['Решение по второму переводу', msx(m.secondDecisionMs), m.secondDecision ? 'решение: ' + String(m.secondDecision) : 'NX.scoreTransfer в браузере'],
      ['Индекс DNA второго перевода', num(m.dnaIndex), m.dnaTier ? 'уровень: ' + String(m.dnaTier) : 'Transaction DNA'],
    ].filter((x) => x[1] != null);
    const when = m.ts ? new Date(m.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
    setHtml(box, (items.length ? '<div class="kpis">' + items.map((x) => '<div class="card kpi"><div class="label">' + esc(x[0]) + '</div><div class="value">' + esc(x[1]) + '</div><div class="ci">' + esc(x[2]) + '</div></div>').join('') + '</div>'
      : '<div class="empty">Показ начат, но замеров ещё нет — пройдите шаги 1–4.</div>') +
      '<p class="small muted mt-s">' + (when ? 'Последний показ: ' + esc(when) + '. ' : '') + 'Один показ в одном браузере: зависит от темпа ведущего и судьи-«мошенника». Это проверка, что демо не подстроено, а не оценка качества модели.</p>');
  }

  /* ---------------- события ---------------- */
  let rt = null;
  function bind() {
    const slider = $('#thrSlider');
    slider.addEventListener('input', () => { S.thr = Number(slider.value) || 55; render(); });
    document.querySelectorAll('[data-thr]').forEach((b) => b.addEventListener('click', () => { S.thr = Number(b.dataset.thr); render(); }));
    document.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => { S.set = b.dataset.set; run(); }));
    document.querySelectorAll('[data-err]').forEach((b) => b.addEventListener('click', () => { S.errFilter = b.dataset.err; renderErrors(); }));
    $('#useStop').addEventListener('change', (e) => { S.useStop = !!e.target.checked; run(); });
    $('#baseRate').addEventListener('change', (e) => { S.baseRate = Number(e.target.value) || 0.01; render(); });
    $('#rerun').addEventListener('click', run);
    $('#ownBtn').addEventListener('click', tryOwn);
    $('#ownText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) tryOwn(); });
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.rows.length) { drawPR(prCurve(S.rows)); drawHist(); } }, 120); });
    // замеры сцены пишутся из другой вкладки — обновляемся по событию storage
    window.addEventListener('storage', (e) => { if (!e.key || e.key === STAGE_KEY) renderStage(); });
  }

  function init() {
    if (!$('#benchRoot')) return; // bench.js подключён на другой странице (лендинг) только ради NX.Bench
    renderStage();
    if (!NX || typeof NX.scanText !== 'function') { fail('Не загрузился движок NX.scanText (assets/js/core.js). Откройте страницу через serve.ps1 или задеплоенный сайт.'); return; }
    if (!C || !Array.isArray(C.train) || !Array.isArray(C.holdout)) { fail('Не загрузился корпус window.NX_CORPUS (assets/data/sms-corpus.js).'); return; }
    readParams();
    const total = C.train.length + C.holdout.length;
    const el = $('#corpusSize'); if (el) el.textContent = total + ' ' + plural(total, F_MSG);
    const tr = $('#setTrainN'); if (tr) tr.textContent = String(C.train.length);
    const ho = $('#setHoldN'); if (ho) ho.textContent = String(C.holdout.length);
    const al = $('#setAllN'); if (al) al.textContent = String(total);
    $('#baseRate').value = String(S.baseRate);
    bind();
    if (NX.renderIcons) NX.renderIcons();
    run();
    try { renderDna(); } catch (e) { console.error(e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  if (NX) NX.Bench = { run, confusion, metrics, wilson, rocAuc, prCurve, state: S, evalCall, evalCalls, callSummary, verifiedSummary, stageMetrics, tplLabel };
})();
