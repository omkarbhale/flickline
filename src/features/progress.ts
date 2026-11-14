import { defineFeature } from '../app/feature';
import { SKILL_IDS } from '../config/dial';
import type { MedalId } from '../config/medals';
import { endOfRunMedals } from '../feedback/medals';
import { bandOf, summariseRun } from '../progress/bests';
import { subTierInfo, subTierOf } from '../progress/ranks';
import { RunPace, RunRecorder, situationStats } from '../progress/runRecords';
import { SAVE_VERSION, type ProgressData, type RouteTile, type RunBest } from '../progress/save';
import { parseSave } from '../settings/saveData';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The progress save (design 14.5) for playtests. `state()` summarises it (where it persists, plays, run bests per
     * band, drill bests, situation records, ranks, medals, history length). `pace()` reads the pace bar's numbers now.
     * `fakeBest()` stores a best run for a dial's band with `sectors` sectors that each earn `score / sectors`, so the
     * pace bar can be looked at without playing a run for it. `situations()` lists the situation records.
     * `exportText()` is the file's text; `importText()` validates and applies one (no reload); `reset()` clears the save.
     */
    readonly progress: {
      state(): unknown;
      pace(): { score: number; reference: number } | null;
      fakeBest(dial: number, score: number, sectors?: number): void;
      situations(): Record<string, { contacts: number; winRate: number | null; keptMean: number | null }>;
      exportText(): string;
      importText(text: string): { ok: boolean; error?: string };
      reset(): void;
    };
  }
}

/**
 * Persistence and the ranked parts of progress (#38, #217). At `runReady` it arms the pace bar with the best run of
 * the run's dial band as it stood before the run; during the run the recorder folds the run's events (sectors,
 * contacts and their cards, score, the Flawless marks) into a route strip; at `runEnded` it settles Quick Study,
 * updates the ranks (Ascent) and records the run: history, run count and, for a run mode, the band's run records and
 * the situation records. A quit keeps only its contacts. The skill posterior is saved after each run. A producer,
 * so its medals reach the results card (a presentation feature) built in the same dispatch.
 */
export const feature = defineFeature({
  id: 'progress',
  stage: 'producer',
  setup(game) {
    const cfg = game.tunables.progress;
    const bus = game.bus;
    const store = game.progress;
    const skills = game.modes.skills;
    const health = game.world.health;
    const recorder = new RunRecorder(() => health.hp + health.shield, game.tunables.sweep.finaleSector);
    const pace = new RunPace(recorder);
    const earned: string[] = [];
    const medalPayload = { tick: 0, id: '' as string };
    let savedTrials = -1;

    const trialTotal = (): number => SKILL_IDS.reduce((n, s) => n + skills.trialCount(s), 0);
    const award = (id: MedalId, tick: number): void => {
      medalPayload.tick = tick;
      medalPayload.id = id;
      bus.emit('medalAwarded', medalPayload);
    };

    game.hud.live.setPace(pace);

    bus.on('runReady', (e) => {
      recorder.begin(e.seed, e.dial);
      earned.length = 0;
      if (cfg.runModes.includes(e.mode)) pace.arm(store.bestRun(e.dial));
      else pace.clear();
    });
    bus.on('scoreAwarded', (e) => recorder.scored(e.total));
    bus.on('sectorEntered', (e) => recorder.sectorEntered(e));
    bus.on('sectorEnded', (e) => recorder.sectorEnded(e));
    bus.on('contactSettled', (e) => recorder.contactSettled(e));
    bus.on('medalAwarded', (e) => {
      earned.push(e.id);
      recorder.medal(e.id);
      store.addMedal(e.id, new Date().toISOString());
    });

    bus.on('runEnded', (e) => {
      const modeId = game.modes.modeId;
      if (modeId === null) return;
      const isRun = cfg.runModes.includes(modeId);
      const trials = trialTotal();
      if (e.reason === 'quit') {
        // Not a finished run: nothing to record, but the trials already played still sharpened the rating, and the
        // fights already fought still say how the player does in each situation.
        if (isRun) store.recordContactsOnly(recorder.finish(game.modes.runner.stats.score));
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
      for (const id of endOfRunMedals({ medianRtMs: stats.medianRtMs, timedTargets: timed, previousMedianRtMs: previous }, game.tunables.medals)) {
        award(id, e.tick);
      }

      store.batch(() => {
        const subs: { key: string; sub: number }[] = [];
        for (const s of SKILL_IDS) if (skills.trialCount(s) > 0) subs.push({ key: s, sub: subTierOf(skills.rating(s), game.tunables.dial) });
        if (subs.length > 0) subs.push({ key: 'line', sub: subTierOf(skills.rating('line'), game.tunables.dial) });
        if (store.updateRanks(subs)) award('ascent', e.tick);
        store.setRatings(skills.serialize());
        savedTrials = trials;
        store.recordRun(
          summariseRun(stats, score, new Date().toISOString(), earned),
          isRun ? recorder.finish(score) : null,
          // The Daily Route's date goes here when that route exists (design §4.8); until then no run is the day's.
          null,
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
      paceArmed: pace.armed,
    }));
    game.addDebug({
      progress: {
        state() {
          const d = store.snapshot;
          const runBests: Record<string, unknown> = {};
          for (const band of Object.keys(d.runBests)) {
            const r = d.runBests[band]!;
            runBests[band] = { best: r.best?.score ?? null, depth: r.deepest?.depth ?? null, finalesCleared: r.finalesCleared };
          }
          const drillBests: Record<string, Record<string, number>> = {};
          for (const mode of Object.keys(d.drillBests)) {
            drillBests[mode] = {};
            for (const band of Object.keys(d.drillBests[mode]!)) drillBests[mode]![band] = d.drillBests[mode]![band]!.score;
          }
          const ranks: Record<string, string> = {};
          for (const k of Object.keys(d.ranks)) ranks[k] = `${subTierInfo(d.ranks[k]!.at, game.tunables.dial).label} (peak ${subTierInfo(d.ranks[k]!.peak, game.tunables.dial).label})`;
          const medals: Record<string, number> = {};
          for (const k of Object.keys(d.medals)) medals[k] = d.medals[k]!.count;
          return {
            version: SAVE_VERSION, persistence: store.persistence, plays: { ...d.plays }, runBests, drillBests,
            dailyBests: Object.keys(d.dailyBests).length, situations: Object.keys(d.situations).length, ranks, medals,
            history: d.history.length, last: d.history[d.history.length - 1] ?? null, flaggedSkill: d.flaggedSkill,
            ratingsSaved: d.ratings !== null,
          };
        },
        pace: () => {
          const p = pace.pace();
          return p === null ? null : { score: p.score, reference: p.reference };
        },
        situations() {
          const out: Record<string, { contacts: number; winRate: number | null; keptMean: number | null }> = {};
          for (const card of Object.keys(store.snapshot.situations)) {
            const s = situationStats(store.snapshot.situations[card]);
            out[card] = { contacts: s.contacts, winRate: s.winRate, keptMean: s.keptMean };
          }
          return out;
        },
        fakeBest(dial, score, sectors = 4) {
          const strip: RouteTile[] = [];
          const pacePts: number[] = [];
          for (let i = 1; i <= sectors; i++) {
            strip.push({ index: i, role: 'take', condition: 'full', stake: 'plain', won: 2, lost: 0, hpIn: 100, hpOut: 80, cleared: true, flawless: false });
            pacePts.push(Math.round((score * i) / sectors));
          }
          const rec: RunBest = { score, depth: sectors, cleared: sectors, seed: 0, date: new Date().toISOString(), dial, strip, pace: pacePts };
          const data: ProgressData = store.exportData();
          data.runBests[bandOf(dial, cfg)] = { best: rec, deepest: rec, finalesCleared: 0 };
          store.replace(data);
          if (game.modes.modeId !== null && cfg.runModes.includes(game.modes.modeId)) pace.arm(rec);
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
