import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../app/js/core/store.js';
import { addClip, evaluate, has3D } from '../app/js/timeline/model.js';

const layers = (c) => c.A || c.layers || c;

test('Sin fotos ni clips 3D el vídeo lleva las capas de los estudios combinadas', () => {
  const p = newProject();
  p.studio.tunnels = [{ id: 't1', type: 'hexgrid', params: {} }];
  p.studio.meshes = [{ id: 'm1', type: 'lattice', params: {} }];
  p.studio.equalizers = [{ id: 'e1', type: 'reactor', params: {} }, { id: 'e2', type: 'pulsar', params: {}, hidden: true }];
  assert.equal(has3D(p), false);
  for (const t of [0, 7.3, 59]) {
    const L = layers(evaluate(p, t));
    assert.equal(L.tunnels.length, 1); assert.equal(L.meshes.length, 1); assert.equal(L.equalizers.length, 1);
    assert.equal(L.photos.length, 0);
  }
});

test('Proyecto vacío: túnel por defecto en lugar de negro', () => {
  const p = newProject();
  const L = layers(evaluate(p, 3));
  assert.equal(L.tunnels.length, 1);
});

test('Con clips 3D manda la línea de tiempo; las fotos se pueden ocultar', () => {
  const p = newProject();
  p.studio.meshes = [{ id: 'm1', type: 'lattice', params: {} }];
  addClip(p, 'tunnels', { type: 'rings', start: 0, dur: 5 });
  addClip(p, 'photos', { photoId: 'ph1', start: 0, dur: 5 });
  let L = layers(evaluate(p, 1));
  assert.equal(L.tunnels.length, 1); assert.equal(L.meshes.length, 0); assert.equal(L.photos.length, 1);
  p.showPhotos = false;
  L = layers(evaluate(p, 1));
  assert.equal(L.photos.length, 0); assert.equal(L.tunnels.length, 1);
});
