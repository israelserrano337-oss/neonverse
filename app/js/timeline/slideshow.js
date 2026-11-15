// Pase de fotos al ritmo: cada cambio de foto cae exactamente en un golpe (o compás) de la música,
// con fundido cruzado entre fotos (la siguiente entra encima de la anterior: nunca pasa por negro).
import { uid } from '../core/util.js';

export const SLIDE_EVERY = [
  { value: 'hits', label: 'En cada golpe de batería (bombo y caja)' }, { value: 'kicks', label: 'En cada bombo' }, { value: 'strong', label: 'Solo en los golpes fuertes' },
  { value: 1, label: 'Cada pulso (rejilla regular)' }, { value: 2, label: 'Cada 2 golpes' }, { value: 4, label: 'Cada compás' },
  { value: 8, label: 'Cada 2 compases' }, { value: 16, label: 'Cada 4 compases' },
];
export const SLIDE_LOOKS = [
  { value: 'full', label: 'Pantalla completa' },
  { value: 'framed', label: 'Enmarcadas en el túnel' },
  { value: 'back', label: 'De fondo (el 3D brilla encima)' },
];
const VARIED_FX = ['cinezoom', 'parallax', 'zoom3d', 'camera', 'depth', 'flares', 'cinezoom', 'neon'];
// Con cambios rápidos solo efectos de movimiento: los de luz (neón, destellos) cambiarían el brillo en cada golpe
const FAST_FX = ['cinezoom', 'parallax', 'zoom3d', 'camera'];
const MOTIONS = ['in', 'out', 'left', 'right', 'in', 'drift'];
export const SLIDE_HITFX = [
  { value: 'varied', label: 'Variado' }, { value: 'punch', label: 'Zoom de impacto' }, { value: 'glitch', label: 'Glitch' }, { value: 'rgb', label: 'RGB' },
  { value: 'shake', label: 'Sacudida' }, { value: 'flash', label: 'Destello suave' }, { value: 'none', label: 'Sin efecto (corte seco)' },
];
const VARIED_HIT = ['punch', 'rgb', 'punch', 'glitch', 'shake', 'punch', 'rgb', 'flash'];
export const isHitMode = (e) => e === 'hits' || e === 'kicks' || e === 'strong';

/** Golpes de batería en tiempo de línea de tiempo (0 = inicio del recorte). */
export function hitGrid(analysis, trimStart, duration, mode, minGap = 0.25) {
  minGap = Math.max(0.25, minGap); // nunca más de 4 cambios por segundo (≤ 2 destellos/s; la norma WCAG 2.3.1 marca 3)
  const hits = analysis.drumHits ? analysis.drumHits({ mode, minGap }) : [];
  const out = [0];
  for (const h of hits) { const t = h.t - trimStart; if (t <= 0.05 || t >= duration - 0.05) continue; if (t - out[out.length - 1] >= minGap * 0.95) out.push(t); }
  return out;
}

/** Instantes (en tiempo de la línea de tiempo) de los golpes múltiplos de `every`, alineados al compás. */
export function beatGrid(analysis, trimStart, duration, every) {
  const db = analysis.d?.downbeat ?? 0;
  const out = [0];
  let k = Math.ceil(analysis.beatPos(trimStart) - 1e-6);
  if (every > 1) { const r = (((k - db) % every) + every) % every; if (r) k += every - r; }
  for (let n = 0; n < 100000; n++, k += every) {
    const t = analysis.beatTime(k) - trimStart;
    if (t >= duration - 0.05) break;
    if (t > out[out.length - 1] + 0.12) out.push(t);
  }
  return out;
}

/**
 * Crea los clips del pase.
 * @param {object} o { project, analysis, duration, every, look, effect ('varied' o id), t0, t1 }
 */
export function buildSlideshow(o) {
  const { project, analysis, duration } = o;
  const photos = project.photos;
  if (!photos.length) return [];
  const t0 = o.t0 ?? 0, t1 = Math.min(duration, o.t1 ?? duration);
  const trim = project.audio?.trimStart || 0;
  const every = o.every ?? 4, hitMode = isHitMode(every);
  let times = hitMode ? hitGrid(analysis, trim, duration, every, o.minGap ?? 0.25) : beatGrid(analysis, trim, duration, every);
  // sin batería suficiente (o sin música): rejilla de pulsos
  if (hitMode && times.length < (t1 - t0) / 4) times = beatGrid(analysis, trim, duration, 1);
  times = times.filter((t) => t >= t0 - 1e-3 && t < t1 - 0.05);
  if (!times.length || times[0] > t0 + 0.05) times.unshift(t0);
  const look = o.look || 'full';
  const fast = hitMode || every <= 2;
  const fxList = fast ? FAST_FX : VARIED_FX;
  const ovFrac = fast ? 0.5 : 0.3;
  const hitFx = o.hitFx ?? (hitMode ? 'varied' : 'none');
  const clips = [];
  times.forEach((start, j) => {
    const end = j + 1 < times.length ? times[j + 1] : t1;
    const seg = end - start;
    const last = j === times.length - 1;
    // Fundido cruzado: la foto siguiente entra encima durante `ov`; esta sigue entera debajo.
    // golpes: casi corte seco (2 fotogramas) para que el cambio «pegue» con la batería
    const ov = last ? 0 : hitMode ? Math.min(0.1, seg * 0.3) : Math.min(0.4, Math.max(0.1, seg * ovFrac));
    const ph = photos[j % photos.length];
    const effect = o.effect && o.effect !== 'varied' ? o.effect : fxList[j % fxList.length];
    const prevSeg = j ? times[j] - times[j - 1] : seg;
    const lead = hitMode && j > 0 ? Math.min(0.07, prevSeg * 0.2) : 0; // la foto nueva ya está entera justo en el golpe
    clips.push({
      id: uid('c'), track: 'photos', type: 'photo', start: +(start - lead).toFixed(4), dur: +(seg + ov + lead).toFixed(4),
      params: {
        photoId: ph.id, effect, effectAmount: 0.55, motion: MOTIONS[j % MOTIONS.length], motionAmount: 0.5,
        parallax: 0.3, depth: 0.2, react: 0.7,
        fadeIn: j === 0 ? Math.min(0.5, seg * 0.4) : hitMode ? Math.min(0.1, (times[j] - times[j - 1]) * 0.3) : Math.min(0.4, Math.max(0.1, (times[j] - times[j - 1]) * ovFrac)),
        matchLuma: hitMode, hitDelay: +lead.toFixed(4),
        hitFx: j === 0 ? 'none' : hitFx === 'varied' ? VARIED_HIT[j % VARIED_HIT.length] : hitFx, hitAmount: 0.8,
        fadeOut: last ? Math.min(0.5, seg * 0.4) : 0,
        blend: look === 'back' ? 'back' : 'front',
        frame: look === 'framed' ? ['hexagon', 'circle', 'neonframe', 'diamond'][Math.floor(j / Math.max(1, photos.length)) % 4] : 'none',
        slideshow: true,
      },
    });
  });
  return clips;
}
