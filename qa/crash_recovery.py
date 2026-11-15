# Anticierres: (1) cierre simulado durante la carga de música → modo seguro y «Abrir sin la música»;
# (2) proyecto antiguo con una mezcla de 70 min guardada entera → se pide el tramo en vez de decodificarla.
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5198'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            ctx = await b.new_context(bypass_csp=True, user_agent=UA, viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errs.append(str(e)))
            await page.goto('http://localhost:5198/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            # Proyecto antiguo: mezcla larga guardada entera
            await page.evaluate("""async () => { const n = window.neon; const blob = await (await fetch('examples/_qa-long.mp3')).blob();
              const id = await n.media.put(blob, 'mezcla-larga.mp3');
              const p = JSON.parse(JSON.stringify(n.store.project)); p.name = 'Proyecto viejo';
              p.audio = { mediaId: id, name: 'mezcla-larga.mp3', mime: 'audio/mpeg', duration: 4200, trimStart: 1800, trimEnd: 4200, markers: [], bpm: 120 };
              n.openProject(p); }""")
            await page.wait_for_selector('#modal:not(.hidden) .segment-picker', timeout=30000)
            lbl = await page.inner_text('.segment-picker p.hint')
            print('(2) proyecto viejo → selector de tramo:', lbl)
            await page.click('#modal button:has-text("Usar este tramo")')
            await page.wait_for_function('window.neon.store.project.audio?.source && !window.neon.analysis.synthetic', timeout=120000)
            print('    música:', await page.evaluate('window.neon.store.project.audio.name'), '·', await page.evaluate('window.neon.audioBuffer.duration'), 's')
            await page.evaluate('window.neon.autosave()'); await page.wait_for_timeout(600)
            # (1) Cierre simulado a mitad de una carga de música
            await page.evaluate("localStorage.setItem('nv-crash-op', JSON.stringify({ op: 'audio', detail: 'mezcla-larga.mp3', t: Date.now() }))")
            await page.reload()
            await page.wait_for_selector('#modal:not(.hidden)', timeout=30000)
            print('(1) tras el cierre:', (await page.inner_text('#modal')).replace('\n', ' | ')[:330])
            await page.screenshot(path='/tmp/qa/out/crash-modal.png')
            await page.click('#modal button:has-text("Abrir sin la música")')
            await page.wait_for_function('window.neon && window.neon.store.project.name === "Proyecto viejo"', timeout=30000)
            print('    abierto:', await page.evaluate('({ name: neon.store.project.name, audio: neon.store.project.audio, safe: neon.safeMode, q: neon.prefs.quality })'))
            await page.evaluate("window.neon.go('settings')"); await page.wait_for_timeout(300)
            t = await page.inner_text('#panel-body')
            print('    ajustes:', [l for l in t.split('\n') if 'Cierres detectados' in l or 'Modo seguro' in l])
            await b.close()
    finally: srv.terminate()
    print('errores de página:', errs)
asyncio.run(main())
