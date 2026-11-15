# Pase «en cada golpe de batería»: para cada efecto de impacto, cambios por segundo y saltos de brillo.
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEASURE = """async ({ fx }) => {
  const app = window.neon, E = app.engine, gl = E.renderer.getContext();
  app.makeSlideshow({ every: 'hits', look: 'full', effect: 'varied', hitFx: fx, minGap: 0.25 });
  for (const ph of app.store.project.photos) await app.ensurePhoto(ph);
  const { evaluate } = await import('./js/timeline/model.js');
  const W = 144, H = 256, buf = new Uint8Array(W * H * 4), lum = [], ids = [];
  app.exporting = true; E.setCanvasSize(W, H);
  for (let t = 4; t < 12; t += 1 / 30) {
    const comp = evaluate(app.store.project, t);
    ids.push(comp.A.photos.at(-1)?.params.photoId);
    E.render({ t, comp, project: app.store.project, audioFor: app.audioFor(t), quality: app.qualityFor('export'), width: W, height: H, target: null });
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let s = 0; for (let k = 0; k < buf.length; k += 4) s += 0.2126 * buf[k] + 0.7152 * buf[k + 1] + 0.0722 * buf[k + 2];
    lum.push(s / (W * H));
  }
  app.exporting = false;
  let d1 = 0, d3 = 0; for (let i = 1; i < lum.length; i++) d1 = Math.max(d1, Math.abs(lum[i] - lum[i - 1])); for (let i = 3; i < lum.length; i++) d3 = Math.max(d3, Math.abs(lum[i] - lum[i - 3]));
  let changes = 0; for (let i = 1; i < ids.length; i++) if (ids[i] !== ids[i - 1]) changes++;
  // WCAG 2.3.1 (aprox.): un destello = par de cambios opuestos de ≥ 10 % (25/255) de brillo; límite: 3 por segundo
  const ev = []; let ref = lum[0], refI = 0;
  for (let i = 1; i < lum.length; i++) { const d = lum[i] - ref; if (Math.abs(d) >= 25) { ev.push({ i, s: Math.sign(d) }); ref = lum[i]; refI = i; } else if ((d > 0 && lum[i] > ref) || (d < 0 && lum[i] < ref)) {} if (i - refI > 6) { ref = lum[i]; refI = i; } }
  let maxFlash = 0;
  for (let a = 0; a < lum.length; a++) { const win = ev.filter((e) => e.i >= a && e.i < a + 30); let f = 0; for (let k = 1; k < win.length; k++) if (win[k].s !== win[k - 1].s) f++; maxFlash = Math.max(maxFlash, Math.ceil(f / 2)); }
  return { fx, cambiosPorSegundo: +(changes / 8).toFixed(2), destellosMaxPorSegundo: maxFlash, d1: +d1.toFixed(1), d3: +d3.toFixed(1), brillo: +(lum.reduce((a, b) => a + b) / lum.length).toFixed(1) };
}"""
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5189'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = await (await b.new_context(viewport={'width': 1300, 'height': 850}, bypass_csp=True)).new_page()
            errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
            await page.goto('http://localhost:5189/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.evaluate("async () => { const p = await (await fetch('examples/demo-neon-techno.neonverse')).json(); await window.neon.importProjectData(p); }")
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            await page.set_input_files('#file-photos', sorted(['/tmp/qa/photos/' + f for f in os.listdir('/tmp/qa/photos')]))
            await page.wait_for_function('window.neon.store.project.photos.length >= 9', timeout=30000)
            for fx in ['varied', 'punch', 'glitch', 'rgb', 'shake', 'flash', 'none']:
                r = await page.evaluate(MEASURE, {'fx': fx})
                flag = 'FALLA' if r['destellosMaxPorSegundo'] > 3 else 'ok'
                print(flag, r)
            print('errores', errs)
            await b.close()
    finally: srv.terminate()
asyncio.run(main())
