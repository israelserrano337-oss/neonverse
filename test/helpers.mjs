// Generador de música sintética para pruebas (bombo, bajo, charles, pausa sin bombo).
export function synthTrack({ bpm = 128, seconds = 60, sr = 44100, breakAt = null, breakLen = 0, seed = 1 } = {}) {
  const n = Math.floor(seconds * sr);
  const x = new Float32Array(n);
  const beat = 60 / bpm;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const inBreak = breakAt !== null && t >= breakAt && t < breakAt + breakLen;
    const bt = t % beat;
    let v = 0;
    if (!inBreak) {
      const env = Math.exp(-bt * 18);
      v += 0.9 * env * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-bt * 30)) * bt);   // bombo
      const ht = (t + beat / 2) % beat;
      v += 0.15 * Math.exp(-ht * 60) * rnd();                                          // charles a contratiempo
      v += 0.25 * Math.sin(2 * Math.PI * 55 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / beat)); // bajo
    } else {
      v += 0.12 * Math.sin(2 * Math.PI * 440 * t) * (0.6 + 0.4 * Math.sin(t * 2));      // pad suave
    }
    x[i] = v * 0.7;
  }
  return { mono: x, sr };
}

/** Batería completa: bombo en los tiempos 1 y 3, caja (ruido) en 2 y 4, charles a contratiempo y bajo con ataque suave fuera de pulso. */
export function drumKit({ bpm = 120, seconds = 24, sr = 44100, kicksOn = [0, 2], snareOn = [1, 3] } = {}) {
  const n = Math.floor(seconds * sr), x = new Float32Array(n), beat = 60 / bpm;
  let s = 99; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  let hp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, b = Math.floor(t / beat), bt = t - b * beat, inBar = b % 4;
    let v = 0;
    if (kicksOn.includes(inBar)) v += 0.95 * Math.exp(-bt * 16) * Math.sin(2 * Math.PI * (48 + 110 * Math.exp(-bt * 28)) * bt);
    const w = rnd(); hp = 0.85 * (hp + w - prev); prev = w; // ruido pasa-altos
    if (snareOn.includes(inBar)) v += 0.5 * Math.exp(-bt * 22) * hp + 0.2 * Math.exp(-bt * 30) * Math.sin(2 * Math.PI * 190 * bt);
    const ht = (t + beat / 2) % beat; v += 0.12 * Math.exp(-ht * 70) * hp;
    const bassT = (t + beat * 0.25) % (beat * 2); v += 0.22 * Math.sin(2 * Math.PI * 55 * t) * Math.min(1, bassT * 8) * Math.exp(-bassT * 1.5);
    x[i] = v * 0.7;
  }
  return { mono: x, sr, beat };
}
