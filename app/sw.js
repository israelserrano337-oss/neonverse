// Generado por scripts/build-web.mjs — NEONVERSE AI 2.0 sin conexión
const CACHE = 'neonverse-09fcd8fc04e4';
const PRECACHE = ["./","assets/brand/apple-touch-icon.png","assets/brand/favicon-32.png","assets/brand/favicon-64.png","assets/brand/favicon.ico","assets/brand/icon-1024.png","assets/brand/icon-512.png","assets/brand/icon-installer-512.png","assets/brand/icon-installer.svg","assets/brand/icon-mono-black.svg","assets/brand/icon-mono-white-512.png","assets/brand/icon-mono-white.svg","assets/brand/icon-simple.svg","assets/brand/icon-symbol-1024.png","assets/brand/icon-symbol.svg","assets/brand/icon.svg","assets/brand/logo-horizontal-dark.png","assets/brand/logo-horizontal-dark.svg","assets/brand/logo-horizontal.png","assets/brand/logo-horizontal.svg","assets/brand/logo-vertical.png","assets/brand/logo-vertical.svg","css/neonverse.css","examples/index.json","index.html","js/audio/analysis-core.js","js/audio/analysis-worker.js","js/audio/analysis.js","js/audio/loader.js","js/audio/player.js","js/audio/segment.js","js/beatsync/BeatSync.js","js/core/crashguard.js","js/core/media.js","js/core/store.js","js/core/util.js","js/director/AutoDirector.js","js/director/profiles.js","js/engine/Engine.js","js/engine/glsl.js","js/engine/materials.js","js/export/Exporter.js","js/export/mobile.js","js/main.js","js/studios/effects.js","js/studios/equalizers.js","js/studios/meshes.js","js/studios/palettes.js","js/studios/particles.js","js/studios/photos.js","js/studios/transitions.js","js/studios/tunnels.js","js/timeline/TimelineView.js","js/timeline/model.js","js/timeline/slideshow.js","js/ui/controls.js","js/ui/sections-a.js","js/ui/sections-b.js","js/ui/sections.js","manifest.webmanifest","vendor/mp4-muxer.mjs","vendor/three.core.js","vendor/three.module.js"];
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
