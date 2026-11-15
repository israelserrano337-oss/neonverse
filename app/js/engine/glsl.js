// Fragmentos GLSL compartidos: paleta de 3 colores, ruido, color y los 13 filtros.

export const PAL_GLSL = /* glsl */ `
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
uniform float uPalShift; uniform float uPalHard; uniform float uPalIntensity; uniform float uPalDir;
vec3 palRaw(float u){
  u = fract(u); float s = u * 3.0;
  float k = fract(s); k = mix(k*k*(3.0-2.0*k), step(0.5, k), uPalHard);
  if (s < 1.0) return mix(uC0, uC1, k);
  if (s < 2.0) return mix(uC1, uC2, k);
  return mix(uC2, uC0, k);
}
vec3 pal(float u){ return palRaw(u + uPalShift); }
vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
// Modo de color de una capa: 0 degradado, 1-3 color fijo, 4 arcoíris, 5 blanco caliente
vec3 layerColor(float u, float mode){
  if (mode < 0.5) return pal(u);
  if (mode < 1.5) return uC0;
  if (mode < 2.5) return uC1;
  if (mode < 3.5) return uC2;
  if (mode < 4.5) return hsv2rgb(vec3(fract(u + uPalShift), 0.85, 1.0));
  if (mode < 5.5) return mix(vec3(1.0), pal(u), 0.35);
  float p = clamp(fract(u) * 1.5, 0.0, 1.0); // 6: hielo original (azul → cian → blanco hielo)
  return p < 0.5 ? mix(vec3(0.165, 0.357, 1.0), vec3(0.247, 0.824, 1.0), p * 2.0) : mix(vec3(0.247, 0.824, 1.0), vec3(0.918, 0.973, 1.0), (p - 0.5) * 2.0);
}
`;

export const NOISE_GLSL = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), u.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x), u.y); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  float n = i.x + i.y*57.0 + i.z*113.0;
  return mix(mix(mix(hash11(n), hash11(n+1.0), u.x), mix(hash11(n+57.0), hash11(n+58.0), u.x), u.y),
             mix(mix(hash11(n+113.0), hash11(n+114.0), u.x), mix(hash11(n+170.0), hash11(n+171.0), u.x), u.y), u.z); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/** Los 13 filtros como funciones de color. `f[i]` es la cantidad 0..1 de cada uno (combinables). */
export const FILTER_IDS = ['cyberpunk', 'neonGlow', 'synthwave', 'electricBlue', 'ultraviolet', 'darkCinema', 'chromatic', 'fluorescent', 'thermal', 'plasma', 'holographic', 'rgb', 'highContrast'];

export const FILTERS_GLSL = /* glsl */ `
vec3 thermalMap(float x){
  vec3 c = mix(vec3(0.0,0.0,0.25), vec3(0.4,0.0,0.7), smoothstep(0.0,0.25,x));
  c = mix(c, vec3(1.0,0.0,0.3), smoothstep(0.25,0.5,x));
  c = mix(c, vec3(1.0,0.6,0.0), smoothstep(0.5,0.75,x));
  return mix(c, vec3(1.0,1.0,0.75), smoothstep(0.75,1.0,x));
}
// filtros de color puros (los que desplazan píxeles —chromatic, rgb— se aplican al muestrear)
vec3 applyFilters(vec3 c, vec2 uv, float f[13], float time){
  float l = luma(c);
  if (f[0] > 0.0) { // Cyberpunk: sombras cian, luces magenta, contraste
    vec3 g = mix(vec3(0.0,0.55,0.75)*l*1.6, vec3(1.0,0.25,0.85)*l*1.5, smoothstep(0.25,0.75,l));
    vec3 t = mix(c, g + c*0.35, 0.8); t = (t - 0.5) * 1.15 + 0.5;
    c = mix(c, t, f[0]);
  }
  if (f[1] > 0.0) { // Neon Glow: saturación y brillo en las luces
    vec3 h = rgb2hsv(max(c, 0.0)); h.y = min(1.0, h.y * 1.45); h.z *= 1.0 + 0.45 * smoothstep(0.35,1.0,h.z);
    c = mix(c, hsv2rgb(h), f[1]);
  }
  if (f[2] > 0.0) { // Synthwave: mapa morado-rosa-naranja con degradado vertical
    vec3 m = mix(vec3(0.12,0.0,0.3), vec3(1.0,0.16,0.6), smoothstep(0.1,0.6,l)); m = mix(m, vec3(1.0,0.75,0.3), smoothstep(0.6,1.0,l));
    m += vec3(0.25,0.0,0.3) * (1.0 - uv.y) * 0.4;
    c = mix(c, m, f[2] * 0.85);
  }
  if (f[3] > 0.0) { // Electric Blue: duotono azul eléctrico
    vec3 m = mix(vec3(0.0,0.02,0.12), vec3(0.15,0.55,1.0), l); m = mix(m, vec3(0.85,0.97,1.0), smoothstep(0.7,1.0,l));
    c = mix(c, m, f[3]);
  }
  if (f[4] > 0.0) { // Ultravioleta
    vec3 m = mix(vec3(0.05,0.0,0.12), vec3(0.55,0.1,1.0), l); m += vec3(0.6,0.3,1.0) * smoothstep(0.75,1.0,l) * 0.6;
    c = mix(c, m, f[4]);
  }
  if (f[5] > 0.0) { // Dark Cinema: negros profundos, desaturado, verde-azulado
    vec3 m = mix(vec3(l), c, 0.55); m = pow(max(m, 0.0), vec3(1.35)) * vec3(0.92, 1.0, 1.05);
    float bars = step(0.1, uv.y) * step(uv.y, 0.9);
    c = mix(c, m * mix(1.0, bars, 0.0), f[5]);
  }
  if (f[7] > 0.0) { // Fluorescent: tono desplazado a verdes/rosas ácidos y saturación máxima
    vec3 h = rgb2hsv(max(c, 0.0)); h.x = fract(h.x + 0.08 * sin(h.x * 12.0)); h.y = min(1.0, h.y * 1.9 + 0.15); h.z = pow(h.z, 0.85);
    c = mix(c, hsv2rgb(h), f[7]);
  }
  if (f[8] > 0.0) { c = mix(c, thermalMap(clamp(l * 1.1, 0.0, 1.0)), f[8]); } // Thermal Vision
  if (f[9] > 0.0) { // Plasma: mapa de paleta animado por luminancia
    vec3 m = pal(l * 1.3 + time * 0.05 + 0.15 * sin(uv.x * 6.0 + time)) * (0.25 + 1.1 * l);
    c = mix(c, m, f[9] * 0.85);
  }
  if (f[10] > 0.0) { // Holographic: iridiscencia + líneas finas
    vec3 irid = hsv2rgb(vec3(fract(l * 1.5 + uv.y * 0.6 + time * 0.03), 0.55, 1.0));
    float scan = 0.85 + 0.15 * sin(uv.y * 900.0);
    c = mix(c, (c * 0.55 + irid * l * 0.9) * scan, f[10]);
  }
  if (f[12] > 0.0) { // High Contrast
    vec3 m = smoothstep(0.08, 0.92, c); m = mix(vec3(luma(m)), m, 1.25);
    c = mix(c, m, f[12]);
  }
  return c;
}
`;
