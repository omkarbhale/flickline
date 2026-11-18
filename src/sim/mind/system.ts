import type { EventSink } from '../../core/eventBus';
import { TICK_DT } from '../../core/time';
import type { Tunables } from '../../config/tunables';
import { lineClear } from '../exposure';
import type { MapDef } from '../mapTypes';
import { PerceptionSystem } from '../perception';
import type { TargetField } from '../targets';
import type { BoxDef, LevelDef, PlayerState, SimEvents, TargetState } from '../types';
import { NavRuntime } from './nav';

/**
 * The world's side of the enemy mind (issue #91): one `PerceptionSystem` (#89) every mind-driven
 * Echo has a perceiver in, the level's nav graph for their moves, and the facts a mind needs about
 * its team (a teammate went down where it could see or hear it, §5.2 `alert`). Owned by `World`,
 * stepped once per tick before the targets, so every mind decides on what its perception knew at
 * the start of the tick. Hears the player through `hear`, which the world calls for every event the
 * player's own movement and gun emit. Allocation-free after construction and `setLevel`.
 */
export class MindSystem {
  readonly perception: PerceptionSystem;
  readonly nav = new NavRuntime();
  /** Slots of the target field that held a live mind at the last step, and the id they held. */
  private readonly ids: Int32Array;
  private boxes: readonly BoxDef[];
  /** Forwards the perceiver events into whatever sink the world's tick is using. */
  private readonly sink: { target: EventSink<SimEvents>; emit: EventSink<SimEvents>['emit'] };

  constructor(private readonly tunables: Tunables, level: LevelDef, player: PlayerState, seed = 1) {
    const NULL: EventSink<SimEvents> = { emit() {} };
    const sink = {
      target: NULL,
      emit<K extends keyof SimEvents>(type: K, payload: SimEvents[K]): void { sink.target.emit(type, payload); },
    };
    this.sink = sink;
    this.boxes = level.boxes;
    this.perception = new PerceptionSystem(tunables, level.boxes, player, sink, seed);
    this.ids = new Int32Array(tunables.targets.maxTargets).fill(-1);
    this.setLevel(level);
  }

  /** The level changed: sight rays and moves use its boxes and nav graph. Allocates (level load only). */
  setLevel(level: LevelDef): void {
    this.boxes = level.boxes;
    this.perception.setBoxes(level.boxes);
    this.nav.build((level as Partial<MapDef>).nav ?? null);
  }

  get levelBoxes(): readonly BoxDef[] {
    return this.boxes;
  }

  /** Forget every mind and every callout (world reset). */
  reset(): void {
    this.perception.reset();
    this.ids.fill(-1);
  }

  /** A mind-driven Echo spawned in `slot`: watch it for its death. */
  register(slot: number, id: number): void {
    this.ids[slot] = id;
  }

  /**
   * The player made a sound (`footstep` running, `playerLanded`, `shotFired`, `reloadStarted`):
   * every perceiver in range hears it (`PerceptionSystem.hear`). Any other event is ignored.
   */
  hear(type: keyof SimEvents, payload: unknown): void {
    if (this.perception.count === 0) return;
    switch (type) {
      case 'footstep': {
        const e = payload as SimEvents['footstep'];
        if (!e.walking && !e.crouching) this.perception.hear('footstep', e.tick);
        break;
      }
      case 'playerLanded':
        this.perception.hear('landing', (payload as SimEvents['playerLanded']).tick);
        break;
      case 'shotFired':
        this.perception.hear('shot', (payload as SimEvents['shotFired']).tick);
        break;
      case 'reloadStarted':
        this.perception.hear('reload', (payload as SimEvents['reloadStarted']).tick);
        break;
      default:
        break;
    }
  }

  /**
   * One tick, before the targets step: notice minds that died (alarm their teammates), then the
   * perception's callouts and decision points.
   */
  step(tick: number, field: TargetField, events: EventSink<SimEvents>): void {
    this.sink.target = events;
    const slots = field.slots;
    for (let i = 0; i < slots.length; i++) {
      const id = this.ids[i]!;
      if (id < 0) continue;
      const t = slots[i]!;
      if (t.alive && t.id === id && t.mind.active) continue;
      this.ids[i] = -1;
      this.perception.remove(id);
      // Killed (not despawned): the others who could see or hear it go on alert.
      if (t.id === id && t.hp <= 0) this.teammateDown(t, slots, tick);
    }
    if (this.perception.count > 0) this.perception.step(tick);
  }

  /** `dead` went down: every other living mind that hears a shot from there or sees the spot gets the alarm. */
  private teammateDown(dead: TargetState, slots: readonly TargetState[], tick: number): void {
    const hy = this.tunables.targets.hit.headCentreStand;
    const now = tick * TICK_DT;
    for (let i = 0; i < slots.length; i++) {
      const o = slots[i]!;
      if (!o.alive || !o.mind.active || o === dead) continue;
      const p = o.mind.perceiver;
      if (p === null) continue;
      const dx = dead.pos.x - p.eye.x, dz = dead.pos.z - p.eye.z;
      const near = dx * dx + dz * dz <= o.mind.profile.hearShotM * o.mind.profile.hearShotM;
      if (!near && !lineClear(this.boxes, p.eye.x, p.eye.y, p.eye.z, dead.pos.x, dead.pos.y + hy, dead.pos.z)) continue;
      const a = o.mind.alarm;
      a.x = dead.pos.x; a.y = dead.pos.y; a.z = dead.pos.z;
      o.mind.alarmSec = now;
    }
  }
}
