/**
 * Rack format 1 → 2 (windsor#935, record `2026-10-24-step-variation`): step
 * variation replaced Skip on the Grid and the Arp, so a format-1 rack's Grid
 * or Arp sequencer loses its `skipChance` and loads at this build's format
 * with no correction. A Figure keeps its Skip. Rack format 2 → 3
 * (windsor#945, record `2026-10-24-step-variation-velocity-and-chance`): a
 * format-2 rack's Grid or Arp sequencer gains `chancePerEffect: false`. A
 * current rack round-trips the variation fields.
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
      expect(file['sequencer']).toEqual({ kind: sequencer.kind, chancePerEffect: false });
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

  it('round-trips the variation fields at this format', () => {
    const variation = {
      randomness: 0.4,
      probability: 0.8,
      restsSound: true,
      octaveMode: true,
      chancePerEffect: true,
    };
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

describe('a format-2 rack (windsor#945)', () => {
  const variation = { randomness: 0.6, probability: 0.3, restsSound: true, octaveMode: true };

  it('gains chancePerEffect off on the Grid and the Arp, the Figure untouched', () => {
    for (const kind of ['grid', 'arp']) {
      const raw = rack(2, { kind, ...variation });
      const before = structuredClone(raw);
      const upgraded = upgradeRackFile(raw);
      expect('refused' in upgraded).toBe(false);
      expect(raw).toEqual(before);
      const file = (upgraded as { value: Raw }).value;
      expect(file['format']).toBe(3);
      expect(file['sequencer']).toEqual({ kind, ...variation, chancePerEffect: false });
    }
    const figure = { kind: 'figure', skipChance: 0.3 };
    const upgraded = upgradeRackFile(rack(2, figure)) as { value: Raw };
    expect(upgraded.value['sequencer']).toEqual(figure);
  });

  it('with variation on, loads as format 3 with the switch off and no correction', () => {
    expect(RACK_FILE_FORMAT).toBe(3);
    for (const kind of ['grid', 'arp']) {
      const entry = loadRackFile('old', rack(2, { kind, ...variation }));
      expect(entry.format).toBe(3);
      expect(entry.problems).toEqual([]);
      expect(entry.sequencer).toMatchObject({ ...variation, chancePerEffect: false });
    }
  });

  it('keeps the switch through a format-3 round trip', () => {
    for (const kind of ['grid', 'arp']) {
      for (const chancePerEffect of [false, true]) {
        const once = loadRackFile('new', rack(3, { kind, ...variation, chancePerEffect }));
        expect(once.problems).toEqual([]);
        const twice = loadRackFile('new', JSON.parse(serialiseRackFile(once)));
        expect(twice).toEqual(once);
        expect(twice.sequencer).toMatchObject({ chancePerEffect });
      }
    }
  });
});
