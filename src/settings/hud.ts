import { hud as hudTunables } from '../config/hud';
import { clamp } from '../core/math';

/**
 * HUD settings (design §13.1, §13.3): per-element visibility and a global scale. The ids are the
 * `data-el` names of `hud/liveHud.ts`; the stat strip items are individually toggleable (§7.2).
 */
export const HUD_ELEMENTS = [
  'timer', 'score', 'multiplier', 'chain', 'streak', 'ghost',
  'acc', 'hs', 'rt', 'ttk', 'moving',
  'edge', 'hp', 'ammo',
] as const;
export type HudElementId = (typeof HUD_ELEMENTS)[number];

export interface HudSettings {
  /** Scales every cluster about its screen anchor (1 = designed size). */
  scale: number;
  show: Record<HudElementId, boolean>;
}

export const HUD_LABELS: Readonly<Record<HudElementId, string>> = {
  timer: 'Timer', score: 'Score', multiplier: 'Multiplier', chain: 'Chain', streak: 'Streak ring', ghost: 'Ghost-pace bar',
  acc: 'Accuracy', hs: 'Headshot rate', rt: 'Median RT', ttk: 'Median TTK', moving: 'Moving shots',
  edge: 'Edge meter', hp: 'Health', ammo: 'Ammo',
};

export function defaultHudSettings(): HudSettings {
  const show = {} as Record<HudElementId, boolean>;
  for (const id of HUD_ELEMENTS) show[id] = true;
  return { scale: 1, show };
}

export const DEFAULT_HUD: HudSettings = defaultHudSettings();

export function cloneHud(h: Readonly<HudSettings>): HudSettings {
  return { scale: h.scale, show: { ...h.show } };
}

/** Validate arbitrary input into a full, safe `HudSettings`. Unknown keys are dropped; missing ones default. */
export function sanitizeHud(raw: unknown): HudSettings {
  const out = defaultHudSettings();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as { scale?: unknown; show?: unknown };
  if (typeof r.scale === 'number' && Number.isFinite(r.scale)) out.scale = clamp(r.scale, hudTunables.scaleMin, hudTunables.scaleMax);
  if (typeof r.show === 'object' && r.show !== null) {
    const s = r.show as Record<string, unknown>;
    for (const id of HUD_ELEMENTS) if (typeof s[id] === 'boolean') out.show[id] = s[id] as boolean;
  }
  return out;
}

export function hudEquals(a: Readonly<HudSettings>, b: Readonly<HudSettings>): boolean {
  if (a.scale !== b.scale) return false;
  for (const id of HUD_ELEMENTS) if (a.show[id] !== b.show[id]) return false;
  return true;
}
