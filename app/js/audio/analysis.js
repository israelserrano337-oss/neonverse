// Vista de lectura del análisis: audio.at(t) devuelve los niveles en el instante t (interpolados, puros).
import { RATE, SPEC_BANDS, BAND_NAMES } from './analysis-core.js';

function sample(arr, t) {
  const n = arr.length;
  if (!n) return 0;
  const x = t * RATE;
  if (x <= 0) return arr[0];
  if (x >= n - 1) return arr[n - 1];
  const i = Math.floor(x), k = x - i;
  return arr[i] + (arr[i + 1] - arr[i]) * k;
}

export class Analysis {
  constructor(data) {
    this.d = data;
    this.duration = data.duration;
    this.bpm = data.bpm;
    this.beats = data.beats;
    this.sections = data.sections;
    this.synthetic = false;
    this._spec = new Float32Array(SPEC_BANDS);
    // Envolventes lentas para todo lo que cambia el BRILLO (ataque ~160 ms): evitan destellos de 1 fotograma
    if (data.bands) {
      const slow = (src) => { const o = new Float32Array(src.length); let y = 0; for (let i = 0; i < src.length; i++) { const x = src[i]; y += (x > y ? 0.06 : 0.035) * (x - y); o[i] = y; } return o; };
      this.soft = { bass: slow(data.bands.bass), mid: slow(data.bands.mid), treble: slow(data.bands.treble), energy: slow(data.energy) };
    }
    // Espectro suavizado para los ecualizadores: sube en ~165 ms y baja en ~300 ms (sin saltos de un fotograma)
    if (data.spectrum && data.frames) {
      const n = data.frames, sp = new Float32Array(n * SPEC_BANDS);
      for (let b = 0; b < SPEC_BANDS; b++) {
        let y = 0;
        for (let f = 0; f < n; f++) { const x = data.spectrum[f * SPEC_BANDS + b] / 255; y += (x > y ? 0.06 : 0.035) * (x - y); sp[f * SPEC_BANDS + b] = y; }
      }
      this.specSoft = sp;
    }
  }
  /** Posición en golpes desde el inicio (fraccionaria). */
  beatPos(t) {
    const b = this.beats, n = b.length;
    if (n < 2) return t * (this.bpm / 60);
    if (t < b[0]) return (t - b[0]) / (b[1] - b[0]);
    if (t >= b[n - 1]) return n - 1 + (t - b[n - 1]) / (b[n - 1] - b[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m] <= t) lo = m; else hi = m; }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
  }
  /**
   * Golpes de batería reales (no la rejilla): picos de bombo y de caja, ignorando los platillos.
   * mode: 'hits' (bombo y caja) · 'kicks' (solo bombo) · 'strong' (solo los más fuertes).
   * Devuelve [{ t, s }] en tiempo de audio, separados al menos `minGap` segundos.
   */
  drumHits({ mode = 'hits', minGap = 0.25, sensitivity = 0.5 } = {}) {
    const d = this.d, n = d.frames, R = RATE;
    if (!d.kick || n < 10) return [];
    const v = new Float32Array(n);
    const near = (arr, i) => { let m = 0; for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (arr[k] > m) m = arr[k]; return m; };
    for (let i = 0; i < n; i++) {
      const body = d.body ? near(d.body, i) : near(d.onset, i);
      // Bombo real = ataque grave que DOMINA sobre los medios (una caja o una palmada sola reparten el ataque por
      // todo el espectro: dominio ≈ 1; bombo solo ≫ 1; bombo + palmada ≈ 2-4) y con algo de «clic» (un bajo no lo tiene).
      let dom = 5; if (d.lowDom) { dom = 0; for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) if (d.lowDom[k] > dom) dom = d.lowDom[k]; }
      const gate = Math.max(0, Math.min(1, (dom - 1.1) / 0.5));
      const kick = d.kick[i] * Math.min(1, 0.3 + 2 * body) * gate;
      // Caja: ataque de banda ancha con cuerpo en medios (un charles solo tiene agudos)
      const snare = Math.max(0, d.onset[i] - 0.7 * d.hat[i]) * 0.9 + (d.kick[i] > 0.3 && body > 0.5 ? 0.6 * Math.min(d.kick[i], body) : 0); // banda ancha, o grave + cuerpo a la vez
      v[i] = mode === 'kicks' ? kick : Math.max(kick, Math.min(1, snare));
    }
    const W = Math.round(0.5 * R), pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + v[i];
    // Umbral: absoluto y, además, relativo a los golpes fuertes de ESTA canción (los bombos son, de forma consistente,
    // los ataques graves más fuertes; notas de bajo y golpes fantasma quedan por debajo).
    const cand = [];
    for (let i = 2; i < n - 2; i++) if (v[i] > 0.15 && v[i] >= v[i - 1] && v[i] >= v[i + 1] && v[i] >= v[i - 2] && v[i] >= v[i + 2]) cand.push(v[i]);
    cand.sort((x, y) => x - y);
    const ref = cand.length ? cand[Math.floor(cand.length * 0.9)] : 0;
    const absThr = Math.max(0.5 - 0.3 * sensitivity, ref * (mode === 'kicks' ? 0.9 - 0.5 * sensitivity : 0.6 - 0.4 * sensitivity)) + (mode === 'strong' ? 0.15 : 0);
    const peaks = [];
    for (let i = 2; i < n - 2; i++) {
      const x = v[i];
      if (x < absThr) continue;
      let isMax = true;
      for (let k = -4; k <= 4 && isMax; k++) if (k && i + k >= 0 && i + k < n && v[i + k] > x) isMax = false;
      if (!isMax) continue;
      const a = Math.max(0, i - W), b = Math.min(n, i + W), mean = (pre[b] - pre[a]) / (b - a);
      if (x < mean * (mode === 'strong' ? 1.7 : 1.3) + 0.04) continue;
      peaks.push({ t: i / R, s: x });
    }
    const out = [];
    for (const p of peaks) {
      const last = out[out.length - 1];
      if (last && p.t - last.t < minGap) { if (p.s > last.s * 1.15) out[out.length - 1] = p; }
      else out.push(p);
    }
    return out;
  }
  /** Golpes de bombo y de batería (bombo+caja) preparados para consultas rápidas (una vez por canción). */
  _drums() {
    if (this._dc) return this._dc;
    const mk = (list) => {
      const t = Float64Array.from(list.map((h) => h.t));
      let smax = 1e-6; for (const h of list) smax = Math.max(smax, h.s);
      const s = Float32Array.from(list.map((h) => 0.55 + 0.45 * Math.min(1, h.s / smax)));
      const cum = new Float64Array(t.length + 1); for (let i = 0; i < t.length; i++) cum[i + 1] = cum[i] + s[i];
      return { t, s, cum };
    };
    this._dc = { kick: mk(this.drumHits({ mode: 'kicks', minGap: 0.2 })), hit: mk(this.drumHits({ mode: 'hits', minGap: 0.12 })) };
    return this._dc;
  }
  /**
   * Señales de MOVIMIENTO ligadas a los golpes reales (no a la rejilla): suben en el instante del golpe y caen después.
   *   kickPulse / hitPulse: 0..1, caída exponencial (0,17 s / 0,13 s)
   *   kickTravel: desplazamiento acumulado (cada bombo da un «empujón» que se frena en ~0,3 s)
   *   kickAge0..2: segundos desde los tres últimos bombos
   */
  drumsAt(t, out) {
    const D = this._drums();
    const last = (set) => { const a = set.t; let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
    const k = last(D.kick), h = last(D.hit);
    out.kickPulse = k < 0 ? 0 : D.kick.s[k] * Math.exp(-(t - D.kick.t[k]) / 0.17);
    out.hitPulse = h < 0 ? 0 : D.hit.s[h] * Math.exp(-(t - D.hit.t[h]) / 0.13);
    const tau = 0.3;
    let tr = k < 0 ? 0 : D.kick.cum[k + 1] * tau;
    for (let j = k; j >= 0 && j > k - 10; j--) tr -= D.kick.s[j] * tau * Math.exp(-(t - D.kick.t[j]) / tau);
    out.kickTravel = tr;
    out.kickIndex = k;
    for (let j = 0; j < 3; j++) out['kickAge' + j] = k - j >= 0 ? t - D.kick.t[k - j] : 99;
    return out;
  }
  /** Tiempo (s) de una posición de golpe (inversa de beatPos). */
  beatTime(pos) {
    const b = this.beats, n = b.length;
    if (n < 2) return pos / (this.bpm / 60);
    if (pos <= 0) return b[0] + pos * (b[1] - b[0]);
    if (pos >= n - 1) return b[n - 1] + (pos - (n - 1)) * (b[n - 1] - b[n - 2]);
    const i = Math.floor(pos);
    return b[i] + (pos - i) * (b[i + 1] - b[i]);
  }
  /** Tiempo del compás que contiene t (para encajar escenas y cortes). */
  barStart(t) { const p = this.beatPos(t) - this.d.downbeat; return this.beatTime(Math.floor(p / 4) * 4 + this.d.downbeat); }
  sectionAt(t) {
    const s = this.sections;
    for (let i = 0; i < s.length; i++) if (t < s[i].end || i === s.length - 1) return { ...s[i], index: i };
    return null;
  }
  /** Pulso seguro: campana coseno centrada en cada golpe, ponderada por la fuerza del golpe. */
  pulseAt(pos) {
    const i = Math.round(pos), d = Math.abs(pos - i);
    const w = 0.4;
    if (d >= w) return 0;
    const s = this.d.beatStrength[Math.max(0, Math.min(this.d.beatStrength.length - 1, i))] ?? 0.6;
    const c = Math.cos((Math.PI / 2) * (d / w));
    return c * c * (0.35 + 0.65 * s);
  }
  /** Niveles del instante t (todos 0..1 salvo posiciones y acumulados). */
  at(t, out = {}) {
    const d = this.d;
    for (const k of BAND_NAMES) out[k] = sample(d.bands[k], t);
    out.energy = sample(d.energy, t);
    out.onset = sample(d.onset, t);
    out.kick = sample(d.kick, t);
    out.hat = sample(d.hat, t);
    out.volume = out.energy;
    out.bassSoft = sample(this.soft.bass, t); out.midSoft = sample(this.soft.mid, t);
    out.trebleSoft = sample(this.soft.treble, t); out.energySoft = sample(this.soft.energy, t);
    const bp = this.beatPos(t);
    out.beatPos = bp;
    out.beatPhase = bp - Math.floor(bp);
    const barPos = (bp - d.downbeat) / 4;
    out.barPos = barPos;
    out.barPhase = barPos - Math.floor(barPos);
    out.beat = this.pulseAt(bp);
    out.bar = Math.floor(barPos);
    out.bpm = this.bpm;
    out.bps = this.bpm / 60;
    out.travel = sample(d.cumEnergy, t);
    out.travelBass = sample(d.cumBass, t);
    const n = d.frames, x = Math.max(0, Math.min(n - 1, t * RATE)), i = Math.floor(x), k = x - i, j = Math.min(n - 1, i + 1);
    const spec = out.spectrum || (out.spectrum = new Float32Array(SPEC_BANDS));
    for (let b = 0; b < SPEC_BANDS; b++) spec[b] = (d.spectrum[i * SPEC_BANDS + b] * (1 - k) + d.spectrum[j * SPEC_BANDS + b] * k) / 255;
    const sec = this.sectionAt(t);
    out.section = sec ? sec.type : 'verse';
    out.sectionEnergy = sec ? sec.energy : 0.5;
    out.time = t;
    this.drumsAt(t, out);
    return out;
  }
  /** Solo el espectro (32 bandas) en t: barato, para el historial de los ecualizadores. */
  spectrumAt(t, out = new Float32Array(SPEC_BANDS)) {
    const d = this.d, n = d.frames, x = Math.max(0, Math.min(n - 1, t * RATE)), i = Math.floor(x), k = x - i, j = Math.min(n - 1, i + 1);
    const s = this.specSoft;
    if (s) for (let b = 0; b < SPEC_BANDS; b++) out[b] = s[i * SPEC_BANDS + b] * (1 - k) + s[j * SPEC_BANDS + b] * k;
    else for (let b = 0; b < SPEC_BANDS; b++) out[b] = (d.spectrum[i * SPEC_BANDS + b] * (1 - k) + d.spectrum[j * SPEC_BANDS + b] * k) / 255;
    return out;
  }
  /** Picos para dibujar la forma de onda: devuelve [min,max] por columna. */
  waveform(columns, t0 = 0, t1 = this.duration) {
    const p = this.d.peaks, out = new Float32Array(columns);
    for (let c = 0; c < columns; c++) {
      const a = Math.floor(((t0 + ((t1 - t0) * c) / columns) * RATE)), b = Math.max(a + 1, Math.floor(((t0 + ((t1 - t0) * (c + 1)) / columns) * RATE)));
      let m = 0;
      for (let i = Math.max(0, a); i < Math.min(p.length, b); i++) if (p[i] > m) m = p[i];
      out[c] = m;
    }
    return out;
  }
}

/** Análisis sintético (sin música): 120 BPM y niveles suaves, para que los estudios se animen. */
export class SyntheticAnalysis extends Analysis {
  constructor(duration = 30, bpm = 120) {
    const beats = [];
    for (let t = 0; t <= duration + 1; t += 60 / bpm) beats.push(t);
    const sections = [];
    for (let s = 0, i = 0; s < duration; s += 16, i++) sections.push({ start: s, end: Math.min(duration, s + 16), type: ['intro', 'build', 'drop', 'break'][i % 4], energy: [0.4, 0.65, 1, 0.45][i % 4], bars: 8 });
    super({ duration, bpm, beats: Float64Array.from(beats), sections, downbeat: 0, beatStrength: new Float32Array(beats.length).fill(0.7), frames: 0 });
    this.synthetic = true;
  }
  at(t, out = {}) {
    const bp = t * (this.bpm / 60);
    const ph = bp - Math.floor(bp);
    const pulse = this.pulseAt(bp);
    const slow = 0.5 + 0.5 * Math.sin(t * 0.37);
    out.bass = 0.35 + 0.45 * pulse;
    out.lowMid = 0.4 + 0.2 * Math.sin(t * 1.3);
    out.mid = 0.45 + 0.25 * Math.sin(t * 0.9 + 1);
    out.highMid = 0.35 + 0.25 * slow;
    out.treble = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.1));
    out.energy = 0.45 + 0.25 * slow + 0.15 * pulse;
    out.volume = out.energy;
    out.bassSoft = out.bass; out.midSoft = out.mid; out.trebleSoft = out.treble; out.energySoft = out.energy;
    out.onset = pulse; out.kick = pulse; out.hat = 0.5 * (1 - Math.abs(ph - 0.5) * 2);
    out.beatPos = bp; out.beatPhase = ph; out.beat = pulse;
    out.barPos = bp / 4; out.barPhase = out.barPos - Math.floor(out.barPos); out.bar = Math.floor(out.barPos);
    out.bpm = this.bpm; out.bps = this.bpm / 60;
    out.travel = t * 0.55; out.travelBass = t * 0.5;
    const spec = out.spectrum || (out.spectrum = new Float32Array(SPEC_BANDS));
    for (let b = 0; b < SPEC_BANDS; b++) spec[b] = Math.max(0, Math.min(1, (b < 6 ? out.bass : out.mid) * (0.6 + 0.4 * Math.sin(t * 2 + b * 0.7))));
    const sec = this.sectionAt(t);
    out.section = sec?.type || 'verse'; out.sectionEnergy = sec?.energy ?? 0.5; out.time = t;
    this.drumsAt(t, out);
    return out;
  }
  waveform(columns) { return new Float32Array(columns).fill(0); }
  spectrumAt(t, out = new Float32Array(SPEC_BANDS)) { out.set(this.at(t, this._tmp || (this._tmp = {})).spectrum); return out; }
  drumHits({ minGap = 0.25 } = {}) { const out = []; const step = Math.max(60 / this.bpm, minGap); for (let t = 0; t < this.duration; t += step) out.push({ t, s: 0.8 }); return out; }
}

export { RATE, SPEC_BANDS, BAND_NAMES };
