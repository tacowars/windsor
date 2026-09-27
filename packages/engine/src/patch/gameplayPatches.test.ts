/**
 * Gameplay sounds reference the library by stable id (epic #564 decision 3):
 * every id in `GAMEPLAY_PATCH_IDS` has a file, and game code spells no preset
 * id outside that table, so the editor's Delete guard (#563) can trust it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GAMEPLAY_PATCHES, GAMEPLAY_PATCH_IDS } from './gameplayPatches';
import { patchLeafDifferences } from './patchLibrary';
import { PATCH_LIBRARY, PRESETS } from './presets';

const AUDIO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_SRC = join(AUDIO, '..');
const IDS = Object.values(GAMEPLAY_PATCH_IDS);

describe('GAMEPLAY_PATCH_IDS', () => {
  it.each(IDS)('%s has a library file and resolves to the same patch', (id) => {
    expect(existsSync(join(AUDIO, 'patches', `${id}.json`))).toBe(true);
    expect(PATCH_LIBRARY[id]).toBeDefined();
    expect(patchLeafDifferences(GAMEPLAY_PATCHES[id], PRESETS[id], id)).toEqual([]);
  });
});

/**
 * A preset id spelled where game code names a patch: `preset: '<id>'` or
 * `PRESETS['<id>']`. A bare word is not a preset literal (`'kick'` is also a
 * part slot), so the position is what classifies it.
 */
const PRESET_LITERAL = /(?:\bpreset\s*:\s*|\bPRESETS\s*\[\s*)(['"])([a-z0-9-]+)\1/g;

/** Every library id the source spells in a preset position. */
function presetLiterals(source: string): string[] {
  return [...source.matchAll(PRESET_LITERAL)]
    .map((match) => match[2] ?? '')
    .filter((id) => Object.hasOwn(PATCH_LIBRARY, id));
}

/** Non-test client source, minus fixtures, the generated index and the table itself. */
function gameSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === '__fixtures__' || entry.name === 'patches' ? [] : gameSources(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    if (entry.name.endsWith('.d.ts') || path === join(AUDIO, 'patch/gameplayPatches.ts')) return [];
    return [path];
  });
}

describe('preset literals in game code', () => {
  it('flags a real file that spells one and passes a real file that does not', () => {
    // The full-arrangement fixture names its parts' presets by string; it is a
    // fixture, so the guard below never scans it, which is what makes it a
    // safe positive input for the classifier itself.
    const fixture = readFileSync(join(AUDIO, '__fixtures__/fullArrangement.ts'), 'utf8');
    expect(presetLiterals(fixture)).toContain('kick');
    // sfxBuffers bakes two gameplay patches and names both through the table.
    const sfx = readFileSync(join(AUDIO, 'sfx/sfxBuffers.ts'), 'utf8');
    expect(presetLiterals(sfx)).toEqual([]);
    // A part slot named 'kick' is not a preset literal.
    expect(presetLiterals("const parts = ['kick', 'hat']; part: 'kick'")).toEqual([]);
  });

  it('are spelled nowhere outside GAMEPLAY_PATCH_IDS', () => {
    const offenders = gameSources(CLIENT_SRC).flatMap((path) => {
      const ids = presetLiterals(readFileSync(path, 'utf8'));
      return ids.length ? [`${relative(CLIENT_SRC, path)}: ${ids.join(', ')}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
