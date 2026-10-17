/**
 * The browser's Racks side (windsor#884): the rows, their chain line and
 * pattern mark, the Kind facet's counts under the shared filter, the pane's
 * rack rows with a member absent where the rack lacks it, and a rename's
 * name check.
 */
import { describe, expect, it } from 'vitest';

import type { RackEntry } from '@windsor/engine';
import { PATCH_FILE_FORMAT, RACK_FILE_FORMAT, RACK_FILE_KIND, loadRackFile } from '@windsor/engine';
import { PATCH_LIBRARY } from '@windsor/engine/patch/presets';
import { browserRows, facets } from './patchBrowserModel';
import { chainLine, kindCounts, rackInfo, rackListing, rackNameProblem } from './rackBrowserModel';
import { stepListing } from './patchStepModel';

/** A rack around the built-in kick, with the members asked for. */
function rack(
  id: string,
  name: string,
  inserts: unknown[],
  extra: Record<string, unknown> = {},
): RackEntry {
  const kick = PATCH_LIBRARY['kick']!;
  return loadRackFile(id, {
    format: RACK_FILE_FORMAT,
    kind: RACK_FILE_KIND,
    name,
    category: 'Drums',
    tags: ['kick', 'drive'],
    description: 'A test rack.',
    patchFormat: PATCH_FILE_FORMAT,
    patch: { ...kick.patch, name },
    patchSource: 'kick',
    inserts,
    ...extra,
  });
}

const DRIVE = { kind: 'drive', id: 'd1' };
const KEYED = { kind: 'compressor', id: 'c1', sidechain: { track: null } };
const OFF = { kind: 'reverb', id: 'r1', enabled: false };

const racks = {
  'kick-drive': rack('kick-drive', 'Kick Drive', [DRIVE, KEYED, OFF], {
    sequencer: { kind: 'euclidean' },
    lowCut: 45,
  }),
  'bare-kick': rack('bare-kick', 'Bare Kick', []),
};
const userIds = new Set(['kick-drive']);

describe('the rack rows', () => {
  it('list every rack by name, the user’s as Library and the bank as Built-in, with the chain and the pattern', () => {
    const rows = rackListing(racks, userIds);
    expect(rows.map((row) => [row.id, row.source])).toEqual([
      ['bare-kick', 'built-in'],
      ['kick-drive', 'library'],
    ]);
    expect(rows[1]?.chain).toEqual(['Classic Drive', 'Bus compressor', 'Reverb']);
    expect(chainLine(rows[1]!.chain)).toBe('Classic Drive → Bus compressor → Reverb');
    expect(rows[1]?.pattern).toBe('euclidean');
    expect(rows[0]?.chain).toEqual([]);
    expect(rows[0]?.pattern).toBeNull();
  });

  it('take the shared filter, facets and sort as the patch rows do', () => {
    const rows = rackListing(racks, userIds);
    const filter = { query: 'bare', category: '', tag: '', source: '' };
    expect(browserRows(rows, filter).map((row) => row.id)).toEqual(['bare-kick']);
    const shown = facets(rows, { ...filter, query: '' });
    expect(shown.source.map((row) => [row.value, row.count])).toEqual([
      ['document', 0],
      ['built-in', 1],
      ['library', 1],
    ]);
    expect(shown.category.map((row) => [row.value, row.count])).toEqual([
      ['', 2],
      ['Drums', 2],
    ]);
  });
});

describe('the Kind facet', () => {
  it('counts each kind under the search and the other facets kept', () => {
    const patches = stepListing(PATCH_LIBRARY);
    const rows = rackListing(racks, userIds);
    const all = kindCounts(patches, rows, { query: '', category: '', tag: '', source: '' });
    expect(all.patches).toBe(
      stepListing(PATCH_LIBRARY).filter((row) => row.category !== 'Legacy FX').length,
    );
    expect(all.racks).toBe(2);
    const searched = kindCounts(patches, rows, {
      query: 'kick',
      category: '',
      tag: '',
      source: 'library',
    });
    expect(searched).toEqual({ patches: 0, racks: 1 });
  });
});

describe('the pane’s rack rows', () => {
  it('name the patch and its origin, each insert’s power and a disconnected key, the sequencer and the low cut', () => {
    const [bare, drive] = rackListing(racks, userIds);
    const info = rackInfo(racks['kick-drive'], drive!, PATCH_LIBRARY);
    expect(info.detail).toBe('Drums · Library · Rack');
    expect(info.patchName).toBe('Kick Drive');
    expect(info.origin).toEqual({ name: PATCH_LIBRARY['kick']!.name, id: 'kick' });
    expect(info.chain).toEqual([
      { label: 'Classic Drive', enabled: true, keyDisconnected: false },
      { label: 'Bus compressor', enabled: true, keyDisconnected: true },
      { label: 'Reverb', enabled: false, keyDisconnected: false },
    ]);
    expect(info.sequencer).toBe('Euclid');
    expect(info.lowCut).toBe('45 Hz');
    const none = rackInfo(racks['bare-kick'], bare!, {});
    expect(none.detail).toBe('Drums · Built-in · Rack');
    expect(none.origin).toBeNull();
    expect(none.chain).toEqual([]);
    expect(none.sequencer).toBeNull();
    expect(none.lowCut).toBeNull();
  });
});

describe('a rack’s new name', () => {
  it('must be non-empty and no other rack’s, the rack’s own name allowed', () => {
    expect(rackNameProblem('  ', racks)).toBe('A name is required.');
    expect(rackNameProblem('bare kick', racks, 'kick-drive')).toMatch(/already exists/);
    expect(rackNameProblem('Kick Drive', racks, 'kick-drive')).toBeNull();
    expect(rackNameProblem('Kick Room', racks)).toBeNull();
  });
});
