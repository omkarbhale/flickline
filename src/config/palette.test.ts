import { describe, expect, it } from 'vitest';
import { contrastFromLuminance, contrastRatio, relativeLuminance } from '../core/color';
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
    // Everything except `ember` (see its comment: the design value cannot reach 7:1) is as designed.
    expect(css.ink).toBe('#0b0d14');
    expect(css.slate).toBe('#151a26');
    expect(css.steel).toBe('#26304a');
    expect(css.trim).toBe('#38e8ff');
    expect(css.core).toBe('#fff1d6');
    expect(css.gold).toBe('#ffd23f');
    expect(css.ok).toBe('#5bf2a5');
    expect(css.warn).toBe('#ffb020');
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
    const strongest = Math.max(render.trim.intensity, g.minorWeight, g.majorWeight, g.tickWeight, m.tick, m.major, m.line, m.armedOff, m.armedOn);
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
