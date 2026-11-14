import { css } from '../config/palette';

/**
 * The faces of a gate's doors (design §4.5): what a door says about the sector behind it, drawn in
 * Flickline's own visual language: trim-line glyphs (strokes of light on a dark panel), one short
 * word beside each, never a sentence. Four rows, top to bottom: the sector's **role**, its
 * **sightline** (a cone: long and thin, or short and wide against a wall), what is **heard** through
 * the door (footsteps) and the **stake**. Canvas 2D, drawn once when a gate is entered (never per frame).
 *
 * The stake's colour is one of the palette's accents but never the only signal: each stake has its own
 * shape and its own word, so no row depends on hue (design §11, colour-vision rules).
 */

/** What a door says (structurally the director's `DoorFacts`: render does not import the run director). */
export interface DoorFacts {
  readonly role: 'take' | 'hold' | 'meet';
  readonly sightline: 'long' | 'close';
  readonly heard: 'quiet' | 'few' | 'several';
  readonly stake: 'shield' | 'arms' | 'hot' | 'plain';
  readonly arms?: string;
  /** The sector's economy (design 4.6): a light or eco sector is announced on its door. */
  readonly condition?: 'full' | 'light' | 'eco';
  /** An Overtime door (design 4.7, #206): which Overtime sector it leads to (1 = the first) and its depth multiplier; announced in the header band. */
  readonly overtime?: { readonly k: number; readonly mult: number };
}

/** What a Leave door says (design 4.7, #206): the run ends and what it banks. */
export interface LeaveFacts {
  /** The run's score, final once it leaves. */
  readonly score: number;
  /** The part of it earned in Overtime and never banked until now (0: leaving straight after the Finale). */
  readonly overtimePoints: number;
}

export const FACE_W = 512;
export const FACE_H = 640;
const ROW_H = 140;
const TOP = 74;
const ICON_X = 100;
const TEXT_X = 188;
const FONT = "'Barlow', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const ROLE_WORD = { take: 'TAKE', hold: 'HOLD', meet: 'MEET' } as const;
const ROLE_SUB = { take: 'you move in', hold: 'they move in', meet: 'both move' } as const;
const SIGHT_WORD = { long: 'LONG', close: 'CLOSE' } as const;
const SIGHT_SUB = { long: 'far angles', close: 'short angles' } as const;
const HEARD_WORD = { quiet: 'QUIET', few: '1–2', several: 'SEVERAL' } as const;
const HEARD_SUB = { quiet: 'no steps', few: 'steps ahead', several: 'many steps' } as const;

/** Words and colours of a stake. `arms` names the weapon. */
export function stakeLabel(f: DoorFacts, shieldTo: number, hotMult: number, hotExtra: number): { word: string; sub: string; colour: string } {
  switch (f.stake) {
    case 'shield': return { word: 'SHIELD', sub: `refill to ${shieldTo}`, colour: css.trim };
    case 'arms': return { word: 'ARMS', sub: (f.arms ?? '').toUpperCase(), colour: css.gold };
    case 'hot': return { word: 'HOT', sub: `×${hotMult} · +${hotExtra} fight${hotExtra === 1 ? '' : 's'}`, colour: css.ember };
    default: return { word: 'PLAIN', sub: 'no stake', colour: css.core };
  }
}

function stroke(g: CanvasRenderingContext2D, colour: string, w = 8): void {
  g.strokeStyle = colour;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.fillStyle = colour;
}

function arrow(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  const a = Math.atan2(y1 - y0, x1 - x0);
  for (const s of [-1, 1]) {
    g.moveTo(x1, y1);
    g.lineTo(x1 - Math.cos(a + s * 0.6) * 18, y1 - Math.sin(a + s * 0.6) * 18);
  }
  g.stroke();
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function roleGlyph(g: CanvasRenderingContext2D, role: DoorFacts['role'], cx: number, cy: number): void {
  if (role === 'take') {
    // An arrow walking into a bracket: the player moves in.
    arrow(g, cx - 46, cy, cx + 12, cy);
    g.beginPath();
    g.moveTo(cx + 24, cy - 36);
    g.lineTo(cx + 44, cy - 36);
    g.lineTo(cx + 44, cy + 36);
    g.lineTo(cx + 24, cy + 36);
    g.stroke();
  } else if (role === 'hold') {
    // Two arrows closing on a dot: they come to you.
    dot(g, cx, cy, 9);
    arrow(g, cx - 50, cy - 30, cx - 16, cy - 8);
    arrow(g, cx + 50, cy - 30, cx + 16, cy - 8);
    arrow(g, cx, cy + 44, cx, cy + 16);
  } else {
    // Two arrows past each other: both sides move.
    arrow(g, cx - 46, cy - 16, cx + 46, cy - 16);
    arrow(g, cx + 46, cy + 16, cx - 46, cy + 16);
  }
}

/** Sightline: the player's dot and the cone of what they see down the sector: long and thin, or short and wide against a wall. */
function sightGlyph(g: CanvasRenderingContext2D, sight: DoorFacts['sightline'], cx: number, cy: number): void {
  const x0 = cx - 50;
  dot(g, x0, cy, 8);
  const len = sight === 'long' ? 100 : 44;
  const half = sight === 'long' ? 11 : 30;
  g.beginPath();
  g.moveTo(x0 + 8, cy);
  g.lineTo(x0 + 8 + len, cy - half);
  g.lineTo(x0 + 8 + len, cy + half);
  g.closePath();
  g.stroke();
  if (sight === 'close') {
    // The wall that closes it.
    g.beginPath();
    g.moveTo(x0 + 14 + len, cy - 40);
    g.lineTo(x0 + 14 + len, cy + 40);
    g.stroke();
  } else {
    g.globalAlpha *= 0.4;
    g.beginPath();
    g.moveTo(x0 + 14 + len, cy - 14);
    g.lineTo(x0 + 14 + len + 10, cy - 14);
    g.moveTo(x0 + 14 + len, cy + 14);
    g.lineTo(x0 + 14 + len + 10, cy + 14);
    g.stroke();
    g.globalAlpha /= 0.4;
  }
}

/** Heard: footstep marks, none / a pair / a crowd. */
function heardGlyph(g: CanvasRenderingContext2D, heard: DoorFacts['heard'], cx: number, cy: number): void {
  const step = (x: number, y: number, a: number): void => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.ellipse(0, 0, 7, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  if (heard === 'quiet') {
    g.beginPath();
    g.arc(cx, cy, 32, 0, Math.PI * 2);
    g.moveTo(cx - 22, cy + 22);
    g.lineTo(cx + 22, cy - 22);
    g.stroke();
  } else if (heard === 'few') {
    step(cx - 14, cy + 20, -0.2);
    step(cx + 14, cy - 20, 0.2);
  } else {
    step(cx - 36, cy + 24, -0.25);
    step(cx - 12, cy - 6, 0.2);
    step(cx + 12, cy + 24, -0.2);
    step(cx + 34, cy - 6, 0.25);
    step(cx + 6, cy - 34, 0.1);
  }
}

function stakeGlyph(g: CanvasRenderingContext2D, stake: DoorFacts['stake'], cx: number, cy: number): void {
  g.beginPath();
  if (stake === 'shield') {
    g.moveTo(cx, cy - 42);
    g.lineTo(cx + 34, cy - 28);
    g.lineTo(cx + 30, cy + 10);
    g.quadraticCurveTo(cx + 22, cy + 32, cx, cy + 44);
    g.quadraticCurveTo(cx - 22, cy + 32, cx - 30, cy + 10);
    g.lineTo(cx - 34, cy - 28);
    g.closePath();
    g.stroke();
  } else if (stake === 'arms') {
    // A long gun in profile: barrel, body, grip, magazine.
    g.moveTo(cx - 52, cy - 8);
    g.lineTo(cx + 40, cy - 8);
    g.lineTo(cx + 40, cy + 6);
    g.lineTo(cx - 6, cy + 6);
    g.lineTo(cx - 12, cy + 38);
    g.lineTo(cx - 28, cy + 38);
    g.lineTo(cx - 22, cy + 6);
    g.lineTo(cx - 52, cy + 6);
    g.closePath();
    g.stroke();
  } else if (stake === 'hot') {
    // A flame.
    g.moveTo(cx, cy - 46);
    g.quadraticCurveTo(cx + 40, cy - 6, cx + 30, cy + 22);
    g.quadraticCurveTo(cx + 22, cy + 46, cx, cy + 46);
    g.quadraticCurveTo(cx - 24, cy + 46, cx - 30, cy + 20);
    g.quadraticCurveTo(cx - 34, cy - 4, cx - 10, cy - 22);
    g.quadraticCurveTo(cx - 8, cy - 6, cx, cy + 2);
    g.quadraticCurveTo(cx + 8, cy - 14, cx, cy - 46);
    g.closePath();
    g.stroke();
  } else {
    g.arc(cx, cy, 30, 0, Math.PI * 2);
    g.stroke();
  }
}

/**
 * Draw one door's face. `shieldTo`, `hotMult` and `hotExtra` come from the gate tunables, so the
 * words on the door are the numbers the sector applies.
 */
export function drawDoorFace(
  g: CanvasRenderingContext2D, facts: DoorFacts, opts: { shieldTo: number; hotMult: number; hotExtra: number; conditionTitles?: Readonly<Record<'light' | 'eco', string>> },
): void {
  g.clearRect(0, 0, FACE_W, FACE_H);
  // The panel: dark glass with a thin trim line round it.
  g.fillStyle = 'rgba(11,13,20,0.82)';
  g.beginPath();
  g.roundRect(8, 8, FACE_W - 16, FACE_H - 16, 26);
  g.fill();
  stroke(g, css.trim, 4);
  g.globalAlpha = 0.9;
  g.stroke();
  g.globalAlpha = 1;

  // The header band: an Overtime sector (design 4.7), a light or eco sector is announced here (a full sector says nothing, design 4.6).
  if (facts.overtime) {
    const text = `OVERTIME ${facts.overtime.k} \u00b7 \u00d7${facts.overtime.mult.toFixed(1)}`;
    stroke(g, css.gold, 4);
    g.beginPath();
    g.roundRect(30, 26, FACE_W - 60, 44, 12);
    g.stroke();
    g.fillStyle = css.gold;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `700 32px ${FONT}`;
    g.fillText(text, FACE_W / 2, 58);
    g.textAlign = 'left';
  } else if (facts.condition === 'light' || facts.condition === 'eco') {
    const title = (opts.conditionTitles?.[facts.condition] ?? facts.condition).toUpperCase();
    const colour = facts.condition === 'eco' ? css.alert : css.warn;
    stroke(g, colour, 4);
    g.beginPath();
    g.roundRect(30, 26, FACE_W - 60, 44, 12);
    g.stroke();
    g.fillStyle = colour;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `700 32px ${FONT}`;
    g.fillText(title, FACE_W / 2, 58);
    g.textAlign = 'left';
  }
  const stake = stakeLabel(facts, opts.shieldTo, opts.hotMult, opts.hotExtra);
  const rows: { colour: string; word: string; sub: string; glyph: (cx: number, cy: number) => void }[] = [
    { colour: css.trim, word: ROLE_WORD[facts.role], sub: ROLE_SUB[facts.role], glyph: (x, y) => roleGlyph(g, facts.role, x, y) },
    { colour: css.trim, word: SIGHT_WORD[facts.sightline], sub: SIGHT_SUB[facts.sightline], glyph: (x, y) => sightGlyph(g, facts.sightline, x, y) },
    { colour: css.trim, word: HEARD_WORD[facts.heard], sub: HEARD_SUB[facts.heard], glyph: (x, y) => heardGlyph(g, facts.heard, x, y) },
    { colour: stake.colour, word: stake.word, sub: stake.sub, glyph: (x, y) => stakeGlyph(g, facts.stake, x, y) },
  ];
  rows.forEach((row, i) => {
    const y0 = TOP + i * ROW_H;
    const cy = y0 + ROW_H / 2 - 6;
    if (i > 0) {
      g.globalAlpha = 0.25;
      stroke(g, css.trim, 2);
      g.beginPath();
      g.moveTo(34, y0 - 2);
      g.lineTo(FACE_W - 34, y0 - 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    stroke(g, row.colour, 8);
    row.glyph(ICON_X, cy);
    g.fillStyle = row.colour;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = `700 ${row.word.length > 6 ? 62 : 76}px ${FONT}`;
    g.fillText(row.word, TEXT_X, cy + 12);
    g.globalAlpha = 0.78;
    g.fillStyle = css.core;
    g.font = `500 38px ${FONT}`;
    g.fillText(row.sub, TEXT_X, cy + 52);
    g.globalAlpha = 1;
  });
}

/** Thousands-separated whole number ("12,340"), the way the HUD and the results card write a score. */
function thousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** An exit: an arrow leaving through a bracket. */
function leaveGlyph(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.beginPath();
  g.moveTo(cx - 8, cy - 40);
  g.lineTo(cx - 40, cy - 40);
  g.lineTo(cx - 40, cy + 40);
  g.lineTo(cx - 8, cy + 40);
  g.stroke();
  arrow(g, cx - 22, cy, cx + 46, cy);
}

/** A vault: a lock body with its shackle. */
function bankGlyph(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.beginPath();
  g.roundRect(cx - 34, cy - 6, 68, 50, 8);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy - 6, 22, Math.PI, 0);
  g.stroke();
  dot(g, cx, cy + 20, 6);
}

/** A tick: it is kept. */
function keptGlyph(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.beginPath();
  g.moveTo(cx - 36, cy + 4);
  g.lineTo(cx - 10, cy + 30);
  g.lineTo(cx + 38, cy - 30);
  g.stroke();
}

/**
 * The face of an Overtime gate's Leave door (design 4.7, #206): the run ends and every point is banked. Three rows in the same
 * trim-line language as a sector's face: **LEAVE** (the run ends), the score it banks, and what Overtime added to it.
 */
export function drawLeaveFace(g: CanvasRenderingContext2D, facts: LeaveFacts): void {
  g.clearRect(0, 0, FACE_W, FACE_H);
  g.fillStyle = 'rgba(11,13,20,0.82)';
  g.beginPath();
  g.roundRect(8, 8, FACE_W - 16, FACE_H - 16, 26);
  g.fill();
  stroke(g, css.gold, 4);
  g.globalAlpha = 0.9;
  g.stroke();
  g.globalAlpha = 1;
  const at = facts.overtimePoints > 0;
  const rows: { colour: string; word: string; sub: string; glyph: (cx: number, cy: number) => void }[] = [
    { colour: css.gold, word: 'LEAVE', sub: 'the run ends', glyph: (x, y) => leaveGlyph(g, x, y) },
    { colour: css.core, word: thousands(facts.score), sub: 'banked', glyph: (x, y) => bankGlyph(g, x, y) },
    { colour: at ? css.gold : css.core, word: at ? `+${thousands(facts.overtimePoints)}` : 'NONE', sub: at ? 'from Overtime, kept' : 'at risk', glyph: (x, y) => keptGlyph(g, x, y) },
  ];
  rows.forEach((row, i) => {
    const y0 = TOP + i * ROW_H;
    const cy = y0 + ROW_H / 2 - 6;
    if (i > 0) {
      g.globalAlpha = 0.25;
      stroke(g, css.gold, 2);
      g.beginPath();
      g.moveTo(34, y0 - 2);
      g.lineTo(FACE_W - 34, y0 - 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    stroke(g, row.colour, 8);
    row.glyph(ICON_X, cy);
    g.fillStyle = row.colour;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = `700 ${row.word.length > 6 ? 62 : 76}px ${FONT}`;
    g.fillText(row.word, TEXT_X, cy + 12);
    g.globalAlpha = 0.78;
    g.fillStyle = css.core;
    g.font = `500 38px ${FONT}`;
    g.fillText(row.sub, TEXT_X, cy + 52);
    g.globalAlpha = 1;
  });
  // The fourth row's place: the way on is the other door.
  g.globalAlpha = 0.6;
  g.fillStyle = css.core;
  g.textAlign = 'center';
  g.font = `500 34px ${FONT}`;
  g.fillText('or push on: the other door', FACE_W / 2, TOP + 3 * ROW_H + 70);
  g.textAlign = 'left';
  g.globalAlpha = 1;
}
