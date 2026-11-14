import type { Subscribable } from '../core/eventBus';
import type { RunEvents } from '../sim/runEvents';
import type { SimEvents } from '../sim/types';

type AllEvents = SimEvents & RunEvents;

/** One logged event: a discriminated union over every logged event type, payload deep-copied. */
export type LoggedEvent = { [K in keyof AllEvents]: { type: K; data: AllEvents[K] } }[keyof AllEvents];

/**
 * What goes in the log: every sim fact and run event. The stat tracker's derived events
 * (`chainUpdated`, `streakUpdated`, `killSummarised`) are pure functions of these and are not
 * logged. Footsteps/jumps are logged too: the log is the determinism fingerprint of a run.
 */
export const LOGGED_EVENT_TYPES: readonly (keyof AllEvents)[] = [
  'runReady', 'runStarted', 'runEnded',
  'shotFired', 'shotImpact', 'targetHit', 'targetKilled', 'targetRespawned',
  'playerJumped', 'playerLanded', 'footstep',
  'targetSpawned', 'targetVisible', 'targetExpired', 'targetShielded',
  'enemyTell', 'enemyFired', 'playerDamaged', 'playerSlowed', 'playerDied',
  'surgeStarted', 'surgeEnded', 'medalAwarded', 'skillTrial',
  'aimOnTarget', 'headHeightSampled', 'playerStopped',
];

/** The immutable-by-convention record of a run that `computeStats` consumes. */
export interface RunLog {
  readonly mode: string;
  readonly seed: number;
  readonly dial: number;
  readonly events: readonly LoggedEvent[];
  /** True when the capacity was hit and later events were dropped. */
  readonly truncated: boolean;
}

function cloneValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice();
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) out[k] = cloneValue((v as Record<string, unknown>)[k]);
  return out;
}

/**
 * Records the run's events. Payloads are copied (the bus reuses them). This allocates per
 * *event* (shots, kills, edges, 8 Hz samples), never per tick or per frame, and is bounded by
 * `maxEvents`; it is the one deliberate exception to the no-allocation rule in the sim path.
 */
export class EventLog implements RunLog {
  mode = '';
  seed = 0;
  dial = 0;
  events: LoggedEvent[] = [];
  truncated = false;
  recording = false;

  constructor(private maxEvents: number) {}

  setCapacity(maxEvents: number): void {
    this.maxEvents = maxEvents;
  }

  /** Start a fresh log for a run (before `runReady` is emitted). */
  begin(mode: string, seed: number, dial: number): void {
    this.mode = mode;
    this.seed = seed;
    this.dial = dial;
    this.events = [];
    this.truncated = false;
    this.recording = true;
  }

  stop(): void {
    this.recording = false;
  }

  record<K extends keyof AllEvents>(type: K, payload: AllEvents[K]): void {
    if (!this.recording) return;
    if (this.events.length >= this.maxEvents) {
      this.truncated = true;
      return;
    }
    this.events.push({ type, data: cloneValue(payload) } as LoggedEvent);
  }

  /** Subscribe to every logged type. Returns the unsubscribe function. */
  attach(bus: Subscribable<AllEvents>): () => void {
    const offs: (() => void)[] = [];
    for (const type of LOGGED_EVENT_TYPES) {
      offs.push(bus.on(type, (p) => this.record(type, p as never)));
    }
    return () => offs.forEach((f) => f());
  }
}
