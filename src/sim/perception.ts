import type { EventSink, Subscribable } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { lognormalTruncated } from '../core/dist';
import { Rng } from '../core/rng';
import { TICK_DT } from '../core/time';
import { vec3, type Vec3 } from '../core/vec3';
import type { EnemySoundKind } from '../config/attribution';
import type { Tunables } from '../config/tunables';
import { targetAimPoint, wrapPi, yawOf } from './aim';
import type { PerceptionQueries } from './attribution';
import type { Expectation } from './enemyTiming';
import type { MindProfile } from './mind/profile';
import { lineClear } from './exposure';
import type { BoxDef, PlayerState, SimEvents, TargetState } from './types';

/**
 * Enemy perception (issue #89; `docs/research/player-like-enemies.md` §5.3, rules F1–F3;
 * `docs/research/engagement-information.md` §4.2). Everything an enemy may know about the player,
 * and nothing else: the decision FSM (#91) and the aim model (#90) read only what is stored here.
 *
 *  - **Sight**: at decision points (lognormal intervals, median 0.12 s, so a group never decides on one
 *    tick) an enemy with the player inside its field of view (the player's own 103°) casts up to
 *    four rays from its eye to sample points on the player's head and upper body (the eye, the
 *    chest, both shoulders). One clear ray is sight; the mask says which. Outside the field of view
 *    no ray is cast at all.
 *  - **Hearing**: the player's own sounds (running footsteps, landings, shots, reloads; walking and
 *    crouch-walking are silent) within the same radii the player hears enemies at
 *    (`attribution.soundRadiusM`), heard as a position estimate with an error by mind skill that
 *    shrinks while the sound keeps coming from the same place.
 *  - **Memory**: the last known position with its timestamp and a confidence that halves every
 *    `mind.perception.memoryHalfLifeSec` and is never refreshed without new perception; forgotten below a floor.
 *  - **Shared sightings**: when one enemy sees the player the others learn it after a lognormal delay
 *    (median 0.8 s), standing in for a human callout.
 *  - **Expectation**: the attended sector and the predicted window, the contact class (`prepared`
 *    / `attending` / `unaware`, timed by `sim/enemyTiming.ts`) and the sight sample the aim model
 *    should aim at.
 *
 * The module owns no gameplay state the rest of the sim reads, emits only facts
 * (`perceiverSaw` ...) and never consults the world hash. Pure; allocation-free after
 * construction (fixed pools, reused event payloads, no closures per call). Randomness comes only
 * from the `Rng` each perceiver is given (and the callout delays' own seeded stream), so one enemy's draws never shift another's.
 */

/** How a position in memory was learned. */
export type MemorySource = 'sight' | 'sound' | 'shared' | 'prior';

/** The last known position of the player, with when and how it was learned. */
export interface Memory {
  valid: boolean;
  source: MemorySource;
  /** Feet position (a sound's is the estimate, not the truth). */
  pos: Vec3;
  /** Sim time of the perception (a shared sighting carries the sighter's time, not the callout's). */
  stampSec: number;
  /** Confidence at `stampSec`; `memoryConfidence` decays it. */
  confidence0: number;
  /** Uncertainty of `pos` at `stampSec`, metres. */
  errM: number;
}

/**
 * What the enemy expects, for the aim model (#90). `active` is false with no memory and no sector.
 * The sector is centred on `yaw` (radians, the world convention of `core/vec3`), `halfWidth` wide.
 */
export interface Expected {
  active: boolean;
  /** From memory (true) or from the sector the mind assigned a hold (false). */
  fromMemory: boolean;
  yaw: number;
  halfWidth: number;
  /** Horizontal distance from the eye to the attended point (0 for a hold sector). */
  dist: number;
  confidence: number;
  /** The window in which the player is predicted to appear, absolute sim seconds. */
  windowOpenSec: number;
  windowCloseSec: number;
}

/** The sector a hold is aimed at, set by the mind (not perception). */
export interface AttendedSector {
  active: boolean;
  yaw: number;
  halfWidth: number;
}

/** Bits of `Perceiver.visibleMask`: which sample points have a clear ray this decision. */
export const SEEN_HEAD = 1;
export const SEEN_CHEST = 2;
export const SEEN_SHOULDER_L = 4;
export const SEEN_SHOULDER_R = 8;

/** One enemy's perception state. Preallocated by `PerceptionSystem`; the owner writes `eye` and `yaw`, everything else is read-only. */
export interface Perceiver {
  /** The enemy it belongs to (`TargetState.id`); -1 for a free slot. */
  id: number;
  active: boolean;
  /** A dead enemy neither looks nor hears. The owner keeps it current. */
  alive: boolean;
  /** The enemy's mind profile (#88): hearing error and radii by mind skill. Read live, never copied. */
  profile: MindProfile;
  /** Eye position, written by the owner every tick it moves. */
  eye: Vec3;
  /** View yaw, radians; written by the owner. Sight is tested against it. */
  yaw: number;
  rng: Rng;

  // --- sight (valid after a decision) -----------------------------------------------------
  sees: boolean;
  /** The player is inside the attention cone (only meaningful while `sees`). */
  inAttention: boolean;
  /** Sim time the current sighting began / the last one ended (-Infinity: never). */
  seenSinceSec: number;
  lostSinceSec: number;
  /** Which sample points had a clear ray at the last decision (`SEEN_*` bits). */
  visibleMask: number;
  /** The best visible sample (the eye if it is clear, else the chest, else a shoulder): where to aim. Valid while `visibleMask !== 0`. */
  sightPoint: Vec3;
  /** The class of the contact that began the current (or last) sighting, judged before it updated anything. */
  contact: Expectation;
  /** Rays cast at the last decision, and decisions made (tests, the overlay). */
  raysLast: number;
  decisions: number;
  nextDecisionSec: number;
  lastShareSec: number;

  // --- memory and expectation ------------------------------------------------------------
  memory: Memory;
  sector: AttendedSector;
  expect: Expected;

  // --- hearing ---------------------------------------------------------------------------
  /** Multiplier on the next estimate's error: shrinks on repeats from the same place. */
  hearScale: number;
  lastHeardSec: number;
  lastHeardErrM: number;
  lastHeard: Vec3;
  heardCount: number;
}

function createPerceiver(): Perceiver {
  return {
    id: -1, active: false, alive: true, profile: null as unknown as MindProfile, eye: vec3(), yaw: 0, rng: new Rng(1),
    sees: false, inAttention: false, seenSinceSec: -Infinity, lostSinceSec: -Infinity, visibleMask: 0, sightPoint: vec3(),
    contact: 'unaware', raysLast: 0, decisions: 0, nextDecisionSec: -1, lastShareSec: -Infinity,
    memory: { valid: false, source: 'sight', pos: vec3(), stampSec: 0, confidence0: 0, errM: 0 },
    sector: { active: false, yaw: 0, halfWidth: 0 },
    expect: {
      active: false, fromMemory: false, yaw: 0, halfWidth: 0, dist: 0, confidence: 0, windowOpenSec: 0, windowCloseSec: 0,
    },
    hearScale: 1, lastHeardSec: -Infinity, lastHeardErrM: 0, lastHeard: vec3(), heardCount: 0,
  };
}

export interface PerceptionEvents {
  /** An enemy got the player in sight (the first decision at which a ray reached him). `contact` is how prepared it was. */
  perceiverSaw: { tick: number; t: number; id: number; contact: Expectation; inAttention: boolean; visibleMask: number; distance: number };
  /** An enemy's sight of the player ended. */
  perceiverLostSight: { tick: number; t: number; id: number };
  /** An enemy heard the player: `x`, `y`, `z` is its estimate, off by up to `errorM` metres. */
  perceiverHeard: { tick: number; t: number; id: number; sound: EnemySoundKind; x: number; y: number; z: number; errorM: number; distance: number };
  /** A teammate's sighting reached an enemy; `adopted` when it was better than what the enemy already believed. */
  perceiverGotShared: { tick: number; t: number; id: number; fromId: number; x: number; y: number; z: number; delaySec: number; adopted: boolean };
}

declare module './types' {
  interface SimEvents extends PerceptionEvents {}
}

/** How far enemy profile `pr` hears a sound of this kind: `attribution.soundRadiusM` x `mind.hearing.radiusScale`. */
function soundRadius(pr: MindProfile, kind: EnemySoundKind): number {
  switch (kind) {
    case 'footstep': return pr.hearFootstepM;
    case 'landing': return pr.hearLandingM;
    case 'reload': return pr.hearReloadM;
    default: return pr.hearShotM;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Confidence of `m` at sim time `nowSec`: halves every `halfLifeSec`, 0 for an empty memory. */
export function memoryConfidence(m: Memory, nowSec: number, halfLifeSec: number): number {
  if (!m.valid) return 0;
  const age = nowSec - m.stampSec;
  return m.confidence0 * Math.pow(0.5, (age > 0 ? age : 0) / halfLifeSec);
}

export class PerceptionSystem {
  /** `seesPlayer` for `AttributionFacts.perception` (#119): whether the enemy with that id sees the player as of its last decision. */
  readonly queries: PerceptionQueries;
  /** Rays cast and decisions taken since the last reset (the budget tests and the overlay). */
  raysTotal = 0;
  decisionsTotal = 0;

  private readonly pool: Perceiver[] = [];
  /** The callout delays' own stream: a sighting never consumes a teammate's perception stream, so adding an enemy shifts nobody else's draws. */
  private readonly shareRng: Rng;
  private readonly halfFov: number;
  private readonly attentionHalf: number;
  private readonly minHalf: number;
  private readonly maxHalf: number;
  private readonly maxRays: number;
  private readonly rangeSq: number;

  // Shares in flight (fixed ring, swap-remove).
  private shareCount = 0;
  private readonly shareTo: Int32Array;
  private readonly shareFrom: Int32Array;
  private readonly shareDue: Float64Array;
  private readonly shareSeen: Float64Array;
  private readonly shareX: Float64Array;
  private readonly shareY: Float64Array;
  private readonly shareZ: Float64Array;

  private readonly sawEv: SimEvents['perceiverSaw'] = { tick: 0, t: 0, id: 0, contact: 'unaware', inAttention: false, visibleMask: 0, distance: 0 };
  private readonly lostEv: SimEvents['perceiverLostSight'] = { tick: 0, t: 0, id: 0 };
  private readonly heardEv: SimEvents['perceiverHeard'] = { tick: 0, t: 0, id: 0, sound: 'footstep', x: 0, y: 0, z: 0, errorM: 0, distance: 0 };
  private readonly sharedEv: SimEvents['perceiverGotShared'] = { tick: 0, t: 0, id: 0, fromId: 0, x: 0, y: 0, z: 0, delaySec: 0, adopted: false };

  constructor(
    private readonly tunables: Tunables,
    private boxes: readonly BoxDef[],
    private readonly player: PlayerState,
    private readonly events: EventSink<SimEvents>,
    seed = 1,
  ) {
    this.shareRng = new Rng((seed ^ 0x9e3779b9) >>> 0);
    const p = tunables.perception;
    for (let i = 0; i < p.maxPerceivers; i++) this.pool.push(createPerceiver());
    this.halfFov = (tunables.view.hfovDeg * DEG2RAD) / 2;
    this.attentionHalf = tunables.mind.perception.attentionHalfAngleDeg * DEG2RAD;
    this.minHalf = p.expectation.minHalfWidthDeg * DEG2RAD;
    this.maxHalf = p.expectation.maxHalfWidthDeg * DEG2RAD;
    this.maxRays = Math.min(4, p.maxRaysPerDecision);
    this.rangeSq = p.sightRangeM * p.sightRangeM;
    this.shareTo = new Int32Array(p.maxShares);
    this.shareFrom = new Int32Array(p.maxShares);
    this.shareDue = new Float64Array(p.maxShares);
    this.shareSeen = new Float64Array(p.maxShares);
    this.shareX = new Float64Array(p.maxShares);
    this.shareY = new Float64Array(p.maxShares);
    this.shareZ = new Float64Array(p.maxShares);
    this.queries = { seesPlayer: (enemy: TargetState) => this.sees(enemy.id) };
  }

  /** The level changed: sight rays use the new level's boxes from now on. */
  setBoxes(boxes: readonly BoxDef[]): void {
    this.boxes = boxes;
  }

  /** Forget every enemy and every callout in flight (a world reset or a run going live). */
  reset(): void {
    for (let i = 0; i < this.pool.length; i++) this.pool[i]!.active = false;
    this.shareCount = 0;
    this.raysTotal = 0;
    this.decisionsTotal = 0;
  }

  /**
   * Give enemy `id` a perceiver. `rng` is the enemy's own stream (`TargetState.streams.decisions`, #86);
   * `profile` its mind profile (#88). Returns null when the pool is full. The owner then keeps `eye`, `yaw` and `alive` current.
   */
  add(id: number, rng: Rng, profile: MindProfile): Perceiver | null {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (p.active) continue;
      p.id = id; p.active = true; p.alive = true; p.rng = rng; p.profile = profile;
      p.yaw = 0; p.eye.x = 0; p.eye.y = 0; p.eye.z = 0;
      p.sees = false; p.inAttention = false; p.seenSinceSec = -Infinity; p.lostSinceSec = -Infinity;
      p.visibleMask = 0; p.contact = 'unaware'; p.raysLast = 0; p.decisions = 0;
      p.nextDecisionSec = -1; p.lastShareSec = -Infinity;
      p.memory.valid = false; p.sector.active = false; p.expect.active = false;
      p.hearScale = 1; p.lastHeardSec = -Infinity; p.heardCount = 0;
      return p;
    }
    return null;
  }

  /** Free enemy `id`'s perceiver (it died or left). Callouts it already made stay in flight. */
  remove(id: number): void {
    const p = this.get(id);
    if (p !== undefined) p.active = false;
  }

  get(id: number): Perceiver | undefined {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (p.active && p.id === id) return p;
    }
    return undefined;
  }

  /** How many perceivers are in use. */
  get count(): number {
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i]!.active) n++;
    return n;
  }

  /** Visit every active perceiver without allocating. */
  each(fn: (p: Perceiver) => void): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (p.active) fn(p);
    }
  }

  /** Whether enemy `id` sees the player as of its last decision. */
  sees(id: number): boolean {
    const p = this.get(id);
    return p !== undefined && p.alive && p.sees;
  }

  /** Put the enemy's eye where the enemy's body has its head (`aim.ts` head centre) and set its view yaw. */
  setViewFromTarget(p: Perceiver, t: TargetState, yaw: number): void {
    targetAimPoint(t, this.tunables.targets, p.eye);
    p.yaw = yaw;
    p.alive = t.alive;
  }

  /**
   * The mind aims a hold at a sector (the expected appearance point, §5.4): the enemy is prepared for
   * a player appearing in it while it has no better information. `yaw` and `halfWidth` in radians.
   */
  setAttendedSector(p: Perceiver, yaw: number, halfWidth: number): void {
    p.sector.active = true;
    p.sector.yaw = yaw;
    p.sector.halfWidth = clamp(halfWidth, this.minHalf, this.maxHalf);
  }

  clearAttendedSector(p: Perceiver): void {
    p.sector.active = false;
  }

  /**
   * A belief a card or the director puts in the enemy's head at spawn (engagement-information §4.1:
   * "a pre-filled memory entry"): the player was last around (`x`, `y`, `z`), `ageSec` ago, to within `errM`.
   * Not perception: used only by cards that say so, never by the mind on its own.
   */
  prime(p: Perceiver, x: number, y: number, z: number, nowSec: number, ageSec = 0, errM = 2): void {
    this.remember(p, x, y, z, nowSec - ageSec, this.tunables.perception.confidence.prior, errM, 'prior', nowSec);
    this.refreshExpectation(p, nowSec);
  }

  /** Confidence of the enemy's memory at `nowSec`, 0 when it has none. */
  confidenceAt(p: Perceiver, nowSec: number): number {
    return memoryConfidence(p.memory, nowSec, this.tunables.mind.perception.memoryHalfLifeSec);
  }

  // --- hearing ------------------------------------------------------------------------------

  /**
   * Subscribe to the player's own sounds. Returns an unsubscribe function. Running footsteps are
   * audible; walking (`walk`) and crouch-walking are silent, exactly as the player's own hearing
   * of enemies has it (the symmetric channels, engagement-information §4.2).
   */
  attach(bus: Subscribable<SimEvents>): () => void {
    const offs = [
      bus.on('footstep', (e) => { if (!e.walking && !e.crouching) this.hear('footstep', e.tick); }),
      bus.on('playerLanded', (e) => this.hear('landing', e.tick)),
      bus.on('shotFired', (e) => this.hear('shot', e.tick)),
      bus.on('reloadStarted', (e) => this.hear('reload', e.tick)),
    ];
    return () => { for (const off of offs) off(); };
  }

  /**
   * The player made a sound of `kind` at `tick` at his current position. Every living perceiver within
   * the sound's radius (`attribution.soundRadiusM`, horizontal distance, the table the player's hearing
   * of enemies uses) hears it as a position estimate off by up to `max(floor, frac * distance)`.
   */
  hear(kind: EnemySoundKind, tick: number): void {
    const tun = this.tunables.perception;
    const now = tick * TICK_DT;
    const pl = this.player.pos;
    const conf = tun.confidence[kind];
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (!p.active || !p.alive) continue;
      const radius = soundRadius(p.profile, kind);
      const dx = pl.x - p.eye.x, dz = pl.z - p.eye.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > radius) continue;
      const err = Math.max(p.profile.hearErrorFloorM, p.profile.hearErrorFrac * d) * p.hearScale;
      const a = p.rng.next() * Math.PI * 2;
      const r = err * Math.sqrt(p.rng.next());
      const ex = pl.x + Math.cos(a) * r, ez = pl.z + Math.sin(a) * r;
      // A sound again from about where the last one was narrows the next guess.
      if (now - p.lastHeardSec <= tun.hearing.repeatWindowSec) {
        const mx = ex - p.lastHeard.x, mz = ez - p.lastHeard.z;
        const reach = err + p.lastHeardErrM;
        p.hearScale = mx * mx + mz * mz <= reach * reach
          ? Math.max(tun.hearing.repeatMinScale, p.hearScale * tun.hearing.repeatShrink)
          : 1;
      } else {
        p.hearScale = 1;
      }
      p.lastHeardSec = now; p.lastHeardErrM = err; p.lastHeard.x = ex; p.lastHeard.y = pl.y; p.lastHeard.z = ez;
      p.heardCount++;
      this.remember(p, ex, pl.y, ez, now, conf, err, 'sound', now);
      this.refreshExpectation(p, now);
      const ev = this.heardEv;
      ev.tick = tick; ev.t = now; ev.id = p.id; ev.sound = kind; ev.x = ex; ev.y = pl.y; ev.z = ez; ev.errorM = err; ev.distance = d;
      this.events.emit('perceiverHeard', ev);
    }
  }

  // --- the tick -----------------------------------------------------------------------------

  /** Advance to `tick`: deliver callouts that are due, then run the decision points that have come round. Call once per sim tick. */
  step(tick: number): void {
    const now = tick * TICK_DT;
    this.deliverShares(tick, now);
    const dec = this.tunables.perception;
    const mp = this.tunables.mind.perception;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (!p.active) continue;
      if (p.nextDecisionSec < 0) { p.nextDecisionSec = now + p.rng.next() * mp.decisionIntervalMedianSec; continue; }
      if (now < p.nextDecisionSec) continue;
      this.decide(p, tick, now);
      p.nextDecisionSec = now + lognormalTruncated(p.rng, mp.decisionIntervalMedianSec, mp.decisionIntervalCv, dec.decisionMinSec, dec.decisionMaxSec);
    }
  }

  /** One decision point for `p`: look, then update memory, sharing and expectation. */
  private decide(p: Perceiver, tick: number, now: number): void {
    const tun = this.tunables.perception;
    p.raysLast = 0;
    p.decisions++;
    this.decisionsTotal++;
    p.visibleMask = 0;
    const pl = this.player;
    const dx = pl.pos.x - p.eye.x, dz = pl.pos.z - p.eye.z;
    const dSq = dx * dx + dz * dz;
    let off = Math.PI;
    if (p.alive && dSq <= this.rangeSq) {
      off = Math.abs(wrapPi(yawOf(dx, dz) - p.yaw));
      if (off <= this.halfFov) p.visibleMask = this.trace(p, dx, dz, Math.sqrt(dSq));
    }
    const seen = p.visibleMask !== 0;

    if (seen) {
      if (!p.sees) {
        // The contact is judged against what the enemy believed *before* this sighting.
        this.refreshExpectation(p, now);
        p.contact = this.classify(p, now, yawOf(dx, dz), off);
        p.sees = true;
        p.seenSinceSec = now;
        const ev = this.sawEv;
        ev.tick = tick; ev.t = now; ev.id = p.id; ev.contact = p.contact; ev.inAttention = off <= this.attentionHalf;
        ev.visibleMask = p.visibleMask; ev.distance = Math.sqrt(dSq);
        this.events.emit('perceiverSaw', ev);
      }
      p.inAttention = off <= this.attentionHalf;
      this.remember(p, pl.pos.x, pl.pos.y, pl.pos.z, now, tun.confidence.sight, tun.expectation.sightErrM, 'sight', now);
      if (now - p.lastShareSec >= tun.share.intervalSec) {
        p.lastShareSec = now;
        this.shareSighting(p, now);
      }
    } else if (p.sees) {
      p.sees = false;
      p.lostSinceSec = now;
      const ev = this.lostEv;
      ev.tick = tick; ev.t = now; ev.id = p.id;
      this.events.emit('perceiverLostSight', ev);
    }

    if (p.memory.valid && this.confidenceAt(p, now) < tun.memory.forgetBelow) p.memory.valid = false;
    this.refreshExpectation(p, now);
  }

  /**
   * Cast the sample rays (at most `maxRaysPerDecision`, never more than four) from the enemy's eye to
   * the player's eye, chest and both shoulders. Returns the `SEEN_*` bits of the clear ones and sets
   * `sightPoint` to the best of them.
   */
  private trace(p: Perceiver, dx: number, dz: number, d: number): number {
    const s = this.tunables.perception.samples;
    const pl = this.player;
    const fx = pl.pos.x, fy = pl.pos.y, fz = pl.pos.z;
    let lx = 1, lz = 0;
    if (d > 1e-6) { lx = -dz / d; lz = dx / d; } // square to the line of sight on the ground plane
    const ex = p.eye.x, ey = p.eye.y, ez = p.eye.z;
    let mask = 0;
    for (let k = 0; k < this.maxRays; k++) {
      let px = fx, py: number, pz = fz;
      if (k === 0) py = fy + pl.eyeHeight;
      else if (k === 1) py = fy + pl.height * s.chestFrac;
      else {
        py = fy + pl.height * s.shoulderFrac;
        const side = k === 2 ? s.shoulderHalfWidthM : -s.shoulderHalfWidthM;
        px += lx * side; pz += lz * side;
      }
      p.raysLast++;
      this.raysTotal++;
      if (!lineClear(this.boxes, ex, ey, ez, px, py, pz)) continue;
      if (mask === 0) { p.sightPoint.x = px; p.sightPoint.y = py; p.sightPoint.z = pz; }
      mask |= 1 << k;
    }
    return mask;
  }

  // --- memory -------------------------------------------------------------------------------

  /** Store a belief if it is at least as confident (now) as the one the enemy has. Returns whether it was stored. */
  private remember(
    p: Perceiver, x: number, y: number, z: number, stampSec: number, conf0: number, errM: number,
    source: MemorySource, nowSec: number,
  ): boolean {
    const half = this.tunables.mind.perception.memoryHalfLifeSec;
    const m = p.memory;
    const incoming = conf0 * Math.pow(0.5, Math.max(0, nowSec - stampSec) / half);
    if (m.valid && incoming < memoryConfidence(m, nowSec, half)) return false;
    m.valid = true; m.source = source;
    m.pos.x = x; m.pos.y = y; m.pos.z = z;
    m.stampSec = stampSec; m.confidence0 = conf0; m.errM = errM;
    return true;
  }

  // --- shared sightings ---------------------------------------------------------------------

  /** `p` saw the player at `now`: queue a callout to every other living enemy, each after its own lognormal delay. */
  private shareSighting(p: Perceiver, now: number): void {
    const sh = this.tunables.perception.share;
    const mp = this.tunables.mind.perception;
    const pl = this.player.pos;
    for (let i = 0; i < this.pool.length; i++) {
      const q = this.pool[i]!;
      if (!q.active || !q.alive || q === p) continue;
      if (this.shareCount >= this.shareTo.length) return;
      const n = this.shareCount++;
      const delay = lognormalTruncated(this.shareRng, mp.shareDelayMedianSec, mp.shareDelayCv, sh.delayMinSec, sh.delayMaxSec);
      this.shareTo[n] = q.id; this.shareFrom[n] = p.id;
      this.shareDue[n] = now + delay; this.shareSeen[n] = now;
      this.shareX[n] = pl.x; this.shareY[n] = pl.y; this.shareZ[n] = pl.z;
    }
  }

  private deliverShares(tick: number, now: number): void {
    const conf = this.tunables.perception.confidence.shared;
    const err = this.tunables.perception.expectation.sightErrM;
    for (let n = this.shareCount - 1; n >= 0; n--) {
      if (this.shareDue[n]! > now) continue;
      const to = this.get(this.shareTo[n]!);
      if (to !== undefined && to.alive) {
        const seenAt = this.shareSeen[n]!;
        const x = this.shareX[n]!, y = this.shareY[n]!, z = this.shareZ[n]!;
        const adopted = this.remember(to, x, y, z, seenAt, conf, err, 'shared', now);
        this.refreshExpectation(to, now);
        const ev = this.sharedEv;
        ev.tick = tick; ev.t = now; ev.id = to.id; ev.fromId = this.shareFrom[n]!;
        ev.x = x; ev.y = y; ev.z = z; ev.delaySec = now - seenAt; ev.adopted = adopted;
        this.events.emit('perceiverGotShared', ev);
      }
      const last = --this.shareCount;
      if (n !== last) {
        this.shareTo[n] = this.shareTo[last]!; this.shareFrom[n] = this.shareFrom[last]!;
        this.shareDue[n] = this.shareDue[last]!; this.shareSeen[n] = this.shareSeen[last]!;
        this.shareX[n] = this.shareX[last]!; this.shareY[n] = this.shareY[last]!; this.shareZ[n] = this.shareZ[last]!;
      }
    }
  }

  // --- expectation --------------------------------------------------------------------------

  /**
   * Recompute `p.expect` from memory (preferred: it is specific) or the sector the mind set. The
   * sector is the memory's position seen from the eye, as wide as the position is uncertain; the
   * window opens when the information arrived and closes `windowSec` later, or half a window after
   * the player could have run from there to here, whichever is later.
   */
  refreshExpectation(p: Perceiver, now: number): void {
    const tun = this.tunables.perception;
    const ex = tun.expectation;
    const e = p.expect;
    const m = p.memory;
    if (m.valid) {
      const dx = m.pos.x - p.eye.x, dz = m.pos.z - p.eye.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const age = Math.max(0, now - m.stampSec);
      e.active = true; e.fromMemory = true;
      e.yaw = yawOf(dx, dz);
      e.halfWidth = clamp(Math.atan2(m.errM + ex.driftMps * age, Math.max(d, 0.5)), this.minHalf, this.maxHalf);
      e.dist = d;
      e.confidence = memoryConfidence(m, now, this.tunables.mind.perception.memoryHalfLifeSec);
      e.windowOpenSec = m.stampSec;
      e.windowCloseSec = m.stampSec + Math.max(ex.windowSec, d / ex.assumedSpeedMps + ex.windowSec / 2);
    } else if (p.sector.active) {
      e.active = true; e.fromMemory = false;
      e.yaw = p.sector.yaw; e.halfWidth = p.sector.halfWidth; e.dist = 0;
      e.confidence = tun.confidence.prior;
      e.windowOpenSec = now; e.windowCloseSec = now + ex.windowSec;
    } else {
      e.active = false; e.fromMemory = false; e.confidence = 0;
    }
  }

  /**
   * How prepared `p` is for the player appearing at bearing `bearingYaw` (radians) at `nowSec`
   * (`player-like-enemies` §5.3, timed by `sim/enemyTiming.ts`): `prepared` when the bearing is in the
   * attended sector and the time inside its window; else `attending` inside the attention cone around
   * the view; else `unaware` (the orientation cost applies). Reads the expectation as last refreshed.
   */
  classifyContact(p: Perceiver, nowSec: number, bearingYaw: number): Expectation {
    return this.classify(p, nowSec, bearingYaw, Math.abs(wrapPi(bearingYaw - p.yaw)));
  }

  private classify(p: Perceiver, now: number, bearing: number, offAxis: number): Expectation {
    const e = p.expect;
    if (e.active && now >= e.windowOpenSec && now <= e.windowCloseSec && Math.abs(wrapPi(bearing - e.yaw)) <= e.halfWidth) {
      return 'prepared';
    }
    return offAxis <= this.attentionHalf ? 'attending' : 'unaware';
  }
}
