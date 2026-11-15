// Análisis musical fuera de línea. Código puro (sin DOM): se ejecuta en un Web Worker y en las pruebas de Node.
// Resultado: curvas por fotograma de análisis (100 por segundo), BPM, rejilla de golpes, compases y secciones.

export const RATE = 100;           // fotogramas de análisis por segundo
export const SPEC_BANDS = 32;      // bandas del espectro guardado
export const BAND_NAMES = ['bass', 'lowMid', 'mid', 'highMid', 'treble'];
const BAND_HZ = [[30, 150], [150, 400], [400, 2000], [2000, 5000], [5000, 11000]];

// ---------------------------------------------------------------- FFT
function makeFFT(n) {
  const levels = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

function percentile(arr, p) {
  const a = Float32Array.from(arr).sort();
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

/** Seguidor de envolvente: ataque rápido, caída suave (en fotogramas de 10 ms). */
function envelope(src, attack = 0.65, release = 0.14) {
  const out = new Float32Array(src.length);
  let y = 0;
  for (let i = 0; i < src.length; i++) { const x = src[i]; y += (x > y ? attack : release) * (x - y); out[i] = y; }
  return out;
}

function normalize(arr, lo = 0.08, hi = 0.985) {
  const a = percentile(arr, lo), b = percentile(arr, hi);
  const d = b - a || 1;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.min(1, Math.max(0, (arr[i] - a) / d));
  return out;
}

// ---------------------------------------------------------------- análisis principal
/**
 * @param {Float32Array} mono  muestras mono
 * @param {number} sampleRate
 * @param {(p:number)=>void} [progress]
 */
export function analyze(mono, sampleRate, progress = () => {}) {
  // Reducir a ~22 kHz (suficiente para el análisis y el doble de rápido).
  let sr = sampleRate, x = mono;
  if (sampleRate > 32000) {
    const n = Math.floor(mono.length / 2);
    x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * (mono[2 * i] + mono[2 * i + 1]);
    sr = sampleRate / 2;
  }
  const duration = mono.length / sampleRate;
  const N = Math.max(1, Math.floor(duration * RATE));
  const hop = sr / RATE;
  const size = sr > 16000 ? 1024 : 512;
  const fft = makeFFT(size);
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const re = new Float32Array(size), im = new Float32Array(size);
  const nb = size / 2;
  const binHz = sr / size;
  const bandBins = BAND_HZ.map(([a, b]) => [Math.max(1, Math.floor(a / binHz)), Math.min(nb - 1, Math.ceil(b / binHz))]);
  // Bandas logarítmicas del espectro (40 Hz .. 11 kHz)
  const specEdges = [];
  for (let i = 0; i <= SPEC_BANDS; i++) specEdges.push(Math.max(1, Math.min(nb - 1, Math.round((40 * Math.pow(11000 / 40, i / SPEC_BANDS)) / binHz))));

  const raw = BAND_NAMES.map(() => new Float32Array(N));
  const rms = new Float32Array(N), peaks = new Float32Array(N);
  const flux = new Float32Array(N), kickFlux = new Float32Array(N), hatFlux = new Float32Array(N), bodyFlux = new Float32Array(N), lowDom = new Float32Array(N);
  const specRaw = new Float32Array(N * SPEC_BANDS);
  const prev = new Float32Array(nb);
  const kickHi = Math.ceil(160 / binHz), hatLo = Math.floor(5000 / binHz), bodyHi = Math.floor(2000 / binHz);

  for (let f = 0; f < N; f++) {
    const center = Math.floor(f * hop + hop / 2);
    const start = center - size / 2;
    let s2 = 0, pk = 0;
    for (let i = 0; i < size; i++) {
      const idx = start + i;
      const v = idx >= 0 && idx < x.length ? x[idx] : 0;
      re[i] = v * win[i]; im[i] = 0;
    }
    const h0 = Math.max(0, Math.floor(f * hop)), h1 = Math.min(x.length, Math.floor((f + 1) * hop));
    for (let i = h0; i < h1; i++) { const v = x[i]; s2 += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
    rms[f] = Math.sqrt(s2 / Math.max(1, h1 - h0));
    peaks[f] = pk;
    fft(re, im);
    let fl = 0, kf = 0, hf = 0, bf = 0;
    for (let k = 1; k < nb; k++) {
      const mag = Math.log1p(100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      const d = mag - prev[k];
      if (d > 0) { fl += d; if (k <= kickHi) kf += d; else if (k >= hatLo) hf += d; else if (k <= bodyHi) bf += d; }
      prev[k] = mag;
      re[k] = mag; // reutilizar como magnitud logarítmica
    }
    flux[f] = fl; kickFlux[f] = kf; hatFlux[f] = hf; bodyFlux[f] = bf;
    // dominio grave: ataque por bin en graves frente a medios (bombo ≫ 1; caja, palmada o ruido ≈ 1)
    lowDom[f] = Math.min(20, (kf / kickHi) / (bf / (bodyHi - kickHi) + 0.02));
    for (let b = 0; b < BAND_NAMES.length; b++) {
      const [a, z] = bandBins[b];
      let s = 0;
      for (let k = a; k <= z; k++) s += re[k];
      raw[b][f] = s / (z - a + 1);
    }
    for (let b = 0; b < SPEC_BANDS; b++) {
      const a = specEdges[b], z = Math.max(a, specEdges[b + 1] - 1);
      let s = 0;
      for (let k = a; k <= z; k++) s += re[k];
      specRaw[f * SPEC_BANDS + b] = s / (z - a + 1);
    }
    if ((f & 2047) === 0) progress(0.1 + 0.6 * (f / N));
  }

  const bands = {};
  BAND_NAMES.forEach((name, b) => { bands[name] = envelope(normalize(raw[b])); });
  const energyRaw = new Float32Array(N);
  for (let f = 0; f < N; f++) energyRaw[f] = rms[f];
  const energy = envelope(normalize(energyRaw, 0.05, 0.99), 0.5, 0.08);
  const onset = normalize(flux, 0.5, 0.995);
  const kick = normalize(kickFlux, 0.5, 0.995);
  const hat = normalize(hatFlux, 0.5, 0.995);
  const body = normalize(bodyFlux, 0.5, 0.995); // ataque en 160–2000 Hz: el «clic» del bombo y el cuerpo de la caja
  // Espectro a 8 bits (normalizado por banda)
  const spectrum = new Uint8Array(N * SPEC_BANDS);
  for (let b = 0; b < SPEC_BANDS; b++) {
    const col = new Float32Array(N);
    for (let f = 0; f < N; f++) col[f] = specRaw[f * SPEC_BANDS + b];
    const lo = percentile(col, 0.1), hi = percentile(col, 0.99), d = hi - lo || 1;
    let y = 0;
    for (let f = 0; f < N; f++) {
      const v = Math.min(1, Math.max(0, (col[f] - lo) / d));
      y += (v > y ? 0.7 : 0.18) * (v - y);
      spectrum[f * SPEC_BANDS + b] = Math.round(y * 255);
    }
  }
  progress(0.75);

  // Envolvente de golpes para el tempo: flujo total + bombo
  const oenv = new Float32Array(N);
  for (let f = 0; f < N; f++) oenv[f] = 0.3 * onset[f] + 0.7 * kick[f]; // el bombo manda: el charles marca contratiempos
  const tempo = estimateTempo(oenv);
  const beats = trackBeats(oenv, tempo.period);
  progress(0.85);
  const beatStrength = new Float32Array(beats.length);
  for (let i = 0; i < beats.length; i++) {
    const f = Math.round(beats[i] * RATE);
    let m = 0;
    for (let k = f - 3; k <= f + 3; k++) if (k >= 0 && k < N) m = Math.max(m, 0.7 * kick[k] + 0.3 * onset[k]);
    beatStrength[i] = m;
  }
  // Primer tiempo del compás: la fase con más bombo
  let downbeat = 0, best = -1;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let i = ph; i < beats.length; i += 4) s += beatStrength[i];
    if (s > best) { best = s; downbeat = ph; }
  }
  const cumEnergy = new Float32Array(N), cumBass = new Float32Array(N);
  let ce = 0, cb = 0;
  for (let f = 0; f < N; f++) { ce += energy[f] / RATE; cb += bands.bass[f] / RATE; cumEnergy[f] = ce; cumBass[f] = cb; }
  const bpm = beats.length > 8 ? 60 / beatSlope(beats) : tempo.bpm;
  const sections = detectSections({ N, energy, bands, beats, downbeat, duration });
  progress(1);
  return {
    rate: RATE, duration, frames: N, bpm: Math.round(bpm * 10) / 10, tempoConfidence: tempo.confidence,
    bands, energy, onset, kick, hat, body, lowDom, spectrum, rms, peaks,
    beats: Float64Array.from(beats), beatStrength, downbeat, cumEnergy, cumBass, sections,
  };
}

/** Periodo medio por regresión lineal (más preciso que la mediana de diferencias cuantizadas). */
function beatSlope(b) {
  const n = b.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += b[i]; sxx += i * i; sxy += i * b[i]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return slope > 0.2 && slope < 1.5 ? slope : median(diffs(b));
}
function diffs(a) { const o = []; for (let i = 1; i < a.length; i++) o.push(a[i] - a[i - 1]); return o; }
function median(a) { if (!a.length) return 0.5; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

/** Tempo por autocorrelación de la envolvente de golpes, con corrección de tempo a la mitad/doble. */
export function estimateTempo(oenv) {
  const N = oenv.length;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += oenv[i];
  mean /= N || 1;
  let o = new Float32Array(N);
  for (let i = 0; i < N; i++) o[i] = Math.max(0, oenv[i] - mean);
  // Suavizado (los picos de 1 fotograma castigan los periodos no enteros, p. ej. 37,5 fotogramas a 160 BPM)
  for (let pass = 0; pass < 2; pass++) {
    const s = new Float32Array(N);
    for (let i = 0; i < N; i++) s[i] = (o[Math.max(0, i - 2)] + 4 * o[Math.max(0, i - 1)] + 6 * o[i] + 4 * o[Math.min(N - 1, i + 1)] + o[Math.min(N - 1, i + 2)]) / 16;
    o = s;
  }
  const minLag = Math.floor((60 / 200) * RATE), maxLag = Math.ceil((60 / 55) * RATE);
  const ac = new Float32Array(maxLag * 2 + 2);
  const lim = Math.min(N, RATE * 120); // basta con 2 minutos
  for (let lag = minLag; lag <= Math.min(maxLag * 2, N - 1); lag++) {
    let s = 0;
    for (let i = lag; i < lim; i++) s += o[i] * o[i - lag];
    ac[lag] = s / (lim - lag || 1);
  }
  let bestLag = 0, bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * RATE) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.9, 2)); // preferencia suave por tempos de baile
    const score = (ac[lag] + 0.5 * (ac[lag * 2] || 0)) * w;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag) return { bpm: 120, period: RATE / 2, confidence: 0 };
  // Interpolación parabólica
  const y0 = ac[bestLag - 1] || 0, y1 = ac[bestLag], y2 = ac[bestLag + 1] || 0;
  const den = y0 - 2 * y1 + y2;
  let lag = bestLag + (den ? (0.5 * (y0 - y2)) / den : 0);
  let bpm = (60 * RATE) / lag;
  // Tempo a la mitad: si sale lento y al doble también hay ritmo claro, duplicar.
  const half = Math.round(lag / 2);
  if (bpm < 88 && half >= minLag && ac[half] > 0.55 * ac[bestLag]) { lag /= 2; bpm *= 2; }
  if (bpm > 190) { lag *= 2; bpm /= 2; }
  let total = 0; for (let l = minLag; l <= maxLag; l++) total += Math.max(0, ac[l]);
  const confidence = total > 0 ? Math.min(1, (ac[Math.round(lag)] || 0) / (total / (maxLag - minLag + 1)) / 6) : 0;
  return { bpm, period: lag, confidence };
}

/** Seguimiento de golpes por programación dinámica (golpe a golpe; tolera derivas de tempo). */
export function trackBeats(oenv, period) {
  const N = oenv.length;
  if (N < period * 2) return [];
  const alpha = 400;
  const score = new Float32Array(N), back = new Int32Array(N).fill(-1);
  const lo = Math.round(period * 0.5), hi = Math.round(period * 2);
  for (let t = 0; t < N; t++) {
    let best = 0, arg = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const r = Math.log((t - tau) / period);
      const v = score[tau] - alpha * r * r;
      if (v > best || arg < 0) { best = v; arg = tau; }
    }
    score[t] = oenv[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // Mejor final dentro del último periodo
  let end = N - 1, bv = -Infinity;
  for (let t = Math.max(0, N - Math.round(period)); t < N; t++) if (score[t] > bv) { bv = score[t]; end = t; }
  const out = [];
  for (let t = end; t >= 0; t = back[t]) { out.push(t / RATE); if (back[t] < 0) break; }
  out.reverse();
  // Completar huecos al principio y al final con el periodo
  const p = period / RATE;
  while (out.length && out[0] - p > -1e-6 && out[0] - p >= 0) out.unshift(out[0] - p);
  const dur = N / RATE;
  while (out.length && out[out.length - 1] + p < dur) out.push(out[out.length - 1] + p);
  return out;
}

/** Secciones musicales alineadas a compases (intro, estrofa, subida, drop, pausa, final). */
export function detectSections({ N, energy, bands, beats, downbeat, duration }) {
  const bars = [];
  for (let i = downbeat; i + 4 <= beats.length; i += 4) bars.push(beats[i]);
  if (bars.length < 4) return [{ start: 0, end: duration, type: 'verse', energy: 0.5, bars: 0 }];
  if (bars[0] > 0.05) bars.unshift(Math.max(0, bars[0] - (bars[1] - bars[0])));
  const B = bars.length;
  const feat = [];
  for (let b = 0; b < B; b++) {
    const f0 = Math.floor(bars[b] * RATE), f1 = Math.min(N, Math.floor((b + 1 < B ? bars[b + 1] : duration) * RATE));
    const v = [0, 0, 0, 0];
    for (let f = f0; f < f1; f++) { v[0] += energy[f]; v[1] += bands.bass[f]; v[2] += bands.mid[f]; v[3] += bands.treble[f]; }
    const n = Math.max(1, f1 - f0);
    feat.push(v.map((x) => x / n));
  }
  // Novedad: diferencia entre los 4 compases anteriores y los 4 siguientes
  const nov = new Float32Array(B);
  for (let b = 2; b < B - 1; b++) {
    const a = [0, 0, 0, 0], c = [0, 0, 0, 0];
    let na = 0, nc = 0;
    for (let k = Math.max(0, b - 4); k < b; k++) { feat[k].forEach((v, i) => (a[i] += v)); na++; }
    for (let k = b; k < Math.min(B, b + 4); k++) { feat[k].forEach((v, i) => (c[i] += v)); nc++; }
    let d = 0;
    for (let i = 0; i < 4; i++) d += Math.abs(a[i] / na - c[i] / nc) * (i === 0 ? 1.6 : 1);
    nov[b] = d;
  }
  const thr = Math.max(0.12, percentile(nov, 0.8));
  const cuts = [0];
  for (let b = 4; b < B - 2; b++) {
    const isPeak = nov[b] >= thr && nov[b] >= nov[b - 1] && nov[b] >= nov[b + 1];
    const aligned = b % 4 === 0 || nov[b] > thr * 1.6;
    const gap = b - cuts[cuts.length - 1];
    if (isPeak && aligned && (gap >= 8 || (gap >= 4 && nov[b] > thr * 1.5))) cuts.push(b);
  }
  // Secciones demasiado largas: partir cada 16 compases
  const final = [];
  for (let i = 0; i < cuts.length; i++) {
    const a = cuts[i], z = i + 1 < cuts.length ? cuts[i + 1] : B;
    for (let s = a; s < z; s += 16) final.push([s, Math.min(z, s + 16)]);
  }
  const secs = final.map(([a, z]) => {
    let e = 0;
    for (let k = a; k < z; k++) e += feat[k][0] * 0.6 + feat[k][1] * 0.4;
    return { start: bars[a], end: z < B ? bars[z] : duration, bars: z - a, energy: e / (z - a) };
  });
  const maxE = Math.max(...secs.map((s) => s.energy), 1e-6);
  secs.forEach((s, i) => {
    const rel = s.energy / maxE;
    s.energy = Math.round(rel * 1000) / 1000;
    const next = secs[i + 1] ? secs[i + 1].energy / maxE : 0;
    if (i === 0 && rel < 0.75) s.type = 'intro';
    else if (i === secs.length - 1 && rel < 0.7) s.type = 'outro';
    else if (rel >= 0.78) s.type = 'drop';
    else if (rel < 0.5) s.type = 'break';
    else if (next > rel + 0.12) s.type = 'build';
    else s.type = 'verse';
  });
  secs[0].start = 0;
  return secs;
}

/** Lista de transferibles para enviar el resultado desde el Worker sin copiar. */
export function transferables(r) {
  const t = [r.energy.buffer, r.onset.buffer, r.kick.buffer, r.hat.buffer, r.body.buffer, r.lowDom.buffer, r.spectrum.buffer, r.rms.buffer, r.peaks.buffer, r.beats.buffer, r.beatStrength.buffer, r.cumEnergy.buffer, r.cumBass.buffer];
  for (const k of BAND_NAMES) t.push(r.bands[k].buffer);
  return t;
}
