# Verificación del BEAT-SYNC PHOTO ENGINE PRO en Chrome real:
#  A) al cargar música + fotos se activa en AUTO KICK;  B) cambios de modo, NEXT y PREVIOUS mientras suena (sin parar la música,
#  sin crear otro AudioContext);  C) el MP4 exportado muestra, fotograma a fotograma, la misma foto que la vista previa;
#  D) destellos por segundo de cada transición en el modo más rápido;  E) coste del motor por fotograma.
import asyncio, os, subprocess, time, base64, json, sys
import numpy as np
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.environ.get('QA_AUDIO', '/tmp/demo.mp3')
OUT = '/tmp/qa/out/beatsync.mp4'
INIT = "window.__ac = 0; for (const k of ['AudioContext', 'webkitAudioContext']) { const C = window[k]; if (!C) continue; window[k] = class extends C { constructor(...a) { super(...a); window.__ac++; } }; }"
PREVIEW = """async ({ t0, t1 }) => {
  const app = window.neon, E = app.engine, gl = E.renderer.getContext(); const W = 90, H = 160, buf = new Uint8Array(W * H * 4);
  const { evaluate } = await import('./js/timeline/model.js');
  for (const ph of app.store.project.photos) await app.ensurePhoto(ph);
  app.exporting = true; E.setCanvasSize(W, H);
  const out = [];
  for (let i = Math.round(t0 * 30); i < Math.round(t1 * 30); i++) {
    const t = i / 30, comp = evaluate(app.store.project, t);
    E.render({ t, comp, project: app.store.project, audioFor: app.audioFor(t), quality: app.qualityFor(), width: W, height: H, target: null });
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let r = 0, g = 0, b = 0; for (let k = 0; k < buf.length; k += 4) { r += buf[k]; g += buf[k + 1]; b += buf[k + 2]; }
    const n = W * H; out.push([r / n, g / n, b / n, app.store.project.photos.findIndex((p) => p.id === comp.A.photos.at(-1).params.photoId), 0.2126 * r / n + 0.7152 * g / n + 0.0722 * b / n]);
  }
  app.exporting = false; app.resizePreview(true);
  return out;
}"""
def flashes(lum):
    ev = []; ref = lum[0]; refI = 0
    for i in range(1, len(lum)):
        d = lum[i] - ref
        if abs(d) >= 25: ev.append((i, 1 if d > 0 else -1)); ref = lum[i]; refI = i
        if i - refI > 6: ref = lum[i]; refI = i
    best = 0
    for a in range(len(lum)):
        w = [e for e in ev if a <= e[0] < a + 30]; f = sum(1 for k in range(1, len(w)) if w[k][1] != w[k - 1][1]); best = max(best, (f + 1) // 2)
    return best
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs'), '--port', '5186'], stdout=subprocess.DEVNULL); time.sleep(0.8)
    ok = True
    def check(name, cond, extra=''):
        nonlocal ok; ok = ok and bool(cond); print(('  ✓ ' if cond else '  ✗ ') + name + (' — ' + str(extra) if extra != '' else ''))
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
            ctx = await b.new_context(viewport={'width': 1400, 'height': 900}, bypass_csp=True, accept_downloads=True)
            await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            errs = []; page.on('pageerror', lambda e: errs.append(str(e))); page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            await page.goto('http://localhost:5186/index.html')
            await page.wait_for_function('window.neon && window.neon.engine', timeout=30000)
            await page.evaluate("async () => { const { newProject } = await import('./js/core/store.js'); await window.neon.openProject(newProject('Prueba Beat-Sync'), { silent: true }); }")
            await page.set_input_files('#file-audio', AUDIO)
            await page.wait_for_function('window.neon.store.project.audio && !window.neon.analysis.synthetic', timeout=90000)
            await page.click('.nav-btn[data-section="photos"]')
            await page.set_input_files('#file-photos', sorted(['/tmp/qa/colors/' + f for f in os.listdir('/tmp/qa/colors')]))
            await page.wait_for_function('window.neon.store.project.photos.length >= 6 && window.neon.store.project.beatSync.enabled', timeout=30000)
            print('A) Carga de música y fotos')
            st = await page.evaluate("(() => { const a = window.neon, ev = a.bsEvents(); const k = a.analysis.drumHits({ mode: 'kicks', minGap: 0.2, sensitivity: 0.5 }).map(h => h.t); return { mode: a.store.project.beatSync.baseMode, events: ev.length - 1, kicks: k.length, allOnKick: ev.slice(1).every(e => k.some(x => Math.abs(x - e.t) < 0.011)), bpm: a.analysis.bpm, clips: a.store.project.timeline.tracks.photos.length }; })()")
            check('motor activado en AUTO KICK al cargar las fotos', st['mode'] == 'kick', st)
            check('cada bombo detectado produce un cambio y cada cambio cae en un bombo', st['allOnKick'] and abs(st['events'] - st['kicks']) <= 2)
            check('la carga de fotos sigue creando el pase de la pista de fotos (no se rompe lo anterior)', st['clips'] > 0)
            for m, per in [('half', 2), ('beat', 1), ('two', 0.5)]:
                r = await page.evaluate("(m) => { const a = window.neon; a.bsMode(m); const ev = a.bsEvents().slice(1).filter(e => e.t > 4 && e.t < 20); const beats = 16 / (60 / a.analysis.bpm); return [ev.length, beats]; }", m)
                check(f'modo {m}: {per} cambios por pulso', abs(r[0] - r[1] * per) <= 1.5, f'{r[0]} cambios en {r[1]:.1f} pulsos')
            await page.evaluate("window.neon.bsMode('kick')")
            print('B) En reproducción (sin detener la música)')
            await page.click('#btn-play'); await page.wait_for_timeout(2500)
            log = []
            async def snap(tag):
                s = await page.evaluate("(() => { const a = window.neon, s = a.bsState(); return { t: +a.player.time.toFixed(2), playing: a.player.playing, idx: s.index, mode: s.mode, ac: window.__ac }; })()"); s['tag'] = tag; log.append(s); return s
            s0 = await snap('inicio')
            await page.click('.seg button:has-text("1/2 BEAT")'); await page.wait_for_timeout(1500); s1 = await snap('1/2 BEAT')
            await page.click('.seg button:has-text("2 BEATS")'); await page.wait_for_timeout(1500); s2 = await snap('2 BEATS')
            # NEXT y PREVIOUS: se pausa el automático un instante para medir solo el efecto del botón
            await page.click('label.toggle:has-text("Cambio automático") input'); await page.wait_for_timeout(300); sa = await snap('auto off')
            await page.click('button:has-text("NEXT")'); await page.wait_for_timeout(250); sn = await snap('NEXT')
            await page.click('button:has-text("PREVIOUS")'); await page.wait_for_timeout(250); sp = await snap('PREVIOUS')
            await page.click('button:has-text("PREVIOUS")'); await page.wait_for_timeout(250); sp2 = await snap('PREVIOUS')
            await page.keyboard.press('n'); await page.wait_for_timeout(250); sk = await snap('tecla N')
            await page.click('.seg button:has-text("AUTO KICK")'); await page.wait_for_timeout(1500); s3 = await snap('AUTO KICK')
            await page.click('.seg button:has-text("1 BEAT")'); await page.wait_for_timeout(1200); s4 = await snap('1 BEAT')
            await page.click('#btn-play')
            for s in log: print('    ', s)
            check('la música no se detuvo en ningún cambio', all(s['playing'] for s in log) and all(log[i]['t'] > log[i - 1]['t'] for i in range(1, len(log))))
            check('los modos cambian al instante', [s1['mode'], s2['mode'], sa['mode'], s3['mode'], s4['mode']] == ['half', 'two', 'off', 'kick', 'beat'])
            check('NEXT avanza una foto', sn['idx'] == (sa['idx'] + 1) % 6, f"{sa['idx']} → {sn['idx']}")
            check('PREVIOUS retrocede una foto (dos veces)', sp['idx'] == sa['idx'] and sp2['idx'] == (sa['idx'] - 1) % 6, f"{sn['idx']} → {sp['idx']} → {sp2['idx']}")
            check('tecla N = NEXT', sk['idx'] == sa['idx'])
            check('un único AudioContext en toda la sesión', s4['ac'] == 1, s4['ac'])
            rec = await page.evaluate("JSON.stringify(window.neon.store.project.beatSync)")
            print('    grabado:', rec[:330])
            print('C) Exportación = vista previa (fotograma a fotograma)')
            await page.evaluate("window.neon.bsSet({ transition: 'cut' })")
            T1 = min(18.0, float(s4['t']) + 3)
            prev = np.array(await page.evaluate(PREVIEW, {'t0': 0, 't1': T1}))
            async with page.expect_download(timeout=600000) as dl:
                r = await page.evaluate("(t1) => window.neon.exporter.run({ width: 360, height: 640, fps: 30, codec: 'h264', quality: 'high', audioBitrate: 192, fileName: 'beatsync', range: [0, t1] }).then(r => ({ frames: r.frames, size: r.size }))", T1)
            await (await dl.value).save_as(OUT)
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', OUT, '-vf', 'scale=8:8', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], capture_output=True).stdout
            vid = np.frombuffer(raw, np.uint8).reshape(-1, 64, 3).astype(np.float32).mean(axis=1)
            n = min(len(vid), len(prev)); exp = prev[:n, 3].astype(int)
            refs = np.array([np.median(vid[:n][exp == k], axis=0) for k in range(6)])
            sep = min(np.linalg.norm(refs[i] - refs[j]) for i in range(6) for j in range(i))
            cls = np.argmin(np.linalg.norm(vid[:n, None, :] - refs[None], axis=2), axis=1)
            bad = int((cls[10:] != exp[10:]).sum()); changes = int((np.diff(exp[10:]) != 0).sum()); vchanges = int((np.diff(cls[10:]) != 0).sum())
            pcls = np.argmin(np.linalg.norm(prev[:n, None, :3] - np.array([np.median(prev[:n][exp == k, :3], axis=0) for k in range(6)])[None], axis=2), axis=1)
            print('    fotogramas que no cuadran — vista previa:', np.nonzero(pcls != exp)[0].tolist()[:12], '· vídeo:', np.nonzero(cls != exp)[0].tolist()[:12], '· vídeo≠vista previa:', np.nonzero(cls != pcls)[0].tolist()[:12])
            check(f'{n} fotogramas exportados; las 6 fotos se distinguen por color', len(vid) == r['frames'] and sep > 40, f'separación mínima {sep:.0f}')
            F0 = 10  # los primeros 0,33 s son el fundido desde negro de la primera foto: sin color que clasificar; se comparan por brillo
            check('la vista previa muestra en cada fotograma la foto que dicta el motor', int((pcls[F0:] != exp[F0:]).sum()) == 0)
            dif = float(np.abs(vid[:n] - prev[:n, :3]).mean()); check('color medio de cada fotograma: MP4 ≈ vista previa (incluido el fundido inicial)', dif < 10, f'diferencia media {dif:.1f}/255')
            check('el MP4 muestra exactamente la misma foto que la vista previa en todos los fotogramas', bad == 0, f'{bad} fotogramas distintos de {n - 10}; cambios de foto: vista previa {changes}, vídeo {vchanges}')
            print('D) Destellos por segundo (modo 1/2 BEAT, el más rápido; límite WCAG: 3)')
            await page.evaluate("window.neon.bsReset(); window.neon.bsMode('half')")
            await page.evaluate("window.neon.player.seek(0)"); await page.evaluate("window.neon.bsMode('half')")
            for tr in ['cut', 'crossfade', 'zoom', 'flash', 'rgbglitch']:
                await page.evaluate("(tr) => window.neon.bsSet({ transition: tr })", tr)
                lum = [x[4] for x in await page.evaluate(PREVIEW, {'t0': 4, 't1': 12})]
                d1 = max(abs(lum[i] - lum[i - 1]) for i in range(1, len(lum)))
                f = flashes(lum); check(f'{tr}: {f} destellos/s (salto máx. {d1:.0f}/255)', f <= 3)
            print('E) Coste del motor')
            ms = await page.evaluate("(() => { const a = window.neon, p = a.store.project; const t0 = performance.now(); for (let i = 0; i < 20000; i++) a.bsClips(p, (i * 0.0137) % 50); return (performance.now() - t0) / 20000; })()")
            check('cálculo por fotograma < 0,05 ms (no afecta al render 3D)', ms < 0.05, f'{ms * 1000:.1f} µs')
            check('sin errores de consola', not [e for e in errs if 'favicon' not in e], errs[:3])
            await b.close()
    finally: srv.terminate()
    print('\nRESULTADO:', 'TODO CORRECTO' if ok else 'HAY FALLOS'); sys.exit(0 if ok else 1)
asyncio.run(main())
