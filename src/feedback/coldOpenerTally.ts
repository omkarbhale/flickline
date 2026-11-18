import type { ColdOutcome } from '../progress/coldOpeners';

/**
 * What a cold opener produced (design §8.5), folded from the run's events between `coldOpenerStarted`
 * and `coldOpenerEnded`: its `baseline` trials, contacts won, first-bullet headshot kills, times to shot
 * and moving shots. Pure; `features/coldOpener.ts` feeds it from the bus. Not a hot path: a handful of
 * events per contact.
 */
export class ColdOpenerTally {
  private on = false;
  private version = 0;
  private seed = 0;
  private level = 0;
  private of = 0;
  private readonly trials: { skill: string; itemDifficulty: number; success: boolean }[] = [];
  private readonly tts: number[] = [];
  private contacts = 0;
  private won = 0;
  private heads = 0;
  private shots = 0;
  private moving = 0;

  /** A cold opener is being played now. */
  get active(): boolean {
    return this.on;
  }

  get currentLevel(): number {
    return this.level;
  }

  begin(e: { version: number; level: number; legs: number; seed: number }): void {
    this.on = true;
    this.version = e.version;
    this.seed = e.seed;
    this.level = e.level;
    this.of = e.legs;
    this.trials.length = 0;
    this.tts.length = 0;
    this.contacts = this.won = this.heads = this.shots = this.moving = 0;
  }

  /** A `skillTrial`: only the cold opener's own (`source: 'baseline'`) count. */
  trial(e: { skill: string; itemDifficulty: number; success: boolean; rtMs?: number; source?: string }): void {
    if (!this.on || e.source !== 'baseline') return;
    this.trials.push({ skill: e.skill, itemDifficulty: e.itemDifficulty, success: e.success });
    if (e.success && e.rtMs !== undefined && Number.isFinite(e.rtMs)) this.tts.push(e.rtMs);
  }

  shot(moving: boolean): void {
    if (!this.on) return;
    this.shots++;
    if (moving) this.moving++;
  }

  kill(e: { firstBullet: boolean; zone: string }): void {
    if (this.on && e.firstBullet && e.zone === 'head') this.heads++;
  }

  /** A contact settled: `cleared` is won; died or disengaged are lost; an avoided one (nobody contested it) is not counted. */
  settled(outcome: string): void {
    if (!this.on || outcome === 'avoided') return;
    this.contacts++;
    if (outcome === 'cleared') this.won++;
  }

  /** The cold opener ended: what it produced, or null when it was quit (a quit cold opener is offered again). */
  end(e: { reason: 'exit' | 'death' | 'quit'; legsDone: number; kept: number }): ColdOutcome | null {
    if (!this.on) return null;
    this.on = false;
    if (e.reason === 'quit') return null;
    return {
      version: this.version, seed: this.seed, level: this.level, legs: e.legsDone, of: this.of, trials: this.trials.slice(),
      contacts: this.contacts, won: this.won, firstBulletHeads: this.heads, engaged: this.trials.length, ttsMs: this.tts.slice(),
      shots: this.shots, movingShots: this.moving, kept: e.kept, end: e.reason,
    };
  }

  /** Forget a cold opener in progress (the run was replaced). */
  cancel(): void {
    this.on = false;
  }
}
