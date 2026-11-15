# Cambios

## 2.4.0 — 15-11-2026
- **BEAT-SYNC PHOTO ENGINE PRO** (`app/js/beatsync/BeatSync.js`, módulo independiente): cambio de foto en cada bombo real (AUTO KICK, con opción de incluir la caja), o cada 1/2, 1 o 2 pulsos; el modo se cambia mientras suena y queda grabado en su instante. Botones NEXT / PREVIOUS (teclas N / B), cambio automático sí/no, sensibilidad, velocidad de transición, orden secuencial o aleatorio, 5 transiciones (corte, fundido cruzado, zoom dinámico, flash, RGB glitch).
- Reutiliza el análisis y el reloj de audio existentes (un solo AudioContext, sin analizadores nuevos); anti-rebote de 1/6 s; solo dos capas de foto reutilizadas (sin crear geometría en cada cambio); 2 µs de cálculo por fotograma.
- Se integra con un único gancho en la línea de tiempo (`setPhotoProvider`): motor 3D y exportador sin cambios. Es función pura del tiempo: el MP4 repite los cambios vistos.
- Detección de bombo mejorada: dominio grave frente a medios (distingue bombo de caja/palmada), «clic» en medios (descarta bajos) y umbral relativo a los golpes de cada canción.
- Al cargar el primer lote de fotos se activa Beat-Sync en AUTO KICK (el pase fijo sigue creándose como alternativa).

## 2.3.0 — 15-11-2026
- **Fotos en cada golpe de batería:** detección de golpes reales (bombo + caja, sin platillos; el bombo exige el «clic» de banda ancha para no confundirlo con un bajo). El pase de fotos cambia en cada golpe (modos: bombo y caja, solo bombo, solo golpes fuertes) y es el modo por defecto al cargar fotos.
- **Efecto de impacto** en cada cambio: zoom de impacto, glitch, RGB, sacudida, destello suave o variado; la foto nueva está completa justo en el golpe (fundido de 3 fotogramas adelantado).
- Igualación de brillo entre fotos en este modo y máximo de 4 cambios por segundo (≤ 2 destellos/s; WCAG 2.3.1 permite 3).
- Auto Director: en drops y subidas (con «cantidad de fotografías» ≥ 0,45) las fotos cambian en cada golpe con impacto.

## 2.2.0 — 14-11-2026
- **Ecualizadores 3D** (portados de «Reactor atómico · Ecualizador 3D»): **Reactor** (núcleo atómico, barras radiales en 13 niveles, órbitas y ondas de choque), **Púlsar** (esfera de 480 rayos), **Vórtice** (túnel de 24 anillos donde el espectro viaja al fondo) y **Matriz** (anillos de columnas).
- Nueva pista «Ecualizadores» en la línea de tiempo, sección de menú con estudio de capas, inspector, módulo de sincronía propio.
- Controles: tamaño, altura de barras, estela, velocidad, órbita de cámara, inclinación, núcleo, brillo, opacidad, color (paleta del proyecto, arcoíris o «Hielo y oro» original) y reacción.
- Versión determinista: el historial del espectro sale del análisis (la exportación coincide con la vista previa); limitador de brillo y envolventes suaves (barrido de seguridad 8/8).
- Auto Director: nuevo control «Ecualizadores 3D», preferencias por perfil y túnel atenuado cuando el ecualizador protagoniza la escena.

## 2.1.0 — 14-11-2026
- **iPhone sin PC:** versión web lista para GitHub Pages (`npm run build:web` → `dist-web/`, flujo `.github/workflows/pages.yml`), funciona sin conexión (service worker) y se instala en la pantalla de inicio.
- **Exportación en el iPhone:** MP4 H.264 + AAC con WebCodecs, escrito por trozos (sin duplicar memoria), cabecera AAC propia (evita el fallo de Safari 26, WebKit 302253), pantalla encendida durante la exportación, aviso si se sale de la app.
- **Guardar en Fotos:** botón que abre la hoja de compartir de iOS («Guardar vídeo»), más «Guardar en Archivos».
- **Interfaz iOS:** diseño de app a pantalla completa (vista previa fija, panel desplazable, menú inferior), sin zoom al tocar campos, zonas seguras, reproducción en una fila, línea de tiempo solo en su sección, audio que no silencia el interruptor lateral, almacenamiento persistente, fotos HEIC.

## 2.0.1 — 14-11-2026
- **Corregido:** al cargar fotos no se añadían al vídeo (solo se veía la foto seleccionada en la vista previa del estudio).
- Nuevo **pase de fotos al ritmo**: se crea automáticamente al cargar fotos; cambio cada golpe, 2 golpes, compás, 2 o 4 compases, exactamente sobre los golpes detectados; aspecto pantalla completa, enmarcado en el túnel o de fondo; efecto variado o fijo.
- Fundido cruzado entre fotos (la nueva entra encima; en mezcla aditiva, fundido simétrico): sin pasar por negro ni parpadeos. Con cambios rápidos solo se usan efectos de movimiento.
- Panel Fotos: vista previa «Pase en el vídeo» / «Foto seleccionada».
- Auto Director: fotos encajadas en la rejilla de golpes, aspecto común por escena y fundidos cruzados.

## 2.0.0 — 14-11-2026 (primera versión, desde cero)
- Arquitectura modular Electron + web (ES modules sin empaquetador), render determinista `renderFrame(t)`.
- Identidad: portal de anillos hexagonales con núcleo de energía; icono, simplificado, monocromo, instalador, logotipo horizontal/vertical, favicons, ICO multirresolución.
- Motor: 18 túneles superponibles, 12 mallas con reacción por bandas, 8 partículas, capa de fotos con 17 efectos, máscaras, recorte, parallax y relieve; 13 filtros combinables; 17 transiciones; 14 efectos; resplandor HDR y tonemapping.
- Análisis musical en Worker: bandas, golpes, BPM con corrección de tempo a la mitad, seguimiento de pulso por programación dinámica, secciones (intro, estrofa, subida, drop, pausa, final), envolventes lentas para el brillo.
- Auto Director AI: 15 perfiles, 10 controles creativos, semilla reproducible, otra versión, aleatorio inteligente, congelar/regenerar escena, guardar composición, cortes suaves.
- Línea de tiempo multipista (8 pistas) con mover, recortar, cortar, duplicar, eliminar, carriles, marcadores, imán al ritmo, zoom, deshacer/rehacer.
- Exportador MP4 720p–4K, 9:16/16:9/1:1/personalizado, 24/30/60 FPS, H.264/H.265, calidad o bitrate, audio AAC, carpeta y nombre.
- Modos Rendimiento/Equilibrado/Calidad, límite de FPS, reducción de partículas, tamaño de texturas, liberación de memoria.
- Versión web adaptable a iPhone, PWA, proyecto `.neonverse` con medios incrustados.
- Biblioteca (proyectos, composiciones, paletas), autoguardado, 3 proyectos de ejemplo con medios propios.
- Seguridad fotosensible: barrido automático y correcciones (onda de túnel sin corte, fundidos cercanos, flash limitado, transiciones sin cambios bruscos).
