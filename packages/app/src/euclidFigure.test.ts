/**
 * The Euclid card's figure per region (windsor#75, Codex's P1 on #79):
 * with the transport inside the second of two Euclid regions whose figures
 * differ, the card shows and Capture freezes region 2's live figure into
 * region 2, never the part's own. Driven by the engine's player rig, so the
 * figures are the ones the player really holds.
 */
import { describe, expect, it } from 'vitest';

import type { RegionPattern } from '@windsor/engine';
import { TICKS_PER_BAR, partAt } from '@windsor/engine';
import {
  FULL_DOCUMENT,
  FULL_PARTS,
  FULL_SLOT,
  withDocumentPart,
} from '@windsor/engine/__fixtures__/fullArrangement';
import { rig } from '@windsor/engine/__fixtures__/playerRig';
import { HALF, halves, patternOf } from '@windsor/engine/__fixtures__/regionPatternSongs';
import { DocumentModel } from './documentModel';
import { regionFigure, type FigureSource } from './euclidFigure';
import { countOnsets } from './euclidModel';
import { regionPatternChange } from './partEdits';

const BAR = TICKS_PER_BAR;
const slot = FULL_SLOT.kick;

/** A kick pattern whose figure is `k` onsets of 16, held (no modulator movement). */
const withK = (k: number): RegionPattern => ({
  ...patternOf(FULL_PARTS.kick.sequencer),
  pulses: { min: k, max: k, start: k },
});

/** Two Euclid regions, 4 onsets in bars 1–2 and 11 in bars 3–4, played up to `tick`. */
function playedTo(tick: number): { model: DocumentModel; source: FigureSource } {
  const model = new DocumentModel(
    withDocumentPart(FULL_DOCUMENT, 'kick', {
      regions: halves(withK(4), withK(11)),
      sequencer: { ...FULL_PARTS.kick.sequencer, pulses: { min: 4, max: 4, start: 4 } },
    }),
  );
  const r = rig(model.doc);
  r.run(tick / BAR);
  const source: FigureSource = {
    doc: model.doc,
    capturePattern: (s, region) => r.player.capturePattern(s, region),
    position: () => tick,
  };
  return { model, source };
}

describe("the Euclid card's figure for a region", () => {
  it("captures region 2's live figure into region 2 while playback is inside it", () => {
    const { model, source } = playedTo(HALF + BAR);
    const figure = regionFigure(source, slot, 1);
    expect(countOnsets(figure)).toBe(11);
    // The part's own figure, which the card captured before this fix.
    expect(countOnsets(source.capturePattern(slot) ?? [])).toBe(4);

    const partial = regionPatternChange(model.doc, slot, 1, { pattern: figure });
    if (!partial) throw new Error('the capture was refused');
    model.merge(partial);
    const part = partAt(model.doc, slot);
    expect(part?.regions[1]?.pattern).toMatchObject({ pattern: figure });
    expect(part?.regions[0]?.pattern).toMatchObject({ pattern: null, pulses: { start: 4 } });
  });

  it("shows region 1's own live figure there, and a region's preview while playback is elsewhere", () => {
    const { source } = playedTo(BAR);
    expect(countOnsets(regionFigure(source, slot, 0))).toBe(4);
    // Region 2 is not playing: its figure is its pattern's preview.
    expect(countOnsets(regionFigure(source, slot, 1))).toBe(11);
  });
});
