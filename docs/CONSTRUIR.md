# Construir el ejecutable de Windows

## En Windows (recomendado)
```
npm install
npm run dist
```
`npm run dist` descarga FFmpeg para Windows en `build/ffmpeg-win/` (una vez), empaqueta la app y genera en `dist/`:
- `NEONVERSE-AI-2.0-Instalador-2.0.0.exe` (NSIS, carpeta elegible, accesos directos)
- `NEONVERSE-AI-2.0-Portable-2.0.0.exe`

El icono (`build/icon.ico`, 16–256 px) y la información de versión se incrustan en el EXE con `scripts/after-pack.cjs` (resedit), sin firmar. El instalador usa `build/installer.ico`.

## En Linux
Igual, pero electron-builder necesita **Wine** para el instalador NSIS (`apt install wine`). Si la descarga de Electron falla por un proxy, copia `electron-v<versión>-win32-x64.zip` en `~/.cache/electron/`.

## Iconos
`npm run icons` (Python 3 + `rsvg-convert`) regenera todos los SVG/PNG/ICO desde `scripts/build-icons.py`.

## Ejemplos
`node scripts/make-examples.mjs` (necesita FFmpeg y Python con Pillow) regenera `app/examples/` con música e imágenes sintéticas propias.

> Nota: al final de `npm run dist` electron-builder puede mostrar «Cannot read properties of null (reading 'channel')». Es solo el archivo de actualizaciones automáticas (no configuradas): el instalador y el portable ya están generados en `dist/`.
