# Diseño adaptable: emula un iPhone 15 (393×852, táctil) y captura las secciones principales.
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5194'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            dev = p.devices['iPhone 15'] if 'iPhone 15' in p.devices else p.devices['iPhone 14']
            ctx = await b.new_context(**{k: v for k, v in dev.items() if k != 'default_browser_type'}, bypass_csp=True)
            page = await ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            await page.goto('http://localhost:5194/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.evaluate("async () => { const p = await (await fetch('examples/demo-neon-techno.neonverse')).json(); await window.neon.importProjectData(p); }")
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            await page.evaluate('window.neon.player.seek(9)')
            for sid in ['home', 'director', 'photos', 'timeline', 'export']:
                await page.tap(f'.nav-btn[data-section="{sid}"]')
                await page.wait_for_timeout(1200)
                await page.screenshot(path=f'/tmp/qa/iphone-{sid}.png')
            ov = await page.evaluate('[document.documentElement.scrollWidth, window.innerWidth, window.neon.prefs.quality, document.querySelector("#nav").getBoundingClientRect().bottom, window.innerHeight]')
            print('ancho contenido/ventana, calidad, nav abajo/alto:', ov, 'errores:', errs)
            await b.close()
    finally: srv.terminate()
asyncio.run(main())
