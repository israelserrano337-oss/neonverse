// Biblioteca de 17 transiciones cinematográficas (pase de shader entre la escena A y la B).
import { PAL_GLSL, NOISE_GLSL } from '../engine/glsl.js';

export const TRANSITIONS = [
  ['fade', 'Fundido'], ['flash', 'Flash'], ['zoom', 'Zoom'], ['spin3d', 'Giro 3D'], ['wipe', 'Barrido'], ['glitch', 'Glitch'],
  ['rgb', 'RGB'], ['particles', 'Explosión de partículas'], ['portal', 'Portal'], ['tunnel', 'Túnel'], ['disintegrate', 'Desintegración'],
  ['ripples', 'Ondas circulares'], ['electric', 'Electricidad'], ['curtains', 'Cortinas de luz'], ['digital', 'Distorsión digital'],
  ['geometric', 'Transición geométrica'], ['plasma', 'Transición de plasma'],
].map(([id, label], index) => ({ id, label, index }));
export const TRANSITION_BY_ID = Object.fromEntries(TRANSITIONS.map((x) => [x.id, x]));

export const TRANSITION_PARAMS = [
  { key: 'speed', label: 'Velocidad (curva)', min: 0.3, max: 3, step: 0.01, value: 1 },
  { key: 'direction', label: 'Dirección (grados)', min: 0, max: 360, step: 1, value: 0 },
  { key: 'intensity', label: 'Intensidad', min: 0, max: 1, step: 0.01, value: 0.7 },
  { key: 'color', label: 'Color', options: [{ value: 'c0', label: 'Color 1 de la paleta' }, { value: 'c1', label: 'Color 2 de la paleta' }, { value: 'c2', label: 'Color 3 de la paleta' }, { value: 'white', label: 'Blanco' }, { value: 'custom', label: 'Personalizado' }], value: 'c0' },
  { key: 'customColor', label: 'Color personalizado', type: 'color', value: '#00f0ff' },
];

/** Curva de progreso: velocidad > 1 arranca rápido, < 1 arranca lento; siempre suave en los extremos. */
export function easeProgress(p, speed = 1) {
  let k = Math.min(1, Math.max(0, p));
  k = speed >= 1 ? 1 - Math.pow(1 - k, speed) : Math.pow(k, 1 / speed);
  return k * k * (3 - 2 * k);
}

export const TRANSITION_FRAG = /* glsl */ `
${PAL_GLSL}
${NOISE_GLSL}
uniform sampler2D tA; uniform sampler2D tB;
uniform float uP, uType, uDir, uInt, uTime, uAspect;
uniform vec3 uColor;
varying vec2 vUv;
bool is(float k){ return abs(uType - k) < 0.5; }
vec3 A(vec2 uv){ return texture2D(tA, clamp(uv, 0.0, 1.0)).rgb; }
vec3 B(vec2 uv){ return texture2D(tB, clamp(uv, 0.0, 1.0)).rgb; }
float bellp(float p){ return sin(3.14159265 * p) * sin(3.14159265 * p); }
void main(){
  vec2 uv = vUv; float p = uP; float I = uInt;
  vec2 dir = vec2(cos(uDir), sin(uDir));
  vec2 c = (uv - 0.5) * vec2(uAspect, 1.0);
  vec3 col;
  if (is(0.0)) col = mix(A(uv), B(uv), p);
  else if (is(1.0)) { // flash suave: campana de brillo limitada (segura)
    col = mix(A(uv), B(uv), smoothstep(0.0, 1.0, p)) + uColor * bellp(p) * (0.05 + 0.08 * I); // cambio repartido en toda la duración
  }
  else if (is(2.0)) { // zoom: A se acerca, B llega desde lejos
    float za = 1.0 + 2.5 * I * p, zb = 1.0 + 2.0 * I * (1.0 - p);
    vec3 a = A(0.5 + (uv - 0.5) / za), b = B(0.5 + (uv - 0.5) * zb);
    col = mix(a, b, smoothstep(0.3, 0.7, p));
  }
  else if (is(3.0)) { // giro 3D: rotación con perspectiva sobre el eje vertical
    float ang = p * 3.14159265; float s = cos(ang);
    float side = step(0.5, p);
    vec2 q = uv - 0.5; float persp = 1.0 + 0.6 * I * sin(ang) * q.x * sign(s + 1e-4);
    vec2 r = vec2(q.x / max(abs(s), 0.02), q.y / persp) + 0.5;
    bool inside = r.x >= 0.0 && r.x <= 1.0 && r.y >= 0.0 && r.y <= 1.0;
    vec3 face = side < 0.5 ? A(r) : B(vec2(1.0 - r.x, r.y));
    vec3 under = mix(A(uv), B(uv), p) * 0.7; // sin fundido a negro; mezcla lineal (cambio de brillo gradual)
    col = inside ? mix(under, face, abs(s)) : under; // la cara se funde con el fondo al ponerse de canto
  }
  else if (is(4.0)) { // barrido con borde luminoso
    float d = dot(uv - 0.5, dir) + 0.5; float e = p * 1.3 - 0.15;
    float m = smoothstep(e - 0.03, e + 0.03, d);
    col = mix(B(uv), A(uv), m) + uColor * exp(-pow((d - e) * 30.0, 2.0)) * I * 1.4;
  }
  else if (is(5.0)) { // glitch
    float g = bellp(p) * I; float row = floor(uv.y * 30.0); float k = step(1.0 - g, hash21(vec2(row, floor(uTime * 15.0))));
    vec2 o = vec2((hash21(vec2(row, floor(uTime * 15.0) + 1.0)) - 0.5) * 0.25 * g * k, 0.0);
    float sel = step(hash21(vec2(floor(uv.y * 12.0), floor(uTime * 10.0))), p);
    vec3 s1 = mix(A(uv + o), B(uv + o), sel);
    col = vec3(mix(A(uv + o + vec2(0.02 * g, 0.0)), B(uv + o + vec2(0.02 * g, 0.0)), sel).r, s1.g, mix(A(uv + o - vec2(0.02 * g, 0.0)), B(uv + o - vec2(0.02 * g, 0.0)), sel).b);
  }
  else if (is(6.0)) { // RGB: canales separados que se cruzan
    float g = bellp(p) * I * 0.08;
    vec3 a = vec3(A(uv + dir * g).r, A(uv).g, A(uv - dir * g).b), b = vec3(B(uv + dir * g).r, B(uv).g, B(uv - dir * g).b);
    col = vec3(mix(a.r, b.r, smoothstep(0.0, 0.8, p)), mix(a.g, b.g, smoothstep(0.1, 0.9, p)), mix(a.b, b.b, smoothstep(0.2, 1.0, p)));
  }
  else if (is(7.0)) { // explosión de partículas: celdas que salen disparadas
    vec2 g = uv * vec2(48.0 * uAspect, 48.0); vec2 id = floor(g);
    float r = hash21(id); vec2 v = (vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 2.0;
    float k = smoothstep(r * 0.6, r * 0.6 + 0.4, p);
    vec2 src = uv - (normalize(c + 1e-4) * 0.35 + v * 0.25) * k * I;
    vec3 a = A(src) * (1.0 - k) + uColor * k * (1.0 - k) * 2.0 * I;
    col = mix(a, B(uv), smoothstep(0.45, 1.0, p));
  }
  else if (is(8.0)) { // portal: círculo que se abre con anillo de energía
    float r = length(c); float R = sqrt(p) * (0.9 + 0.3 * I); // área ∝ p: el brillo cambia a ritmo constante
    float m = smoothstep(R + 0.06, R - 0.06, r); // borde suave
    vec2 sw = uv + vec2(sin(atan(c.y, c.x) * 6.0 + uTime * 4.0), cos(r * 30.0 - uTime * 5.0)) * 0.01 * I * (1.0 - p);
    col = mix(A(sw), B(uv), m) + pal(r * 2.0 + uTime * 0.2) * exp(-pow((r - R) * 40.0, 2.0)) * 0.45 * I;
  }
  else if (is(9.0)) { // túnel: desenfoque radial hacia el centro y salida
    vec3 acc = vec3(0.0); float s = bellp(p) * 0.25 * I;
    for (int i = 0; i < 10; i++) { float f = 1.0 - s * float(i) / 10.0; vec2 q = 0.5 + (uv - 0.5) * f; acc += mix(A(q), B(q), smoothstep(0.15, 0.85, p)); }
    col = acc / 10.0 + uColor * bellp(p) * 0.06 * I;
  }
  else if (is(10.0)) { // desintegración por ruido con borde ardiente
    float n = smoothstep(0.22, 0.72, fbm(uv * vec2(uAspect, 1.0) * 6.0)); // reparto uniforme: el cambio avanza a ritmo constante
    float e = p * 1.2 - 0.1; float m = smoothstep(e - 0.08, e + 0.08, n);
    col = mix(B(uv), A(uv), m) + uColor * smoothstep(0.04, 0.0, abs(n - e)) * 0.55 * I;
  }
  else if (is(11.0)) { // ondas circulares
    float r = length(c); float w = sin(r * 40.0 - p * 30.0) * bellp(p) * 0.02 * I;
    vec2 q = uv + normalize(c + 1e-4) * w;
    col = mix(A(q), B(q), smoothstep(p * 1.2 - 0.2, p * 1.2, 0.9 - r));
  }
  else if (is(12.0)) { // electricidad: rayos en el frente de cambio
    float d = dot(uv - 0.5, dir) + 0.5;
    float jag = (vnoise(vec2(uv.y * 20.0 + uTime * 30.0, uTime * 7.0)) - 0.5) * 0.12 * I;
    float e = p * 1.2 - 0.1 + jag; float m = smoothstep(e - 0.01, e + 0.01, d);
    float bolt = exp(-pow((d - e) * 80.0, 2.0)) + 0.4 * exp(-pow((d - e) * 15.0, 2.0));
    col = mix(B(uv), A(uv), m) + mix(uColor, vec3(1.0), 0.4) * bolt * 0.9 * I;
  }
  else if (is(13.0)) { // cortinas de luz
    float bars = 10.0; float id = floor(uv.x * bars); float off = hash11(id) * 0.4;
    float k = smoothstep(off, off + 0.6, p);
    float edge = smoothstep(0.0, 0.5, k) * smoothstep(1.0, 0.5, k);
    col = mix(A(uv), B(uv), step(1.0 - k, uv.y)) + uColor * edge * 0.25 * I * (0.6 + 0.4 * sin(uv.x * bars * 6.283));
  }
  else if (is(14.0)) { // distorsión digital: pixelado + franjas
    float px = mix(1.0, 64.0, bellp(p) * I);
    vec2 res = vec2(uAspect, 1.0) * 540.0 / px; vec2 q = (floor(uv * res) + 0.5) / res;
    float slice = step(0.7, hash21(vec2(floor(uv.y * 40.0), floor(uTime * 12.0)))) * bellp(p) * I;
    q.x += (hash21(vec2(floor(uv.y * 40.0), 1.0)) - 0.5) * 0.1 * slice;
    col = mix(A(q), B(q), smoothstep(0.0, 1.0, p));
  }
  else if (is(15.0)) { // geométrica: rejilla hexagonal que se revela
    vec2 g = c * 12.0; vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5;
    vec2 a1 = mod(g, r) - h, b1 = mod(g - h, r) - h; vec2 gv = dot(a1, a1) < dot(b1, b1) ? a1 : b1;
    vec2 id = g - gv; float delay = hash21(floor(id * 10.0)) * 0.5 + length(id) * 0.02;
    float k = smoothstep(delay, delay + 0.5, p);
    float hexd = max(abs(gv.x) * 0.866 + abs(gv.y) * 0.5, abs(gv.y));
    float m = step(hexd, k * 0.6);
    col = mix(A(uv), B(uv), m) + uColor * smoothstep(0.02, 0.0, abs(hexd - k * 0.6)) * (1.0 - k) * 1.5 * I;
  }
  else { // plasma
    float v = sin(c.x * 8.0 + uTime) + sin(c.y * 9.0 - uTime * 1.3) + sin((c.x + c.y) * 6.0 + uTime * 0.7) + fbm(c * 3.0 + uTime * 0.3) * 2.0;
    v = smoothstep(0.2, 0.8, v * 0.125 + 0.5); float e = p * 1.2 - 0.1;
    float m = smoothstep(e - 0.08, e + 0.08, v);
    col = mix(B(uv), A(uv), m) + pal(v + uTime * 0.1) * smoothstep(0.05, 0.0, abs(v - e)) * 0.5 * I;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
