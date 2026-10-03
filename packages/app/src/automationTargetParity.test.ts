/**
 * The sequencer lane rows held to their knobs (windsor#491): every field a
 * kind offers a lane is a knob on that kind's device, under the row's label,
 * whose range is the row's (windsor#514), so a locked knob shows every value
 * the lane reaches and the lane reaches every value the knob does.
 */
import { describe, expect, it } from 'vitest';
import { SEQ_AUTOMATION_FIELDS, requireCatalogRow, seqTargetId } from '@windsor/engine';
import type { SequencerKind } from '@windsor/engine';
import {
  ARP_GRID_KNOBS,
  ARP_KNOBS,
  BASS_KNOBS,
  FIGURE_KNOBS,
  GRID_KNOBS,
  type SequencerKnobEntry,
} from './sequencerKnobTables';

/** The knob tables each kind with sequencer lanes draws. */
const KNOBS_OF: Partial<Record<SequencerKind, readonly SequencerKnobEntry[]>> = {
  figure: FIGURE_KNOBS,
  grid: GRID_KNOBS,
  arp: [...ARP_KNOBS, ...ARP_GRID_KNOBS],
  bass: BASS_KNOBS,
};

describe('the sequencer lane rows and their knobs', () => {
  const offered = Object.entries(SEQ_AUTOMATION_FIELDS).flatMap(([kind, fields]) =>
    (fields ?? []).map((field) => [kind as SequencerKind, field] as const),
  );

  it.each(offered)('%s offers %s, a knob under the row’s label with its range', (kind, field) => {
    const row = requireCatalogRow(seqTargetId(field));
    const knob = KNOBS_OF[kind]?.find((e) => e.kind === 'driver' && e.f === field);
    expect(knob?.label, `${kind} ${field}`).toBe(row.label);
    expect(knob?.o.min).toBe(row.min);
    expect(knob?.o.max).toBe(row.max);
  });
});
