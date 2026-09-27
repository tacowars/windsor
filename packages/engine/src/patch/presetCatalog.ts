/**
 * Browser metadata is separate from Patch: no DSP or document-schema changes.
 * Since #561 the metadata is each library file's own `category`, `tags` and
 * `description`; this module carries the metadata and the browser's filter.
 * The listing itself is the console's `libraryModel.listLibrary` over
 * whichever library it has open (#620 retired the duplicate here).
 */
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
