import { audio, type AudioTunables } from './audio';
import { dial, type DialTunables } from './dial';
import { modes, type ModeTunables } from './modes';
import { movement, type MovementTunables } from './movement';
import { render, type RenderTunables } from './render';
import { run, type RunTunables } from './run';
import { scoring, type ScoringTunables } from './scoring';
import { targets, type TargetTunables } from './targets';
import { view, type ViewTunables } from './view';
import { weapon, type WeaponTunables } from './weapon';

/**
 * The single source of tunable numbers. Each area keeps its values in its own file in this folder
 * (so parallel work rarely collides); this module aggregates them. Gameplay numbers never live
 * inline in code. The sim receives a Tunables object by injection (see sim/world.ts), tests pass
 * their own.
 */
export interface Tunables {
  movement: MovementTunables;
  weapon: WeaponTunables;
  targets: TargetTunables;
  view: ViewTunables;
  render: RenderTunables;
  audio: AudioTunables;
  scoring: ScoringTunables;
  modes: ModeTunables;
  dial: DialTunables;
  run: RunTunables;
}

/** Live, mutable instance. Only the debug hook and settings UI may mutate it at runtime. */
export const tunables: Tunables = { movement, weapon, targets, view, render, audio, dial, scoring, modes, run };

/** Deep copy for tests and what-if runs (tunables are JSON-safe plain data). */
export function cloneTunables(t: Tunables = tunables): Tunables {
  return JSON.parse(JSON.stringify(t)) as Tunables;
}
