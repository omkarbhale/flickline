import { describe, expect, it } from 'vitest';
import { vec3 } from '../core/vec3';
import { azimuthDeg, positionAtAzimuth } from './spatial';

describe('listener-relative placement', () => {
  it('puts +60 degrees to the right and -60 to the left for any yaw, and reads them back', () => {
    const p = vec3();
    for (const yaw of [0, 0.7, -2.1, Math.PI]) {
      for (const az of [-60, 60, 0, 170]) {
        positionAtAzimuth(p, 3, 1.6, -4, yaw, az, 10);
        expect(azimuthDeg(3, -4, yaw, p.x, p.z)).toBeCloseTo(az, 6);
        expect(Math.hypot(p.x - 3, p.z + 4)).toBeCloseTo(10, 6);
        expect(p.y).toBe(1.6);
      }
    }
  });

  it('matches the architecture frame: yaw 0 faces -Z with +X on the right', () => {
    const p = positionAtAzimuth(vec3(), 0, 0, 0, 0, 60, 10);
    expect(p.x).toBeGreaterThan(8);
    expect(p.z).toBeLessThan(0);
    // Positive yaw turns left: the same world point is then further to the listener's right.
    expect(azimuthDeg(0, 0, 0.5, p.x, p.z)).toBeGreaterThan(60);
  });
});
