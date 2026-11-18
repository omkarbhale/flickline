import { coldScore } from '../adaptive/coldScore';
import { defineFeature } from '../app/feature';
import { MODES } from '../app/modeHost';
import { ColdOpenerTally } from '../feedback/coldOpenerTally';
import { firstColdLevel, isColdOpenerDue, pickColdOpener } from '../modes/coldOpener';
import { SWEEP_MODE } from '../modes/sweep';
import {
  buildColdRecord, coldTrend, readColdLevel, readColdRecords, replayColdLevel, stepColdLevel, validRecords, type ColdLevelState, type ColdOpenerRecord,
  type ColdTrend,
} from '../progress/coldOpeners';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The cold opener (design 8.5, #209). `state()`: whether one is due now and at which level, whether one is
     * being played, the newest record and the trend. `due(lastRunEndMs, nowMs?)`: the due rule alone.
     * `plan(level, seed?)`: the legs a run on that seed would play at that level. `force(level)`: the next Sweep
     * run opens with a cold opener at `level` whatever the due rule says (`null`: never; `undefined`: back to the
     * rule). `warm(yes)`: answer the warm question for the newest record. `records()`: every stored record.
     * `referenceLike()`: whether the reference-like presentation is on.
     */
    readonly coldOpener: {
      state(): unknown;
      due(lastRunEndMs: number | null, nowMs?: number): boolean;
      plan(level: number, seed?: number): unknown;
      force(level: number | null | undefined): void;
      warm(yes: boolean): boolean;
      records(): ColdOpenerRecord[];
      referenceLike(): boolean;
    };
  }
}

/**
 * The cold opener at run time (design 8.5, 7.4): decides whether a Sweep run opens with one (the due rule over
 * the save's finished runs and cold openers, the player's level), folds its events into a record when it ends
 * for real (a quit offers it again), stores it with the level's 3-of-5 moves, and asks the warm question on the
 * results card (`Y`). While its legs are played the run is a clean opener with the reference-like presentation:
 * no coaching cues or added tells, and none of the rewards the reference game lacks (clock, score and streak
 * counters, floating points, pulse, reward sounds); the shot, the target's reaction and the hit and kill sounds
 * stay. Cues and rewards come back when the opener ends. A producer, so the presentation is set before the
 * presentation features hear the run's first events, and the record exists before the results card is built.
 */
export const feature = defineFeature({
  id: 'coldOpener',
  stage: 'producer',
  setup(game) {
    const cfg = game.tunables.coldOpener;
    const store = game.progress;
    const options = game.feedbackOptions;
    const tally = new ColdOpenerTally();
    let forced: number | null | undefined;
    /** The reference-like presentation of the cold opener is on (its legs are being played). */
    let cold = false;
    /** What the cue plan had before the cold opener took over (restored when it ends). */
    let savedClean = false;
    let savedPhase = options.cuePhase;
    /** This run made a record: the warm question is asked on its results card. */
    let asked = false;

    const records = (): ColdOpenerRecord[] => readColdRecords(store.snapshot.coldOpeners);
    const levelState = (): ColdLevelState | null => readColdLevel(store.snapshot.coldOpenerLevels, cfg.version);
    /** When the player last finished a run or a cold opener (wall-clock ms), or null. */
    const lastActivityMs = (): number | null => {
      const h = store.snapshot.history;
      const recs = store.snapshot.coldOpeners;
      let last = Number.NEGATIVE_INFINITY;
      const run = h.length > 0 ? Date.parse(h[h.length - 1]!.date) : Number.NaN;
      if (Number.isFinite(run)) last = run;
      const at = recs.length > 0 ? Date.parse(String(recs[recs.length - 1]!.at ?? '')) : Number.NaN;
      if (Number.isFinite(at) && at > last) last = at;
      return Number.isFinite(last) ? last : null;
    };
    const levelNow = (): number => levelState()?.level ?? firstColdLevel(game.modes.skills.rating('line'), cfg);
    const dueNow = (): boolean => store.snapshot.history.length >= cfg.minRuns && isColdOpenerDue(lastActivityMs(), Date.now(), cfg.gapHours);

    game.modes.coldOpenerFor = (modeId) => {
      if (modeId !== SWEEP_MODE) return null;
      if (forced !== undefined) return forced;
      return dueNow() ? levelNow() : null;
    };

    // Reference-like presentation: the mode's own flag (a mode that is always measured) or the cold opener's legs.
    const sync = (): void => {
      const on = cold || MODES[game.modes.modeId ?? '']?.referenceLike === true;
      if (on === (options.referenceLike === true)) return;
      options.referenceLike = on;
      game.hud.root.classList.toggle('ref-like', on);
    };
    const coldOn = (on: boolean): void => {
      if (on === cold) return;
      cold = on;
      if (on) {
        savedClean = options.clean === true;
        savedPhase = options.cuePhase;
        // The cold opener is always a clean opener (design 7.4): no coaching cues, no added tells, reference-like HUD.
        options.clean = true;
        options.cuePhase = 'summary';
        game.hud.root.classList.add('hud-clean');
      } else {
        options.clean = savedClean;
        options.cuePhase = savedPhase;
        game.hud.root.classList.toggle('hud-clean', savedClean);
      }
      sync();
    };

    const bus = game.bus;
    bus.on('runReady', () => {
      tally.cancel();
      cold = false;
      asked = false;
      hidePrompt();
      sync();
    });
    game.onReset(sync);
    bus.on('coldOpenerStarted', (e) => {
      tally.begin(e);
      coldOn(true);
    });
    bus.on('skillTrial', (e) => tally.trial(e));
    bus.on('shotFired', (e) => tally.shot(e.moving));
    bus.on('targetKilled', (e) => tally.kill(e));
    bus.on('contactSettled', (e) => tally.settled(e.outcome));
    bus.on('coldOpenerEnded', (e) => {
      const outcome = tally.end(e);
      coldOn(false);
      if (!outcome) return; // quit: offered again
      const now = new Date();
      const before = lastActivityMs();
      const score = coldScore(outcome.trials, cfg, game.tunables.dial);
      const rec = buildColdRecord(outcome, score, {
        date: game.today(),
        at: now.toISOString(),
        gapH: before === null ? null : (now.getTime() - before) / 3_600_000,
        sens: game.settings.get().sensitivity,
      });
      const all = [...records(), rec];
      const state = stepColdLevel(levelState() ?? { v: cfg.version, level: rec.level, moves: [] }, all, cfg);
      store.addColdOpener(rec, state);
      asked = true;
    });
    bus.on('runEnded', (e) => {
      // The record was kept in memory since the opener ended mid-run: write it now (also after a quit later in the run).
      if (asked) store.commit();
      // A run quit inside the cold opener: its `coldOpenerEnded` (quit) already restored the cues; nothing to ask.
      if (e.reason === 'quit' || !asked) return;
      showPrompt();
    });

    // ---- the warm question on the results card (transfer.md 5.1: asked after the run, one optional key) ----
    let prompt: HTMLElement | null = null;
    const promptEl = (): HTMLElement | null => {
      if (prompt?.isConnected) return prompt;
      prompt = document.querySelector<HTMLElement>('#results [data-k="cold"]');
      return prompt;
    };
    const render = (): void => {
      const el = promptEl();
      const last = records().at(-1);
      if (!el || !last) return;
      const answer = last.warm ? 'Yes: kept out of your trend.' : 'No';
      el.innerHTML = `Cold opener measured. Aimed in any game in the last hour? <kbd>Y</kbd> <span>${answer}</span>`;
      el.hidden = false;
    };
    function showPrompt(): void {
      // The results card is built in this same dispatch, after this producer: write the line once it exists.
      queueMicrotask(render);
    }
    function hidePrompt(): void {
      const el = promptEl();
      if (el) el.hidden = true;
    }
    window.addEventListener('keydown', (e) => {
      if (!asked || e.code !== 'KeyY' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (game.run.state !== 'result' || game.menu.isOpen) return;
      const last = records().at(-1);
      if (!last) return;
      setWarm(!last.warm);
      render();
    });
    function setWarm(yes: boolean): boolean {
      if (!store.setColdOpenerWarm(yes)) return false;
      // What counted for the level may have changed: replay the level from the series.
      const state = levelState();
      if (state) store.setColdOpenerLevel(replayColdLevel(state, records(), cfg));
      return true;
    }

    const trendNow = (): ColdTrend => coldTrend(validRecords(records(), cfg.version).map((r) => r.dial), cfg);
    game.addOverlayLines(() => (cold ? `cold opener level ${tally.currentLevel}: clean, reference-like` : ''));
    game.addSnapshot('coldOpener', () => ({ active: cold, due: dueNow(), level: levelNow(), records: store.snapshot.coldOpeners.length }));
    game.addDebug({
      coldOpener: {
        state: () => ({
          due: dueNow(),
          level: levelNow(),
          forced: forced ?? null,
          active: cold,
          clean: options.clean === true,
          referenceLike: options.referenceLike === true,
          lastActivity: lastActivityMs(),
          records: store.snapshot.coldOpeners.length,
          last: records().at(-1) ?? null,
          levelState: levelState(),
          trend: trendNow(),
        }),
        due: (lastRunEndMs, nowMs = Date.now()) => isColdOpenerDue(lastRunEndMs, nowMs, cfg.gapHours),
        plan: (level, seed = game.world.seed) =>
          pickColdOpener(seed, level, undefined, cfg).legs.map((l) => ({ slot: l.slot, variant: l.variant, mirrored: l.mirrored, map: l.contact.map, sector: l.contact.sector, card: l.contact.card })),
        force: (level) => {
          forced = level;
        },
        warm: (yes) => setWarm(yes),
        records: () => records(),
        referenceLike: () => options.referenceLike === true,
      },
    });
  },
});
