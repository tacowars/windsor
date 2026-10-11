/**
 * The envelope picker's rules (windsor#707 decisions 4 and 5): the Song
 * tab's voice sections and nothing else, the marked targets first in the
 * roll's order, the cap of four envelopes, and the eight voice slots
 * shared with the part's song voice lanes.
 */
import { describe, expect, it } from 'vitest';

import type { AutomationTargetId, RollEnvelope, VoiceTargetPath } from '@windsor/engine';
import { DEFAULT_ROLL_CONFIG, FM_LANES_MAX, partAt } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import type { VoiceSlotPart } from './partVoiceSlots';
import { newSong } from './songParts';
import {
  type EnvelopeTargetGroup,
  envelopePicker,
  shownEnvelope,
  voiceTargetGroups,
} from './rollEnvelopePicker';

const GROUPS: EnvelopeTargetGroup[] = [
  {
    label: 'Voice · Filter',
    targets: [
      { path: 'filter.cutoff', label: 'Cutoff' },
      { path: 'filter.resonance', label: 'Resonance' },
      { path: 'filter.envAmount', label: 'Filt Env Amt' },
    ],
  },
  {
    label: 'Voice · Op A',
    targets: [
      { path: 'ops.0.level', label: 'Op A Level' },
      { path: 'ops.0.ratio', label: 'Op A Ratio' },
    ],
  },
];

const env = (target: VoiceTargetPath, on = true): RollEnvelope => ({ target, on, points: [] });
/** A part with song voice lanes on `lanes` and a roll holding `envelopes`. */
const partOf = (lanes: readonly string[], envelopes: readonly RollEnvelope[]): VoiceSlotPart => ({
  automation: lanes.map((path) => ({
    target: `voice.${path}` as AutomationTargetId,
    on: true,
    points: [],
  })),
  sequencer: { kind: 'roll', ...DEFAULT_ROLL_CONFIG, envelopes },
  regions: [],
});
const paths = (picker: ReturnType<typeof envelopePicker>): string[][] =>
  picker.groups.map((group) => group.targets.map((t) => t.path));

describe('the envelope picker (windsor#707)', () => {
  it('offers the Song tab’s voice sections only, macros included, no mixer or insert row', () => {
    const part = partAt(new DocumentModel(newSong()).doc, 0);
    if (!part) throw new Error('no part');
    const groups = voiceTargetGroups(part);
    const all = groups.flatMap((g) => g.targets.map((t) => t.path));
    expect(groups[0]).toMatchObject({ label: 'Voice · Filter' });
    expect(all).toContain('filter.cutoff');
    expect(all.every((path) => !path.startsWith('strip.') && !path.startsWith('insert.'))).toBe(
      true,
    );
  });

  it('lists the marked targets first, in the roll’s order, and leaves them out of their sections', () => {
    const envelopes = [env('ops.0.level', false), env('filter.cutoff')];
    const picker = envelopePicker({
      groups: GROUPS,
      envelopes,
      part: partOf([], envelopes),
      shown: 'filter.cutoff',
    });
    expect(picker.marked).toEqual([
      { path: 'ops.0.level', label: 'Op A Level', on: false, shown: false },
      { path: 'filter.cutoff', label: 'Cutoff', on: true, shown: true },
    ]);
    expect(paths(picker)).toEqual([['filter.resonance', 'filter.envAmount'], ['ops.0.ratio']]);
    expect(picker.groups.flatMap((g) => g.targets).every((t) => t.refused === null)).toBe(true);
  });

  it('marks an added target and lists it first', () => {
    const before = envelopePicker({ groups: GROUPS, envelopes: [], part: undefined, shown: null });
    expect(before.marked).toEqual([]);
    const after = envelopePicker({
      groups: GROUPS,
      envelopes: [env('filter.resonance')],
      part: partOf([], [env('filter.resonance')]),
      shown: 'filter.resonance',
    });
    expect(after.marked.map((t) => t.path)).toEqual(['filter.resonance']);
    expect(paths(after)[0]).toEqual(['filter.cutoff', 'filter.envAmount']);
  });

  it('refuses a fifth envelope: at four, every target without one is disabled', () => {
    const envelopes = [
      env('filter.cutoff'),
      env('filter.resonance'),
      env('ops.0.level'),
      env('ops.0.ratio'),
    ];
    const part = partOf([], envelopes);
    const picker = envelopePicker({ groups: GROUPS, envelopes, part, shown: null });
    expect(picker.envFull).toBe(true);
    expect(picker.groups.flatMap((g) => g.targets)).toEqual([
      { path: 'filter.envAmount', label: 'Filt Env Amt', lane: false, refused: 'envFull' },
    ]);
  });

  it('disables a ninth distinct voice target, counting the part’s song voice lanes', () => {
    // Six song lanes, one of them on Resonance, and two envelopes: 8 of 8.
    const lanes = [
      'filter.resonance',
      'filter.vowel',
      'ops.1.level',
      'ops.1.ratio',
      'ops.2.level',
      'pitchEnvAmount',
    ];
    const envelopes = [env('filter.cutoff'), env('ops.0.level')];
    const part = partOf(lanes, envelopes);
    const picker = envelopePicker({ groups: GROUPS, envelopes, part, shown: null });
    expect(picker.slots).toBe(8);
    expect(picker.slotsFull).toBe(true);
    expect(picker.envFull).toBe(false);
    const open = picker.groups.flatMap((g) => g.targets);
    // Resonance's lane already holds its slot, which an envelope shares: open, tagged.
    expect(open.find((t) => t.path === 'filter.resonance')).toMatchObject({
      lane: true,
      refused: null,
    });
    expect(open.find((t) => t.path === 'filter.envAmount')?.refused).toBe('slotsFull');
    expect(open.find((t) => t.path === 'ops.0.ratio')?.refused).toBe('slotsFull');
  });

  it('counts a target held by both a lane and an envelope once', () => {
    const envelopes = [env('filter.cutoff')];
    const part = partOf(['filter.cutoff'], envelopes);
    const picker = envelopePicker({ groups: GROUPS, envelopes, part, shown: null });
    expect(picker.slots).toBe(1);
  });

  it('shows the chosen envelope, else the first, else none', () => {
    const envelopes = [env('filter.cutoff'), env('ops.0.level')];
    expect(shownEnvelope(envelopes, 'ops.0.level')?.target).toBe('ops.0.level');
    expect(shownEnvelope(envelopes, 'filter.vowel')?.target).toBe('filter.cutoff');
    expect(shownEnvelope([], 'filter.cutoff')).toBeNull();
  });

  it('counts another region’s envelopes: 7 lanes and 1 envelope elsewhere fill the slots', () => {
    // Seven song lanes, none on the picker's targets, and Op A Level's envelope in a region's
    // pattern; this roll holds none. Only a target already in the part's slots stays open.
    const lanes = ['filter.vowel', 'ops.1.level', 'ops.1.ratio', 'ops.2.level', 'ops.2.ratio'];
    const part: VoiceSlotPart = {
      ...partOf([...lanes, 'pitchEnvAmount', 'filter.resonance'], []),
      regions: [
        {
          start: 0,
          duration: 96,
          pattern: { kind: 'roll', ...DEFAULT_ROLL_CONFIG, envelopes: [env('ops.0.level')] },
        },
      ],
    };
    const picker = envelopePicker({ groups: GROUPS, envelopes: [], part, shown: null });
    expect(picker.slots).toBe(FM_LANES_MAX);
    const refused = Object.fromEntries(
      picker.groups.flatMap((g) => g.targets).map((t) => [t.path, t.refused]),
    );
    expect(refused).toEqual({
      'filter.cutoff': 'slotsFull',
      'filter.resonance': null,
      'filter.envAmount': 'slotsFull',
      'ops.0.level': null,
      'ops.0.ratio': 'slotsFull',
    });
  });
});
