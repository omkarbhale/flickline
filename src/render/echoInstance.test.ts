import { describe, expect, it } from 'vitest';
import { flashAmount, MATRIX_FLOATS, peekCentre, writeInstanceMatrix, yawTowards } from './echoInstance';

/** Apply a column-major 4x4 at `index` to a point. */
function apply(m: Float32Array, index: number, x: number, y: number, z: number): [number, number, number] {
  const o = index * MATRIX_FLOATS;
  return [
    m[o]! * x + m[o + 4]! * y + m[o + 8]! * z + m[o + 12]!,
    m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z + m[o + 13]!,
    m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z + m[o + 14]!,
  ];
}

describe('instance transform', () => {
  it('translates feet-centre geometry to the world position (yaw 0)', () => {
    const m = new Float32Array(2 * MATRIX_FLOATS);
    writeInstanceMatrix(m, 1, 3, 0.5, -7, 0);
    expect(apply(m, 1, 0, 1.66, 0)).toEqual([3, 2.16, -7].map((v) => expect.closeTo(v, 5)));
  });

  it('crouched / peek placement is the same transform at a different position (no scale, no skew)', () => {
    const m = new Float32Array(MATRIX_FLOATS);
    writeInstanceMatrix(m, 0, 1, 0, 2, 0.7);
    const a = apply(m, 0, 0, 0, 0);
    const b = apply(m, 0, 0, 1, 0);
    expect(b[1] - a[1]).toBeCloseTo(1, 5); // up stays up and unscaled
    const c = apply(m, 0, 0.25, 0, 0);
    expect(Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])).toBeCloseTo(0.25, 5); // rigid
  });

  it('yaw rotates local +Z to (sin yaw, 0, cos yaw)', () => {
    const m = new Float32Array(MATRIX_FLOATS);
    writeInstanceMatrix(m, 0, 0, 0, 0, Math.PI / 2);
    const p = apply(m, 0, 0, 0, 1);
    expect(p[0]).toBeCloseTo(1, 5);
    expect(p[2]).toBeCloseTo(0, 5);
  });

  it('yawTowards turns local +Z at the viewer', () => {
    for (const [vx, vz] of [[0, 5], [4, 0], [-3, -3], [2, -6]] as const) {
      const yaw = yawTowards(1, 1, vx, vz);
      const m = new Float32Array(MATRIX_FLOATS);
      writeInstanceMatrix(m, 0, 0, 0, 0, yaw);
      const f = apply(m, 0, 0, 0, 1);
      const dx = vx - 1, dz = vz - 1, len = Math.hypot(dx, dz);
      expect(f[0]).toBeCloseTo(dx / len, 5);
      expect(f[2]).toBeCloseTo(dz / len, 5);
    }
  });
});

describe('hit flash', () => {
  it('holds white then fades, and is gone after 60 ms', () => {
    expect(flashAmount(-0.001, 0.06)).toBe(0);
    expect(flashAmount(0, 0.06)).toBe(1);
    expect(flashAmount(0.03, 0.06)).toBe(1);
    expect(flashAmount(0.048, 0.06)).toBeCloseTo(0.5, 5);
    expect(flashAmount(0.06, 0.06)).toBe(0);
    expect(flashAmount(1, 0.06)).toBe(0);
  });
});

describe('peek (partial exposure) placement', () => {
  const w = 0.5; // body width (hit.torsoWidth)
  it('exposure 0 hides the whole body behind the edge, 1 clears it', () => {
    expect(peekCentre(2, 1, 0, w) + w / 2).toBeCloseTo(2, 6); // the body's open-side edge sits on the cover edge
    expect(peekCentre(2, 1, 1, w) - w / 2).toBeCloseTo(2, 6);
  });
  it('a shoulder peek (40%) shows exactly 40% of the width past the edge, on either side', () => {
    const right = peekCentre(2, 1, 0.4, w);
    expect(right + w / 2 - 2).toBeCloseTo(0.4 * w, 6);
    const left = peekCentre(-3, -1, 0.4, w);
    expect(-3 - (left - w / 2)).toBeCloseTo(0.4 * w, 6);
  });
  it('clamps exposure to 0..1', () => {
    expect(peekCentre(0, 1, -1, w)).toBe(peekCentre(0, 1, 0, w));
    expect(peekCentre(0, 1, 2, w)).toBe(peekCentre(0, 1, 1, w));
  });
});
