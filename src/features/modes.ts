import { defineFeature } from '../app/feature';
import { MODES, ModeHost } from '../app/modeHost';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Mode framework: start/stop a mode run and read its state (`step()` advances it like any tick). */
    readonly mode: {
      /** Ready a run (ready phase 0.8 s, then live). `pinDial` fixes the dial. Returns false for an unknown id. */
      start(id?: string, opts?: { seed?: number; pinDial?: number }): boolean;
      stop(): void;
      /** Phase, beat, dial, axes, score, streak, chain, trials, timing. */
      status(): unknown;
      /** Ids of the registered modes. */
      list(): string[];
    };
  }
}

/**
 * The mode framework on the running game: the host ticks after every sim tick and stops on reset.
 * A producer: it emits `streakUpdated` before presentation hears the kill (the chime reads it).
 */
export const feature = defineFeature({
  id: 'modes',
  stage: 'producer',
  setup(game) {
    const modes = new ModeHost(game.world, game.bus, game.map, game.tunables);
    game.onTick(() => modes.tick());
    game.onReset(() => modes.stop());
    game.addOverlayLines(() => {
      const m = modes.status();
      if (m.mode === null) return '';
      return (
        `mode ${m.mode} ${m.phase}  beat ${m.beat} dial ${m.dial.toFixed(0)}  ${m.timeSec.toFixed(1)}s\n` +
        `score ${m.score}  kills ${m.kills}  trials ${m.trialsWon}/${m.trials}  streak ${m.streak}  chain ${m.chain}`
      );
    });
    game.addDebug({
      mode: {
        start: (id = 'test', opts = {}) => modes.start(id, opts),
        stop: () => modes.stop(),
        status: () => modes.status(),
        list: () => Object.keys(MODES),
      },
    });
  },
});
