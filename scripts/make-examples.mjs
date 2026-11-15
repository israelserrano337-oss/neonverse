// Genera los proyectos de ejemplo en app/examples con el propio Auto Director.
// Música: techno sintético propio (FFmpeg → MP3). Imágenes: abstractas generadas (PIL). Sin material de terceros.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../app/js/audio/analysis-core.js';
import { Analysis, SyntheticAnalysis } from '../app/js/audio/analysis.js';
import { newProject } from '../app/js/core/store.js';
import { generate } from '../app/js/director/AutoDirector.js';
import { schemaDefaults } from '../app/js/core/util.js';
import { PHOTO_SETTINGS } from '../app/js/studios/photos.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'app', 'examples');
const tmp = join(root, 'build', 'tmp-examples');
mkdirSync(out, { recursive: true }); mkdirSync(tmp, { recursive: true });

function techno(seconds = 60, bpm = 128, sr = 44100) {
  const n = Math.floor(seconds * sr), L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / bpm, bar = beat * 4;
  let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const chords = [[55, 65.4, 82.4], [49, 61.7, 73.4], [43.7, 55, 65.4], [49, 58.3, 73.4]];
  for (let i = 0; i < n; i++) {
    const t = i / sr, b = Math.floor(t / beat), bt = t - b * beat, barI = Math.floor(t / bar);
    const brk = t >= bar * 12 && t < bar * 20; // pausa de 8 compases
    const intro = t < bar * 2;
    let v = 0;
    if (!brk) v += 0.95 * Math.exp(-bt * 16) * Math.sin(2 * Math.PI * (48 + 110 * Math.exp(-bt * 28)) * bt);
    const ht = (t + beat / 2) % beat;
    if (!intro) v += 0.12 * Math.exp(-ht * 70) * rnd();
    if (!brk && !intro && b % 2 === 1) v += 0.22 * Math.exp(-bt * 22) * rnd();
    const ch = chords[barI % 4];
    const sb = (t % (beat / 2)) / (beat / 2);
    if (!intro) v += (brk ? 0.05 : 0.2) * Math.sin(2 * Math.PI * ch[0] * t) * Math.min(1, sb * 20) * Math.exp(-sb * 2.2);
    const pad = ch.reduce((a, f) => a + Math.sin(2 * Math.PI * f * 4 * t + Math.sin(t * 0.5)), 0) / 3;
    v += pad * (brk ? 0.16 : 0.06) * (0.6 + 0.4 * Math.sin(2 * Math.PI * t / bar));
    const pan = 0.15 * Math.sin(t * 0.8);
    L[i] = Math.tanh(v * 0.9) * (1 - pan) * 0.8; R[i] = Math.tanh(v * 0.9) * (1 + pan) * 0.8;
  }
  return { L, R, sr };
}
function wav16(L, R, sr) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
  return b;
}

// 1) Música
const { L, R, sr } = techno();
writeFileSync(join(tmp, 'techno.wav'), wav16(L, R, sr));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(tmp, 'techno.wav'), '-c:a', 'libmp3lame', '-b:a', '128k', join(tmp, 'techno.mp3')]);
// 2) Imágenes abstractas
execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw, ImageFilter
import math, random
random.seed(11)
pals=[[(0,240,255),(138,43,255),(255,43,214)],[(57,255,20),(0,229,199),(255,230,0)],[(255,30,60),(255,122,0),(255,212,0)],[(125,249,255),(106,0,255),(255,0,200)]]
for k,pal in enumerate(pals):
    w,h=900,1200
    im=Image.new('RGB',(w,h),(6,3,18)); d=ImageDraw.Draw(im)
    for i in range(26):
        c=pal[i%3]; r=random.randint(40,260); x=random.randint(0,w); y=random.randint(0,h)
        d.ellipse([x-r,y-r,x+r,y+r],outline=c,width=random.randint(3,14))
    for i in range(10):
        c=pal[(i+1)%3]; pts=[(random.randint(0,w),random.randint(0,h)) for _ in range(3)]
        d.polygon(pts,outline=c,width=5)
    im=im.filter(ImageFilter.GaussianBlur(1.5))
    glow=im.filter(ImageFilter.GaussianBlur(18))
    im=Image.blend(im,glow,0.35)
    im.save('${tmp}/abstract%d.jpg'%(k+1),quality=82)
`]);

const dataUrl = (file, mime) => `data:${mime};base64,${readFileSync(file).toString('base64')}`;
const mono = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = 0.5 * (L[i] + R[i]);
const analysis = new Analysis(analyze(mono, sr));
console.log('BPM', analysis.bpm, 'secciones', analysis.sections.map((s) => s.type).join(' → '));

const examples = [];
// Ejemplo A: completo con música y fotos
{
  const p = newProject('Demo · Neon Techno 128 BPM');
  p.audio = { mediaId: 'ex_audio', name: 'neon-techno-demo.mp3', mime: 'audio/mpeg', duration: L.length / sr, trimStart: 0, trimEnd: L.length / sr, markers: [], bpm: analysis.bpm };
  p.photos = [1, 2, 3, 4].map((i) => ({ id: `ex_ph${i}`, mediaId: `ex_img${i}`, name: `abstracto ${i}`, w: 900, h: 1200, luma: 0.2, addedAt: i, settings: schemaDefaults(PHOTO_SETTINGS) }));
  p.director.profile = 'future-rave'; p.director.seed = 128128;
  const r = generate({ project: p, analysis, duration: p.audio.duration, profileId: p.director.profile, controls: p.director.controls, seed: p.director.seed });
  p.timeline.tracks = r.tracks; p.director.scenes = r.scenes;
  p.media = { ex_audio: { name: 'neon-techno-demo.mp3', data: dataUrl(join(tmp, 'techno.mp3'), 'audio/mpeg') } };
  for (let i = 1; i <= 4; i++) p.media[`ex_img${i}`] = { name: `abstracto ${i}`, data: dataUrl(join(tmp, `abstract${i}.jpg`), 'image/jpeg') };
  writeFileSync(join(out, 'demo-neon-techno.neonverse'), JSON.stringify(p));
  examples.push({ name: 'Neon Techno 128 BPM', desc: 'Música y 4 imágenes incluidas · Future Rave', file: 'demo-neon-techno.neonverse' });
  console.log('A', r.summary);
}
// Ejemplos B y C: composiciones sin música (30 s)
for (const [profile, name, seed] of [['synthwave', 'Synthwave sin música', 1984], ['psytrance', 'Psytrance fractal sin música', 4242]]) {
  const p = newProject('Demo · ' + name);
  p.director.profile = profile; p.director.seed = seed;
  const a = new SyntheticAnalysis(30);
  const r = generate({ project: p, analysis: a, duration: 30, profileId: profile, controls: p.director.controls, seed });
  p.timeline.tracks = r.tracks; p.director.scenes = r.scenes;
  const file = `demo-${profile}.neonverse`;
  writeFileSync(join(out, file), JSON.stringify(p));
  examples.push({ name, desc: `Perfil ${profile} · 30 s · carga tu música y regenera`, file });
}
writeFileSync(join(out, 'index.json'), JSON.stringify(examples, null, 2));
console.log('Ejemplos en', out);
