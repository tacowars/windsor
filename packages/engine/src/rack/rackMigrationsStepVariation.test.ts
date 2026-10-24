/**
 * Rack format 1 → 2 (windsor#935, record `2026-10-24-step-variation`): step
 * variation replaced Skip on the Grid and the Arp, so a format-1 rack's Grid
 * or Arp sequencer loses its `skipChance` and loads at this build's format
 * with no correction. A Figure keeps its Skip. A current rack round-trips
 * the four new fields.
 */
import { describe, expect, it } from 'vitest';

import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import type { Patch } from '../patch/patch';
import { PATCH_FILE_FORMAT } from '../patch/patchLibrary';
import { RACK_FILE_FORMAT, loadRackFile } from './rackFile';
import { serialiseRackFile } from './rackFileSerialise';
import { upgradeRackFile } from './rackMigrations';

type Raw = Record<string, unknown>;

const PATCH = FULL_DOCUMENT.patches['kick'] as Patch;

/** A rack at `format` around `sequencer`. */
const rack = (format: number, sequencer: Raw): Raw => ({
  format,
  kind: 'rack',
  name: PATCH.name,
  category: 'Drums',
  tags: [],
  description: '',
  patchFormat: PATCH_FILE_FORMAT,
  patch: PATCH,
  sequencer,
  inserts: [],
});

const GRID = { kind: 'grid', skipChance: 0.7 };
const ARP = { kind: 'arp', skipChance: 0.2 };
const FIGURE = { kind: 'figure', skipChance: 0.3 };

describe('a format-1 rack (windsor#935)', () => {
  it('loses the Grid’s and the Arp’s skipChance, the Figure’s kept', () => {
    for (const sequencer of [GRID, ARP]) {
      const raw = rack(1, sequencer);
      const before = structuredClone(raw);
      const upgraded = upgradeRackFile(raw);
      expect('refused' in upgraded).toBe(false);
      expect(raw).toEqual(before);
      const file = (upgraded as { value: Raw }).value;
      expect(file['format']).toBe(RACK_FILE_FORMAT);
      expect(file['sequencer']).toEqual({ kind: sequencer.kind });
    }
    const figure = upgradeRackFile(rack(1, FIGURE)) as { value: Raw };
    expect(figure.value['sequencer']).toEqual(FIGURE);
  });

  it("loads at this build's format with no correction, nothing varied", () => {
    for (const sequencer of [GRID, ARP]) {
      const entry = loadRackFile('old', rack(1, sequencer));
      expect(entry.format).toBe(RACK_FILE_FORMAT);
      expect(entry.problems).toEqual([]);
      expect(entry.sequencer).not.toHaveProperty('skipChance');
      expect(entry.sequencer).toMatchObject({
        randomness: 0,
        probability: 0,
        restsSound: false,
        octaveMode: false,
      });
    }
  });

  it('round-trips the four fields at this format', () => {
    const variation = { randomness: 0.4, probability: 0.8, restsSound: true, octaveMode: true };
    for (const kind of ['grid', 'arp']) {
      const once = loadRackFile('new', rack(RACK_FILE_FORMAT, { kind, ...variation }));
      expect(once.problems).toEqual([]);
      const twice = loadRackFile('new', JSON.parse(serialiseRackFile(once)));
      expect(twice.problems).toEqual([]);
      expect(twice).toEqual(once);
      expect(twice.sequencer).toMatchObject(variation);
    }
  });
});
