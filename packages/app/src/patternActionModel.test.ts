/**
 * The pattern actions (windsor#827): what each kind offers, the rules that
 * turn a button off, and the writes that differ from a plain pattern merge
 * (the seed, the Euclid capture's toast, the Roll's Quantize step). The card
 * and the region menu both run `patternEdit`, so no parity test is needed.
 */
import { describe, expect, it } from 'vitest';

import type { GridSpec, NoteEvent, RollNote, SequencerKind } from '@windsor/engine';
import {
  DIVISORS,
  GridSequencer,
  ScaleSampler,
  TICKS_PER_BAR,
  gridNote,
  partAt,
  regionPattern,
} from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { reverseGrid } from './gridModel';
import type { ActionReads, PatternAction } from './patternActionModel';
import { actionBlocked, offeredActions, patternEdit } from './patternActionModel';
import { regionPatternChange, sequencerKindChange } from './partEdits';
import { ROLL_SNAP_OFF_TICKS } from './rollTables';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const SIXTEENTH = 6;
/** A 16-step figure: hits on steps 1 and 4. */
const FIGURE = Array.from({ length: 16 }, (_, i) => i === 0 || i === 3);

/** A new song whose part 0 is a `kind` part with one 4-bar region. */
function songWith(kind: SequencerKind): DocumentModel {
  const model = new DocumentModel(newSong());
  const partial = sequencerKindChange(model.doc, 0, kind, (raw) => model.preview(raw));
  if (partial) model.merge(partial);
  model.merge({ parts: { 0: { regions: [{ start: 0, duration: 4 * BAR }] } } });
  return model;
}

const reads = (over: Partial<ActionReads> = {}): ActionReads => ({
  random: () => 0.25,
  chord: () => null,
  figure: () => FIGURE,
  rollFrame: () => ({ loop: BAR, region: 4 * BAR, snap: SIXTEENTH }),
  ...over,
});

const run = (model: DocumentModel, action: PatternAction, over: Partial<ActionReads> = {}) =>
  patternEdit(action, { doc: model.doc, slot: 0, region: 0, reads: reads(over) });

describe('what each card offers', () => {
  it('lists the cards’ buttons in their order, and none on Chord or no sequencer', () => {
    for (const kind of ['grid', 'arp', 'bass', 'figure'] as const) {
      expect(offeredActions(kind), kind).toEqual(['randomize', 'reverse', 'reseed']);
    }
    expect(offeredActions('euclidean')).toEqual(['capture']);
    expect(offeredActions('roll')).toEqual(['quantize']);
    expect(offeredActions('chord')).toEqual([]);
    expect(offeredActions('none')).toEqual([]);
  });

  it('refuses an action the kind doesn’t offer', () => {
    expect(run(songWith('chord'), 'reseed')).toBeNull();
    expect(run(songWith('grid'), 'capture')).toBeNull();
  });
});

describe('the writes', () => {
  it('Reverse writes the reversed steps into the region, as the Grid card did', () => {
    const model = songWith('grid');
    const part = partAt(model.doc, 0);
    if (!part) throw new Error('no part');
    const spec = regionPattern(part, 0);
    if (spec.kind !== 'grid') throw new Error('not a grid');
    expect(run(model, 'reverse')).toEqual({
      partial: regionPatternChange(model.doc, 0, 0, reverseGrid(spec)),
    });
  });

  it('Reseed writes a new seed to the part', () => {
    for (const kind of ['grid', 'arp', 'bass', 'figure'] as const) {
      const model = songWith(kind);
      const before = partAt(model.doc, 0)?.sequencer;
      const edit = run(model, 'reseed');
      if (!edit) throw new Error(`${kind}: no reseed`);
      model.merge(edit.partial);
      const after = partAt(model.doc, 0)?.sequencer;
      expect(after && 'seed' in after && after.seed, kind).not.toBe(
        before && 'seed' in before && before.seed,
      );
    }
  });

  it('Capture freezes the figure with the card’s toast, and Release lets the modulator back', () => {
    const model = songWith('euclidean');
    const capture = run(model, 'capture');
    expect(capture?.notice).toBe(
      'part 0: captured — the figure is a literal array in the document',
    );
    if (!capture) throw new Error('no capture');
    model.merge(capture.partial);
    const part = partAt(model.doc, 0);
    expect(part && regionPattern(part, 0)).toMatchObject({ pattern: FIGURE });
    expect(run(model, 'capture')?.notice).toBe('part 0: released back to the modulator');
  });

  it('Quantize snaps every note to the card’s Snap as one `Quantize` step, and writes nothing on the grid', () => {
    const model = songWith('roll');
    const notes: RollNote[] = [{ tick: 4, pitch: 60, ticks: SIXTEENTH, velocity: 100 }];
    model.merge(regionPatternChange(model.doc, 0, 0, { loopTicks: BAR, notes }) ?? {});
    const edit = run(model, 'quantize');
    expect(edit?.label).toBe('Quantize');
    if (!edit) throw new Error('no quantize');
    model.merge(edit.partial);
    const part = partAt(model.doc, 0);
    const spec = part && regionPattern(part, 0);
    expect(spec?.kind === 'roll' && spec.notes.map((n) => n.tick)).toEqual([SIXTEENTH]);
    expect(run(model, 'quantize')).toBeNull();
  });
});

describe('the rules that turn a button off', () => {
  it('a Figure canon holds Randomize and Reverse, not Reseed', () => {
    const model = songWith('figure');
    const part = partAt(model.doc, 0);
    if (!part) throw new Error('no part');
    const canon = { ...regionPattern(part, 0), source: { slot: 1, offset: 0, transpose: 0 } };
    expect(actionBlocked('randomize', canon, SIXTEENTH)).toBe('follows its source');
    expect(actionBlocked('reverse', canon, SIXTEENTH)).toBe('follows its source');
    expect(actionBlocked('reseed', canon, SIXTEENTH)).toBeNull();
    expect(actionBlocked('randomize', regionPattern(part, 0), SIXTEENTH)).toBeNull();
  });

  it('Snap Off holds Quantize with the card’s off tag, and the write refuses too', () => {
    const model = songWith('roll');
    const part = partAt(model.doc, 0);
    if (!part) throw new Error('no part');
    const spec = regionPattern(part, 0);
    expect(actionBlocked('quantize', spec, ROLL_SNAP_OFF_TICKS)).toBe('snap off');
    expect(actionBlocked('quantize', spec, SIXTEENTH)).toBeNull();
    const off = { loop: BAR, region: 4 * BAR, snap: ROLL_SNAP_OFF_TICKS };
    expect(run(model, 'quantize', { rollFrame: () => off })).toBeNull();
  });
});

/** Every event region 0's Grid pattern plays over four bars of sixteenths, from its own stream. */
function playGrid(model: DocumentModel): NoteEvent[] {
  const part = partAt(model.doc, 0);
  const spec = part && regionPattern(part, 0);
  if (spec?.kind !== 'grid') throw new Error('not a grid');
  const seq = new GridSequencer(new ScaleSampler({ root: 0, scale: 'naturalMinor' }), spec);
  const events: NoteEvent[] = [];
  const step = DIVISORS.sixteenth;
  for (let s = 0; s < (4 * BAR) / step; s++) {
    const at = { tick: s * step, step: s, bar: 0, tickInBar: 0, seconds: 0, secondsPerTick: 0 };
    events.push(...seq.handleTick({ ...at, time: 0 }));
  }
  return events;
}

describe('Reseed on a Grid (windsor#936)', () => {
  /** A Grid song whose line climbs the scale, varying at `amount` on every step. */
  function variedGrid(amount: number): DocumentModel {
    const model = songWith('grid');
    const steps: GridSpec['steps'] = Array.from({ length: 16 }, (_, i) => gridNote(i % 7));
    const pattern = { steps, randomness: amount, probability: amount };
    const partial = regionPatternChange(model.doc, 0, 0, pattern);
    if (partial) model.merge(partial);
    return model;
  }
  const reseeded = (model: DocumentModel): NoteEvent[] => {
    const edit = run(model, 'reseed');
    if (!edit) throw new Error('no reseed');
    model.merge(edit.partial);
    return playGrid(model);
  };

  it('changes what a randomized line plays', () => {
    const model = variedGrid(1);
    const before = playGrid(model);
    expect(reseeded(model)).not.toEqual(before);
  });

  it('leaves a line at amount 0 as it played', () => {
    const model = variedGrid(0);
    const before = playGrid(model);
    expect(reseeded(model)).toEqual(before);
  });
});
