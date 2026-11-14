import {
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
  type Texture,
  type IUniform,
} from 'three';

/**
 * Post-processing slot.
 *
 * One pipeline owns the final image. With no enabled effects (or the whole pipeline disabled by
 * the graphics-quality preset) the scene renders straight to the canvas: zero extra cost, no
 * render targets allocated. Each effect is a single fullscreen-triangle pass; effects chain with
 * ping-pong render targets and the last one writes to the canvas.
 *
 * To add an effect: create a PostEffect (a ShaderMaterial with a `tDiffuse` sampler uniform),
 * push it to pipeline.effects. Keep fragment shaders cheap: this runs at native resolution.
 */
export interface PostEffect {
  name: string;
  enabled: boolean;
  material: ShaderMaterial;
  /**
   * The effect is a flash or pulse (the 3-frame chromatic kill pulse, the Surge frame glow): the
   * pipeline skips it while **Reduce flashing** is on (design §11, §13.3). Steady effects (vignette,
   * bloom) leave this unset.
   */
  flashing?: boolean;
}

/** Whether the pipeline runs `fx` this frame. */
function runs(fx: PostEffect, reduceFlashing: boolean): boolean {
  return fx.enabled && !(reduceFlashing && fx.flashing === true);
}

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Subtle darkened edges: a cheap proof that the slot works and a place to grow a grade pass. */
export function createVignetteEffect(): PostEffect {
  const material = new ShaderMaterial({
    uniforms: { tDiffuse: { value: null } as IUniform<Texture | null>, strength: { value: 0.35 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float strength;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = vUv - 0.5;
        float v = 1.0 - strength * smoothstep(0.25, 0.85, dot(d, d) * 2.0);
        gl_FragColor = vec4(c.rgb * v, c.a);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
  });
  return { name: 'vignette', enabled: true, material };
}

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

export class PostPipeline {
  readonly effects: PostEffect[] = [];
  /** Master switch (driven by the quality preset). */
  enabled = false;
  /** Reduce flashing (a setting): effects marked `flashing` do not run. */
  reduceFlashing = false;

  private rtA: WebGLRenderTarget | null = null;
  private rtB: WebGLRenderTarget | null = null;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private width = 1;
  private height = 1;
  private samples = 0;

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new Mesh(g);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Whether render() will use the offscreen path this frame. */
  get active(): boolean {
    if (!this.enabled) return false;
    for (let i = 0; i < this.effects.length; i++) if (runs(this.effects[i]!, this.reduceFlashing)) return true;
    return false;
  }

  setSize(width: number, height: number, samples: number): void {
    if (width === this.width && height === this.height && samples === this.samples) return;
    this.width = width;
    this.height = height;
    this.samples = samples;
    this.disposeTargets();
  }

  private ensureTargets(): void {
    if (this.rtA) return;
    const opts = { type: HalfFloatType, depthBuffer: true, samples: this.samples };
    this.rtA = new WebGLRenderTarget(this.width, this.height, opts);
    this.rtB = new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType, depthBuffer: false });
  }

  /**
   * Draw `scene`, then (if given) `overlay` on top with the depth buffer cleared (the first-person
   * weapon: its own camera and FOV, never clipped by the world), then run the effects over both.
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, overlay?: Overlay | null): void {
    if (!this.active) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      drawOverlay(renderer, overlay);
      return;
    }
    this.ensureTargets();
    let read = this.rtA!;
    let write = this.rtB!;
    renderer.setRenderTarget(read);
    renderer.render(scene, camera);
    drawOverlay(renderer, overlay);

    let remaining = 0;
    for (let i = 0; i < this.effects.length; i++) if (runs(this.effects[i]!, this.reduceFlashing)) remaining++;
    for (let i = 0; i < this.effects.length; i++) {
      const fx = this.effects[i]!;
      if (!runs(fx, this.reduceFlashing)) continue;
      remaining--;
      fx.material.uniforms.tDiffuse!.value = read.texture;
      this.quad.material = fx.material;
      renderer.setRenderTarget(remaining === 0 ? null : write);
      renderer.render(this.quadScene, this.quadCamera);
      const t = read;
      read = write;
      write = t;
    }
    renderer.setRenderTarget(null);
  }

  private disposeTargets(): void {
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.rtA = this.rtB = null;
  }

  dispose(): void {
    this.disposeTargets();
    this.quad.geometry.dispose();
    for (const fx of this.effects) fx.material.dispose();
  }
}
