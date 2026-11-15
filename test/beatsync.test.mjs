import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../app/js/audio/analysis-core.js';
import { Analysis } from '../app/js/audio/analysis.js';
import { defaultBeatSync, buildEvents, clipsAt, stateAt, setModeAt, addNudge, photoIndex, BS_COOLDOWN } from '../app/js/beatsync/BeatSync.js';
import { newProject } from '../app/js/core/store.js';
import { evaluate, setPhotoProvider } from '../app/js/timeline/model.js';
import { synthTrack, drumKit } from './helpers.mjs';

const BPM = 120, SEC = 24;
const kit = drumKit({ bpm: BPM, seconds: SEC });
const A = new Analysis(analyze(kit.mono, kit.sr));
const beat = 60 / BPM;
const photos = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, settings: {} }));
const cfgOf = (o = {}) => Object.assign(defaultBeatSync(), { enabled: true }, o);
const ev = (cfg) => buildEvents(cfg, A, 0, SEC).slice(1);
const offBeat = (t, step = beat) => { const d = ((t % step) + step) % step; return Math.min(d, step - d); };
const inWin = (e, a, b) => e.filter((x) => x.t >= a && x.t < b);

test('BPM de la batería de prueba', () => assert.ok(Math.abs(A.bpm - BPM) < 1.5, `bpm ${A.bpm}`));

test('1/2 BEAT: dos cambios por pulso', () => {
  const e = inWin(ev(cfgOf({ baseMode: 'half' })), 4, 20);
  assert.ok(Math.abs(e.length - 32 * 2) <= 1, `${e.length} cambios en 32 pulsos`);
  for (const x of e) assert.ok(offBeat(x.t, beat / 2) < 0.03, `fuera de rejilla ${x.t}`);
});
test('1 BEAT: un cambio por pulso', () => {
  const e = inWin(ev(cfgOf({ baseMode: 'beat' })), 4, 20);
  assert.ok(Math.abs(e.length - 32) <= 1, `${e.length}`);
  for (const x of e) assert.ok(offBeat(x.t) < 0.03, `fuera de pulso ${x.t}`);
});
test('2 BEATS: un cambio cada dos pulsos', () => {
  const e = inWin(ev(cfgOf({ baseMode: 'two' })), 4, 20);
  assert.ok(Math.abs(e.length - 16) <= 1, `${e.length}`);
  for (let i = 1; i < e.length; i++) assert.ok(Math.abs(e[i].t - e[i - 1].t - 2 * beat) < 0.04);
});
test('AUTO KICK: un cambio por cada bombo, y ninguno con la caja, el charles ni el bajo', () => {
  const e = inWin(ev(cfgOf({ baseMode: 'kick' })), 4, 20);
  // bombos reales: tiempos 1 y 3 de cada compás → cada 2 pulsos (16 en 32 pulsos)
  assert.ok(Math.abs(e.length - 16) <= 1, `${e.length} cambios para 16 bombos`);
  for (const x of e) { const d = offBeat(x.t, 2 * beat); assert.ok(d < 0.035, `cambio en ${x.t.toFixed(3)} no coincide con un bombo (a ${Math.round(d * 1000)} ms)`); }
});
test('AUTO KICK + caja: cambia en bombo y caja (cada pulso), no en el charles', () => {
  const e = inWin(ev(cfgOf({ baseMode: 'kick', snare: true })), 4, 20);
  assert.ok(Math.abs(e.length - 32) <= 2, `${e.length}`);
  for (const x of e) assert.ok(offBeat(x.t) < 0.035, `fuera de golpe ${x.t}`);
});
test('AUTO KICK no responde a una parte sin batería', () => {
  const { mono, sr } = synthTrack({ bpm: 128, seconds: 40, breakAt: 15, breakLen: 10 });
  const a = new Analysis(analyze(mono, sr));
  const e = buildEvents(cfgOf({ baseMode: 'kick' }), a, 0, 40).slice(1);
  assert.ok(inWin(e, 15.4, 24.6).length <= 1, `cambios en la pausa: ${inWin(e, 15.4, 24.6).length}`);
  assert.ok(inWin(e, 2, 14).length >= 22, `bombos antes de la pausa: ${inWin(e, 2, 14).length}`);
});
test('Anti-rebote: nunca dos cambios automáticos a menos de 1/6 s, ni duplicados', () => {
  for (const mode of ['half', 'beat', 'two', 'kick']) for (const sensitivity of [0, 0.5, 1]) {
    const e = buildEvents(cfgOf({ baseMode: mode, sensitivity, snare: true }), A, 0, SEC);
    for (let i = 2; i < e.length; i++) assert.ok(e[i].t - e[i - 1].t >= BS_COOLDOWN - 1e-9, `${mode}: ${e[i].t - e[i - 1].t}`);
  }
});
test('Cambio de modo durante la reproducción: lo anterior no se altera y lo siguiente usa el modo nuevo', () => {
  const cfg = cfgOf({ baseMode: 'two' });
  const before = ev(cfg).filter((x) => x.t < 10).map((x) => x.t);
  setModeAt(cfg, 10, 'half'); setModeAt(cfg, 16, 'off');
  const e = ev(cfg);
  assert.deepEqual(e.filter((x) => x.t < 10).map((x) => x.t), before);
  assert.ok(Math.abs(inWin(e, 10, 16).length - 24) <= 1, `${inWin(e, 10, 16).length}`);
  assert.equal(inWin(e, 16.01, SEC).length, 0);
});
test('NEXT y PREVIOUS: avanzan y retroceden una foto en su instante; el orden secuencial no salta', () => {
  const cfg = cfgOf({ baseMode: 'beat' });
  const base = buildEvents(cfg, A, 0, SEC);
  const s0 = stateAt(cfg, base, photos, 7.3);
  addNudge(cfg, 7.25, 1);
  const s1 = stateAt(cfg, buildEvents(cfg, A, 0, SEC), photos, 7.3);
  assert.equal(s1.index, (s0.index + 1) % 5);
  addNudge(cfg, 7.27, -1); addNudge(cfg, 7.28, -1);
  const e2 = buildEvents(cfg, A, 0, SEC);
  assert.equal(stateAt(cfg, e2, photos, 7.3).index, (s0.index + 4) % 5);
  assert.equal(stateAt(cfg, e2, photos, 7.2).index, s0.index === stateAt(cfg, base, photos, 7.2).index ? stateAt(cfg, base, photos, 7.2).index : -1);
  for (let i = 1; i < base.length; i++) assert.equal(photoIndex(base[i].n, 5, 'sequential'), (photoIndex(base[i - 1].n, 5, 'sequential') + 1) % 5);
});
test('Orden aleatorio: determinista, sin repetir seguidas y todas las fotos en cada vuelta', () => {
  const seq = Array.from({ length: 40 }, (_, n) => photoIndex(n, 5, 'random', 7));
  assert.deepEqual(seq, Array.from({ length: 40 }, (_, n) => photoIndex(n, 5, 'random', 7)));
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1]);
  for (let c = 0; c < 8; c++) assert.equal(new Set(seq.slice(c * 5, c * 5 + 5)).size, 5);
});
test('Función pura del tiempo: evaluar en cualquier orden da lo mismo (base de la exportación exacta)', () => {
  const p = newProject(); p.photos = photos; p.beatSync = cfgOf({ baseMode: 'kick', transition: 'zoom' });
  setModeAt(p.beatSync, 9, 'half'); addNudge(p.beatSync, 5.11, 1);
  setPhotoProvider((proj, t) => (proj.beatSync?.enabled ? clipsAt(proj.beatSync, buildEvents(proj.beatSync, A, 0, SEC), proj.photos, t, SEC) : null));
  const snap = (t) => JSON.stringify(evaluate(p, t).A.photos.map((c) => [c.id, c.params.photoId, c.start, c.params.hitFx]));
  const ts = []; for (let i = 0; i < SEC * 30; i++) ts.push(i / 30);
  const fwd = ts.map(snap);
  const shuffled = ts.map((t, i) => [t, i]).sort((x, y) => Math.sin(x[1] * 12.9898) - Math.sin(y[1] * 12.9898));
  for (const [t, i] of shuffled) assert.equal(snap(t), fwd[i]);
  // la foto de arriba cambia exactamente en cada evento (con transición «zoom» entra unos fotogramas antes)
  const e = buildEvents(p.beatSync, A, 0, SEC);
  for (const x of e.slice(1)) { const top = evaluate(p, x.t + 0.001).A.photos.at(-1); assert.equal(top.event, e.indexOf(x)); }
  setPhotoProvider(null);
});
