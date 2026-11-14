import { defineFeature } from '../app/feature';
import { SKILL_IDS } from '../config/dial';
import type { MedalId } from '../config/medals';
import { endOfRunMedals } from '../feedback/medals';
import { bandOf, GhostPace, ScoreCurve, summariseRun } from '../progress/bests';
import { subTierInfo, subTierOf } from '../progress/ranks';
import { SAVE_VERSION, type BestRecord, type ProgressData } from '../progress/save';
import { parseSave } from '../settings/saveData';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The progress save (design 14.5) for playtests. `state()` summarises it (where it persists, plays, bests per
     * mode and band, ranks, medals, history length). `ghost(mode, t)` reads the live ghost's score. `fakeBest()`
     * stores a personal best whose score rises in a straight line, so the ghost-pace bar can be looked at
     * without playing a run for it. `exportText()` is the file's text; `importText()` validates and applies one
     * (no reload); `reset()` clears the save.
     */
    readonly progress: {
      state(): unknown;
      ghost(mode: string, tSec: number): number | null;
      fakeBest(mode: string, dial: number, score: number, durationSec?: number): void;
      exportText(): string;
      importText(text: string): { ok: boolean; error?: string };
      reset(): void;
    };
  }
}

/**
 * Persistence and the ranked parts of progress (issue #38). At `runReady` it arms the ghost with the personal
 * best of the run's mode and band as it stood before the run; during the run it records the score curve; at
 * `runEnded` it settles the end-of-run medals (Flawless, Quick Study), updates the ranks (Ascent) and records
 * the run: history, run count and a personal best with its curve. The skill posterior is saved after each
 * run. A producer, so its medals reach the results card (a presentation feature) built in the same dispatch.
 */
export const feature = defineFeature({
  id: 'progress',
  stage: 'producer',
  setup(game) {
    const cfg = game.tunables.progress;
    const bus = game.bus;
    const store = game.progress;
    const skills = game.modes.skills;
    const ghost = new GhostPace(cfg.curveStepSec);
    const curve = new ScoreCurve(cfg.curveStepSec, cfg.curveMaxSamples);
    const earned: string[] = [];
    const medalPayload = { tick: 0, id: '' as string };
    let savedTrials = -1;

    const trialTotal = (): number => SKILL_IDS.reduce((n, s) => n + skills.trialCount(s), 0);
    const award = (id: MedalId, tick: number): void => {
      medalPayload.tick = tick;
      medalPayload.id = id;
      bus.emit('medalAwarded', medalPayload);
    };

    game.hud.live.setPersonalBest(ghost);

    bus.on('runReady', (e) => {
      curve.reset();
      earned.length = 0;
      ghost.arm(e.mode, cfg.noBestModes.includes(e.mode) ? null : store.bestAt(e.mode, e.dial));
    });
    bus.on('scoreAwarded', (e) => curve.record(e.t, e.total));
    bus.on('medalAwarded', (e) => {
      earned.push(e.id);
      store.addMedal(e.id, new Date().toISOString());
    });

    bus.on('runEnded', (e) => {
      const modeId = game.modes.modeId;
      if (modeId === null) return;
      const trials = trialTotal();
      if (e.reason === 'quit') {
        // Not a finished run: nothing to record, but the trials already played still sharpened the rating.
        if (trials !== savedTrials) store.setRatings(skills.serialize());
        savedTrials = trials;
        return;
      }
      const stats = game.run.liveStats();
      const score = game.modes.runner.stats.score;
      const previous: number[] = [];
      for (const h of store.snapshot.history) if (h.mode === modeId && h.medianRtMs !== null) previous.push(h.medianRtMs);
      let timed = 0;
      for (const t of stats.targets) if (t.rtMs !== null) timed++;
      for (const id of endOfRunMedals({
        mode: modeId,
        fullRun: e.reason === 'timer' || e.reason === 'complete',
        hits: stats.hits, misses: stats.misses, movingShots: stats.movingShots,
        medianRtMs: stats.medianRtMs, timedTargets: timed, previousMedianRtMs: previous,
      }, game.tunables.medals)) award(id, e.tick);

      store.batch(() => {
        const subs: { key: string; sub: number }[] = [];
        for (const s of SKILL_IDS) if (skills.trialCount(s) > 0) subs.push({ key: s, sub: subTierOf(skills.rating(s), game.tunables.dial) });
        if (subs.length > 0) subs.push({ key: 'line', sub: subTierOf(skills.rating('line'), game.tunables.dial) });
        if (store.updateRanks(subs)) award('ascent', e.tick);
        store.setRatings(skills.serialize());
        savedTrials = trials;
        store.recordRun(
          summariseRun(stats, score, new Date().toISOString(), earned),
          curve.finish(stats.durationSec),
        );
      });
    });

    // A medal earned mid-run is only marked in memory (no storage write in the middle of a fight): flush on the way out.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => store.commit());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') store.commit();
      });
    }

    game.addSnapshot('progress', () => ({
      persistence: store.persistence,
      history: store.snapshot.history.length,
      ghostArmed: ghost.scoreAt(game.modes.modeId ?? '', 0) !== null,
    }));
    game.addDebug({
      progress: {
        state() {
          const d = store.snapshot;
          const bests: Record<string, Record<string, number>> = {};
          for (const mode of Object.keys(d.bests)) {
            bests[mode] = {};
            for (const band of Object.keys(d.bests[mode]!)) bests[mode]![band] = d.bests[mode]![band]!.score;
          }
          const ranks: Record<string, string> = {};
          for (const k of Object.keys(d.ranks)) ranks[k] = `${subTierInfo(d.ranks[k]!.at, game.tunables.dial).label} (peak ${subTierInfo(d.ranks[k]!.peak, game.tunables.dial).label})`;
          const medals: Record<string, number> = {};
          for (const k of Object.keys(d.medals)) medals[k] = d.medals[k]!.count;
          return {
            version: SAVE_VERSION, persistence: store.persistence, plays: { ...d.plays }, bests, ranks, medals,
            history: d.history.length, last: d.history[d.history.length - 1] ?? null, flaggedSkill: d.flaggedSkill,
            ratingsSaved: d.ratings !== null,
          };
        },
        ghost: (mode, t) => ghost.scoreAt(mode, t),
        fakeBest(mode, dial, score, durationSec = 60) {
          const n = Math.ceil(durationSec / cfg.curveStepSec);
          const c: number[] = [];
          for (let i = 0; i <= n; i++) c.push(Math.round((score * i) / n));
          const rec: BestRecord = {
            score, seed: 0, date: new Date().toISOString(), dial,
            stats: { shots: 0, hits: 0, headHits: 0, kills: 0, movingShots: 0, accuracy: null, headshotRate: null, medianRtMs: null, medianTtkMs: null, maxChain: 0, cleanKills: 0 },
            curve: c,
          };
          const data: ProgressData = store.exportData();
          (data.bests[mode] ??= {})[bandOf(dial, cfg)] = rec;
          store.replace(data);
          if (game.modes.modeId === mode) ghost.arm(mode, rec);
        },
        exportText: () => game.exportSave(),
        importText(text) {
          const r = parseSave(text);
          if (!r.ok) return { ok: false, error: r.error };
          game.importSave(r.parts);
          return { ok: true };
        },
        reset: () => store.reset(),
      },
    });
  },
});
