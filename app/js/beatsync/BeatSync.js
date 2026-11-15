// BEAT-SYNC PHOTO ENGINE PRO — módulo independiente (sin DOM ni WebGL; se prueba también en Node).
//
// Decide qué fotografía se ve en cada instante a partir de:
//   · los golpes de bombo/caja y la rejilla de pulsos del análisis existente (no crea AudioContext ni analizadores),
//   · el modo activo (1/2 BEAT, 1 BEAT, 2 BEATS, AUTO KICK o automático apagado), que puede cambiarse durante la
//     reproducción: cada cambio queda anotado con su instante («changes»),
//   · las pulsaciones de NEXT / PREVIOUS, anotadas igualmente («nudges»).
// Todo es función pura del tiempo: la exportación vuelve a calcular exactamente los mismos cambios que se vieron.
import { createRNG, hashInt, mod } from '../core/util.js';

export const BS_MODES = [
  { value: 'half', label: '1/2 BEAT', hint: 'dos cambios por pulso' },
  { value: 'beat', label: '1 BEAT', hint: 'un cambio por pulso' },
  { value: 'two', label: '2 BEATS', hint: 'un cambio cada dos pulsos' },
  { value: 'kick', label: 'AUTO KICK', hint: 'solo en golpes de bombo reales' },
];
export const BS_TRANSITIONS = [
  { value: 'cut', label: 'Corte instantáneo' }, { value: 'crossfade', label: 'Fundido cruzado' }, { value: 'zoom', label: 'Zoom dinámico' },
  { value: 'flash', label: 'Flash sincronizado con el golpe' }, { value: 'rgbglitch', label: 'RGB Glitch' },
];
export const BS_LOOKS = [{ value: 'full', label: 'Pantalla completa' }, { value: 'back', label: 'De fondo (el 3D brilla encima)' }, { value: 'framed', label: 'Enmarcadas' }];

/** Anti-rebote global: nunca dos cambios automáticos a menos de 1/6 s (≤ 3 destellos por segundo, WCAG 2.3.1). */
export const BS_COOLDOWN = 1 / 6;

export function defaultBeatSync() {
  return { enabled: false, baseMode: 'kick', resume: 'kick', snare: false, sensitivity: 0.5, transition: 'zoom', speed: 0.7, order: 'sequential', seed: 1, look: 'full', changes: [], nudges: [] };
}

/** Modo vigente en t ('half' | 'beat' | 'two' | 'kick' | 'off'). */
export function modeAt(cfg, t) {
  let m = cfg.baseMode;
  for (const c of cfg.changes) if (c.t <= t + 1e-6) m = c.mode; else break;
  return m;
}
/** Cambia el modo desde t en adelante (durante la reproducción queda grabado en ese instante). */
export function setModeAt(cfg, t, mode) {
  cfg.changes = cfg.changes.filter((c) => c.t < t - 1e-6);
  if (t < 0.05) { cfg.baseMode = mode; cfg.changes = []; }
  else if (modeAt(cfg, t) !== mode) cfg.changes.push({ t: +t.toFixed(4), mode });
  if (mode !== 'off') cfg.resume = mode;
}
export function addNudge(cfg, t, d) { cfg.nudges.push({ t: +Math.max(0, t).toFixed(4), d }); cfg.nudges.sort((a, b) => a.t - b.t); }

// ---------------------------------------------------------------- rejillas de disparo
function beatTimes(analysis, trim, duration, step) {
  const out = [];
  const db = analysis.d?.downbeat ?? 0;
  let k = Math.ceil(analysis.beatPos(trim) / step - 1e-6) * step;
  if (step === 2) { const r = mod(Math.round(k) - db, 2); if (r) k += 2 - r; }
  for (let n = 0; n < 200000; n++, k += step) {
    const t = analysis.beatTime(k) - trim;
    if (t >= duration - 0.02) break;
    if (t > 0.02) out.push(t);
  }
  return out;
}
function kickTimes(analysis, trim, duration, cfg) {
  const hits = analysis.drumHits ? analysis.drumHits({ mode: cfg.snare ? 'hits' : 'kicks', minGap: Math.max(BS_COOLDOWN, 0.2), sensitivity: cfg.sensitivity ?? 0.5 }) : [];
  return hits.map((h) => h.t - trim).filter((t) => t > 0.02 && t < duration - 0.02);
}

const cache = new WeakMap();
/**
 * Lista ordenada de cambios de foto: [{ t, d, manual, n }], donde n es el número de foto acumulado.
 * El primero es siempre { t: 0, n: 0 }. Se guarda en caché por análisis + configuración.
 */
export function buildEvents(cfg, analysis, trim, duration) {
  const key = JSON.stringify([cfg.baseMode, cfg.changes, cfg.nudges, cfg.snare, cfg.sensitivity, trim, duration]);
  const hit = cache.get(analysis);
  if (hit && hit.key === key) return hit.events;
  const grids = {};
  const grid = (m) => grids[m] || (grids[m] = m === 'kick' ? kickTimes(analysis, trim, duration, cfg) : beatTimes(analysis, trim, duration, { half: 0.5, beat: 1, two: 2 }[m]));
  const points = [{ t: 0, mode: cfg.baseMode }, ...cfg.changes.filter((c) => c.t < duration)];
  const raw = [];
  points.forEach((pt, i) => {
    if (pt.mode === 'off') return;
    const a = pt.t, b = i + 1 < points.length ? points[i + 1].t : duration;
    for (const t of grid(pt.mode)) if (t >= a && t < b) raw.push({ t, d: 1, manual: false });
  });
  for (const nd of cfg.nudges) if (nd.t < duration) raw.push({ t: nd.t, d: nd.d, manual: true });
  raw.sort((x, y) => x.t - y.t || (x.manual ? 1 : -1));
  // anti-rebote y duplicados: un disparo automático demasiado cerca del anterior se descarta
  const events = [{ t: 0, d: 0, manual: false, n: 0 }];
  let n = 0;
  for (const e of raw) {
    const last = events[events.length - 1];
    if (!e.manual && e.t - last.t < BS_COOLDOWN && events.length > 1) continue;
    if (!e.manual && e.t < 0.05) continue;
    n += e.d;
    events.push({ t: e.t, d: e.d, manual: e.manual, n });
  }
  cache.set(analysis, { key, events });
  return events;
}

/** Índice del último evento cuyo instante (menos adelanto) es ≤ t. */
function findEvent(starts, t) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= t) lo = m; else hi = m - 1; }
  return lo;
}

// ---------------------------------------------------------------- orden de las fotos
const perms = new Map();
function permutation(N, seed, cycle) {
  const key = `${N}|${seed}|${cycle}`;
  if (perms.has(key)) return perms.get(key);
  const rng = createRNG(hashInt((seed >>> 0) ^ hashInt(cycle * 2654435761)));
  const p = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  if (perms.size > 500) perms.clear();
  perms.set(key, p);
  return p;
}
/** Foto nº n: secuencial, o aleatorio sin repetir hasta agotar todas (y sin repetir al empezar otra vuelta). */
export function photoIndex(n, N, order, seed = 1) {
  if (N <= 0) return -1;
  if (order !== 'random' || N < 3) return mod(n, N);
  const cycle = Math.floor(n / N), pos = mod(n, N);
  const p = permutation(N, seed, cycle);
  if (pos === 0) { const prev = permutation(N, seed, cycle - 1); if (prev[N - 1] === p[0]) return p[1]; }
  if (pos === 1) { const prev = permutation(N, seed, cycle - 1); if (prev[N - 1] === p[0]) return p[0]; }
  return p[pos];
}

// ---------------------------------------------------------------- transiciones
const lerp = (a, b, k) => a + (b - a) * k;
/** Duración nominal de la transición según «velocidad» (0 lenta … 1 rápida). */
export const transitionSeconds = (speed) => lerp(0.5, 0.04, Math.min(1, Math.max(0, speed ?? 0.7)));
const MOTIONS = ['in', 'out', 'in', 'drift'];

function timing(cfg, events, i) {
  const e = events[i];
  if (i === 0) return { fade: 0.3, lead: 0 };
  const gap = e.t - events[i - 1].t, T = transitionSeconds(cfg.speed);
  if (cfg.transition === 'cut') return { fade: 0, lead: 0 };
  if (cfg.transition === 'crossfade') { const fade = Math.min(T, gap * 0.45); return { fade, lead: e.manual ? 0 : fade / 2 }; }
  // zoom / flash / rgb glitch: entrada de ~3 fotogramas, completa justo en el golpe; el efecto decae después
  const fade = Math.min(0.09, T, gap * 0.4);
  return { fade, lead: e.manual ? 0 : fade };
}

/**
 * Clips virtuales de foto para el instante t (la foto vigente y, durante el fundido, la anterior debajo).
 * Usa solo dos identificadores ('bs_a' / 'bs_b'): el motor reutiliza dos capas y no crea geometría en cada cambio.
 */
export function clipsAt(cfg, events, photos, t, duration) {
  const N = photos.length;
  if (!N || !events.length) return [];
  if (!events._starts || events._key !== `${cfg.transition}|${cfg.speed}`) {
    events._starts = events.map((e, i) => e.t - timing(cfg, events, i).lead);
    events._key = `${cfg.transition}|${cfg.speed}`;
  }
  const i = findEvent(events._starts, t);
  const mk = (j) => {
    const e = events[j], tm = timing(cfg, events, j), s = events._starts[j];
    const nextS = j + 1 < events.length ? events._starts[j + 1] : duration;
    const nextFade = j + 1 < events.length ? timing(cfg, events, j + 1).fade : 0;
    const ph = photos[photoIndex(e.n, N, cfg.order, cfg.seed)];
    const fx = j === 0 || cfg.transition === 'cut' || cfg.transition === 'crossfade' ? 'none' : { zoom: 'punch', flash: 'flash', rgbglitch: 'rgbglitch' }[cfg.transition];
    return {
      id: j % 2 ? 'bs_b' : 'bs_a', track: 'photos', type: 'photo', start: s, dur: Math.max(0.05, nextS - s + nextFade + 0.05), beatSync: true, event: j,
      params: {
        photoId: ph.id, effect: 'cinezoom', effectAmount: 0.3, motion: MOTIONS[mod(e.n, MOTIONS.length)], motionAmount: 0.35, parallax: 0.2, depth: 0.2, react: 0.5,
        fadeIn: tm.fade, fadeOut: 0, blend: cfg.look === 'back' ? 'back' : 'front', frame: cfg.look === 'framed' ? 'hexagon' : 'none', matchLuma: true,
        hitFx: fx, hitAmount: 0.85, hitDelay: tm.lead, hitDecay: Math.max(0.1, transitionSeconds(cfg.speed)),
      },
    };
  };
  const cur = mk(i);
  if (i > 0 && t < events._starts[i] + timing(cfg, events, i).fade + 0.02) return [mk(i - 1), cur];
  return [cur];
}

/** Resumen para la interfaz: foto visible, modo y número de cambios. */
export function stateAt(cfg, events, photos, t) {
  let i = 0, lo = 0, hi = events.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (events[m].t <= t + 1e-6) { i = m; lo = m + 1; } else hi = m - 1; }
  const idx = photoIndex(events[i].n, photos.length, cfg.order, cfg.seed);
  return { event: i, n: events[i].n, index: idx, photo: photos[idx] || null, mode: modeAt(cfg, t), total: events.length - 1 };
}
