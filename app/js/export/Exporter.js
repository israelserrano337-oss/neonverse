// Exportador MP4: vuelve a dibujar cada fotograma en t = inicio + i/fps (no graba la pantalla).
// Escritorio: píxeles → FFmpeg (H.264/H.265, CPU o Intel QuickSync). Navegador: WebCodecs + mp4-muxer.
import { evaluate } from '../timeline/model.js';
import { CrashGuard } from '../core/crashguard.js';
import { PositionedSink, aacAudioSpecificConfig, isIOS, canShareVideo, keepAwake } from './mobile.js';

export const EXPORT_PRESETS = [
  { id: 'tiktok', label: 'TikTok 9:16', aspect: [9, 16] },
  { id: 'capcut', label: 'CapCut 9:16', aspect: [9, 16] },
  { id: 'youtube', label: 'YouTube 16:9', aspect: [16, 9] },
  { id: 'square', label: 'Cuadrado 1:1', aspect: [1, 1] },
  { id: 'custom', label: 'Personalizado', aspect: null },
];
export const RESOLUTIONS = [{ id: 720, label: '720p' }, { id: 1080, label: '1080p' }, { id: 1440, label: '1440p' }, { id: 2160, label: '4K (2160p)' }];
export const DURATIONS = [{ value: 0, label: 'Completo' }, { value: 15, label: '15 s' }, { value: 30, label: '30 s' }, { value: 45, label: '45 s' }, { value: 60, label: '60 s' }];
export const STARTS = [{ value: 'drop', label: 'Desde el primer drop (lo más intenso)' }, { value: 'start', label: 'Desde el principio' }, { value: 'cursor', label: 'Desde el cursor' }];

/**
 * Tramo [t0, t1] a exportar. Con duración fija (15/30/45/60 s) el inicio se encaja en el compás y, si no cabe,
 * se adelanta para que el clip dure exactamente lo elegido (o la canción entera si es más corta).
 */
export function exportRange({ total, duration = 0, start = 'drop', cursor = 0, analysis = null, trimStart = 0, loop = null }) {
  if (loop) return [loop.a, loop.b];
  if (!duration || duration >= total - 0.01) return [0, total];
  let t0 = 0;
  if (start === 'cursor') t0 = cursor;
  else if (start === 'drop' && analysis && !analysis.synthetic) {
    const sec = analysis.sections.find((s) => s.type === 'drop' && s.start - trimStart >= 0) || analysis.sections.find((s) => s.type === 'build' && s.start - trimStart >= 0);
    if (sec) t0 = sec.start - trimStart;
    // un compás antes del drop: el golpe de entrada se ve en el clip
    if (t0 > 0 && analysis.bpm) t0 = Math.max(0, t0 - (60 / analysis.bpm) * 4);
  }
  if (analysis?.barStart && start !== 'start' && t0 > 0) t0 = Math.max(0, analysis.barStart(t0 + trimStart + 0.05) - trimStart);
  t0 = Math.min(Math.max(0, t0), Math.max(0, total - duration));
  return [+t0.toFixed(4), +Math.min(total, t0 + duration).toFixed(4)];
}

export const QUALITIES = [{ id: 'draft', label: 'Borrador', crf: 28, mbps: 4 }, { id: 'normal', label: 'Normal', crf: 23, mbps: 8 }, { id: 'high', label: 'Alta', crf: 19, mbps: 14 }, { id: 'max', label: 'Máxima', crf: 16, mbps: 24 }];

/** Tamaño de salida: el lado corto es la resolución elegida; dimensiones pares. */
export function outputSize(preset, res, custom) {
  const p = EXPORT_PRESETS.find((x) => x.id === preset) || EXPORT_PRESETS[0];
  if (!p.aspect) return { w: even(custom?.w || 1080), h: even(custom?.h || 1920) };
  const [aw, ah] = p.aspect;
  if (aw <= ah) return { w: even(res), h: even((res * ah) / aw) };
  return { w: even(res * aw / ah), h: even(res) };
}
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

export function bitrateFor(w, h, fps, quality) {
  const q = QUALITIES.find((x) => x.id === quality) || QUALITIES[2];
  return Math.round(q.mbps * 1e6 * (w * h) / (1080 * 1920) * Math.sqrt(fps / 30));
}

export class Exporter {
  constructor(app) { this.app = app; this.running = false; this.cancelled = false; }
  get desktop() { return typeof window !== 'undefined' && window.neonDesktop?.isDesktop; }

  async capabilities() {
    const out = { desktop: !!this.desktop, h264: false, h265: false, qsv: false, webcodecs: typeof VideoEncoder !== 'undefined' };
    if (this.desktop) {
      try { Object.assign(out, await window.neonDesktop.ffmpegInfo()); } catch (e) { out.error = String(e); }
    } else if (out.webcodecs) {
      try { out.h264 = (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 8e6, framerate: 30 })).supported; } catch {}
      try { out.h265 = (await VideoEncoder.isConfigSupported({ codec: 'hvc1.1.6.L120.90', width: 1080, height: 1920, bitrate: 8e6, framerate: 30 })).supported; } catch {}
    }
    return out;
  }

  /**
   * @param {object} opt { width, height, fps, codec:'h264'|'h265', encoder:'cpu'|'qsv', quality, bitrateMbps, audioBitrate, fileName, folder, range:[t0,t1], onProgress }
   */
  async run(opt) {
    if (this.running) throw new Error('Ya hay una exportación en curso');
    const app = this.app;
    this.running = true; this.cancelled = false;
    const { width: W, height: H, fps } = opt;
    const [t0, t1] = opt.range;
    const total = Math.max(1, Math.round((t1 - t0) * fps));
    const wasPlaying = app.player.playing;
    app.player.pause();
    app.exporting = true;
    CrashGuard.begin('export', `${W}x${H} ${fps} fps ${(t1 - t0).toFixed(0)} s`);
    const quality = { ...app.qualityFor('export') };
    const startedAt = performance.now();
    let sink = null;
    const wake = await keepAwake(); // en iPhone: que la pantalla no se apague a mitad
    let hiddenWarn = false;
    const onHide = () => { if (document.hidden) hiddenWarn = true; };
    document.addEventListener('visibilitychange', onHide);
    try {
      await app.preloadPhotos(W >= 1440 || H >= 2400 ? 4096 : 2048);
      app.engine.setCanvasSize(W, H);
      const bitrate = opt.bitrateMbps ? Math.round(opt.bitrateMbps * 1e6) : bitrateFor(W, H, fps, opt.quality);
      sink = this.desktop ? await this.desktopSink(opt, W, H, fps, bitrate, t0, t1) : await this.browserSink(opt, W, H, fps, bitrate, t0, t1);
      const gl = app.engine.renderer.getContext();
      const pixels = this.desktop ? new Uint8Array(W * H * 4) : null;
      const project = app.store.project;
      for (let i = 0; i < total; i++) {
        if (this.cancelled) throw new Error('cancelado');
        const t = t0 + i / fps;
        const comp = evaluate(project, t);
        app.engine.render({ t, comp, project, audioFor: app.audioFor(t), quality, width: W, height: H, target: null });
        if (this.desktop) {
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          await sink.frame(pixels);
        } else {
          await sink.frame(app.engine.canvas, i);
        }
        if (i % 3 === 0 || i === total - 1) {
          const el = (performance.now() - startedAt) / 1000;
          const rate = (i + 1) / el;
          opt.onProgress?.({ frame: i + 1, total, fps: rate, eta: (total - i - 1) / Math.max(0.01, rate), elapsed: el });
          await new Promise((r) => setTimeout(r, 0)); // deja respirar a la interfaz
        }
      }
      const result = await sink.finish();
      return { ...result, seconds: (performance.now() - startedAt) / 1000, frames: total, width: W, height: H, fps, interrupted: hiddenWarn };
    } catch (e) {
      try { await sink?.cancel(); } catch {}
      throw e;
    } finally {
      document.removeEventListener('visibilitychange', onHide);
      try { await wake?.release(); } catch {}
      this.running = false; CrashGuard.end();
      app.exporting = false;
      app.engine.disposeAll();
      app.resizePreview(true);
      if (wasPlaying) app.player.play();
    }
  }
  cancel() { this.cancelled = true; }

  // ------------------------------------------------------------ escritorio: FFmpeg en el proceso principal
  async desktopSink(opt, W, H, fps, bitrate, t0, t1) {
    const app = this.app, d = window.neonDesktop;
    const a = app.store.project.audio;
    let audio = null;
    if (a && opt.audioBitrate !== 0) {
      const item = await app.media.get(a.mediaId);
      if (item) audio = { bytes: new Uint8Array(await item.blob.arrayBuffer()), name: item.name, start: (a.trimStart || 0) + t0, duration: t1 - t0 };
    }
    const q = QUALITIES.find((x) => x.id === opt.quality) || QUALITIES[2];
    const job = await d.exportStart({
      width: W, height: H, fps, codec: opt.codec, encoder: opt.encoder, crf: q.crf, bitrate: opt.bitrateMbps ? bitrate : 0,
      audio, audioBitrate: opt.audioBitrate || 192, fadeOut: opt.fadeOut || 0, folder: opt.folder, fileName: opt.fileName,
    });
    if (!job.ok) throw new Error(job.error || 'No se pudo iniciar FFmpeg');
    return {
      frame: async (px) => { const r = await d.exportFrame(px); if (!r.ok) throw new Error(r.error || 'FFmpeg dejó de aceptar fotogramas'); },
      finish: async () => { const r = await d.exportFinish(); if (!r.ok) throw new Error(r.error || 'FFmpeg falló al cerrar el vídeo'); return { path: r.path, size: r.size, log: r.log }; },
      cancel: () => d.exportCancel(),
    };
  }

  // ------------------------------------------------------------ navegador: WebCodecs + mp4-muxer
  async browserSink(opt, W, H, fps, bitrate, t0, t1) {
    if (typeof VideoEncoder === 'undefined') throw new Error('Este navegador no puede codificar vídeo (WebCodecs). Exporta el proyecto .neonverse y renderízalo en la app de escritorio.');
    const { Muxer, StreamTarget } = await import('../../vendor/mp4-muxer.mjs');
    const level = W * H > 1920 * 1088 ? (W * H > 2560 * 1440 ? '34' : '33') : '28';
    let vcodec = opt.codec === 'h265' ? 'hvc1.1.6.L150.90' : `avc1.6400${level}`;
    let vcfg = { codec: vcodec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
    if (opt.codec === 'h265') { delete vcfg.avc; vcfg.hevc = { format: 'hevc' }; }
    if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) {
      vcfg = { codec: `avc1.6400${level}`, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
      if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error('El navegador no admite codificar H.264 a este tamaño');
    }
    const app = this.app;
    const buffer = app.audioBuffer;
    let aCodec = null, aCfg = null;
    if (buffer && opt.audioBitrate !== 0 && typeof AudioEncoder !== 'undefined') {
      for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
        const cfg = { codec, sampleRate: buffer.sampleRate, numberOfChannels: Math.min(2, buffer.numberOfChannels), bitrate: (opt.audioBitrate || 192) * 1000 };
        try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) { aCodec = mux; aCfg = cfg; break; } } catch {}
      }
    }
    // Escritura por trozos (memoria = tamaño del vídeo una vez): imprescindible en iPhone
    const store = new PositionedSink();
    const target = new StreamTarget({ onData: (data, position) => store.write(data, position), chunked: true, chunkSize: 4 * 1024 * 1024 });
    const muxer = new Muxer({
      target, fastStart: false, firstTimestampBehavior: 'offset',
      video: { codec: vcfg.codec.startsWith('hvc') ? 'hevc' : 'avc', width: W, height: H, frameRate: fps },
      ...(aCodec ? { audio: { codec: aCodec, numberOfChannels: aCfg.numberOfChannels, sampleRate: aCfg.sampleRate } } : {}),
    });
    let encErr = null;
    const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
    venc.configure(vcfg);
    const frameDur = Math.round(1e6 / fps);
    return {
      frame: async (canvas, i) => {
        if (encErr) throw encErr;
        const vf = new VideoFrame(canvas, { timestamp: i * frameDur, duration: frameDur });
        venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      },
      finish: async () => {
        await venc.flush();
        if (encErr) throw encErr;
        venc.close();
        if (aCodec) await encodeAudio(buffer, aCfg, (app.store.project.audio?.trimStart || 0) + t0, t1 - t0, muxer, aCodec, opt.fadeOut || 0);
        muxer.finalize();
        const blob = store.toBlob('video/mp4');
        const name = (opt.fileName || 'neonverse-video').replace(/[\\/:*?"<>|]+/g, '_') + '.mp4';
        const url = URL.createObjectURL(blob);
        const file = new File([blob], name, { type: 'video/mp4' });
        const share = canShareVideo(file);
        // En iPhone no se descarga solo: el panel ofrece «Guardar en Fotos» (hoja de compartir) y «Guardar en Archivos».
        if (!isIOS()) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); }
        return { path: name, size: blob.size, blobUrl: url, file, share, audio: aCodec, noAudioReason: buffer && !aCodec && opt.audioBitrate !== 0 ? 'Este navegador no puede codificar audio (en iPhone hace falta iOS 26 o posterior)' : null };
      },
      cancel: async () => { try { venc.close(); } catch {} },
    };
  }
}

async function encodeAudio(buffer, cfg, start, duration, muxer, kind, fadeOut = 0) {
  let err = null;
  // AAC: se escribe una cabecera AudioSpecificConfig propia (Safari 26 entrega una incorrecta)
  const asc = kind === 'aac' ? aacAudioSpecificConfig(cfg.sampleRate, cfg.numberOfChannels) : null;
  const fix = (meta) => (asc ? { ...(meta || {}), decoderConfig: { ...(meta?.decoderConfig || {}), codec: 'mp4a.40.2', sampleRate: cfg.sampleRate, numberOfChannels: cfg.numberOfChannels, description: asc } } : meta);
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, fix(meta)), error: (e) => { err = e; } });
  enc.configure(cfg);
  const sr = buffer.sampleRate, ch = cfg.numberOfChannels;
  const s0 = Math.floor(start * sr), s1 = Math.min(buffer.length, Math.floor((start + duration) * sr));
  const block = 4096;
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)));
  for (let s = s0; s < s1; s += block) {
    const n = Math.min(block, s1 - s);
    const data = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) data.set(chans[c].subarray(s, s + n), c * n);
    if (fadeOut > 0) { // fundido final (seno cuadrado), igual que en escritorio
      const f0 = s1 - Math.floor(fadeOut * sr);
      if (s + n > f0) for (let c = 0; c < ch; c++) for (let i = Math.max(0, f0 - s); i < n; i++) { const k = (s1 - (s + i)) / (s1 - f0); data[c * n + i] *= Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, k))) ** 2; }
    }
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(((s - s0) / sr) * 1e6), data });
    enc.encode(ad);
    ad.close();
    if (err) throw err;
    while (enc.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 1));
  }
  await enc.flush();
  enc.close();
}
