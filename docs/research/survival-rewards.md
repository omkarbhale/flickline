# Survival rewards: paying for living through a fight, not only for kills

Research and decision for the open question **#132** ("rewards that pay for kills and speed but never for surviving or a correct disengage"), from vision review 1 (`docs/reviews/vision-review-1.md`, finding 6). Companion documents: `engagement-information.md` (scenario cards, crossfire), `player-like-enemies.md` §2.10 (mistakes by tier), `fight-attribution.md` §3.1 (what a contact is).

- Date: 2026-11-14. Reference game: Valorant ("the reference game").
- Code: `src/feedback/contactScore.ts` (the rules), `src/config/scoring.ts` (`contact`, `isolationAngleDeg`), `src/feedback/streaks.ts` (chain gate), `src/feedback/contactExperiment.ts` + `.test.ts` (the settling experiment, run in CI).
- #132 stays open until the rules are built into Sweep and Corner Clear and judged in play (section 6).

---

## 1. Summary

**The problem is real, and it is a per-contact problem.** In a seeded model of Sweep fights, today's table pays a matched player *more per contact* for swinging into every fight than for isolating angles and leaving fights they are losing. That holds at the low dials (0–20) for a matched player and at 8 of 11 dials for an under-matched one (section 4). It does not hold *per run*, because a Sweep death already ends the run. The run total therefore prices survival, but that price is paid once, minutes later, when the player can no longer connect it to the fight that cost it. Instant feedback is how Flickline teaches (vision principle 3), so the lesson has to be paid out where the fight ends.

**Decision.** A **contact settle**: when a contact ends, it pays for how it ended and for the health the player kept.

| Outcome | Settle (in kills' worth, × health kept) |
|---|---|
| **Cleared** (every enemy dead, player alive) | `clear` = **2** |
| **Disengaged alive** (lost ≥ 30% of the health+shield the contact started with, then broke line of sight for 2 s and lived) | `disengage` = **1.5** |
| **Avoided** (left unhurt) | 0 |
| **Died** | 0 |

`kill's worth` = the mean `base` of the contact's enemies × the difficulty term (design §8.1). `health kept` = 1 − damage taken in the contact ÷ health+shield at its start, and kill-heal does not reduce it. Kill points stay exactly as they are and are still paid the instant each enemy dies. The settle is one extra payout, never negative.

Also decided:

- **Chain credit only for isolated kills.** A kill made while another live enemy had the player in sight from a bearing more than 30° away from the victim's (a second angle) neither extends nor starts a chain. Surge fills from chains (design §4.8), so swinging into a crossfire cannot fill Surge. The clean streak, which measures aim, is unchanged.
- **The speed term stays on every card.** This deliberately departs from the issue's proposal; see section 3.3.
- **Kill-heal is unchanged.** It sustains clean play, and the settle prices the health it would otherwise refund for free.

Result of the settling experiment with these rules (section 4): "isolate and disengage" out-scores "always swing" per contact at **all 11 dials** (+2% to +7%) and per run at all 11 dials. "Back off at the first hit" scores lowest at every dial: "isolate" earns 52–68% more per contact. The check runs in CI (`npm run reward-experiment`, about 2 s), so a retune that breaks the ranking fails the build.

---

## 2. Why the old table trains over-aggression

Design §8.1 pays per kill: `base × precision × speed × streak × difficulty`. Chains (kills within 1.5 s) fill Surge, which doubles score. Sweep heals only on kills, and tempo windows (#100) push the player forward. "No negative scores" is a rule.

Nothing in that list pays for:

- leaving a fight you are losing;
- not swinging into two angles;
- keeping your health.

The only cost of a bad fight is health, and the next kill refunds part of it. In the reference game survival is the currency: dying gives the other team a player of man advantage, which is worth about as much as a kill (`engagement-information.md`: "~+20 points per man advantage"). Coaching sources name "over-aggressive" as the upper-middle tier's mistake and "swinging into multiple angles" as the top low-tier mistake (`player-like-enemies.md` §2.10, `engagement-information.md` card 8). A trainer whose rewards say "take every fight" builds the habit vision principle 1 calls a bug, and it contradicts Flickline's own crossfire and breach cards ("isolate one angle", "don't take this fight yet").

---

## 3. The rules and why each is shaped this way

### 3.1 The settle prices a life the way the reference game does, then a little more

The man-advantage argument gives a natural price: surviving a contact is worth about **one kill**. Pricing it at exactly that (`clear = disengage = 1`) only **ties** the two policies in the experiment: the worst dial moves from −5% to +0.2%. Pricing survival at one kill cancels the kill table's bias but does not reverse it. **2** is the smallest round value that ranks isolating higher at every dial, for matched, under-matched and over-matched players. A larger value grows the margin only slowly (raising `clear` to 3 or 4 with `disengage` at 2 lifts the worst case only to +2.4–2.6%) and starts to make one contact's settle outweigh its kills, which would mute the kill feedback that makes Flickline fun (principle 2). So the value is 2.

### 3.2 Guards against the loop training passivity instead

The fix must not swap one bad habit for another. Flickline is fast, and taking a fight you can win is still the right play.

- **A clear always pays more than a disengage at the same health** (2 > 1.5), and a clear also collects every kill. Winning stays the best outcome. A unit test checks the inequality.
- **Leaving unhurt pays nothing** (`avoided`). A disengage needs at least 30% of the contact's starting health+shield lost (more than one Kestrel body hit through a heavy shield, 39/150 = 26%), so peek-and-leave cannot be farmed. Health does not regenerate in Sweep, so every disengage is paid for with health that only kills restore.
- **Disengaged enemies come back.** In Sweep the survivors push and re-peek (`player-like-enemies.md`: disengage → reposition or re-peek). Leaving buys a reset, not an exit. The experiment models this (section 4.1).
- **The experiment includes a passive policy** ("back off at the first hit") and asserts that it scores lowest, per contact and per run, at every dial.

### 3.3 Why the speed term is kept (a deliberate departure from the issue)

The issue proposed applying `speed` only on cards where the player is the one forced to move. We did not adopt this. `speed` uses TTK, which design §3 defines as the time *from the first shot at the target* to its death. It pays for killing efficiently once the player has committed, not for rushing into the fight: a player who holds an angle for 5 s and then kills in 0.3 s gets the full term. Removing it from holding cards would take a mechanics reward away from the cards where crosshair placement matters most, and it would change nothing about aggression. In the experiment both policies have the same TTK, and the term never separated them. The guard is recorded in `config/scoring.ts`: TTK must stay first-shot-based. If a later change measures speed from `targetVisible` (time to shot), the issue's gate becomes necessary.

### 3.4 Chain isolation

A chain is the reward that most directly pays for a double kill. A double kill made by swinging into two angles at once is the lucky outcome of the mistake the crossfire card exists to teach out of. In the experiment, 17–22% of "always swing" kills were crossfire kills; under the new rule they earn no chain credit. The 30° threshold is about the area the crosshair covers without a flick. Two holders further apart than that cannot both be fought from one crosshair placement. The facts the producer needs (which enemies had line of sight to the player, from which bearing) are the exposure facts of #119. Until they exist, every kill counts as isolated, which matches today's behaviour.

---

## 4. The settling experiment

### 4.1 Model

Sweep, its director and enemy fire are not built yet, so the experiment runs on a seeded **contact model** (`feedback/contactExperiment.ts`), not on the game sim. Kill points and the settle come from the real scoring code, so the model measures the actual table.

- **Fights**: event-driven duels. Each side fires after a time to first shot (log-normal spread) at 6 shots/s with a per-shot hit chance and head share. Damage is the spec's Kestrel at 15 m (39 body, 156 head) through heavy shields (50, 66% absorb) on both sides, with Sweep's kill-heal (+5 body, +10 head kill).
- **Enemies** use the design's dial axes: `enemyReactionSec + tellSec` (1.7 s → 0.48 s) and `enemyHitChance` (0.15 → 0.6). Head share goes from 12% to 30% with the dial (§2.10 tiers).
- **The player is matched.** At each dial the player's edge over the enemy profile is solved so that an isolated 1v1 is won *untouched* 70% of the time. That is the trial success of design §4.7 at the mode's target rate (§9). The check is repeated at 55% (under-matched) and 85% (over-matched).
- **Contacts** have 1–4 enemies (weights 30/35/25/10%). 40% of contacts with two or more enemies come from two angles at once (a crossfire). Enemies arriving through the same angle are staggered by 0.3–1.5 s.
- **Policies**:
  - **always swing**: exposed to every angle at once, never leaves.
  - **isolate and disengage**: fights one angle, then slices to the next (0.6 s). It leaves (0.3 s still exposed) when it has lost at least 35% of its starting health+shield *and* the enemy that just hit it is healthier than it is. It also skips the second angle if it is already that hurt.
  - **back off**: isolates, and leaves at the first hit.
- **Two measures**:
  - per contact: 1,000 seeded contacts at full health, as the issue specified;
  - per Sweep run: runs of up to 50 contacts until 1,000 contacts are fought, with health carried between contacts, death ending the run, and enemies the player left coming back with the next contact.
- Every policy meets the same contacts in the same order.

### 4.2 Results, matched player

Generated by `REWARD_TABLE_OUT=<file> npm run reward-experiment`. "Today" is the §8.1 kill table alone; "Proposed" adds the settle. Percentages are isolate relative to swing unless stated.

| Dial | Today, per contact: isolate vs swing | Proposed, per contact | Today, per run | Proposed, per run | Proposed, isolate vs back off (contact / run) | Clear / disengage / death % (swing · isolate · back off) | Swing kills in a crossfire | Contacts per run (swing · isolate) |
|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 0 | 102 vs 104 (−1.4%) | 164 vs 154 (+6.4%) | +37.7% | +41.2% | +68.3% / +56.2% | 69 / 0 / 31 · 69 / 20 / 12 · 33 / 6 / 5 | 21% | 2.8 · 4.1 |
| 10 | 138 vs 139 (−0.2%) | 216 vs 204 (+5.6%) | +28.1% | +31.0% | +57.3% / +63.1% | 67 / 0 / 33 · 66 / 18 / 16 · 34 / 8 / 9 | 20% | 2.7 · 3.7 |
| 20 | 194 vs 201 (−3.3%) | 297 vs 291 (+2.1%) | +47.7% | +50.1% | +58.9% / +70.7% | 69 / 0 / 31 · 67 / 14 / 19 · 34 / 11 / 10 | 20% | 2.6 · 3.8 |
| 30 | 280 vs 278 (+0.8%) | 413 vs 389 (+6.2%) | +19.8% | +21.2% | +61.4% / +66.8% | 66 / 0 / 34 · 66 / 12 / 21 · 31 / 11 / 12 | 22% | 2.8 · 3.5 |
| 40 | 420 vs 408 (+3.0%) | 605 vs 569 (+6.4%) | +22.2% | +24.9% | +54.4% / +90.6% | 70 / 0 / 30 · 72 / 10 / 19 · 36 / 11 / 13 | 20% | 3.0 · 3.8 |
| 50 | 547 vs 534 (+2.5%) | 783 vs 736 (+6.5%) | +17.1% | +19.2% | +57.0% / +70.4% | 66 / 0 / 34 · 68 / 11 / 22 · 34 / 12 / 15 | 22% | 2.8 · 3.3 |
| 60 | 761 vs 742 (+2.6%) | 1,077 vs 1,022 (+5.4%) | +23.9% | +25.4% | +55.2% / +104.5% | 69 / 0 / 31 · 71 / 9 / 21 · 37 / 14 / 15 | 18% | 2.9 · 3.6 |
| 70 | 1,162 vs 1,123 (+3.5%) | 1,618 vs 1,534 (+5.5%) | +33.2% | +33.1% | +52.9% / +114.1% | 74 / 0 / 26 · 76 / 5 / 19 · 40 / 12 / 13 | 19% | 3.4 · 4.3 |
| 80 | 1,492 vs 1,463 (+2.0%) | 2,044 vs 1,960 (+4.3%) | +12.3% | +14.5% | +56.5% / +127.4% | 71 / 0 / 29 · 71 / 6 / 23 · 38 / 12 / 18 | 21% | 3.2 · 3.7 |
| 90 | 1,898 vs 1,850 (+2.6%) | 2,552 vs 2,429 (+5.1%) | +21.9% | +21.4% | +58.5% / +144.5% | 63 / 0 / 37 · 64 / 7 / 30 · 31 / 18 / 22 | 19% | 2.7 · 3.1 |
| 100 | 2,783 vs 2,649 (+5.1%) | 3,755 vs 3,516 (+6.8%) | +30.2% | +30.9% | +51.9% / +123.8% | 69 / 0 / 31 · 72 / 5 / 23 · 36 / 12 / 20 | 17% | 2.9 · 3.5 |

**Under-matched (55% untouched 1v1 wins).**

- Per contact, today's table ranks swing higher at 8 of 11 dials, by up to 5.2%. The proposed table ranks isolate higher at all 11, by +1.0% to +7.3%.
- Per run, isolate is ahead at 10 of 11 dials. The exception is dial 100, where swing is ahead by 3.0% today and 1.1% proposed: an under-matched player at the top of the dial cannot win the fights it isolates.

**Over-matched (85%).** Isolate is ahead everywhere under both tables, by +2.4% to +7.6% per contact with the settle.

### 4.3 What the experiment says

1. **The issue's "by construction" claim is partly right.** Today's table favours swinging per contact where enemies punish swings least: the low dials, and players below their dial. At mid and high dials isolating already wins a little more, because swinging dies more often (26–37% against 12–30% per contact). The bias exists, but it is small and lives in the per-contact signal.
2. **Per run, Sweep's death rule already prices survival** (isolate +12% to +48% per run today). The settle does not need to fix the run total. It moves the price of survival to the moment the fight ends, so the player can learn from it.
3. **The margins are modest** (+2% to +7% per contact). That is intended: the settle tilts the reward towards good habits without making survival the main source of points.
4. **Model lethality is far above Sweep's design target.** A matched player dies in 12–30% of contacts, so model runs last 3–4 contacts, while design §4.8 expects about 3:00 (about 30 contacts). Contact sizes and dial axes taken straight from the design make Sweep far deadlier than the design intends. This is filed as a balance issue for the Sweep director (#165). At lower lethality kills weigh more relative to survival, so the run-level comparison should be re-checked once the director exists (section 6).

### 4.4 Limits

- It is a model, not the game. It has no movement, no slow-on-hit, no reloads, no audio information and no enemy minds. Both sides see each other at the same instant, so peeker's advantage and holder's advantage are not modelled.
- Surge is not modelled because its fill rules belong to #40. The chain gate therefore does not move these numbers; it is justified on its own (section 3.4).
- At dial 90 and above, the matched player's solved edge reaches the model's caps (hit chance 0.95), so those rows are less informative.

---

## 5. Presentation (for #40, #123, #51)

- The settle floats once when the contact ends, like a kill's `+score` but anchored under the score, with a short word: **Clean** (cleared untouched), **Clear** (cleared, hurt), **Reset** (disengaged). The word is Flickline's own; nothing is taken from another game. Died and avoided show nothing: no negative feedback and no zero.
- It follows the fight-attribution silence rules (`fight-attribution.md` §6.5, §7.2): it never stacks with the fight cause line, never shows while an enemy is visible or a tell is running, and is suppressed in drills.
- The results card's Sweep and Corner Clear stats gain "contacts cleared / reset / lost" next to "damage taken per contact".
- Event: `contactSettled { tick, t, contactId, outcome, kept, points }`, emitted by the mode that owns contacts (design §14.3).

---

## 6. What settles #132

1. **Built**: Sweep (#51) and Corner Clear (#50, #103) call `settleContact` when a contact ends, using the contact boundaries of `fight-attribution.md` §3.1. The kill producer passes `isolated` to `StreakTracker.onKill` from the exposure facts of #119.
2. **Re-run on the real sim**: the bot harness (#28) runs the same three policies as scripted bots over 1,000 seeded Sweep contacts, using real movement, enemy minds and the real director. The same assertions apply. If the ranking fails there, `contact.clear` and `contact.disengage` are retuned under the constraints of section 3.2.
3. **Judged in play**: in the fun playtest (#68), testers say whether the settle reads as a reward for good fights, or as noise or a scold. The transfer check (#128) watches whether over-peek damage per contact falls across sessions.
