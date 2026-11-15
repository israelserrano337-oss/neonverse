# Reparto de trabajo por modelos Claude

Claude no puede cambiar de modelo por sí mismo: **el modelo se elige a mano en el selector** antes de enviar cada mensaje. Este archivo dice cuál seleccionar para cada tipo de tarea, para aprovechar la suscripción Pro sin malgastar.

| Modelo | Uso en NEONVERSE | Ejemplos |
|---|---|---|
| **Fable 5.2** (incluido hasta el 16 de noviembre) | Tareas difíciles mientras esté disponible | Mejoras grandes del Auto Director, nuevos tipos de túnel/malla con shaders complejos, rediseños de arquitectura |
| **Sonnet 5** | Desarrollo habitual | Nuevos controles, ajustes de interfaz, nuevos filtros/transiciones, corrección de errores normales, integración |
| **Haiku 5.5** | Tareas auxiliares baratas | Actualizar documentación, CHANGELOG, comentarios, listados, revisar un error sencillo, resúmenes |
| **Opus 5.5** | Solo problemas críticos | Auditorías, fallos de exportación difíciles, rendimiento en el equipo de destino, revisión final antes de publicar |

## Historial

| Fecha | Modelo | Trabajo |
|---|---|---|
| 2026-11-14 | Opus 5.5 (elegido por el usuario para arrancar) | Fases 1–12: arquitectura, identidad, motor completo, Auto Director, línea de tiempo, exportador, empaquetado. Ver CHANGELOG.md |

## Reglas de consumo

- Antes de pedir trabajo, el modelo debe leer `PROJECT_STATE.md` y `TASKS.md` (no el proyecto entero).
- No regenerar archivos que funcionan; editar solo lo necesario.
- Una tarea por mensaje, con el archivo concreto a tocar.
- Opus no se usa para tareas rutinarias.
- No se usan API ni créditos adicionales.
