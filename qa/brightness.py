# Mide el brillo medio de cada fotograma de un MP4 y los saltos entre fotogramas (seguridad fotosensible).
# Límites orientativos usados en NEONVERSE: < 20 niveles (de 255) por fotograma y < 25 en 3 fotogramas.
import subprocess, sys, numpy as np
path = sys.argv[1]
w, h = 90, 160
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={w}:{h}', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
m = fr.mean(axis=(1, 2))
d1 = np.abs(np.diff(m)); d3 = np.abs(m[3:] - m[:-3])
fps = 30
print(f'fotogramas {len(m)} · brillo medio {m.mean():.1f} (mín {m.min():.1f}, máx {m.max():.1f})')
print(f'salto máx 1 fotograma: {d1.max():.1f} (en {d1.argmax()/fps:.2f} s) · máx en 3 fotogramas: {d3.max():.1f}')
print(f'eventos >20 por fotograma: {(d1 > 20).sum()} · >25 en 3 fotogramas: {(d3 > 25).sum()}')
sat = (fr > 245).mean(axis=(1, 2))
print(f'píxeles quemados (>245): media {sat.mean()*100:.1f} % · máx {sat.max()*100:.1f} %')
