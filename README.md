# NEONVERSE AI 2.0 — Futuristic Music Video Studio

Estudio audiovisual que convierte música y fotografías en vídeos musicales futuristas: túneles 3D, mallas eléctricas, fotos animadas, filtros y transiciones, todo sincronizado con la canción y exportado a MP4 para TikTok, CapCut y YouTube. Funciona en local, sin suscripciones ni servicios de IA de pago.

## Instalar (Windows)

- **Instalador:** `NEONVERSE-AI-2.0-Instalador-2.0.0.exe` → elige carpeta, crea accesos directos.
- **Portable:** `NEONVERSE-AI-2.0-Portable-2.0.0.exe` → se ejecuta sin instalar.

Windows SmartScreen puede avisar porque el ejecutable no está firmado: «Más información → Ejecutar de todos modos». FFmpeg va incluido.

## Uso rápido

1. **Música** (MP3, WAV, AAC/M4A, FLAC): se analiza en tu equipo (BPM, golpes, graves/medios/agudos, secciones).
2. **Fotos** (JPG, PNG, WEBP).
3. **Auto Director AI** → elige un perfil (15) → **GENERAR VÍDEO**.
4. Retoca en los estudios o en la **línea de tiempo** (deshacer/rehacer ilimitado).
5. **Exportar MP4**: 720p–4K, 9:16 / 16:9 / 1:1 / personalizado, 24/30/60 FPS, H.264 o H.265.

Atajos: Espacio reproducir · Ctrl+Z / Ctrl+Y · Ctrl+S guardar · S cortar · D duplicar · Supr eliminar · M marcador · ←/→ un golpe.

## iPhone (sin PC)

Publica la versión web en GitHub Pages siguiendo `docs/IPHONE.md`: se abre en Safari, se añade a la pantalla de inicio, funciona sin conexión y exporta el MP4 en el propio iPhone con **Guardar en Fotos** (audio AAC con iOS 26+).

Para probarla en el PC: `npm run web` → http://localhost:5173.

## Desarrollo

```
npm install          # copia three.js y mp4-muxer a app/vendor
npm start            # app de escritorio (Electron)
npm test             # 16 pruebas de lógica
npm run dist         # instalador + portable de Windows (ver docs/CONSTRUIR.md)
```

Documentos: `ARCHITECTURE.md` (diseño), `PROJECT_STATE.md` (estado), `TASKS.md` (pendiente), `CHANGELOG.md`, `MODEL_ASSIGNMENTS.md` (qué modelo Claude usar), `docs/CONSTRUIR.md`, `docs/PRUEBAS.md`.
