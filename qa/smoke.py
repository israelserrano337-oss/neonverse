# Prueba de humo en Chrome real (sin pantalla): arranca la app, recorre las 14 secciones,
# carga música y fotos sintéticas, ejecuta el Auto Director y comprueba que no hay errores.
import asyncio, sys, os, subprocess, time, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get('QA_OUT', '/tmp/qa')
os.makedirs(OUT, exist_ok=True)

async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5199'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    time.sleep(0.8)
    errors = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
            ctx = await b.new_context(viewport={'width': 1500, 'height': 920}, bypass_csp=True)
            page = await ctx.new_page()
            page.on('console', lambda m: (errors.append(m.text) if m.type == 'error' else None, print('[console]', m.type, m.text[:300]) if m.type in ('error', 'warning') else None))
            page.on('pageerror', lambda e: (errors.append(str(e)), print('[pageerror]', e)))
            await page.goto('http://localhost:5199/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.wait_for_timeout(1500)
            await page.screenshot(path=f'{OUT}/01-home.png')
            # música y fotos sintéticas
            await page.set_input_files('#file-audio', os.environ.get('QA_AUDIO', '/tmp/qa/test.wav'))
            await page.wait_for_function('window.neon.store.project.audio && !window.neon.analysis.synthetic', timeout=60000)
            photos = sorted([os.path.join('/tmp/qa/photos', f) for f in os.listdir('/tmp/qa/photos')])
            await page.set_input_files('#file-photos', photos)
            await page.wait_for_function(f'window.neon.store.project.photos.length >= {len(photos)}', timeout=30000)
            info = await page.evaluate('({bpm: window.neon.analysis.bpm, sections: window.neon.analysis.sections.map(s => s.type), photos: window.neon.store.project.photos.length})')
            print('análisis', info)
            # recorrer secciones
            ids = await page.evaluate('[...document.querySelectorAll(".nav-btn")].map(b => b.dataset.section)')
            for i, sid in enumerate(ids):
                await page.click(f'.nav-btn[data-section="{sid}"]')
                await page.wait_for_timeout(900)
                await page.screenshot(path=f'{OUT}/s{i:02d}-{sid}.png')
            # Auto Director
            await page.click('.nav-btn[data-section="director"]')
            await page.wait_for_timeout(300)
            await page.click('text=GENERAR VÍDEO')
            await page.wait_for_timeout(1500)
            summ = await page.evaluate('({scenes: window.neon.store.project.director.scenes.length, clips: Object.values(window.neon.store.project.timeline.tracks).reduce((n,t)=>n+t.length,0)})')
            print('director', summ)
            for k, t in enumerate([2.0, 9.5, 17.0, 26.0]):
                await page.evaluate(f'window.neon.player.seek({t})')
                await page.wait_for_timeout(700)
                await page.screenshot(path=f'{OUT}/g{k}-t{t}.png')
            # reproducir un poco
            await page.click('#btn-play'); await page.wait_for_timeout(2500); await page.click('#btn-play')
            fps = await page.evaluate('document.getElementById("hud-fps").textContent')
            print('fps', fps)
            # deshacer / rehacer
            r = await page.evaluate('(() => { const s = window.neon.store; const n = s.undoStack.length; s.undo(); const a = s.undoStack.length; s.redo(); return [n, a, s.undoStack.length]; })()')
            print('undo/redo', r)
            await b.close()
    finally:
        srv.terminate()
    print('ERRORES:', len(errors))
    for e in errors[:30]: print(' -', e[:400])
    return 1 if errors else 0

sys.exit(asyncio.run(main()))
