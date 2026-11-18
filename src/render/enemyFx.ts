import { Color, DoubleSide, type InstancedBufferAttribute, Mesh, type ShaderMaterial } from 'three';
import { echoPresets, type EchoPresetId } from '../config/palette';
import type { EnemyFxTunables } from '../config/enemies';
import type { Tunables } from '../config/tunables';
import type { Subscribable } from '../core/eventBus';
import { FIRE_TELL } from '../sim/enemyAi';
import type { RunEvents } from '../sim/runEvents';
import type { World } from '../sim/world';
import {
  fxMaterial, instAttr, SPRITE_FRAG, SPRITE_VERT, strip, TRACER_FRAG, TRACER_VERT,
} from './effects';
import type { GameRenderer, RenderFrame, RenderLayer } from './gameRenderer';

/**
 * What an enemy shooting back looks like (design §5.3, §7): while a tell runs, the head node
 * flares and a thin bright line flickers from the muzzle towards the player; every enemy bullet,
 * hit or miss, leaves a brief streak (a near miss streaks past the head). Everything is drawn
 * from sim state and events, in the enemy colour preset, with the same strip and billboard
 * shaders as the player's tracers (`render/effects.ts`). Two instanced draws, fixed pools,
 * nothing allocated per frame; an idle layer hides its meshes.
 */

interface Streak {
  active: boolean;
  age: number;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
}

export class EnemyFxLayer implements RenderLayer {
  private readonly cfg: EnemyFxTunables;
  private readonly fire: Tunables['enemies']['fire'];
  private readonly lineGeo = strip();
  private readonly lineMesh: Mesh;
  private readonly lineAttrs: InstancedBufferAttribute[] = [];
  private readonly lA: Float32Array;
  private readonly lB: Float32Array;
  private readonly lColor: Float32Array;
  private readonly lParams: Float32Array;
  private readonly flareGeo = strip();
  private readonly flareMesh: Mesh;
  private readonly flareAttrs: InstancedBufferAttribute[] = [];
  private readonly fPos: Float32Array;
  private readonly fColor: Float32Array;
  private readonly fParams: Float32Array;
  private readonly streaks: Streak[] = [];
  private nextStreak = 0;
  private readonly lineColor = new Color();
  private readonly flareColor = new Color();
  private preset: EchoPresetId;
  private clock = 0;
  private wasActive = false;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly renderer: GameRenderer,
    private readonly world: World,
    bus: Subscribable<Pick<RunEvents, 'enemyFired'>>,
    t: Tunables,
    /**
     * How strong the added tell (head-node flare, line) is, 1 .. 0 (design §7.4: it fades with the dial and is
     * off in a clean run or cold opener); the windup itself is untouched. Default full.
     */
    private readonly tellStrength: () => number = () => 1,
  ) {
    this.cfg = t.enemies.fx;
    this.fire = t.enemies.fire;
    const cfg = this.cfg;
    const nL = cfg.tellCapacity + cfg.tracerCapacity;
    this.lineGeo.instanceCount = nL;
    this.lA = instAttr(this.lineGeo, 'aA', nL, 3, this.lineAttrs);
    this.lB = instAttr(this.lineGeo, 'aB', nL, 3, this.lineAttrs);
    this.lColor = instAttr(this.lineGeo, 'aColor', nL, 3, this.lineAttrs);
    this.lParams = instAttr(this.lineGeo, 'aParams', nL, 4, this.lineAttrs);
    this.lineMesh = new Mesh(
      this.lineGeo,
      fxMaterial(TRACER_VERT, TRACER_FRAG, { uDash: { value: 1 }, uMinPx: { value: 1.5 }, uViewportH: { value: 1080 } }, true),
    );
    (this.lineMesh.material as ShaderMaterial).side = DoubleSide;
    const nF = cfg.tellCapacity;
    this.flareGeo.instanceCount = nF;
    this.fPos = instAttr(this.flareGeo, 'aPos', nF, 3, this.flareAttrs);
    this.fColor = instAttr(this.flareGeo, 'aColor', nF, 3, this.flareAttrs);
    this.fParams = instAttr(this.flareGeo, 'aParams', nF, 4, this.flareAttrs);
    this.flareMesh = new Mesh(this.flareGeo, fxMaterial(SPRITE_VERT, SPRITE_FRAG, {}, true));
    for (const m of [this.lineMesh, this.flareMesh]) {
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 11;
      renderer.scene.add(m);
    }
    for (let i = 0; i < cfg.tracerCapacity; i++) {
      this.streaks.push({ active: false, age: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 });
    }
    this.preset = renderer.echoPreset;
    this.applyPreset();
    this.off.push(bus.on('enemyFired', (e) => this.onFired(e.id, e.dir.x, e.dir.y, e.dir.z)));
  }

  private applyPreset(): void {
    const p = echoPresets[this.preset];
    this.lineColor.set(p.color);
    this.flareColor.set(p.head);
  }

  /** A shot left an enemy: start a streak from its muzzle along `dir`, running a little past the player. */
  private onFired(id: number, dx: number, dy: number, dz: number): void {
    const t = this.world.targetField.byId(id);
    if (!t) return;
    const s = this.streaks[this.nextStreak]!;
    this.nextStreak = (this.nextStreak + 1) % this.streaks.length;
    const my = t.pos.y + (t.crouched ? this.fire.muzzleHeightCrouch : this.fire.muzzleHeightStand);
    const p = this.world.player;
    const dist = Math.hypot(p.pos.x - t.pos.x, p.pos.y + p.eyeHeight - my, p.pos.z - t.pos.z) + this.cfg.tracerOvershootM;
    s.active = true;
    s.age = 0;
    s.ax = t.pos.x; s.ay = my; s.az = t.pos.z;
    s.bx = s.ax + dx * dist; s.by = my + dy * dist; s.bz = s.az + dz * dist;
  }

  update(frame: RenderFrame): void {
    const preset = this.renderer.echoPreset;
    if (preset !== this.preset) {
      this.preset = preset;
      this.applyPreset();
    }
    this.clock += frame.dt;
    const cfg = this.cfg;
    const world = frame.world;
    const alpha = frame.alpha;
    const slots = world.targets;
    const p = world.player;
    const lc = this.lineColor, fc = this.flareColor;
    const nowTick = world.tick - 1 + alpha;
    let nLines = 0;
    let nFlares = 0;
    // Player point the lines run to: the chest, interpolated like the camera.
    const px = p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha;
    const pz = p.prevPos.z + (p.pos.z - p.prevPos.z) * alpha;
    const py = p.pos.y + p.height * this.fire.bodyAimFraction;
    const flicker = 1 - cfg.tellFlickerDepth * (0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2 * cfg.tellFlickerHz));
    const strength = Math.min(1, Math.max(0, this.tellStrength()));

    for (let i = 0; i < slots.length && nFlares < cfg.tellCapacity && strength > 0; i++) {
      const t = slots[i]!;
      if (!t.alive || t.ai.phase !== FIRE_TELL) continue;
      const a = t.ai;
      const progress = Math.min(1, Math.max(0, (nowTick - a.tellStartTick) / Math.max(1, a.tellTicks)));
      const x = t.prevPos.x + (t.pos.x - t.prevPos.x) * alpha;
      const y = t.prevPos.y + (t.pos.y - t.prevPos.y) * alpha;
      const z = t.prevPos.z + (t.pos.z - t.prevPos.z) * alpha;
      const hit = this.world.tunables.targets.hit;
      // Head node flare: grows over the tell.
      const f = nFlares * 3;
      const headY = y + (t.crouched ? hit.headCentreCrouch : hit.headCentreStand);
      this.fPos[f] = x; this.fPos[f + 1] = headY; this.fPos[f + 2] = z;
      this.fColor[f] = fc.r; this.fColor[f + 1] = fc.g; this.fColor[f + 2] = fc.b;
      const g = nFlares * 4;
      this.fParams[g] = cfg.flareStartM + (cfg.flareEndM - cfg.flareStartM) * progress;
      this.fParams[g + 1] = cfg.flareAlpha * (0.55 + 0.45 * progress) * strength;
      this.fParams[g + 2] = 0;
      this.fParams[g + 3] = progress * 1.2;
      nFlares++;
      // Line: muzzle to (most of the way to) the player, flickering and brightening as the shot nears.
      const my = y + (t.crouched ? this.fire.muzzleHeightCrouch : this.fire.muzzleHeightStand);
      const o = nLines * 3;
      this.lA[o] = x; this.lA[o + 1] = my; this.lA[o + 2] = z;
      const r = cfg.tellLineReach;
      if (a.mind) {
        // A mind's tell is its real aim phase (#90): the line runs along where it is aiming, so the flick
        // and its correction are seen sweeping onto the player, as long as the line to the player would be.
        const ex = px - x, ey = py - my, ez = pz - z;
        const len = Math.sqrt(ex * ex + ey * ey + ez * ez) * r;
        const cp = Math.cos(a.aim.pitch);
        this.lB[o] = x - Math.sin(a.aim.yaw) * cp * len;
        this.lB[o + 1] = my + Math.sin(a.aim.pitch) * len;
        this.lB[o + 2] = z - Math.cos(a.aim.yaw) * cp * len;
      } else {
        this.lB[o] = x + (px - x) * r; this.lB[o + 1] = my + (py - my) * r; this.lB[o + 2] = z + (pz - z) * r;
      }
      this.lColor[o] = lc.r; this.lColor[o + 1] = lc.g; this.lColor[o + 2] = lc.b;
      const q = nLines * 4;
      this.lParams[q] = cfg.tellLineAlpha * flicker * (0.5 + 0.5 * progress) * strength;
      this.lParams[q + 1] = 0;
      this.lParams[q + 2] = cfg.tellLineWidthM;
      nLines++;
    }
    // Bullet streaks, after the tells in the same strip buffer.
    const dt = frame.dt;
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i]!;
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= cfg.tracerLifeSec) {
        s.active = false;
        continue;
      }
      if (nLines >= cfg.tellCapacity + cfg.tracerCapacity) break;
      const o = nLines * 3;
      this.lA[o] = s.ax; this.lA[o + 1] = s.ay; this.lA[o + 2] = s.az;
      this.lB[o] = s.bx; this.lB[o + 1] = s.by; this.lB[o + 2] = s.bz;
      this.lColor[o] = fc.r; this.lColor[o + 1] = fc.g; this.lColor[o + 2] = fc.b;
      const q = nLines * 4;
      this.lParams[q] = cfg.tracerAlpha * (1 - s.age / cfg.tracerLifeSec);
      this.lParams[q + 1] = 0;
      this.lParams[q + 2] = cfg.tracerWidthM;
      nLines++;
    }
    for (let i = nLines; i < cfg.tellCapacity + cfg.tracerCapacity; i++) this.lParams[i * 4] = 0;
    for (let i = nFlares; i < cfg.tellCapacity; i++) this.fParams[i * 4 + 1] = 0;
    const any = nLines > 0 || nFlares > 0;
    this.lineMesh.visible = any || this.wasActive;
    this.flareMesh.visible = any || this.wasActive;
    if (this.lineMesh.visible) {
      for (const a of this.lineAttrs) a.needsUpdate = true;
      for (const a of this.flareAttrs) a.needsUpdate = true;
    }
    this.wasActive = any;
  }

  resize(_width: number, height: number, pixelRatio: number): void {
    (this.lineMesh.material as ShaderMaterial).uniforms.uViewportH!.value = Math.max(1, height * pixelRatio);
  }

  dispose(): void {
    for (const f of this.off) f();
    for (const m of [this.lineMesh, this.flareMesh]) {
      m.geometry.dispose();
      (m.material as ShaderMaterial).dispose();
      m.removeFromParent();
    }
  }
}

