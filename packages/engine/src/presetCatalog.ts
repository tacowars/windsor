/**
 * Browser metadata is separate from Patch: no DSP or document-schema changes.
 * Since #561 the metadata is each library file's own `category`, `tags` and
 * `description`; this module only lists and filters.
 */
import type { Patch } from './patch';
import { PATCH_LIBRARY, PRESETS } from './presets';

export interface PresetMetadata {
  category: string;
  tags: readonly string[];
  description: string;
}
export interface PresetListing extends PresetMetadata {
  id: string;
  name: string;
  source: 'document' | 'built-in';
}

/** The four legacy gameplay sounds keep this category; the browser hides it unless asked. */
export const HIDDEN_CATEGORY = 'Legacy game FX';

export const PRESET_CATALOG: Record<string, PresetMetadata> = Object.fromEntries(
  Object.values(PATCH_LIBRARY).map(({ id, category, tags, description }) => [
    id,
    { category, tags, description },
  ]),
);

/** Document copies shadow factory entries, including when their IDs match. */
export function listPresets(documentPatches: Record<string, Patch> = {}): PresetListing[] {
  const ids = [...new Set([...Object.keys(documentPatches), ...Object.keys(PRESETS)])];
  return ids
    .map((id): PresetListing => {
      const documentPatch = Object.hasOwn(documentPatches, id) ? documentPatches[id] : undefined;
      const patch = documentPatch ?? PRESETS[id];
      const metadata = Object.hasOwn(PRESET_CATALOG, id) ? PRESET_CATALOG[id] : undefined;
      return {
        id,
        name: patch?.name ?? id,
        source: documentPatch ? 'document' : 'built-in',
        category: metadata?.category ?? 'Uncategorized',
        tags: metadata?.tags ?? [],
        description: documentPatch
          ? 'Saved in this song. ' + (metadata?.description ?? 'Your custom patch.')
          : (metadata?.description ?? ''),
      };
    })
    .sort(
      (a, b) =>
        Number(b.source === 'document') - Number(a.source === 'document') ||
        a.name.localeCompare(b.name),
    );
}

export interface PresetFilter {
  query: string;
  category: string;
  tag: string;
  source: string;
}
export function filterPresets(
  entries: readonly PresetListing[],
  filter: PresetFilter,
): PresetListing[] {
  const words = filter.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filter.category ? entry.category !== filter.category : entry.category === HIDDEN_CATEGORY)
      return false;
    if (filter.tag && !entry.tags.includes(filter.tag)) return false;
    if (filter.source && entry.source !== filter.source) return false;
    const text = [entry.id, entry.name, entry.category, ...entry.tags, entry.description]
      .join(' ')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
