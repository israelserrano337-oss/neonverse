# NEONVERSE en iPhone (sin depender del PC)

La versión web se publica gratis en **GitHub Pages** (HTTPS). En el iPhone se abre en Safari, se añade a la pantalla de inicio y funciona como una app: también **sin conexión** tras la primera visita y **exporta el MP4 en el propio iPhone**, que se guarda en **Fotos**.

## Publicarla (una vez, desde el PC o el iPhone)
1. Crea una cuenta en github.com (gratis) y un repositorio nuevo, por ejemplo `neonverse` (público: GitHub Pages gratuito lo requiere).
2. Descomprime `NEONVERSE-web-para-GitHub-Pages.zip`. Pulsa **Add file → Upload files** y arrastra **todo el contenido** de la carpeta (no la carpeta), incluido el archivo `.nojekyll`. Confirma con **Commit changes**.
3. **Settings → Pages → Build and deployment**: Source «Deploy from a branch», Branch `main` y carpeta `/ (root)` → **Save**.
4. En 1–2 minutos estará en `https://TU-USUARIO.github.io/neonverse/`.

*(Alternativa: subir el código fuente completo al repositorio y elegir Source «GitHub Actions»: `.github/workflows/pages.yml` publica la carpeta `app/` en cada cambio.)*

## Instalarla en el iPhone
1. Abre la dirección en **Safari** → botón Compartir → **Añadir a pantalla de inicio**.
2. Ábrela desde el icono (pantalla completa, sin barras de Safari).

## Exportar a la galería
1. Exportar → TikTok/CapCut 9:16, **1080p o 720p, 30 FPS** (4K puede agotar la memoria del iPhone).
2. **EXPORTAR MP4** y deja la app en primer plano (la pantalla no se apaga sola mientras exporta).
3. Al terminar pulsa **📲 Guardar en Fotos** → en el menú elige **«Guardar vídeo»**. También puedes «Guardar en Archivos».

Requisitos: **iOS 26 o posterior** para el audio AAC (con iOS 16.4–18 el vídeo se exporta sin audio y la app lo avisa). Vídeo H.264 por hardware.

## Notas
- Los proyectos se guardan en el iPhone (Safari). Para no perderlos, usa la app desde la pantalla de inicio y, de vez en cuando, Biblioteca → «Exportar proyecto .neonverse».
- Las fotos HEIC del iPhone se admiten; la música se elige desde la app Archivos (MP3, M4A/AAC, WAV).
- Para actualizar la app: sube los archivos nuevos al repositorio; el iPhone descarga la versión nueva al abrirla con conexión.
