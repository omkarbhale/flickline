# Maps

One JSON file per map. `npm run map-lint` validates and lints every `*.json` here (CI runs it, < 1 s).
The schema is documented by the types in `../mapTypes.ts` and enforced by `../mapSchema.ts`; the lint checks are in `../mapLint.ts`.

Adding a map: add `<id>.json`, run `npm run map-lint`, then export it from `../mapLoader.ts` (`loadMap(json)`). A `MapDef` is a `LevelDef`, so `new World({ level: map, ... })` works unchanged.

## Format (schema 1)

Vectors are `[x, y, z]` metres, +Y up, yaw 0 looks down -Z. Unknown properties are errors.

| Key | Meaning |
|---|---|
| `schema`, `id`, `name` | `schema` is `1`; `id` is the file name without `.json` |
| `bounds` | playable volume `{min, max}`; spawn, anchors, nav nodes and checkpoints must lie inside |
| `spawn` | `{pos, yaw}` feet position and facing |
| `boxes` | collision AABBs `{id?, tag, min, max}`. Tags: `floor wall crate platform cover pillar panel ceiling ramp`. Give a box an `id` if an anchor refers to it (peek `cover`, spray `panel`). A `ramp` box also has `ramp: {rise, lowY}` (see Elevation) |
| `targets` | placeholder sphere-target positions `{pos}` (modes will place targets from anchors) |
| `anchors` | where modes put things; every anchor has `kind`, unique `id`, optional `tags`. Kinds: `post`, `beacon-shell`, `strafe-lane`, `peek`, `gate`, `drone-volume`, `spray-alcove` |
| `nav` | coarse walkable graph `{nodes: [{id, pos}], edges: [[id, id]]}` |
| `lanes`, `checkpoints` | optional: named corridors, and route checkpoints `{id, pos, angleAnchors: [peek ids]}` |
| `marks` | optional floor markings (`tick`, `major`, `line`) drawn flat on the floor; never collide |
| `look` | `{sky: "#rrggbb", fog: [near, far], palette}`; the renderer picks the box palette by name |
| `lint` | optional per-map `{overlapTolerance, maxSightline}` |

## Elevation (stairs, ledges, ramps)

A grounded player walks up any ledge or stair riser of at most `movement.stepHeight` (0.35 m; author risers at 0.3 m or less) and walks down drops of the same size without leaving the ground. Anything taller needs a ramp or a jump. Horizontal speed is the same on a ramp as on the flat.

A **ramp** is a box tagged `ramp` with `"ramp": {"rise": "+x" | "-x" | "+z" | "-z", "lowY": y}`: the solid is the box cut by a sloped plane whose surface climbs along `rise` from height `lowY` at the low face up to the box's `max.y` at the high face (`min.y <= lowY < max.y`; `lowY = min.y` for a plain wedge sitting on its base). Example, a 3 m wide ramp climbing north (-z) from the floor to a 2.4 m deck: `{"id": "ramp-a", "tag": "ramp", "min": [7.5, 0, 14], "max": [10.5, 2.4, 22], "ramp": {"rise": "-z", "lowY": 0}}` (slope 16.7 degrees; the lint rejects slopes above `movement.maxWalkableSlopeDeg`, 45). Bullets, line of sight and the lint see the real sloped surface.

Stairs are plain boxes: **stack** one box per step (each from the top of the previous step to its own top, over its own slice of the run) instead of nesting slabs, or the overlap check fails. Place anchors and nav nodes at the floor height under them (on a ramp, the surface height under the point is fine). Everything raised or sunken relative to the spawn must be reachable on foot (`raised-reach`).

## Lint checks (errors fail CI, warnings are printed)

`bounds` (everything inside), `buried` (spawn, anchors, nav nodes, checkpoints not inside geometry), `nav-connected` and `nav-edge` (one connected graph, every edge walkable by the player hull over stairs and ramps, no ledge or drop taller than a step), `ramp-slope` and `ramp-ends` (a ramp is walkable and both its ends meet a floor; the top end is a warning), `raised-reach` (every raised or sunken post, gate, peek, lane end, nav node and checkpoint can be reached on foot from the spawn: a flood fill with the player's step rules), `checkpoint-reach`, `peek-los` (a peek's `out` position sees the checkpoint it serves), `overlap` (boxes overlap by at most 5 cm), `spray` (stated distance is real and the post is visible from the stand), `sightline` (per-map maximum), and the warning `visible-from-spawn` for posts and strafe lanes. It also prints the sightline report (longest line of sight, per-node maxima, histogram).

## Range

54 x 24 m hall, 8 m ceiling, spawn at the south end (z = 25) looking north, so distances from the spawn are `25 - z`:
posts at 6/10/15/20/30/40 m (5 angles each, tag `band-N`) plus 3 beside the pillars (tag `pillar`); the `beacon-shell` (8-25 m) is centred in the middle of the hall, so the Orbit mode moves the player to its `centre`;
3 `strafe-lane`s at 12/22/33 m; 3 `spray-alcove`s (niches in the north wall; the player fires from `stand` at the `post` 12/20/28 m away); 5 sphere targets at 5/10/20/30/50 m; floor ticks every 5 m (thicker every 10 m).
