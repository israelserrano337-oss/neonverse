// Estudio de túneles 3D: 18 tipos. Cada tipo construye sus mallas una vez y las coloca para el instante t (función pura).
import * as THREE from 'three';
import { neonMaterial, shaderMaterial, instanced, vertexInst, setCommon, COLOR_MODES } from '../engine/materials.js';
import { hashInt, mod } from '../core/util.js';

const h = (i, salt = 0) => hashInt(i * 7919 + salt * 104729) / 4294967296;

export const TUNNEL_PARAMS = [
  { key: 'speed', label: 'Velocidad', min: 0, max: 3, step: 0.01, value: 1 },
  { key: 'depth', label: 'Profundidad', min: 15, max: 120, step: 1, value: 60 },
  { key: 'rotation', label: 'Rotación', min: -2, max: 2, step: 0.01, value: 0.15 },
  { key: 'zoom', label: 'Zoom', min: 0.5, max: 2.5, step: 0.01, value: 1 },
  { key: 'perspective', label: 'Perspectiva (FOV)', min: 35, max: 115, step: 1, value: 72 },
  { key: 'scale', label: 'Escala', min: 0.4, max: 3, step: 0.01, value: 1 },
  { key: 'density', label: 'Densidad', min: 6, max: 80, step: 1, value: 28, rebuild: true },
  { key: 'glow', label: 'Intensidad luminosa', min: 0, max: 3, step: 0.01, value: 1.2 },
  { key: 'thickness', label: 'Grosor', min: 0.01, max: 0.4, step: 0.01, value: 0.06, rebuild: true },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, value: 0.9 },
  { key: 'direction', label: 'Dirección', options: [{ value: 'forward', label: 'Hacia delante' }, { value: 'backward', label: 'Hacia atrás' }], value: 'forward' },
  { key: 'colorMode', label: 'Color', options: COLOR_MODES, value: 0 },
  { key: 'colorShift', label: 'Desplazar color', min: 0, max: 1, step: 0.01, value: 0 },
  { key: 'camera', label: 'Movimiento de cámara', min: 0, max: 1, step: 0.01, value: 0.3 },
  { key: 'react', label: 'Reacción musical', min: 0, max: 2, step: 0.01, value: 1 },
];

// ------------------------------------------------------------ utilidades comunes (puras)
export function travelOf(t, a, p, kw = 1) { // kw: peso del empujón del bombo (menor en túneles que llenan la pantalla)
  const dir = p.direction === 'backward' ? -1 : 1;
  const r = Math.min(1.5, p.react), kicks = a.kickTravel !== undefined;
  return dir * p.speed * (t * (kicks ? 5 - 2.6 * Math.min(1, r) * kw : 5) + (a.travelBass || 0) * r * 2.5 + (a.kickTravel || 0) * r * 15 * kw);
}
function bend(z, t, p, L) {
  const k = Math.min(1, -z / L), c = p.camera, kk = k * k;
  return [c * 2.4 * kk * Math.sin(t * 0.45 + z * 0.03), c * 1.7 * kk * Math.cos(t * 0.33 + z * 0.025)];
}
function roll(t, p) { return p.rotation * t + p.camera * 0.35 * Math.sin(t * 0.27); }
/** Onda luminosa que recorre el túnel en cada golpe (envolvente suave). */
function wave(dn, a, react) {
  // La onda recorre el túnel de fondo a cámara durante el golpe y se apaga antes de llegar:
  // en el instante del golpe (cuando salta de posición) su peso es cero, así que no hay destello.
  const x = dn - (1 - (a.beatPhase || 0));
  const fadeNear = dn < 0.06 ? 0 : dn > 0.45 ? 1 : ((dn - 0.06) / 0.39) ** 2;
  return react * 0.4 * Math.exp(-x * x * 28) * fadeNear * (0.4 + 0.6 * (a.sectionEnergy ?? 0.6));
}
function glowOf(p, a) { return Math.min(1.8, p.glow) * (0.88 + 0.22 * (a.energySoft ?? a.energy ?? 0) * Math.min(1.5, p.react)); }
function radius(p, a, dn = 0) { const r = Math.min(1.5, p.react); return 3 * p.scale * (1 + r * (0.04 * (a.bassSoft ?? a.bass ?? 0) + 0.15 * Math.min(1, a.kickPulse || 0) * (0.25 + 0.75 * Math.min(1, dn * 2.5)))); }

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
function compose(mesh, i, x, y, z, rx, ry, rz, sx, sy, sz) {
  E.set(rx, ry, rz); Q.setFromEuler(E); P.set(x, y, z); S.set(sx, sy, sz);
  M.compose(P, Q, S); mesh.setMatrixAt(i, M);
}
function setInst(mesh, i, u, b, x = 0, w = 0) { const a = mesh.geometry.attributes.aInst.array; a[i * 4] = u; a[i * 4 + 1] = b; a[i * 4 + 2] = x; a[i * 4 + 3] = w; }
function flush(mesh) { mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.aInst.needsUpdate = true; }
function common(mat, p, a, L, t, near = 0.5, nearW = 1.4) { setCommon(mat, p, { uGlow: glowOf(p, a), uFar: L * 0.97, uNear: near, uNearW: nearW, uTime: t }); }
/** Distancia a la que un anillo de radio R empieza a salir del encuadre: se funde antes de cruzar el borde. */
const edgeNear = (p) => Math.max(0.5, 2.4 * p.scale * (1 + 0.15 * (p.speed - 1)));

// ------------------------------------------------------------ túneles de marcos (anillos, polígonos…)
function frameTunnel(shapes, { twist = 0, alt = 0, band = 1 } = {}) {
  return (p) => {
    const group = new THREE.Group();
    const n = Math.round(p.density);
    const mat = neonMaterial({ side: THREE.DoubleSide });
    const th = p.thickness * band;
    const meshes = shapes.map((sides, k) => {
      const count = Math.ceil((n - k) / shapes.length);
      const geo = new THREE.RingGeometry(1 - th / 2, 1 + th / 2, sides, 1, Math.PI / 2);
      const m = instanced(geo, mat, Math.max(1, count));
      group.add(m);
      return m;
    });
    return {
      object: group,
      update(t, a, p) {
        const L = p.depth, spacing = L / n, travel = travelOf(t, a, p);
        group.rotation.z = roll(t, p);
        const idx = shapes.map(() => 0);
        for (let i = 0; i < n; i++) {
          const k = i % shapes.length, m = meshes[k], j = idx[k]++;
          const d = mod(i * spacing - travel, L), z = -d, dn = d / L;
          const [ox, oy] = bend(z, t, p, L);
          const r = radius(p, a, dn);
          const rz = i * twist + (alt && i % 2 ? alt : 0);
          compose(m, j, ox, oy, z, 0, 0, rz, r, r, 1);
          setInst(m, j, i / n * 1.0 + dn * 0.0, 0.55 + 0.45 * h(i) + wave(dn, a, p.react), h(i, 3));
        }
        meshes.forEach(flush);
        common(mat, p, a, L, t, edgeNear(p), 1.5 + 2.2 * p.speed); // fundido más largo cuanto más rápido
      },
    };
  };
}

// ------------------------------------------------------------ espiral (hélices de tubo)
function spiralTunnel(p) {
  const group = new THREE.Group();
  const arms = Math.max(2, Math.min(8, Math.round(p.density / 8)));
  const L = 120, pitch = 9, R = 3;
  const mat = neonMaterial({ uAlong: 1 });
  const holder = new THREE.Group();
  for (let k = 0; k < arms; k++) {
    const pts = [];
    for (let s = 0; s <= 600; s++) { const z = -s / 600 * L; const ang = (z / pitch) * Math.PI * 2 + (k / arms) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(ang) * R, Math.sin(ang) * R, z)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 600, Math.max(0.015, p.thickness * 0.8), 6, false);
    vertexInst(geo, () => [k / arms, 1, 0, 0]);
    holder.add(new THREE.Mesh(geo, mat));
  }
  group.add(holder);
  return {
    object: group,
    update(t, a, p) {
      const travel = travelOf(t, a, p);
      const s = p.scale * (1 + p.react * 0.06 * (a.bass || 0));
      holder.scale.set(s, s, 1);
      holder.rotation.z = -(travel / pitch) * Math.PI * 2 + roll(t, p);
      common(mat, p, a, Math.min(L, p.depth), t);
      mat.uniforms.uGlow.value = glowOf(p, a) * (1 + wave(0.3, a, p.react) * 0.5);
    },
  };
}

// ------------------------------------------------------------ sólidos instanciados en anillos (cubos, cristales, metal)
function solidRingTunnel({ geometry, perRing = 8, metal = 0, solid = false, size = 1, spin = 1, scatter = 0, stretch = 1 }) {
  return (p) => {
    const group = new THREE.Group();
    const rings = Math.round(p.density);
    const per = perRing;
    const mat = neonMaterial({ metal, solid });
    const mesh = instanced(geometry(p), mat, rings * per);
    group.add(mesh);
    return {
      object: group,
      update(t, a, p) {
        const L = p.depth, spacing = L / rings, travelS = travelOf(t, a, p, 0.4);
        group.rotation.z = roll(t, p);
        let i = 0;
        for (let r = 0; r < rings; r++) {
          const d = mod(r * spacing - travelS, L), z = -d, dn = d / L;
          const [ox, oy] = bend(z, t, p, L);
          const R = radius(p, a, dn);
          for (let k = 0; k < per; k++, i++) {
            const ang = (k / per) * Math.PI * 2 + r * 0.35 + scatter * (h(i, 5) - 0.5) * 1.2;
            const rr = R * (1 + scatter * (h(i, 7) - 0.5) * 0.5);
            const sc = (0.18 + p.thickness * 2.2) * size * (1 + 0.2 * p.react * (a.midSoft ?? a.mid ?? 0));
            const sp = spin * (t * (0.6 + h(i)) + h(i, 9) * 6);
            compose(mesh, i, ox + Math.cos(ang) * rr, oy + Math.sin(ang) * rr, z + scatter * (h(i, 11) - 0.5) * spacing, sp, sp * 0.7, ang, sc, sc, sc * stretch);
            setInst(mesh, i, r / rings + k / per * 0.15, 0.6 + 0.4 * h(i, 2) + wave(dn, a, p.react), h(i, 4));
          }
        }
        flush(mesh);
        common(mat, p, a, L, t, 2.2 + 0.6 * Math.min(1, a.kickPulse || 0) * Math.min(1, p.speed)); // los sólidos se funden antes de pasar junto a la cámara (más aún en el acelerón)
      },
    };
  };
}

// Estructuras metálicas: marcos cuadrados de 4 vigas + vigas longitudinales
function metalTunnel(p) {
  const group = new THREE.Group();
  const rings = Math.round(p.density);
  const mat = neonMaterial({ metal: 0.85, solid: true });
  const th = 0.08 + p.thickness;
  const beams = instanced(new THREE.BoxGeometry(1, th, th), mat, rings * 4);
  const rails = instanced(new THREE.BoxGeometry(th * 1.3, th * 1.3, 1), mat, 8);
  const lights = neonMaterial();
  const leds = instanced(new THREE.BoxGeometry(0.9, th * 0.35, th * 0.35), lights, rings * 4);
  group.add(beams, rails, leds);
  return {
    object: group,
    update(t, a, p) {
      const L = p.depth, spacing = L / rings, travel = travelOf(t, a, p);
      group.rotation.z = roll(t, p) * 0.5;
      const R = 3 * p.scale;
      for (let r = 0; r < rings; r++) {
        const d = mod(r * spacing - travel, L), z = -d, dn = d / L;
        const [ox, oy] = bend(z, t, p, L);
        for (let k = 0; k < 4; k++) {
          const ang = (k / 4) * Math.PI * 2, i = r * 4 + k;
          const cx = ox + Math.cos(ang) * R, cy = oy + Math.sin(ang) * R;
          compose(beams, i, cx, cy, z, 0, 0, ang + Math.PI / 2, R * 2 + th, 1, 1);
          setInst(beams, i, r / rings, 1, h(i));
          const inset = 0.92;
          compose(leds, i, ox + Math.cos(ang) * R * inset, oy + Math.sin(ang) * R * inset, z, 0, 0, ang + Math.PI / 2, R * 1.8, 1, 1);
          setInst(leds, i, r / rings + 0.1 * k, 0.5 + wave(dn, a, p.react) * 1.4 + 0.25 * (a.midSoft ?? a.mid ?? 0) * p.react, 0);
        }
      }
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
        compose(rails, k, Math.cos(ang) * R * 1.02, Math.sin(ang) * R * 1.02, -L / 2, 0, 0, 0, 1, 1, L);
        setInst(rails, k, k / 8, 1, 0);
      }
      [beams, rails, leds].forEach(flush);
      common(mat, p, a, L, t);
      mat.uniforms.uGlow.value = 0.9;
      common(lights, p, a, L, t);
    },
  };
}

// ------------------------------------------------------------ láser y líneas luminosas (vigas finas que fluyen)
function streakTunnel({ count = 6, len = 8, speedMul = 1.6, radial = 'wall', twist = 0 }) {
  return (p) => {
    const group = new THREE.Group();
    const n = Math.round(p.density) * count;
    const mat = neonMaterial();
    const mesh = instanced(new THREE.BoxGeometry(Math.max(0.01, p.thickness * 0.6), Math.max(0.01, p.thickness * 0.6), 1), mat, n);
    group.add(mesh);
    return {
      object: group,
      update(t, a, p) {
        const L = p.depth, travel = travelOf(t, a, p) * speedMul;
        group.rotation.z = roll(t, p);
        const R = 3 * p.scale;
        for (let i = 0; i < n; i++) {
          const ang = h(i) * Math.PI * 2 + twist * t * (h(i, 3) - 0.5);
          // en cada bombo las estelas se abren hacia fuera y se estiran («salto a la velocidad de la luz»)
          const kS = Math.min(1, a.kickPulse || 0) * Math.min(1.5, p.react);
          const rr = (radial === 'wall' ? R * (0.95 + 0.1 * h(i, 2)) : R * (0.5 + 1.1 * Math.sqrt(h(i, 2)))) * (1 + 0.16 * kS);
          const l = len * (0.5 + h(i, 4)) * (radial === 'wall' ? 1 : (0.4 + 0.6 * p.speed)) * (1 + 0.7 * kS);
          const d = mod(h(i, 6) * L - travel * (0.8 + 0.4 * h(i, 8)), L), z = -d, dn = d / L;
          const [ox, oy] = bend(z, t, p, L);
          compose(mesh, i, ox + Math.cos(ang) * rr, oy + Math.sin(ang) * rr, z - l / 2, 0, 0, ang, 1, 1, l);
          setInst(mesh, i, h(i, 9), (0.5 + 0.5 * h(i, 10)) * (0.7 + 0.4 * p.react * (a.trebleSoft ?? a.treble ?? 0)) + wave(dn, a, p.react), 0);
        }
        flush(mesh);
        common(mat, p, a, L, t, 1.5 + 0.8 * p.speed); // cuanto más rápidas, antes se funden (sin destellos al pasar)
      },
    };
  };
}

// ------------------------------------------------------------ partículas (posiciones en el shader)
function particleTunnel(p, env) {
  const n = Math.max(200, Math.round(p.density * 90 * (env?.quality?.particles ?? 1)));
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) seed.set([h(i), h(i, 1), h(i, 2), h(i, 3)], i * 4);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = shaderMaterial({
    uniforms: { uL: { value: 60 }, uR: { value: 3 }, uSize: { value: 1 }, uRoll: { value: 0 }, uCam: { value: 0 }, uPix: { value: 1 } },
    vertex: /* glsl */ `
      attribute vec4 aSeed; uniform float uTravel, uL, uR, uSize, uRoll, uTime, uCam, uPix, uBass;
      varying float vU; varying float vA;
      void main(){
        float d = mod(aSeed.z * uL - uTravel * (0.7 + 0.6 * aSeed.w), uL);
        float ang = aSeed.x * 6.2831853 + uRoll;
        float r = uR * (0.75 + 0.5 * aSeed.y) * (1.0 + 0.08 * uBass);
        float k = d / uL;
        vec3 p = vec3(cos(ang) * r + uCam * 2.4 * k * k * sin(uTime * 0.45 - d * 0.03), sin(ang) * r + uCam * 1.7 * k * k * cos(uTime * 0.33 - d * 0.025), -d);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPix * uSize * (2.0 + 6.0 * aSeed.y) * 8.0 / max(0.5, -mv.z);
        vU = aSeed.x + k; vA = smoothstep(uL, uL * 0.6, d) * smoothstep(0.3, 1.5, d);
      }`,
    fragment: /* glsl */ `
      uniform float uGlow, uOpacity, uShift, uMode; varying float vU; varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float m = smoothstep(0.5, 0.0, length(c)); m *= m;
        gl_FragColor = vec4(layerColor(vU + uShift, uMode) * uGlow * uPalIntensity, m * vA * uOpacity); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    object: pts,
    update(t, a, p, env) {
      const u = mat.uniforms;
      common(mat, p, a, p.depth, t);
      u.uTravel.value = travelOf(t, a, p) * 1.4; u.uL.value = p.depth; u.uR.value = 3 * p.scale;
      const kT = Math.min(1, a.kickPulse || 0) * Math.min(1.5, p.react);
      u.uSize.value = (0.6 + p.thickness * 6) * (1 + 0.5 * kT); u.uRoll.value = roll(t, p); u.uCam.value = p.camera; u.uBass.value = (a.bassSoft ?? a.bass ?? 0) * p.react + 1.6 * kT;
      u.uPix.value = env?.pixelRatio ?? 1;
    },
  };
}

// ------------------------------------------------------------ túneles de shader sobre cilindro
const CYL_VERT = /* glsl */ `
varying vec2 vUv; varying float vDepth; uniform float uTime, uCam, uL, uWave, uBass, uFreq;
void main(){
  vUv = uv;
  vec3 p = position;
  float d = -p.z, k = d / uL;
  float w = uWave * (0.25 + 0.75 * uBass) * sin(uv.y * uL * uFreq * 0.25 - uTime * 3.0 + uv.x * 6.2831 * 3.0);
  p.xy *= 1.0 + w * 0.12;
  p.x += uCam * 2.4 * k * k * sin(uTime * 0.45 - d * 0.03);
  p.y += uCam * 1.7 * k * k * cos(uTime * 0.33 - d * 0.025);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const CYL_HEAD = /* glsl */ `
varying vec2 vUv; varying float vDepth;
uniform float uGlow, uOpacity, uShift, uMode, uNear, uFar, uTime, uTravel, uL, uDensity, uBass, uMid, uTreble, uBeat, uEnergy;
float fogF(){ return smoothstep(uFar, uFar * 0.5, vDepth) * smoothstep(uNear, uNear + 1.5, vDepth); }
vec4 outC(vec3 c, float a){ return vec4(c * uGlow * uPalIntensity, clamp(a * uOpacity * fogF(), 0.0, 1.0)); }
`;
const CYL_PATTERNS = {
  plasma: /* glsl */ `void main(){
    vec2 q = vec2(vUv.x * 6.2831853, vUv.y * uL * 0.12 * uDensity + uTravel * 0.06);
    float v = sin(q.x * 2.0 + uTime) + sin(q.y * 1.3 + uTime * 0.7) + sin((q.x + q.y) * 1.1 + uTime * 0.5) + sin(length(vec2(sin(q.x), q.y * 0.3)) * 3.0 - uTime);
    v += fbm(q * 0.8 + uTime * 0.2) * 2.0;
    vec3 c = layerColor(v * 0.12 + uShift, uMode);
    float bright = 0.3 + 0.55 * smoothstep(-1.0, 3.0, v) + 0.15 * uBass;
    gl_FragColor = outC(c * bright, 0.85); }`,
  fractal: /* glsl */ `void main(){
    float a = vUv.x * 6.2831853; float seg = 6.2831853 / 6.0; a = abs(mod(a, seg) - seg * 0.5);
    float z = vUv.y * uL * 0.06 * uDensity + uTravel * 0.05;
    vec2 p = vec2(cos(a), sin(a)) * (0.6 + 0.4 * fract(z)) ;
    p += vec2(sin(z * 0.7), cos(z * 0.5)) * 0.3;
    float acc = 0.0, m = 0.0;
    vec2 c = vec2(-0.72 + 0.08 * sin(uTime * 0.21), -0.56 + 0.06 * cos(uTime * 0.17)) - 0.02 * uBass;
    for (int i = 0; i < 9; i++){ p = abs(p) / dot(p, p) + c; float l = length(p); acc += exp(-l * 1.6); m = max(m, l); }
    vec3 col = layerColor(acc * 0.12 + z * 0.05 + uShift, uMode) * (0.12 + acc * 0.13);
    gl_FragColor = outC(col, 0.9); }`,
  energy: /* glsl */ `void main(){
    float ang = vUv.x * 64.0 * uDensity * 0.25;
    float lane = floor(ang); float f = fract(ang);
    float sp = 0.6 + hash11(lane) * 1.4;
    float z = vUv.y * uL * 0.25 + uTravel * 0.5 * sp + hash11(lane + 3.0) * 40.0;
    float streak = smoothstep(0.0, 0.1, fract(z * 0.05)) * smoothstep(1.0, 0.4, fract(z * 0.05));
    float core = smoothstep(0.5, 0.0, abs(f - 0.5)) ;
    float flow = fbm(vec2(vUv.x * 20.0, vUv.y * uL * 0.1 + uTravel * 0.2));
    float v = core * core * streak * (0.6 + 0.8 * uTreble * hash11(lane + 7.0)) + flow * 0.18;
    gl_FragColor = outC(layerColor(lane * 0.07 + uShift, uMode) * v * 1.6, 1.0); }`,
  holo: /* glsl */ `void main(){
    vec2 g = vec2(vUv.x * 24.0 * uDensity * 0.25, vUv.y * uL * 0.5 * uDensity * 0.25 + uTravel * 0.3);
    vec2 f = abs(fract(g) - 0.5);
    float line = smoothstep(0.47, 0.5, max(f.x, f.y));
    float scan = 0.6 + 0.4 * sin(vUv.y * uL * 6.0 - uTime * 8.0);
    float band = smoothstep(0.92, 1.0, sin(vUv.y * uL * 0.4 + uTravel * 0.2 - uTime * 2.0));
    vec3 irid = hsv2rgb(vec3(fract(vUv.x * 2.0 + vUv.y * 3.0 + uTime * 0.05 + uShift), 0.55, 1.0));
    vec3 c = mix(layerColor(vUv.x + uShift, uMode), irid, 0.45);
    float v = (line * scan * smoothstep(0.015, 0.1, vUv.y) + band * 0.35 * smoothstep(0.04, 0.3, vUv.y)) + 0.05;
    gl_FragColor = outC(c * v * (0.8 + 0.6 * uMid), 1.0); }`,
  waves: /* glsl */ `void main(){
    float v = 0.55 + 0.45 * sin(vUv.y * uL * 0.8 - uTime * 3.0);
    gl_FragColor = outC(layerColor(vUv.y * 2.0 + vUv.x + uShift, uMode) * v, 1.0); }`,
};
function cylinderTunnel(kind, { wire = false } = {}) {
  return (p, env) => {
    const L = 120;
    const radial = wire ? 40 : 64, heightSegs = wire ? Math.round(40 + p.density * 2) : 1;
    const geo = new THREE.CylinderGeometry(3, 3, L, radial, heightSegs, true);
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -L / 2);
    // uv.y = 0 cerca de la cámara, 1 al fondo
    const mat = shaderMaterial({
      vertex: CYL_VERT, fragment: CYL_HEAD + CYL_PATTERNS[kind], side: THREE.BackSide, wireframe: wire,
      uniforms: { uL: { value: L }, uCam: { value: 0 }, uWave: { value: wire ? 1 : 0 }, uDensity: { value: 1 }, uFreq: { value: 1 } },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return {
      object: mesh,
      update(t, a, p) {
        const u = mat.uniforms;
        common(mat, p, a, p.depth, t);
        u.uTravel.value = travelOf(t, a, p, 0); // llenan la pantalla: sin acelerón (solo el pulso de escala) u.uCam.value = p.camera;
        u.uDensity.value = p.density / 28; u.uFreq.value = p.density / 28;
        u.uBass.value = (a.bassSoft ?? a.bass ?? 0) * p.react; u.uMid.value = (a.midSoft ?? a.mid ?? 0) * p.react; u.uTreble.value = (a.trebleSoft ?? a.treble ?? 0) * p.react;
        u.uBeat.value = (a.beat || 0) * p.react; u.uEnergy.value = a.energy || 0;
        const kp = 1 + 0.045 * Math.min(1, a.kickPulse || 0) * Math.min(1, p.react); mesh.scale.set(p.scale * kp, p.scale * kp, 1);
        mesh.rotation.z = roll(t, p);
      },
    };
  };
}

// ------------------------------------------------------------ portales dimensionales: anillos + discos en espiral
function portalTunnel(p, env) {
  const ring = frameTunnel([48], { band: 2.2 })(p, env);
  const group = new THREE.Group();
  group.add(ring.object);
  const n = Math.max(2, Math.round(p.density / 5));
  const geo = new THREE.CircleGeometry(1, 64);
  const mat = shaderMaterial({
    side: THREE.DoubleSide,
    vertex: /* glsl */ `attribute vec4 aInst; varying vec2 vUv; varying float vDepth; varying vec4 vI;
      void main(){ vUv = uv; vI = aInst; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragment: /* glsl */ `varying vec2 vUv; varying float vDepth; varying vec4 vI;
      uniform float uGlow, uOpacity, uShift, uMode, uNear, uFar, uTime, uBass;
      void main(){ vec2 q = vUv - 0.5; float r = length(q) * 2.0; float a = atan(q.y, q.x);
        float sw = sin(a * 5.0 + r * 9.0 - uTime * 3.0 + vI.z * 6.0);
        float ringMask = smoothstep(0.15, 0.6, r) * smoothstep(1.0, 0.85, r);
        float v = (0.5 + 0.5 * sw) * ringMask * (0.55 + 0.3 * uBass);
        float fog = smoothstep(uFar, uFar * 0.5, vDepth) * smoothstep(uNear, uNear + 2.6, vDepth);
        gl_FragColor = vec4(layerColor(r * 0.5 + a * 0.08 + vI.x + uShift, uMode) * uGlow * uPalIntensity, v * fog * uOpacity * vI.y); }`,
  });
  const discs = instanced(geo, mat, n);
  group.add(discs);
  return {
    object: group,
    update(t, a, p, env) {
      const pc = { ...p, react: Math.min(p.react, 0.55) }; // anillos gruesos y discos: empujón menor (sin destellos)
      ring.update(t, a, pc, env);
      const L = p.depth, spacing = L / n, travel = travelOf(t, a, pc);
      for (let i = 0; i < n; i++) {
        const d = mod(i * spacing + spacing / 2 - travel, L), z = -d;
        const [ox, oy] = bend(z, t, p, L);
        const r = radius(p, a, d / L) * 0.98;
        compose(discs, i, ox, oy, z, 0, 0, t * 0.5 * (i % 2 ? 1 : -1), r, r, 1);
        setInst(discs, i, i / n, 0.55, h(i));
      }
      flush(discs);
      common(mat, p, a, L, t);
      mat.uniforms.uNear.value = edgeNear(p) + 4; // los discos se funden antes: con el acelerón del bombo no llenan la pantalla de golpe
      mat.uniforms.uBass.value = (a.bassSoft ?? a.bass ?? 0) * p.react;
      group.rotation.z = 0;
    },
  };
}

// ------------------------------------------------------------ catálogo
export const TUNNELS = [
  { id: 'rings', label: 'Anillos concéntricos', build: frameTunnel([64]), defaults: { thickness: 0.05 } },
  { id: 'spiral', label: 'Espirales', build: spiralTunnel, defaults: { density: 32, thickness: 0.05, rotation: 0.1 } },
  { id: 'hexagons', label: 'Hexágonos', build: frameTunnel([6], { twist: 0.12 }), defaults: { thickness: 0.07 } },
  { id: 'cubes', label: 'Cubos', build: solidRingTunnel({ geometry: () => new THREE.BoxGeometry(1, 1, 1), perRing: 10, metal: 0.25, solid: true, size: 1 }), defaults: { density: 18, thickness: 0.05 } },
  { id: 'crystals', label: 'Cristales', build: solidRingTunnel({ geometry: () => new THREE.OctahedronGeometry(1, 0), perRing: 9, size: 0.9, spin: 0.6, scatter: 1, stretch: 2.6 }), defaults: { density: 20, glow: 1.4 } },
  { id: 'polygons', label: 'Polígonos', build: frameTunnel([5, 7, 8], { twist: 0.08 }), defaults: { thickness: 0.06 } },
  { id: 'laser', label: 'Túnel láser', build: streakTunnel({ count: 4, len: 14, speedMul: 1.8, radial: 'wall', twist: 0.4 }), defaults: { density: 24, thickness: 0.03, glow: 1.6 } },
  { id: 'plasma', label: 'Túnel de plasma', build: cylinderTunnel('plasma'), defaults: { glow: 1, opacity: 0.85 } },
  { id: 'fractal', label: 'Túnel fractal', build: cylinderTunnel('fractal'), defaults: { glow: 1.1 } },
  { id: 'particles', label: 'Túnel de partículas', build: particleTunnel, defaults: { density: 40, thickness: 0.08, glow: 1.4 } },
  { id: 'waves', label: 'Túnel de ondas', build: cylinderTunnel('waves', { wire: true }), defaults: { density: 30, glow: 0.9, opacity: 0.7 } },
  { id: 'geometric', label: 'Túnel geométrico', build: frameTunnel([4, 3, 6], { twist: 0.26 }), defaults: { thickness: 0.07 } },
  { id: 'holographic', label: 'Túnel holográfico', build: cylinderTunnel('holo'), defaults: { glow: 1.1, opacity: 0.85 } },
  { id: 'energy', label: 'Túnel de energía', build: cylinderTunnel('energy'), defaults: { glow: 1.3 } },
  { id: 'metal', label: 'Estructuras metálicas', build: metalTunnel, defaults: { density: 16, thickness: 0.05, speed: 0.8 } },
  { id: 'triangles', label: 'Túnel de triángulos', build: frameTunnel([3], { alt: Math.PI / 3 }), defaults: { thickness: 0.08 } },
  { id: 'lightlines', label: 'Líneas luminosas', build: streakTunnel({ count: 8, len: 6, speedMul: 3, radial: 'free' }), defaults: { density: 26, thickness: 0.025, glow: 1.5, speed: 1.4 } },
  { id: 'portals', label: 'Portales dimensionales', build: portalTunnel, defaults: { density: 20, thickness: 0.06, glow: 1.3, speed: 0.8 } },
];
export const TUNNEL_BY_ID = Object.fromEntries(TUNNELS.map((x) => [x.id, x]));
