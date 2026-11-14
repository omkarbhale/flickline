import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { secondsToTicks, TICK_DT } from '../core/time';
import { vec3 } from '../core/vec3';
import { cloneTunables } from '../config/tunables';
import type { TargetState } from '../sim/types';
import { createFightPaceStats, FightPace, type FightPaceEvents, type FightPaceWorld } from './fightPace';

const T = cloneTunables();

/** A world of one Echo slot the test moves and hides by hand; the player stands at the origin. */
function stubWorld(): { world: FightPaceWorld; echo: TargetState; sight: { open: boolean } } {
  const sight = { open: false };
  const echo = { id: 7, alive: false, pos: vec3(20, 0, 0), prevPos: vec3(20, 0, 0) } as unknown as TargetState;
  const world = {
    tick: 0,
    player: { pos: vec3(0, 0, 0), eyeHeight: 1.62 },
    targetField: { slots: [echo], hasLineOfSightFrom: () => sight.open },
    boxes: [],
  } as unknown as FightPaceWorld;
  return { world, echo, sight };
}

/** A tracker on a fresh bus, and a clock that ticks it like the game does. */
function rig() {
  const bus = new EventBus<FightPaceEvents>();
  const { world, echo, sight } = stubWorld();
  const pace = new FightPace(bus, world, T);
  const w = world as { tick: number };
  const run = (sec: number): void => {
    const end = w.tick + secondsToTicks(sec);
    while (w.tick < end) {
      w.tick++;
      pace.tick();
    }
  };
  const at = (): { tick: number } => ({ tick: w.tick });
  return { bus, pace, echo, sight, run, at, read: () => pace.read(createFightPaceStats()) };
}

/** Within one sight sample and a tick of `b` (sight and running steps are sampled every `fightPace.sampleSec`). */
const near = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(T.fightPace.sampleSec + 0.01);

describe('fight pace (#248)', () => {
  it('counts fought contacts per live minute; an avoided contact is not a fight', () => {
    const r = rig();
    r.bus.emit('runStarted', r.at());
    r.bus.emit('sectorEntered', r.at());
    r.run(10);
    r.bus.emit('contactSettled', { ...r.at(), outcome: 'cleared' });
    r.bus.emit('contactSettled', { ...r.at(), outcome: 'avoided' });
    r.run(10);
    r.bus.emit('contactSettled', { ...r.at(), outcome: 'disengaged' });
    r.bus.emit('targetKilled', r.at());
    r.run(10);
    r.bus.emit('runEnded', { ...r.at(), reason: 'death' });
    r.run(5); // after the end nothing counts
    const s = r.read();
    near(s.liveSec, 30);
    expect(s.fights).toBe(2);
    expect(s.avoided).toBe(1);
    expect(s.deaths).toBe(1);
    near(s.fightsPerMin, 4);
    near(s.duelsPerMin, 4);
  });

  it('dead air is the longest stretch inside a sector with nothing seen, heard or shooting; gates are timed apart', () => {
    const r = rig();
    r.bus.emit('runStarted', r.at());
    r.bus.emit('sectorEntered', r.at());
    r.run(4);
    r.bus.emit('enemyFired', { ...r.at(), hit: false, audibleToPlayer: true }); // heard: 4 s of dead air
    r.run(2);
    r.bus.emit('enemyFired', { ...r.at(), hit: false, audibleToPlayer: false }); // too far to hear, missed: still dead air
    r.run(16);
    r.bus.emit('sectorEnded', r.at()); // 18 s since the shot heard
    r.bus.emit('gateEntered', r.at());
    r.run(30); // a long gate is not dead air
    r.bus.emit('sectorEntered', r.at());
    r.run(3);
    r.bus.emit('targetVisible', r.at());
    r.run(1);
    r.bus.emit('runEnded', { ...r.at(), reason: 'left' });
    const s = r.read();
    near(s.deadAirMaxSec, 18);
    expect(s.deadAirOver).toBe(1);
    expect(s.sectors).toBe(2);
    near(s.sectorSec, 26);
    expect(s.gates).toBe(1);
    near(s.gateMaxSec, 30);
  });

  it('an Echo in an open line, or running within footstep range, ends the dead air at the next sample', () => {
    const r = rig();
    r.bus.emit('runStarted', r.at());
    r.bus.emit('sectorEntered', r.at());
    r.echo.alive = true;
    r.run(5);
    r.sight.open = true; // seen
    r.run(1);
    r.sight.open = false;
    near(r.read().deadAirMaxSec, 5);
    // Running towards the player (one step per tick above the silent walk speed), 20 m away: heard.
    r.run(8);
    const step = (T.audio.enemy.silentBelowMps + 1) * TICK_DT;
    r.echo.prevPos.x = r.echo.pos.x + step;
    r.run(1);
    near(r.read().deadAirMaxSec, 8);
    // The same run beyond the footstep radius is silent: the stretch keeps growing.
    r.echo.pos.x = r.echo.prevPos.x = T.attribution.soundRadiusM.footstep + 5;
    r.echo.prevPos.x += step;
    r.run(10);
    near(r.read().deadAirMaxSec, 10);
    // A walk is silent too.
    r.echo.pos.x = r.echo.prevPos.x = 10;
    r.echo.prevPos.x += (T.audio.enemy.silentBelowMps - 0.5) * TICK_DT;
    r.run(2);
    near(r.read().deadAirMaxSec, 12);
  });

  it('a new run starts from zero, and an open stretch counts while it runs', () => {
    const r = rig();
    r.bus.emit('runStarted', r.at());
    r.bus.emit('sectorEntered', r.at());
    r.bus.emit('contactSettled', { ...r.at(), outcome: 'died' });
    r.run(20);
    near(r.read().deadAirMaxSec, 20);
    r.bus.emit('runStarted', r.at());
    const s = r.read();
    expect(s.fights).toBe(0);
    expect(s.sectors).toBe(0);
    expect(s.deadAirMaxSec).toBe(0);
  });
});
