/**
 * The single source of tunable numbers, as an open registry composed by type. Each area keeps its
 * values in its own `config/<area>.ts` and adds them itself, so a new area never edits this file:
 *
 *   export const tunableGroups = { run };          // the runtime values
 *   type Groups = typeof tunableGroups;
 *   declare module './tunables' {
 *     interface Tunables extends Groups {}         // the type, derived from the same object
 *   }
 *
 * This module composes every `config/*.ts` that exports `tunableGroups` (Vite's eager glob: plain
 * static imports, resolved at build time). Gameplay numbers never live inline in code. The sim
 * receives a Tunables object by injection (see sim/world.ts), tests pass their own.
 */
export interface Tunables {}

type GroupModule = { tunableGroups?: Record<string, unknown> };

/** Merge each file's groups into one object; two files claiming one key is a startup error. */
export function composeTunables(modules: Record<string, GroupModule>): Tunables {
  const out: Record<string, unknown> = {};
  const owner: Record<string, string> = {};
  for (const file of Object.keys(modules).sort()) {
    const groups = modules[file]!.tunableGroups;
    if (!groups) continue;
    for (const key of Object.keys(groups)) {
      if (key in out) throw new Error(`tunable group '${key}' is declared by both ${owner[key]} and ${file}`);
      out[key] = groups[key];
      owner[key] = file;
    }
  }
  return out as unknown as Tunables;
}

/** Live, mutable instance. Only the debug hook and settings UI may mutate it at runtime. */
export const tunables: Tunables = composeTunables(
  import.meta.glob<GroupModule>(['./*.ts', '!./tunables.ts', '!./*.test.ts'], { eager: true }),
);

/** Deep copy for tests and what-if runs (tunables are JSON-safe plain data). */
export function cloneTunables(t: Tunables = tunables): Tunables {
  return JSON.parse(JSON.stringify(t)) as Tunables;
}
