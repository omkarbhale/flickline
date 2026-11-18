import { defineFeature } from '../app/feature';
import { palette } from '../config/palette';
import { CalloutGlow } from '../hud/calloutGlow';

/**
 * The callout stand-in's edge glow (engagement-information §4.2, #99): a soft patch of the accent
 * colour on the screen edge towards the called direction, fading over `callout.glowSec`. It is
 * drawn only while showing, from the event and the live view yaw (no DOM writes per frame beyond
 * the one small canvas), and is information, not a flash, so Reduce flashing leaves it as it is.
 */
export const feature = defineFeature({
  id: 'calloutGlow',
  stage: 'presentation',
  setup(game) {
    const cfg = game.tunables.callout;
    const rgb = [(palette.trim >> 16) & 255, (palette.trim >> 8) & 255, palette.trim & 255] as const;
    const glow = new CalloutGlow(game.hud.root, rgb, cfg.glowSec * 1000, (cfg.glowWidthDeg * Math.PI) / 180);
    const size = (): void => glow.resize(window.innerWidth, window.innerHeight);
    size();
    window.addEventListener('resize', size);
    game.bus.on('calloutIssued', (e) => glow.show(e.dirX, e.dirZ, performance.now()));
    game.onFrame(() => glow.update(performance.now(), game.input.yaw));
    game.onReset(() => glow.reset());
  },
});
