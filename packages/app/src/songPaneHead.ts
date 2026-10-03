/**
 * The Song view's detail pane header text (windsor#123): the title and small
 * note for the selection — "Lead — Arp" over "arp · Up 1/16 · 1 region", or
 * "Harmony — bar 3" over "chord 2". One pure function, so the pane draws its
 * header from it and the view's repaint check rewrites that header in place
 * after a card's edit, never rebuilding the card under the pointer.
 */
import type { ArrangementDocument, Meter, MusicPart } from '@windsor/engine';
import { meterBeats, partAt, regionPattern } from '@windsor/engine';
import { eventBar } from './harmonyLaneModel';
import { editedRegion, keepsRegionPatterns } from './partEdits';
import { KIND_LABELS } from './sequencerConstants';
import type { SongSelection } from './songTab';
import { type PartNames, REGION_SUMMARY, forKind, partNames } from './songViewTables';

export interface PaneHeadText {
  readonly title: string;
  readonly note: string;
}

/**
 * The region the pane's card and Octave knob edit: the selected one, else the
 * first (windsor#75 decision 2) — none for a kind whose card edits the part's
 * sequencer, and null when the part has no region.
 */
export function editTarget(part: MusicPart, region: number | null): number | null | undefined {
  return keepsRegionPatterns(part) ? editedRegion(part, region) : undefined;
}

/** A part's header: its name and kind, over the edited pattern's summary and the region count. */
export function partHeadText(
  part: MusicPart,
  region: number | null,
  meter?: Meter,
  names?: PartNames,
): PaneHeadText {
  const count = part.regions.length;
  const edited = editTarget(part, region);
  const shown = typeof edited === 'number' ? regionPattern(part, edited) : part.sequencer;
  return {
    title: `${part.name} — ${KIND_LABELS[part.sequencer.kind]}`,
    note: `${forKind(REGION_SUMMARY, shown, meter, names)} · ${count} region${count === 1 ? '' : 's'}`,
  };
}

/** The header for the selection as the document now stands; null when it names nothing. */
export function paneHeadText(
  doc: ArrangementDocument,
  selection: SongSelection,
): PaneHeadText | null {
  if (!selection) return null;
  if (selection.kind === 'part') {
    const part = partAt(doc, selection.slot);
    return part ? partHeadText(part, selection.region, doc.transport.meter, partNames(doc)) : null;
  }
  const event = doc.harmony.events[selection.index];
  if (!event) return null;
  const bar = eventBar(event, meterBeats(doc.transport.meter));
  return { title: `Harmony — bar ${bar}`, note: `chord ${selection.index + 1}` };
}
