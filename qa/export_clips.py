# Exportador: duraciones 15/30/45/60 s desde la interfaz (navegador) y medición del MP4:
# duración exacta, fotogramas, fundido final del audio y sincronía del movimiento con los bombos.
import asyncio, os, subprocess, time, json, sys
import numpy as np
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def probe(path):
    j = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,duration,nb_frames', '-of', 'json', path], capture_output=True, text=True).stdout)
    return {s['codec_type']: s for s in j['streams']}
def audio_tail(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '8000', '-'], capture_output=True).stdout
    a = np.frombuffer(raw, np.float32); rms = lambda x: float(np.sqrt(np.mean(x * x)) + 1e-9)
    return rms(a[-int(0.15 * 8000):]) / rms(a[-int(3 * 8000):-int(1 * 8000)])
def motion_sync(path, kicks_rel):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', 'scale=36:64', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, 64, 36).astype(np.float32)
    m = np.abs(np.diff(f, axis=0)).mean(axis=(1, 2)); m = np.concatenate([[0], m])
    near = set(); fr = [round(t * 30) for t in kicks_rel]
    for x in fr: near.update({x + 1, x + 2, x + 3})
    a = [m[i] for i in range(2, len(m)) if i in near]; b = [m[i] for i in range(2, len(m)) if i not in near]
    return float(np.mean(a) / np.mean(b))
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5180'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    ok = True
    def check(name, cond, extra=''):
        nonlocal ok; ok = ok and bool(cond); print(('  ✓ ' if cond else '  ✗ ') + name + (' — ' + str(extra) if extra != '' else ''))
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = await (await b.new_context(viewport={'width': 1400, 'height': 900}, bypass_csp=True, accept_downloads=True)).new_page()
            errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
            await page.goto('http://localhost:5180/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.evaluate("async () => { const p = await (await fetch('examples/demo-neon-techno.neonverse')).json(); await window.neon.importProjectData(p); }")
            await page.wait_for_function('!window.neon.analysis.synthetic', timeout=60000)
            await page.evaluate("window.neon.store.commit('qa', (p) => { p.export.resolution = 720; p.export.quality = 'normal'; })")
            await page.click('.nav-btn[data-section="export"]'); await page.wait_for_timeout(600)
            labels = await page.evaluate("[...document.querySelectorAll('.seg button')].map(b => b.textContent)")
            check('botones de duración en el exportador', all(x in labels for x in ['Completo', '15 s', '30 s', '45 s', '60 s']), labels)
            for secs in [15, 30, 45, 60]:
                await page.click(f'.seg button:has-text("{secs} s")'); await page.wait_for_timeout(400)
                tramo = await page.evaluate("[...document.querySelectorAll('#panel-body .hint')].map(e => e.textContent).find(t => t.startsWith('Tramo'))")
                check(f'{secs} s: el panel muestra el tramo', f'({secs}.0 s)' in tramo, tramo)
            for secs in [15, 30]:
                print(f'Exportación de {secs} s (desde el primer drop, interfaz del navegador)')
                await page.click(f'.seg button:has-text("{secs} s")'); await page.wait_for_timeout(400)
                rng = await page.evaluate("(() => { const a = window.neon, ex = a.store.project.export; return import('./js/export/Exporter.js').then(m => m.exportRange({ total: a.store.duration, duration: ex.clipSeconds, start: ex.clipStart || 'drop', cursor: a.player.time, analysis: a.analysis, trimStart: 0 })); })()")
                kicks = await page.evaluate("(r) => window.neon.analysis.drumHits({ mode: 'kicks', minGap: 0.2 }).map(h => h.t - r[0]).filter(t => t > 0.2 && t < r[1] - r[0] - 0.2)", rng)
                async with page.expect_download(timeout=900000) as dl:
                    await page.click('#panel-body button.neon-btn.big')
                d = await dl.value; out = f'/tmp/qa/out/clip-{secs}s.mp4'; await d.save_as(out)
                await page.wait_for_function("!window.neon.exporter.running", timeout=60000)
                pr = probe(out)
                vdur, adur, nfr = float(pr['video']['duration']), float(pr['audio']['duration']), int(pr['video']['nb_frames'])
                check(f'nombre {d.suggested_filename}', d.suggested_filename.endswith(f'-{secs}s.mp4'))
                check(f'duración exacta {secs} s: vídeo {vdur:.2f} s, {nfr} fotogramas', abs(vdur - secs) < 0.05 and nfr == secs * 30)
                check(f'audio {adur:.2f} s', abs(adur - secs) < 0.1)
                ft = audio_tail(out); check('fundido final del audio (los últimos 0,15 s mucho más bajos)', ft < 0.35, f'nivel final {ft:.2f} del normal')
                first = await page.evaluate("(() => { const s = window.neon.analysis.sections.find(x => x.type === 'drop'); return s ? s.start : 0; })()")
                check(f'tramo desde el primer drop ({first:.2f} s, un compás antes): {rng[0]:.2f}–{rng[1]:.2f} s', rng[0] <= first + 0.01 and rng[0] >= max(0, first - 2.1))
                ms = motion_sync(out, kicks); check(f'el movimiento del vídeo exportado se concentra en los {len(kicks)} bombos', ms > 1.25, f'contraste {ms:.2f}')
            check('sin errores', not errs, errs[:2])
            await b.close()
    finally: srv.terminate()
    print('RESULTADO:', 'TODO CORRECTO' if ok else 'HAY FALLOS'); sys.exit(0 if ok else 1)
if __name__ == "__main__": asyncio.run(main())
