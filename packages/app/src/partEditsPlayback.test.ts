/**
 * A card's region edit is what plays (windsor#75 fix round 2, over the
 * player of windsor#74): the console writes an edit into one region through
 * `regionPatternChange`, and the engine's `ArrangementPlayer` — driven by
 * its own test rig — plays the part's pattern in the untouched region and
 * the edited copy in the other. Each window is compared against the same
 * song with that pattern on the whole part, so nothing here restates how a
 * chord is voiced or a figure is timed; the tick checks are what Pat hears.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, ChordStep, SequencerSpec } from '@windsor/engine';
import { PPQ, TICKS_PER_BAR, partAt, regionPattern } from '@windsor/engine';
import { CHORD_PATTERN_A } from '@windsor/engine/__fixtures__/documentCases';
import {
  FULL_DOCUMENT,
  FULL_PARTS,
  FULL_SLOT,
  type FullPartId,
  withDocumentPart,
} from '@windsor/engine/__fixtures__/fullArrangement';
import { rig } from '@windsor/engine/__fixtures__/playerRig';
import { kinds, type RecordingPart } from '@windsor/engine/__fixtures__/recordingPart';
import { HALF, SONG, halves, tickOf } from '@windsor/engine/__fixtures__/regionPatternSongs';
import { DocumentModel } from './documentModel';
import { regionPatternChange } from './partEdits';

const BAR = TICKS_PER_BAR;

/** The fixture song with the part on `id` playing `sequencer` in two regions, bars 1–2 and 3–4, neither with a pattern. */
function twoRegions(id: FullPartId, sequencer: SequencerSpec): DocumentModel {
  return new DocumentModel(withDocumentPart(FULL_DOCUMENT, id, { regions: halves(), sequencer }));
}

/** Apply one card edit to the second region, as the card does. */
function editSecond(model: DocumentModel, id: FullPartId, fields: Record<string, unknown>): void {
  const partial = regionPatternChange(model.doc, FULL_SLOT[id], 1, fields);
  if (!partial) throw new Error('the edit was refused');
  model.merge(partial);
}

/** The same song with `spec` on the whole part, in both regions: what that pattern alone plays. */
const alone = (doc: ArrangementDocument, id: FullPartId, spec: SequencerSpec) =>
  withDocumentPart(doc, id, { regions: halves(), sequencer: spec });

/** The part's timed calls of `kind` on ticks `[from, to)`, as tick and note. */
function heard(
  part: RecordingPart,
  kind: 'noteOn' | 'trigger',
  from: number,
  to: number,
): Array<[number, number | undefined]> {
  return kinds(part, kind)
    .map((c): [number, number | undefined] => [tickOf(c.time), c.note])
    .filter(([tick]) => tick >= from && tick < to);
}

/** Play `doc` for the whole song and return the part on `id`. */
function play(doc: ArrangementDocument, id: FullPartId): RecordingPart {
  const r = rig(doc);
  r.run(SONG / BAR);
  return r.parts[id];
}

describe('a chord region edited through the card plays its own pattern', () => {
  const four: ChordStep[] = Array.from({ length: 4 }, () => ({
    kind: 'hit',
    duration: 1,
    repeat: 1,
    inversion: 2,
    octave: 0,
  }));

  it("plays the part's one hit a bar in region 1 and the four inversion-2 hits in region 2", () => {
    const base = CHORD_PATTERN_A as unknown as SequencerSpec;
    const model = twoRegions('drone', base);
    editSecond(model, 'drone', { steps: four, divisor: PPQ });
    const part = partAt(model.doc, FULL_SLOT.drone);
    if (!part) throw new Error('no drone part');
    expect(part.sequencer).toEqual(base);

    const played = play(model.doc, 'drone');
    const first = heard(played, 'noteOn', 0, HALF);
    const second = heard(played, 'noteOn', HALF, SONG);
    // Region 1: the part's own pattern, one hit on each bar.
    expect([...new Set(first.map(([tick]) => tick))]).toEqual([0, BAR]);
    expect(first).toEqual(heard(play(alone(model.doc, 'drone', base), 'drone'), 'noteOn', 0, HALF));
    // Region 2: the edited copy, a hit on every quarter.
    const quarters = Array.from({ length: (SONG - HALF) / PPQ }, (_, i) => HALF + i * PPQ);
    expect([...new Set(second.map(([tick]) => tick))]).toEqual(quarters);
    const edited = regionPattern(part, 1);
    const reference = play(alone(model.doc, 'drone', edited), 'drone');
    expect(second).toEqual(heard(reference, 'noteOn', HALF, SONG));
    // Not what the part's own pattern would have played there.
    const unedited = heard(play(alone(model.doc, 'drone', base), 'drone'), 'noteOn', HALF, SONG);
    expect(second).not.toEqual(unedited);
  });
});

describe('a euclid region edited through the card plays its own figure', () => {
  it("triggers the part's figure in region 1 and the captured figure in region 2", () => {
    const base = FULL_PARTS.kick.sequencer;
    const model = twoRegions('kick', base);
    // The card's click-to-toggle capture: a fixed figure, one onset every third step.
    const figure = Array.from({ length: base.steps }, (_, i) => i % 3 === 0);
    editSecond(model, 'kick', { pattern: figure });
    const part = partAt(model.doc, FULL_SLOT.kick);
    if (!part) throw new Error('no kick part');
    expect(part.sequencer).toEqual(base);

    const played = play(model.doc, 'kick');
    const unedited = play(alone(model.doc, 'kick', base), 'kick');
    expect(heard(played, 'trigger', 0, HALF)).toEqual(heard(unedited, 'trigger', 0, HALF));
    const second = heard(played, 'trigger', HALF, SONG);
    const onsets = Array.from({ length: (SONG - HALF) / base.divisor }, (_, i) => i)
      .filter((i) => figure[i % base.steps])
      .map((i) => HALF + i * base.divisor);
    expect(second.map(([tick]) => tick)).toEqual(onsets);
    expect(second).not.toEqual(heard(unedited, 'trigger', HALF, SONG));
  });
});
