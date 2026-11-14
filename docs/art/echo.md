# Echo, Beacon and Gnat: look, shader and how to drive them

Design: `docs/design.md` §5.1, §5.2, §11. Code: `src/render/echo*.ts`, `src/render/targetsView.ts`;
numbers in `src/config/echo.ts` (look), `src/config/palette.ts` (presets),
`src/config/render.ts` (`echoOutline` per quality).

## Model (all procedural, no assets)

`buildEchoMesh(hit, shape)` builds the humanoid **from `targets.hit.*`**, so the silhouette cannot
drift from the hitboxes (`echoModel.test.ts` asserts every zone within 2%, standing and crouched):

| Zone | Mesh | Matches |
|---|---|---|
| Head | 8 x 6 UV sphere, 80 tris, radius `headRadius` at `headCentre*` | the head sphere |
| Torso + arms | lofted box sections + two arms; arms' outer edge puts the width at `torsoWidth` | torso range, 0.50 m wide |
| Legs | two lofted legs, floor to `legTop*`; width `legWidth` | leg range, 0.46 m wide |

200 triangles in total (budget 400). The standing and crouched vertex sets have identical
topology and the vertex shader morphs between them with one per-instance number (`aState.z`), so a
crouched Echo is the same single draw. The Echo always turns its front to the viewer (yaw towards
the camera) which is the silhouette width the cylinder hit zones are built for. The Beacon is an
orb of exactly `kinds.beacon.orbRadius`; the Gnat is a vertically stretched octahedron, 0.22 m wide.

## Shader (`echoMaterial.ts`)

One `ShaderMaterial` family, one shared uniform set (`EchoUniforms`): preset colours, light,
rim, facet lift, head glow, outline width, viewport, clock.

* Unlit flat colour. Facet shading, rim light, head node and hit flash **only ever mix towards a
  lighter colour**, so the preset colour is the darkest thing an Echo ever renders: the 7:1 contrast
  guarantee below holds for what is on screen, not just for the token.
* Fog is off for Echoes: an Echo stays the highest-contrast thing on screen at any range.
* Hit flash (60 ms, `flashAmount`), crouch, idle lean and the death dissolve (every triangle
  shrinks to its centroid, staggered per face) are all vertex-shader work from `aState`; there is no
  per-pixel discard.
* Outline: inverted hull, a second back-face draw of the same instances, pushed out in screen space.
  Off at Low and Medium, on at High, and always on for the Contrast preset.
* One draw per type for up to 64 Echoes (`EnemyBatch`, filled compactly each frame: an idle type
  draws nothing). At most 6 enemy draws: 3 types x (body + outline).

## Presets (`echoPresets`)

Worst case of body / head against the brightest Range surface (cover, relative luminance 0.0072;
the table in `config/palette.test.ts` checks every surface):

| Preset | Body | Head node | Body vs worst surface | Head vs worst surface |
|---|---|---|---|---|
| Ember (default) | `#FF7A4D` | `#FFF1D6` | 7.11:1 | 16.4:1 |
| Magenta | `#FF6EE6` | `#FFE3FA` | 7.54:1 | 15.4:1 |
| Lime | `#9CFF3D` | `#F4FFE0` | 14.7:1 | 17.7:1 |
| Amber | `#FFC21A` | `#FFF4CC` | 11.3:1 | 16.7:1 |
| Contrast | `#DCDCDC` + black outline | `#FFFFFF` | 13.4:1 | 18.4:1 |

## Kill shatter

The burst itself is the shard effect from #24 (`render/effects.ts`, `feedback/shotCues.ts`): 12
shards per kill, all motion in the vertex shader, a pooled instanced mesh, zero allocation per kill
(its tests assert it). #18 adds the matching Echo side: the killed body keeps its slot and dissolves
for `echo.dissolveSec` (0.28 s, every triangle shrinks to its centroid in the vertex shader), the
white hit flash length is `feedback.targetFlashSec` (60 ms), and the shards are tinted with the
enemy colour preset (`ShotEffects.setShardColor`, called from `GameRenderer.setEchoPreset`).

## Driving it

* `GameRenderer.setEchoPreset(id)`, `GameRenderer.enemies` (the `TargetsView`).
* Debug hook: `__flickline.echoPreset('lime')`, `echoShowcase([{ look: 'gnat', x, y, z }, ...])`
  (display-only props: how the Gnat shows today, since the sim has no Gnat kind yet),
  `echoClock(sec | null)` (pin the Gnat spin clock for screenshots).
* Adding an enemy that looks like an Echo needs no render work: a humanoid-shaped kind is drawn as
  an Echo, an orb-shaped one as a Beacon. For the Gnat, route its kind to `TargetsView.gnat.add(...)`
  (one line next to the Beacon branch) and give it a hit radius from `echo.gnat.radius`.
* Peeks: an Echo is just a transform. `peekCentre(edge, side, exposure, width)` gives the centre that
  leaves a given fraction of the body past a cover edge; cover hides the rest by depth (no clipping).
