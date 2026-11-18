import { defineFeature } from '../app/feature';
import { RAD2DEG } from '../core/math';
import { Rng } from '../core/rng';
import { fsmGoto } from '../sim/fsm';
import { MIND_STATE_NAMES, mindBehaviour, type MindStateName } from '../sim/mind/decision';
import { createMindProfile, profileFor } from '../sim/mind/profile';
import type { MindStats } from '../sim/mind/state';
import type { TargetState } from '../sim/types';

/** What the debug hook reports about one mind-driven Echo (degrees, metres, seconds). */
export interface MindReport {
  id: number;
  kind: string;
  state: MindStateName;
  skill: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  yawDeg: number;
  pitchDeg: number;
  crouching: boolean;
  hp: number;
  mag: number;
  reloading: boolean;
  sees: boolean;
  contact: string;
  aimErrDeg: number;
  moving: boolean;
  waypoints: number;
  stats: MindStats;
}

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The enemy mind's profile (#88) for a mind skill 0-100 and an enemy serial, as plain numbers: the
     * anchor table interpolated, the serial's personality jitter, floors applied. A probe for playtests and tuning.
     */
    mindProfile(mindSkill: number, serial?: number): Record<string, number>;
    /**
     * Every mind-driven Echo (#91; spawn one with `spawn('strafer', pos, { mind: { skill, watch, spots, fire } })`):
     * its decision state, body, gun, what it perceives and its counters (shots above the gate, legs, re-peeks, unsticks).
     */
    minds(): MindReport[];
    /** Force a mind-driven Echo into a decision state (playtests, screenshots); returns false for an unknown id or state. */
    mindState(id: number, state: MindStateName): boolean;
    /** Load a map by id outside any mode (its boxes, nav graph and look), for mind playtests on real geometry; false for an unknown id. */
    loadMap(id: string): boolean;
  }
}

function report(t: TargetState): MindReport {
  const m = t.mind;
  const k = t.body.kin;
  const s = m.stats;
  return {
    id: t.id, kind: t.kind, state: MIND_STATE_NAMES[t.fsm.state]!, skill: m.profile.mindSkill,
    x: k.pos.x, y: k.pos.y, z: k.pos.z, speed: Math.hypot(k.vel.x, k.vel.z), yawDeg: k.yaw * RAD2DEG, pitchDeg: k.pitch * RAD2DEG,
    crouching: k.crouching, hp: t.hp, mag: t.body.weapon.slots[0]!.mag, reloading: t.body.weapon.reloadLeft > 0,
    sees: m.perceiver?.sees ?? false, contact: m.contact, aimErrDeg: m.aimErr * RAD2DEG, moving: m.moving, waypoints: m.wpN,
    stats: {
      shots: s.shots, movingShots: s.movingShots, bursts: s.bursts, movingBursts: s.movingBursts, legs: s.legs, crouches: s.crouches, repeeks: s.repeeks,
      repeekSameWay: s.repeekSameWay, unsticks: s.unsticks,
    },
  };
}

/** Debug probes for the enemy mind: profiles (#88) and the decision FSM (#91). */
export const feature = defineFeature({
  id: 'mind',
  stage: 'tools',
  setup(game) {
    const scratch = createMindProfile();
    const each = (fn: (t: TargetState) => void): void => {
      const slots = game.world.targets;
      for (let i = 0; i < slots.length; i++) if (slots[i]!.alive && slots[i]!.mind.active) fn(slots[i]!);
    };
    game.addOverlayLines(() => {
      let n = 0;
      const counts: Record<string, number> = {};
      each((t) => {
        n++;
        const s = MIND_STATE_NAMES[t.fsm.state]!;
        counts[s] = (counts[s] ?? 0) + 1;
      });
      if (n === 0) return '';
      return `minds ${n} · ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`;
    });
    game.addSnapshot('minds', () => {
      const out: MindReport[] = [];
      each((t) => out.push(report(t)));
      return out;
    });
    game.addDebug({
      mindProfile(mindSkill, serial = 1) {
        // Probe-only stream: the real per-enemy streams are `(runSeed, serial, stream)` hashes (#86).
        profileFor(mindSkill, new Rng((Math.imul(serial, 0x9e3779b1) ^ 0x6d1d) >>> 0), scratch, game.tunables);
        return { ...scratch };
      },
      minds() {
        const out: MindReport[] = [];
        each((t) => out.push(report(t)));
        return out;
      },
      loadMap(id) {
        const ok = game.modes.loadMap(id);
        if (ok) game.renderNow();
        return ok;
      },
      mindState(id, state) {
        const t = game.world.targetField.byId(id);
        const i = MIND_STATE_NAMES.indexOf(state);
        if (!t || !t.mind.active || i < 0) return false;
        const w = game.world;
        fsmGoto(mindBehaviour, t, { tick: w.tick, rng: w.rng, tunables: w.tunables, events: game.bus, world: w }, i);
        return true;
      },
    });
  },
});
