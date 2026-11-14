import { vec3 } from '../core/vec3';
import type { TargetTunables } from '../config/targets';
import type { LevelDef, TargetState } from './types';

/** (Re)build the target list from a level's spawn points. Mutates `out` in place. */
export function levelTargetsReset(out: TargetState[], level: LevelDef, tt: TargetTunables): void {
  out.length = 0;
  for (let i = 0; i < level.targets.length; i++) {
    const s = level.targets[i]!;
    out.push({
      id: i,
      home: vec3(s.pos.x, s.pos.y, s.pos.z),
      pos: vec3(s.pos.x, s.pos.y, s.pos.z),
      radius: tt.radius,
      hp: tt.maxHp,
      maxHp: tt.maxHp,
      alive: true,
      respawnTick: 0,
      lastHitTick: -1,
      kind: 'post',
      visible: false,
    });
  }
}
