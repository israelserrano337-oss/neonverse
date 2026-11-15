// Materiales neón compartidos. Los uniformes de paleta son objetos únicos: se actualizan una vez por fotograma.
import * as THREE from 'three';
import { PAL_GLSL, NOISE_GLSL } from './glsl.js';

export const PAL_UNIFORMS = {
  uC0: { value: new THREE.Color('#00f0ff') },
  uC1: { value: new THREE.Color('#8a2bff') },
  uC2: { value: new THREE.Color('#ff2bd6') },
  uPalShift: { value: 0 },
  uPalHard: { value: 0 },
  uPalIntensity: { value: 1 },
  uPalDir: { value: 0 },
};

export const COLOR_MODES = [
  { value: 0, label: 'Degradado de paleta' }, { value: 1, label: 'Color 1' }, { value: 2, label: 'Color 2' },
  { value: 3, label: 'Color 3' }, { value: 4, label: 'Arcoíris' }, { value: 5, label: 'Blanco caliente' }, { value: 6, label: 'Hielo y oro (original)' },
];

const NEON_VERT = /* glsl */ `
attribute vec4 aInst;
uniform float uUAlong;
varying float vU; varying float vB; varying float vDepth; varying vec3 vN; varying vec2 vUv; varying float vX;
void main(){
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
#endif
  vec4 mv = modelViewMatrix * p;
  vDepth = -mv.z;
  vN = normalize(normalMatrix * n);
  vU = aInst.x + uv.x * uUAlong; vB = aInst.y; vX = aInst.z; vUv = uv;
  gl_Position = projectionMatrix * mv;
}`;

const NEON_FRAG = /* glsl */ `
${PAL_GLSL}
uniform float uGlow; uniform float uOpacity; uniform float uShift; uniform float uMode;
uniform float uNear; uniform float uNearW; uniform float uFar; uniform float uMetal; uniform float uTime;
varying float vU; varying float vB; varying float vDepth; varying vec3 vN; varying vec2 vUv; varying float vX;
void main(){
  vec3 c = layerColor(vU + uShift, uMode);
  if (uMetal > 0.0) {
    vec3 L = normalize(vec3(0.4, 0.7, 0.6));
    float d = max(dot(vN, L), 0.0);
    float rim = pow(1.0 - abs(vN.z), 3.0);
    float stripe = smoothstep(0.92, 1.0, sin(vUv.y * 40.0 + uTime * 2.0 + vX * 6.0) * 0.5 + 0.5);
    vec3 metal = vec3(0.16, 0.17, 0.22) * (0.35 + 0.9 * d) + vec3(0.8) * pow(d, 24.0);
    c = mix(c, metal + c * (rim * 1.4 + stripe * 0.8), uMetal);
  }
  float fog = smoothstep(uFar, uFar * 0.55, vDepth) * smoothstep(uNear, uNear + uNearW, vDepth);
  float a = clamp(uOpacity * vB * fog, 0.0, 1.0);
  gl_FragColor = vec4(c * uGlow * uPalIntensity, a);
}`;

/** Material aditivo con color de paleta por instancia/vértice (atributo aInst: u, brillo, extra, extra). */
export function neonMaterial({ metal = 0, side = THREE.FrontSide, blending = THREE.AdditiveBlending, uAlong = 0, solid = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...PAL_UNIFORMS,
      uGlow: { value: 1 }, uOpacity: { value: 1 }, uShift: { value: 0 }, uMode: { value: 0 },
      uNear: { value: 0.4 }, uNearW: { value: 1.4 }, uFar: { value: 60 }, uMetal: { value: metal }, uTime: { value: 0 }, uUAlong: { value: uAlong },
    },
    vertexShader: NEON_VERT, fragmentShader: NEON_FRAG,
    transparent: true, depthWrite: solid, depthTest: solid, blending: solid ? THREE.NormalBlending : blending, side,
  });
}

/** Material de shader a medida que ya incluye paleta, ruido y los uniformes comunes. */
export function shaderMaterial({ vertex, fragment, uniforms = {}, side = THREE.FrontSide, blending = THREE.AdditiveBlending, wireframe = false, defines = {} }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...PAL_UNIFORMS,
      uTime: { value: 0 }, uGlow: { value: 1 }, uOpacity: { value: 1 }, uShift: { value: 0 }, uMode: { value: 0 },
      uNear: { value: 0.4 }, uFar: { value: 60 }, uTravel: { value: 0 },
      uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 }, uBeat: { value: 0 }, uEnergy: { value: 0 },
      ...uniforms,
    },
    vertexShader: vertex,
    fragmentShader: `${PAL_GLSL}\n${NOISE_GLSL}\n${fragment}`,
    transparent: true, depthWrite: false, depthTest: false, blending, side, wireframe, defines,
  });
}

/** Atributo aInst por vértice para geometrías no instanciadas. */
export function vertexInst(geometry, fn = () => [0, 1, 0, 0]) {
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 4);
  const pos = geometry.attributes.position;
  for (let i = 0; i < n; i++) arr.set(fn(i, pos.getX(i), pos.getY(i), pos.getZ(i)), i * 4);
  geometry.setAttribute('aInst', new THREE.BufferAttribute(arr, 4));
  return geometry;
}

/** Malla instanciada con atributo aInst por instancia. */
export function instanced(geometry, material, count) {
  const g = geometry.clone();
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  attr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aInst', attr);
  const mesh = new THREE.InstancedMesh(g, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  geometry.dispose();
  return mesh;
}

/** Aplica uniformes comunes de capa a un material. */
export function setCommon(mat, p, extra = {}) {
  const u = mat.uniforms;
  if (u.uOpacity) u.uOpacity.value = p.opacity ?? 1;
  if (u.uShift) u.uShift.value = p.colorShift ?? 0;
  if (u.uMode) u.uMode.value = p.colorMode ?? 0;
  for (const k in extra) if (u[k]) u[k].value = extra[k];
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { for (const k in m.uniforms || {}) { const v = m.uniforms[k].value; if (v && v.isTexture && !v.userData?.shared) v.dispose(); } m.dispose(); });
  });
}
