import { describe, expect, it } from 'vitest';
import { sanitizePlayLog } from './playLog';
import { DEFAULT_PROFILE } from './profile';
import { buildSave, MAX_SAVE_BYTES, parseSave, SAVE_VERSION } from './saveData';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings';

const parts = () => ({
  settings: sanitizeSettings({ sensitivity: 0.55, quality: 'high', fpsCap: 144, keys: { jump: ['KeyF'] }, difficultyPin: { orbit: 40 } }),
  profile: { ...DEFAULT_PROFILE, selfReport: 'some' as const, firstRunDone: true },
  playLog: sanitizePlayLog({ bests: { orbit: 1200 }, plays: { orbit: 3 }, flaggedSkill: 'flick' }),
});

describe('save file', () => {
  it('round-trips settings, profile and play log', () => {
    const r = parseSave(buildSave(parts(), '2026-01-01T00:00:00.000Z'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts.settings).toEqual(parts().settings);
    expect(r.parts.profile).toEqual(parts().profile);
    expect(r.parts.playLog).toEqual(parts().playLog);
  });

  it('is versioned and says what it is', () => {
    const j = JSON.parse(buildSave(parts(), 'x'));
    expect(j.format).toBe('flickline-save');
    expect(j.version).toBe(SAVE_VERSION);
  });

  it('rejects things that are not saves, with a reason', () => {
    for (const bad of ['', '{nope', '[]', 'null', '{"format":"other","version":1,"settings":{}}', '{"format":"flickline-save"}']) {
      const r = parseSave(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });

  it('rejects a newer version and an empty save, and an oversized text', () => {
    expect(parseSave(JSON.stringify({ format: 'flickline-save', version: SAVE_VERSION + 1, settings: {} })).ok).toBe(false);
    expect(parseSave(JSON.stringify({ format: 'flickline-save', version: 1 })).ok).toBe(false);
    expect(parseSave('x'.repeat(MAX_SAVE_BYTES + 1)).ok).toBe(false);
  });

  it('clamps hand-edited values like the stores do', () => {
    const r = parseSave(JSON.stringify({ format: 'flickline-save', version: 1, settings: { volume: 9, fpsCap: 77, renderScale: 0, fov: 150, keys: { jump: ['Escape'] } } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.parts.settings!;
    expect(s.volume).toBe(1);
    expect(s.fpsCap).toBe(DEFAULT_SETTINGS.fpsCap);
    expect(s.renderScale).toBe(0.5);
    expect('fov' in s).toBe(false);
    expect(s.keys.jump).toEqual([]);
  });

  it('leaves out the parts the file does not have', () => {
    const r = parseSave(JSON.stringify({ format: 'flickline-save', version: 1, playLog: { bests: { orbit: 5 } } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parts.settings).toBeUndefined();
      expect(r.parts.profile).toBeUndefined();
      expect(r.parts.playLog?.bests.orbit).toBe(5);
    }
  });
});
