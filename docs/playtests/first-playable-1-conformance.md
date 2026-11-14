# First-playable playtest 1: interim conformance table

Appendix to [`first-playable-1.md`](first-playable-1.md) (issue #29, numbers track). The automated conformance suite and the generated `docs/conformance.md` (#64) do not exist yet, so this table is a hand audit of build `1590520` against `docs/mechanics-spec.md`. When #64 lands, its generated table supersedes this one.

- Weapons in scope: **Pace** (`pistol_accurate`, semi) and **Kestrel** (`rifle_spray`, auto). Rill, Vane, Longnail and the other pistol archetypes are not built, so their rows are "not implemented".
- Behaviours were measured by driving the real deterministic `World` (testRoom level, seeds 1–5, 128 Hz) through vite's `runnerImport` from scratch scripts outside the repo.
- Statuses: **match**, **deviation**, **not implemented**, and **placeholder-match** (the value equals one the spec itself tags ESTIMATE or PLACEHOLDER, or §7.1 confidence L/P), so a reader can tell "matches an estimate" from "matches a measured value".
- Strict rule: a match means equal within the spec's own stated precision or tolerance. Where the spec prints a rounded derived value (Pace crouched first shot "0.23" = 0.30 × 0.75 = 0.225), the formula counts as the spec value.
- "Evidence" names an existing test only when it asserts the spec number. A test that reads the number back from the same tunables object is called self-referential.

## 1. Conformance table

### 1.1 View, input, timing (§1)

| Item | Spec value (§) | Confidence tag | Implemented value (file:line) | Evidence | Status |
|---|---|---|---|---|---|
| Sim tick rate | 128 Hz (§1.4, §7.1 `sim.tick_hz`) | OFFICIAL / H | `TICK_RATE = 128` (src/core/time.ts:12) | `core.test.ts` "uses a power-of-two tick"; probe: TICK_DT = 0.0078125 | match |
| Fixed-step sim, render-rate look, fire/move resolved at tick (§1.4) | fixed sim, look sampled per frame | OFFICIAL | `FixedStepper(TICK_DT, 8)` (src/app/game.ts:98, src/core/fixedStep.ts); look applied in the mousemove handler (src/input/input.ts:181-182) | code read, `core.test.ts` FixedStepper tests | match |
| hFOV at 16:9 | 103 deg (§1.1, §7.1) | COMMUNITY | `view.hfovDeg = 103` (src/config/view.ts:14) | probe: 103 -> vfov -> 103 round trip; `core.test.ts:121` | match |
| Vertical FOV | 70.5328 deg, constant (§1.1, §7.1 `view.vfov_deg`) | DERIVED / H | derived, not stored: `verticalFovDeg(103, 16/9)` (src/core/view.ts:20-22), camera built with it (src/render/gameRenderer.ts:110) | probe: 70.53280043; `core.test.ts:121` (2 decimals) | match |
| Hor+ (vertical fixed, hFOV follows aspect) | 16:10 97.06, 4:3 86.63, 5:4 82.95, 21:9 118.36, 32:9 136.62 (§1.1, `view.fov_hor_plus`) | ESTIMATE 55% / M | resize only sets `camera.aspect` (src/render/gameRenderer.ts:184-185) | probe from 70.5328: 97.058, 86.632, 82.950, 118.361, 136.623; renderer path code read only, no renderer test | placeholder-match |
| No FOV slider | none (§1.1) | COMMUNITY | locked; `fovLockNote` shown (src/config/view.ts:18, src/ui/settingsPanel.ts:65) | code read | match |
| Yaw per count at sens 1.0 | 0.07 deg (§1.2, §7.1) | COMMUNITY / H | `DEGREES_PER_COUNT = 0.07` (src/core/sensitivity.ts:12) | `sensitivity.test.ts` 5 cases; probe 0.07 | match |
| Pitch per count at sens 1.0 | 0.07 deg (§1.2, `input.pitch_deg_per_count_at_sens1`) | ESTIMATE 85% / M | same factor on pitch (src/input/input.ts:182) | code read; no test of the InputManager path | placeholder-match |
| Pitch clamp | 89 deg (§1.2, `input.pitch_limit_deg`) | PLACEHOLDER / P | `maxPitchDeg: 89` (src/config/movement.ts:56), input clamp (src/input/input.ts:37, src/app/game.ts:165) | `sim.test.ts` "clamps pitch" | placeholder-match |
| cm/360 formula | `914.4 / (DPI*sens*0.07)` = `13062.86/(DPI*sens)` (§1.2, §7.5) | COMMUNITY | `(360/(0.07*sens*dpi))*2.54` (src/core/sensitivity.ts:19-22), algebraically identical | `sensitivity.test.ts` (32.66, 40.82, 16.33, closed form, inverse); probe 32.6571, 40.8214, 40.8214 | match |
| Raw input, no accel or smoothing | raw only (§1.2) | n/a | requests `unadjustedMovement`, fallback emits `rawInputChanged` (src/input/input.ts:86-130); no filtering | code read only (browser dependent) | match |
| Scope zoom factors | ADS 1.25 rifle, 1.15 smg; sniper 2.5 then 5 (§1.3, `input.scope_zoom_*`) | COMMUNITY / M | none in code | grep for ads/scope/zoom: no hit in config or sim | not implemented |
| Scoped FOV model and scoped sensitivity | angle division, multiplier default 1.0 (§1.3, `input.scoped_fov_model`, `scope_multiplier_default`) | ESTIMATE 65% / M, H | none | grep | not implemented |

### 1.2 Movement (§2)

| Item | Spec value (§) | Confidence tag | Implemented value (file:line) | Evidence | Status |
|---|---|---|---|---|---|
| Run speed, rifle_spray (Kestrel) | 5.40 m/s (0.80 x 6.75) (§2.1, §7.2) | DATA | `movement.runSpeed = 5.4` (src/config/movement.ts:49); `kestrel.runSpeedMps = 5.4` (src/config/weapon.ts:174) | probe: 5.4 steady; `sim.test.ts:55` reads runSpeed back from tunables (self-referential) | match |
| Run speed, pistol_accurate (Pace) | 5.7375 m/s (0.85 x 6.75) (§2.1, §7.2) | DATA | `pace.runSpeedMps = 5.7375` (src/config/weapon.ts:135) but the player always moves at `movement.runSpeed = 5.4`; `stepPlayer` never reads the equipped weapon (src/sim/movement.ts:70) | probe: Pace equipped, run speed measured 5.4 | deviation |
| Run speed, no weapon (knife) | 6.75 m/s (§2.1, `move.run_speed_knife`) | OFFICIAL / H | no unarmed state | code read | not implemented |
| Run speed, other archetypes | smg 5.7375, pistol_light 5.7375, pistol_heavy 5.40, sniper 5.13 (§2.1) | DATA | weapons absent | n/a | not implemented |
| ADS and scoped move multipliers | rifles 0.76, smg 0.76, sniper scoped 0.72 (§2.1, `ads_move_mult`) | DATA | none | grep | not implemented |
| Walk fraction (Kestrel walk speed) | 0.50 of run = 2.70 m/s (§2.2, `move.walk_fraction`) | ESTIMATE 35% / L | `walkFraction 0.5` (src/config/weapon.ts:208), `walkSpeed 2.7` (src/config/movement.ts:50) | probe: Kestrel walk 2.7 | placeholder-match |
| Walk speed, Pace | 0.5 x 5.7375 = 2.869 m/s (§2.2) | ESTIMATE 35% / L | 2.7 (same fixed value, src/sim/movement.ts:70) | probe: Pace walk 2.7 | deviation |
| Crouch-walk fraction (config key) | 0.34 (§2.2, `move.crouch_walk_fraction`) | ESTIMATE 25% / L | `crouchWalkFraction 0.34` (src/config/weapon.ts:209) | read | placeholder-match |
| Crouch-walk speed (Kestrel) | 0.34 x 5.4 = 1.836 m/s (§2.2) | ESTIMATE 25% / L | `crouchSpeed 2.2` (src/config/movement.ts:51) = 0.407 of run | probe: 2.2 m/s | deviation |
| Acceleration, rest to full speed | 0.20 s linear (§2.3, `move.accel_time_to_max`) | ESTIMATE 35% / L | `groundAccel 70` m/s^2 (src/config/movement.ts:52) = 5.4/70 = 0.077 s | probe: 0.078125 s (10 ticks) | deviation |
| Braking above 25% of max / at or below | 39 / 24 m/s^2, split at 0.25, scaled by max/5.4 (§2.3, `move.brake_decel_*`) | DERIVED / M | one constant rate (70 m/s^2), no band split, no weapon scaling: `accel = groundAccel*dt` toward wish (src/sim/movement.ts:74-83) | probe: speed falls 0.547 m/s per tick all the way (4.853, 4.306, ... 0.478, 0) | deviation |
| Full stop from run | 0.160 s (§2.3, `move.stop_time_from_run`) | OFFICIAL (2020 data) / M | derived from the above: 0.078 s | probe: 5.4 -> 0 in 10 ticks = 0.078125 s (release); same through zero for counter-strafe | deviation |
| Counter-strafe = release plus opposite acceleration, no extra bonus | (§2.3 rule) | ESTIMATE 45% | opposite key and release brake at the same rate; opposite key then accelerates the other way (src/sim/movement.ts:74-83) | probe: identical trace to 0.478 m/s, then reverse speed 0.069, 0.616, 1.162 | placeholder-match |
| Accuracy deadzone, non-sniper | 27.5% of max speed (§2.4, `move.deadzone_fraction`) | OFFICIAL 70% / M | `deadzoneFraction 0.275` for Pace and Kestrel (src/config/weapon.ts:146, 185) | `weapon.test.ts:131` (moving only above 0.275 x run speed), `runProbe.test.ts:47`; probe: speed exactly on threshold is not a moving shot | match |
| Accuracy deadzone, sniper | 15% (§2.4, `deadzone_fraction_sniper`) | OFFICIAL 65% / M | no sniper | n/a | not implemented |
| "Max speed" used by the deadzone | equipped weapon's run speed (§2.4) | ESTIMATE 70% | `def.deadzoneFraction * def.runSpeedMps` (src/sim/weaponModel.ts:51, src/sim/runProbe.ts:62) | `runProbe.test.ts:47` | placeholder-match |
| First fully accurate shot after stopping | zero error at 0.100 +- 0.01 s (0.090 to 0.110) after the stopping input (§2.5, automated test required) | ESTIMATE 60% | follows from braking above: speed <= 1.485 m/s reached at tick 8 | probe (Kestrel, shot at each tick after release): error 5.59, 4.98, 4.38, 3.77, 3.12, 1.76, 0.41 deg at 1-7 ticks, then 0.200 (stationary first-shot) from tick 8 = **0.0625 s**. At 0.100 s the error is zero, but it has been zero for 0.04 s, 37% earlier than the spec's 0.100 +- 0.01. | deviation |
| First accurate shot, sniper | about 0.13 s (§2.5) | ESTIMATE 40% | no sniper | n/a | not implemented |
| Jump apex, flat ground | 1.0 m (§2.6, `move.jump_apex`) | ESTIMATE 35% / L | `jumpSpeed 6`, `gravity 22` (src/config/movement.ts:54-55): analytic 0.818 m | probe: 0.795 m | deviation |
| Gravity | 20 m/s^2 (§2.6, `move.gravity`) | PLACEHOLDER / P | `gravity 22` (src/config/movement.ts:54) | read | deviation |
| Takeoff vertical speed | 6.32 m/s (§2.6) | DERIVED | `jumpSpeed 6` (src/config/movement.ts:55) | read | deviation |
| Airtime, flat ground | 0.63 s (§2.6) | DERIVED | analytic 0.545 s | probe: 0.539 s (69 ticks) | deviation |
| Horizontal speed in the air | preserved from takeoff, never above run speed (§2.6) | ESTIMATE 55% | air speed is accelerated toward the (zero) wish velocity at 12 m/s^2 when keys are released: `p.grounded ? groundAccel : airAccel` (src/sim/movement.ts:74) | probe: running jump, keys released at takeoff: 5.4 -> 4.46 m/s after 10 ticks -> 0 m/s before landing (air time 0.54 s) | deviation |
| Air acceleration | 0.25 x ground accel (about 6.8 m/s^2 for a rifle) (§2.6, `move.air_accel_fraction`) | ESTIMATE 25% / L | `airAccel 12` (src/config/movement.ts:53) = 0.17 x 70; 1.8x the spec value | read | deviation |
| Bunny-hop speed gain | none (§2.6) | ESTIMATE 65% | speed capped at run speed by wish-velocity model | probe: 4 s of continuous hopping, max speed 5.4 | placeholder-match |
| Landing speed loss | none (§2.6, `move.landing_speed_loss` 0) | ESTIMATE 50% / L | none | probe: 5.4 before and after landing | placeholder-match |
| Crouch-jump (extra reach) | off in v1 (§2.6) | no number | no reach gain: feet position unchanged when the hull shrinks (src/sim/movement.ts:47-55) | code read | placeholder-match |
| Landing inaccuracy add | +7.0 deg (§2.6, `move.landing_spread_add`) | OFFICIAL 75% / M | `landingSpreadAddDeg 7` (src/config/weapon.ts:210) | `weapon.test.ts:140`; probe: shot 1 tick after landing = 7.2 (0.2 + 7) | match |
| Landing inaccuracy window | 0.225 s, binary (§2.6, `move.landing_spread_duration`) | OFFICIAL 75% / M | `landingSpreadSec 0.225` (src/config/weapon.ts:211), `< 0.225 - EPS` (src/sim/weapon.ts:436) | probe: +7 at 27 and 28 ticks after landing (0.2188 s), gone at 29 ticks (0.2266 s); correct tick quantisation of 28.8 ticks | match |
| Airborne error, Kestrel / Pace | +10 / +7 deg (§3.4, §7.3) | WIKI, medium | `errAirDeg` 10 / 7 (src/config/weapon.ts:184, 145) | `weapon.test.ts:123-139` | match |
| Standing hull height | 1.80 m (§2.7, `body.height_stand`) | ESTIMATE 30% / L | `standHeight 1.8` (src/config/movement.ts:44) | read | placeholder-match |
| Hull radius | 0.30 m (§2.7, `body.radius`) | PLACEHOLDER / P | `hullHalfWidth 0.3`, a square prism (src/config/movement.ts:43) | read; footprint is a 0.6 m square, not a 0.3 m-radius disc | placeholder-match |
| Eye height standing | 1.62 m (§2.7, `body.eye_height_stand`) | ESTIMATE 30% / L | `standEyeHeight 1.62` (src/config/movement.ts:46) | probe: eye 1.62; `hitZones.test.ts` head-height cases | placeholder-match |
| Crouched hull height | 1.30 m (§2.7, `body.height_crouch`) | PLACEHOLDER / P | `crouchHeight 1.4` (src/config/movement.ts:45) | read; the crouched Echo hit zone top is 1.30 (src/config/targets.ts:92-94) so the two crouched heights disagree inside the game | deviation |
| Crouched eye height | 1.17 m (§2.7, `body.eye_height_crouch`) | PLACEHOLDER / P | `crouchEyeHeight 1.22` (src/config/movement.ts:47) | probe: settles at 1.22 | deviation |
| Crouch transition | 0.15 s down or up (§2.7, `body.crouch_transition`) | PLACEHOLDER / P | hull height flips in one tick; eye moves at `eyeHeightSpeed 4` m/s (src/config/movement.ts:48, src/sim/movement.ts:47-57) | probe: hull 1.4 after 1 tick; eye reaches crouch in 0.094 s, back to stand in 0.102 s | deviation |
| Step height | 0.35 m (§2.7) | PLACEHOLDER / P | `stepHeight 0.35` (src/config/movement.ts:58) | `elevation.test.ts` (0.3 m risers, 1 m drop falls) | placeholder-match |
| Ramp speed | unchanged horizontal speed (§2.7) | ESTIMATE 45% | `moveAxisStep` + snapDown, no slope speed term (src/sim/movement.ts:107-123) | `elevation.test.ts:127-185` | placeholder-match |
| Steepest authored ramp | 45 deg (§2.7) | PLACEHOLDER | `maxWalkableSlopeDeg 45` (src/config/movement.ts:59), lint (src/sim/mapLint.ts:269) | map lint | placeholder-match |

### 1.3 Weapon handling (§3.1, §7.2)

| Item | Spec value (§) | Confidence tag | Implemented value (file:line) | Evidence | Status |
|---|---|---|---|---|---|
| Kestrel fire rate and mode | 11.0 rps, auto (§3.1) | DATA | `fireRateHz 11`, `auto` (src/config/weapon.ts:168-169) | probe, 10 simulated seconds, trigger held: 110 shots = 11.0/s, mean interval 0.0910 s (intervals 11 or 12 ticks, fractional carry); `sim.test.ts:221` | match |
| Pace fire rate and mode | 6.75 rps, semi (§3.1) | DATA | `fireRateHz 6.75`, `semi` (src/config/weapon.ts:129-130) | probe, ideal clicker, 10 s: 68 shots (first at t=0), mean interval 0.14820 s = 6.748/s; button held down fires exactly 1 shot per second of hold; `weapon.test.ts:396` | match |
| Kestrel magazine, reserve | 30, 60 (§7.2, §3.1) | DATA / WIKI | 30, 60 (src/config/weapon.ts:170-171) | probe: 30 shots then auto-reload, reserve 60 -> 30 | match |
| Pace magazine, reserve | 13, 39 | DATA / WIKI | 13, 39 (src/config/weapon.ts:131-132) | probe: 13 shots, reserve 39 -> 26 | match |
| Reload time Kestrel / Pace | 2.5 s / 1.5 s | DATA | 2.5, 1.5 (src/config/weapon.ts:172, 133) | probe: reload exactly 320 ticks = 2.500 s and 192 ticks = 1.500 s; `weapon.test.ts:318` | match |
| Equip time Kestrel / Pace | 1.0 s / 0.75 s | DATA | 1.0, 0.75 (src/config/weapon.ts:173, 134) | probe: swap to first shot exactly 128 ticks = 1.000 s and 96 ticks = 0.750 s; `weapon.test.ts:353` | match |
| ADS fire rate multiplier and ADS first-shot | rifles x0.9, first shot 0.1575 / 0.11 / 0.25 (§3.1, §3.3) | DATA | none | grep | not implemented |
| rifle_precise (Vane), smg (Rill), pistol_light, pistol_heavy, sniper: handling, spread, movement error, damage bands (§7.2 to §7.4) | per §7 | DATA | weapons absent | n/a | not implemented |

### 1.4 Damage, kills (§3.2, §4.1, §4.2, §6)

| Item | Spec value (§) | Confidence tag | Implemented value (file:line) | Evidence | Status |
|---|---|---|---|---|---|
| Kestrel damage bands | 0-20 m 156/39/33.15, 20-50 m 140/35/29.75 (§3.2, §7.4) | DATA | src/config/weapon.ts:187-188 | `damage.test.ts:27`, `weapon.test.ts:274` | match |
| Pace damage bands | 0-30 m 105/30/25.5, 30-50 m 87.5/25/21.25 | DATA | src/config/weapon.ts:148-149 | `damage.test.ts:55` | match |
| Stepwise falloff, last band beyond 50 m, floats kept | band containing the hit distance; 20 m ends band 1 (§3.2) | DATA | `distance <= upToM` (src/sim/damage.ts:11-20); no rounding | `damage.test.ts:44, 50`; boundary at exactly the band edge is not defined by the spec | match |
| Hitscan | instant (§3.6) | ESTIMATE 85% | `trace()` (src/sim/weapon.ts:112) | `sim.test.ts` hitscan block | placeholder-match |
| Health | 100 HP (§4.1, `health.max`) | OFFICIAL / H | src/config/player.ts:46 | `playerHealth.test.ts:43`, `shield.test.ts:120` | match |
| Armour capacities and absorb | light 25, heavy 50, 66% (§4.1) | OFFICIAL / H | src/config/player.ts:47 | `shield.test.ts:120` | match |
| Per-hit armour rule, total 100 + armour | `absorbed = min(0.66*dmg, shield)` (§4.1) | DERIVED | src/sim/damage.ts:28-31, applied to player (src/sim/playerHealth.ts:164) and Echoes (src/sim/targets.ts:511) | `shield.test.ts:112, 125, 209` | match |
| Bullets to kill, spec §6 table, Kestrel and Pace, shield 0/25/50, all zones, both bands | 36 cells (§6) | DERIVED | derived from the bands | `shield.test.ts:149-190` (39 rows x 3 zones, headline cases); the probe recomputed 12 rows x 3 shields = 36 cells: 0 mismatches | match |
| TTK = (bullets - 1) / fire rate | e.g. Kestrel body 4 = 0.273 s (§6) | DERIVED | fire-rate timing | `shield.test.ts:172` | match |
| Head and leg multipliers | per weapon, via the band numbers (§3.2, §4.2) | DATA | expressed as absolute band damage | `damage.test.ts` | match |
| Penetration class | Kestrel medium, Pace medium (§3.6, §7.4) | DATA | 'medium', 'medium' (src/config/weapon.ts:151, 190) | read | match |
| Damage retained through a wall | low 0.3, medium 0.5, high 0.7; v1 maps use no penetrable walls (§3.6) | PLACEHOLDER | none | grep | not implemented |
| Tracer lifetime | 0.06 s (§3.6) | PLACEHOLDER | `tracer.lifeSec 0.08` (src/config/feedback.ts:68) | read; design.md §7.1 table line 261 specifies "tracer ... 80 ms" | deviation |

### 1.5 Spread, recovery, recoil (§3.3 to §3.5)

| Item | Spec value (§) | Confidence tag | Implemented value (file:line) | Evidence | Status |
|---|---|---|---|---|---|
| First-shot error, standing | Kestrel 0.20, Pace 0.30 deg (§3.3, §7.3) | DATA | src/config/weapon.ts:175, 136 | probe: shot 1 spread 0.2 and 0.3 | match |
| Half-angle cone | first-shot angle is a half-angle (§3.3, `spread.half_angle`) | ESTIMATE 65% / M | `r = spreadDeg * u^p` is the cone radius angle (src/sim/weapon.ts:448-452) | `weapon.test.ts:473` (every bullet within spread) | placeholder-match |
| Centre-bias exponents | still 1.5, moving 0.5 (§3.3) | ESTIMATE 45% / L | 1.5, 0.5 (src/config/weapon.ts:212-213) | `weapon.test.ts:482` (mean radius band for still shots); the moving exponent has no statistical test | placeholder-match |
| Crouch multiplier and crouched first shot | Kestrel 0.85 -> 0.17, Pace 0.75 -> 0.23 (table) (§3.3) | DATA | 0.85, 0.75 (src/config/weapon.ts:177, 138); stance applied to accumulated spread (src/sim/weapon.ts:435-439) | probe: Kestrel crouch 0.17, Pace crouch 0.225 (the spec table's 0.23 is 0.225 rounded) | match |
| Max spread | Kestrel 0.9, Pace 1.65 deg (§3.3) | WIKI, medium | src/config/weapon.ts:176, 137 | probe: Kestrel spray reaches 0.9 at bullet 10 and stays; Pace tap series 0.300, 0.412, 0.750, 1.087, 1.425, 1.650 | match |
| Recovery time, Kestrel | 0.35 s | OFFICIAL | 0.35 (src/config/weapon.ts:178) | `weapon.test.ts:93` | match |
| Recovery time, Pace | 0.25 s | ESTIMATE 30% | 0.25 (src/config/weapon.ts:139) | `weapon.test.ts:93` | placeholder-match |
| Tap efficiency, Kestrel | 4 (§3.3) | OFFICIAL | 4 (src/config/weapon.ts:179) | `weapon.test.ts:85` | match |
| Tap efficiency, Pace | 3 | ESTIMATE 30% | 3 (src/config/weapon.ts:140) | probe: second tap 0.156 s later counts as held (0.222 s limit), spread follows spec formula 0.412 | placeholder-match |
| n_ramp | Kestrel 8, Pace 4 (§3.3) | ESTIMATE 30% | 8, 4 (src/config/weapon.ts:180, 141) | `weapon.test.ts:77` | placeholder-match |
| Spread model (reset after recovery, held +1, tap +1/tap_eff) | the §3.3 pseudocode | ESTIMATE 40% | src/sim/weaponModel.ts:13-25, src/sim/weapon.ts:418-427 | `weapon.test.ts:77-113`; probe spray: spread 0.200, 0.222, 0.309, ... 0.834, 0.900 | placeholder-match |
| Final spread formula, stance on stationary part, plus movement, plus landing | (§3.3) | ESTIMATE | src/sim/weapon.ts:431-440 | `weapon.test.ts:140` | placeholder-match |
| Movement-error values, Kestrel | crouch-moving 0.8, walk 3, run 6, air 10 (§3.4) | OFFICIAL corroboration | src/config/weapon.ts:181-184 | `weapon.test.ts:116-129` | match |
| Movement-error values, Pace | 0.5, 1.1, 2.3, 7 | WIKI / OFFICIAL (walk, run) | src/config/weapon.ts:142-145 | `weapon.test.ts:116-129` | match |
| Movement-error ramp shape | §3.4 pseudocode | ESTIMATE 40% | src/sim/weaponModel.ts:32-47 | `weapon.test.ts:116` | placeholder-match |
| Movement error observed in the sim, Kestrel walking | 3.0 deg (§3.4) | OFFICIAL | measured total 3.2 = 0.2 + 3 | probe | match |
| Movement error observed in the sim, Kestrel running | 6.0 | OFFICIAL | measured 6.2 = 0.2 + 6 | probe | match |
| Movement error observed in the sim, Kestrel crouch-walking | 0.8 deg added (total 0.17 + 0.8 = 0.97) | WIKI, medium (PN 2.02 corroboration) | measured total 1.501 = 0.17 + **1.331**: crouch speed 2.2 m/s is f = 0.407, above the 0.34 crouch-walk fraction, so the shot lands on the crouch-to-run ramp | probe | deviation |
| Movement error observed in the sim, Pace walking | 1.1 deg | OFFICIAL | measured 1.256 total = 0.3 + 0.956 (Pace walks at f = 0.471, not 0.5) | probe | deviation |
| Movement error observed in the sim, Pace running | 2.3 deg | OFFICIAL | measured 2.459 total = 0.3 + 2.159 (Pace runs at f = 0.941, not 1.0) | probe | deviation |
| Movement error observed in the sim, Pace crouch-walking | 0.5 deg | WIKI | measured 0.8435 total = 0.225 + 0.618 | probe | deviation |
| Recoil as data (per-bullet pitch and yaw arrays, recovery rate) | (§3.5 rule) | PLACEHOLDER | `recoilPitchDeg`, `recoilYawDeg` etc. (src/config/weapon.ts:74-92) | `weapon.test.ts:184-272` | match |
| Kestrel pitch kick | 0.30 deg bullets 1-11, then 0.07 (§3.5) | PLACEHOLDER 20% | `[...times(11, 0.3), 0.07]` (src/config/weapon.ts:192) | `weapon.test.ts:220`; probe pitch offset 0, 0.3, 0.6, ... 3.3 | placeholder-match |
| Kestrel yaw kick | 0.15 deg after the 8 protected bullets (§3.5) | PLACEHOLDER 20% | `[...times(8, 0), 0.15]` (src/config/weapon.ts:194) | `weapon.test.ts:204, 456`; probe yaw 0 until bullet 9, then 0.15 | placeholder-match |
| Kestrel yaw switch: protected 8, 10% chance, 0.6 s | (§3.5) | OFFICIAL (PN 11.08) | 8, 0.1, 0.6 (src/config/weapon.ts:195-197) | `weapon.test.ts:204, 210` (10,000 seeded bullets) | match |
| View recovery | 8 deg/s after the gun recovery time (§3.5) | PLACEHOLDER | `recoilReturnDegPerSec 8`, delay 0.35 s (src/config/weapon.ts:198-199) | `weapon.test.ts:258` | placeholder-match |
| Moving and jumping recoil multipliers | both axes x1.5, vertical x1.8 on rifles running (§3.5) | OFFICIAL (PN 4.0, 6.11) | 1.8 pitch, 1.5 yaw for Kestrel (src/config/weapon.ts:200-201); applied to any shot above the deadzone or airborne, not only running | `weapon.test.ts:237` | match |
| Crouched-stationary yaw recoil | -15% (§3.5) | OFFICIAL (PN 0.50) | 0.85 (src/config/weapon.ts:202) | `weapon.test.ts:237` | match |
| Pace recoil | 0.60 deg per shot, recovers within 0.25 s, no yaw (§3.5) | PLACEHOLDER 20% | `[0.6]`, return 2.4 deg/s from the first tick (src/config/weapon.ts:152-158) | `weapon.test.ts:237` | placeholder-match |
| 100-spray at a wall, impacts inside the cone | (§3.5 measure) | n/a | n/a | `weapon.test.ts:419-488` (100 bullets) | match |

### 1.6 Taking damage, tagging, flinch (§4)

| Item | Spec value (§) | Confidence tag | Implemented value (file:line) | Evidence | Status |
|---|---|---|---|---|---|
| Tag speed cap | 0.275 x max speed (72.5% slow) (§4.3, `tag.speed_scale`) | OFFICIAL 70% / M | `speedScale 0.275` (src/config/player.ts:48); cap = `m.runSpeed * tagScale` (src/sim/movement.ts:88) | `playerHealth.test.ts:184, 200`; probe: continuous hits hold speed at exactly 1.485 = threshold and the shot is not flagged moving (spread 0.2) | match |
| Tag cap against the equipped weapon's max speed | 0.275 x equipped run speed (§4.3) | OFFICIAL | cap uses `movement.runSpeed` 5.4 for every weapon | probe: Pace runner tagged: cap 1.485, spec 0.275 x 5.7375 = 1.578 (Pace tagged runner lands under its deadzone instead of on it) | deviation |
| Tag ramp-in | 0.10 s (§4.3, `tag.ramp_in`) | PLACEHOLDER / P | `rampInSec 0.1` (src/config/player.ts:48) | probe: from 5.4 the cap is first reached on tick 13 = 0.102 s; `playerHealth.test.ts:189` | placeholder-match |
| Tag release value | 0.5 s (§4.3, `tag.release`) | ESTIMATE 30% / L | `releaseSec 0.5` (src/config/player.ts:48) | `playerHealth.test.ts:184` | placeholder-match |
| Tag release behaviour: "release over 0.5 s after the last hit", "hold while hits continue" | full speed back 0.5 s after the last hit (§4.3 rule) | ESTIMATE 30% | the 0.5 s release starts only after the 0.1 s ramp completes, so one hit gives back full speed 0.6 s after it (`tagTotalSec`, src/sim/playerHealth.ts:71, 83-88); with hits every 0.2 s the cap is not held (speed oscillates 1.485 to 2.29) | probe: single hit, speed back at 5.4 on tick 77 = 0.602 s; hits every 11 ticks hold exactly the cap; every 26 ticks they do not; `playerHealth.test.ts:189` asserts 0.6 s | deviation |
| Tag applies to headshots and airborne targets, flat per bullet | yes, no scaling (§4.3) | ESTIMATE 40-70% | zone and weapon agnostic (src/sim/playerHealth.ts:177-179) | `playerHealth.test.ts:236` (airborne) | placeholder-match |
| Tag through a wall | 25% slow (§4.3) | OFFICIAL 50% | none (no penetrable walls) | n/a | not implemented |
| Flinch pitch kicks | head 2.0, body 0.6, leg 0.3 deg (§4.4) | PLACEHOLDER 20% | src/config/player.ts:49 | `playerHealth.test.ts:272` | placeholder-match |
| Flinch recovery | "recovering over 0.25 s" (§4.4, `flinch.recovery`) | PLACEHOLDER 20% | one rate for all kicks, `pitchHeadDeg / recoverySec` = 8 deg/s (src/sim/playerHealth.ts:145-147): head 0.25 s, body 0.075 s, leg 0.0375 s | `playerHealth.test.ts:260` tests the head case only | deviation |
| Flinch strength multiplier, 0 disables | (§4.4) | PLACEHOLDER | `strength 1` (src/config/player.ts:49) | `playerHealth.test.ts:280` | placeholder-match |

### 1.7 Targets (§5)

| Item | Spec value (§) | Confidence tag | Implemented value (file:line) | Evidence | Status |
|---|---|---|---|---|---|
| Head sphere | radius 0.14, centre 1.66 standing, 1.16 crouched (§5.1, `hit.head_*`) | ESTIMATE 30% / L | src/config/targets.ts:89-91 | `hitZones.test.ts:32-145` | placeholder-match |
| Torso and legs | torso 0.80-1.52 (0.55-1.02 crouched), legs 0-0.80 (0-0.55), widths 0.50 / 0.46 (§5.1) | ESTIMATE 30% / L | src/config/targets.ts:92-99 | `hitZones.test.ts:57-76, 134` | placeholder-match |
| Target health | 100 (§7.1) | H | `maxHp 100` (src/config/targets.ts:101) | `damage.test.ts:23` | match |
| Strafing target speeds 2.0 / 3.5 / 5.4 m/s and direction change 0.3-1.0 s | (§5.3, `target.speed_*`) | PLACEHOLDER 25% | roster has only Post (static) and Beacon (src/config/targets.ts:102-107) | n/a | not implemented |
| Target stop time | 0.16 s (§5.3, `target.stop_time`) | M | no moving targets | n/a | not implemented |

## 2. Counts per status

Total rows: 118

| Status | Rows |
|---|---|
| match | 45 |
| placeholder-match | 36 |
| deviation | 24 |
| not implemented | 13 |

Summary: of the rows that exist for the two built weapons and the player, the 24 deviations cluster in four root causes: (a) the player speed model ignores the equipped weapon (D1, D16, D19), (b) placeholder movement numbers that were never replaced (D2 to D15), (c) two interpretations of ambiguous spec wording (D17, D18), (d) one design-over-spec presentation value (D20). Weapon handling, damage bands, shield rule, bullets-to-kill, spread, recoil-as-data, FOV and sensitivity all match; the spec's own placeholder values match everywhere they were applied except the movement block.


## 3. Deviations, with reasons

Where a reason exists in the repo it is cited; "explained" means a written reason covers it, "unexplained" means none does. Reasons were searched in code comments, `docs/design.md` and the backlog in design.md §17; the playtest then matched them against open issues (#73 covers D1–D16 except D11).

**Common written reason for the movement values.** `src/config/movement.ts:2-4`: "PLACEHOLDER VALUES: `docs/mechanics-spec.md` holds the researched numbers and a later task applies them here (a data-only change; the movement code reads only these fields)". `src/sim/movement.ts:19-22` says "Placeholder player movement ... Replace the numbers via config/movement.ts". `weapon.test.ts:161` also calls walk speed "placeholder" (and `sim.test.ts:197` hard-codes "walk speed 2.7 of 5.4"). This explains value-only differences. Two caveats: (1) the "data-only change" claim is wrong for several rows below, because the sim code has no per-weapon speed, no two-band braking, no weapon-scaled braking and no air-speed preservation (src/sim/movement.ts:70, 74-83, 88); (2) design.md §17 has no backlog item that names applying these numbers (the only movement-related items are #47 Stop & Pop and #67 feel tuning, and design §14.7 says feel tuning must not change numbers that have a conformance row), so nothing is tracking the work.

| # | Deviation | Precise mismatch | Reason written down? | Judgement |
|---|---|---|---|---|
| D1 | Pace run, walk speed (rows "Run speed, pistol_accurate", "Walk speed, Pace") | Pace moves at 5.4 / 2.7 m/s; spec 5.7375 / 2.869. `pace.runSpeedMps 5.7375` exists in src/config/weapon.ts:135 and is documented there as "Equipped run speed ... the max speed of the deadzone" but `stepPlayer` (src/sim/movement.ts:70) never reads it, so the accuracy fraction f = speed / runSpeedMps is wrong for Pace. | The movement header comment says placeholder, but the weapon config contradicts it by claiming the equipped speed drives the deadzone. | **Unexplained** (logic gap, not a value; the header's "data-only" claim is false here). |
| D2 | Crouch-walk speed | 2.2 m/s = 0.407 of run; spec 0.34 x 5.4 = 1.836 m/s. Consequence measured: Kestrel crouch-walk shot error is +1.33 deg, not the spec's +0.8 (Pace +0.62 vs +0.5), because speed sits above the 0.34 crouch fraction the same codebase uses (src/config/weapon.ts:209). | Header placeholder comment only. | **Explained as a placeholder value** (weakly), but it silently breaks the spec's crouch-moving accuracy; `weapon.test.ts:123` only tests the error function at f = 0.34, never the real crouch speed. |
| D3 | Acceleration | 0.078 s to full speed (70 m/s^2) vs 0.20 s (ESTIMATE 35%). | Header placeholder comment. | **Explained** (placeholder), but not tracked. |
| D4 | Braking | Single constant 70 m/s^2 vs spec 39 m/s^2 above 25% of max and 24 m/s^2 below, scaled by max/5.4. | Header comment, which wrongly calls it a data-only change. | **Unexplained for the structure**: two bands and weapon scaling need sim code that does not exist. |
| D5 | Stop time from run | 0.078 s vs 0.160 s (OFFICIAL data). | Header comment. | **Explained as placeholder**, high impact: it is the spec's #2 ranked mechanic (§8). |
| D6 | First accurate shot after stopping | Error is zero from 0.0625 s after release (tick 8), spec 0.100 +- 0.01 s (§2.5, an explicit automated-test requirement). The 0.100 s sample itself reads zero, so a test that only checks t = 0.100 would pass; the spec intent (accurate no earlier than about 0.10 s) is violated by 37%. Follows from D5. Design.md §4.4 Stop & Pop text quotes "about 0.10 s after the stopping input", so the mode copy and the sim disagree. | Header comment (by inheritance from D4/D5). | **Explained as placeholder; design.md copy contradicts the sim**. |
| D7 | Gravity | 22 m/s^2 vs 20 (PLACEHOLDER; value is not a match). | Header comment. | **Explained**. |
| D8 | Takeoff speed | 6.0 m/s vs 6.32. | Header comment. | **Explained**. |
| D9 | Jump apex | 0.795 m measured (0.818 analytic) vs 1.0 m; inside the spec's 0.8-1.2 m bound only at its bottom edge. `sim.test.ts:92-100` computes its expectation from the tunables, so it cannot catch this. | Header comment. | **Explained**. |
| D10 | Airtime | 0.539 s vs 0.63 s. | Header comment. | **Explained**. |
| D11 | Air horizontal speed | Not preserved: with keys released the player brakes toward 0 in the air at 12 m/s^2 (5.4 -> 0 before landing). Spec: preserved from takeoff. | None; the sim comment describes "wish-velocity acceleration on the ground and in the air" as a design choice of the placeholder model. | **Unexplained** (model-level; not a number swap). |
| D12 | Air acceleration | 12 m/s^2 vs 0.25 x ground accel (about 6.8 for a rifle at the spec's 0.2 s). | Header comment. | **Explained** as a value, but see D11. |
| D13 | Crouched hull height | 1.40 m vs 1.30 m (PLACEHOLDER). Also disagrees with the Echo crouched hit zone top (1.30, src/config/targets.ts:92-94), against the spec's "map geometry and hitboxes use the same values". | Header comment. | **Explained**. |
| D14 | Crouched eye height | 1.22 m vs 1.17 m. | Header comment. | **Explained**. |
| D15 | Crouch transition | Hull height changes in 1 tick; eye takes 0.094 s down and 0.102 s up; spec 0.15 s. | Header comment. | **Explained**. |
| D16 | Tag cap versus equipped weapon | Uses 5.4 for every weapon (src/sim/movement.ts:88); Pace should cap at 1.578 m/s. | None. | **Unexplained**, same root cause as D1. |
| D17 | Tag release timing | One hit restores full speed 0.60 s after the hit (0.1 s ramp then 0.5 s release); literal spec "release over 0.5 s after the last hit". Hits spaced more than 0.1 s apart do not hold the cap. | Yes: code comment src/sim/playerHealth.ts:75-82 ("the slow then lasts ramp_in + release in all"), asserted by `playerHealth.test.ts:189-198`. | **Explained**; a reasonable reading of an ambiguous spec sentence, but not recorded as an interpretation in the spec. Low severity. |
| D18 | Flinch recovery | Body and leg kicks recover in 0.075 s and 0.0375 s; spec lists one recovery of 0.25 s for the effect. | Yes: field comment "smaller kicks recover at the same rate" (src/config/player.ts:38). | **Explained** (documented choice), spec is ambiguous; PLACEHOLDER feature. Low severity. |
| D19 | Movement-error values observed for Pace (3 rows) and Kestrel crouch-walk (1 row) | Consequence of D1 and D2, listed as separate behaviour rows because the spec's §3.4 numbers are not what a player gets. | See D1, D2. | **Unexplained** for Pace (D1), explained for crouch (D2). |
| D20 | Tracer lifetime | 0.08 s vs 0.06 s (PLACEHOLDER, cosmetic). | Yes: design.md §7.1 (line 261) specifies "tracer (thin bright quad, 80 ms)". | **Explained** (design overrides the spec's placeholder); the spec should be updated. |

