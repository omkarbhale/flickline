# Flickline mechanics spec

Single source of numbers and rules for Flickline's shooting and movement. The goal is that practice here transfers to a modern tactical shooter, the **reference game** (Valorant). Only mechanics and feel are modelled on the reference game. Flickline uses its own names, weapons, maps, enemies, art, sound and interface; nothing here recommends copying any of them. Reference weapons are named only to say where an archetype's numbers come from.

- Research date: 2026-11-14. Reference game build when researched: **13.10** (build dated 2026-11-07, per `valorant-api.com/v1/version`).
- Tracking issue: omkarbhale/flickline#7.
- Flickline simulates in **metres, seconds, degrees**. Every length and speed below is also given in the reference unit (see 0.2).

---

## 0. How to read this document

### 0.1 Confidence tags

| Tag | Meaning |
|---|---|
| **OFFICIAL** | Riot patch note, Riot dev post, or Riot's own wiki. |
| **DATA** | Extracted game data (the values behind the in-game armory, via `valorant-api.com`), cross-checked against the Riot wiki. Treated as authoritative. |
| **COMMUNITY** | Several independent community sources agree, none from Riot. |
| **DERIVED** | Arithmetic on sourced numbers; the arithmetic is shown or checkable. |
| **ESTIMATE (confidence %)** | Not public. Best guess, with the confidence I place in it and how to measure or tune it. |
| **PLACEHOLDER** | A Flickline design choice where the reference game gives no usable number. Tune by feel. |

Source tags in square brackets, e.g. `[API]`, `[PN 3.0]`, resolve to URLs in section 11. A number without a tag is DERIVED from the tagged numbers next to it.

### 0.2 Units

The reference game runs on Unreal Engine, whose default unit is the centimetre. Riot does not state the unit scale. **ESTIMATE (about 70%): 1 reference unit (uu) = 1 cm, so 100 uu = 1 m.** Supporting evidence: Unreal default `[UE-UNITS]`; every published speed is a clean multiple of 675 uu/s (6.75 m/s) `[WIKI-R Melee]`. Do not use Source-engine units (Hammer unit = 0.01905 m); they do not apply.

Because of this assumption, every length and speed below carries a `uu` column or note. Angles are in degrees and are unit-independent. Times are seconds.

How to verify the unit scale: time a knife run across a distance of known length in the Range and compare with 6.75 m/s; or take any ability range printed in metres on the Riot wiki and compare with its datamined range in uu.

### 0.3 Flickline archetype names

| Flickline archetype ID | Role | Numbers come from (reference weapon) |
|---|---|---|
| `rifle_precise` | One-tap rifle: high damage, no falloff, punishes spray | Vandal |
| `rifle_spray` | Controllable spray rifle: faster fire, falloff past 20 m | Phantom (Flickline has no silenced variant) |
| `smg` | Close-range spray, fast move speed | Spectre |
| `pistol_light` | Free starter sidearm, semi-auto | Classic (primary fire only) |
| `pistol_accurate` | Accurate sidearm, semi-auto, one-tap head up close | Ghost |
| `pistol_heavy` | Heavy pistol: 2-hit body kill, slow fire | Sheriff |
| `sniper` | Bolt-style sniper: one-shot body kill, scoped | Operator |

Flickline gives these its own display names, models and sounds; the IDs above are config keys only.

---

## 1. View and input

### 1.1 Field of view

| Item | Value | Tag |
|---|---|---|
| Horizontal FOV at 16:9 | **103°** | COMMUNITY: four independent sources `[S-FOV]` `[RECH]` `[EDPI]` `[SPIND]` |
| Vertical FOV at 16:9 | **70.53°** (2·atan(tan(51.5°)·9/16)) | DERIVED; a forum post quotes 70.5328 `[MS-FOV43]`, a trainer developer quotes 71 `[S-FOV]` |
| In-game FOV slider | none | COMMUNITY `[GGR-FOV]` `[SK-FOV]` |
| Projection | perspective, rectilinear | standard |

One FOV-calculator site claims 103° is the *vertical* FOV. I reject it: it contradicts the other four sources, and its own 16:10 figure is geometrically inconsistent with its claim.

**Behaviour at other aspect ratios is not publicly confirmed.** Known: 4:3 with Fill keeps the same world view stretched, not cropped `[SK-FOV]` `[MM-43]`; Riot lists 4:3, 5:4, 16:10, 16:9, 21:9 as supported and recommends 16:9 `[RIOT-RES]`. If the game holds *vertical* FOV fixed (Hor+), horizontal FOV would be:

| Aspect | hFOV (vertical fixed at 70.53°) | Tag |
|---|---|---|
| 16:9 | 103.00° | sourced |
| 16:10 | 97.06° | ESTIMATE (55%) |
| 4:3 | 86.63° | ESTIMATE (55%); a forum snippet quotes the same figure `[MS-FOV43]` |
| 5:4 | 82.95° | ESTIMATE (55%) |
| 21:9 (64:27) | 118.36° | ESTIMATE (40%), the game may cap or pillarbox |
| 32:9 | 136.62° | ESTIMATE (30%), the game may cap or pillarbox |

**Flickline rule:** design and test at 16:9 with **hFOV 103°**. Store the FOV as the **vertical** angle 70.53° and derive hFOV from the canvas aspect (Hor+). Do not offer an FOV slider by default (the reference game has none, and a different FOV changes target apparent size and the feel of every flick). A "match my reference game" mode is exactly this default.

### 1.2 Sensitivity scale

Reference yaw is **0.07° per mouse count at sensitivity 1.0**, fixed, not configurable. COMMUNITY: four independent converter sites list the same value `[CSDB]` `[METABOT]` `[MINIWEB]` `[RECH]`. Pitch uses the same factor (community convention, **ESTIMATE 85%**; no source states it).

```
yaw_deg_per_count   = 0.07 * sens
deg_per_inch        = DPI * sens * 0.07
cm_per_360          = 914.4 / (DPI * sens * 0.07)   = 13062.86 / (DPI * sens)
inches_per_360      = 5142.86 / (DPI * sens)
eDPI                = DPI * sens
```

Check: 800 DPI at sens 0.5 gives 914.4 / 28 = 32.66 cm/360 (matches `[RECH]`'s worked example). 800 DPI at 0.4 gives 40.82 cm/360; 1600 DPI at 0.2 gives the same.

Conversions (`target_sens = valorant_sens * 0.07 / target_yaw`; all hold cm/360 constant and assume the same DPI):

| To game | Target yaw (deg/count) | Multiply reference sens by | Tag |
|---|---|---|---|
| CS2 / CS:GO / Source (m_yaw) | 0.022 | **3.181818** (35/11); reverse ×0.314286 | COMMUNITY, verified in four places `[CSDB]` `[RECH]` `[METABOT]` `[MINIWEB]` |
| Apex Legends | 0.022 | 3.181818 | COMMUNITY `[CSDB]` `[RECH]` |
| Overwatch 2 / CoD / Destiny 2 | 0.0066 | 10.606 | COMMUNITY `[CSDB]` `[RECH]` |
| Rainbow Six Siege | 0.00572958 | 12.22 | ESTIMATE (70%), one table `[CSDB]` |
| Fortnite (percent units) | 0.005555 per 1% | about 12.6 | ESTIMATE (60%); Fortnite's slider depends on FOV, treat as approximate `[CSDB]` `[MINIWEB]` |

**Flickline rule:** use the same scale. Flickline sensitivity 1.0 = 0.07° per count, so a player's reference-game sensitivity can be typed in unchanged. Show cm/360 live next to the slider (need the player's DPI). Raw input only: no mouse acceleration, no smoothing, no per-frame filtering. Pitch clamp ±89°.

### 1.3 Scoped (zoomed) sensitivity

The reference game has two multipliers on top of base sensitivity: **ADS** (rifles, SMGs, heavies) and **Scoped** (snipers). Default for both is **1.0**; one Scoped value covers all sniper scopes `[EDPI]` `[RECH]` (COMMUNITY).

Zoom factors (COMMUNITY, `[EDPI]` cites community posts from March 2023 and March 2026; partly matched by `[RECH]` and `[DT]`):

| Zoom | Archetype | Slider |
|---|---|---|
| 1.15× | `smg` (Spectre) | ADS |
| 1.25× | `rifle_precise`, `rifle_spray` (Vandal, Phantom) | ADS |
| 2.5× then 5× (two stages) | `sniper` (Operator) | Scoped |

Other reference weapons zoom 1.15× (Stinger, heavies), 1.5× (Guardian), 3.5× (Marshal, Outlaw). Disagreement: an older article gives 1.25× for the heavies and 2.5× for Marshal; I trust the newer sources (1.15× and 3.5×), confidence 70% `[DT]` `[EDPI]` `[RECH]`.

Behaviour (community model, **ESTIMATE 65%**, derived by `[EDPI]` and reproduced by me):

- Scoped horizontal FOV = 103° / zoom (plain angle division, not tangent-based): 1.15× → 89.6°, 1.25× → 82.4°, 2.5× → 41.2°, 3.5× → 29.4°, 5× → 20.6°.
- Scoped yaw at multiplier 1.0 = base yaw / zoom: 2.5× → 0.028°/count, 5× → 0.014°/count (at sens 1.0). So rotation is divided by the zoom factor and the multiplier then scales it.
- Reproducing the community's six "crosshair-match" multipliers (0.908, 0.870, 0.815, 0.747, 0.731, 0.723) from this model works to three decimals. They are probably produced by the same formula, so this shows internal consistency, not independent proof.

**Flickline rule:** implement exactly this model (FOV = 103°/zoom, rotation = base/zoom × multiplier, default multiplier 1.0). Because the model is unverified, expose "scoped FOV model" as a tunable (angle-division default; tangent-based alternative gives 95.1°/90.3°/79.9°/53.4°/39.5°/28.2°). Measure by comparing the angular size of a known-size object scoped vs unscoped in the reference game.

### 1.4 Simulation and input timing

- The reference game's servers and clients run a **fixed 128 Hz simulation**, server-authoritative with client prediction, independent of render rate. OFFICIAL `[RIOT-NETCODE]` `[RIOT-128]`.
- **Flickline rule:** simulate movement and weapon state at a fixed **128 Hz** (7.8125 ms) tick, render at display rate (144+ Hz) with interpolation, and apply mouse look at render rate (sampled per frame, not per tick) so aim never feels quantised. Fire and movement inputs are timestamped and resolved at the tick that contains them. Hit detection is hitscan; there is no network, so no lag compensation is needed.

---

## 2. Movement

### 2.1 Base speed and equipped speed

Base (knife) run speed is **6.75 m/s = 675 uu/s** OFFICIAL `[WIKI-R Melee]`. Run speed with a weapon equipped is a fixed multiple. DATA (`[API]` `runSpeedMultiplier`), and the Riot wiki prints the same m/s for every weapon I checked `[WIKI-R weapons]`.

| Class (archetype) | Multiplier | Run m/s | Run uu/s (ESTIMATE, unit scale) |
|---|---|---|---|
| Knife (no weapon) | 1.00 | 6.75 | 675 |
| Rifles (`rifle_precise`, `rifle_spray`) | 0.80 | 5.40 | 540 |
| SMG (`smg`) | 0.85 | 5.7375 | 574 |
| Light/accurate pistols (`pistol_light`, `pistol_accurate`) | 0.85 | 5.7375 | 574 |
| Heavy pistol (`pistol_heavy`) | 0.80 | 5.40 | 540 |
| Sniper (`sniper`) | 0.76 | 5.13 | 513 |
| Shotguns (not in v1) | 0.75 | 5.0625 | 506 |
| Heavy machine guns (not in v1) | 0.76 | 5.13 | 513 |

ADS / scoped move speed is a further multiplier on the weapon's run speed `[WIKI-R weapons]` `[API]`: rifles 0.76 (Vandal ADS = 0.76 × 5.4 = 4.104 m/s), SMG 0.76 (4.361 m/s), sniper scoped 0.72 (3.694 m/s; cut from 0.76 in patch 1.09 `[PN 1.09]`).

### 2.2 Walk, crouch-walk

**Not public.** Riot publishes no walk or crouch-walk multiplier `[RIOT-WALK]`. What exists: a blog claims walk is "about half" of run (unsourced `[AIMFINDER]`), and Riot's dev stop test has a column labelled "61%" that is possibly the walk speed fraction `[DEVTRACK]`; the post does not define it.

| Quantity | Recommended | Range | Tag |
|---|---|---|---|
| Walk speed (shift) as fraction of equipped run speed | **0.50** | 0.40 to 0.61 | ESTIMATE (35%) |
| Crouch-walk speed fraction | **0.34** | 0.25 to 0.5 | ESTIMATE (25%) |

Reasoning: the walk and crouch-walk accuracy penalties exist and are non-zero (section 3.4), so both speeds must sit above the 27.5% accuracy deadzone; crouch-walk has the small +0.8° penalty, so it is only slightly above it. 0.34 is placed just above the deadzone. Rifle example: walk 2.70 m/s (270 uu/s), crouch-walk 1.84 m/s (184 uu/s).

Measure: record the Range at 60+ fps, run, shift-walk, and crouch-walk across one marked distance, divide. Do it with the knife out and with a rifle to confirm both scale with the weapon multiplier.

### 2.3 Acceleration, deceleration, friction

**Stopping (the best data we have).** A Riot designer's 2020 test on a rifle, timed from the moment of the stopping input (approximate; frame-rate and human-input variance), OFFICIAL `[DEVTRACK]` (reproduced in `[TURBOSMURFS]`):

| Method | Run → walk level ("61%") | Run → deadzone ("25%") | Run → stop |
|---|---|---|---|
| Standard counter-strafe | 0.055 s | 0.104 s | **0.160 s** |
| Walk key held (no counter-strafe) | 0.065 s | 0.110 s | 0.170 s |
| Walk key + counter-strafe | 0.060 s | 0.107 s | 0.166 s |

Riot's conclusion: letting go of movement inputs, or counter-strafing, is faster than holding a walk key `[DEVTRACK]`. The test has no release-only row and does not define the start of timing. Community sources disagree on whether counter-strafe beats plain release `[SPIKE-CS]` `[WOOTING]`.

Derived deceleration (rifle, 5.4 m/s): 100% → 61% in 0.055 s = 38 m/s²; 61% → 25% in 0.049 s = 40 m/s²; 25% → 0 in 0.056 s = 24 m/s². So braking is roughly constant at ~39 m/s² (about 7.2 × run speed per second) down to the deadzone, with a softer tail. Average to a full stop: 5.4 / 0.160 = 33.8 m/s². At today's 27.5% deadzone, the accuracy gate is reached about 0.100 s after the stopping input (interpolated, ESTIMATE 60%).

**Acceleration, friction, air control: not public.** One ex-pro coach says players accelerate "much slower than in any CS game" `[SK-TWIX]`; the wiki says movement penalties "ramp up as agents accelerate and taper off as they decelerate" `[WIKI-F Weapons]`. A mirror of the braking numbers would give about 0.15 s to full speed, but the coach's quote argues for slower.

| Quantity | Recommended | Tag |
|---|---|---|
| Time from rest to full speed (input held) | **0.20 s** (linear ramp) | ESTIMATE (35%) |
| Braking, speed above 25% of max (input released or reversed) | **39 m/s²** (3900 uu/s²) | DERIVED from `[DEVTRACK]`, 60% |
| Braking, speed at or below 25% of max | **24 m/s²** (2400 uu/s²) | DERIVED from `[DEVTRACK]`, 55% |
| Full stop from rifle run speed | 0.16 s | OFFICIAL `[DEVTRACK]` (2020 data) |
| Counter-strafe bonus beyond release | none (default); tunable | ESTIMATE (45%) |

Flickline rule: braking is constant-deceleration (not exponential friction) in the two bands above, and the same whether the player releases or presses the opposite key; an opposite key additionally starts accelerating the other way at the normal rate. That makes the stop time depend only on speed, which is the property players rely on. Expose both braking numbers and the acceleration time as tunables; scale braking by `weapon_max_speed / 5.4` so stop *time* stays 0.16 s for every weapon.

Measure acceleration: 240 fps capture of a knife run from rest, track position per frame, fit v(t). Measure release-only stop the same way and compare with counter-strafe.

### 2.4 Accuracy gating by speed ("deadzone")

Riot defines the deadzone as "the movement speed a player becomes inaccurate" `[PN 3.0]`. History: 25% → 30% (patch 0.50) `[PN 0.50]`; **30% → 27.5% for all weapons** (patch 3.0) `[PN 3.0]`; Operator specifically **15%** (patch 1.09) `[PN 1.09]`. No later change found through 13.10 (patches 9.10 and 12.09 changed movement spread numbers but not thresholds) `[PN 9.10]` `[PN 12.09]`.

| Quantity | Value | Tag |
|---|---|---|
| Accuracy deadzone, all weapons except sniper | **27.5% of max speed** | OFFICIAL (3.0), still current at 70% confidence |
| Accuracy deadzone, sniper | **15% of max speed** | OFFICIAL (1.09), unclear whether 3.0 overwrote it; 65% |
| "Max speed" it is measured against | the equipped weapon's run speed | ESTIMATE (70%); the notes do not define it |

Examples: rifle deadzone = 0.275 × 5.4 = **1.485 m/s** (148.5 uu/s); sniper = 0.15 × 5.13 = **0.77 m/s**; SMG = 0.275 × 5.7375 = 1.578 m/s.

The pre-3.0 30% rule was exploitable: staying at or below the threshold while strafing in a small space kept full accuracy `[GGR-ACC]`. Flickline must test that a player cannot hold the threshold indefinitely with tiny inputs for free accuracy; the reference game accepts this behaviour at 27.5%, so keep it, but log it.

### 2.5 Time before shots are accurate after stopping

Practical figure, rifle (ESTIMATE 60%, from `[DEVTRACK]` 2020 data and today's 27.5% gate): **first fully accurate shot about 0.10 s after the stopping input; a complete stop about 0.16 s.** Sniper (15% gate): about 0.13 s (ESTIMATE 40%). Flickline gets this for free if section 2.3 braking and section 3.4 gating are implemented as written; verify with an automated test: from full run, release, the shot error must be zero at t = 0.100 ± 0.01 s.

### 2.6 Jump, air control, landing

Riot publishes **no** jump height, airtime or gravity.

| Quantity | Recommended | Tag |
|---|---|---|
| Jump apex (flat ground) | **1.0 m** (100 uu) | ESTIMATE (35%). Only a bound exists: patch 0.50 retuned a "jump height to escape damaging area-denial" threshold from 80 to 120, in unlabelled units (probably uu = cm), implying a normal jump apex between 0.8 and 1.2 m `[PN 0.50]` |
| Gravity | **20 m/s²** (2000 uu/s²) | PLACEHOLDER |
| Takeoff vertical speed | 6.32 m/s (= √(2·g·h)) | DERIVED |
| Airtime on flat ground | **0.63 s** (= 2·√(2h/g)) | DERIVED; a fan guide quotes 0.6 s for one agent's base jump (low quality, not used) `[SWITCHBLADE]` |
| Horizontal speed in air | preserved from takeoff, never above the equipped run speed | ESTIMATE (55%) |
| Air acceleration | **0.25 × ground acceleration** (about 6.8 m/s² for a rifle) | ESTIMATE (25%) |
| Bunny-hop speed gain | none | ESTIMATE (65%); qualitative sources `[THEGAMER-BHOP]` |
| Crouch-jump (hold crouch in the air for extra reach) | exists in the reference game; v1 default: **off** | `[DEXERTO-BOOST]`; no numbers |
| Landing inaccuracy | **+7.0° for 0.225 s**, binary (full value for the whole window) | OFFICIAL `[PN 1.09]`, current at 75% |
| Landing speed loss | none | ESTIMATE (50%) |
| Airborne inaccuracy | **+10°** rifles/SMGs, **+7°** pistols, **+15°** sniper | `[WIKI-F weapons]`, medium confidence (wiki only) |

Measure: capture a side-on jump at 120+ fps in the Range; count frames from leaving the ground to landing (T) and read apex against a known height (h); then g = 8h/T² and takeoff speed = 4h/T. Do the crouch-jump the same way.

### 2.7 Player collision, eye height, crouch

Riot publishes **no** capsule, eye or crouch heights. All agents share one gameplay hitbox `[GAMEPRESSURE]` `[MEINMMO]` (second-hand) and hitboxes follow the pose, so crouching lowers them `[RIOT-HITREG]` (OFFICIAL, hit registration post). Map visual detail is kept outside the 0.3 to 2.7 m band, so combat heights fit inside it `[SPIKE-ASCENT]` (secondary).

| Quantity | Recommended (m) | uu | Tag |
|---|---|---|---|
| Standing hull height | **1.80** | 180 | ESTIMATE (30%); equals the generic Unreal character height `[WOLD-SCALE]`; one blog claims 2.0 m, unsourced `[ESPORTSTALK]` |
| Hull radius | **0.30** | 30 | PLACEHOLDER |
| Eye height, standing | **1.62** | 162 | ESTIMATE (30%); 90% of hull height |
| Crouched hull height | **1.30** | 130 | PLACEHOLDER |
| Eye height, crouched | **1.17** | 117 | PLACEHOLDER |
| Crouch transition (down or up) | **0.15 s** | | PLACEHOLDER |
| Step height (walk up a ledge or stair riser without jumping; also the longest drop walked down without becoming airborne) | **0.35** (authored risers stay at or below 0.30) | 35 | PLACEHOLDER; at least 0.30 as issue #133 requires |
| Slopes: horizontal speed on a ramp | unchanged (the run, walk and crouch speeds above apply to the horizontal component; no uphill slow-down or downhill speed-up) | | ESTIMATE (45%): the reference game's ramp behaviour is not published |
| Steepest walkable ramp a map may author | 45 degrees (the map lint enforces it; typical ramps 12 to 25) | | PLACEHOLDER |

Flickline's own maps are designed around these numbers, so what matters is that the **map geometry and the hitboxes use the same values**. Measure any of them in the reference game by lining up a map ledge of known height with the crosshair at standing and crouched eye height; calibrate the world scale first with the 6.75 m/s knife run.

---

## 3. Shooting

### 3.1 Weapon handling

All DATA `[API]` (build 13.10), cross-checked against the Riot wiki and, for the changes, patch notes (Vandal 9.25 → 9.75 rps and 39 → 40 body in 1.07 `[PN 1.07]`; Phantom falloff reworked to a single break at 20 m in 9.10 `[PN 9.10]`). Fire rate in rounds per second; the shot interval is its reciprocal.

| Archetype | Ref. weapon | Fire rate (rps) | Interval (s) | Mode | Mag | Reserve | Reload (s) | Equip (s) | Run mult. |
|---|---|---|---|---|---|---|---|---|---|
| `rifle_precise` | Vandal | 9.75 | 0.1026 | auto | 25 | 50 | 2.5 | 1.0 | 0.80 |
| `rifle_spray` | Phantom | 11.0 | 0.0909 | auto | 30 | 60 | 2.5 | 1.0 | 0.80 |
| `smg` | Spectre | 13.333 | 0.0750 | auto | 30 | 90 | 2.25 | 0.75 | 0.85 |
| `pistol_light` | Classic | 6.75 | 0.1481 | semi | 12 | 36 | 1.75 | 0.75 | 0.85 |
| `pistol_accurate` | Ghost | 6.75 | 0.1481 | semi | 13 | 39 | 1.5 | 0.75 | 0.85 |
| `pistol_heavy` | Sheriff | 4.0 | 0.2500 | semi | 6 | 24 | 2.25 | 1.0 | 0.80 |
| `sniper` | Operator | 0.6 | 1.6667 | semi | 5 | 10 | 3.7 | 1.5 | 0.76 |

Reserve ammo is wiki-sourced (medium confidence) `[WIKI-F weapons]`. Alternate fire: rifles ADS at 90% fire rate (Vandal 8.775 rps, Phantom 9.9 rps) `[API]`; SMG ADS 12 rps; sniper has no rate change.

Disagreements checked: "9.75 vs 11 rps" is two different weapons, not a conflict; Vandal 9.25 rps and 39 body damage are the pre-1.07 values and stale. Fast and instant equip variants exist for ability interactions `[WIKI-F weapons]`; Flickline v1 has no abilities, so use the normal equip time.

### 3.2 Damage

All DATA `[API]`, with the wiki agreeing; the wiki floors decimals for display (Phantom leg 33.15 shows as 33). Flickline: keep floats in the simulation, floor only what is displayed.

| Archetype | Range from (m) | Range to (m) | Head | Body | Leg | Head mult. | Leg mult. |
|---|---|---|---|---|---|---|---|
| `rifle_precise` | 0 | 50 | 160 | 40 | 34 | 4.0 | 0.85 |
| `rifle_spray` | 0 | 20 | 156 | 39 | 33.15 | 4.0 | 0.85 |
| `rifle_spray` | 20 | 50 | 140 | 35 | 29.75 | 4.0 | 0.85 |
| `smg` | 0 | 15 | 78 | 26 | 22.1 | 3.0 | 0.85 |
| `smg` | 15 | 30 | 66 | 22 | 18.7 | 3.0 | 0.85 |
| `smg` | 30 | 50 | 60 | 20 | 17 | 3.0 | 0.85 |
| `pistol_light` | 0 | 30 | 78 | 26 | 22.1 | 3.0 | 0.85 |
| `pistol_light` | 30 | 50 | 66 | 22 | 18.7 | 3.0 | 0.85 |
| `pistol_accurate` | 0 | 30 | 105 | 30 | 25.5 | 3.5 | 0.85 |
| `pistol_accurate` | 30 | 50 | 87.5 | 25 | 21.25 | 3.5 | 0.85 |
| `pistol_heavy` | 0 | 30 | 159.5 | 55 | 46.75 | 2.9 | 0.85 |
| `pistol_heavy` | 30 | 50 | 145 | 50 | 42.5 | 2.9 | 0.85 |
| `sniper` | 0 | 50 | 255 | 150 | 120 | 1.7 | 0.80 |

Important: the head multiplier is **per weapon**, not a flat 4×. It is 4× only for the two rifles; the common claim "head 4×, leg 0.85×" is the rifle case `[API]`. Ranges are in metres (range × 100 = uu). 50 m is the last falloff bin for every weapon `[API]`; beyond 50 m use the last band.

Falloff is stepwise (bands), not a continuous curve. Hitscan: damage is decided by the band that contains the hit distance.

### 3.3 First-shot accuracy and spread

**First-shot error is a fixed angle in degrees per weapon**, a property of the weapon, not of the player. DATA `[API]` (`firstBulletAccuracy`); the wiki labels it "1st shot spread" `[WIKI-F weapons]`.

- There is **no "perfect" first shot for most weapons**. Only four reference weapons (Guardian, Marshal, Outlaw, Operator) get zero error, and only when scoped `[WIKI-F Weapons]`. Vandal and Phantom still have 0.25° and 0.20° when standing still and fully recovered.
- Whether the degree figure is a half-angle (maximum deviation from the crosshair) or a full cone is not stated. **ESTIMATE (65%): half-angle.** Cone radius at distance d is d·tan(θ).
- Distribution (ESTIMATE, 45%): stationary shots are biased toward the centre ("Error Power"); moving shots are almost uniformly random inside the cone `[PN 6.11]`. Model: stationary radius = θ · U^1.5; moving radius = θ · √U (uniform over the disc); U uniform in [0,1], direction uniform in angle. Tune by measuring how often a stationary first-shot tap at 20 m lands inside a head-sized circle.

Cone radius for the precise rifle (0.25°) and spray rifle (0.20°), in cm:

| Distance | 10 m | 20 m | 30 m | 50 m |
|---|---|---|---|---|
| 0.20° (`rifle_spray`) | 3.5 | 7.0 | 10.5 | 17.5 |
| 0.25° (`rifle_precise`) | 4.4 | 8.7 | 13.1 | 21.8 |
| 0.40° (`smg`, `pistol_light`) | 7.0 | 14.0 | 20.9 | 34.9 |
| 1.0° (rifle max spread) | 17.5 | 34.9 | 52.4 | 87.3 |

First-shot error and max spread, standing (DATA for first shot `[API]`; the max values are WIKI, medium confidence `[WIKI-F weapons]`):

| Archetype | First shot (°) | Max spread (°) | Crouch multiplier (all spread) | Crouched first shot (°) |
|---|---|---|---|---|
| `rifle_precise` | 0.25 | 1.0 | 0.85 | 0.21 |
| `rifle_spray` | 0.20 | 0.9 | 0.85 | 0.17 |
| `smg` | 0.40 | 1.3 (wiki says 1.4) | 0.85 | 0.34 |
| `pistol_light` | 0.40 | 1.8 | 0.75 | 0.30 |
| `pistol_accurate` | 0.30 | 1.65 | 0.75 | 0.23 |
| `pistol_heavy` | 0.25 | 2.75 | 0.75 | 0.19 |
| `sniper` (unscoped) | 5.0 | 5.0 | 0.90 | 4.5 |
| `sniper` (scoped) | 0 | 0 | n/a | 0 |

Disagreement: Spectre max spread 1.3 (patch 11.08: "reduced from 1.5 to 1.3" `[PN 11.08]`) vs 1.4 (wiki, which also quotes "1.5 to 1.4"). Trust the patch note, confidence 55%. Rifle ADS first shot: Vandal 0.1575°, Phantom 0.11° `[API]`; SMG ADS 0.25° `[API]`.

**Spread growth and recovery.** Riot: "Inaccuracy is accrued any time the weapon is re-fired prior to a complete duration of a weapon's respective Gun Recovery Time", and **Tap Efficiency** (higher = slower accrual) governs how fast it grows `[PN 0.50]`.

| Archetype | Recovery time (s) | Tap efficiency | Tag |
|---|---|---|---|
| `rifle_precise` | 0.375 | 6 | OFFICIAL `[PN 0.50]` |
| `rifle_spray` | 0.35 | 4 | OFFICIAL `[PN 0.50]` |
| `smg` | 0.25 | 3 | tap efficiency OFFICIAL `[PN 11.08]`; recovery ESTIMATE (35%) |
| `pistol_heavy` | 0.35 | 3 | ESTIMATE (30%) |
| `pistol_light`, `pistol_accurate` | 0.25 | 3 | ESTIMATE (30%) |
| `sniper` | n/a | n/a | shot interval (1.67 s) exceeds any recovery |

The Vandal recovery of 0.375 s is 3.7 shot intervals; the Phantom's 0.35 s is 3.9. A clean tap therefore needs a gap of at least the recovery time between shots; a burst of two or three accrues a little error.

Flickline model (ESTIMATE 40%; the exact functional form is not public):

```
state: shot_count n (float), last_shot_time
on shot:
    if now - last_shot_time >= recovery_time:  n = 0          # full reset
    spread_accum = first_shot + (max_spread - first_shot) * min(1, n / n_ramp)
    n += 1.0                      if interval <= 1.5 * fire_interval   # held fire
    n += 1.0 / tap_efficiency     otherwise                            # deliberate taps
```

`n_ramp` (bullets to reach max spread) is not public. Published analogues: another SMG's spread accrual was sped up from 7 to 6 bullets `[PN 11.08]`, and the `smg` archetype's error steps moved from bullets 4/7/10 to 3/6/8 `[PN 4.0]`. Use **n_ramp = 8** for rifles, **6** for `smg`, **4** for pistols (ESTIMATE 30%) and tune against a measured spray.

Final spread, in degrees:

```
spread = (first_shot + fire_accum) * stance_mult   # stance_mult = crouch multiplier when crouched, else 1
         + movement_add                            # section 3.4
         + landing_add                             # +7.0 deg for 0.225 s after landing
```

(`fire_accum` is `spread_accum - first_shot`.) Applying the crouch multiplier to the whole stationary part matches the wiki's crouched first-shot values; whether it also scales accumulated spread is an ESTIMATE (50%).

### 3.4 Movement error

Added degrees on top of stationary spread, by movement state, per weapon. OFFICIAL where a patch note is cited, otherwise `[WIKI-F weapons]` (medium confidence).

| Archetype | Crouch-moving | Walking | Running | Airborne | Official corroboration |
|---|---|---|---|---|---|
| `rifle_precise`, `rifle_spray` | 0.8 | 3 | 6 | 10 | crouch-move 0.3 → 0.8 `[PN 2.02]`; walk 2 → 3, run 5 → 6 `[PN 9.10]` |
| `smg` | 0.15 | 1 | 2.5 | 10 | walk 0.3 → 1.0, run 2.0 → 2.5 `[PN 3.0]`; SMGs unaffected by 9.10 `[PN 9.10]` |
| `pistol_light`, `pistol_accurate` | 0.5 | 1.1 | 2.3 | 7 | walk 0.84 → 1.1, run 2.0 → 2.3 `[PN 9.10]` |
| `pistol_heavy` | 0.5 | 1.2 | 3 | 7 | walk 0.25 → 1.2, run 2.0 → 3.0 `[PN 3.0]` |
| `sniper` | 7.5 | 10 | 15 | 15 | wiki only (medium) |

Flickline rule (ramp shape is an ESTIMATE, 40%: the wiki says penalties "ramp up as agents accelerate and taper off as they decelerate" `[WIKI-F Weapons]`; the curve is unpublished):

```
f = current_speed / equipped_max_speed
if f <= deadzone (0.275, sniper 0.15):  movement_add = 0
elif f <= walk_fraction:                movement_add = walk_add * (f - deadzone) / (walk_fraction - deadzone)
else:                                   movement_add = walk_add + (run_add - walk_add) * (f - walk_fraction) / (1 - walk_fraction)
crouched and moving: same shape using crouch_add and crouch_walk_fraction in place of walk
airborne: movement_add = airborne_add (replaces the above while off the ground)
```

Tune by counter-strafing and taking a shot at several moments of the stop; the shot should be inaccurate until the deadzone is crossed and accurate after.

### 3.5 Recoil

**No official or measured per-bullet recoil coordinates exist publicly.** Do not treat anything below as measured.

What is public:

- Recoil has a vertical (pitch) and a horizontal (yaw) component. Yaw direction switches under three published rules: a **protected bullet count** (no switch possible before it), a **chance of switching** per bullet, and a **switch time**. PC values (patch 11.08, OFFICIAL `[PN 11.08]`): rifle_precise 6 protected, 10% chance, 0.6 s; rifle_spray 8 protected, 10%, 0.6 s; smg 5 protected, 0.28 s (chance not stated).
- Shape (a journalist's 100-spray test of the precise rifle, qualitative `[WIN-SPRAY]`): about the first 5 to 6 bullets go almost straight up, then a horizontal kick, a "hard snap" after bullet 6 or 7, and then a right-to-left swing; the layout is near the Source-engine rifle pattern but with a sharper break. Treat shape counts as ±1 to 2 bullets.
- Running or jumping while firing multiplies recoil: both axes ×1.5 (was 1.25) `[PN 4.0]`; vertical ×1.8 (was 1.5) on both rifles and the SMG while running `[PN 6.11]`. Crouched-stationary yaw recoil was reduced 15% `[PN 0.50]`.

Flickline rule: implement recoil as **data**: per archetype, an array of per-bullet `(pitch_deg, yaw_deg)` kicks plus a recovery hold, so measured data can replace the placeholders without code changes. The yaw sign flips per the three published rules. Starting placeholders (PLACEHOLDER, 20% confidence; replace after measuring):

| Archetype | Pitch kick per bullet (deg) | Yaw kick per bullet (deg) after protected bullets | Notes |
|---|---|---|---|
| `rifle_precise` | 0.35 for bullets 1 to 9, then 0.08 | 0.18 | protected 6, flip 10%, 0.6 s |
| `rifle_spray` | 0.30 for bullets 1 to 11, then 0.07 | 0.15 | protected 8, flip 10%, 0.6 s |
| `smg` | 0.22 for bullets 1 to 8, then 0.06 | 0.12 | protected 5, flip 10% (assumed), 0.28 s |
| `pistol_*` | 0.60 per shot, recovers within 0.25 s | 0 | no pattern |
| `sniper` | 1.2 per shot, recovers in 0.8 s | 0 | |

View recovery after firing stops (the shape is a PLACEHOLDER): Flickline treats the gun recovery time `[PN 0.50]` as the reset of the **whole** spray, so the recoil aim offset is back on the crosshair by then, together with the spread and the pattern position. A shot fired at or after the recovery time is a centred first shot. The offset holds through held fire (1.5 shot intervals, the threshold of section 3.3; pistols do not hold), then returns in a straight line that reaches zero exactly at the recovery time. An earlier draft returned at 8°/s *starting* at the recovery time, which left a tap after a 10-bullet burst up to 2.9° high with nothing on screen to show it (#191). Whether the view itself climbs with recoil is a separate open question (#180 Q2). **Measure** by firing 100 sprays at a flat wall 10 m away with no compensation, record impacts per bullet index, convert pixels to degrees using the FOV (the method in `[WIN-SPRAY]`), and take the per-bullet mean path and flip frequency.

### 3.6 Wall penetration, tracers, hit scan

- Penetration is public only as a class `[API]`: **Low** (`pistol_light`, `smg`), **Medium** (`rifle_precise`, `rifle_spray`, `pistol_accurate`), **High** (`pistol_heavy`, `sniper`). Thickness limits and damage reduction per surface are not published; a news claim of "about 50% lost" for medium weapons is unsourced.
- Flickline v1 placeholder (PLACEHOLDER): damage retained through one penetrable wall: Low 0.3, Medium 0.5, High 0.7. Recommendation: **v1 maps use no penetrable walls**; keep the class on each weapon so it can be switched on later.
- Weapons are **hitscan** (instant). I found no Riot source fetched in this pass; this is general knowledge and recorded as ESTIMATE (85%). Tracers are cosmetic: PLACEHOLDER, 0.06 s lifetime, drawn from the muzzle to the impact point. In the reference game the silenced weapons hide their tracers from enemies `[API]`; in a single-player trainer this is moot.

---

## 4. Taking damage and hit effects

### 4.1 Health and armour

OFFICIAL / DATA `[WIKI-R Health]` `[WIKI-R Armor]` `[GEAR]`:

| Item | Value |
|---|---|
| Health | **100 HP**, cannot be raised by standard means; effective maximum 150 |
| Natural regeneration | none |
| Light armour | absorbs **66%** of each hit until it has absorbed **25** damage |
| Heavy armour | absorbs **66%** of each hit until it has absorbed **50** damage |
| Regen shield (optional, not in v1) | absorbs 100%; 25 held at a time; 50-point regeneration pool (`[GEAR]`, `[PN 9.10]`); regeneration delay not published |

Per-hit rule (DERIVED from Riot's wording, medium-high confidence; the order of operations on the hit that breaks the shield is not published):

```
absorbed = min(0.66 * dmg, shield_remaining)
health  -= dmg - absorbed
shield_remaining -= absorbed
```

Consequences: total damage to kill is always `100 + armour` (125 light, 150 heavy), provided hits are large enough that the 66% share is not capped; this matches Riot's wiki bullet counts for every weapon I checked. Disagreement: some guides say "66% to armour, 33% to health"; Riot's wording is "absorbs 66%", so health takes 34%. Rounding is not public (keep floats in the simulation; floor only what is displayed). Measure by shooting an armoured Range bot with a known-damage weapon and logging HP after each hit.

### 4.2 Hit multipliers and kill thresholds

See section 3.2 for the per-weapon values. Summary: head 4× (rifles), 3× (SMG, `pistol_light`), 3.5× (`pistol_accurate`), 2.9× (`pistol_heavy`), 1.7× (`sniper`); leg 0.85× of body (sniper 0.8×).

### 4.3 Tagging (movement slow when hit)

"Tagging is the slowing effect you feel when hit by bullets" `[PN 3.0]`. This matters in Flickline only if enemies shoot the player; it is specified here so it can be switched on.

| Quantity | Value | Tag |
|---|---|---|
| Standard bullet hit | **72.5% slow** (speed scaled by 0.275) | OFFICIAL `[PN 3.0]` ("75% >>> 72.5%"); current at 70% |
| Hit through a wall | 25% slow (speed scaled by 0.75) | OFFICIAL `[PN 1.02]`, not restated since; 50% |
| Shotgun pellet hit beyond 10 m | 30% slow for 0.5 s on a smooth curve | OFFICIAL `[PN 1.07]` (not in v1) |
| Ramp-in | gradual; time not published (Riot doubled it in 1.02) | OFFICIAL `[PN 1.02]` |
| Recovery duration | **0.5 s** from the last hit, smooth return, refreshed by each hit | ESTIMATE (30%), by analogy with the shotgun value |
| Scaling with damage or weapon | none (flat per bullet) | ESTIMATE (70%) |
| Applies to headshots and airborne targets | yes | ESTIMATE (40%); not documented |

Disagreement: patch 1.02 set the standard value to 70% while 3.0 states 75% → 72.5%; the two cannot both be on the same baseline. I trust 3.0 (later, and the turret numbers in 3.05 and 11.08 build on it). Inference: a 72.5% slow leaves 27.5% of max speed, exactly the deadzone from the same patch, matching Riot's stated aim that a tagged runner lands right at the accuracy threshold (medium confidence, confirm by measuring speed while tagged). In patch 9.10 Riot raised moving-accuracy penalties in response to tagging dropping players into the accurate range `[PN 9.10]`.

Flickline rule: on a hit, set a speed cap of `0.275 * max_speed`, ramp into it over 0.10 s (PLACEHOLDER), hold while hits continue, and release over 0.5 s after the last hit. Expose all four numbers as tunables. Measure by recording a player holding a movement key while single shots hit them, plot speed vs time at 128+ fps.

### 4.4 Aim punch (flinch)

The reference game has a camera aim punch on being hit: patch 1.07 states that headshots from shotguns produce a lower aim punch than other weapons `[PN 1.07]` (OFFICIAL, so existence is certain). Whether torso hits flinch, and whether armour reduces it, rests on one community article citing a forum post `[GAMERIV]` (ESTIMATE 50%). Magnitude, duration and recovery are not public.

Flickline rule (PLACEHOLDER, 20%): default **small** and zone-dependent: head hit 2.0° pitch kick, body hit 0.6°, leg hit 0.3°, recovering over 0.25 s. Offer a "flinch strength" multiplier (default 1.0, 0 disables). Do not make it a gameplay-defining random effect. Measure by recording a stationary player being shot and extracting crosshair offset per frame.

---

## 5. Targets (what a trainer presents)

### 5.1 Hit zones

Riot publishes no hitbox dimensions. All agents share one gameplay hitbox, and it follows the pose `[RIOT-HITREG]`. Separate head, body and leg zones exist (damage depends on which is hit).

Flickline's starting hitbox (ESTIMATE, 30%; PLACEHOLDER dimensions; the head share of height, about 13%, is from one community analysis seen only in a snippet `[REDDIT-HEAD]`):

| Zone | Standing: from / to height (m) | uu | Crouched: from / to height (m) | Width |
|---|---|---|---|---|
| Legs | 0.00 / 0.80 | 0 / 80 | 0.00 / 0.55 | 0.46 m |
| Body (torso) | 0.80 / 1.52 | 80 / 152 | 0.55 / 1.02 | 0.50 m |
| Head | 1.52 / 1.80 | 152 / 180 | 1.02 / 1.30 | 0.28 m (sphere radius 0.14 m, centre 1.66 m standing, 1.16 m crouched) |

The standing eye height (1.62 m) lies inside the head zone, 0.04 m below the head centre, so a crosshair held at eye level hits the lower half of the head. Head angular size, 0.28 m tall (DERIVED): 5 m → 3.21°, 10 m → 1.60°, 20 m → 0.80°, 30 m → 0.53°, 50 m → 0.32°. Compare with the 0.25° rifle first-shot cone: at 50 m its radius (21.8 cm) exceeds the head radius (14 cm), so a first-shot head hit at 50 m is not guaranteed even with perfect aim (the centre bias in section 3.3 helps).

Measure in the reference game: put a bot at 5 m, sweep the crosshair across it, and note where the hit marker or damage number changes (head/body/leg boundaries); use a known map prop for scale.

### 5.2 Engagement distances

- Riot data: "nearly half of all [spray rifle] kills took place within 15 m"; the precise rifle's kills "spread more evenly" across 0 to 15, 15 to 30 and 30+ m bins `[RIOT-DATADROP]` (OFFICIAL, 2023, pre-9.10 damage). The weapon design breakpoints are 15, 20, 30 and 50 m.
- Per-map sightlines: no official numbers. Third-party guide claims (secondary, not verified): one map has almost nothing beyond 20 m, another has 20 to 30 m lanes, open maps have mid angles of 30 to 50+ m.
- The Range's board runs from 5 to 50 m, with positions at 5, 10, 20, 30, 50 m (two third-party guides agree, no Riot page: `[STRAFE-RANGE]` `[TURBOSMURFS]`; confidence 65%).

**Flickline default distance mix (ESTIMATE, 50%):** median fight 10 to 20 m; 70% of presented targets at 5 to 20 m, 25% at 20 to 30 m, 5% at 30 to 50 m (long angles for the sniper archetype). Offer fixed-distance modes at 5, 10, 20, 30, 50 m.

### 5.3 Target movement speeds

Range bot speeds and strafe timing are **not public**. A player-run speed is exact: 5.4 m/s for a rifle player, 6.75 m/s max. One outlet reported (unconfirmed by Riot) that bots were silently made more mobile around patch 7.07 `[DOTESPORTS-BOTS]`.

Angular speed of a target crossing perpendicular at distance d: ω = v / d (rad/s).

| Target speed | at 10 m | at 20 m | at 30 m |
|---|---|---|---|
| 5.4 m/s (rifle run) | 30.9°/s | 15.5°/s | 10.3°/s |
| 6.75 m/s (knife run) | 38.7°/s | 19.3°/s | 12.9°/s |
| 3.0 m/s | 17.2°/s | 8.6°/s | 5.7°/s |

Flickline strafing targets (PLACEHOLDER, 25%), by difficulty tier: **slow 2.0 m/s, medium 3.5 m/s, fast 5.4 m/s**, with a direction change every 0.3 to 1.0 s (randomised) and a "counter-strafe stop" (decelerating to 0 in 0.16 s, using the braking in section 2.3) before standing still for 0.2 to 0.4 s, so that the player learns to shoot stopped targets, not just moving ones. Targets should obey the same acceleration and braking rules as the player so the timing teaches the real thing. Measure bot speeds by recording the Range at 60 fps, timing a traverse of a known width, and expressing the result as a fraction of 6.75 m/s.

---

## 6. Time-to-kill tables

Convention (same as the Riot wiki): TTK = (bullets − 1) / fire rate, all bullets hit, first bullet at t = 0, primary fire, no reaction time. The numbers are cells of `bullets (TTK seconds)` for shield 0 / 25 (light) / 50 (heavy). Computed with the per-hit armour rule in section 4.1; they match Riot's wiki bullet counts cell for cell, except `smg` legs at 30 to 50 m vs light armour, where the wiki's old revision says 7 bullets but 17 × 7 = 119 < 125, so 8 are required. Re-running with damage floored to integers changes no bullet counts.

| Archetype (range m) | Zone | Shield 0 | Shield 25 | Shield 50 |
|---|---|---|---|---|
| `rifle_precise` (0 to 50) | head | 1 (0) | 1 (0) | 1 (0) |
| | body | 3 (0.205) | 4 (0.308) | 4 (0.308) |
| | leg | 3 (0.205) | 4 (0.308) | 5 (0.410) |
| `rifle_spray` (0 to 20) | head | 1 (0) | 1 (0) | 1 (0) |
| | body | 3 (0.182) | 4 (0.273) | 4 (0.273) |
| | leg | 4 (0.273) | 4 (0.273) | 5 (0.364) |
| `rifle_spray` (20 to 50) | head | 1 (0) | 1 (0) | 2 (0.091) |
| | body | 3 (0.182) | 4 (0.273) | 5 (0.364) |
| | leg | 4 (0.273) | 5 (0.364) | 6 (0.455) |
| `smg` (0 to 15) | head | 2 (0.075) | 2 (0.075) | 2 (0.075) |
| | body | 4 (0.225) | 5 (0.300) | 6 (0.375) |
| | leg | 5 (0.300) | 6 (0.375) | 7 (0.450) |
| `smg` (15 to 30) | head | 2 (0.075) | 2 (0.075) | 3 (0.150) |
| | body | 5 (0.300) | 6 (0.375) | 7 (0.450) |
| | leg | 6 (0.375) | 7 (0.450) | 9 (0.600) |
| `smg` (30 to 50) | head | 2 (0.075) | 3 (0.150) | 3 (0.150) |
| | body | 5 (0.300) | 7 (0.450) | 8 (0.525) |
| | leg | 6 (0.375) | 8 (0.525) | 9 (0.600) |
| `pistol_heavy` (0 to 30) | head | 1 (0) | 1 (0) | 1 (0) |
| | body | 2 (0.250) | 3 (0.500) | 3 (0.500) |
| | leg | 3 (0.500) | 3 (0.500) | 4 (0.750) |
| `pistol_heavy` (30 to 50) | head | 1 (0) | 1 (0) | 2 (0.250) |
| | body | 2 (0.250) | 3 (0.500) | 3 (0.500) |
| | leg | 3 (0.500) | 3 (0.500) | 4 (0.750) |
| `pistol_light` (0 to 30) | head | 2 (0.148) | 2 (0.148) | 2 (0.148) |
| | body | 4 (0.444) | 5 (0.593) | 6 (0.741) |
| | leg | 5 (0.593) | 6 (0.741) | 7 (0.889) |
| `pistol_light` (30 to 50) | head | 2 (0.148) | 2 (0.148) | 3 (0.296) |
| | body | 5 (0.593) | 6 (0.741) | 7 (0.889) |
| | leg | 6 (0.741) | 7 (0.889) | 9 (1.185) |
| `pistol_accurate` (0 to 30) | head | 1 (0) | 2 (0.148) | 2 (0.148) |
| | body | 4 (0.444) | 5 (0.593) | 5 (0.593) |
| | leg | 4 (0.444) | 5 (0.593) | 6 (0.741) |
| `pistol_accurate` (30 to 50) | head | 2 (0.148) | 2 (0.148) | 2 (0.148) |
| | body | 4 (0.444) | 5 (0.593) | 6 (0.741) |
| | leg | 5 (0.593) | 6 (0.741) | 8 (1.037) |
| `sniper` (0 to 50) | head | 1 | 1 | 1 |
| | body | 1 | 1 | 1 |
| | leg | 1 | 2 (1.667) | 2 (1.667) |

A "0" TTK means one bullet; real time-to-kill adds the shot delay and any flinch. For the sniper, one body shot kills even a heavily armoured player exactly (150 body vs 150 effective health).

---

## 7. Recommended Flickline starting values

All values are metres, seconds and degrees. Keys are suggestions for a tunables config. **Conf** is confidence in the number as a match to the reference game (H ≥ 85%, M 50 to 85%, L < 50%, P = placeholder for a design choice). The "Sec" column is the section with the source and measurement method.

### 7.1 Global tunables

| Key | Value | Unit | Conf | Sec |
|---|---|---|---|---|
| `sim.tick_hz` | 128 | Hz | H | 1.4 |
| `view.vfov_deg` | 70.5328 | deg (hFOV 103 at 16:9) | H | 1.1 |
| `view.fov_hor_plus` | true | bool | M | 1.1 |
| `input.yaw_deg_per_count_at_sens1` | 0.07 | deg | H | 1.2 |
| `input.pitch_deg_per_count_at_sens1` | 0.07 | deg | M | 1.2 |
| `input.pitch_limit_deg` | 89 | deg | P | 1.2 |
| `input.scoped_fov_model` | `angle_div` | enum (`angle_div`, `tangent`) | M | 1.3 |
| `input.scope_zoom_ads_rifle` | 1.25 | x | M | 1.3 |
| `input.scope_zoom_ads_smg` | 1.15 | x | M | 1.3 |
| `input.scope_zoom_sniper_1` / `_2` | 2.5 / 5.0 | x | M | 1.3 |
| `input.scope_multiplier_default` | 1.0 | x | H | 1.3 |
| `move.run_speed_knife` | 6.75 | m/s | H | 2.1 |
| `move.walk_fraction` | 0.50 | of run | L | 2.2 |
| `move.crouch_walk_fraction` | 0.34 | of run | L | 2.2 |
| `move.accel_time_to_max` | 0.20 | s | L | 2.3 |
| `move.brake_decel_high` | 39 (scaled by max/5.4) | m/s² | M | 2.3 |
| `move.brake_decel_low` | 24 (scaled by max/5.4) | m/s² | M | 2.3 |
| `move.brake_band_split_fraction` | 0.25 | of max | M | 2.3 |
| `move.stop_time_from_run` | 0.16 | s | M | 2.3 |
| `move.deadzone_fraction` | 0.275 | of max | M | 2.4 |
| `move.deadzone_fraction_sniper` | 0.15 | of max | M | 2.4 |
| `move.jump_apex` | 1.0 | m | L | 2.6 |
| `move.gravity` | 20.0 | m/s² | P | 2.6 |
| `move.air_accel_fraction` | 0.25 | of ground | L | 2.6 |
| `move.landing_spread_add` | 7.0 | deg | M | 2.6 |
| `move.landing_spread_duration` | 0.225 | s | M | 2.6 |
| `move.landing_speed_loss` | 0 | fraction | L | 2.6 |
| `body.height_stand` | 1.80 | m | L | 2.7 |
| `body.height_crouch` | 1.30 | m | P | 2.7 |
| `body.radius` | 0.30 | m | P | 2.7 |
| `body.eye_height_stand` | 1.62 | m | L | 2.7 |
| `body.eye_height_crouch` | 1.17 | m | P | 2.7 |
| `body.crouch_transition` | 0.15 | s | P | 2.7 |
| `hit.head_radius` | 0.14 | m | L | 5.1 |
| `hit.head_centre_stand` / `_crouch` | 1.66 / 1.16 | m | L | 5.1 |
| `hit.torso_range_stand` | 0.80 to 1.52 | m | L | 5.1 |
| `hit.torso_range_crouch` | 0.55 to 1.02 | m | L | 5.1 |
| `hit.leg_top_stand` / `_crouch` | 0.80 / 0.55 | m | L | 5.1 |
| `spread.half_angle` | true | bool | M | 3.3 |
| `spread.center_bias_power_still` | 1.5 | exponent | L | 3.3 |
| `spread.center_bias_power_moving` | 0.5 | exponent | L | 3.3 |
| `health.max` | 100 | HP | H | 4.1 |
| `armor.light` / `armor.heavy` | 25 / 50 | HP | H | 4.1 |
| `armor.absorb_fraction` | 0.66 | fraction | H | 4.1 |
| `tag.speed_scale` | 0.275 | of max | M | 4.3 |
| `tag.ramp_in` | 0.10 | s | P | 4.3 |
| `tag.release` | 0.50 | s | L | 4.3 |
| `flinch.pitch_head` / `_body` / `_leg` | 2.0 / 0.6 / 0.3 | deg | P | 4.4 |
| `flinch.recovery` | 0.25 | s | P | 4.4 |
| `target.speed_slow` / `_medium` / `_fast` | 2.0 / 3.5 / 5.4 | m/s | P | 5.3 |
| `target.stop_time` | 0.16 | s | M | 5.3 |

### 7.2 Per-archetype tunables: handling

| Archetype | `fire_rate_hz` | `mag` | `reload_s` | `equip_s` | `run_mult` | `ads_move_mult` | `run_speed_mps` |
|---|---|---|---|---|---|---|---|
| `rifle_precise` | 9.75 | 25 | 2.5 | 1.0 | 0.80 | 0.76 | 5.40 |
| `rifle_spray` | 11.0 | 30 | 2.5 | 1.0 | 0.80 | 0.76 | 5.40 |
| `smg` | 13.333 | 30 | 2.25 | 0.75 | 0.85 | 0.76 | 5.7375 |
| `pistol_light` | 6.75 | 12 | 1.75 | 0.75 | 0.85 | n/a | 5.7375 |
| `pistol_accurate` | 6.75 | 13 | 1.5 | 0.75 | 0.85 | n/a | 5.7375 |
| `pistol_heavy` | 4.0 | 6 | 2.25 | 1.0 | 0.80 | n/a | 5.40 |
| `sniper` | 0.6 | 5 | 3.7 | 1.5 | 0.76 | 0.72 | 5.13 |

### 7.3 Per-archetype tunables: spread, recovery, movement error

| Archetype | `spread_first_deg` | `spread_max_deg` | `crouch_mult` | `recovery_s` | `tap_eff` | `n_ramp` | `err_crouchmove_deg` | `err_walk_deg` | `err_run_deg` | `err_air_deg` | `deadzone` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `rifle_precise` | 0.25 | 1.0 | 0.85 | 0.375 | 6 | 8 | 0.8 | 3 | 6 | 10 | 0.275 |
| `rifle_spray` | 0.20 | 0.9 | 0.85 | 0.35 | 4 | 8 | 0.8 | 3 | 6 | 10 | 0.275 |
| `smg` | 0.40 | 1.3 | 0.85 | 0.25 | 3 | 6 | 0.15 | 1 | 2.5 | 10 | 0.275 |
| `pistol_light` | 0.40 | 1.8 | 0.75 | 0.25 | 3 | 4 | 0.5 | 1.1 | 2.3 | 7 | 0.275 |
| `pistol_accurate` | 0.30 | 1.65 | 0.75 | 0.25 | 3 | 4 | 0.5 | 1.1 | 2.3 | 7 | 0.275 |
| `pistol_heavy` | 0.25 | 2.75 | 0.75 | 0.35 | 3 | 4 | 0.5 | 1.2 | 3 | 7 | 0.275 |
| `sniper` (unscoped) | 5.0 | 5.0 | 0.90 | n/a | n/a | n/a | 7.5 | 10 | 15 | 15 | 0.15 |
| `sniper` (scoped) | 0 | 0 | n/a | n/a | n/a | n/a | 7.5 | 10 | 15 | 15 | 0.15 |

### 7.4 Per-archetype tunables: damage bands (range in m is the band's upper bound)

| Archetype | Band 1 up to | H / B / L | Band 2 up to | H / B / L | Band 3 up to | H / B / L |
|---|---|---|---|---|---|---|
| `rifle_precise` | 50 | 160 / 40 / 34 | | | | |
| `rifle_spray` | 20 | 156 / 39 / 33.15 | 50 | 140 / 35 / 29.75 | | |
| `smg` | 15 | 78 / 26 / 22.1 | 30 | 66 / 22 / 18.7 | 50 | 60 / 20 / 17 |
| `pistol_light` | 30 | 78 / 26 / 22.1 | 50 | 66 / 22 / 18.7 | | |
| `pistol_accurate` | 30 | 105 / 30 / 25.5 | 50 | 87.5 / 25 / 21.25 | | |
| `pistol_heavy` | 30 | 159.5 / 55 / 46.75 | 50 | 145 / 50 / 42.5 | | |
| `sniper` | 50 | 255 / 150 / 120 | | | | |

Beyond the last band use the last band. Penetration class: `rifle_precise` M, `rifle_spray` M, `smg` L, `pistol_light` L, `pistol_accurate` M, `pistol_heavy` H, `sniper` H.

### 7.5 Conversions for implementers

```
metres  = uu / 100          (assumes 1 uu = 1 cm; ESTIMATE, section 0.2)
uu      = metres * 100
yaw_deg = counts * 0.07 * sens
cm_per_360 = 914.4 / (DPI * sens * 0.07)
```

---

## 8. Mechanics that matter most for skill transfer (ranked)

1. **Sensitivity scale and field of view.** Same 0.07°/count yaw, same 103° hFOV (70.53° vertical), same scoped model. Muscle memory (cm/360) and how big a target looks at a given distance both transfer only if these match; everything else is wasted if they do not.
2. **Movement-accuracy gating: stop to shoot.** The 0.16 s stop, the 27.5% deadzone and the 0.10 s time-to-accurate are what make counter-strafing the core skill. Get the braking and the accuracy gate exactly right and the stop-and-shoot rhythm transfers directly.
3. **First-shot accuracy and tap/burst reset.** A fixed 0.25° (precise rifle) or 0.20° (spray rifle) first-shot cone, back to full accuracy only after the recovery time (0.375 s / 0.35 s). This defines when you can tap, burst or must spray.
4. **Weapon cadence and damage thresholds.** Fire rates (9.75, 11 rps), one-shot headshot (160 / 156 on 100 HP), 3-bullet body kill, and falloff break at 20 m. These set the rhythm of every duel and the meaning of "one more bullet".
5. **Recoil pattern and spread growth.** Vertical climb then horizontal switching with a protected count and a random flip. This is where we have the least data (placeholders), so build it data-driven and measure it early.
6. **Equipped run speeds.** 6.75 / 5.40 / 5.74 / 5.13 m/s sets how fast targets and the player move; it fixes angular speeds the aim has to track.
7. **Hit-zone sizes and head height versus crosshair.** Head size and its distance above eye level decide crosshair placement habits; our numbers here are estimates, so measure.
8. **Moving and airborne error.** Walking +3° and running +6° (rifle), jumping +10°, landing +7° for 0.225 s: this teaches when not to shoot.
9. **Tagging slow.** 72.5% slow on hit, landing the runner at the deadzone; it affects whether getting shot makes you accurate. Matters only when enemies return fire.
10. **Crouch accuracy bonus.** 0.85 / 0.75 spread multiplier and lower hitbox; small but part of the muscle memory.

---

## 9. Open questions and default answers

| # | Question | Default answer for Flickline |
|---|---|---|
| 1 | Is 1 reference unit exactly 1 cm? | Yes (70%). Flickline's numbers are in metres regardless; the speeds in m/s come from the wiki and do not depend on the unit. |
| 2 | Walk speed fraction and crouch-walk fraction? | 0.50 and 0.34; measure with a marked distance. |
| 3 | Acceleration to full speed and braking curve for release-only vs counter-strafe? | 0.20 s to full speed; constant braking in two bands; counter-strafe key equals release plus the opposite acceleration. |
| 4 | Jump height, gravity, airtime? | 1.0 m apex, 20 m/s², 0.63 s airtime. |
| 5 | Capsule, eye and crouch heights, and the hit-zone dimensions? | 1.80 m / 1.62 m eye / 1.30 m crouched; head sphere 0.14 m; see section 5.1. |
| 6 | Do other aspect ratios change hFOV or add black bars? | Hor+ at fixed 70.53° vertical FOV; 16:9 is the supported baseline. |
| 7 | Is scoped FOV = 103°/zoom (angle division) or tangent-based? | Angle division (community model); the tangent option is a tunable. |
| 8 | Is the first-shot angle a half-angle or a full cone? | Half-angle. |
| 9 | What does the recoil pattern look like per bullet? | Data-driven placeholders (section 3.5); measure 100 sprays and replace. |
| 10 | Tagging duration, ramp, and whether it applies to headshots or airborne targets? | 0.10 s ramp, 0.5 s release, applies always; only used if enemies shoot. |
| 11 | Aim punch magnitude and recovery? | Small, zone-dependent, 0.25 s; adjustable multiplier. |
| 12 | Wall penetration numbers? | Classes only; v1 has no penetrable walls; placeholders 0.3 / 0.5 / 0.7 retained. |
| 13 | Does the 27.5% deadzone apply to the sniper or does it use 15%? | 15% for the sniper, 27.5% for the rest. |
| 14 | Does landing slow the player? | No. |
| 15 | Should the crosshair show spread? | No bloom by default: the reference game's crosshair is a player-set shape that does not grow with error (to my knowledge, unverified), so the player must learn the accuracy states, not read them off the reticle. |
| 16 | Armour behaviour on the hit that breaks the shield? | Leftover damage passes to health (total 100 + armour), no rounding in the simulation. |
| 17 | Should Flickline ship alternate fire (ADS, burst) in v1? | ADS for both rifles and the SMG (ADS fire rate ×0.9, first-shot 0.1575° / 0.11° / 0.25°); no alternate burst mode. |
| 18 | Weapon viewmodel FOV and animation timing? | Not researched (no public numbers); use a fixed viewmodel FOV independent of the world FOV, equip and reload timings drive the animations. |

---

## 10. Cross-checks performed

Numbers I double-checked against a second source, as required:

| Number | First source | Second source | Result |
|---|---|---|---|
| Knife run 6.75 m/s | Riot wiki Melee page `[WIKI-R Melee]` | Weapon multipliers × 6.75 reproduce every printed wiki m/s (0.8 → 5.4, 0.76 → 5.13, 0.85 → 5.7375); forum post `[VLR-SPEED]` | agree |
| Weapon run speeds | `[API]` multipliers | `[WIKI-R weapons]` m/s | agree for every weapon checked |
| hFOV 103° | trainer developer `[S-FOV]` | `[RECH]`, `[EDPI]`, `[SPIND]`; vertical 70.53° recomputed | agree; one calculator site (vertical 103°) rejected, geometrically inconsistent |
| Yaw 0.07 and ×3.1818 to CS2 | `[CSDB]` | `[METABOT]`, `[MINIWEB]`, `[RECH]` | agree |
| Vandal 9.75 rps, 160/40/34 | `[API]` | `[WIKI-F weapons]`; patch 1.07 `[PN 1.07]` | agree (9.25 and 39 are pre-1.07) |
| Phantom 11 rps, 156/39/33, falloff at 20 m | `[API]` | `[WIKI-F weapons]`; patch 9.10 `[PN 9.10]` | agree (the 15 m / 30 m tiers are pre-9.10) |
| First-shot 0.25° / 0.20° | `[API]` | `[WIKI-F weapons]` | agree |
| Deadzone 27.5% | `[PN 3.0]` | consistent with the tagging numbers in the same patch | agree; 30% is the pre-3.0 value |
| Stop time 0.16 s | `[DEVTRACK]` | same numbers in `[TURBOSMURFS]` | agree (same origin, so not independent) |
| Armour 66% and 25 / 50 | `[GEAR]` | `[WIKI-R Armor]` | agree |
| TTK bullet counts | script on `[API]` numbers | Riot wiki TTK tables | agree except one stale wiki revision |

Items with no independent second source (the stop-time table and the tagging values come from Riot posts that were reproduced elsewhere but not independently re-measured) are marked as such where they appear.

---

## 11. Source key

Fetch dates are 2026-11-14. Pages marked "snippet" were seen only in search-result text because a direct fetch was blocked.

| Tag | URL |
|---|---|
| `[API]` | https://valorant-api.com/v1/weapons (build via https://valorant-api.com/v1/version) |
| `[GEAR]` | https://valorant-api.com/v1/gear |
| `[PN x.y]` | https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-x-y/ (with a dash: 0-50, 1-02, 1-07, 1-09, 2-02, 3-0, 4-0, 6-11, 9-10, 11-08, 12-09) |
| `[WIKI-R Melee]`, `[WIKI-R weapons]` | https://wiki.playvalorant.com/en-us/Melee , https://wiki.playvalorant.com/en-us/<Weapon> (Vandal, Phantom, Spectre, Operator, ...) |
| `[WIKI-R Health]`, `[WIKI-R Armor]` | https://wiki.playvalorant.com/en-us/Health , https://wiki.playvalorant.com/en-us/Armor |
| `[WIKI-F weapons]`, `[WIKI-F Weapons]` | https://valorant.fandom.com/wiki/<Weapon> and https://valorant.fandom.com/wiki/Weapons (fetched via the MediaWiki API; community-maintained, has stale spots) |
| `[RIOT-NETCODE]` | https://www.riotgames.com/en/news/peeking-valorants-netcode |
| `[RIOT-128]` | https://www.riotgames.com/en/news/valorants-128-tick-servers |
| `[RIOT-HITREG]` | https://playvalorant.com/en-us/news/dev/the-state-of-hit-registration/ |
| `[RIOT-DATADROP]` | https://playvalorant.com/en-us/news/dev/valorant-data-drop-phantom-vs-vandal/ |
| `[RIOT-RES]` | https://support.riotgames.com/en-us/valorant/support-tools/supported-resolutions-in-valorant |
| `[RIOT-WALK]` | https://support.riotgames.com/en-us/valorant/gameplay/walking-running-and-crouching |
| `[DEVTRACK]` | https://devtrackers.gg/valorant/p/f29d0021-walking-running-accuracy-too-high (Riot developer reply with a designer's stop-timing test, 2020) |
| `[TURBOSMURFS]` | https://turbosmurfs.gg/article/how-to-improve-aim-in-valorant |
| `[S-FOV]` | https://steamcommunity.com/app/1421020/discussions/0/3133919455870334349 (aim-trainer developer, 2021-05-27) |
| `[RECH]` | https://www.recharge.com/blog/en-gb/valorant-sensitivity-converter-cs2-apex-ow2-fortnite |
| `[EDPI]` | https://edpi-calculator.org/tools/valorant-scoped-sensitivity |
| `[SPIND]` | https://www.valorant-spind.de/en/valorant-stretched-res.html |
| `[CSDB]` | https://csdb.gg/sensitivity-converter/ and https://csdb.gg/sensitivity-converter/valorant-to-cs2/ |
| `[METABOT]` | https://metabot.gg/en/cs2/tools/sensitivity-converter |
| `[MINIWEB]` | https://miniwebtool.com/game-sensitivity-converter/ |
| `[MS-FOV43]` | https://mouse-sensitivity.com/forums/topic/9354-about-wrong-fov-about-valorant-in-43 (snippet) |
| `[GGR-FOV]` | https://www.ggrecon.com/guides/how-to-change-your-fov-in-valorant/ |
| `[SK-FOV]` | https://www.sportskeeda.com/valorant/valorant-fov-guide-the-best-screen-settings-shooter-2023 |
| `[MM-43]` | https://mein-mmo.de/en/valorant-does-the-43-aspect-ratio-provide-advantages-like-in-csgo,494741 |
| `[DT]` | https://www.digitaltrends.com/gaming/valorant-weapons-guide/ (older article) |
| `[UE-UNITS]` | https://dev.epicgames.com/documentation/unreal-engine/units-of-measurement-in-unreal-engine |
| `[WOLD-SCALE]` | https://worldofleveldesign.com/categories/ue4/ue4-guide-to-scale-dimensions.php |
| `[VLR-SPEED]` | https://vlr.gg/post/4240306 (forum, unofficial) |
| `[AIMFINDER]` | https://aimfinder.pro/guides/valorant-movement-and-tracking (cites nothing; not used for numbers) |
| `[SPIKE-CS]` | https://www.thespike.gg/valorant/beginner-guides/is-counter-strafing-in-valorant-slower-than-csgo |
| `[WOOTING]` | https://wooting.io/post/wooting-valorant-guide-in-game-benefits-settings-and-pro-profiles |
| `[SK-TWIX]` | https://sportskeeda.com/esports/valorant-how-player-models-movement-making-operator-balancing-nightmare-riot |
| `[GGR-ACC]` | https://www.ggrecon.com/articles/valorant-shooting-accuracy (snippet) |
| `[THEGAMER-BHOP]` | https://www.thegamer.com/valorant-bunny-hop-guide/ |
| `[DEXERTO-BOOST]` | https://www.dexerto.com/valorant/how-to-use-boost-exploit-to-jump-higher-in-valorant-1417403/ |
| `[SWITCHBLADE]` | https://www.switchbladegaming.com/valorant/jett-guide/ (snippet, low quality, not used) |
| `[GAMEPRESSURE]` | https://www.gamepressure.com/newsroom/valorant-has-a-hitbox-problem-players-are-analyzing/zd1bdf |
| `[MEINMMO]` | https://mein-mmo.de/en/valorant-popular-agent-jett-dies-faster-than-the-others-why,500318 (second-hand quote of Riot developers) |
| `[SPIKE-ASCENT]` | https://www.thespike.gg/valorant/news/the-design-behind-ascent-explained/317 (secondary) |
| `[ESPORTSTALK]` | https://www.esportstalk.com/blog/riot-dev-raises-curtain-on-valorant-crosshair-placement/ (unsourced claim, not used) |
| `[REDDIT-HEAD]` | https://libredd.it/r/VALORANT/comments/pu9pbv/ (snippet) |
| `[WIN-SPRAY]` | https://win.gg/news/explaining-valorant-weapon-spray-patterns-and-if-theyre-random/ |
| `[GAMERIV]` | https://gameriv.com/valorant-community-demanding-that-shields-should-negate-aimpunch/ (cites a forum post) |
| `[STRAFE-RANGE]` | https://www.strafe.com/news/read/valorant-range-map-all-you-need-to-know-guide/ |
| `[DOTESPORTS-BOTS]` | https://dotesports.com/valorant/news/riot-silently-updated-valorants-practice-bots-but-now-theyre-out-of-control (snippet) |
