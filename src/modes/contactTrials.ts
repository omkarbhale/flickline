import { RAD2DEG } from '../core/math';
import { TICK_DT } from '../core/time';
import type { TrialBar, TrialTunables } from '../config/trials';
import type { SkillId } from './contracts';

/**
 * The trial classifier of a Sweep sector (design §3.1, §9.1; #203): it reads the facts of the
 * sector's contacts as the sim reports them and turns each fight into `skillTrial`s for the seven
 * skills. The rules are the issue's, their numbers are data (`config/trials.ts`):
 *
 * | Skill | Item | Success |
 * |---|---|---|
 * | `precision` | first shot at an Echo first seen within `flickMinDeg` of the crosshair (Cold Start's first-bullet rule) | that bullet hits the head |
 * | `flick` | first shot at an Echo first seen further than `flickMinDeg` away (Orbit's must-flick item) | it hits, within the feasible time for the angle (× the dial's slack) |
 * | `track` | a duel with a strafing Echo, from first sight, while it and the player see each other | padded aim on it for the dial's share of the duel |
 * | `footwork` | the player's shots at an Echo that has the player in its sight | none of them a moving shot |
 * | `spray` | a burst of `minBullets` or more with a shot at an Echo | the dial's share of its bullets hit an Echo |
 * | `switch` | a kill with another seen Echo of the contact in sight | the next shot at it hits within the dial's time |
 * | `angles` | a take contact's first sight (once per contact) | pre-aim and head-height errors within the dial's bounds |
 *
 * Bars marked "the dial's" move with the item's difficulty (`config/trials.ts` explains why).
 *
 * A contact the player never saw into (an Echo had them first and they never saw it) is a failed
 * `angles` item, in any sector, so every contact that opens yields at least one trial. A sighted Echo the
 * player never shot at is a failed `precision`/`flick` item only if the contact was lost.
 *
 * Every trial's difficulty is its contact's: the dial its Echoes were placed at plus the card's
 * offset (design §9.1), set by the caller. Pure and deterministic; allocation-free after
 * construction (fixed slots, reused `extra` records). Angles arrive in radians, as the sim emits them.
 */

/**
 * Where trials go (the Sweep mode forwards them to the runner): the contact's index (`addContact`),
 * its item difficulty and card, and the Echo it is about (-1: the contact as a whole). `extra` is
 * reused: copy what you keep.
 */
export interface TrialSink {
  trial(
    contact: number, skill: SkillId, itemDifficulty: number, success: boolean, card: string, targetId: number, extra: Readonly<Record<string, number>>,
  ): void;
}

/** Whether an Echo and the player see each other now (its shooting model is in contact). */
export interface SightQuery {
  inSight(echoId: number): boolean;
}

interface ContactSlot {
  index: number;
  card: string;
  difficulty: number;
  take: boolean;
  anglesDone: boolean;
  /** Id of the Echo whose kill started a pending `switch` item (-1: none) and the tick of that kill. */
  switchFrom: number;
  switchTick: number;
}

interface EchoSlot {
  id: number;
  contact: number;
  strafing: boolean;
  alive: boolean;
  /** Tick the player first saw it (-1: not yet), the crosshair-to-head angle then (degrees) and the flick vector (radians). */
  sightTick: number;
  relocDeg: number;
  flickYaw: number;
  flickPitch: number;
  firstShotDone: boolean;
  duelTicks: number;
  onTicks: number;
  trackDone: boolean;
  footShots: number;
  footMoving: number;
  footDone: boolean;
}

const MAX_CONTACTS = 16;
const MAX_ECHOES = 32;

/** A bar's value at item difficulty `dial` (clamped to 0–100). */
export function barAt(bar: TrialBar, dial: number): number {
  const t = dial <= 0 ? 0 : dial >= 100 ? 1 : dial / 100;
  return bar.at0 + (bar.at100 - bar.at0) * t;
}

function extraOf(keys: readonly string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of keys) o[k] = 0;
  return o;
}

export class ContactTrials {
  private readonly contacts: ContactSlot[] = [];
  private readonly echoes: EchoSlot[] = [];
  private nContacts = 0;
  private nEchoes = 0;
  private aimOnId = -1;
  /** The shot fired last, until its impact (or the end of the tick: a shot into the open has none). */
  private pending = false;
  private pTick = 0;
  private pShotId = -1;
  private pAimId = -1;
  private pAimErrDeg = 0;
  private pMoving = false;
  private pDYaw = 0;
  private pDPitch = 0;
  private pHitId = -1;
  private pHead = false;
  /** The burst in progress: bullets, hits on Echoes, the tick of its last bullet, and the Echo its first shot at an Echo went to. */
  private burstBullets = 0;
  private burstHits = 0;
  private burstLast = 0;
  private burstEcho = -1;
  private readonly x = {
    precision: extraOf(['offsetDeg', 'preAimed', 'errDeg', 'timeSec']),
    flick: extraOf(['flickDeg', 'timeSec', 'limitSec', 'overshootDeg', 'hit']),
    track: extraOf(['duelSec', 'onTargetShare', 'needShare']),
    footwork: extraOf(['shots', 'movingShots']),
    spray: extraOf(['bullets', 'hits', 'needShare']),
    switch: extraOf(['timeSec', 'limitSec', 'hit', 'timedOut']),
    angles: extraOf(['preAimDeg', 'headErrDeg', 'maxPreAimDeg', 'maxHeadDeg', 'seen']),
  };

  constructor(
    private readonly cfg: TrialTunables,
    /** A missed shot is "at" an Echo when the crosshair was within this of its head (`targets.reactionAimDeg`). */
    private readonly shotAtDeg: number,
    private readonly sink: TrialSink,
    private readonly sight: SightQuery,
  ) {
    for (let i = 0; i < MAX_CONTACTS; i++) this.contacts.push({ index: i, card: '', difficulty: 0, take: false, anglesDone: false, switchFrom: -1, switchTick: 0 });
    for (let i = 0; i < MAX_ECHOES; i++) {
      this.echoes.push({
        id: -1, contact: 0, strafing: false, alive: false, sightTick: -1, relocDeg: 0, flickYaw: 0, flickPitch: 0, firstShotDone: false,
        duelTicks: 0, onTicks: 0, trackDone: false, footShots: 0, footMoving: 0, footDone: false,
      });
    }
  }

  /** Forget every contact (a new sector). Call `flush` first so nothing in progress is lost. */
  reset(): void {
    this.nContacts = 0;
    this.nEchoes = 0;
    this.aimOnId = -1;
    this.pending = false;
    this.burstBullets = this.burstHits = 0;
    this.burstEcho = -1;
  }

  /** Register a contact; returns its index (the order of `addContact` calls), -1 when full. */
  addContact(card: string, difficulty: number, take: boolean): number {
    if (this.nContacts >= MAX_CONTACTS) return -1;
    const c = this.contacts[this.nContacts]!;
    c.card = card;
    c.difficulty = difficulty;
    c.take = take;
    c.anglesDone = false;
    c.switchFrom = -1;
    c.switchTick = 0;
    return this.nContacts++;
  }

  /** Register an Echo of `contact` (`strafing`: a Strafer with a lane to strafe along). */
  addEcho(contact: number, id: number, strafing: boolean): void {
    if (contact < 0 || contact >= this.nContacts || id < 0 || this.nEchoes >= MAX_ECHOES) return;
    const e = this.echoes[this.nEchoes++]!;
    e.id = id;
    e.contact = contact;
    e.strafing = strafing;
    e.alive = true;
    e.sightTick = -1;
    e.relocDeg = e.flickYaw = e.flickPitch = 0;
    e.firstShotDone = false;
    e.duelTicks = e.onTicks = 0;
    e.trackDone = false;
    e.footShots = e.footMoving = 0;
    e.footDone = false;
  }

  /** `targetVisible`: the player first saw an Echo (pre-aim error and the flick vector to its head, radians). */
  sighted(tick: number, echoId: number, preAim: number, dYaw: number, dPitch: number): void {
    const e = this.echo(echoId);
    if (!e || e.sightTick >= 0) return;
    e.sightTick = tick;
    e.relocDeg = preAim * RAD2DEG;
    e.flickYaw = dYaw;
    e.flickPitch = dPitch;
    const c = this.contacts[e.contact]!;
    if (!c.take || c.anglesDone) return;
    c.anglesDone = true;
    const x = this.x.angles;
    x.preAimDeg = e.relocDeg;
    x.headErrDeg = Math.abs(dPitch) * RAD2DEG;
    x.seen = 1;
    x.maxPreAimDeg = barAt(this.cfg.angles.maxPreAimDeg, c.difficulty);
    x.maxHeadDeg = barAt(this.cfg.angles.maxHeadDeg, c.difficulty);
    this.emit('angles', c, x.preAimDeg <= x.maxPreAimDeg && x.headErrDeg <= x.maxHeadDeg, echoId, x);
  }

  /** `shotFired` (its stat fields): the crosshair's nearest visible target and the angle to its head, radians. */
  fired(tick: number, shotId: number, aimTargetId: number, aimErr: number, moving: boolean, aimDYaw: number, aimDPitch: number): void {
    if (this.pending) this.resolveShot();
    this.pending = true;
    this.pTick = tick;
    this.pShotId = shotId;
    this.pAimId = aimTargetId;
    this.pAimErrDeg = aimErr * RAD2DEG;
    this.pMoving = moving;
    this.pDYaw = aimDYaw;
    this.pDPitch = aimDPitch;
    this.pHitId = -1;
    this.pHead = false;
  }

  /** `shotImpact` of that shot: the target it struck (-1: none) and the zone. */
  impact(shotId: number, targetId: number, zone: string | null | undefined): void {
    if (!this.pending || shotId !== this.pShotId) return;
    this.pHitId = targetId;
    this.pHead = zone === 'head';
    this.resolveShot();
  }

  /** `aimOnTarget`: the padded aim ray is on target `id` (or on nothing). */
  aimOn(on: boolean, id: number): void {
    this.aimOnId = on ? id : -1;
  }

  /** An Echo died. Its duel trials settle; with another seen Echo of its contact in sight, a `switch` item starts. */
  killed(tick: number, echoId: number): void {
    if (this.pending) this.resolveShot();
    const e = this.echo(echoId);
    if (!e || !e.alive) return;
    e.alive = false;
    this.endDuel(e);
    const c = this.contacts[e.contact]!;
    if (c.switchFrom >= 0) return;
    for (let i = 0; i < this.nEchoes; i++) {
      const o = this.echoes[i]!;
      if (o === e || o.contact !== e.contact || !o.alive || o.sightTick < 0 || !this.sight.inSight(o.id)) continue;
      c.switchFrom = e.id;
      c.switchTick = tick;
      return;
    }
  }

  /** Once per tick, after the sim's step: settle the last shot, end bursts, time duels and switches. */
  step(tick: number): void {
    if (this.pending) this.resolveShot();
    if (this.burstBullets > 0 && (tick - this.burstLast) * TICK_DT > this.cfg.spray.maxGapSec) this.closeBurst();
    for (let i = 0; i < this.nEchoes; i++) {
      const e = this.echoes[i]!;
      if (!e.alive || !e.strafing || e.trackDone || e.sightTick < 0 || !this.sight.inSight(e.id)) continue;
      e.duelTicks++;
      if (this.aimOnId === e.id) e.onTicks++;
    }
    for (let i = 0; i < this.nContacts; i++) {
      const c = this.contacts[i]!;
      if (c.switchFrom < 0) continue;
      const dt = (tick - c.switchTick) * TICK_DT;
      if (dt > barAt(this.cfg.switch.maxSec, c.difficulty)) this.endSwitch(c, false, dt, true);
    }
  }

  /**
   * Contact `index` ended (it may open again later). `lost`: the player died in it or left it hurt.
   * An unseen take contact fails `angles`; a seen Echo never shot at fails its first-shot item when lost.
   */
  settle(index: number, lost: boolean): void {
    if (index < 0 || index >= this.nContacts) return;
    if (this.pending) this.resolveShot();
    const c = this.contacts[index]!;
    if (c.switchFrom >= 0) this.endSwitch(c, false, barAt(this.cfg.switch.maxSec, c.difficulty), true);
    // Caught from an angle the player never saw into: a failed `angles` item, in a take sector or not (a meet's Echo seen
    // only after it shot is the same miss). In a take sector a sighting already decided the item.
    if (!c.anglesDone && !this.seenIn(index)) {
      c.anglesDone = true;
      const x = this.x.angles;
      x.preAimDeg = x.headErrDeg = -1;
      x.maxPreAimDeg = barAt(this.cfg.angles.maxPreAimDeg, c.difficulty);
      x.maxHeadDeg = barAt(this.cfg.angles.maxHeadDeg, c.difficulty);
      x.seen = 0;
      this.emit('angles', c, false, -1, x);
    }
    for (let i = 0; i < this.nEchoes; i++) {
      const e = this.echoes[i]!;
      if (e.contact !== index) continue;
      if (e.alive) this.endDuel(e);
      if (lost && e.sightTick >= 0 && !e.firstShotDone) {
        e.firstShotDone = true;
        this.firstShot(e, c, false, false, -1);
      }
    }
  }

  /** End of the sector (or run): settle the last shot and close the burst in progress. */
  flush(): void {
    if (this.pending) this.resolveShot();
    if (this.burstBullets > 0) this.closeBurst();
  }

  // --- internals ---------------------------------------------------------------------------

  private seenIn(contact: number): boolean {
    for (let i = 0; i < this.nEchoes; i++) {
      const e = this.echoes[i]!;
      if (e.contact === contact && e.sightTick >= 0) return true;
    }
    return false;
  }

  private echo(id: number): EchoSlot | null {
    if (id < 0) return null;
    for (let i = 0; i < this.nEchoes; i++) if (this.echoes[i]!.id === id) return this.echoes[i]!;
    return null;
  }

  private emit(skill: SkillId, c: ContactSlot, success: boolean, targetId: number, extra: Readonly<Record<string, number>>): void {
    this.sink.trial(c.index, skill, c.difficulty, success, c.card, targetId, extra);
  }

  private resolveShot(): void {
    this.pending = false;
    const hit = this.pHitId >= 0 ? this.echo(this.pHitId) : null;
    let at = hit;
    if (!at && this.pAimErrDeg <= this.shotAtDeg) at = this.echo(this.pAimId);

    // Bursts: a gap longer than `maxGapSec` starts a new one.
    if (this.burstBullets > 0 && (this.pTick - this.burstLast) * TICK_DT > this.cfg.spray.maxGapSec) this.closeBurst();
    this.burstBullets++;
    if (hit) this.burstHits++;
    this.burstLast = this.pTick;
    if (at && this.burstEcho < 0) this.burstEcho = at.id;

    if (!at) return;
    const c = this.contacts[at.contact]!;
    const onIt = hit === at;
    if (!at.firstShotDone && at.sightTick >= 0) {
      at.firstShotDone = true;
      this.firstShot(at, c, onIt, onIt && this.pHead, this.pTick);
    }
    if (!at.footDone && this.sight.inSight(at.id)) {
      at.footShots++;
      if (this.pMoving) at.footMoving++;
    }
    if (c.switchFrom >= 0 && at.id !== c.switchFrom) {
      const dt = (this.pTick - c.switchTick) * TICK_DT;
      this.endSwitch(c, onIt && dt <= barAt(this.cfg.switch.maxSec, c.difficulty), dt, false);
    }
  }

  /** The first-shot item of an Echo: `flick` when it was first seen far off the crosshair, else `precision`. `tick` -1: never shot. */
  private firstShot(e: EchoSlot, c: ContactSlot, hit: boolean, head: boolean, tick: number): void {
    const timeSec = tick >= 0 ? (tick - e.sightTick) * TICK_DT : -1;
    if (e.relocDeg > this.cfg.flickMinDeg) {
      const x = this.x.flick;
      const f = this.cfg.flick;
      const limit = (f.baseSec + f.perDegSec * e.relocDeg) * barAt(f.slack, c.difficulty);
      x.flickDeg = e.relocDeg;
      x.timeSec = timeSec;
      x.limitSec = limit;
      x.hit = hit ? 1 : 0;
      // Signed overshoot along the flick (design §3.2): the crosshair's offset from the head at the shot, projected on the flick vector.
      const len = Math.sqrt(e.flickYaw * e.flickYaw + e.flickPitch * e.flickPitch);
      x.overshootDeg = tick >= 0 && this.pAimId === e.id && len > 1e-9 ? (-(this.pDYaw * e.flickYaw + this.pDPitch * e.flickPitch) / len) * RAD2DEG : 0;
      this.emit('flick', c, hit && timeSec >= 0 && timeSec <= limit, e.id, x);
      return;
    }
    const x = this.x.precision;
    x.offsetDeg = e.relocDeg;
    x.preAimed = e.relocDeg <= this.cfg.preAimedDeg ? 1 : 0;
    x.errDeg = tick >= 0 && this.pAimId === e.id ? this.pAimErrDeg : -1;
    x.timeSec = timeSec;
    this.emit('precision', c, head, e.id, x);
  }

  /** A duel with an Echo is over (it died, or its contact settled): its `track` and `footwork` items. */
  private endDuel(e: EchoSlot): void {
    const c = this.contacts[e.contact]!;
    const duelSec = e.duelTicks * TICK_DT;
    if (!e.trackDone && e.strafing && duelSec >= this.cfg.track.minDuelSec) {
      e.trackDone = true;
      const x = this.x.track;
      x.duelSec = duelSec;
      x.onTargetShare = e.onTicks / e.duelTicks;
      x.needShare = barAt(this.cfg.track.onTargetShare, c.difficulty);
      this.emit('track', c, x.onTargetShare >= x.needShare, e.id, x);
    }
    if (!e.footDone && e.footShots > 0) {
      e.footDone = true;
      const x = this.x.footwork;
      x.shots = e.footShots;
      x.movingShots = e.footMoving;
      this.emit('footwork', c, e.footMoving === 0, e.id, x);
    }
  }

  private endSwitch(c: ContactSlot, success: boolean, timeSec: number, timedOut: boolean): void {
    const x = this.x.switch;
    x.timeSec = timeSec;
    x.limitSec = barAt(this.cfg.switch.maxSec, c.difficulty);
    x.hit = success ? 1 : 0;
    x.timedOut = timedOut ? 1 : 0;
    const from = c.switchFrom;
    c.switchFrom = -1;
    this.emit('switch', c, success, from, x);
  }

  private closeBurst(): void {
    const n = this.burstBullets;
    const hits = this.burstHits;
    const echoId = this.burstEcho;
    this.burstBullets = this.burstHits = 0;
    this.burstEcho = -1;
    if (n < this.cfg.spray.minBullets || echoId < 0) return;
    const e = this.echo(echoId);
    if (!e) return;
    const c = this.contacts[e.contact]!;
    const x = this.x.spray;
    x.bullets = n;
    x.hits = hits;
    x.needShare = barAt(this.cfg.spray.hitShare, c.difficulty);
    this.emit('spray', c, hits / n >= x.needShare, echoId, x);
  }
}
