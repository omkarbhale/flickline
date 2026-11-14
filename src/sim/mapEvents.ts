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
}

declare module '../core/gameEvents' {
  interface GameEvents extends MapEvents {}
}
