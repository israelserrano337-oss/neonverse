// Decodificación de la música y lanzamiento del análisis en el Worker.
import { Analysis } from './analysis.js';
import { analyze } from './analysis-core.js';

let ctx = null;
export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  return ctx;
}

export async function decodeAudio(arrayBuffer) {
  const ac = audioContext();
  // Safari antiguo solo admite la forma con callbacks
  return new Promise((resolve, reject) => {
    const p = ac.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

export function mixToMono(buffer) {
  const n = buffer.length, ch = buffer.numberOfChannels;
  const mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
  return mono;
}

let seq = 0;
export function analyzeBuffer(buffer, onProgress = () => {}) {
  const mono = mixToMono(buffer);
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' }); }
    catch (e) { worker = null; }
    if (!worker) { // sin workers de módulo: análisis en el hilo principal
      try { resolve(new Analysis(analyze(mono, buffer.sampleRate, onProgress))); } catch (e) { reject(e); }
      return;
    }
    const id = ++seq;
    const timer = setTimeout(() => { worker.terminate(); fallback(); }, 120000);
    const fallback = () => { try { resolve(new Analysis(analyze(mono, buffer.sampleRate, onProgress))); } catch (e) { reject(e); } };
    worker.onmessage = (e) => {
      if (e.data.id !== id) return;
      if (e.data.progress !== undefined) return onProgress(e.data.progress);
      clearTimeout(timer);
      worker.terminate();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(new Analysis(e.data.result));
    };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); console.warn('Worker de análisis falló; uso el hilo principal', e.message); fallback(); };
    const copy = mono.slice(); // la copia viaja al worker; el original queda para el plan B
    worker.postMessage({ id, mono: copy, sampleRate: buffer.sampleRate }, [copy.buffer]);
  });
}
