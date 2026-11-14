/**
 * Events about the loaded map's own dynamic state. The map is static data; these let a mode
 * drive decoration that lives on it, without the mode knowing anything about rendering.
 */
export interface MapEvents {
  /**
   * Lane's Stop & Pop: the lane became armed (the player is moving sideways fast enough, so
   * targets may appear) or disarmed. The renderer lights the map's `armed` floor marks while armed.
   */
  laneArmedChanged: { tick: number; armed: boolean };
  /**
   * The world loaded another map because the mode being started is designed for it (`ModeDef.map`).
   * Emitted by the mode host after the sim's level was swapped and before the run resets; the
   * renderer builds the new level's visuals on it. Not emitted when the mode's map is already loaded.
   */
  mapLoaded: { tick: number; mapId: string };
}

declare module '../core/gameEvents' {
  interface GameEvents extends MapEvents {}
}
