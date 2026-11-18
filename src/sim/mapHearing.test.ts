import { describe, expect, it } from 'vitest';
import { attribution } from '../config/attribution';
import { approachWarnings } from './mapHearing';
import { formatLintReport, lintErrors, lintMap } from './mapLint';
import { elbowMap, MAPS } from './mapLoader';
import { parseMap } from './mapSchema';
import type { MapDef } from './mapTypes';

describe('the warning a runner gives (map-lint report, #99)', () => {
  it('every shipped map lints clean with its own radii, and the report prints each approach', () => {
    for (const map of Object.values(MAPS)) {
      const report = lintMap(map);
      expect(lintErrors(report), map.id).toEqual([]);
      expect(report.issues.filter((i) => i.check === 'heard-before-seen'), `${map.id} main approach outside the window`).toEqual([]);
      expect(formatLintReport(report).filter((l) => l.includes('approach ')).length).toBe(report.approaches.length);
    }
  });

  it('Elbow\'s main approach gives a running enemy 1-2 s of warning at the entry at its own footstep radius', () => {
    const w = approachWarnings(elbowMap);
    const main = w.filter((a) => a.main);
    expect(main).toHaveLength(1);
    expect(main[0]!.sectorId).toBe('elbow-hold-corner');
    expect(main[0]!.footstepM).toBe(elbowMap.hearing!.footstep);
    expect(main[0]!.warningSec).toBeGreaterThanOrEqual(attribution.warning.minSec);
    expect(main[0]!.warningSec).toBeLessThanOrEqual(attribution.warning.maxSec);
  });

  it('the radius is what sets the warning: the table\'s radius on the same map gives far more than 2 s, a tiny one is heard only once seen', () => {
    const wide: MapDef = { ...elbowMap, hearing: undefined };
    const a = approachWarnings(wide).find((x) => x.main)!;
    const b = approachWarnings({ ...elbowMap, hearing: { footstep: 3 } }).find((x) => x.laneId === a.laneId)!;
    expect(a.footstepM).toBe(attribution.soundRadiusM.footstep);
    expect(a.warningSec).toBeGreaterThan(attribution.warning.maxSec);
    expect(b.heardAtM).toBe(-1);
    expect(b.warningSec).toBe(0);
  });

  it('a map without sectors has no approaches to report', () => {
    expect(approachWarnings(MAPS.range!)).toEqual([]);
  });
});

describe('the map\'s own sound radii (schema)', () => {
  const base = { schema: 1, id: 'h', name: 'H', bounds: { min: [-5, 0, -5], max: [5, 4, 5] }, spawn: { pos: [0, 0, 0], yaw: 0 }, boxes: [{ tag: 'floor', min: [-6, -1, -6], max: [6, 0, 6] }], targets: [], anchors: [], nav: { nodes: [], edges: [] }, look: { sky: '#101820', fog: [10, 20], palette: 'p' } };

  it('accepts a radius per kind and carries it into the level', () => {
    const r = parseMap({ ...base, hearing: { footstep: 12, shot: 40 } });
    expect(r.ok ? [] : r.errors).toEqual([]);
    if (r.ok) expect(r.map.hearing).toEqual({ footstep: 12, shot: 40 });
    const none = parseMap(base);
    expect(none.ok && none.map.hearing).toBeFalsy();
  });

  it('rejects an unknown kind and a non-positive radius', () => {
    expect(parseMap({ ...base, hearing: { whisper: 5 } }).ok).toBe(false);
    expect(parseMap({ ...base, hearing: { footstep: 0 } }).ok).toBe(false);
    expect(parseMap({ ...base, hearing: { footstep: 'far' } }).ok).toBe(false);
  });
});
