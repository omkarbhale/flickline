/**
 * Icons: original inline SVG on a 24 x 24 grid, drawn as strokes in `currentColor` so they follow
 * the text colour and cost no request. The set shares the wordmark's motif, a line that ends in a
 * dot. Decorative by default (`aria-hidden`); the control that holds an icon carries the label.
 */
export const ICON_PATHS = {
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  resume: '<path d="M8 5.5v13l10.5-6.5z"/>',
  restart: '<path d="M19 12a7 7 0 1 1-2.4-5.3"/><path d="M19.5 4.5v4.2h-4.2"/>',
  settings: '<path d="M4 7h9"/><circle cx="17" cy="7" r="1.8"/><path d="M4 12h3"/><circle cx="11" cy="12" r="1.8"/><path d="M15 12h5"/><path d="M4 17h12"/><circle cx="19.5" cy="17" r="1.8"/>',
  menu: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  skip: '<path d="M6 5.5v13l8-6.5z"/><path d="M18 5.5v13"/>',
  back: '<path d="M19 12H6"/><path d="M11 6.5 5.5 12l5.5 5.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  // Skills (design section 3): one glyph each.
  precision: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  flick: '<path d="M4 17c1.5-6 6-9.5 12-9.5"/><path d="m13 4.5 3.5 3-3 3.5"/><circle cx="19.5" cy="7.5" r="1.4"/>',
  track: '<path d="M3 15c3-7 5-7 8 0s5 7 8 0"/><circle cx="20" cy="15" r="1.4"/>',
  footwork: '<path d="M7 20V9.5a2.5 2.5 0 0 1 5 0V20"/><path d="M12 20v-6.5a2.5 2.5 0 0 1 5 0V20"/><path d="M5 20h14"/>',
  spray: '<path d="M4 20 12 4"/><path d="M4 20 18 7"/><path d="M4 20l16-3"/><circle cx="12" cy="4" r="1.2"/><circle cx="18" cy="7" r="1.2"/><circle cx="20" cy="17" r="1.2"/>',
  switch: '<circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M9 9.5c2-2 4-2 6 0"/><path d="M15 14.5c-2 2-4 2-6 0"/>',
  angles: '<path d="M5 20V5h15"/><path d="M5 12h7"/><circle cx="18" cy="5" r="1.4"/>',
  line: '<path d="M3 12h15"/><circle cx="20.5" cy="12" r="1.7"/><path d="M6 7.5h5M6 16.5h5"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** The SVG markup of an icon at `size` px (square). */
export function icon(name: IconName, size = 20): string {
  return `<svg class="fl-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}
