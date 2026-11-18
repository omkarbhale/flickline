# Transfer habit review 1 (issue #160)

The first run of the transfer habit review (`docs/transfer-checklist.md` §1), on `main` at `d88de61`, played on 2026-11-18. It asks one question of every situation a run presents: **would the habit this builds be wrong in the reference game?** Numbers, feel and fun are judged on their own tracks (#61, #62, #63). Nothing here stands in for them.

| | |
|---|---|
| **Verdict, first-playable rule** | **Pass.** The review ran on the whole run and is posted on #149. Every *harmful* item has an issue, and #280 is new. |
| **Verdict, first-release rule** | **Fail.** Seven situations carry open critical harmful items. All except #280 trace back to the Echoes' sight, hearing and dice-roll shots (#247). |
| **Harmful items** | T4, T5, T11, T12 in every fight situation, from Echoes that hear nothing, see from any side, hit by a dice roll through cover and never move off their anchor (#247, with #92 and #263). **New:** hold arrivals announce themselves and hold fire until the player notices them (#280). |
| **Retired since the preliminary pass** | Always-Hot no longer out-scores reading the gate (T10, T14). Kill-heal, measured, does not pay "fight to heal" (T14). |

## Scope: what changed since the issue was written

The issue named Cold Start, Orbit and the Placement run. #187 retired those modes before this review ran, and its comment on this issue re-scoped the review to "the first playable run". Since then the run has gained hold sectors and the Finale (#204), Overtime (#206), meet sectors (#212), conditions (#207), gates and stakes (#205), the lean (#210) and the cold opener (#209). Reviewing only the take sectors that the first-playable rule names would leave every game layer unreviewed. That is exactly the gap vision review 2 (finding 6) flagged. **Decision (recorded on #160): review every situation `main` ships, and score items T1–T14 (the checklist's current list), not only T1–T13.**

Not built on `main`, so not reviewed: tempo windows (#100), Surge, Rushers, Bulwarks and Gnats (#33), the cause line (#120–#123) and the reference check-in (#154).

## How it was run

- **Browser.** A production build (`vite build`, `vite preview`) in headless Chromium at 1600×900 and 1280×720, software-rendered (SwiftShader). Two fresh profiles were used: one that tapped **New** and one that tapped **Competitive** on the first panel. Each played three full Sweep runs with the default settings and three with *Coaching cues* off: 12 runs in total, through `window.__flickline.botPlay` at bot skill 20 (New) and 75 (Competitive). Scripted walks through the first sector, a gate and a hold sector were driven with `__flickline.sweep`. The screenshots were looked at, and four are kept in `docs/screenshots/transfer-review-1/`. The `chrome-devtools-axi` bridge could not start on this machine (its MCP package would not download), so the page was driven over the DevTools protocol directly.
  - The New profile's Opener ran at dial 7 with full tells (`tellStrength` 1). The Competitive profile's Opener ran at dial 67 with no added tells (`tellCue` 0, enemy reaction 0.59 s, hit chance 0.45).
  - The cue phase was *every trial* on the first runs and moved to *bandwidth* on the Competitive profile's later runs.
- **Bot reports** on the same commit:
  - `npm run bot -- --sweep-report --runs 60`, `--gate-report --runs 200`, `--overtime-report --runs 200`, `--meet-report --runs 100`, each at skills 30, 50 and 70.
- **Two scratch taps** over `HeadlessGame` (kept with the task data, not added to the repo):
  - **Kill-heal:** 120 runs. Health lost and healed per fought contact, by health at the contact's start.
  - **Hold arrivals:** the first hold sector of 30 seeds. The player stands at the entry, facing the sector or with their back to it, and does not shoot.
- **Code read** for every rule a score depends on. Each is cited in the notes below.

## Results

*S* = same, *D* = different but harmless, ***H*** = harmful, — = does not apply. The note number after a score explains it below the table. Every *H* is critical: the checklist calls an item critical when it is harmful in Sweep, and Sweep is now the whole game.

| Situation | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | Harmful items (issues) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Take sectors (Opener and 2–5; take-unaware, take-expected, clear, crossfire) | S¹ | D² | D³ | **H**⁴ | **H**⁵ | D⁶ | S⁷ | S⁸ | D⁹ | S¹⁰ | **H**¹¹ | **H**¹² | S¹³ | — | #247, #92, #263 |
| Cold opener and clean opener | S¹ | D² | D³ | **H**⁴ | S¹⁴ | S¹⁴ | S⁷ | S⁸ | D⁹ | S¹⁰ | **H**¹¹ | **H**¹² | S¹³ | — | #247 |
| Meet sectors | S¹ | D² | S¹⁵ | **H**⁴ | S¹⁵ | D⁶ | S¹⁵ | S⁸ | D⁹ | S¹⁰ | **H**¹¹ | **H**¹² | S¹³ | — | #247, #263 |
| Hold sectors (hold, trade, flank) and followers | S¹ | D² | S¹⁶ | **H**⁴ | **H**⁵ | D⁶ | S⁷ | S⁸ | D⁹ | S¹⁰ | **H**¹¹ ¹⁶ | **H**¹² ¹⁶ | S¹³ | — | #247, #92, #263, **#280** |
| Finale | S¹ | D² | S¹⁶ | **H**⁴ | **H**⁵ | D⁶ | S⁷ | S⁸ | D⁹ | S¹⁰ | **H**¹¹ ¹⁶ | **H**¹² ¹⁶ | S¹³ | S¹⁷ | #247, #92, #263, **#280** |
| Overtime sectors | S¹ | D² | as the take or hold it deals | **H**⁴ | **H**⁵ | D⁶ | S⁷ | S⁸ | D⁹ | S¹⁰ | **H**¹¹ | **H**¹² | S¹³ | S¹⁸ | #247, #92, #263, **#280** |
| Conditions: eco and light | — | — | — | — | — | — | — | — | S¹⁹ | — | — | — | — | — | — |
| Gate and door stakes | — | — | — | — | — | — | — | — | — | S²⁰ | — | S²⁰ | — | S²⁰ | — |
| Kill-heal | — | — | — | — | — | — | — | — | — | D²¹ | — | — | — | D²¹ | — |
| Contact settle and sector clear | — | — | — | — | — | — | — | — | — | S¹⁰ | — | — | — | S¹⁰ | — |
| Depth multiplier | — | — | — | — | — | — | — | — | — | S¹⁷ | — | — | — | S¹⁷ | — |
| Overtime bank-or-push | — | — | — | — | — | — | — | — | — | S¹⁸ | — | — | — | S¹⁸ | — |
| The lean | — | — | — | — | — | — | — | — | — | — | — | — | — | D²² | — |
| Feedback layer (fading cues, results card, one thing to fix) | — | — | — | — | — | D⁶ | — | S⁸ | — | — | — | — | — | D²³ | — |

### Notes

1. **T1, target size.** Heads use the spec's hit zones (head sphere 0.14 m at 1.66 m, design §5.1). The head node is drawn brighter *inside* the head without enlarging it. No dial value changes the hitbox.
2. **T2, target height: different, harmless.** Every holder stands on the floor of a level map, so the right head height is always eye level. Resting the crosshair at head height pays, which is the right habit, but only in its easiest form, and height differences are never practised. Already filed as #249 (`quality:transfer`), so no new issue.
3. **T3, appearance: different, harmless.** Take Echoes are placed before they can be seen and come into view because the player moves, often at a cover edge (`new-take-first-sight.png`). Two softer points, both already open:
   - first sight is close and full-body (the Competitive Opener's first Echo stood in the open about 5 m away with the crosshair already on its neck, `competitive-take-first-sight.png`; #249);
   - Echoes are the brightest thing on a dark scene, so spotting them is a pop-out task (#134).
4. **T4, timing windows: harmful.** An Echo's shot is still a seeded roll:
   - `enemyHitChance` is the dial's chance × distance falloff × 0.5 if the player is moving × 0.7 if crouched at range;
   - `rollZone` then picks head, body or leg by fixed weights, without consulting cover (`src/sim/enemyFire.ts`, unchanged since the preliminary pass).

   So exposing less (a shoulder peek, a jiggle, holding from half cover with only the head out) does not shorten the window in which the player can be hit, and cannot be learned from being hit. #247 item 3.
5. **T5, rhythm: harmful where Peekers fight.** A Peeker keeps one pattern for its life and re-peeks the same anchor after a seeded 0.8–2.0 s wait (`peek.hiddenMinSec`/`hiddenMaxSec`, `src/sim/peeker.ts`). The angle you just lost a duel on is always where the next peek comes from, within two seconds. That is the checklist's own example of a harmful T11/T5 habit. #247 item 4 (re-peek or reposition), #92 (peek patterns, S10 variety). Strafer legs and stops are seeded per leg, so they score *same*.
6. **T6, cues: different, harmless.** The tell's flare, laser and tone are full up to dial 35 and gone from dial 60 (`tellCue`; the New Opener ran at strength 1, the Competitive one at 0). The moving-shot tracer, `⇆` and tock move to *bandwidth* and then *summary* with the rating. *Coaching cues* off removes them all. The clean opener has none. A player at a low dial does get a tell the reference game lacks, but the tell's length is the Echo's real aim phase, and the cue fades on a schedule (#129, closed as built). The retention experiment that would test the fade is #164.
7. **T7, movement: same.** Movement is free everywhere. A moving shot gets the spec's inaccuracy, and the stat strip and results card count moving shots. The Echo's hit chance halves while the player is above the accuracy deadzone, which stands in for the reference game's "a strafing target is harder to hit". Because the player's own moving shots are inaccurate, the winning pattern is still strafe, stop, shoot, which the meet report measures (note 15).
8. **T8, crosshair placement: same.** A take contact's first sight is an `angles` trial (pre-aim and head-height error, design §3.1). The one thing to fix on both profiles' results cards was "Park your crosshair at head height where targets tend to appear, so the flick is short" (`competitive-cues-off-results.png`). It is the right lesson, in the right words.
9. **T9, weapon use: different, harmless.** Magazines, reloads, recoil and shields are the spec's, and both sides carry the same tier. Reserve ammunition is infinite in runs (HUD `30 / ∞`). No fight on `main` is long enough to run out, so no wrong habit can form. Note it if ammunition ever becomes a stake.
10. **T10, decisions: same.** The contact settle pays a clear above a disengage above leaving unhurt or dying. Its CI check (`npm run reward-experiment`, `src/feedback/contactExperiment.test.ts`) ranks "isolate and disengage" above "always swing" at every dial. Chains give no credit for a kill made under fire from a second angle (#132). The sector clear scales with health kept.
11. **T11, enemy behaviour: harmful.** Echoes on `main` still:
    - see the player if one ray from muzzle to eye is clear within 80 m, **from any side** (`seesPlayer`);
    - hear nothing: #89's perception system is built, but it drives only the debug perceivers, not the Echoes;
    - never leave their anchor after a duel;
    - are not slowed when hit (#263).

    An opponent that sees your back, never moves and is never tagged is beaten by exploits no human allows. #247 (items 1, 2 and 4) and #263.
12. **T12, information: harmful.** Echoes do not hear the player, so running everywhere is free and fastest. In the reference game running announces you. A first-run hint now says "Walk to stay quiet" (`new-take-first-sight.png`). That is the right habit, but on `main` the game does not reward it. #247 item 1.
13. **T13, pace: same.** A run lasts five to nine minutes at most, and the bot's browser runs lasted 7–191 live seconds. The design's session is 15–30 minutes. Nothing asks for a long, fatiguing stretch.
14. **Cold and clean opener.** The opener shows no coaching cues, no added tells and a reference-like HUD (design §7.4). Its contacts come from a calibrated pool: a fixed six-slot card set, shuffled, three of six mirrored, so days differ while their statistics match (`coldOpener.test.ts`, "two days at the same level differ in order and mirroring, with identical item statistics"). It cannot be memorised, and it measures the player without the cues: *same* for T5 and T6.
15. **Meet sectors.** The group is in view down the corridor from the first frame, the way a rotation meets you in a corridor. A run is heard and a walk is silent, and the Strafer brakes with the spec's braking before it shoots. Bot meet report: the bot won **84 %, 83 % and 90 %** of meets where it stopped first, against **74 %, 76 % and 76 %** where the Echo stopped first (skills 30, 50, 70; 100 meets each). Stopping first wins, as it should.
16. **Hold sectors and the Finale.** Arrivals spawn out of sight and walk approach lanes in, which is *same* for T3. **Harmful (new, #280):** two rules protect the *player's* information rather than the Echo's:
    - an arrival holds fire until it has entered the player's view frustum or been heard running (`src/sim/enemyFire.ts:229`);
    - a Strafer arrival runs, louder than its own gait below about dial 29, until it has been noticed (`src/sim/strafer.ts:121`).

    The scratch tap measured both. **67–75 %** of arrivals were noticed first by sound. **19–22 %** held fire for at least 0.5 s while they had a clear line to the player and were unseen and unheard (30 seeds; facing the sector vs back to it). The habits this builds are "silence means nobody is coming" and "an enemy I have not looked at will not shoot", both wrong in the reference game. The rule cites `player-like-enemies.md` S9, but S9 is about what the *Echo* may know. #280 proposes Echo-side honesty once #247 lands.
17. **Depth multiplier and the Finale: same.** The multiplier rises with each sector reached alive (×1.0 to ×2.0, then +0.2 per Overtime sector) and never with time. Dying ends the run, so the multiplier pays for staying alive, which is also the reference game's currency.
18. **Overtime bank-or-push: same.** Bot overtime report (200 seeds per row): leaving when below 90 health+shield out-scores always pushing at every skill:
    - skill 30: 4,562 vs 4,456;
    - skill 50: 5,085 vs 4,878;
    - skill 70: 5,930 vs 5,320.

    Always pushing banked nothing and lost 7,398–11,678 Overtime points. Saving when hurt pays, as in the reference game (`docs/research/survival-rewards.md`).
19. **Conditions: same.** Eco and light sectors give both sides the spec's shield tier and weapons, and the results card names the bullet-count difference when it mattered ("Eco sector, no shields: your Pace needed one headshot here (two on a shielded target)", seen on both profiles' cards).
20. **Gate and door stakes: same.** The door facts are true by construction (`modes/sweepGate.ts`), and in play the two doors differed in role and sightline (`gate-doors.png`). **The preliminary pass's *harmful* score no longer holds.** Gate report (200 seeds per row, ± one standard error):

    | Skill | Read the gate vs always Hot | All facts vs always Hot |
    |---|---|---|
    | 30 | +12 (±53) | +396 (±381) |
    | 50 | +103 (±60) | +754 (±391) |
    | 70 | +75 (±72) | +614 (±418) |

    Always-Hot no longer out-scores reading. Reading still pays only about one standard error more, so the CI guard #239 proposes is still worth having: a retune could bring the habit back silently. Re-measured on #239.
21. **Kill-heal: different, harmless (measured).** The scratch tap played 40 runs each at skills 30, 50 and 70 and counted health lost and healed per fought contact, by health+shield at the contact's start. Net health (healed minus lost, per contact):
    - from 101–150: −31 to −34;
    - from 51–100: −12.5 to −22.6;
    - from ≤ 50: −4.2 to +3.4, but a fight started there **ended in death 57–68 % of the time**, and death ends the run.

    A fight is never a good way to get health back. The heal (5 HP for a body kill, 10 for a head kill, never shield) is a reward the reference game does not have. It cannot pay for "take a fight to heal", the habit the preliminary pass asked about.
22. **The lean: different, harmless.** It changes which cards the next run deals (at most twice their base share), never how a fight works. The Daily Route and the cold opener never lean.
23. **Feedback layer: different, harmless.** The run clock shows at the top centre, but nothing pays for time (note 17). Whether it nudges people to rush is a fun-track question for the repeat-enjoyment playtest (#214).

## Measurements

| Measurement | Result |
|---|---|
| Cold-opener precision (H2) | One cold opener is good to about ±11 dial points (CI: `src/debug/coldHarness.test.ts`). That misses the checklist's ±5 target; the design records it, and #257 is the follow-up. |
| Warm-up is not improvement (H3) | Holds as a rate, not as worded. A warm-up-only bot is told "Improved" on 2.2 % of its verdict days, and CI asserts at most 5 %. The checklist's "Steady on every one of 30 days" is not met: 12 % of months see one "Improved". |
| Learning is reported (H4) | Holds as a rate, not as worded. A learning bot is told "Improved" by day 14 in 30 % of months and by day 30 in 93 %. CI asserts "within 30 days in most months". |
| Not memorisable (H5) | **Pass.** Two days at a level differ in order and mirroring and have identical item statistics (`coldOpener.test.ts`). |
| Cold opener in play | No tester data yet; nobody outside the agents has played (#180, #214). |
| Reference check-in | Not built (#154). |
| Transfer pilot | Not run (#158). |

## Pass rule applied (checklist §3)

**First playable: pass.**
- The habit review has run on the first playable's run (take sectors on Elbow and Lane and their cards, kill-heal, the contact settle) and on everything built since. The Transfer section is posted on #149.
- Every *harmful* item has an issue:
  - #247 (T4, T11, T12, and T5 with #92);
  - #263 (T11);
  - #280 (T11, T12 in hold sectors).

  #247, #92 and #280 are labelled `phase:first-release`. #263 carries no phase label yet; it belongs in first-release scope with #247, and that is asked for on #149.

**First release: fail.**
- Open critical *harmful* items: #247, #280, #92 and #263.
- H2 misses ±5, and H3 and H4 hold as rates rather than as worded (#257).
- The reference check-in (#154) and the transfer pilot (#158) are not built.

## What would change these scores

- **#247** lands (hearing, sight with facing, aimed shots, re-peek or reposition): re-score T4, T5, T11 and T12 for every fight situation. Then fix #280 on top of it.
- **#249** (range, height, cover) and **#134** (spotting): re-score T2 and T3.
- **Tempo (#100)**: score its window as a T14 layer, since it is the first thing that will pay for moving fast.
- Make "habit review of the new layer posted" part of every future game-layer issue's acceptance (vision review 2, finding 6). This review found the layers that shipped without one mostly sound (stakes, settle, Overtime, kill-heal), but one fairness rule (#280) built a wrong habit nobody had looked for.
