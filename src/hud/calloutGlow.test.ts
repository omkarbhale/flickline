import { describe, expect, it } from 'vitest';
import { arcScreenAngle } from './damageArcs';
import { edgePoint } from './calloutGlow';

describe('callout glow placement', () => {
  it('sits on the edge towards the called direction: ahead is the top edge, right the right edge, behind the bottom', () => {
    const p: [number, number] = [0, 0];
    edgePoint(p, 0, 320, 180, 0);
    expect(p[0]).toBeCloseTo(160, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    edgePoint(p, Math.PI / 2, 320, 180, 0);
    expect(p[0]).toBeCloseTo(320, 6);
    expect(p[1]).toBeCloseTo(90, 6);
    edgePoint(p, Math.PI, 320, 180, 0);
    expect(p[1]).toBeCloseTo(180, 6);
    edgePoint(p, -Math.PI / 4, 320, 180, 0.1); // up-left, pulled in a little from the corner-ish edge
    expect(p[0]).toBeGreaterThan(0);
    expect(p[1]).toBeGreaterThan(0);
  });

  it('follows the view: a direction to the right of an unturned view moves ahead when the player turns right, left when they turn left', () => {
    // World direction +X (to the right of yaw 0).
    expect(arcScreenAngle(1, 0, 0, 0)).toBeCloseTo(Math.PI / 2, 9);
    // Turning right is a negative yaw: the +X direction is now dead ahead.
    expect(arcScreenAngle(1, 0, 0, -Math.PI / 2)).toBeCloseTo(0, 9);
    // Turning left (+yaw) pushes it round to the right of the view.
    expect(arcScreenAngle(1, 0, 0, Math.PI / 2)).toBeCloseTo(Math.PI, 9);
  });
});
