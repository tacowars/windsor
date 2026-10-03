/**
 * A part's sequencer lanes as the region gate reads them (windsor#488): the
 * lanes that are on and that the part's kind offers, read with `valueAt` at
 * a song position. No AudioParam is involved, so the live player and the
 * offline render read the same values on the same ticks. A part with no such
 * lane reads none, and its gate hands nothing on. Pure.
 */
import type { SequencerKind } from '../song/arrangement';
import type { SeqField, SeqOverrides } from '../sequencing/regionGate';
import { valueAt } from './automationEvaluate';
import type { AutomationLane, AutomationPoint, AutomationTargetRow } from './automationLane';
import { SEQ_AUTOMATION_FIELDS } from './automationSeqTables';
import { catalogRow, parseTargetId } from './automationTargets';

interface SeqLane {
  readonly field: SeqField;
  readonly row: AutomationTargetRow;
  readonly points: readonly AutomationPoint[];
}

/** `lanes`' sequencer lanes a `kind` part plays: on, offered by the kind, with points. */
function seqLanesOf(
  lanes: readonly AutomationLane[],
  kind: SequencerKind,
  fields: typeof SEQ_AUTOMATION_FIELDS,
): SeqLane[] {
  const offered = fields[kind] ?? [];
  const out: SeqLane[] = [];
  for (const lane of lanes) {
    if (!lane.on || lane.points.length === 0) continue;
    const parsed = parseTargetId(lane.target);
    const row = catalogRow(lane.target);
    if (parsed?.kind !== 'seq' || !row || !offered.includes(parsed.field)) continue;
    out.push({ field: parsed.field, row, points: lane.points });
  }
  return out;
}

/**
 * What a `kind` part's sequencer lanes hold at a song position, or undefined
 * when it plays none, so a part without them costs its gate nothing.
 */
export function seqOverridesReader(
  lanes: readonly AutomationLane[] | undefined,
  kind: SequencerKind,
  fields = SEQ_AUTOMATION_FIELDS,
): ((tick: number) => SeqOverrides) | undefined {
  const seq = lanes === undefined ? [] : seqLanesOf(lanes, kind, fields);
  if (seq.length === 0) return undefined;
  return (tick) => {
    const overrides: { [F in SeqField]?: number } = {};
    for (const { field, row, points } of seq) overrides[field] = valueAt(row, points, tick);
    return overrides;
  };
}
