// Herramientas musicales: Afinador cromático (La4 = 440 Hz), Metrónomo y Sponsors.
// Se muestran como capas DOM sobre el juego; no tocan el estado de los minijuegos.
// El audio del micrófono se analiza en memoria y nunca se graba ni se guarda.
import { getConfirmedSponsors, SPONSOR_INTRO, SPONSOR_WHATSAPP_URL } from './sponsors-config.js';
import { t, getLang } from './i18n.js';

// Todo texto asignado a elementos de estas capas pasa por el traductor (respaldo: español).
const TEXT_CONTENT = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
function localizeNode(node) {
  Object.defineProperty(node, 'textContent', {
    configurable: true,
    get() { return TEXT_CONTENT.get.call(this); },
    set(value) { TEXT_CONTENT.set.call(this, typeof value === 'string' ? t(value) : value); },
  });
  return node;
}

export const A4 = 440;
const NOTE_NAMES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const NOTE_LETTERS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

let hooks = { pauseMusic: () => {}, resumeMusic: () => {} };
export function setMusicToolHooks(next) { hooks = { ...hooks, ...next }; }

// ---------- Funciones puras (testeables) ----------
export function noteFromFrequency(freq, ref = A4) {
  if (!(freq > 0)) return null;
  const midiFloat = 69 + 12 * Math.log2(freq / ref);
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  const pc = ((midi % 12) + 12) % 12;
  return { midi, name: NOTE_NAMES[pc], letter: NOTE_LETTERS[pc], octave: Math.floor(midi / 12) - 1, cents, freq };
}

export function tuningColor(cents) {
  const a = Math.abs(cents);
  if (a <= 5) return '#2EE86F';
  if (a <= 15) return '#FFD52B';
  return '#FF4D5E';
}

// YIN (de Cheveigné & Kawahara) con interpolación parabólica: robusto para instrumentos con armónicos.
export function detectPitchYin(buf, sampleRate, minF = 50, maxF = 2000, threshold = 0.12) {
  const maxTau = Math.min(Math.floor(sampleRate / minF), Math.floor(buf.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxF));
  const W = buf.length - maxTau;
  if (W < 32) return null;
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.008) return null;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) { const diff = buf[i] - buf[i + tau]; sum += diff * diff; }
    d[tau] = sum;
  }
  // Diferencia normalizada acumulada
  let running = 0;
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running ? (d[tau] * tau) / running : 1;
  }
  let tauEst = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst < 0) return null;
  let better = tauEst;
  if (tauEst > 1 && tauEst < maxTau) {
    const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom) better = tauEst + (s2 - s0) / denom;
  }
  return { freq: sampleRate / better, clarity: 1 - cmnd[tauEst], rms };
}

// Duración de un tiempo según BPM y compás. En 6/8 el BPM indica la corchea.
export const METERS = {
  '2/4': { beats: 2, accents: [2, 0] },
  '3/4': { beats: 3, accents: [2, 0, 0] },
  '4/4': { beats: 4, accents: [2, 0, 0, 0] },
  '6/8': { beats: 6, accents: [2, 0, 0, 1, 0, 0] },
};
export function clampBpm(v) { return Math.max(40, Math.min(240, Math.round(Number(v) || 100))); }

// ---------- Estilos y helpers DOM ----------
let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.mt-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 20% 15%,rgba(139,32,245,.35),transparent 55%),radial-gradient(circle at 85% 80%,rgba(18,105,243,.3),transparent 55%),rgba(8,10,34,.97);
  font-family:'Fredoka','Baloo 2',system-ui,sans-serif;color:#fff;overflow-y:auto;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));box-sizing:border-box;touch-action:manipulation}
.mt-card{width:min(560px,100%);max-height:100%;display:flex;flex-direction:column;gap:12px;align-items:stretch}
.mt-head{display:flex;align-items:center;gap:10px}
.mt-head h2{flex:1;margin:0;text-align:center;font-size:clamp(22px,6vw,30px);color:#FFD52B;text-shadow:0 0 12px rgba(255,213,43,.6)}
.mt-btn{font:inherit;font-weight:700;border:2px solid var(--c,#00DFFF);background:rgba(14,20,65,.95);color:#fff;border-radius:14px;padding:10px 14px;min-height:46px;cursor:pointer;box-shadow:0 0 10px color-mix(in srgb,var(--c,#00DFFF) 55%,transparent);text-decoration:none;text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.mt-btn:active{transform:scale(.97)}
.mt-btn.on{background:var(--c,#00DFFF);color:#0b0f2e}
.mt-btn:disabled{opacity:.45}
.mt-panel{background:linear-gradient(160deg,rgba(31,15,82,.96),rgba(7,21,58,.96));border:2px solid var(--c,#8B20F5);border-radius:18px;padding:14px;box-shadow:0 0 14px color-mix(in srgb,var(--c,#8B20F5) 45%,transparent)}
.mt-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center}
.mt-note{font-size:clamp(46px,15vw,76px);font-weight:800;text-align:center;line-height:1}
.mt-sub{text-align:center;font-size:15px;color:#dce6ff}
.mt-msg{text-align:center;font-size:14px;color:#FFD52B;min-height:20px}
.mt-canvas{width:100%;height:auto;display:block}
.mt-range{width:100%;accent-color:#FFD52B;height:34px}
.mt-dots{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.mt-dot{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.35);transition:transform .06s,background .06s}
.mt-dot.acc{border-color:#FFD52B}
.mt-dot.lit{background:#00DFFF;transform:scale(1.18);box-shadow:0 0 14px #00DFFF}
.mt-dot.acc.lit{background:#FFD52B;box-shadow:0 0 16px #FFD52B}
.mt-sp{display:flex;gap:12px;align-items:center}
.mt-sp img{width:72px;height:72px;object-fit:contain;border-radius:12px;background:#fff}
@media (orientation:landscape) and (max-height:520px){
  .mt-card{width:min(900px,100%)}
  .mt-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
  .mt-note{font-size:52px}
}`;
  document.head.appendChild(s);
}

function el(tag, attrs = {}, children = []) {
  const n = localizeNode(document.createElement(tag));
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else if (k === 'aria-label' || k === 'alt') n.setAttribute(k, t(v));
    else n.setAttribute(k, v);
  }
  [].concat(children).forEach((c) => c && n.appendChild(typeof c === 'string' ? document.createTextNode(t(c)) : c));
  return n;
}

let activeTool = null;
function openOverlay(title, color, onClose) {
  closeActiveTool();
  injectStyle();
  hooks.pauseMusic();
  const overlay = el('div', { class: 'mt-overlay', role: 'dialog', 'aria-label': title });
  // Igual que los otros modales: los toques no llegan al canvas del juego.
  overlay.addEventListener('pointerdown', (e) => e.stopPropagation());
  const card = el('div', { class: 'mt-card' });
  const back = el('button', { class: 'mt-btn', style: '--c:#1269F3', text: '← Volver' });
  card.appendChild(el('div', { class: 'mt-head' }, [back, el('h2', { text: title, style: `color:${color}` }), el('span', { style: 'width:84px' })]));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const tool = {
    overlay, card,
    close() {
      if (activeTool !== tool) return;
      activeTool = null;
      try { onClose?.(); } catch (e) { /* limpieza best-effort */ }
      overlay.remove();
      hooks.resumeMusic();
    },
  };
  back.addEventListener('click', () => tool.close());
  activeTool = tool;
  return tool;
}
export function closeActiveTool() { activeTool?.close(); }
export function isMusicToolOpen() { return !!activeTool; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && activeTool) activeTool.close(); });

// ---------- AFINADOR ----------
export function openTuner() {
  let ctx = null, stream = null, source = null, analyser = null, testOsc = null, raf = 0;
  let history = [], smoothCents = null, lastMidi = null, lastSeen = 0;
  const tool = openOverlay('🎵 Afinador', '#00DFFF', stopAll);
  const noteEl = el('div', { class: 'mt-note', text: '—' });
  const octEl = el('div', { class: 'mt-sub', text: 'Tocá una nota' });
  const freqEl = el('div', { class: 'mt-sub', text: '— Hz · — cents' });
  const canvas = el('canvas', { class: 'mt-canvas', width: '640', height: '300' });
  const msg = el('div', { class: 'mt-msg', text: 'Referencia: La4 = 440 Hz' });
  const micBtn = el('button', { class: 'mt-btn', style: '--c:#2EE86F', text: '🎤 Activar micrófono' });
  const testBtn = el('button', { class: 'mt-btn', style: '--c:#8B20F5', text: '🔔 Prueba 440 Hz' });
  const privacy = el('div', { class: 'mt-sub', style: 'font-size:12px;opacity:.8', text: 'El sonido se analiza en tu dispositivo. No se graba ni se guarda.' });
  tool.card.appendChild(el('div', { class: 'mt-split' }, [
    el('div', { class: 'mt-panel', style: '--c:#00DFFF' }, [noteEl, octEl, freqEl, canvas]),
    el('div', { class: 'mt-panel', style: '--c:#8B20F5;display:flex;flex-direction:column;gap:10px' }, [msg, el('div', { class: 'mt-row' }, [micBtn, testBtn]), privacy]),
  ]));

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
    }
    return ctx;
  }
  function buildChain(node) {
    // Filtro pasa-altos (quita zumbidos/golpes) y pasa-bajos (quita siseo) antes del análisis.
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    node.connect(hp); hp.connect(lp); lp.connect(analyser);
    return [hp, lp];
  }
  let chain = [];
  function disconnectInputs() {
    try { source?.disconnect(); } catch (e) { /* ya desconectado */ }
    chain.forEach((n) => { try { n.disconnect(); } catch (e) { /* ok */ } });
    chain = [];
    if (testOsc) { try { testOsc.stop(); testOsc.disconnect(); } catch (e) { /* ok */ } testOsc = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    source = null;
    micBtn.textContent = '🎤 Activar micrófono'; micBtn.classList.remove('on');
    testBtn.classList.remove('on');
    history = []; smoothCents = null; lastMidi = null;
  }
  function stopAll() {
    cancelAnimationFrame(raf); raf = 0;
    disconnectInputs();
    document.removeEventListener('visibilitychange', onVis);
    if (ctx) { ctx.close().catch(() => {}); ctx = null; analyser = null; }
  }
  function onVis() { if (document.hidden) { disconnectInputs(); msg.textContent = 'Micrófono apagado al salir de la app.'; } }
  document.addEventListener('visibilitychange', onVis);

  async function startMic() {
    if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'Este navegador no permite usar el micrófono.'; return; }
    if (!window.isSecureContext) { msg.textContent = 'El micrófono necesita una conexión segura (HTTPS).'; return; }
    disconnectInputs();
    ensureCtx();
    msg.textContent = 'Pidiendo permiso para el micrófono…';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (activeTool !== tool) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      source = ctx.createMediaStreamSource(stream);
      chain = buildChain(source);
      micBtn.textContent = '⏹ Apagar micrófono'; micBtn.classList.add('on');
      msg.textContent = 'Escuchando… tocá una nota larga.';
      loop();
    } catch (err) {
      const name = err?.name || '';
      msg.textContent = name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Permiso denegado. Habilitá el micrófono en los ajustes del navegador o del teléfono.'
        : name === 'NotFoundError' ? 'No se encontró ningún micrófono.'
        : name === 'NotReadableError' ? 'El micrófono está siendo usado por otra app.'
        : 'No se pudo activar el micrófono.';
    }
  }
  function startTest() {
    disconnectInputs();
    ensureCtx();
    testOsc = ctx.createOscillator();
    testOsc.type = 'sawtooth'; // señal con armónicos, como un instrumento real
    testOsc.frequency.value = 440;
    const g = ctx.createGain(); g.gain.value = 0.3;
    testOsc.connect(g);
    chain = [g, ...buildChain(g)];
    testOsc.start();
    testBtn.classList.add('on');
    msg.textContent = 'Señal interna de 440 Hz (no usa micrófono ni suena).';
    loop();
  }
  micBtn.addEventListener('click', () => (stream ? (disconnectInputs(), msg.textContent = 'Micrófono apagado.') : startMic()));
  testBtn.addEventListener('click', () => (testOsc ? (disconnectInputs(), msg.textContent = 'Prueba detenida.') : startTest()));

  const buf = new Float32Array(2048);
  function loop() {
    cancelAnimationFrame(raf);
    const step = () => {
      if (activeTool !== tool || !analyser) return;
      if (source || testOsc) {
        analyser.getFloatTimeDomainData(buf);
        const r = detectPitchYin(buf, ctx.sampleRate);
        const now = performance.now();
        if (r && r.clarity > 0.8 && r.freq >= 50 && r.freq <= 2000) {
          history.push(r.freq); if (history.length > 5) history.shift();
          const med = history.slice().sort((a, b) => a - b)[Math.floor(history.length / 2)];
          const n = noteFromFrequency(med);
          if (n.midi !== lastMidi) { smoothCents = n.cents; lastMidi = n.midi; }
          else smoothCents += (n.cents - smoothCents) * 0.3;
          lastSeen = now;
          render(n, smoothCents);
        } else if (now - lastSeen > 900) {
          history = []; render(null, 0);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function render(n, cents) {
    if (n) {
      const c = tuningColor(cents);
      const en = getLang() === 'en';
      noteEl.textContent = en ? n.letter : n.name; noteEl.style.color = c;
      octEl.textContent = en ? `${n.letter}${n.octave} · ${n.name}${n.octave}` : `${n.name}${n.octave} · ${n.letter}${n.octave}`;
      freqEl.textContent = `${n.freq.toFixed(1)} Hz · ${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cents`;
    } else {
      noteEl.textContent = '—'; noteEl.style.color = '#fff';
      octEl.textContent = 'Tocá una nota'; freqEl.textContent = '— Hz · — cents';
    }
    drawGauge(n ? cents : null);
  }
  function drawGauge(cents) {
    const g = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h * 0.92, r = h * 0.78;
    g.clearRect(0, 0, w, h);
    const ang = (c) => -Math.PI / 2 + (Math.max(-50, Math.min(50, c)) / 50) * (Math.PI * 0.42);
    const zones = [[-50, -15, '#FF4D5E'], [-15, -5, '#FFD52B'], [-5, 5, '#2EE86F'], [5, 15, '#FFD52B'], [15, 50, '#FF4D5E']];
    g.lineWidth = 22;
    zones.forEach(([a, b, col]) => { g.strokeStyle = col; g.globalAlpha = 0.85; g.beginPath(); g.arc(cx, cy, r, ang(a), ang(b)); g.stroke(); });
    g.globalAlpha = 1; g.fillStyle = '#fff'; g.font = 'bold 20px system-ui'; g.textAlign = 'center';
    [-50, -25, 0, 25, 50].forEach((c) => {
      const a = ang(c);
      g.fillText(c > 0 ? `+${c}` : `${c}`, cx + Math.cos(a) * (r - 40), cy + Math.sin(a) * (r - 40) + 7);
    });
    g.font = 'bold 24px system-ui';
    g.fillText('♭', cx - r * 0.9, cy - 10); g.fillText('♯', cx + r * 0.9, cy - 10);
    if (cents !== null) {
      const a = ang(cents);
      g.strokeStyle = tuningColor(cents); g.lineWidth = 7; g.lineCap = 'round';
      g.shadowColor = g.strokeStyle; g.shadowBlur = 16;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6)); g.stroke();
      g.shadowBlur = 0;
    }
    g.fillStyle = '#FFD52B'; g.beginPath(); g.arc(cx, cy, 12, 0, Math.PI * 2); g.fill();
  }
  drawGauge(null);
}

// ---------- METRÓNOMO ----------
export function openMetronome() {
  let ctx = null, master = null, timer = 0, raf = 0;
  let bpm = 100, meter = '4/4', accentOn = true, volume = 0.8;
  let state = 'stopped'; // 'playing' | 'paused' | 'stopped'
  let beatIndex = 0, nextTime = 0, visualQueue = [], taps = [];
  const LOOKAHEAD_MS = 25, SCHEDULE_AHEAD = 0.12;

  const tool = openOverlay('🥁 Metrónomo', '#FF28CC', stopAll);
  const bpmEl = el('div', { class: 'mt-note', text: '100' });
  const unitEl = el('div', { class: 'mt-sub', text: 'BPM (negra)' });
  const range = el('input', { type: 'range', min: '40', max: '240', step: '1', value: '100', class: 'mt-range', 'aria-label': 'BPM' });
  const minus = el('button', { class: 'mt-btn', style: '--c:#00DFFF;min-width:56px', text: '−' });
  const plus = el('button', { class: 'mt-btn', style: '--c:#00DFFF;min-width:56px', text: '+' });
  const tap = el('button', { class: 'mt-btn', style: '--c:#FFD52B', text: '👆 Tap Tempo' });
  const dots = el('div', { class: 'mt-dots' });
  const meterBtns = Object.keys(METERS).map((m) => el('button', { class: 'mt-btn', style: '--c:#8B20F5', text: m, onclick: () => setMeter(m) }));
  const accentBtn = el('button', { class: 'mt-btn on', style: '--c:#FFD52B', text: '★ Acento: Sí' });
  const playBtn = el('button', { class: 'mt-btn', style: '--c:#2EE86F', text: '▶ Iniciar' });
  const pauseBtn = el('button', { class: 'mt-btn', style: '--c:#FFD52B', text: '⏸ Pausar' });
  const stopBtn = el('button', { class: 'mt-btn', style: '--c:#FF4D5E', text: '⏹ Detener' });
  const vol = el('input', { type: 'range', min: '0', max: '100', value: '80', class: 'mt-range', 'aria-label': 'Volumen' });
  tool.card.appendChild(el('div', { class: 'mt-split' }, [
    el('div', { class: 'mt-panel', style: '--c:#FF28CC;display:flex;flex-direction:column;gap:8px' }, [
      bpmEl, unitEl, el('div', { class: 'mt-row', style: 'flex-wrap:nowrap' }, [minus, range, plus]), el('div', { class: 'mt-row' }, [tap]), dots,
    ]),
    el('div', { class: 'mt-panel', style: '--c:#8B20F5;display:flex;flex-direction:column;gap:10px' }, [
      el('div', { class: 'mt-row' }, meterBtns), el('div', { class: 'mt-row' }, [accentBtn]),
      el('div', { class: 'mt-row' }, [playBtn, pauseBtn, stopBtn]),
      el('div', { class: 'mt-sub', text: '🔊 Volumen' }), vol,
    ]),
  ]));

  function renderDots() {
    dots.innerHTML = '';
    METERS[meter].accents.forEach((a, i) => dots.appendChild(el('div', { class: `mt-dot${accentOn && a ? ' acc' : ''}`, 'data-i': String(i) })));
    meterBtns.forEach((b) => b.classList.toggle('on', b.textContent === meter));
    unitEl.textContent = meter === '6/8' ? 'BPM (corchea) · grupos de 3' : 'BPM (negra)';
  }
  function setBpm(v) { bpm = clampBpm(v); bpmEl.textContent = String(bpm); range.value = String(bpm); }
  function setMeter(m) { meter = m; beatIndex = 0; renderDots(); }
  range.addEventListener('input', () => setBpm(range.value));
  minus.addEventListener('click', () => setBpm(bpm - 1));
  plus.addEventListener('click', () => setBpm(bpm + 1));
  vol.addEventListener('input', () => {
    volume = Math.max(0, Math.min(1, Number(vol.value) / 100));
    if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  });
  accentBtn.addEventListener('click', () => {
    accentOn = !accentOn;
    accentBtn.classList.toggle('on', accentOn);
    accentBtn.textContent = accentOn ? '★ Acento: Sí' : '☆ Acento: No';
    renderDots();
  });
  tap.addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now); if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      setBpm(60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length));
    }
  });

  function click(time, level) {
    // level 2 = acento fuerte, 1 = acento secundario (6/8, 4ª corchea), 0 = tiempo débil
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = level === 2 ? 1760 : level === 1 ? 1320 : 990;
    const peak = level === 2 ? 1 : level === 1 ? 0.75 : 0.55;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(g); g.connect(master);
    osc.start(time); osc.stop(time + 0.08);
  }
  function scheduler() {
    const m = METERS[meter];
    while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const i = beatIndex % m.beats;
      click(nextTime, accentOn ? m.accents[i] : 0);
      visualQueue.push({ i, time: nextTime });
      nextTime += 60 / bpm;
      beatIndex = (i + 1) % m.beats;
    }
  }
  function draw() {
    if (activeTool !== tool) return;
    if (ctx) {
      let current = null;
      while (visualQueue.length && visualQueue[0].time <= ctx.currentTime) current = visualQueue.shift();
      if (current) {
        dots.querySelectorAll('.mt-dot').forEach((d) => d.classList.toggle('lit', Number(d.dataset.i) === current.i));
        setTimeout(() => dots.querySelectorAll('.mt-dot.lit').forEach((d) => d.classList.remove('lit')), Math.min(120, 30000 / bpm));
      }
    }
    raf = requestAnimationFrame(draw);
  }
  function play() {
    if (state === 'playing') return; // evita programaciones duplicadas
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
    }
    ctx.resume().catch(() => {});
    if (state === 'stopped') beatIndex = 0;
    state = 'playing';
    nextTime = ctx.currentTime + 0.06;
    visualQueue = [];
    clearInterval(timer);
    timer = setInterval(scheduler, LOOKAHEAD_MS);
    scheduler();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
    playBtn.classList.add('on');
  }
  function halt(next) {
    clearInterval(timer); timer = 0;
    state = next;
    if (next === 'stopped') beatIndex = 0;
    else if (visualQueue.length) beatIndex = visualQueue[0].i; // retoma en el tiempo que no llegó a sonar
    visualQueue = [];
    // Silencia de inmediato los clics ya programados.
    if (ctx && master) {
      master.disconnect();
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
    }
    playBtn.classList.remove('on');
    dots.querySelectorAll('.mt-dot.lit').forEach((d) => d.classList.remove('lit'));
  }
  playBtn.addEventListener('click', play);
  pauseBtn.addEventListener('click', () => { if (state === 'playing') halt('paused'); });
  stopBtn.addEventListener('click', () => halt('stopped'));
  function onVis() { if (document.hidden && state === 'playing') halt('paused'); }
  document.addEventListener('visibilitychange', onVis);
  function stopAll() {
    halt('stopped');
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVis);
    if (ctx) { ctx.close().catch(() => {}); ctx = null; master = null; }
  }
  renderDots();
}

// ---------- SPONSORS ----------
function sponsorCard(s) {
  const children = [];
  if (s.logo) children.push(el('img', { src: s.logo, alt: `Logo de ${s.name}`, loading: 'lazy', onerror: (e) => e.target.remove() }));
  const info = el('div', { style: 'flex:1;min-width:0' }, [
    el('div', { style: 'font-weight:800;font-size:18px', text: s.name }),
    s.description ? el('div', { class: 'mt-sub', style: 'text-align:left', text: s.description }) : null,
  ]);
  children.push(info);
  const isSafeUrl = typeof s.url === 'string' && /^https:\/\//i.test(s.url);
  const attrs = { class: 'mt-panel mt-sp', style: '--c:#FFD52B;color:#fff;text-decoration:none' };
  return isSafeUrl
    ? el('a', { ...attrs, href: s.url, target: '_blank', rel: 'noopener noreferrer' }, children)
    : el('div', attrs, children);
}

export function openSponsors() {
  const tool = openOverlay('🤝 Nuestros sponsors y colaboradores', '#FFD52B');
  const list = getConfirmedSponsors();
  const intro = el('div', { class: 'mt-panel', style: '--c:#FF28CC' }, [
    el('div', { class: 'mt-sub', style: 'font-size:17px;color:#fff', text: 'Gracias a quienes acompañan nuestro proyecto y nos ayudan a seguir creando oportunidades a través de la música.' }),
  ]);
  tool.card.appendChild(intro);
  if (!list.length) {
    tool.card.appendChild(el('div', { class: 'mt-panel', style: '--c:#00DFFF' }, [
      el('div', { style: 'font-size:40px;text-align:center', text: '🎻🎺🥁' }),
      el('div', { class: 'mt-sub', style: 'font-size:17px;color:#FFD52B', text: 'Próximamente conocerás a quienes hacen posible esta aventura.' }),
    ]));
  } else {
    list.forEach((s) => tool.card.appendChild(sponsorCard(s)));
  }
  tool.card.appendChild(el('a', {
    class: 'mt-btn', style: '--c:#2EE86F;font-size:17px;padding:14px',
    href: SPONSOR_WHATSAPP_URL, target: '_blank', rel: 'noopener noreferrer',
  }, ['💬 Quiero colaborar con la Orquesta Escuela']));
}

let introShown = false;
// Presentación inicial: solo si está activada y hay sponsors confirmados. Se puede saltar y se cierra sola.
export function maybeShowSponsorIntro() {
  if (introShown) return;
  introShown = true;
  const list = getConfirmedSponsors();
  if (!SPONSOR_INTRO.enabled || !list.length) return;
  injectStyle();
  const overlay = el('div', { class: 'mt-overlay', role: 'dialog', 'aria-label': 'Sponsors' });
  overlay.addEventListener('pointerdown', (e) => e.stopPropagation());
  const card = el('div', { class: 'mt-card' }, [
    el('h2', { style: 'text-align:center;color:#FFD52B;margin:0', text: 'Con el apoyo de' }),
    ...list.map((s) => el('div', { class: 'mt-panel mt-sp', style: '--c:#FFD52B' }, [
      s.logo ? el('img', { src: s.logo, alt: `Logo de ${s.name}`, onerror: (e) => e.target.remove() }) : null,
      el('div', { style: 'font-weight:800;font-size:18px', text: s.name }),
    ])),
  ]);
  const close = () => { clearTimeout(t); overlay.remove(); };
  card.appendChild(el('button', { class: 'mt-btn', style: '--c:#00DFFF', text: 'Saltar ▶', onclick: close }));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const ms = Math.min(SPONSOR_INTRO.maxSeconds, list.length * SPONSOR_INTRO.secondsPerSponsor) * 1000;
  const t = setTimeout(close, Math.max(1500, ms));
}
