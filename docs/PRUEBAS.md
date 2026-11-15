# Pruebas

| Nivel | Orden | Qué comprueba |
|---|---|---|
| Lógica | `npm test` | Análisis (BPM 100–174, tempo a la mitad, golpes alineados, secciones), Auto Director (determinismo por semilla, 15 perfiles válidos, sin huecos, variedad, reparto de fotos, congelar/regenerar), línea de tiempo (cortar, duplicar, carriles), deshacer/rehacer, tamaños de exportación |
| Interfaz | `python3 qa/smoke.py` | Chrome real: arranque, 14 secciones, carga de música y fotos, Auto Director, reproducción, historial, cero errores de consola |
| Seguridad fotosensible | `python3 qa/safety.py [pista|tipo]` | Cada túnel (también a velocidad alta), malla, partícula, transición, efecto y efecto de foto por separado con música real: salto de brillo < 20/255 por fotograma y < 25 en 3 |
| Vídeo exportado | `python3 qa/brightness.py video.mp4` | Brillo por fotograma de un MP4 real |
| Exportación navegador | `python3 qa/browser_export.py` | WebCodecs + mp4-muxer, descarga y pistas |
| iPhone | `python3 qa/iphone.py` | Diseño en 393×852 táctil, sin desbordamientos |
| Beat-Sync | `python3 qa/beatsync.py` | Modos 1/2, 1, 2 y AUTO KICK; cambios de modo, NEXT y PREVIOUS en reproducción; un solo AudioContext; MP4 = vista previa fotograma a fotograma; destellos por segundo; coste |
| Escritorio | `electron . --selftest-export="salida.mp4|t0|t1|ancho|alto"` | Abre el ejemplo con música, exporta con FFmpeg y termina con código 0/1 |

Los scripts `qa/` usan Playwright con Google Chrome (`/usr/bin/google-chrome`); ajusta la ruta en tu equipo.
