import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  BoxGeometry,
  SphereGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Subscribable } from '../core/eventBus';
import { lerp } from '../core/math';
import { REFERENCE_ASPECT, verticalFovDeg } from '../core/view';
import { env, palette } from '../config/palette';
import { QUALITY_LEVELS, type QualityLevel } from '../config/render';
import type { Tunables } from '../config/tunables';
import type { SimEvents } from '../sim/types';
import type { MapDef } from '../sim/mapTypes';
import type { World } from '../sim/world';
import { ShotEffects } from './effects';
import { BlobShadows } from './blobShadows';
import { applyEnvQuality, createEnvUniforms, horizonColor, type EnvUniforms } from './envShaders';
import { buildLevelMesh, type LevelMesh } from './levelMesh';
import { Sky } from './sky';
import { PostPipeline, createVignetteEffect } from './post';

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

const BASE_TARGET_COLOR = palette.ember;
const FLASH_TICKS = 14;

/**
 * Everything three.js. Reads sim state (never writes it), interpolates between the last two
 * ticks, and owns the scene, camera, post pipeline and effect pools.
 *
 * Hot-path rules: render() allocates nothing. All vectors/matrices are scratch members.
 */
export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly post = new PostPipeline();
  readonly stats: RenderStats = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };

  private quality: QualityLevel;
  private level: LevelMesh | null = null;
  private readonly envUniforms: EnvUniforms;
  private readonly sky: Sky;
  private readonly blobs: BlobShadows;
  private readonly fog: Fog;
  private targetMesh: InstancedMesh | null = null;
  private readonly effects: ShotEffects;
  private readonly viewmodel: Mesh;
  private readonly m4 = new Matrix4();
  private readonly color = new Color();
  private flashState: Uint8Array = new Uint8Array(0);
  private width = 1;
  private height = 1;
  private viewmodelBaseZ = -0.34;

  constructor(
    canvas: HTMLCanvasElement,
    bus: Subscribable<SimEvents>,
    private readonly tunables: Tunables,
    initialQuality: QualityLevel,
  ) {
    this.quality = initialQuality;
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

    this.effects = new ShotEffects(this.scene, bus);

    // Placeholder first-person weapon model, parented to the camera.
    this.viewmodel = new Mesh(new BoxGeometry(0.05, 0.07, 0.36), new MeshLambertMaterial({ color: palette.steel }));
    this.viewmodel.position.set(0.15, -0.14, this.viewmodelBaseZ);
    this.camera.add(this.viewmodel);

    this.post.effects.push(createVignetteEffect());
    this.applyQuality();
  }

  setQuality(q: QualityLevel): void {
    if (!QUALITY_LEVELS.includes(q)) return;
    this.quality = q;
    this.applyQuality();
  }

  private applyQuality(): void {
    const p = this.tunables.render.quality[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatioCap));
    this.post.enabled = p.postProcessing;
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
    const pr = this.renderer.getPixelRatio();
    const p = this.tunables.render.quality[this.quality];
    this.post.setSize(Math.floor(this.width * pr), Math.floor(this.height * pr), p.antialias ? 4 : 0);
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
    this.scene.add(this.level.root);
    this.blobs.setLevel(world.level.boxes);
    this.applyQuality();

    if (this.targetMesh) {
      this.scene.remove(this.targetMesh);
      this.targetMesh.geometry.dispose();
      (this.targetMesh.material as MeshBasicMaterial).dispose();
      this.targetMesh.dispose();
    }
    const n = Math.max(1, world.targets.length);
    // Unlit and unfogged on purpose: an Echo stays the highest-contrast thing on screen at any
    // distance (design section 11). The Echo shader (#18) replaces this material.
    this.targetMesh = new InstancedMesh(
      new SphereGeometry(1, 24, 16),
      new MeshBasicMaterial({ color: 0xffffff, fog: false }),
      n,
    );
    this.targetMesh.count = world.targets.length;
    this.targetMesh.frustumCulled = false;
    for (let i = 0; i < world.targets.length; i++) this.targetMesh.setColorAt(i, this.color.setHex(BASE_TARGET_COLOR));
    this.flashState = new Uint8Array(n);
    this.scene.add(this.targetMesh);
    // Compile shaders now so the first shot / first frame does not hitch.
    this.renderer.compile(this.scene, this.camera);
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
    this.effects.update(dt);
    this.viewmodel.position.z = this.viewmodelBaseZ + this.effects.kick * 0.04;
    this.viewmodel.rotation.x = this.effects.kick * 0.06;
    this.updateTargets(world);
    this.blobs.update(world.targets);

    this.renderer.info.reset();
    this.post.render(this.renderer, this.scene, this.camera);
    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
  }

  private updateTargets(world: World): void {
    const mesh = this.targetMesh;
    if (!mesh) return;
    let colorDirty = false;
    for (let i = 0; i < world.targets.length; i++) {
      const t = world.targets[i]!;
      const s = t.alive ? t.radius : 0;
      this.m4.makeScale(s, s, s).setPosition(t.pos.x, t.pos.y, t.pos.z);
      mesh.setMatrixAt(i, this.m4);
      const age = world.tick - t.lastHitTick;
      const flashing = t.lastHitTick >= 0 && age < FLASH_TICKS ? 1 : 0;
      if (flashing !== this.flashState[i]) {
        this.flashState[i] = flashing;
        mesh.setColorAt(i, this.color.setHex(flashing ? 0xffffff : BASE_TARGET_COLOR));
        colorDirty = true;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.effects.dispose();
    this.post.dispose();
    this.level?.dispose();
    this.sky.dispose();
    this.blobs.dispose();
    this.renderer.dispose();
  }
}
