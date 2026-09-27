/**
 * The metadata modal's rules (#563): required and unique names, ids from
 * names, category and tag lists from the library, tag normalisation and
 * suggestions, and the loudness warning's suggested volume.
 */
import { describe, expect, it } from 'vitest';

import { PATCH_LIBRARY } from '@windsor/engine';
import { SUGGESTED_HEADROOM } from './libraryConstants';
import {
  categoriesOf,
  copyMetadata,
  nameProblem,
  normaliseTags,
  slugify,
  suggestTags,
  suggestedVolume,
  tagsOf,
  uniqueId,
} from './patchMetadata';

describe('ids from names', () => {
  it('slugs a display name to the file id rule', () => {
    expect(slugify('Bell Lead copy')).toBe('bell-lead-copy');
    expect(slugify('  Über  Pad! 2 ')).toBe('uber-pad-2');
    expect(slugify('***')).toBe('patch');
  });
  it('suffixes a taken slug with -2, then -3', () => {
    expect(uniqueId('kick', Object.keys(PATCH_LIBRARY))).toBe('kick-2');
    expect(uniqueId('kick', ['kick', 'kick-2'])).toBe('kick-3');
    expect(uniqueId('brand-new', Object.keys(PATCH_LIBRARY))).toBe('brand-new');
  });
});

describe('display names', () => {
  it('are required, trimmed and unique among the library, except over the entry saved', () => {
    expect(nameProblem('  ', PATCH_LIBRARY)).toContain('required');
    expect(nameProblem('FM Kick', PATCH_LIBRARY)).toContain('kick');
    expect(nameProblem(' fm kick ', PATCH_LIBRARY)).toContain('kick');
    expect(nameProblem('FM Kick', PATCH_LIBRARY, 'kick')).toBeNull();
    expect(nameProblem('Something New', PATCH_LIBRARY)).toBeNull();
  });
});

describe('categories and tags', () => {
  it('lists the library categories once each, sorted, and the tags likewise', () => {
    const categories = categoriesOf(PATCH_LIBRARY);
    expect(categories).toContain('Drums');
    expect(new Set(categories).size).toBe(categories.length);
    expect([...categories].sort((a, b) => a.localeCompare(b))).toEqual(categories);
    const tags = tagsOf(PATCH_LIBRARY);
    expect(tags).toContain('kick');
    expect(new Set(tags).size).toBe(tags.length);
  });
  it('lower-cases, trims and de-duplicates typed tags', () => {
    expect(normaliseTags([' Bell ', 'bell', '', 'ORIGINAL', 'original'])).toEqual([
      'bell',
      'original',
    ]);
  });
  it('suggests library tags by prefix, minus the ones already chosen', () => {
    expect(suggestTags(PATCH_LIBRARY, 'ki')).toContain('kick');
    expect(suggestTags(PATCH_LIBRARY, 'KI', ['kick'])).not.toContain('kick');
    expect(suggestTags(PATCH_LIBRARY, '')).toEqual([]);
  });
  it('copies metadata as "<name> copy" with its own tag array', () => {
    const source = { name: 'Bell', category: 'Plucks', tags: ['bell'], description: 'd' };
    const copy = copyMetadata(source);
    expect(copy).toEqual({ ...source, name: 'Bell copy' });
    expect(copy.tags).not.toBe(source.tags);
  });
});

describe('the loudness warning', () => {
  it('suggests volume × 0.98 / peak', () => {
    expect(suggestedVolume(0.8, 1.6)).toBeCloseTo((0.8 * SUGGESTED_HEADROOM) / 1.6, 12);
  });
});
