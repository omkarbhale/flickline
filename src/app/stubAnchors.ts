import { vec3 } from '../core/vec3';
import type { AnchorSource } from '../modes/contracts';

/**
 * Hand-placed Post anchors for the foundation's test room (feet positions), clear of its crates and
 * platforms. TEMPORARY: replaced by the map data of #16 (`MapDef.anchors`).
 */
const anchors: AnchorSource['anchors'][number][] = [];
let n = 0;
for (const z of [-18, -14, -12, -2, 0, 2]) {
  for (const x of [-16, -12, -4, 0, 4, 10, 16]) anchors.push({ id: `stub-post-${n++}`, kind: 'post', pos: vec3(x, 0, z) });
}

export const stubAnchors: AnchorSource = { anchors, bounds: { min: vec3(-19, 0, -19), max: vec3(19, 6, 19) } };
