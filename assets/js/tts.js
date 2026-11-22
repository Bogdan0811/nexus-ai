/* NEXUS AI · tts.js — один модуль озвучки для всего демо.
   Задача: звучать как живой человек, а не «робот».
   1) Выбираем лучший голос, который есть в браузере:
      нейросетевые «Natural / Online / Neural» (Microsoft Edge: Светлана, Дария, Дмитрий; казахские Айгуль, Даулет)
      → голоса Google → остальные. Старые системные голоса Windows (Irina, Pavel) — только если других нет.
   2) Роль задаёт голос и манеру: 'granny' — робот-приманка (женский, медленнее, с паузами),
      'scammer' — звонящий (мужской, если есть, чуть быстрее), 'calm' — «голос из спокойного времени».
   3) Текст режется на фразы, между фразами — короткие паузы, как в живой речи.
      Нейросетевым голосам высоту не трогаем: искажение высоты и делает голос «роботом».
   API:
     NX.tts.ready()                      → Promise, когда список голосов загружен
     NX.tts.pick(role, lang)             → SpeechSynthesisVoice | null
     NX.tts.speak(text, {role, lang})    → Promise<{ok, voice, quality}>; lang 'ru' | 'kz' (по умолчанию — по тексту)
     NX.tts.cancel()
     NX.tts.info(lang)                   → {voice, name, quality:'natural'|'good'|'basic'|'none', hint}
     NX.tts.speaking()                   → boolean
*/
(function () {
  'use strict';
  const NX = (window.NX = window.NX || {});
  const ss = window.speechSynthesis;
  const KZ_RE = /[әғқңөұүһі]/i;

  let voices = [];
  let readyP = null;
  function load() {
    try { voices = (ss && ss.getVoices()) || []; } catch (e) { voices = []; }
    return voices;
  }
  function ready() {
    if (readyP && voices.length) return readyP;
    readyP = new Promise((res) => {
      if (!ss) { res([]); return; }
      if (load().length) { res(voices); return; }
      let done = false;
      const fin = () => { if (done) return; done = true; res(load()); };
      try { ss.addEventListener('voiceschanged', fin, { once: true }); } catch (e) { ss.onvoiceschanged = fin; }
      setTimeout(fin, 1500);
    });
    return readyP;
  }
  if (ss) { load(); try { ss.addEventListener('voiceschanged', load); } catch (e) { /* ignore */ } }

  const FEMALE = /svetlana|dariya|daria|aigul|irina|ekaterina|alena|alyona|milena|katya|anna|elena|google|female|жен/i;
  const MALE = /dmitry|dmitri|pavel|daulet|maxim|yuri|male|муж/i;

  function quality(v) {
    if (!v) return 'none';
    const n = v.name || '';
    if (/natural|neural|online|premium|enhanced/i.test(n)) return 'natural';
    if (/google|siri|yandex/i.test(n) || v.localService === false) return 'good';
    return 'basic';
  }
  function score(v, role) {
    const q = quality(v);
    let s = q === 'natural' ? 100 : q === 'good' ? 60 : 10;
    const n = v.name || '';
    const fem = FEMALE.test(n) && !MALE.test(n);
    const male = MALE.test(n);
    if (role === 'scammer') { if (male) s += 20; }
    else { if (fem) s += 20; if (male) s -= 15; }
    if (/svetlana/i.test(n) && role !== 'scammer') s += 6; // мягкий тембр, лучше всего подходит «бабушке»
    if (/dariya/i.test(n) && role === 'calm') s += 6;
    if (v.default) s += 1;
    return s;
  }
  function langOf(text, lang) {
    if (lang === 'kz' || lang === 'kk') return 'kk';
    if (lang === 'ru') return 'ru';
    return KZ_RE.test(text || '') ? 'kk' : 'ru';
  }
  function pick(role, lang) {
    const want = lang === 'kz' || lang === 'kk' ? 'kk' : 'ru';
    const list = voices.length ? voices : load();
    const of = (code) => list.filter((v) => new RegExp('^' + code + '([-_]|$)', 'i').test(v.lang || ''));
    let cand = of(want);
    if (!cand.length && want === 'kk') cand = of('ru'); // казахского голоса нет — читает русский
    if (!cand.length) return null;
    return cand.slice().sort((a, b) => score(b, role) - score(a, role))[0];
  }
  function info(lang) {
    const v = pick('granny', lang || 'ru');
    const q = quality(v);
    const hint = q === 'natural' ? 'Естественный нейросетевой голос'
      : q === 'good' ? 'Хороший голос. Самый живой — в браузере Microsoft Edge (голоса Natural)'
      : q === 'basic' ? 'Простой системный голос. Для живого голоса откройте демо в Microsoft Edge'
      : 'Нет русского голоса — демо идёт текстом';
    return { voice: v, name: v ? v.name : '', quality: q, hint };
  }

  // манера речи по роли; нейросетевым голосам высоту не меняем
  function style(role, q) {
    const nat = q === 'natural';
    if (role === 'granny') return { rate: nat ? 0.9 : 0.88, pitch: nat ? 1 : 1.05, gap: 260 };
    if (role === 'scammer') return { rate: nat ? 1.04 : 1.05, pitch: nat ? 1 : 0.9, gap: 140 };
    return { rate: nat ? 0.95 : 0.95, pitch: 1, gap: 220 };
  }
  // фразы: по . ! ? … и по длинным запятым — так интонация естественнее
  function chunks(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const parts = t.match(/[^.!?…]+[.!?…]+["»)]*|[^.!?…]+$/g) || [t];
    const out = [];
    parts.forEach((p) => {
      p = p.trim(); if (!p) return;
      if (p.length > 160) { const xs = p.split(/,\s+/); xs.forEach((x, k) => { x = x.trim(); if (x) out.push(k < xs.length - 1 ? x + ',' : x); }); }
      else out.push(p);
    });
    return out;
  }

  let run = 0;
  let busy = false;
  let audio = null;
  function stopAudio() { if (audio) { try { audio.onended = audio.onerror = null; audio.pause(); } catch (e) { /* ignore */ } audio = null; } }
  function cancel() { run++; busy = false; stopAudio(); try { if (ss) ss.cancel(); } catch (e) { /* ignore */ } }
  function speaking() { try { return busy || !!(ss && ss.speaking); } catch (e) { return busy; } }

  // Заранее записанные живые голоса (ElevenLabs): assets/data/voice-manifest.js → window.NX_VOICE[текст] = {src, role}
  const normKey = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  function recorded(text) {
    const m = window.NX_VOICE;
    return (m && m[normKey(text)]) || null;
  }
  function playRecorded(rec) {
    const my = ++run;
    try { if (ss) ss.cancel(); } catch (e) { /* ignore */ }
    stopAudio();
    busy = true;
    return new Promise((resolve) => {
      let fin = false;
      const done = (ok) => { if (fin) return; fin = true; if (my === run) { busy = false; audio = null; } resolve(ok); };
      try {
        const a = new Audio(rec.src);
        audio = a;
        a.preload = 'auto';
        a.onended = () => done(true);
        a.onerror = () => done(false);
        const p = a.play();
        if (p && p.catch) p.catch(() => done(false)); // автозапуск заблокирован — вернёмся к голосу браузера
      } catch (e) { done(false); }
    });
  }

  function speak(text, opts) {
    const o = opts || {};
    const role = o.role || 'granny';
    const rec = !(NX.flags && NX.flags.mute) && recorded(text);
    if (rec) {
      return playRecorded(rec).then((ok) => ok ? { ok: true, voice: 'ElevenLabs · ' + rec.role, quality: 'recorded' } : speakBrowser(text, o, role));
    }
    return speakBrowser(text, o, role);
  }
  function speakBrowser(text, o, role) {
    return ready().then(() => {
      const lang = langOf(text, o.lang);
      const v = pick(role, lang);
      const q = quality(v);
      if (!ss || !v || (NX.flags && NX.flags.mute)) return { ok: false, voice: null, quality: q };
      const st = style(role, q);
      if (o.rate) st.rate = o.rate;
      const parts = chunks(text);
      const my = ++run;
      try { ss.cancel(); } catch (e) { /* ignore */ }
      busy = true;
      return new Promise((resolve) => {
        let i = 0;
        const done = (ok) => { if (my === run) busy = false; resolve({ ok, voice: v.name, quality: q }); };
        const next = () => {
          if (my !== run) return done(false);
          if (i >= parts.length) return done(true);
          const p = parts[i++];
          let fin = false;
          const end = () => { if (fin) return; fin = true; clearTimeout(guard); if (my !== run) return done(false); setTimeout(next, i < parts.length ? st.gap : 0); };
          const guard = setTimeout(end, 2500 + p.length * 110);
          try {
            const u = new SpeechSynthesisUtterance(p);
            u.voice = v; u.lang = v.lang; u.rate = st.rate; u.pitch = st.pitch; u.volume = 1;
            u.onend = end; u.onerror = end;
            ss.speak(u);
          } catch (e) { end(); }
        };
        next();
      });
    });
  }

  NX.tts = { ready, pick, speak, cancel, info, speaking, quality, chunks, recorded, hasRecordings: () => !!(window.NX_VOICE && Object.keys(window.NX_VOICE).length) };
})();
