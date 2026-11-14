import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../core/time';
import { hints as cfg } from '../config/hints';
import { HintRules } from './hints';

const rules = (seen: string[] = []): HintRules => new HintRules(seen, cfg, TICK_DT);

describe('Stop to shoot', () => {
  it('is owed for the first moving shot at a target that missed', () => {
    const r = rules();
    r.onShot(1, true, true);
    expect(r.onShotEnded(1, false)).toBe(true);
  });
  it('is never owed twice', () => {
    const r = rules();
    r.onShot(1, true, true);
    expect(r.onShotEnded(1, false)).toBe(true);
    r.onShot(2, true, true);
    expect(r.onShotEnded(2, false)).toBe(false);
  });
  it('ignores hits, standing shots, and shots at nothing', () => {
    const r = rules();
    r.onShot(1, true, true);
    expect(r.onShotEnded(1, true)).toBe(false);
    r.onShot(2, false, true);
    expect(r.onShotEnded(2, false)).toBe(false);
    r.onShot(3, true, false);
    expect(r.onShotEnded(3, false)).toBe(false);
    expect(r.has('stopToShoot')).toBe(false);
  });
  it('ignores an impact that belongs to another shot', () => {
    const r = rules();
    r.onShot(4, true, true);
    expect(r.onShotEnded(3, false)).toBe(false);
  });
});

describe('Walk to stay quiet', () => {
  const ticks = (sec: number): number => Math.round(sec / TICK_DT);
  it('is owed when an Echo sees the player just after loud steps', () => {
    const r = rules();
    r.onFootstep(100, false, false);
    expect(r.onEchoNoticed(100 + ticks(0.5), true)).toBe(true);
    expect(r.onEchoNoticed(100 + ticks(0.6), true)).toBe(false);
  });
  it('does not count walking or crouched steps, a long-ago step, or a sighting the player started', () => {
    const r = rules();
    r.onFootstep(100, true, false);
    r.onFootstep(110, false, true);
    expect(r.onEchoNoticed(120, true)).toBe(false);
    r.onFootstep(200, false, false);
    expect(r.onEchoNoticed(200 + ticks(cfg.loudStepWindowSec + 0.5), true)).toBe(false);
    expect(r.onEchoNoticed(201, false)).toBe(false);
    expect(r.has('walkQuiet')).toBe(false);
  });
});

describe('what was shown', () => {
  it('starts from the saved ids (unknown ones dropped) and reports them in a fixed order', () => {
    const r = rules(['pickDoor', 'nope']);
    expect(r.shown()).toEqual(['pickDoor']);
    expect(r.claim('pickDoor')).toBe(false);
    expect(r.claim('stopToShoot')).toBe(true);
    expect(r.shown()).toEqual(['stopToShoot', 'pickDoor']);
  });
  it('a saved hint never comes back', () => {
    const r = rules(['stopToShoot']);
    r.onShot(1, true, true);
    expect(r.onShotEnded(1, false)).toBe(false);
  });
});
