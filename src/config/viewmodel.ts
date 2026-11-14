import { scaleLinear } from '../core/color';
import { palette } from './palette';

/**
 * First-person weapon model tunables (design section 11 "Viewmodel", issue #45).
 *
 * VIEWMODEL FOV IS INDEPENDENT OF THE WORLD FOV. The world camera is locked to the reference
 * 103 deg horizontal (`view.hfovDeg`, vertical 70.53 deg) so aiming transfers. The weapon is drawn
 * in its own pass by its own camera with `vfovDeg` below, so it keeps the same size and place on
 * screen, never clips into walls (the pass clears depth) and never changes what the world looks
 * like. Like the world it is Hor+: the vertical FOV is constant, so a wider screen shows more at
 * the sides but the weapon sits at the same distance from the screen centre in units of screen
 * height at every aspect ratio. (The spec has no numbers for this: `docs/mechanics-spec.md` Q18.)
 *
 * Models are drawn in "viewmodel space": metres, right-handed, +X right, +Y up, the camera at the
 * origin looking down -Z. The numbers here are presentation only; none comes from the spec.
 */

/** Weapons that have a model. `rill` is here before the sim has it (#30): lookup is by id string. */
export type ViewmodelId = 'pace' | 'kestrel' | 'rill';
export const VIEWMODEL_IDS: readonly ViewmodelId[] = ['pace', 'kestrel', 'rill'];

/** The viewmodel setting: which hand holds the weapon, or hidden. Live. */
export type ViewmodelMode = 'right' | 'left' | 'hidden';
export const VIEWMODEL_MODES: readonly ViewmodelMode[] = ['right', 'left', 'hidden'];
export const DEFAULT_VIEWMODEL_MODE: ViewmodelMode = 'right';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Per-weapon placement and recoil response. Angles in degrees, lengths in metres. */
export interface ViewmodelWeaponTunables {
  /** Where the model origin (the grip) rests, in viewmodel space, for the right hand. */
  rest: Vec3Like;
  /** Rest yaw (deg, positive turns the muzzle towards the screen centre for a right-hand weapon). */
  restYawDeg: number;
  /** Per-shot kick: the gun jumps back, pitches up and rolls, then decays with `kickDecaySec`. */
  kickBackM: number;
  kickPitchDeg: number;
  kickRollDeg: number;
  /** Time constant of the per-shot kick (seconds). A shot at the fire interval restarts it. */
  kickDecaySec: number;
  /** Visual follow of the sim's aim offset: degrees of gun pitch / yaw per degree of recoil offset. */
  climbPitchGain: number;
  climbYawGain: number;
  /** Muzzle flash: shape id (0 compact star, 1 long cross, 2 wide petals), size (m), colour. */
  flash: { shape: 0 | 1 | 2; size: number; color: number };
}

export interface ViewmodelTunables {
  /** Vertical FOV of the viewmodel pass, degrees. Independent of the world FOV (see above). */
  vfovDeg: number;
  near: number;
  far: number;
  /**
   * The weapon (and its flash) must stay outside this centred box, half-size in units of half the
   * screen height, in every pose and aspect ratio (design section 6: never covers the crosshair).
   * 0.2 is ~108 px at 1080p. Checked by `viewmodelPose.test.ts`.
   */
  centreSafeHalf: number;
  /** Distance in front of the eye, metres, at which tracers appear to leave the on-screen muzzle. */
  tracerOriginDepthM: number;
  /** Equip: the weapon rises from below over the sim's `equipSec`. */
  equip: { dropM: number; pitchDeg: number; rollDeg: number };
  /** Reload: tilt and lower over the sim's `reloadSec`, two knocks (magazine out and in), return. */
  reload: { dropM: number; pitchDeg: number; rollDeg: number; knockM: number; lowerFrac: number; raiseFrac: number };
  /** Colours of the matte dark models (derived from the palette; the trim line is `palette.trim`). */
  colors: { body: number; dark: number; glove: number; trim: number };
  weapons: Record<ViewmodelId, ViewmodelWeaponTunables>;
}

export const viewmodel: ViewmodelTunables = {
  vfovDeg: 60,
  near: 0.01,
  far: 4,
  centreSafeHalf: 0.2,
  tracerOriginDepthM: 0.5,
  equip: { dropM: 0.2, pitchDeg: 38, rollDeg: -14 },
  reload: { dropM: 0.06, pitchDeg: 12, rollDeg: -32, knockM: 0.012, lowerFrac: 0.2, raiseFrac: 0.2 },
  colors: {
    body: scaleLinear(palette.steel, 1.0),
    dark: scaleLinear(palette.steel, 0.55),
    glove: scaleLinear(palette.steel, 0.4),
    trim: palette.trim,
  },
  weapons: {
    pace: {
      rest: { x: 0.17, y: -0.185, z: -0.34 },
      restYawDeg: 1.5,
      kickBackM: 0.03,
      kickPitchDeg: 7,
      kickRollDeg: 1.5,
      kickDecaySec: 0.085,
      climbPitchGain: 2,
      climbYawGain: 1,
      flash: { shape: 0, size: 0.09, color: palette.core },
    },
    kestrel: {
      rest: { x: 0.21, y: -0.225, z: -0.4 },
      restYawDeg: 1.8,
      kickBackM: 0.022,
      kickPitchDeg: 2.2,
      kickRollDeg: 0.9,
      kickDecaySec: 0.05,
      climbPitchGain: 1.5,
      climbYawGain: 1,
      flash: { shape: 1, size: 0.12, color: palette.core },
    },
    rill: {
      rest: { x: 0.19, y: -0.2, z: -0.36 },
      restYawDeg: 1.8,
      kickBackM: 0.017,
      kickPitchDeg: 1.6,
      kickRollDeg: 0.8,
      kickDecaySec: 0.04,
      climbPitchGain: 1.5,
      climbYawGain: 1,
      flash: { shape: 2, size: 0.11, color: palette.core },
    },
  },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { viewmodel };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
