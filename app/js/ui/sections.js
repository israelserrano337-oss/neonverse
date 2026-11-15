// Registro de las 14 secciones del menú principal.
import { renderHome, renderDirector, renderTunnels, renderMeshes, renderEqualizers, renderPhotos, renderFilters, renderTransitions } from './sections-a.js';
import { renderMusic, renderSync, renderTimeline, renderPalettes, renderExport, renderLibrary, renderSettings } from './sections-b.js';

export const SECTIONS = [
  { id: 'home', label: 'Inicio', icon: 'home', title: 'Inicio', sub: 'NEONVERSE AI 2.0 — Futuristic Music Video Studio', render: renderHome },
  { id: 'director', label: 'Auto Director', icon: 'director', title: 'Auto Director AI', sub: 'Analiza la canción y monta el vídeo completo', render: renderDirector },
  { id: 'tunnels', label: 'Túneles 3D', icon: 'tunnels', title: 'Estudio de túneles 3D', sub: '18 tipos superponibles con control total', render: renderTunnels, studio: () => ({ kinds: ['tunnels'] }) },
  { id: 'meshes', label: 'Mallas', icon: 'meshes', title: 'Mallas eléctricas 3D', sub: '12 estilos de malla y 8 de partículas', render: renderMeshes, studio: () => ({ kinds: ['meshes', 'particles'] }) },
  { id: 'equalizers', label: 'Ecualizadores', icon: 'equalizers', title: 'Ecualizadores 3D', sub: 'Reactor, Púlsar, Vórtice y Matriz sobre el espectro de la canción', render: renderEqualizers, studio: () => ({ kinds: ['equalizers'] }) },
  { id: 'photos', label: 'Fotos', icon: 'photos', title: 'Estudio de fotografías', sub: 'Galería, edición, efectos y filtros', render: renderPhotos, studio: (app) => ({ kind: 'photo', photoId: app.store.project.photos[0]?.id, fx: app._photoFx, withTunnel: true }) },
  { id: 'filters', label: 'Filtros', icon: 'filters', title: 'Filtros', sub: '13 filtros combinables con intensidad ajustable', render: renderFilters },
  { id: 'transitions', label: 'Transiciones', icon: 'transitions', title: 'Transiciones cinematográficas', sub: '17 transiciones con duración, curva, dirección, intensidad y color', render: renderTransitions, studio: (app) => ({ kind: 'transition', type: app._transStudio?.type || 'portal', params: app._transStudio?.params || {}, duration: app._transStudio?.duration || 1.5 }) },
  { id: 'music', label: 'Música', icon: 'music', title: 'Música y analizador', sub: 'Reproductor, forma de onda, recorte, marcadores y BPM', render: renderMusic },
  { id: 'sync', label: 'Sincronía', icon: 'sync', title: 'Sincronización', sub: 'Cómo reacciona cada módulo a la música', render: renderSync },
  { id: 'timeline', label: 'Línea de tiempo', icon: 'timeline', title: 'Línea de tiempo', sub: 'Editor multipista con deshacer y rehacer', render: renderTimeline },
  { id: 'palettes', label: 'Paletas', icon: 'palettes', title: 'Paletas fluorescentes', sub: 'Tres colores, degradado y sincronía musical', render: renderPalettes },
  { id: 'export', label: 'Exportar', icon: 'export', title: 'Exportador MP4', sub: 'TikTok, CapCut, YouTube y cuadrado', render: renderExport },
  { id: 'library', label: 'Biblioteca', icon: 'library', title: 'Biblioteca', sub: 'Proyectos, composiciones y paletas guardadas', render: renderLibrary },
  { id: 'settings', label: 'Ajustes', icon: 'settings', title: 'Ajustes', sub: 'Rendimiento y sistema', render: renderSettings },
];
