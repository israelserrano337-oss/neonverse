# v2.6.0: exportar SIN fotos (solo capas de estudios: túneles + mallas + ecualizadores) y elección al iniciar.
import asyncio, os, subprocess, time, sys, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = '/tmp/qa/out/sin-fotos.mp4'
SETUP = """async () => {
  const n = window.neon;
  const p = await (await fetch('examples/demo-neon-techno.neonverse')).json();
  await n.importProjectData(p);
  n.store.commit('qa', (pp) => {
    for (const k of ['tunnels','meshes','equalizers','particles','photos']) pp.timeline.tracks[k] = [];
    pp.photos = []; pp.beatSync.enabled = false;
    pp.studio.tunnels = [{ id: 'qt', type: 'hexgrid', params: {} }];
    pp.studio.meshes = [{ id: 'qm', type: 'lattice', params: {} }];
    pp.studio.equalizers = [{ id: 'qe', type: 'reactor', params: {} }];
    pp.studio.particles = [];
  });
}"""
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5196'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            ctx = await b.new_context(bypass_csp=True, accept_downloads=True, viewport={'width': 1280, 'height': 800})
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errs.append(str(e)))
            await page.goto('http://localhost:5196/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.evaluate(SETUP)
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            # El panel Exportar debe describir el contenido
            await page.evaluate("window.neon.go('export')"); await page.wait_for_timeout(400)
            txt = await page.inner_text('#panel-body')
            line = [l for l in txt.split('\n') if 'Capas de los estudios' in l]
            print('panel exportar:', line[:1])
            await page.screenshot(path='/tmp/qa/out/export-panel.png')
            async with page.expect_download(timeout=300000) as dl:
                r = await page.evaluate("window.neon.exporter.run({ width: 360, height: 640, fps: 30, codec: 'h264', quality: 'normal', audioBitrate: 192, fileName: 'sin-fotos', range: [20, 24] })")
            await (await dl.value).save_as(OUT)
            print('export', {k: r[k] for k in ('size', 'frames') if k in r})
            # Autoguardar y recargar: debe preguntar
            await page.evaluate('window.neon.autosave()'); await page.wait_for_timeout(500)
            await page.reload(); await page.wait_for_selector('#modal:not(.hidden)', timeout=30000)
            print('modal al iniciar:', (await page.inner_text('#modal')).replace('\n', ' | ')[:200])
            await page.screenshot(path='/tmp/qa/out/startup-modal.png')
            await page.click('#modal button:has-text("Empezar proyecto nuevo")'); await page.wait_for_timeout(800)
            st = await page.evaluate('({ audio: !!window.neon.store.project.audio, name: window.neon.store.project.name, eq: window.neon.store.project.studio.equalizers.length })')
            print('tras «nuevo»:', st)
            await page.reload(); await page.wait_for_function('window.neon && window.neon.engine', timeout=30000); await page.wait_for_timeout(1500)
            vis = await page.evaluate("!document.getElementById('modal').classList.contains('hidden')")
            print('modal tras empezar nuevo (debe ser False):', vis)
            await b.close()
    finally: srv.terminate()
    print('errores de página:', errs)
asyncio.run(main())
