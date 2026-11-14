import { defineFeature } from '../app/feature';
import { MODES } from '../app/modeHost';
import { ResultsRecorder, type CardModel, type RatedSkill } from '../feedback/results';
import { ResultsCard } from '../ui/resultsCard';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * End-of-run results card (design 8.2). `state()` reads whether it is open, the card's data and the
     * measured timings (ms from `runEnded` to the DOM being written, and to the next painted frame; key press
     * to the first drawn `ready` frame of the next run). `playAgain()` is the `Enter` path. `pb(n)` installs a
     * fake personal best score for the PB delta (`null` removes it).
     */
    readonly results: {
      state(): { open: boolean; card: CardModel | null; buildMs: number; appearMs: number; restartToFrameMs: number; budgetMs: number };
      playAgain(): boolean;
      pb(score: number | null): void;
    };
  }
}

/** The skill a mode moves: its only one, or the Line rating for modes that train several. */
function skillOf(mode: string): RatedSkill | null {
  const def = MODES[mode];
  if (!def || def.skills.length === 0) return null;
  return def.skills.length === 1 ? def.skills[0]! : 'line';
}

/**
 * The results card: shown over the frozen last frame inside the `runEnded` dispatch, `Enter` plays
 * again (next seed, no scene rebuild), `Esc` opens the menu. Presentation stage: the run controller
 * has already frozen its stats when this hears `runEnded`.
 */
export const feature = defineFeature({
  id: 'results',
  stage: 'presentation',
  setup(game) {
    const card = new ResultsCard(document.body, {
      onPlayAgain: (pressedAt) => void game.playAgain(pressedAt),
      onMenu: () => game.openMenu(),
      blocked: () => game.menu.isOpen,
    });

    let endedAt = 0;
    game.bus.on('runEnded', () => {
      endedAt = performance.now(); // before the recorder below builds the card
    });
    let pb: number | null = null;
    const recorder = new ResultsRecorder({
      bus: game.bus,
      run: game.run,
      ratings: game.modes.skills,
      skillOf,
      pb: { best: () => pb },
      onCard: (model) => card.show(model, endedAt),
      onNewRun: () => card.hide(),
    });
    game.onReset(() => {
      if (game.run.state !== 'result') card.hide();
    });

    game.addOverlayLines(() => {
      if (card.lastBuildMs < 0) return '';
      const key = game.lastRestartToFrameMs >= 0 ? `  play-again key->frame ${game.lastRestartToFrameMs.toFixed(1)} ms` : '';
      return `results ${card.isOpen ? 'open' : 'closed'}  built ${card.lastBuildMs.toFixed(1)} ms  painted ${card.lastAppearMs.toFixed(1)} ms${key}`;
    });
    game.addSnapshot('results', () => ({ open: card.isOpen, score: recorder.last?.scoreValue ?? null }));
    game.addDebug({
      results: {
        state: () => ({
          open: card.isOpen,
          card: recorder.last,
          buildMs: card.lastBuildMs,
          appearMs: card.lastAppearMs,
          restartToFrameMs: game.lastRestartToFrameMs,
          budgetMs: game.tunables.results.appearBudgetMs,
        }),
        playAgain: () => game.playAgain(performance.now()),
        pb(score) {
          pb = score;
        },
      },
    });
  },
});
