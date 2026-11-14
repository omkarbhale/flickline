/**
 * Everything that flows over the game's one shared bus: an open registry composed by type.
 *
 * Each module that owns events declares its map next to its code and adds it here with
 * TypeScript interface merging, so adding events never edits a shared file:
 *
 *   export interface RunEvents { runRestarted: { tick: number } }
 *   declare module '../core/gameEvents' {
 *     interface GameEvents extends RunEvents {}
 *   }
 *
 * A clash (two maps declaring the same event with different payloads) is a compile error. Find
 * every map with a search for `interface GameEvents extends`.
 */
export interface GameEvents {}
