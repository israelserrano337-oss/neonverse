// Canciones largas (mezclas de 1 h o más) sin agotar la memoria del iPhone.
// Decodificar una hora de audio entera ocupa ~1,3 GB y iOS cierra la pestaña. Aquí solo se lee del
// archivo el tramo elegido (más un margen), sin cargar el resto en memoria:
//   · MP3: índice de tramas (cabeceras) leyendo el archivo a trozos de 1 MB → corte exacto por trama.
//   · M4A / MP4 (AAC): tabla de muestras del «moov» → tramas AAC con cabecera ADTS.
//   · WAV: cálculo directo del rango de bytes.
//   · Otros formatos: grabación en tiempo real del tramo desde un <audio> (plan B, tarda lo que dura).
import { audioContext, decodeAudio } from './loader.js';

const MB = 1 << 20;
export const isIOSDevice = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Límites: por encima se pide elegir un tramo en lugar de decodificar la canción entera. */
export function longLimits(ios = isIOSDevice()) {
  return ios ? { seconds: 8 * 60, bytes: 60 * MB, maxSegment: 5 * 60 } : { seconds: 20 * 60, bytes: 300 * MB, maxSegment: 15 * 60 };
}
export function isLong({ duration, size }, lim = longLimits()) {
  return (Number.isFinite(duration) && duration > lim.seconds) || size > lim.bytes;
}

/** Duración leyendo solo los metadatos (el navegador no carga el archivo entero). */
export function probeDuration(file, timeout = 15000) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(tm); a.removeAttribute('src'); a.load(); URL.revokeObjectURL(url); resolve(v); };
    const tm = setTimeout(() => end(NaN), timeout);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) return end(a.duration);
      a.ondurationchange = () => { if (Number.isFinite(a.duration)) end(a.duration); };
      a.currentTime = 1e7; // truco para MP3 sin cabecera de duración
    };
    a.onerror = () => end(NaN);
    a.src = url;
  });
}

const readBytes = async (file, a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
const str4 = (u, o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);

export async function sniff(file) {
  const h = await readBytes(file, 0, 64);
  const name = (file.name || '').toLowerCase();
  if (str4(h, 0) === 'RIFF' && str4(h, 8) === 'WAVE') return 'wav';
  if (str4(h, 4) === 'ftyp') return 'mp4';
  if (str4(h, 0).startsWith('ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) || /\.mp3$/.test(name)) return 'mp3';
  return 'other';
}

// ------------------------------------------------------------------------------------------ MP3
const BR = {
  '1-3': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-3': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
/** Cabecera de trama MP3 → { size, spf, sr } o null. */
export function mp3Frame(u, o) {
  if (u[o] !== 0xff || (u[o + 1] & 0xe0) !== 0xe0) return null;
  const ver = (u[o + 1] >> 3) & 3, layer = (u[o + 1] >> 1) & 3;
  if (ver === 1 || layer === 0) return null;
  const bi = u[o + 2] >> 4, si = (u[o + 2] >> 2) & 3, pad = (u[o + 2] >> 1) & 1;
  if (bi === 0 || bi === 15 || si === 3) return null;
  const v1 = ver === 3, L = 4 - layer; // L: 1, 2 o 3
  const br = BR[v1 ? `1-${4 - L}` : (L === 1 ? '2-3' : '2-2')][bi] * 1000;
  const sr = SR[ver][si];
  let size, spf;
  if (L === 1) { spf = 384; size = (Math.floor(12 * br / sr) + pad) * 4; }
  else if (L === 2 || v1) { spf = 1152; size = Math.floor(144 * br / sr) + pad; }
  else { spf = 576; size = Math.floor(72 * br / sr) + pad; }
  return size > 4 ? { size, spf, sr } : null;
}

/** Recorre las tramas hasta `until` segundos. Devuelve los bytes [a, b) y el instante real de a. */
async function mp3Range(file, from, until, onProgress) {
  let pos = 0;
  const head = await readBytes(file, 0, 10);
  if (str4(head, 0).startsWith('ID3')) pos = 10 + ((head[6] & 127) << 21 | (head[7] & 127) << 14 | (head[8] & 127) << 7 | (head[9] & 127)) + (head[5] & 0x10 ? 10 : 0);
  const CH = MB;
  // t cuenta el tiempo de las tramas; el audio real va «shift» por detrás (retardo del codificador + decodificador)
  let buf = null, bufStart = 0, t = 0, a = -1, ta = 0, frames = 0, shift = 0;
  const size = file.size;
  while (pos + 4 <= size) {
    if (!buf || pos + 4 > bufStart + buf.length) { bufStart = pos; buf = await readBytes(file, pos, Math.min(size, pos + CH)); onProgress?.(Math.min(1, t / until)); if (buf.length < 4) break; }
    const o = pos - bufStart;
    const f = mp3Frame(buf, o);
    // Comprobación de la trama siguiente para no confundir datos con cabeceras
    if (f && (o + f.size + 2 > buf.length || mp3Frame(buf, o + f.size) || pos + f.size >= size)) {
      if (frames === 0) {
        frames++;
        shift = (576 + 529) / f.sr; // valor típico si no hay etiqueta LAME
        const fr = buf.subarray(o, Math.min(buf.length, o + f.size)), tag = (k) => { for (let i = 4; i < Math.min(fr.length - 4, 64); i++) if (str4(fr, i) === k) return i; return -1; };
        if (tag('Xing') >= 0 || tag('Info') >= 0) { // trama informativa: no lleva audio
          let L = -1; for (let i = 0; i < fr.length - 24; i++) if (str4(fr, i) === 'LAME' || str4(fr, i) === 'Lavc' || str4(fr, i) === 'Lavf') { L = i; break; }
          if (L >= 0) shift = (((fr[L + 21] << 4) | (fr[L + 22] >> 4)) + 529) / f.sr;
          pos += f.size; continue;
        }
      }
      if (a < 0 && t - shift + f.spf / f.sr > from) { a = pos; ta = t - shift; }
      t += f.spf / f.sr; frames++;
      pos += f.size;
      if (t - shift >= until) break;
    } else pos++;
  }
  if (a < 0) throw new Error('No se encontró audio MP3 en ese punto');
  return { a, b: Math.min(size, pos), ta };
}

// ------------------------------------------------------------------------------------------ MP4 / M4A
function boxes(u, start, end) {
  const out = [];
  for (let o = start; o + 8 <= end;) {
    let s = (u[o] << 24 | u[o + 1] << 16 | u[o + 2] << 8 | u[o + 3]) >>> 0, h = 8;
    if (s === 1) { s = Number(new DataView(u.buffer, u.byteOffset + o + 8, 8).getBigUint64(0)); h = 16; }
    if (s === 0) s = end - o;
    if (s < 8) break;
    out.push({ type: str4(u, o + 4), start: o + h, end: Math.min(end, o + s) });
    o += s;
  }
  return out;
}
const find = (u, b, path) => { let cur = [b]; for (const p of path) { const nx = []; for (const c of cur) nx.push(...boxes(u, c.start, c.end).filter((x) => x.type === p)); cur = nx; } return cur; };

async function readMoov(file) {
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = await readBytes(file, pos, pos + 16);
    let s = (h[0] << 24 | h[1] << 16 | h[2] << 8 | h[3]) >>> 0;
    if (s === 1) s = Number(new DataView(h.buffer).getBigUint64(8));
    if (s === 0) s = file.size - pos;
    if (str4(h, 4) === 'moov') { if (s > 64 * MB) throw new Error('moov demasiado grande'); return readBytes(file, pos, pos + s); }
    if (s < 8) break;
    pos += s;
  }
  throw new Error('Archivo MP4 sin moov');
}

function parseAsc(u) {
  // u: bytes del descriptor esds (después de la cabecera de caja)
  let o = 4; // versión + flags
  const len = () => { let n = 0; for (let i = 0; i < 4; i++) { const c = u[o++]; n = (n << 7) | (c & 127); if (!(c & 128)) break; } return n; };
  while (o < u.length) {
    const tag = u[o++]; const l = len();
    if (tag === 3) { o += 2; const fl = u[o++]; if (fl & 128) o += 2; if (fl & 64) o += 1 + u[o]; if (fl & 32) o += 2; continue; }
    if (tag === 4) { o += 13; continue; }
    if (tag === 5) {
      const b0 = u[o], b1 = u[o + 1];
      let aot = b0 >> 3, fi = ((b0 & 7) << 1) | (b1 >> 7), ch = (b1 >> 3) & 15;
      if (aot === 5 || aot === 29) aot = 2; // HE-AAC: núcleo LC (el SBR se detecta implícitamente)
      return { aot, fi, ch };
    }
    o += l;
  }
  throw new Error('AAC sin configuración');
}

async function mp4Range(file, from, until) {
  const m = await readMoov(file);
  const root = { start: 8, end: m.length };
  for (const trak of find(m, root, ['trak'])) {
    const mdia = find(m, trak, ['mdia'])[0]; if (!mdia) continue;
    const hdlr = find(m, mdia, ['hdlr'])[0];
    if (!hdlr || str4(m, hdlr.start + 8) !== 'soun') continue;
    const mdhd = find(m, mdia, ['mdhd'])[0];
    const dv = new DataView(m.buffer, m.byteOffset);
    const ts = m[mdhd.start] === 1 ? dv.getUint32(mdhd.start + 20) : dv.getUint32(mdhd.start + 12);
    const stbl = find(m, mdia, ['minf', 'stbl'])[0];
    // Lista de edición: muestras de «cebado» del codificador AAC al principio (1024–2112)
    let prime = 0; const elst = find(m, trak, ['edts', 'elst'])[0];
    if (elst && dv.getUint32(elst.start + 4) > 0) prime = m[elst.start] === 1 ? Number(dv.getBigInt64(elst.start + 16)) : dv.getInt32(elst.start + 12);
    prime = Math.max(0, prime) / ts;
    const get = (t) => find(m, stbl, [t])[0];
    const stsd = get('stsd');
    const entry = boxes(m, stsd.start + 8, stsd.end)[0];
    if (!entry || entry.type !== 'mp4a') throw new Error('La pista de audio no es AAC');
    let esds = -1; for (let i = entry.start; i < entry.end - 4; i++) if (str4(m, i) === 'esds') { esds = i + 4; break; }
    if (esds < 0) throw new Error('AAC sin esds');
    const asc = parseAsc(m.subarray(esds, entry.end));
    if (asc.fi > 12 || asc.ch === 0 || asc.ch > 7) throw new Error('Configuración AAC no compatible');
    // Tablas de muestras
    const stts = get('stts'), stsz = get('stsz'), stsc = get('stsc'), stco = get('stco') || get('co64'), is64 = !get('stco');
    const nS = dv.getUint32(stsz.start + 8), fixed = dv.getUint32(stsz.start + 4);
    const sizeOf = (i) => fixed || dv.getUint32(stsz.start + 12 + i * 4);
    const nC = dv.getUint32(stco.start + 4);
    const chunkOff = (i) => is64 ? Number(dv.getBigUint64(stco.start + 8 + i * 8)) : dv.getUint32(stco.start + 8 + i * 4);
    const nSC = dv.getUint32(stsc.start + 4);
    const sc = []; for (let i = 0; i < nSC; i++) sc.push([dv.getUint32(stsc.start + 8 + i * 12) - 1, dv.getUint32(stsc.start + 12 + i * 12)]);
    // Duraciones (stts) → índice de muestra para un instante
    const nT = dv.getUint32(stts.start + 4);
    const startSample = (sec) => { let s = 0, tt = 0; const target = sec * ts; for (let i = 0; i < nT; i++) { const c = dv.getUint32(stts.start + 8 + i * 8), d = dv.getUint32(stts.start + 12 + i * 8); if (tt + c * d > target) return { s: s + Math.floor((target - tt) / d), d }; s += c; tt += c * d; } return { s, d: 1024 }; };
    const timeOf = (idx) => { let s = 0, tt = 0; for (let i = 0; i < nT; i++) { const c = dv.getUint32(stts.start + 8 + i * 8), d = dv.getUint32(stts.start + 12 + i * 8); if (s + c > idx) return (tt + (idx - s) * d) / ts; s += c; tt += c * d; } return tt / ts; };
    const s0 = Math.max(0, startSample(from + prime).s), s1 = Math.min(nS, startSample(until + prime).s + 1);
    // Desplazamiento en el archivo de cada muestra del tramo
    const offs = []; let si = 0;
    for (let c = 0, k = 0; c < nC && si < s1; c++) {
      while (k + 1 < sc.length && sc[k + 1][0] <= c) k++;
      let o = chunkOff(c);
      for (let j = 0; j < sc[k][1] && si < s1; j++, si++) { const z = sizeOf(si); if (si >= s0) offs.push([o, z]); o += z; }
    }
    if (!offs.length) throw new Error('Tramo vacío');
    const lo = offs[0][0], hi = offs[offs.length - 1][0] + offs[offs.length - 1][1];
    if (hi - lo > 200 * MB) throw new Error('Tramo AAC demasiado disperso');
    const span = await readBytes(file, lo, hi);
    const total = offs.reduce((n, [, z]) => n + z + 7, 0);
    const out = new Uint8Array(total); let w = 0;
    const prof = asc.aot - 1;
    for (const [o, z] of offs) {
      const L = z + 7;
      out.set([0xff, 0xf1, (prof << 6) | (asc.fi << 2) | (asc.ch >> 2), ((asc.ch & 3) << 6) | (L >> 11), (L >> 3) & 0xff, ((L & 7) << 5) | 0x1f, 0xfc], w);
      out.set(span.subarray(o - lo, o - lo + z), w + 7); w += L;
    }
    return { bytes: out.buffer, ta: timeOf(s0) - prime };
  }
  throw new Error('El archivo no tiene pista de audio');
}

// ------------------------------------------------------------------------------------------ WAV
async function wavRange(file, from, until) {
  const h = await readBytes(file, 0, Math.min(file.size, 256 * 1024));
  const dv = new DataView(h.buffer);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= h.length) {
    const id = str4(h, o), sz = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { tag: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), sr: dv.getUint32(o + 12, true), align: dv.getUint16(o + 20, true), bits: dv.getUint16(o + 22, true) };
    if (id === 'data') { data = o + 8; break; }
    o += 8 + sz + (sz & 1);
  }
  if (!fmt || data == null) throw new Error('WAV no válido');
  const tag = fmt.tag === 0xfffe ? (fmt.bits === 32 ? 3 : 1) : fmt.tag;
  const fA = Math.max(0, Math.floor(from * fmt.sr)), fB = Math.min(Math.floor((file.size - data) / fmt.align), Math.ceil(until * fmt.sr));
  const body = await readBytes(file, data + fA * fmt.align, data + fB * fmt.align);
  const out = new Uint8Array(44 + body.length), w = new DataView(out.buffer);
  out.set([82, 73, 70, 70]); w.setUint32(4, 36 + body.length, true); out.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  w.setUint32(16, 16, true); w.setUint16(20, tag, true); w.setUint16(22, fmt.ch, true); w.setUint32(24, fmt.sr, true);
  w.setUint32(28, fmt.sr * fmt.align, true); w.setUint16(32, fmt.align, true); w.setUint16(34, fmt.bits, true);
  out.set([100, 97, 116, 97], 36); w.setUint32(40, body.length, true); out.set(body, 44);
  return { bytes: out.buffer, ta: fA / fmt.sr };
}

// ------------------------------------------------------------------------------------------ plan B
/** Graba el tramo reproduciéndolo (silenciado) desde un <audio>: vale para cualquier formato que el navegador reproduzca. */
export function captureRealtime(file, start, dur, onProgress) {
  return new Promise((resolve, reject) => {
    const ac = audioContext();
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    a.src = url; a.preload = 'auto'; a.playsInline = true;
    const L = [], R = []; let n = 0, rec = false;
    const src = ac.createMediaElementSource(a);
    const sp = ac.createScriptProcessor(4096, 2, 2);
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(sp); sp.connect(g); g.connect(ac.destination);
    const finish = (err) => {
      sp.onaudioprocess = null; a.pause(); try { src.disconnect(); sp.disconnect(); g.disconnect(); } catch {}
      URL.revokeObjectURL(url);
      if (err) return reject(err);
      n = Math.min(n, Math.round(dur * ac.sampleRate));
      const buf = ac.createBuffer(2, n, ac.sampleRate);
      let w = 0; for (let i = 0; i < L.length && w < n; i++) { const k = Math.min(L[i].length, n - w); buf.copyToChannel(L[i].subarray(0, k), 0, w); buf.copyToChannel(R[i].subarray(0, k), 1, w); w += k; }
      resolve(buf);
    };
    sp.onaudioprocess = (e) => {
      if (!rec) return;
      const ib = e.inputBuffer;
      L.push(ib.getChannelData(0).slice()); R.push((ib.numberOfChannels > 1 ? ib.getChannelData(1) : ib.getChannelData(0)).slice()); n += ib.length;
      onProgress?.(Math.min(1, n / ac.sampleRate / dur));
      if (n / ac.sampleRate >= dur || a.ended) finish();
    };
    a.onerror = () => finish(new Error('Este formato no se puede leer en este navegador'));
    a.onloadedmetadata = () => { a.currentTime = start; };
    a.onseeked = () => { if (rec) return; ac.resume().then(() => a.play()).then(() => { rec = true; }).catch((e) => finish(e)); };
  });
}

/** Recorta un AudioBuffer a [t0, t0 + dur) creando uno nuevo (el grande se libera). */
export function cutBuffer(buf, t0, dur) {
  const ac = audioContext();
  const a = Math.max(0, Math.round(t0 * buf.sampleRate)), n = Math.max(1, Math.min(buf.length - a, Math.round(dur * buf.sampleRate)));
  const out = ac.createBuffer(Math.min(2, buf.numberOfChannels), n, buf.sampleRate);
  for (let c = 0; c < out.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, a + n), c);
  return out;
}

/** WAV de 16 bits a partir de un AudioBuffer (para guardar solo el tramo en el proyecto). */
export function encodeWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const s = (o, t) => { for (let i = 0; i < 4; i++) out.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); s(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const d = []; for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) { const v = Math.max(-1, Math.min(1, d[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/**
 * Extrae [start, start + dur) de un archivo de audio sin decodificarlo entero.
 * Devuelve un AudioBuffer del tramo exacto y el método usado.
 */
export async function extractSegment(file, start, dur, onProgress) {
  const PAD = 1.0;
  const from = Math.max(0, start - PAD), until = start + dur + PAD;
  const kind = await sniff(file);
  let res = null, method = kind;
  try {
    if (kind === 'mp3') { const r = await mp3Range(file, from, until, onProgress); res = { bytes: await file.slice(r.a, r.b).arrayBuffer(), ta: r.ta }; }
    else if (kind === 'mp4') res = await mp4Range(file, from, until);
    else if (kind === 'wav') res = await wavRange(file, from, until);
  } catch (e) { console.warn('[tramo] lectura directa falló, uso la grabación en tiempo real', e); res = null; }
  if (res) {
    try {
      const dec = await decodeAudio(res.bytes);
      res.bytes = null;
      return { buffer: cutBuffer(dec, start - res.ta, dur), method };
    } catch (e) { console.warn('[tramo] no se pudo decodificar el tramo', e); }
  }
  method = 'realtime';
  return { buffer: await captureRealtime(file, start, dur, onProgress), method };
}
