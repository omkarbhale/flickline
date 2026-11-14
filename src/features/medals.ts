import { defineFeature } from '../app/feature';
import { MedalEngine, MEDAL_EVENT_TYPES } from '../feedback/medals';
import type { MedalId } from '../config/medals';
import { TICK_DT } from '../core/time';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Medals (design 8.4): the ids earned in the run now playing (or the last one), and the saved totals. */
    medals(): { run: string[]; totals: Record<string, number> };
  }
}

/**
 * The in-run medals (design §8.4): feeds the run's events to the pure `MedalEngine` and turns each award
 * into a `medalAwarded` event (the sound and the results card read it; the toast is #40). Ascent, Flawless
 * and Quick Study come from `features/progress.ts` at the end of the run. A producer: it emits before the
 * presentation that hears the kill.
 */
export const feature = defineFeature({
  id: 'medals',
  stage: 'producer',
  setup(game) {
    const bus = game.bus;
    const run: MedalId[] = [];
    const payload = { tick: 0, id: '' as string };
    const engine = new MedalEngine(
      (id, tick) => {
        run.push(id);
        payload.tick = tick;
        payload.id = id;
        bus.emit('medalAwarded', payload);
      },
      game.tunables.medals,
      game.tunables.targets.shotAtDeg,
      game.tunables.sweep.finaleSector,
      // What the sim knows of an Echo's motion (Hairline needs a moving one, Pendulum a strafing one).
      {
        speed(id) {
          const t = game.world.targetField.byId(id);
          return t === null ? 0 : Math.hypot(t.pos.x - t.prevPos.x, t.pos.z - t.prevPos.z) / TICK_DT;
        },
        strafing(id) {
          const t = game.world.targetField.byId(id);
          return t !== null && t.kind === 'strafer' && Math.abs(t.ai.vel) >= game.tunables.medals.movingEchoMps;
        },
      },
    );

    bus.on('runReady', (e) => {
      run.length = 0;
      engine.begin(e.mode);
    });
    for (const type of MEDAL_EVENT_TYPES) {
      if (type === 'runEnded' || type === 'runStarted') continue;
      bus.on(type, (e) => engine.observe(type, e as never));
    }
    bus.on('runStarted', (e) => engine.observe('runStarted', e));
    bus.on('runEnded', (e) => engine.observe('runEnded', e));
    game.onTick(() => engine.advance(game.world.tick));

    game.addDebug({
      medals: () => {
        const totals: Record<string, number> = {};
        const m = game.progress.snapshot.medals;
        for (const id of Object.keys(m)) totals[id] = m[id]!.count;
        return { run: run.slice(), totals };
      },
    });
  },
});
