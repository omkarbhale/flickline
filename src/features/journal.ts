import { defineFeature } from '../app/feature';
import { journalLine, journalMeasures, summariseJournal, type JournalMeasures } from '../progress/journalMeasures';
import type { PlayJournal } from '../progress/journal';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The play journal (#251, design §14.5): when and how the game was played, local only. `state()` reads the journal as
     * saved; `measures()` the playtest's repeat-enjoyment numbers; `line()` the one line the Data group shows. `setNow(ms)`
     * makes the journal's clock read `ms` (null: the real one), to look at a session gap or a day change without waiting.
     */
    readonly journal: {
      state(): PlayJournal;
      measures(): JournalMeasures;
      line(): string;
      setNow(ms: number | null): void;
    };
  }
}

/**
 * Feeds the run's events to the play journal (`progress/journal.ts`, #251): `runReady`, `runStarted`, `sectorEntered` (the
 * run's depth) and `runEnded`, for run modes only (Sweep and its Daily Route; a fixture mode is not play the player chose).
 * Nothing is sent anywhere and nothing reads the journal to change play: it is a record the player owns and exports.
 *
 * The writes are deferred (no storage write mid-fight). A finished run is written by the progress feature's batch in the same
 * `runEnded` dispatch (it runs right after this one: producers go by id); a quit is written here; `pagehide` flushes the rest.
 */
export const feature = defineFeature({
  id: 'journal',
  stage: 'producer',
  setup(game) {
    const store = game.progress;
    const cfg = game.tunables.progress;
    const now = (): number => game.now();
    let counting = false;

    game.bus.on('runReady', (e) => {
      counting = cfg.runModes.includes(e.mode);
      if (counting) store.journalReady(now());
    });
    game.bus.on('runStarted', () => {
      if (counting) store.journalStarted(now());
    });
    game.bus.on('sectorEntered', (e) => {
      if (counting) store.journalSector(e.index);
    });
    game.bus.on('runEnded', (e) => {
      if (!counting) return;
      store.journalEnded(now(), e.t, e.reason);
      if (e.reason === 'quit') store.commit();
    });

    game.addSnapshot('journal', () => ({ sessions: store.journal.sessions.length, runs: store.journal.runs.length, days: store.journal.days.length }));
    game.addDebug({
      journal: {
        state: () => JSON.parse(JSON.stringify(store.journal)) as PlayJournal,
        measures: () => journalMeasures(store.journal),
        line: () => journalLine(summariseJournal(store.journal, now(), cfg.journal)),
        setNow: (ms) => game.setNow(ms),
      },
    });
  },
});
