# Barrido de seguridad fotosensible: dibuja cada tipo por separado con la música de ejemplo
# y mide el salto de brillo medio por fotograma (0-255). Límites: <20 por fotograma, <25 en 3.
import asyncio, os, sys, subprocess, time, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JS = """async (spec) => {
  const app = window.neon, E = app.engine, project = app.store.project;
  const gl = E.renderer.getContext();
  const W = 144, H = 256, buf = new Uint8Array(W * H * 4);
  const out = [];
  const empty = () => ({ photos: [], tunnels: [], meshes: [], particles: [] });
  for (const it of spec.items) {
    const A = empty();
    let comp = { A, B: null, transition: null, progress: 0, lighting: { current: null, previous: null }, effects: [] };
    if (it.track === 'transitions') { A.tunnels = [{ id: 'qa_a', type: 'rings', params: {}, start: 0, dur: 1e9 }]; comp.B = empty(); comp.B.tunnels = [{ id: 'qa_b', type: 'plasma', params: {}, start: 0, dur: 1e9 }]; }
    else if (it.track === 'effects') { A.tunnels = [{ id: 'qa_a', type: 'rings', params: {}, start: 0, dur: 1e9 }]; comp.effects = [{ type: it.id, params: it.params || {}, start: 0, dur: 1e9 }]; }
    else if (it.track === 'photos') { A.photos = [{ id: 'qa_p_' + it.id, type: 'photo', params: { photoId: project.photos[0].id, effect: it.id, effectAmount: 0.8, motion: 'in' }, start: spec.t0 - 0.5, dur: spec.frames / 30 + 1 }]; }
    else A[it.track] = [{ id: 'qa_' + it.id, type: it.type || it.id, params: it.params || {}, start: 0, dur: 1e9 }];
    const lum = [];
    for (let i = 0; i < spec.frames; i++) {
      const t = spec.t0 + i / 30;
      if (it.track === 'transitions') { comp.transition = { type: it.id, params: {}, start: spec.t0, dur: 0.8 }; comp.progress = Math.min(1, Math.max(0, (t - spec.t0 - 0.5) / 0.8)); }
      E.render({ t, comp, project, audioFor: app.audioFor(t), quality: app.qualityFor('export'), width: W, height: H, target: null });
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let s = 0; for (let k = 0; k < buf.length; k += 4) s += 0.2126 * buf[k] + 0.7152 * buf[k + 1] + 0.0722 * buf[k + 2];
      lum.push(s / (W * H));
    }
    let d1 = 0, d3 = 0, at = 0;
    for (let i = 1; i < lum.length; i++) { const d = Math.abs(lum[i] - lum[i - 1]); if (d > d1) { d1 = d; at = i; } }
    for (let i = 3; i < lum.length; i++) d3 = Math.max(d3, Math.abs(lum[i] - lum[i - 3]));
    out.push({ track: it.track, id: it.id, d1: +d1.toFixed(1), d3: +d3.toFixed(1), at: +(spec.t0 + at / 30).toFixed(2), mean: +(lum.reduce((a, b) => a + b, 0) / lum.length).toFixed(1) });
    E.slots.forEach((s) => s.clear());
  }
  return out;
}"""

async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5198'], stdout=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = await (await b.new_context(viewport={'width': 1200, 'height': 800}, bypass_csp=True)).new_page()
            page.on('pageerror', lambda e: print('[pageerror]', e))
            await page.goto('http://localhost:5198/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.evaluate("async () => { const p = await (await fetch('examples/demo-neon-techno.neonverse')).json(); await window.neon.importProjectData(p); window.neon.exporting = true; }")
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            await page.wait_for_timeout(1500)
            items = await page.evaluate("""async () => {
              const eq = await import('./js/studios/equalizers.js');
              const m = await import('./js/studios/tunnels.js'), me = await import('./js/studios/meshes.js'), pa = await import('./js/studios/particles.js'), tr = await import('./js/studios/transitions.js'), ef = await import('./js/studios/effects.js'), ph = await import('./js/studios/photos.js');
              return [...eq.EQUALIZERS.map(x => ({track: 'equalizers', id: x.id})), ...eq.EQUALIZERS.map(x => ({track: 'equalizers', id: x.id + '·intenso', type: x.id, params: {react: 2, speed: 3, height: 2.5, colorMode: 0}})), ...m.TUNNELS.map(x => ({track: 'tunnels', id: x.id})), ...m.TUNNELS.map(x => ({track: 'tunnels', id: x.id + '·rápido', type: x.id, params: {speed: 2.4, react: 1.6, glow: 1.5, camera: 0.8}})), ...me.MESHES.map(x => ({track: 'meshes', id: x.id})), ...pa.PARTICLES.map(x => ({track: 'particles', id: x.id})),
                ...tr.TRANSITIONS.map(x => ({track: 'transitions', id: x.id})), ...ef.EFFECTS.filter(x => x.id !== 'filter').map(x => ({track: 'effects', id: x.id, params: {amount: 0.8, sync: 'beat'}})),
                ...ph.PHOTO_FX.map(([id]) => ({track: 'photos', id}))];
            }""")
            only = sys.argv[1] if len(sys.argv) > 1 else None
            if only: items = [i for i in items if i['track'] == only or i['id'] == only]
            res = await page.evaluate(JS, {'items': items, 't0': 8.0, 'frames': 75})
            bad = 0
            for r in res:
                flag = 'FALLA' if r['d1'] >= 20 or r['d3'] >= 25 else 'ok'
                bad += flag != 'ok'
                print(f"{flag:5} {r['track']:12} {r['id']:14} salto1={r['d1']:5} salto3={r['d3']:5} (t={r['at']}) brillo={r['mean']}")
            print(f'\n{len(res) - bad}/{len(res)} dentro de los límites')
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
