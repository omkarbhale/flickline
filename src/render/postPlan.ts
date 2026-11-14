import type { PostPreset } from '../config/render';

/** Bloom works at 1/DOWNSAMPLE of the frame in each axis (design section 11: downsample x4, no mip chain). */
export const BLOOM_DOWNSAMPLE = 4;

/**
 * What the post pipeline draws for a preset, counted. A *full-screen pass* is one that covers the
 * whole native-resolution frame (the cost design section 14.1 budgets: <= 1 at Medium, <= 3 at
 * High, none at Low); quarter-resolution passes cost 1/16 of one each, so they are counted apart
 * and never hide behind the budget. The scene draw itself is not a post pass. Pure data so the
 * budget is unit-tested and the overlay reads the same numbers the renderer follows.
 */
export interface PostPlan {
  /** Any effect on: the scene renders offscreen and the composite writes the canvas. */
  active: boolean;
  /** Passes at native resolution (the composite, when active). */
  fullScreenPasses: number;
  /** Passes at 1/16 of the area: bloom threshold/downsample and, with `blur`, the two blur passes. */
  quarterPasses: number;
  /** Render targets alive: the scene target plus the bloom ones. 0 when inactive. */
  targets: number;
}

export function planPost(p: Readonly<PostPreset>): PostPlan {
  const active = p.bloom || p.vignette || p.chromatic;
  if (!active) return { active: false, fullScreenPasses: 0, quarterPasses: 0, targets: 0 };
  const quarter = p.bloom ? (p.blur ? 3 : 1) : 0;
  return { active: true, fullScreenPasses: 1, quarterPasses: quarter, targets: 1 + (p.bloom ? (p.blur ? 2 : 1) : 0) };
}
