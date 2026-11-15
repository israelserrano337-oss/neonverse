// Utilidades puras y deterministas compartidas por todos los módulos.

/** PRNG mulberry32: misma semilla ⇒ misma secuencia (Auto Director reproducible). */
export function createRNG(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
    chance: (p) => next() < p,
    /** Elección ponderada: items = [{value, weight}] */
    weighted(items) {
      let total = 0;
      for (const it of items) total += Math.max(0, it.weight);
      if (total <= 0) return items[0]?.value;
      let r = next() * total;
      for (const it of items) { r -= Math.max(0, it.weight); if (r <= 0) return it.value; }
      return items[items.length - 1].value;
    },
    fork: (salt) => createRNG(hashInt((a ^ hashInt(salt)) >>> 0)),
  };
}

/** Hash entero → entero (determinista). */
export function hashInt(x) {
  if (typeof x === 'string') { let h = 2166136261; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } x = h; }
  x = (x | 0) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
/** Hash a [0,1) a partir de un número (también con decimales). */
export function hash01(n) { return hashInt(Math.floor(n * 1000003) ^ Math.floor(n)) / 4294967296; }

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, k) => a + (b - a) * k;
export const smoothstep = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
export const fract = (x) => x - Math.floor(x);
export const mod = (x, m) => ((x % m) + m) % m;
/** Campana suave sen² de 0 a 1 a 0 (para pulsos seguros). */
export const bell = (k) => (k <= 0 || k >= 1 ? 0 : Math.sin(Math.PI * k) ** 2);

let _uid = 0;
/** Identificador único para objetos creados por el usuario (no afecta al render). */
export function uid(prefix = 'id') {
  _uid = (_uid + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${_uid.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export function formatTime(s, withMs = false) {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60), sec = s - m * 60;
  return withMs ? `${m}:${sec.toFixed(2).padStart(5, '0')}` : `${m}:${Math.floor(sec).toString().padStart(2, '0')}`;
}

export function debounce(fn, ms) {
  let id = 0;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

/** Valores por defecto de un esquema de parámetros. */
export function schemaDefaults(schema) {
  const o = {};
  for (const p of schema) o[p.key] = Array.isArray(p.value) ? [...p.value] : p.value;
  return o;
}
/** Rellena parámetros que falten con los del esquema. */
export function withDefaults(schema, params = {}) {
  const o = schemaDefaults(schema);
  for (const k in params) if (params[k] !== undefined) o[k] = params[k];
  return o;
}
/** Clave estructural: cambia solo si cambian parámetros marcados con rebuild. */
export function rebuildKey(type, schema, params) {
  let k = type;
  for (const p of schema) if (p.rebuild) k += '|' + params[p.key];
  return k;
}
