// Copia las librerías de terceros a app/vendor para que la app funcione sin empaquetador
// (web, iPhone y Electron cargan los mismos módulos ES).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'app', 'vendor');
mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/three/build/three.module.js', 'three.module.js'],
  ['node_modules/three/build/three.core.js', 'three.core.js'],
  ['node_modules/mp4-muxer/build/mp4-muxer.mjs', 'mp4-muxer.mjs'],
];
let n = 0;
for (const [src, dst] of files) {
  const s = join(root, src);
  if (!existsSync(s)) { console.warn('[vendor] falta', src, '(ejecuta npm install)'); continue; }
  copyFileSync(s, join(out, dst)); n++;
}
console.log(`[vendor] ${n}/${files.length} archivos copiados a app/vendor`);
