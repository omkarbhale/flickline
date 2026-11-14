import { describe, expect, it } from 'vitest';
import { gridMove, resolveKey, type NavState } from './navigation';

const st = (over: Partial<NavState> = {}): NavState => ({
  menuOpen: true, screen: 'main', runPhase: 'idle', typing: false, onButton: false, sessionActive: false, ...over,
});
const act = (code: string, over: Partial<NavState> = {}): string | undefined => resolveKey(code, st(over))?.type;

describe('keys in a run', () => {
  it('Backspace restarts from ready, live and result, and in free play', () => {
    for (const runPhase of ['idle', 'ready', 'live', 'result'] as const) expect(act('Backspace', { menuOpen: false, runPhase })).toBe('restart');
  });
  it('Enter starts the next run only on the result', () => {
    expect(act('Enter', { menuOpen: false, runPhase: 'result' })).toBe('nextRun');
    expect(act('Enter', { menuOpen: false, runPhase: 'live' })).toBeUndefined();
  });
  it('leaves every other key to the game', () => {
    for (const k of ['KeyW', 'Space', 'KeyR', 'Escape', 'Digit1']) expect(act(k, { menuOpen: false, runPhase: 'live' })).toBeUndefined();
  });
});

describe('pause menu', () => {
  const p = { screen: 'pause' } as const;
  it('Esc and Enter resume, Backspace restarts', () => {
    expect(act('Escape', p)).toBe('resume');
    expect(act('Enter', p)).toBe('resume');
    expect(act('Backspace', p)).toBe('restart');
  });
  it('Enter on a focused button is the button’s', () => {
    expect(act('Enter', { ...p, onButton: true })).toBeUndefined();
  });
  it('S opens settings, M goes to the menu, K skips only inside a session', () => {
    expect(act('KeyS', p)).toBe('openSettings');
    expect(act('KeyM', p)).toBe('toMenu');
    expect(act('KeyK', p)).toBeUndefined();
    expect(act('KeyK', { ...p, sessionActive: true })).toBe('skipStep');
  });
});

describe('main menu', () => {
  it('Enter plays today’s session unless a button has focus', () => {
    expect(act('Enter')).toBe('playSession');
    expect(act('Enter', { onButton: true })).toBeUndefined();
  });
  it('number keys start the card at that position', () => {
    expect(resolveKey('Digit1', st())).toEqual({ type: 'launchCard', index: 0 });
    expect(resolveKey('Digit9', st())).toEqual({ type: 'launchCard', index: 8 });
    expect(act('Digit0')).toBeUndefined();
  });
  it('S opens settings; Esc and Backspace do nothing', () => {
    expect(act('KeyS')).toBe('openSettings');
    expect(act('Escape')).toBeUndefined();
    expect(act('Backspace')).toBeUndefined();
  });
});

describe('settings and typing', () => {
  it('Esc goes back from settings, also while typing', () => {
    expect(act('Escape', { screen: 'settings' })).toBe('back');
    expect(act('Escape', { screen: 'settings', typing: true })).toBe('back');
  });
  it('typing swallows every other key: Backspace never restarts, S never opens settings', () => {
    for (const screen of ['main', 'pause', 'settings', 'firstRun'] as const) {
      for (const k of ['Backspace', 'KeyS', 'KeyM', 'Enter', 'Digit2']) expect(act(k, { screen, typing: true })).toBeUndefined();
    }
  });
  it('first-run has no shortcuts of its own (its fields and Click to play handle themselves)', () => {
    for (const k of ['Enter', 'Escape', 'KeyS', 'Backspace', 'Digit1']) expect(act(k, { screen: 'firstRun' })).toBeUndefined();
  });
});

describe('gridMove', () => {
  it('steps along a row and wraps at the ends', () => {
    expect(gridMove(0, 'ArrowRight', 3, 5)).toBe(1);
    expect(gridMove(4, 'ArrowRight', 3, 5)).toBe(0);
    expect(gridMove(0, 'ArrowLeft', 3, 5)).toBe(4);
  });
  it('moves by a row vertically and stops at the edge', () => {
    expect(gridMove(1, 'ArrowDown', 3, 5)).toBe(4);
    expect(gridMove(2, 'ArrowDown', 3, 5)).toBe(2);
    expect(gridMove(4, 'ArrowUp', 3, 5)).toBe(1);
    expect(gridMove(1, 'ArrowUp', 3, 5)).toBe(1);
  });
  it('a single column is a list', () => {
    expect(gridMove(0, 'ArrowDown', 1, 4)).toBe(1);
    expect(gridMove(3, 'ArrowUp', 1, 4)).toBe(2);
  });
  it('ignores other keys and handles empty and out-of-range input', () => {
    expect(gridMove(2, 'KeyA', 3, 5)).toBe(2);
    expect(gridMove(0, 'ArrowRight', 3, 0)).toBe(-1);
    expect(gridMove(-1, 'ArrowRight', 3, 5)).toBe(1);
    expect(gridMove(99, 'ArrowLeft', 3, 5)).toBe(3);
    expect(gridMove(0, 'ArrowDown', 9, 2)).toBe(0);
  });
});
