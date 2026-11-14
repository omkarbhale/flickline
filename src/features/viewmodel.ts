import { defineFeature } from '../app/feature';
import { VIEWMODEL_IDS, type ViewmodelId, type ViewmodelMode } from '../config/viewmodel';
import { ViewmodelLayer } from '../render/viewmodel';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The first-person weapon. `mode` ('right' | 'left' | 'hidden') sets the setting live;
     * `preview` draws that weapon's model whatever the sim has equipped ('pace' | 'kestrel' |
     * 'rill'; null follows the sim again), for looking at Rill before the sim has it. Returns the
     * model drawn last frame, the mode, the pose and the muzzle in viewmodel space.
     */
    viewmodel(opts?: { mode?: ViewmodelMode; preview?: ViewmodelId | null }): unknown;
  }
}

/** The first-person weapon (design section 11): meshes, pose from the sim, muzzle flash, hand setting. */
export const feature = defineFeature({
  id: 'viewmodel',
  stage: 'presentation',
  setup(game) {
    const layer = new ViewmodelLayer(
      game.renderer,
      game.cues,
      game.tunables.viewmodel,
      game.tunables.weapon,
      game.settings.get().viewmodel,
    );
    game.renderer.addLayer(layer);
    game.bus.on('settingsChanged', ({ settings, changed }) => {
      if (changed.includes('viewmodel')) layer.setMode(settings.viewmodel);
    });
    game.addOverlayLines(() => {
      const s = layer.state;
      return s.model ? `viewmodel ${s.model} (${s.mode}) ${layer.triangles(s.model)} tris` : `viewmodel ${s.mode}`;
    });
    game.addDebug({
      viewmodel(opts = {}) {
        if (opts.mode) game.settings.set({ viewmodel: opts.mode });
        if (opts.preview !== undefined) {
          if (opts.preview !== null && !VIEWMODEL_IDS.includes(opts.preview)) throw new Error(`no viewmodel '${opts.preview}'`);
          layer.force(opts.preview);
        }
        game.renderNow();
        const s = layer.state;
        return JSON.parse(JSON.stringify(s));
      },
    });
  },
});
