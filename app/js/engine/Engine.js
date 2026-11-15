// Motor de render: compone capas 3D por escena, transición A/B, resplandor y posproceso (filtros + efectos).
// Todo es función de t: la exportación vuelve a dibujar exactamente lo mismo que la vista previa.
import * as THREE from 'three';
import { PAL_UNIFORMS, disposeObject } from './materials.js';
import { PAL_GLSL, NOISE_GLSL, FILTERS_GLSL, FILTER_IDS } from './glsl.js';
import { TUNNEL_BY_ID, TUNNEL_PARAMS } from '../studios/tunnels.js';
import { MESH_BY_ID, MESH_PARAMS } from '../studios/meshes.js';
import { PARTICLE_BY_ID, PARTICLE_PARAMS } from '../studios/particles.js';
import { EQ_BY_ID, EQ_PARAMS } from '../studios/equalizers.js';
import { buildPhotoLayer, PHOTO_CLIP_PARAMS, PHOTO_SETTINGS } from '../studios/photos.js';
import { TRANSITION_BY_ID, TRANSITION_FRAG, TRANSITION_PARAMS, easeProgress } from '../studios/transitions.js';
import { EFFECT_PARAMS } from '../studios/effects.js';
import { resolvePalette } from '../studios/palettes.js';
import { withDefaults, rebuildKey, clamp, bell } from '../core/util.js';

THREE.ColorManagement.enabled = false;

export const CATALOG = {
  tunnels: { byId: TUNNEL_BY_ID, schema: TUNNEL_PARAMS, order: 0 },
  meshes: { byId: MESH_BY_ID, schema: MESH_PARAMS, order: 1 },
  particles: { byId: PARTICLE_BY_ID, schema: PARTICLE_PARAMS, order: 2 },
  equalizers: { byId: EQ_BY_ID, schema: EQ_PARAMS, order: 1.5 },
};

export function effectiveParams(track, clip, project) {
  if (track === 'photos') {
    const photo = project?.photos.find((x) => x.id === clip.params?.photoId);
    const out = { ...withDefaults(PHOTO_CLIP_PARAMS, clip.params), ...withDefaults(PHOTO_SETTINGS, photo?.settings || {}), photoId: clip.params?.photoId };
    if (out.blend && out.blend !== 'auto') out.layer = out.blend;
    if (out.frame && out.frame !== 'none') { out.mask = out.frame; out.scale *= out.frameScale; out.fit = 'cover'; if (out.layer === 'back') out.layer = 'front'; }
    return out;
  }
  const cat = CATALOG[track];
  const item = cat.byId[clip.type];
  return withDefaults(cat.schema, { ...(item?.defaults || {}), ...(clip.params || {}) });
}

const FS_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = /* glsl */ `uniform sampler2D tSrc; uniform float uThr; varying vec2 vUv;
void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b)); float k = smoothstep(uThr, uThr + 0.35, l); gl_FragColor = vec4(c * k, 1.0); }`;
const BLUR_FRAG = /* glsl */ `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main(){ vec3 s = texture2D(tSrc, vUv).rgb * 0.227027;
  s += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.316216;
  s += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(s, 1.0); }`;

const POST_FRAG = /* glsl */ `
${PAL_GLSL}
${NOISE_GLSL}
${FILTERS_GLSL}
uniform sampler2D tScene; uniform sampler2D tBloom1; uniform sampler2D tBloom2;
uniform float uBloom, uTime, uAspect, uExposure, uGrain, uVig, uFrame;
uniform float uF[13];
uniform float uGlitch, uRGB, uChrom, uWaves, uMirror, uScan, uNoise, uPixel, uFlash, uZoom;
uniform vec2 uShake; uniform vec2 uRes;
varying vec2 vUv;
vec3 sceneAt(vec2 uv){ uv = clamp(uv, 0.0, 1.0); return texture2D(tScene, uv).rgb + (texture2D(tBloom1, uv).rgb * 0.9 + texture2D(tBloom2, uv).rgb * 0.7) * uBloom; }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 uv = (vUv - 0.5) / uZoom + 0.5 + uShake;
  if (uMirror > 0.0) {
    vec2 m = vec2(0.5 - abs(uv.x - 0.5), uv.y);
    if (uMirror > 0.5) m.y = 0.5 - abs(uv.y - 0.5);
    uv = mix(uv, m, smoothstep(0.0, 0.25, uMirror));
  }
  if (uWaves > 0.0) uv += vec2(sin(uv.y * 22.0 + uTime * 3.0), cos(uv.x * 18.0 + uTime * 2.5)) * 0.008 * uWaves;
  if (uPixel > 0.0) { vec2 r = uRes / (1.0 + uPixel * 24.0); uv = (floor(uv * r) + 0.5) / r; }
  if (uGlitch > 0.0) {
    float row = floor(uv.y * 36.0); float tick = floor(uTime * 10.0);
    float k = step(1.0 - 0.45 * uGlitch, hash21(vec2(row, tick)));
    uv.x += k * (hash21(vec2(row, tick + 5.0)) - 0.5) * 0.12 * uGlitch;
  }
  vec3 c;
  float split = uRGB * 0.012 + uF[11] * 0.008 + uGlitch * 0.004;
  if (split > 0.0 || uChrom > 0.0 || uF[6] > 0.0) {
    vec2 dir = (uv - 0.5) * (uChrom * 0.03 + uF[6] * 0.02) + vec2(split, 0.0);
    c = vec3(sceneAt(uv + dir).r, sceneAt(uv).g, sceneAt(uv - dir).b);
  } else c = sceneAt(uv);
  c = aces(c * uExposure * 1.1);
  c = applyFilters(c, vUv, uF, uTime);
  c += mix(vec3(1.0), uC0, 0.35) * uFlash;
  if (uScan > 0.0) c *= 1.0 - uScan * 0.22 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.5));
  float vig = smoothstep(0.85, 0.2, length((vUv - 0.5) * vec2(uAspect, 1.0) * 1.15));
  c *= mix(1.0, vig, uVig);
  float g = hash21(vUv * uRes + uFrame * 13.17) - 0.5;
  c += g * (uGrain + uNoise * 0.15);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

class Slot {
  constructor(engine) {
    this.engine = engine;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020108);
    this.camera = new THREE.PerspectiveCamera(70, 9 / 16, 0.05, 400);
    this.pool = new Map(); // clipId -> { key, layer, track, unused }
  }
  render(set, t, ctx, target) {
    const { project, audioFor, quality, aspect, renderHeight } = ctx;
    for (const e of this.pool.values()) e.used = false;
    // Cámara: perspectiva del primer túnel; vaivén global según el movimiento de cámara
    let fov = 68, camAmt = 0.12;
    const tun = set.tunnels[0];
    if (tun) { const p = effectiveParams('tunnels', tun, project); fov = p.perspective / p.zoom; camAmt = Math.max(camAmt, p.camera); }
    for (const m of set.meshes) camAmt = Math.max(camAmt, 0.3 * (effectiveParams('meshes', m, project).amplitude || 0));
    const sway = [Math.sin(t * 0.37) * camAmt * 0.5, Math.cos(t * 0.29) * camAmt * 0.32];
    const cam = this.camera;
    const ka = audioFor('tunnels'), kp = Math.min(1, ka.kickPulse || 0) * Math.min(1, 0.45 + camAmt);
    cam.fov = clamp(fov * (1 - 0.02 * kp), 20, 130); cam.aspect = aspect; cam.updateProjectionMatrix();
    cam.position.set(sway[0], sway[1], -0.3 * kp);
    cam.lookAt(sway[0] * 0.2, sway[1] * 0.2, -30);
    const env = { quality, aspect, fov: cam.fov, camSway: sway, renderHeight, pixelRatio: renderHeight / 960, photoTexture: ctx.photoTexture, spectrumAt: this.engine.spectrumAt };
    const order = { photos: 0, tunnels: 0, meshes: 1, equalizers: 1.5, particles: 2 };
    for (const track of ['photos', 'tunnels', 'meshes', 'equalizers', 'particles']) {
      (set[track] || []).forEach((clip, idx) => {
        const p = effectiveParams(track, clip, project);
        let key;
        if (track === 'photos') key = 'photo|' + quality.level;
        else {
          const item = CATALOG[track].byId[clip.type];
          if (!item) return;
          key = rebuildKey(clip.type, CATALOG[track].schema, p) + '|' + quality.level;
        }
        let e = this.pool.get(clip.id);
        if (e && e.key !== key) { this.scene.remove(e.layer.object); disposeObject(e.layer.object); this.pool.delete(clip.id); e = null; }
        if (!e) {
          const layer = track === 'photos' ? buildPhotoLayer(p, env) : CATALOG[track].byId[clip.type].build(p, env);
          e = { key, layer, track };
          this.pool.set(clip.id, e);
          this.scene.add(layer.object);
        }
        e.used = true; e.age = 0;
        const obj = e.layer.object;
        obj.visible = true;
        const local = t - clip.start;
        const a = audioFor(track === 'photos' ? 'photos' : track);
        const lenv = Object.assign(env, { local, dur: clip.dur, order: idx });
        e.layer.update(t, a, p, lenv);
        if (track !== 'photos') { const ro = order[track] * 10 + idx; obj.traverse((o) => { o.renderOrder = ro; }); }
      });
    }
    for (const [id, e] of this.pool) {
      if (!e.used) {
        e.layer.object.visible = false;
        e.age = (e.age || 0) + 1;
        if (e.age > 240) { this.scene.remove(e.layer.object); disposeObject(e.layer.object); this.pool.delete(id); }
      }
    }
    const r = this.engine.renderer;
    r.setRenderTarget(target);
    r.clear();
    r.render(this.scene, cam);
  }
  clear() { for (const e of this.pool.values()) { this.scene.remove(e.layer.object); disposeObject(e.layer.object); } this.pool.clear(); }
}

function fsPass(frag, uniforms) {
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  return { scene, material: m, uniforms };
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false, depth: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    const gl = this.renderer.getContext();
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.slots = [new Slot(this), new Slot(this)];
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rt = {};
    this.size = { w: 0, h: 0 };
    this.frame = 0;
    this.textures = new Map(); // photoId -> { texture, aspect, luma, w }
    this.spectrumAt = null; // (t, out) => espectro de 32 bandas en t (lo asigna la app)
    this.transPass = fsPass(TRANSITION_FRAG, { ...PAL_UNIFORMS, tA: { value: null }, tB: { value: null }, uP: { value: 0 }, uType: { value: 0 }, uDir: { value: 0 }, uInt: { value: 0.7 }, uTime: { value: 0 }, uAspect: { value: 1 }, uColor: { value: new THREE.Color() } });
    this.brightPass = fsPass(BRIGHT_FRAG, { tSrc: { value: null }, uThr: { value: 0.6 } });
    this.blurPass = fsPass(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.postPass = fsPass(POST_FRAG, {
      ...PAL_UNIFORMS, tScene: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
      uBloom: { value: 1 }, uTime: { value: 0 }, uAspect: { value: 1 }, uExposure: { value: 1 }, uGrain: { value: 0.04 }, uVig: { value: 0.35 }, uFrame: { value: 0 },
      uF: { value: new Array(13).fill(0) }, uGlitch: { value: 0 }, uRGB: { value: 0 }, uChrom: { value: 0 }, uWaves: { value: 0 }, uMirror: { value: 0 },
      uScan: { value: 0 }, uNoise: { value: 0 }, uPixel: { value: 0 }, uFlash: { value: 0 }, uZoom: { value: 1 }, uShake: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(1, 1) },
    });
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; console.warn('Contexto WebGL perdido'); });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.rt = {}; this.size = { w: 0, h: 0 }; this.slots.forEach((s) => s.clear()); this.textures.clear(); });
  }

  info() {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), hdr: this.hdr, webgl2: this.renderer.capabilities.isWebGL2 };
  }

  /** Crea o redimensiona los render targets internos al tamaño de trabajo. */
  ensureTargets(w, h, bloomScale = 0.25) {
    if (this.size.w === w && this.size.h === h && this.size.bs === bloomScale) return;
    for (const k in this.rt) this.rt[k].dispose();
    const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const mk = (W, H, depth = false) => new THREE.WebGLRenderTarget(Math.max(2, Math.round(W)), Math.max(2, Math.round(H)), { type, depthBuffer: depth, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rt = {
      a: mk(w, h, true), b: mk(w, h, true), mix: mk(w, h),
      b1a: mk(w * bloomScale, h * bloomScale), b1b: mk(w * bloomScale, h * bloomScale),
      b2a: mk(w * bloomScale * 0.5, h * bloomScale * 0.5), b2b: mk(w * bloomScale * 0.5, h * bloomScale * 0.5),
    };
    this.size = { w, h, bs: bloomScale };
  }

  setCanvasSize(w, h) { this.renderer.setSize(w, h, false); }

  /** Textura de una foto (se registra al cargarla con loadPhoto). */
  photoTexture = (id) => this.textures.get(id) || null;
  setPhotoImage(id, img) {
    const old = this.textures.get(id);
    if (old) old.texture.dispose();
    const tex = new THREE.CanvasTexture(img.canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
    tex.anisotropy = 1;
    tex.userData.shared = true;
    this.textures.set(id, { texture: tex, aspect: img.w / img.h, luma: img.luma, w: img.w });
  }
  dropPhoto(id) { const t = this.textures.get(id); if (t) { t.texture.dispose(); this.textures.delete(id); } }

  /**
   * Dibuja un fotograma.
   * @param {object} f { t, comp, project, audioFor, audioGlobal, quality, width, height, target }
   * target: null = lienzo; WebGLRenderTarget = exportación.
   */
  render(f) {
    if (this.lost) return;
    const { t, comp, project, quality } = f;
    const w = f.width, h = f.height;
    this.ensureTargets(w, h, quality.bloomScale);
    this.frame++;
    const aspect = w / h;
    // Paleta (uniformes compartidos por todos los materiales)
    const palette = resolvePalette(project, comp.lighting, t, f.audioFor('lighting'));
    PAL_UNIFORMS.uC0.value.copy(palette.colors[0]); PAL_UNIFORMS.uC1.value.copy(palette.colors[1]); PAL_UNIFORMS.uC2.value.copy(palette.colors[2]);
    PAL_UNIFORMS.uPalShift.value = palette.shift; PAL_UNIFORMS.uPalHard.value = palette.hard; PAL_UNIFORMS.uPalIntensity.value = palette.intensity; PAL_UNIFORMS.uPalDir.value = palette.dir;
    const ctx = { project, audioFor: f.audioFor, quality, aspect, renderHeight: h, photoTexture: this.photoTexture };
    let sceneTex;
    if (comp.transition && comp.B) {
      this.slots[0].render(comp.A, t, ctx, this.rt.a);
      this.slots[1].render(comp.B, t, ctx, this.rt.b);
      const tp = withDefaults(TRANSITION_PARAMS, comp.transition.params);
      const u = this.transPass.uniforms;
      u.tA.value = this.rt.a.texture; u.tB.value = this.rt.b.texture;
      u.uP.value = easeProgress(comp.progress, tp.speed);
      u.uType.value = TRANSITION_BY_ID[comp.transition.type]?.index ?? 0;
      u.uDir.value = (tp.direction * Math.PI) / 180;
      const ta = f.audioFor('transitions');
      u.uInt.value = tp.intensity * (0.85 + 0.3 * (ta.energy || 0));
      u.uTime.value = t; u.uAspect.value = aspect;
      const col = tp.color === 'custom' ? new THREE.Color(tp.customColor) : tp.color === 'white' ? new THREE.Color(1, 1, 1) : PAL_UNIFORMS[{ c0: 'uC0', c1: 'uC1', c2: 'uC2' }[tp.color] || 'uC0'].value;
      u.uColor.value.copy(col);
      this.renderer.setRenderTarget(this.rt.mix);
      this.renderer.render(this.transPass.scene, this.ortho);
      sceneTex = this.rt.mix.texture;
    } else {
      this.slots[0].render(comp.A, t, ctx, this.rt.a);
      sceneTex = this.rt.a.texture;
    }
    // Resplandor (dos niveles)
    const r = this.renderer, rt = this.rt;
    const fx = this.effectState(comp.effects, f.audioFor('effects'), t, project);
    const bloomAmt = (project.render.bloom ?? 1) * palette.bloom * (1 + fx.bloomBoost) * (1 + 0.5 * (fx.filters.neonGlow || 0));
    if (bloomAmt > 0.01) {
      this.brightPass.uniforms.tSrc.value = sceneTex; this.brightPass.uniforms.uThr.value = project.render.bloomThreshold ?? 0.55;
      r.setRenderTarget(rt.b1a); r.render(this.brightPass.scene, this.ortho);
      const blur = (src, dst, dx, dy) => { this.blurPass.uniforms.tSrc.value = src.texture; this.blurPass.uniforms.uDir.value.set(dx / src.width, dy / src.height); r.setRenderTarget(dst); r.render(this.blurPass.scene, this.ortho); };
      blur(rt.b1a, rt.b1b, 1, 0); blur(rt.b1b, rt.b1a, 0, 1);
      blur(rt.b1a, rt.b2a, 1.5, 0); blur(rt.b2a, rt.b2b, 0, 1.5); blur(rt.b2b, rt.b2a, 2, 0); blur(rt.b2a, rt.b2b, 0, 2);
    }
    const pu = this.postPass.uniforms;
    pu.tScene.value = sceneTex; pu.tBloom1.value = rt.b1a.texture; pu.tBloom2.value = rt.b2b.texture;
    pu.uBloom.value = bloomAmt > 0.01 ? bloomAmt : 0;
    pu.uTime.value = t; pu.uAspect.value = aspect; pu.uExposure.value = project.render.exposure ?? 1;
    pu.uGrain.value = project.render.grain ?? 0.04; pu.uVig.value = Math.min(1, (project.render.vignette ?? 0.35) + fx.vignette);
    pu.uFrame.value = Math.floor(t * 30);
    const fArr = pu.uF.value;
    FILTER_IDS.forEach((id, i) => { fArr[i] = clamp((project.filters?.[id] || 0) + (fx.filters[id] || 0)); });
    pu.uGlitch.value = fx.glitch; pu.uRGB.value = fx.rgbsplit; pu.uChrom.value = fx.chromatic; pu.uWaves.value = fx.waves; pu.uMirror.value = fx.mirror;
    pu.uScan.value = fx.scanlines; pu.uNoise.value = fx.noise; pu.uPixel.value = fx.pixelate; pu.uFlash.value = fx.flash; pu.uZoom.value = 1 + fx.zoompulse * 0.06;
    pu.uShake.value.set(fx.shake * 0.01 * Math.sin(t * 37.1), fx.shake * 0.01 * Math.cos(t * 41.3));
    pu.uRes.value.set(w, h);
    r.setRenderTarget(f.target || null);
    if (!f.target) r.setViewport(0, 0, w, h);
    r.render(this.postPass.scene, this.ortho);
    r.setRenderTarget(null);
  }

  /** Cantidad de cada efecto en t según sus clips (sincronía por golpe/compás con campanas suaves). */
  effectState(effects, a, t, project) {
    const s = { glitch: 0, rgbsplit: 0, chromatic: 0, shake: 0, zoompulse: 0, waves: 0, mirror: 0, scanlines: 0, noise: 0, vignette: 0, pixelate: 0, flash: 0, bloomboost: 0, bloomBoost: 0, filters: {} };
    for (const c of effects) {
      const p = withDefaults(EFFECT_PARAMS, c.params);
      const local = t - c.start;
      const edge = Math.min(1, local / 0.15, (c.dur - local) / 0.15);
      let env = 1;
      if (p.sync === 'beat') { const x = (a.beatPos || 0) * p.rate; const d = Math.abs(x - Math.round(x)); env = d < 0.45 ? Math.cos((Math.PI / 2) * (d / 0.45)) ** 2 : 0; }
      else if (p.sync === 'bar') { const x = (a.barPos || 0) * p.rate; const d = Math.abs(x - Math.round(x)); env = d < 0.25 ? Math.cos((Math.PI / 2) * (d / 0.25)) ** 2 : 0; }
      // Efectos que cambian el brillo: con golpes, menos cantidad (la geometría puede latir; la luz, suave)
      const lightFx = c.type === 'flash' || c.type === 'bloomboost' || c.type === 'scanlines' || c.type === 'vignette' || c.type === 'pixelate';
      if (lightFx && p.sync !== 'continuous') env *= 0.45;
      const amt = clamp(p.amount * env * Math.max(0, edge) * (a.gain ?? 1));
      if (c.type === 'filter') s.filters[p.filter] = (s.filters[p.filter] || 0) + p.amount * Math.max(0, edge);
      else if (c.type === 'flash') s.flash += 0.16 * amt;
      else if (c.type === 'bloomboost') s.bloomBoost += 0.6 * amt;
      else if (c.type in s) s[c.type] += amt;
    }
    s.flash = Math.min(0.2, s.flash);
    return s;
  }

  /** Lectura de píxeles RGBA de un render target (exportación). */
  readPixels(target, buffer) {
    this.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, buffer);
    return buffer;
  }

  disposeAll() { this.slots.forEach((s) => s.clear()); for (const k in this.rt) this.rt[k].dispose(); this.rt = {}; this.size = { w: 0, h: 0 }; }
}
