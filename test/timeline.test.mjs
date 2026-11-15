import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, newProject } from '../app/js/core/store.js';
import { addClip, splitClip, duplicateClip, removeClip, moveClip, computeLanes, evaluate } from '../app/js/timeline/model.js';
import { outputSize } from '../app/js/export/Exporter.js';

test('Cortar, duplicar, mover y eliminar clips', () => {
  const p = newProject();
  const c = addClip(p, 'tunnels', { type: 'rings', start: 2, dur: 8 });
  const r = splitClip(p, c.id, 5);
  assert.equal(c.dur, 3); assert.equal(r.start, 5); assert.equal(r.dur, 5);
  const d = duplicateClip(p, r.id);
  assert.equal(d.start, 10);
  moveClip(p, d.id, 20); assert.equal(d.start, 20);
  removeClip(p, c.id);
  assert.equal(p.timeline.tracks.tunnels.length, 2);
  assert.equal(splitClip(p, r.id, 100), null);
});

test('Deshacer y rehacer, también ajustes continuos agrupados', () => {
  const s = new Store(newProject());
  s.commit('Añadir', (p) => addClip(p, 'tunnels', { type: 'rings', start: 0, dur: 4 }));
  const id = s.project.timeline.tracks.tunnels[0].id;
  for (let i = 1; i <= 10; i++) s.live((p) => { p.timeline.tracks.tunnels[0].params.speed = i / 10; });
  s.settle('Velocidad');
  assert.equal(s.undoStack.length, 2);
  s.undo(); assert.equal(s.project.timeline.tracks.tunnels[0].params.speed, undefined);
  s.undo(); assert.equal(s.project.timeline.tracks.tunnels.length, 0);
  s.redo(); s.redo();
  assert.equal(s.findClip(id).params.speed, 1);
});

test('Carriles para clips superpuestos', () => {
  const { lanes, count } = computeLanes([{ id: 'a', start: 0, dur: 4 }, { id: 'b', start: 2, dur: 4 }, { id: 'c', start: 4.5, dur: 1 }]);
  assert.equal(count, 2); assert.equal(lanes.get('a'), 0); assert.equal(lanes.get('b'), 1); assert.equal(lanes.get('c'), 0);
});

test('Evaluación: capas activas y túneles superpuestos', () => {
  const p = newProject();
  addClip(p, 'tunnels', { type: 'rings', start: 0, dur: 10 });
  addClip(p, 'tunnels', { type: 'laser', start: 5, dur: 10 });
  assert.equal(evaluate(p, 2).A.tunnels.length, 1);
  assert.equal(evaluate(p, 7).A.tunnels.length, 2);
  assert.equal(evaluate(p, 12).A.tunnels.length, 1);
});

test('Tamaños de exportación (pares, por formato y resolución)', () => {
  assert.deepEqual(outputSize('tiktok', 1080), { w: 1080, h: 1920 });
  assert.deepEqual(outputSize('youtube', 1080), { w: 1920, h: 1080 });
  assert.deepEqual(outputSize('square', 720), { w: 720, h: 720 });
  assert.deepEqual(outputSize('capcut', 2160), { w: 2160, h: 3840 });
  assert.deepEqual(outputSize('youtube', 1440), { w: 2560, h: 1440 });
  assert.deepEqual(outputSize('custom', 0, { w: 1001, h: 777 }), { w: 1002, h: 778 });
});

import { analyze } from '../app/js/audio/analysis-core.js';
import { Analysis } from '../app/js/audio/analysis.js';
import { buildSlideshow } from '../app/js/timeline/slideshow.js';
import { synthTrack } from './helpers.mjs';

test('Pase de fotos: cambios exactamente en los golpes, todas las fotos, fundido cruzado sin huecos', () => {
  const { mono, sr } = synthTrack({ bpm: 128, seconds: 30 });
  const a = new Analysis(analyze(mono, sr));
  const p = newProject();
  p.audio = { duration: 30, trimStart: 0, trimEnd: 30 };
  p.photos = ['a', 'b', 'c'].map((id) => ({ id, settings: {} }));
  for (const every of [1, 2, 4]) {
    const clips = buildSlideshow({ project: p, analysis: a, duration: 30, every, look: 'full' });
    assert.ok(clips.length > 30 / (every * 0.47) * 0.8, `pocos cambios con every=${every}: ${clips.length}`);
    for (const c of clips.slice(1)) { const bp = a.beatPos(c.start); assert.ok(Math.abs(bp - Math.round(bp)) < 0.02, `cambio fuera de golpe: ${c.start}`); }
    assert.equal(new Set(clips.map((c) => c.params.photoId)).size, 3);
    for (let i = 1; i < clips.length; i++) assert.ok(clips[i - 1].start + clips[i - 1].dur >= clips[i].start + clips[i].params.fadeIn - 1e-3, 'hueco entre fotos');
    for (let t = 0.6; t < 29.5; t += 0.05) assert.ok(evaluateAt(p, clips, t) >= 1, `sin foto en ${t}`);
  }
});
function evaluateAt(p, clips, t) { p.timeline.tracks.photos = clips; return evaluate(p, t).A.photos.length; }

test('Pase «en cada golpe de batería»: cada cambio cae en un golpe, con efecto de impacto', () => {
  const { mono, sr } = synthTrack({ bpm: 128, seconds: 20 });
  const a = new Analysis(analyze(mono, sr));
  const p = newProject();
  p.audio = { duration: 20, trimStart: 0, trimEnd: 20 };
  p.photos = ['a', 'b', 'c', 'd'].map((id) => ({ id, settings: {} }));
  const hits = a.drumHits({ mode: 'hits', minGap: 0.25 }).map((h) => h.t);
  const clips = buildSlideshow({ project: p, analysis: a, duration: 20, every: 'hits', hitFx: 'varied', minGap: 0.25 });
  assert.ok(clips.length >= hits.length * 0.9, `${clips.length} cambios / ${hits.length} golpes`);
  for (const c of clips.slice(1)) assert.ok(hits.some((h) => Math.abs(h - (c.start + c.params.hitDelay)) < 0.011), `cambio fuera de golpe: ${c.start}`);
  assert.ok(clips.slice(1).every((c) => c.params.hitFx !== 'none'));
  assert.ok(clips.slice(1).every((c) => c.params.fadeIn <= 0.1));
});

import { exportRange } from '../app/js/export/Exporter.js';
test('Exportador: duraciones de 15/30/45/60 s, inicio en el drop o el cursor, encajadas en la canción', () => {
  const { mono, sr } = synthTrack({ bpm: 128, seconds: 90, breakAt: 30, breakLen: 15 });
  const a = new Analysis(analyze(mono, sr));
  for (const d of [15, 30, 45, 60]) {
    for (const start of ['drop', 'start', 'cursor']) {
      const [t0, t1] = exportRange({ total: 90, duration: d, start, cursor: 50, analysis: a });
      assert.ok(Math.abs(t1 - t0 - d) < 1e-3, `${d} s desde ${start}: ${t0}-${t1}`);
      assert.ok(t0 >= 0 && t1 <= 90 + 1e-6);
      if (start === 'start') assert.equal(t0, 0);
      if (start !== 'start' && t0 > 0 && t0 < 90 - d - 1e-6) { const bp = a.beatPos(t0); assert.ok(Math.abs(bp - Math.round(bp)) < 0.03, `inicio fuera de compás ${t0}`); }
    }
  }
  assert.deepEqual(exportRange({ total: 20, duration: 30, start: 'drop', analysis: a }), [0, 20]); // canción más corta
  assert.deepEqual(exportRange({ total: 90, duration: 0 }), [0, 90]);
  const [c0] = exportRange({ total: 90, duration: 60, start: 'cursor', cursor: 70, analysis: a });
  assert.ok(Math.abs(c0 - 30) < 1e-6, `se adelanta para caber: ${c0}`);
});
