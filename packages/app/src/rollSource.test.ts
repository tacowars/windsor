/**
 * What an open Roll watches (windsor#708 decision 9): a song voice lane on
 * another target, added and then deleted on the Song timeline, changes the
 * roll's read, so the card repaints and its Envelopes tab's `Voice n/8` and
 * picker follow, though the roll itself is untouched.
 */
import { describe, expect, it } from 'vitest';

import type { RollEnvelope } from '@windsor/engine';
import { TICKS_PER_BAR, partAt, voiceTargetId } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { sequencerKindChange } from './partEdits';
import { envelopePicker, voiceTargetGroups } from './rollEnvelopePicker';
import { readRollSource, sameInputs, sourceKey } from './rollSource';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const CUTOFF: RollEnvelope = { target: 'filter.cutoff', on: true, points: [] };
const ROLL = { kind: 'roll', loopTicks: BAR, notes: [], envelopes: [CUTOFF] };

/** A song whose part 0 is a Roll with one region holding a Cutoff envelope. */
function rollSong(): DocumentModel {
  const model = new DocumentModel(newSong());
  const partial = sequencerKindChange(model.doc, 0, 'roll', (raw) => model.preview(raw));
  if (partial) model.merge(partial);
  model.merge({ parts: { 0: { regions: [{ start: 0, duration: BAR, pattern: ROLL }] } } });
  return model;
}

/** The Envelopes tab's voice slot count, as its picker reads it. */
function slots(model: DocumentModel): number {
  const part = partAt(model.doc, 0)!;
  const groups = voiceTargetGroups(part);
  return envelopePicker({ groups, envelopes: [CUTOFF], part, shown: null }).slots;
}

describe('an open Roll beside the Song timeline', () => {
  it('sees a voice lane on another target added, then deleted', () => {
    const model = rollSong();
    const before = readRollSource(model.doc, 0, 0);
    expect(slots(model)).toBe(1);

    const lane = { target: voiceTargetId('filter.resonance'), on: true, points: [] };
    model.merge({
      parts: { 0: { automation: [{ ...lane, points: [{ tick: 0, value: 2, bend: 0 }] }] } },
    });
    const added = readRollSource(model.doc, 0, 0);
    expect(sameInputs(added, before)).toBe(false);
    expect(sourceKey(added)).not.toBe(sourceKey(before));
    expect(slots(model)).toBe(2);

    model.merge({ parts: { 0: { automation: [] } } });
    const removed = readRollSource(model.doc, 0, 0);
    expect(sourceKey(removed)).toBe(sourceKey(before));
    expect(slots(model)).toBe(1);
  });
});
