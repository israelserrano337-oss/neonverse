// NEONVERSE AI 2.0 — proceso principal de Electron.
// Sirve la app por el protocolo app:// y ejecuta FFmpeg para exportar los fotogramas que dibuja el renderer.
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');

const APP_DIR = path.join(__dirname, '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.neonverse': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // gráficas antiguas (HD 5500 / 820M) a veces están en lista negra
app.commandLine.appendSwitch('enable-gpu-rasterization');

let win = null;
const selftest = (process.argv.find((a) => a.startsWith('--selftest-export=')) || '').split('=')[1] || '';

function ffmpegPath() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = path.join(process.resourcesPath || '', 'ffmpeg', exe);
  if (app.isPackaged && fs.existsSync(bundled)) return bundled;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch { /* sin ffmpeg-static */ }
  const dev = path.join(__dirname, '..', 'build', 'ffmpeg-win', exe);
  if (fs.existsSync(dev)) return dev;
  return exe; // en el PATH
}

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(APP_DIR, 'assets', 'brand', process.platform === 'win32' ? 'favicon.ico' : 'icon-512.png'));
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 980, minHeight: 640, backgroundColor: '#04030c', title: 'NEONVERSE AI 2.0', icon,
    show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => { if (!selftest) win.show(); });
  const q = selftest ? `?selftest=${encodeURIComponent(selftest)}` : '';
  win.loadURL('app://neonverse/index.html' + q);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('console-message', (_e, level, message) => { if (selftest || level >= 2) console.log('[renderer]', message); });
}

function buildMenu() {
  const tpl = [
    { label: 'Archivo', submenu: [{ role: 'quit', label: 'Salir' }] },
    { label: 'Editar', submenu: [{ role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' }] },
    { label: 'Ver', submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'togglefullscreen', label: 'Pantalla completa' }, { role: 'resetZoom', label: 'Zoom normal' }, { role: 'zoomIn', label: 'Acercar' }, { role: 'zoomOut', label: 'Alejar' }, { type: 'separator' }, { role: 'toggleDevTools', label: 'Herramientas de desarrollo' }] },
    { label: 'Ayuda', submenu: [{ label: 'Acerca de NEONVERSE AI 2.0', click: () => dialog.showMessageBox(win, { type: 'info', title: 'NEONVERSE AI 2.0', message: 'NEONVERSE AI 2.0 — Futuristic Music Video Studio', detail: `Versión ${app.getVersion()}\nFFmpeg: ${ffmpegPath()}`, icon: nativeImage.createFromPath(path.join(APP_DIR, 'assets', 'brand', 'icon-512.png')) }) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------------------------------------------------------------- FFmpeg
function run(file, args) {
  return new Promise((resolve) => execFile(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, out: String(stdout) + String(stderr) })));
}
let infoCache = null;
ipcMain.handle('ffmpeg:info', async () => {
  if (infoCache) return infoCache;
  const ff = ffmpegPath();
  const v = await run(ff, ['-hide_banner', '-version']);
  if (v.err) return { h264: false, h265: false, qsv: false, error: 'FFmpeg no encontrado: ' + ff };
  const e = await run(ff, ['-hide_banner', '-encoders']);
  infoCache = { path: ff, version: (v.out.match(/ffmpeg version (\S+)/) || [])[1] || '', h264: /libx264/.test(e.out), h265: /libx265/.test(e.out), qsv: /h264_qsv/.test(e.out) };
  return infoCache;
});

let job = null;
function codecArgs(o) {
  const crf = o.crf || 19, br = o.bitrate;
  const rate = br ? ['-b:v', String(br), '-maxrate', String(Math.round(br * 1.5)), '-bufsize', String(br * 2)] : null;
  if (o.encoder === 'qsv') {
    const c = o.codec === 'h265' ? 'hevc_qsv' : 'h264_qsv';
    return ['-c:v', c, ...(rate || ['-global_quality', String(crf + 2)]), '-look_ahead', '0', ...(o.codec === 'h265' ? ['-tag:v', 'hvc1'] : [])];
  }
  if (o.codec === 'h265') return ['-c:v', 'libx265', '-preset', 'medium', ...(rate || ['-crf', String(crf + 3)]), '-tag:v', 'hvc1', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p'];
  return ['-c:v', 'libx264', '-preset', o.width * o.height > 2.5e6 ? 'fast' : 'medium', ...(rate || ['-crf', String(crf)]), '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
}

ipcMain.handle('export:start', async (_e, o) => {
  try {
    if (job) return { ok: false, error: 'Ya hay una exportación en curso' };
    const folder = o.folder && fs.existsSync(o.folder) ? o.folder : path.join(app.getPath('videos'), 'NEONVERSE');
    fs.mkdirSync(folder, { recursive: true });
    const base = (o.fileName || 'neonverse-video').replace(/[\\/:*?"<>|]+/g, '_');
    let out = path.join(folder, base + '.mp4');
    for (let i = 2; fs.existsSync(out); i++) out = path.join(folder, `${base} (${i}).mp4`);
    let audioPath = null;
    if (o.audio?.bytes) {
      audioPath = path.join(os.tmpdir(), `neonverse-audio-${process.pid}-${Date.now()}${path.extname(o.audio.name || '.mp3') || '.mp3'}`);
      fs.writeFileSync(audioPath, Buffer.from(o.audio.bytes));
    }
    const vdur = o.audio ? o.audio.duration : null;
    const args = ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0',
      ...(audioPath ? ['-ss', o.audio.start.toFixed(4), '-t', o.audio.duration.toFixed(4), '-i', audioPath] : []),
      '-vf', o.encoder === 'qsv' ? 'vflip,format=nv12' : 'vflip,format=yuv420p',
      '-map', '0:v', ...(audioPath ? ['-map', '1:a'] : []),
      ...codecArgs(o),
      ...(audioPath && o.fadeOut > 0 ? ['-af', `afade=t=out:st=${Math.max(0, o.audio.duration - o.fadeOut).toFixed(3)}:d=${o.fadeOut.toFixed(3)}:curve=qsin`] : []),
      ...(audioPath ? ['-c:a', 'aac', '-b:a', `${o.audioBitrate || 192}k`, '-ar', '48000', '-ac', '2', '-shortest'] : []),
      '-r', String(o.fps), '-movflags', '+faststart', out];
    const proc = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    job = { proc, out, audioPath, log: '', failed: null, closed: null, frames: 0, vdur };
    proc.stderr.on('data', (d) => { job && (job.log = (job.log + d).slice(-8000)); });
    proc.on('error', (err) => { if (job) job.failed = 'No se pudo ejecutar FFmpeg: ' + err.message; });
    job.closed = new Promise((resolve) => proc.on('close', (code) => resolve(code)));
    proc.stdin.on('error', (err) => { if (job && !job.failed) job.failed = 'FFmpeg cerró la entrada: ' + err.message + '\n' + job.log; });
    return { ok: true, path: out };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

ipcMain.handle('export:frame', async (_e, pixels) => {
  if (!job) return { ok: false, error: 'No hay exportación activa' };
  if (job.failed) return { ok: false, error: job.failed + '\n' + job.log };
  const buf = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const okWrite = job.proc.stdin.write(buf);
  job.frames++;
  if (!okWrite) await new Promise((resolve) => { const done = () => { job?.proc.stdin.off('drain', done); clearInterval(iv); resolve(); }; const iv = setInterval(() => { if (!job || job.failed) done(); }, 200); job.proc.stdin.once('drain', done); });
  return job && job.failed ? { ok: false, error: job.failed } : { ok: true };
});

ipcMain.handle('export:finish', async () => {
  if (!job) return { ok: false, error: 'No hay exportación activa' };
  const j = job;
  j.proc.stdin.end();
  const code = await j.closed;
  job = null;
  if (j.audioPath) fs.rm(j.audioPath, () => {});
  if (code !== 0 || !fs.existsSync(j.out)) return { ok: false, error: `FFmpeg terminó con código ${code}\n${j.log}` };
  return { ok: true, path: j.out, size: fs.statSync(j.out).size, log: j.log };
});

ipcMain.handle('export:cancel', async () => {
  if (!job) return { ok: true };
  const j = job; job = null;
  try { j.proc.stdin.destroy(); } catch {}
  try { j.proc.kill('SIGKILL'); } catch {}
  await Promise.race([j.closed, new Promise((r) => setTimeout(r, 3000))]);
  fs.rm(j.out, () => {});
  if (j.audioPath) fs.rm(j.audioPath, () => {});
  return { ok: true };
});

// ---------------------------------------------------------------- archivos
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Carpeta de destino', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('file:save', async (_e, { defaultName, data }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Guardar proyecto', defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: 'Proyecto NEONVERSE', extensions: ['neonverse'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, data); return { ok: true, path: r.filePath }; } catch (err) { return { ok: false, error: String(err.message) }; }
});
ipcMain.handle('shell:showItem', (_e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('selftest:done', (_e, result) => { console.log('[selftest]', JSON.stringify(result)); setTimeout(() => app.exit(result?.ok ? 0 : 1), 200); return true; });

// ---------------------------------------------------------------- arranque
app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR)) return new Response('Prohibido', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' } });
    } catch { return new Response('No encontrado', { status: 404 }); }
  });
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
