// Editor visual de la línea de tiempo multipista (lienzo). Ratón y táctil.
import { TRACKS, TRACK_LABELS } from '../core/store.js';
import { computeLanes, moveClip, resizeClip, getClip } from './model.js';
import { TUNNEL_BY_ID } from '../studios/tunnels.js';
import { MESH_BY_ID } from '../studios/meshes.js';
import { PARTICLE_BY_ID } from '../studios/particles.js';
import { EQ_BY_ID } from '../studios/equalizers.js';
import { TRANSITION_BY_ID } from '../studios/transitions.js';
import { EFFECT_BY_ID } from '../studios/effects.js';
import { FILTER_LABELS } from '../studios/photos.js';
import { formatTime } from '../core/util.js';
import { SECTION_NAMES } from '../director/AutoDirector.js';

const HEAD = 96, RULER = 22, MUSIC_H = 44, LANE_H = 22;
const COLORS = {
  photos: '#ffb020', tunnels: '#00e5ff', meshes: '#8a5cff', equalizers: '#5fd8ff', particles: '#4dffb5', transitions: '#ff2bd6', lighting: '#ffe14d', effects: '#ff5e7a',
};
const SECTION_COLORS = { intro: '#2b6cff', verse: '#5a3cff', build: '#c03cff', drop: '#ff2b8a', break: '#1fb6c9', outro: '#2b6cff' };

export function clipLabel(c, project) {
  switch (c.track) {
    case 'tunnels': return TUNNEL_BY_ID[c.type]?.label || c.type;
    case 'meshes': return MESH_BY_ID[c.type]?.label || c.type;
    case 'particles': return PARTICLE_BY_ID[c.type]?.label || c.type;
    case 'equalizers': return 'Ecualizador ' + (EQ_BY_ID[c.type]?.label || c.type);
    case 'transitions': return TRANSITION_BY_ID[c.type]?.label || c.type;
    case 'effects': return c.type === 'filter' ? `Filtro ${FILTER_LABELS[c.params?.filter] || ''}` : EFFECT_BY_ID[c.type]?.label || c.type;
    case 'lighting': return `Luz · ${c.params?.palette || ''}`;
    case 'photos': { const ph = project.photos.find((p) => p.id === c.params?.photoId); return ph ? ph.name : 'Foto'; }
    default: return c.type;
  }
}

export class TimelineView {
  constructor(canvas, app) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.pps = 30; // píxeles por segundo
    this.scrollX = 0;
    this.scrollY = 0;
    this.drag = null;
    this.dirty = true;
    this.snap = true;
    this.rows = [];
    this.thumbs = new Map();
    this._resize = new ResizeObserver(() => { this.dirty = true; this.fitIfNeeded(); });
    this._resize.observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.fitted = false;
  }
  get duration() { return this.app.store.duration; }
  fitIfNeeded() { if (!this.fitted && this.cv.clientWidth > 50) { this.zoomFit(); this.fitted = true; } }
  zoomFit() { const w = Math.max(100, this.cv.clientWidth - HEAD - 10); this.pps = Math.max(2, w / Math.max(1, this.duration)); this.scrollX = 0; this.dirty = true; }
  zoom(f, anchorX = null) {
    const ax = anchorX ?? (this.cv.clientWidth - HEAD) / 2;
    const tAt = (ax + this.scrollX) / this.pps;
    this.pps = Math.min(600, Math.max(1, this.pps * f));
    this.scrollX = Math.max(0, tAt * this.pps - ax);
    this.dirty = true;
  }
  x2t(x) { return (x - HEAD + this.scrollX) / this.pps; }
  t2x(t) { return HEAD + t * this.pps - this.scrollX; }

  /** Ajuste al golpe más cercano (si el imán está activo y hay análisis). */
  snapTime(t, px = 9) {
    if (!this.snap) return t;
    const a = this.app.analysis, trim = this.app.store.project.audio?.trimStart || 0;
    const cands = [0, this.app.player.time];
    if (a) { const bp = a.beatPos(t + trim); cands.push(a.beatTime(Math.round(bp)) - trim); }
    for (const m of this.app.store.project.timeline.markers) cands.push(m);
    let best = t, bd = px / this.pps;
    for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  layout() {
    const p = this.app.store.project;
    this.rows = [];
    let y = RULER + MUSIC_H - this.scrollY;
    for (const tr of TRACKS) {
      const { lanes, count } = computeLanes(p.timeline.tracks[tr]);
      const h = count * LANE_H + 6;
      this.rows.push({ track: tr, y, h, lanes });
      y += h;
    }
    this.contentH = y + this.scrollY;
  }

  hit(x, y) {
    if (y < RULER) return { area: 'ruler' };
    if (y < RULER + MUSIC_H) return { area: 'music' };
    if (x < HEAD) { const r = this.rows.find((r) => y >= r.y && y < r.y + r.h); return { area: 'head', row: r }; }
    const r = this.rows.find((r) => y >= r.y && y < r.y + r.h);
    if (!r) return { area: 'empty' };
    const clips = this.app.store.project.timeline.tracks[r.track];
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i];
      const lane = r.lanes.get(c.id) || 0;
      const cy = r.y + 3 + lane * LANE_H;
      const x0 = this.t2x(c.start), x1 = this.t2x(c.start + c.dur);
      if (x >= x0 - 3 && x <= x1 + 3 && y >= cy && y < cy + LANE_H - 2) {
        const edge = x1 - x0 > 16 ? (x - x0 < 7 ? 'left' : x1 - x < 7 ? 'right' : 'body') : 'body';
        return { area: 'clip', clip: c, row: r, edge };
      }
    }
    return { area: 'track', row: r };
  }

  onDown(e) {
    const rect = this.cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    this.cv.setPointerCapture(e.pointerId);
    const h = this.hit(x, y);
    const store = this.app.store;
    if (h.area === 'ruler' || h.area === 'music') { this.drag = { kind: 'seek' }; this.app.player.seek(Math.max(0, this.x2t(x))); return; }
    if (h.area === 'clip') {
      store.select({ clipId: h.clip.id, track: h.row.track });
      this.drag = { kind: h.edge, id: h.clip.id, x0: x, start: h.clip.start, dur: h.clip.dur, moved: false };
      this.dirty = true;
      return;
    }
    if (h.area === 'track' || h.area === 'empty' || h.area === 'head') {
      store.select({});
      this.drag = { kind: 'pan', x0: x, y0: y, sx: this.scrollX, sy: this.scrollY, tap: true, t: this.x2t(x) };
      this.dirty = true;
    }
  }
  onMove(e) {
    const rect = this.cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const d = this.drag;
    if (!d) {
      const h = this.hit(x, y);
      this.cv.style.cursor = h.area === 'clip' ? (h.edge === 'body' ? 'grab' : 'ew-resize') : h.area === 'ruler' || h.area === 'music' ? 'pointer' : 'default';
      return;
    }
    if (d.kind === 'seek') { this.app.player.seek(Math.max(0, this.x2t(x))); return; }
    if (d.kind === 'pan') {
      if (Math.abs(x - d.x0) + Math.abs(y - d.y0) > 4) d.tap = false;
      this.scrollX = Math.max(0, d.sx - (x - d.x0));
      const maxY = Math.max(0, this.contentH - this.cv.clientHeight);
      this.scrollY = Math.min(maxY, Math.max(0, d.sy - (y - d.y0)));
      this.dirty = true;
      return;
    }
    const dt = (x - d.x0) / this.pps;
    if (Math.abs(x - d.x0) > 2) d.moved = true;
    if (!d.moved) return;
    const store = this.app.store;
    store.live((p) => {
      if (d.kind === 'body') moveClip(p, d.id, this.snapTime(d.start + dt));
      else if (d.kind === 'left') { const s = Math.min(d.start + d.dur - 0.1, this.snapTime(d.start + dt)); resizeClip(p, d.id, s, d.start + d.dur - s); }
      else if (d.kind === 'right') { const end = Math.max(d.start + 0.1, this.snapTime(d.start + d.dur + dt)); resizeClip(p, d.id, d.start, end - d.start); }
    }, 'timeline');
    this.dirty = true;
  }
  onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'pan' && d.tap) this.app.player.seek(Math.max(0, d.t));
    if ((d.kind === 'body' || d.kind === 'left' || d.kind === 'right') && d.moved) this.app.store.settle(d.kind === 'body' ? 'Mover clip' : 'Cambiar duración');
  }
  onDouble(e) {
    const rect = this.cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const h = this.hit(x, y);
    if (h.area === 'track') this.app.actions.addDefaultClip(h.row.track, this.snapTime(this.x2t(x)));
  }
  onWheel(e) {
    e.preventDefault();
    const rect = this.cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) { this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left - HEAD); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.scrollX = Math.max(0, this.scrollX + (e.deltaX || e.deltaY));
    else { const maxY = Math.max(0, this.contentH - this.cv.clientHeight); this.scrollY = Math.min(maxY, Math.max(0, this.scrollY + e.deltaY)); }
    this.dirty = true;
  }

  /** Mantiene visible el cursor de reproducción. */
  follow(t) {
    const x = this.t2x(t), w = this.cv.clientWidth;
    if (x > w - 40 || x < HEAD) { this.scrollX = Math.max(0, t * this.pps - (w - HEAD) * 0.25); this.dirty = true; }
  }

  draw(t) {
    const cv = this.cv, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    this.layout();
    const store = this.app.store, p = store.project, a = this.app.analysis;
    const dur = this.duration, trim = p.audio?.trimStart || 0;
    // Fondo de secciones y rejilla de compases
    g.fillStyle = '#070512'; g.fillRect(0, 0, W, H);
    if (a) {
      for (const s of a.sections) {
        const x0 = this.t2x(s.start - trim), x1 = this.t2x(s.end - trim);
        if (x1 < HEAD || x0 > W) continue;
        g.fillStyle = (SECTION_COLORS[s.type] || '#444') + '14';
        g.fillRect(Math.max(HEAD, x0), RULER, x1 - Math.max(HEAD, x0), H);
      }
      const beatPx = (60 / a.bpm) * this.pps;
      const stepBeats = beatPx > 14 ? 1 : beatPx * 4 > 14 ? 4 : 16;
      const b0 = Math.ceil(a.beatPos(this.x2t(HEAD) + trim) / stepBeats) * stepBeats;
      for (let b = b0; ; b += stepBeats) {
        const tt = a.beatTime(b) - trim; const x = this.t2x(tt);
        if (x > W || tt > dur) break;
        const isBar = ((b - (a.d?.downbeat || 0)) % 4 + 4) % 4 === 0;
        g.strokeStyle = isBar ? 'rgba(140,110,255,0.16)' : 'rgba(140,110,255,0.06)';
        g.beginPath(); g.moveTo(x + 0.5, RULER); g.lineTo(x + 0.5, H); g.stroke();
      }
    }
    // Escenas del director
    for (const s of p.director.scenes || []) {
      const x = this.t2x(s.start);
      if (x < HEAD || x > W) continue;
      g.strokeStyle = s.frozen ? 'rgba(120,220,255,0.55)' : 'rgba(255,255,255,0.08)';
      g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x + 0.5, RULER); g.lineTo(x + 0.5, H); g.stroke(); g.setLineDash([]);
    }
    // Música: forma de onda + recorte
    const my = RULER;
    g.fillStyle = '#0c0920'; g.fillRect(HEAD, my, W - HEAD, MUSIC_H);
    if (a && !a.synthetic) {
      const cols = Math.max(1, Math.floor(W - HEAD));
      const t0 = this.x2t(HEAD) + trim, t1 = this.x2t(W) + trim;
      const wf = a.waveform(cols, Math.max(0, t0), t1);
      const grd = g.createLinearGradient(HEAD, 0, W, 0);
      grd.addColorStop(0, '#00f0ff'); grd.addColorStop(0.5, '#8a2bff'); grd.addColorStop(1, '#ff2bd6');
      g.fillStyle = grd;
      const mid = my + MUSIC_H / 2;
      for (let i = 0; i < cols; i++) {
        const tt = (t0 + (t1 - t0) * (i / cols)) - trim;
        if (tt < 0 || tt > dur) continue;
        const hh = Math.max(1, wf[i] * (MUSIC_H - 8) / 2);
        g.fillRect(HEAD + i, mid - hh, 1, hh * 2);
      }
    } else {
      g.fillStyle = '#5d55a0'; g.font = '11px system-ui'; g.fillText(p.audio ? 'Analizando…' : 'Sin música (doble clic en Música para cargar)', HEAD + 8, my + MUSIC_H / 2 + 4);
    }
    // Pistas
    for (const r of this.rows) {
      if (r.y > H || r.y + r.h < RULER + MUSIC_H) continue;
      g.fillStyle = 'rgba(255,255,255,0.015)'; g.fillRect(HEAD, r.y, W - HEAD, r.h);
      g.strokeStyle = 'rgba(140,110,255,0.12)'; g.beginPath(); g.moveTo(0, r.y + r.h + 0.5); g.lineTo(W, r.y + r.h + 0.5); g.stroke();
      const col = COLORS[r.track];
      for (const c of p.timeline.tracks[r.track]) {
        const x0 = this.t2x(c.start), x1 = this.t2x(c.start + c.dur);
        if (x1 < HEAD || x0 > W) continue;
        const lane = r.lanes.get(c.id) || 0, cy = r.y + 3 + lane * LANE_H;
        const sel = store.selection.clipId === c.id;
        const xa = Math.max(HEAD, x0), w = Math.max(2, x1 - xa - 1);
        g.fillStyle = col + (sel ? 'bb' : '55');
        roundRect(g, xa, cy, w, LANE_H - 3, 5); g.fill();
        g.strokeStyle = sel ? '#ffffff' : col; g.lineWidth = sel ? 1.6 : 1;
        roundRect(g, xa + 0.5, cy + 0.5, w - 1, LANE_H - 4, 5); g.stroke();
        if (w > 26) {
          g.save(); g.beginPath(); g.rect(xa + 3, cy, w - 6, LANE_H); g.clip();
          g.fillStyle = sel ? '#fff' : '#e8e4ff'; g.font = '10.5px system-ui';
          g.fillText((p.director.scenes?.find((s) => s.id === c.sceneId)?.frozen ? '❄ ' : '') + clipLabel(c, p), xa + 5, cy + 13);
          g.restore();
        }
      }
    }
    // Cabeceras
    g.fillStyle = '#0a0718'; g.fillRect(0, RULER, HEAD, H);
    g.font = '11px system-ui'; g.fillStyle = '#cfc8ff';
    g.fillText('🎵 ' + TRACK_LABELS.music, 8, RULER + MUSIC_H / 2 + 4);
    for (const r of this.rows) {
      if (r.y + r.h < RULER + MUSIC_H || r.y > H) continue;
      g.fillStyle = COLORS[r.track]; g.fillRect(0, Math.max(r.y, RULER + MUSIC_H), 3, r.h);
      g.fillStyle = '#cfc8ff'; g.fillText(TRACK_LABELS[r.track], 9, Math.max(r.y, RULER + MUSIC_H) + 15);
    }
    g.strokeStyle = 'rgba(140,110,255,0.25)'; g.beginPath(); g.moveTo(HEAD + 0.5, 0); g.lineTo(HEAD + 0.5, H); g.stroke();
    // Regla
    g.fillStyle = '#0d0a22'; g.fillRect(0, 0, W, RULER);
    const step = niceStep(70 / this.pps);
    g.fillStyle = '#9b93c9'; g.font = '10px ui-monospace, monospace';
    for (let s = Math.floor(this.x2t(HEAD) / step) * step; s <= dur; s += step) {
      const x = this.t2x(s); if (x < HEAD) continue; if (x > W) break;
      g.fillRect(x, RULER - 6, 1, 6); g.fillText(formatTime(s), x + 3, 13);
    }
    if (a) {
      for (const s of a.sections) { const x = this.t2x(s.start - trim); if (x >= HEAD && x < W) { g.fillStyle = SECTION_COLORS[s.type] || '#888'; g.fillText(SECTION_NAMES[s.type] || s.type, x + 3, RULER + 11 + MUSIC_H - 14); } }
    }
    if (this.app.bsActive?.()) { // cambios de foto del Beat-Sync: marcas sobre la música
      g.fillStyle = '#ffb020';
      for (const e of this.app.bsEvents()) { const x = this.t2x(e.t); if (x < HEAD) continue; if (x > W) break; g.fillRect(x, RULER + MUSIC_H - (e.manual ? 12 : 6), e.manual ? 2 : 1, e.manual ? 12 : 6); }
    }
    for (const m of p.timeline.markers) { const x = this.t2x(m); if (x < HEAD || x > W) continue; g.fillStyle = '#ffe14d'; g.beginPath(); g.moveTo(x, RULER - 1); g.lineTo(x - 5, RULER - 8); g.lineTo(x, RULER - 15); g.lineTo(x + 5, RULER - 8); g.fill(); }
    // Fin de la canción
    const xe = this.t2x(dur);
    if (xe < W) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(xe, RULER, W - xe, H); }
    // Fragmento en bucle
    const loop = this.app.player.loop;
    if (loop.enabled) { g.fillStyle = 'rgba(0,240,255,0.08)'; g.fillRect(this.t2x(loop.a), 0, (loop.b - loop.a) * this.pps, H); }
    // Cursor
    const px = this.t2x(t);
    if (px >= HEAD && px <= W) { g.fillStyle = '#ffffff'; g.fillRect(px - 0.5, 0, 1.5, H); g.fillStyle = '#00f0ff'; g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.fill(); }
    this.dirty = false;
  }
}

function niceStep(s) { for (const v of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (v >= s) return v; return 600; }
function roundRect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
