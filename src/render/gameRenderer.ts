import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  BoxGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Subscribable } from '../core/eventBus';
import { lerp } from '../core/math';
import { REFERENCE_ASPECT, verticalFovDeg } from '../core/view';
import { QUALITY_LEVELS, type QualityLevel } from '../config/render';
import type { Tunables } from '../config/tunables';
import type { SimEvents } from '../sim/types';
import type { MapDef } from '../sim/mapTypes';
import type { World } from '../sim/world';
import { ShotEffects } from './effects';
import { buildLevelMesh, type LevelMesh } from './levelMesh';
import { PostPipeline, createVignetteEffect } from './post';
import { TargetsView } from './targetsView';

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

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
  private targetsView: TargetsView | null = null;
  private readonly effects: ShotEffects;
  private readonly viewmodel: Mesh;
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

    const r = tunables.render;
    this.scene.background = new Color(r.skyColor);
    this.scene.fog = new Fog(r.skyColor, r.fogNear, r.fogFar);
    this.scene.add(new HemisphereLight(0xffffff, 0x56606e, 2.4));
    const sun = new DirectionalLight(0xfff0dc, 2.6);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);

    this.effects = new ShotEffects(this.scene, bus);

    // Placeholder first-person weapon model, parented to the camera.
    this.viewmodel = new Mesh(new BoxGeometry(0.05, 0.07, 0.36), new MeshLambertMaterial({ color: 0x3b4452 }));
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
    this.level?.setAnisotropy(Math.min(p.maxAnisotropy, this.renderer.capabilities.getMaxAnisotropy()));
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
   * Build visuals for a level and its targets. With a `MapDef`, also applies its look (sky and
   * fog colour, fog range), box palette and floor markings.
   */
  loadLevel(world: World, map?: MapDef): void {
    this.level?.dispose();
    if (this.level) this.scene.remove(this.level.root);
    if (map) {
      (this.scene.background as Color).set(map.look.sky);
      this.scene.fog = new Fog(map.look.sky, map.look.fog[0], map.look.fog[1]);
    }
    this.level = buildLevelMesh(world.level, { palette: map?.look.palette, marks: map?.marks });
    this.scene.add(this.level.root);
    this.applyQuality();

    if (this.targetsView) {
      this.scene.remove(this.targetsView.root);
      this.targetsView.dispose();
    }
    this.targetsView = new TargetsView(this.tunables, world.targets.length);
    this.scene.add(this.targetsView.root);
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

    this.effects.update(dt);
    this.viewmodel.position.z = this.viewmodelBaseZ + this.effects.kick * 0.04;
    this.viewmodel.rotation.x = this.effects.kick * 0.06;
    this.targetsView?.update(world, alpha);

    this.renderer.info.reset();
    this.post.render(this.renderer, this.scene, this.camera);
    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
  }

  dispose(): void {
    this.effects.dispose();
    this.targetsView?.dispose();
    this.post.dispose();
    this.level?.dispose();
    this.renderer.dispose();
  }
}
