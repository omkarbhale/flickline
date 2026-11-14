import { describe, expect, it } from 'vitest';
import { post } from '../config/post';
import { QUALITY_LEVELS, render } from '../config/render';
import { planPost } from './postPlan';

describe('post pipeline plan (design section 14.1 budget)', () => {
  it('Low has no post at all: no passes, no render targets', () => {
    expect(planPost(render.quality.low.post)).toEqual({ active: false, fullScreenPasses: 0, quarterPasses: 0, targets: 0 });
  });

  it('Medium is bloom only, in one full-screen pass', () => {
    const f = render.quality.medium.post;
    expect(f).toMatchObject({ bloom: true, vignette: false, chromatic: false });
    const p = planPost(f);
    expect(p.fullScreenPasses).toBe(1);
    expect(p.quarterPasses).toBe(1);
    expect(p.targets).toBe(2); // the scene target and one quarter-resolution bloom target
  });

  it('High adds the blur, the vignette and the chromatic option, still one native-resolution pass', () => {
    const f = render.quality.high.post;
    expect(f).toEqual({ bloom: true, blur: true, vignette: true, chromatic: true });
    const p = planPost(f);
    expect(p.fullScreenPasses).toBe(1);
    expect(p.quarterPasses).toBe(3);
    expect(p.targets).toBe(3);
  });

  it('every preset stays inside its full-screen pass budget, counting quarter passes at 1/16', () => {
    for (const q of QUALITY_LEVELS) {
      const p = planPost(render.quality[q].post);
      expect(p.fullScreenPasses).toBeLessThanOrEqual(post.passBudget[q]);
      expect(p.fullScreenPasses + p.quarterPasses / 16).toBeLessThanOrEqual(post.passBudget[q] + (p.active ? 0.25 : 0));
    }
    expect(post.passBudget).toEqual({ low: 0, medium: 1, high: 3 });
  });

  it('presets only ever add effects going up', () => {
    const order = QUALITY_LEVELS.map((q) => render.quality[q].post);
    for (let i = 1; i < order.length; i++) {
      for (const k of ['bloom', 'blur', 'vignette', 'chromatic'] as const) {
        if (order[i - 1]![k]) expect(order[i]![k]).toBe(true);
      }
    }
  });
});
