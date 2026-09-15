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
  it('derives a legal, distinct identifier from every accepted slug', () => {
    expect(identifierFor('score-drowned-cellos')).toBe('patch_score_drowned_cellos');
    expect(identifierFor('kick')).toBe('patch_kick');
    expect(identifierFor('a1')).not.toBe(identifierFor('a-1'));
    expect(identifierFor('1st')).toMatch(/^[A-Za-z_$][\w$]*$/);
    const index = renderIndex(['lead-bell', 'kick', '1st']);
    expect(index).toContain("import patch_lead_bell from './lead-bell.json';");
    expect(index).toContain("  'lead-bell': patch_lead_bell,");
    expect(index).toContain('  kick: patch_kick,');
    expect(index).toContain("  '1st': patch_1st,");
  });
});
