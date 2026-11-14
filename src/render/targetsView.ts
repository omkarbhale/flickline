import { Group } from 'three';
import { lerp } from '../core/math';
import { TICK_DT } from '../core/time';
import { echoPresets, type EchoPresetId } from '../config/palette';
import type { QualityPreset } from '../config/render';
import type { Tunables } from '../config/tunables';
import type { World } from '../sim/world';
import { EnemyBatch } from './echoBatch';
import {
  applyEchoPreset,
  createEchoMaterial,
  createEchoOutlineMaterial,
  createEchoUniforms,
  type EchoUniforms,
} from './echoMaterial';
import { buildEchoMesh, buildGnatMesh, buildOrbMesh } from './echoModel';
import { flashAmount, yawTowards } from './echoInstance';

/** The three enemy looks (design section 5.2): Echo humanoid, Beacon orb, Gnat octahedron. */
export type EnemyLook = 'echo' | 'beacon' | 'gnat';

/**
 * A display-only prop drawn alongside the simulation's targets (debug showcase, screenshots,
 * and the Gnat until the sim has one). `x,y,z` is the feet centre (echo) or the centre.
 */
export interface ShowcaseItem {
  look: EnemyLook;
  x: number;
  y: number;
  z: number;
  crouched?: boolean;
  /** 0..1 hit flash and dissolve progress; the idle lean in metres (echo) or the spin phase in radians (gnat). */
  flash?: number;
  dissolve?: number;
  lean?: number;
}

/**
 * Draws the roster from sim state: Echoes, Beacons and Gnats as one instanced draw per type
 * (capacity = the target registry's, 64) and the shared Echo shader's uniforms. The kill shatter
 * itself is the pooled shard effect in `render/effects.ts`; here the killed body dissolves. Reads sim state only; hit detection never looks at these meshes (it uses
 * `sim/hitZones.ts`, and the meshes are built from the same `hit.*` dimensions).
 * `update` allocates nothing.
 */
export class TargetsView {
  readonly root = new Group();
  readonly uniforms: EchoUniforms;
  readonly echo: EnemyBatch;
  readonly beacon: EnemyBatch;
  readonly gnat: EnemyBatch;
  /** Display-only extras drawn after the sim's targets (null = none). Set by the debug hook. */
  showcase: readonly ShowcaseItem[] | null = null;

  private preset: EchoPresetId = 'ember';
  private qualityOutline = false;
  private time = 0;
  private frozen = false;

  constructor(
    private readonly tunables: Tunables,
    capacity: number,
    quality: QualityPreset,
  ) {
    const e = tunables.echo;
    const u = createEchoUniforms(e, tunables.render, tunables.targets.hit);
    this.uniforms = u;
    this.echo = new EnemyBatch(buildEchoMesh(tunables.targets.hit, e.shape), createEchoMaterial(u, 'echo'), createEchoOutlineMaterial(u, 'echo'), capacity);
    const orb = tunables.targets.kinds.beacon.orbRadius;
    this.beacon = new EnemyBatch(buildOrbMesh(orb, e.beacon.segments, e.beacon.rings), createEchoMaterial(u, 'beacon'), createEchoOutlineMaterial(u, 'beacon'), capacity);
    this.gnat = new EnemyBatch(buildGnatMesh(e.gnat.radius, e.gnat.stretch), createEchoMaterial(u, 'gnat'), createEchoOutlineMaterial(u, 'gnat'), capacity);
    for (const b of [this.echo, this.beacon, this.gnat]) this.root.add(b.mesh, b.hull);
    this.setQuality(quality);
  }

  /** Colour preset (Ember, Magenta, Lime, Amber, Contrast). Uniform writes only. */
  setPreset(id: EchoPresetId): void {
    this.preset = id;
    applyEchoPreset(this.uniforms, id);
    this.applyOutline();
  }

  get presetId(): EchoPresetId {
    return this.preset;
  }

  /** Quality-dependent flags: the outline (the Contrast preset forces it on). */
  setQuality(q: QualityPreset): void {
    this.qualityOutline = q.echoOutline;
    this.applyOutline();
  }

  private applyOutline(): void {
    const on = this.qualityOutline || echoPresets[this.preset].outlineAlways;
    this.echo.setOutline(on);
    this.beacon.setOutline(on);
    this.gnat.setOutline(on);
  }

  /** Drawing-buffer size in pixels (the outline width is in pixels). */
  setViewport(widthPx: number, heightPx: number): void {
    this.uniforms.uViewport.value.set(widthPx, heightPx);
  }

  /** Pin the Echo clock to `sec` (Gnat spin), or resume with null. Debug / screenshots. */
  setTime(sec: number | null): void {
    if (sec === null) {
      this.frozen = false;
      return;
    }
    this.frozen = true;
    this.time = sec;
  }

  get clock(): number {
    return this.time;
  }

  /** Seconds since tick `tick` was simulated, given the render interpolation `alpha`. */
  private age(world: World, tick: number, alpha: number): number {
    return Math.max(0, (world.tick - tick - 1 + alpha) * TICK_DT);
  }

  /** `viewX/viewZ` is the camera's horizontal position: Echoes turn their front towards it. */
  update(world: World, alpha: number, dt: number, viewX: number, viewZ: number): void {
    if (!this.frozen) this.time += dt;
    this.uniforms.uTime.value = this.time;

    const e = this.tunables.echo;
    const flashSec = this.tunables.feedback.targetFlashSec;
    const kinds = this.tunables.targets.kinds;
    this.echo.begin();
    this.beacon.begin();
    this.gnat.begin();

    const slots = world.targets;
    for (let i = 0; i < slots.length; i++) {
      const t = slots[i]!;
      let flash = 0;
      let dissolve = 0;
      if (t.alive) {
        if (t.lastHitTick >= 0) flash = flashAmount(this.age(world, t.lastHitTick, alpha), flashSec);
      } else {
        // A freshly killed target keeps its last pose while its body dissolves (the shards are
        // already flying). Expired or never-hit targets just vanish.
        if (t.hp > 0 || t.lastHitTick < 0 || t.lastHitTick > world.tick) continue;
        const age = this.age(world, t.lastHitTick, alpha);
        if (age >= e.dissolveSec) continue;
        dissolve = age / e.dissolveSec;
        flash = flashAmount(age, flashSec);
      }
      if (kinds[t.kind].shape === 'orb') {
        this.beacon.add(t.pos.x, t.pos.y, t.pos.z, 0, flash, dissolve, 0, 0, t.scale);
      } else {
        const lean = lerp(t.prevSway, t.sway, alpha);
        // Strafers and Peekers move every tick: interpolate like the camera (a still one has prevPos == pos).
        const x = lerp(t.prevPos.x, t.pos.x, alpha), y = lerp(t.prevPos.y, t.pos.y, alpha), z = lerp(t.prevPos.z, t.pos.z, alpha);
        const yaw = yawTowards(x, z, viewX, viewZ);
        this.echo.add(x, y, z, yaw, flash, dissolve, t.crouched ? 1 : 0, lean);
      }
    }

    const extra = this.showcase;
    if (extra) {
      for (let i = 0; i < extra.length; i++) {
        const s = extra[i]!;
        if (s.look === 'echo') {
          this.echo.add(s.x, s.y, s.z, yawTowards(s.x, s.z, viewX, viewZ), s.flash ?? 0, s.dissolve ?? 0, s.crouched ? 1 : 0, s.lean ?? 0);
        } else if (s.look === 'beacon') {
          this.beacon.add(s.x, s.y, s.z, 0, s.flash ?? 0, s.dissolve ?? 0, 0, 0);
        } else {
          this.gnat.add(s.x, s.y, s.z, 0, s.flash ?? 0, s.dissolve ?? 0, 0, s.lean ?? i * 1.7);
        }
      }
    }

    this.echo.end();
    this.beacon.end();
    this.gnat.end();
  }

  dispose(): void {
    this.echo.dispose();
    this.beacon.dispose();
    this.gnat.dispose();
  }
}
