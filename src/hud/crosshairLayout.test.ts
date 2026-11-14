import { describe, expect, it } from 'vitest';
import { CROSSHAIR_PRESETS, DEFAULT_CROSSHAIR, cloneCrosshair, type CrosshairParams } from '../settings/crosshair';
import { computeCrosshairLayout, createLayout, LAYER_FILL, MAX_RECTS } from './crosshairLayout';

const DPRS = [1, 1.25, 2];
const SIZES: [number, number][] = [[1920, 1080], [1921, 1081], [1366, 768], [1280, 720], [2560, 1440], [801, 601], [1537, 865]];

function allPresets(): CrosshairParams[] {
  const all = [DEFAULT_CROSSHAIR, ...CROSSHAIR_PRESETS.map((p) => p.params)];
  const dotAndArms = cloneCrosshair(DEFAULT_CROSSHAIR);
  dotAndArms.dot.show = true;
  dotAndArms.outer.show = true;
  all.push(dotAndArms);
  return all;
}

describe('crosshair layout: exact screen centre', () => {
  it('is centred within half a device pixel at every size and DPR, on whole device pixels', () => {
    const out = createLayout();
    for (const dpr of DPRS) {
      for (const [w, h] of SIZES) {
        for (const p of allPresets()) {
          for (const spread of [0, 0.5, 1]) {
            computeCrosshairLayout(p, spread, w, h, dpr, out);
            const devW = Math.round(w * dpr);
            const devH = Math.round(h * dpr);
            const tag = `${w}x${h}@${dpr}`;
            // The canvas box is a whole number of device pixels and centred exactly.
            expect(Number.isInteger(out.canvasLeft), tag).toBe(true);
            expect(Number.isInteger(out.canvasTop), tag).toBe(true);
            expect(out.canvasLeft * 2 + out.canvasW, tag).toBe(devW);
            expect(out.canvasTop * 2 + out.canvasH, tag).toBe(devH);
            expect(out.count).toBeLessThanOrEqual(MAX_RECTS);
            // Fill rectangles: integer edges, inside the canvas, and symmetric about the centre.
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < out.count; i++) {
              const r = out.rects[i]!;
              expect(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h), tag).toBe(true);
              expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= out.canvasW && r.y + r.h <= out.canvasH, tag).toBe(true);
              if (r.layer === LAYER_FILL) {
                minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w);
                minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.h);
              }
            }
            // Screen-space centre of the drawn shape vs the screen centre.
            const sx = out.canvasLeft + (minX + maxX) / 2;
            const sy = out.canvasTop + (minY + maxY) / 2;
            expect(Math.abs(sx - devW / 2), tag).toBeLessThanOrEqual(0.5);
            expect(Math.abs(sy - devH / 2), tag).toBeLessThanOrEqual(0.5);
          }
        }
      }
    }
  });

  it('is exactly centred when the thickness parity matches the screen parity (even sizes, even thickness)', () => {
    const out = createLayout();
    const p = cloneCrosshair(DEFAULT_CROSSHAIR);
    p.inner.thickness = 2;
    p.dot.show = true;
    p.dot.size = 2;
    for (const dpr of [1, 2]) {
      computeCrosshairLayout(p, 0, 1920, 1080, dpr, out);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < out.count; i++) {
        const r = out.rects[i]!;
        if (r.layer !== LAYER_FILL) continue;
        minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w);
        minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.h);
      }
      expect(out.canvasLeft + (minX + maxX) / 2).toBe((1920 * dpr) / 2);
      expect(out.canvasTop + (minY + maxY) / 2).toBe((1080 * dpr) / 2);
    }
  });

  it('scales lengths with DPR so the crosshair keeps its CSS size', () => {
    const out = createLayout();
    const p = cloneCrosshair(DEFAULT_CROSSHAIR);
    computeCrosshairLayout(p, 0, 1920, 1080, 1, out);
    const w1 = out.rects.slice(0, out.count).filter((r) => r.layer === LAYER_FILL).map((r) => r.w * r.h);
    computeCrosshairLayout(p, 0, 1920, 1080, 2, out);
    const w2 = out.rects.slice(0, out.count).filter((r) => r.layer === LAYER_FILL).map((r) => r.w * r.h);
    expect(w2.map((a, i) => a / w1[i]!)).toEqual(w1.map(() => 4));
  });

  it('opens the lines outward with spread, only when firing error is on', () => {
    const out = createLayout();
    const p = cloneCrosshair(DEFAULT_CROSSHAIR);
    const topY = (): number => out.rects.slice(0, out.count).filter((r) => r.layer === LAYER_FILL)[0]!.y;
    const reach = (): number => out.canvasTop + topY();
    computeCrosshairLayout(p, 0, 1920, 1080, 1, out);
    const rest = reach();
    computeCrosshairLayout(p, 1, 1920, 1080, 1, out);
    expect(reach()).toBe(rest); // off by default: shots do not move the lines
    p.firingError = { show: true, amount: 6 };
    computeCrosshairLayout(p, 1, 1920, 1080, 1, out);
    expect(reach()).toBe(rest - 6);
    computeCrosshairLayout(p, 0.5, 1920, 1080, 1, out);
    expect(reach()).toBe(rest - 3);
  });

  it('draws nothing for a crosshair with every element hidden', () => {
    const out = createLayout();
    const p = cloneCrosshair(DEFAULT_CROSSHAIR);
    p.inner.show = false;
    computeCrosshairLayout(p, 0, 1920, 1080, 1, out);
    expect(out.count).toBe(0);
  });
});
