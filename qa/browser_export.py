# Exportación en el navegador (WebCodecs + mp4-muxer) con el ejemplo de música: descarga y comprueba el MP4.
import asyncio, os, subprocess, time, json, sys
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/qa/out/browser.mp4'
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5195'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            ctx = await b.new_context(bypass_csp=True, accept_downloads=True)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: print('[pageerror]', e))
            page.on('console', lambda m: print('[console]', m.text[:200]) if m.type == 'error' else None)
            await page.goto('http://localhost:5195/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.evaluate("async () => { const p = await (await fetch('examples/demo-neon-techno.neonverse')).json(); await window.neon.importProjectData(p); }")
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            caps = await page.evaluate('window.neon.exporter.capabilities()')
            print('capacidades', caps)
            async with page.expect_download(timeout=300000) as dl:
                r = await page.evaluate("window.neon.exporter.run({ width: 360, height: 640, fps: 30, codec: 'h264', quality: 'normal', audioBitrate: 192, fileName: 'prueba-navegador', range: [20, 24] })")
            d = await dl.value
            await d.save_as(OUT)
            print('resultado', {k: r[k] for k in ('path', 'size', 'frames', 'seconds', 'audio') if k in r})
            await b.close()
    finally: srv.terminate()
asyncio.run(main())
