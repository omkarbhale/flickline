import { defineFeature } from '../app/feature';
import { SCENARIO_CARD_IDS } from '../config/scenario';
import { Rng } from '../core/rng';
import { ALL_CARDS, CARD_COUNT, NO_CARD, ScenarioSampler, cardData } from '../modes/scenario';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The scenario cards and the seeded sampler (#97, design §4.4) for playtests and the bot harness. `cards()` lists the ten
     * cards as data. `mix(seed, n, winRate)` deals `n` contacts (every card allowed, the player winning each with probability
     * `winRate`, default 1) and reports each card's share against its target, the distinct cards, the longest run of one
     * card, and the known-duel and flank shares. Pure: it touches no run.
     */
    readonly scenario: {
      cards(): ReturnType<typeof cardData>[];
      mix(seed?: number, n?: number, winRate?: number): {
        n: number;
        shares: Record<string, { share: number; target: number }>;
        distinct: number;
        longestRun: number;
        maxDeviationPoints: number;
        knownDuelShare: number;
        flankShare: number;
      };
    };
  }
}

export const feature = defineFeature({
  id: 'scenario',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      scenario: {
        cards: () => SCENARIO_CARD_IDS.map((_, i) => ({ ...cardData(i) })),
        mix(seed = 1, n = 1000, winRate = 1) {
          const cfg = game.tunables.scenario;
          const s = new ScenarioSampler(cfg, game.tunables.lean, seed);
          const outcome = new Rng(seed ^ 0x5bd1e995);
          const counts = new Array<number>(CARD_COUNT).fill(0);
          let wonLast = false;
          let run = 0;
          let longest = 0;
          let prev = NO_CARD;
          for (let i = 0; i < n; i++) {
            const c = s.draw(ALL_CARDS, wonLast);
            if (c === NO_CARD) continue;
            counts[c]!++;
            run = c === prev ? run + 1 : 1;
            prev = c;
            if (run > longest) longest = run;
            wonLast = outcome.next() < winRate;
            s.record(c, wonLast);
          }
          const shares: Record<string, { share: number; target: number }> = {};
          let worst = 0;
          SCENARIO_CARD_IDS.forEach((id, i) => {
            const share = counts[i]! / n;
            shares[id] = { share, target: cfg.mix[id] };
            worst = Math.max(worst, Math.abs(share - cfg.mix[id]));
          });
          return {
            n, shares, distinct: s.distinct, longestRun: longest, maxDeviationPoints: worst * 100,
            knownDuelShare: shares['known-duel']!.share, flankShare: shares['flank']!.share,
          };
        },
      },
    });
  },
});
