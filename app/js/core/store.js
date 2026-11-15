// Estado del proyecto + historial de deshacer/rehacer + eventos.
import { deepClone } from './util.js';
import { defaultBeatSync } from '../beatsync/BeatSync.js';

export const TRACKS = ['photos', 'tunnels', 'meshes', 'equalizers', 'particles', 'transitions', 'lighting', 'effects'];
export const TRACK_LABELS = {
  music: 'Música', photos: 'Fotografías', tunnels: 'Túneles', meshes: 'Mallas', equalizers: 'Ecualizadores', particles: 'Partículas',
  transitions: 'Transiciones', lighting: 'Iluminación', effects: 'Efectos',
};

export const DIRECTOR_CONTROLS = [
  { key: 'intensity', label: 'Intensidad visual', min: 0, max: 1, step: 0.01, value: 0.7 },
  { key: 'sceneSpeed', label: 'Velocidad de escenas', min: 0, max: 1, step: 0.01, value: 0.55 },
  { key: 'transitionFreq', label: 'Frecuencia de transiciones', min: 0, max: 1, step: 0.01, value: 0.6 },
  { key: 'aggression', label: 'Agresividad de efectos', min: 0, max: 1, step: 0.01, value: 0.45 },
  { key: 'photoAmount', label: 'Cantidad de fotografías', min: 0, max: 1, step: 0.01, value: 0.6 },
  { key: 'sceneDuration', label: 'Duración de escenas', min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: 'camera', label: 'Movimiento de cámara', min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: 'particles', label: 'Densidad de partículas', min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: 'complexity', label: 'Complejidad 3D', min: 0, max: 1, step: 0.01, value: 0.6 },
  { key: 'sensitivity', label: 'Sensibilidad musical', min: 0, max: 1, step: 0.01, value: 0.65 },
  { key: 'equalizers', label: 'Ecualizadores 3D', min: 0, max: 1, step: 0.01, value: 0.4 },
];

export const SYNC_MODULES = [
  ['tunnels', 'Túneles'], ['meshes', 'Mallas'], ['equalizers', 'Ecualizadores'], ['photos', 'Fotografías'], ['particles', 'Partículas'],
  ['lighting', 'Iluminación'], ['effects', 'Efectos'], ['transitions', 'Transiciones'],
];

export function defaultSync() {
  const modules = {};
  for (const [k] of SYNC_MODULES) modules[k] = { enabled: true, bass: 1, mid: 1, treble: 1, beat: 1 };
  return { global: 1, offsetMs: 0, smoothing: 0.5, beatSnap: true, modules };
}

export function newProject(name = 'Proyecto sin título') {
  const now = new Date().toISOString();
  const controls = {};
  for (const c of DIRECTOR_CONTROLS) controls[c.key] = c.value;
  return {
    format: 'neonverse-project', version: 2, name, createdAt: now, updatedAt: now,
    seed: 20261114,
    aspect: '9:16', customSize: { w: 1080, h: 1920 },
    duration: 30, // sin música: duración libre de la composición
    audio: null, // { mediaId, name, duration, trimStart, trimEnd, markers:[], bpm }
    photos: [], // { id, mediaId, name, w, h, luma, settings }
    palette: { id: 'cyber', colors: ['#00f0ff', '#8a2bff', '#ff2bd6'], gradient: 'smooth', direction: 0, speed: 0.15, brightness: 1, saturation: 1, intensity: 1, auto: false, autoEvery: 8, musicSync: 0.4 },
    customPalettes: [],
    filters: {}, // filtro global: { id: cantidad }
    sync: defaultSync(),
    director: { profile: 'cyberpunk', controls, seed: 20261114, scenes: [], safeCuts: true },
    timeline: { tracks: Object.fromEntries(TRACKS.map((t) => [t, []])), markers: [] },
    render: { bloom: 0.7, bloomThreshold: 0.62, vignette: 0.35, grain: 0.035, exposure: 0.9 },
    export: { preset: 'tiktok', width: 1080, height: 1920, fps: 30, codec: 'h264', quality: 'high', bitrate: 0, audioBitrate: 192, fileName: 'neonverse-video', range: 'all' },
    studio: { tunnels: [], meshes: [], particles: [], equalizers: [] },
  };
}

/** Rellena campos que falten en proyectos antiguos o importados. */
export function normalizeProject(p) {
  const base = newProject(p?.name || 'Proyecto');
  const out = Object.assign(base, deepClone(p || {}));
  out.timeline = out.timeline || base.timeline;
  out.timeline.tracks = out.timeline.tracks || {};
  for (const t of TRACKS) if (!Array.isArray(out.timeline.tracks[t])) out.timeline.tracks[t] = [];
  out.timeline.markers = out.timeline.markers || [];
  out.sync = Object.assign(defaultSync(), out.sync || {});
  for (const [k] of SYNC_MODULES) out.sync.modules[k] = Object.assign({ enabled: true, bass: 1, mid: 1, treble: 1, beat: 1 }, out.sync.modules?.[k] || {});
  out.director = Object.assign(newProject().director, out.director || {});
  out.studio = Object.assign({ tunnels: [], meshes: [], particles: [], equalizers: [] }, out.studio || {});
  out.beatSync = Object.assign(defaultBeatSync(), out.beatSync || {});
  return out;
}

export class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) { if (!this._h.has(ev)) this._h.set(ev, new Set()); this._h.get(ev).add(fn); return () => this._h.get(ev)?.delete(fn); }
  emit(ev, data) { this._h.get(ev)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(`[evento ${ev}]`, e); } }); }
}

/**
 * Almacén con historial. Las mutaciones pasan por `commit(label, fn)`, que guarda
 * una instantánea anterior para deshacer. Los cambios continuos (deslizadores) usan
 * `live(fn)` y se agrupan en un solo paso al soltar (`settle(label)`).
 */
export class Store extends Emitter {
  constructor(project) {
    super();
    this.project = normalizeProject(project || newProject());
    this.undoStack = [];
    this.redoStack = [];
    this.limit = 120;
    this._pending = null;
    this.selection = { clipId: null, track: null, photoId: null };
    this.version = 0;
  }
  _snap() { return JSON.stringify({ ...this.project, studio: undefined }); }
  _changed(kind) { this.version++; this.project.updatedAt = new Date().toISOString(); this.emit('change', kind); }
  commit(label, fn, kind = 'edit') {
    this._flushPending();
    const before = this._snap();
    fn(this.project);
    this.undoStack.push({ label, state: before });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._changed(kind);
    this.emit('history');
  }
  /** Cambio continuo: se aplica ya, el paso de historial se crea con settle(). */
  live(fn, kind = 'live') {
    if (!this._pending) this._pending = this._snap();
    fn(this.project);
    this._changed(kind);
  }
  settle(label = 'Ajuste') {
    if (!this._pending) return;
    this.undoStack.push({ label, state: this._pending });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._pending = null;
    this.emit('history');
  }
  _flushPending() { if (this._pending) this.settle('Ajuste'); }
  _restore(json) {
    const studio = this.project.studio;
    this.project = normalizeProject(JSON.parse(json));
    this.project.studio = studio;
  }
  undo() {
    this._flushPending();
    const step = this.undoStack.pop();
    if (!step) return false;
    this.redoStack.push({ label: step.label, state: this._snap() });
    this._restore(step.state);
    this._changed('history');
    this.emit('history');
    return step.label;
  }
  redo() {
    const step = this.redoStack.pop();
    if (!step) return false;
    this.undoStack.push({ label: step.label, state: this._snap() });
    this._restore(step.state);
    this._changed('history');
    this.emit('history');
    return step.label;
  }
  replace(project, kind = 'load') {
    this.project = normalizeProject(project);
    this.undoStack.length = 0; this.redoStack.length = 0; this._pending = null;
    this.selection = { clipId: null, track: null, photoId: null };
    this._changed(kind);
    this.emit('history');
  }
  select(sel) { this.selection = Object.assign({ clipId: null, track: null, photoId: null }, sel); this.emit('select', this.selection); }

  // --- consultas de clips ---
  findClip(id) {
    for (const t of TRACKS) { const c = this.project.timeline.tracks[t].find((x) => x.id === id); if (c) return c; }
    return null;
  }
  /** Duración total: música recortada o duración libre. */
  get duration() {
    const a = this.project.audio;
    if (a && a.duration) return Math.max(0.5, (a.trimEnd || a.duration) - (a.trimStart || 0));
    return this.project.duration || 30;
  }
}
