/**
 * A generic part takes its name from its patch (windsor#103): a part still
 * called `Part <slot + 1>` (or with no name) is renamed to the first
 * `PART_AUTO_NAME_LENGTH` graphemes of the first patch it is given, and a
 * song opened with such a part already playing a patch is renamed the same
 * way. Pure: the patch-assignment and song-load paths call it and send what
 * it returns through the same document write a typed rename takes. A name the
 * user typed is never generic, so it is never touched; neither is a part on
 * its Init sentinel, which has no patch chosen yet.
 */
import type { ArrangementDocument, DocumentPartial } from '@windsor/engine';
import { isInitPreset } from './libraryConstants';
import { PART_AUTO_NAME_LENGTH, partLabelFor } from './songConstants';

/** True when `name` is the default the part on `slot` was given, or empty. */
export function isGenericPartName(name: string, slot: number): boolean {
  return name.trim() === '' || name === partLabelFor(slot);
}

/** The first `length` graphemes of `patchName`, whitespace trimmed; null when nothing is left. */
export function autoName(patchName: string, length = PART_AUTO_NAME_LENGTH): string | null {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const head = [...segmenter.segment(patchName.trim())]
    .slice(0, length)
    .map((grapheme) => grapheme.segment)
    .join('')
    .trim();
  return head === '' ? null : head;
}

/** A part and what it is being given: its slot and name, the preset id, and that patch's name. */
export interface AutoNameInput {
  slot: number;
  name: string;
  preset: string;
  patchName: string | undefined;
}

/** The part's new name, or null when it keeps its own. */
export function autoPartName(input: AutoNameInput, length = PART_AUTO_NAME_LENGTH): string | null {
  if (!isGenericPartName(input.name, input.slot)) return null;
  if (isInitPreset(input.preset) || input.patchName === undefined) return null;
  return autoName(input.patchName, length);
}

/**
 * The part fields a patch assignment writes: `{ preset }`, plus `{ name }`
 * when the part on `slot` is generic and the patch names it. The caller puts
 * them in the assignment's own `partChange`, so the rename is the same edit.
 */
export function assignPatchFields(
  doc: Pick<ArrangementDocument, 'parts'>,
  slot: number,
  preset: string,
  patchName: string | undefined,
): Record<string, unknown> {
  const part = doc.parts.find((candidate) => candidate.slot === slot);
  const name = part ? autoPartName({ slot, name: part.name, preset, patchName }) : null;
  return name === null ? { preset } : { preset, name };
}

/**
 * The renames a song needs as it opens: every generic part already playing a
 * patch the document carries, by slot. Null when nothing changes.
 */
export function loadRenames(
  doc: Pick<ArrangementDocument, 'parts' | 'patches'>,
): DocumentPartial | null {
  const parts: Record<number, { name: string }> = {};
  for (const part of doc.parts) {
    const patch = doc.patches?.[part.preset];
    const name = autoPartName({
      slot: part.slot,
      name: part.name,
      preset: part.preset,
      patchName: patch?.name,
    });
    if (name !== null) parts[part.slot] = { name };
  }
  return Object.keys(parts).length > 0 ? ({ parts } as DocumentPartial) : null;
}

/**
 * The import report as the song ends up (windsor#114): a malformed name is
 * reported as falling back to `Part <slot + 1>`, and when the load-time rename
 * then names that part after its patch, the line says so instead of claiming
 * the fallback. Every other line, and a clean generic import's report, is
 * returned as it came.
 */
export function reportFinalPartNames(
  corrections: readonly string[],
  doc: Pick<ArrangementDocument, 'parts'>,
): string[] {
  const renamed = new Map<string, string>();
  for (const part of doc.parts) {
    const fallback = partLabelFor(part.slot);
    if (part.name !== fallback) renamed.set(`is not a name — using "${fallback}"`, part.name);
  }
  return corrections.map((line) => {
    for (const [ending, name] of renamed) {
      if (line.endsWith(ending)) {
        return `${line.slice(0, -ending.length)}is not a name — named after its patch: "${name}"`;
      }
    }
    return line;
  });
}
