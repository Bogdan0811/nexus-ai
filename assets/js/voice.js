/* =====================================================================
   NEXUS VoiceGuard — акустический анализ голоса на признаки синтеза
   Реальная обработка сигнала в браузере (Web Audio API + FFT):
   jitter основного тона, диапазон интонации, динамика громкости,
   регулярность пауз, спектральная плоскостность, энергия ВЧ.
   В промышленной версии заменяется/дополняется нейросетью
   (например, AASIST / RawNet2), обученной на ASVspoof.
   ===================================================================== */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  let ctx = null;
  const ac = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());

  /* ---------- FFT (radix-2, in-place) ---------- */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }
  const hann = (N) => { const w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); return w; };

  function mono(buf) {
    const n = Math.min(buf.length, buf.sampleRate * 30);
    const out = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / buf.numberOfChannels; }
    return out;
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

  /* ---------- извлечение признаков ---------- */
  function analyze(buf) {
    const x = mono(buf), sr = buf.sampleRate;
    const N = 2048, hop = 1024, win = hann(N);
    const frames = Math.max(0, Math.floor((x.length - N) / hop));
    const rms = [];
    for (let f = 0; f < frames; f++) { let s = 0; for (let i = 0; i < N; i++) { const v = x[f * hop + i]; s += v * v; } rms.push(Math.sqrt(s / N)); }
    const maxR = Math.max(...rms, 1e-9);
    const thr = Math.max(maxR * 0.12, 0.004);
    const voiced = rms.map((r) => r > thr);
    // спектральные признаки
    const flat = [], hf = [];
    const re = new Float64Array(N), im = new Float64Array(N);
    const hfBin = Math.floor((7500 / sr) * N);
    for (let f = 0; f < frames; f += 2) {
      if (!voiced[f]) continue;
      for (let i = 0; i < N; i++) { re[i] = x[f * hop + i] * win[i]; im[i] = 0; }
      fft(re, im);
      let lg = 0, ar = 0, tot = 0, hi = 0; const half = N / 2;
      for (let k = 1; k < half; k++) { const p = re[k] * re[k] + im[k] * im[k] + 1e-12; lg += Math.log(p); ar += p; tot += p; if (k >= hfBin) hi += p; }
      flat.push(Math.exp(lg / (half - 1)) / (ar / (half - 1)));
      hf.push(hi / tot);
    }
    // основной тон: даунсэмплинг ~ до 8-12 кГц, автокорреляция
    const ds = Math.max(1, Math.floor(sr / 11000)), sr2 = sr / ds;
    const y = new Float32Array(Math.floor(x.length / ds));
    for (let i = 0; i < y.length; i++) { let s = 0; for (let j = 0; j < ds; j++) s += x[i * ds + j]; y[i] = s / ds; }
    const M = Math.round(0.04 * sr2), minL = Math.floor(sr2 / 400), maxL = Math.floor(sr2 / 70);
    const pitches = [];
    for (let f = 0; f < frames; f++) {
      if (!voiced[f]) { pitches.push(0); continue; }
      const st = Math.floor((f * hop) / ds);
      if (st + M + maxL >= y.length) { pitches.push(0); continue; }
      let e0 = 0; for (let i = 0; i < M; i++) e0 += y[st + i] * y[st + i];
      let best = 0, bl = 0;
      const rs = new Float64Array(maxL + 2);
      for (let L = minL; L <= maxL; L++) {
        let c = 0, e1 = 0;
        for (let i = 0; i < M; i++) { c += y[st + i] * y[st + i + L]; e1 += y[st + i + L] * y[st + i + L]; }
        const r = c / Math.sqrt(e0 * e1 + 1e-12);
        rs[L] = r;
        if (r > best) { best = r; bl = L; }
      }
      // защита от ошибки «октава вниз»: берём первый локальный максимум, близкий к глобальному
      for (let L = minL + 1; L < bl; L++) { if (rs[L] >= 0.9 * best && rs[L] >= rs[L - 1] && rs[L] >= rs[L + 1]) { bl = L; break; } }
      pitches.push(best > 0.5 && bl ? sr2 / bl : 0);
    }
    // отбрасываем октавные ошибки трекера: оставляем тон в пределах ±5 полутонов от медианы
    const raw = pitches.filter((p) => p > 0).sort((a, b) => a - b);
    const med = raw.length ? raw[Math.floor(raw.length / 2)] : 0;
    const inRange = (p) => p > 0 && Math.abs(12 * Math.log2(p / med)) <= 5;
    for (let i = 0; i < pitches.length; i++) if (!inRange(pitches[i])) pitches[i] = 0;
    const pv = pitches.filter((p) => p > 0);
    const jit = [];
    for (let i = 1; i < pitches.length; i++) if (pitches[i] && pitches[i - 1]) { const d = Math.abs(pitches[i] - pitches[i - 1]) / ((pitches[i] + pitches[i - 1]) / 2); if (d < 0.25) jit.push(d); }
    const jitter = mean(jit) * 100;
    const semis = pv.map((p) => 12 * Math.log2(p / (mean(pv) || 1)));
    const pitchRange = std(semis);
    const vr = rms.filter((r, i) => voiced[i]);
    const dynCV = std(vr) / (mean(vr) || 1);
    // паузы
    const pauses = []; let run = 0;
    voiced.forEach((v) => { if (!v) run++; else { if (run >= 2) pauses.push(run); run = 0; } });
    const pauseCV = pauses.length >= 3 ? std(pauses) / mean(pauses) : null;
    const silenceRatio = voiced.filter((v) => !v).length / (voiced.length || 1);
    const flatness = mean(flat), hfRatio = mean(hf);

    const flags = [];
    if (pv.length < 5) flags.push({ w: 0, t: 'Недостаточно речи для анализа тона', neutral: true });
    else {
      if (jitter < 0.6) flags.push({ w: 38, t: 'Почти нулевой джиттер тона — неестественно стабильный голос' });
      else if (jitter < 1.3) flags.push({ w: 18, t: 'Пониженная микровариативность тона' });
      if (pitchRange < 1.0) flags.push({ w: 28, t: 'Монотонная интонация (разброс < 1 полутона)' });
      else if (pitchRange < 1.8) flags.push({ w: 10, t: 'Узкий диапазон интонации' });
    }
    if (sr >= 32000 && hfRatio < 0.0015) flags.push({ w: 18, t: 'Спектр обрезан выше 7,5 кГц — характерно для TTS-вокодеров (или телефонного кодека)' });
    if (pauseCV !== null && pauseCV < 0.3) flags.push({ w: 16, t: 'Паузы слишком равномерные — машинный ритм речи' });
    if (vr.length > 5 && dynCV < 0.28) flags.push({ w: 14, t: 'Слишком ровная громкость, нет естественных акцентов' });
    if (flatness < 0.002 && flat.length) flags.push({ w: 12, t: 'Спектр без шумовой компоненты (нет дыхания и придыханий)' });
    const score = flags.length ? NX.combine(flags.map((f) => f.w)) : 6;
    return {
      score, flags, sr, duration: x.length / sr,
      features: [
        ['Джиттер тона', jitter.toFixed(2) + ' %', '1,5 – 6 %', jitter < 1.3],
        ['Диапазон интонации', pitchRange.toFixed(2) + ' пт', '2 – 6 пт', pitchRange < 1.8],
        ['Средний тон F0', Math.round(med) + ' Гц', '85 – 255 Гц', false],
        ['Вариативность громкости', dynCV.toFixed(2), '0,35 – 0,9', dynCV < 0.28],
        ['Регулярность пауз (CV)', pauseCV === null ? '—' : pauseCV.toFixed(2), '> 0,4', pauseCV !== null && pauseCV < 0.3],
        ['Спектральная плоскостность', flatness.toFixed(4), '> 0,002', flatness < 0.002],
        ['Энергия > 7,5 кГц', (hfRatio * 100).toFixed(3) + ' %', '> 0,15 %', sr >= 32000 && hfRatio < 0.0015],
        ['Доля тишины', Math.round(silenceRatio * 100) + ' %', '10 – 40 %', false],
      ],
      x,
    };
  }

  /* ---------- визуализация ---------- */
  // цвета канваса берём из токенов дизайн-системы (единая тёмная тема), с запасным hex
  function cssVar(name, fallback) {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v && !/^var\(/.test(v) ? v : fallback; } catch (e) { return fallback; }
  }
  // '#RRGGBB' / '#RGB' / 'rgb(r, g, b)' → [r, g, b]; при неудаче — запасной цвет
  function toRgb(c, fb) {
    const s = String(c || '').trim();
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return m[1].split('').map((h) => parseInt(h + h, 16));
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return [+m[1], +m[2], +m[3]];
    return fb;
  }
  function fitCanvas(cv) { const r = cv.getBoundingClientRect(); cv.width = Math.max(300, Math.round(r.width * (window.devicePixelRatio || 1))); cv.height = Math.round(r.height * (window.devicePixelRatio || 1)); return cv.getContext('2d'); }
  function drawWave(x) {
    const cv = $('#waveCanvas'), g = fitCanvas(cv), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, cssVar('--accent', '#6366F1')); grad.addColorStop(1, cssVar('--cyan', '#22D3EE'));
    g.fillStyle = grad;
    const step = Math.max(1, Math.floor(x.length / W));
    for (let i = 0; i < W; i++) {
      let mn = 1, mx = -1;
      for (let j = 0; j < step; j++) { const v = x[i * step + j] || 0; if (v < mn) mn = v; if (v > mx) mx = v; }
      g.fillRect(i, ((1 - mx) * H) / 2, 1, Math.max(1, ((mx - mn) * H) / 2));
    }
  }
  function drawSpec(x, sr) {
    const cv = $('#specCanvas'), g = fitCanvas(cv), W = cv.width, H = cv.height;
    const N = 512, win = hann(N), re = new Float64Array(N), im = new Float64Array(N);
    const img = g.createImageData(W, H);
    const maxBin = Math.min(N / 2, Math.floor((12000 / sr) * N));
    // тёмная палитра спектрограммы из общих токенов: фон --bg2 → --accent → --accent-ink
    const c0 = toRgb(cssVar('--bg2', '#0A0F1C'), [10, 15, 28]);
    const c1 = toRgb(cssVar('--accent', '#6366F1'), [99, 102, 241]);
    const c2 = toRgb(cssVar('--accent-ink', '#A5B4FC'), [165, 180, 252]);
    const mix = (a, b, u, i) => a[i] + (b[i] - a[i]) * u;
    for (let c = 0; c < W; c++) {
      const st = Math.floor((c / W) * (x.length - N));
      for (let i = 0; i < N; i++) { re[i] = (x[st + i] || 0) * win[i]; im[i] = 0; }
      fft(re, im);
      for (let yy = 0; yy < H; yy++) {
        const k = Math.floor(((H - 1 - yy) / H) * maxBin);
        const db = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-10);
        const v = NX.clamp((db + 60) / 70, 0, 1);
        const p = (yy * W + c) * 4;
        const lo = v < 0.6 ? c0 : c1, hi = v < 0.6 ? c1 : c2, u = v < 0.6 ? v / 0.6 : (v - 0.6) / 0.4;
        img.data[p] = mix(lo, hi, u, 0); img.data[p + 1] = mix(lo, hi, u, 1); img.data[p + 2] = mix(lo, hi, u, 2); img.data[p + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // подписи: текст --muted с ореолом --panel — читаются и на тёмном фоне, и на насыщенных полосах
    const dpr = window.devicePixelRatio || 1;
    g.font = '600 ' + (11 * dpr) + 'px ' + cssVar('--font', 'Inter, sans-serif');
    g.lineJoin = 'round'; g.lineWidth = 3 * dpr; g.strokeStyle = cssVar('--panel', '#0E1424'); g.fillStyle = cssVar('--muted', '#95A1BE');
    [['12 кГц', 6, 14 * dpr], ['0', 6, H - 6]].forEach(([s, lx, ly]) => { g.strokeText(s, lx, ly); g.fillText(s, lx, ly); });
  }

  // opts.manual — ручная проверка (эталонный тест-сигнал или загруженный файл): событие видно в ленте, но Core не считает его атакой
  function render(res, label, opts) {
    const manual = !!(opts && opts.manual);
    const lvl = res.score >= 60 ? 'high' : res.score >= 30 ? 'med' : 'low';
    const verdict = lvl === 'high' ? 'Много признаков, похожих на синтез речи' : lvl === 'med' ? 'Есть отдельные признаки искусственной речи' : 'Признаков синтеза речи почти нет';
    const icon = NX.icon({ high: 'bot', med: 'alert', low: 'user' }[lvl], { size: 24 });
    $('#voiceMeta').textContent = label + ' · ' + res.duration.toFixed(1) + ' с · ' + Math.round(res.sr / 1000) + ' кГц';
    $('#voiceResult').innerHTML = '<div class="row between mb wrap gap-s"><h3>Результат VoiceGuard</h3><span class="row gap-s"><span class="badge warn plain">эксперимент</span><span class="tag">' + NX.esc(label) + '</span></span></div>' +
      '<div class="verdict ' + lvl + '"><div class="vi">' + icon + '</div><div class="grow"><h4>' + verdict + '</h4><div class="small muted">Индекс акустических признаков синтеза 0–100 · это не вероятность и не доказательство мошенничества</div></div><div style="text-align:right"><div class="risk-big" style="color:' + NX.riskColor(res.score) + '">' + res.score + '<span class="small muted" style="font-size:14px"> / 100</span></div></div></div>' +
      '<div class="mt">' + NX.meter(res.score) + '</div>' +
      (res.flags.length ? '<h4 class="mt mb" style="font-size:13px">Обнаруженные признаки</h4><ul class="reasons">' + res.flags.map((f) => '<li><span class="ri">' + (f.neutral ? '<span style="color:var(--info-ink, var(--muted))">' + NX.icon('info', { size: 14 }) + '</span>' : '<span style="color:' + (f.w >= 25 ? 'var(--danger-ink)' : 'var(--warn-ink)') + '">' + NX.icon('alert', { size: 14 }) + '</span>') + '</span><span>' + NX.esc(f.t) + '</span>' + (f.w ? '<span class="w">+' + f.w + '</span>' : '') + '</li>').join('') + '</ul>' : '') +
      '<h4 class="mt mb" style="font-size:13px">Акустические признаки</h4><div class="table-wrap"><table class="table"><thead><tr><th>Признак</th><th>Значение</th><th>Норма живой речи</th></tr></thead><tbody>' +
      res.features.map((f) => '<tr><td>' + f[0] + '</td><td class="mono" style="color:' + (f[3] ? 'var(--warn)' : 'var(--text)') + '">' + f[1] + '</td><td class="muted">' + f[2] + '</td></tr>').join('') + '</tbody></table></div>' +
      (lvl !== 'low' ? '<div class="notice warn mt">Если звонящий голосом родственника или сотрудника банка просит деньги — положите трубку и перезвоните ему сами по известному номеру.</div><div class="row mt"><button class="btn danger" id="voiceReport">Сообщить в банк</button></div>' : '') +
      '<p class="disclaimer mt">Экспериментальный индикатор: эвристический DSP-анализ без обученной модели. Живой голос по плохой связи может дать высокий индекс, качественный синтез — низкий, поэтому решение о переводе по одному этому сигналу не принимается. В продукте — нейросетевой детектор (обучение на ASVspoof) и только как дополнительный сигнал.</p>';
    const rb = $('#voiceReport');
    if (rb) rb.onclick = () => { NX.inbox.push({ id: NX.uid('inc'), ts: Date.now(), client: NX.state.user.name, type: 'Deepfake-голос', title: 'VoiceGuard (эксперимент): признаки синтезированного голоса в звонке', score: res.score, amount: 0, account: '—', source: 'VoiceGuard', status: 'new', chain: [] }); rb.disabled = true; rb.innerHTML = NX.icon('check', { size: 16 }) + 'Отправлено'; NX.toast('Отправлено в банк', 'Запись передана антифрод-команде', 'ok'); };
    const ev = { type: lvl === 'high' ? 'voice_fake' : 'voice_check', source: 'VoiceGuard', severity: lvl, title: lvl === 'high' ? 'VoiceGuard: признаки синтеза речи (эксперимент)' : 'Проверка голоса (эксперимент)', details: label + ' · индекс признаков синтеза ' + res.score + '/100' + (manual ? ' · ручная проверка, не сигнал атаки' : '') };
    if (manual) ev.manual = true;
    NX.addEvent(ev);
  }

  function process(buf, label, opts) {
    $('#voiceResult').innerHTML = '<div class="empty"><div class="typing"><span></span><span></span><span></span></div><p class="mt-s">Анализирую спектр и интонацию…</p></div>';
    setTimeout(() => {
      try {
        const res = analyze(buf);
        drawWave(res.x); drawSpec(res.x, buf.sampleRate);
        render(res, label, opts);
        const a = $('#voiceAudio'); a.src = URL.createObjectURL(toWav(buf)); a.classList.remove('hidden');
      } catch (e) { console.error(e); NX.toast('Ошибка анализа', e.message, 'warn'); }
    }, 60);
  }

  /* ---------- синтетические тестовые образцы ---------- */
  function synth(kind) {
    const sr = 48000, dur = 6, n = sr * dur;
    const buf = ac().createBuffer(1, n, sr), d = buf.getChannelData(0);
    const r = NX.rng(kind === 'ai' ? 7 : 11);
    const human = kind === 'human';
    // разметка слогов и пауз
    const segs = []; let t = 0.15;
    while (t < dur - 0.3) {
      const len = human ? 0.12 + r() * 0.22 : 0.18;
      segs.push({ a: t, b: t + len, F1: 350 + r() * 450, F2: 900 + r() * 1400 });
      t += len + (human ? (r() < 0.2 ? 0.25 + r() * 0.35 : 0.03 + r() * 0.07) : 0.12);
    }
    let phase = 0, si = 0, jitterOff = 0;
    const cutoff = human ? 11000 : 7200;
    const base = human ? 175 : 165;
    for (let i = 0; i < n; i++) {
      const tt = i / sr;
      while (si < segs.length - 1 && tt > segs[si].b) si++;
      const s = segs[si];
      const inSeg = tt >= s.a && tt <= s.b;
      let env = 0;
      if (inSeg) { const p = (tt - s.a) / (s.b - s.a); env = Math.sin(Math.PI * p) ** (human ? 0.7 : 0.5); if (human) env *= 0.55 + 0.45 * Math.sin(si * 1.7) ** 2; }
      if (human && i % 480 === 0) jitterOff = (r() - 0.5) * 0.08;
      const f0 = human ? base * (1 + 0.12 * Math.sin(tt * 1.3) + 0.08 * Math.sin(tt * 3.7 + 1) + 0.05 * Math.sin(tt * 9.1) + jitterOff) : base * (1 + 0.004 * Math.sin(tt * 0.5));
      phase += (2 * Math.PI * f0) / sr;
      let v = 0;
      if (env > 0.001) {
        const K = Math.floor(cutoff / f0);
        for (let k = 1; k <= K; k++) {
          const fk = k * f0;
          const g = (1 / k) * (0.3 + 2.2 * Math.exp(-(((fk - s.F1) / 160) ** 2)) + 1.6 * Math.exp(-(((fk - s.F2) / 220) ** 2)) + 0.8 * Math.exp(-(((fk - 2700) / 300) ** 2)));
          v += g * Math.sin(k * phase);
        }
        v *= env * 0.18;
      }
      if (human) v += (r() - 0.5) * 0.012 * (0.3 + env) + (r() - 0.5) * 0.004;
      d[i] = v;
    }
    return buf;
  }

  /* ---------- WAV ---------- */
  function toWav(buf) {
    const x = mono(buf), sr = buf.sampleRate, n = x.length;
    const ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(x[i]));
    const k = mx > 0 ? 0.9 / mx : 1;
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, NX.clamp(x[i] * k, -1, 1) * 32767, true);
    return new Blob([ab], { type: 'audio/wav' });
  }

  async function decodeFile(file) {
    const arr = await file.arrayBuffer();
    return await new Promise((ok, fail) => { const p = ac().decodeAudioData(arr, ok, fail); if (p && p.then) p.then(ok, fail); });
  }

  let rec = null, chunks = [], stopTimer = null;
  async function toggleRec() {
    const btn = $('#recBtn');
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = []; rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        clearTimeout(stopTimer); stream.getTracks().forEach((t) => t.stop());
        btn.innerHTML = NX.icon('mic') + 'Записать с микрофона'; btn.classList.remove('danger');
        try { const blob = new Blob(chunks, { type: rec.mimeType }); const b = await decodeFile(blob); process(b, 'Запись с микрофона'); } catch (e) { NX.toast('Не удалось обработать запись', e.message, 'warn'); }
      };
      rec.start();
      btn.innerHTML = NX.icon('stop') + 'Остановить (макс. 10 с)'; btn.classList.add('danger');
      stopTimer = setTimeout(() => rec.state === 'recording' && rec.stop(), 10000);
    } catch (e) { NX.toast('Нет доступа к микрофону', 'Разрешите доступ в браузере (нужен HTTPS)', 'warn'); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const inp = $('#voiceFile'), drop = $('#voiceDrop');
    if (!inp) return;
    const handle = async (f) => { try { const b = await decodeFile(f); process(b, f.name, { manual: true }); } catch (e) { NX.toast('Формат не поддерживается', 'Попробуйте WAV или MP3', 'warn'); } };
    inp.onchange = () => inp.files[0] && handle(inp.files[0]);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]));
    $('#recBtn').onclick = toggleRec;
    $('#sampleHuman').onclick = () => process(synth('human'), 'Тест: живой голос', { manual: true });
    $('#sampleAI').onclick = () => process(synth('ai'), 'Тест: синтетический голос', { manual: true });
  });
  NX.Voice = { analyze, synth };
})();
