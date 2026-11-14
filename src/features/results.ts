import { defineFeature } from '../app/feature';
import { MODES } from '../app/modeHost';
import { scriptedRun } from '../debug/scriptedSweep';
import { PLACEMENT_MODE } from '../modes/placement';
import '../feedback/cuePlanner'; // declares the cueScheduleSet event
import { ArmourNoteTracker } from '../feedback/armourNoteTracker';
import { ResultsRecorder, type CardModel, type RatedSkill } from '../feedback/results';
import { RunStoryTracker, storyConfigFrom } from '../feedback/runStory';
import { keyLabel } from '../settings/keys';
import { ResultsCard } from '../ui/resultsCard';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * End-of-run results card (design 8.2). `state()` reads whether it is open, the card's data and the
     * measured timings (ms from `runEnded` to the DOM being written, and to the next painted frame; key press
     * to the first drawn `ready` frame of the next run). `playAgain()` is the `Enter` path (a new run on a new
     * seed) and `replay()` the `R` path (this seed again). `pb(n)` installs a
     * fake personal best score for the PB line (`null` = no personal best yet).
     */
    readonly results: {
      state(): { open: boolean; card: CardModel | null; buildMs: number; appearMs: number; restartToFrameMs: number; budgetMs: number };
      playAgain(): boolean;
      replay(): boolean;
      pb(score: number | null): void;
      /**
       * Play a scripted, seeded Sweep run (sectors, contacts with their cards, kills, damage) through the event bus and
       * end it, so the card can be looked at without a playthrough. `reason` is how it ends (default `death`);
       * `cause` stands in for the death cause line (#123) until the attribution engine provides one.
       * Returns the sectors entered and the points scored.
       */
      demo(opts?: { seed?: number; sectors?: number; reason?: string; cause?: string; damageScale?: number }): { sectors: number; score: number };
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
 * a new run (next seed, no scene rebuild), `R` replays the seed, `Esc` opens the menu. Presentation stage: the run controller
 * has already frozen its stats when this hears `runEnded`.
 */
export const feature = defineFeature({
  id: 'results',
  stage: 'presentation',
  setup(game) {
    const card = new ResultsCard(document.body, {
      onPlayAgain: (pressedAt) => void game.playAgain(pressedAt),
      onReplay: (pressedAt) => void game.replaySeed(pressedAt),
      onMenu: () => game.openMenu(),
      blocked: () => game.menu.isOpen,
      isConfirm: (code) => game.settings.get().keys.confirm.includes(code),
    });
    const showConfirmKey = (): void => {
      const c = game.settings.get().keys.confirm[0];
      card.setConfirmLabel(c === undefined ? '' : keyLabel(c));
    };
    showConfirmKey();
    game.bus.on('settingsChanged', ({ changed }) => {
      if (changed.includes('keys')) showConfirmKey();
    });

    let endedAt = 0;
    game.bus.on('runEnded', () => {
      endedAt = performance.now(); // before the recorder below builds the card
    });
    // Whether the run now playing is the session's clean run (design §7.4), told by the cue planner's event.
    let clean = false;
    game.bus.on('cueScheduleSet', (e) => {
      clean = e.clean;
    });
    // The best the run has to beat, read at `runReady`: the progress producer records the run (and a new best)
    // before this presentation feature builds the card, so reading it at `runEnded` would compare a run with itself.
    let before: number | null = null;
    // A playtest's fake best (`results.pb`); undefined = the real one.
    let fake: number | null | undefined;
    // A playtest's stand-in death cause line (`results.demo`), until the attribution engine (#123) provides one.
    let fakeCause: string | null = null;
    const runModes = game.tunables.progress.runModes;
    game.bus.on('runReady', (e) => {
      // The Daily Route compares with the day best instead of the run best (design §4.8, §8.2).
      before = !runModes.includes(e.mode) ? null : game.dailyKey !== null ? (game.progress.dailyBest(game.dailyKey)?.score ?? null) : (game.progress.bestRun(e.dial)?.score ?? null);
    });
    // The run's story (route strip, fights by situation) is folded from the run director's facts (#201, design §14.3:
    // `sectorEntered`, `sectorEnded`, `contactSettled` with its card, `runBanked`) and the player's health events. The
    // tracker reads them through its own structural event map, so it depends on none of the director's code.
    const story = new RunStoryTracker(storyConfigFrom(game.tunables.player, game.tunables.results.run.routeSectors, game.tunables.results.run.maxSectors));
    game.bus.onAny((type, payload) => {
      if (RunStoryTracker.reads(type)) story.ingest(type, payload as never);
    });
    // What the shield changed in a kill (the armour note, and the eco note in an eco sector), named on the card.
    const armour = new ArmourNoteTracker({
      weapon: () => {
        const w = game.tunables.weapon[game.world.loadout[game.world.weapon.active]!];
        return { name: w.name, bands: w.damageBands };
      },
      maxHp: game.tunables.player.health.max,
      absorb: game.tunables.player.shield.absorb,
      fullShield: game.tunables.player.shield.heavy,
    });
    game.bus.on('runReady', () => armour.reset());
    game.bus.on('sectorEntered', (e) => armour.sectorEntered(e.condition));
    game.bus.on('targetKilled', (e) => armour.killed(e.zone, e.distance, e.shield));
    const recorder = new ResultsRecorder({
      story,
      notes: () => armour.notes(),
      bus: game.bus,
      run: game.run,
      deathCause: () => fakeCause,
      // The running record per scenario card (#217): the progress producer has already added this run's contacts.
      situationHistory(cardId) {
        const r = game.progress.situation(cardId, game.tunables.progress.situationWindow);
        return r.contacts > 0 ? { won: r.wins, played: r.contacts } : null;
      },
      ratings: game.modes.skills,
      skillOf,
      pb: { best: () => (fake === undefined ? before : fake), keepsBest: (mode) => runModes.includes(mode) },
      onCard: (model) => {
        card.show(model, endedAt);
      },
      onNewRun: () => card.hide(),
      isClean: () => clean,
      dailyDate: () => game.dailyKey,
      firstRating: (mode) => mode === PLACEMENT_MODE,
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
        replay: () => game.replaySeed(performance.now()),
        pb(score) {
          fake = score;
        },
        demo(opts = {}) {
          fakeCause = opts.cause ?? null;
          const { events, expect } = scriptedRun(opts.seed ?? 7, opts.sectors ?? 6, opts.reason ?? 'death', game.world.tick, opts.damageScale);
          const score = expect.kills * 150;
          for (const e of events) {
            // The scripted events are in the run's own vocabulary; `scoreAwarded` is the mode framework's total.
            if (e.type === 'runEnded') game.bus.emit('scoreAwarded' as never, { total: score } as never);
            game.bus.emit(e.type as never, e.data as never);
          }
          return { sectors: expect.sectors.length, score };
        },
      },
    });
  },
});
