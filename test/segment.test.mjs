import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.navigator ??= { userAgent: 'node', platform: 'Linux', maxTouchPoints: 0 };
const { mp3Frame, longLimits, isLong } = await import('../app/js/audio/segment.js');

test('Cabeceras MP3: tamaño y muestras por trama', () => {
  assert.deepEqual(mp3Frame(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), 0), { size: 417, spf: 1152, sr: 44100 }); // 128 kbps 44,1 kHz
  assert.deepEqual(mp3Frame(new Uint8Array([0xff, 0xfb, 0x92, 0x00]), 0), { size: 418, spf: 1152, sr: 44100 }); // con relleno
  assert.equal(mp3Frame(new Uint8Array([0xff, 0xf3, 0x84, 0x00]), 0).spf, 576); // MPEG-2
  assert.equal(mp3Frame(new Uint8Array([0xff, 0xfb, 0xf0, 0x00]), 0), null); // índice de bitrate no válido
  assert.equal(mp3Frame(new Uint8Array([0x49, 0x44, 0x33, 0x04]), 0), null);
});

test('Límites de canción larga: iPhone más estricto que el escritorio', () => {
  const ios = longLimits(true), pc = longLimits(false);
  assert.ok(isLong({ duration: 3600, size: 80e6 }, ios));
  assert.ok(!isLong({ duration: 300, size: 10e6 }, ios));
  assert.ok(isLong({ duration: 25 * 60, size: 30e6 }, pc));
  assert.ok(!isLong({ duration: 10 * 60, size: 30e6 }, pc));
  assert.ok(isLong({ duration: NaN, size: 400e6 }, pc));
});
