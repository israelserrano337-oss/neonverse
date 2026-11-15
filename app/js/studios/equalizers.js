// Ecualizadores 3D: Reactor, Púlsar, Vórtice y Matriz.
// Basados en «Reactor atómico · Ecualizador 3D» (aportado por el usuario), adaptados al motor determinista:
//  - el historial del espectro se lee del análisis en t − k·paso (no de fotogramas anteriores),
//  - los giros salen de t y de las integrales de energía (no de sumas por fotograma),
//  - las ondas de choque nacen en la rejilla de golpes con una envolvente suave.
import * as THREE from 'three';
import { neonMaterial, instanced, setCommon, COLOR_MODES, PAL_UNIFORMS } from '../engine/materials.js';

export const EQ_PARAMS = [
  { key: 'scale', label: 'Tamaño', min: 0.4, max: 2, step: 0.01, value: 1 },
  { key: 'height', label: 'Altura de las barras', min: 0, max: 2.5, step: 0.01, value: 1 },
  { key: 'trail', label: 'Estela (memoria del espectro)', min: 0, max: 3, step: 0.01, value: 1 },
  { key: 'speed', label: 'Velocidad de giro', min: 0, max: 3, step: 0.01, value: 1 },
  { key: 'orbit', label: 'Órbita de cámara', min: 0, max: 1, step: 0.01, value: 0.35 },
  { key: 'tilt', label: 'Inclinación', min: -0.6, max: 0.9, step: 0.01, value: 0 },
  { key: 'core', label: 'Núcleo luminoso', min: 0, max: 1.5, step: 0.01, value: 1 },
  { key: 'glow', label: 'Brillo', min: 0, max: 3, step: 0.01, value: 1.1 },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, value: 0.95 },
  { key: 'colorMode', label: 'Color', options: COLOR_MODES, value: 6 },
  { key: 'colorShift', label: 'Desplazar color', min: 0, max: 1, step: 0.01, value: 0 },
  { key: 'react', label: 'Reacción musical', min: 0, max: 2, step: 0.01, value: 1 },
];

const NBAND = 24, PER = 48;
const bandOf = (i) => { const m = i % PER; return m < NBAND ? m : PER - 1 - m; };
const TAN24 = Math.tan((24 * Math.PI) / 180); // FOV original de 48°
const ORIG = { c0: new THREE.Color(0x2a5bff), c1: new THREE.Color(0x3fd2ff), c2: new THREE.Color(0xeaf8ff), gold: new THREE.Color(0xffc46b), white: new THREE.Color(0xfff2d8) };
const yA = new THREE.Vector3(0, 1, 0), zA = new THREE.Vector3(0, 0, 1), xA = new THREE.Vector3(1, 0, 0);
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();

let glowTexCache = null;
function glowTex() {
  if (glowTexCache) return glowTexCache;
  const k = document.createElement('canvas'); k.width = k.height = 128;
  const x = k.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  glowTexCache = new THREE.CanvasTexture(k);
  glowTexCache.colorSpace = THREE.NoColorSpace;
  glowTexCache.userData.shared = true;
  return glowTexCache;
}
const addMat = (o) => new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, ...o });
function glow(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  s.scale.set(size, size, 1);
  return s;
}

/** Colores de acento (núcleo, electrones, anillos): originales (oro/hielo) o de la paleta del proyecto. */
function accents(p) {
  if (p.colorMode === 6) return { warm: ORIG.gold, core: ORIG.white, ring: ORIG.c1, ice: ORIG.c2 };
  return { warm: PAL_UNIFORMS.uC2.value, core: PAL_UNIFORMS.uC2.value, ring: PAL_UNIFORMS.uC0.value, ice: PAL_UNIFORMS.uC1.value };
}

/** Historial del espectro (24 bandas) a partir del análisis: hist(k) = espectro en t − k·paso. */
function makeHistory(n) {
  const frames = Array.from({ length: n }, () => new Float32Array(NBAND));
  const tmp = new Float32Array(32);
  return {
    update(t, a, p, env) {
      const step = (p.trail ?? 1) / 60;
      const gain = Math.min(1.25, p.react ?? 1) * (a.gain ?? 1); // tope: más ganancia satura todas las bandas a la vez
      for (let k = 0; k < n; k++) {
        const src = env.spectrumAt ? env.spectrumAt(t - k * step, tmp) : a.spectrum;
        const f = frames[k];
        for (let j = 0; j < NBAND; j++) {
          const x = (j * 31) / (NBAND - 1), i = Math.floor(x), w = x - i;
          const v = (src[i] * (1 - w) + src[Math.min(31, i + 1)] * w) * gain;
          f[j] = v > 1 ? 1 : v;
        }
      }
      return frames;
    },
  };
}
const histAt = (frames, k) => frames[Math.min(frames.length - 1, Math.max(0, k))];
/** Limitador de brillo: si todo el espectro sube a la vez, baja el brillo por barra (el tamaño sigue reaccionando). */
function limiter(frame) { let m = 0; for (let j = 0; j < NBAND; j++) m += frame[j]; m /= NBAND; return 0.85 / (0.5 + m); }

/** Distancia para encuadrar como el original (FOV 48°, radio visible 12,5 en vertical). */
function frameDist(env, base = 30, radius = 12.5) {
  const t = Math.tan(((env.fov ?? 68) * Math.PI) / 360);
  return Math.max((base * TAN24) / t, radius / (t * (env.aspect || 0.5625)));
}

function setBox(mesh, i, u, b) { const a = mesh.geometry.attributes.aInst.array; a[i * 4] = u; a[i * 4 + 1] = b; }
function flush(mesh) { mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.aInst.needsUpdate = true; }
function common(mat, p, a, D) {
  setCommon(mat, p, { uGlow: Math.min(2.2, p.glow), uNear: 0.5, uNearW: 1, uFar: D + 60 });
}
/** Rotación determinista: velocidad base·t + empuje musical (integral de la energía). */
const spinOf = (t, a, p, base, music) => (p.speed ?? 1) * (base * t + music * (a.travel || 0) * Math.min(1.5, p.react ?? 1));

// ================================================================ 0 · Reactor
function buildReactor(p) {
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  root.add(tilt); tilt.add(body);
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 32), addMat({ color: 0xfff2d8 }));
  const heartHalo = glow(0xffc46b, 6);
  const lattice = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 1), addMat({ color: 0x3fd2ff, wireframe: true, opacity: 0.55 }));
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 0), addMat({ color: 0x5fd8ff, wireframe: true, opacity: 0.22 }));
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 26, 12, 1, true), addMat({ color: 0x5fd8ff, opacity: 0.2 }));
  body.add(heart, heartHalo, lattice, cage, axis);
  const orbits = [], ringMat = addMat({ color: 0x5fd8ff, opacity: 0.55 }), ringGeo = new THREE.TorusGeometry(3.7, 0.022, 8, 160);
  const eGeo = new THREE.SphereGeometry(0.17, 16, 16), eMat = addMat({ color: 0xfff2d8 });
  const eHalos = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group(); g.rotation.y = (i * Math.PI) / 3;
    const tl = new THREE.Group(); tl.rotation.x = 1.05; g.add(tl);
    const spin = new THREE.Group(); tl.add(spin);
    const e = new THREE.Mesh(eGeo, eMat); e.position.x = 3.7; const h = glow(0xffc46b, 1.5); e.add(h); eHalos.push(h);
    spin.add(new THREE.Mesh(ringGeo, ringMat), e); body.add(g); orbits.push({ spin, mul: i + 1, ph: i * 2.094 });
  }
  const NB = 96, TIERS = 6, TN = TIERS * 2 + 1, BR = 8;
  const bars = instanced(new THREE.BoxGeometry(1, 1, 1), neonMaterial(), NB * TN); body.add(bars);
  const guide = [BR, BR + 1.6].map((r, i) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 8, 192), addMat({ color: 0x5fd8ff, opacity: i ? 0.18 : 0.5 })); t.rotation.x = Math.PI / 2; body.add(t); return t; });
  const NM = 12, segs = [], segGeo = new THREE.TorusGeometry(13, 0.07, 8, 28, ((Math.PI * 2) / NM) * 0.78), segRoot = new THREE.Group(); body.add(segRoot);
  for (let i = 0; i < NM; i++) { const m = new THREE.Mesh(segGeo, addMat({ color: 0x5fd8ff, opacity: 0.3 })); m.rotation.z = (i * Math.PI * 2) / NM; m.rotation.x = Math.PI / 2; segRoot.add(m); segs.push(m); }
  const floor = [6, 10, 14, 18].map((r, i) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 200), addMat({ color: 0x3fd2ff, opacity: 0.16 - i * 0.025 })); t.rotation.x = Math.PI / 2; t.position.y = -4.6; body.add(t); return t; });
  const shocks = []; const shockGeo = new THREE.TorusGeometry(1, 0.02, 6, 160);
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(shockGeo, addMat({ color: 0xeaf8ff, opacity: 0 })); m.rotation.x = Math.PI / 2; body.add(m); shocks.push(m); }
  const hist = makeHistory(TIERS * 3 + 1);
  const mat = bars.material;
  return {
    object: root,
    update(t, a, p, env) {
      const r = Math.min(1.25, p.react), bassS = (a.bassSoft ?? a.bass ?? 0) * r, midS = (a.midSoft ?? a.mid ?? 0) * r, trS = (a.trebleSoft ?? a.treble ?? 0) * r, beat = (a.beat || 0) * r;
      const ac = accents(p), core = p.core ?? 1;
      const D = frameDist(env) / (p.scale || 1);
      root.position.set(0, 0, -D);
      tilt.rotation.x = Math.PI / 2 - 1.3 + (p.tilt || 0);
      body.rotation.y = -(0.9 + (p.orbit ?? 0.35) * Math.sin(t * 0.1)) - spinOf(t, a, p, 0.07, 0.2);
      heart.scale.setScalar(1 + bassS * 0.5 + beat * 0.18); heart.material.color.copy(ac.core); heart.material.opacity = Math.min(1, core);
      heartHalo.scale.setScalar(6 + bassS * 7 + beat * 2.5); heartHalo.material.color.copy(ac.warm); heartHalo.material.opacity = (0.4 + bassS * 0.35) * core * 0.65;
      lattice.scale.setScalar(1 + bassS * 0.35); lattice.rotation.y = spinOf(t, a, p, 0.25, 1.4); lattice.rotation.x = 0.12 * t; lattice.material.opacity = 0.4 + trS * 0.45;
      cage.scale.setScalar(1 + midS * 0.4); cage.rotation.y = -spinOf(t, a, p, 0.15, 0.8); cage.rotation.z = 0.08 * t;
      axis.material.opacity = 0.1 + bassS * 0.3 + beat * 0.1; axis.scale.x = axis.scale.z = 1 + bassS * 2;
      const spinA = spinOf(t, a, p, 0.5, 2.2);
      ringMat.opacity = 0.35 + trS * 0.5; ringMat.color.copy(ac.ring); eMat.color.copy(ac.core);
      for (const h of eHalos) h.material.color.copy(ac.warm);
      for (const o of orbits) o.spin.rotation.z = o.ph + spinA * o.mul;
      for (const g of [...guide, ...floor, ...segs]) g.material.color.copy(ac.ring);
      const frames = hist.update(t, a, p, env);
      let n = 0;
      const hMul = p.height ?? 1;
      for (let tr = -TIERS; tr <= TIERS; tr++) {
        const k = Math.abs(tr), fr = histAt(frames, k * 3), fade = 1 - k / (TIERS + 1.6), rr = BR + k * 0.32, y = tr * 0.55;
        for (let i = 0; i < NB; i++) {
          const b = bandOf(i), v = fr[b], ang = (i / NB) * 6.2832, h = 0.1 + Math.pow(v, 1.5) * 7 * fade * hMul;
          Q.setFromAxisAngle(yA, -ang); P.set(Math.cos(ang) * (rr + h / 2), y, Math.sin(ang) * (rr + h / 2)); S.set(h, 0.07, 0.24);
          M.compose(P, Q, S); bars.setMatrixAt(n, M);
          setBox(bars, n++, (b / (NBAND - 1)) * 0.667, (0.25 + v * 0.95) * fade * 0.8);
        }
      }
      flush(bars);
      const cur = frames[0];
      for (let i = 0; i < NM; i++) {
        const m = i % 6, b = (m < 3 ? m : 5 - m) * 4, w = Math.max(cur[b], cur[b + 1], cur[b + 2], cur[b + 3]);
        const s = segs[i]; s.material.opacity = 0.2 + w * 0.6; s.scale.z = 1 + w * 7;
      }
      segRoot.rotation.y = t * 0.05;
      // ondas de choque en los últimos golpes (envolvente de 1,4 s, sin estado)
      const bp = a.beatPos || 0, bps = a.bps || 2;
      for (let k = 0; k < 3; k++) {
        const s = shocks[k], age = (bp - Math.floor(bp) + k) / bps, life = 1 - age * 0.7;
        s.visible = life > 0;
        if (!s.visible) continue;
        s.scale.setScalar(BR * 0.8 + (1 - life) * 16); s.material.opacity = life * 0.35 * (0.4 + 0.6 * bassS); s.material.color.copy(ac.ice);
      }
      common(mat, p, a, D);
    },
  };
}

// ================================================================ 1 · Púlsar
function buildPulsar() {
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group(); root.add(tilt); tilt.add(body);
  const NS = 480, pm = instanced(new THREE.BoxGeometry(1, 1, 1), neonMaterial(), NS), pdir = [], pbd = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) { const y = 1 - (2 * (i + 0.5)) / NS, r = Math.sqrt(1 - y * y), a = i * 2.39996; pdir.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); pbd[i] = Math.min(NBAND - 1, Math.floor(Math.abs(y) * NBAND)); }
  const pq = pdir.map((d) => new THREE.Quaternion().setFromUnitVectors(xA, d));
  const pcore = new THREE.Mesh(new THREE.SphereGeometry(1.3, 32, 32), addMat({ color: 0xfff2d8 })), phalo = glow(0xffc46b, 9);
  const ringMat = addMat({ color: 0xeaf8ff, opacity: 0.6 });
  const pr1 = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.03, 8, 160), ringMat); pr1.rotation.x = Math.PI / 2;
  const pr2 = new THREE.Mesh(pr1.geometry, ringMat);
  body.add(pm, pcore, phalo, pr1, pr2);
  const hist = makeHistory(1);
  return {
    object: root,
    update(t, a, p, env) {
      const r = Math.min(1.25, p.react), bassS = (a.bassSoft ?? a.bass ?? 0) * r, midS = (a.midSoft ?? a.mid ?? 0) * r, beat = (a.beat || 0) * r;
      const ac = accents(p), core = p.core ?? 1;
      const D = frameDist(env) / (p.scale || 1);
      root.position.set(0, 0, -D);
      tilt.rotation.x = Math.PI / 2 - 1.3 + (p.tilt || 0);
      body.rotation.y = -(0.9 + (p.orbit ?? 0.35) * Math.sin(t * 0.1)) + spinOf(t, a, p, 0.1, 0.4);
      const cur = hist.update(t, a, p, env)[0];
      const lim = limiter(cur);
      // altura limitada: los 480 rayos ocupan casi toda la pantalla (evita destellos al crecer de golpe)
      const r0 = 2.5 + bassS * 1.3 + beat * 0.6, hMul = Math.min(1.5, p.height ?? 1);
      for (let i = 0; i < NS; i++) {
        const b = pbd[i], v = cur[b], len = 0.25 + Math.pow(v, 1.3) * 8 * hMul, w = 0.08 + v * 0.1;
        P.copy(pdir[i]).multiplyScalar(r0 + len / 2); S.set(len, w, w);
        M.compose(P, pq[i], S); pm.setMatrixAt(i, M);
        setBox(pm, i, (b / (NBAND - 1)) * 0.667, (0.3 + v * 0.9) * 0.45 * lim);
      }
      flush(pm);
      pcore.scale.setScalar(1 + bassS * 0.5 + beat * 0.25); pcore.material.color.copy(ac.core); pcore.material.opacity = Math.min(1, core);
      phalo.scale.setScalar(8 + bassS * 8 + beat * 2); phalo.material.color.copy(ac.warm); phalo.material.opacity = (0.4 + bassS * 0.35) * core * 0.6;
      pr2.rotation.set(1.05, spinOf(t, a, p, 0.4, 1.6), 0);
      const rs = 1 + bassS * 0.25 + beat * 0.1; pr1.scale.setScalar(rs); pr2.scale.setScalar(rs);
      ringMat.color.copy(ac.ice); ringMat.opacity = 0.6 * (p.opacity ?? 1);
      common(pm.material, p, a, D);
    },
  };
}

// ================================================================ 2 · Vórtice
function buildVortex() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const NT = 24, NA = 96, vm = instanced(new THREE.BoxGeometry(1, 1, 1), neonMaterial(), NT * NA);
  const vend = glow(0xeaf8ff, 24); vend.position.z = -62;
  body.add(vm, vend);
  const hist = makeHistory(NT);
  return {
    object: root,
    update(t, a, p, env) {
      const r = Math.min(1.25, p.react), bassS = (a.bassSoft ?? a.bass ?? 0) * r, enS = (a.energySoft ?? a.energy ?? 0) * r, beat = (a.beat || 0) * r;
      const ac = accents(p);
      const tn = Math.tan(((env.fov ?? 68) * Math.PI) / 360);
      const off = (15 * TAN24) / tn / (p.scale || 1);
      // cámara original: z = 15 mirando al fondo, con un leve vaivén
      root.position.set(-Math.sin(t * 0.17) * 0.9 * (p.orbit ?? 0.35) / 0.35, -Math.cos(t * 0.13) * 0.6 * (p.orbit ?? 0.35) / 0.35, -off);
      root.rotation.x = (p.tilt || 0) * 0.3;
      body.rotation.z = spinOf(t, a, p, 0.05, 0.45);
      const frames = hist.update(t, a, p, env);
      const lim = Math.pow(limiter(frames[0]), 1.6); // ocupa toda la pantalla: limitador más firme
      const R0 = 6.4 + bassS * 0.9 + beat * 0.4, bk = 1 + beat * 0.15, hMul = Math.min(1.6, p.height ?? 1);
      let n = 0;
      for (let k = 0; k < NT; k++) {
        const fr = histAt(frames, k), fade = 1 - k / (NT + 6), z = -k * 2.6, tw = k * 0.045;
        for (let i = 0; i < NA; i++) {
          const b = bandOf(i), v = fr[b], ang = (i / NA) * 6.2832 + tw, h = 0.15 + Math.pow(v, 1.4) * 4.5 * fade * hMul;
          Q.setFromAxisAngle(zA, ang); P.set(Math.cos(ang) * (R0 - h / 2), Math.sin(ang) * (R0 - h / 2), z); S.set(h, 0.22, 0.5);
          M.compose(P, Q, S); vm.setMatrixAt(n, M);
          setBox(vm, n++, (b / (NBAND - 1)) * 0.667, (0.2 + v * 0.9) * fade * bk * 0.25 * lim);
        }
      }
      flush(vm);
      vend.material.color.copy(ac.ice); vend.material.opacity = (0.25 + enS * 0.45) * (p.core ?? 1) * 0.5; vend.scale.setScalar(20 + bassS * 12 + beat * 3);
      setCommon(vm.material, p, { uGlow: Math.min(2.2, p.glow), uNear: 0.5, uNearW: 1, uFar: off + 90 });
    },
  };
}

// ================================================================ 3 · Matriz
function buildMatrix() {
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group(); root.add(tilt); tilt.add(body);
  const NR = 12, NQ = 96, xm = instanced(new THREE.BoxGeometry(1, 1, 1), neonMaterial(), NR * NQ), mcore = glow(0x3fd2ff, 10);
  mcore.position.y = 0.5; body.add(xm, mcore);
  const hist = makeHistory(NR * 2);
  return {
    object: root,
    update(t, a, p, env) {
      const r = Math.min(1.25, p.react), bassS = (a.bassSoft ?? a.bass ?? 0) * r, beat = (a.beat || 0) * r;
      const ac = accents(p);
      const D = frameDist(env, 36, 17.5) / (p.scale || 1); // radio exterior ≈ 15,7: cabe entero también en 9:16
      root.position.set(0, -1.5 * 0.5, -D);
      tilt.rotation.x = Math.PI / 2 - 0.95 + (p.tilt || 0);
      body.rotation.y = -(0.9 + (p.orbit ?? 0.35) * Math.sin(t * 0.1)) - spinOf(t, a, p, 0.06, 0.28);
      const frames = hist.update(t, a, p, env);
      const bk = 1 + beat * 0.3, hMul = p.height ?? 1;
      let n = 0;
      for (let rr = 0; rr < NR; rr++) {
        const fr = histAt(frames, rr * 2), rad = 3 + rr * 1.15, fade = 1 - rr * 0.045, dep = ((rad * 6.2832) / NQ) * 0.62;
        for (let j = 0; j < NQ; j++) {
          const b = bandOf(j), v = fr[b], ang = (j / NQ) * 6.2832, h = 0.18 + Math.pow(v, 1.5) * 10 * fade * bk * hMul;
          Q.setFromAxisAngle(yA, -ang); P.set(Math.cos(ang) * rad, h / 2, Math.sin(ang) * rad); S.set(0.62, h, dep);
          M.compose(P, Q, S); xm.setMatrixAt(n, M);
          setBox(xm, n++, (b / (NBAND - 1)) * 0.667, (0.2 + v * 0.8) * fade * 0.28 * limiter(fr));
        }
      }
      flush(xm);
      mcore.material.color.copy(ac.ice);
      mcore.scale.setScalar(6 + bassS * 7 + beat * 2.5); mcore.material.opacity = (0.2 + bassS * 0.25) * (p.core ?? 1) * 0.4;
      common(xm.material, p, a, D);
    },
  };
}

/** Polvo estelar compartido por los cuatro (como en el original). */
function withDust(build) {
  return (p, env) => {
    const layer = build(p, env);
    const NP = 700, pos = new Float32Array(NP * 3);
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < NP; i++) { const r = 18 + rnd() * 40, th = rnd() * 6.283, u = Math.acos(2 * rnd() - 1); pos.set([r * Math.sin(u) * Math.cos(th), r * Math.cos(u) * 0.6, r * Math.sin(u) * Math.sin(th)], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.14, map: glowTex(), color: 0x7fdcff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    dust.frustumCulled = false;
    layer.object.add(dust);
    const up = layer.update;
    return {
      object: layer.object,
      update(t, a, p, env) {
        up(t, a, p, env);
        const ac = accents(p);
        dust.rotation.y = t * 0.01; dust.material.color.copy(ac.ice); dust.material.opacity = (0.25 + (a.trebleSoft ?? 0) * 0.25) * (p.opacity ?? 1);
        dust.material.size = 0.14 * ((env.renderHeight || 960) / 960);
      },
    };
  };
}

export const EQUALIZERS = [
  { id: 'reactor', label: 'Reactor', desc: 'Núcleo atómico con barras radiales en 13 niveles, órbitas y ondas de choque', build: withDust(buildReactor), defaults: {} },
  { id: 'pulsar', label: 'Púlsar', desc: 'Esfera de 480 rayos que crecen con cada banda del espectro', build: withDust(buildPulsar), defaults: {} },
  { id: 'vortex', label: 'Vórtice', desc: 'Túnel de 24 anillos: el espectro viaja hacia el fondo', build: withDust(buildVortex), defaults: {} },
  { id: 'matrix', label: 'Matriz', desc: 'Ciudad circular de columnas que suben con la música', build: withDust(buildMatrix), defaults: {} },
];
export const EQ_BY_ID = Object.fromEntries(EQUALIZERS.map((x) => [x.id, x]));
