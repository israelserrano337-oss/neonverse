// Modelo de la línea de tiempo: evaluación pura en t y operaciones de edición (cortar, mover, duplicar…).
import { TRACKS } from '../core/store.js';
import { uid, deepClone } from '../core/util.js';

const EPS = 1e-4;
export const isActive = (c, t) => t >= c.start - EPS && t < c.start + c.dur - EPS;
export const activeIn = (clips, t) => clips.filter((c) => isActive(c, t)).sort((a, b) => (a.lane || 0) - (b.lane || 0) || a.start - b.start || (a.id < b.id ? -1 : 1));

// Proveedor opcional de fotos (Beat-Sync Photo Engine): si devuelve clips, sustituyen a la pista de fotos en t.
let photoProvider = null;
export function setPhotoProvider(fn) { photoProvider = fn; }

const KINDS_3D = ['tunnels', 'meshes', 'equalizers', 'particles'];
const DEFAULT_BG = [{ id: 'bg_rings', type: 'rings', params: { speed: 0.6, glow: 1 }, start: 0, dur: 1e9 }];
/** ¿La línea de tiempo tiene algún clip 3D? Si no, el vídeo usa las capas de los estudios (lo mismo que se ve). */
export const has3D = (project) => KINDS_3D.some((k) => (project.timeline.tracks[k] || []).length > 0);
/** Capas de los estudios (túneles + mallas + ecualizadores + partículas combinados) como fondo de todo el vídeo. */
export function studioBackground(project) {
  const A = { tunnels: [], meshes: [], equalizers: [], particles: [] };
  for (const k of KINDS_3D) A[k] = (project.studio?.[k] || []).filter((c) => !c.hidden).map((c) => ({ ...c, start: 0, dur: 1e9 }));
  if (!KINDS_3D.some((k) => A[k].length)) A.tunnels = DEFAULT_BG;
  return A;
}

function layerSet(tracks, t, project) {
  const photos = project.showPhotos === false ? [] : (photoProvider && photoProvider(project, t)) || activeIn(tracks.photos, t);
  if (!has3D(project)) return { photos, ...studioBackground(project) };
  return { photos, tunnels: activeIn(tracks.tunnels, t), meshes: activeIn(tracks.meshes, t), equalizers: activeIn(tracks.equalizers || [], t), particles: activeIn(tracks.particles, t) };
}

/** Qué hay que dibujar en t: capas A (y B si hay transición), iluminación y efectos activos. */
export function evaluate(project, t) {
  const tr = project.timeline.tracks;
  const transition = tr.transitions.find((c) => isActive(c, t)) || null;
  let A, B = null, progress = 0;
  if (transition) {
    A = layerSet(tr, transition.start - 2e-3, project);
    B = layerSet(tr, transition.start + transition.dur + 2e-3, project);
    progress = (t - transition.start) / transition.dur;
  } else A = layerSet(tr, t, project);
  const lit = activeIn(tr.lighting, t);
  const current = lit.length ? lit.reduce((a, b) => (b.start > a.start ? b : a)) : null;
  let previous = null;
  if (current) {
    const before = tr.lighting.filter((c) => c !== current && c.start < current.start + EPS && isActive(c, current.start - 0.01));
    previous = before.length ? before[before.length - 1] : tr.lighting.filter((c) => c.start + c.dur <= current.start + 0.05).sort((a, b) => b.start - a.start)[0] || null;
  }
  return { A, B, transition, progress, lighting: { current, previous }, effects: activeIn(tr.effects, t) };
}

/** Composición de estudio: lo que se edita en un estudio, sin línea de tiempo (vista previa en solitario). */
export function studioComposition(studio, kinds, t) {
  const A = { photos: [], tunnels: [], meshes: [], equalizers: [], particles: [] };
  for (const k of kinds) A[k] = (studio[k] || []).filter((c) => !c.hidden).map((c) => ({ ...c, start: 0, dur: 1e9 }));
  return { A, B: null, transition: null, progress: 0, lighting: { current: null, previous: null }, effects: [] };
}

// ------------------------------------------------------------ operaciones (se usan dentro de store.commit)
export function trackOf(project, id) { for (const t of TRACKS) if (project.timeline.tracks[t].some((c) => c.id === id)) return t; return null; }
export function getClip(project, id) { const t = trackOf(project, id); return t ? project.timeline.tracks[t].find((c) => c.id === id) : null; }

export function addClip(project, track, clip) {
  const c = { id: clip.id || uid('c'), track, type: clip.type, start: Math.max(0, clip.start || 0), dur: Math.max(0.1, clip.dur || 4), params: deepClone(clip.params || {}), ...(clip.sceneId ? { sceneId: clip.sceneId } : {}) };
  project.timeline.tracks[track].push(c);
  sortTrack(project, track);
  return c;
}
export function removeClip(project, id) {
  const t = trackOf(project, id); if (!t) return false;
  project.timeline.tracks[t] = project.timeline.tracks[t].filter((c) => c.id !== id);
  return true;
}
export function moveClip(project, id, start, snap) {
  const c = getClip(project, id); if (!c) return;
  c.start = Math.max(0, snap ? snap(start) : start);
  sortTrack(project, trackOf(project, id));
}
export function resizeClip(project, id, start, dur) {
  const c = getClip(project, id); if (!c) return;
  c.start = Math.max(0, start); c.dur = Math.max(0.1, dur);
}
/** Corta un clip en t: el original termina en t y se crea otro desde t. */
export function splitClip(project, id, t) {
  const c = getClip(project, id); if (!c || t <= c.start + 0.05 || t >= c.start + c.dur - 0.05) return null;
  const right = deepClone(c);
  right.id = uid('c'); right.start = t; right.dur = c.start + c.dur - t;
  c.dur = t - c.start;
  project.timeline.tracks[trackOf(project, id)].push(right);
  sortTrack(project, c.track);
  return right;
}
export function duplicateClip(project, id) {
  const c = getClip(project, id); if (!c) return null;
  const d = deepClone(c);
  d.id = uid('c'); d.start = c.start + c.dur; delete d.frozen;
  project.timeline.tracks[c.track].push(d);
  sortTrack(project, c.track);
  return d;
}
export function sortTrack(project, track) { if (track) project.timeline.tracks[track].sort((a, b) => a.start - b.start || (a.lane || 0) - (b.lane || 0)); }

/** Asigna carriles para dibujar clips solapados uno encima de otro. */
export function computeLanes(clips) {
  const ends = [];
  const lanes = new Map();
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    let l = ends.findIndex((e) => e <= c.start + 1e-3);
    if (l < 0) { l = ends.length; ends.push(0); }
    ends[l] = c.start + c.dur;
    lanes.set(c.id, l);
  }
  return { lanes, count: Math.max(1, ends.length) };
}

export function timelineEnd(project) {
  let e = 0;
  for (const t of TRACKS) for (const c of project.timeline.tracks[t]) e = Math.max(e, c.start + c.dur);
  return e;
}
