import { defineFeature } from '../app/feature';
import { createFightPaceStats, FightPace, type FightPaceStats } from '../feedback/fightPace';
import type { FlicklineDebug } from '../debug/hook';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Fight pace of the run now playing, or of the last one (#248, design §2.2): fights and duels per live minute,
     * the longest dead air inside a sector, gate seconds, and the targets they are judged against. A playtest records it per run.
     */
    fightPace(): FightPaceStats & { target: { fightsPerMin: number; maxDeadAirSec: number; maxGateSec: number } };
  }
}

/**
 * Fight pace in the game (#248): the same tracker the bot report uses, fed by the game's bus and
 * world, shown on the debug overlay and read by playtests through the debug hook.
 */
export const feature = defineFeature({
  id: 'fightPace',
  stage: 'tools',
  setup(game) {
    const pace = new FightPace(game.bus, game.world, game.tunables);
    const stats = createFightPaceStats();
    game.onTick(() => pace.tick());
    game.addOverlayLines(() => {
      if (game.run.state === 'idle') return '';
      const s = pace.read(stats);
      if (s.sectors === 0) return '';
      return (
        `pace ${s.fights} fights ${s.fightsPerMin.toFixed(1)}/min  duels ${s.duelsPerMin.toFixed(1)}/min` +
        `  dead air max ${s.deadAirMaxSec.toFixed(1)} s  gate max ${s.gateMaxSec.toFixed(1)} s`
      );
    });
    const snapshot = (): ReturnType<FlicklineDebug['fightPace']> => {
      const f = game.tunables.fightPace;
      return { ...pace.read(createFightPaceStats()), target: { fightsPerMin: f.targetFightsPerMin, maxDeadAirSec: f.maxDeadAirSec, maxGateSec: f.maxGateSec } };
    };
    game.addSnapshot('fightPace', snapshot);
    game.addDebug({ fightPace: snapshot });
  },
});
