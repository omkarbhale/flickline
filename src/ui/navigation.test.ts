import { describe, expect, it } from 'vitest';
import { DiscardAsk, gridMove, resolveKey, type NavState } from './navigation';

const st = (over: Partial<NavState> = {}): NavState => ({
  menuOpen: true, screen: 'main', runPhase: 'idle', typing: false, onButton: false, ...over,
});
const act = (code: string, over: Partial<NavState> = {}): string | undefined => resolveKey(code, st(over))?.type;

describe('keys in a run', () => {
  it('Backspace asks for a new run from ready, live and result, and in the Lobby', () => {
    for (const runPhase of ['idle', 'ready', 'live', 'result'] as const) expect(act('Backspace', { menuOpen: false, runPhase })).toBe('newRun');
  });
  it('leaves Enter on the result to the results card, and in a run to the game', () => {
    for (const runPhase of ['ready', 'live', 'result'] as const) expect(act('Enter', { menuOpen: false, runPhase })).toBeUndefined();
  });
  it('Enter in the Lobby (pointer locked, no run) starts a run', () => {
    expect(act('Enter', { menuOpen: false, runPhase: 'idle' })).toBe('play');
  });
  it('leaves every other key to the game', () => {
    for (const k of ['KeyW', 'Space', 'KeyR', 'Escape', 'Digit1', 'KeyK']) expect(act(k, { menuOpen: false, runPhase: 'live' })).toBeUndefined();
  });
});

describe('pause menu', () => {
  const p = { screen: 'pause' } as const;
  it('Esc and Enter resume, Backspace starts a new run', () => {
    expect(act('Escape', p)).toBe('resume');
    expect(act('Enter', p)).toBe('resume');
    expect(act('Backspace', p)).toBe('newRun');
  });
  it('Enter on a focused button is the button’s', () => {
    expect(act('Enter', { ...p, onButton: true })).toBeUndefined();
  });
  it('S opens settings, M goes to the menu, and nothing is left of the session keys', () => {
    expect(act('KeyS', p)).toBe('openSettings');
    expect(act('KeyM', p)).toBe('toMenu');
    expect(act('KeyK', p)).toBeUndefined();
    expect(act('Digit1', p)).toBeUndefined();
  });
});

describe('main menu', () => {
  it('Enter plays unless a button has focus', () => {
    expect(act('Enter')).toBe('play');
    expect(act('Enter', { onButton: true })).toBeUndefined();
  });
  it('has no mode shortcuts any more: 1-9 and K do nothing', () => {
    for (const k of ['Digit1', 'Digit9', 'KeyK']) expect(act(k)).toBeUndefined();
  });
  it('S opens settings; Esc and Backspace do nothing', () => {
    expect(act('KeyS')).toBe('openSettings');
    expect(act('Escape')).toBeUndefined();
    expect(act('Backspace')).toBeUndefined();
  });
});

describe('first-run panel', () => {
  const f = { screen: 'firstRun' } as const;
  it('Enter plays unless a button has the focus; nothing else is a shortcut', () => {
    expect(act('Enter', f)).toBe('play');
    expect(act('Enter', { ...f, onButton: true })).toBeUndefined();
    for (const k of ['Escape', 'KeyS', 'Backspace', 'Digit1']) expect(act(k, f)).toBeUndefined();
  });
});

describe('settings and typing', () => {
  it('Esc goes back from settings, also while typing', () => {
    expect(act('Escape', { screen: 'settings' })).toBe('back');
    expect(act('Escape', { screen: 'settings', typing: true })).toBe('back');
  });
  it('typing swallows every other key: Backspace never starts a run, S never opens settings', () => {
    for (const screen of ['main', 'pause', 'settings', 'firstRun'] as const) {
      for (const k of ['Backspace', 'KeyS', 'KeyM', 'Enter', 'Digit2']) expect(act(k, { screen, typing: true })).toBeUndefined();
    }
  });
});

describe('Backspace mid-run asks once', () => {
  it('a live run asks on the first press and discards on a second within the window', () => {
    const d = new DiscardAsk(2.5);
    expect(d.press('live', 10)).toBe('ask');
    expect(d.press('live', 11.9)).toBe('go');
  });
  it('asks again once the window has passed, and again after a confirmed discard', () => {
    const d = new DiscardAsk(2.5);
    expect(d.press('live', 10)).toBe('ask');
    expect(d.press('live', 12.6)).toBe('ask');
    expect(d.press('live', 13)).toBe('go');
    expect(d.press('live', 13.1)).toBe('ask');
  });
  it('never asks when nothing is lost: not ready, not finished, not the Lobby', () => {
    const d = new DiscardAsk(2.5);
    for (const phase of ['idle', 'ready', 'result'] as const) expect(d.press(phase, 5)).toBe('go');
  });
  it('a ready press in between forgets the pending ask, and clear() forgets it too', () => {
    const d = new DiscardAsk(2.5);
    expect(d.press('live', 1)).toBe('ask');
    expect(d.press('ready', 1.5)).toBe('go');
    expect(d.press('live', 2)).toBe('ask');
    d.clear();
    expect(d.press('live', 2.5)).toBe('ask');
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

describe('rebound keys', () => {
  const keys = { restart: ['KeyG'], confirm: ['KeyH'] };
  const bound = (code: string, over: Partial<NavState> = {}): string | undefined => resolveKey(code, st(over), keys)?.type;
  it('restart and confirm follow the bindings in a run, the Lobby, the pause menu and the main menu', () => {
    expect(bound('KeyG', { menuOpen: false, runPhase: 'live' })).toBe('newRun');
    expect(bound('Backspace', { menuOpen: false, runPhase: 'live' })).toBeUndefined();
    expect(bound('KeyH', { menuOpen: false, runPhase: 'idle' })).toBe('play');
    expect(bound('KeyG', { screen: 'pause' })).toBe('newRun');
    expect(bound('KeyH', { screen: 'pause' })).toBe('resume');
    expect(bound('Enter', { screen: 'pause' })).toBeUndefined();
    expect(bound('KeyH', { screen: 'main' })).toBe('play');
  });
  it('a focused button still keeps the confirm key', () => {
    expect(bound('KeyH', { screen: 'main', onButton: true })).toBeUndefined();
  });
});
