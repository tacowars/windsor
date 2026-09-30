/**
 * The detail pane's header text (windsor#123): the title and note the pane
 * draws and the view's repaint check rewrites after a card's edit — each
 * sequencer kind's summary, the region count singular and plural, a region's
 * own pattern, and a chord's header.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, MusicPart, SequencerKind } from '@windsor/engine';
import { SEQUENCER_KINDS, TICKS_PER_BAR, partAt } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { regionPatternChange, sequencerKindChange } from './partEdits';
import { KIND_LABELS } from './sequencerConstants';
import { newSong } from './songParts';
import { paneHeadText, partHeadText } from './songPaneHead';

const BAR = TICKS_PER_BAR;

/** A new song whose part 0 is a `kind` part with `regions` one-bar regions. */
function songWith(kind: SequencerKind, regions: number): DocumentModel {
  const model = new DocumentModel(newSong());
  const partial = sequencerKindChange(model.doc, 0, kind, (raw) => model.preview(raw));
  if (partial) model.merge(partial);
  const drawn = Array.from({ length: regions }, (_, i) => ({ start: i * BAR, duration: BAR }));
  model.merge({ parts: { 0: { regions: drawn } } });
  return model;
}

const part0 = (doc: ArrangementDocument): MusicPart => {
  const part = partAt(doc, 0);
  if (!part) throw new Error('part 0 is gone');
  return part;
};

/** Apply one card edit to region `region` (or the part's sequencer) of part 0. */
function edit(model: DocumentModel, region: number | undefined, fields: Record<string, unknown>) {
  const partial = regionPatternChange(model.doc, 0, region, fields);
  if (!partial) throw new Error('the edit was refused');
  model.merge(partial);
}

describe('a part header', () => {
  it.each(SEQUENCER_KINDS)('titles a %s part with its name and kind', (kind) => {
    const part = part0(songWith(kind, 1).doc);
    expect(partHeadText(part, 0).title).toBe(`${part.name} — ${KIND_LABELS[kind]}`);
  });

  it.each([
    ['euclidean', /^euclid \d+\/\d+ · .+ · 1 region$/],
    ['grid', /^grid · \d+ steps · .+ · 1 region$/],
    ['chord', /^chord · \d+ steps · .+ · 1 region$/],
    ['arp', /^arp · \S+ .+ · 1 region$/],
    ['bass', /^bass · .+ · 1 region$/],
    ['none', /^no sequencer · 1 region$/],
  ] as const)('summarises a %s part in its note', (kind, note) => {
    expect(partHeadText(part0(songWith(kind, 1).doc), 0).note).toMatch(note);
  });

  it('counts no regions, one region and several', () => {
    expect(partHeadText(part0(songWith('arp', 0).doc), null).note).toMatch(/ · 0 regions$/);
    expect(partHeadText(part0(songWith('arp', 1).doc), 0).note).toMatch(/ · 1 region$/);
    expect(partHeadText(part0(songWith('arp', 3).doc), 0).note).toMatch(/ · 3 regions$/);
  });

  it('follows an edit to the arp style and division', () => {
    const model = songWith('arp', 1);
    edit(model, 0, { style: 'down', divisor: TICKS_PER_BAR / 8 });
    expect(partHeadText(part0(model.doc), 0).note).toBe('arp · Down 1/8 · 1 region');
  });

  it("shows the edited region's own pattern, the first when none is selected", () => {
    const model = songWith('euclidean', 2);
    edit(model, 1, { steps: 12 });
    const part = part0(model.doc);
    expect(partHeadText(part, 1).note).toMatch(/^euclid \d+\/12 /);
    expect(partHeadText(part, 0).note).not.toMatch(/^euclid \d+\/12 /);
    expect(partHeadText(part, null).note).toBe(partHeadText(part, 0).note);
  });
});

describe('the pane header for a selection', () => {
  it("reads a part's header from the document, and nothing for a missing part", () => {
    const model = songWith('grid', 2);
    expect(paneHeadText(model.doc, { kind: 'part', slot: 0, region: 1 })).toEqual(
      partHeadText(part0(model.doc), 1),
    );
    expect(paneHeadText(model.doc, { kind: 'part', slot: 99, region: null })).toBeNull();
    expect(paneHeadText(model.doc, null)).toBeNull();
  });

  it('titles a chord with its bar and numbers it in the note', () => {
    const { doc } = new DocumentModel(newSong());
    const index = doc.harmony.events.length - 1;
    const event = doc.harmony.events[index];
    if (!event) throw new Error('the new song has no chord');
    expect(paneHeadText(doc, { kind: 'event', index })).toEqual({
      title: `Harmony — bar ${Math.floor(event.start / BAR) + 1}`,
      note: `chord ${index + 1}`,
    });
    expect(paneHeadText(doc, { kind: 'event', index: index + 1 })).toBeNull();
  });
});
