// AUTO DIRECTOR AI — generación local por reglas creativas + análisis musical + semilla (determinista).
import { createRNG, hashInt, clamp, lerp, deepClone } from '../core/util.js';
import { TRACKS } from '../core/store.js';
import { PROFILE_BY_ID, PROFILES } from './profiles.js';
import { TUNNEL_BY_ID } from '../studios/tunnels.js';
import { MESH_BY_ID } from '../studios/meshes.js';

const LIGHT_OVERLAYS = ['particles', 'lightlines', 'laser', 'rings', 'spiral'];
// Ecualizadores preferidos por perfil
const EQ_WEIGHTS = {
  cyberpunk: { matrix: 3, pulsar: 2, reactor: 1, vortex: 1 }, 'techno-underground': { reactor: 3, vortex: 2, matrix: 1 }, 'hard-techno': { vortex: 3, reactor: 2, pulsar: 2 },
  industrial: { reactor: 3, matrix: 2 }, psytrance: { vortex: 3, pulsar: 3 }, trance: { reactor: 3, pulsar: 2, vortex: 1 }, synthwave: { matrix: 3, vortex: 1 },
  'dark-energy': { reactor: 3, pulsar: 2 }, 'electric-dreams': { pulsar: 3, matrix: 1 }, 'neon-festival': { matrix: 2, pulsar: 2, vortex: 2 }, cosmic: { pulsar: 3, reactor: 2 },
  apocalypse: { vortex: 2, matrix: 2, reactor: 1 }, 'plasma-dimension': { pulsar: 2, vortex: 2 }, 'holographic-world': { matrix: 3, reactor: 2 }, 'future-rave': { vortex: 2, pulsar: 2, reactor: 2, matrix: 2 },
};
const SECTION_NAMES = { intro: 'Intro', verse: 'Estrofa', build: 'Subida', drop: 'Drop', break: 'Pausa', outro: 'Final' };
export { SECTION_NAMES };

/** Rejilla de compases y secciones en tiempo de línea de tiempo (0 = inicio del recorte). */
export function musicalGrid(analysis, trimStart, duration) {
  const bars = [];
  const db = analysis.d?.downbeat ?? 0;
  const startPos = Math.floor(analysis.beatPos(trimStart) - db);
  for (let k = Math.floor(startPos / 4) * 4 + db; ; k += 4) {
    const tt = analysis.beatTime(k) - trimStart;
    if (tt > duration - 0.05) break;
    if (tt >= -0.05) bars.push(Math.max(0, tt));
    if (bars.length > 4000) break;
  }
  if (!bars.length || bars[0] > 0.05) bars.unshift(0);
  const sections = analysis.sections
    .map((s) => ({ ...s, start: Math.max(0, s.start - trimStart), end: Math.min(duration, s.end - trimStart) }))
    .filter((s) => s.end - s.start > 0.2);
  if (!sections.length) sections.push({ start: 0, end: duration, type: 'verse', energy: 0.6 });
  sections[0].start = 0; sections[sections.length - 1].end = duration;
  const beatLen = 60 / (analysis.bpm || 120);
  return { bars, sections, beatLen };
}

function weightedPick(rng, weights, recent = [], penalty = 0.12) {
  const items = Object.entries(weights).map(([value, w]) => ({ value, weight: w * (recent.includes(value) ? penalty : 1) }));
  return rng.weighted(items);
}
function rangeOf(rng, r, scale = 1) { return clamp(lerp(r[0], r[1], rng.next()) * scale); }

/**
 * Genera la composición completa.
 * @param {object} o { project, analysis, duration, profileId, controls, seed, keepFrozen, onlySceneId }
 * @returns {{ tracks, scenes, summary }}
 */
export function generate(o) {
  const { project, analysis, duration } = o;
  const profile = PROFILE_BY_ID[o.profileId] || PROFILES[0];
  const C = o.controls;
  const seed = o.seed >>> 0;
  const trim = project.audio?.trimStart || 0;
  const { bars, sections, beatLen } = musicalGrid(analysis, trim, duration);
  const barLen = beatLen * 4;
  const photos = project.photos || [];
  const prevScenes = project.director?.scenes || [];
  const prevTracks = project.timeline.tracks;

  // ---- 1. Escenas alineadas a compases
  const baseBars = Math.round(lerp(1.5, 12, clamp(C.sceneDuration * 0.75 + (1 - C.sceneSpeed) * 0.25)));
  const snapPow = (n) => [1, 2, 4, 8, 16].reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 4);
  const barIndex = (t) => { let i = 0; while (i + 1 < bars.length && bars[i + 1] <= t + 0.02) i++; return i; };
  const scenes = [];
  sections.forEach((sec, si) => {
    const factor = sec.type === 'drop' ? 0.5 : sec.type === 'break' || sec.type === 'intro' || sec.type === 'outro' ? 1.6 : 1;
    const per = Math.max(1, snapPow(baseBars * factor));
    let b0 = barIndex(sec.start);
    let start = sec.start;
    while (start < sec.end - 0.1) {
      const b1 = b0 + per;
      let end = b1 < bars.length ? bars[b1] : sec.end;
      if (end > sec.end - barLen * 0.75 || end <= start) end = sec.end;
      scenes.push({ start, end, section: sec.type, energy: sec.energy ?? 0.6, sectionIndex: si, firstOfSection: start === sec.start });
      start = end; b0 = b1;
    }
  });

  // ---- 2. Semillas por escena; escenas congeladas se conservan
  const rngRoot = createRNG(seed);
  const out = Object.fromEntries(TRACKS.map((t) => [t, []]));
  const outScenes = [];
  const recent = { tunnels: [], meshes: [], particles: [], photoFx: [], transitions: [], equalizers: [] };
  let photoCursor = Math.floor(rngRoot.next() * Math.max(1, photos.length));
  // golpes de batería reales (una vez por generación), en tiempo de línea de tiempo
  const drumHitsTL = analysis.drumHits && !analysis.synthetic ? analysis.drumHits({ mode: 'hits', minGap: Math.max(0.3, beatLen * 0.9) }).map((h) => h.t - trim).filter((t) => t > 0 && t < duration) : [];
  const sceneSeeds = scenes.map((_, i) => hashInt(seed ^ hashInt(i * 2654435761)));

  scenes.forEach((sc, i) => {
    const old = prevScenes.find((s) => Math.abs(s.start - sc.start) < 0.05 && Math.abs(s.end - sc.end) < 0.05);
    let sceneSeed = sceneSeeds[i];
    let sceneId = `s${i}_${(sceneSeed >>> 0).toString(36)}`;
    const keepFrozen = o.keepFrozen && old?.frozen;
    const keepOther = o.onlySceneId && old && old.id !== o.onlySceneId;
    if (o.onlySceneId && old && old.id === o.onlySceneId) { sceneSeed = hashInt(sceneSeed ^ (o.regenNonce || 1)); sceneId = `s${i}_${(sceneSeed >>> 0).toString(36)}`; }
    if (keepFrozen || keepOther) {
      for (const t of TRACKS) for (const c of prevTracks[t]) if (c.sceneId === old.id) out[t].push(deepClone(c));
      outScenes.push({ ...old });
      for (const c of prevTracks.tunnels) if (c.sceneId === old.id) recent.tunnels.push(c.type);
      return;
    }
    const rng = createRNG(sceneSeed);
    const e = clamp(sc.energy * 0.7 + (sc.section === 'drop' ? 0.3 : sc.section === 'build' ? 0.15 : 0));
    const len = sc.end - sc.start;
    const I = C.intensity;
    let k = 0;
    const cid = (tr) => `${sceneId}_${tr}${k++}`;
    const push = (track, type, start, dur, params) => out[track].push({ id: cid(track[0]), track, type, start: +start.toFixed(4), dur: +Math.max(0.1, dur).toFixed(4), params, sceneId });

    // Túnel principal
    const tType = weightedPick(rng, profile.tunnels, recent.tunnels.slice(-2));
    recent.tunnels.push(tType);
    const tDef = TUNNEL_BY_ID[tType];
    const speed = Math.min(2, profile.speed * lerp(0.55, 1.55, e) * lerp(0.75, 1.3, I));
    const tParams = {
      ...(tDef.defaults || {}),
      speed: +speed.toFixed(3),
      glow: +((tDef.defaults?.glow ?? 1.2) * Math.min(1.15, profile.glow) * lerp(0.7, 1.05, I)).toFixed(3),
      camera: +clamp(C.camera * profile.camera * 2 * rng.range(0.6, 1.2)).toFixed(3),
      rotation: +((rng.next() - 0.5) * 0.6 * (0.5 + C.camera)).toFixed(3),
      react: +lerp(0.4, 1.6, C.sensitivity).toFixed(3),
      density: Math.round((tDef.defaults?.density ?? 28) * lerp(0.7, 1.3, C.complexity)),
      direction: sc.section === 'break' && rng.chance(0.25) ? 'backward' : 'forward',
      colorMode: rng.chance(0.12) ? 4 : 0,
      colorShift: +rng.next().toFixed(3),
      perspective: Math.round(lerp(62, 92, e) + rng.range(-6, 6)),
    };
    push('tunnels', tType, sc.start, len, tParams);
    // Segundo túnel superpuesto
    if (rng.chance(profile.layering * C.complexity * (0.6 + e * 0.6))) {
      const pool = Object.fromEntries(LIGHT_OVERLAYS.filter((x) => x !== tType).map((x) => [x, 1]));
      const t2 = weightedPick(rng, pool);
      push('tunnels', t2, sc.start, len, { ...(TUNNEL_BY_ID[t2].defaults || {}), speed: +(speed * rng.range(0.8, 1.4)).toFixed(3), opacity: +rng.range(0.35, 0.65).toFixed(3), glow: 1.1, react: tParams.react, camera: tParams.camera, colorShift: +rng.next().toFixed(3), scale: +rng.range(0.6, 1.4).toFixed(3) });
    }
    // Ecualizador 3D (Reactor, Púlsar, Vórtice, Matriz): más probable en drops y subidas
    let hasEq = false;
    const eqAmt = C.equalizers ?? 0.4; // control «Ecualizadores 3D» (0 = nunca)
    const eqChance = eqAmt <= 0.001 ? 0 : Math.min(0.95, lerp(0.05, 0.9, eqAmt) * lerp(0.7, 1.15, C.complexity) * (sc.section === 'drop' ? 1.3 : sc.section === 'build' ? 1 : 0.55));
    if (rng.chance(eqChance)) {
      const eType = weightedPick(rng, EQ_WEIGHTS[profile.id] || { reactor: 1, pulsar: 1, vortex: 1, matrix: 1 }, recent.equalizers.slice(-1), 0.2);
      recent.equalizers.push(eType); hasEq = true;
      // el ecualizador es el protagonista de la escena: los túneles quedan de fondo
      for (const c of out.tunnels) if (c.sceneId === sceneId) { c.params.opacity = +((c.params.opacity ?? 0.9) * 0.55).toFixed(3); c.params.glow = +((c.params.glow ?? 1.2) * 0.8).toFixed(3); }
      push('equalizers', eType, sc.start, len, { react: +lerp(0.6, 1.4, C.sensitivity).toFixed(3), speed: +(profile.speed * lerp(0.7, 1.3, e)).toFixed(3), height: +lerp(0.7, 1.3, I).toFixed(3), orbit: +(0.2 + 0.5 * C.camera).toFixed(3), colorMode: rng.chance(0.5) ? 6 : 0, colorShift: +rng.next().toFixed(3), glow: +lerp(0.9, 1.2, I).toFixed(3) });
    }
    // Malla eléctrica
    if (rng.chance((hasEq ? 0.35 : 1) * profile.meshChance * lerp(0.4, 1.3, C.complexity) * (0.6 + 0.5 * e))) {
      const mType = weightedPick(rng, profile.meshes, recent.meshes.slice(-1));
      recent.meshes.push(mType);
      push('meshes', mType, sc.start, len, { ...(MESH_BY_ID[mType].defaults || {}), amplitude: +lerp(0.5, 1.4, e * I).toFixed(3), speed: +(profile.speed * lerp(0.6, 1.3, e)).toFixed(3), bassReact: +lerp(0.4, 1.6, C.sensitivity).toFixed(3), opacity: +rng.range(0.55, 0.9).toFixed(3), colorShift: +rng.next().toFixed(3), rotation: +((rng.next() - 0.5) * 0.4).toFixed(3) });
    }
    // Partículas
    if (rng.chance(0.25 + 0.7 * C.particles)) {
      const pType = weightedPick(rng, profile.particles, recent.particles.slice(-1));
      recent.particles.push(pType);
      push('particles', pType, sc.start, len, { density: +lerp(0.4, 1.6, C.particles).toFixed(3), speed: +(profile.speed * lerp(0.6, 1.3, e)).toFixed(3), react: tParams.react, glow: +(1.1 * profile.glow).toFixed(3), colorShift: +rng.next().toFixed(3) });
    }
    // Fotografías: reparto equitativo; en drops, enmarcadas en el túnel; en pausas, a pantalla completa
    if (photos.length && rng.chance(lerp(0.15, 1, C.photoAmount) * (sc.section === 'drop' ? 0.85 : 1))) {
      const beatsBase = sc.section === 'drop' ? 4 : 8;
      // golpes por foto (potencia de 2): más fotos y más rápido con «cantidad de fotografías» y «velocidad de escenas»
      const beatsPer = [1, 2, 4, 8, 16].reduce((a, b) => (Math.abs(b - beatsBase * lerp(1.6, 0.4, (C.sceneSpeed + C.photoAmount) / 2)) < Math.abs(a - beatsBase * lerp(1.6, 0.4, (C.sceneSpeed + C.photoAmount) / 2)) ? b : a), 4);
      let grid = [];
      // En drops y subidas con bastantes fotos: la foto cambia en cada golpe de batería (con impacto)
      let onHits = false;
      if ((sc.section === 'drop' || sc.section === 'build') && C.photoAmount >= 0.45 && drumHitsTL.length) {
        const hs = drumHitsTL.filter((t) => t > sc.start + 0.15 && t < sc.end - 0.15);
        if (hs.length >= 2) { grid = [sc.start, ...hs]; onHits = true; }
      }
      if (!onHits) {
        for (let k = Math.round(analysis.beatPos(sc.start + trim)); grid.length < 64; k += beatsPer) { const tt = analysis.beatTime(k) - trim; if (tt >= sc.end - 0.1) break; if (tt >= sc.start - 0.02) grid.push(Math.max(sc.start, tt)); }
        if (!grid.length || grid[0] > sc.start + 0.05) grid.unshift(sc.start);
      }
      const hitPool = profile.photoFx.glitch || profile.photoFx.rgbsplit ? ['punch', 'rgb', 'glitch', 'punch', 'shake'] : ['punch', 'punch', 'shake', 'rgb'];
      const count = grid.length;
      // aspecto común a toda la escena (para que el fundido cruzado sea entre fotos iguales)
      const framed = sc.section === 'drop' || sc.section === 'build' ? rng.chance(0.65) : rng.chance(0.25);
      const blend = framed ? 'front' : rng.weighted([{ value: 'back', weight: 3 }, { value: 'screen', weight: 2 }, { value: 'front', weight: sc.section === 'break' || sc.section === 'intro' ? 2 : 0.5 }]);
      const frame = framed ? rng.pick(profile.masks.filter((m) => m !== 'none').concat(['circle'])) : 'none';
      for (let j = 0; j < count; j++) {
        const segEnd = j + 1 < count ? grid[j + 1] : sc.end, seg = segEnd - grid[j];
        const ov = j + 1 < count ? (onHits ? Math.min(0.1, seg * 0.3) : Math.min(0.35, Math.max(0.1, seg * 0.3))) : 0;
        const pd = seg;
        const ph = photos[photoCursor % photos.length]; photoCursor++;
        // con cambios en cada golpe: solo efectos de movimiento (los de luz cambiarían el brillo en cada golpe)
        const fx = onHits ? rng.pick(['cinezoom', 'parallax', 'zoom3d', 'camera']) : weightedPick(rng, profile.photoFx, recent.photoFx.slice(-2), 0.3);
        recent.photoFx.push(fx);
        const lead = onHits && j > 0 ? Math.min(0.07, (grid[j] - grid[j - 1]) * 0.2) : 0;
        push('photos', 'photo', grid[j] - lead, seg + ov + lead, {
          photoId: ph.id, effect: fx, effectAmount: +rng.range(0.4, 0.85).toFixed(3),
          motion: rng.pick(['in', 'out', 'left', 'right', 'orbit', 'drift']), motionAmount: +rng.range(0.3, 0.8).toFixed(3),
          parallax: +rng.range(0.1, 0.6).toFixed(3), depth: +rng.range(0, 0.6).toFixed(3), react: +lerp(0.3, 1.2, C.sensitivity).toFixed(3),
          hitFx: onHits && j > 0 ? hitPool[j % hitPool.length] : 'none', hitAmount: 0.75, matchLuma: onHits, hitDelay: +lead.toFixed(4),
          fadeIn: +(j === 0 ? Math.min(0.9, pd * 0.28) : onHits ? Math.min(0.1, (grid[j] - grid[j - 1]) * 0.3) : Math.min(0.35, Math.max(0.1, (grid[j] - grid[j - 1]) * 0.3))).toFixed(3), fadeOut: +(j + 1 < count ? (blend === 'screen' ? ov : 0) : Math.max(Math.min(0.9, pd * 0.28), Math.min(0.45, pd * 0.5))).toFixed(3), // mezcla aditiva: fundido simétrico (si no, se sumarían)
          blend, frame,
        });
      }
    }
    // Fundido cruzado: si la foto que entra no tapa del todo (partículas, desintegración, holograma, mezcla aditiva),
    // la anterior debe desvanecerse a la vez; si no, desaparecería de golpe por debajo.
    const scenePhotos = out.photos.filter((c) => c.sceneId === sceneId).sort((x, y) => x.start - y.start);
    for (let j = 0; j + 1 < scenePhotos.length; j++) {
      const nx = scenePhotos[j + 1].params;
      if (['particles', 'disintegrate', 'hologram'].includes(nx.effect) || nx.blend === 'screen' || ['particles', 'disintegrate', 'hologram'].includes(scenePhotos[j].params.effect)) scenePhotos[j].params.fadeOut = nx.fadeIn;
    }
    outScenes.push({ id: sceneId, start: sc.start, end: sc.end, seed: sceneSeed, frozen: false, section: sc.section, energy: +e.toFixed(3) });
  });

  // ---- 3. Iluminación y filtros por sección
  const rngS = createRNG(hashInt(seed ^ 0x51ec));
  sections.forEach((sec, si) => {
    const pal = profile.palettes[(si + Math.floor(rngS.next() * 2)) % profile.palettes.length];
    out.lighting.push({ id: `L${si}_${seed.toString(36)}`, track: 'lighting', type: 'light', start: sec.start, dur: sec.end - sec.start, params: { palette: pal, brightness: +lerp(0.82, 1.02, C.intensity).toFixed(3), bloom: +(sec.type === 'drop' ? lerp(0.9, 1.2, C.intensity) : lerp(0.7, 1, C.intensity)).toFixed(3), saturation: 1, hueShift: 0, pulse: +lerp(0.1, 0.55, C.sensitivity).toFixed(3) } });
    const fEntries = Object.entries(profile.filters);
    const [fid, fr] = fEntries[si % fEntries.length];
    out.effects.push({ id: `F${si}_${seed.toString(36)}`, track: 'effects', type: 'filter', start: sec.start, dur: sec.end - sec.start, params: { filter: fid, amount: +rangeOf(rngS, fr, lerp(0.6, 1.2, C.intensity)).toFixed(3), sync: 'continuous', rate: 1 } });
  });

  // ---- 4. Efectos en las partes intensas (seguros: campanas por golpe/compás)
  const rngE = createRNG(hashInt(seed ^ 0xeffec7));
  outScenes.forEach((s) => {
    if (s.energy < 0.6 || C.aggression < 0.05) return;
    if (!rngE.chance(lerp(0.2, 0.95, C.aggression) * s.energy)) return;
    const fx = weightedPick(rngE, profile.effects);
    out.effects.push({ id: `E_${s.id}`, track: 'effects', type: fx, start: s.start, dur: s.end - s.start, params: { amount: +lerp(0.15, 0.7, C.aggression).toFixed(3), sync: fx === 'scanlines' || fx === 'chromatic' || fx === 'noise' ? 'continuous' : rngE.chance(0.7) ? 'beat' : 'bar', rate: 1 }, sceneId: s.id });
  });

  // ---- 5. Transiciones en los límites de escena
  const rngT = createRNG(hashInt(seed ^ 0x7a115));
  const safeCuts = project.director?.safeCuts !== false;
  for (let i = 1; i < outScenes.length; i++) {
    const s = outScenes[i], prev = outScenes[i - 1];
    const sectionChange = s.section !== prev.section;
    const p = C.transitionFreq * (sectionChange ? 1 : 0.55);
    if (!rngT.chance(p)) {
      // Corte suave: fundido breve en lugar de un corte seco (evita saltos bruscos de brillo)
      if (safeCuts) { const d = Math.min(0.6, Math.max(0.35, beatLen)); out.transitions.push({ id: `T${i}_${s.id}_cut`, track: 'transitions', type: 'fade', start: +Math.max(0, s.start - d / 2).toFixed(4), dur: +d.toFixed(4), params: { speed: 1, direction: 0, intensity: 0.5, color: 'c0' } }); }
      continue;
    }
    const high = s.energy > 0.62 || prev.energy > 0.7;
    const pool = high ? profile.transitions.high : profile.transitions.low;
    const type = weightedPick(rngT, pool, recent.transitions.slice(-1), 0.35);
    recent.transitions.push(type);
    const fast = ['glitch', 'digital', 'rgb'].includes(type);
    let dur = type === 'flash' ? Math.max(0.8, beatLen * 2) : fast ? beatLen * rngT.pick([0.5, 1]) : beatLen * (high ? 2 : rngT.pick([2, 4])) * lerp(1.2, 0.7, C.sceneSpeed);
    dur = Math.min(dur, (s.end - s.start) * 0.5, (prev.end - prev.start) * 0.5);
    if (dur < 0.15) continue;
    const start = fast ? s.start - dur * 0.5 : s.start - dur * 0.5;
    out.transitions.push({ id: `T${i}_${s.id}`, track: 'transitions', type, start: +Math.max(0, start).toFixed(4), dur: +dur.toFixed(4), params: { speed: fast ? 1.4 : 1, direction: Math.round(rngT.range(0, 360)), intensity: +lerp(0.45, 0.95, C.aggression * 0.5 + C.intensity * 0.5).toFixed(3), color: rngT.pick(['c0', 'c1', 'c2', 'white']) } });
  }

  const summary = {
    profile: profile.name, scenes: outScenes.length, sections: sections.length,
    clips: TRACKS.reduce((n, t) => n + out[t].length, 0),
    tunnelTypes: new Set(out.tunnels.map((c) => c.type)).size,
  };
  return { tracks: out, scenes: outScenes, summary };
}

/** «Aleatorio inteligente»: perfil y controles al azar dentro de rangos que funcionan. */
export function smartRandom(seed) {
  const r = createRNG(seed);
  const profile = r.pick(PROFILES).id;
  const controls = {
    intensity: +r.range(0.55, 0.95).toFixed(2), sceneSpeed: +r.range(0.35, 0.85).toFixed(2), transitionFreq: +r.range(0.4, 0.9).toFixed(2),
    aggression: +r.range(0.2, 0.75).toFixed(2), photoAmount: +r.range(0.4, 0.9).toFixed(2), sceneDuration: +r.range(0.3, 0.7).toFixed(2),
    camera: +r.range(0.3, 0.8).toFixed(2), particles: +r.range(0.3, 0.85).toFixed(2), complexity: +r.range(0.4, 0.9).toFixed(2), sensitivity: +r.range(0.5, 0.9).toFixed(2), equalizers: +r.range(0.2, 0.7).toFixed(2),
  };
  return { profile, controls };
}
