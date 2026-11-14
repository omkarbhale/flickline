import type { Vec3 } from '../core/vec3';

/**
 * Listener-relative placement, in the engine's coordinates (architecture section 6: +Y up, yaw 0
 * looks down -Z, positive yaw turns left, right = (cos yaw, 0, -sin yaw)). Pure maths so tests and
 * the browser probe can place sources at a known bearing without a Web Audio context.
 */

/** Bearing of (`sx`, `sz`) from a listener at (`lx`, `lz`) facing `yaw`: 0 = ahead, +90 = right, -90 = left, +-180 = behind. */
export function azimuthDeg(lx: number, lz: number, yaw: number, sx: number, sz: number): number {
  const dx = sx - lx;
  const dz = sz - lz;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return (Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) * 180) / Math.PI;
}

/** Put a point `distance` metres from the listener at `azimuth` degrees (see `azimuthDeg`), at the listener's height. */
export function positionAtAzimuth(out: Vec3, lx: number, ly: number, lz: number, yaw: number, azimuth: number, distance: number): Vec3 {
  const a = (azimuth * Math.PI) / 180;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  out.x = lx + (fx * Math.cos(a) + rx * Math.sin(a)) * distance;
  out.y = ly;
  out.z = lz + (fz * Math.cos(a) + rz * Math.sin(a)) * distance;
  return out;
}
