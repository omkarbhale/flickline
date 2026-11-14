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
| `marks` | optional floor markings (`tick`, `major`, `line`, `armed`) drawn flat on the floor; never collide. `armed` marks are dim until a `laneArmedChanged { armed: true }` event lights them (the Lane's stripe, driven by a mode) |
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
posts at 6/10/15/20/30/40 m (tag `band-N`; 9 angles 15° apart at 6 and 10 m so Cold Start always has a Post 5-25° from the crosshair, 5 angles at the other bands) plus 3 beside the pillars (tag `pillar`); the `beacon-shell` (8-25 m) is centred in the middle of the hall, so the Orbit mode moves the player to its `centre`;
3 `strafe-lane`s at 12/22/33 m; 3 `spray-alcove`s (niches in the north wall; the player fires from `stand` at the `post` 12/20/28 m away); 5 sphere targets at 5/10/20/30/50 m; floor ticks every 5 m (thicker every 10 m).

## Lane

6 x 30 m corridor (x -3..3, z -15..15), 4 m ceiling. Spawn at the south end (z = 14) looking north, so distances from the spawn are `14 - z`. A start line at z = 12; five alternating 1.3 m half-wall stops 5 m apart (z = 9, 4, -1, -6, -11, sides left/right/left/right/left, 2 m deep, leaving a 4 m gap); the last 3 m narrow to a 4 m wide far-end alcove. Posts at 16 / 18.5 / 21 / 23.5 / 26 m (three angles each), 27.5 m (`alcove`, three) and 28.5 m (`alcove`, two), tags `band-<d>`. The armed stripe is two `armed` marks: a band behind the start line and a runner down the middle, clear of the half-walls. Distance ticks every 5 m. 3 placeholder sphere targets.

## Elbow

26 x 26 m footprint, L-shaped: a south arm (x -13..13, z 6..13) and a west arm (x -13..-6, z -13..6) meeting at the elbow, plus a hub room inside the elbow and a pocket room behind it, joined by three 2 m doorways (D1 south arm to hub, D2 west arm to hub, D3 hub to pocket; threshold lines on the floor). Spawn at the east end of the south arm looking west. Crates at low (1.0 m), half (1.3 m) and full (2.2 m) heights; a 1.2 m deck at the north end of the west arm reached by a 13.5 degree ramp.

Six `peek` anchors, one per pattern plus repeats: `peek-stack` (wide, full stack at the arm's west end), `peek-door-south` (shoulder, hub side of D1), `peek-corner` (jiggle, inner corner of the elbow), `peek-crate` (hop, low crate in the west arm), `peek-deck` (shoulder, elevated, on the deck) and `peek-pocket` (wide, pocket room seen through D3). Ten checkpoints in route order (spawn, along the south arm, through D1 to the hub and D3, through D2 into the west arm, back along the south arm). A checkpoint's angle distance is checkpoint to its first peek's `out`: long (22-26 m) `cp-01`, `cp-08`, `cp-10`; mid (12-16 m) `cp-02`, `cp-04`, `cp-07`; close (5-8 m) `cp-03`, `cp-05`, `cp-06`, `cp-09`. Each peek's `hold` is hidden from every checkpoint it serves (`laneElbow.test.ts` checks it at head height; the `hop` hold hides behind a 1.0 m crate only horizontally, see the issue).
