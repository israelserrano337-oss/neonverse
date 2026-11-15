// Paletas de tres colores fluorescentes: preajustes, personalizadas y resolución por fotograma.
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/util.js';

export const PALETTE_PRESETS = [
  { id: 'cyber', name: 'Cian · Violeta · Magenta', colors: ['#00f0ff', '#8a2bff', '#ff2bd6'] },
  { id: 'laser', name: 'Verde láser · Turquesa · Amarillo', colors: ['#39ff14', '#00e5c7', '#ffe600'] },
  { id: 'pinkblue', name: 'Rosa · Púrpura · Azul eléctrico', colors: ['#ff4fd8', '#9d3cff', '#1f6bff'] },
  { id: 'plasma', name: 'Rojo plasma · Naranja · Amarillo', colors: ['#ff1e3c', '#ff7a00', '#ffd400'] },
  { id: 'ice', name: 'Azul hielo · Ultravioleta · Fucsia', colors: ['#7df9ff', '#6a00ff', '#ff00c8'] },
  { id: 'sunset', name: 'Atardecer synthwave', colors: ['#ff2975', '#f222ff', '#8c1eff'] },
  { id: 'toxic', name: 'Tóxico', colors: ['#b6ff00', '#00ff9c', '#00b3ff'] },
  { id: 'gold', name: 'Oro y cian', colors: ['#ffc400', '#00e1ff', '#ff3d81'] },
  { id: 'blood', name: 'Rojo industrial', colors: ['#ff0033', '#ff5e00', '#ffffff'] },
  { id: 'aurora', name: 'Aurora', colors: ['#00ffa3', '#00b7ff', '#b100ff'] },
];

export const PALETTE_PARAMS = [
  { key: 'gradient', label: 'Degradado', options: [{ value: 'smooth', label: 'Suave' }, { value: 'hard', label: 'Bandas' }], value: 'smooth' },
  { key: 'direction', label: 'Dirección', options: [{ value: 0, label: 'A lo largo de la profundidad' }, { value: 1, label: 'Alrededor' }], value: 0 },
  { key: 'speed', label: 'Velocidad', min: 0, max: 1, step: 0.01, value: 0.15 },
  { key: 'brightness', label: 'Brillo', min: 0.3, max: 1.8, step: 0.01, value: 1 },
  { key: 'saturation', label: 'Saturación', min: 0, max: 1.5, step: 0.01, value: 1 },
  { key: 'intensity', label: 'Intensidad', min: 0.2, max: 2, step: 0.01, value: 1 },
  { key: 'auto', label: 'Cambio automático', type: 'toggle', value: false },
  { key: 'autoEvery', label: 'Cambiar cada (compases)', min: 2, max: 32, step: 1, value: 8 },
  { key: 'musicSync', label: 'Sincronización musical', min: 0, max: 1, step: 0.01, value: 0.4 },
];

export function allPalettes(project) { return [...PALETTE_PRESETS, ...(project.customPalettes || [])]; }
export function paletteColors(project, id) {
  const p = allPalettes(project).find((x) => x.id === id);
  return p ? p.colors : project.palette.colors;
}

const tmp = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
const tmpB = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
function setColors(out, hexes) { for (let i = 0; i < 3; i++) out[i].set(hexes[i] || '#ffffff'); return out; }
function mixColors(a, b, k) { for (let i = 0; i < 3; i++) a[i].lerp(b[i], k); return a; }

/**
 * Paleta en el instante t: base del proyecto, cambio automático por compases, clips de iluminación
 * (con fundido de 0,6 s entre clips) y desplazamiento musical. Devuelve colores ya ajustados.
 */
export function resolvePalette(project, lighting, t, a) {
  const pal = project.palette;
  setColors(tmp, pal.colors);
  if (pal.auto && !lighting.current) {
    const presets = PALETTE_PRESETS;
    const every = Math.max(1, pal.autoEvery || 8);
    const pos = (a.barPos || 0) / every;
    const i = Math.floor(pos), k = smoothstep(1 - 1 / every, 1, pos - i);
    setColors(tmp, presets[((i % presets.length) + presets.length) % presets.length].colors);
    setColors(tmpB, presets[(((i + 1) % presets.length) + presets.length) % presets.length].colors);
    mixColors(tmp, tmpB, k);
  }
  let brightness = pal.brightness ?? 1, saturation = pal.saturation ?? 1, hueShift = 0, bloom = 1, pulse = 0;
  const cur = lighting.current;
  if (cur) {
    const cp = cur.params || {};
    setColors(tmp, paletteColors(project, cp.palette));
    const k = smoothstep(0, 0.6, t - cur.start);
    if (lighting.previous && k < 1) { setColors(tmpB, paletteColors(project, lighting.previous.params?.palette)); mixColors(tmpB, tmp, k); for (let i = 0; i < 3; i++) tmp[i].copy(tmpB[i]); }
    brightness *= cp.brightness ?? 1; saturation *= cp.saturation ?? 1; hueShift = cp.hueShift ?? 0; bloom = cp.bloom ?? 1; pulse = cp.pulse ?? 0;
  }
  for (const c of tmp) {
    if (hueShift || saturation !== 1) { const hsl = {}; c.getHSL(hsl); c.setHSL((hsl.h + hueShift + 1) % 1, clamp(hsl.s * saturation), hsl.l); }
    c.multiplyScalar(brightness);
  }
  const sync = pal.musicSync ?? 0;
  const shift = (pal.speed ?? 0) * t * 0.25 + sync * 0.25 * (a.barPos || 0) * 0.5;
  const beatGlow = 1 + pulse * 0.35 * (a.beat || 0);
  return { colors: tmp, shift, hard: pal.gradient === 'hard' ? 1 : 0, dir: Number(pal.direction) || 0, intensity: (pal.intensity ?? 1) * beatGlow, bloom };
}
