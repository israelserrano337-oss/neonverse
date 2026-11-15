// Web Worker: ejecuta el análisis musical sin bloquear la interfaz.
import { analyze, transferables } from './analysis-core.js';
self.onmessage = (e) => {
  const { id, mono, sampleRate } = e.data;
  try {
    const result = analyze(mono, sampleRate, (p) => self.postMessage({ id, progress: p }));
    self.postMessage({ id, result }, transferables(result));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
