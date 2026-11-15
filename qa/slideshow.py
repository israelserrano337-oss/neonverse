# Flujo real: cargar música → cargar fotos → debe crearse el pase al ritmo, la foto debe cambiar en los golpes,
# y el pase (incluso «cada golpe») debe quedar dentro de los límites de brillo.
import asyncio, os, subprocess, time, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEASURE = """async ({ every }) => {
  const app = window.neon, E = app.engine, gl = E.renderer.getContext();
  app.makeSlideshow({ every, look: 'full', effect: 'varied' });
  await new Promise(r => setTimeout(r, 300));
  const { evaluate } = await import('./js/timeline/model.js');
  const W = 144, H = 256, buf = new Uint8Array(W * H * 4), lum = [], ids = [];
  app.exporting = true;
  for (let t = 1; t < 9; t += 1 / 30) {
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
  return { every, changes, d1: +d1.toFixed(1), d3: +d3.toFixed(1), mean: +(lum.reduce((a, b) => a + b) / lum.length).toFixed(1) };
}"""
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5192'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = await (await b.new_context(viewport={'width': 1400, 'height': 900}, bypass_csp=True)).new_page()
            errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
            await page.goto('http://localhost:5192/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.set_input_files('#file-audio', '/tmp/qa/test.wav')
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            await page.click('.nav-btn[data-section="photos"]')
            await page.set_input_files('#file-photos', sorted(['/tmp/qa/photos/' + f for f in os.listdir('/tmp/qa/photos')]))
            await page.wait_for_function('window.neon.store.project.timeline.tracks.photos.length > 0', timeout=30000)
            st = await page.evaluate('({view: window.neon.view.mode, clips: window.neon.store.project.timeline.tracks.photos.length, toast: document.getElementById("toast").textContent})')
            print('tras cargar fotos:', st)
            await page.wait_for_timeout(800)
            await page.click('.nav-btn[data-section="photos"]'); await page.wait_for_timeout(600)
            for i, t in enumerate([3.0, 4.9, 6.8]):
                await page.evaluate(f'window.neon.player.seek({t})'); await page.wait_for_timeout(700)
                await page.screenshot(path=f'/tmp/qa/slide-{i}.png')
            for every in [1, 2, 4]:
                print('medición', await page.evaluate(MEASURE, {'every': every}))
            print('errores', errs)
            await b.close()
    finally: srv.terminate()
asyncio.run(main())
