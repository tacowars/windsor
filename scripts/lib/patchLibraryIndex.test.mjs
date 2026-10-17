/* global URL */
// reads-by-path: packages/engine/src/patches/**, packages/engine/src/racks/**, packages/engine/src/__fixtures__/**
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BANKS, identifierFor, patchIdsIn, renderIndex } from './patchLibraryIndex.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(root, 'packages/engine/src');
const PATCHES = join(SRC, 'patches');
const FIXTURES = join(SRC, '__fixtures__');

describe('the patch library index', () => {
  it('is current for the committed patches/ directory', () => {
    const ids = patchIdsIn(PATCHES);
    expect(ids.length).toBeGreaterThan(0);
    expect(renderIndex(ids)).toBe(readFileSync(join(PATCHES, 'index.ts'), 'utf8'));
  });
  it('is current for every bank, the racks included (windsor#877)', () => {
    expect(BANKS.map((bank) => bank.dir)).toEqual(['patches', 'racks']);
    for (const bank of BANKS) {
      const dir = join(SRC, bank.dir);
      expect(renderIndex(patchIdsIn(dir), bank)).toBe(readFileSync(join(dir, 'index.ts'), 'utf8'));
    }
  });
  it('refuses a directory holding something that is not a patch file', () => {
    // A real directory: __fixtures__/ holds .ts files and JSON that is not a patch.
    expect(() => patchIdsIn(FIXTURES)).toThrow(/only <id>\.json files belong here/);
  });
  it('derives a legal, distinct identifier from every accepted slug', () => {
    expect(identifierFor('score-drowned-cellos')).toBe('patch_score_drowned_cellos');
    expect(identifierFor('kick')).toBe('patch_kick');
    expect(identifierFor('kick', 'rack')).toBe('rack_kick');
    expect(identifierFor('a1')).not.toBe(identifierFor('a-1'));
    expect(identifierFor('1st')).toMatch(/^[A-Za-z_$][\w$]*$/);
    const index = renderIndex(['lead-bell', 'kick', '1st']);
    expect(index).toContain("import patch_lead_bell from './lead-bell.json';");
    expect(index).toContain("  'lead-bell': patch_lead_bell,");
    expect(index).toContain('  kick: patch_kick,');
    expect(index).toContain("  '1st': patch_1st,");
  });
  it("renders a bank's own constant, prefix and loader, and an empty bank as an empty map", () => {
    const racks = BANKS[1];
    const index = renderIndex(['kick-drive'], racks);
    expect(index).toContain("import rack_kick_drive from './kick-drive.json';");
    expect(index).toContain('export const RACK_FILES: Readonly<Record<string, unknown>> = {');
    expect(index).toContain("  'kick-drive': rack_kick_drive,");
    expect(index).toContain('(`rack/rackBank.ts` loads it)');
    expect(index).toContain('One static import per rack');
    expect(renderIndex([], racks)).toContain(
      'export const RACK_FILES: Readonly<Record<string, unknown>> = {};\n',
    );
  });
});
