/**
 * The Song view's automation lanes, the pure part (windsor#348; record
 * `2026-10-01-song-automation-lanes`): the picker's groups and what it
 * disables, a new lane flat at the parameter's current value, on/off and
 * delete through the document, the names, the inactive fields and the
 * lane count.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_DOCUMENT,
  AUTOMATION_EQ_ID,
  AUTOMATION_PART,
  AUTOMATION_TAPE_ID,
} from '@windsor/engine/__fixtures__/automationSong';
import {
  DEFAULT_DELAY,
  DEFAULT_TAPE,
  FM_LANES_MAX,
  STRIP_AUTOMATION_ROWS,
  TICKS_PER_BAR,
  VOICE_AUTOMATION_ROWS,
  catalogRow,
  formatTargetId,
  targetKind,
  type AutomationLane,
  type AutomationTargetId,
  type AutomationTargetRow,
  type DocumentPart,
  type InsertSpec,
} from '@windsor/engine';
import { DocumentModel } from './documentModel';
import {
  automationChange,
  automationSignature,
  currentValue,
  insertLabels,
  laneActivity,
  laneCountLabel,
  laneTitle,
  lanesOf,
  newLane,
  pickerGroups,
  toggledLane,
  voiceCountLabel,
  withLane,
  withoutLane,
} from './songAutomationModel';

const SLOT = AUTOMATION_PART.slot;
const tapeTarget = (field: string): AutomationTargetId =>
  formatTargetId({ kind: 'insert', insertId: AUTOMATION_TAPE_ID, field });
const TAPE_DRIVE = tapeTarget('drive');
const TAPE_WEAR = tapeTarget('wear');
const TAPE_WOW = tapeTarget('wow');
const isVoice = (target: AutomationTargetId): boolean => targetKind(target) === 'voice';

/** `AUTOMATION_PART` with `inserts` on its strip and `lanes` as its automation. */
const partWith = (
  inserts: readonly InsertSpec[],
  lanes: readonly AutomationLane[] = [],
): DocumentPart => ({
  ...AUTOMATION_PART,
  strip: { ...AUTOMATION_PART.strip, inserts },
  automation: lanes,
});

const flat = (target: AutomationTargetId): AutomationLane => newLane(target, 0, TICKS_PER_BAR);
const row = (target: string): AutomationTargetRow => catalogRow(target)!;

describe('the picker', () => {
  const groups = pickerGroups(AUTOMATION_PART);
  const labels = groups.map((g) => g.label);

  it('lists Mixer, then one group per insert, then the voice groups (decision 4)', () => {
    expect(labels).toEqual([
      'Mixer',
      'Insert · Tape',
      'Insert · Parametric EQ',
      'Voice · Filter',
      'Voice · Op A',
      'Voice · Op B',
      'Voice · Op C',
      'Voice · Op D',
      'Voice · LFO',
      'Voice · Pitch',
    ]);
  });

  it('offers every strip and voice target once', () => {
    const targets = groups.flatMap((g) => g.options.map((o) => o.target));
    for (const r of [...STRIP_AUTOMATION_ROWS, ...VOICE_AUTOMATION_ROWS]) {
      expect(
        targets.filter((t) => t === r.target),
        r.target,
      ).toHaveLength(1);
    }
  });

  it('lists Vowel last in Voice · Filter, whatever the filter mode (windsor#406)', () => {
    const filter = groups.find((g) => g.label === 'Voice · Filter')!.options;
    expect(filter.at(-1)).toEqual({
      target: 'voice.filter.vowel',
      label: 'Vowel',
      disabled: false,
    });
  });

  it("groups the voice's options by the catalog's section, in its order (windsor#436)", () => {
    const operator = (name: string): readonly [string, string[]] => [
      `Voice · Op ${name}`,
      ['Level', 'Decay', 'Dcy Crv', 'Fdbk', 'Width'].map((f) => `Op ${name} ${f}`),
    ];
    const bare = pickerGroups(partWith([]));
    expect(bare.map((g) => [g.label, g.options.map((o) => o.label)])).toEqual([
      ['Mixer', ['Level', 'Pan', 'Send A', 'Send B']],
      ['Voice · Filter', ['Cutoff', 'Filt Env Amt', 'Resonance', 'Filter Decay', 'Vowel']],
      ...['A', 'B', 'C', 'D'].map(operator),
      ['Voice · LFO', ['LFO 1 Amt', 'LFO 1 Rate', 'LFO 2 Amt', 'LFO 2 Rate']],
      ['Voice · Pitch', ['Pitch Env']],
    ]);
    expect(bare.flatMap((g) => g.options.map((o) => o.target))).toEqual([
      ...STRIP_AUTOMATION_ROWS.map((r) => r.target),
      ...VOICE_AUTOMATION_ROWS.map((r) => r.target),
    ]);
  });

  it("lists only the fields an insert's settings leave read", () => {
    const tape = groups.find((g) => g.label === 'Insert · Tape')!.options.map((o) => o.target);
    expect(tape).toContain(TAPE_DRIVE);
    expect(tape).toContain(TAPE_WEAR);
    expect(tape).not.toContain(TAPE_WOW);
    const split = pickerGroups(partWith([{ ...DEFAULT_TAPE, split: true, id: 't' }]));
    const splitTape = split[1]!.options.map((o) => o.target);
    expect(splitTape).toContain('insert.t.wow');
    expect(splitTape).not.toContain('insert.t.wear');
  });

  it('disables a target that already has a lane', () => {
    const mixer = groups[0]!.options;
    expect(mixer.find((o) => o.target === 'strip.level')?.disabled).toBe(true);
    expect(mixer.find((o) => o.target === 'strip.pan')?.disabled).toBe(true);
    expect(mixer.find((o) => o.target === 'strip.send.a')?.disabled).toBe(false);
    const voice = groups.flatMap((g) => g.options).filter((o) => isVoice(o.target));
    expect(voice.find((o) => o.target === 'voice.filter.cutoff')?.disabled).toBe(true);
    expect(voice.find((o) => o.target === 'voice.filter.resonance')?.disabled).toBe(false);
  });

  it(`disables every voice target at ${FM_LANES_MAX} voice lanes, and nothing else`, () => {
    const lanes = VOICE_AUTOMATION_ROWS.slice(0, FM_LANES_MAX).map((r) => flat(r.target));
    const full = pickerGroups(partWith(AUTOMATION_PART.strip.inserts, lanes));
    const options = full.flatMap((g) => g.options);
    expect(options.filter((o) => isVoice(o.target)).every((o) => o.disabled)).toBe(true);
    expect(options.filter((o) => !isVoice(o.target)).some((o) => o.disabled)).toBe(false);
    expect(voiceCountLabel(lanes)).toBe(`Voice ${FM_LANES_MAX}/${FM_LANES_MAX}`);
    expect(voiceCountLabel(lanesOf(AUTOMATION_PART))).toBe('Voice 2/8');
  });

  it('numbers two inserts of one kind', () => {
    const inserts = [
      { ...DEFAULT_DELAY, id: 'd1' },
      { ...DEFAULT_TAPE, id: 't1' },
      { ...DEFAULT_DELAY, id: 'd2' },
    ];
    expect([...insertLabels(inserts).values()]).toEqual(['Dub delay 1', 'Tape', 'Dub delay 2']);
    expect(pickerGroups(partWith(inserts)).map((g) => g.label)).toContain('Insert · Dub delay 2');
  });
});

describe('a lane', () => {
  it('is named with its kind line: Mixer, the insert, the voice group', () => {
    expect(laneTitle(AUTOMATION_PART, 'strip.level')).toEqual({
      name: 'Level',
      kindLine: 'Mixer',
      kind: 'strip',
    });
    expect(laneTitle(AUTOMATION_PART, TAPE_DRIVE)).toEqual({
      name: 'Drive',
      kindLine: 'Tape',
      kind: 'insert',
    });
    const eq = formatTargetId({
      kind: 'insert',
      insertId: AUTOMATION_EQ_ID,
      field: 'bands.0.freq',
    });
    expect(laneTitle(AUTOMATION_PART, eq).kindLine).toBe('Parametric EQ');
    expect(laneTitle(AUTOMATION_PART, 'voice.filter.cutoff')).toEqual({
      name: 'Cutoff',
      kindLine: 'Voice · Filter',
      kind: 'voice',
    });
    expect(laneTitle(AUTOMATION_PART, 'voice.ops.1.width').kindLine).toBe('Voice · Op B');
    expect(laneTitle(AUTOMATION_PART, 'voice.ops.3.feedback')).toEqual({
      name: 'Op D Fdbk',
      kindLine: 'Voice · Op D',
      kind: 'voice',
    });
    expect(laneTitle(AUTOMATION_PART, 'voice.lfo2.amount').kindLine).toBe('Voice · LFO');
    expect(laneTitle(AUTOMATION_PART, 'voice.pitchEnvAmount')).toEqual({
      name: 'Pitch Env',
      kindLine: 'Voice · Pitch',
      kind: 'voice',
    });
  });

  it('starts flat at the value from tick 0 to the song end, on (decision 4)', () => {
    expect(newLane('strip.pan', 0.25, 4 * TICKS_PER_BAR)).toEqual({
      target: 'strip.pan',
      on: true,
      points: [
        { tick: 0, value: 0.25, bend: 0 },
        { tick: 4 * TICKS_PER_BAR, value: 0.25, bend: 0 },
      ],
    });
  });
});

describe("a parameter's current value", () => {
  const patch = AUTOMATION_DOCUMENT.patches?.[AUTOMATION_PART.preset];

  it('reads the strip, a send the strip lacks as silent', () => {
    expect(currentValue(AUTOMATION_PART, patch, 'strip.level')).toBe(AUTOMATION_PART.strip.level);
    expect(currentValue(AUTOMATION_PART, patch, 'strip.pan')).toBe(AUTOMATION_PART.strip.pan);
    expect(currentValue(AUTOMATION_PART, patch, 'strip.send.b')).toBe(0.2);
    expect(currentValue(AUTOMATION_PART, patch, 'strip.send.a')).toBe(0);
  });

  it("clamps to the lane's range: a level past the knob's +6 dB reads the top", () => {
    const loud = { ...AUTOMATION_PART, strip: { ...AUTOMATION_PART.strip, level: 3 } };
    expect(currentValue(loud, patch, 'strip.level')).toBe(row('strip.level').max);
  });

  it("reads the insert's spec and the part's patch", () => {
    expect(currentValue(AUTOMATION_PART, patch, TAPE_DRIVE)).toBe(DEFAULT_TAPE.drive);
    expect(patch).toBeDefined();
    expect(currentValue(AUTOMATION_PART, patch, 'voice.filter.cutoff')).toBe(patch!.filter.cutoff);
    expect(currentValue(AUTOMATION_PART, patch, 'voice.ops.2.width')).toBe(patch!.ops[2]!.width);
  });
});

describe('the edits, through the document', () => {
  const lanes = lanesOf(AUTOMATION_PART);
  const after = (next: AutomationLane[]): readonly AutomationLane[] => {
    const model = new DocumentModel(AUTOMATION_DOCUMENT);
    model.merge(automationChange(SLOT, next));
    return model.doc.parts.find((p) => p.slot === SLOT)?.automation ?? [];
  };

  it('adds a lane, and refuses a second on one target', () => {
    const added = newLane('strip.send.a', 0.3, AUTOMATION_DOCUMENT.transport.bars * TICKS_PER_BAR);
    const next = withLane(lanes, added);
    expect(after(next)).toEqual([...lanes, added]);
    expect(withLane(next, added)).toEqual(next);
  });

  it('switches a lane off and back on', () => {
    const off = toggledLane(lanes, 'strip.level');
    expect(after(off).find((l) => l.target === 'strip.level')?.on).toBe(false);
    expect(toggledLane(off, 'strip.level')).toEqual(lanes);
  });

  it('deletes a lane, and the last leaves the part with none', () => {
    expect(after(withoutLane(lanes, 'strip.pan')).map((l) => l.target)).not.toContain('strip.pan');
    const model = new DocumentModel(AUTOMATION_DOCUMENT);
    model.merge(automationChange(SLOT, []));
    expect(model.doc.parts.find((p) => p.slot === SLOT)?.automation).toBeUndefined();
  });
});

describe('an inactive insert field', () => {
  it('says why, by its kind', () => {
    const split = partWith([{ ...DEFAULT_TAPE, split: true, id: AUTOMATION_TAPE_ID }]);
    expect(laneActivity(split, TAPE_WEAR)).toEqual({
      active: false,
      why: "Wear is inactive while Tape's motion is split",
    });
    expect(laneActivity(AUTOMATION_PART, TAPE_WOW)).toEqual({
      active: false,
      why: "Wow is inactive while Tape's motion is not split",
    });
  });

  it('leaves a read field, a strip lane and a voice lane active', () => {
    expect(laneActivity(AUTOMATION_PART, TAPE_DRIVE).active).toBe(true);
    expect(laneActivity(AUTOMATION_PART, 'strip.level').active).toBe(true);
    expect(laneActivity(AUTOMATION_PART, 'voice.filter.cutoff').active).toBe(true);
  });
});

describe('the folded badge', () => {
  it('counts the lanes for the folded badge', () => {
    expect(laneCountLabel(1)).toBe('1 lane');
    expect(laneCountLabel(2)).toBe('2 lanes');
  });
});

describe('the repaint signature', () => {
  it('is nothing for a folded part with no lanes', () => {
    expect(automationSignature(partWith([]), false)).toBeNull();
    expect(automationSignature(partWith([]), true)).not.toBeNull();
  });

  it('follows the lanes and a switch that changes what an insert reads, not a knob', () => {
    const tape = { ...DEFAULT_TAPE, id: AUTOMATION_TAPE_ID };
    const base = JSON.stringify(
      automationSignature(partWith([tape], lanesOf(AUTOMATION_PART)), false),
    );
    const turned = partWith([{ ...tape, drive: tape.drive + 1 }], lanesOf(AUTOMATION_PART));
    expect(JSON.stringify(automationSignature(turned, false))).toBe(base);
    const split = partWith([{ ...tape, split: true }], lanesOf(AUTOMATION_PART));
    expect(JSON.stringify(automationSignature(split, false))).not.toBe(base);
    const off = partWith([tape], toggledLane(lanesOf(AUTOMATION_PART), 'strip.level'));
    expect(JSON.stringify(automationSignature(off, false))).not.toBe(base);
  });
});
