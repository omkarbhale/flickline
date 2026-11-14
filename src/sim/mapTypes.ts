import type { Vec3 } from '../core/vec3';
import type { LevelDef } from './types';

/**
 * Map data (design section 10.2). A map is one JSON file under `src/sim/levels/`; the validator
 * (`mapSchema.ts`) turns it into a `MapDef`, which IS a `LevelDef` (the simulation only ever
 * looks at `boxes`, `spawn` and `targets`) plus everything modes, the renderer and the lint need.
 *
 * In the JSON file vectors are `[x, y, z]` arrays (compact to author); in `MapDef` they are `Vec3`.
 * Coordinates: metres, +Y up, yaw 0 looks down -Z (see the architecture issue).
 */

export const MAP_SCHEMA_VERSION = 1;

export type Stance = 'stand' | 'crouch';
export type PeekPattern = 'shoulder' | 'wide' | 'jiggle' | 'hop';

interface AnchorBase {
  id: string;
  /** Free-form labels the mode scheduler filters on (for example `band-20`, `pillar`). */
  tags: string[];
}

/** Where an enemy post (a standing target) may appear. `pos` is the feet centre. */
export interface PostAnchor extends AnchorBase {
  kind: 'post';
  pos: Vec3;
  yaw: number;
  stance?: Stance;
}

/** A sphere shell around `centre` on which beacons are placed (`rMin`..`rMax` metres). */
export interface BeaconShellAnchor extends AnchorBase {
  kind: 'beacon-shell';
  centre: Vec3;
  rMin: number;
  rMax: number;
}

/** A line a strafing target walks along, `a` to `b` (feet height). */
export interface StrafeLaneAnchor extends AnchorBase {
  kind: 'strafe-lane';
  a: Vec3;
  b: Vec3;
}

/** A spot an enemy peeks from: waits at `hold` behind `cover` (a box id) and steps out to `out`. */
export interface PeekAnchor extends AnchorBase {
  kind: 'peek';
  cover: string;
  hold: Vec3;
  out: Vec3;
  pattern: PeekPattern;
}

/** Where enemies enter the arena. */
export interface GateAnchor extends AnchorBase {
  kind: 'gate';
  pos: Vec3;
  yaw: number;
}

/** A box of air that flying targets may use. */
export interface DroneVolumeAnchor extends AnchorBase {
  kind: 'drone-volume';
  min: Vec3;
  max: Vec3;
}

/**
 * Spray Wall station: the player fires from `stand` (looking along `yaw`) at a post standing at
 * `post` in front of a wall `panel` (a box id) that records the bullet pattern.
 * `distance` is the metres between `stand` and `post`.
 */
export interface SprayAlcoveAnchor extends AnchorBase {
  kind: 'spray-alcove';
  stand: Vec3;
  yaw: number;
  post: Vec3;
  panel: string;
  distance: number;
}

export type Anchor =
  | PostAnchor
  | BeaconShellAnchor
  | StrafeLaneAnchor
  | PeekAnchor
  | GateAnchor
  | DroneVolumeAnchor
  | SprayAlcoveAnchor;

export type AnchorKind = Anchor['kind'];
export const ANCHOR_KINDS: readonly AnchorKind[] = [
  'post', 'beacon-shell', 'strafe-lane', 'peek', 'gate', 'drone-volume', 'spray-alcove',
];

export type AnchorOfKind<K extends AnchorKind> = Extract<Anchor, { kind: K }>;

export interface NavNode {
  id: string;
  pos: Vec3;
}

/** Coarse walkable graph (open areas, doorways). Edges are undirected pairs of node ids. */
export interface NavGraph {
  nodes: NavNode[];
  edges: [string, string][];
}

/** A named lane (corridor) with a width, for modes that run along one. */
export interface LaneDef {
  id: string;
  start: Vec3;
  end: Vec3;
  width: number;
}

/** A route checkpoint; `angleAnchors` are the `peek` anchors that hold the angle it arms. */
export interface CheckpointDef {
  id: string;
  pos: Vec3;
  angleAnchors: string[];
}

/** A flat marking painted on the floor (visual only, never collides): distance ticks, start lines. */
export interface FloorMark {
  kind: 'tick' | 'major' | 'line';
  a: Vec3;
  b: Vec3;
  /** Stripe width in metres. */
  width: number;
}

export interface MapLook {
  /** Sky/background and fog colour, `#rrggbb`. */
  sky: string;
  /** Fog near and far distances in metres. */
  fog: [number, number];
  /** Name of the box colour palette the renderer should use (unknown names fall back). */
  palette: string;
}

/** Per-map overrides of the lint's tolerances. */
export interface MapLintOptions {
  /** Boxes may overlap by at most this many metres (default 0.05). */
  overlapTolerance?: number;
  /** Error if any sightline at eye height is longer than this (metres). */
  maxSightline?: number;
}

export interface MapDef extends LevelDef {
  /** Derived from `anchors` by the loader. */
  enemyFeet: readonly Vec3[];
  schema: typeof MAP_SCHEMA_VERSION;
  id: string;
  /** Playable volume. Everything a player or an anchor can occupy lies inside. */
  bounds: { min: Vec3; max: Vec3 };
  anchors: Anchor[];
  nav: NavGraph;
  lanes: LaneDef[];
  checkpoints: CheckpointDef[];
  marks: FloorMark[];
  look: MapLook;
  lint: MapLintOptions;
}
