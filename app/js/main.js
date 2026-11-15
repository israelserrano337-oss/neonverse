// NEONVERSE AI 2.0 — arranque y coordinación de módulos.
import { Store, newProject, normalizeProject, TRACKS } from './core/store.js';
import { MediaStore } from './core/media.js';
import { uid, debounce, clamp, formatTime, deepClone, schemaDefaults } from './core/util.js';
import { Player } from './audio/player.js';
import { decodeAudio, analyzeBuffer, audioContext } from './audio/loader.js';
import { SyntheticAnalysis, BAND_NAMES } from './audio/analysis.js';
import { Engine } from './engine/Engine.js';
import { evaluate, studioComposition, addClip, removeClip, splitClip, duplicateClip, getClip } from './timeline/model.js';
import { TimelineView } from './timeline/TimelineView.js';
import { Exporter } from './export/Exporter.js';
import { buildSlideshow } from './timeline/slideshow.js';
import { setPhotoProvider } from './timeline/model.js';
import { buildEvents, clipsAt, stateAt, setModeAt, addNudge, modeAt } from './beatsync/BeatSync.js';
import { generate, smartRandom } from './director/AutoDirector.js';
import { TUNNELS } from './studios/tunnels.js';
import { MESHES } from './studios/meshes.js';
import { PARTICLES } from './studios/particles.js';
import { EQUALIZERS } from './studios/equalizers.js';
import { PHOTO_SETTINGS, PHOTO_CLIP_PARAMS } from './studios/photos.js';
import { TRANSITION_PARAMS } from './studios/transitions.js';
import { EFFECT_PARAMS, LIGHTING_PARAMS } from './studios/effects.js';
import { toast, modal, el, icon } from './ui/controls.js';
import { SECTIONS } from './ui/sections.js';

const QUALITY = {
  performance: { level: 'p', previewMax: 640, fps: 30, particles: 0.4, segments: 0.5, bloomScale: 0.25, maxPhoto: 1024 },
  balanced: { level: 'b', previewMax: 960, fps: 30, particles: 0.7, segments: 0.75, bloomScale: 0.25, maxPhoto: 2048 },
  quality: { level: 'q', previewMax: 1920, fps: 60, particles: 1, segments: 1, bloomScale: 0.25, maxPhoto: 2048 },
  export: { level: 'x', particles: 1, segments: 1, bloomScale: 0.25, maxPhoto: 4096 },
};
const PREFS_KEY = 'neonverse-prefs';

class App {
  constructor() {
    this.prefs = Object.assign({ quality: null, previewScale: 1, fpsCap: 0, particleMul: 1, maxPhoto: 0, followPlayhead: true, autosave: true }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
    this.store = new Store(newProject());
    this.media = new MediaStore();
    this.player = new Player();
    this.exporter = new Exporter(this);
    this.analysis = new SyntheticAnalysis(30);
    this.audioBuffer = null;
    this.view = { mode: 'timeline', studio: null };
    this.section = 'home';
    this.exporting = false;
    this.studioClock = performance.now();
    this._views = {};
    this._a = [{}, {}, {}];
    this.actions = this.makeActions();
    this.photoLoads = new Map();
  }

  // ---------------------------------------------------------------- arranque
  async init() {
    const msg = (t) => { document.getElementById('boot-msg').textContent = t; };
    msg('Creando motor gráfico…');
    this.canvas = document.getElementById('view');
    try { this.engine = new Engine(this.canvas); }
    catch (e) { msg('WebGL 2 no está disponible en este equipo/navegador.'); throw e; }
    // historial del espectro para los ecualizadores (mismo desfase y recorte que el resto del audio)
    this.engine.spectrumAt = (tt, out) => this.analysis.spectrumAt((this.store.project.audio?.trimStart || 0) + tt - (this.store.project.sync.offsetMs || 0) / 1000, out);
    const info = this.engine.info();
    this.gpu = info;
    if (!this.prefs.quality) this.prefs.quality = /intel|hd graphics|uhd|mali|adreno|apple|swiftshader|llvmpipe/i.test(info.renderer) ? 'balanced' : 'quality';
    if (/iphone|ipad|android/i.test(navigator.userAgent)) this.prefs.quality = this.prefs.quality === 'quality' ? 'balanced' : this.prefs.quality;
    this.timeline = new TimelineView(document.getElementById('tl-canvas'), this);
    setPhotoProvider((project, t) => this.bsClips(project, t));
    this.buildNav();
    this.bindUI();
    this.setupMobile();
    msg('Recuperando el último proyecto…');
    await this.restoreAutosave();
    this.store.on('change', (kind) => this.onChange(kind));
    this.store.on('select', () => { this.timeline.dirty = true; if (this.section === 'timeline') this.renderSection(); });
    this.store.on('history', () => this.updateHistoryButtons());
    this.player.on('state', () => this.updateTransport());
    this.player.on('ended', () => this.updateTransport());
    this.syncHeader();
    this.go(this.store.project.timeline.tracks.tunnels.length ? 'timeline' : 'home');
    document.getElementById('boot').style.opacity = '0';
    setTimeout(() => document.getElementById('boot').remove(), 500);
    document.getElementById('app').classList.remove('hidden');
    this.resizePreview(true);
    new ResizeObserver(() => this.resizePreview()).observe(document.getElementById('stage'));
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    window.neon = this; // acceso para pruebas automáticas
  }

  /** iPhone / móvil: audio que ignora el interruptor de silencio, almacenamiento persistente, uso sin conexión. */
  setupMobile() {
    this.phone = window.matchMedia('(max-width: 860px)').matches;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    try { navigator.storage?.persist?.(); } catch {}
    if (this.phone) document.getElementById('timeline-dock').classList.add('collapsed');
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Sin modo sin conexión', e));
    // al volver a la app tras bloquear el iPhone, el contexto de audio puede quedar suspendido
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.player.playing) audioContext().resume?.(); });
  }

  // ---------------------------------------------------------------- calidad
  qualityFor(mode = this.prefs.quality) {
    const q = { ...QUALITY[mode] || QUALITY.balanced };
    if (mode !== 'export') {
      q.particles *= this.prefs.particleMul;
      if (this.prefs.maxPhoto) q.maxPhoto = this.prefs.maxPhoto;
      q.level += `${this.prefs.particleMul}`;
    }
    return q;
  }
  setQuality(mode) {
    this.prefs.quality = mode; this.savePrefs();
    this.engine.disposeAll(); this.resizePreview(true);
    this.reloadPhotoTextures();
    document.getElementById('quality-select').value = mode;
  }
  savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); }

  frameAspect() {
    const p = this.store.project;
    if (p.aspect === 'custom') return (p.customSize?.w || 1080) / (p.customSize?.h || 1920);
    const [a, b] = p.aspect.split(':').map(Number);
    return a / b;
  }
  resizePreview(force = false) {
    if (this.exporting) return;
    const stage = document.getElementById('stage');
    const frame = document.getElementById('stage-frame');
    const W = stage.clientWidth - 20, H = stage.clientHeight - 20;
    if (W < 10 || H < 10) return;
    const ar = this.frameAspect();
    let w = W, h = W / ar;
    if (h > H) { h = H; w = H * ar; }
    frame.style.width = `${Math.floor(w)}px`; frame.style.height = `${Math.floor(h)}px`;
    const q = this.qualityFor();
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.prefs.previewScale;
    let rh;
    if (ar > 1) rh = Math.min(Math.round(h * dpr), Math.round(q.previewMax / ar));
    else rh = Math.min(Math.round(h * dpr), q.previewMax);
    const rw = Math.max(2, Math.round(rh * ar));
    if (force || this.pw !== rw || this.ph !== rh) { this.pw = rw; this.ph = rh; this.engine.setCanvasSize(rw, rh); this.canvas.style.width = '100%'; this.canvas.style.height = '100%'; }
    this.timeline.dirty = true;
  }

  // ---------------------------------------------------------------- audio para los módulos
  /** Devuelve audioFor(módulo): niveles del instante con la sincronía por módulo aplicada. */
  audioFor(t) {
    const p = this.store.project, sync = p.sync, a = this.analysis;
    const tA = (p.audio?.trimStart || 0) + t - (sync.offsetMs || 0) / 1000;
    const base = a.at(tA, this._a[0]);
    const sm = clamp(sync.smoothing ?? 0.5);
    if (sm > 0.01) {
      const b1 = a.at(tA - 0.03, this._a[1]), b2 = a.at(tA - 0.06, this._a[2]);
      for (const k of [...BAND_NAMES, 'energy', 'beat']) base[k] = base[k] * (1 - 0.5 * sm) + (b1[k] * 0.3 + b2[k] * 0.2) * sm;
    }
    const views = this._views;
    return (module) => {
      const m = sync.modules[module] || { enabled: true, bass: 1, mid: 1, treble: 1, beat: 1 };
      const v = views[module] || (views[module] = {});
      Object.assign(v, base);
      const g = (sync.global ?? 1) * (m.enabled ? 1 : 0);
      v.bass = Math.min(1.5, base.bass * m.bass * g);
      v.lowMid = Math.min(1.5, base.lowMid * m.mid * g);
      v.mid = Math.min(1.5, base.mid * m.mid * g);
      v.highMid = Math.min(1.5, base.highMid * m.treble * g);
      v.treble = Math.min(1.5, base.treble * m.treble * g);
      v.beat = Math.min(1.5, base.beat * m.beat * g);
      v.energy = Math.min(1.5, base.energy * g);
      v.bassSoft = Math.min(1.5, base.bassSoft * m.bass * g); v.midSoft = Math.min(1.5, base.midSoft * m.mid * g);
      v.trebleSoft = Math.min(1.5, base.trebleSoft * m.treble * g); v.energySoft = Math.min(1.5, base.energySoft * g);
      v.travelBass = base.travelBass * (m.enabled ? m.bass : 0);
      v.kickPulse = Math.min(1.5, (base.kickPulse || 0) * m.beat * g);
      v.hitPulse = Math.min(1.5, (base.hitPulse || 0) * m.beat * g);
      v.kickTravel = (base.kickTravel || 0) * (m.enabled ? m.beat : 0) * (sync.global ?? 1);
      v.gain = g;
      return v;
    };
  }

  // ---------------------------------------------------------------- bucle de render
  loop(now) {
    requestAnimationFrame(this.loop);
    if (this.exporting || !this.engine) return;
    const q = this.qualityFor();
    const cap = this.prefs.fpsCap || q.fps;
    if (this._last && now - this._last < 1000 / cap - 2) return;
    const dt = this._last ? now - this._last : 16;
    this._last = now;
    this.player.tick();
    const t = this.player.time;
    const tr = this.store.project.timeline.tracks;
    const idle = this.view.mode !== 'studio' && !this.bsActive() && !tr.tunnels.length && !tr.meshes.length && !tr.photos.length && !tr.particles.length && !tr.equalizers.length;
    const studio = this.view.mode === 'studio' || idle;
    const st = studio ? (this.player.playing ? t : (now - this.studioClock) / 1000) : t;
    const key = `${this.store.version}|${t.toFixed(4)}|${this.pw}x${this.ph}|${this.view.mode}`;
    if (!studio && key === this._lastKey && !this._forceRender) { this.uiTick(t, dt, false); return; }
    this._lastKey = key; this._forceRender = false;
    let comp;
    if (idle) {
      // Proyecto vacío: las capas del estudio sirven de fondo animado
      if (!this.store.project.studio.tunnels.length) this.store.project.studio.tunnels.push({ id: 'idle', type: 'rings', params: { speed: 0.6, glow: 1 } });
      comp = studioComposition(this.store.project.studio, ['tunnels'], st);
    } else comp = studio ? this.studioComp(st) : evaluate(this.store.project, t);
    try {
      this.engine.render({ t: st, comp, project: this.store.project, audioFor: this.audioFor(st), quality: q, width: this.pw, height: this.ph, target: null });
    } catch (e) { console.error(e); if (!this._renderErr) { this._renderErr = true; toast('Error de render: ' + e.message, true, 6000); } }
    this.uiTick(t, dt, true);
  }
  requestRender() { this._forceRender = true; }

  studioComp(t) {
    const s = this.view.studio || {};
    const p = this.store.project;
    if (s.kind === 'transition') {
      const base = p.studio.tunnels.length ? p.studio.tunnels : [{ id: 'demoA', type: 'rings', params: {} }];
      const A = { photos: [], tunnels: base.map((c) => ({ ...c, start: 0, dur: 1e9 })), meshes: [], equalizers: [], particles: [] };
      const B = { photos: [], tunnels: [{ id: 'demoB', type: 'hexagons', params: { colorShift: 0.5, speed: 1.3 } }], meshes: [{ id: 'demoBm', type: 'wavy', params: {}, start: 0, dur: 1e9 }], equalizers: [], particles: [] };
      B.tunnels[0].start = 0; B.tunnels[0].dur = 1e9;
      const D = Math.max(0.2, s.duration || 1.5), cyc = D + 1.4;
      const ph = (t % cyc) - 0.7;
      const progress = clamp(ph / D);
      const flip = Math.floor(t / cyc) % 2 === 1;
      return { A: flip ? B : A, B: flip ? A : B, transition: { type: s.type, params: s.params, start: 0, dur: D }, progress, lighting: { current: null, previous: null }, effects: [] };
    }
    if (s.kind === 'photo') {
      const comp = studioComposition(p.studio, s.withTunnel ? ['tunnels'] : [], t);
      if (s.photoId) {
        const D = 6, local = t % D;
        comp.A.photos = [{ id: 'studio-photo-' + s.photoId, track: 'photos', type: 'photo', start: t - local, dur: D, params: { ...(s.fx || {}), photoId: s.photoId } }];
      }
      return comp;
    }
    return studioComposition(p.studio, s.kinds || ['tunnels'], t);
  }

  setView(mode, studio = null) {
    this.view = { mode, studio };
    if (mode === 'studio') this.studioClock = performance.now() - 2000;
    const b = document.getElementById('btn-view-mode');
    b.textContent = mode === 'studio' ? 'Vista: Estudio' : 'Vista: Línea de tiempo';
    b.classList.toggle('on', mode === 'studio');
    document.getElementById('hud-mode').textContent = mode === 'studio' ? 'ESTUDIO' : '';
    this.requestRender();
  }

  uiTick(t, dt, rendered) {
    this._fpsAcc = (this._fpsAcc || 0) * 0.9 + (rendered ? 1000 / Math.max(1, dt) : 0) * 0.1;
    if (!this._uiN || ++this._uiN > 6) {
      this._uiN = 1;
      document.getElementById('time-now').textContent = formatTime(t, true);
      document.getElementById('hud-fps').textContent = rendered ? `${Math.round(this._fpsAcc)} FPS · ${this.pw}×${this.ph}` : '';
      const a = this.audioFor(t)('lighting');
      document.getElementById('hud-section').textContent = this.analysis.synthetic ? '' : (this.store.project.audio ? a.section.toUpperCase() : '');
      document.getElementById('hud-bpm').textContent = this.store.project.audio ? `${this.analysis.bpm} BPM` : '';
      this.sectionTick?.(t, a);
    }
    if (this.player.playing && this.prefs.followPlayhead) this.timeline.follow(t);
    if (this.player.playing || this.timeline.dirty || this._lastTlT !== t) { this.timeline.draw(t); this._lastTlT = t; }
    this.drawScrub(t);
  }

  // ---------------------------------------------------------------- cambios del proyecto
  onChange(kind) {
    this.timeline.dirty = true;
    this.requestRender();
    if (kind === 'load' || kind === 'history' || kind === 'audio' || kind === 'aspect') {
      this.syncHeader();
      this.player.setRange(this.store.project.audio?.trimStart || 0, this.store.duration);
      if (kind !== 'history') this.timeline.zoomFit();
      this.resizePreview(true);
      if (kind !== 'live') this.renderSection();
    }
    if (kind === 'trim') this.player.setRange(this.store.project.audio?.trimStart || 0, this.store.duration);
    this.scheduleAutosave();
  }
  syncHeader() {
    const p = this.store.project;
    document.getElementById('project-name').value = p.name;
    document.getElementById('aspect-select').value = p.aspect;
    document.getElementById('quality-select').value = this.prefs.quality;
    document.getElementById('time-total').textContent = formatTime(this.store.duration);
    this.player.setRange(p.audio?.trimStart || 0, this.store.duration);
    if (!p.audio && this.analysis.synthetic && Math.abs(this.analysis.duration - this.store.duration) > 0.5) this.analysis = new SyntheticAnalysis(this.store.duration);
  }
  updateHistoryButtons() {
    const u = this.store.undoStack.at(-1), r = this.store.redoStack.at(-1);
    const bu = document.getElementById('btn-undo'), br = document.getElementById('btn-redo');
    bu.disabled = !u; br.disabled = !r;
    bu.title = u ? `Deshacer: ${u.label} (Ctrl+Z)` : 'Nada que deshacer';
    br.title = r ? `Rehacer: ${r.label} (Ctrl+Y)` : 'Nada que rehacer';
  }
  updateTransport() {
    const b = document.getElementById('btn-play');
    b.textContent = this.player.playing ? '❚❚' : '▶';
    b.classList.toggle('playing', this.player.playing);
    document.getElementById('btn-loop').classList.toggle('on', this.player.loop.enabled);
  }

  // ---------------------------------------------------------------- medios
  async loadAudioFile(file) {
    try {
      toast('Cargando música…');
      const buf = await file.arrayBuffer();
      let decoded;
      try { decoded = await decodeAudio(buf); }
      catch { throw new Error('Formato no compatible en este navegador. Prueba MP3, WAV o AAC.'); }
      const mediaId = await this.media.put(file, file.name);
      await this.setAudioBuffer(decoded, true);
      const old = this.store.project.audio;
      this.store.commit('Cargar música', (p) => {
        p.audio = { mediaId, name: file.name, mime: file.type, duration: decoded.duration, trimStart: 0, trimEnd: decoded.duration, markers: [], bpm: this.analysis.bpm };
      }, 'audio');
      if (old?.mediaId && old.mediaId !== mediaId) this.media.remove(old.mediaId);
      toast(`Música lista: ${this.analysis.bpm} BPM · ${this.analysis.sections.length} secciones`);
    } catch (e) { console.error(e); toast(e.message || 'No se pudo cargar la música', true, 5000); }
  }
  async setAudioBuffer(decoded, analyze = true) {
    this.audioBuffer = decoded;
    this.player.setBuffer(decoded);
    if (analyze) {
      document.getElementById('hud-section').textContent = 'ANALIZANDO…';
      const t0 = performance.now();
      this.analysis = await analyzeBuffer(decoded, (p) => { document.getElementById('hud-section').textContent = `ANALIZANDO ${Math.round(p * 100)}%`; });
      console.log(`[análisis] ${(performance.now() - t0).toFixed(0)} ms · ${this.analysis.bpm} BPM`);
    }
    this.timeline.dirty = true;
    this.requestRender();
  }
  async addPhotoFiles(files) {
    const ok = [...files].filter((f) => /image\/(jpeg|png|webp|heic|heif)/.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!ok.length) { toast('Formatos admitidos: JPG, JPEG, PNG, WEBP (y HEIC del iPhone)', true); return; }
    toast(`Cargando ${ok.length} foto(s)…`);
    const added = [];
    for (const f of ok) {
      try {
        const mediaId = await this.media.put(f, f.name);
        const img = await this.media.image(mediaId, this.qualityFor().maxPhoto);
        const id = uid('ph');
        this.engine.setPhotoImage(id, img);
        added.push({ id, mediaId, name: f.name.replace(/\.[^.]+$/, '') || `foto ${this.store.project.photos.length + added.length + 1}`, w: img.srcW, h: img.srcH, luma: +img.luma.toFixed(3), addedAt: Date.now(), settings: schemaDefaults(PHOTO_SETTINGS) });
      } catch (e) { console.warn('Foto no válida', f.name, e); }
    }
    if (added.length) this.store.commit(`Añadir ${added.length} foto(s)`, (p) => { p.photos.push(...added); }, 'photos');
    if (added.length && !this.store.project.timeline.tracks.photos.length) {
      this.makeSlideshow({ every: this.store.project.audio ? 'hits' : 2, look: 'full', effect: 'varied', hitFx: 'varied', minGap: 0.25 }, { keepEngine: true });
      // Primer lote de fotos: se activa el motor Beat-Sync en AUTO KICK (el pase fijo queda como alternativa)
      this.store.commit('Activar Beat-Sync', (p) => { p.beatSync.enabled = true; });
      toast(`${added.length} foto(s) añadidas · Beat-Sync activo: ${this.bsEvents().length - 1} cambios en AUTO KICK. Ajústalo en Fotos.`, false, 4500);
      this.setView('timeline');
    } else toast(`${added.length} foto(s) añadidas · para usarlas: Fotos → «Crear pase al ritmo» o GENERAR VÍDEO`, false, 4500);
    if (this.section === 'photos' || this.section === 'director' || this.section === 'home') this.renderSection();
    return added;
  }
  async ensurePhoto(ph, max) {
    if (this.engine.photoTexture(ph.id) && (!max || this._photoMax === max)) return;
    const key = ph.id + '@' + max;
    if (this.photoLoads.has(key)) return this.photoLoads.get(key);
    const pr = (async () => { const img = await this.media.image(ph.mediaId, max || this.qualityFor().maxPhoto); if (img) this.engine.setPhotoImage(ph.id, img); })();
    this.photoLoads.set(key, pr);
    try { await pr; } finally { this.photoLoads.delete(key); }
  }
  async reloadPhotoTextures(max) {
    const m = max || this.qualityFor().maxPhoto;
    for (const ph of this.store.project.photos) { this.engine.dropPhoto(ph.id); await this.ensurePhoto(ph, m); }
    this._photoMax = m;
    this.media.trimImages(m);
    this.requestRender();
  }
  async preloadPhotos(max) { await this.reloadPhotoTextures(max); }

  // ---------------------------------------------------------------- proyecto: guardar / abrir
  scheduleAutosave = debounce(() => this.autosave(), 1500);
  async autosave() {
    if (!this.prefs.autosave) return;
    try { await this.media.libPut('autosave', { project: deepClone({ ...this.store.project }), savedAt: Date.now() }); } catch (e) { console.warn('Autoguardado', e); }
  }
  async restoreAutosave() {
    try {
      const rec = await this.media.libGet('autosave');
      if (rec?.project) await this.openProject(rec.project, { silent: true });
    } catch (e) { console.warn('No se pudo recuperar el autoguardado', e); }
  }
  async openProject(project, { silent = false } = {}) {
    const p = normalizeProject(project);
    this.player.stop();
    this.audioBuffer = null; this.player.setBuffer(null);
    this.analysis = new SyntheticAnalysis(p.duration || 30);
    for (const id of [...this.engine.textures.keys()]) this.engine.dropPhoto(id);
    this.store.replace(p, 'load');
    if (p.audio?.mediaId) {
      const ab = await this.media.arrayBuffer(p.audio.mediaId);
      if (ab) { try { await this.setAudioBuffer(await decodeAudio(ab), true); } catch (e) { console.warn(e); } }
      else if (!silent) toast('Falta el archivo de música de este proyecto: vuelve a cargarlo', true, 5000);
    }
    this.store._changed('load');
    for (const ph of p.photos) this.ensurePhoto(ph).catch(() => {});
    if (!silent) toast(`Proyecto abierto: ${p.name}`);
  }
  async saveToLibrary() {
    const p = this.store.project;
    const key = `project:${p.createdAt}`;
    await this.media.libPut(key, { project: deepClone(p), name: p.name, savedAt: Date.now(), clips: TRACKS.reduce((n, t) => n + p.timeline.tracks[t].length, 0) });
    toast(`Guardado en la biblioteca: ${p.name}`);
  }
  /** Archivo .neonverse con la música y las fotos incrustadas (para pasar del iPhone al PC). */
  async exportProjectFile() {
    const p = deepClone(this.store.project);
    toast('Empaquetando proyecto…');
    const media = {};
    if (p.audio?.mediaId) media[p.audio.mediaId] = { name: p.audio.name, data: await this.media.toDataURL(p.audio.mediaId) };
    for (const ph of p.photos) media[ph.mediaId] = { name: ph.name, data: await this.media.toDataURL(ph.mediaId) };
    const json = JSON.stringify({ ...p, media });
    const name = `${p.name.replace(/[\\/:*?"<>|]+/g, '_') || 'proyecto'}.neonverse`;
    await this.saveFile(name, json, 'application/json');
  }
  async importProjectFile(file) {
    try { await this.importProjectData(JSON.parse(await file.text())); }
    catch (e) { toast('No se pudo abrir: ' + e.message, true, 5000); }
  }
  async importProjectData(data) {
    {
      if (data.format !== 'neonverse-project') throw new Error('No es un proyecto de NEONVERSE');
      const media = data.media || {};
      delete data.media;
      for (const [id, m] of Object.entries(media)) if (m?.data) await this.media.fromDataURL(m.data, m.name, id);
      data.createdAt = data.createdAt || new Date().toISOString();
      await this.openProject(data);
    }
  }
  async saveFile(name, data, type) {
    if (window.neonDesktop?.saveFile) {
      const r = await window.neonDesktop.saveFile({ defaultName: name, data });
      if (r?.ok) toast(`Guardado: ${r.path}`); else if (r?.error) toast(r.error, true);
      return;
    }
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Descargado: ${name}`);
  }

  // ---------------------------------------------------------------- Beat-Sync Photo Engine PRO
  bsActive(project = this.store.project) { return !!(project.beatSync?.enabled && project.photos.length); }
  bsEvents(project = this.store.project) { return buildEvents(project.beatSync, this.analysis, project.audio?.trimStart || 0, this.store.duration); }
  /** Clips de foto del motor en t (o null si está apagado: entonces manda la pista de fotos). */
  bsClips(project, t) { return this.bsActive(project) ? clipsAt(project.beatSync, this.bsEvents(project), project.photos, t, this.store.duration) : null; }
  bsState(t = this.player.time) { const p = this.store.project; return this.bsActive() ? stateAt(p.beatSync, this.bsEvents(), p.photos, t) : null; }
  bsSet(patch, label = 'Beat-Sync') { this.store.commit(label, (p) => { Object.assign(p.beatSync, patch); }); }
  /** Cambia el modo desde el cursor (en reproducción queda grabado en ese instante; la música no se detiene). */
  bsMode(mode) { const t = this.player.playing || this.player.time > 0.05 ? this.player.time : 0; this.store.commit('Beat-Sync: modo', (p) => { p.beatSync.enabled = true; setModeAt(p.beatSync, t, mode); }); }
  bsAuto(on) { const cur = modeAt(this.store.project.beatSync, this.player.time); if (on === (cur !== 'off')) return; this.bsMode(on ? this.store.project.beatSync.resume || 'kick' : 'off'); }
  /** NEXT (+1) / PREVIOUS (−1) en el instante actual. */
  bsNudge(d) { if (!this.store.project.photos.length) return; const t = this.player.time; this.store.commit(d > 0 ? 'Beat-Sync: NEXT' : 'Beat-Sync: PREVIOUS', (p) => { p.beatSync.enabled = true; addNudge(p.beatSync, t, d); }); }
  bsReset() { this.store.commit('Beat-Sync: borrar cambios grabados', (p) => { p.beatSync.changes = []; p.beatSync.nudges = []; }); }

  /** Pase de fotos al ritmo en toda la canción (sustituye la pista de fotos). */
  makeSlideshow(opts, { keepEngine = false } = {}) {
    const clips = buildSlideshow({ project: this.store.project, analysis: this.analysis, duration: this.store.duration, ...opts });
    this.store.commit('Pase de fotos al ritmo', (p) => {
      p.timeline.tracks.photos = clips;
      if (!keepEngine) p.beatSync.enabled = false; // el pase fijo y el motor Beat-Sync no se usan a la vez
      // con fotos enmarcadas o de fondo hace falta un túnel detrás
      if (opts.look !== 'full' && !p.timeline.tracks.tunnels.length) p.timeline.tracks.tunnels.push({ id: uid('c'), track: 'tunnels', type: 'rings', start: 0, dur: this.store.duration, params: { speed: 0.9, glow: 1.1 } });
    });
    for (const ph of this.store.project.photos) this.ensurePhoto(ph).catch(() => {});
    return clips.length;
  }

  // ---------------------------------------------------------------- Auto Director
  runDirector({ seed, keepFrozen = false, onlySceneId = null, label = 'Generar vídeo' } = {}) {
    const p = this.store.project;
    if (!p.audio) toast('Sin música: genero una composición libre de ' + Math.round(this.store.duration) + ' s. Carga una canción para sincronizar.', false, 4000);
    const s = seed ?? p.director.seed;
    const t0 = performance.now();
    const r = generate({ project: p, analysis: this.analysis, duration: this.store.duration, profileId: p.director.profile, controls: p.director.controls, seed: s, keepFrozen, onlySceneId, regenNonce: (Date.now() & 0xffff) | 1 });
    this.store.commit(label, (pp) => {
      for (const t of TRACKS) pp.timeline.tracks[t] = r.tracks[t];
      pp.director.scenes = r.scenes;
      pp.director.seed = s;
      pp.seed = s;
    }, 'director');
    this.engine.slots.forEach((sl) => sl.clear());
    for (const ph of p.photos) this.ensurePhoto(ph).catch(() => {});
    console.log(`[director] ${(performance.now() - t0).toFixed(0)} ms`, r.summary);
    return r.summary;
  }

  // ---------------------------------------------------------------- acciones de edición
  makeActions() {
    const app = this;
    return {
      addDefaultClip(track, t) {
        const p = app.store.project;
        const beat = 60 / (app.analysis.bpm || 120);
        const dur = track === 'transitions' ? beat * 2 : track === 'photos' ? 4 : beat * 16;
        let clip;
        switch (track) {
          case 'tunnels': clip = { type: p.studio.tunnels[0]?.type || TUNNELS[0].id, params: deepClone(p.studio.tunnels[0]?.params || {}) }; break;
          case 'meshes': clip = { type: p.studio.meshes[0]?.type || MESHES[0].id, params: deepClone(p.studio.meshes[0]?.params || {}) }; break;
          case 'particles': clip = { type: p.studio.particles[0]?.type || PARTICLES[0].id, params: {} }; break;
          case 'equalizers': clip = { type: p.studio.equalizers[0]?.type || EQUALIZERS[0].id, params: deepClone(p.studio.equalizers[0]?.params || {}) }; break;
          case 'photos': if (!p.photos.length) { toast('Primero añade fotografías', true); return; } clip = { type: 'photo', params: { ...schemaDefaults(PHOTO_CLIP_PARAMS), photoId: (p.photos.find((x) => x.id === app.store.selection.photoId) || p.photos[0]).id } }; break;
          case 'transitions': clip = { type: 'fade', params: schemaDefaults(TRANSITION_PARAMS) }; break;
          case 'lighting': clip = { type: 'light', params: { ...schemaDefaults(LIGHTING_PARAMS), palette: p.palette.id || 'cyber' } }; break;
          case 'effects': clip = { type: 'glitch', params: schemaDefaults(EFFECT_PARAMS) }; break;
          default: return;
        }
        let made;
        app.store.commit('Añadir clip', (pp) => { made = addClip(pp, track, { ...clip, start: track === 'transitions' ? t - dur / 2 : t, dur: track === 'photos' ? (p.photos.find((x) => x.id === clip.params.photoId)?.settings?.duration || dur) : dur }); });
        app.store.select({ clipId: made.id, track });
        return made;
      },
      insert(track, type, params, t = app.player.time, dur) {
        const beat = 60 / (app.analysis.bpm || 120);
        let made;
        app.store.commit('Insertar clip', (pp) => { made = addClip(pp, track, { type, params, start: t, dur: dur || beat * 16 }); });
        app.store.select({ clipId: made.id, track });
        return made;
      },
      split() {
        const id = app.store.selection.clipId; const t = app.player.time;
        if (!id) return toast('Selecciona un clip para cortarlo');
        let r; app.store.commit('Cortar clip', (p) => { r = splitClip(p, id, t); });
        if (!r) toast('El cursor debe estar dentro del clip', true);
      },
      duplicate() { const id = app.store.selection.clipId; if (!id) return toast('Selecciona un clip'); let d; app.store.commit('Duplicar clip', (p) => { d = duplicateClip(p, id); }); if (d) app.store.select({ clipId: d.id, track: d.track }); },
      remove() { const id = app.store.selection.clipId; if (!id) return; app.store.commit('Eliminar clip', (p) => removeClip(p, id)); app.store.select({}); },
      marker() { const t = +app.player.time.toFixed(3); app.store.commit('Añadir marcador', (p) => { p.timeline.markers.push(t); p.timeline.markers.sort((a, b) => a - b); }); toast(`Marcador en ${formatTime(t, true)}`); },
      undo() { const l = app.store.undo(); if (l) toast(`Deshecho: ${l}`); },
      redo() { const l = app.store.redo(); if (l) toast(`Rehecho: ${l}`); },
    };
  }

  // ---------------------------------------------------------------- interfaz general
  buildNav() {
    const box = document.getElementById('nav-items');
    for (const s of SECTIONS) {
      const b = el('button', { class: 'nav-btn', 'data-section': s.id, title: s.title, html: `${icon(s.icon)}<span>${s.label}</span>` });
      b.addEventListener('click', () => this.go(s.id));
      box.append(b);
    }
  }
  go(id) {
    const s = SECTIONS.find((x) => x.id === id) || SECTIONS[0];
    this.section = s.id;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === s.id));
    document.getElementById('panel-title').textContent = s.title;
    document.getElementById('panel-sub').textContent = s.sub || '';
    const dock = document.getElementById('timeline-dock');
    dock.classList.toggle('big', s.id === 'timeline');
    if (s.id === 'timeline') dock.classList.remove('collapsed');
    document.body.className = document.body.className.replace(/\bsec-\S+/g, '').trim() + ` sec-${s.id}`;
    if (this.phone) this.timeline.dirty = true;
    if (this.phone) { document.querySelector(`.nav-btn[data-section="${s.id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); document.getElementById('panel-body').scrollTop = 0; }
    this.sectionTick = null;
    if (!s.studio) this.setView('timeline');
    this.renderSection();
    setTimeout(() => this.resizePreview(), 220);
  }
  renderSection() {
    const s = SECTIONS.find((x) => x.id === this.section);
    const body = document.getElementById('panel-body');
    const scroll = body.scrollTop;
    body.innerHTML = '';
    this.sectionTick = null;
    try { s.render(this, body); } catch (e) { console.error(e); body.append(el('p', { class: 'note' }, 'Error en el panel: ' + e.message)); }
    body.scrollTop = scroll;
  }

  bindUI() {
    const $ = (id) => document.getElementById(id);
    $('btn-play').onclick = () => { audioContext().resume?.(); this.player.toggle(); };
    $('btn-stop').onclick = () => { this.player.stop(); this.updateTransport(); this.requestRender(); };
    $('btn-loop').onclick = () => {
      const l = this.player.loop;
      if (!l.enabled) { const t = this.player.time; const a = this.analysis.barStart ? this.analysis.barStart(t + (this.store.project.audio?.trimStart || 0)) - (this.store.project.audio?.trimStart || 0) : t; l.a = Math.max(0, a); l.b = Math.min(this.store.duration, l.a + (60 / this.analysis.bpm) * 16); }
      l.enabled = !l.enabled; this.updateTransport(); this.timeline.dirty = true;
      toast(l.enabled ? `Repetir fragmento ${formatTime(l.a, true)} – ${formatTime(l.b, true)}` : 'Repetición desactivada');
    };
    $('volume').oninput = (e) => this.player.setVolume(parseFloat(e.target.value));
    $('btn-view-mode').onclick = () => { if (this.view.mode === 'studio') this.setView('timeline'); else { const s = SECTIONS.find((x) => x.id === this.section); if (s.studio) this.setView('studio', s.studio(this)); else toast('La vista de estudio está en Túneles, Mallas, Fotografías y Transiciones'); } };
    $('btn-undo').onclick = () => this.actions.undo();
    $('btn-redo').onclick = () => this.actions.redo();
    $('btn-save').onclick = () => this.saveToLibrary();
    $('btn-export-top').onclick = () => this.go('export');
    $('project-name').onchange = (e) => this.store.commit('Renombrar', (p) => { p.name = e.target.value.trim() || 'Proyecto'; });
    $('aspect-select').onchange = (e) => this.store.commit('Cambiar formato', (p) => { p.aspect = e.target.value; }, 'aspect');
    $('quality-select').onchange = (e) => this.setQuality(e.target.value);
    $('tl-snap').onchange = (e) => { this.timeline.snap = e.target.checked; };
    document.querySelectorAll('[data-tl]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.tl;
      if (k === 'split') this.actions.split(); else if (k === 'duplicate') this.actions.duplicate(); else if (k === 'delete') this.actions.remove(); else if (k === 'marker') this.actions.marker();
      else if (k === 'zoom-in') this.timeline.zoom(1.4); else if (k === 'zoom-out') this.timeline.zoom(1 / 1.4); else if (k === 'zoom-fit') this.timeline.zoomFit();
      else if (k === 'toggle') { $('timeline-dock').classList.toggle('collapsed'); setTimeout(() => this.resizePreview(), 230); }
    }));
    $('file-audio').onchange = (e) => { if (e.target.files[0]) this.loadAudioFile(e.target.files[0]); e.target.value = ''; };
    $('file-photos').onchange = (e) => { if (e.target.files.length) this.addPhotoFiles(e.target.files); e.target.value = ''; };
    $('file-project').onchange = (e) => { if (e.target.files[0]) this.importProjectFile(e.target.files[0]); e.target.value = ''; };
    // Barra de desplazamiento con forma de onda
    const sc = $('scrub-canvas');
    const seekAt = (e) => { const r = sc.getBoundingClientRect(); this.player.seek(clamp((e.clientX - r.left) / r.width) * this.store.duration); };
    sc.addEventListener('pointerdown', (e) => { sc.setPointerCapture(e.pointerId); this._scrub = true; seekAt(e); });
    sc.addEventListener('pointermove', (e) => { if (this._scrub) seekAt(e); });
    sc.addEventListener('pointerup', () => { this._scrub = false; });
    // Arrastrar y soltar archivos
    let dragN = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragN = 0; document.body.classList.remove('dragging');
      const files = [...(e.dataTransfer?.files || [])];
      const audio = files.find((f) => f.type.startsWith('audio/') || /\.(mp3|wav|aac|m4a|flac|ogg)$/i.test(f.name));
      const proj = files.find((f) => /\.neonverse$/i.test(f.name));
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (proj) this.importProjectFile(proj);
      if (audio) this.loadAudioFile(audio);
      if (imgs.length) this.addPhotoFiles(imgs);
    });
    // Atajos de teclado
    window.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.actions.undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.actions.redo(); }
      else if (mod && k === 's') { e.preventDefault(); this.saveToLibrary(); }
      else if (k === ' ') { e.preventDefault(); audioContext().resume?.(); this.player.toggle(); }
      else if (k === 'delete' || k === 'backspace') { if (this.store.selection.clipId) { e.preventDefault(); this.actions.remove(); } }
      else if (k === 's' && !mod) this.actions.split();
      else if (k === 'd' && !mod) this.actions.duplicate();
      else if (k === 'm' && !mod) this.actions.marker();
      else if (k === 'n' && !mod) this.bsNudge(1);
      else if (k === 'b' && !mod) this.bsNudge(-1);
      else if (k === 'home') this.player.seek(0);
      else if (k === 'arrowleft') this.player.seek(this.player.time - (e.shiftKey ? 5 : 60 / this.analysis.bpm));
      else if (k === 'arrowright') this.player.seek(this.player.time + (e.shiftKey ? 5 : 60 / this.analysis.bpm));
    });
    window.addEventListener('beforeunload', () => { this.autosave(); });
    this.updateHistoryButtons();
  }

  drawScrub(t) {
    const cv = document.getElementById('scrub-canvas');
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); this._scrubBg = null; }
    const g = cv.getContext('2d');
    const key = `${this.store.version}|${W}|${this.analysis.bpm}|${this.analysis.synthetic}`;
    if (!this._scrubBg || this._scrubKey !== key) {
      const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height;
      const o = off.getContext('2d');
      o.fillStyle = '#0c0920'; o.fillRect(0, 0, off.width, off.height);
      if (!this.analysis.synthetic) {
        const trim = this.store.project.audio?.trimStart || 0;
        const wf = this.analysis.waveform(off.width, trim, trim + this.store.duration);
        const grd = o.createLinearGradient(0, 0, off.width, 0);
        grd.addColorStop(0, '#00f0ff'); grd.addColorStop(0.5, '#8a2bff'); grd.addColorStop(1, '#ff2bd6');
        o.fillStyle = grd;
        for (let i = 0; i < off.width; i++) { const h = Math.max(1, wf[i] * off.height * 0.9); o.fillRect(i, (off.height - h) / 2, 1, h); }
      }
      this._scrubBg = off; this._scrubKey = key;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this._scrubBg, 0, 0);
    const x = (t / this.store.duration) * cv.width;
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, 0, cv.width - x, cv.height);
    g.fillStyle = '#fff'; g.fillRect(x - 1, 0, 2 * dpr, cv.height);
  }
}

const app = new App();
app.init().then(() => selftest(app)).catch((e) => { console.error(e); const m = document.getElementById('boot-msg'); if (m) m.textContent = 'Error al iniciar: ' + e.message; });

/** Autoprueba: abre el ejemplo con música, genera y exporta 4 s reales. Se activa con ?selftest=salida.mp4 */
async function selftest(app) {
  const q = new URLSearchParams(location.search).get('selftest');
  if (!q) return;
  const done = (r) => (window.neonDesktop?.selftestDone ? window.neonDesktop.selftestDone(r) : console.log('[selftest]', JSON.stringify(r)));
  try {
    const proj = await (await fetch('examples/demo-neon-techno.neonverse')).json();
    await app.importProjectData(proj);
    console.log('[selftest] proyecto', app.store.project.name, JSON.stringify(app.store.project.timeline.tracks.tunnels.slice(0, 2).map((c) => [c.type, c.start])));
    const caps = await app.exporter.capabilities();
    const [qPath, qa, qb, qw, qh, qbs] = q.split('|');
    if (qbs) { app.bsSet({ enabled: true, transition: 'cut' }); app.bsMode(qbs); console.log('[selftest] beatsync', JSON.stringify(app.bsEvents().map((e) => +e.t.toFixed(3)))); }
    const out = qPath.replace(/\\/g, '/');
    const folder = out.includes('/') ? out.slice(0, out.lastIndexOf('/')) : undefined;
    const name = out.slice(out.lastIndexOf('/') + 1).replace(/\.mp4$/i, '');
    let clipRange = null, clipFade = 0;
    if (/^clip\d+$/.test(qa || '')) { const { exportRange } = await import('./export/Exporter.js'); clipRange = exportRange({ total: app.store.duration, duration: +qa.slice(4), start: 'drop', analysis: app.analysis, trimStart: app.store.project.audio?.trimStart || 0 }); clipFade = 0.8; console.log('[selftest] tramo', JSON.stringify(clipRange)); }
    const r = await app.exporter.run({ fadeOut: clipFade, width: parseInt(qw, 10) || 540, height: parseInt(qh, 10) || 960, fps: 30, codec: 'h264', encoder: 'cpu', quality: 'normal', audioBitrate: 192, fileName: name, folder, range: clipRange || [Number.isFinite(parseFloat(qa)) ? +qa : 10, Number.isFinite(parseFloat(qb)) ? +qb : 14] });
    done({ ok: true, caps, ...r });
  } catch (e) { done({ ok: false, error: String(e.stack || e) }); }
}
export default app;
