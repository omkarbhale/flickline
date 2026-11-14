import { describe, expect, it } from 'vitest';
import { contrastFromLuminance, relativeLuminance, srgbToLinear } from '../core/color';
import { ECHO_PRESET_IDS, echoPresets, env, horizonLuminance } from './palette';
import { post } from './post';

/**
 * Readability guard (vision principle 8: polish never costs target readability). The palette test
 * holds Echoes at >= 7:1 against every un-haloed surface. Bloom and the vignette can only lower
 * that, so their worst case is bounded here: the halo adds at most `bloom.maxAdd` to a surface and
 * the vignette scales everything by at least `1 - strength`, at the same pixel (a conservative
 * overlap: the halo is weakest at the corners where the vignette is strongest). An Echo must stay
 * at least WCAG AA (4.5:1) against every surface under both, for every colour preset.
 */
describe('post stack keeps Echoes readable', () => {
  const surfaces = [env.floor, env.wall, env.cover, env.platform, env.void].map(relativeLuminance).concat(horizonLuminance());
  const brightest = Math.max(...surfaces);
  const vmin = 1 - post.vignette.strength;

  for (const id of ECHO_PRESET_IDS) {
    for (const [part, hex] of [['body', echoPresets[id].color], ['head node', echoPresets[id].head]] as const) {
      it(`${id} ${part} stays >= 4.5:1 under the bloom halo and the corner vignette`, () => {
        const echo = relativeLuminance(hex) * vmin;
        const surface = brightest * vmin + post.bloom.maxAdd;
        expect(contrastFromLuminance(echo, surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('the halo cap is a real, visible glow (not zero) and the vignette is subtle', () => {
    expect(post.bloom.maxAdd).toBeGreaterThan(0.005);
    expect(post.vignette.strength).toBeLessThanOrEqual(0.2);
    // linear 0.018 is ~ sRGB 36/255 on a near-black frame: visible.
    expect(255 * (1.055 * Math.pow(post.bloom.maxAdd, 1 / 2.4) - 0.055)).toBeGreaterThan(30);
  });

  it('the bloom threshold sits above every environment surface, so only emissives glow', () => {
    // Peak channel of the brightest environment surface (linear), at full light.
    const peak = (hex: number): number => Math.max(...[(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => srgbToLinear(c / 255)));
    const envPeak = Math.max(...[env.floor, env.wall, env.cover, env.platform, env.void].map(peak));
    expect(post.bloom.threshold - post.bloom.knee).toBeGreaterThan(envPeak);
  });
});
