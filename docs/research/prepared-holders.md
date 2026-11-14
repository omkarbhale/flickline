# Prepared holders: fairness floors split by expectation

Answer and settling experiment for the open question **#127**: *should the enemy fairness floors apply to an enemy that already expects you?* It came out of Vision review 1 (#115, finding 1) and belongs to **#70 (player-like enemies)**. Companion documents: `docs/research/player-like-enemies.md` (the enemy mind; its sections are cited as §x.y), `docs/research/human-performance.md` (time-to-shot baselines), `docs/research/engagement-information.md` (scenario cards).

- Date: 2026-11-14. Reference game: Valorant ("the reference game"). Evidence tags as in the companion documents (**High**, **Med**, **Low**, **DERIVED**, **HYPOTHESIS (n%)**).
- Serves vision principles 1 (transfer first: a drill that builds a habit that fails in the reference game is a bug) and 6 (enemies behave like real players).
- Issue #127 stays open until the rule is built into the enemy mind (#90, #91) and judged in play (#96).

## 1. Answer

**No. The reaction and tell floors protect the player from an enemy they *surprised*. They do not apply to a holder that expects the player at that spot.**

| | Surprised enemy (`attending`, `unaware`) | Prepared holder (`prepared`) |
|---|---|---|
| Reaction | Profile draw, + 0.10 s if the player appeared outside its attention cone; floored at **0.25 s** (`floors.enemyReactionSec`) | Profile draw − 0.035 s expectation bonus; floored at **0.15 s** (`floors.preparedReactionSec`) |
| Tell | Starts when the aim phase starts, lasts `max(aim phase, dial tell)`; tell floored at `floors.tellSec` (research F5) | Starts the moment the holder perceives the player and runs until its shot. **It never delays the shot.** |
| First shot ready | reaction + `max(aim phase, tell)` | reaction + aim phase |
| Top anchor (mind 100), crosshair already on the swing | ≥ 0.43 s with today's tell axis, ≥ 0.55 s with research F4's | median **≈ 0.24 s** on target, **≈ 0.30 s** over all wide swings (some need a correction) |

Built as `sim/enemyTiming.ts` (`enemyShotTiming`: pure, seeded, allocation-free). The enemy aim model and FSM (#90, #91) call it once per contact; their perception (#89) decides the expectation. The floors stay in `config/dial.ts`; the expectation numbers are `config/expectation.ts`.

**Why 0.15 s for a prepared holder, not no floor at all.** No ordinary mouse click answers a visual onset faster than about 150 ms; faster responses are anticipations (`human-performance.md` §1.1, Woods 2015, High/Med). The floor keeps every enemy human. With the research anchors it almost never binds: the top anchor's prepared reaction averages 0.255 s (0.29 s − 0.035 s, DERIVED).

**Why the tell still shows.** Feedback is product (vision principle 8), and the death recap (#94) needs to show *when the holder saw you*. A tell that runs from first sight to the shot draws exactly that, and it adds no delay. It is too short to react to, and that is the lesson: you do not out-react a prepared holder.

## 2. Settling experiment

The experiment that #127 specified, run as signature **S12** in the unit tests (`src/sim/wideSwing.ts`, `src/sim/wideSwing.test.ts`, under a second).

**Setup.** A scripted human-timing peeker who expects a holder wide-swings an angle that a holder has its crosshair on. Both sides use the same skill anchor, so only the timing rule differs between conditions.

- **Peeker.** Reaction is the anchor's ex-Gaussian minus the expectation bonus (it timed its own swing), truncated at 0.11 s, the anticipation limit. Its first accurate shot comes at reaction + `max(0.10 s stop to the accuracy gate, correction)` (spec §2.4: rifle gate about 0.10 s after the stopping input). The stop and the aim correction overlap.
- **Holder.** `enemyShotTiming` from the same anchor, with the aim phase equal to its correction. A correction is skipped (crosshair already on the swing) with the anchor's wide-swing anticipation share (§5.4: 0.05 / 0.15 / 0.35 / 0.55). Otherwise it takes a lognormal time, median the anchor's correction delay (0.20 / 0.17 / 0.14 / 0.12 s), CV 0.3.
- **The peeker gets the holder's placement quality.** The peeker skips its correction with the same share as the holder. This is conservative: in the card *Take: expected*, the holder knows where the peeker will appear; the peeker only suspects where the holder is.
- **Exchange.** Both sides fire the Kestrel (11 rounds/s, 156 head, 39 body, 100 HP; spec §7). Shots land on 128 Hz ticks. Each shot rolls head, body or miss: first shot head 0.10 / 0.18 / 0.28 / 0.38, body about 0.4; later shots half the head odds (HYPOTHESIS 35%). A duel ends when one side takes lethal damage. Both dying on one tick is a trade.
- **Size.** 4,000 seeded duels per cell (the issue asked for 1,000; 4,000 keeps the standard error under one point). Every condition uses the same peeker draws (common random numbers).

**Conditions.**

| Condition | Holder timing |
|---|---|
| `today` | Today's code: reaction floor 0.25 s, tell = the dial's tell axis (0.5 → 0.18 s), tell floor 0.15 s |
| `research` | Research F4: as `today`, with #12's tell axis 0.7 → 0.30 s and tell floor 0.25 s |
| `split` | This answer (as configured) |
| `split+pa` | This answer plus the reference game's 40–70 ms peeker's advantage against the holder |

**Results** (`WIDE_SWING_REPORT=1 npx vitest run src/sim/wideSwing.test.ts`; holder share = holder wins / decided duels):

| Mind | Condition | Holder first shot (median) | Peeker first shot (median) | Holder wins | Peeker wins | Trades + draws | Holder share |
|---|---|---|---|---|---|---|---|
| 0 | today | 1092 ms | 763 ms | 1062 | 2902 | 36 | **27%** |
| 0 | research | 1292 ms | 763 ms | 681 | 3284 | 35 | **17%** |
| 0 | split | 761 ms | 763 ms | 2025 | 1942 | 33 | **51%** |
| 0 | split+pa | 816 ms | 763 ms | 1808 | 2149 | 43 | **46%** |
| 35 | today | 825 ms | 569 ms | 1054 | 2924 | 22 | **26%** |
| 35 | research | 997 ms | 569 ms | 599 | 3381 | 20 | **15%** |
| 35 | split | 562 ms | 569 ms | 2089 | 1877 | 34 | **53%** |
| 35 | split+pa | 617 ms | 569 ms | 1805 | 2163 | 32 | **45%** |
| 65 | today | 632 ms | 431 ms | 1067 | 2906 | 27 | **27%** |
| 65 | research | 780 ms | 431 ms | 512 | 3459 | 29 | **13%** |
| 65 | split | 408 ms | 431 ms | 2125 | 1836 | 39 | **54%** |
| 65 | split+pa | 463 ms | 431 ms | 1892 | 2077 | 31 | **48%** |
| 100 | today | 474 ms | 353 ms | 1221 | 2744 | 35 | **31%** |
| 100 | research | 593 ms | 353 ms | 711 | 3268 | 21 | **18%** |
| 100 | split | 304 ms | 353 ms | 2319 | 1639 | 42 | **59%** |
| 100 | split+pa | 359 ms | 353 ms | 2020 | 1932 | 48 | **51%** |

**Sensitivity to the hypothetical shot odds** (holder share; both sides' head odds scaled):

| Mind | Head odds | today | split | split+pa |
|---|---|---|---|---|
| 65 | ×0.5 | 30% | 53% | 48% |
| 65 | ×1 | 27% | 54% | 48% |
| 65 | ×2 | 16% | 57% | 46% |
| 100 | ×0.5 | 35% | 57% | 50% |
| 100 | ×1 | 31% | 59% | 51% |
| 100 | ×2 | 20% | 63% | 50% |

**Reading.**

1. **The floors invert the lesson.** With the floors, the peeker wins 69–87% of wide swings into a pre-aimed angle at every skill. The research's own F4 tells make it worse. The settling criterion in #127 ("if the peeker wins > 50%, the floors invert the lesson") is met by a wide margin, and the result holds with the shot odds halved or doubled.
2. **Split floors restore the holder's edge.** The prepared holder wins 51–59%, more at higher skill, because the stop the peeker must make before an accurate shot then costs it. The edge is modest because the model is timing only and gives the peeker the holder's crosshair placement. Real holders also choose the distance and the angle and watch one spot while the peeker searches.
3. **Prepared holders are not superhuman.** At mind 100 the holder's median first shot is 0.30 s over all wide swings and 0.24 s when already on target (5th–95th percentile 0.19–0.37 s). That matches the 0.25–0.35 s human pre-aimed range (`human-performance.md` §1.2) once you remove the ~20 ms of display and mouse delay that range includes and a simulated enemy does not have. At mind 0 it is 0.76 s, a first-week player who is waiting for you.
4. **Peeker's advantage on its own makes this a coin flip** (45–51%). The holder-side effects that offset it in the reference game are not modelled yet (see 3.2), so it stays off.

## 3. Decisions recorded

### 3.1 The dial: prevalence and placement, and speed through the mind skill

#127 proposed that the dial control how many prepared holders appear and their settle noise, *not their speed*. Adopted with one change: **a prepared holder's speed follows the mind skill**, through the profile's reaction anchor (§5.4).

The reason is principle 5 (meet the player at their skill) and principle 6 (enemies fight like people at the player's level). A first-week player's prepared opponent answering in 0.3 s would be an expert. Real prepared humans are slower at lower skill: practice shrinks the slow tail (Böer 2025, High). The table above shows the split rule gives the holder the same modest edge at every skill, so the lesson is the same at every dial: deny the expectation.

The dial's other levers on this fight:

- **Prevalence.** The Sweep director (#51) sets the share of *Take: expected* contacts.
- **Placement quality.** The anchor's wide-swing anticipation, vertical offset and settle noise (§5.4).

### 3.2 Peeker's advantage: modelled, off by default

`config/expectation.ts` carries `peekerAdvantageMinSec`/`MaxSec`, applied by `enemyShotTiming` in both directions:

- **The player peeks.** The enemy perceives the player late by the drawn amount.
- **An Echo peeks.** The Echo reacts early by that amount, still floored.

Both are **0** by default, which keeps research §8 Q1's "No". Turning it on alone takes the holder from 51–59% to 45–51% (table above). In the reference game the netcode gap is offset by effects this model leaves out. For example, a sideways peeker's leading shoulder is visible to the holder before the peeker's eye clears the corner: about 0.15–0.25 m, or 30–45 ms at 5.4 m/s (DERIVED; HYPOTHESIS 40% that it matters). Perception (#89) samples the player's upper body (§5.3), so that effect will arrive with real Echoes.

**Revisit in #93.** It re-runs S12 with real Echoes. Turn the advantage on only if the holder still wins most with it.

### 3.3 What is not changed

- The exposure floor, the target-size floor and the spawn-distance rules are untouched.
- A surprised enemy keeps both floors. A flank, an off-angle appearance or a player the enemy only heard (`alert`, not `prepared`) all count as surprised.
- `prepared` requires information (F1, F2): the card or memory places the player at this spot, and the player appears inside the enemy's attention cone. An enemy pre-aiming a common angle with no information is `attending`.

## 4. Changes to other work (comments posted)

- **#89 perception and #90 aim model.** Classify each contact as `prepared` / `attending` / `unaware` (§5.3) and call `enemyShotTiming` with the aim phase from the submovement model. Signature S1's minimum becomes 0.15 s for prepared draws and stays 0.25 s for the rest.
- **#91 FSM.** For a prepared holder, `react` → `duel` with the tell running from first sight; there is no tell hold.
- **#88 mind profiles.** Absorb `WIDE_SWING_ANCHORS`' timing rows into `config/mind.ts`; the experiment then reads the profiles.
- **#93 signature suite.** Add S12 (this experiment) against real Echoes; decide peeker's advantage there (3.2).
- **#51 Sweep director.** The share of *Take: expected* contacts is a dial lever (3.1).
- **#94 death recap.** "It saw you at 0 ms and shot at 290 ms: it was holding this spot" is the honest line for these deaths, and the card's lesson is "deny the expectation".
- **#110/#126 fight attribution.** The per-card prior for *Take: expected* can start from the `split` row of the table: the player, as peeker, wins about 41–49% at a matched dial.
