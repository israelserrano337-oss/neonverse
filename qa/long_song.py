# Canciones largas (70 min) en modo iPhone: selector de tramo, lectura parcial y precisión del corte.
import asyncio, os, subprocess, time, sys
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = sys.argv[1:] or ['/tmp/long/mix-cbr.mp3', '/tmp/long/mix-vbr.mp3', '/tmp/long/mix.m4a', '/tmp/long/mix25.wav']
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
START = 3005
BEEPS = """() => { const b = window.neon.audioBuffer, d = b.getChannelData(0), sr = b.sampleRate, out = []; let last = -1e9;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.3) { if (i - last > sr) out.push(+(i / sr).toFixed(3)); last = i; }
  return { dur: +b.duration.toFixed(3), beeps: out, src: window.neon.store.project.audio.source, name: window.neon.store.project.audio.name, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 }; }"""
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5197'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    ok = True
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'])
            for f in FILES:
                ctx = await b.new_context(bypass_csp=True, user_agent=UA, viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                page = await ctx.new_page()
                logs = []
                page.on('console', lambda m: logs.append(m.text) if '[tramo]' in m.text or m.type == 'error' else None)
                page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
                await page.goto('http://localhost:5197/index.html')
                await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
                t0 = time.time()
                await page.set_input_files('#file-audio', f)
                await page.wait_for_selector('#modal:not(.hidden) .segment-picker', timeout=30000)
                if f == FILES[0]: await page.screenshot(path='/tmp/qa/out/picker-iphone.png')
                await page.evaluate(f"() => {{ const r = document.querySelector('.segment-picker input[type=range]'); r.value = {START if 'mix25' not in f else 1205}; r.dispatchEvent(new Event('input')); }}")
                D = 15 if f.endswith('.ogg') else 60
                await page.select_option('.segment-picker select', str(D))
                await page.evaluate(f"() => {{ const r = document.querySelector('.segment-picker input[type=range]'); r.value = {START if 'mix25' not in f else 1205}; r.dispatchEvent(new Event('input')); }}")
                await page.click('#modal button:has-text("Usar este tramo")')
                await page.wait_for_function('window.neon.store.project.audio && window.neon.store.project.audio.source && !window.neon.analysis.synthetic', timeout=240000)
                r = await page.evaluate(BEEPS)
                exp = [5 + 10 * k for k in range(D // 10)]  # los pitidos están cada 10 s; el tramo empieza en ...05
                err = max(abs(a - e) for a, e in zip(r['beeps'], exp)) if len(r['beeps']) >= D // 10 else 99
                good = err < (0.15 if f.endswith('.ogg') else 0.03) and abs(r['dur'] - D) < 0.1
                ok &= good
                print(r['beeps'][:3]); print(f"{os.path.basename(f):14s} {'OK ' if good else 'MAL'} {time.time()-t0:5.1f} s · dur {r['dur']} · error máx {err*1000:.0f} ms · heap {r['heap']} MB · {r['name']} · {[l for l in logs][:3]}")
                await ctx.close()
            await b.close()
    finally: srv.terminate()
    print('TODO OK' if ok else 'FALLOS')
asyncio.run(main())
