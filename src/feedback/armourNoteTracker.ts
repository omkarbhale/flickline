import type { DamageBand } from '../config/weapon';
import { bulletsToKill } from '../sim/damage';
import type { HitZone } from '../sim/types';
import { armourNote, ecoNote } from './armourNote';

/** What the tracker needs about the weapon in hand at a kill. */
export interface KillWeapon {
  name: string;
  bands: readonly DamageBand[];
}

export interface ArmourNoteDeps {
  /** The weapon the player killed with (the one in hand now). */
  weapon(): KillWeapon;
  /** Health of an Echo and the absorb share of a shield (spec §4.1), and the shield of a full economy (what an eco kill is compared with). */
  maxHp: number;
  absorb: number;
  fullShield: number;
}

/**
 * Names the difference a shield made, once per run, on the results card (design §5.2, §4.6): the kill
 * where an armoured target took the most extra bullets ("your Pace needed two headshots on an armoured
 * target"), and, in an eco sector, the kill where having no shield saved the most ("Eco sector, no shields:
 * your Pace needed one headshot here"). The counts are the spec's for the zone and distance of the killing
 * shot (`bulletsToKill`), so the note teaches the threshold, not what the misses of that fight added.
 * Pure; the caller feeds it the kills and the sector conditions.
 */
export class ArmourNoteTracker {
  private eco = false;
  private armour: { note: string; extra: number } | null = null;
  private ecoKill: { note: string; extra: number } | null = null;

  constructor(private readonly deps: ArmourNoteDeps) {}

  reset(): void {
    this.eco = false;
    this.armour = null;
    this.ecoKill = null;
  }

  /** A sector was entered with this economy. */
  sectorEntered(condition: string): void {
    this.eco = condition === 'eco';
  }

  /** The player killed an Echo with a shot in `zone` from `distance` m; `shield` is what the Echo spawned with. */
  killed(zone: HitZone, distance: number, shield: number): void {
    const { maxHp, absorb, fullShield } = this.deps;
    const w = this.deps.weapon();
    const bare = bulletsToKill(w.bands, zone, distance, maxHp, 0, absorb);
    if (!Number.isFinite(bare)) return;
    if (shield > 0) {
      const armoured = bulletsToKill(w.bands, zone, distance, maxHp, shield, absorb);
      const note = armourNote(w.name, zone, armoured, bare);
      if (note !== null && armoured - bare > (this.armour?.extra ?? 0)) this.armour = { note, extra: armoured - bare };
    } else if (this.eco) {
      const shielded = bulletsToKill(w.bands, zone, distance, maxHp, fullShield, absorb);
      const note = ecoNote(w.name, zone, bare, shielded);
      if (note !== null && shielded - bare > (this.ecoKill?.extra ?? 0)) this.ecoKill = { note, extra: shielded - bare };
    }
  }

  /** The notes to print, armour first. */
  notes(): string[] {
    const out: string[] = [];
    if (this.armour) out.push(this.armour.note);
    if (this.ecoKill) out.push(this.ecoKill.note);
    return out;
  }
}
