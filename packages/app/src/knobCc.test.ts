/**
 * A knob's CC look (windsor#785, record `2026-10-13-midi-cc-mapping`
 * decisions 2, 3 and 7): the tag order with a lane on, a lane off, an
 * envelope playing and none; the ring from the pin to the CC's value; the
 * hollow marker while pickup waits; the highlight while learn listens.
 */
import {
  type CcMapping,
  type CcTargetId,
  type DocumentPart,
  type InsertKindName,
  makeArrangement,
  partAt,
} from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import type { CcStatus } from './ccStatus';
import { COMPRESSOR_KNOBS } from './compressorTables';
import { DELAY_KNOBS } from './delayTables';
import { EQ_GLOBAL_KNOBS } from './eqTables';
import {
  BLOOM_KNOBS,
  CHORUS_KNOBS,
  DRIVE_KNOBS,
  ECHO_KNOBS,
  ENSEMBLE_KNOBS,
  FILTER_INSERT_KNOBS,
  REVERB_KNOBS,
} from './insertKnobTables';
import { type KnobCcState, insertCcTarget, knobCcAt } from './knobCc';
import { knobTagText } from './knobLock';
import { knobRing } from './knobRing';
import { newSong } from './songParts';
import { PHASER_KNOBS } from './phaserTables';
import { RETRO_REVERB_KNOBS } from './retroReverbTables';
import { TAPE_KNOBS } from './tapeTables';

const LEVEL: CcTargetId = 'voice.ops.0.level';
const AT = { part: 0, target: LEVEL } as const;
const LANE = { color: 'violet', value: 0.4 };

const mapping: CcMapping = {
  source: { device: 'Keys', channel: 1, cc: 71 },
  target: LEVEL,
  min: 0,
  max: 1,
  inverted: false,
};

function part(extra: Partial<DocumentPart> = {}): DocumentPart {
  const first = partAt(makeArrangement(newSong()).document, 0);
  if (!first) throw new Error('no part');
  return { ...first, ...extra };
}

const MAPPED = part({ ccMappings: [mapping] });

/** A CC state answering `status` and `held` for every target. */
const state = (
  status: CcStatus | undefined,
  held?: number,
  learning: KnobCcState['learning'] = null,
): KnobCcState => ({ status: () => status, held: () => held, learning });

describe('the knob tag', () => {
  it('reads AUTO with a lane on, else CC <n> while mapped, else ENV, whatever else plays', () => {
    expect(knobTagText(LANE, 71, true)).toBe('AUTO');
    expect(knobTagText({ ...LANE, macro: 'Accent' }, null, false)).toBe('Accent');
    expect(knobTagText(null, 71, true)).toBe('CC 71');
    expect(knobTagText(null, 71, false)).toBe('CC 71');
    expect(knobTagText(null, null, true)).toBe('ENV');
  });
});

describe('knobCcAt', () => {
  it('shows nothing on an unmapped knob learn does not listen for, or a knob no part owns', () => {
    expect(knobCcAt(part(), AT, state(undefined))).toBeNull();
    expect(knobCcAt(MAPPED, { ...AT, part: null }, state(undefined))).toBeNull();
  });

  it('carries the CC at rest, and the value it plays once moved', () => {
    const live: CcStatus = { kind: 'live', value: 0.3, held: true };
    expect(knobCcAt(MAPPED, AT, state(live))).toMatchObject({ cc: 71, held: null, marker: null });
    expect(knobCcAt(MAPPED, AT, state(live, 0.3))).toMatchObject({ held: 0.3, waiting: false });
  });

  it('waits for pickup with the hollow marker once a position is heard, none before', () => {
    const heard: CcStatus = { kind: 'waiting', marker: { cc: 100, value: 0.79 } };
    expect(knobCcAt(MAPPED, AT, state(heard))).toMatchObject({ waiting: true, marker: 0.79 });
    const unheard: CcStatus = { kind: 'waiting', marker: null };
    expect(knobCcAt(MAPPED, AT, state(unheard))).toMatchObject({ waiting: true, marker: null });
  });

  it("lights the knob learn listens for, mapped or not, and shows a share's value", () => {
    const learning = { part: 0, target: LEVEL };
    expect(knobCcAt(part(), AT, state(undefined, undefined, learning))).toMatchObject({
      cc: null,
      learning: true,
    });
    const half = (v: number): number => v / 2;
    const seen = knobCcAt(MAPPED, AT, state(undefined, 0.6), undefined, half);
    expect(seen).toMatchObject({ held: 0.3, learning: false });
  });
});

describe('knobRing', () => {
  const out = { base: 0, playing: 0 };
  const env = { base: 0.8, playing: 0.5 };

  it("runs from the pin to the CC's value; an envelope's ring wins, a lock clears the CC's", () => {
    expect(knobRing(null, null, { held: 0.3 }, 0.8, out)).toEqual({ base: 0.8, playing: 0.3 });
    expect(knobRing(env, null, { held: 0.3 }, 0.8, out)).toBe(env);
    expect(knobRing(null, LANE, { held: 0.3 }, 0.4, out)).toBeNull();
    expect(knobRing(null, null, { held: null }, 0.8, out)).toBeNull();
  });
});

describe('insertCcTarget', () => {
  // Each kind's knob table; advanced drive builds its knobs from its own spec.
  const TABLES: Partial<Record<InsertKindName, readonly { readonly f: string }[]>> = {
    drive: DRIVE_KNOBS,
    chorus: CHORUS_KNOBS,
    compressor: COMPRESSOR_KNOBS,
    'retro-reverb': RETRO_REVERB_KNOBS,
    phaser: PHASER_KNOBS,
    tape: TAPE_KNOBS,
    delay: DELAY_KNOBS,
    ensemble: ENSEMBLE_KNOBS,
    reverb: REVERB_KNOBS,
    echo: ECHO_KNOBS,
    eq: EQ_GLOBAL_KNOBS,
    filter: FILTER_INSERT_KNOBS,
    bloom: BLOOM_KNOBS,
  };
  const fields = Object.values(TABLES).flatMap((table) => table.map((entry) => entry.f));

  it('answers every knob of every kind, and a slot child of every host, without throwing', () => {
    for (const [kind, table] of Object.entries(TABLES) as [InsertKindName, { f: string }[]][]) {
      for (const { f } of table) {
        const id = insertCcTarget(kind, 'fx1', f);
        expect(id === null || id === `insert.fx1.${f}`, `${kind} ${f}`).toBe(true);
      }
      for (const f of fields) expect(() => insertCcTarget(kind, 'fx1', `slot.${f}`)).not.toThrow();
    }
  });

  it("leaves Bloom's Octave, Low and High unmapped, and maps its continuous fields", () => {
    for (const f of ['octave', 'low', 'high']) expect(insertCcTarget('bloom', 'fx1', f)).toBeNull();
    expect(insertCcTarget('bloom', 'fx1', 'mix')).toBe('insert.fx1.mix');
    expect(insertCcTarget('bloom', 'fx1', 'freeze')).toBeNull();
  });
});
