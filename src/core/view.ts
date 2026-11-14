import { DEG2RAD, RAD2DEG } from './math';

/**
 * Field of view maths.
 *
 * The reference game fixes the HORIZONTAL FOV at 103 degrees for a 16:9 display. We derive the
 * VERTICAL FOV from that reference and keep it constant ("Hor+"): other aspect ratios see more or
 * less horizontally, exactly like the reference.
 *
 *   vfov = 2 * atan( tan(hfov / 2) / aspect )          (aspect = width / height)
 *   hfov = 2 * atan( tan(vfov / 2) * aspect )
 *
 * 103 deg @ 16:9  ->  vfov = 70.53 deg (what three.js PerspectiveCamera.fov takes)
 * same vfov: hfov = 86.6 deg @ 4:3, 97.1 deg @ 16:10, 117.6 deg @ 21:9, 136.6 deg @ 32:9
 */
export const REFERENCE_ASPECT = 16 / 9;

export function verticalFovDeg(hfovDeg: number, aspect: number): number {
  return 2 * Math.atan(Math.tan((hfovDeg * DEG2RAD) / 2) / aspect) * RAD2DEG;
}

export function horizontalFovDeg(vfovDeg: number, aspect: number): number {
  return 2 * Math.atan(Math.tan((vfovDeg * DEG2RAD) / 2) * aspect) * RAD2DEG;
}
