// Estudio de mallas eléctricas 3D: 12 estilos. Desplazamiento en el shader (puro en t) con reacción por bandas.
import * as THREE from 'three';
import { shaderMaterial, setCommon, COLOR_MODES, instanced } from '../engine/materials.js';
import { NOISE_GLSL } from '../engine/glsl.js';
import { hashInt, createRNG, bell } from '../core/util.js';

const h = (i, salt = 0) => hashInt(i * 7919 + salt * 104729) / 4294967296;

export const PLACEMENTS = [
  { value: 'auto', label: 'Automática' }, { value: 'center', label: 'Centro' }, { value: 'floor', label: 'Suelo' },
  { value: 'ceiling', label: 'Techo' }, { value: 'tunnel', label: 'Suelo y techo' }, { value: 'back', label: 'Fondo' },
];

export const MESH_PARAMS = [
  { key: 'amplitude', label: 'Amplitud', min: 0, max: 3, step: 0.01, value: 1 },
  { key: 'frequency', label: 'Frecuencia', min: 0.1, max: 4, step: 0.01, value: 1 },
  { key: 'density', label: 'Densidad', min: 8, max: 160, step: 1, value: 60, rebuild: true },
  { key: 'speed', label: 'Velocidad', min: 0, max: 3, step: 0.01, value: 1 },
  { key: 'ondulation', label: 'Ondulación', min: 0, max: 2, step: 0.01, value: 0.6 },
  { key: 'depth', label: 'Profundidad', min: 2, max: 30, step: 0.1, value: 10 },
  { key: 'rotation', label: 'Rotación', min: -2, max: 2, step: 0.01, value: 0.1 },
  { key: 'intensity', label: 'Intensidad', min: 0, max: 2, step: 0.01, value: 1 },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, value: 0.85 },
  { key: 'glow', label: 'Brillo', min: 0, max: 3, step: 0.01, value: 1.1 },
  { key: 'colorMode', label: 'Colores', options: COLOR_MODES, value: 0 },
  { key: 'colorShift', label: 'Desplazar color', min: 0, max: 1, step: 0.01, value: 0 },
  { key: 'bassReact', label: 'Reacción a graves', min: 0, max: 2, step: 0.01, value: 1 },
  { key: 'midReact', label: 'Reacción a medios', min: 0, max: 2, step: 0.01, value: 0.7 },
  { key: 'trebleReact', label: 'Reacción a agudos', min: 0, max: 2, step: 0.01, value: 0.6 },
  { key: 'placement', label: 'Posición', options: PLACEMENTS, value: 'auto' },
];

// Vértice común: desplazamiento por estilo
const MESH_VERT = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uAmp, uFreq, uSpeed, uOnd, uInt, uBass, uMid, uTreble, uBeat, uBassR, uMidR, uTrebR, uStyle, uTravel, uMorph;
attribute vec4 aSeed;
varying float vH; varying vec2 vUv; varying float vDepth; varying vec3 vP; varying vec4 vSeed;
float audioK(){ return 1.0 + uInt * (uBass * uBassR * 0.9 + uMid * uMidR * 0.35); }
vec3 sf(float a, float m, float n1){ return vec3(pow(abs(cos(m * a / 4.0)), n1) + pow(abs(sin(m * a / 4.0)), n1)); }
bool isS(float k){ return abs(uStyle - k) < 0.5; }
vec3 displaceP(vec3 p, vec3 n){
  float t = uTime * uSpeed;
  float s = uStyle;
  if (s > 98.0) return p; // posiciones calculadas en la CPU
  if (s < 0.5) { // neuronal: deriva suave de cada nodo
    p += vec3(sin(t * 0.7 + aSeed.x * 40.0), cos(t * 0.6 + aSeed.y * 40.0), sin(t * 0.5 + aSeed.z * 40.0)) * 0.35 * uAmp * audioK();
    return p;
  }
  if (s > 10.5) { // superficies geométricas: superfórmula que se transforma
    float th = (uv.x - 0.5) * 6.2831853, ph = (uv.y - 0.5) * 3.14159265;
    float m1 = 2.0 + 4.0 * (0.5 + 0.5 * sin(t * 0.21)) + uMorph, m2 = 3.0 + 3.0 * (0.5 + 0.5 * cos(t * 0.17));
    float r1 = pow(dot(sf(th, m1, 1.6).xy, vec2(0.5)), -0.6);
    float r2 = pow(dot(sf(ph, m2, 1.4).xy, vec2(0.5)), -0.6);
    vec3 q = vec3(r1 * cos(th) * r2 * cos(ph), r1 * sin(th) * r2 * cos(ph), r2 * sin(ph));
    return q * 1.6 * (1.0 + 0.15 * uAmp * uBass * uBassR * uInt) * (1.0 + 0.1 * uOnd * sin(ph * 6.0 + t * 2.0));
  }
  float w;
  vec2 q = p.xy;
  if (isS(4.0) || isS(8.0)) q = vec2(p.x, p.y - uTravel); // terreno que avanza
  if (isS(2.0) || isS(5.0)) { // esfera holográfica / poligonal: desplazamiento radial
    w = (vnoise3(p * uFreq * 1.2 + t * 0.4) - 0.5) * 1.2 + uOnd * 0.25 * sin(p.y * 4.0 * uFreq + t * 2.0);
    return p + n * w * 0.6 * uAmp * audioK();
  }
  if (isS(6.0)) { // circular: ondas radiales
    float r = length(p.xy);
    w = sin(r * 2.2 * uFreq - t * 3.0) * (0.5 + 0.5 * uOnd) + 0.4 * (vnoise(p.xy * uFreq + t * 0.3) - 0.5);
    return p + vec3(0.0, 0.0, w * 0.55 * uAmp * audioK() * smoothstep(9.0, 2.0, r));
  }
  w = sin(q.x * uFreq * 0.8 + t) * cos(q.y * uFreq * 0.6 - t * 0.8) * 0.6;
  w += uOnd * sin(length(q) * uFreq * 1.3 - t * 2.0) * 0.5;
  w += (fbm(q * uFreq * 0.35 + t * 0.15) - 0.5) * 1.4;
  return p + vec3(0.0, 0.0, w * uAmp * audioK());
}
void main(){
  vUv = uv; vSeed = aSeed;
  vec3 p0 = position; vec3 n0 = normal;
#ifdef USE_INSTANCING
  p0 = (instanceMatrix * vec4(p0, 1.0)).xyz; n0 = mat3(instanceMatrix) * n0;
#endif
  vec3 p = displaceP(p0, n0);
  vH = (uStyle > 10.5) ? length(p) * 0.3 : p.z;
  vP = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (2.0 + 5.0 * aSeed.w) * 10.0 / max(1.0, -mv.z);
}`;

const MESH_FRAG = /* glsl */ `
uniform float uGlow, uOpacity, uShift, uMode, uTime, uSpeed, uStyle, uBass, uMid, uTreble, uTrebR, uMidR, uBeat, uFar, uIsPoint, uTravel;
varying float vH; varying vec2 vUv; varying float vDepth; varying vec3 vP; varying vec4 vSeed;
void main(){
  float t = uTime * uSpeed;
  float s = uStyle;
  float u = vH * 0.15 + vUv.x * 0.6 + vUv.y * 0.3;
  float b = 0.7 + 0.5 * smoothstep(-0.6, 1.2, vH);
  if (s > 98.0) { u = vSeed.x; b = 0.4 + 1.2 * vSeed.y; }
  else if (s < 0.5) { u = vSeed.x; b = 0.7 + 0.8 * smoothstep(0.85, 1.0, fract(vSeed.y - t * 0.6)) * (0.5 + uMid * uMidR); }
  else if (s > 0.5 && s < 1.5) { b *= 0.5 + 1.2 * smoothstep(0.8, 1.0, fract(vUv.y * 3.0 - t * 0.7 + vnoise(vUv * 8.0) * 0.5)); }
  else if (s > 1.5 && s < 2.5) { b *= 0.55 + 0.45 * sin(vP.y * 18.0 - t * 6.0); u += t * 0.05; }
  else if (s > 2.5 && s < 3.5) { // plasma
    vec2 q = vUv * 6.0; float v = sin(q.x * 1.7 + t) + sin(q.y * 2.1 - t * 0.8) + sin((q.x + q.y) * 1.3 + t * 0.6) + fbm(q + t * 0.2) * 2.0;
    u = v * 0.12; b = 0.3 + 0.7 * smoothstep(-1.5, 3.0, v);
  }
  else if (s > 7.5 && s < 8.5) { // superficie de ondas sólida: sombreado por derivadas
    vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
    float d = clamp(abs(dot(n, normalize(vec3(0.3, 0.6, 0.7)))), 0.0, 1.0);
    b = 0.25 + 0.9 * d + 0.4 * smoothstep(0.2, 1.4, vH);
  }
  // destellos de agudos (celdas que se encienden con una envolvente suave)
  float cell = hash21(floor(vUv * 40.0) + floor(t * 4.0));
  b += uTreble * uTrebR * 0.6 * smoothstep(0.93, 1.0, cell) * sin(fract(t * 4.0) * 3.14159);
  float fog = smoothstep(uFar, uFar * 0.4, vDepth) * smoothstep(0.3, 1.2, vDepth);
  float a = uOpacity * fog;
  if (uIsPoint > 0.5) { vec2 c = gl_PointCoord - 0.5; float m = smoothstep(0.5, 0.0, length(c)); a *= m * m; b *= 1.6; }
  gl_FragColor = vec4(layerColor(u + uShift, uMode) * b * uGlow * uPalIntensity, clamp(a, 0.0, 1.0));
}`;

function meshMaterial(style, { wire = false, point = false, side = THREE.DoubleSide } = {}) {
  const m = shaderMaterial({
    vertex: MESH_VERT, fragment: MESH_FRAG, wireframe: wire, side,
    uniforms: {
      uAmp: { value: 1 }, uFreq: { value: 1 }, uSpeed: { value: 1 }, uOnd: { value: 0.5 }, uInt: { value: 1 },
      uBassR: { value: 1 }, uMidR: { value: 1 }, uTrebR: { value: 1 }, uStyle: { value: style }, uIsPoint: { value: point ? 1 : 0 }, uMorph: { value: 0 },
    },
  });
  return m;
}
function ensureSeed(geo) {
  if (geo.attributes.aSeed) return geo;
  const n = geo.attributes.position.count, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set([h(i), h(i, 1), h(i, 2), h(i, 3)], i * 4);
  geo.setAttribute('aSeed', new THREE.BufferAttribute(a, 4));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}
function setMeshUniforms(mats, p, a, t) {
  for (const m of mats) {
    const u = m.uniforms;
    setCommon(m, p, { uGlow: p.glow, uTime: t, uFar: p.depth * 3 + 25 });
    u.uAmp.value = p.amplitude; u.uFreq.value = p.frequency; u.uSpeed.value = p.speed; u.uOnd.value = p.ondulation; u.uInt.value = p.intensity;
    u.uBassR.value = p.bassReact; u.uMidR.value = p.midReact; u.uTrebR.value = p.trebleReact;
    u.uBass.value = a.bassSoft ?? a.bass ?? 0; u.uMid.value = a.midSoft ?? a.mid ?? 0; u.uTreble.value = a.trebleSoft ?? a.treble ?? 0; u.uBeat.value = a.beat || 0;
    u.uTravel.value = t * p.speed * 2 + (a.travelBass || 0) * p.bassReact * 1.5;
  }
}

/** Coloca la malla según la posición elegida (suelo, techo, ambos, centro, fondo). */
function placed(make, defaultPlacement) {
  return (p, env) => {
    const place = p.placement === 'auto' ? defaultPlacement : p.placement;
    const group = new THREE.Group();
    const parts = [];
    const add = (cfg) => { const r = make(p, env); parts.push(r); const o = new THREE.Group(); o.add(r.object); o.userData.cfg = cfg; group.add(o); };
    if (place === 'tunnel') { add('floor'); add('ceiling'); } else add(place);
    return {
      object: group,
      update(t, a, p, env) {
        for (const o of group.children) {
          const cfg = o.userData.cfg;
          const d = p.depth;
          o.rotation.set(0, 0, 0); o.position.set(0, 0, 0); o.scale.set(1, 1, 1);
          if (cfg === 'floor' || cfg === 'ceiling') {
            o.rotation.x = cfg === 'floor' ? -Math.PI / 2 : Math.PI / 2;
            o.position.set(0, cfg === 'floor' ? -2.4 : 2.4, -d * 0.5 - 4);
          } else if (cfg === 'back') { o.position.set(0, 0, -d * 2.2); o.scale.setScalar(2.6); }
          else { o.position.set(0, 0, -d); }
          o.children[0].rotation.z = p.rotation * t * (cfg === 'ceiling' ? -1 : 1) * (cfg === 'floor' || cfg === 'ceiling' ? 0.15 : 1);
          if (cfg === 'center' || cfg === 'back') o.children[0].rotation.y = p.rotation * t * 0.6;
        }
        for (const r of parts) r.update(t, a, p, env);
      },
    };
  };
}

// ---------------------------------------------------------------- estilos
function gridSurface(style, { wire = true, w = 24, hgt = 40, solid = false } = {}) {
  return (p, env) => {
    const seg = Math.max(8, Math.round(p.density * (env?.quality?.segments ?? 1)));
    const geo = ensureSeed(new THREE.PlaneGeometry(w, hgt, seg, Math.round(seg * hgt / w)));
    const mats = [meshMaterial(style, { wire })];
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, mats[0]));
    if (solid) { const m2 = meshMaterial(style, { wire: true }); mats.push(m2); group.add(new THREE.Mesh(geo, m2)); }
    group.children.forEach((c) => (c.frustumCulled = false));
    return { object: group, update(t, a, p) { setMeshUniforms(mats, p, a, t); if (solid) { mats[0].uniforms.uOpacity.value = p.opacity * 0.55; mats[1].uniforms.uGlow.value = p.glow * 0.5; } } };
  };
}

function sphereMesh(style, { detail = 3, faces = false } = {}) {
  return (p) => {
    const d = Math.max(1, Math.min(6, Math.round(detail + (p.density - 60) / 40)));
    const geo = ensureSeed(new THREE.IcosahedronGeometry(2.6, d));
    const mats = [meshMaterial(style, { wire: true })];
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, mats[0]));
    if (faces) { const m2 = meshMaterial(style); mats.push(m2); group.add(new THREE.Mesh(geo, m2)); }
    group.children.forEach((c) => (c.frustumCulled = false));
    return { object: group, update(t, a, p) { setMeshUniforms(mats, p, a, t); if (faces) mats[1].uniforms.uOpacity.value = p.opacity * 0.18; } };
  };
}

function neuralMesh(p) {
  const n = Math.max(20, Math.round(p.density * 2.2));
  const rng = createRNG(4242);
  const nodes = [];
  for (let i = 0; i < n; i++) nodes.push([rng.range(-5, 5), rng.range(-6, 6), rng.range(-3, 3)]);
  const pos = [], seeds = [], uvs = [], idx = [];
  nodes.forEach((v, i) => { pos.push(...v); seeds.push(h(i), h(i, 1), h(i, 2), h(i, 3)); uvs.push(0, 0); });
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  pg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(n * 3).fill(0), 3));
  // aristas a los 3 vecinos más próximos; cada extremo lleva la semilla de su nodo (se mueve con él)
  const lp = [], ls = [], lu = [];
  const seen = new Set();
  nodes.forEach((a, i) => {
    const d = nodes.map((b, j) => [j, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]).slice(0, 3);
    for (const [j] of d) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue; seen.add(key);
      const e = seen.size;
      lp.push(...a, ...nodes[j]);
      ls.push(h(i), h(e, 5), h(i, 2), h(i, 3), h(j), h(e, 5) + 0.25, h(j, 2), h(j, 3));
      lu.push(0, 0, 1, 0);
    }
  });
  // la semilla .y de cada extremo difiere en 0,25: el pulso recorre la arista
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lg.setAttribute('aSeed', new THREE.Float32BufferAttribute(ls, 4));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(lp.length).fill(0), 3));
  const mLines = meshMaterial(0), mPts = meshMaterial(0, { point: true });
  const group = new THREE.Group();
  const lines = new THREE.LineSegments(lg, mLines), pts = new THREE.Points(pg, mPts);
  lines.frustumCulled = pts.frustumCulled = false;
  group.add(lines, pts);
  return { object: group, update(t, a, p) { setMeshUniforms([mLines, mPts], p, a, t); mLines.uniforms.uGlow.value = p.glow * 0.7; } };
}

function connectedParticles(p) {
  const n = Math.max(20, Math.min(160, Math.round(p.density * 1.2)));
  const maxPairs = n * 8;
  const pp = new Float32Array(n * 3), lpos = new Float32Array(maxPairs * 6), lseed = new Float32Array(maxPairs * 8);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const ps = new Float32Array(n * 4); for (let i = 0; i < n; i++) ps.set([h(i), h(i, 1), h(i, 2), h(i, 3)], i * 4);
  pg.setAttribute('aSeed', new THREE.BufferAttribute(ps, 4));
  pg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  pg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
  lg.setAttribute('aSeed', new THREE.BufferAttribute(lseed, 4));
  lg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(maxPairs * 4), 2));
  lg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(maxPairs * 6), 3));
  const mL = meshMaterial(0), mP = meshMaterial(0, { point: true });
  mL.uniforms.uStyle.value = 99; mP.uniforms.uStyle.value = 99; // sin desplazamiento en el shader: posiciones en CPU
  const lines = new THREE.LineSegments(lg, mL), pts = new THREE.Points(pg, mP);
  lines.frustumCulled = pts.frustumCulled = false;
  const group = new THREE.Group(); group.add(lines, pts);
  return {
    object: group,
    update(t, a, p) {
      const s = t * p.speed * 0.35, A = 4.2 * (0.6 + 0.4 * p.amplitude);
      for (let i = 0; i < n; i++) {
        pp[i * 3] = A * Math.sin(s * (0.5 + h(i)) + h(i, 1) * 6.28) * (0.6 + 0.4 * h(i, 4));
        pp[i * 3 + 1] = A * 1.5 * Math.sin(s * (0.4 + h(i, 2)) * p.frequency + h(i, 3) * 6.28);
        pp[i * 3 + 2] = 2.5 * Math.cos(s * (0.3 + h(i, 5)) + h(i, 6) * 6.28);
      }
      const maxD = (1.4 + 0.8 * p.ondulation) * (1 + 0.3 * (a.bass || 0) * p.bassReact);
      let k = 0;
      for (let i = 0; i < n && k < maxPairs; i++) for (let j = i + 1; j < n && k < maxPairs; j++) {
        const dx = pp[i * 3] - pp[j * 3], dy = pp[i * 3 + 1] - pp[j * 3 + 1], dz = pp[i * 3 + 2] - pp[j * 3 + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < maxD) {
          lpos.set([pp[i * 3], pp[i * 3 + 1], pp[i * 3 + 2], pp[j * 3], pp[j * 3 + 1], pp[j * 3 + 2]], k * 6);
          const f = 1 - d / maxD;
          lseed.set([h(i), f, 0, f, h(j), f, 0, f], k * 8);
          k++;
        }
      }
      lg.setDrawRange(0, k * 2);
      lg.attributes.position.needsUpdate = true; lg.attributes.aSeed.needsUpdate = true; pg.attributes.position.needsUpdate = true;
      setMeshUniforms([mL, mP], p, a, t);
      mL.uniforms.uStyle.value = 99; mP.uniforms.uStyle.value = 99;
    },
  };
}

function circularMesh(p, env) {
  const seg = Math.max(12, Math.round(p.density * 0.5 * (env?.quality?.segments ?? 1)));
  const geo = ensureSeed(new THREE.RingGeometry(0.2, 9, 64, seg));
  const m = meshMaterial(6, { wire: true });
  const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false;
  return { object: mesh, update(t, a, p) { setMeshUniforms([m], p, a, t); } };
}

/** Campo eléctrico volumétrico: rayos que cambian por época (determinista) con envolvente suave + nube de puntos. */
function electricField(p) {
  const bolts = Math.max(3, Math.round(p.density / 10)), segs = 18;
  const lpos = new Float32Array(bolts * segs * 6), lseed = new Float32Array(bolts * segs * 8);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
  lg.setAttribute('aSeed', new THREE.BufferAttribute(lseed, 4));
  lg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bolts * segs * 4), 2));
  lg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bolts * segs * 6), 3));
  const mL = meshMaterial(99);
  const lines = new THREE.LineSegments(lg, mL); lines.frustumCulled = false;
  const cloudN = 1500;
  const cg = new THREE.BufferGeometry();
  const cp = new Float32Array(cloudN * 3), cs = new Float32Array(cloudN * 4);
  for (let i = 0; i < cloudN; i++) { cp.set([(h(i) - 0.5) * 12, (h(i, 1) - 0.5) * 16, (h(i, 2) - 0.5) * 8], i * 3); cs.set([h(i, 3), h(i, 4), h(i, 5), h(i, 6) * 0.4], i * 4); }
  cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
  cg.setAttribute('aSeed', new THREE.BufferAttribute(cs, 4));
  cg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cloudN * 2), 2));
  cg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cloudN * 3), 3));
  const mC = meshMaterial(0, { point: true });
  const cloud = new THREE.Points(cg, mC); cloud.frustumCulled = false;
  const group = new THREE.Group(); group.add(cloud, lines);
  return {
    object: group,
    update(t, a, p) {
      const rate = 1.2 + 2.5 * p.speed;
      for (let b = 0; b < bolts; b++) {
        const ph = t * rate + h(b, 9);
        const epoch = Math.floor(ph), k = ph - epoch;
        const env = bell(Math.min(1, k * 1.25)) * (0.5 + 0.5 * h(epoch * 31 + b, 2)); // fundido de entrada y salida
        const r = createRNG(hashInt(epoch * 977 + b * 131));
        const x0 = r.range(-4, 4), y0 = r.range(5, 8), x1 = r.range(-4, 4), y1 = r.range(-8, -5), z0 = r.range(-2, 2);
        let px = x0, py = y0, pz = z0;
        for (let s = 0; s < segs; s++) {
          const f = (s + 1) / segs;
          const jit = 0.9 * p.amplitude * (1 + 0.5 * (a.treble || 0) * p.trebleReact) * Math.sin(f * Math.PI);
          const nx = x0 + (x1 - x0) * f + r.range(-jit, jit), ny = y0 + (y1 - y0) * f, nz = z0 + r.range(-jit, jit) * 0.6;
          const i = b * segs + s;
          lpos.set([px, py, pz, nx, ny, nz], i * 6);
          lseed.set([b / bolts, env, 0, 0, b / bolts, env, 0, 0], i * 8);
          px = nx; py = ny; pz = nz;
        }
      }
      lg.attributes.position.needsUpdate = true; lg.attributes.aSeed.needsUpdate = true;
      setMeshUniforms([mL, mC], p, a, t);
      mL.uniforms.uStyle.value = 99;
      mL.uniforms.uGlow.value = p.glow * 1.4 * (0.75 + 0.35 * (a.bassSoft ?? a.bass ?? 0) * p.bassReact);
      mC.uniforms.uGlow.value = p.glow * 0.5;
    },
  };
}

/** Malla de líneas láser: abanico de haces que barren + rejilla de suelo. */
function laserLines(p) {
  const beams = Math.max(6, Math.round(p.density / 4));
  const geo = new THREE.BoxGeometry(0.035, 0.035, 1);
  const seed = new Float32Array(24 * 4);
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed.slice(0, geo.attributes.position.count * 4), 4));
  const mat = meshMaterial(99);
  const mesh = new THREE.InstancedMesh(geo, mat, beams * 2);
  mesh.frustumCulled = false;
  // los haces usan el material de malla sin desplazamiento; el brillo por instancia va en la escala Y del haz
  const grid = gridSurface(4, { wire: true, w: 30, hgt: 50 })({ ...p, density: Math.min(40, p.density) });
  grid.object.rotation.x = -Math.PI / 2; grid.object.position.set(0, -3.2, -18);
  const group = new THREE.Group(); group.add(grid.object, mesh);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
  return {
    object: group,
    update(t, a, p) {
      const L = 40;
      for (let side = 0; side < 2; side++) for (let i = 0; i < beams; i++) {
        const k = i / (beams - 1) - 0.5;
        const sweep = Math.sin(t * p.speed * 0.8 + side * 1.7) * 0.5 * p.ondulation;
        const yaw = k * 1.3 * p.frequency * 0.6 + sweep, pitch = 0.08 + 0.12 * Math.sin(t * 0.6 + i);
        e.set(pitch, yaw + (side ? Math.PI * 0.08 : -Math.PI * 0.08), 0, 'YXZ'); q.setFromEuler(e);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const ox = side ? 3 : -3;
        v.set(ox + dir.x * L / 2, -2 + dir.y * L / 2, -p.depth + dir.z * L / 2);
        s.set(1 + (a.mid || 0) * p.midReact, 1, L);
        m4.compose(v, q, s);
        mesh.setMatrixAt(side * beams + i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      setMeshUniforms([mat], p, a, t);
      mat.uniforms.uStyle.value = 99;
      mat.uniforms.uGlow.value = p.glow * 1.6 * (0.7 + 0.4 * (a.energySoft ?? a.energy ?? 0));
      grid.update(t, a, { ...p, amplitude: p.amplitude * 0.4, opacity: p.opacity * 0.5 });
    },
  };
}

function geometricSurface(p) {
  const seg = Math.max(16, Math.round(p.density));
  const geo = ensureSeed(new THREE.PlaneGeometry(1, 1, seg, Math.round(seg * 0.6)));
  const m = meshMaterial(11, { wire: true });
  const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false;
  return { object: mesh, update(t, a, p) { setMeshUniforms([m], p, a, t); m.uniforms.uMorph.value = p.ondulation * 2; } };
}

export const MESHES = [
  { id: 'neural', label: 'Malla neuronal', build: placed(neuralMesh, 'center'), defaults: { density: 50, glow: 1.2 } },
  { id: 'energy', label: 'Malla de energía', build: placed(gridSurface(1, { w: 26, hgt: 26 }), 'back'), defaults: { density: 70 } },
  { id: 'holographic', label: 'Malla holográfica', build: placed(sphereMesh(2, { detail: 3 }), 'center'), defaults: { amplitude: 0.6 } },
  { id: 'plasma', label: 'Malla de plasma', build: placed(gridSurface(3, { wire: false, w: 30, hgt: 30 }), 'back'), defaults: { opacity: 0.6, glow: 0.9 } },
  { id: 'wavy', label: 'Malla ondulada', build: placed(gridSurface(4, { w: 30, hgt: 50 }), 'floor'), defaults: { density: 50, amplitude: 0.8 } },
  { id: 'polygonal', label: 'Malla poligonal', build: placed(sphereMesh(5, { detail: 1, faces: true }), 'center'), defaults: { amplitude: 0.9, density: 30 } },
  { id: 'connected', label: 'Partículas conectadas', build: placed(connectedParticles, 'center'), defaults: { density: 80 } },
  { id: 'circular', label: 'Malla circular', build: placed(circularMesh, 'back'), defaults: { density: 50, glow: 0.7, opacity: 0.7 } },
  { id: 'wavesurface', label: 'Superficie de ondas', build: placed(gridSurface(8, { wire: false, solid: true, w: 30, hgt: 50 }), 'floor'), defaults: { density: 70, opacity: 0.9 } },
  { id: 'electric', label: 'Campo eléctrico volumétrico', build: placed(electricField, 'center'), defaults: { density: 50, glow: 1.3 } },
  { id: 'laser', label: 'Malla de líneas láser', build: laserLines, defaults: { density: 40, ondulation: 1 } },
  { id: 'geometric', label: 'Superficies geométricas animadas', build: placed(geometricSurface, 'center'), defaults: { density: 70, amplitude: 0.8 } },
];
export const MESH_BY_ID = Object.fromEntries(MESHES.map((x) => [x.id, x]));
