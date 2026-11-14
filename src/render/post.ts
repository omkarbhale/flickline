import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { palette } from '../config/palette';
import type { PostTunables } from '../config/post';
import type { PostPreset } from '../config/render';
import { GpuTimer } from './gpuTimer';
import { BLOOM_DOWNSAMPLE, planPost, type PostPlan } from './postPlan';

/**
 * The post stack (design section 11 "Post", budget in section 14.1).
 *
 * With every effect off (the Low preset) the scene renders straight to the canvas: no render
 * targets exist and no pass runs. Otherwise the scene (and the first-person overlay) render into
 * one half-float target and:
 *
 *   1. bloom: a 4-tap threshold + box downsample x4 into a quarter-resolution target. At High two
 *      more quarter-resolution passes blur it (separable, 5 taps each). No mip chain.
 *   2. composite: the ONE full-screen pass. It adds the (clamped) bloom, applies the vignette and
 *      its damage mode and the chromatic split, and writes the canvas.
 *
 * Every other effect belongs in the composite shader as a few ALU ops, not as a new pass: a full
 * native-resolution pass is the cost the quality presets budget (`planPost`, `config/post.ts`).
 */

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Threshold (soft knee on the peak channel, so saturated emissives qualify) and 4x4 box downsample in 4 bilinear taps. */
const EXTRACT_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 texel;
uniform vec3 bright; // threshold, knee, per-tap cap
varying vec2 vUv;
vec3 tap(vec2 uv) {
  vec3 c = min(texture2D(tScene, uv).rgb, vec3(bright.z));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - bright.x + bright.y, 0.0, 2.0 * bright.y);
  soft = soft * soft / (4.0 * bright.y + 1e-4);
  return c * (max(soft, br - bright.x) / max(br, 1e-4));
}
void main() {
  vec3 s = tap(vUv + vec2(-texel.x, -texel.y)) + tap(vUv + vec2(texel.x, -texel.y))
         + tap(vUv + vec2(-texel.x, texel.y)) + tap(vUv + vec2(texel.x, texel.y));
  gl_FragColor = vec4(s * 0.25, 1.0);
}`;

/** Separable 9-tap Gaussian as 5 bilinear taps. */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 step;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSource, vUv).rgb * 0.227027027
    + (texture2D(tSource, vUv + step * 1.3846153846).rgb + texture2D(tSource, vUv - step * 1.3846153846).rgb) * 0.3162162162
    + (texture2D(tSource, vUv + step * 3.2307692308).rgb + texture2D(tSource, vUv - step * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform float chroma;      // 0..1 kill pulse envelope
uniform float chromaShift; // corner split as a fraction of the width at chroma = 1
#ifdef USE_BLOOM
uniform sampler2D tBloom;
uniform vec2 bloomTexel;
uniform vec2 bloomK;       // strength, max added light
#endif
#ifdef USE_VIGNETTE
uniform vec3 vig;          // strength, inner, outer (squared radius)
uniform float damage;      // 0..1 damage envelope
uniform vec2 damageK;      // extra edge darkening, edge tint
uniform vec3 damageColor;  // alert colour, linear
#endif
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  vec3 c;
#ifdef USE_CHROMA
  if (chroma > 0.0) {
    vec2 o = d * (chroma * chromaShift * 2.0);
    c = vec3(texture2D(tScene, vUv + o).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - o).b);
  } else {
    c = texture2D(tScene, vUv).rgb;
  }
#else
  c = texture2D(tScene, vUv).rgb;
#endif
#ifdef USE_BLOOM
  vec3 b = texture2D(tBloom, vUv).rgb;
#ifdef BLOOM_TAPS5
  vec2 h = bloomTexel * 0.75;
  b = b * 0.4 + 0.15 * (texture2D(tBloom, vUv + h).rgb + texture2D(tBloom, vUv - h).rgb
    + texture2D(tBloom, vUv + vec2(h.x, -h.y)).rgb + texture2D(tBloom, vUv + vec2(-h.x, h.y)).rgb);
#endif
  c += min(b * bloomK.x, vec3(bloomK.y));
#endif
#ifdef USE_VIGNETTE
  float r2 = dot(d, d) * 2.0;
  c *= 1.0 - vig.x * smoothstep(vig.y, vig.z, r2);
  if (damage > 0.0) {
    float e = smoothstep(0.1, 0.95, r2);
    c = c * (1.0 - damageK.x * damage * e) + damageColor * (damageK.y * damage * e * e);
  }
#endif
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** A second scene drawn over the world with its own camera (the viewmodel pass). */
export interface Overlay {
  scene: Scene;
  camera: PerspectiveCamera;
}

function drawOverlay(renderer: WebGLRenderer, overlay: Overlay | null | undefined): void {
  if (!overlay) return;
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(overlay.scene, overlay.camera);
  renderer.autoClear = autoClear;
}

function pass(vertexShader: string, fragmentShader: string, uniforms: Record<string, IUniform>): ShaderMaterial {
  return new ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
}

type TexUniform = IUniform<Texture | null>;

export class PostPipeline {
  /** What the current preset draws (counts for the overlay and the info panel). */
  plan: PostPlan = planPost({ bloom: false, blur: false, vignette: false, chromatic: false });
  /** Optional GPU timing of the post passes (debug only; null = off, no cost). */
  timer: GpuTimer | null = null;

  private flags: PostPreset = { bloom: false, blur: false, vignette: false, chromatic: false };
  private sceneRt: WebGLRenderTarget | null = null;
  private bloomA: WebGLRenderTarget | null = null;
  private bloomB: WebGLRenderTarget | null = null;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private width = 1;
  private height = 1;
  private samples = 0;

  private readonly extract: ShaderMaterial;
  private readonly blur: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly cu: Record<string, IUniform>;
  private blurSpread = 1;

  constructor(cfg: Readonly<PostTunables>) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new Mesh(g);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const b = cfg.bloom;
    this.extract = pass(FULLSCREEN_VERT, EXTRACT_FRAG, {
      tScene: { value: null } as TexUniform,
      texel: { value: new Vector2(1, 1) },
      bright: { value: new Vector3(b.threshold, b.knee, b.tapCap) },
    });
    this.blur = pass(FULLSCREEN_VERT, BLUR_FRAG, {
      tSource: { value: null } as TexUniform,
      step: { value: new Vector2() },
    });
    this.blurSpread = b.blurSpread;
    this.cu = {
      tScene: { value: null } as TexUniform,
      tBloom: { value: null } as TexUniform,
      bloomTexel: { value: new Vector2(1, 1) },
      bloomK: { value: new Vector2(b.strength, b.maxAdd) },
      chroma: { value: 0 },
      chromaShift: { value: cfg.chromatic.shift },
      vig: { value: new Vector3(cfg.vignette.strength, cfg.vignette.inner, cfg.vignette.outer) },
      damage: { value: 0 },
      damageK: { value: new Vector2(cfg.damage.darken, cfg.damage.tint) },
      damageColor: { value: new Color(palette.alert) },
    };
    this.composite = pass(FULLSCREEN_VERT, COMPOSITE_FRAG, this.cu);
  }

  /** Apply a quality preset's post flags. Changing them recompiles the composite (call `precompile` after). */
  configure(flags: Readonly<PostPreset>): void {
    const f = this.flags;
    const changed = f.bloom !== flags.bloom || f.blur !== flags.blur || f.vignette !== flags.vignette || f.chromatic !== flags.chromatic;
    if (!changed) return;
    f.bloom = flags.bloom;
    f.blur = flags.blur;
    f.vignette = flags.vignette;
    f.chromatic = flags.chromatic;
    this.plan = planPost(f);
    const d: Record<string, string> = {};
    if (f.bloom) d.USE_BLOOM = '';
    if (f.bloom && !f.blur) d.BLOOM_TAPS5 = '';
    if (f.vignette) d.USE_VIGNETTE = '';
    if (f.chromatic) d.USE_CHROMA = '';
    this.composite.defines = d;
    this.composite.needsUpdate = true;
    if (!this.plan.active || !f.bloom || !f.blur) this.disposeBloomB();
    if (!this.plan.active) this.disposeTargets();
  }

  /** Whether render() uses the offscreen path this frame. */
  get active(): boolean {
    return this.plan.active;
  }

  /** Damage vignette envelope 0..1 (only drawn where the preset has the vignette). */
  setDamage(v: number): void {
    this.cu.damage!.value = v;
  }

  /** Chromatic pulse envelope 0..1 (only drawn where the preset allows it). */
  setChroma(v: number): void {
    this.cu.chroma!.value = v;
  }

  setSize(width: number, height: number, samples: number): void {
    if (width === this.width && height === this.height && samples === this.samples) return;
    this.width = width;
    this.height = height;
    this.samples = samples;
    this.disposeTargets();
  }

  private ensureTargets(): void {
    if (!this.sceneRt) {
      this.sceneRt = new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType, depthBuffer: true, samples: this.samples });
      (this.extract.uniforms.texel!.value as Vector2).set(1 / this.width, 1 / this.height);
    }
    if (this.flags.bloom) {
      const w = Math.max(1, Math.ceil(this.width / BLOOM_DOWNSAMPLE));
      const h = Math.max(1, Math.ceil(this.height / BLOOM_DOWNSAMPLE));
      if (!this.bloomA) {
        this.bloomA = new WebGLRenderTarget(w, h, { type: HalfFloatType, depthBuffer: false });
        (this.cu.bloomTexel!.value as Vector2).set(1 / w, 1 / h);
      }
      if (this.flags.blur && !this.bloomB) this.bloomB = new WebGLRenderTarget(w, h, { type: HalfFloatType, depthBuffer: false });
    }
  }

  /** Compile the passes for the current flags now, so the first frame (or a quality switch) does not hitch. */
  precompile(renderer: WebGLRenderer): void {
    if (!this.plan.active) return;
    renderer.setRenderTarget(null);
    for (const m of [this.composite, this.flags.bloom ? this.extract : null, this.flags.blur ? this.blur : null]) {
      if (!m) continue;
      this.quad.material = m;
      renderer.compile(this.quadScene, this.quadCamera);
    }
  }

  private run(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * Draw `scene`, then (if given) `overlay` on top with the depth buffer cleared (the first-person
   * weapon: its own camera and FOV, never clipped by the world), then run the post passes over both.
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, overlay?: Overlay | null): void {
    if (!this.plan.active) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      drawOverlay(renderer, overlay);
      return;
    }
    this.ensureTargets();
    const sceneRt = this.sceneRt!;
    renderer.setRenderTarget(sceneRt);
    renderer.render(scene, camera);
    drawOverlay(renderer, overlay);

    // Every pass below overwrites its whole target, so the clears are skipped.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.timer?.begin();
    const bloomA = this.bloomA;
    if (this.flags.bloom && bloomA) {
      this.extract.uniforms.tScene!.value = sceneRt.texture;
      this.run(renderer, this.extract, bloomA);
      const bloomB = this.bloomB;
      if (this.flags.blur && bloomB) {
        const step = this.blur.uniforms.step!.value as Vector2;
        this.blur.uniforms.tSource!.value = bloomA.texture;
        step.set(this.blurSpread / bloomA.width, 0);
        this.run(renderer, this.blur, bloomB);
        this.blur.uniforms.tSource!.value = bloomB.texture;
        step.set(0, this.blurSpread / bloomA.height);
        this.run(renderer, this.blur, bloomA);
      }
      this.cu.tBloom!.value = bloomA.texture;
    }
    this.cu.tScene!.value = sceneRt.texture;
    this.run(renderer, this.composite, null);
    this.timer?.end();
    renderer.autoClear = autoClear;
    this.timer?.poll();
  }

  private disposeBloomB(): void {
    this.bloomB?.dispose();
    this.bloomB = null;
  }

  private disposeTargets(): void {
    this.sceneRt?.dispose();
    this.bloomA?.dispose();
    this.bloomB?.dispose();
    this.sceneRt = this.bloomA = this.bloomB = null;
  }

  /** Render targets currently allocated (0 whenever the pipeline is off). */
  get allocatedTargets(): number {
    return (this.sceneRt ? 1 : 0) + (this.bloomA ? 1 : 0) + (this.bloomB ? 1 : 0);
  }

  dispose(): void {
    this.disposeTargets();
    this.quad.geometry.dispose();
    this.extract.dispose();
    this.blur.dispose();
    this.composite.dispose();
  }
}
