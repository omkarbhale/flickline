# Transfer checklist

How the **Transfer** quality track is judged (design §14.7). The question: **does skill earned in Flickline carry over to the reference game, and does every situation the game presents teach only habits that are also right there?** Since #187 the game is one game, Sweep (design §4); the review's unit is the **situation**: a sector role, a scenario card, a condition or a game layer (door stakes, kill-heal, Overtime, the depth multiplier). Where this page says *mode*, read *situation*. Reasoning and evidence: `docs/research/transfer.md`. Tracking issue: [#149](https://github.com/omkarbhale/flickline/issues/149).

Transfer is judged in two ways, never merged into one score and never standing in for numbers, feel or fun:

1. **Habit review**: a person plays each mode and asks of every item below, "would this habit be wrong in the reference game?"
2. **Measurements**: the Daily Baseline's bot tests, Baseline and check-in data from playtests, and the transfer pilot's verdict.

---

## 1. Habit review

### 1.1 How to run it

- Play each mode in scope for at least three runs at two skill levels (self-reported New and Competitive), in a real browser, with the default settings and then with coaching cues off.
- For every item in section 1.2, score the mode:
  - **Same**: the habit the mode builds is also right in the reference game.
  - **Different, harmless**: the mode differs, but the difference cannot become a habit that fails there. Write why.
  - **Harmful**: the mode rewards or builds a habit that loses fights in the reference game. This is a bug (vision principle 1), however fun the mode is.
- Give evidence for every score that is not *Same*: a screenshot, an event-log excerpt, a measurement or a short description of what the player does.
- File every *Harmful* item as an issue labelled `quality:transfer`, naming the item number, and list it on the tracker.
- An item is **critical** when it is harmful in Sweep or in a mode that trains `footwork`, `angles` or `precision`, the three skills with the strongest transfer case (`docs/research/human-performance.md` §6.2).
- Items that only restate a value in `docs/mechanics-spec.md` are judged by the numbers track (#61), not here; this review asks what the *mode* makes of those mechanics.

### 1.2 Items

Each item describes a habit in Flickline's own words; no reference material is copied or recorded.

| # | Area | Question | Harmful looks like |
|---|---|---|---|
| T1 | Target size | Are heads at real head size (spec hit zones) when the mode is judged at the player's matched dial? | Success at the matched dial depends on enlarged targets the player never meets in a match. |
| T2 | Target height | Do targets put the head where a standing or crouching enemy's head would be, so that resting the crosshair at head height pays? | Targets float at random heights, so resting at head height is not rewarded. |
| T3 | Appearance | Do targets enter the view the way enemies do (from behind cover, at an edge, moving into the open), or do they pop into existence in open space? | The player learns to react to a target appearing from nothing, a visual event that never happens in a match (#134). |
| T4 | Timing windows | Is the time the player gets before a target leaves or an enemy hits them realistic for the situation? | Windows longer than a prepared opponent would give, so a habit that loses to a prepared holder wins here (#127). |
| T5 | Rhythm | Is the timing of targets unpredictable? | A fixed or learnable rhythm lets the player time shots instead of reacting. |
| T6 | Cues | Does the player's action depend on a cue the reference game does not give (enemy tell laser or tone, moving-shot tock or tracer, miss ghost, numbers)? | The player waits for a tell before acting, or knows they were moving only because of the tock (#129). |
| T7 | Movement | Can the player move the way they would in a match, and does the mode reward stopping before shooting? | Movement is locked where a match would require it, or shooting while moving is rewarded. |
| T8 | Crosshair placement | Between targets, does the mode reward keeping the crosshair where the next enemy will be, at head height? | The best strategy is to park the crosshair somewhere a match would punish (centre of the room, the floor). |
| T9 | Weapon use | Do magazines, reloads, recoil and bullets-to-kill (including shields) behave as in a match where it matters for the drill? | Infinite ammo or no shields teach a bullet count or a spray length that fails in a match (#131). |
| T10 | Decisions | Does scoring reward the decision a good player would make in a match (disengage, hold, trade, isolate one angle)? | Score pays for taking every fight fast, swinging into several angles or staying after a kill (#132). |
| T11 | Enemy behaviour | Do enemies fight like players at the player's level, mistakes included (`docs/research/player-like-enemies.md`)? | Enemies are beaten by an exploit no human opponent allows (always the same peek, never re-peeking, no trade). |
| T12 | Information | Does the player know as much and as little about the fight as they would in a match (`docs/research/engagement-information.md`)? | Both sides always know everything, or the player always knows where every enemy will be. |
| T13 | Pace and fatigue | Is the session length and intensity something the player can bring into a match warm, not tired? | A session that leaves the player's hand tired before they play a match. |
| T14 | Game layers | Do the layers around the mechanics (kill-heal, door stakes, the depth multiplier, Overtime's bank-or-push, tempo) reward the decision a good player would make in a match? | A layer pays for a habit a match punishes: taking needless fights to heal, rushing loud to beat a window, never saving. |

New items are added when a playtest or review finds a habit the list misses; each new item needs an example of the harmful case.

### 1.3 Report template (the Transfer section of a playtest report)

```
## Transfer

Habit review: <situations reviewed> at <skill levels>, build <commit>.

| Situation | T1 | T2 | … | T14 | Harmful items (issues) |
|---|---|---|---|---|---|

Measurements: cold-opener bot tests <pass/fail> (H2–H5); cold-opener data from testers <n, days, verdicts shown>; check-ins <n>.
Pilot: <not run / feasibility verdict and warnings, link>.
Verdict: <pass / fail against the phase rule below>, with the reasons.
```

Post the section on the Transfer tracker as a comment, as the other tracks do.

---

## 2. Measurements

| Measurement | Where | Pass |
|---|---|---|
| Cold-opener precision (H2) | Bot harness, CI | Spread of a fixed-ability bot's cold-opener estimates within 20% of the figure design §8.5 states (about ±5 dial points, to be measured). |
| Warm-up is not improvement (H3) | Bot harness, CI | A warm-up-only bot is told "Steady" on every one of 30 days. |
| Learning is reported (H4) | Bot harness, CI | A learning bot is told "Improved" within 14 days, across a level change. |
| Not memorisable (H5) | Bot harness, CI | Two days' orders differ; their item statistics are identical. |
| Cold opener in play | Playtest exports | Reported, not judged: valid cold openers per tester, share warm, gaps between them, verdicts shown. |
| Reference check-in | Playtest exports and pilot form | Reported, not judged: check-ins per tester. |
| Transfer pilot | Pilot playtest issue | Its feasibility verdict and any warning (`transfer.md` §7.3). |

---

## 3. Pass rule

### First playable

- The habit review has been run on the first playable's run (take sectors on Elbow and Lane and the cards they draw, kill-heal, contact settle) and posted on the tracker. Cold Start, Orbit and the Placement run were retired by #187 before their review (#160) ran.
- Every *Harmful* item has an issue. Critical items need not be fixed yet, but each has an issue in the first-release scope.

### First release

- The habit review has been run on every sector role, every scenario card, every condition and every game layer (item T14).
- **No open critical harmful item**, unless the tracker records why it is accepted for this release and which issue fixes it.
- The cold opener (design §8.5, which replaced the Daily Baseline) and the reference check-in are built, and H2–H5 pass in CI against the cold opener.
- The transfer pilot has run and reported a feasibility verdict, with no open "worse than the reference game's own practice" warning.

A pass on this track says the game builds no known wrong habit and that its learning is measured honestly. It does not say transfer is proven; only a study large enough to test it can say that (`transfer.md` §7.5).
