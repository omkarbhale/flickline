import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { lerp } from '../core/math';
import { REFERENCE_ASPECT, verticalFovDeg } from '../core/view';
import { env, palette } from '../config/palette';
import type { EchoPresetId } from '../config/palette';
import { QUALITY_LEVELS, type QualityLevel } from '../config/render';
import type { Tunables } from '../config/tunables';
import type { MapDef } from '../sim/mapTypes';
import type { World } from '../sim/world';
import { BlobShadows } from './blobShadows';
import { applyEnvQuality, createEnvUniforms, horizonColor, type EnvUniforms } from './envShaders';
import { buildLevelMesh, type LevelMesh } from './levelMesh';
import { Sky } from './sky';
import { PostPipeline, type Overlay } from './post';
import { WorldHint } from './worldHint';
import { TargetsView } from './targetsView';

/** What a render layer sees each frame. One reused object: read it during `update` only. */
export interface RenderFrame {
  world: World;
  /** Interpolation between the last two ticks. */
  alpha: number;
  /** Seconds since the last drawn frame (0 for an immediate re-render). */
  dt: number;
}

/**
 * A visual subsystem a feature adds with `addLayer` (shot effects, hints, viewmodels). It builds
 * its objects into `renderer.scene` / `renderer.camera` when constructed; the renderer drives it.
 * Hot-path rule: `update` and `afterDraw` allocate nothing.
 */
export interface RenderLayer {
  /** Every drawn frame, after the camera is placed and before drawing, in the order added. */
  update(frame: RenderFrame): void;
  /** Right after the frame was drawn. */
  afterDraw?(): void;
  /** Canvas size in CSS pixels and the device pixel ratio, after every resize or quality change. */
  resize?(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/**
 * Everything three.js. Reads sim state (never writes it), interpolates between the last two
 * ticks, and owns the scene, camera, environment, targets and post pipeline. Features add their
 * own visuals as `RenderLayer`s (`addLayer`).
 *
 * Hot-path rules: render() allocates nothing. All vectors/matrices are scratch members.
 */
export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly post: PostPipeline;
  /**
   * The first-person overlay pass: drawn after the world with the depth buffer cleared, by its own
   * camera (own FOV; the world FOV is locked). The viewmodel layer owns its contents and sets the
   * camera's FOV and aspect in `resize`.
   */
  readonly overlay: Overlay = { scene: new Scene(), camera: new PerspectiveCamera(60, 16 / 9, 0.01, 4) };
  /** The single first-run hint floating over a target; hidden unless shown. */
  readonly hint: WorldHint;
  readonly stats: RenderStats = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };

  private quality: QualityLevel;
  private level: LevelMesh | null = null;
  private laneArmed = false;
  private readonly envUniforms: EnvUniforms;
  private readonly sky: Sky;
  private readonly blobs: BlobShadows;
  private readonly fog: Fog;
  private targetsView: TargetsView | null = null;
  private preset: EchoPresetId = 'ember';
  private readonly layers: RenderLayer[] = [];
  private readonly frame: RenderFrame = { world: null as unknown as World, alpha: 1, dt: 0 };
  private readonly proj = new Vector3();
  private width = 1;
  private height = 1;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly tunables: Tunables,
    initialQuality: QualityLevel,
  ) {
    this.quality = initialQuality;
    this.post = new PostPipeline(tunables.post);
    const preset = tunables.render.quality[initialQuality];
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.info.autoReset = false;

    const v = tunables.view;
    this.camera = new PerspectiveCamera(verticalFovDeg(v.hfovDeg, REFERENCE_ASPECT), 16 / 9, v.near, v.far);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Lightline environment: shared procedural-shader uniforms, sky dome, blob decals, fog.
    const r = tunables.render;
    this.envUniforms = createEnvUniforms(r, env);
    this.scene.background = new Color(palette.ink);
    this.fog = new Fog(palette.ink, r.fogNear, r.fogFar);
    this.scene.fog = this.fog;
    this.sky = new Sky(this.envUniforms, v.far);
    this.scene.add(this.sky.mesh);
    this.blobs = new BlobShadows(r.blob);
    this.scene.add(this.blobs.mesh);
    // The one directional light (plus ambient) for lit-material objects; the environment shaders
    // use the same direction from the shared uniforms.
    this.scene.add(new AmbientLight(0xffffff, r.light.objectAmbient));
    const sun = new DirectionalLight(0xffffff, r.light.objectSun);
    sun.position.set(...r.light.dir).multiplyScalar(12);
    this.scene.add(sun);

    this.hint = new WorldHint(this.scene, 'Click the orb');

    this.applyQuality();
  }

  /**
   * Add a feature's layer. Features are set up before the level loads, so the layers' shaders are
   * compiled ahead together with the level's.
   */
  addLayer(layer: RenderLayer): void {
    this.layers.push(layer);
    layer.resize?.(this.width, this.height, this.renderer.getPixelRatio());
  }

  /**
   * Enemy colour preset (design section 11). Applies to existing and future enemies; layers that
   * match it (the kill shatter) read `echoPreset`.
   */
  setEchoPreset(id: EchoPresetId): void {
    this.preset = id;
    this.targetsView?.setPreset(id);
  }

  get echoPreset(): EchoPresetId {
    return this.preset;
  }

  /** The enemy view (colour preset, showcase props, Gnat clock); null before a level loads. */
  get enemies(): TargetsView | null {
    return this.targetsView;
  }

  setQuality(q: QualityLevel): void {
    if (!QUALITY_LEVELS.includes(q)) return;
    this.quality = q;
    this.applyQuality();
    this.post.precompile(this.renderer);
  }

  private applyQuality(): void {
    const p = this.tunables.render.quality[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatioCap));
    this.post.configure(p.post);
    this.targetsView?.setQuality(p);
    applyEnvQuality(this.envUniforms, p);
    horizonColor(this.envUniforms, this.fog.color); // fog fades to the sky's horizon colour
    this.resize(this.width, this.height);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.overlay.camera.aspect = this.camera.aspect;
    this.overlay.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    const p = this.tunables.render.quality[this.quality];
    for (let i = 0; i < this.layers.length; i++) this.layers[i]!.resize?.(this.width, this.height, pr);
    this.post.setSize(Math.floor(this.width * pr), Math.floor(this.height * pr), p.antialias ? 4 : 0);
    this.targetsView?.setViewport(this.width * pr, this.height * pr);
  }

  /**
   * Build visuals for a level and its targets. With a `MapDef`, also applies its fog range and
   * floor markings (its sky/fog colours and palette name are superseded by the Lightline palette).
   */
  loadLevel(world: World, map?: MapDef): void {
    this.level?.dispose();
    if (this.level) this.scene.remove(this.level.root);
    if (map) {
      // Lightline owns the colours (one palette, design section 11); a map only sets how far the fog reaches.
      this.fog.near = map.look.fog[0];
      this.fog.far = map.look.fog[1];
    }
    this.level = buildLevelMesh(world.level, this.envUniforms, this.tunables.render, { marks: map?.marks });
    this.level.setMarksArmed(this.laneArmed);
    this.scene.add(this.level.root);
    this.blobs.setLevel(world.level.boxes);
    this.applyQuality();

    if (this.targetsView) {
      this.scene.remove(this.targetsView.root);
      this.targetsView.dispose();
    }
    this.targetsView = new TargetsView(this.tunables, world.targets.length, this.tunables.render.quality[this.quality]);
    this.targetsView.setPreset(this.preset);
    const pr = this.renderer.getPixelRatio();
    this.targetsView.setViewport(this.width * pr, this.height * pr);
    this.scene.add(this.targetsView.root);
    // Compile shaders now so the first shot / first frame does not hitch.
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.overlay.scene, this.overlay.camera);
    this.post.precompile(this.renderer);
  }

  /** Light or dim the loaded map's armed floor stripe (Lane). Survives a level reload. */
  setLaneArmed(armed: boolean): void {
    this.laneArmed = armed;
    this.level?.setMarksArmed(armed);
  }

  /**
   * Draw one frame. `alpha` interpolates the sim between the last two ticks; yaw/pitch are the
   * freshest view angles (live mouse look), applied without tick latency.
   */
  render(world: World, alpha: number, yaw: number, pitch: number, dt: number): void {
    const p = world.player;
    this.camera.position.set(
      lerp(p.prevPos.x, p.pos.x, alpha),
      lerp(p.prevPos.y, p.pos.y, alpha) + lerp(p.prevEyeHeight, p.eyeHeight, alpha),
      lerp(p.prevPos.z, p.pos.z, alpha),
    );
    this.camera.rotation.set(pitch, yaw, 0);

    this.sky.follow(this.camera);
    this.targetsView?.update(world, alpha, dt, this.camera.position.x, this.camera.position.z);
    this.blobs.update(world.targets, this.tunables.targets);
    const f = this.frame;
    f.world = world;
    f.alpha = alpha;
    f.dt = dt;
    for (let i = 0; i < this.layers.length; i++) this.layers[i]!.update(f);

    this.renderer.info.reset();
    this.post.render(this.renderer, this.scene, this.camera, this.overlay);
    for (let i = 0; i < this.layers.length; i++) this.layers[i]!.afterDraw?.();
    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
  }

  /**
   * Project a world point to CSS pixels using the camera of the last drawn frame (used to anchor
   * floating numbers). Returns false when the point is behind the camera. No allocation.
   */
  projectToScreen(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    const v = this.proj.set(x, y, z).project(this.camera);
    if (v.z > 1) return false;
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    return true;
  }

  dispose(): void {
    for (const layer of this.layers) layer.dispose();
    this.targetsView?.dispose();
    this.post.dispose();
    this.level?.dispose();
    this.sky.dispose();
    this.blobs.dispose();
    this.renderer.dispose();
  }
}
