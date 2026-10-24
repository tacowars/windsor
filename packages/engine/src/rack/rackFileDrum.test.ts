/**
 * A rack carrying a Drum sequencer (windsor#948, record
 * `2026-10-24-drum-sequencer` decisions 7 and 8): `drum` is a kind like any
 * other to the rack loader, so a rack file holding one loads with nothing
 * to report and round-trips byte for byte, its hits' fields included. The
 * rack format does not move.
 */
import { describe, expect, it } from 'vitest';

import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import type { Patch } from '../patch/patch';
import { PATCH_FILE_FORMAT } from '../patch/patchLibrary';
import { DEFAULT_DRUM_CONFIG } from '../sequencing/drumSequencer';
import { DRUM_REST, drumHit } from '../sequencing/drumSteps';
import { RACK_FILE_FORMAT, loadRackFile, type RackFile } from './rackFile';
import { serialiseRackFile } from './rackFileSerialise';

const PATCH = FULL_DOCUMENT.patches['kick'] as Patch;
/** The default Drum config without its seed, as a rack carries it. */
const DRUM_CONFIG: Record<string, unknown> = { ...DEFAULT_DRUM_CONFIG };
delete DRUM_CONFIG.seed;

const drumRack = (): RackFile => ({
  format: RACK_FILE_FORMAT,
  kind: 'rack',
  name: PATCH.name,
  category: 'Drums',
  tags: ['snare'],
  description: 'A rack that exists only inside this test.',
  patchFormat: PATCH_FILE_FORMAT,
  patch: PATCH,
  sequencer: {
    kind: 'drum',
    ...(DRUM_CONFIG as Omit<typeof DEFAULT_DRUM_CONFIG, 'seed'>),
    note: 38,
    steps: [drumHit({ accent: true }), DRUM_REST, drumHit({ velocity: 0.3, pitch: 2, ratchet: 2 })],
    length: 3,
  },
  inserts: [],
});

describe('a rack with a Drum sequencer', () => {
  it('loads with nothing to report and round-trips byte for byte', () => {
    const file = drumRack();
    const text = serialiseRackFile(file);
    const entry = loadRackFile('snare-rack', JSON.parse(text));
    expect(entry.problems).toEqual([]);
    expect(entry.sequencer).toEqual(file.sequencer);
    const back: Partial<typeof entry> = { ...entry };
    delete back.id;
    delete back.problems;
    expect(serialiseRackFile(back as RackFile)).toBe(text);
  });
});
