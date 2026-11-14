# Spec conformance suite (issue #64, numbers track of design §14.7)

Answers "do the implemented numbers match `docs/mechanics-spec.md`?" mechanically.

```
npm run conformance   # rewrites src/conformance/specSnapshot.json and docs/conformance.md, about 2 s
npm test              # the suite: one test per row, plus "snapshot matches the spec" and "table is up to date"
```

## How it works

| File | Role |
|---|---|
| `specParse.ts` | Pure parser: the spec's §7 tables (+ §3.1 reserve and mode, §1.1 hFOV per aspect, §6 bullets to kill) -> `specSnapshot.json`. `specParse.test.ts` re-extracts it and fails when the checked-in file no longer matches the spec. |
| `rows.ts` | One row per spec value or behaviour: spec value, section, the spec's confidence tag, and how the implemented value is obtained: a live `config/` key (compared key by key), or a measurement on the real `World` driven by scripted `TickInput` (`measure.ts`, `sim.ts`). |
| `deviations.ts` | The written reason for every row that differs from the spec. |
| `conformance.ts` | Turns outcomes into statuses and applies the rules below. |
| `table.ts`, `generate.ts` | Render `docs/conformance.md` (deterministic: no dates, no commit ids). `scripts/conformance.mjs` writes the files. |

## Statuses and rules

- **match** (value sourced by the spec), **match (estimate)**, **match (placeholder)**: equal to the spec; the second and third say the spec itself marks the number as a guess.
- **deviation**: differs from the spec. It must have a non-empty reason in `deviations.ts`, or the suite fails.
- **not implemented**: nothing to compare yet (a weapon, a mechanic). Never a failure; it flips to match or deviation by itself when the code lands, because every row reads a config key or the sim and finds nothing until then.
- A reason left in `deviations.ts` for a row that now matches fails the suite: the PR that fixes a deviation deletes its entries and runs `npm run conformance`.

## Working with it

- **Changed a number or a mechanic?** Run `npm run conformance`, commit `docs/conformance.md`, and put the counts in a comment on the numbers tracking issue (#61).
- **Spec edited?** `npm test` fails until `npm run conformance` has re-extracted the snapshot; a new §7 row with no row builder fails too ("has a row for every spec value").
- **New weapon archetype in `config/weapon.ts`?** Its rows are already there as "not implemented", keyed by the `archetype` field; they light up when the entry exists.
- **A config key moved?** Update the path in `rows.ts` (`cfg(t, 'new.path', 'old.path')` keeps both).
- **New behaviour to check?** Add a measurement to `measure.ts` (build a `createSim`, script `TickInput`, return numbers read from the sim) and a row in `rows.ts`. Never read the value you compare against from the same config key you are testing.
