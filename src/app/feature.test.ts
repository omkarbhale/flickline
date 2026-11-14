import { describe, expect, it } from 'vitest';
import { composeTunables, tunables } from '../config/tunables';
import { defineFeature, FEATURE_STAGES, orderFeatures, type FeatureStage } from './feature';
import { FEATURES } from './features';

const f = (id: string, stage: FeatureStage) => ({ feature: defineFeature({ id, stage, setup() {} }) });

describe('feature registry', () => {
  it('orders by stage, then id, whatever the discovery order', () => {
    const order = orderFeatures({
      '../features/zeta.ts': f('zeta', 'tools'),
      '../features/beta.ts': f('beta', 'presentation'),
      '../features/omega.ts': f('omega', 'producer'),
      '../features/alpha.ts': f('alpha', 'presentation'),
    }).map((x) => x.id);
    expect(order).toEqual(['omega', 'alpha', 'beta', 'zeta']);
  });

  it('rejects a module without a feature, an id that is not the file name, and an unknown stage', () => {
    expect(() => orderFeatures({ '../features/a.ts': {} })).toThrow(/does not export/);
    expect(() => orderFeatures({ '../features/a.ts': f('b', 'tools') })).toThrow(/must equal the file name/);
    expect(() => orderFeatures({ '../features/a.ts': f('a', 'late' as FeatureStage) })).toThrow(/unknown stage/);
  });

  it('discovers the real features, unique and in stage order', () => {
    const ids = FEATURES.map((x) => x.id);
    expect(ids).toContain('audio');
    expect(new Set(ids).size).toBe(ids.length);
    const ranks = FEATURES.map((x) => FEATURE_STAGES.indexOf(x.stage));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('tunables registry', () => {
  it('composes every config group', () => {
    for (const key of ['movement', 'weapon', 'weaponRules', 'targets', 'view', 'render', 'audio', 'feedback', 'profile', 'scoring', 'modes', 'dial', 'run']) {
      expect(tunables, key).toHaveProperty(key);
    }
  });

  it('refuses a group declared by two files', () => {
    expect(() => composeTunables({ './a.ts': { tunableGroups: { x: 1 } }, './b.ts': { tunableGroups: { x: 2 } } })).toThrow(
      /declared by both \.\/a\.ts and \.\/b\.ts/,
    );
    expect(composeTunables({ './a.ts': { tunableGroups: { x: 1 } }, './p.ts': {} })).toEqual({ x: 1 });
  });
});
