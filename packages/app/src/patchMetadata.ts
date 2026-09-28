/**
 * The metadata modal's rules (#563), without the DOM: ids from names, unique
 * display names, category and tag lists drawn from the library, tag
 * normalisation and suggestions, and the loudness warning's volume advice.
 */
import type { LibraryEntry } from '@windsor/engine';
import { PATCH_ID_RULE } from '@windsor/engine';
import { SUGGESTED_HEADROOM } from './libraryConstants';

export type LibraryEntries = Readonly<Record<string, LibraryEntry>>;

/** What the modal collects; the id is derived, never typed. */
export interface PatchMetadata {
  name: string;
  category: string;
  tags: string[];
  description: string;
}

/** A filename slug from a display name: `Bell Lead copy` → `bell-lead-copy`. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return PATCH_ID_RULE.test(slug) ? slug : 'patch';
}

/** `base`, else `base-2`, `base-3`, … — the first id not in `taken`. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Lower-cased, trimmed, empties dropped, first occurrence kept. */
export function normaliseTags(tags: Iterable<string>): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/** Why a display name cannot be used, or null when it can. `ownId` exempts the entry being saved over. */
export function nameProblem(name: string, entries: LibraryEntries, ownId?: string): string | null {
  const clean = name.trim();
  if (!clean) return 'A display name is required.';
  const clash = Object.values(entries).find(
    (entry) => entry.id !== ownId && entry.name.trim().toLowerCase() === clean.toLowerCase(),
  );
  return clash ? `"${clash.name}" is already the name of ${clash.id}.` : null;
}

/** The library's categories, sorted, each once. */
export function categoriesOf(entries: LibraryEntries): string[] {
  return [...new Set(Object.values(entries).map((entry) => entry.category))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** The library's tags, sorted, each once. */
export function tagsOf(entries: LibraryEntries): string[] {
  return [...new Set(Object.values(entries).flatMap((entry) => entry.tags))].sort();
}

/** Library tags starting with what was typed, minus the ones already chosen. */
export function suggestTags(
  entries: LibraryEntries,
  typed: string,
  chosen: readonly string[] = [],
): string[] {
  const prefix = typed.trim().toLowerCase();
  if (!prefix) return [];
  return tagsOf(entries).filter((tag) => tag.startsWith(prefix) && !chosen.includes(tag));
}

/** The metadata of a Copy to new: `<name> copy`, same category, tags and description. */
export function copyMetadata(source: PatchMetadata): PatchMetadata {
  return { ...source, tags: [...source.tags], name: `${source.name} copy` };
}

/** The volume that would bring `peak` to just under the clip line. */
export function suggestedVolume(volume: number, peak: number): number {
  return (volume * SUGGESTED_HEADROOM) / peak;
}
