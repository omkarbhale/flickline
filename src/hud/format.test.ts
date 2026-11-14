import { describe, expect, it } from 'vitest';
import { hud } from '../config/hud';
import { chainText, formatClock, formatDelta, formatMs, formatMult, formatPercent, formatScore, formatSeconds, formatTenths } from './format';

describe('hud formatting', () => {
  it('clock rounds up so it reads 0:00 only when the run is over', () => {
    expect(formatClock(30)).toBe('0:30');
    expect(formatClock(29.01)).toBe('0:30');
    expect(formatClock(0.4)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(-3)).toBe('0:00');
  });
  it('tenths floor so the display never reads below the true remaining time', () => {
    expect(formatTenths(9.99)).toBe('9.9');
    expect(formatTenths(0.04)).toBe('0.0');
    expect(formatTenths(5)).toBe('5.0');
  });
  it('percent, ms and seconds show a dash with no data', () => {
    expect(formatPercent(0.742)).toBe('74%');
    expect(formatPercent(NaN)).toBe('–');
    expect(formatMs(181.6)).toBe('182ms');
    expect(formatMs(NaN)).toBe('–');
    expect(formatSeconds(410)).toBe('0.41s');
    expect(formatSeconds(0)).toBe('0.00s');
    expect(formatSeconds(NaN)).toBe('–');
  });
  it('multiplier, score and delta', () => {
    expect(formatMult(1)).toBe('×1.0');
    expect(formatMult(1.7)).toBe('×1.7');
    expect(formatScore(12450)).toBe('12,450');
    expect(formatDelta(240.4)).toBe('+240');
    expect(formatDelta(-84.6)).toBe('−85');
    expect(formatDelta(0)).toBe('+0');
  });
  it('chain callouts follow the label table and cap at its last entry', () => {
    const t = (n: number): string => chainText(n, hud.chainShowFrom, hud.chainLabels);
    expect(t(0)).toBe('');
    expect(t(1)).toBe('');
    expect(t(2)).toBe('PAIR ×2');
    expect(t(3)).toBe('TRIPLE ×3');
    expect(t(4)).toBe('QUAD ×4');
    expect(t(5)).toBe('SURGE CHAIN ×5');
    expect(t(9)).toBe('SURGE CHAIN ×9');
  });
});
