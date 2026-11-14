/** The raw-input line under the sensitivity fields. */
export function rawInputText(on: boolean | null, requested: boolean): string {
  if (on === null) return requested ? 'Raw input: requested when you click play' : 'Raw input: off (turned off in settings)';
  if (on) return 'Raw input: on';
  return requested
    ? 'Raw input: off (this browser cannot disable mouse acceleration; turn off "Enhance pointer precision" in your OS)'
    : 'Raw input: off (turned off in settings)';
}

