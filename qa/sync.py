# Medición de la sincronía visual con la batería: para cada visual se dibujan 10 s a 30 fps con la canción de ejemplo,
# se calcula el MOVIMIENTO (diferencia media entre fotogramas consecutivos) y se compara con los golpes de bombo reales.
#   contraste = movimiento medio en los 3 fotogramas tras cada bombo / movimiento medio del resto  (1 = no se nota el golpe)
#   retraso   = fotograma del pico de movimiento medio alrededor del bombo (0 = en el golpe)
#   salto     = mayor cambio de BRILLO medio entre fotogramas (seguridad: < 20)
import asyncio, os, subprocess, time, sys, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = """async ({ items, t0, secs }) => {
  const app = window.neon, E = app.engine, gl = E.renderer.getContext(); const W = window.__W || 108, H = window.__H || 192, N = W * H;
  const trim = app.store.project.audio?.trimStart || 0;
  const kicks = app.analysis.drumHits({ mode: 'kicks', minGap: 0.2 }).map((h) => h.t - trim).filter((t) => t > t0 + 0.3 && t < t0 + secs - 0.5);
  app.exporting = true; E.setCanvasSize(W, H);
  for (const ph of app.store.project.photos) await app.ensurePhoto(ph);
  const out = [];
  const empty = () => ({ photos: [], tunnels: [], meshes: [], equalizers: [], particles: [] });
  for (const it of items) {
    const A = empty();
    if (it.track === 'photos') A.photos = [{ id: 'sy_p', type: 'photo', params: { photoId: app.store.project.photos[0].id, effect: 'none', motion: 'none', fadeIn: 0, fadeOut: 0 }, start: 0, dur: 1e9 }];
    else A[it.track] = [{ id: 'sy_' + it.id, type: it.id, params: {}, start: 0, dur: 1e9 }];
    const comp = { A, B: null, transition: null, progress: 0, lighting: { current: null, previous: null }, effects: [] };
    let prev = null; const mot = [], lum = [];
    const buf = new Uint8Array(N * 4);
    for (let i = 0; i < secs * 30; i++) {
      const t = t0 + i / 30;
      E.render({ t, comp, project: app.store.project, audioFor: app.audioFor(t), quality: app.qualityFor('balanced'), width: W, height: H, target: null });
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // bloques de 4×4 (movimiento «a ojo»: no se satura con líneas finas que se mueven muchos píxeles)
      const BW = W / 4, BH = H / 4, g = new Float32Array(BW * BH); let L = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 4, v = 0.2126 * buf[k] + 0.7152 * buf[k + 1] + 0.0722 * buf[k + 2]; g[(y >> 2) * BW + (x >> 2)] += v / 16; L += v; }
      lum.push(L / N);
      if (prev) { let d = 0; for (let j = 0; j < g.length; j++) d += Math.abs(g[j] - prev[j]); mot.push(d / g.length); } else mot.push(0);
      prev = g;
    }
    E.slots.forEach((s) => s.clear());
    const fr = kicks.map((t) => Math.round((t - t0) * 30));
    const near = new Set(); for (const f of fr) for (let k = 1; k <= 3; k++) near.add(f + k);
    let a = 0, na = 0, b = 0, nb = 0; for (let i = 2; i < mot.length; i++) { if (near.has(i)) { a += mot[i]; na++; } else { b += mot[i]; nb++; } }
    const prof = []; for (let o = -6; o <= 12; o++) { let s = 0, n = 0; for (const f of fr) if (mot[f + o] !== undefined) { s += mot[f + o]; n++; } prof.push(s / Math.max(1, n)); }
    let best = 0; for (let o = 0; o < prof.length; o++) if (prof[o] > prof[best]) best = o;
    let jump = 0; for (let i = 1; i < lum.length; i++) jump = Math.max(jump, Math.abs(lum[i] - lum[i - 1]));
    out.push({ track: it.track, id: it.id, contrast: +((a / na) / (b / nb)).toFixed(2), lag: best - 6, motion: +(b / nb).toFixed(2), jump: +jump.toFixed(1) });
  }
  app.exporting = false;
  return { kicks: kicks.length, out };
}"""
ITEMS = [('tunnels', x) for x in ['rings', 'hexagons', 'spiral', 'cubes', 'laser', 'plasma', 'particles', 'portals', 'metal']] + \
        [('equalizers', x) for x in ['reactor', 'pulsar', 'vortex', 'matrix']] + \
        [('meshes', x) for x in ['wavy', 'holographic', 'neural', 'electric', 'wavesurface', 'geometric']] + \
        [('particles', x) for x in ['stardust', 'orbit', 'sparks']] + [('photos', 'foto')]
async def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    items = [{'track': t, 'id': i} for t, i in ITEMS if not only or only in (t, i)]
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5184'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = await (await b.new_context(viewport={'width': 1200, 'height': 800}, bypass_csp=True)).new_page()
            page.on('pageerror', lambda e: print('[pageerror]', e))
            await page.goto('http://localhost:5184/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.evaluate("async () => { const p = await (await fetch('examples/demo-neon-techno.neonverse')).json(); await window.neon.importProjectData(p); }")
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            if os.environ.get('RES'): w, h = os.environ['RES'].split('x'); await page.evaluate(f'window.__W = {w}; window.__H = {h}')
            r = await page.evaluate(JS, {'items': items, 't0': 4.0, 'secs': 10})
            print(f"bombos en la ventana: {r['kicks']}")
            print(f"{'visual':26}{'contraste':>10}{'retraso':>9}{'movim.':>8}{'salto':>7}")
            for x in r['out']:
                print(f"{x['track'] + '/' + x['id']:26}{x['contrast']:>10}{x['lag']:>9}{x['motion']:>8}{x['jump']:>7}")
            json.dump(r['out'], open('/tmp/qa/sync-last.json', 'w'))
            await b.close()
    finally: srv.terminate()
asyncio.run(main())
