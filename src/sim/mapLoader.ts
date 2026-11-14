import { parseMap, type MapIssue } from './mapSchema';
import type { MapDef } from './mapTypes';
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
