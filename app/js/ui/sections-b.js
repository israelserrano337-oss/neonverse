// Paneles: Música, Sincronización, Línea de tiempo, Paletas, Exportador, Biblioteca, Ajustes.
import { el, slider, select, toggle, color, button, group, hint, note, btnRow, paramsForm, toast, modal, promptText } from './controls.js';
import { SYNC_MODULES, TRACKS, TRACK_LABELS } from '../core/store.js';
import { uid, deepClone, withDefaults, formatTime, clamp } from '../core/util.js';
import { SECTION_NAMES } from '../director/AutoDirector.js';
import { TUNNELS, TUNNEL_PARAMS, TUNNEL_BY_ID } from '../studios/tunnels.js';
import { MESHES, MESH_PARAMS, MESH_BY_ID } from '../studios/meshes.js';
import { PARTICLES, PARTICLE_PARAMS, PARTICLE_BY_ID } from '../studios/particles.js';
import { EQUALIZERS, EQ_PARAMS, EQ_BY_ID } from '../studios/equalizers.js';
import { PHOTO_CLIP_PARAMS } from '../studios/photos.js';
import { TRANSITIONS, TRANSITION_PARAMS } from '../studios/transitions.js';
import { EFFECTS, EFFECT_PARAMS, LIGHTING_PARAMS } from '../studios/effects.js';
import { PALETTE_PRESETS, PALETTE_PARAMS, allPalettes } from '../studios/palettes.js';
import { EXPORT_PRESETS, RESOLUTIONS, QUALITIES, DURATIONS, STARTS, outputSize, bitrateFor, exportRange } from '../export/Exporter.js';
import { clipLabel } from '../timeline/TimelineView.js';
import { isIOS, shareVideo } from '../export/mobile.js';
import { removeClip, splitClip, duplicateClip } from '../timeline/model.js';

const $f = (id) => document.getElementById(id);

// ================================================================ MÚSICA
export function renderMusic(app, body) {
  const p = app.store.project, a = p.audio;
  body.append(btnRow(button(a ? '🎵 Cambiar canción' : '🎵 Cargar canción', () => $f('file-audio').click(), 'neon-btn small')), hint('MP3, WAV, AAC/M4A y FLAC si el sistema los admite. Se analiza en tu equipo: duración, BPM, graves/medios/agudos, golpes y secciones.'));
  if (!a) { body.append(note('Sin música. La composición dura ' + Math.round(app.store.duration) + ' s.'), slider({ label: 'Duración sin música (s)', min: 5, max: 600, step: 1, value: p.duration, onChange: (v) => app.store.commit('Duración', (pp) => { pp.duration = v; }, 'aspect') })); return; }
  body.append(group('Información', true, el('div', { class: 'kv' },
    el('b', {}, 'Archivo'), el('span', {}, a.name), el('b', {}, 'Duración total'), el('span', {}, formatTime(a.duration, true)),
    el('b', {}, 'Fragmento usado'), el('span', {}, `${formatTime(a.trimStart, true)} → ${formatTime(a.trimEnd, true)} (${formatTime(app.store.duration, true)})`),
    el('b', {}, 'BPM'), el('span', {}, `${app.analysis.bpm} (confianza ${Math.round((app.analysis.d.tempoConfidence || 0) * 100)} %)`),
    el('b', {}, 'Golpes'), el('span', {}, String(app.analysis.beats.length)))));
  // Forma de onda con selector de inicio/final y marcadores
  const wave = el('canvas', { class: 'wave' });
  let drag = null;
  const draw = () => {
    const W = wave.clientWidth, H = wave.clientHeight; if (!W) return;
    const dpr = Math.min(2, devicePixelRatio || 1); wave.width = W * dpr; wave.height = H * dpr;
    const g = wave.getContext('2d'); g.scale(dpr, dpr);
    const wf = app.analysis.waveform(W, 0, a.duration);
    const grd = g.createLinearGradient(0, 0, W, 0); grd.addColorStop(0, '#00f0ff'); grd.addColorStop(0.5, '#8a2bff'); grd.addColorStop(1, '#ff2bd6');
    g.fillStyle = grd;
    for (let i = 0; i < W; i++) { const h = Math.max(1, wf[i] * H * 0.9); g.fillRect(i, (H - h) / 2, 1, h); }
    const x0 = (a.trimStart / a.duration) * W, x1 = (a.trimEnd / a.duration) * W;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, x0, H); g.fillRect(x1, 0, W - x1, H);
    g.fillStyle = '#3dffb0'; g.fillRect(x0 - 1, 0, 3, H); g.fillStyle = '#ff4d6d'; g.fillRect(x1 - 1, 0, 3, H);
    for (const m of p.timeline.markers) { const x = ((m + a.trimStart) / a.duration) * W; g.fillStyle = '#ffe14d'; g.fillRect(x, 0, 1.5, H); }
    for (const s of app.analysis.sections) { const x = (s.start / a.duration) * W; g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '9px system-ui'; g.fillText(SECTION_NAMES[s.type] || s.type, x + 2, 10); g.fillRect(x, 0, 1, 12); }
    const xp = ((app.player.time + a.trimStart) / a.duration) * W; g.fillStyle = '#fff'; g.fillRect(xp, 0, 1.5, H);
  };
  const tAt = (e) => clamp((e.clientX - wave.getBoundingClientRect().left) / wave.clientWidth) * a.duration;
  wave.addEventListener('pointerdown', (e) => {
    wave.setPointerCapture(e.pointerId);
    const t = tAt(e), px = 10 / wave.clientWidth * a.duration;
    drag = Math.abs(t - a.trimStart) < px ? 'start' : Math.abs(t - a.trimEnd) < px ? 'end' : 'seek';
    if (drag === 'seek') app.player.seek(t - a.trimStart);
  });
  wave.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = tAt(e);
    if (drag === 'seek') app.player.seek(t - a.trimStart);
    else app.store.live((pp) => { if (drag === 'start') pp.audio.trimStart = Math.min(t, pp.audio.trimEnd - 1); else pp.audio.trimEnd = Math.max(t, pp.audio.trimStart + 1); }, 'trim');
    draw();
  });
  wave.addEventListener('pointerup', () => { if (drag === 'start' || drag === 'end') { app.store.settle('Recortar música'); app.store._changed('aspect'); } drag = null; });
  body.append(group('Forma de onda · selector de inicio (verde) y final (rojo)', true, wave,
    btnRow(button('Inicio aquí', () => { app.store.commit('Inicio de la música', (pp) => { pp.audio.trimStart = Math.min(pp.audio.trimStart + app.player.time, pp.audio.trimEnd - 1); }, 'aspect'); }), button('Final aquí', () => { app.store.commit('Final de la música', (pp) => { pp.audio.trimEnd = Math.max(pp.audio.trimStart + app.player.time, pp.audio.trimStart + 1); }, 'aspect'); }), button('Canción completa', () => app.store.commit('Canción completa', (pp) => { pp.audio.trimStart = 0; pp.audio.trimEnd = pp.audio.duration; }, 'aspect'))),
    hint('Cambiar el inicio desplaza la música respecto a la composición: vuelve a generar con el Auto Director para reencajar.')));
  requestAnimationFrame(draw);
  // Reproductor
  body.append(group('Reproductor', true,
    btnRow(button('▶ / ❚❚', () => app.player.toggle()), button('■ Detener', () => app.player.stop()), button('⟲ Fragmento', () => $f('btn-loop').click())),
    slider({ label: 'Volumen', min: 0, max: 1, step: 0.01, value: app.player.volume, onInput: (v) => { app.player.setVolume(v); $f('volume').value = v; } }),
    loopEditor(app)));
  // Marcadores
  const ml = el('div', { class: 'list' });
  for (const m of p.timeline.markers) ml.append(el('div', { class: 'list-item' }, el('span', { class: 'grow mono', style: { cursor: 'pointer' }, onclick: () => app.player.seek(m) }, '◆ ' + formatTime(m, true)), button('✕', () => { app.store.commit('Quitar marcador', (pp) => { pp.timeline.markers = pp.timeline.markers.filter((x) => x !== m); }); app.renderSection(); })));
  body.append(group(`Marcadores (${p.timeline.markers.length})`, false, btnRow(button('◆ Marcador en el cursor (M)', () => { app.actions.marker(); app.renderSection(); }), button('Marcadores en cada sección', () => { app.store.commit('Marcadores de sección', (pp) => { pp.timeline.markers = [...new Set(app.analysis.sections.map((s) => +(s.start - a.trimStart).toFixed(3)).filter((x) => x >= 0 && x < app.store.duration))].sort((x, y) => x - y); }); app.renderSection(); })), ml));
  // Secciones
  const sl = el('div', { class: 'list' });
  app.analysis.sections.forEach((s) => sl.append(el('div', { class: 'list-item', style: { cursor: 'pointer' }, onclick: () => app.player.seek(Math.max(0, s.start - a.trimStart)) }, el('span', { class: 'section-tag' }, SECTION_NAMES[s.type] || s.type), el('span', { class: 'grow mono' }, `${formatTime(s.start, true)} – ${formatTime(s.end, true)}`), el('span', { class: 'dim' }, `energía ${Math.round(s.energy * 100)}%`))));
  body.append(group('Secciones detectadas', false, sl));
  // Analizador de frecuencias
  const meter = el('div', { class: 'meter' });
  const bars = []; for (let i = 0; i < 32; i++) { const b = el('i'); bars.push(b); meter.append(b); }
  const bands = el('div', { class: 'kv mono' });
  body.append(group('Analizador de frecuencias', true, meter, bands));
  app.sectionTick = (t, au) => {
    for (let i = 0; i < 32; i++) bars[i].style.height = `${Math.round(au.spectrum[i] * 100)}%`;
    bands.innerHTML = `<b>Graves</b><span>${bar(au.bass)}</span><b>Medios</b><span>${bar(au.mid)}</span><b>Agudos</b><span>${bar(au.treble)}</span><b>Golpe</b><span>${bar(au.beat)}</span><b>Compás</b><span>${au.bar + 1} · tiempo ${Math.floor(((au.beatPos % 4) + 4) % 4) + 1}</span>`;
    if (app.player.playing) draw();
  };
  body.append(btnRow(button('Reanalizar', async () => { if (!app.audioBuffer) return; await app.setAudioBuffer(app.audioBuffer, true); app.store.commit('Reanalizar', (pp) => { pp.audio.bpm = app.analysis.bpm; }); app.renderSection(); })));
}
const bar = (v) => '▮'.repeat(Math.round(clamp(v) * 12)).padEnd(12, '·');
function loopEditor(app) {
  const l = app.player.loop;
  return el('div', {}, hint('Fragmento A-B para repetir mientras editas:'),
    slider({ label: 'Inicio A (s)', min: 0, max: app.store.duration, step: 0.01, value: l.a, onInput: (v) => { l.a = v; app.timeline.dirty = true; } }),
    slider({ label: 'Final B (s)', min: 0, max: app.store.duration, step: 0.01, value: l.b || Math.min(8, app.store.duration), onInput: (v) => { l.b = v; app.timeline.dirty = true; } }));
}

// ================================================================ SINCRONIZACIÓN
export function renderSync(app, body) {
  const s = app.store.project.sync;
  const live = (fn, label) => [(v) => app.store.live((pp) => fn(pp.sync, v)), () => app.store.settle(label)];
  const [g1, g2] = live((sy, v) => { sy.global = v; }, 'Sensibilidad global');
  const [o1, o2] = live((sy, v) => { sy.offsetMs = v; }, 'Desfase');
  const [s1, s2] = live((sy, v) => { sy.smoothing = v; }, 'Suavizado');
  body.append(group('General', true,
    slider({ label: 'Sensibilidad global', min: 0, max: 2, step: 0.01, value: s.global, onInput: g1, onChange: g2 }),
    slider({ label: 'Desfase visual (ms, + retrasa la imagen)', min: -300, max: 300, step: 5, value: s.offsetMs, onInput: o1, onChange: o2 }),
    slider({ label: 'Suavizado (evita parpadeos)', min: 0, max: 1, step: 0.01, value: s.smoothing, onInput: s1, onChange: s2 }),
    note('Los pulsos van anclados a la rejilla de golpes con envolventes suaves: el ritmo se nota sin destellos bruscos.')));
  for (const [k, label] of SYNC_MODULES) {
    const m = s.modules[k];
    const mk = (key, lab) => slider({ label: lab, min: 0, max: 2, step: 0.01, value: m[key], onInput: (v) => app.store.live((pp) => { pp.sync.modules[k][key] = v; }), onChange: () => app.store.settle(`${label}: ${lab}`) });
    body.append(group(label, false, toggle({ label: 'Reacciona a la música', value: m.enabled, onChange: (v) => app.store.commit(`${label}: sincronía`, (pp) => { pp.sync.modules[k].enabled = v; }) }), mk('bass', 'Graves'), mk('mid', 'Medios'), mk('treble', 'Agudos'), mk('beat', 'Golpes')));
  }
  body.append(group('Línea de tiempo', true, toggle({ label: 'Imán al ritmo al mover clips', value: app.timeline.snap, onChange: (v) => { app.timeline.snap = v; $f('tl-snap').checked = v; } }), toggle({ label: 'Seguir el cursor al reproducir', value: app.prefs.followPlayhead, onChange: (v) => { app.prefs.followPlayhead = v; app.savePrefs(); } })));
}

// ================================================================ LÍNEA DE TIEMPO (inspector)
const SCHEMAS = { tunnels: [TUNNELS, TUNNEL_PARAMS, TUNNEL_BY_ID], meshes: [MESHES, MESH_PARAMS, MESH_BY_ID], equalizers: [EQUALIZERS, EQ_PARAMS, EQ_BY_ID], particles: [PARTICLES, PARTICLE_PARAMS, PARTICLE_BY_ID] };
export function renderTimeline(app, body) {
  const p = app.store.project;
  body.append(hint('Arrastra un clip para moverlo, sus bordes para cambiar la duración. Doble clic en una pista vacía para añadir. Ctrl+rueda para zoom.'));
  const add = el('div', { class: 'btn-row' });
  for (const t of TRACKS) add.append(button('＋ ' + TRACK_LABELS[t], () => app.actions.addDefaultClip(t, app.player.time)));
  body.append(group('Añadir en el cursor', true, add));
  const id = app.store.selection.clipId;
  const c = id ? app.store.findClip(id) : null;
  if (!c) {
    const counts = TRACKS.map((t) => `${TRACK_LABELS[t]}: ${p.timeline.tracks[t].length}`).join(' · ');
    body.append(note('Selecciona un clip en la línea de tiempo para editarlo.'), hint(counts));
    return;
  }
  const track = c.track;
  body.append(group(`${TRACK_LABELS[track]} · ${clipLabel(c, p)}`, true,
    slider({ label: 'Inicio (s)', min: 0, max: app.store.duration, step: 0.01, value: c.start, onInput: (v) => app.store.live(() => { c.start = v; }), onChange: () => app.store.settle('Mover clip') }),
    slider({ label: 'Duración (s)', min: 0.1, max: Math.max(10, app.store.duration), step: 0.01, value: c.dur, onInput: (v) => app.store.live(() => { c.dur = v; }), onChange: () => app.store.settle('Duración') }),
    btnRow(button('Ir al inicio', () => app.player.seek(c.start)), button('✂ Cortar', () => app.actions.split()), button('⧉ Duplicar', () => app.actions.duplicate()), button('🗑', () => app.actions.remove(), 'ghost-btn danger')),
    c.sceneId ? btnRow(button(p.director.scenes.find((s) => s.id === c.sceneId)?.frozen ? '❄ Escena congelada' : 'Congelar su escena', () => { app.store.commit('Congelar escena', (pp) => { const s = pp.director.scenes.find((x) => x.id === c.sceneId); if (s) s.frozen = !s.frozen; }); app.renderSection(); })) : null));
  const onP = (k, v, final) => { if (final) return app.store.settle('Ajuste'); app.store.live(() => { c.params[k] = v; }); };
  if (SCHEMAS[track]) {
    const [list, schema, byId] = SCHEMAS[track];
    body.append(select({ label: 'Tipo', options: list.map((x) => ({ value: x.id, label: x.label })), value: c.type, onChange: (v) => { app.store.commit('Cambiar tipo', () => { c.type = v; c.params = { ...(byId[v].defaults || {}) }; }); app.renderSection(); } }));
    body.append(group('Parámetros', true, paramsForm(schema, withDefaults(schema, { ...(byId[c.type]?.defaults || {}), ...c.params }), onP)));
  } else if (track === 'photos') {
    body.append(group('Foto, efecto y movimiento', true, paramsForm(PHOTO_CLIP_PARAMS, withDefaults(PHOTO_CLIP_PARAMS, c.params), (k, v, f) => { onP(k, v, f); if (k === 'photoId' && f) app.store.commit('Cambiar foto', () => { c.params.photoId = v; }); }, { photos: p.photos })),
      btnRow(button('Editar la foto en el estudio', () => { app.store.select({ photoId: c.params.photoId }); app.go('photos'); })));
  } else if (track === 'transitions') {
    body.append(select({ label: 'Transición', options: TRANSITIONS.map((x) => ({ value: x.id, label: x.label })), value: c.type, onChange: (v) => app.store.commit('Tipo de transición', () => { c.type = v; }) }));
    body.append(group('Parámetros', true, paramsForm(TRANSITION_PARAMS, withDefaults(TRANSITION_PARAMS, c.params), onP)));
  } else if (track === 'effects') {
    body.append(select({ label: 'Efecto', options: EFFECTS.map((x) => ({ value: x.id, label: x.label })), value: c.type, onChange: (v) => { app.store.commit('Tipo de efecto', () => { c.type = v; }); app.renderSection(); } }));
    body.append(group('Parámetros', true, paramsForm(EFFECT_PARAMS, withDefaults(EFFECT_PARAMS, c.params), onP, { skip: c.type === 'filter' ? ['sync', 'rate'] : ['filter'] })));
  } else if (track === 'lighting') {
    body.append(group('Iluminación', true, paramsForm(LIGHTING_PARAMS, withDefaults(LIGHTING_PARAMS, c.params), onP, { palettes: allPalettes(p) })));
  }
}

// ================================================================ PALETAS
export function renderPalettes(app, body) {
  const p = app.store.project, pal = p.palette;
  const grid = el('div', { class: 'cards' });
  for (const pr of allPalettes(p)) {
    const custom = !PALETTE_PRESETS.includes(pr);
    grid.append(el('button', { class: 'card' + (pal.id === pr.id ? ' active' : ''), onclick: () => { app.store.commit('Paleta ' + pr.name, (pp) => { pp.palette.id = pr.id; pp.palette.colors = [...pr.colors]; }); app.renderSection(); } },
      el('div', { class: 'swatch' }, ...pr.colors.map((c) => el('i', { style: { background: c } }))), pr.name, custom ? el('small', {}, 'personalizada') : null));
  }
  body.append(group('Paletas de tres colores', true, grid));
  const edit = el('div');
  pal.colors.forEach((c, i) => edit.append(color({ label: `Color ${i + 1}`, value: c, onInput: (v) => app.store.live((pp) => { pp.palette.colors[i] = v; pp.palette.id = 'custom-edit'; }), onChange: () => app.store.settle('Color de paleta') })));
  edit.append(paramsForm(PALETTE_PARAMS, withDefaults(PALETTE_PARAMS, pal), (k, v, final) => { if (final) return app.store.settle('Ajuste de paleta'); app.store.live((pp) => { pp.palette[k] = v; }); }));
  body.append(group('Editar paleta actual', true, edit));
  body.append(btnRow(
    button('💾 Guardar como paleta personalizada', async () => {
      const name = await promptText('Nombre de la paleta', 'Mi paleta');
      if (!name) return;
      const id = uid('pal');
      app.store.commit('Guardar paleta', (pp) => { pp.customPalettes.push({ id, name, colors: [...pp.palette.colors] }); pp.palette.id = id; });
      const lib = (await app.media.libGet('palettes')) || [];
      lib.push({ id, name, colors: [...pal.colors] });
      await app.media.libPut('palettes', lib);
      toast('Paleta guardada (también en la Biblioteca)');
      app.renderSection();
    }, 'neon-btn small'),
    button('➜ Iluminación en el cursor', () => { app.actions.insert('lighting', 'light', { ...withDefaults(LIGHTING_PARAMS, {}), palette: pal.id }, app.player.time); toast('Clip de iluminación añadido'); }),
  ));
  if (p.customPalettes.length) {
    const l = el('div', { class: 'list' });
    for (const cp of p.customPalettes) l.append(el('div', { class: 'list-item' }, el('div', { class: 'swatch', style: { width: '60px', margin: 0 } }, ...cp.colors.map((c) => el('i', { style: { background: c } }))), el('span', { class: 'grow' }, cp.name), button('✕', () => { app.store.commit('Eliminar paleta', (pp) => { pp.customPalettes = pp.customPalettes.filter((x) => x.id !== cp.id); }); app.renderSection(); })));
    body.append(group('Paletas personalizadas del proyecto', false, l));
  }
}

// ================================================================ EXPORTADOR
export function renderExport(app, body) {
  const p = app.store.project, ex = p.export;
  const caps = el('div', { class: 'hint' }, 'Comprobando codificadores…');
  let capInfo = null;
  app.exporter.capabilities().then((c) => {
    capInfo = c;
    caps.textContent = c.desktop
      ? `FFmpeg ${c.version || ''}: H.264 ${c.h264 ? '✓' : '✗'} · H.265 ${c.h265 ? '✓' : '✗'} · Intel QuickSync ${c.qsv ? '✓' : '✗'}`
      : `Navegador (WebCodecs): H.264 ${c.h264 ? '✓' : '✗'} · H.265 ${c.h265 ? '✓' : '✗'}${c.webcodecs ? '' : ' — este navegador no puede exportar: usa la app de escritorio'}`;
  });
  const set = (k, v, label = 'Ajuste de exportación') => { app.store.commit(label, (pp) => { pp.export[k] = v; }); app.renderSection(); };
  const res = ex.resolution || 1080;
  const size = outputSize(ex.preset, res, ex.custom || p.customSize);
  const rangeNow = () => exportRange({ total: app.store.duration, duration: ex.clipSeconds || 0, start: ex.clipStart || 'drop', cursor: app.player.time, analysis: app.analysis, trimStart: p.audio?.trimStart || 0, loop: ex.range === 'loop' && app.player.loop.enabled ? app.player.loop : null });
  const [r0, r1] = rangeNow();
  const dur = r1 - r0;
  const bitrate = ex.bitrateMbps ? ex.bitrateMbps * 1e6 : bitrateFor(size.w, size.h, ex.fps, ex.quality);
  const estMB = ((bitrate + (ex.audioBitrate || 0) * 1000) * dur) / 8 / 1e6;
  body.append(group('Formato', true,
    select({ label: 'Destino', options: EXPORT_PRESETS.map((x) => ({ value: x.id, label: x.label })), value: ex.preset, onChange: (v) => { set('preset', v); const asp = { tiktok: '9:16', capcut: '9:16', youtube: '16:9', square: '1:1', custom: 'custom' }[v]; if (asp !== p.aspect) app.store.commit('Formato', (pp) => { pp.aspect = asp; }, 'aspect'); } }),
    ex.preset === 'custom' ? el('div', { class: 'btn-row' }, numIn('Ancho', ex.custom?.w || 1080, (v) => app.store.commit('Ancho', (pp) => { pp.export.custom = { ...(pp.export.custom || { w: 1080, h: 1920 }), w: v }; pp.customSize = pp.export.custom; }, 'aspect')), numIn('Alto', ex.custom?.h || 1920, (v) => app.store.commit('Alto', (pp) => { pp.export.custom = { ...(pp.export.custom || { w: 1080, h: 1920 }), h: v }; pp.customSize = pp.export.custom; }, 'aspect'))) : null,
    ex.preset !== 'custom' ? select({ label: 'Resolución', options: RESOLUTIONS.map((x) => ({ value: x.id, label: x.label })), value: res, onChange: (v) => set('resolution', v) }) : null,
    select({ label: 'Fotogramas por segundo', options: [24, 30, 60].map((x) => ({ value: x, label: `${x} FPS` })), value: ex.fps, onChange: (v) => set('fps', v) }),
    el('p', { class: 'hint' }, `Salida: ${size.w}×${size.h} · ${ex.fps} FPS · ${formatTime(dur, true)} · ${Math.round(dur * ex.fps)} fotogramas · ~${estMB.toFixed(0)} MB`)));
  // Duración del clip (15 / 30 / 45 / 60 s) y punto de inicio
  const durSeg = el('div', { class: 'seg' });
  for (const d of DURATIONS) durSeg.append(el('button', { class: (ex.clipSeconds || 0) === d.value && ex.range !== 'loop' ? 'on' : '', onclick: () => { app.store.commit('Duración del clip', (pp) => { pp.export.clipSeconds = d.value; pp.export.range = 'all'; }); app.renderSection(); } }, d.label));
  body.append(group('Duración del vídeo', true, durSeg,
    (ex.clipSeconds || 0) > 0 ? select({ label: 'Empezar', options: STARTS, value: ex.clipStart || 'drop', onChange: (v) => set('clipStart', v, 'Inicio del clip') }) : null,
    (ex.clipSeconds || 0) > 0 ? toggle({ label: 'Fundido final del audio (0,8 s)', value: ex.fadeOut !== false, onChange: (v) => set('fadeOut', v, 'Fundido final') }) : null,
    el('p', { class: 'hint' }, `Tramo: ${formatTime(r0, true)} → ${formatTime(r1, true)} (${dur.toFixed(1)} s)` + ((ex.clipSeconds || 0) > app.store.duration ? ' · la canción es más corta que la duración elegida' : '')),
    btnRow(button('▶ Previsualizar el tramo', () => { app.player.loop = { enabled: true, a: r0, b: r1 }; app.updateTransport(); app.timeline.dirty = true; app.player.play(r0); }))));
  body.append(group('Calidad y codificación', true,
    select({ label: 'Códec', options: [{ value: 'h264', label: 'MP4 H.264 (máxima compatibilidad)' }, { value: 'h265', label: 'MP4 H.265 / HEVC (si es compatible)' }], value: ex.codec, onChange: (v) => set('codec', v) }),
    window.neonDesktop?.isDesktop ? select({ label: 'Codificador', options: [{ value: 'cpu', label: 'Procesador (x264/x265)' }, { value: 'qsv', label: 'Intel QuickSync (gráfica Intel)' }], value: ex.encoder || 'cpu', onChange: (v) => set('encoder', v) }) : null,
    select({ label: 'Calidad', options: QUALITIES.map((x) => ({ value: x.id, label: x.label })), value: ex.quality, onChange: (v) => set('quality', v) }),
    slider({ label: 'Bitrate manual (Mbps, 0 = automático)', min: 0, max: 80, step: 1, value: ex.bitrateMbps || 0, onChange: (v) => set('bitrateMbps', v) }),
    select({ label: 'Audio', options: [{ value: 0, label: 'Sin audio' }, { value: 128, label: 'AAC 128 kbps' }, { value: 192, label: 'AAC 192 kbps' }, { value: 320, label: 'AAC 320 kbps' }], value: ex.audioBitrate ?? 192, onChange: (v) => set('audioBitrate', v) }),
    caps));
  const nameIn = el('input', { type: 'text', value: ex.fileName || p.name, style: { width: '100%' } });
  nameIn.onchange = () => set('fileName', nameIn.value.trim() || 'neonverse-video', 'Nombre de archivo');
  const folderRow = window.neonDesktop?.isDesktop ? el('div', { class: 'row inline' }, el('label', {}, ex.folder || 'Carpeta: Vídeos'), button('Elegir carpeta', async () => { const r = await window.neonDesktop.chooseFolder(); if (r) set('folder', r, 'Carpeta'); })) : hint('En el navegador el vídeo se descarga a tu carpeta de descargas.');
  body.append(group('Archivo', true, el('div', { class: 'row' }, el('label', {}, 'Nombre del archivo'), nameIn), folderRow,
    select({ label: 'Rango', options: [{ value: 'all', label: 'Según «Duración del vídeo»' }, { value: 'loop', label: 'Solo el fragmento A-B' }], value: ex.range, onChange: (v) => set('range', v) })));
  const prog = el('div', { class: 'progress' }, el('i'));
  const status = el('p', { class: 'hint' }, '');
  const startBtn = button('🎬 EXPORTAR MP4', async () => {
    if (app.exporter.running) return;
    if (size.w * size.h >= 3840 * 2160 * 0.9) { const ok = await modal('Exportación 4K', 'En tu equipo el 4K puede tardar bastante (cada fotograma se dibuja completo). ¿Continuar?', [{ label: 'Cancelar', value: 0 }, { label: 'Continuar', value: 1, primary: true }]); if (!ok) return; }
    startBtn.disabled = true; cancelBtn.disabled = false;
    const range = rangeNow();
    const fadeOut = (ex.clipSeconds || 0) > 0 && ex.fadeOut !== false && range[1] < app.store.duration - 0.05 ? 0.8 : 0;
    try {
      const r = await app.exporter.run({
        width: size.w, height: size.h, fps: ex.fps, codec: ex.codec, encoder: ex.encoder || 'cpu', quality: ex.quality, bitrateMbps: ex.bitrateMbps || 0, audioBitrate: ex.audioBitrate ?? 192,
        fileName: (ex.fileName || p.name) + ((ex.clipSeconds || 0) > 0 && range[1] - range[0] < app.store.duration - 0.05 ? `-${ex.clipSeconds}s` : ''), folder: ex.folder, range, fadeOut,
        onProgress: (s) => { prog.firstChild.style.width = `${(s.frame / s.total) * 100}%`; status.textContent = `Fotograma ${s.frame}/${s.total} · ${s.fps.toFixed(1)} fps · quedan ${formatTime(s.eta)}`; },
      });
      status.textContent = `✓ Terminado en ${formatTime(r.seconds)}: ${r.path} (${(r.size / 1e6).toFixed(1)} MB)` + (r.noAudioReason ? ` · SIN AUDIO: ${r.noAudioReason}` : '') + (r.interrupted ? ' · Saliste de la app durante la exportación: revisa el vídeo.' : '');
      toast('Vídeo exportado');
      if (window.neonDesktop?.isDesktop && r.path) body.append(btnRow(button('Abrir carpeta', () => window.neonDesktop.showItem(r.path))));
      if (r.file) {
        const saveBox = el('div', { class: 'btn-row' });
        if (r.share) saveBox.append(button('📲 Guardar en Fotos', async () => { try { await shareVideo(r.file, p.name); } catch (e) { if (e.name !== 'AbortError') toast('No se pudo abrir el menú de compartir: ' + e.message, true); } }, 'neon-btn big'));
        saveBox.append(el('a', { class: 'ghost-btn', href: r.blobUrl, download: r.path, style: { textAlign: 'center', textDecoration: 'none' } }, isIOS() ? '📁 Guardar en Archivos' : '⬇ Descargar de nuevo'));
        body.insertBefore(saveBox, status.nextSibling);
        if (r.share) body.insertBefore(note('En el menú que se abre elige «Guardar vídeo»: queda en tu galería de Fotos, listo para TikTok o CapCut.'), saveBox.nextSibling);
        saveBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (e) {
      status.textContent = e.message === 'cancelado' ? 'Exportación cancelada' : '✗ ' + e.message;
      if (e.message !== 'cancelado') toast('Error al exportar: ' + e.message, true, 7000);
    } finally { startBtn.disabled = false; cancelBtn.disabled = true; }
  }, 'neon-btn big');
  const cancelBtn = button('Cancelar', () => app.exporter.cancel(), 'ghost-btn danger'); cancelBtn.disabled = true;
  body.append(startBtn, prog, status, btnRow(cancelBtn),
    note('Render real fotograma a fotograma con todos los efectos y la música sincronizada; no es una grabación de pantalla. La vista previa se detiene mientras exporta.'));
  if (isIOS()) body.append(note('iPhone: exporta 720p o 1080p a 30 FPS (4K puede agotar la memoria). Mantén NEONVERSE en primer plano hasta que termine: la pantalla no se apagará sola. El audio AAC requiere iOS 26 o posterior. Al terminar pulsa «Guardar en Fotos».'));
}
function numIn(label, value, onChange) { const i = el('input', { type: 'number', value, min: 16, max: 7680, step: 2, style: { width: '90px' } }); i.onchange = () => onChange(Math.max(16, Math.round(+i.value / 2) * 2)); return el('label', { class: 'hint' }, label + ' ', i); }

// ================================================================ BIBLIOTECA
export function renderLibrary(app, body) {
  body.append(btnRow(button('💾 Guardar proyecto actual', async () => { await app.saveToLibrary(); app.renderSection(); }, 'neon-btn small'), button('📂 Importar .neonverse', () => $f('file-project').click())),
    btnRow(button('📦 Exportar proyecto .neonverse (con música y fotos)', () => app.exportProjectFile())),
    hint('El archivo .neonverse lleva la música y las fotos dentro: sirve para pasar un proyecto del iPhone al ordenador y exportarlo allí.'));
  const projects = el('div', { class: 'list' }, hint('Cargando…'));
  const comps = el('div', { class: 'list' });
  const pals = el('div', { class: 'list' });
  body.append(group('Proyectos', true, projects), group('Composiciones del Auto Director', true, comps), group('Paletas guardadas', false, pals));
  app.media.libKeys().then(async (keys) => {
    projects.innerHTML = ''; comps.innerHTML = ''; pals.innerHTML = '';
    const items = [];
    for (const k of keys) { if (k === 'autosave') continue; const v = await app.media.libGet(k); if (v) items.push([k, v]); }
    items.sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
    for (const [k, v] of items) {
      if (k.startsWith('project:')) projects.append(el('div', { class: 'list-item' }, el('span', { class: 'grow' }, v.name, el('small', { class: 'dim' }, ` · ${new Date(v.savedAt).toLocaleString('es-ES')} · ${v.clips} clips`)),
        button('Abrir', async () => { await app.openProject(v.project); app.go('timeline'); }),
        button('Duplicar', async () => { const cp = deepClone(v.project); cp.name += ' (copia)'; cp.createdAt = new Date().toISOString(); await app.media.libPut(`project:${cp.createdAt}`, { ...v, project: cp, name: cp.name, savedAt: Date.now() }); app.renderSection(); }),
        button('✕', async () => { await app.media.libDelete(k); app.renderSection(); })));
      else if (k.startsWith('composition:')) comps.append(el('div', { class: 'list-item' }, el('span', { class: 'grow' }, v.name, el('small', { class: 'dim' }, ' · ' + new Date(v.savedAt).toLocaleString('es-ES'))),
        button('Aplicar', () => { app.store.commit('Aplicar composición', (pp) => { pp.timeline.tracks = deepClone(v.tracks); pp.director.scenes = deepClone(v.scenes); pp.director.profile = v.profile; pp.director.controls = deepClone(v.controls); pp.director.seed = v.seed; }); toast('Composición aplicada'); }),
        button('Regenerar con su semilla', () => { app.store.commit('Ajustes de composición', (pp) => { pp.director.profile = v.profile; pp.director.controls = deepClone(v.controls); }); app.runDirector({ seed: v.seed, label: 'Regenerar composición' }); }),
        button('✕', async () => { await app.media.libDelete(k); app.renderSection(); })));
      else if (k === 'palettes') for (const pl of v) pals.append(el('div', { class: 'list-item' }, el('div', { class: 'swatch', style: { width: '60px', margin: 0 } }, ...pl.colors.map((c) => el('i', { style: { background: c } }))), el('span', { class: 'grow' }, pl.name), button('Añadir al proyecto', () => { app.store.commit('Añadir paleta', (pp) => { if (!pp.customPalettes.some((x) => x.id === pl.id)) pp.customPalettes.push(deepClone(pl)); pp.palette.id = pl.id; pp.palette.colors = [...pl.colors]; }); toast('Paleta aplicada'); })));
    }
    if (!projects.children.length) projects.append(hint('Aún no hay proyectos guardados (Ctrl+S).'));
    if (!comps.children.length) comps.append(hint('Guarda composiciones desde el Auto Director.'));
    if (!pals.children.length) pals.append(hint('Guarda paletas desde Paletas.'));
  });
}

// ================================================================ AJUSTES
export function renderSettings(app, body) {
  const pr = app.prefs;
  const modes = el('div', { class: 'seg' });
  for (const [id, label] of [['performance', 'Rendimiento'], ['balanced', 'Equilibrado'], ['quality', 'Calidad']]) modes.append(el('button', { class: pr.quality === id ? 'on' : '', onclick: () => { app.setQuality(id); app.renderSection(); } }, label));
  body.append(group('Modo de rendimiento', true, modes,
    hint('Rendimiento: vista previa a 640 px, menos partículas y texturas de 1024 px (Intel HD 5500 / GeForce 820M). Equilibrado: 960 px. Calidad: resolución completa y 60 FPS. La exportación siempre usa la máxima calidad.'),
    slider({ label: 'Resolución de la vista previa', min: 0.35, max: 1, step: 0.05, value: pr.previewScale, onChange: (v) => { pr.previewScale = v; app.savePrefs(); app.resizePreview(true); } }),
    select({ label: 'Límite de FPS de la vista previa', options: [{ value: 0, label: 'Según el modo' }, { value: 24, label: '24' }, { value: 30, label: '30' }, { value: 60, label: '60' }], value: pr.fpsCap, onChange: (v) => { pr.fpsCap = +v; app.savePrefs(); } }),
    slider({ label: 'Reducción de partículas (vista previa)', min: 0.2, max: 1, step: 0.05, value: pr.particleMul, onChange: (v) => { pr.particleMul = v; app.savePrefs(); app.engine.disposeAll(); app.resizePreview(true); } }),
    select({ label: 'Tamaño máximo de texturas de fotos', options: [{ value: 0, label: 'Según el modo' }, { value: 1024, label: '1024 px' }, { value: 2048, label: '2048 px' }, { value: 4096, label: '4096 px' }], value: pr.maxPhoto, onChange: (v) => { pr.maxPhoto = +v; app.savePrefs(); app.reloadPhotoTextures(); } }),
  ));
  body.append(group('Proyecto', true,
    toggle({ label: 'Autoguardado', value: pr.autosave, onChange: (v) => { pr.autosave = v; app.savePrefs(); } }),
    btnRow(button('Liberar memoria de la GPU', () => { app.engine.disposeAll(); app.resizePreview(true); toast('Memoria liberada'); }))));
  const i = app.engine.info();
  body.append(group('Sistema', false, el('div', { class: 'kv' },
    el('b', {}, 'Gráfica'), el('span', {}, i.renderer), el('b', {}, 'WebGL 2'), el('span', {}, i.webgl2 ? 'sí' : 'no'), el('b', {}, 'Render HDR'), el('span', {}, i.hdr ? 'sí (16 bits)' : 'no (8 bits)'),
    el('b', {}, 'Textura máx.'), el('span', {}, String(i.maxTexture)), el('b', {}, 'Versión'), el('span', {}, 'NEONVERSE AI 2.0.0'), el('b', {}, 'Modo'), el('span', {}, window.neonDesktop?.isDesktop ? 'Escritorio (Electron + FFmpeg)' : 'Web'))));
  body.append(group('Restablecer', false, btnRow(button('Borrar preferencias', () => { localStorage.removeItem('neonverse-prefs'); toast('Preferencias borradas: recarga la app'); }, 'ghost-btn danger'))));
}
