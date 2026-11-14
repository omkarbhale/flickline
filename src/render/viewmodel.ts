import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { ViewmodelId, ViewmodelMode, ViewmodelTunables } from '../config/viewmodel';
import { VIEWMODEL_IDS } from '../config/viewmodel';
import type { WeaponDef, WeaponId, WeaponTable } from '../config/weapon';
import type { ShotCues } from '../feedback/shotCues';
import { TICK_DT } from '../core/time';
import type { GameRenderer, RenderFrame, RenderLayer } from './gameRenderer';
import { buildViewmodel, type ViewmodelMeshData } from './viewmodelModel';
import { createViewmodelPose, poseTimeSec, transformPoint, viewmodelPose, type ViewmodelPose } from './viewmodelPose';

/**
 * The first-person weapon (design section 11, issue #45): one merged mesh per weapon, drawn in the
 * renderer's overlay pass by a camera of its own, so the viewmodel FOV is independent of the locked
 * world FOV and the weapon never clips into walls. The pose comes from the sim's weapon state
 * (`viewmodelPose`); the muzzle flash is the per-weapon sprite for the shot-cue model's flash.
 * The tracers start where the on-screen muzzle is (`cues.setMuzzle`).
 *
 * Hot path: `update` allocates nothing (scratch objects only).
 */

const MODEL_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aTrim;
varying vec3 vNormal;
varying vec3 vColor;
varying float vTrim;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vColor = aColor;
  vTrim = aTrim;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// Matte: a soft half-Lambert from one fixed light, a faint cool rim so the dark silhouette reads
// against the dark world, and the trim line unlit (always on, the one line of light).
const MODEL_FRAG = /* glsl */ `
uniform vec3 uTrim;
uniform vec3 uLight;
varying vec3 vNormal;
varying vec3 vColor;
varying float vTrim;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  float d = dot(n, uLight) * 0.5 + 0.5;
  float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
  vec3 lit = vColor * (0.4 + 1.1 * d * d) + uTrim * 0.1 * rim;
  vec3 c = mix(lit, uTrim * 1.5, vTrim);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const FLASH_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// One sprite shape per weapon, procedural (no textures): 0 compact four-point star (Pace),
// 1 long horizontal cross with a hot core (Kestrel), 2 wide three-petal burst (Rill).
const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uShape;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float core = exp(-r * r * 9.0);
  float spikes;
  if (uShape < 0.5) {
    spikes = pow(abs(cos(a * 2.0)), 14.0) * (1.0 - r);
  } else if (uShape < 1.5) {
    spikes = pow(abs(cos(a)), 40.0) * (1.0 - r) + 0.5 * pow(abs(cos(a * 3.0)), 20.0) * (1.0 - r);
  } else {
    spikes = pow(abs(cos(a * 1.5)), 9.0) * (1.0 - r * 0.9);
  }
  float edge = 1.0 - smoothstep(0.75, 1.0, r);
  float k = clamp(core + spikes, 0.0, 1.0) * edge * uAlpha;
  gl_FragColor = vec4(uColor * k, k);
  #include <colorspace_fragment>
}`;

interface Entry {
  data: ViewmodelMeshData;
  mesh: Mesh;
  flash: Mesh;
  flashMat: ShaderMaterial;
}

function modelGeometry(d: ViewmodelMeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(d.position, 3));
  g.setAttribute('normal', new BufferAttribute(d.normal, 3));
  g.setAttribute('aColor', new BufferAttribute(d.color, 3));
  g.setAttribute('aTrim', new BufferAttribute(d.trim, 1));
  return g;
}

export class ViewmodelLayer implements RenderLayer {
  private readonly entries: Partial<Record<ViewmodelId, Entry>> = {};
  private readonly modelMat: ShaderMaterial;
  private readonly flashGeo = new PlaneGeometry(1, 1);
  private readonly pose: ViewmodelPose = createViewmodelPose();
  private readonly muzzleView = { x: 0, y: 0, z: -1 };
  private mode: ViewmodelMode;
  private forced: ViewmodelId | null = null;
  private current: ViewmodelId | null = null;

  constructor(
    private readonly renderer: GameRenderer,
    private readonly cues: ShotCues,
    private readonly cfg: ViewmodelTunables,
    private readonly weapons: WeaponTable,
    mode: ViewmodelMode,
  ) {
    this.mode = mode;
    this.modelMat = new ShaderMaterial({
      uniforms: {
        uTrim: { value: new Color(cfg.colors.trim) },
        uLight: { value: new Vector3(-0.45, 0.75, 0.5).normalize() },
      },
      vertexShader: MODEL_VERT,
      fragmentShader: MODEL_FRAG,
    });
    for (const id of VIEWMODEL_IDS) {
      const data = buildViewmodel(id, cfg.colors);
      const mesh = new Mesh(modelGeometry(data), this.modelMat);
      mesh.rotation.order = 'YXZ';
      mesh.frustumCulled = false;
      // Flash: a billboard at the muzzle, child of the weapon so it follows every pose. Visible
      // at construction so the level's shader compile includes it; `update` hides it.
      const wt = cfg.weapons[id];
      const flashMat = new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(wt.flash.color) },
          uAlpha: { value: 0 },
          uShape: { value: wt.flash.shape },
        },
        vertexShader: FLASH_VERT,
        fragmentShader: FLASH_FRAG,
        transparent: true,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });
      const flash = new Mesh(this.flashGeo, flashMat);
      flash.position.set(data.muzzle.x, data.muzzle.y, data.muzzle.z);
      flash.frustumCulled = false;
      flash.renderOrder = 5;
      mesh.add(flash);
      renderer.overlay.scene.add(mesh);
      this.entries[id] = { data, mesh, flash, flashMat };
    }
  }

  /** Right-handed, left-handed or hidden; takes effect on the next frame. */
  setMode(mode: ViewmodelMode): void {
    this.mode = mode;
  }

  /** Show weapon `id`'s model whatever the sim has equipped (previews; null = follow the sim). */
  force(id: ViewmodelId | null): void {
    this.forced = id;
  }

  /** Which model was drawn last frame (null = none), the last pose and its muzzle in view space. */
  get state(): { model: ViewmodelId | null; mode: ViewmodelMode; pose: Readonly<ViewmodelPose>; muzzle: Readonly<{ x: number; y: number; z: number }> } {
    return { model: this.current, mode: this.mode, pose: this.pose, muzzle: this.muzzleView };
  }

  /** Triangles per weapon model (debug/overlay). */
  triangles(id: ViewmodelId): number {
    return this.entries[id]?.data.triangleCount ?? 0;
  }

  update(frame: RenderFrame): void {
    const world = frame.world;
    const w = world.weapon;
    const simId = w.slots[w.active]!.id;
    const id: ViewmodelId | null = this.forced ?? (simId in this.entries ? (simId as ViewmodelId) : null);
    const hidden = this.mode === 'hidden' || id === null;

    for (let i = 0; i < VIEWMODEL_IDS.length; i++) {
      const e = this.entries[VIEWMODEL_IDS[i]!]!;
      e.mesh.visible = !hidden && VIEWMODEL_IDS[i] === id;
    }
    this.current = hidden ? null : id;
    if (hidden || id === null) {
      this.cues.resetMuzzle();
      return;
    }

    const e = this.entries[id]!;
    const vt = this.cfg.weapons[id];
    const def: WeaponDef = this.weapons[id as WeaponId] ?? this.weapons[simId];
    const stateSec = world.tick * TICK_DT;
    const pose = viewmodelPose(this.pose, w, def, vt, this.cfg, stateSec, poseTimeSec(world.tick, frame.alpha), this.mode === 'left');
    e.mesh.position.set(pose.x, pose.y, pose.z);
    e.mesh.rotation.set(pose.rx, pose.ry, pose.rz);
    e.mesh.scale.x = pose.mirror ? -1 : 1;

    // Muzzle flash from the shot-cue model's flash cue.
    const f = this.cues.flash;
    if (f.active) {
      const t = Math.min(1, f.age / f.life);
      e.flash.visible = true;
      e.flashMat.uniforms.uAlpha!.value = 1 - t * t;
      e.flash.rotation.z = this.cues.frame * 1.7;
      e.flash.scale.setScalar(vt.flash.size * (0.8 + 0.4 * (1 - t)));
    } else {
      e.flash.visible = false;
    }

    // Tell the shot-cue model where the muzzle is on screen, as an offset from the world camera:
    // project the muzzle through the viewmodel camera, then back out through the world camera at
    // `tracerOriginDepthM`, so tracers leave the barrel you see whatever the two FOVs are.
    const m = transformPoint(pose, e.data.muzzle.x, e.data.muzzle.y, e.data.muzzle.z, this.muzzleView);
    if (m.z < -1e-4) {
      const vp = this.renderer.overlay.camera.projectionMatrix.elements;
      const wp = this.renderer.camera.projectionMatrix.elements;
      const nx = (vp[0]! * m.x) / -m.z;
      const ny = (vp[5]! * m.y) / -m.z;
      const d = this.cfg.tracerOriginDepthM;
      this.cues.setMuzzle((nx * d) / wp[0]!, (ny * d) / wp[5]!, d);
    }
  }

  resize(): void {
    const cam = this.renderer.overlay.camera;
    cam.fov = this.cfg.vfovDeg;
    cam.near = this.cfg.near;
    cam.far = this.cfg.far;
    cam.updateProjectionMatrix();
  }

  dispose(): void {
    for (const id of VIEWMODEL_IDS) {
      const e = this.entries[id];
      if (!e) continue;
      this.renderer.overlay.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.flashMat.dispose();
    }
    this.flashGeo.dispose();
    this.modelMat.dispose();
  }
}
