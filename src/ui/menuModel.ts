/** `sweep` -> `Sweep`, `someMode` -> `Some mode`: the name a registered mode goes by in the pause title and the difficulty pin. */
export function titleFromId(id: string): string {
  const spaced = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
  return spaced.length === 0 ? id : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
