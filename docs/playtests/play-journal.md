# Measuring repeat enjoyment from the play journal (#251)

Vision principle 10 asks whether people replay Flickline because it is fun. Recall and agents cannot answer that: a tester forgets, and a bot replays whatever it is told to. Flickline therefore keeps a **play journal** in the save, on the player's device only (no telemetry, design §8.4), and the repeat-enjoyment playtest ([#214](https://github.com/omkarbhale/flickline/issues/214), hypotheses R1 to R7 in `docs/research/replay-not-drills.md` §7) reads its numbers from testers' exports instead of from memory.

The journal is a record, not a reward: it holds no streak, goal or points, the game never reads it, and it is shown only as one plain line in Settings > Data (design §2.5).

## What a tester does

1. Play as they like, over days. Nothing is asked of them in the game.
2. When the test window ends: **Settings > Data > Copy play journal** (or **Download save**; the full export carries the same journal). Paste the copied text on #214, or attach the file.

## What the report author does

Save each tester's paste as a file (`ann.json`, `ben.json`) and run:

```
npm run journal -- ann.json ben.json
```

It prints a markdown table, one row per tester and a pooled row, for the playtest report in `docs/playtests/`.

| Column | Hypothesis | Meaning |
|---|---|---|
| sessions, runs | R1 | Sessions that played at least one run (a gap of 30 minutes starts a new one), and runs that went live. |
| runs per session | R1 | Median and mean runs started per session. |
| one-run sessions | R1 | Sessions with one run and no restart. They are not a signal to shorten the run, which is already short (R1, #274): look at early deaths (#165) first. |
| quit mid-run | R1 | Runs the player quit before their end. |
| restarted straight after | R1 | Finished runs whose next run was readied within 10 s of the results card ("pulled back in"). |
| restarted after a death, left after a death | R6 | Deaths followed by another run within 10 s, and sessions that ended with the player leaving after a death. |
| median run s | R1 | Median seconds a run was live. |
| fights / live min, longest dead air | fight pace (#248) | The median run's fights per live minute and the pooled rate (all fights over all live minutes), and the median run's longest stretch inside a sector with no Echo seen, heard or shooting, with the runs over 15 s. Targets (design §2.2): at least 4 a minute at the median run, no dead air over 15 s. Runs saved before #248 carry neither and are left out. |
| live s to the Finale's exit | R1, run length (#274) | Of the runs that cleared the Finale: the median seconds from going live to walking out of it (Overtime not counted), with how many runs that is. Target (design §4.1): 120–240 s. The bot's time (`npm run bot -- --repeat-report`) is a floor for a person's. Runs saved before #274 do not carry it and are left out. |
| days played, day 3, day 7 | R7 | Return without being asked. `yes`: played exactly 3 (or 7) days after the first day; `later`: only after it; `no`: not by the export; `n/a`: that day had not come yet when the export was made, so it is not yet testable. |

R2 to R5 need other evidence (door choices against state, "did this run feel different?", the bot harness); the journal does not cover them. Ask each tester after each run, beside the journal: "Did this run have enough fighting?" (1–5, and "where was it slow?"); the journal's fight rate is what that answer is read against (design §14.7).

## What it can and cannot say

- It says what people did, not why. Ask the day-3 and day-7 questions of #180 beside it.
- It records Sweep runs only (the Daily Route included), and only on the browser and device where it was played. A tester who plays in two browsers needs both exports.
- Sessions older than 90 days are dropped; the first day ever played is kept, so day-3 and day-7 stay measurable.
- Days are the tester's local calendar days. The copied journal carries the day it was written down, so a tester's time zone does not move the "not yet testable" boundary.
