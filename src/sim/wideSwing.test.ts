import { describe, expect, it } from 'vitest';
import { axisValue } from '../adaptive/dial';
import type { AxisDef, FairnessFloors } from '../config/dial';
import { cloneTunables } from '../config/tunables';
import { economyShield } from './damage';
import { runWideSwing, WIDE_SWING_ANCHORS, type SkillAnchor, type WideSwingConfig, type WideSwingResult } from './wideSwing';

/**
 * #127 settling experiment (signature S12, `docs/research/prepared-holders.md`): a human-timing
 * peeker wide-swings a pre-aimed holder, 4,000 seeded duels per condition (the issue asks for at least 1,000). The reference game
 * designs the holder to win this fight; if the peeker wins, Flickline teaches the wrong lesson.
 * `WIDE_SWING_REPORT=1 npx vitest run src/sim/wideSwing.test.ts` prints the table for the doc.
 */

const tun = cloneTunables();
const DUELS = 4000; // the issue asks for 1,000; 4,000 keeps the standard error under 1 point
const SEED = 127;

/** #12 proposal P5 for the tell axis (`config/dial.ts` notes it): the research's floors F4. */
const RESEARCH_TELL: AxisDef = { at0: 0.7, at100: 0.3, curve: 'linear' };
const RESEARCH_FLOORS: FairnessFloors = { ...tun.dial.floors, tellSec: 0.25 };
/** The reference game's netcode peeker's advantage (Riot, research §2.5); off in Flickline's tunables. */
const REFERENCE_PEEKER_ADVANTAGE = { ...tun.expectation, peekerAdvantageMinSec: 0.04, peekerAdvantageMaxSec: 0.07 };

type Condition = 'today' | 'research' | 'split' | 'split+pa';
const CONDITIONS: readonly Condition[] = ['today', 'research', 'split', 'split+pa'];

function config(anchor: SkillAnchor, cond: Condition, headScale = 1): WideSwingConfig {
  const k = tun.weapon.kestrel;
  const near = k.damageBands[0]!;
  return {
    anchor,
    rule: cond === 'today' || cond === 'research' ? 'floors' : 'split',
    tellSec: cond === 'research' ? axisValue(RESEARCH_TELL, anchor.mind) : axisValue(tun.dial.axes.tellSec, anchor.mind),
    floors: cond === 'research' ? RESEARCH_FLOORS : tun.dial.floors,
    expectation: cond === 'split+pa' ? REFERENCE_PEEKER_ADVANTAGE : tun.expectation,
    headScale,
    gateSec: 0.1,
    fireIntervalSec: 1 / k.fireRateHz,
    headDamage: near.head,
    bodyDamage: near.body,
    hp: tun.player.health.max,
    // Duels are fought on the default enemy-fire economy (a full buy: heavy shields, design §5.1).
    shield: economyShield(tun.economy.defaultEnemyFire, tun.economy, tun.player.shield),
    shieldAbsorb: tun.player.shield.absorb,
  };
}

function anchor(mind: number): SkillAnchor {
  return WIDE_SWING_ANCHORS.find((a) => a.mind === mind)!;
}

function run(mind: number, cond: Condition, headScale = 1): WideSwingResult {
  return runWideSwing(config(anchor(mind), cond, headScale), SEED, DUELS);
}

describe('wide swing into a prepared holder (#127)', () => {
  for (const mind of [65, 100]) {
    it(`mind ${mind}: with the floors on a prepared holder the peeker wins (the inverted lesson)`, () => {
      expect(run(mind, 'today').holderShare).toBeLessThan(0.5);
      expect(run(mind, 'research').holderShare).toBeLessThan(0.5);
    });

    it(`mind ${mind}: with floors split by expectation (as configured) the holder wins most`, () => {
      const r = run(mind, 'split');
      expect(r.holderShare).toBeGreaterThan(0.5);
      // ...and stays human: no runaway either (a prepared holder is beatable).
      expect(r.holderShare).toBeLessThan(0.8);
      // The holder answers in a real prepared holder's time: about 0.3–0.4 s (research §1.2).
      expect(r.holderMedianSec).toBeGreaterThan(0.25);
      expect(r.holderMedianSec).toBeLessThan(0.45);
    });

    it(`mind ${mind}: the verdict holds with the hypothetical head odds halved and doubled`, () => {
      for (const s of [0.5, 2]) {
        expect(run(mind, 'today', s).holderShare).toBeLessThan(0.5);
        expect(run(mind, 'split', s).holderShare).toBeGreaterThan(0.5);
      }
    });
  }

  it('is deterministic for a seed', () => {
    expect(run(65, 'split')).toEqual(run(65, 'split'));
  });

  it('prints the report table when asked', () => {
    if (!process.env.WIDE_SWING_REPORT) return;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const ms = (x: number) => `${Math.round(x * 1000)} ms`;
    const lines = ['| Mind | Condition | Holder first shot (median) | Peeker first shot (median) | Holder wins | Peeker wins | Trades + draws | Holder share |', '|---|---|---|---|---|---|---|---|'];
    for (const a of WIDE_SWING_ANCHORS) {
      for (const cond of CONDITIONS) {
        const r = run(a.mind, cond);
        lines.push(`| ${a.mind} | ${cond} | ${ms(r.holderMedianSec)} | ${ms(r.peekerMedianSec)} | ${r.holderWins} | ${r.peekerWins} | ${r.trades + r.draws} | **${pct(r.holderShare)}** |`);
      }
    }
    lines.push('', '| Mind | Head odds | today | split | split+pa |', '|---|---|---|---|---|');
    for (const mind of [65, 100]) {
      for (const s of [0.5, 1, 2]) {
        const cells = (['today', 'split', 'split+pa'] as const).map((c) => pct(run(mind, c, s).holderShare));
        lines.push(`| ${mind} | ×${s} | ${cells.join(' | ')} |`);
      }
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  });
});
