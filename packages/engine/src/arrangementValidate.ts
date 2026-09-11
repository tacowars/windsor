/**
 * What a merged arrangement must satisfy before `ArrangementPlayer` commits
 * it: a positive tempo, a preset every part can resolve, no part renamed
 * live, and finite notes and holds. Throws — the player turns the throw into
 * `ApplyResult.error`, and a merged arrangement that fails here changes
 * nothing. The normaliser (`arrangementDocument.ts`) is what makes a
 * *committed* document satisfy this by construction; this is the guard for
 * what a live partial produces.
 */
import type { Arrangement, MusicPartId } from './arrangement';
import { MUSIC_PART_IDS } from './arrangement';
import type { Patch } from './patch';

/** The preset table a part name resolves against: the document's patches over the code's. */
export type PresetTable = Readonly<Record<string, Patch>>;

export function presetFor(presets: PresetTable, id: MusicPartId, name: string): Patch {
  const preset = presets[name];
  if (!preset) throw new Error(`${id}: unknown audio preset "${name}"`);
  return preset;
}

export function validateArrangement(
  next: Arrangement,
  previous: Arrangement | null,
  presets: PresetTable,
): void {
  if (!Number.isFinite(next.bpm) || next.bpm <= 0) {
    throw new RangeError(`bpm must be a positive number, got ${next.bpm}`);
  }
  for (const id of MUSIC_PART_IDS) {
    const section = next[id];
    if (!section) continue;
    presetFor(presets, id, section.preset);
    const before = previous?.[id];
    if (previous && before && section.part !== before.part) {
      throw new Error(`${id}: a part cannot be renamed live ("${before.part}")`);
    }
    if (!Number.isFinite(section.velocity) || section.velocity < 0) {
      throw new RangeError(`${id}: velocity must be >= 0, got ${section.velocity}`);
    }
  }
  for (const id of ['kick', 'hat'] as const) {
    const section = next[id];
    if (!section) continue;
    const { note, hold } = section;
    if (!Number.isFinite(note)) throw new RangeError(`${id}: note must be finite, got ${note}`);
    if (!Number.isFinite(hold) || hold <= 0) {
      throw new RangeError(`${id}: hold must be > 0 seconds, got ${hold}`);
    }
  }
}
