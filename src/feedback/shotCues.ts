import type { Subscribable } from '../core/eventBus';
import type { FeedbackTunables } from '../config/feedback';
import type { SimEvents, TargetState } from '../sim/types';
import type { FeedbackOptions } from './options';

/**
 * World-space presentation cues for a shot (design §7.1 "See" column): tracers, muzzle flash,
 * impact sparks, decals, the kill shatter and the miss-offset ghost.
 *
 * This is the pure half of the effects: it subscribes to sim events, owns every cue slot in
 * fixed-size preallocated arrays (zero allocation after construction; a full pool recycles its
 * oldest slot) and ages them. The renderer (render/effects.ts) only reads the slots and writes
 * GPU buffers; the DOM hitmarkers live in hud/. Keeping the logic here makes the frame-latency
 * guarantee testable without WebGL.
 *
 * Frame accounting: the game calls beginFrame() at the top of every rendered frame, before the
 * sim ticks, and markDrawn() right after the renderer drew. A cue born from a sim event in this
 * frame is drawn in this same frame (latency 0); the stats record the worst case.
 */

export const TRACER_NORMAL = 0;
export const TRACER_MOVING = 1;
export const TRACER_GHOST_LINE = 2;
export type TracerKind = 0 | 1 | 2;

export const IMPACT_MISS = 0;
export const IMPACT_HIT = 1;
export const IMPACT_KILL = 2;
export type ImpactKind = 0 | 1 | 2;

interface CueBase {
  active: boolean;
  age: number;
  life: number;
  /** Frame number when the cue was created from its event. */
  born: number;
  /** Frame number when it was first drawn, -1 until then. */
  shown: number;
}

export interface TracerCue extends CueBase {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  kind: TracerKind;
}

export interface ImpactCue extends CueBase {
  x: number; y: number; z: number;
  kind: ImpactKind;
}

export interface DecalCue {
  active: boolean;
  age: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  /** 0..1, varies the decal rotation and size a little. */
  variation: number;
}

export interface ShatterCue extends CueBase {
  x: number; y: number; z: number;
  /** Shot direction (shards get a forward bias). */
  dx: number; dy: number; dz: number;
  /** Unique per kill; seeds the shard motion in the vertex shader. */
  seed: number;
  /** Renderer bookkeeping: the GPU attributes for this kill are written. */
  uploaded: boolean;
}

export interface GhostCue extends CueBase {
  /** Where the nearest target's head was. */
  hx: number; hy: number; hz: number;
  /** The aim ray's closest point to that head (the offset arrow runs from here to the head). */
  mx: number; my: number; mz: number;
}

export interface FlashCue extends CueBase {
  /** Muzzle position in world space (renderer places the sprite; viewmodel art is #45). */
  x: number; y: number; z: number;
}

export interface FrameLatencyStats {
  samples: number;
  max: number;
  last: number;
  /** Cues that waited more than one frame (must stay 0). */
  late: number;
}

function base(): CueBase {
  return { active: false, age: 0, life: 0, born: 0, shown: -1 };
}

export class ShotCues {
  readonly tracers: TracerCue[] = [];
  readonly impacts: ImpactCue[] = [];
  readonly decals: DecalCue[] = [];
  readonly shatters: ShatterCue[] = [];
  readonly ghost: GhostCue = { ...base(), hx: 0, hy: 0, hz: 0, mx: 0, my: 0, mz: 0 };
  readonly flash: FlashCue = { ...base(), x: 0, y: 0, z: 0 };
  readonly latency: FrameLatencyStats = { samples: 0, max: 0, last: 0, late: 0 };

  /** Rendered-frame counter (see class comment). */
  frame = 0;
  /** Recoil kick 0..1 for the viewmodel, decays in update(). */
  kick = 0;
  /** True when the decal GPU buffer must be rewritten (spawn, expiry or fade step). */
  decalsDirty = false;

  private nextTracer = 0;
  private nextImpact = 0;
  private nextDecal = 0;
  private nextShatter = 0;
  private shatterSerial = 0;
  private lastTracer = -1;
  /** Cues created but not drawn yet (lets markDrawn skip its scan on idle frames). */
  private pending = 0;
  private decalFading = false;
  // Last shot, copied from the event payload (payloads are only valid during the callback).
  private ox = 0; private oy = 0; private oz = 0;
  private dx = 0; private dy = 0; private dz = -1;
  private readonly offs: (() => void)[] = [];

  constructor(
    bus: Subscribable<SimEvents>,
    private readonly cfg: FeedbackTunables,
    private readonly options: Readonly<FeedbackOptions>,
    private readonly targets: readonly TargetState[],
  ) {
    for (let i = 0; i < cfg.tracer.capacity + 1; i++) {
      this.tracers.push({ ...base(), ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, kind: TRACER_NORMAL });
    }
    for (let i = 0; i < cfg.impact.capacity; i++) this.impacts.push({ ...base(), x: 0, y: 0, z: 0, kind: IMPACT_MISS });
    for (let i = 0; i < cfg.decal.capacity; i++) {
      this.decals.push({ active: false, age: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, variation: 0 });
    }
    for (let i = 0; i < cfg.shatter.capacity; i++) {
      this.shatters.push({ ...base(), x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1, seed: 0, uploaded: true });
    }

    this.offs.push(
      bus.on('shotFired', (e) => this.onShotFired(e)),
      bus.on('shotImpact', (e) => this.onShotImpact(e)),
      bus.on('targetKilled', (e) => this.onKilled(e)),
    );
  }

  /** Call once at the top of each rendered frame, before the sim ticks. */
  beginFrame(): void {
    this.frame++;
  }

  private birth(c: CueBase, life: number): void {
    c.active = true;
    c.age = 0;
    c.life = life;
    c.born = this.frame;
    c.shown = -1;
    this.pending++;
  }

  private onShotFired(e: SimEvents['shotFired']): void {
    const fx = this.cfg;
    this.kick = 1;
    this.ox = e.origin.x; this.oy = e.origin.y; this.oz = e.origin.z;
    this.dx = e.dir.x; this.dy = e.dir.y; this.dz = e.dir.z;

    // Muzzle = eye + right * 0.2 - up * 0.16 + forward * 0.5 (matches the placeholder viewmodel).
    const hl = Math.sqrt(this.dx * this.dx + this.dz * this.dz) || 1;
    const mx = this.ox + (-this.dz / hl) * 0.2 + this.dx * 0.5;
    const my = this.oy - 0.16 + this.dy * 0.5;
    const mz = this.oz + (this.dx / hl) * 0.2 + this.dz * 0.5;

    const f = this.flash;
    f.x = mx; f.y = my; f.z = mz;
    this.recycle(f);
    this.birth(f, fx.muzzleFlash.lifeSec);

    // The tracer exists from the shot itself; shotImpact (same tick) shortens it to the hit point.
    const idx = this.nextTracer;
    this.nextTracer = (idx + 1) % fx.tracer.capacity;
    const t = this.tracers[idx]!;
    this.recycle(t);
    this.birth(t, fx.tracer.lifeSec);
    t.ax = mx; t.ay = my; t.az = mz;
    const far = fx.tracer.maxLength;
    t.bx = this.ox + this.dx * far; t.by = this.oy + this.dy * far; t.bz = this.oz + this.dz * far;
    t.kind = e.moving && this.options.coachingCues ? TRACER_MOVING : TRACER_NORMAL;
    this.lastTracer = idx;
  }

  private onShotImpact(e: SimEvents['shotImpact']): void {
    const fx = this.cfg;
    const p = e.point;
    const n = e.normal;

    if (this.lastTracer >= 0) {
      const t = this.tracers[this.lastTracer]!;
      t.bx = p.x; t.by = p.y; t.bz = p.z;
    }

    const idx = this.nextImpact;
    this.nextImpact = (idx + 1) % fx.impact.capacity;
    const c = this.impacts[idx]!;
    this.recycle(c);
    this.birth(c, fx.impact.lifeSec);
    c.x = p.x + n.x * 0.02; c.y = p.y + n.y * 0.02; c.z = p.z + n.z * 0.02;
    c.kind = e.onTarget ? IMPACT_HIT : IMPACT_MISS;

    if (!e.onTarget) {
      const di = this.nextDecal;
      this.nextDecal = (di + 1) % fx.decal.capacity;
      const d = this.decals[di]!;
      d.active = true;
      d.age = 0;
      d.x = p.x + n.x * 0.004; d.y = p.y + n.y * 0.004; d.z = p.z + n.z * 0.004;
      d.nx = n.x; d.ny = n.y; d.nz = n.z;
      d.variation = (this.nextDecal * 0.61803398875) % 1;
      this.decalsDirty = true;
      if (this.options.missGhost) this.spawnGhost();
    }
  }

  private onKilled(e: SimEvents['targetKilled']): void {
    const fx = this.cfg;
    const p = e.point;
    // A larger spark burst on top of the hit spark.
    const idx = this.nextImpact;
    this.nextImpact = (idx + 1) % fx.impact.capacity;
    const c = this.impacts[idx]!;
    this.recycle(c);
    this.birth(c, fx.impact.lifeSec * 1.5);
    c.x = p.x; c.y = p.y; c.z = p.z;
    c.kind = IMPACT_KILL;

    const si = this.nextShatter;
    this.nextShatter = (si + 1) % fx.shatter.capacity;
    const s = this.shatters[si]!;
    this.recycle(s);
    this.birth(s, fx.shatter.lifeSec);
    s.x = p.x; s.y = p.y; s.z = p.z;
    s.dx = this.dx; s.dy = this.dy; s.dz = this.dz;
    s.seed = ++this.shatterSerial;
    s.uploaded = false;
  }

  /**
   * Ghost ring on a miss: the head of the target nearest to the aim ray (within maxOffsetDeg),
   * plus the closest point of the ray to it, so the arrow shows exactly how far and which way
   * the shot missed at the target's depth.
   * TODO(#15): head centre is the sphere centre for the placeholder targets; use the head sphere
   * (spec hit.head_centre_*) once humanoid zones exist.
   */
  private spawnGhost(): void {
    const g = this.cfg.ghost;
    const maxTan = Math.tan((g.maxOffsetDeg * Math.PI) / 180);
    let best = Infinity;
    let bi = -1;
    let bt = 0;
    for (let i = 0; i < this.targets.length; i++) {
      const tg = this.targets[i]!;
      if (!tg.alive) continue;
      const vx = tg.pos.x - this.ox, vy = tg.pos.y - this.oy, vz = tg.pos.z - this.oz;
      const t = vx * this.dx + vy * this.dy + vz * this.dz;
      if (t <= 0) continue;
      const px = vx - this.dx * t, py = vy - this.dy * t, pz = vz - this.dz * t;
      const off = Math.sqrt(px * px + py * py + pz * pz) / t; // tan of the angular offset
      if (off < best && off <= maxTan) { best = off; bi = i; bt = t; }
    }
    if (bi < 0) return;
    const tg = this.targets[bi]!;
    const c = this.ghost;
    this.recycle(c);
    this.birth(c, g.lifeSec);
    c.hx = tg.pos.x; c.hy = tg.pos.y; c.hz = tg.pos.z;
    c.mx = this.ox + this.dx * bt; c.my = this.oy + this.dy * bt; c.mz = this.oz + this.dz * bt;

    // The arrow line is just another tracer slot (kind GHOST_LINE) so the renderer draws it with
    // the same strip shader; it is the extra last slot of the tracer array.
    const t = this.tracers[this.cfg.tracer.capacity]!;
    this.recycle(t);
    this.birth(t, g.lifeSec);
    t.ax = c.mx; t.ay = c.my; t.az = c.mz;
    t.bx = c.hx; t.by = c.hy; t.bz = c.hz;
    t.kind = TRACER_GHOST_LINE;
  }

  /** A slot that is overwritten while still waiting for its first draw no longer counts as pending. */
  private recycle(c: CueBase): void {
    if (c.active && c.shown < 0 && this.pending > 0) this.pending--;
  }

  /**
   * Age every cue by `dt` seconds. A cue is never retired before it has been drawn once, so a
   * long hitch cannot swallow an effect.
   */
  update(dt: number): void {
    const k = this.kick - dt * 9;
    this.kick = k > 0 ? k : 0;
    for (let i = 0; i < this.tracers.length; i++) this.age(this.tracers[i]!, dt);
    for (let i = 0; i < this.impacts.length; i++) this.age(this.impacts[i]!, dt);
    for (let i = 0; i < this.shatters.length; i++) this.age(this.shatters[i]!, dt);
    this.age(this.ghost, dt);
    this.age(this.flash, dt);

    const d = this.cfg.decal;
    const fadeStart = d.ttlSec - d.fadeSec;
    let fading = false;
    for (let i = 0; i < this.decals.length; i++) {
      const c = this.decals[i]!;
      if (!c.active) continue;
      c.age += dt;
      if (c.age >= d.ttlSec) {
        c.active = false;
        this.decalsDirty = true;
      } else if (c.age >= fadeStart) {
        fading = true;
      }
    }
    if (fading || this.decalFading) this.decalsDirty = true;
    this.decalFading = fading;
  }

  private age(c: CueBase, dt: number): void {
    if (!c.active) return;
    c.age += dt;
    if (c.age >= c.life && c.shown >= 0) c.active = false;
  }

  /** Call right after the frame was drawn: stamps the first-draw frame of new cues. */
  markDrawn(): void {
    if (this.pending === 0) return;
    for (let i = 0; i < this.tracers.length; i++) this.stamp(this.tracers[i]!);
    for (let i = 0; i < this.impacts.length; i++) this.stamp(this.impacts[i]!);
    for (let i = 0; i < this.shatters.length; i++) this.stamp(this.shatters[i]!);
    this.stamp(this.ghost);
    this.stamp(this.flash);
    this.pending = 0;
  }

  private stamp(c: CueBase): void {
    if (!c.active || c.shown >= 0) return;
    c.shown = this.frame;
    const lat = this.frame - c.born;
    const s = this.latency;
    s.samples++;
    s.last = lat;
    if (lat > s.max) s.max = lat;
    if (lat > 1) s.late++;
  }

  resetLatency(): void {
    const s = this.latency;
    s.samples = 0; s.max = 0; s.last = 0; s.late = 0;
  }

  /** Drop everything (run restart). */
  clear(): void {
    for (const t of this.tracers) t.active = false;
    for (const i of this.impacts) i.active = false;
    for (const s of this.shatters) s.active = false;
    for (const d of this.decals) d.active = false;
    this.ghost.active = false;
    this.flash.active = false;
    this.pending = 0;
    this.lastTracer = -1;
    this.decalsDirty = true;
  }

  dispose(): void {
    this.offs.forEach((f) => f());
  }
}
