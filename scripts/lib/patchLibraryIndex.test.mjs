/* global URL */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { identifierFor, patchIdsIn, renderIndex } from './patchLibraryIndex.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const PATCHES = join(root, 'packages/client/src/audio/patches');
const FIXTURES = join(root, 'packages/client/src/audio/__fixtures__');

describe('the patch library index', () => {
  it('is current for the committed patches/ directory', () => {
    const ids = patchIdsIn(PATCHES);
    expect(ids.length).toBeGreaterThan(0);
    expect(renderIndex(ids)).toBe(readFileSync(join(PATCHES, 'index.ts'), 'utf8'));
  });
  it('refuses a directory holding something that is not a patch file', () => {
    // A real directory: __fixtures__/ holds .ts files and JSON that is not a patch.
    expect(() => patchIdsIn(FIXTURES)).toThrow(/only <id>\.json files belong here/);
  });
  it('derives a legal identifier from a real id and imports it by its slug', () => {
    expect(identifierFor('score-drowned-cellos')).toBe('patchScoreDrownedCellos');
    expect(identifierFor('kick')).toBe('patchKick');
    expect(renderIndex(['lead-bell'])).toContain("import patchLeadBell from './lead-bell.json';");
    expect(renderIndex(['lead-bell'])).toContain("  'lead-bell': patchLeadBell,");
  });
});
