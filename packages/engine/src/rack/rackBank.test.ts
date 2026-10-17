/**
 * The built-in rack bank (windsor#877): every shipped rack loads clean and
 * names a built-in patch as its provenance, the index and the bank agree,
 * and a bank with a bad file fails at load rather than shipping it.
 */
import { describe, expect, it } from 'vitest';

import { PATCH_LIBRARY } from '../patch/presets';
import { RACK_FILES } from '../racks/index';
import { RACK_FILE_FORMAT, RACK_FILE_KIND } from './rackConstants';
import { RACK_BANK, loadRackBank } from './rackBank';
import { PATCH_FILE_FORMAT } from '../patch/patchLibrary';

/** A rack file around a built-in patch, for the bank rules to run on. */
function rackAround(inserts: unknown[]): Record<string, unknown> {
  const kick = PATCH_LIBRARY['kick']!;
  return {
    format: RACK_FILE_FORMAT,
    kind: RACK_FILE_KIND,
    name: 'Kick Rack',
    category: kick.category,
    tags: [...kick.tags],
    description: '',
    patchFormat: PATCH_FILE_FORMAT,
    patch: { ...kick.patch, name: 'Kick Rack' },
    patchSource: 'kick',
    inserts,
  };
}

describe('the shipped rack bank', () => {
  it('holds every indexed file, each loaded with no problems', () => {
    expect(Object.keys(RACK_BANK)).toEqual(Object.keys(RACK_FILES));
    for (const [id, entry] of Object.entries(RACK_BANK)) {
      expect(entry.id).toBe(id);
      expect(entry.problems).toEqual([]);
    }
  });

  it("names a built-in patch as each rack's provenance, when it names one", () => {
    for (const entry of Object.values(RACK_BANK)) {
      if (entry.patchSource !== undefined) expect(PATCH_LIBRARY[entry.patchSource]).toBeDefined();
    }
  });
});

describe('loadRackBank', () => {
  it('loads a clean file and keeps a correction on its entry', () => {
    const bank = loadRackBank({
      clean: rackAround([{ kind: 'drive', id: 'd1' }]),
      loud: rackAround([{ kind: 'drive', id: 'd1', drive: 999 }]),
    });
    expect(bank['clean']?.problems).toEqual([]);
    expect(bank['loud']?.problems).toHaveLength(1);
    expect(bank['loud']?.problems[0]).toMatch(/inserts\[0\]\.drive/);
  });

  it('throws on a file the loader refuses, so a bad rack never ships', () => {
    expect(() => loadRackBank({ bad: rackAround([{ kind: 'no-such-insert', id: 'x' }]) })).toThrow(
      /no-such-insert/,
    );
  });
});
