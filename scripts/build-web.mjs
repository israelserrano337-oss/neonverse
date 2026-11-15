// Prepara la versión web para GitHub Pages (o cualquier hosting HTTPS):
//  - genera app/sw.js con la lista de archivos (funciona sin conexión tras la primera visita)
//  - copia app/ a dist-web/ con .nojekyll, lista para subir a la raíz de un repositorio.
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'app');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(app).map((p) => relative(app, p).split('\\').join('/')).filter((f) => f !== 'sw.js').sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(app, f)));
const version = hash.digest('hex').slice(0, 12);
// Precarga: todo menos los proyectos de ejemplo grandes (se guardan al abrirlos)
const precache = ['./', ...files.filter((f) => !f.endsWith('.neonverse'))];
writeFileSync(join(app, 'sw.js'), `// Generado por scripts/build-web.mjs — NEONVERSE AI 2.0 sin conexión
const CACHE = 'neonverse-${version}';
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('neonverse-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') c.put(req, res.clone());
    return res;
  }).catch(() => caches.match('./index.html')));
});
`);
const out = join(root, 'dist-web');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(app, out, { recursive: true });
writeFileSync(join(out, '.nojekyll'), '');
writeFileSync(join(out, 'README.md'), '# NEONVERSE AI 2.0 (web)\n\nVersión web para iPhone y navegador. Publicada con GitHub Pages desde la raíz de este repositorio.\n');
const n = walk(out).length;
const mb = walk(out).reduce((s, p) => s + statSync(p).size, 0) / 1e6;
console.log(`[web] versión ${version} · ${n} archivos · ${mb.toFixed(1)} MB en dist-web/`);
