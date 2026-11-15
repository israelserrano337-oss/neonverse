import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../app/js/audio/analysis-core.js';
import { Analysis, SyntheticAnalysis } from '../app/js/audio/analysis.js';
import { newProject, TRACKS } from '../app/js/core/store.js';
import { generate, smartRandom } from '../app/js/director/AutoDirector.js';
import { PROFILES } from '../app/js/director/profiles.js';
import { TUNNEL_BY_ID } from '../app/js/studios/tunnels.js';
import { MESH_BY_ID } from '../app/js/studios/meshes.js';
import { PARTICLE_BY_ID } from '../app/js/studios/particles.js';
import { EQ_BY_ID } from '../app/js/studios/equalizers.js';
import { TRANSITION_BY_ID } from '../app/js/studios/transitions.js';
import { EFFECT_BY_ID } from '../app/js/studios/effects.js';
import { evaluate } from '../app/js/timeline/model.js';
import { synthTrack } from './helpers.mjs';

const { mono, sr } = synthTrack({ bpm: 128, seconds: 75, breakAt: 30, breakLen: 15 });
const analysis = new Analysis(analyze(mono, sr));
function project(nPhotos = 6) {
  const p = newProject('Prueba');
  p.audio = { mediaId: 'x', name: 'x.wav', duration: 75, trimStart: 0, trimEnd: 75 };
  p.photos = Array.from({ length: nPhotos }, (_, i) => ({ id: 'p' + i, name: 'f' + i, settings: {} }));
  return p;
}
const run = (seed, profileId = 'cyberpunk', p = project()) => generate({ project: p, analysis, duration: 75, profileId, controls: p.director.controls, seed });

test('Determinista: misma semilla ⇒ misma composición', () => {
  assert.equal(JSON.stringify(run(42)), JSON.stringify(run(42)));
  assert.notEqual(JSON.stringify(run(42).tracks), JSON.stringify(run(43).tracks));
});

test('Los 15 perfiles generan clips válidos que cubren toda la canción', () => {
  assert.equal(PROFILES.length, 15);
  for (const pr of PROFILES) {
    const r = run(7, pr.id);
    for (const c of r.tracks.tunnels) assert.ok(TUNNEL_BY_ID[c.type], `${pr.id}: túnel ${c.type}`);
    for (const c of r.tracks.meshes) assert.ok(MESH_BY_ID[c.type], `${pr.id}: malla ${c.type}`);
    for (const c of r.tracks.particles) assert.ok(PARTICLE_BY_ID[c.type], `${pr.id}: partículas ${c.type}`);
    for (const c of r.tracks.equalizers) assert.ok(EQ_BY_ID[c.type], `${pr.id}: ecualizador ${c.type}`);
    for (const c of r.tracks.transitions) assert.ok(TRANSITION_BY_ID[c.type], `${pr.id}: transición ${c.type}`);
    for (const c of r.tracks.effects) assert.ok(EFFECT_BY_ID[c.type], `${pr.id}: efecto ${c.type}`);
    // sin huecos: en cada instante hay al menos un túnel
    for (let t = 0; t < 75; t += 0.5) assert.ok(r.tracks.tunnels.some((c) => t >= c.start - 1e-3 && t < c.start + c.dur), `${pr.id}: hueco en ${t}`);
    for (const t of TRACKS) for (const c of r.tracks[t]) assert.ok(Number.isFinite(c.start) && c.dur > 0, `${pr.id}: clip inválido`);
  }
});

test('Variedad: no repite el mismo túnel en escenas consecutivas', () => {
  const r = run(99);
  const main = r.scenes.map((s) => r.tracks.tunnels.find((c) => c.sceneId === s.id && Math.abs(c.start - s.start) < 1e-3)?.type);
  let repeats = 0;
  for (let i = 1; i < main.length; i++) if (main[i] === main[i - 1]) repeats++;
  assert.ok(repeats <= Math.ceil(main.length * 0.15), `repeticiones ${repeats}/${main.length}`);
  assert.ok(new Set(main).size >= 3, 'pocos tipos de túnel');
});

test('Las fotos se reparten todas', () => {
  const p = project(5);
  p.director.controls.photoAmount = 1;
  const r = run(5, 'trance', p);
  const used = new Set(r.tracks.photos.map((c) => c.params.photoId));
  assert.equal(used.size, 5);
});

test('Congelar y regenerar escena conserva el resto', () => {
  const p = project();
  const r1 = run(11, 'cyberpunk', p);
  p.timeline.tracks = r1.tracks; p.director.scenes = r1.scenes;
  const target = r1.scenes[2];
  const r2 = generate({ project: p, analysis, duration: 75, profileId: 'cyberpunk', controls: p.director.controls, seed: 11, onlySceneId: target.id, regenNonce: 5 });
  const others = (r) => JSON.stringify(r.tracks.tunnels.filter((c) => c.start < target.start - 1e-3 || c.start >= target.end - 1e-3).map((c) => [c.type, c.start, c.params.speed]));
  assert.equal(others(r1), others(r2));
  p.director.scenes = r1.scenes.map((s, i) => ({ ...s, frozen: i === 1 }));
  const r3 = generate({ project: p, analysis, duration: 75, profileId: 'cyberpunk', controls: p.director.controls, seed: 999, keepFrozen: true });
  const frozen = r1.scenes[1];
  const pick = (r) => JSON.stringify(r.tracks.tunnels.filter((c) => c.sceneId === frozen.id));
  assert.equal(pick(r1), pick(r3));
});

test('Evaluación: transición entrega escenas A y B distintas', () => {
  const p = project();
  const r = run(3, 'hard-techno', p);
  p.timeline.tracks = r.tracks;
  const tr = r.tracks.transitions[0];
  assert.ok(tr, 'sin transiciones');
  const ev = evaluate(p, tr.start + tr.dur / 2);
  assert.ok(ev.transition && ev.B);
  assert.ok(ev.progress > 0.3 && ev.progress < 0.7);
});

test('Sin música (análisis sintético) también genera', () => {
  const p = newProject();
  const a = new SyntheticAnalysis(30);
  const r = generate({ project: p, analysis: a, duration: 30, profileId: 'synthwave', controls: p.director.controls, seed: 1 });
  assert.ok(r.tracks.tunnels.length > 0);
  const sr2 = smartRandom(5);
  assert.ok(sr2.profile && sr2.controls.intensity > 0);
});

test('El director usa los 4 ecualizadores', () => {
  const used = new Set();
  for (const pr of PROFILES) for (const seed of [1, 2, 3]) for (const c of run(seed, pr.id).tracks.equalizers) used.add(c.type);
  assert.deepEqual([...used].sort(), ['matrix', 'pulsar', 'reactor', 'vortex']);
});

test('Control «Ecualizadores 3D»: 0 = ninguno, 1 = en la mayoría de escenas', () => {
  const p = project();
  p.director.controls = { ...p.director.controls, equalizers: 0 };
  assert.equal(run(21, 'cyberpunk', p).tracks.equalizers.length, 0);
  p.director.controls = { ...p.director.controls, equalizers: 1 };
  const r = run(21, 'cyberpunk', p);
  assert.ok(r.tracks.equalizers.length >= r.scenes.length * 0.5, `${r.tracks.equalizers.length}/${r.scenes.length}`);
});
