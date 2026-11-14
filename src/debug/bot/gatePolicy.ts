import type { GatePlan } from '../../modes/sweepDirector';

/**
 * How the Sweep bot chooses a door (#205). A policy sees the two doors' facts (what the player sees,
 * nothing more) and the player's health and shield, and returns the door to walk through.
 */
export type GatePolicy = (gate: GatePlan, vitals: { hp: number; shield: number }) => 0 | 1;

function doorWith(gate: GatePlan, stake: string): 0 | 1 | -1 {
  return gate.doors[0].facts.stake === stake ? 0 : gate.doors[1].facts.stake === stake ? 1 : -1;
}

/** Policy A of #205: always take Hot when it is offered, else the left door. */
export const alwaysHot: GatePolicy = (gate) => {
  const hot = doorWith(gate, 'hot');
  return hot === -1 ? 0 : hot;
};

/** HP below which policy B asks for a Shield (#205: "Shield when below 50 HP"). */
export const SHIELD_BELOW_HP = 50;

/** Policy B of #205: Shield when below 50 HP, Hot when not, else the left door. */
export const readTheGate: GatePolicy = (gate, v) => {
  if (v.hp < SHIELD_BELOW_HP) {
    const shield = doorWith(gate, 'shield');
    if (shield !== -1) return shield;
  }
  const hot = doorWith(gate, 'hot');
  return hot === -1 ? 0 : hot;
};

/**
 * Policy C: reads all three facts, not only the stake. The heard bucket is the honest warning (a
 * sector with several Echoes is far deadlier, see the table on #205), so a door that is several is
 * only worth taking for a stake that pays for it: each door scores its stake's value minus the
 * danger its heard bucket shows, and the better door is taken (the left one on a tie).
 */
const STAKE_VALUE = { hot: 1, shield: 0.3, arms: 0.1, plain: 0 } as const;
const HEARD_DANGER = { quiet: -0.2, few: 0, several: 1.5 } as const;
export const readAllFacts: GatePolicy = (gate) => {
  const score = (d: 0 | 1): number => STAKE_VALUE[gate.doors[d].facts.stake] - HEARD_DANGER[gate.doors[d].facts.heard];
  return score(1) > score(0) ? 1 : 0;
};

/** Always the left door: what a player who ignores the gate does. */
export const leftDoor: GatePolicy = () => 0;

export const GATE_POLICIES: Readonly<Record<string, GatePolicy>> = { hot: alwaysHot, read: readTheGate, facts: readAllFacts, left: leftDoor };

/** What the bot sees at an Overtime gate (design §4.7, #206): its health and what is at stake. */
export interface OvertimeView {
  hp: number;
  shield: number;
  /** Overtime sectors cleared so far (0 at the gate right after the Finale). */
  overtimeSectors: number;
  /** Overtime points at risk (a Leave door banks them) and the score banked for good. */
  atRisk: number;
  banked: number;
}

/** The two doors of an Overtime gate: leave (the run ends, everything banked) or push on into the next Overtime sector. */
export type OvertimePolicy = (view: OvertimeView) => 'leave' | 'push';

/** Always leave at the first Overtime gate: the run ends at the Finale, as it did before Overtime. The default, so earlier reports do not change. */
export const alwaysLeave: OvertimePolicy = () => 'leave';

/** Always push on: how deep the bot gets before it dies (the depth distribution of #206). */
export const alwaysPush: OvertimePolicy = () => 'push';

/**
 * Health+shield below which `bankWhenHurt` leaves. The full tank is 100 HP + 50 shield; 90 is 60% of it, about where a player who reads
 * their own health stops trusting the next sector (a fight costs a third of the tank at the matched dial).
 */
export const BANK_BELOW_EHP = 90;

/** Push while the tank is healthy, leave once it is not: the bank-or-push decision a player makes (design §4.7). */
export const bankWhenHurt: OvertimePolicy = (v) => (v.hp + v.shield < BANK_BELOW_EHP ? 'leave' : 'push');

export const OVERTIME_POLICIES: Readonly<Record<string, OvertimePolicy>> = { leave: alwaysLeave, push: alwaysPush, bank: bankWhenHurt };
