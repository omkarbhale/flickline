import { defineFeature } from '../app/feature';
import type { Game } from '../app/game';
import { playMode, type BotHost, type BotOptions, type BotResult } from '../debug/modeBot';
import { zoneCentre } from '../sim/hitZones';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Play a whole run of a mode with a scripted aimer (reaction delay, exponential flick, seeded aim
     * error; see `debug/modeBot.ts`) at full simulation speed, then render once. Deterministic for a
     * fixed `seed` (and `pinDial`, since the skill model learns from every run). Returns the run's
     * totals and the world hash.
     */
    bot(modeId: string, opts?: Partial<BotOptions>): BotResult;
  }
}

/** The running game as a `BotHost`: ticks without rendering, aim points from the live targets. */
function gameBotHost(game: Game): BotHost {
  const c = { x: 0, y: 0, z: 0 };
  const first = () => game.world.targets.find((t) => t.alive) ?? null;
  return {
    startMode: (id, o) => game.startMode(id, o),
    tick(yaw, pitch, fire) {
      game.input.setLook(yaw, pitch);
      game.step(1, { fire }, false);
    },
    eye(out) {
      const p = game.world.player;
      out.x = p.pos.x;
      out.y = p.pos.y + p.eyeHeight;
      out.z = p.pos.z;
    },
    view: () => ({ yaw: game.input.yaw, pitch: game.input.pitch }),
    nextTarget(out) {
      const t = first();
      if (!t) return false;
      const tt = game.tunables.targets;
      zoneCentre(c, t, tt.hit, tt.kinds[t.kind], 'head');
      out.x = c.x;
      out.y = c.y;
      out.z = c.z;
      return true;
    },
    targetId: () => first()?.id ?? -1,
    status: () => game.modes.status(),
    hash: () => game.world.hash(),
  };
}

/** The scripted aimer as a debug command (`__flickline.bot`). */
export const feature = defineFeature({
  id: 'modeBot',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      bot(modeId, opts = {}) {
        const result = playMode(gameBotHost(game), modeId, { seed: game.world.seed, ...opts });
        game.renderNow();
        return result;
      },
    });
  },
});
