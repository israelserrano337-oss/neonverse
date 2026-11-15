# Versión iPhone: diseño (iPhone 15), exportación con la ruta de iOS (MP4 por trozos, archivo para «Guardar en Fotos»)
# y modo sin conexión (service worker). Chrome emulando el iPhone: no sustituye a una prueba en Safari real.
import asyncio, os, subprocess, time, base64, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = '/tmp/qa/ios'; os.makedirs(OUT, exist_ok=True)
async def main():
    subprocess.run(['node', os.path.join(ROOT, 'scripts/build-web.mjs')], check=True, stdout=subprocess.DEVNULL)
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5191'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            dev = dict(p.devices['iPhone 15'] if 'iPhone 15' in p.devices else p.devices['iPhone 14']); dev.pop('default_browser_type', None)
            ctx = await b.new_context(**dev, bypass_csp=True)
            page = await ctx.new_page()
            errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            await page.goto('http://localhost:5191/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.set_input_files('#file-audio', '/tmp/qa/test.wav')
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            await page.set_input_files('#file-photos', sorted(['/tmp/qa/photos/' + f for f in os.listdir('/tmp/qa/photos')]))
            await page.wait_for_function('window.neon.store.project.timeline.tracks.photos.length > 0', timeout=30000)
            await page.evaluate('window.neon.runDirector({ label: "Generar" })')
            await page.evaluate('window.neon.player.seek(8)')
            for sid in ['home', 'director', 'photos', 'timeline', 'export']:
                await page.tap(f'.nav-btn[data-section="{sid}"]'); await page.wait_for_timeout(1000)
                await page.screenshot(path=f'{OUT}/{sid}.png')
            lay = await page.evaluate('''() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { scrollW: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight, stage: Math.round(r('#stage').height), panelTop: Math.round(r('#panel').top), panelH: Math.round(r('#panel').height), navTop: Math.round(r('#nav').top), inputFont: getComputedStyle(document.querySelector('select')).fontSize, ios: (await import('./js/export/mobile.js')).isIOS() }; }''') if False else None
            lay = await page.evaluate('''async () => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const m = await import('./js/export/mobile.js'); return { scrollW: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight, stage: Math.round(r('#stage').height), panelTop: Math.round(r('#panel').top), panelH: Math.round(r('#panel').height), navTop: Math.round(r('#nav').top), selectFont: getComputedStyle(document.querySelector('#panel select')).fontSize, ios: m.isIOS() }; }''')
            print('diseño', lay)
            # Exportación con la ruta de iOS (sin descarga automática; archivo en memoria por trozos)
            r = await page.evaluate('''async () => { const r = await window.neon.exporter.run({ width: 360, height: 640, fps: 30, codec: 'h264', quality: 'normal', audioBitrate: 192, fileName: 'ios-prueba', range: [4, 8] });
              const buf = new Uint8Array(await r.file.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
              return { size: r.size, share: r.share, audio: r.audio, noAudio: r.noAudioReason, name: r.file.name, type: r.file.type, b64: btoa(s) }; }''')
            open(f'{OUT}/ios-prueba.mp4', 'wb').write(base64.b64decode(r.pop('b64')))
            print('exportación', r)
            await page.wait_for_timeout(800)
            await page.screenshot(path=f'{OUT}/export-done.png')
            await ctx.close()
            # Sin conexión: registrar el service worker, cortar la red y recargar
            ctx2 = await b.new_context(**dev, bypass_csp=True)
            pg = await ctx2.new_page()
            await pg.goto('http://localhost:5191/index.html')
            await pg.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await pg.evaluate("navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready)")
            await pg.wait_for_timeout(4000)
            await pg.reload(); await pg.wait_for_function('navigator.serviceWorker.controller', timeout=20000)
            await ctx2.set_offline(True)
            await pg.reload()
            ok = await pg.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            print('sin conexión: la app arranca =', bool(ok))
            await b.close()
            print('errores', [e for e in errs if 'favicon' not in e][:10])
    finally: srv.terminate()
asyncio.run(main())
