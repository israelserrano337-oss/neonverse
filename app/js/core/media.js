// Medios del proyecto (música y fotografías): memoria + IndexedDB para conservarlos entre sesiones.
import { uid } from './util.js';

const DB_NAME = 'neonverse-media';
const DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      if (!db.objectStoreNames.contains('library')) db.createObjectStore('library');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { console.warn('IndexedDB no disponible', req.error); resolve(null); };
  });
}
function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(undefined);
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((r) => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class MediaStore {
  constructor() {
    this.items = new Map(); // id -> { id, name, type, blob }
    this.images = new Map(); // `${id}@${max}` -> { canvas, w, h, luma }
    this.dbp = openDB();
  }
  async put(fileOrBlob, name) {
    const id = uid('m');
    const item = { id, name: name || fileOrBlob.name || id, type: fileOrBlob.type || '', blob: fileOrBlob };
    this.items.set(id, item);
    const db = await this.dbp;
    try { await tx(db, 'media', 'readwrite', (s) => s.put({ name: item.name, type: item.type, blob: item.blob }, id)); } catch (e) { console.warn('No se pudo guardar el medio', e); }
    return id;
  }
  async get(id) {
    if (this.items.has(id)) return this.items.get(id);
    const db = await this.dbp;
    const rec = await tx(db, 'media', 'readonly', (s) => reqP(s.get(id)));
    if (!rec) return null;
    const item = { id, name: rec.name, type: rec.type, blob: rec.blob };
    this.items.set(id, item);
    return item;
  }
  async arrayBuffer(id) { const it = await this.get(id); return it ? it.blob.arrayBuffer() : null; }
  async remove(id) {
    this.items.delete(id);
    for (const k of [...this.images.keys()]) if (k.startsWith(id + '@')) this.images.delete(k);
    const db = await this.dbp;
    try { await tx(db, 'media', 'readwrite', (s) => s.delete(id)); } catch {}
  }

  /** Imagen decodificada una sola vez y reducida a `max` píxeles de lado (texturas ligeras). */
  async image(id, max = 2048) {
    const key = `${id}@${max}`;
    if (this.images.has(key)) return this.images.get(key);
    const it = await this.get(id);
    if (!it) return null;
    const bmp = await decodeImage(it.blob);
    const srcW = bmp.width, srcH = bmp.height;
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const luma = measureLuma(canvas);
    const out = { canvas, w, h, luma, srcW, srcH };
    this.images.set(key, out);
    return out;
  }
  /** Libera texturas de un tamaño distinto (cambio de modo de rendimiento). */
  trimImages(keepMax) { for (const k of [...this.images.keys()]) if (!k.endsWith('@' + keepMax) && !k.endsWith('@256')) this.images.delete(k); }

  // ---- biblioteca (proyectos, composiciones, paletas) ----
  async libPut(key, value) { const db = await this.dbp; if (!db) { localStorage.setItem('nv-lib-' + key, JSON.stringify(value)); return; } await tx(db, 'library', 'readwrite', (s) => s.put(value, key)); }
  async libGet(key) { const db = await this.dbp; if (!db) { const v = localStorage.getItem('nv-lib-' + key); return v ? JSON.parse(v) : null; } return tx(db, 'library', 'readonly', (s) => reqP(s.get(key))); }
  async libDelete(key) { const db = await this.dbp; if (!db) { localStorage.removeItem('nv-lib-' + key); return; } await tx(db, 'library', 'readwrite', (s) => s.delete(key)); }
  async libKeys() {
    const db = await this.dbp;
    if (!db) return Object.keys(localStorage).filter((k) => k.startsWith('nv-lib-')).map((k) => k.slice(7));
    return tx(db, 'library', 'readonly', (s) => reqP(s.getAllKeys()));
  }

  // ---- empaquetado para intercambio (iPhone ⇄ PC) ----
  async toDataURL(id) {
    const it = await this.get(id);
    if (!it) return null;
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(it.blob); });
  }
  async fromDataURL(dataUrl, name, id) {
    const blob = await (await fetch(dataUrl)).blob();
    const nid = id || uid('m');
    const item = { id: nid, name, type: blob.type, blob };
    this.items.set(nid, item);
    const db = await this.dbp;
    try { await tx(db, 'media', 'readwrite', (s) => s.put({ name, type: blob.type, blob }, nid)); } catch {}
    return nid;
  }
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* Safari antiguo */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/** Luminancia media perceptual (0..1) para igualar el brillo de las fotos. */
export function measureLuma(canvas) {
  const c = document.createElement('canvas');
  c.width = 48; c.height = 48;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(canvas, 0, 0, 48, 48);
  const d = x.getImageData(0, 0, 48, 48).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return s / (d.length / 4);
}
