/**
 * Which lane holds a knob (windsor#351; record
 * `2026-10-01-song-automation-lanes` decision 6), over the automation
 * fixture's hat part: a strip, insert or voice knob is locked while its lane
 * is on, at the lane's value at the playhead, and free while the lane is
 * off, deleted, absent, or on an insert field the insert does not read.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_DOCUMENT,
  AUTOMATION_EQ_ID,
  AUTOMATION_PART,
  AUTOMATION_TAPE_ID,
} from '@windsor/engine/__fixtures__/automationSong';
import {
  TICKS_PER_BAR,
  VOICE_TARGET_IDS,
  partAt,
  type AutomationLane,
  type DocumentPart,
  type InsertSpec,
} from '@windsor/engine';
import {
  automatedValueText,
  catalogKnobAutomation,
  insertKnobAutomation,
  lockedKnobNotice,
  sameKnobAutomation,
  voiceKnobAutomation,
  voiceKnobTarget,
  type KnobLockColors,
} from './knobAutomation';
import { LANE_KIND_COLOR } from './songAutomationTables';

const BAR = TICKS_PER_BAR;
const COLORS: KnobLockColors = { strip: 'teal', insert: 'violet', voice: 'amber' };

/** The hat part with `lanes` in place of its own. */
const withLanes = (lanes: readonly AutomationLane[]): DocumentPart => ({
  ...AUTOMATION_PART,
  automation: lanes,
});

/** The hat part with the lane on `target` switched on or off. */
const switched = (target: string, on: boolean): DocumentPart =>
  withLanes(
    (AUTOMATION_PART.automation ?? []).map((l) => (l.target === target ? { ...l, on } : l)),
  );

const insertAt = (part: DocumentPart, id: string): InsertSpec | undefined =>
  part.strip.inserts.find((spec) => spec.id === id);

describe('a strip knob', () => {
  it('locks at its lane’s value at the playhead, in the mixer colour', () => {
    expect(catalogKnobAutomation(AUTOMATION_PART, 'strip.level', 0, COLORS)).toEqual({
      color: 'teal',
      value: 0.5,
    });
    const after = catalogKnobAutomation(AUTOMATION_PART, 'strip.level', 3 * BAR, COLORS);
    expect(after?.value).toBe(1);
  });

  it('follows the curve between points', () => {
    const at = (tick: number): number =>
      catalogKnobAutomation(AUTOMATION_PART, 'strip.level', tick)?.value ?? NaN;
    expect(at(BAR)).toBeGreaterThan(0.5);
    expect(at(BAR)).toBeLessThan(1);
  });

  it('is free while its lane is off, deleted or absent', () => {
    expect(catalogKnobAutomation(AUTOMATION_PART, 'strip.pan', BAR)).toBeNull();
    const deleted = withLanes(
      (AUTOMATION_PART.automation ?? []).filter((l) => l.target !== 'strip.level'),
    );
    expect(catalogKnobAutomation(deleted, 'strip.level', 0)).toBeNull();
    expect(catalogKnobAutomation(switched('strip.level', false), 'strip.level', 0)).toBeNull();
    expect(catalogKnobAutomation(AUTOMATION_PART, 'strip.send.a', 0)).toBeNull();
    expect(catalogKnobAutomation(undefined, 'strip.level', 0)).toBeNull();
  });

  it('locks again when its lane is switched back on', () => {
    expect(catalogKnobAutomation(switched('strip.pan', true), 'strip.pan', 0)?.value).toBe(-0.5);
  });

  it('takes the kind’s colour from the lanes’ own table by default', () => {
    expect(catalogKnobAutomation(AUTOMATION_PART, 'strip.level', 0)?.color).toBe(
      LANE_KIND_COLOR.strip,
    );
  });
});

describe('an insert knob', () => {
  const tape = insertAt(AUTOMATION_PART, AUTOMATION_TAPE_ID);
  const eq = insertAt(AUTOMATION_PART, AUTOMATION_EQ_ID);

  it('locks on its insert’s field, in the insert colour', () => {
    expect(insertKnobAutomation(AUTOMATION_PART, tape, 'drive', 0, COLORS)).toEqual({
      color: 'violet',
      value: -6,
    });
    expect(insertKnobAutomation(AUTOMATION_PART, tape, 'drive', 4 * BAR)?.value).toBe(18);
  });

  it('is free on a field the insert does not read: the lane is inert', () => {
    // Tape is unsplit, so its wow lane, though on, moves nothing.
    expect(tape?.kind === 'tape' && tape.split).toBe(false);
    expect(insertKnobAutomation(AUTOMATION_PART, tape, 'wow', BAR)).toBeNull();
  });

  it('locks the inert field once the insert reads it again', () => {
    const split = { ...tape, split: true } as InsertSpec;
    const part: DocumentPart = {
      ...AUTOMATION_PART,
      strip: {
        ...AUTOMATION_PART.strip,
        inserts: [split, ...AUTOMATION_PART.strip.inserts.slice(1)],
      },
    };
    expect(insertKnobAutomation(part, split, 'wow', BAR)?.value).toBe(25);
  });

  it('is free while its lane is off, and on a field no lane holds', () => {
    expect(insertKnobAutomation(AUTOMATION_PART, eq, 'bands.0.freq', 0)).toBeNull();
    expect(insertKnobAutomation(AUTOMATION_PART, tape, 'bias', 0)).toBeNull();
  });

  it('is free on a field its kind does not automate, and on an insert with no id', () => {
    expect(insertKnobAutomation(AUTOMATION_PART, tape, 'seed', 0)).toBeNull();
    const anonymous = { ...tape } as InsertSpec & { id?: string };
    delete anonymous.id;
    expect(insertKnobAutomation(AUTOMATION_PART, anonymous, 'drive', 0)).toBeNull();
    expect(insertKnobAutomation(AUTOMATION_PART, undefined, 'drive', 0)).toBeNull();
  });
});

describe('a patch knob', () => {
  it('locks on a voice target, in the voice colour', () => {
    expect(voiceKnobAutomation(AUTOMATION_PART, 'filter.cutoff', 0, COLORS)).toEqual({
      color: 'amber',
      value: 200,
    });
    // A step at bar 2: the later point wins on its tick.
    expect(voiceKnobAutomation(AUTOMATION_PART, 'ops.0.level', 2 * BAR)?.value).toBe(0.25);
  });

  it('is free on a path off the catalog and on a target with no lane', () => {
    expect(voiceKnobTarget('ops.0.ratio')).toBeNull();
    expect(voiceKnobAutomation(AUTOMATION_PART, 'ops.0.ratio', 0)).toBeNull();
    expect(voiceKnobAutomation(AUTOMATION_PART, 'filter.resonance', 0)).toBeNull();
  });

  it('knows the 29 voice targets and no more', () => {
    expect(VOICE_TARGET_IDS).toHaveLength(29);
    for (const id of VOICE_TARGET_IDS) {
      expect(voiceKnobTarget(id.slice('voice.'.length))).toBe(id);
    }
  });

  it('locks only for the part whose lanes hold it, though two parts share a patch', () => {
    const other = AUTOMATION_DOCUMENT.parts.find((p) => p.slot !== AUTOMATION_PART.slot)!;
    const sharing: DocumentPart = { ...other, preset: AUTOMATION_PART.preset };
    const hat = partAt(AUTOMATION_DOCUMENT, AUTOMATION_PART.slot);
    expect(voiceKnobAutomation(hat, 'filter.cutoff', 0)).not.toBeNull();
    expect(voiceKnobAutomation(sharing, 'filter.cutoff', 0)).toBeNull();
  });
});

describe('the lock’s wording and change check', () => {
  it('names the knob in the press notice and the readout', () => {
    expect(lockedKnobNotice('Cutoff')).toBe(
      'Cutoff is automated in the song. Switch its lane off to edit it.',
    );
    expect(automatedValueText('1.20 kHz')).toBe('1.20 kHz, automated');
  });

  it('redraws only on a change of lock, colour or value', () => {
    const a = { color: 'teal', value: 0.5 };
    expect(sameKnobAutomation(null, null)).toBe(true);
    expect(sameKnobAutomation(a, { ...a })).toBe(true);
    expect(sameKnobAutomation(a, null)).toBe(false);
    expect(sameKnobAutomation(a, { ...a, value: 0.6 })).toBe(false);
    expect(sameKnobAutomation(a, { ...a, color: 'amber' })).toBe(false);
  });
});
