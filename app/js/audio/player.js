// Reproductor: reproduce la música recortada y da el reloj de la vista previa.
// Sin música funciona igual con un reloj virtual (para previsualizar composiciones).
import { Emitter } from '../core/store.js';
import { audioContext } from './loader.js';

export class Player extends Emitter {
  constructor() {
    super();
    this.buffer = null;
    this.playing = false;
    this.offset = 0;        // tiempo de línea de tiempo al iniciar
    this.startedAt = 0;     // reloj (ctx o performance) al iniciar
    this.source = null;
    this.gain = null;
    this.volume = 0.9;
    this.trimStart = 0;
    this.duration = 30;
    this.loop = { enabled: false, a: 0, b: 0 };
    this.rate = 1;
  }
  setBuffer(buffer) { this.stop(); this.buffer = buffer; }
  setRange(trimStart, duration) { this.trimStart = trimStart || 0; this.duration = Math.max(0.1, duration); }
  _clock() {
    if (this.buffer) { const ac = audioContext(); return ac.currentTime - (ac.outputLatency || ac.baseLatency || 0); }
    return performance.now() / 1000;
  }
  get time() {
    if (!this.playing) return this.offset;
    return this.offset + (this._clock() - this.startedAt) * this.rate;
  }
  async play(from = this.offset) {
    if (from >= this.duration - 0.05) from = 0;
    this._stopSource();
    this.offset = Math.max(0, from);
    if (this.buffer) {
      const ac = audioContext();
      if (ac.state !== 'running') { try { await ac.resume(); } catch {} }
      this.gain = this.gain || ac.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(ac.destination);
      const src = ac.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.gain);
      const startIn = this.trimStart + this.offset;
      src.start(0, Math.min(startIn, this.buffer.duration - 0.01), Math.max(0.01, this.duration - this.offset));
      this.source = src;
      this.startedAt = this._clock();
    } else {
      this.startedAt = this._clock();
    }
    this.playing = true;
    this.emit('state', 'play');
  }
  _stopSource() {
    if (this.source) { try { this.source.onended = null; this.source.stop(); } catch {} try { this.source.disconnect(); } catch {} this.source = null; }
  }
  pause() {
    if (!this.playing) return;
    this.offset = Math.min(this.duration, this.time);
    this.playing = false;
    this._stopSource();
    this.emit('state', 'pause');
  }
  stop() {
    this.playing = false;
    this._stopSource();
    this.offset = this.loop.enabled ? this.loop.a : 0;
    this.emit('state', 'stop');
  }
  seek(t) {
    t = Math.max(0, Math.min(this.duration, t));
    if (this.playing) this.play(t); else { this.offset = t; this.emit('seek', t); }
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  setVolume(v) { this.volume = v; if (this.gain) this.gain.gain.value = v; }
  /** Llamar en cada fotograma: gestiona el bucle de fragmento y el final. */
  tick() {
    if (!this.playing) return;
    const t = this.time;
    if (this.loop.enabled && this.loop.b > this.loop.a + 0.1 && t >= this.loop.b) this.play(this.loop.a);
    else if (t >= this.duration) { this.pause(); this.offset = this.duration; this.emit('ended'); }
  }
}
