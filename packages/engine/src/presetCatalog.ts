/** Browser metadata is separate from Patch: no DSP or document-schema changes. */
import type { Patch } from './patch';
import { PRESETS } from './presets';
import { SCORING_CATALOG } from './presetsScoring';

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

const LEGACY_METADATA: Record<string, PresetMetadata> = {
  'lead-bell': {
    category: 'Plucks',
    tags: ['bell', 'original'],
    description: 'Original FM bell. Try C4–C5 with sparse delay.',
  },
  'pad-drift': {
    category: 'Pads',
    tags: ['evolving', 'original'],
    description: 'Original slow drifting pad. Hold chords for several seconds.',
  },
  'ai-voice': {
    category: 'Pads',
    tags: ['vocal', 'original'],
    description: 'Original formant voice with fixed-frequency modulators.',
  },
  'sub-drone': {
    category: 'Basses',
    tags: ['sub', 'drone', 'original'],
    description: 'Original low sustained drone.',
  },
  'bass-digital': {
    category: 'Basses',
    tags: ['digital', 'original'],
    description: 'Original digital bass. Start in C2–C3.',
  },
  kick: { category: 'Drums', tags: ['kick', 'original'], description: 'Original FM kick.' },
  snare: {
    category: 'Drums',
    tags: ['snare', 'noise', 'original'],
    description: 'Original FM body plus noise snare.',
  },
  hat: {
    category: 'Drums',
    tags: ['hat', 'noise', 'original'],
    description: 'Original noise hat.',
  },
  'saw-arp': {
    category: 'Plucks',
    tags: ['arp', 'authored'],
    description: 'Existing authored saw arpeggio voice.',
  },
  'drone-sqr': {
    category: 'Pads',
    tags: ['drone', 'authored'],
    description: 'Existing authored square drone.',
  },
};
const GAME_FX = ['weapon-zap', 'horde-horn', 'pickup-blip', 'build-thunk'];
export const PRESET_CATALOG: Record<string, PresetMetadata> = {
  ...LEGACY_METADATA,
  ...Object.fromEntries(
    GAME_FX.map((id) => [
      id,
      {
        category: 'Legacy game FX',
        tags: ['legacy', 'game-fx'],
        description: 'Retained for existing documents. Legacy gameplay sound.',
      },
    ]),
  ),
  ...Object.fromEntries(
    SCORING_CATALOG.map(({ id, category, tags, description }) => [
      id,
      { category, tags, description },
    ]),
  ),
};

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
    if (filter.category ? entry.category !== filter.category : entry.category === 'Legacy game FX')
      return false;
    if (filter.tag && !entry.tags.includes(filter.tag)) return false;
    if (filter.source && entry.source !== filter.source) return false;
    const text = [entry.id, entry.name, entry.category, ...entry.tags, entry.description]
      .join(' ')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
