import { audio, type AudioTunables } from './audio';
import { feedback, type FeedbackTunables } from './feedback';
import { dial, type DialTunables } from './dial';
import { echo, type EchoTunables } from './echo';
import { modes, type ModeTunables } from './modes';
import { movement, type MovementTunables } from './movement';
import { profile, type ProfileTunables } from './profile';
import { render, type RenderTunables } from './render';
import { scoring, type ScoringTunables } from './scoring';
import { targets, type TargetTunables } from './targets';
import { view, type ViewTunables } from './view';
import { weapon, weaponRules, type WeaponRules, type WeaponTable } from './weapon';

/**
 * The single source of tunable numbers. Each area keeps its values in its own file in this folder
 * (so parallel work rarely collides); this module aggregates them. Gameplay numbers never live
 * inline in code. The sim receives a Tunables object by injection (see sim/world.ts), tests pass
 * their own.
 */
export interface Tunables {
  movement: MovementTunables;
  /** Weapon definitions keyed by id: `weapon.pace`, `weapon.kestrel`. */
  weapon: WeaponTable;
  /** Rules shared by every weapon (spec §7.1 global keys). */
  weaponRules: WeaponRules;
  targets: TargetTunables;
  view: ViewTunables;
  render: RenderTunables;
  audio: AudioTunables;
  feedback: FeedbackTunables;
  profile: ProfileTunables;
  scoring: ScoringTunables;
  modes: ModeTunables;
  dial: DialTunables;
  echo: EchoTunables;
}

/** Live, mutable instance. Only the debug hook and settings UI may mutate it at runtime. */
export const tunables: Tunables = { movement, weapon, weaponRules, targets, view, render, audio, feedback, profile, dial, scoring, modes, echo };

/** Deep copy for tests and what-if runs (tunables are JSON-safe plain data). */
export function cloneTunables(t: Tunables = tunables): Tunables {
  return JSON.parse(JSON.stringify(t)) as Tunables;
}
