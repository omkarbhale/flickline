import { describe, expect, it } from 'vitest';
import { actionOf, bindKey, clearKey, defaultKeys, DEFAULT_KEYS, isBindableCode, KEY_ACTIONS, keyLabel, sanitizeKeys } from './keys';

describe('default keys (design §13.3)', () => {
  it('match the settings table', () => {
    const d = DEFAULT_KEYS;
    expect(['forward', 'left', 'back', 'right'].map((a) => d[a as 'forward'][0])).toEqual(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
    expect(d.walk[0]).toBe('ShiftLeft');
    expect(d.crouch[0]).toBe('ControlLeft');
    expect(d.jump[0]).toBe('Space');
    expect([d.weapon1[0], d.weapon2[0], d.weapon3[0]]).toEqual(['Digit1', 'Digit2', 'Digit3']);
    expect(d.reload[0]).toBe('KeyR');
    expect(d.restart[0]).toBe('Backspace');
    expect(d.confirm[0]).toBe('Enter');
    expect(d.statSheet[0]).toBe('Tab');
    expect(d.fullscreen[0]).toBe('F11');
  });

  it('never bind one code to two actions', () => {
    const seen = new Map<string, string>();
    for (const a of KEY_ACTIONS) {
      for (const c of DEFAULT_KEYS[a]) {
        expect(seen.get(c), `${c} used by ${seen.get(c)} and ${a}`).toBeUndefined();
        seen.set(c, a);
      }
    }
  });
});

describe('bindKey', () => {
  it('rebinds a slot', () => {
    const r = bindKey(defaultKeys(), 'jump', 0, 'KeyF');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.keys.jump).toEqual(['KeyF']);
  });

  it('adds a second code to an action with one', () => {
    const r = bindKey(defaultKeys(), 'jump', 1, 'KeyF');
    expect(r.ok && r.keys.jump).toEqual(['Space', 'KeyF']);
  });

  it('rejects a conflict and names the action that holds the key', () => {
    const r = bindKey(defaultKeys(), 'jump', 0, 'KeyR');
    expect(r).toEqual({ ok: false, reason: 'conflict', with: 'reload' });
  });

  it('names itself when the code is in the action’s other slot', () => {
    const r = bindKey(defaultKeys(), 'forward', 0, 'ArrowUp');
    expect(r).toEqual({ ok: false, reason: 'conflict', with: 'forward' });
  });

  it('accepts the key a slot already holds (a no-op)', () => {
    const r = bindKey(defaultKeys(), 'jump', 0, 'Space');
    expect(r.ok).toBe(true);
  });

  it('rejects reserved and malformed codes', () => {
    expect(bindKey(defaultKeys(), 'jump', 0, 'Escape')).toEqual({ ok: false, reason: 'reserved' });
    expect(bindKey(defaultKeys(), 'jump', 0, 'Backquote')).toEqual({ ok: false, reason: 'reserved' });
    expect(bindKey(defaultKeys(), 'jump', 0, '')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('does not change the bindings it was given', () => {
    const k = defaultKeys();
    bindKey(k, 'jump', 0, 'KeyF');
    expect(k.jump).toEqual(['Space']);
  });

  it('lets a freed key be bound elsewhere', () => {
    const cleared = clearKey(defaultKeys(), 'reload', 0);
    expect(cleared.reload).toEqual([]);
    const r = bindKey(cleared, 'jump', 1, 'KeyR');
    expect(r.ok).toBe(true);
  });
});

describe('sanitizeKeys', () => {
  it('fills defaults for garbage and for missing actions', () => {
    expect(sanitizeKeys(null)).toEqual(DEFAULT_KEYS);
    expect(sanitizeKeys({ jump: ['KeyF'] }).reload).toEqual(['KeyR']);
  });

  it('repairs a save that binds a code twice: the earlier action keeps it', () => {
    const k = sanitizeKeys({ forward: ['KeyX'], back: ['KeyX', 'KeyZ'] });
    expect(k.forward).toEqual(['KeyX']);
    expect(k.back).toEqual(['KeyZ']);
    const seen = new Set<string>();
    for (const a of KEY_ACTIONS) for (const c of k[a]) {
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }
  });

  it('drops reserved, non-string and surplus codes; an empty list stays unbound', () => {
    const k = sanitizeKeys({ jump: ['Escape', 5, 'KeyF', 'KeyG', 'KeyH'], reload: [] });
    expect(k.jump).toEqual(['KeyF', 'KeyG']);
    expect(k.reload).toEqual([]);
  });

  it('does not hand a default to an action when another action took it', () => {
    const k = sanitizeKeys({ forward: ['KeyR'] });
    expect(k.forward).toEqual(['KeyR']);
    expect(k.reload).toEqual([]);
  });
});

describe('helpers', () => {
  it('finds the holder of a code', () => {
    expect(actionOf(defaultKeys(), 'KeyW')).toBe('forward');
    expect(actionOf(defaultKeys(), 'KeyQ')).toBeNull();
  });
  it('labels codes for people', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit2')).toBe('2');
    expect(keyLabel('ControlLeft')).toBe('Ctrl');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('F11')).toBe('F11');
  });
  it('knows what can be bound', () => {
    expect(isBindableCode('KeyA')).toBe(true);
    expect(isBindableCode('Escape')).toBe(false);
    expect(isBindableCode(3)).toBe(false);
  });
});
