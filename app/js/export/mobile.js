// Utilidades de exportación para móvil (iPhone): MP4 por trozos, cabecera AAC correcta y guardado en Fotos.

export const isIOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Recoge las escrituras posicionadas del muxer (StreamTarget) en trozos y arma un Blob al final.
 * La memoria usada es el tamaño del vídeo una sola vez (sin copias dobles), importante en iPhone.
 */
export class PositionedSink {
  constructor() { this.parts = []; } // { pos, data } ordenados, sin solapes
  write(data, pos) {
    const src = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const end = pos + src.byteLength;
    // 1) sobrescribir lo que ya existe (parches de cabecera)
    const covered = [];
    for (const p of this.parts) {
      const a = Math.max(pos, p.pos), b = Math.min(end, p.pos + p.data.byteLength);
      if (a < b) { p.data.set(src.subarray(a - pos, b - pos), a - p.pos); covered.push([a, b]); }
    }
    // 2) añadir los tramos nuevos
    covered.sort((x, y) => x[0] - y[0]);
    let cur = pos;
    const fresh = [];
    for (const [a, b] of covered) { if (a > cur) fresh.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < end) fresh.push([cur, end]);
    for (const [a, b] of fresh) this.parts.push({ pos: a, data: src.slice(a - pos, b - pos) });
    if (fresh.length) this.parts.sort((x, y) => x.pos - y.pos);
  }
  toBlob(type = 'video/mp4') {
    let expect = 0;
    for (const p of this.parts) { if (p.pos !== expect) throw new Error(`MP4 incompleto (hueco en el byte ${expect})`); expect += p.data.byteLength; }
    return new Blob(this.parts.map((p) => p.data), { type });
  }
  get size() { return this.parts.reduce((n, p) => n + p.data.byteLength, 0); }
}

/** AudioSpecificConfig de AAC-LC (Safari 26 genera una cabecera incorrecta: WebKit bug 302253). */
export function aacAudioSpecificConfig(sampleRate, channels) {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const idx = rates.indexOf(sampleRate);
  if (idx >= 0) {
    const v = (2 << 11) | (idx << 7) | (channels << 3);
    return new Uint8Array([v >> 8, v & 0xff]);
  }
  // frecuencia explícita: 5 bits tipo + 4 bits (15) + 24 bits frecuencia + 4 bits canales + 3 bits
  const bits = (2n << 35n) | (15n << 31n) | (BigInt(sampleRate) << 7n) | (BigInt(channels) << 3n);
  return new Uint8Array([Number((bits >> 32n) & 0xffn), Number((bits >> 24n) & 0xffn), Number((bits >> 16n) & 0xffn), Number((bits >> 8n) & 0xffn), Number(bits & 0xffn)]);
}

/** ¿Se puede guardar en Fotos con la hoja de compartir del sistema? */
export function canShareVideo(file) {
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch { return false; }
}
/** Abre la hoja de compartir (en iPhone: «Guardar vídeo» lo guarda en la galería). Debe llamarse desde un toque. */
export async function shareVideo(file, title = 'NEONVERSE') {
  await navigator.share({ files: [file], title });
}

/** Mantiene la pantalla encendida durante la exportación (si el navegador lo permite). */
export async function keepAwake() {
  try { if ('wakeLock' in navigator) return await navigator.wakeLock.request('screen'); } catch { /* no disponible */ }
  return null;
}
