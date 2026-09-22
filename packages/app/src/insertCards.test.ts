/**
 * The insert-card registry covers the engine's insert kinds (#641), as
 * `SEQUENCER_CARDS` covers the sequencer kinds: a kind added to
 * `INSERT_KINDS` without a card, a label or knobs would be an insert the
 * Mixer tab can add and not show. That fails here, and the registry carries
 * no entry the engine does not declare.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DRIVE,
  DRIVE_GAIN_MAX_DB,
  DRIVE_GAIN_MIN_DB,
  DRIVE_TONE_MAX_HZ,
  DRIVE_TONE_MIN_HZ,
  INSERT_KINDS,
  INSERT_KIND_NAMES,
} from '../../../packages/client/src/audio/index-for-editor';
import { INSERT_CARDS } from './insertCards';
import { DRIVE_KNOBS, INSERT_LABELS } from './insertKnobTables';

describe('INSERT_CARDS', () => {
  it('has a card for every insert kind the engine declares, and no other', () => {
    for (const kind of INSERT_KIND_NAMES) expect(typeof INSERT_CARDS[kind], kind).toBe('function');
    expect(Object.keys(INSERT_CARDS).sort()).toEqual([...INSERT_KIND_NAMES].sort());
  });

  it('labels every kind it can add', () => {
    expect(Object.keys(INSERT_LABELS).sort()).toEqual([...INSERT_KIND_NAMES].sort());
  });
});

describe('DRIVE_KNOBS', () => {
  it("covers every drive field but the kind, each defaulting to DEFAULT_DRIVE's", () => {
    const fields = INSERT_KINDS.drive.fields.filter((f) => f !== 'kind');
    expect(DRIVE_KNOBS.map((k) => k.f).sort()).toEqual([...fields].sort());
    for (const { f, o } of DRIVE_KNOBS) expect(o.def, f).toBe(DEFAULT_DRIVE[f]);
  });

  it("spans the engine's ranges", () => {
    const byField = Object.fromEntries(DRIVE_KNOBS.map((k) => [k.f, k.o]));
    expect([byField.drive?.min, byField.drive?.max]).toEqual([
      DRIVE_GAIN_MIN_DB,
      DRIVE_GAIN_MAX_DB,
    ]);
    expect([byField.tone?.min, byField.tone?.max]).toEqual([DRIVE_TONE_MIN_HZ, DRIVE_TONE_MAX_HZ]);
    expect([byField.mix?.min, byField.mix?.max]).toEqual([0, 1]);
  });
});
