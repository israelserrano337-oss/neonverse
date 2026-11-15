// Estudio de fotografías: ajustes por foto, 17 efectos, movimientos, máscaras, filtros y capa 3D animada.
import * as THREE from 'three';
import { shaderMaterial } from '../engine/materials.js';
import { FILTERS_GLSL, FILTER_IDS } from '../engine/glsl.js';
import { clamp, smoothstep } from '../core/util.js';

export const FILTER_LABELS = {
  cyberpunk: 'Cyberpunk', neonGlow: 'Neon Glow', synthwave: 'Synthwave', electricBlue: 'Electric Blue', ultraviolet: 'Ultraviolet',
  darkCinema: 'Dark Cinema', chromatic: 'Chromatic', fluorescent: 'Fluorescent', thermal: 'Thermal Vision', plasma: 'Plasma',
  holographic: 'Holographic', rgb: 'RGB', highContrast: 'High Contrast',
};
const FILTER_OPTIONS = [{ value: 'none', label: 'Ninguno' }, ...FILTER_IDS.map((id) => ({ value: id, label: FILTER_LABELS[id] }))];

export const PHOTO_FX = [
  ['none', 'Sin efecto'], ['cinezoom', 'Zoom cinematográfico'], ['zoom3d', 'Zoom 3D'], ['parallax', 'Parallax'], ['glitch', 'Glitch'],
  ['rgbsplit', 'RGB Split'], ['hologram', 'Holograma'], ['neon', 'Neón'], ['plasma', 'Plasma'], ['crystal', 'Cristal'], ['mirror', 'Espejo'],
  ['particles', 'Partículas'], ['disintegrate', 'Desintegración'], ['flares', 'Destellos'], ['waves', 'Ondas'], ['distortion', 'Distorsión'],
  ['camera', 'Movimiento de cámara'], ['depth', 'Efecto de profundidad'],
];
const FX_INDEX = Object.fromEntries(PHOTO_FX.map(([id], i) => [id, i]));

export const MASKS = [
  ['none', 'Sin máscara'], ['rounded', 'Esquinas redondeadas'], ['circle', 'Círculo'], ['hexagon', 'Hexágono'], ['diamond', 'Rombo'],
  ['soft', 'Bordes suaves'], ['neonframe', 'Marco neón'],
];
const MASK_INDEX = Object.fromEntries(MASKS.map(([id], i) => [id, i]));

/** Ajustes propios de cada foto (Estudio de fotografías). */
export const PHOTO_SETTINGS = [
  { key: 'duration', label: 'Duración individual (s)', min: 0.5, max: 20, step: 0.1, value: 4 },
  { key: 'fit', label: 'Encaje', options: [{ value: 'cover', label: 'Llenar el cuadro' }, { value: 'contain', label: 'Foto completa' }], value: 'cover' },
  { key: 'zoom', label: 'Zoom', min: 0.5, max: 3, step: 0.01, value: 1 },
  { key: 'cropX', label: 'Recorte: izquierda', min: 0, max: 0.9, step: 0.01, value: 0 },
  { key: 'cropY', label: 'Recorte: arriba', min: 0, max: 0.9, step: 0.01, value: 0 },
  { key: 'cropW', label: 'Recorte: ancho', min: 0.1, max: 1, step: 0.01, value: 1 },
  { key: 'cropH', label: 'Recorte: alto', min: 0.1, max: 1, step: 0.01, value: 1 },
  { key: 'scale', label: 'Escala', min: 0.2, max: 2, step: 0.01, value: 1 },
  { key: 'rotate', label: 'Rotación', min: -180, max: 180, step: 1, value: 0 },
  { key: 'offsetX', label: 'Desplazamiento X', min: -1, max: 1, step: 0.01, value: 0 },
  { key: 'offsetY', label: 'Desplazamiento Y', min: -1, max: 1, step: 0.01, value: 0 },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, value: 1 },
  { key: 'mask', label: 'Máscara', options: MASKS.map(([value, label]) => ({ value, label })), value: 'none' },
  { key: 'layer', label: 'Capa', options: [{ value: 'front', label: 'Delante del 3D' }, { value: 'back', label: 'Fondo (detrás del 3D)' }, { value: 'screen', label: 'Luz (mezcla aditiva)' }], value: 'front' },
  { key: 'brightness', label: 'Brillo', min: 0.3, max: 2, step: 0.01, value: 1 },
  { key: 'contrast', label: 'Contraste', min: 0.3, max: 2, step: 0.01, value: 1 },
  { key: 'saturation', label: 'Saturación', min: 0, max: 2, step: 0.01, value: 1 },
  { key: 'autoExposure', label: 'Igualar brillo entre fotos', type: 'toggle', value: true },
  { key: 'filterA', label: 'Filtro 1', options: FILTER_OPTIONS, value: 'none' },
  { key: 'filterAAmount', label: 'Intensidad filtro 1', min: 0, max: 1, step: 0.01, value: 0.7 },
  { key: 'filterB', label: 'Filtro 2', options: FILTER_OPTIONS, value: 'none' },
  { key: 'filterBAmount', label: 'Intensidad filtro 2', min: 0, max: 1, step: 0.01, value: 0.5 },
];

/** Parámetros del clip de foto en la línea de tiempo (efecto y movimiento). */
export const PHOTO_CLIP_PARAMS = [
  { key: 'photoId', label: 'Fotografía', type: 'photo', value: null },
  { key: 'effect', label: 'Efecto', options: PHOTO_FX.map(([value, label]) => ({ value, label })), value: 'cinezoom' },
  { key: 'effectAmount', label: 'Intensidad del efecto', min: 0, max: 1, step: 0.01, value: 0.6 },
  { key: 'motion', label: 'Movimiento', options: [
    { value: 'none', label: 'Fijo' }, { value: 'in', label: 'Acercar' }, { value: 'out', label: 'Alejar' }, { value: 'left', label: 'Desplazar a la izquierda' },
    { value: 'right', label: 'Desplazar a la derecha' }, { value: 'up', label: 'Desplazar arriba' }, { value: 'orbit', label: 'Órbita 3D' }, { value: 'drift', label: 'Flotar' }], value: 'in' },
  { key: 'motionAmount', label: 'Cantidad de movimiento', min: 0, max: 1, step: 0.01, value: 0.5 },
  { key: 'parallax', label: 'Parallax', min: 0, max: 1, step: 0.01, value: 0.3 },
  { key: 'depth', label: 'Profundidad', min: 0, max: 1, step: 0.01, value: 0.3 },
  { key: 'react', label: 'Reacción musical', min: 0, max: 2, step: 0.01, value: 0.8 },
  { key: 'blend', label: 'Mezcla con el 3D', options: [{ value: 'auto', label: 'Según la foto' }, { value: 'front', label: 'Delante del 3D' }, { value: 'back', label: 'Fondo (el 3D brilla encima)' }, { value: 'screen', label: 'Luz (aditiva)' }], value: 'auto' },
  { key: 'frame', label: 'Enmarcar en la escena', options: [{ value: 'none', label: 'No (usar la máscara de la foto)' }, ...MASKS.filter(([id]) => id !== 'none').map(([value, label]) => ({ value, label }))], value: 'none' },
  { key: 'hitFx', label: 'Efecto de impacto al entrar', options: [{ value: 'none', label: 'Ninguno' }, { value: 'punch', label: 'Zoom de impacto' }, { value: 'glitch', label: 'Glitch' }, { value: 'rgb', label: 'RGB' }, { value: 'shake', label: 'Sacudida' }, { value: 'flash', label: 'Destello suave' }], value: 'none' },
  { key: 'hitAmount', label: 'Intensidad del impacto', min: 0, max: 1, step: 0.01, value: 0.8 },
  { key: 'frameScale', label: 'Tamaño del marco', min: 0.3, max: 1, step: 0.01, value: 0.62 },
  { key: 'fadeIn', label: 'Fundido de entrada (s)', min: 0, max: 3, step: 0.05, value: 0.4 },
  { key: 'fadeOut', label: 'Fundido de salida (s)', min: 0, max: 3, step: 0.05, value: 0.4 },
];

const PHOTO_VERT = /* glsl */ `
uniform sampler2D uTex; uniform float uFx, uFxAmt, uDepthAmt, uTime; uniform vec4 uCrop; uniform float uZoom, uURot; uniform vec2 uUVOff;
varying vec2 vUv; varying float vDepth;
vec2 cropUV(vec2 uv){
  vec2 c = uv - 0.5; c = mat2(cos(uURot), -sin(uURot), sin(uURot), cos(uURot)) * c; c /= uZoom; c += 0.5 + uUVOff;
  return uCrop.xy + c * uCrop.zw;
}
void main(){
  vUv = uv;
  vec3 p = position;
  if (abs(uFx - 17.0) < 0.5) { // profundidad: relieve por luminancia
    vec3 col = texture2D(uTex, cropUV(uv)).rgb;
    p.z += (dot(col, vec3(0.3, 0.59, 0.11)) - 0.4) * uDepthAmt * 0.6;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const PHOTO_FRAG = /* glsl */ `
${FILTERS_GLSL}
uniform sampler2D uTex; uniform vec4 uCrop; uniform float uZoom, uURot; uniform vec2 uUVOff;
uniform float uOpacity, uFx, uFxAmt, uProg, uLocal, uTime, uBass, uBeat, uTreble, uMask, uAspect, uGain, uBright, uContrast, uSat, uFA, uFB, uFAAmt, uFBAmt, uDissolve, uTexel, uHitGlitch, uHitRGB, uHitFlash;
varying vec2 vUv; varying float vDepth;
bool fx(float k){ return abs(uFx - k) < 0.5; }
vec2 cropUV(vec2 uv){
  vec2 c = uv - 0.5; c = mat2(cos(uURot), -sin(uURot), sin(uURot), cos(uURot)) * c; c /= uZoom; c += 0.5 + uUVOff;
  return uCrop.xy + c * uCrop.zw;
}
vec3 tex(vec2 uv){ vec2 q = cropUV(uv); if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec3(0.0); return texture2D(uTex, q).rgb; }
float maskA(vec2 uv){
  vec2 c = (uv - 0.5) * vec2(uAspect, 1.0); float m = 1.0;
  if (abs(uMask - 1.0) < 0.5) { vec2 d = abs(c) - vec2(uAspect * 0.5 - 0.08, 0.42); m = 1.0 - smoothstep(0.0, 0.01, length(max(d, 0.0)) - 0.08); }
  else if (abs(uMask - 2.0) < 0.5) { m = 1.0 - smoothstep(0.495, 0.5, length(c) / min(uAspect, 1.0)); }
  else if (abs(uMask - 3.0) < 0.5) { vec2 q = abs(c) / (min(uAspect, 1.0) * 0.5); m = 1.0 - smoothstep(0.98, 1.0, max(q.x * 0.866 + q.y * 0.5, q.y)); }
  else if (abs(uMask - 4.0) < 0.5) { vec2 q = abs(c) / (min(uAspect, 1.0) * 0.5); m = 1.0 - smoothstep(0.98, 1.0, q.x + q.y); }
  else if (abs(uMask - 5.0) < 0.5) { vec2 q = abs(uv - 0.5) * 2.0; m = smoothstep(1.0, 0.7, max(q.x, q.y)); }
  return m;
}
void main(){
  vec2 uv = vUv;
  float A = uFxAmt; float t = uTime;
  if (fx(14.0)) uv += vec2(sin(uv.y * 18.0 + t * 3.0), cos(uv.x * 14.0 + t * 2.4)) * 0.012 * A * (1.0 + uBass);
  if (fx(15.0)) { vec2 c = uv - 0.5; float r = length(c); float ang = atan(c.y, c.x) + A * 1.6 * smoothstep(0.6, 0.0, r) * sin(t * 0.7); uv = 0.5 + vec2(cos(ang), sin(ang)) * r * (1.0 - 0.15 * A * r); }
  if (fx(10.0)) { uv.x = 0.5 - abs(uv.x - 0.5) * (1.0 + A * 0.2); if (A > 0.5) uv.y = 0.5 + abs(uv.y - 0.5) * sign(uv.y - 0.5); }
  if (fx(9.0)) { vec2 g = uv * (6.0 + 8.0 * A); vec2 id = floor(g); vec2 off = vec2(hash21(id), hash21(id + 7.0)) - 0.5; uv += off * 0.04 * A; }
  if (fx(4.0)) { float row = floor(uv.y * 24.0); float k = step(1.0 - 0.35 * A, hash21(vec2(row, floor(t * 6.0)))); uv.x += k * (hash21(vec2(row, floor(t * 6.0) + 3.0)) - 0.5) * 0.15 * A; }
  if (uHitGlitch > 0.001) { float row = floor(uv.y * 18.0); float k = step(0.55, hash21(vec2(row, floor(uLocal * 30.0)))); uv.x += k * (hash21(vec2(row, 7.0 + floor(uLocal * 30.0))) - 0.5) * 0.16 * uHitGlitch; }
  vec3 c;
  if (fx(5.0) || fx(4.0) || uHitRGB > 0.001) { float o = (fx(5.0) || fx(4.0) ? 0.006 + 0.02 * A * (fx(5.0) ? 1.0 : uBass) : 0.0) + 0.045 * uHitRGB + 0.012 * uHitGlitch; c = vec3(tex(uv + vec2(o, 0.0)).r, tex(uv).g, tex(uv - vec2(o, 0.0)).b); }
  else c = tex(uv);
  // tono base: brillo, contraste, saturación, igualación de brillo
  c *= uGain * uBright; c = (c - 0.5) * uContrast + 0.5; c = mix(vec3(luma(c)), c, uSat); c = max(c, 0.0);
  if (fx(7.0)) { // neón: bordes resplandecientes
    float e = 0.0; float d = uTexel * 1.5;
    e += length(tex(uv + vec2(d, 0.0)) - tex(uv - vec2(d, 0.0)));
    e += length(tex(uv + vec2(0.0, d)) - tex(uv - vec2(0.0, d)));
    vec3 neonC = pal(uv.y + t * 0.05) * smoothstep(0.08, 0.5, e) * (2.0 + 1.5 * uBass);
    c = mix(c, c * 0.25 + neonC, A);
  }
  if (fx(6.0)) { // holograma
    float scan = 0.75 + 0.25 * sin(uv.y * 600.0 - t * 10.0); float band = smoothstep(0.96, 1.0, sin(uv.y * 8.0 - t * 2.0));
    vec3 hc = mix(vec3(0.2, 0.9, 1.0), pal(0.2), 0.3) * luma(c) * 1.6;
    c = mix(c, (hc + band * 0.4) * scan, A);
  }
  if (fx(8.0)) { float v = sin(uv.x * 9.0 + t) + sin(uv.y * 7.0 - t * 0.8) + sin((uv.x + uv.y) * 6.0 + t * 0.6); c = mix(c, c * 0.6 + pal(v * 0.15 + luma(c)) * luma(c) * 1.3, A * 0.8); }
  if (fx(13.0)) { // destellos: haz que cruza + fuga de luz
    float beam = exp(-pow((uv.x - fract(t * 0.15) * 1.6 + 0.3 - uv.y * 0.4) * 9.0, 2.0));
    vec2 lp = vec2(0.8, 0.2) + 0.1 * vec2(sin(t * 0.5), cos(t * 0.4));
    float leak = smoothstep(0.7, 0.0, length(uv - lp));
    c += (pal(0.1 + t * 0.03) * beam * 0.5 + pal(0.6) * leak * 0.3) * A * (0.75 + 0.35 * uBass);
  }
  // filtros por foto (hasta dos combinados)
  float f[13]; for (int i = 0; i < 13; i++) f[i] = 0.0;
  for (int i = 0; i < 13; i++) { if (abs(float(i) - uFA) < 0.5) f[i] += uFAAmt; if (abs(float(i) - uFB) < 0.5) f[i] += uFBAmt; }
  c = applyFilters(c, uv, f, t);
  if (f[6] > 0.0) { c.r = mix(c.r, tex(uv + vec2(0.008, 0.0) * f[6]).r * uGain, 0.6); }
  if (f[11] > 0.0) { c = mix(c, vec3(tex(uv + vec2(0.012, 0.0) * f[11]).r, c.g, tex(uv - vec2(0.012, 0.0) * f[11]).b) * uGain, f[11]); }
  c += vec3(uHitFlash); // destello de impacto (pequeño y breve: seguro)
  float a = uOpacity * maskA(vUv);
  if (abs(uMask - 6.0) < 0.5) { vec2 q = abs(vUv - 0.5) * 2.0; float edge = smoothstep(0.9, 0.97, max(q.x, q.y)) * smoothstep(1.0, 0.985, max(q.x, q.y)); c = mix(c, pal(vUv.x + vUv.y + t * 0.1) * 2.2, edge); }
  if (fx(6.0)) a *= 0.75 + 0.2 * sin(t * 3.0);
  if (uDissolve > 0.0) { float n = fbm(vUv * 8.0); a *= smoothstep(uDissolve - 0.05, uDissolve + 0.05, n); }
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}`;

const PTS_VERT = /* glsl */ `
uniform sampler2D uTex; uniform vec4 uCrop; uniform float uZoom, uURot; uniform vec2 uUVOff; uniform vec2 uSize;
uniform float uTime, uMode, uProg, uAmt, uPix, uBass, uGain;
attribute vec4 aSeed; varying vec3 vC; varying float vA;
vec2 cropUV(vec2 uv){
  vec2 c = uv - 0.5; c = mat2(cos(uURot), -sin(uURot), sin(uURot), cos(uURot)) * c; c /= uZoom; c += 0.5 + uUVOff;
  return uCrop.xy + c * uCrop.zw;
}
void main(){
  vec2 uv = aSeed.xy;
  vec3 col = texture2D(uTex, cropUV(uv)).rgb * uGain;
  vec3 p = vec3((uv - 0.5) * uSize, 0.0);
  float k;
  if (uMode < 0.5) { // partículas: la foto respira hecha de puntos
    float w = uAmt * (0.15 + 0.25 * uBass);
    p += vec3(sin(uTime * 1.3 + aSeed.z * 30.0), cos(uTime * 1.1 + aSeed.w * 30.0), sin(uTime * 0.9 + aSeed.z * 20.0) * 3.0) * w;
    vA = 1.0; k = 0.0;
  } else { // desintegración: cada punto se suelta cuando el progreso supera su umbral
    float th = 0.35 + 0.55 * (uv.x * 0.6 + aSeed.z * 0.4);
    k = clamp((uProg - th) / 0.35, 0.0, 1.0) * uAmt * 1.4;
    k = k * k;
    p += vec3(1.2 + aSeed.w * 2.0, 0.8 + aSeed.z * 1.6, 1.5 + aSeed.w * 2.5) * k * 3.0 + vec3(sin(uTime + aSeed.z * 9.0), cos(uTime + aSeed.w * 9.0), 0.0) * k;
    vA = (1.0 - k) * step(th, uProg + 0.02);
  }
  vC = col * (1.0 + k * 0.8);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPix * (1.0 + aSeed.w);
}`;
const PTS_FRAG = /* glsl */ `
varying vec3 vC; varying float vA; uniform float uOpacity;
void main(){ vec2 c = gl_PointCoord - 0.5; float m = smoothstep(0.5, 0.2, length(c)); gl_FragColor = vec4(vC * 1.2, m * vA * uOpacity); }`;

/** Construye la capa de una foto. env.photoTexture(id) → { texture, aspect, luma } o null si aún carga. */
export function buildPhotoLayer(p, env) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1, 96, 96);
  const mat = shaderMaterial({
    vertex: PHOTO_VERT, fragment: PHOTO_FRAG, blending: THREE.NormalBlending, side: THREE.DoubleSide,
    uniforms: {
      uTex: { value: null }, uCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, uZoom: { value: 1 }, uURot: { value: 0 }, uUVOff: { value: new THREE.Vector2() },
      uFx: { value: 0 }, uFxAmt: { value: 0.5 }, uDepthAmt: { value: 0 }, uProg: { value: 0 }, uLocal: { value: 0 }, uMask: { value: 0 }, uAspect: { value: 1 },
      uGain: { value: 1 }, uBright: { value: 1 }, uContrast: { value: 1 }, uSat: { value: 1 }, uFA: { value: -1 }, uFB: { value: -1 }, uFAAmt: { value: 0 }, uFBAmt: { value: 0 },
      uDissolve: { value: 0 }, uTexel: { value: 1 / 1024 }, uHitGlitch: { value: 0 }, uHitRGB: { value: 0 }, uHitFlash: { value: 0 },
    },
  });
  const plane = new THREE.Mesh(geo, mat);
  plane.frustumCulled = false;
  group.add(plane);
  let points = null, ptsMat = null;
  const ensurePoints = (q) => {
    if (points) return;
    const res = Math.round(150 * Math.sqrt(q));
    const n = res * res;
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const x = (i % res + 0.5) / res, y = (Math.floor(i / res) + 0.5) / res; const r = Math.sin(i * 12.9898) * 43758.5453; seed.set([x, y, r - Math.floor(r), (Math.sin(i * 78.233) * 43758.5453) % 1 * 0.5 + 0.5], i * 4); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    ptsMat = new THREE.ShaderMaterial({
      uniforms: { uTex: mat.uniforms.uTex, uCrop: mat.uniforms.uCrop, uZoom: mat.uniforms.uZoom, uURot: mat.uniforms.uURot, uUVOff: mat.uniforms.uUVOff, uGain: mat.uniforms.uGain,
        uSize: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uMode: { value: 0 }, uProg: { value: 0 }, uAmt: { value: 1 }, uPix: { value: 2 }, uBass: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: PTS_VERT, fragmentShader: PTS_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    points = new THREE.Points(g, ptsMat);
    points.frustumCulled = false;
    points.userData.res = res;
    group.add(points);
  };

  return {
    object: group,
    update(t, a, p, env) {
      const ph = env.photoTexture?.(p.photoId);
      const u = mat.uniforms;
      if (!ph) { group.visible = false; return; }
      group.visible = true;
      if (u.uTex.value !== ph.texture) { u.uTex.value = ph.texture; u.uTexel.value = 1 / Math.max(ph.w || 1024, 1); }
      const local = env.local ?? 0, dur = Math.max(0.05, env.dur ?? 4), prog = clamp(local / dur);
      const fxId = p.effect || 'none', fx = FX_INDEX[fxId] ?? 0, A = p.effectAmount ?? 0.5;
      // Encaje en el cuadro a la distancia de la capa
      const layer = p.layer || 'front';
      const D = layer === 'back' ? 22 + p.depth * 10 : 4 + p.depth * 4;
      const fov = (env.fov ?? 70) * Math.PI / 180;
      const hh = D * Math.tan(fov / 2), hw = hh * env.aspect;
      const cropAspect = (ph.aspect * (p.cropW ?? 1)) / (p.cropH ?? 1);
      const frameAspect = hw / hh;
      let w, hgt;
      const cover = (p.fit ?? 'cover') === 'cover';
      if ((cropAspect > frameAspect) === cover) { hgt = 2 * hh; w = hgt * cropAspect; } else { w = 2 * hw; hgt = w / cropAspect; }
      const sc = (p.scale ?? 1) * (1 + 0.03 * (a.beat || 0) * (p.react ?? 1));
      // Movimiento a lo largo del clip (función de prog)
      const mA = p.motionAmount ?? 0.5, ease = prog * prog * (3 - 2 * prog);
      let zoom = p.zoom ?? 1, offX = 0, offY = 0, rx = 0, ry = 0, dz = 0;
      switch (p.motion) {
        case 'in': zoom *= 1 + 0.3 * mA * ease; break;
        case 'out': zoom *= 1 + 0.3 * mA * (1 - ease); break;
        case 'left': offX = 0.12 * mA * (ease - 0.5); zoom *= 1 + 0.15 * mA; break;
        case 'right': offX = -0.12 * mA * (ease - 0.5); zoom *= 1 + 0.15 * mA; break;
        case 'up': offY = -0.12 * mA * (ease - 0.5); zoom *= 1 + 0.15 * mA; break;
        case 'orbit': ry = 0.35 * mA * Math.sin(prog * Math.PI * 2 * 0.5 + t * 0.3); rx = 0.15 * mA * Math.cos(t * 0.4); break;
        case 'drift': offX = 0.03 * mA * Math.sin(t * 0.5); offY = 0.03 * mA * Math.cos(t * 0.43); ry = 0.08 * mA * Math.sin(t * 0.3); break;
        default: break;
      }
      if (fxId === 'cinezoom') zoom *= 1 + 0.35 * A * ease;
      if (fxId === 'zoom3d') { dz = 2.2 * A * ease; rx += 0.25 * A * (1 - ease); ry += 0.2 * A * Math.sin(prog * Math.PI); }
      if (fxId === 'camera') { ry += 0.3 * A * Math.sin(t * 0.6); rx += 0.12 * A * Math.sin(t * 0.45); offX += 0.05 * A * Math.sin(t * 0.37); }
      if (fxId === 'depth') { ry += 0.4 * A * Math.sin(t * 0.5); rx += 0.15 * A * Math.cos(t * 0.37); }
      // Impacto al entrar la foto: envolvente que decae en ~0,15 s desde el golpe
      // el fundido empieza un poco antes (hitDelay) para que la foto nueva esté completa justo en el golpe
      const lh = local - (p.hitDelay || 0);
      const hk = p.hitFx && p.hitFx !== 'none' && lh >= 0 ? Math.exp(-lh / (p.hitDecay || 0.18)) * (p.hitAmount ?? 0.8) : 0;
      let hitScale = 1;
      if (hk > 0) {
        if (p.hitFx === 'punch') { zoom *= 1 + 0.3 * hk; hitScale = 1 + 0.06 * hk; }
        if (p.hitFx === 'shake') { offX += 0.028 * hk * Math.sin(lh * 95); offY += 0.022 * hk * Math.cos(lh * 81); rx += 0.035 * hk * Math.sin(lh * 70); }
      }
      const par = (p.parallax ?? 0) + (fxId === 'parallax' ? A : 0);
      const cam = env.camSway || [0, 0];
      plane.scale.set(w * sc * hitScale, hgt * sc * hitScale, 1);
      group.position.set((p.offsetX ?? 0) * hw - cam[0] * par * 0.8, (p.offsetY ?? 0) * hh - cam[1] * par * 0.8, -D + dz);
      group.rotation.set(rx + cam[1] * par * 0.06, ry + cam[0] * par * 0.06, ((p.rotate ?? 0) * Math.PI) / 180);
      u.uCrop.value.set(p.cropX ?? 0, 1 - (p.cropY ?? 0) - (p.cropH ?? 1), p.cropW ?? 1, p.cropH ?? 1);
      u.uZoom.value = zoom * (1 + 0.025 * (a.beat || 0) * (p.react ?? 1));
      u.uURot.value = 0;
      u.uUVOff.value.set(offX + (fxId === 'parallax' ? -cam[0] * 0.02 * A : 0), offY);
      u.uFx.value = fx; u.uFxAmt.value = A; u.uDepthAmt.value = fxId === 'depth' ? A * Math.min(w, hgt) * 0.35 : 0;
      u.uProg.value = prog; u.uLocal.value = local; u.uTime.value = t;
      u.uBass.value = (a.bassSoft ?? a.bass ?? 0) * (p.react ?? 1); u.uBeat.value = (a.beat || 0) * (p.react ?? 1); u.uTreble.value = (a.treble || 0) * (p.react ?? 1);
      u.uHitGlitch.value = p.hitFx === 'glitch' ? hk : p.hitFx === 'rgbglitch' ? hk * 0.8 : 0; u.uHitRGB.value = p.hitFx === 'rgb' || p.hitFx === 'rgbglitch' ? hk : 0;
      u.uHitFlash.value = p.hitFx === 'flash' ? 0.06 * hk : 0; // limitado: no supera ~15/255 aunque se repita en cada golpe
      u.uMask.value = MASK_INDEX[p.mask] ?? 0; u.uAspect.value = (w * sc) / (hgt * sc);
      // Igualación de brillo; con cambios en cada golpe (matchLuma) más fuerte: todas las fotos quedan con el mismo brillo medio
      u.uGain.value = p.autoExposure !== false && ph.luma ? (p.matchLuma ? clamp(Math.pow(0.34 / Math.max(0.03, ph.luma), 0.75), 0.5, 2) : clamp(0.36 / Math.max(0.05, ph.luma), 0.6, 1.5)) : 1;
      u.uBright.value = p.brightness ?? 1; u.uContrast.value = p.contrast ?? 1; u.uSat.value = p.saturation ?? 1;
      u.uFA.value = FILTER_IDS.indexOf(p.filterA); u.uFB.value = FILTER_IDS.indexOf(p.filterB);
      u.uFAAmt.value = p.filterAAmount ?? 0; u.uFBAmt.value = p.filterBAmount ?? 0;
      // Fundidos de entrada/salida (envolvente, nunca de golpe)
      const fi = p.fadeIn ?? 0.4, fo = p.fadeOut ?? 0.4;
      const env1 = (fi > 0 ? smoothstep(0, fi, local) : 1) * (fo > 0 ? smoothstep(dur, dur - fo, local) : 1);
      let opacity = (p.opacity ?? 1) * env1;
      u.uDissolve.value = 0;
      const usePts = fxId === 'particles' || fxId === 'disintegrate';
      if (usePts) {
        ensurePoints(env.quality?.particles ?? 1);
        points.visible = true;
        const pu = ptsMat.uniforms;
        pu.uSize.value.set(w * sc, hgt * sc); pu.uTime.value = t; pu.uProg.value = prog; pu.uAmt.value = A;
        pu.uMode.value = fxId === 'particles' ? 0 : 1; pu.uBass.value = (a.bassSoft ?? a.bass ?? 0) * (p.react ?? 1);
        pu.uPix.value = Math.max(1.5, (env.renderHeight || 1080) / points.userData.res * 0.55 * sc);
        if (fxId === 'particles') { pu.uOpacity.value = opacity * A; opacity *= 1 - 0.75 * A; }
        else { pu.uOpacity.value = opacity; u.uDissolve.value = clamp((prog - 0.3) / 0.6) * A * 1.1; }
      } else if (points) points.visible = false;
      u.uOpacity.value = opacity;
      mat.blending = layer === 'screen' ? THREE.AdditiveBlending : THREE.NormalBlending;
      group.renderOrder = (layer === 'back' ? -10 : 10) + (env.order || 0) * 0.01;
      plane.renderOrder = group.renderOrder; if (points) points.renderOrder = group.renderOrder + 1;
    },
  };
}
