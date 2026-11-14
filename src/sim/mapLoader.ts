import { parseMap, type MapIssue } from './mapSchema';
import type { MapDef } from './mapTypes';
import { resolveMap } from './mapMirror';
import elbowJson from './levels/elbow.json';
import gateJson from './levels/gate.json';
import laneJson from './levels/lane.json';
import rangeJson from './levels/range.json';

/** Thrown for an invalid map; `issues` lists every problem with its JSON path. */
export class MapError extends Error {
  readonly issues: MapIssue[];

  constructor(label: string, issues: MapIssue[]) {
    super(`invalid map ${label}:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'MapError';
    this.issues = issues;
  }
}

/**
 * Validate raw map JSON and turn it into a `MapDef` (a `LevelDef` plus anchors, nav, marks, look).
 * Runs once when a map is loaded, never per frame.
 */
export function loadMap(raw: unknown, label = 'map'): MapDef {
  const result = parseMap(raw);
  if (!result.ok) throw new MapError(label, result.errors);
  return result.map;
}

/** Every shipped map. Adding a map = a JSON file in `levels/` plus one line here. */
export const rangeMap: MapDef = loadMap(rangeJson, 'range');
export const laneMap: MapDef = loadMap(laneJson, 'lane');
export const elbowMap: MapDef = loadMap(elbowJson, 'elbow');
/** The gate room Sweep walks the player through between sectors (design §4.5, #205): not a sector map, no sectors of its own. */
export const gateMap: MapDef = loadMap(gateJson, 'gate');

/** Every shipped map by id (`?map=<id>` in the URL picks one until the modes choose their own). */
export const MAPS: Readonly<Record<string, MapDef>> = {
  [rangeMap.id]: rangeMap,
  [laneMap.id]: laneMap,
  [elbowMap.id]: elbowMap,
  [gateMap.id]: gateMap,
};

/** A shipped map by id, or its mirror for `<id>~m` (the cold opener's mirrored contacts, design §8.5); null when unknown. */
export function findMap(id: string): MapDef | null {
  return resolveMap(MAPS, id);
}
