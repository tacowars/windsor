/**
 * What an envelope's value reads as (windsor#708 decision 4; epic
 * windsor#699 decision 2): the offset it pushes over the patch's own
 * setting, worked through the voice target's row (`voiceTargetTables.ts`)
 * as the engine applies it, `value × span`: octaves on a ratio row, the
 * target's own units on an add row (a macro's has none). Always signed, so
 * 0 reads `+0.00`.
 *
 * The drag readout says where it sits and what it reads: on the point a
 * drag moves, else on the curve under the pointer, as the loop hears it.
 */
import type { RollEnvelope, RollEnvelopePoint } from '@windsor/engine';
import { catalogRow, envelopeValueAt, voiceTargetId, voiceTargetRow } from '@windsor/engine';
import { ROLL_ENVELOPE_READOUT } from './rollEnvelopeTables';

type ReadoutTable = typeof ROLL_ENVELOPE_READOUT;

/** `x` with its sign and `decimals`, a value that rounds to zero as +0. */
const signed = (x: number, decimals: number): string => {
  const shown = Number(x.toFixed(decimals)) || 0;
  return `${shown >= 0 ? '+' : ''}${shown.toFixed(decimals)}`;
};

/** The offset `value` (−1..1) pushes on the voice target at `path`, in its units. */
export function envelopeOffsetText(
  path: string,
  value: number,
  table: ReadoutTable = ROLL_ENVELOPE_READOUT,
): string {
  const row = voiceTargetRow(path);
  if (!row) return signed(value, table.decimals);
  const offset = value * row.span;
  const decimals = Math.abs(offset) >= table.wideFrom ? table.wideDecimals : table.decimals;
  const unit =
    row.curve === 'ratio' ? table.octaves : (catalogRow(voiceTargetId(path))?.unit ?? '');
  return unit === '' ? signed(offset, decimals) : `${signed(offset, decimals)} ${unit}`;
}

/** Where the drag readout sits, in loop ticks, and the value it reads. */
export interface DragReading {
  readonly tick: number;
  readonly value: number;
}

/**
 * The drag readout over `draft`, a gesture's preview of `envelope`'s
 * `start`: on the one point the drag moved (the lists alike but for it),
 * else the curve's value at `pointerTick` inside the loop of `loopTicks`,
 * as the loop hears it.
 */
export function dragReading(
  envelope: RollEnvelope,
  lists: {
    readonly start: readonly RollEnvelopePoint[];
    readonly draft: readonly RollEnvelopePoint[];
  },
  pointerTick: number,
  loopTicks: number,
): DragReading {
  const { start, draft } = lists;
  if (draft.length === start.length) {
    const moved = draft.filter((point, i) => point !== start[i]);
    if (moved.length === 1) return { tick: moved[0]!.tick, value: moved[0]!.value };
  }
  const tick = Math.max(0, Math.min(loopTicks - 1, pointerTick));
  const value = envelopeValueAt({ ...envelope, on: true, points: draft }, tick, loopTicks);
  return { tick, value };
}
