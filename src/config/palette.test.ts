import { describe, expect, it } from 'vitest';
import { contrastFromLuminance, contrastRatio, relativeLuminance, srgbToLinear } from '../core/color';
import {
  ECHO_PRESET_IDS,
  echoPresets,
  css,
  env,
  horizonLuminance,
  palette,
  UI_BACKGROUNDS,
  UI_FOREGROUNDS,
  type PaletteToken,
} from './palette';
import { render } from './render';

describe('palette tokens (design section 11)', () => {
  it('exports all ten tokens as 0xRRGGBB and matching CSS strings', () => {
    const tokens: PaletteToken[] = ['ink', 'slate', 'steel', 'trim', 'ember', 'core', 'gold', 'ok', 'warn', 'alert'];
    expect(Object.keys(palette).sort()).toEqual([...tokens].sort());
    for (const t of tokens) {
      expect(palette[t]).toBeGreaterThanOrEqual(0);
      expect(palette[t]).toBeLessThanOrEqual(0xffffff);
      expect(css[t]).toBe('#' + palette[t].toString(16).padStart(6, '0'));
    }
    // As designed (section 11), which adopts #19's `ember` and #52 R15's `warn`.
    expect(css.ink).toBe('#0b0d14');
    expect(css.slate).toBe('#151a26');
    expect(css.steel).toBe('#26304a');
    expect(css.trim).toBe('#38e8ff');
    expect(css.core).toBe('#fff1d6');
    expect(css.gold).toBe('#ffd23f');
    expect(css.ok).toBe('#5bf2a5');
    expect(css.warn).toBe('#b58cff');
    expect(css.alert).toBe('#ff3d5a');
  });
});

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio(0x000000, 0xffffff)).toBeCloseTo(21, 5);
    expect(contrastRatio(0xffffff, 0xffffff)).toBeCloseTo(1, 5);
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 5);
    expect(relativeLuminance(0x000000)).toBe(0);
  });
});

describe('UI/HUD contrast table (>= 4.5:1)', () => {
  const rows: [PaletteToken, PaletteToken, number][] = [];
  for (const fg of UI_FOREGROUNDS) for (const bg of UI_BACKGROUNDS) rows.push([fg, bg, contrastRatio(palette[fg], palette[bg])]);

  it.each(rows)('%s on %s', (_fg, _bg, ratio) => {
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Echo against the environment (>= 7:1)', () => {
  const surfaces: [string, number][] = [
    ['floor', relativeLuminance(env.floor)],
    ['wall', relativeLuminance(env.wall)],
    ['cover', relativeLuminance(env.cover)],
    ['platform', relativeLuminance(env.platform)],
    ['void / sky zenith / clear colour', relativeLuminance(env.void)],
    ['sky at the horizon glow peak (and fog colour)', horizonLuminance()],
  ];
  const echoes: [string, number][] = [
    ['ember', palette.ember],
    ['core (head node)', palette.core],
  ];

  for (const [en, ec] of echoes) {
    it.each(surfaces)(`${en} against %s`, (_name, lum) => {
      expect(contrastFromLuminance(relativeLuminance(ec), lum)).toBeGreaterThanOrEqual(7);
    });
  }

  it('the shaders only darken environment colours (shade <= 1), so the table above bounds what is drawn', () => {
    expect(render.light.ambient + render.light.sun).toBeLessThanOrEqual(1);
    expect(render.gradient.low).toBeLessThanOrEqual(1);
  });

  it('thin emissive lines (trim, grid) stay dimmer than an Echo so the Echo is the brightest element', () => {
    const echoL = relativeLuminance(palette.ember);
    const trimL = relativeLuminance(palette.trim);
    const g = render.grid;
    const m = render.trim.marks;
    const strongest = Math.max(render.trim.intensity, g.minorWeight, g.majorWeight, g.tickWeight, m.tick, m.major, m.line);
    expect(strongest * trimL).toBeLessThan(echoL);
  });
});

describe('Echo colour presets (>= 7:1 against every Range surface)', () => {
  const surfaces: [string, number][] = [
    ['floor', relativeLuminance(env.floor)],
    ['wall', relativeLuminance(env.wall)],
    ['cover', relativeLuminance(env.cover)],
    ['platform', relativeLuminance(env.platform)],
    ['void / sky zenith / clear colour', relativeLuminance(env.void)],
    ['sky at the horizon glow peak', horizonLuminance()],
  ];

  it('has the five presets of design section 11', () => {
    expect([...ECHO_PRESET_IDS]).toEqual(['ember', 'magenta', 'lime', 'amber', 'contrast']);
    expect(echoPresets.ember.color).toBe(palette.ember);
    expect(echoPresets.contrast.outline).toBe(0x000000);
    expect(echoPresets.contrast.outlineAlways).toBe(true);
  });

  for (const id of ECHO_PRESET_IDS) {
    const p = echoPresets[id];
    it.each(surfaces)(`${id} body against %s`, (_n, lum) => {
      expect(contrastFromLuminance(relativeLuminance(p.color), lum)).toBeGreaterThanOrEqual(7);
    });
    it.each(surfaces)(`${id} head node against %s`, (_n, lum) => {
      expect(contrastFromLuminance(relativeLuminance(p.head), lum)).toBeGreaterThanOrEqual(7);
    });
    it(`${id}: the head node is at least as bright as the body (it stays the brightest part)`, () => {
      expect(relativeLuminance(p.head)).toBeGreaterThanOrEqual(relativeLuminance(p.color));
    });
  }
});

/**
 * Colour-vision-deficiency checks (research #52 R13/R15/R18, `docs/research/cvd_check.py`): Machado,
 * Oliveira & Fernandes (2009) at severity 1.0 in linear sRGB, WCAG contrast, CIE76 delta E. A palette
 * change re-runs these with the suite, so the script never has to be remembered.
 */
describe('colour-vision deficiency (research #52 R13, R15)', () => {
  const SIMS: Record<string, number[][]> = {
    normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  };
  const simulate = (hex: number, m: number[][]): number[] => {
    const v = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => srgbToLinear(c / 255));
    return m.map((row) => Math.min(1, Math.max(0, row[0]! * v[0]! + row[1]! * v[1]! + row[2]! * v[2]!)));
  };
  const lum = (v: number[]): number => 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  const lab = (v: number[]): number[] => {
    const x = (0.4124564 * v[0]! + 0.3575761 * v[1]! + 0.1804375 * v[2]!) / 0.95047;
    const y = 0.2126729 * v[0]! + 0.7151522 * v[1]! + 0.072175 * v[2]!;
    const z = (0.0193339 * v[0]! + 0.119192 * v[1]! + 0.9503041 * v[2]!) / 1.08883;
    const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const deltaE = (a: number, b: number, m: number[][]): number => {
    const p = lab(simulate(a, m));
    const q = lab(simulate(b, m));
    return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
  };
  // The horizon glow is darker than every token here, so the flat surfaces bound the contrast.
  const surfaces = [env.floor, env.wall, env.cover, env.platform, env.void];

  for (const [sim, m] of Object.entries(SIMS)) {
    it(`${sim}: every Echo body >= 4.5:1 and head node >= 7:1 against every rendered surface (R13)`, () => {
      for (const id of ECHO_PRESET_IDS) {
        for (const s of surfaces) {
          const ls = lum(simulate(s, m));
          expect(contrastFromLuminance(lum(simulate(echoPresets[id].color, m)), ls), id).toBeGreaterThanOrEqual(4.5);
          expect(contrastFromLuminance(lum(simulate(echoPresets[id].head, m)), ls), id).toBeGreaterThanOrEqual(7);
        }
      }
    });

    it(`${sim}: moving shot (warn) and headshot (gold) stay separable, delta E >= 20 (R15)`, () => {
      expect(deltaE(palette.warn, palette.gold, m)).toBeGreaterThanOrEqual(20);
    });
  }
});
