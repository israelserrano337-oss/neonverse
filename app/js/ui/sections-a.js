// Paneles: Inicio, Auto Director, Túneles, Mallas, Fotografías, Filtros, Transiciones.
import { el, slider, select, toggle, button, group, hint, note, btnRow, paramsForm, toast, modal } from './controls.js';
import { DIRECTOR_CONTROLS, newProject } from '../core/store.js';
import { uid, deepClone, schemaDefaults, withDefaults, formatTime } from '../core/util.js';
import { PROFILES, PROFILE_BY_ID } from '../director/profiles.js';
import { smartRandom, SECTION_NAMES } from '../director/AutoDirector.js';
import { TUNNELS, TUNNEL_PARAMS, TUNNEL_BY_ID } from '../studios/tunnels.js';
import { MESHES, MESH_PARAMS, MESH_BY_ID } from '../studios/meshes.js';
import { PARTICLES, PARTICLE_PARAMS, PARTICLE_BY_ID } from '../studios/particles.js';
import { EQUALIZERS, EQ_PARAMS, EQ_BY_ID } from '../studios/equalizers.js';
import { PHOTO_SETTINGS, PHOTO_CLIP_PARAMS, PHOTO_FX } from '../studios/photos.js';
import { FILTERS } from '../studios/effects.js';
import { TRANSITIONS, TRANSITION_PARAMS } from '../studios/transitions.js';
import { addClip, has3D } from '../timeline/model.js';
import { BS_MODES, BS_TRANSITIONS, BS_LOOKS, modeAt } from '../beatsync/BeatSync.js';
import { SLIDE_EVERY, SLIDE_LOOKS, SLIDE_HITFX, isHitMode } from '../timeline/slideshow.js';

const $f = (id) => document.getElementById(id);

// ================================================================ INICIO
export function renderHome(app, body) {
  const p = app.store.project;
  body.append(
    el('div', { class: 'hero' }, el('img', { src: 'assets/brand/logo-horizontal.svg', alt: 'NEONVERSE AI 2.0' }), el('p', { class: 'hint' }, 'Futuristic Music Video Studio · todo se procesa en tu equipo')),
    group('Empezar', true,
      btnRow(button('🎵 Cargar música', () => $f('file-audio').click(), 'neon-btn'), button('🖼 Añadir fotos', () => $f('file-photos').click())),
      btnRow(button('✨ Ir al Auto Director', () => app.go('director')), button('🎬 Exportar MP4', () => app.go('export'))),
      btnRow(button('＋ Proyecto nuevo', async () => {
        const r = await modal('Proyecto nuevo', 'El proyecto actual queda autoguardado en la biblioteca si lo guardas antes. ¿Crear uno vacío?', [{ label: 'Cancelar', value: 0 }, { label: 'Guardar y crear', value: 2 }, { label: 'Crear', value: 1, primary: true }]);
        if (!r) return;
        if (r === 2) await app.saveToLibrary();
        await app.openProject(newProject(), { silent: true });
        toast('Proyecto nuevo'); app.go('home');
      }), button('📂 Abrir .neonverse', () => $f('file-project').click())),
    ),
    group('Proyecto actual', true,
      el('div', { class: 'kv' },
        el('b', {}, 'Nombre'), el('span', {}, p.name),
        el('b', {}, 'Música'), el('span', {}, p.audio ? `${p.audio.name} · ${formatTime(app.store.duration)} · ${app.analysis.bpm} BPM` : 'sin música'),
        el('b', {}, 'Fotos'), el('span', {}, String(p.photos.length)),
        el('b', {}, 'Clips'), el('span', {}, String(Object.values(p.timeline.tracks).reduce((n, t) => n + t.length, 0))),
        el('b', {}, 'Formato'), el('span', {}, p.aspect),
      )),
    group('Cómo funciona', false,
      el('ol', { class: 'hint' }, el('li', {}, 'Carga una canción (MP3, WAV, AAC o FLAC) y tus fotos.'), el('li', {}, 'Elige un perfil en el Auto Director y pulsa GENERAR VÍDEO.'), el('li', {}, 'Retoca escenas en la línea de tiempo o en los estudios.'), el('li', {}, 'Exporta el MP4 para TikTok, CapCut o YouTube.')),
      note('Atajos: Espacio reproducir · Ctrl+Z/Ctrl+Y deshacer/rehacer · S cortar · D duplicar · Supr eliminar · M marcador · ←/→ un golpe.')),
    group('Ejemplos', false, examplesList(app)),
    group('Equipo', false, el('div', { class: 'kv' }, el('b', {}, 'GPU'), el('span', {}, app.gpu.renderer), el('b', {}, 'Modo'), el('span', {}, { performance: 'Rendimiento', balanced: 'Equilibrado', quality: 'Calidad' }[app.prefs.quality]), el('b', {}, 'Escritorio'), el('span', {}, window.neonDesktop?.isDesktop ? 'Sí (FFmpeg integrado)' : 'No (versión web)'))),
  );
}

function examplesList(app) {
  const box = el('div', { class: 'list' }, hint('Cargando ejemplos…'));
  fetch('examples/index.json').then((r) => r.json()).then((list) => {
    box.innerHTML = '';
    for (const ex of list) box.append(el('div', { class: 'list-item' }, el('span', { class: 'grow' }, ex.name, el('small', { class: 'dim' }, ' · ' + ex.desc)), button('Abrir', async () => {
      const proj = await (await fetch('examples/' + ex.file)).json();
      proj.createdAt = new Date().toISOString();
      try { await app.importProjectData(proj); } catch (e) { toast('No se pudo abrir el ejemplo: ' + e.message, true); return; }
      app.go('timeline');
    })));
  }).catch(() => { box.innerHTML = ''; box.append(hint('No hay ejemplos disponibles.')); });
  return box;
}

// ================================================================ AUTO DIRECTOR
export function renderDirector(app, body) {
  const p = app.store.project, d = p.director;
  const cards = el('div', { class: 'cards' });
  for (const pr of PROFILES) {
    cards.append(el('button', { class: 'card' + (d.profile === pr.id ? ' active' : ''), title: pr.desc, onclick: () => { app.store.commit('Perfil ' + pr.name, (pp) => { pp.director.profile = pr.id; }); app.renderSection(); } }, pr.name, el('small', {}, pr.desc)));
  }
  const ctl = el('div');
  for (const c of DIRECTOR_CONTROLS) ctl.append(slider({ ...c, value: d.controls[c.key], onInput: (v) => app.store.live((pp) => { pp.director.controls[c.key] = v; }, 'director-ui'), onChange: () => app.store.settle(c.label) }));
  const seedIn = el('input', { type: 'number', value: d.seed, style: { width: '120px' }, min: 0, max: 4294967295 });
  seedIn.onchange = () => app.store.commit('Cambiar semilla', (pp) => { pp.director.seed = (parseInt(seedIn.value, 10) >>> 0); });
  const summary = el('div', { class: 'hint' }, d.scenes?.length ? `Composición actual: ${d.scenes.length} escenas · semilla ${d.seed}` : 'Aún no se ha generado ninguna composición.');
  const gen = (opts, label) => {
    const s = app.runDirector({ ...opts, label });
    summary.textContent = `${s.profile}: ${s.scenes} escenas, ${s.sections} secciones, ${s.clips} clips, ${s.tunnelTypes} tipos de túnel distintos · semilla ${app.store.project.director.seed}`;
    toast(`${label}: ${s.scenes} escenas generadas`);
    app.player.seek(0);
    renderScenes();
  };
  const scenesBox = el('div', { class: 'list' });
  const renderScenes = () => {
    scenesBox.innerHTML = '';
    const sc = app.store.project.director.scenes || [];
    if (!sc.length) { scenesBox.append(hint('Genera un vídeo para ver sus escenas.')); return; }
    sc.forEach((s, i) => {
      scenesBox.append(el('div', { class: 'list-item' },
        el('span', { class: 'section-tag' }, SECTION_NAMES[s.section] || s.section),
        el('span', { class: 'grow mono', title: 'Ir a la escena', style: { cursor: 'pointer' }, onclick: () => app.player.seek(s.start + 0.01) }, `${i + 1}. ${formatTime(s.start, true)}–${formatTime(s.end, true)}`),
        button(s.frozen ? '❄ Congelada' : 'Congelar', () => { app.store.commit(s.frozen ? 'Descongelar escena' : 'Congelar escena', (pp) => { const x = pp.director.scenes.find((y) => y.id === s.id); x.frozen = !x.frozen; }); renderScenes(); }, 'ghost-btn' + (s.frozen ? ' active' : '')),
        button('↻', () => { if (s.frozen) return toast('Descongela la escena para regenerarla', true); gen({ onlySceneId: s.id }, 'Regenerar escena'); }, 'ghost-btn', { title: 'Regenerar solo esta escena' }),
      ));
    });
  };
  renderScenes();
  const audioInfo = p.audio
    ? note(`🎵 ${p.audio.name} · ${app.analysis.bpm} BPM · ${app.analysis.sections.length} secciones (${app.analysis.sections.map((s) => SECTION_NAMES[s.type]).join(' → ')})`)
    : note('Sin música todavía: el director creará una composición de prueba. Carga una canción para sincronizar todo con el ritmo.');
  body.append(
    audioInfo,
    btnRow(button('🎵 Cargar canción', () => $f('file-audio').click()), button(`🖼 Fotos (${p.photos.length})`, () => $f('file-photos').click())),
    button('⚡ GENERAR VÍDEO', () => gen({ keepFrozen: true }, 'Generar vídeo'), 'neon-btn big'),
    btnRow(
      button('↻ Generar otra versión', () => gen({ seed: (d.seed + 7919) >>> 0, keepFrozen: true }, 'Otra versión')),
      button('🎲 Aleatorio inteligente', () => { const seed = (Math.random() * 4294967295) >>> 0; const r = smartRandom(seed); app.store.commit('Aleatorio inteligente', (pp) => { pp.director.profile = r.profile; pp.director.controls = r.controls; }); gen({ seed, keepFrozen: true }, 'Aleatorio inteligente'); app.renderSection(); }),
    ),
    btnRow(
      button('❄ Congelar escena actual', () => { const s = sceneAt(app); if (!s) return toast('No hay escena en el cursor'); app.store.commit('Congelar escena', (pp) => { pp.director.scenes.find((x) => x.id === s.id).frozen = true; }); renderScenes(); toast('Escena congelada: no cambiará al regenerar'); }),
      button('♻ Regenerar escena actual', () => { const s = sceneAt(app); if (!s) return toast('No hay escena en el cursor'); if (s.frozen) return toast('Está congelada', true); gen({ onlySceneId: s.id }, 'Regenerar escena'); }),
    ),
    btnRow(button('💾 Guardar composición', async () => {
      const name = `${PROFILE_BY_ID[d.profile]?.name || 'Composición'} · semilla ${d.seed}`;
      await app.media.libPut(`composition:${Date.now()}`, { name, profile: d.profile, controls: deepClone(d.controls), seed: d.seed, tracks: deepClone(p.timeline.tracks), scenes: deepClone(d.scenes), savedAt: Date.now() });
      toast('Composición guardada en la Biblioteca');
    })),
    summary,
    group('Perfil visual', true, cards),
    group('Inteligencia creativa', true, ctl),
    group('Protección fotosensible', false, toggle({ label: 'Cortes suaves entre escenas (recomendado)', value: d.safeCuts !== false, onChange: (v) => app.store.commit('Cortes suaves', (pp) => { pp.director.safeCuts = v; }) }), hint('Convierte los cortes secos en fundidos de un cuarto de segundo para evitar saltos bruscos de brillo. Se aplica al generar.')),
    group('Semilla (repetir una composición)', false, el('div', { class: 'row inline' }, el('label', {}, 'Semilla'), seedIn), hint('La misma semilla con la misma música, fotos y controles produce exactamente el mismo vídeo.')),
    group('Escenas', true, scenesBox),
  );
}
function sceneAt(app) { const t = app.player.time; return (app.store.project.director.scenes || []).find((s) => t >= s.start && t < s.end); }

// ================================================================ ESTUDIOS DE CAPAS (túneles, mallas, partículas)
const KIND = {
  tunnels: { list: TUNNELS, schema: TUNNEL_PARAMS, byId: TUNNEL_BY_ID, label: 'túnel', max: 4 },
  meshes: { list: MESHES, schema: MESH_PARAMS, byId: MESH_BY_ID, label: 'malla', max: 3 },
  particles: { list: PARTICLES, schema: PARTICLE_PARAMS, byId: PARTICLE_BY_ID, label: 'partículas', max: 2 },
  equalizers: { list: EQUALIZERS, schema: EQ_PARAMS, byId: EQ_BY_ID, label: 'ecualizador', max: 2 },
};

function layerStudio(app, body, kind, opts = {}) {
  const K = KIND[kind];
  const p = app.store.project;
  const sel = app.store.selection;
  const selClip = sel.clipId && sel.track === kind ? app.store.findClip(sel.clipId) : null;
  const wrap = el('div');
  if (selClip) {
    wrap.append(note(`Editando el clip seleccionado de la línea de tiempo (${formatTime(selClip.start, true)}).`),
      btnRow(button('Volver a las capas del estudio', () => { app.store.select({}); app.renderSection(); })));
    wrap.append(typeGrid(K, selClip.type, (id) => app.store.commit('Cambiar tipo', () => { selClip.type = id; selClip.params = { ...(K.byId[id].defaults || {}), ...pickKeep(selClip.params) }; })));
    const params = withDefaults(K.schema, { ...(K.byId[selClip.type]?.defaults || {}), ...selClip.params });
    wrap.append(group('Controles', true, paramsForm(K.schema, params, (k, v, final) => {
      if (final) { app.store.settle('Ajuste de ' + K.label); return; }
      app.store.live(() => { selClip.params[k] = v; });
    })));
    app.setView('timeline');
    return wrap;
  }
  const layers = p.studio[kind];
  if (!layers.length) layers.push({ id: uid('st'), type: K.list[0].id, params: { ...(K.list[0].defaults || {}) } });
  const active = layers.find((l) => l.id === opts.activeId?.[kind]) || layers[0];
  const list = el('div', { class: 'layer-list' });
  layers.forEach((l, i) => {
    list.append(el('div', { class: 'layer-item' + (l === active ? ' active' : ''), onclick: () => { app._studioActive = { ...(app._studioActive || {}), [kind]: l.id }; app.renderSection(); } },
      el('span', { class: 'name' }, `${i + 1}. ${K.byId[l.type]?.label || l.type}`),
      el('button', { title: l.hidden ? 'Mostrar' : 'Ocultar', onclick: (e) => { e.stopPropagation(); l.hidden = !l.hidden; app.requestRender(); app.renderSection(); } }, l.hidden ? '◌' : '◉'),
      el('button', { title: 'Eliminar capa', onclick: (e) => { e.stopPropagation(); p.studio[kind] = layers.filter((x) => x !== l); app.requestRender(); app.renderSection(); } }, '✕')));
  });
  wrap.append(group(`Capas superpuestas (${layers.length}/${K.max})`, true, list,
    btnRow(button(`＋ Añadir capa de ${K.label}`, () => { if (layers.length >= K.max) return toast(`Máximo ${K.max} capas`, true); const t = K.list[(layers.length * 3) % K.list.length]; layers.push({ id: uid('st'), type: t.id, params: { ...(t.defaults || {}), opacity: 0.6 } }); app._studioActive = { ...(app._studioActive || {}), [kind]: layers.at(-1).id }; app.requestRender(); app.renderSection(); })),
    hint('Las capas se dibujan una encima de otra.'),
    !has3D(p) ? note('Mientras la línea de tiempo no tenga túneles, mallas ni ecualizadores, estas capas (de todos los estudios, combinadas) son el fondo de todo el vídeo y se exportan tal cual.') : hint('La línea de tiempo ya tiene clips 3D: estas capas solo se usan si las añades con «➜ Añadir a la línea de tiempo».')));
  wrap.append(group('Tipo', true, typeGrid(K, active.type, (id) => { active.type = id; active.params = { ...(K.byId[id].defaults || {}), ...pickKeep(active.params) }; app.requestRender(); app.renderSection(); })));
  const params = withDefaults(K.schema, { ...(K.byId[active.type]?.defaults || {}), ...active.params });
  wrap.append(group('Controles', true, paramsForm(K.schema, params, (k, v) => { active.params[k] = v; app.requestRender(); })));
  wrap.append(btnRow(
    button('➜ Añadir a la línea de tiempo', () => {
      const t = app.player.time; const beat = 60 / (app.analysis.bpm || 120);
      app.store.commit(`Insertar ${K.label}`, (pp) => { for (const l of layers.filter((x) => !x.hidden)) addClip(pp, kind, { type: l.type, params: deepClone(l.params), start: t, dur: beat * 16 }); });
      toast(`Añadido en ${formatTime(t, true)} (16 golpes). Ajusta la duración en la línea de tiempo.`);
    }, 'neon-btn small'),
    button('Restablecer', () => { active.params = { ...(K.byId[active.type].defaults || {}) }; app.requestRender(); app.renderSection(); }),
  ));
  return wrap;
}
const pickKeep = (params) => { const o = {}; for (const k of ['colorMode', 'colorShift', 'react', 'opacity', 'camera']) if (params?.[k] !== undefined) o[k] = params[k]; return o; };
function typeGrid(K, current, onPick) {
  const g = el('div', { class: 'cards' });
  for (const t of K.list) g.append(el('button', { class: 'card' + (t.id === current ? ' active' : ''), onclick: () => onPick(t.id) }, t.label, t.desc ? el('small', {}, t.desc) : null));
  return g;
}

export function renderTunnels(app, body) {
  if (!(app.store.selection.track === 'tunnels' && app.store.selection.clipId)) app.setView('studio', { kinds: ['tunnels'] });
  body.append(layerStudio(app, body, 'tunnels', { activeId: app._studioActive }));
}
export function renderMeshes(app, body) {
  const withTunnel = app._meshWithTunnel ?? false;
  if (!(app.store.selection.clipId && ['meshes', 'particles'].includes(app.store.selection.track))) app.setView('studio', { kinds: withTunnel ? ['tunnels', 'meshes', 'particles'] : ['meshes', 'particles'] });
  body.append(toggle({ label: 'Mostrar también los túneles del estudio de fondo', value: withTunnel, onChange: (v) => { app._meshWithTunnel = v; app.renderSection(); } }));
  body.append(el('h3', { class: 'hint' }, 'MALLAS ELÉCTRICAS'), layerStudio(app, body, 'meshes', { activeId: app._studioActive }));
  body.append(el('h3', { class: 'hint' }, 'PARTÍCULAS'), layerStudio(app, body, 'particles', { activeId: app._studioActive }));
}

// ================================================================ ECUALIZADORES
export function renderEqualizers(app, body) {
  const withTunnel = app._eqWithTunnel ?? false;
  if (!(app.store.selection.clipId && app.store.selection.track === 'equalizers')) app.setView('studio', { kinds: withTunnel ? ['tunnels', 'equalizers'] : ['equalizers'] });
  body.append(note(app.store.project.audio ? 'Las barras siguen el espectro de tu canción: pulsa ▶ para verlos reaccionar.' : 'Carga una canción para que las barras sigan su espectro (sin música se animan con una señal de prueba).'));
  body.append(toggle({ label: 'Mostrar también los túneles del estudio de fondo', value: withTunnel, onChange: (v) => { app._eqWithTunnel = v; app.renderSection(); } }));
  body.append(layerStudio(app, body, 'equalizers', { activeId: app._studioActive }));
  body.append(hint('Atajo: «Hielo y oro (original)» en Color conserva el aspecto original; cualquier otro modo usa tu paleta.'));
}

// ================================================================ FOTOGRAFÍAS
export function renderPhotos(app, body) {
  const p = app.store.project;
  let selId = app.store.selection.photoId && p.photos.some((x) => x.id === app.store.selection.photoId) ? app.store.selection.photoId : p.photos[0]?.id;
  app._photoFx = app._photoFx || schemaDefaults(PHOTO_CLIP_PARAMS);
  const fx = app._photoFx;
  const withTunnel = app._photoWithTunnel ?? true;
  const hasShow = p.timeline.tracks.photos.length > 0 || app.bsActive();
  const previewMode = app._photoPreview || (hasShow ? 'show' : 'photo');
  if (previewMode === 'show') app.setView('timeline'); else app.setView('studio', { kind: 'photo', photoId: selId, fx, withTunnel });
  body.append(btnRow(button('🖼 Cargar fotos (ordenador o móvil)', () => $f('file-photos').click(), 'neon-btn small')), hint('JPG, JPEG, PNG y WEBP. Arrastra para reordenar. Se reducen a una textura ligera según el modo de rendimiento.'));
  if (!p.photos.length) { body.append(note('Aún no hay fotos. Al cargarlas se crea automáticamente un pase que cambia de foto al ritmo de la música.')); return; }
  const seg = el('div', { class: 'seg' });
  for (const [id, label] of [['show', '▶ Pase en el vídeo'], ['photo', 'Foto seleccionada']]) seg.append(el('button', { class: previewMode === id ? 'on' : '', onclick: () => { app._photoPreview = id; app.renderSection(); } }, label));
  body.append(el('p', { class: 'hint' }, 'Vista previa:'), seg);
  body.append(group('Fotos en el vídeo', true,
    toggle({ label: 'Mostrar las fotos en el vídeo', value: p.showPhotos !== false, onChange: (v) => { app.store.commit(v ? 'Mostrar fotos' : 'Ocultar fotos', (pp) => { pp.showPhotos = v; }); app.renderSection(); } }),
    hint(p.showPhotos === false ? 'Ocultas: el vídeo se exporta solo con túneles, mallas y ecualizadores. Las fotos siguen cargadas.' : 'Las fotos no son necesarias: sin ellas el vídeo lleva solo túneles, mallas y ecualizadores.'),
    btnRow(button('🗑 Quitar todas las fotos', async () => {
      const ok = await modal('Quitar todas las fotos', `Se quitarán ${p.photos.length} foto(s) y sus clips. Túneles, mallas y ecualizadores no cambian. Se puede deshacer con Ctrl+Z.`, [{ label: 'Cancelar', value: 0 }, { label: 'Quitar', value: 1, primary: true }]);
      if (!ok) return; app.removeAllPhotos(); toast('Fotos quitadas'); app.renderSection();
    }, 'ghost-btn danger'))));
  body.append(beatSyncPanel(app));
  // Pase al ritmo
  const ss = app._slideOpts = app._slideOpts || { every: 'hits', look: 'full', effect: 'varied', hitFx: 'varied', minGap: 0.25 };
  const nShow = p.timeline.tracks.photos.length;
  body.append(group('Pase de fotos al ritmo de la música', true,
    select({ label: 'Cambiar de foto', options: SLIDE_EVERY, value: ss.every, onChange: (v) => { ss.every = isHitMode(v) ? v : +v; app.renderSection(); } }),
    isHitMode(ss.every) ? select({ label: 'Efecto en cada golpe', options: SLIDE_HITFX, value: ss.hitFx ?? 'varied', onChange: (v) => { ss.hitFx = v; } }) : null,
    isHitMode(ss.every) ? slider({ label: 'Tiempo mínimo entre cambios (s)', min: 0.15, max: 1.5, step: 0.05, value: ss.minGap ?? 0.25, onInput: (v) => { ss.minGap = v; } }) : null,
    isHitMode(ss.every) && p.audio ? hint(`Golpes de batería detectados: ${app.analysis.drumHits({ mode: ss.every, minGap: ss.minGap ?? 0.25 }).length} en la canción.`) : null,
    select({ label: 'Aspecto', options: SLIDE_LOOKS, value: ss.look, onChange: (v) => { ss.look = v; } }),
    select({ label: 'Efecto', options: [{ value: 'varied', label: 'Variado (uno distinto en cada foto)' }, ...PHOTO_FX.map(([value, label]) => ({ value, label }))], value: ss.effect, onChange: (v) => { ss.effect = v; } }),
    btnRow(button(nShow ? '♻ Rehacer el pase en toda la canción' : '▶ Crear pase en toda la canción', () => {
      const n = app.makeSlideshow(ss);
      app._photoPreview = 'show'; app.player.seek(0); app.player.play();
      toast(`Pase creado: ${n} cambios de foto ${!p.audio ? '(sin música: en la rejilla de pulsos)' : isHitMode(ss.every) ? 'en los golpes de batería' : 'sobre los pulsos de la música'}`);
      app.renderSection();
    }, 'neon-btn small')),
    hint(nShow ? `Ahora hay ${nShow} clips de foto en la línea de tiempo. Pulsa ▶ para verlo.` : 'Todavía no hay fotos en la línea de tiempo.'),
    note('Los cambios caen exactamente en los golpes detectados y las fotos se encadenan con un fundido cruzado corto, sin pasar por negro (sin parpadeos). El Auto Director también reparte las fotos al generar el vídeo.')));
  // Galería con reordenación por arrastre (y botones para pantallas táctiles)
  const gal = el('div', { class: 'gallery' });
  let dragFrom = -1;
  p.photos.forEach((ph, i) => {
    const img = el('img', { alt: ph.name });
    app.media.image(ph.mediaId, 256).then((im) => { if (im) img.src = im.canvas.toDataURL('image/jpeg', 0.7); });
    const th = el('div', { class: 'thumb' + (ph.id === selId ? ' active' : ''), draggable: 'true', title: ph.name }, img, el('span', { class: 'num' }, String(i + 1)));
    th.onclick = () => { app.store.select({ photoId: ph.id }); app.renderSection(); };
    th.ondragstart = () => { dragFrom = i; };
    th.ondragover = (e) => { e.preventDefault(); th.classList.add('drag-over'); };
    th.ondragleave = () => th.classList.remove('drag-over');
    th.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); th.classList.remove('drag-over'); if (dragFrom < 0 || dragFrom === i) return; app.store.commit('Reordenar fotos', (pp) => { const [m] = pp.photos.splice(dragFrom, 1); pp.photos.splice(i, 0, m); }); app.renderSection(); };
    gal.append(th);
  });
  const sel = p.photos.find((x) => x.id === selId);
  const idx = p.photos.indexOf(sel);
  body.append(group(`Galería (${p.photos.length})`, true, gal,
    btnRow(
      button('◀ Mover', () => { if (idx > 0) { app.store.commit('Reordenar fotos', (pp) => { const [m] = pp.photos.splice(idx, 1); pp.photos.splice(idx - 1, 0, m); }); app.renderSection(); } }),
      button('Mover ▶', () => { if (idx < p.photos.length - 1) { app.store.commit('Reordenar fotos', (pp) => { const [m] = pp.photos.splice(idx, 1); pp.photos.splice(idx + 1, 0, m); }); app.renderSection(); } }),
    ),
    btnRow(
      button('Ordenar por nombre', () => { app.store.commit('Ordenar por nombre', (pp) => pp.photos.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))); app.renderSection(); }),
      button('Por fecha de carga', () => { app.store.commit('Ordenar por fecha', (pp) => pp.photos.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))); app.renderSection(); }),
      button('Por brillo', () => { app.store.commit('Ordenar por brillo', (pp) => pp.photos.sort((a, b) => (a.luma || 0) - (b.luma || 0))); app.renderSection(); }),
    )));
  if (!sel) return;
  body.append(el('p', { class: 'hint' }, `Seleccionada: ${sel.name} · ${sel.w}×${sel.h}`));
  body.append(toggle({ label: 'Previsualizar sobre los túneles del estudio', value: withTunnel, onChange: (v) => { app._photoWithTunnel = v; app.renderSection(); } }));
  const settings = withDefaults(PHOTO_SETTINGS, sel.settings);
  body.append(group('Edición de la foto (se aplica en todo el vídeo)', true, paramsForm(PHOTO_SETTINGS, settings, (k, v, final) => {
    if (final) { app.store.settle('Editar foto'); return; }
    app.store.live((pp) => { const ph = pp.photos.find((x) => x.id === sel.id); ph.settings = { ...ph.settings, [k]: v }; });
    app.requestRender();
  })));
  body.append(group('Efecto y movimiento (vista «Foto seleccionada» e inserción)', previewMode === 'photo', paramsForm(PHOTO_CLIP_PARAMS.filter((x) => x.key !== 'photoId'), fx, (k, v) => { fx[k] = v; app.requestRender(); })));
  body.append(btnRow(
    button('➜ Añadir al cursor', () => {
      app.store.commit('Insertar foto', (pp) => addClip(pp, 'photos', { type: 'photo', start: app.player.time, dur: settings.duration, params: { ...deepClone(fx), photoId: sel.id } }));
      toast('Foto añadida a la línea de tiempo');
    }, 'neon-btn small'),
  ));
  body.append(btnRow(button('🗑 Eliminar foto', async () => {
    const used = Object.values(p.timeline.tracks.photos).filter((c) => c.params.photoId === sel.id).length;
    const ok = await modal('Eliminar foto', `«${sel.name}» se usa en ${used} clip(s), que también se eliminarán.`, [{ label: 'Cancelar', value: 0 }, { label: 'Eliminar', value: 1, primary: true }]);
    if (!ok) return;
    app.store.commit('Eliminar foto', (pp) => { pp.photos = pp.photos.filter((x) => x.id !== sel.id); pp.timeline.tracks.photos = pp.timeline.tracks.photos.filter((c) => c.params.photoId !== sel.id); });
    app.engine.dropPhoto(sel.id); app.store.select({}); app.renderSection();
  }, 'ghost-btn danger')));
}

/** Panel del BEAT-SYNC PHOTO ENGINE PRO (los botones funcionan durante la reproducción, sin detener la música). */
function beatSyncPanel(app) {
  const p = app.store.project, bs = p.beatSync;
  const live = (key, label) => ({ onInput: (v) => app.store.live((pp) => { pp.beatSync[key] = v; }), onChange: () => app.store.settle(label) });
  const modes = el('div', { class: 'seg' });
  const btns = {};
  for (const m of BS_MODES) { btns[m.value] = el('button', { title: m.hint, onclick: () => app.bsMode(m.value) }, m.label); modes.append(btns[m.value]); }
  const autoT = toggle({ label: 'Cambio automático', value: true, onChange: (v) => app.bsAuto(v) });
  const status = el('p', { class: 'hint mono' }, '');
  const master = toggle({ label: 'Usar Beat-Sync (sustituye al pase fijo de la pista de fotos)', value: bs.enabled, onChange: (v) => { app.bsSet({ enabled: v }, v ? 'Activar Beat-Sync' : 'Desactivar Beat-Sync'); app.renderSection(); } });
  const box = group('BEAT-SYNC PHOTO ENGINE PRO', true,
    master,
    el('p', { class: 'hint' }, 'Velocidad de cambio (se puede cambiar mientras suena; cada cambio queda grabado en su instante):'),
    modes, autoT,
    btnRow(button('⏮ PREVIOUS', () => app.bsNudge(-1), 'ghost-btn', { title: 'Foto anterior (tecla B)' }), button('NEXT ⏭', () => app.bsNudge(1), 'neon-btn small', { title: 'Foto siguiente (tecla N)' })),
    status,
    slider({ label: 'Sensibilidad de detección (AUTO KICK)', min: 0, max: 1, step: 0.01, value: bs.sensitivity, ...live('sensitivity', 'Beat-Sync: sensibilidad') }),
    toggle({ label: 'AUTO KICK: incluir también la caja (snare)', value: bs.snare, onChange: (v) => app.bsSet({ snare: v }, 'Beat-Sync: caja') }),
    select({ label: 'Transición', options: BS_TRANSITIONS, value: bs.transition, onChange: (v) => app.bsSet({ transition: v }, 'Beat-Sync: transición') }),
    slider({ label: 'Velocidad de transición', min: 0, max: 1, step: 0.01, value: bs.speed, ...live('speed', 'Beat-Sync: velocidad de transición') }),
    select({ label: 'Orden', options: [{ value: 'sequential', label: 'Secuencial' }, { value: 'random', label: 'Aleatorio (sin repetir hasta verlas todas)' }], value: bs.order, onChange: (v) => app.bsSet({ order: v }, 'Beat-Sync: orden') }),
    select({ label: 'Aspecto', options: BS_LOOKS, value: bs.look, onChange: (v) => app.bsSet({ look: v }, 'Beat-Sync: aspecto') }),
    btnRow(button('Borrar cambios grabados (modos y NEXT/PREVIOUS)', () => { app.bsReset(); toast('Cambios grabados borrados'); })),
    note('Los cambios se calculan con el análisis de la canción ya existente y el reloj de audio; como son función del tiempo, el vídeo exportado repite exactamente lo que ves. Nunca hay más de 6 cambios por segundo.'));
  const tick = (t) => {
    const cur = modeAt(app.store.project.beatSync, t), on = app.store.project.beatSync.enabled;
    for (const k in btns) btns[k].classList.toggle('on', on && cur === k);
    autoT.input.checked = cur !== 'off';
    const st = app.bsState(t);
    status.textContent = st ? `Foto ${st.index + 1}/${app.store.project.photos.length}${st.photo ? ' · ' + st.photo.name.slice(0, 18) : ''} · cambio ${st.event}/${st.total} · ${cur === 'off' ? 'automático apagado' : BS_MODES.find((m) => m.value === cur)?.label}` : 'Motor desactivado: manda la pista de fotos de la línea de tiempo.';
  };
  tick(app.player.time);
  app.sectionTick = (t) => tick(t);
  return box;
}

// ================================================================ FILTROS
export function renderFilters(app, body) {
  const p = app.store.project;
  body.append(hint('Filtros globales combinables: se suman a los clips de filtro de la pista «Efectos». Doble clic en un deslizador lo pone a cero.'));
  const box = el('div');
  for (const f of FILTERS) {
    const s = slider({ label: f.label, min: 0, max: 1, step: 0.01, value: p.filters?.[f.id] || 0, onInput: (v) => app.store.live((pp) => { pp.filters = { ...pp.filters, [f.id]: v }; }), onChange: () => app.store.settle('Filtro ' + f.label) });
    s.input.dataset.def = 0;
    box.append(s);
  }
  body.append(group('Filtros globales', true, box));
  const sel = el('select'); for (const f of FILTERS) sel.append(el('option', { value: f.id }, f.label));
  body.append(group('Filtro en un tramo', true, el('div', { class: 'row inline' }, el('label', {}, 'Filtro'), sel),
    btnRow(button('➜ Añadir clip de filtro en el cursor', () => { app.actions.insert('effects', 'filter', { filter: sel.value, amount: 0.6, sync: 'continuous', rate: 1 }); toast('Clip de filtro añadido (pista Efectos)'); }, 'neon-btn small')),
    btnRow(button('Quitar todos los filtros globales', () => { app.store.commit('Quitar filtros', (pp) => { pp.filters = {}; }); app.renderSection(); }))));
  const R = p.render;
  body.append(group('Acabado de imagen', true,
    slider({ label: 'Resplandor (bloom)', min: 0, max: 2, step: 0.01, value: R.bloom, onInput: (v) => app.store.live((pp) => { pp.render.bloom = v; }), onChange: () => app.store.settle('Resplandor') }),
    slider({ label: 'Umbral del resplandor', min: 0.2, max: 0.95, step: 0.01, value: R.bloomThreshold, onInput: (v) => app.store.live((pp) => { pp.render.bloomThreshold = v; }), onChange: () => app.store.settle('Umbral') }),
    slider({ label: 'Exposición', min: 0.4, max: 2, step: 0.01, value: R.exposure, onInput: (v) => app.store.live((pp) => { pp.render.exposure = v; }), onChange: () => app.store.settle('Exposición') }),
    slider({ label: 'Viñeta', min: 0, max: 1, step: 0.01, value: R.vignette, onInput: (v) => app.store.live((pp) => { pp.render.vignette = v; }), onChange: () => app.store.settle('Viñeta') }),
    slider({ label: 'Grano', min: 0, max: 0.2, step: 0.005, value: R.grain, onInput: (v) => app.store.live((pp) => { pp.render.grain = v; }), onChange: () => app.store.settle('Grano') }),
  ));
}

// ================================================================ TRANSICIONES
export function renderTransitions(app, body) {
  const st = app._transStudio = app._transStudio || { type: 'portal', duration: 1.5, params: schemaDefaults(TRANSITION_PARAMS) };
  const sel = app.store.selection;
  const selClip = sel.track === 'transitions' && sel.clipId ? app.store.findClip(sel.clipId) : null;
  if (selClip) {
    app.setView('timeline');
    body.append(note(`Editando la transición seleccionada (${formatTime(selClip.start, true)}, ${selClip.dur.toFixed(2)} s).`), btnRow(button('Volver a la biblioteca', () => { app.store.select({}); app.renderSection(); })));
    const g = el('div', { class: 'cards' });
    for (const t of TRANSITIONS) g.append(el('button', { class: 'card' + (t.id === selClip.type ? ' active' : ''), onclick: () => { app.store.commit('Tipo de transición', () => { selClip.type = t.id; }); app.renderSection(); } }, t.label));
    body.append(group('Tipo', true, g));
    body.append(group('Parámetros', true,
      slider({ label: 'Duración (s)', min: 0.1, max: 8, step: 0.05, value: selClip.dur, onInput: (v) => app.store.live(() => { const mid = selClip.start + selClip.dur / 2; selClip.dur = v; selClip.start = Math.max(0, mid - v / 2); }), onChange: () => app.store.settle('Duración de transición') }),
      paramsForm(TRANSITION_PARAMS, withDefaults(TRANSITION_PARAMS, selClip.params), (k, v, final) => { if (final) return app.store.settle('Ajuste de transición'); app.store.live(() => { selClip.params[k] = v; }); })));
    return;
  }
  app.setView('studio', { kind: 'transition', type: st.type, params: st.params, duration: st.duration });
  const g = el('div', { class: 'cards' });
  for (const t of TRANSITIONS) g.append(el('button', { class: 'card' + (t.id === st.type ? ' active' : ''), onclick: () => { st.type = t.id; app.renderSection(); } }, t.label));
  body.append(hint('La vista previa repite la transición entre dos escenas de demostración.'), group('Biblioteca (17)', true, g),
    group('Parámetros', true,
      slider({ label: 'Duración (s)', min: 0.1, max: 8, step: 0.05, value: st.duration, onInput: (v) => { st.duration = v; app.view.studio.duration = v; } }),
      paramsForm(TRANSITION_PARAMS, st.params, (k, v) => { st.params[k] = v; })),
    btnRow(button('➜ Insertar en el cursor', () => {
      const t = app.player.time;
      app.store.commit('Insertar transición', (pp) => addClip(pp, 'transitions', { type: st.type, params: deepClone(st.params), start: Math.max(0, t - st.duration / 2), dur: st.duration }));
      toast('Transición centrada en el cursor');
    }, 'neon-btn small')),
    note('Una transición mezcla lo que hay justo antes de su inicio con lo que hay justo después de su final. Colócala sobre un cambio de escena.'));
}
