import type { BehaviourContext } from './fsm';
import type { TargetField } from './targets';
import type { LevelDef } from './types';

/**
 * (Re)build the target field from a level's spawn points: empties the registry, then places each
 * spawn point's target silently (reset / level load announces nothing; the run layer decides).
 * Level-placed targets respawn after a kill.
 */
export function levelTargetsReset(field: TargetField, level: LevelDef, ctx: BehaviourContext): void {
  field.clear();
  field.placeLevel(level.targets, ctx);
}
