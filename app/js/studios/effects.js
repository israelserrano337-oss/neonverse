// Efectos de posproceso de la pista «Efectos» y filtros globales.
import { FILTER_IDS } from '../engine/glsl.js';
import { FILTER_LABELS } from './photos.js';

export const EFFECTS = [
  ['glitch', 'Glitch'], ['rgbsplit', 'RGB Split'], ['chromatic', 'Aberración cromática'], ['shake', 'Temblor de cámara'],
  ['zoompulse', 'Pulso de zoom'], ['waves', 'Ondas'], ['mirror', 'Espejo / caleidoscopio'], ['scanlines', 'Líneas de escaneo'],
  ['noise', 'Grano'], ['vignette', 'Viñeta'], ['pixelate', 'Pixelado'], ['flash', 'Destello suave'], ['bloomboost', 'Resplandor extra'],
  ['filter', 'Filtro de color'],
].map(([id, label]) => ({ id, label }));
export const EFFECT_BY_ID = Object.fromEntries(EFFECTS.map((x) => [x.id, x]));

export const EFFECT_PARAMS = [
  { key: 'amount', label: 'Cantidad', min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: 'sync', label: 'Sincronía', options: [{ value: 'beat', label: 'Con cada golpe' }, { value: 'bar', label: 'Con cada compás' }, { value: 'continuous', label: 'Continuo' }], value: 'beat' },
  { key: 'rate', label: 'Frecuencia', min: 0.25, max: 4, step: 0.25, value: 1 },
  { key: 'filter', label: 'Filtro (si es «Filtro de color»)', options: FILTER_IDS.map((id) => ({ value: id, label: FILTER_LABELS[id] })), value: 'cyberpunk' },
];

export const FILTERS = FILTER_IDS.map((id) => ({ id, label: FILTER_LABELS[id] }));

export const LIGHTING_PARAMS = [
  { key: 'palette', label: 'Paleta', type: 'palette', value: 'cyber' },
  { key: 'brightness', label: 'Brillo', min: 0.3, max: 1.6, step: 0.01, value: 1 },
  { key: 'bloom', label: 'Resplandor', min: 0, max: 2, step: 0.01, value: 1 },
  { key: 'saturation', label: 'Saturación', min: 0, max: 2, step: 0.01, value: 1 },
  { key: 'hueShift', label: 'Giro de tono', min: -0.5, max: 0.5, step: 0.01, value: 0 },
  { key: 'pulse', label: 'Pulso al ritmo', min: 0, max: 1, step: 0.01, value: 0.3 },
];
