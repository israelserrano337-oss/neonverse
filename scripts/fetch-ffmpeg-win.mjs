// Descarga FFmpeg para Windows x64 (build estática de ffmpeg-static) en build/ffmpeg-win/ffmpeg.exe
// para incluirlo dentro del instalador. Se ejecuta solo con `npm run dist`.
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { get } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'ffmpeg-win');
const out = join(dir, 'ffmpeg.exe');
const URL_ = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64.gz';
if (existsSync(out) && statSync(out).size > 10e6) { console.log('[ffmpeg] ya existe', out); process.exit(0); }
mkdirSync(dir, { recursive: true });
function fetchFollow(url, n = 0) {
  return new Promise((resolve, reject) => get(url, { headers: { 'User-Agent': 'neonverse-build' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n < 8) { res.resume(); resolve(fetchFollow(res.headers.location, n + 1)); }
    else if (res.statusCode !== 200) reject(new Error('HTTP ' + res.statusCode));
    else resolve(res);
  }).on('error', reject));
}
console.log('[ffmpeg] descargando FFmpeg para Windows…');
await pipeline(await fetchFollow(URL_), createGunzip(), createWriteStream(out));
console.log('[ffmpeg] listo:', out, (statSync(out).size / 1e6).toFixed(1), 'MB');
