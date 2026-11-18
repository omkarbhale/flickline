# Repeat-enjoyment playtest 1 (issue #214)

The first pass that judges Flickline against vision principle 10: **do people replay Sweep because it is fun?** Build: `main` at `26d340e` (the browser pass ran on `d88de61`, two merges earlier). Six-sector runs with take, hold and meet sectors, gates with doors and stakes, Overtime, the lean, the cold opener, the scenario sampler, the fight-pace measure and the play journal are all on `main`. The four quality tracks get four separate verdicts (design §14.7, vision principle 4), and the repeat-enjoyment verdict sits inside fun. Hypotheses R1–R7 come from `docs/research/replay-not-drills.md` §7.

| Track | Verdict | In one line |
|---|---|---|
| Numbers | **PASS** (implemented rows) | The conformance suite has no unexplained deviation. This pass added no new mechanic to measure. |
| Feel | **Not scored in this pass** | The pass was agent-only and judged the replay loop. Nothing it touched changes recoil, movement, sounds or hit response. The open feel findings on #62 (rolled Echo shots, rare slow-on-hit) stand. |
| Fun | **Repeat enjoyment: NOT YET TESTABLE.** Agent baseline: **3 defects** that would hurt replay | No person has played Sweep yet. The bot and the browser show thin run-to-run variety, runs far shorter than designed, a first results card that reports a false Overtime loss, and Shield doors offered at full shield. |
| Transfer | **R5 not supported** (known, #257); the replay loop adds no new harmful habit | The cold opener's error is ±10.7 dial points against R5's ±6. |

| Hypothesis | Status | One line |
|---|---|---|
| R1 run length brings players back | **Not yet testable** | The journal pipeline works end to end. At human pace a Finale clear takes 2 to 2 min 40 s, against the designed five to nine minutes (#274). |
| R2 route choice is a real decision | **Not yet testable** (bot side: supported, with a defect) | Reading the door facts now pays +1,709 ± 745 points over always-Hot. But 77% of Shield doors are offered at full shield. |
| R3 systemic variety keeps run 20 fresh | **Not yet testable** (baseline recorded) | From run 20 on, 99% of the sector-and-card pairs a run deals were already dealt in that chain. Per the scope note, not judged until #247 and #36 land. |
| R4 the lean practises without feeling like a drill | **Not yet testable** (bot side: exposure supported) | +16% fights in the leaned situations (#210). Whether people notice it is a human question. |
| R5 the cold opener measures learning | **Not supported** | ±10.7 dial points standard error against ±6; false "Improved" on 2.2% of verdict days, under 5% (#209, #257). |
| R6 carried health and run-ending death keep players | **Not yet testable** | 94% of bot runs end in a death. Quits after a death need people. |
| R7 no XP, streaks or unlocks still pulls players back | **Not yet testable** | Needs day-3 and day-7 returns of testers who were not asked to return. |

## How this pass was run

- **Scope (decisions recorded on #214).** The scope notes of vision review 2 (#243, finding 7) are followed. An agent cannot be bored and cannot come back on day 3, so the agent part is a **correctness and baseline pass**. Every hypothesis that needs a person is marked *not yet testable*. R3 gets baseline numbers but no "not supported" until enemy minds (#247, #89–#91) and Foundry (#36) are in. Hold sectors (#204) have landed since that note was written.
- **Bot harness.** The new `npm run bot -- --repeat-report` (`src/debug/bot/repeatReport.ts`) plays chains of consecutive runs on one profile the way a session of **Enter** on the results card plays them. The next seed is `nextSeed` of the last, the skill model carries over, and each run takes the lean the last results card set plus the weakest cards, as `app/game.ts` does. 450 runs: three players at each of skills 30, 50 and 70, 50 runs each, door policy `facts` (reads all three door facts), Overtime policy `bank` (pushes while healthy, leaves when hurt). Smaller runs of the existing `--gate-report` re-measure R2 on today's six-sector run.
- **Browser.** Production build (`vite preview`) in headless Chromium (software GL, so frame rates say nothing), driven through `window.__flickline`. One new profile played from Play: the placing Opener, a gate, a hold sector, a death, the results card, an immediate **Enter**, a mid-run quit, and new sessions on day 3 and day 4 through `journal.setNow`. The console showed only the software-GL warnings.
- **Journal.** The journal recorded in that session was exported in the format of **Settings > Data > Copy play journal** and read back with `npm run journal`, the command that will turn testers' exports into the R1, R6 and R7 tables.
- **Evidence.** Screenshots are in `docs/screenshots/repeat-enjoyment-1/`.

## Bot harness: what 50 consecutive runs deal

`npm run bot -- --repeat-report` (defaults), on `main` at `26d340e`:

| Bot skill | Players × runs | Pairs met / run | Pair also in the run before | Pair met earlier in the chain | New pairs, runs 20+ | Distinct pairs / chain | Distinct sectors / chain | Sector also in the run before | Route repeats an earlier run | First 3 sectors repeat |
|---|---|---|---|---|---|---|---|---|---|---|
| 30 | 3 × 50 | 7.1 | 40 % | 93 % | 1 % | 18.0 | 5.0 | 72 % | 10 % | 37 % |
| 50 | 3 × 50 | 7.2 | 39 % | 94 % | 1 % | 18.0 | 5.0 | 72 % | 10 % | 37 % |
| 70 | 3 × 50 | 7.1 | 39 % | 95 % | 1 % | 18.0 | 5.0 | 72 % | 11 % | 35 % |

| Bot skill | Run length, live s: p10 / median / p90 (min–max) | Median length of runs that cleared the Finale | Reached the Finale | Cleared the Finale | Went into Overtime | Fights / run | Runs that leaned |
|---|---|---|---|---|---|---|---|
| 30 | 20 / 51 / 100 (5–226) | 106 s | 41 % | 13 % | 13 % | 6.3 | 66 % |
| 50 | 18 / 50 / 99 (5–253) | 111 s | 43 % | 13 % | 11 % | 6.5 | 67 % |
| 70 | 20 / 47 / 101 (4–267) | 112 s | 40 % | 15 % | 13 % | 6.4 | 67 % |

The same at the scripted human pace of #248 (`--walker human --players 1`, 150 runs), the closer estimate of a person's run length:

| Bot skill | Run length, live s: p10 / median / p90 (min–max) | Median length of runs that cleared the Finale | Reached the Finale | Cleared the Finale | Went into Overtime | Fights / run | Runs that leaned |
|---|---|---|---|---|---|---|---|
| 30 | 27 / 58 / 118 (3–177) | 122 s | 42 % | 16 % | 12 % | 6.7 | 96 % |
| 50 | 28 / 68 / 118 (3–172) | 118 s | 52 % | 14 % | 14 % | 7.0 | 80 % |
| 70 | 28 / 66 / 116 (3–178) | 160 s | 54 % | 16 % | 14 % | 7.4 | 84 % |

A "pair" is one contact the player met: the sector it was in (`map/sector`) and its scenario card. The pass first ran on `d88de61`. The scenario sampler (#97) and the spaced hold arrivals (#248) landed while it ran, and the tables above are re-run on the merged build. The variety numbers did not move, and runs got shorter (Finale clears took 135–143 s at bot pace before).

What the tables say:

- **The catalog is five sectors.** Over 450 runs the director dealt Elbow's door, hub and west take sectors, Elbow's hold corner and Lane's meet corridor. Lane's take sector (`lane-take-far`) is in the catalog but was never dealt, because it cannot hide an Echo from its entry (#230). Every chain met all five sectors.
- **Run 20 is not fresh in what it deals.** A chain meets 18 distinct sector-and-card pairs over 50 runs. From run 20 on, 99% of the pairs in a run were already met earlier in the same chain, and about 40% were in the run just before. Nearly three quarters of a run's sectors were also in the previous run, and one route in ten replays an earlier route exactly. What differs from run to run is the order, the doors and the Echo placements, not the situations. With Echoes that differ only in timers (#247), that is thin.
- **Cards met, over all runs:** hold 1,312, trade 604, take-expected 322, meet 283, take-unaware 241, flank 204, clear 174, crossfire 65. Hold sectors deal most of the contacts.
- **Runs are short.** The median run lasts under a minute at bot pace and about a minute at human pace. A run that clears the Finale lasts 1 min 46 s to 1 min 52 s at bot pace and 2 to 2 min 40 s at human pace, against design §4.1's "five to nine minutes" (#274).
- **Depth is near the design's target for reaching the Finale, below it for clearing it.** 40–54% of runs reach the Finale (target: about half) and 13–16% clear it (target: about a quarter). The bot uses no cover and never backs off, so these are floors (#53).
- **Death ends 94% of runs** (425 of 450). The rest left through an Overtime gate.
- **Fights per live minute: 6.5–7.0** at bot pace, above #248's target of 4.
- **The bot's skill barely moves anything** (skills 30 to 70 give the same depth and length) because the dial follows the player. That is skill matching working, not a harness fault.

**R2 on today's run** (`npm run bot -- --gate-report --skills 50 --runs 60`, merged build):

| Policy | Score | Depth (of 6) | Made it out | vs always-Hot: score (± s.e.) | vs always-Hot: depth | Doors taken: shield / arms / hot / plain |
|---|---|---|---|---|---|---|
| hot | 4,559 | 3.95 | 8 % | +0 | +0.00 | 23 % / 32 % / 19 % / 27 % |
| read | 4,763 | 3.97 | 10 % | +204 (± 142) | +0.02 | 25 % / 30 % / 19 % / 26 % |
| facts | 6,268 | 4.53 | 22 % | **+1,709 (± 745)** | **+0.58** | 37 % / 39 % / 7 % / 17 % |
| left | 4,709 | 4.05 | 15 % | +151 (± 320) | +0.10 | 27 % / 36 % / 7 % / 30 % |

On the four-sector run of #205, always-Hot out-scored reading the gate by 1,200–1,550 points (#239). On the six-sector run with holds and a Finale, the policy that reads all three facts (it avoids "several" doors unless the stake pays for them) scores about 1,700 more and goes half a sector deeper. Door facts now decide outcomes. The comparison is 60 runs at one skill (about 2 standard errors), so #239 should confirm it at full size before closing.

**Shield doors at full shield.** Over 40 bot runs (137 gates, policy `facts`), a Shield door was offered 56 times, and **43 of those (77%) at a full shield**, where it gives nothing. At the first gate it happened at 18 of 38 gates (47%). The first gate seen in the browser was one of them (`gate-shield-at-full.png`: MEET · LONG · 1-2 · SHIELD against HOLD · CLOSE · 1-2 · ARMS, at 100 HP and 50 shield). At those gates one door is a stake and the other is nothing, so the choice is about role and sightline alone. Posted on #239.

## Agent pass in the browser

| Check | Result | Evidence |
|---|---|---|
| Play from a new profile starts a run with the placing Opener | **Pass** | Run readied at once on seed 2067543410; the Opener played four contact legs on Elbow before the first gate. |
| Gate doors show role, sightline, heard and stake, true to the plan | **Pass** | `sweep.gate()` facts match the doors drawn (`gate-shield-at-full.png`). |
| Arms door swaps the primary | **Pass** | Through the HOLD · ARMS RILL door the player held the Rill. |
| Results card after the first run | **Fail** | It counts the placing Opener's legs as seven sectors, so a death in sector 2 of 6 reads "ELIMINATED · OVERTIME 2" and "Overtime 2 · −1,808 lost" in red, though nothing was at risk (`sweep.state().overtime.banked === -1`). This is the first card a new player sees. **#273** (`results-first-run-overtime.png`). |
| Results card's one thing to fix | **Note** | After a run cleared with the debug `killAll` the card says "No shots were fired this run" and "Play again". That is correct for the input, and an artefact of the debug kill, not a defect. |
| **Enter** within 10 s of the results card | **Pass** | The journal marks the run `pulled: true`; the measures count 1 of 2 finished runs restarted and 1 of 2 deaths restarted. |
| Quit mid-run (New run, pressed twice while live) | **Pass** | Recorded as `end: quit`. One press only asks, by design (§2.3). |
| A 30-minute gap starts a new session; day 3 counts as a return | **Pass** | With the clock moved 40 min, then 3 and 4 days, the journal gave 5 sessions, `day 3: yes`, `day 7: n/a` (the export's day was day 4, so day 7 is not testable yet). |
| Settings > Data shows the journal line and the copy button | **Pass** | "5 sessions this week, 7 runs, 1 started straight after the last" (`journal-data-tab.png`). |
| `npm run journal` reads an export | **Pass** | It printed the R1, R6 and R7 table for the session (below). |
| Console | **Clean** | Only the software-GL warnings of headless Chromium. |

The agent session's journal, as `npm run journal` prints it. It is the pipeline's output on a test session, not evidence about people. It was printed by the `d88de61` build; since #248 the report also has fight-pace columns (fights per live minute, longest dead air), which this journal predates:

| tester | sessions | runs | runs per session (median / mean) | one-run sessions | quit mid-run | restarted straight after (R1) | restarted after a death (R6) | left after a death (R6) | median run s | days played | day 3 (R7) | day 7 (R7) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| agent | 5 | 7 | 1 / 1.4 | 4/5 (80%) | 5/7 (71%) | 1/2 (50%) | 1/2 (50%) | 0/5 (0%) | 6 | 3 | yes | n/a |

## The hypotheses, one by one

| # | Hypothesis | Status | Evidence | Design change the result implies |
|---|---|---|---|---|
| R1 | A run of six sectors (five to nine minutes) brings players back for another | **Not yet testable** | No person has played. The pipeline that will measure it (journal, export, `npm run journal`) works end to end. Bot: the median run lasts about a minute, and a run that clears the Finale lasts 2 to 2 min 40 s at the scripted human pace, so the build does not yet play the run R1 names. | Before testers report: decide whether the target is five to nine minutes or the build's length (#274). If journals then show one-run sessions, **do not shorten to four sectors** as R1's fallback says, because the run is already short. Look at lethality (#165) and the number of sectors and contacts first; fights per minute already meet #248's target. |
| R2 | Route choice at gates is a real decision, not noise | **Not yet testable** (bot side supported, with a defect) | Reading all three door facts pays +1,709 ± 745 points and +0.6 sectors over always-Hot at skill 50, which reverses #239's four-sector result. But 77% of Shield doors appear at full shield (47% of first gates), where the choice is a stake against nothing. Testers' reasons ("why that door?") are needed. | Offer Shield only when the shield is below full (or make the Shield stake something that is worth having at full), so every door pair carries two real stakes. Comment on #239. If testers then still say "I just picked left", make the stakes larger (R2's own rule). |
| R3 | Systemic variety is enough to keep run 20 fresh | **Not yet testable** (baseline recorded; per the scope note, not judged until #247 and #36 land) | Five sectors dealt; 18 distinct sector-and-card pairs per 50 runs; 99% of pairs from run 20 on already met; 72% of a run's sectors were in the run before. | Baseline only. It already points at the order R3 names: more sector maps first (#36, #230, #236), then Echo minds that differ in more than timers (#247). Re-run `--repeat-report` when each lands. A cheap help meanwhile: avoid dealing the last run's sectors first in a new run (the deck forgets across runs). |
| R4 | The lean practises the one thing to fix without feeling like a drill | **Not yet testable** (bot side: exposure supported) | #210's A/B: +16% fights in the leaned cards, the same fights per run. Here, 66–67% of chained runs leaned (80–96% at human pace). Whether a person notices or minds is a human question. | None yet. If testers say the next run felt "set up", lower `lean.boost` or stop naming the lean on the card (R4's rule). |
| R5 | The cold opener measures learning as well as the Baseline it replaces | **Not supported** | Cold-opener bot harness (#209, design §8.5): standard error ±10.7 dial points against the ±6 threshold. False "Improved" on 2.2% of verdict days, inside the 5% threshold. | R5's own rule: lengthen the cold opener or add a second cold sector. The trade is #257 (a level nearer the player's 60–65% point, or eight to nine legs, brings it to about ±8). |
| R6 | Carried health and death ending the run raise stakes without making players quit | **Not yet testable** | Bot: 94% of runs end in a death; deaths spread over sectors 2–6. The journal records "restarted after a death" and "left after a death" correctly. | If testers' journals show many sessions ending on a death: a second life at the Finale gate, or more Shield doors (R6's rule). Note the Shield doors above, which are mostly worthless today. |
| R7 | No XP, streaks or unlocks still gives enough long-term pull | **Not yet testable** | Needs unasked day-3 and day-7 returns. The journal's day-3 and day-7 columns work (`yes`, `later`, `no`, `n/a`). | If return is low while in-session fun is good: a mechanical-only long goal (for example a per-card mastery ladder) before any reward for time played. |

## Human protocol (for testers)

Testers play from the live link, as they like, over at least eight days, and are **not asked to come back**. The test needs a day-3 and a day-7 return that nobody prompted. At the end, each tester pastes **Settings > Data > Copy play journal** on #214. The report author saves each paste as `<name>.json` and runs `npm run journal -- *.json` (`docs/playtests/play-journal.md`).

After the first session and after the last, each tester answers in a comment on #214 (`RQ<n>: answer`; RQ so the numbers clash neither with #180's Q1–Q14 nor with the hypotheses). A word plus one sentence is enough:

- **RQ1. Another run?** After a run ended, did you want another? After a **death** in particular? What made you stop? (R1, R6)
- **RQ2. Different from the last?** Did this run feel different from the one before? What was the same? (R3; "same fights again" is the signal)
- **RQ3. Doors.** Pick one gate you remember: which door did you take, and why? Did any gate feel like it didn't matter? (R2)
- **RQ4. Enough fighting?** Did the run have enough fighting, or too much walking? (#248)
- **RQ5. Why did you lose?** Think of a fight you lost: did you understand why? Mechanics (your aim, your stop) or the situation (two at once, a flank)? (#110)
- **RQ6. Set up?** Did the next run ever feel set up around your weakness? Did that feel good or like homework? (R4)
- **RQ7. Drill?** Did anything feel like a drill or a chore? (principle 10)
- **RQ8. Length.** Was a run too short, about right, or too long? (R1)
- **RQ9. Coming back.** (Last session only) Did you come back on another day without being reminded? Why, or why not? (R7)

A person's fights per live minute and longest dead air come from the journal (`npm run journal` prints them beside the repeat-enjoyment columns, #248); RQ4 is the feeling behind those numbers.

## Four verdicts

### Numbers

**PASS for the implemented rows.** `npm test` includes the conformance suite and fails when `docs/conformance.md` is out of date or a deviation has no written reason. It passes on this build: 211 rows match a sourced value, 57 match an estimate, 15 match a placeholder, 6 deviations each have a written reason, and 167 rows are not implemented yet. This pass added no mechanic. Posted on #61.

### Feel

**Not scored in this pass.** The feel checklist needs a person with headphones for its `H` items, and this pass judged the replay loop, not recoil, movement or sound. Nothing it found changes a feel item. The open findings on #62 stand: Echo shots are rolled, not aimed (#247), and the player is hit so rarely that slow-on-hit is seldom felt (#165). Posted on #62.

### Fun

**Repeat-enjoyment verdict: NOT YET TESTABLE.** No person has played Sweep, and the question (do people start another run because they want to, and come back without being asked?) is about people. The measurement is ready: the journal records it, the export carries it, and `npm run journal` turns it into the table above.

**Agent baseline: three defects that would hurt replay, and one thin area.**

1. The first results card a new player sees reports a false Overtime loss (#273).
2. A run that clears the Finale takes 2 to 2 min 40 s at human pace, well under the designed five to nine minutes, so R1 is being tested on a different run than the one it names (#274).
3. Three quarters of Shield doors are offered at full shield, so many gates are a stake against nothing (comment on #239).
4. Thin area (not a new defect, already tracked): five sectors and about 18 situations per 50 runs. From run 20 on, nearly everything a run deals has been dealt before in the same chain (#36, #230, #236, #247).

What works: Play reaches a run at once; doors show true facts and now decide outcomes (reading them pays); **Enter** restarts in the same breath; the lean reaches more than half of chained runs; fights come at 6.5–7.0 a live minute at bot pace, over #248's target of 4; the journal measures what R1, R6 and R7 need. Posted on #63 and #188.

### Transfer

**R5 not supported** (±10.7 against ±6; tracked by #257). The replay loop itself (Enter, doors, Overtime, the journal) adds no new habit that would fail in the reference game. The four situations #160's preliminary review marked as likely harmful stay open. One of them, always-Hot (#239), is weaker on today's six-sector run: reading the door facts now out-scores it (R2 above). The full habit review of the run is #160's job and was not repeated here. Posted on #149.

## Defects and follow-ups

| Issue | Quality | What |
|---|---|---|
| #273 | fun | Results card on a placing run counts the Opener's legs as sectors: "Overtime 2 · −1,808 lost" after a death in sector 2 |
| #274 | fun | Run length: a Finale clear takes 2 to 2 min 40 s at human pace against design §4.1's five to nine minutes |
| #239 (comment) | fun | Today's gate report (reading the facts now pays) and Shield doors at full shield |
| #248 (comment) | fun, transfer | Fights per live minute in chained runs: 6.5–7.0 at bot pace |
| #188 (comment) | fun | The R3 baseline, to re-run when #36 and #247 land |
| #180 (comment) | fun | The repeat-enjoyment questions above, for human testers |

## Re-running this pass

- `npm run bot -- --repeat-report` (about a minute; `--players 1 --runs 50` for a quick look).
- `npm run bot -- --gate-report --skills 50 --runs 60`.
- Testers' journals: `npm run journal -- <exports>`.
- Browser: a fresh profile, `__flickline.menu.play()`, then `sweep.walk`, `sweep.killAll`, `sweep.toExit`, `sweep.choose` to move through sectors, `hitBy('kestrel')` to die, `results.playAgain()` to restart, `journal.setNow(ms)` to move the clock.
