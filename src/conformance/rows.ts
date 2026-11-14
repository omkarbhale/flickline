import type { Tunables } from '../config/tunables';
import type { WeaponDef, WeaponId } from '../config/weapon';
import { FixedStepper } from '../core/fixedStep';
import { TICK_DT, TICK_RATE } from '../core/time';
import { cmPer360, degreesPerCount } from '../core/sensitivity';
import { horizontalFovDeg, REFERENCE_ASPECT, verticalFovDeg } from '../core/view';
import type { HitZone } from '../sim/types';
import * as M from './measure';
import { createSim, ticksOf } from './sim';
import type { ArchetypeRow, Confidence, GlobalEntry, SpecSnapshot, SpecValue } from './specParse';

/**
 * Every conformance row: one per spec value or measurable behaviour. A row says where the spec
 * value comes from (section, confidence tag), how the implemented value is obtained (a live
 * `config/` key, or a measurement on the real sim), and what the implementation gave.
 *
 * A row's outcome is only a comparison. Whether a mismatch is acceptable is decided in
 * `conformance.ts` against `deviations.ts`.
 */

/** How much the spec itself trusts a number: a sourced value, an estimate, or a placeholder design choice. */
export type TagKind = 'sourced' | 'estimate' | 'placeholder';

export interface Tag {
  /** The spec's own wording, short ("DATA", "ESTIMATE 35%", "L", ...). */
  text: string;
  kind: TagKind;
}

export type Outcome =
  /** Not built yet: nothing in `config/` or the sim to compare. `note` says what is missing. */
  | { kind: 'absent'; note: string }
  | { kind: 'measured'; value: string; ok: boolean };

export interface RowDef {
  /** Stable id: `<spec section>/<what>`; also the name of the test that checks it. */
  id: string;
  /** Table heading the row is listed under. */
  area: string;
  /** Spec section the value comes from. */
  section: string;
  /** Spec value as shown in the table. */
  spec: string;
  tag: Tag;
  /** How the implemented value is obtained (a config key, or what the sim is made to do). */
  via: string;
  run: () => Outcome;
}

// --- Small helpers -----------------------------------------------------------------------------

/** A number with at most 6 significant digits, no trailing zeros. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Number(n.toPrecision(6)));
}

function show(v: SpecValue | null | undefined): string {
  if (v === null || v === undefined) return 'n/a';
  if (Array.isArray(v)) return v.map(fmt).join(' to ');
  return typeof v === 'number' ? fmt(v) : String(v);
}

/** A short unit from the §7.1 unit cell (" m/s"), or nothing when the cell is a note or a type. */
function unitOf(e: GlobalEntry): string {
  const u = e.unit.trim();
  return u === '' || u.includes('(') || ['x', 'bool', 'enum', 'fraction', 'exponent'].includes(u) ? '' : ` ${u}`;
}

const absent = (note: string): Outcome => ({ kind: 'absent', note });

/** Numbers equal within `tol` (absolute). */
function cmp(spec: number, got: number | undefined, tol: number, unit = ''): Outcome {
  if (got === undefined) return absent('no such value yet');
  return { kind: 'measured', value: fmt(got) + unit, ok: Math.abs(got - spec) <= tol };
}

function cmpText(spec: string, got: string): Outcome {
  return { kind: 'measured', value: got, ok: got === spec };
}

const EXACT = 1e-9;

/** The tag multiplier is quantised to ticks, so it bottoms out a hair above its floor (0.277 for 0.275). */
const TAG_FLOOR_TOL = 0.005;

const sourced = (text: string): Tag => ({ text, kind: 'sourced' });
const estimate = (text: string): Tag => ({ text, kind: 'estimate' });
const placeholder = (text: string): Tag => ({ text, kind: 'placeholder' });

/** The spec's §7.1 confidence letter as a tag: H and M are sourced numbers, L an estimate, P a design placeholder. */
export function tagOfConf(conf: Confidence): Tag {
  return conf === 'L' ? estimate('L') : conf === 'P' ? placeholder('P') : sourced(conf);
}

/** Read a config value by path, trying each alternative in turn (a moved key keeps its row). */
function cfg(t: Tunables, ...paths: string[]): { path: string; value: unknown } | undefined {
  for (const path of paths) {
    let cur: unknown = t;
    for (const part of path.split('.')) {
      if (cur === null || typeof cur !== 'object' || !(part in cur)) {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur !== undefined) return { path, value: cur };
  }
  return undefined;
}

// --- Per-archetype lookups -----------------------------------------------------------------------

interface Impl {
  id: WeaponId;
  def: WeaponDef;
}

/** The implemented weapon built from a spec archetype, if any. */
function weaponFor(t: Tunables, archetype: string): Impl | undefined {
  for (const id of Object.keys(t.weapon) as WeaponId[]) {
    if (t.weapon[id].archetype === archetype) return { id, def: t.weapon[id] };
  }
  return undefined;
}

const notBuilt = (archetype: string): string => `no \`${archetype}\` weapon in \`config/weapon.ts\` yet`;

/** Stationary spread-by-shot model from spec §3.3 (first shot adds 1/tap_eff, held shots add 1). */
function sprayModel(first: number, max: number, ramp: number, tap: number, shots: number): number[] {
  const out: number[] = [];
  let n = 0;
  for (let i = 0; i < shots; i++) {
    out.push(first + (max - first) * Math.min(1, n / ramp));
    n += i === 0 ? 1 / tap : 1;
  }
  return out;
}

const HANDLING_TAG: Tag = sourced('DATA');
const WIKI_TAG: Tag = sourced('WIKI, medium');

/** Tag of a §7.3 field, from the confidence text in spec §3.3 and §3.4. */
function spreadTag(archetype: string, field: string): Tag {
  const rifle = archetype === 'rifle_precise' || archetype === 'rifle_spray';
  if (field === 'spread_first_deg') return HANDLING_TAG;
  if (field === 'spread_max_deg' || field === 'crouch_mult') return WIKI_TAG;
  if (field === 'recovery_s') {
    if (rifle) return sourced('OFFICIAL (PN 0.50)');
    return estimate(archetype === 'smg' ? 'ESTIMATE 35%' : 'ESTIMATE 30%');
  }
  if (field === 'tap_eff') {
    if (rifle) return sourced('OFFICIAL (PN 0.50)');
    return archetype === 'smg' ? sourced('OFFICIAL (PN 11.08)') : estimate('ESTIMATE 30%');
  }
  if (field === 'n_ramp') return estimate('ESTIMATE 30%');
  if (field === 'deadzone') return archetype.startsWith('sniper') ? sourced('OFFICIAL 65% (PN 1.09)') : sourced('OFFICIAL 70% (PN 3.0)');
  if (archetype.startsWith('sniper')) return WIKI_TAG;
  if (field === 'err_walk_deg' || field === 'err_run_deg') return sourced('OFFICIAL (PN 3.0 / 9.10)');
  if (field === 'err_crouchmove_deg' && rifle) return sourced('OFFICIAL (PN 2.02)');
  return WIKI_TAG;
}

const SPREAD_FIELDS: Record<string, keyof WeaponDef> = {
  spread_first_deg: 'spreadFirstDeg',
  spread_max_deg: 'spreadMaxDeg',
  crouch_mult: 'crouchSpreadMult',
  recovery_s: 'recoverySec',
  tap_eff: 'tapEfficiency',
  n_ramp: 'spreadRampBullets',
  err_crouchmove_deg: 'errCrouchMoveDeg',
  err_walk_deg: 'errWalkDeg',
  err_run_deg: 'errRunDeg',
  err_air_deg: 'errAirDeg',
  deadzone: 'deadzoneFraction',
};

const HANDLING_FIELDS: Record<string, keyof WeaponDef> = {
  fire_rate_hz: 'fireRateHz',
  mag: 'magazine',
  reload_s: 'reloadSec',
  equip_s: 'equipSec',
  run_speed_mps: 'runSpeedMps',
  reserve: 'reserve',
};

// --- Row builders, one function per area ---------------------------------------------------------

type Rows = RowDef[];

/** §7.1 global tunables: one row per key. A key with no builder here fails `conformance.test.ts`. */
function globalRows(snap: SpecSnapshot, t: Tunables): Rows {
  const rows: Rows = [];
  const get = (key: string): GlobalEntry => snap.global.find((g) => g.key === key)!;
  const kestrel = weaponFor(t, 'rifle_spray')?.id ?? 'kestrel';
  const stop = (): M.StopTrace => M.stopTrace(t, kestrel, 'release');

  const rowFor = (key: string, via: string, run: (spec: number, e: GlobalEntry) => Outcome): void => {
    const e = get(key);
    rows.push({
      id: `7.1/${key}`, area: 'Global tunables (§7.1)', section: e.sec, spec: show(e.value) + unitOf(e) + (e.note ? ` ${e.note}` : ''),
      tag: tagOfConf(e.conf), via, run: () => run(typeof e.value === 'number' ? e.value : NaN, e),
    });
  };
  const fromCfg = (key: string, missing: string, ...paths: string[]): void =>
    rowFor(key, `config \`${paths[0]}\``, (spec) => {
      const c = cfg(t, ...paths);
      return typeof c?.value === 'number' ? cmp(spec, c.value, EXACT) : absent(missing);
    });
  const pair = (key: string, via: string, got: () => [number, number] | undefined, missing: string): void =>
    rowFor(key, via, (_s, e) => {
      const g = got();
      const spec = e.value as number[];
      return g ? { kind: 'measured', value: g.map(fmt).join(' to '), ok: g.every((v, i) => Math.abs(v - spec[i]!) <= EXACT) } : absent(missing);
    });

  rowFor('sim.tick_hz', 'core `TICK_RATE`', (s) => cmp(s, TICK_RATE, EXACT, ' Hz'));
  rowFor('view.vfov_deg', 'core `verticalFovDeg(view.hfovDeg, 16:9)`', (s) => cmp(s, verticalFovDeg(t.view.hfovDeg, REFERENCE_ASPECT), 5e-5, '°'));
  rowFor('view.fov_hor_plus', 'core `horizontalFovDeg` at every §1.1 aspect, vertical FOV held', () => {
    const v = verticalFovDeg(t.view.hfovDeg, REFERENCE_ASPECT);
    let worst = 0;
    for (const a of snap.fovByAspect) worst = Math.max(worst, Math.abs(horizontalFovDeg(v, a.ratio) - a.hfovDeg));
    return { kind: 'measured', value: `largest hFOV error ${fmt(worst)}°`, ok: worst <= 0.01 };
  });
  rowFor('input.yaw_deg_per_count_at_sens1', 'core `degreesPerCount(1)`', (s) => cmp(s, degreesPerCount(1), EXACT, '°'));
  rowFor('input.pitch_deg_per_count_at_sens1', 'core `degreesPerCount(1)` (input applies it to both axes; DOM, not run here)', (s) => cmp(s, degreesPerCount(1), EXACT, '°'));
  rowFor('input.pitch_limit_deg', 'sim: look 100° up, read the player pitch', (s) => cmp(s, M.pitchClampDeg(t), 1e-6, '°'));
  rowFor('input.scoped_fov_model', 'config `scope.fovModel`', (s, e) => {
    const c = cfg(t, 'scope.fovModel');
    return c ? cmpText(String(e.value), String(c.value)) : (void s, absent('no scoped view yet (issue #27)'));
  });
  fromCfg('input.scope_zoom_ads_rifle', 'no ADS zoom yet', 'scope.zoomAdsRifle');
  fromCfg('input.scope_zoom_ads_smg', 'no ADS zoom yet', 'scope.zoomAdsSmg');
  fromCfg('input.scope_zoom_sniper_1', 'no scope yet (sniper is Later, design §6)', 'scope.zoomSniper1');
  fromCfg('input.scope_zoom_sniper_2', 'no scope yet (sniper is Later, design §6)', 'scope.zoomSniper2');
  fromCfg('input.scope_multiplier_default', 'no scoped sensitivity yet (issue #27)', 'scope.multiplierDefault');
  fromCfg('move.run_speed_knife', 'no unarmed state: the player always holds a weapon', 'movement.knifeRunSpeed', 'movement.runSpeedKnife');
  fromCfg('move.walk_fraction', 'no walk fraction', 'movement.walkFraction', 'weaponRules.walkFraction');
  fromCfg('move.crouch_walk_fraction', 'no crouch-walk fraction', 'movement.crouchWalkFraction', 'weaponRules.crouchWalkFraction');
  rowFor('move.accel_time_to_max', `sim: hold forward from rest with ${kestrel}, time to full speed`, (s) => cmp(s, M.accelTimeSec(t, kestrel), TICK_DT, ' s'));
  rowFor('move.brake_decel_high', 'sim: release from full run, braking above 25% of max', (s) => cmp(s, M.brakeRates(stop(), 0.25).high, 0.5, ' m/s²'));
  rowFor('move.brake_decel_low', 'sim: release from full run, braking at or below 25% of max', (s) => cmp(s, M.brakeRates(stop(), 0.25).low, 0.5, ' m/s²'));
  rowFor('move.brake_band_split_fraction', 'sim: speed at which braking softens, one tick resolution', (s) => {
    const f = M.brakeSplitFraction(stop());
    return Number.isNaN(f)
      ? { kind: 'measured', value: 'one braking rate, no band split', ok: false }
      : cmp(s, f, 0.06);
  });
  rowFor('move.stop_time_from_run', 'sim: release from full run, time to a standstill', (s) => cmp(s, M.secs(stop().ticksToZero), TICK_DT, ' s'));
  rowFor('move.deadzone_fraction', 'config `weapon.*.deadzoneFraction` of every non-sniper weapon', (s) => {
    const vals = (Object.keys(t.weapon) as WeaponId[]).filter((id) => !t.weapon[id].archetype.startsWith('sniper')).map((id) => t.weapon[id].deadzoneFraction);
    return { kind: 'measured', value: [...new Set(vals)].map(fmt).join(', '), ok: vals.length > 0 && vals.every((v) => Math.abs(v - s) <= EXACT) };
  });
  rowFor('move.deadzone_fraction_sniper', 'config `weapon.<sniper>.deadzoneFraction`', (s) => {
    const w = weaponFor(t, 'sniper');
    return w ? cmp(s, w.def.deadzoneFraction, EXACT) : absent(notBuilt('sniper'));
  });
  rowFor('move.jump_apex', 'sim: jump from rest, highest feet position', (s) => cmp(s, M.jumpFromRest(t, kestrel).apexM, 0.02, ' m'));
  fromCfg('move.gravity', 'no gravity key', 'movement.gravity');
  rowFor('move.air_accel_fraction', 'sim: sideways acceleration in the air over the same on the ground', (s) => {
    const a = M.accelGroundAndAir(t, kestrel);
    return cmp(s, a.air / a.ground, 0.01);
  });
  fromCfg('move.landing_spread_add', 'no landing spread', 'weaponRules.landingSpreadAddDeg');
  fromCfg('move.landing_spread_duration', 'no landing spread', 'weaponRules.landingSpreadSec');
  rowFor('move.landing_speed_loss', 'sim: horizontal speed before takeoff and after landing, key held', (s) => cmp(s, M.landingSpeedLoss(t, kestrel), 0.01));
  rowFor('body.height_stand', 'sim: player hull height standing', (s) => cmp(s, M.stanceHeights(t, kestrel).standHull, EXACT, ' m'));
  rowFor('body.height_crouch', 'sim: player hull height after crouching', (s) => cmp(s, M.stanceHeights(t, kestrel).crouchHull, EXACT, ' m'));
  fromCfg('body.radius', 'no hull key', 'movement.hullHalfWidth');
  rowFor('body.eye_height_stand', 'sim: eye height standing', (s) => cmp(s, M.stanceHeights(t, kestrel).standEye, EXACT, ' m'));
  rowFor('body.eye_height_crouch', 'sim: eye height after crouching', (s) => cmp(s, M.stanceHeights(t, kestrel).crouchEye, EXACT, ' m'));
  rowFor('body.crouch_transition', 'sim: seconds for the eye to reach the crouched height', (s) => cmp(s, M.stanceHeights(t, kestrel).downSec, TICK_DT, ' s'));
  fromCfg('hit.head_radius', 'no hit-zone config', 'targets.hit.headRadius');
  fromCfg('hit.head_centre_stand', 'no hit-zone config', 'targets.hit.headCentreStand');
  fromCfg('hit.head_centre_crouch', 'no hit-zone config', 'targets.hit.headCentreCrouch');
  pair('hit.torso_range_stand', 'config `targets.hit.torso{Bottom,Top}Stand`', () => [t.targets.hit.torsoBottomStand, t.targets.hit.torsoTopStand], '');
  pair('hit.torso_range_crouch', 'config `targets.hit.torso{Bottom,Top}Crouch`', () => [t.targets.hit.torsoBottomCrouch, t.targets.hit.torsoTopCrouch], '');
  fromCfg('hit.leg_top_stand', 'no hit-zone config', 'targets.hit.legTopStand');
  fromCfg('hit.leg_top_crouch', 'no hit-zone config', 'targets.hit.legTopCrouch');
  rowFor('spread.half_angle', 'sim: 400 seeded stationary first shots, largest deviation from the aim axis', () => {
    const c = M.firstShotCone(t, kestrel);
    return { kind: 'measured', value: `largest ${fmt(c.maxDeg)}° of ${fmt(c.spreadDeg)}°`, ok: c.maxDeg <= c.spreadDeg + 1e-6 && c.maxDeg > 0.9 * c.spreadDeg };
  });
  fromCfg('spread.center_bias_power_still', 'no centre bias', 'weaponRules.centreBiasPowerStill');
  fromCfg('spread.center_bias_power_moving', 'no centre bias', 'weaponRules.centreBiasPowerMoving');
  fromCfg('health.max', 'no health key', 'player.health.max');
  fromCfg('armor.light', 'no armour key', 'player.shield.light');
  fromCfg('armor.heavy', 'no armour key', 'player.shield.heavy');
  fromCfg('armor.absorb_fraction', 'no armour key', 'player.shield.absorb');
  fromCfg('tag.speed_scale', 'no tagging key', 'player.tag.speedScale');
  fromCfg('tag.ramp_in', 'no tagging key', 'player.tag.rampInSec');
  fromCfg('tag.release', 'no tagging key', 'player.tag.releaseSec');
  fromCfg('flinch.pitch_head', 'no flinch key', 'player.flinch.pitchHeadDeg');
  fromCfg('flinch.pitch_body', 'no flinch key', 'player.flinch.pitchBodyDeg');
  fromCfg('flinch.pitch_leg', 'no flinch key', 'player.flinch.pitchLegDeg');
  fromCfg('flinch.recovery', 'no flinch key', 'player.flinch.recoverySec');
  fromCfg('target.speed_slow', 'no target speed tiers', 'dial.strafeSpeed.at0');
  fromCfg('target.speed_medium', 'no target speed tiers', 'enemies.strafer.defaultSpeed');
  fromCfg('target.speed_fast', 'no target speed tiers', 'dial.strafeSpeed.at100');
  rowFor('target.stop_time', 'config `enemies.strafer` braking: time to stop from `brakeRefSpeed`', (s) => {
    const st = t.enemies.strafer;
    const v = st.brakeRefSpeed;
    const split = st.brakeBandFraction * v;
    const sec = (v - split) / st.brakeHigh + split / st.brakeLow;
    return cmp(s, sec, 0.005, ' s');
  });
  return rows;
}

/** §7.2 handling (+ §3.1 reserve and mode), plus the behaviours that measure them. */
function handlingRows(snap: SpecSnapshot, t: Tunables): Rows {
  const rows: Rows = [];
  const knife = Number(snap.global.find((g) => g.key === 'move.run_speed_knife')!.value);
  for (const [arch, spec] of Object.entries(snap.handling)) {
    const w = weaponFor(t, arch);
    const area = 'Weapon handling (§7.2, §3.1)';
    for (const [col, val] of Object.entries(spec)) {
      if (val === null) continue;
      const base = { id: `7.2/${arch}/${col}`, area, section: col === 'reserve' || col === 'mode' ? '3.1' : '7.2' };
      if (col === 'mode') {
        rows.push({ ...base, spec: String(val), tag: HANDLING_TAG, via: 'config `weapon.*.fireMode`', run: () => (w ? cmpText(String(val), w.def.fireMode) : absent(notBuilt(arch))) });
      } else if (col === 'run_mult') {
        rows.push({ ...base, spec: fmt(Number(val)), tag: HANDLING_TAG, via: `config runSpeedMps / ${fmt(knife)} (knife run speed)`, run: () => (w ? cmp(Number(val), w.def.runSpeedMps / knife, 1e-9) : absent(notBuilt(arch))) });
      } else if (col === 'ads_move_mult') {
        rows.push({ ...base, spec: fmt(Number(val)), tag: HANDLING_TAG, via: 'config `weapon.*.adsMoveMult`', run: () => {
          if (!w) return absent(notBuilt(arch));
          const v = (w.def as unknown as Record<string, unknown>)['adsMoveMult'];
          return typeof v === 'number' ? cmp(Number(val), v, EXACT) : absent('no ADS or scoped state yet');
        } });
      } else {
        const key = HANDLING_FIELDS[col];
        if (!key) throw new Error(`conformance: no config field mapped for §7.2 column "${col}"`);
        const tag = col === 'reserve' ? WIKI_TAG : HANDLING_TAG;
        rows.push({ ...base, spec: fmt(Number(val)), tag, via: `config \`weapon.*.${key}\``, run: () => (w ? cmp(Number(val), w.def[key] as number, EXACT) : absent(notBuilt(arch))) });
      }
    }

    // Behaviours: what the sim does with the weapon in hand.
    const bArea = 'Weapon behaviour (§2.1, §2.2, §3.1)';
    const run = Number(spec['run_speed_mps']);
    const speedRow = (what: 'run' | 'walk' | 'crouch', specV: number, tag: Tag): void => {
      rows.push({
        id: `2.1/${arch}/${what}-speed`, area: bArea, section: what === 'run' ? '2.1' : '2.2', spec: `${fmt(specV)} m/s`, tag,
        via: `sim: hold forward${what === 'run' ? '' : what === 'walk' ? ' + walk' : ' + crouch'}, steady speed`,
        run: () => (w ? cmp(specV, M.steadySpeed(t, w.id, what), 1e-3, ' m/s') : absent(notBuilt(arch))),
      });
    };
    speedRow('run', run, HANDLING_TAG);
    const walkF = Number(snap.global.find((g) => g.key === 'move.walk_fraction')!.value);
    const crouchF = Number(snap.global.find((g) => g.key === 'move.crouch_walk_fraction')!.value);
    speedRow('walk', walkF * run, estimate('ESTIMATE 35%'));
    speedRow('crouch', crouchF * run, estimate('ESTIMATE 25%'));
    const mag = Number(spec['mag']);
    const rate = Number(spec['fire_rate_hz']);
    rows.push({
      id: `3.1/${arch}/fire-rate-10s`, area: bArea, section: '3.1', spec: `${fmt(rate)} rounds/s`, tag: HANDLING_TAG,
      via: 'sim: trigger held (semi: clicked) for 10 simulated seconds, endless magazine',
      run: () => {
        if (!w) return absent(notBuilt(arch));
        const r = M.fireRate(t, w.id, 10);
        return { kind: 'measured', value: `${fmt(r.ratePerSec)} rounds/s (${r.shots} shots)`, ok: Math.abs(r.ratePerSec - rate) <= 0.005 * rate };
      },
    });
    rows.push({
      id: `3.1/${arch}/magazine-cycle`, area: bArea, section: '3.1', spec: `${mag} shots, reload ${fmt(Number(spec['reload_s']))} s, reserve ${fmt(Number(spec['reserve']))} - ${mag}`, tag: HANDLING_TAG,
      via: 'sim: empty one magazine, auto-reload',
      run: () => {
        if (!w) return absent(notBuilt(arch));
        const m = M.magazineCycle(t, w.id);
        const ok = m.shotsBeforeReload === mag && Math.abs(m.reloadSec - Number(spec['reload_s'])) <= TICK_DT
          && m.ammoAfter === mag && m.reserveAfter === Number(spec['reserve']) - mag;
        return { kind: 'measured', value: `${m.shotsBeforeReload} shots, reload ${fmt(m.reloadSec)} s, reserve ${m.reserveBefore} - ${m.reserveBefore - m.reserveAfter}`, ok };
      },
    });
    rows.push({
      id: `3.1/${arch}/equip-time`, area: bArea, section: '3.1', spec: `${fmt(Number(spec['equip_s']))} s`, tag: HANDLING_TAG,
      via: 'sim: weapon-swap input to the first shot',
      run: () => (w ? cmp(Number(spec['equip_s']), M.equipSec(t, w.id), TICK_DT, ' s') : absent(notBuilt(arch))),
    });
  }
  return rows;
}

/** §7.3 spread, recovery and movement error, plus the behaviours that measure them. */
function spreadRows(snap: SpecSnapshot, t: Tunables): Rows {
  const rows: Rows = [];
  for (const [arch, spec] of Object.entries(snap.spread)) {
    const base = arch.replace(/_(un)?scoped$/, '');
    const scoped = arch === 'sniper_scoped';
    const w = weaponFor(t, base);
    for (const [col, val] of Object.entries(spec as ArchetypeRow)) {
      if (val === null) continue;
      const key = SPREAD_FIELDS[col];
      if (!key) throw new Error(`conformance: no config field mapped for §7.3 column "${col}"`);
      rows.push({
        id: `7.3/${arch}/${col}`, area: 'Spread, recovery, movement error (§7.3)', section: '7.3', spec: fmt(Number(val)), tag: spreadTag(arch, col),
        via: `config \`weapon.*.${key}\``,
        run: () => {
          if (!w) return absent(notBuilt(base));
          if (scoped) return absent('no scoped state yet (sniper is Later, design §6)');
          return cmp(Number(val), w.def[key] as number, EXACT);
        },
      });
    }
    if (scoped) continue;
    const first = Number(spec['spread_first_deg']);
    const crouchMult = spec['crouch_mult'];
    const bArea = 'Spread behaviour (§3.3, §3.4)';
    rows.push({
      id: `3.3/${arch}/first-shot`, area: bArea, section: '3.3', spec: `${fmt(first)}°` + (crouchMult !== null ? `, crouched ${fmt(first * Number(crouchMult))}°` : ''), tag: HANDLING_TAG,
      via: 'sim: first shot of a settled player, standing and crouched',
      run: () => {
        if (!w) return absent(notBuilt(base));
        const stand = M.firstShotSpreadDeg(t, w.id, false);
        const crouch = M.firstShotSpreadDeg(t, w.id, true);
        const wantCrouch = crouchMult !== null ? first * Number(crouchMult) : first;
        return { kind: 'measured', value: `${fmt(stand)}°, crouched ${fmt(crouch)}°`, ok: Math.abs(stand - first) <= 1e-9 && Math.abs(crouch - wantCrouch) <= 1e-9 };
      },
    });
    if (crouchMult === null) continue; // sniper: no spray model
    const max = Number(spec['spread_max_deg']), ramp = Number(spec['n_ramp']), tap = Number(spec['tap_eff']);
    rows.push({
      id: `3.3/${arch}/spray-growth`, area: bArea, section: '3.3', spec: `first ${fmt(first)}° growing to ${fmt(max)}° over ${ramp} bullets (model of §3.3)`, tag: estimate('ESTIMATE 40%'),
      via: 'sim: 12 held shots, spread of each against the §3.3 model',
      run: () => {
        if (!w) return absent(notBuilt(base));
        const sim = createSim({ weapon: w.id, infiniteMagazine: true });
        const sprayTicks = ticksOf(2);
        const pull = M.trigger(sim, w.id);
        for (let k = 0; k < sprayTicks && sim.rec.shots.length < 12; k++) sim.tick({ fire: pull() });
        const want = sprayModel(first, max, ramp, tap, 12);
        let worst = 0;
        sim.rec.shots.slice(0, 12).forEach((s, i) => (worst = Math.max(worst, Math.abs(s.spreadDeg - want[i]!))));
        return { kind: 'measured', value: `largest difference ${fmt(worst)}° over ${sim.rec.shots.length} shots`, ok: sim.rec.shots.length === 12 && worst <= 1e-6 };
      },
    });
    const recovery = Number(spec['recovery_s']);
    rows.push({
      id: `3.3/${arch}/recovery-reset`, area: bArea, section: '3.3', spec: `full reset after ${fmt(recovery)} s`, tag: spreadTag(arch, 'recovery_s'),
      via: 'sim: two shots a gap apart, shortest gap whose second shot is back at the first-shot spread',
      run: () => {
        if (!w) return absent(notBuilt(base));
        let found = Infinity;
        for (let gap = 1; gap <= ticksOf(1); gap++) {
          const sim = createSim({ weapon: w.id });
          sim.tick({ fire: true });
          sim.run(gap - 1);
          sim.tick({ fire: true });
          const second = sim.rec.shots[1];
          if (second && Math.abs(second.spreadDeg - first) <= 1e-9) {
            found = M.secs(gap);
            break;
          }
        }
        return cmp(recovery, found, TICK_DT, ' s');
      },
    });
    for (const [state, col] of [['crouch-walk', 'err_crouchmove_deg'], ['walk', 'err_walk_deg'], ['run', 'err_run_deg'], ['air', 'err_air_deg']] as const) {
      const add = Number(spec[col]);
      rows.push({
        id: `3.4/${arch}/${state}-error`, area: bArea, section: '3.4', spec: `+${fmt(add)}°`, tag: spreadTag(arch, col),
        via: `sim: first shot while ${state === 'air' ? 'airborne' : state === 'run' ? 'running at full speed' : `${state}ing at steady speed`}, spread over the stationary first shot`,
        run: () => {
          if (!w) return absent(notBuilt(base));
          const sim = createSim({ weapon: w.id });
          const crouching = state === 'crouch-walk';
          if (state === 'air') {
            sim.tick({ jump: true });
            sim.run(ticksOf(0.1));
          } else {
            sim.run(ticksOf(3), { moveZ: 1, walk: state === 'walk', crouch: crouching });
          }
          sim.tick({ fire: true, moveZ: state === 'air' ? 0 : 1, walk: state === 'walk', crouch: crouching });
          const shot = sim.rec.shots[0]!;
          const stationary = first * (crouching ? Number(crouchMult) : 1);
          return cmp(add, shot.spreadDeg - stationary, 1e-6, '°');
        },
      });
    }
    rows.push({
      id: `2.4/${arch}/deadzone-gate`, area: bArea, section: '2.4', spec: `shots at or below ${fmt(Number(spec['deadzone']) * 100)}% of ${fmt(Number(snap.handling[base]!['run_speed_mps']))} m/s are accurate`, tag: spreadTag(arch, 'deadzone'),
      via: 'sim: shot on each tick of a release from full run; moving flag against speed',
      run: () => {
        if (!w) return absent(notBuilt(base));
        const sweep = M.stopShotSweep(t, w.id);
        const limit = Number(spec['deadzone']) * Number(snap.handling[base]!['run_speed_mps']);
        const still = sweep.filter((s) => !s.moving).map((s) => s.speed);
        const moving = sweep.filter((s) => s.moving).map((s) => s.speed);
        const lo = Math.max(...still), hi = Math.min(...moving);
        return { kind: 'measured', value: `accurate up to ${fmt(lo)} m/s, inaccurate from ${fmt(hi)} m/s`, ok: lo <= limit + 1e-9 && hi > limit - 1e-9 };
      },
    });
  }
  return rows;
}

const ZONES: HitZone[] = ['head', 'body', 'leg'];

/** §7.4 damage bands (config upper bound; damage dealt by the sim per zone) and penetration class. */
function damageRows(snap: SpecSnapshot, t: Tunables): Rows {
  const rows: Rows = [];
  const area = 'Damage by range band and zone (§7.4, §3.2)';
  for (const [arch, bands] of Object.entries(snap.damage)) {
    const w = weaponFor(t, arch);
    bands.forEach((band, i) => {
      const lower = i === 0 ? 0 : bands[i - 1]!.upToM;
      rows.push({
        id: `7.4/${arch}/band${i + 1}/up-to`, area, section: '7.4', spec: `${fmt(band.upToM)} m`, tag: HANDLING_TAG, via: `config \`weapon.*.damageBands[${i}].upToM\``,
        run: () => {
          if (!w) return absent(notBuilt(arch));
          const b = w.def.damageBands[i];
          return b ? cmp(band.upToM, b.upToM, EXACT, ' m') : { kind: 'measured', value: 'no such band', ok: false };
        },
      });
      // Probe inside the band (mid-point, but not past 50 m, where the sim's spec bands end).
      const mid = (lower + band.upToM) / 2;
      for (const zone of ZONES) {
        rows.push({
          id: `7.4/${arch}/band${i + 1}/${zone}`, area, section: '3.2', spec: `${fmt(band[zone])} at ${fmt(lower)}-${fmt(band.upToM)} m`, tag: HANDLING_TAG,
          via: `sim: one bullet at the ${zone} of a Post ${fmt(mid)} m away`,
          run: () => {
            if (!w) return absent(notBuilt(arch));
            const r = M.probeDamage(t, w.id, zone, mid);
            return { kind: 'measured', value: `${fmt(r.damage)} (${r.zone ?? 'miss'})`, ok: r.zone === zone && Math.abs(r.damage - band[zone]) <= 1e-6 };
          },
        });
      }
    });
    const last = bands[bands.length - 1]!;
    rows.push({
      id: `7.4/${arch}/beyond-last-band`, area, section: '3.2', spec: `${fmt(last.body)} body beyond ${fmt(last.upToM)} m (last band holds)`, tag: HANDLING_TAG,
      via: 'sim: one body bullet 80 m away',
      run: () => {
        if (!w) return absent(notBuilt(arch));
        const r = M.probeDamage(t, w.id, 'body', 80);
        return { kind: 'measured', value: `${fmt(r.damage)} (${r.zone ?? 'miss'})`, ok: r.zone === 'body' && Math.abs(r.damage - last.body) <= 1e-6 };
      },
    });
    const letter = snap.penetration[arch];
    const name = letter === 'L' ? 'low' : letter === 'M' ? 'medium' : 'high';
    rows.push({
      id: `7.4/${arch}/penetration`, area, section: '7.4', spec: name, tag: HANDLING_TAG, via: 'config `weapon.*.penetration`',
      run: () => (w ? cmpText(name, w.def.penetration) : absent(notBuilt(arch))),
    });
  }

  // §6: bullets to kill, measured on a Post with a shield, every zone and band.
  for (const row of snap.ttk) {
    const w = weaponFor(t, row.archetype);
    const mid = (row.fromM + row.toM) / 2;
    rows.push({
      id: `6/${row.archetype}/${row.fromM}-${row.toM}m/${row.zone}`, area: 'Bullets to kill (§6)', section: '6', spec: row.bullets.join(' / '), tag: sourced('DERIVED'),
      via: `sim: bullets into a Post's ${row.zone} at ${fmt(mid)} m until it dies, shield 0 / 25 / 50`,
      run: () => {
        if (!w) return absent(notBuilt(row.archetype));
        const got = [0, 25, 50].map((s) => M.bulletsToKillEcho(t, w.id, row.zone, mid, s));
        return { kind: 'measured', value: got.join(' / '), ok: got.every((g, i) => g === row.bullets[i]) };
      },
    });
  }
  return rows;
}

/** View, sensitivity, timing, and the spec literals outside §7 that the behaviours need. */
function otherRows(snap: SpecSnapshot, t: Tunables): Rows {
  const rows: Rows = [];
  const area = 'View, input and timing (§1)';
  for (const a of snap.fovByAspect) {
    rows.push({
      id: `1.1/hfov/${a.aspect.replace(/\s+/g, '')}`, area, section: '1.1', spec: `${fmt(a.hfovDeg)}°`, tag: a.ratio === REFERENCE_ASPECT ? sourced('COMMUNITY') : estimate('ESTIMATE 30-55%'),
      via: 'core: horizontalFovDeg at the fixed vertical FOV',
      run: () => cmp(a.hfovDeg, horizontalFovDeg(verticalFovDeg(t.view.hfovDeg, REFERENCE_ASPECT), a.ratio), 0.005, '°'),
    });
  }
  const sens: [string, number, number, number][] = [
    ['800 DPI at sensitivity 0.5', 0.5, 800, 32.66],
    ['800 DPI at sensitivity 0.4', 0.4, 800, 40.82],
    ['1600 DPI at sensitivity 0.2', 0.2, 1600, 40.82],
  ];
  for (const [label, s, dpi, cm] of sens) {
    rows.push({
      id: `1.2/cm360/${dpi}dpi-sens${s}`, area, section: '1.2', spec: `${fmt(cm)} cm/360 (${label})`, tag: sourced('COMMUNITY'), via: 'core `cmPer360`',
      run: () => cmp(cm, cmPer360(s, dpi), 0.005, ' cm'),
    });
  }
  rows.push({
    id: '1.2/cm360/formula', area, section: '1.2', spec: '13062.86 / (DPI × sens)', tag: sourced('COMMUNITY'), via: 'core `cmPer360` at 400 DPI, sensitivity 1.5',
    run: () => cmp(13062.86 / (400 * 1.5), cmPer360(1.5, 400), 1e-3, ' cm'),
  });
  rows.push({
    id: '1.4/stepper-128hz', area, section: '1.4', spec: '128 sim ticks per real second', tag: sourced('OFFICIAL'), via: 'core `FixedStepper(TICK_DT)`: ticks run for 1 s of frames',
    run: () => {
      const s = new FixedStepper(TICK_DT, 1000);
      let ticks = 0;
      for (let i = 0; i < 4; i++) ticks += s.advance(0.25);
      return cmp(128, ticks, 0, ' ticks');
    },
  });
  rows.push({
    id: '1.4/sim-clock', area, section: '1.4', spec: '1 s of sim time after 128 ticks', tag: sourced('OFFICIAL'), via: 'sim: step 128 ticks, read the world clock',
    run: () => {
      const sim = createSim({ settle: false });
      sim.run(128);
      return cmp(1, sim.world.time, EXACT, ' s');
    },
  });

  // §2.5: the time to an accurate shot after stopping.
  const stopArea = 'Stopping and shot accuracy (§2.3, §2.5)';
  for (const arch of Object.keys(snap.handling)) {
    const w = weaponFor(t, arch);
    const sniper = arch === 'sniper';
    const want = sniper ? 0.13 : 0.1;
    const tag = estimate(sniper ? 'ESTIMATE 40%' : 'ESTIMATE 60%');
    rows.push({
      id: `2.5/${arch}/first-accurate-shot`, area: stopArea, section: '2.5', spec: `about ${fmt(want)} s after the stopping input (0.090-0.110)`, tag,
      via: 'sim: from full run release, first tick on which a shot carries no movement error',
      run: () => {
        if (!w) return absent(notBuilt(arch));
        const sweep = M.stopShotSweep(t, w.id);
        const first = sweep.find((s) => s.errorDeg <= 1e-9);
        if (!first) return { kind: 'measured', value: 'never within 0.3 s', ok: false };
        const sec = M.secs(first.ticks);
        return { kind: 'measured', value: `${fmt(sec)} s (tick ${first.ticks})`, ok: sniper ? Math.abs(sec - want) <= 0.02 : sec >= 0.09 - 1e-9 && sec <= 0.11 + 1e-9 };
      },
    });
    rows.push({
      id: `2.5/${arch}/shot-error-zero-at-${want === 0.1 ? '0.100' : '0.130'}s`, area: stopArea, section: '2.5', spec: `shot error zero on the tick nearest ${fmt(want)} s (± 0.01 s) and every tick after`, tag,
      via: `sim: shots on every released tick from the one nearest ${fmt(want)} s to 0.3 s`,
      run: () => {
        if (!w) return absent(notBuilt(arch));
        const from = Math.round(want / TICK_DT);
        const late = M.stopShotSweep(t, w.id).filter((s) => s.ticks >= from);
        const worst = Math.max(...late.map((s) => s.errorDeg));
        return { kind: 'measured', value: `largest error ${fmt(worst)}° from tick ${from} (${fmt(M.secs(from))} s) on`, ok: worst <= 1e-9 };
      },
    });
    rows.push({
      id: `2.3/${arch}/stop-time`, area: stopArea, section: '2.3', spec: '0.16 s from full run, every weapon', tag: sourced('OFFICIAL (2020 data)'),
      via: 'sim: release from full run, time to a standstill',
      run: () => (w ? cmp(0.16, M.secs(M.stopTrace(t, w.id, 'release').ticksToZero), TICK_DT, ' s') : absent(notBuilt(arch))),
    });
  }
  rows.push({
    id: '2.3/counter-strafe-equals-release', area: stopArea, section: '2.3', spec: 'opposite key stops on the same tick as letting go (no bonus)', tag: estimate('ESTIMATE 45%'),
    via: 'sim: release against opposite key from full run, tick the forward speed reaches zero',
    run: () => {
      const id = weaponFor(t, 'rifle_spray')?.id ?? 'kestrel';
      const a = M.stopTrace(t, id, 'release').ticksToZero, b = M.stopTrace(t, id, 'counter').ticksToZero;
      return { kind: 'measured', value: `release ${a} ticks, counter-strafe ${b} ticks`, ok: a === b };
    },
  });
  rows.push({
    id: '2.6/air-speed-kept', area: 'Jumping (§2.6)', section: '2.6', spec: 'horizontal speed preserved from takeoff', tag: estimate('ESTIMATE 55%'),
    via: 'sim: running jump, keys released at takeoff, speed just before landing',
    run: () => {
      const a = M.airSpeedKept(t, 'kestrel');
      return { kind: 'measured', value: `${fmt(a.takeoff)} m/s at takeoff, ${fmt(a.beforeLanding)} m/s before landing`, ok: Math.abs(a.takeoff - a.beforeLanding) <= 0.05 };
    },
  });
  rows.push({
    id: '2.6/bunny-hop-no-gain', area: 'Jumping (§2.6)', section: '2.6', spec: 'no speed gain from bunny-hopping', tag: estimate('ESTIMATE 65%'),
    via: 'sim: 4 s of continuous jumping, forward held, top speed over run speed',
    run: () => {
      const h = M.bunnyHopTopSpeed(t, 'kestrel');
      return { kind: 'measured', value: `top ${fmt(h.hop)} m/s, run ${fmt(h.run)} m/s`, ok: h.hop <= h.run + 1e-6 };
    },
  });
  rows.push({
    id: '2.6/airtime', area: 'Jumping (§2.6)', section: '2.6', spec: '0.63 s on flat ground', tag: sourced('DERIVED'), via: 'sim: jump from rest, ticks until grounded',
    run: () => cmp(0.63, M.jumpFromRest(t, 'kestrel').airSec, 2 * TICK_DT, ' s'),
  });
  rows.push({
    id: '2.6/takeoff-speed', area: 'Jumping (§2.6)', section: '2.6', spec: '6.32 m/s upward', tag: sourced('DERIVED'), via: 'sim: 4 × apex / air time of a jump from rest (the spec\'s measuring recipe)',
    run: () => cmp(6.32, M.jumpFromRest(t, 'kestrel').takeoffSpeed, 0.1, ' m/s'),
  });
  rows.push({
    id: '2.6/landing-spread', area: 'Jumping (§2.6)', section: '2.6', spec: '+7.0° for 0.225 s after landing', tag: sourced('OFFICIAL (PN 1.09)'),
    via: 'sim: shot on each tick after landing, spread over the stationary first shot',
    run: () => {
      const extra: number[] = [];
      for (let k = 1; k <= 40; k++) {
        const sim = createSim({ weapon: 'kestrel' });
        sim.tick({ jump: true });
        for (let n = 0; n < ticksOf(2) && !sim.world.player.grounded; n++) sim.tick();
        sim.run(k - 1);
        sim.tick({ fire: true });
        extra.push(sim.rec.shots[0]!.spreadDeg - t.weapon.kestrel.spreadFirstDeg);
      }
      const on = extra.filter((e) => e > 1).length;
      return { kind: 'measured', value: `+${fmt(Math.max(...extra))}° for ${fmt(M.secs(on))} s`, ok: Math.abs(Math.max(...extra) - 7) <= 1e-6 && Math.abs(M.secs(on) - 0.225) <= TICK_DT };
    },
  });
  rows.push({
    id: '2.7/step-height', area: 'Body (§2.7)', section: '2.7', spec: '0.35 m', tag: placeholder('PLACEHOLDER'), via: 'config `movement.stepHeight`',
    run: () => cmp(0.35, t.movement.stepHeight, EXACT, ' m'),
  });
  rows.push({
    id: '2.7/max-ramp-slope', area: 'Body (§2.7)', section: '2.7', spec: '45°', tag: placeholder('PLACEHOLDER'), via: 'config `movement.maxWalkableSlopeDeg`',
    run: () => cmp(45, t.movement.maxWalkableSlopeDeg, EXACT, '°'),
  });
  for (const crouched of [false, true]) {
    const h = snap.global;
    const g = (k: string): SpecValue => h.find((e) => e.key === k)!.value;
    const range = g(`hit.torso_range_${crouched ? 'crouch' : 'stand'}`) as number[];
    const legTop = g(`hit.leg_top_${crouched ? 'crouch' : 'stand'}`) as number;
    const headTop = (g(`hit.head_centre_${crouched ? 'crouch' : 'stand'}`) as number) + Number(g('hit.head_radius'));
    rows.push({
      id: `5.1/zone-boundaries-${crouched ? 'crouched' : 'standing'}`, area: 'Hit zones (§5.1)', section: '5.1',
      spec: `legs to ${fmt(legTop)} m, body to ${fmt(range[1]!)} m, head to ${fmt(headTop)} m`, tag: estimate('ESTIMATE 30%'),
      via: 'sim: a vertical line of shots through a Post 50 m away, 1 cm apart',
      run: () => {
        const z = M.zoneBoundaries(t, crouched);
        const ok = Math.abs(z.legTop - legTop) <= 0.015 && Math.abs(z.torsoTop - range[1]!) <= 0.015 && Math.abs(z.headTop - headTop) <= 0.015;
        return { kind: 'measured', value: `legs to ${fmt(z.legTop)} m, body to ${fmt(z.torsoTop)} m, head ${fmt(z.headBottom)}-${fmt(z.headTop)} m`, ok };
      },
    });
  }

  // §4.3 tagging and §4.4 flinch, measured on the player.
  const tagArea = 'Taking damage (§4.3, §4.4)';
  const g = (k: string): number => Number(snap.global.find((e) => e.key === k)!.value);
  rows.push({
    id: '4.3/tag-ramp-in', area: tagArea, section: '4.3', spec: `${fmt(g('tag.ramp_in'))} s to the full slow`, tag: placeholder('PLACEHOLDER'),
    via: 'sim: one hit on a running player, ticks until the tag multiplier reaches its floor',
    run: () => {
      const tr = M.tagAfterHit(t, 'kestrel');
      const k = tr.scale.findIndex((s) => s <= g('tag.speed_scale') + TAG_FLOOR_TOL);
      return cmp(g('tag.ramp_in'), k < 0 ? Infinity : M.secs(k + 1), TICK_DT, ' s');
    },
  });
  rows.push({
    id: '4.3/tag-speed-cap', area: tagArea, section: '4.3', spec: `speed ${fmt(g('tag.speed_scale'))} × max while tagged`, tag: sourced('OFFICIAL 70% (PN 3.0)'),
    via: 'sim: running Kestrel player, one hit, speed over max once the slow is full',
    run: () => {
      const tr = M.tagAfterHit(t, 'kestrel');
      return cmp(g('tag.speed_scale'), Math.min(...tr.speed) / tr.fullSpeed, TAG_FLOOR_TOL);
    },
  });
  for (const arch of ['pistol_accurate', 'smg']) {
    const w = weaponFor(t, arch);
    rows.push({
      id: `4.3/tag-speed-cap-${arch}`, area: tagArea, section: '4.3', spec: `speed ${fmt(g('tag.speed_scale'))} × the equipped weapon's max`, tag: sourced('OFFICIAL 70% (PN 3.0)'),
      via: 'sim: running player, one hit, speed over the equipped weapon\'s run speed',
      run: () => {
        if (!w) return absent(notBuilt(arch));
        const tr = M.tagAfterHit(t, w.id);
        return cmp(g('tag.speed_scale'), Math.min(...tr.speed) / w.def.runSpeedMps, TAG_FLOOR_TOL);
      },
    });
  }
  rows.push({
    id: '4.3/tag-release', area: tagArea, section: '4.3', spec: `${fmt(g('tag.release'))} s from the last hit, smooth`, tag: estimate('ESTIMATE 30%'),
    via: 'sim: one hit, ticks from the hit until the tag multiplier is back at 1',
    run: () => {
      const tr = M.tagAfterHit(t, 'kestrel', 1.5);
      const k = tr.scale.findIndex((s) => s >= 1 - 1e-9);
      return cmp(g('tag.release'), k < 0 ? Infinity : M.secs(k + 1), TICK_DT, ' s');
    },
  });
  rows.push({
    id: '4.3/tag-hold-while-hit', area: tagArea, section: '4.3', spec: 'held at the full slow while hits keep coming (a hit every 0.2 s)', tag: estimate('ESTIMATE 30%'),
    via: 'sim: hits every 0.2 s for 1.5 s, highest tag multiplier after the ramp',
    run: () => {
      const tr = M.tagAfterHit(t, 'kestrel', 1.5, ticksOf(0.2));
      const after = tr.scale.slice(ticksOf(0.15));
      const worst = Math.max(...after);
      return { kind: 'measured', value: `multiplier rises to ${fmt(worst)} between hits`, ok: worst <= g('tag.speed_scale') + TAG_FLOOR_TOL };
    },
  });
  for (const zone of ZONES) {
    const key = `flinch.pitch_${zone}`;
    rows.push({
      id: `4.4/flinch-${zone}`, area: tagArea, section: '4.4', spec: `${fmt(g(key))}° kick, recovering over ${fmt(g('flinch.recovery'))} s`, tag: placeholder('PLACEHOLDER'),
      via: 'sim: one hit to the zone, the aim punch next tick and the seconds until it is gone',
      run: () => {
        const f = M.flinchOf(t, zone);
        return { kind: 'measured', value: `${fmt(f.kickDeg)}°, gone after ${fmt(f.recoverySec)} s`, ok: Math.abs(f.kickDeg - g(key)) <= 0.05 && Math.abs(f.recoverySec - g('flinch.recovery')) <= 2 * TICK_DT };
      },
    });
  }
  rows.push({
    id: '3.6/tracer-life', area: 'Tracers (§3.6)', section: '3.6', spec: '0.06 s', tag: placeholder('PLACEHOLDER'), via: 'config `feedback.tracer.lifeSec`',
    run: () => {
      const c = cfg(t, 'feedback.tracer.lifeSec');
      return typeof c?.value === 'number' ? cmp(0.06, c.value, EXACT, ' s') : absent('no tracer config');
    },
  });
  return rows;
}

/** All conformance rows, in the order of the table. Deterministic: no clocks, no randomness outside seeded sims. */
export function buildRows(snap: SpecSnapshot, t: Tunables): RowDef[] {
  return [...otherRows(snap, t), ...globalRows(snap, t), ...handlingRows(snap, t), ...spreadRows(snap, t), ...damageRows(snap, t)];
}

/** Archetypes the table covers, for the sections of the table. */
export function archetypes(snap: SpecSnapshot): string[] {
  return Object.keys(snap.handling);
}
