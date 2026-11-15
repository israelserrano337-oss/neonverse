# NEONVERSE AI 2.0 — Arquitectura

Aplicación de escritorio (Electron) y web (navegador / iPhone) que convierte música y fotografías en vídeos musicales futuristas. Todo funciona en local: sin servicios de IA externos ni suscripciones.

## Principios

1. **Render determinista.** Cada fotograma es una función pura de `t` (segundos), del proyecto y del análisis musical precalculado. Nada de `Math.random()`, relojes del sistema ni estado acumulado entre fotogramas. Por eso la exportación vuelve a dibujar cada fotograma en `t = inicio + i / fps` y coincide con la previsualización. **No se graba la pantalla.**
2. **Análisis musical fuera de línea.** La canción se analiza una vez (Web Worker). Previsualización y exportación leen las mismas curvas (`analysis.at(t)`), nunca un analizador en vivo.
3. **Módulos separados.** Cada estudio (túneles, mallas, fotos, filtros, transiciones, paletas) es un módulo con un catálogo de tipos y un esquema de parámetros. La interfaz se genera a partir de los esquemas, así que todo control que aparece está conectado.
4. **Previsualización y exportación separadas.** La vista previa baja resolución, partículas y FPS según el modo de rendimiento; la exportación siempre renderiza a máxima calidad fuera de pantalla.
5. **Seguridad fotosensible.** Los pulsos van anclados al compás con envolventes suaves (campanas), nunca saltos de brillo de un fotograma.

## Estructura

```
neonverse/
├─ app/                       Aplicación (misma base para web, iPhone y Electron)
│  ├─ index.html              Estructura de la interfaz
│  ├─ css/neonverse.css       Estilo (cristal, neón, responsive)
│  ├─ assets/brand/           Icono, logotipo, favicon (SVG/PNG)
│  ├─ vendor/                 three.js y mp4-muxer copiados por scripts/vendor.mjs
│  └─ js/
│     ├─ main.js              Arranque: crea motor, estado, interfaz
│     ├─ core/                Estado del proyecto, deshacer/rehacer, eventos, semillas, almacenamiento
│     ├─ audio/               Decodificación, análisis (worker), reproductor
│     ├─ engine/              Renderer (Three.js), compositor de capas, posproceso, transiciones
│     ├─ studios/             Catálogos: túneles, mallas, partículas, fotos, filtros, efectos, transiciones, paletas
│     ├─ director/            Auto Director AI: perfiles y generador por reglas con semilla
│     ├─ timeline/            Modelo de pistas/clips y editor en lienzo
│     ├─ export/              Exportador (FFmpeg en escritorio, WebCodecs en navegador)
│     └─ ui/                  Controles generados por esquema y paneles de cada sección
├─ electron/                  Proceso principal, preload, puente con FFmpeg
├─ build/                     Iconos del EXE/instalador, FFmpeg de Windows (descargado)
├─ scripts/                   vendor, servidor web local, iconos, FFmpeg Windows, after-pack
├─ examples/                  Proyectos de ejemplo (.neonverse.json)
├─ test/                      Pruebas de lógica (node --test)
├─ qa/                        Pruebas en navegador real (Playwright) y medición de vídeos
└─ *.md                       Documentación y control del proyecto
```

## Modelo de datos (proyecto)

```js
{
  format: 'neonverse-project', version: 2,
  name, createdAt, updatedAt,
  seed,                                   // semilla global del Auto Director
  aspect: '9:16' | '16:9' | '1:1' | 'custom', customSize: {w,h},
  audio: { name, mime, duration, trimStart, trimEnd, markers: [t], offsetMs },
  photos: [{ id, name, w, h, settings: { zoom, rotate, crop, parallax, depth, opacity, mask, layer, effect, motion, ... } }],
  palette: { id, colors:[c1,c2,c3], gradient, direction, speed, brightness, saturation, intensity, auto, musicSync },
  customPalettes: [...],
  sync: { global, offsetMs, modules: { tunnels:{bass,mid,treble,beat}, meshes:…, photos:…, particles:…, lighting:…, effects:… } },
  director: { profile, controls:{…10 controles…}, seed, scenes:[{id,start,end,seed,frozen}] },
  timeline: { tracks: { photos:[], tunnels:[], meshes:[], particles:[], transitions:[], lighting:[], effects:[] }, markers:[] },
  render: { quality, bloom, vignette, grain },
}
clip = { id, track, type, start, dur, params:{…}, sceneId?, frozen? }
```

Los medios (audio y fotos) se guardan aparte (IndexedDB en web, disco en escritorio). El archivo `.neonverse` de intercambio incrusta los medios para pasar proyectos del iPhone al ordenador.

## Canal de render

```
t ─► analysis.at(t) ─► Timeline.evaluate(t) ─┬─ capas activas A (túneles, mallas, partículas, fotos)
                                             └─ transición activa? capas B
          Compositor ─► RT_A (Three.js) ─┐
                     ─► RT_B (Three.js) ─┴► Pase de transición (17 modos) ─► Posproceso
          Posproceso = bloom ligero + 13 filtros combinables + efectos (glitch, RGB, ondas…) + viñeta/grano
          ─► pantalla (vista previa)  |  ─► lectura de píxeles ─► FFmpeg / WebCodecs (exportación)
```

- Cada clip se convierte en un **objeto de capa** reutilizable (`pool` por id de clip). Solo se reconstruye si cambia un parámetro estructural (cantidad, grosor, forma).
- `update(t, audio, params, palette)` coloca todo para el instante `t`. El avance de túneles usa `t·velocidad + k·∫graves` (integral precalculada), así reaccionan a la música sin estado.

## Auto Director AI

Reglas locales + semilla (PRNG mulberry32). Pasos: secciones musicales → escenas alineadas a compases (duración según energía y controles) → elección de túnel/malla/partículas/foto/paleta/filtros con penalización por repetición reciente → transiciones en los límites (tipo según energía) → efectos en los golpes fuertes → movimientos de cámara. Las escenas pueden congelarse y regenerarse individualmente.

## Exportación

- **Escritorio:** el renderer dibuja cada fotograma en un *render target* del tamaño de salida, lee los píxeles y los envía al proceso principal, que los escribe en la entrada estándar de FFmpeg (`rawvideo rgba → libx264/libx265 o QuickSync`) junto con la pista de audio recortada. Con espera por contrapresión.
- **Navegador:** WebCodecs (`VideoEncoder` H.264 + `AudioEncoder` AAC/Opus) y `mp4-muxer`. En iPhone se recomienda exportar el proyecto `.neonverse` y renderizar en el PC.

## Rendimiento (Intel HD 5500 / GeForce 820M)

Modos *Rendimiento / Equilibrado / Calidad* que ajustan resolución de vista previa, densidad de partículas, segmentos de malla, resolución del bloom y FPS máximos. Las texturas de fotos se reducen a un máximo configurable y se decodifican una sola vez.
