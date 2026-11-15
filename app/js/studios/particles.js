// Partículas: 8 estilos calculados en el shader a partir de semillas (puros en t, miles de puntos baratos).
import * as THREE from 'three';
import { shaderMaterial, setCommon, COLOR_MODES } from '../engine/materials.js';
import { hashInt } from '../core/util.js';

const h = (i, salt = 0) => hashInt(i * 7919 + salt * 104729) / 4294967296;

export const PARTICLE_PARAMS = [
  { key: 'density', label: 'Densidad', min: 0.1, max: 3, step: 0.01, value: 1, rebuild: true },
  { key: 'speed', label: 'Velocidad', min: 0, max: 3, step: 0.01, value: 1 },
  { key: 'size', label: 'Tamaño', min: 0.2, max: 4, step: 0.01, value: 1 },
  { key: 'spread', label: 'Dispersión', min: 0.3, max: 3, step: 0.01, value: 1 },
  { key: 'glow', label: 'Brillo', min: 0, max: 3, step: 0.01, value: 1.2 },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, value: 0.85 },
  { key: 'colorMode', label: 'Color', options: COLOR_MODES, value: 0 },
  { key: 'colorShift', label: 'Desplazar color', min: 0, max: 1, step: 0.01, value: 0 },
  { key: 'react', label: 'Reacción musical', min: 0, max: 2, step: 0.01, value: 1 },
];

const STYLES = ['stardust', 'embers', 'snow', 'orbit', 'galaxy', 'sparks', 'bokeh', 'fireflies'];
const BASE_COUNT = { stardust: 2500, embers: 1600, snow: 1800, orbit: 2200, galaxy: 4000, sparks: 1500, bokeh: 160, fireflies: 500 };

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uSpeed, uSize, uSpread, uStyle, uBass, uBeatPos, uPix, uReact, uTravel;
varying float vU; varying float vA; varying float vSoft;
const float TAU = 6.2831853;
void main(){
  vec3 p; float a = 1.0; float size = 1.0; vSoft = 0.0;
  float t = uTime * uSpeed;
  vec4 s = aSeed;
  if (uStyle < 0.5) { // polvo estelar: viaje hiperespacial
    float L = 60.0; float d = mod(s.z * L - uTravel * 1.5, L);
    float r = (0.4 + 5.5 * s.y) * uSpread; float ang = s.x * TAU;
    p = vec3(cos(ang) * r, sin(ang) * r, -d); a = smoothstep(L, L * 0.6, d) * smoothstep(0.2, 2.0, d);
  } else if (uStyle < 1.5) { // brasas que suben
    float y = mod(s.y * 14.0 + t * (0.6 + s.w), 14.0) - 7.0;
    p = vec3((s.x - 0.5) * 12.0 * uSpread + sin(t + s.z * 9.0) * 0.4, y, -3.0 - s.z * 10.0);
    a = smoothstep(-7.0, -5.0, y) * smoothstep(7.0, 4.0, y); size = 0.8 + s.w;
  } else if (uStyle < 2.5) { // nieve que cae
    float y = 7.0 - mod(s.y * 14.0 + t * (0.3 + 0.4 * s.w), 14.0);
    p = vec3((s.x - 0.5) * 12.0 * uSpread + sin(t * 0.7 + s.z * 9.0) * 0.6, y, -2.0 - s.z * 12.0);
    a = smoothstep(-7.0, -5.0, y) * smoothstep(7.0, 5.0, y);
  } else if (uStyle < 3.5) { // órbitas
    float ring = floor(s.x * 5.0); float r = (1.2 + ring * 0.9) * uSpread * (1.0 + 0.08 * uBass);
    float ang = s.y * TAU + t * (0.6 - ring * 0.08) * (mod(ring, 2.0) < 1.0 ? 1.0 : -1.0);
    p = vec3(cos(ang) * r, sin(ang) * r * 0.45, -8.0 + sin(ang) * r * 0.6); size = 0.6 + s.w;
    p.yz = mat2(0.96, -0.28, 0.28, 0.96) * p.yz;
  } else if (uStyle < 4.5) { // galaxia espiral
    float arm = floor(s.x * 3.0); float r = pow(s.y, 0.7) * 6.0 * uSpread;
    float ang = arm * TAU / 3.0 + r * 0.9 - t * 0.25 + (s.z - 0.5) * 0.7;
    p = vec3(cos(ang) * r, (s.w - 0.5) * 0.4, sin(ang) * r);
    p.yz = mat2(0.5, -0.866, 0.866, 0.5) * p.yz; p.z -= 10.0; size = 0.5 + (1.0 - s.y);
  } else if (uStyle < 5.5) { // chispas: estallido en cada golpe con envolvente suave
    float k = fract(uBeatPos); float id = floor(uBeatPos);
    float ang = s.x * TAU; float el = (s.y - 0.5) * 3.0;
    float sp = (2.0 + 4.0 * s.z) * uSpread * (0.6 + 0.8 * uReact);
    vec3 dir = normalize(vec3(cos(ang), el, sin(ang) * 0.6));
    p = dir * sp * k + vec3(0.0, -k * k * 2.0, -6.0);
    a = smoothstep(0.0, 0.08, k) * (1.0 - k) * (1.0 - k) * step(s.w, 0.35 + 0.5 * uReact);
  } else if (uStyle < 6.5) { // bokeh
    p = vec3((s.x - 0.5) * 14.0 * uSpread + sin(t * 0.2 + s.z * 6.0), (s.y - 0.5) * 20.0 + cos(t * 0.15 + s.w * 6.0), -4.0 - s.z * 6.0);
    size = 5.0 + 8.0 * s.w; vSoft = 1.0; a = 0.35;
  } else { // luciérnagas
    p = vec3((s.x - 0.5) * 12.0 * uSpread + sin(t * (0.3 + s.w) + s.z * 9.0) * 1.5, (s.y - 0.5) * 16.0 + cos(t * (0.25 + s.z) + s.w * 9.0) * 1.5, -3.0 - s.z * 8.0);
    a = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(t * 2.0 * (0.5 + s.w) + s.x * 40.0), 3.0);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPix * uSize * size * (1.5 + 3.5 * s.w) * 8.0 / max(0.5, -mv.z);
  vU = s.x + s.y * 0.3; vA = a;
}`;
const FRAG = /* glsl */ `
uniform float uGlow, uOpacity, uShift, uMode;
varying float vU; varying float vA; varying float vSoft;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  float m = vSoft > 0.5 ? smoothstep(0.5, 0.35, d) * 0.6 + smoothstep(0.5, 0.0, d) * 0.4 : pow(smoothstep(0.5, 0.0, d), 2.0);
  gl_FragColor = vec4(layerColor(vU + uShift, uMode) * uGlow * uPalIntensity, clamp(m * vA * uOpacity, 0.0, 1.0));
}`;

function build(style) {
  return (p, env) => {
    const q = env?.quality?.particles ?? 1;
    const n = Math.max(30, Math.round(BASE_COUNT[style] * p.density * q));
    const geo = new THREE.BufferGeometry();
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) seed.set([h(i), h(i, 1), h(i, 2), h(i, 3)], i * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = shaderMaterial({
      vertex: VERT, fragment: FRAG,
      uniforms: { uSpeed: { value: 1 }, uSize: { value: 1 }, uSpread: { value: 1 }, uStyle: { value: STYLES.indexOf(style) }, uBeatPos: { value: 0 }, uPix: { value: 1 }, uReact: { value: 1 } },
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return {
      object: pts,
      update(t, a, p, env) {
        const u = mat.uniforms;
        setCommon(mat, p, { uTime: t, uGlow: p.glow * (0.85 + 0.3 * (a.energySoft ?? a.energy ?? 0) * p.react) });
        u.uSpeed.value = p.speed; u.uSize.value = p.size * (1 + 0.2 * (a.beat || 0) * p.react); u.uSpread.value = p.spread;
        u.uBass.value = (a.bass || 0) * p.react; u.uBeatPos.value = a.beatPos || 0; u.uReact.value = p.react;
        u.uTravel.value = p.speed * (t * 5 + (a.travelBass || 0) * 2.5 * Math.min(1.5, p.react));
        u.uPix.value = env?.pixelRatio ?? 1;
      },
    };
  };
}

const LABELS = { stardust: 'Polvo estelar', embers: 'Brasas', snow: 'Nieve de luz', orbit: 'Órbitas', galaxy: 'Galaxia', sparks: 'Chispas al ritmo', bokeh: 'Bokeh', fireflies: 'Luciérnagas' };
export const PARTICLES = STYLES.map((id) => ({ id, label: LABELS[id], build: build(id), defaults: {} }));
export const PARTICLE_BY_ID = Object.fromEntries(PARTICLES.map((x) => [x.id, x]));
