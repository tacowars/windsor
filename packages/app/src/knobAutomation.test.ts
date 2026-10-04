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
  DEFAULT_CHORD_CONFIG,
  DEFAULT_GRID_CONFIG,
  TICKS_PER_BAR,
  VOICE_AUTOMATION_ROWS,
  VOICE_TARGET_IDS,
  followingTick,
  makeMacro,
  partAt,
  songTicksOf,
  type AutomationLane,
  type DocumentPart,
  type InsertSpec,
} from '@windsor/engine';
import {
  automatedValueText,
  catalogKnobAutomation,
  insertKnobAutomation,
  knobSongTick,
  isSeqField,
  lockNotice,
  lockedKnobNotice,
  patchKnobAutomation,
  sameKnobAutomation,
  seqKnobAutomation,
  voiceKnobAutomation,
  voiceKnobTarget,
  type KnobLockColors,
} from './knobAutomation';
import { lockTagText } from './knobLock';
import { LANE_KIND_COLOR } from './songAutomationTables';

const BAR = TICKS_PER_BAR;
const COLORS: KnobLockColors = { strip: 'teal', insert: 'violet', voice: 'amber', seq: 'rose' };

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

  it('knows the 38 voice targets and no more, the Formant vowel and the macros among them', () => {
    expect(VOICE_TARGET_IDS).toHaveLength(38);
    expect(voiceKnobTarget('filter.vowel')).toBe('voice.filter.vowel');
    for (const row of VOICE_AUTOMATION_ROWS) {
      expect(voiceKnobTarget(row.path)).toBe(row.target);
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

describe('a sequencer knob (windsor#491)', () => {
  const skip: AutomationLane = {
    target: 'seq.skipChance',
    on: true,
    points: [
      { tick: 0, value: 0.25, bend: 0 },
      { tick: 2 * BAR, value: 0.75, bend: 0 },
    ],
  };
  const grid: DocumentPart = {
    ...AUTOMATION_PART,
    sequencer: { kind: 'grid', ...DEFAULT_GRID_CONFIG },
    automation: [skip],
  };

  it('locks on its field while the part’s kind offers it, in the sequencer colour', () => {
    expect(seqKnobAutomation(grid, 'skipChance', 0, COLORS)).toEqual({
      color: 'rose',
      value: 0.25,
    });
    expect(seqKnobAutomation(grid, 'skipChance', BAR)?.value).toBeCloseTo(0.5);
    expect(seqKnobAutomation(grid, 'skipChance', 0)?.color).toBe(LANE_KIND_COLOR.seq);
  });

  it('is free while its lane is off, and under a kind that offers the field none', () => {
    const off = { ...grid, automation: [{ ...skip, on: false }] };
    expect(seqKnobAutomation(off, 'skipChance', 0)).toBeNull();
    const chord: DocumentPart = { ...grid, sequencer: { kind: 'chord', ...DEFAULT_CHORD_CONFIG } };
    expect(seqKnobAutomation(chord, 'skipChance', 0)).toBeNull();
    expect(seqKnobAutomation(grid, 'gate', 0)).toBeNull();
  });

  it('knows the three sequencer fields and no others', () => {
    expect(['gate', 'skipChance', 'density', 'accentVelocity'].filter(isSeqField)).toEqual([
      'gate',
      'skipChance',
      'density',
    ]);
  });
});

describe('a knob a macro mapping holds (windsor#561)', () => {
  // Accent maps the cutoff 400 Hz .. 3.2 kHz, Exp, at 0.35: it plays 437 Hz (the mockup's).
  const macros = [
    makeMacro({ name: 'Wobble', value: 0.62 }),
    makeMacro({
      name: 'Accent',
      value: 0.35,
      mappings: [{ target: 'filter.cutoff', min: 400, max: 3200, curve: 1 }],
    }),
  ];

  it('locks under its macro’s name at the value the mapping plays, over the lane on it', () => {
    const lock = patchKnobAutomation(AUTOMATION_PART, macros, 'filter.cutoff', 0, COLORS);
    expect(lock?.macro).toBe('Accent');
    expect(lock?.color).toBe('amber');
    expect(lock?.value).toBeCloseTo(437.3, 1);
    expect(lockTagText(lock)).toBe('Accent');
  });

  it('follows a lane on its macro, and frees once the mapping goes', () => {
    const lane: AutomationLane = {
      target: 'voice.macros.1.value',
      on: true,
      points: [{ tick: 0, value: 1, bend: 0 }],
    };
    const part = withLanes([...(AUTOMATION_PART.automation ?? []), lane]);
    expect(patchKnobAutomation(part, macros, 'filter.cutoff', 0)?.value).toBeCloseTo(3200, 6);
    expect(patchKnobAutomation(part, macros, 'macros.1.value', 0, COLORS)).toEqual({
      color: 'amber',
      value: 1,
    });
    const unmapped = [macros[0]!, makeMacro({ name: 'Accent', value: 0.35 })];
    expect(patchKnobAutomation(AUTOMATION_PART, unmapped, 'filter.cutoff', 0, COLORS)).toEqual(
      voiceKnobAutomation(AUTOMATION_PART, 'filter.cutoff', 0, COLORS),
    );
    expect(patchKnobAutomation(AUTOMATION_PART, unmapped, 'filter.resonance', 0)).toBeNull();
  });
});

describe('the lock’s wording and change check', () => {
  it('names the knob in the press notice and the readout', () => {
    expect(lockedKnobNotice('Cutoff')).toBe(
      'Cutoff is automated in the song. Switch its lane off to edit it.',
    );
    expect(automatedValueText('1.20 kHz')).toBe('1.20 kHz, automated');
    expect(lockNotice('Cutoff', { color: 'amber', value: 400, macro: 'Accent' })).toBe(
      'Cutoff is driven by the macro Accent. Remove its mapping to edit it.',
    );
    expect(lockTagText({ color: 'amber', value: 400 })).toBe('AUTO');
  });

  it('redraws only on a change of lock, colour or value', () => {
    const a = { color: 'teal', value: 0.5 };
    expect(sameKnobAutomation(null, null)).toBe(true);
    expect(sameKnobAutomation(a, { ...a })).toBe(true);
    expect(sameKnobAutomation(a, null)).toBe(false);
    expect(sameKnobAutomation(a, { ...a, value: 0.6 })).toBe(false);
    expect(sameKnobAutomation(a, { ...a, color: 'amber' })).toBe(false);
    expect(sameKnobAutomation(a, { ...a, macro: 'Accent' })).toBe(false);
  });
});

describe('the playhead past the song’s end', () => {
  const doc = AUTOMATION_DOCUMENT;
  const songTicks = songTicksOf(doc);
  /** Where the hat's Level knob stands at the transport's `position`. */
  const levelAt = (position: number): number | undefined =>
    catalogKnobAutomation(AUTOMATION_PART, 'strip.level', knobSongTick(doc, position))?.value;

  it('folds the transport’s tick by the song’s length, as the engine plays it', () => {
    expect(knobSongTick(doc, BAR)).toBe(BAR);
    expect(knobSongTick(doc, songTicks)).toBe(0);
    expect(knobSongTick(doc, 2 * songTicks + BAR)).toBe(BAR);
  });

  it('starts a locked knob’s lane again after the song wraps', () => {
    expect(levelAt(songTicks - 1)).toBe(1);
    expect(levelAt(songTicks)).toBe(0.5);
    expect(levelAt(songTicks + BAR)).toBe(levelAt(BAR));
    expect(levelAt(songTicks + BAR)).toBeLessThan(1);
  });

  it('reads inside a loop brace whose clock jumped back on a later pass', () => {
    const loop = { start: BAR, end: 2 * BAR, songTicks };
    const jumped = followingTick(songTicks + 2 * BAR - 1, loop);
    expect(jumped).toBe(songTicks + BAR);
    expect(levelAt(jumped)).toBe(levelAt(BAR));
  });

  it('folds an insert knob’s tick the same way', () => {
    const tape = insertAt(AUTOMATION_PART, AUTOMATION_TAPE_ID);
    const at = (position: number): number | undefined =>
      insertKnobAutomation(AUTOMATION_PART, tape, 'drive', knobSongTick(doc, position))?.value;
    expect(at(songTicks)).toBe(-6);
    expect(at(songTicks + 2 * BAR)).toBe(at(2 * BAR));
  });
});
