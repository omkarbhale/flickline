import { defineFeature } from '../app/feature';
import { MODES } from '../app/modeHost';
import { tellCueAt } from '../adaptive/dial';
import { CUE_PHASES, type CuePhase } from '../config/cues';
import type { SkillId } from '../config/dial';
import { effectivePhase, tellStrength } from '../feedback/cueGate';
import { CuePlanner, createCuePlan, type CuePlan } from '../feedback/cuePlanner';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Fading coaching cues (design §7.4, issue #129). `state()` reads the live schedule (phase, whether
     * the run is clean, the posterior it came from, tell strength at a dial); `phase(p)` forces a phase
     * until the next run starts (`null` returns to the planned one); `clean(on)` forces the clean-run
     * look the same way; `surge(on)` brings the tells back as Surge will.
     */
    readonly cues: {
      state(dial?: number): unknown;
      phase(p: CuePhase | null): void;
      clean(on: boolean): void;
      surge(on: boolean): void;
    };
  }
}

/** The skill a mode trains: its only one, or the Line rating for modes that train several; null for a run that moves no rating. */
function skillOf(mode: string): SkillId | 'line' | null {
  const def = MODES[mode];
  if (!def || def.skills.length === 0) return null;
  return def.skills.length === 1 ? def.skills[0]! : 'line';
}

/**
 * Cue fading: at each run start decides how often the per-event coaching cues speak (from the
 * skill posterior) and whether this is the session's one clean run, and writes that into the shared
 * feedback options the HUD, shot cues and sound map read. Producer stage: the plan is set before any
 * presentation reacts to the run's first events.
 */
export const feature = defineFeature({
  id: 'cues',
  stage: 'producer',
  setup(game) {
    const planner = new CuePlanner(game.tunables.cues);
    const plan: CuePlan = createCuePlan();
    const options = game.feedbackOptions;
    let mode = '';
    let skill: SkillId | 'line' | null = null;
    let rating = NaN;
    let sd = NaN;

    const apply = (): void => {
      options.cuePhase = plan.phase;
      options.clean = plan.clean;
      options.surge = false;
      game.hud.root.classList.toggle('hud-clean', plan.clean);
    };

    game.bus.on('runReady', (e) => {
      mode = e.mode;
      skill = skillOf(mode);
      const skills = game.modes.skills;
      rating = skill === null ? NaN : skills.rating(skill);
      sd = skill === null ? NaN : skills.confidence(skill);
      const s = game.settings.get();
      planner.plan(
        {
          skill,
          rating,
          sd,
          placement: mode === 'placement',
          fading: s.cueFading,
          cleanRunEnabled: s.cleanRun,
          runsCompleted: game.profile.get().runsCompleted,
        },
        plan,
      );
      apply();
      game.bus.emit('cueScheduleSet', { tick: game.world.tick, mode, phase: plan.phase, clean: plan.clean });
    });

    game.bus.on('runEnded', (e) => {
      // A run counts once it ran its course; quitting it early spends nothing (the clean run is offered again).
      // The run is over: free play and the menu are not a clean run, and the reference-like HUD ends with it.
      const spent = e.reason !== 'quit' && skill !== null && mode !== 'placement';
      if (spent) planner.finish(plan);
      options.clean = false;
      if (plan.clean) options.cuePhase = 'every'; // free play after the clean run is not cue-free
      game.hud.root.classList.remove('hud-clean');
      if (spent) game.profile.set({ runsCompleted: game.profile.get().runsCompleted + 1 });
    });

    // Surge brings the tells back as a reward (design 7.4); it never overrides a clean run (cueGate).
    game.bus.on('surgeStarted', () => {
      options.surge = true;
    });
    game.bus.on('surgeEnded', () => {
      options.surge = false;
    });

    game.addOverlayLines(() => {
      if (skill === null) return '';
      return `cues ${plan.clean ? 'clean run' : effectivePhase(options)}  ${skill} ${rating.toFixed(0)} ±${sd.toFixed(1)}`;
    });
    game.addSnapshot('cues', () => ({
      phase: effectivePhase(options),
      planned: plan.phase,
      clean: plan.clean,
      cleanSpent: planner.cleanSpent,
      skill,
      rating,
      sd,
      runsCompleted: game.profile.get().runsCompleted,
    }));
    game.addDebug({
      cues: {
        state: (dial = 50) => ({
          phase: effectivePhase(options),
          planned: plan.phase,
          clean: plan.clean,
          cleanSpent: planner.cleanSpent,
          skill,
          rating,
          sd,
          runsCompleted: game.profile.get().runsCompleted,
          tellAxis: tellCueAt(dial, game.tunables.dial),
          tellStrength: tellStrength(options, game.tunables.cues, game.tunables.dial, dial),
        }),
        phase(p) {
          if (p !== null && !CUE_PHASES.includes(p)) return;
          options.cuePhase = p ?? plan.phase;
        },
        clean(on) {
          options.clean = on;
          game.hud.root.classList.toggle('hud-clean', on);
        },
        surge(on) {
          options.surge = on;
        },
      },
    });
  },
});
