import { describe, expect, it } from 'vitest';
import { defaultProgress, SAVE_VERSION as PROGRESS_VERSION, type ProgressData } from '../progress/save';
import { DEFAULT_PROFILE } from './profile';
import { buildSave, MAX_SAVE_BYTES, parseSave, SAVE_VERSION } from './saveData';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings';

function progress(): ProgressData {
  const p = defaultProgress();
  p.plays = { orbit: 3 };
  p.flaggedSkill = 'flick';
  p.medals = { needle: { count: 2, last: '2026-01-01T00:00:00.000Z' } };
  const best = {
    score: 1200, depth: 7, cleared: 6, seed: 7, date: '2026-01-01T00:00:00.000Z', dial: 61,
    strip: [{ index: 1, role: 'take', condition: 'full', stake: 'plain', won: 2, lost: 0, hpIn: 150, hpOut: 120, cleared: true, flawless: true }],
    pace: [400, 800, 1200],
  };
  p.runBests = { neon: { best, deepest: best, finalesCleared: 1 } };
  p.dailyBests = { '2026-01-01': best };
  p.situations = { clear: [{ won: true, kept: 0.8 }, { won: false, kept: 0.1 }] };
  return p;
}

const parts = () => ({
  settings: sanitizeSettings({ sensitivity: 0.55, quality: 'high', fpsCap: 144, keys: { jump: ['KeyF'] }, difficultyPin: { orbit: 40 } }),
  profile: { ...DEFAULT_PROFILE, selfReport: 'some' as const, firstRunDone: true },
  progress: progress(),
});

describe('save file', () => {
  it('round-trips settings, profile and progress', () => {
    const r = parseSave(buildSave(parts(), '2026-01-01T00:00:00.000Z'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts.settings).toEqual(parts().settings);
    expect(r.parts.profile).toEqual(parts().profile);
    expect(r.parts.progress).toEqual(parts().progress);
  });

  it('is versioned and says what it is', () => {
    const j = JSON.parse(buildSave(parts(), 'x'));
    expect(j.format).toBe('flickline-save');
    expect(j.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(PROGRESS_VERSION);
  });

  it('rejects things that are not saves, with a reason', () => {
    for (const bad of ['', '{nope', '[]', 'null', '{"format":"other","version":1,"settings":{}}', '{"format":"flickline-save"}']) {
      const r = parseSave(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });

  it('rejects a truncated file and a part with the wrong shape (the whole file, not half of it)', () => {
    const text = buildSave(parts(), 'x');
    expect(parseSave(text.slice(0, text.length >> 1)).ok).toBe(false);
    for (const [k, v] of [['history', 'x'], ['runBests', []], ['situations', 'x'], ['plays', 5], ['ratings', { v: 1 }], ['medals', 'no']] as const) {
      const j = { ...JSON.parse(text), [k]: v };
      const r = parseSave(JSON.stringify(j));
      expect(r.ok, k).toBe(false);
    }
  });

  it('rejects a newer version and an empty save, and an oversized text', () => {
    expect(parseSave(JSON.stringify({ format: 'flickline-save', version: SAVE_VERSION + 1, settings: {} })).ok).toBe(false);
    expect(parseSave(JSON.stringify({ format: 'flickline-save', version: 2 })).ok).toBe(false);
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
    const r = parseSave(JSON.stringify({ format: 'flickline-save', version: 2, plays: { orbit: 5 } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parts.settings).toBeUndefined();
      expect(r.parts.profile).toBeUndefined();
      expect(r.parts.progress?.plays.orbit).toBe(5);
    }
  });

  it('migrates a version 1 file (settings, profile, play log): counts and the flagged skill carry over', () => {
    const v1 = { format: 'flickline-save', version: 1, exportedAt: 'x', settings: { sensitivity: 0.6 }, profile: { selfReport: 'some', firstRunDone: true }, playLog: { bests: { orbit: 9 }, plays: { orbit: 4, coldStart: 2 }, flaggedSkill: 'track' } };
    const r = parseSave(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts.settings?.sensitivity).toBe(0.6);
    expect(r.parts.profile?.selfReport).toBe('some');
    expect(r.parts.progress?.plays).toEqual({ orbit: 4, coldStart: 2 });
    expect(r.parts.progress?.flaggedSkill).toBe('track');
    // the old per-mode bests had no dial, so they are not placed into a band
    expect(r.parts.progress?.runBests).toEqual({});
    expect(r.parts.progress?.drillBests).toEqual({});
  });
});
