import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../app/js/audio/analysis-core.js';
import { Analysis } from '../app/js/audio/analysis.js';
import { synthTrack } from './helpers.mjs';

test('BPM 128 detectado y golpes alineados con el bombo', () => {
  const { mono, sr } = synthTrack({ bpm: 128, seconds: 40 });
  const r = analyze(mono, sr);
  assert.ok(Math.abs(r.bpm - 128) < 1.5, `bpm ${r.bpm}`);
  const beat = 60 / 128;
  let err = 0, n = 0;
  for (const b of r.beats) { if (b < 1 || b > 39) continue; const d = ((b % beat) + beat) % beat; err += Math.min(d, beat - d); n++; }
  assert.ok(err / n < 0.03, `desfase medio ${(err / n * 1000).toFixed(1)} ms`);
});

test('Tempo a la mitad corregido (160 BPM no sale como 80)', () => {
  const { mono, sr } = synthTrack({ bpm: 160, seconds: 30 });
  const r = analyze(mono, sr);
  assert.ok(Math.abs(r.bpm - 160) < 2, `bpm ${r.bpm}`);
});

test('Secciones: la pausa sin bombo tiene menos energía que el resto', () => {
  const { mono, sr } = synthTrack({ bpm: 125, seconds: 90, breakAt: 38.4, breakLen: 23.04 });
  const r = analyze(mono, sr);
  assert.ok(r.sections.length >= 2, `secciones ${r.sections.length}`);
  const a = new Analysis(r);
  const inBreak = a.sectionAt(50), loud = a.sectionAt(75);
  assert.ok(inBreak.energy < loud.energy, `pausa ${inBreak.energy} vs ${loud.energy}`);
  assert.ok(['break', 'intro', 'verse', 'build'].includes(inBreak.type), inBreak.type);
});

test('Lectura pura: at(t) devuelve lo mismo en cualquier orden', () => {
  const { mono, sr } = synthTrack({ bpm: 128, seconds: 12 });
  const a = new Analysis(analyze(mono, sr));
  const ts = [3.21, 0.5, 7.77, 3.21, 11.9, 0.5];
  const snap = (t) => { const o = a.at(t); return JSON.stringify([o.bass, o.mid, o.treble, o.beat, o.beatPos, o.travel, Array.from(o.spectrum)]); };
  const first = new Map();
  for (const t of ts) { const s = snap(t); if (first.has(t)) assert.equal(s, first.get(t)); else first.set(t, s); }
  for (const t of [0, 1, 5, 11.99]) { const o = a.at(t); for (const k of ['bass', 'lowMid', 'mid', 'highMid', 'treble', 'energy', 'beat']) assert.ok(o[k] >= 0 && o[k] <= 1.0001 && Number.isFinite(o[k]), `${k}=${o[k]}`); }
});

test('Golpes de batería: coinciden con el bombo y no aparecen en la pausa sin batería', () => {
  const { mono, sr } = synthTrack({ bpm: 128, seconds: 40, breakAt: 15, breakLen: 10 });
  const a = new Analysis(analyze(mono, sr));
  const hits = a.drumHits({ mode: 'hits', minGap: 0.25 });
  const beat = 60 / 128;
  const inBreak = hits.filter((h) => h.t > 15.3 && h.t < 24.7).length;
  const outside = hits.filter((h) => h.t < 14.7 || h.t > 25.3);
  assert.ok(outside.length > (30 / beat) * 0.8, `pocos golpes: ${outside.length}`);
  assert.ok(inBreak <= 2, `golpes en la pausa: ${inBreak}`);
  let err = 0; for (const h of outside) { const d = ((h.t % beat) + beat) % beat; err += Math.min(d, beat - d); }
  assert.ok(err / outside.length < 0.035, `desfase medio ${(err / outside.length * 1000).toFixed(1)} ms`);
  const kicks = a.drumHits({ mode: 'kicks', minGap: 0.25 });
  assert.ok(Math.abs(kicks.length - outside.length) < outside.length * 0.25);
});
