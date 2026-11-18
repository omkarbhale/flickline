import type { Tunables } from '../config/tunables';
import type { WeaponId } from '../config/weapon';
import { DEG2RAD } from '../core/math';
import { TICK_DT } from '../core/time';
import { createSim, runToFullSpeed, settle, ticksOf, type Sim } from './sim';
import type { HitZone } from '../sim/types';

/**
 * Behaviour measurements for the conformance rows. Each function builds its own simulation, drives
 * it with scripted `TickInput`, and returns plain numbers read from the sim. Nothing here knows the
 * spec value it will be compared with; `rows.ts` does that.
 */

/** Seconds of `n` ticks. */
export const secs = (n: number): number => n * TICK_DT;

const memos = new WeakMap<Tunables, Map<string, unknown>>();

/** Compute `fn` once per tunables object and key (several rows read the same measurement). */
function memo<T>(t: Tunables, key: string, fn: () => T): T {
  let m = memos.get(t);
  if (!m) memos.set(t, (m = new Map()));
  if (!m.has(key)) m.set(key, fn());
  return m.get(key) as T;
}

/** An independent copy of the tunables (tunables are plain JSON-safe data). */
function copyOf(t: Tunables): Tunables {
  return structuredClone(t);
}

// --- Movement (spec §2) ------------------------------------------------------------------------

/** Steady horizontal speed with `weapon` in hand, holding forward (+ walk or crouch), m/s. */
export function steadySpeed(t: Tunables, weapon: WeaponId, mode: 'run' | 'walk' | 'crouch'): number {
  const sim = createSim({ weapon, tunables: t });
  runToFullSpeed(sim, mode === 'walk' ? { walk: true } : mode === 'crouch' ? { crouch: true } : {});
  return sim.speed();
}

/** Seconds from rest, holding forward, until the speed first reaches its steady value. */
export function accelTimeSec(t: Tunables, weapon: WeaponId): number {
  const full = steadySpeed(t, weapon, 'run');
  const sim = createSim({ weapon, tunables: t });
  for (let k = 1; k <= ticksOf(2); k++) {
    sim.tick({ moveZ: 1 });
    if (sim.speed() >= full - 1e-6) return secs(k);
  }
  return Infinity;
}

export interface StopTrace {
  /** Forward speed after each released tick (index 0 = first tick of the release). */
  speeds: number[];
  /** Ticks from the stopping input until the forward speed first reaches zero or below. */
  ticksToZero: number;
  fullSpeed: number;
}

/** Run to full speed, then stop with `how`: let go of every key, or press the opposite key. */
export function stopTrace(t: Tunables, weapon: WeaponId, how: 'release' | 'counter'): StopTrace {
  return memo(t, `stop/${weapon}/${how}`, () => stopTraceOf(t, weapon, how));
}

function stopTraceOf(t: Tunables, weapon: WeaponId, how: 'release' | 'counter'): StopTrace {
  const sim = createSim({ weapon, tunables: t });
  runToFullSpeed(sim);
  const fullSpeed = sim.speed();
  const speeds: number[] = [];
  let ticksToZero = -1;
  for (let k = 1; k <= ticksOf(1); k++) {
    sim.tick(how === 'counter' ? { moveZ: -1 } : {});
    const forward = -sim.world.player.vel.z; // yaw 0 looks down -Z
    speeds.push(forward);
    if (ticksToZero < 0 && forward <= 1e-9) ticksToZero = k;
  }
  return { speeds, ticksToZero, fullSpeed };
}

/**
 * An Echo's stop (spec §5.3 target stop time): a Strafer at the dial-50 strafe speed, its body
 * driven by commands (#87): it holds its strafe key for a second, lets go, and this counts the
 * ticks until its body is at rest. The same measurement as the player's release, on the enemy.
 */
export function echoStopTicks(t: Tunables): number {
  return memo(t, 'echo-stop', () => {
    const sim = createSim({ tunables: t });
    const id = sim.world.spawnTarget('strafer', 0, 0, -10, sim.bus);
    const body = sim.world.targetField.byId(id)!.body;
    body.driven = true;
    body.cmd.moveX = 1;
    sim.run(ticksOf(1));
    body.cmd.moveX = 0;
    for (let k = 1; k <= ticksOf(1); k++) {
      sim.tick();
      if (Math.hypot(body.kin.vel.x, body.kin.vel.z) <= 1e-9) return k;
    }
    return -1;
  });
}

/** Braking (m/s^2) in the bands above and below `splitFraction` of full speed, from a release trace. */
export function brakeRates(trace: StopTrace, splitFraction: number): { high: number; low: number } {
  const split = splitFraction * trace.fullSpeed;
  const v = [trace.fullSpeed, ...trace.speeds];
  let high = NaN;
  let low = NaN;
  for (let k = 0; k + 1 < v.length; k++) {
    const a = v[k]!, b = v[k + 1]!;
    if (b <= 1e-9) break;
    const rate = (a - b) / TICK_DT;
    if (Number.isNaN(high) && a > split && b > split) high = rate;
    if (b < split) low = rate;
  }
  return { high, low };
}

/** Fraction of full speed at which braking softens (the first tick whose rate falls below 3/4 of the first). */
export function brakeSplitFraction(trace: StopTrace): number {
  const v = [trace.fullSpeed, ...trace.speeds];
  const first = v[0]! - v[1]!;
  for (let k = 1; k + 1 < v.length; k++) {
    if (v[k + 1]! <= 1e-9) break;
    if (v[k]! - v[k + 1]! < 0.75 * first) return v[k]! / trace.fullSpeed;
  }
  return NaN;
}

export interface StopShot {
  /** Ticks after the stopping input (the shot is fired on this released tick). */
  ticks: number;
  speed: number;
  moving: boolean;
  /** Spread minus the stationary first-shot spread: the movement error that shot carried, degrees. */
  errorDeg: number;
}

/**
 * From full run, release at tick 0 and fire on the `n`-th released tick (a fresh world per n, so
 * every shot is a first shot). The movement error is the spread over the stationary first shot.
 */
export function shotAfterStop(t: Tunables, weapon: WeaponId, n: number): StopShot {
  const sim = createSim({ weapon, tunables: t });
  runToFullSpeed(sim);
  sim.run(n - 1);
  sim.tick({ fire: true });
  const s = sim.rec.shots[0]!;
  return { ticks: n, speed: s.speed, moving: s.moving, errorDeg: s.spreadDeg - t.weapon[weapon].spreadFirstDeg };
}

/** Every released-tick shot from 1 to `upTo`. */
export function stopShotSweep(t: Tunables, weapon: WeaponId, upTo = 40): StopShot[] {
  return memo(t, `sweep/${weapon}/${upTo}`, () => {
    const out: StopShot[] = [];
    for (let n = 1; n <= upTo; n++) out.push(shotAfterStop(t, weapon, n));
    return out;
  });
}

export interface JumpResult {
  apexM: number;
  airSec: number;
  /** Takeoff speed by the spec's measuring recipe: 4 * apex / air time (§2.6), m/s. */
  takeoffSpeed: number;
}

/** Jump from rest on flat ground. */
export function jumpFromRest(t: Tunables, weapon: WeaponId): JumpResult {
  return memo(t, `jump/${weapon}`, () => jumpOf(t, weapon));
}

function jumpOf(t: Tunables, weapon: WeaponId): JumpResult {
  const sim = createSim({ weapon, tunables: t });
  sim.tick({ jump: true });
  let apex = sim.world.player.pos.y;
  let k = 1;
  while (!sim.world.player.grounded && k < ticksOf(3)) {
    sim.tick();
    apex = Math.max(apex, sim.world.player.pos.y);
    k++;
  }
  return { apexM: apex, airSec: secs(k), takeoffSpeed: (4 * apex) / secs(k) };
}

/** Horizontal acceleration (m/s^2) over the first 3 ticks of holding sideways: on the ground, and in the air. */
export function accelGroundAndAir(t: Tunables, weapon: WeaponId): { ground: number; air: number } {
  const g = createSim({ weapon, tunables: t });
  g.run(3, { moveX: 1 });
  const ground = Math.abs(g.world.player.vel.x) / (3 * TICK_DT);
  const a = createSim({ weapon, tunables: t });
  a.tick({ jump: true });
  const v0 = Math.abs(a.world.player.vel.x);
  a.run(3, { moveX: 1 });
  const air = (Math.abs(a.world.player.vel.x) - v0) / (3 * TICK_DT);
  return { ground, air };
}

/** Horizontal speed at takeoff and just before landing when the player lets go of every key in the air. */
export function airSpeedKept(t: Tunables, weapon: WeaponId): { takeoff: number; beforeLanding: number } {
  const sim = createSim({ weapon, tunables: t });
  runToFullSpeed(sim);
  sim.tick({ moveZ: 1, jump: true });
  const takeoff = sim.speed();
  let last = takeoff;
  while (!sim.world.player.grounded) {
    last = sim.speed();
    sim.tick();
    if (sim.world.tick > 2000) break;
  }
  return { takeoff, beforeLanding: last };
}

/** Speed before takeoff and on the tick after landing, holding forward the whole time (landing speed loss). */
export function landingSpeedLoss(t: Tunables, weapon: WeaponId): number {
  const sim = createSim({ weapon, tunables: t });
  runToFullSpeed(sim);
  const before = sim.speed();
  sim.tick({ moveZ: 1, jump: true });
  let k = 0;
  while (!sim.world.player.grounded && k++ < ticksOf(3)) sim.tick({ moveZ: 1 });
  const after = sim.speed();
  return before > 0 ? (before - after) / before : 0;
}

/** Highest speed reached over 4 s of continuous forward bunny-hopping, m/s, and the plain run speed. */
export function bunnyHopTopSpeed(t: Tunables, weapon: WeaponId): { hop: number; run: number } {
  const run = steadySpeed(t, weapon, 'run');
  const sim = createSim({ weapon, tunables: t });
  let top = 0;
  for (let k = 0; k < ticksOf(4); k++) {
    sim.tick({ moveZ: 1, jump: sim.world.player.grounded });
    top = Math.max(top, sim.speed());
  }
  return { hop: top, run };
}

/** Eye height after settling in each stance, and hull height; plus the seconds the eye takes to move between them. */
export function stanceHeights(t: Tunables, weapon: WeaponId): {
  standHull: number; standEye: number; crouchHull: number; crouchEye: number; downSec: number; upSec: number;
} {
  return memo(t, `stance/${weapon}`, () => stanceOf(t, weapon));
}

function stanceOf(t: Tunables, weapon: WeaponId): ReturnType<typeof stanceHeights> {
  const sim = createSim({ weapon, tunables: t });
  const p = sim.world.player;
  const standHull = p.height, standEye = p.eyeHeight;
  let downSec = Infinity;
  for (let k = 1; k <= ticksOf(1); k++) {
    sim.tick({ crouch: true });
    if (downSec === Infinity && Math.abs(p.eyeHeight - t.movement.crouchEyeHeight) < 1e-6) downSec = secs(k);
  }
  const crouchHull = p.height, crouchEye = p.eyeHeight;
  let upSec = Infinity;
  for (let k = 1; k <= ticksOf(1); k++) {
    sim.tick();
    if (upSec === Infinity && Math.abs(p.eyeHeight - standEye) < 1e-6) upSec = secs(k);
  }
  return { standHull, standEye, crouchHull, crouchEye, downSec, upSec };
}

/** The pitch the sim shoots with when the view is told to look 100 degrees up, in degrees. */
export function pitchClampDeg(t: Tunables): number {
  const sim = createSim({ tunables: t });
  sim.tick({ pitch: 100 * DEG2RAD });
  return sim.world.player.pitch / DEG2RAD;
}

// --- Shooting (spec §3) ------------------------------------------------------------------------

/**
 * A trigger finger: auto weapons hold the trigger; semi weapons click on the first tick the gun is
 * ready again (an ideal clicker), releasing in between so every click is a fresh press.
 */
export function trigger(sim: Sim, weapon: WeaponId): () => boolean {
  const auto = sim.world.tunables.weapon[weapon].fireMode === 'auto';
  let prev = false;
  return () => {
    if (auto) return true;
    const w = sim.world.weapon;
    const ready = w.cooldown - TICK_DT <= 1e-9 && w.equipLeft - TICK_DT <= 1e-9 && w.reloadLeft - TICK_DT <= 1e-9;
    prev = !prev && ready;
    return prev;
  };
}

/** Shots fired in `seconds` of trigger pulling with an endless magazine, and the first and last shot times. */
export function fireRate(t: Tunables, weapon: WeaponId, seconds = 10): { shots: number; ratePerSec: number } {
  const sim = createSim({ weapon, tunables: t, infiniteMagazine: true });
  const n = ticksOf(seconds);
  const pull = trigger(sim, weapon);
  for (let k = 0; k < n; k++) sim.tick({ fire: pull() });
  const shots = sim.rec.shots;
  const span = secs(shots[shots.length - 1]!.tick - shots[0]!.tick);
  return { shots: shots.length, ratePerSec: span > 0 ? (shots.length - 1) / span : 0 };
}

export interface MagazineResult {
  shotsBeforeReload: number;
  reloadSec: number;
  ammoAfter: number;
  reserveBefore: number;
  reserveAfter: number;
}

/** Empty one magazine: shots until the reload starts, the reload's length, and the ammo it leaves. */
export function magazineCycle(t: Tunables, weapon: WeaponId): MagazineResult {
  const sim = createSim({ weapon, tunables: t });
  const slot = sim.world.weapon.slots[sim.world.weapon.active]!;
  const reserveBefore = slot.reserve;
  const pull = trigger(sim, weapon);
  for (let k = 0; k < ticksOf(60) && sim.rec.reloadCompleted.length === 0; k++) sim.tick({ fire: pull() });
  const started = sim.rec.reloadStarted[0] ?? -1;
  const done = sim.rec.reloadCompleted[0];
  return {
    shotsBeforeReload: sim.rec.shots.filter((s) => s.tick <= started).length,
    reloadSec: done ? secs(done.tick - started) : Infinity,
    ammoAfter: done?.ammo ?? -1,
    reserveBefore,
    reserveAfter: done?.reserve ?? -1,
  };
}

/** Seconds from the weapon-swap input to the first shot that comes out. */
export function equipSec(t: Tunables, weapon: WeaponId): number {
  const sim = createSim({ weapon, tunables: t });
  const slots = sim.world.weapon.slots;
  const mine = slots.findIndex((s) => s.id === weapon);
  const other = mine === 0 ? 1 : 0;
  sim.world.equipWeapon(slots[other]!.id);
  sim.run(2);
  const swapTick = sim.world.tick + 1;
  sim.tick({ switchTo: mine });
  const pull = trigger(sim, weapon);
  for (let k = 0; k < ticksOf(5) && sim.rec.shots.length === 0; k++) sim.tick({ fire: pull() });
  const shot = sim.rec.shots[0];
  return shot ? secs(shot.tick - swapTick) : Infinity;
}

/** Spread of the first shot from a standing or crouched, stationary, settled player, degrees. */
export function firstShotSpreadDeg(t: Tunables, weapon: WeaponId, crouch: boolean): number {
  const sim = createSim({ weapon, tunables: t });
  if (crouch) sim.run(ticksOf(0.5), { crouch: true });
  sim.tick({ fire: true, crouch });
  return sim.rec.shots[0]!.spreadDeg;
}

/** Largest and mean deviation of the fired direction from the aim axis over `n` stationary first shots, degrees. */
export function firstShotCone(t: Tunables, weapon: WeaponId, n = 400): { maxDeg: number; spreadDeg: number } {
  let maxDeg = 0;
  let spreadDeg = 0;
  for (let seed = 1; seed <= n; seed++) {
    const sim = createSim({ weapon, seed, tunables: t, settle: false });
    sim.tick({ fire: true });
    const s = sim.rec.shots[0]!;
    maxDeg = Math.max(maxDeg, s.deviationDeg);
    spreadDeg = s.spreadDeg;
  }
  return { maxDeg, spreadDeg };
}

// --- Damage (spec §3.2, §4.1, §4.2, §6) ---------------------------------------------------------

/** Config copy with spread and recoil zeroed, so a probe shot lands where it is aimed. */
function steadyAimTunables(source: Tunables): Tunables {
  const t = copyOf(source);
  for (const def of Object.values(t.weapon)) {
    def.spreadFirstDeg = 0;
    def.spreadMaxDeg = 0;
    def.errAirDeg = 0; def.errWalkDeg = 0; def.errRunDeg = 0; def.errCrouchMoveDeg = 0;
    def.recoilPitchDeg = [0];
    def.recoilYawDeg = [0];
  }
  return t;
}

/** Height (m above the target's feet) a probe aims at for each zone of a standing humanoid. */
function zoneAimHeight(t: Tunables, zone: HitZone): number {
  const h = t.targets.hit;
  if (zone === 'head') return h.headCentreStand;
  if (zone === 'body') return (h.torsoBottomStand + h.torsoTopStand) / 2;
  return h.legTopStand / 2;
}

function aimAt(sim: Sim, zone: HitZone, distance: number): { pitch: number } {
  const p = sim.world.player;
  return { pitch: Math.atan2(zoneAimHeight(sim.world.tunables, zone) - (p.pos.y + p.eyeHeight), distance) };
}

/** One bullet at `zone` of a standing Post `distance` m ahead: the zone the sim reports and the damage it dealt. */
export function probeDamage(source: Tunables, weapon: WeaponId, zone: HitZone, distance: number): { zone: HitZone | null; damage: number } {
  const sim = createSim({ weapon, tunables: steadyAimTunables(source) });
  sim.world.spawnTarget('post', 0, 0, -distance, sim.bus);
  sim.tick({ fire: true, ...aimAt(sim, zone, distance) });
  const hit = sim.rec.impacts[0];
  return { zone: hit?.zone ?? null, damage: hit?.damage ?? 0 };
}

/** Damage a bullet does at `distance` m when it hits dead centre, ignoring which zone. */
export function bulletsToKillEcho(source: Tunables, weapon: WeaponId, zone: HitZone, distance: number, shield: number): number {
  const sim = createSim({ weapon, tunables: steadyAimTunables(source), infiniteMagazine: true });
  sim.world.setShields(0, shield);
  sim.world.spawnTarget('post', 0, 0, -distance, sim.bus);
  const aim = aimAt(sim, zone, distance);
  const pull = trigger(sim, weapon);
  for (let k = 0; k < ticksOf(30) && sim.rec.kills === 0; k++) sim.tick({ fire: pull(), ...aim });
  return sim.rec.kills === 0 ? Infinity : sim.rec.impacts.filter((i) => i.result === 'hit').length;
}

/**
 * Zone boundaries of a Post seen from the front at 50 m: shoot a vertical line of rays through the
 * target, 1 cm apart, and report the heights where the zone changes. `leg` ends at `legTop`, `body`
 * at `torsoTop`, and `head` ends at `headTop`.
 */
export function zoneBoundaries(source: Tunables, crouched: boolean): { legTop: number; torsoTop: number; headBottom: number; headTop: number } {
  const t = steadyAimTunables(source);
  const d = 50; // far, so the half-width of the zone (up to 25 cm) barely shifts where the ray meets it
  const sim = createSim({ tunables: t });
  const eye = sim.world.player.eyeHeight;
  const zones: (HitZone | null)[] = [];
  const step = 0.01;
  for (let h = 0; h <= 2.2 + 1e-9; h += step) {
    const s = createSim({ tunables: t });
    s.world.spawnTarget('post', 0, 0, -d, s.bus, { crouched });
    s.tick({ fire: true, pitch: Math.atan2(h - eye, d) });
    zones.push(s.rec.impacts[0]?.zone ?? null);
  }
  const heightOf = (i: number): number => i * step;
  const lastOf = (z: HitZone): number => zones.map((q, i) => (q === z ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const firstOf = (z: HitZone): number => zones.findIndex((q) => q === z);
  const headBottom = heightOf(firstOf('head'));
  return { legTop: heightOf(lastOf('leg')), torsoTop: heightOf(lastOf('body')), headBottom, headTop: heightOf(lastOf('head')) };
}

// --- Taking damage (spec §4.3, §4.4) ------------------------------------------------------------

export interface TagTrace {
  /** The player's tag multiplier on each tick after the (last) hit, from tick 1. */
  scale: number[];
  /** Horizontal speed on each tick. */
  speed: number[];
  fullSpeed: number;
}

/** Hit a running player with a 1 HP bullet (so it survives) and record the tag scale and speed for `seconds`; `hitEveryTicks` repeats the hit. */
export function tagAfterHit(t: Tunables, weapon: WeaponId, seconds = 1.5, hitEveryTicks = 0): TagTrace {
  return memo(t, `tag/${weapon}/${seconds}/${hitEveryTicks}`, () => tagOf(t, weapon, seconds, hitEveryTicks));
}

function tagOf(t: Tunables, weapon: WeaponId, seconds: number, hitEveryTicks: number): TagTrace {
  const sim = createSim({ weapon, tunables: t });
  runToFullSpeed(sim);
  const fullSpeed = sim.speed();
  const scale: number[] = [];
  const speed: number[] = [];
  const n = ticksOf(seconds);
  for (let k = 0; k < n; k++) {
    if (k === 0 || (hitEveryTicks > 0 && k % hitEveryTicks === 0)) sim.world.damagePlayer(1, 'body', 0, 1.6, -12, 1, sim.bus);
    sim.tick({ moveZ: 1 });
    scale.push(sim.world.player.tagScale);
    speed.push(sim.speed());
  }
  return { scale, speed, fullSpeed };
}

/** Aim punch right after one 1 HP hit to `zone`, degrees, and the seconds until it has recovered (< 0.001 deg). */
export function flinchOf(t: Tunables, zone: HitZone): { kickDeg: number; recoverySec: number } {
  const sim = createSim({ tunables: t });
  settle(sim);
  sim.world.damagePlayer(1, zone, 0, 1.6, -12, 1, sim.bus);
  const kickDeg = sim.world.health.flinchDeg;
  let recoverySec = Infinity;
  for (let k = 1; k <= ticksOf(2); k++) {
    sim.tick();
    if (Math.abs(sim.world.health.flinchDeg) < 1e-3) {
      recoverySec = secs(k);
      break;
    }
  }
  return { kickDeg, recoverySec };
}
