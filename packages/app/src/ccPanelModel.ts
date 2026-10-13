/**
 * The MIDI CC panel's rows, without the DOM (windsor#784, record
 * `2026-10-13-midi-cc-mapping` decision 12 and its mockup): which mappings
 * a filter lists, and what each row's cells say. The Part and Parameter
 * cells name the part and the target as the Song tab's lanes do
 * (`laneTitle`); Source is the device, channel and CC, or learn's state;
 * Range is min and max in the target's units (`readout`); Live is the CC's
 * value or one of the router's statuses (`ccStatus.ts`), with the line under
 * it the mockup draws.
 */
import type {
  ArrangementDocument,
  AutomationTargetRow,
  CcMapping,
  CcTargetId,
  DocumentPart,
} from '@windsor/engine';
import { CC_DATA_MAX, ccPosition, ccValue, partAt } from '@windsor/engine';

import { readout } from './automationReadout';
import { partPatch } from './ccPanelEngine';
import type { CcHeard, CcHeardFrom, CcLearning } from './ccPanelSession';
import type { CcStatus } from './ccStatus';
import { partColor } from './consoleColors';
import { LANE_KIND_COLOR } from './songAutomationTables';
import { laneRow, laneTitle } from './songAutomationModel';

/** This part (the default) or All parts. */
export type CcFilter = 'this' | 'all';

/** What the rows read from the console's CC state; `CcSession` is one. */
export interface CcRowState {
  readonly learning: CcLearning | null;
  readonly heard: CcHeard | null;
  status(part: number, target: CcTargetId): CcStatus | undefined;
  heardFrom(part: number, target: CcTargetId): CcHeardFrom | undefined;
  /** The target's value now: the CC's base where one is held, else its own. */
  current(part: number, target: CcTargetId): number | undefined;
}

/** The Source cell: learn listening, learn just heard, or the mapping's source. */
export type CcSourceView =
  | { readonly kind: 'listening' }
  | { readonly kind: 'heard'; readonly cc: number; readonly rest: string }
  | {
      readonly kind: 'set';
      readonly device: string | null;
      readonly channel: number | null;
      readonly cc: number;
      /** "heard USB MIDI Controller · ch 1", or null when nothing was heard since the song opened. */
      readonly heardLine: string | null;
      /** The device it last heard, so a row widened to Any can go back to it. */
      readonly heardDevice: string | null | undefined;
    };

/** The Live cell: a value, a dash, or a status pill, each with an optional line under it. */
export interface CcLiveView {
  readonly tone: 'value' | 'none' | 'pickup' | 'auto' | 'inert';
  readonly text: string;
  readonly sub: string | null;
}

/** One row of the panel. */
export interface CcRowView {
  readonly key: string;
  readonly part: number;
  readonly target: CcTargetId;
  readonly partName: string;
  readonly partColor: string;
  readonly name: string;
  readonly kindLine: string;
  readonly kindColor: string;
  /** The target's row, for the Range cell's drag and typing; undefined when the part lacks it. */
  readonly row: AutomationTargetRow | undefined;
  /** The saved mapping; null for the row learn adds. */
  readonly mapping: CcMapping | null;
  readonly source: CcSourceView;
  /** The Range cell's ends, formatted; one value when min equals max, none on learn's new row. */
  readonly range: readonly string[];
  readonly live: CcLiveView;
  readonly listening: boolean;
  /** Learn has just committed this row. */
  readonly flash: boolean;
}

/** A row's key, by part and target. */
export const ccRowKey = (part: number, target: CcTargetId): string => `${part}|${target}`;

/** A channel as the Source cell shows it: "ch 1", or Any. */
export const channelLabel = (channel: number | null): string =>
  channel === null ? 'Any ch' : `ch ${channel}`;

/** A device as the Source cell shows it. */
export const deviceLabel = (device: string | null): string => device ?? 'Any device';

/** Where a source was heard: "ch 1 · USB MIDI Controller". */
const heardRest = (source: { device: string | null; channel: number | null }): string =>
  [channelLabel(source.channel), ...(source.device === null ? [] : [source.device])].join(' · ');

const NO_VALUE_YET = 'no value heard since the song opened';
const DASH = '—';

/**
 * What a mapping waiting for pickup asks of the hand, from the hardware at
 * `from`: the controller value where the target's `current` value is, rounded
 * the way the knob travels to it, and that value. A current value outside the
 * range picks up at the range's end, which the line says.
 */
export function pickupHint(
  row: AutomationTargetRow,
  mapping: CcMapping,
  current: number,
  from: number,
  format: (value: number) => string,
): string | null {
  const position = ccPosition(row, mapping, current);
  if (position === null) return null;
  const cc = position >= from ? Math.ceil(position) : Math.floor(position);
  const end = format(ccValue(row, mapping, cc));
  const lo = Math.min(mapping.min, mapping.max);
  const hi = Math.max(mapping.min, mapping.max);
  if (current < lo || current > hi) {
    return `turn to CC ${cc} (${end}): ${format(current)} is outside the range`;
  }
  // At either end of the controller there is nothing to turn past.
  const way = cc <= 0 || cc >= CC_DATA_MAX ? 'to' : 'past';
  return `turn ${way} CC ${cc} (${end}) to take ${format(current)}`;
}

/** The Live cell for a mapping's status; `hint` words a pickup from the hardware's position. */
export function ccLiveView(
  status: CcStatus | undefined,
  format: (value: number) => string,
  hint: (from: number) => string | null,
): CcLiveView {
  if (!status) return { tone: 'none', text: DASH, sub: null };
  switch (status.kind) {
    case 'live':
      return status.held
        ? { tone: 'value', text: format(status.value), sub: null }
        : { tone: 'none', text: DASH, sub: NO_VALUE_YET };
    case 'automated':
      return { tone: 'auto', text: 'Automated', sub: 'a song lane drives it; the CC is ignored' };
    case 'inert':
      return { tone: 'inert', text: 'Inert', sub: status.reason };
    case 'noSlot':
      return {
        tone: 'inert',
        text: 'No voice slot',
        sub: "all eight of the part's voice slots are taken",
      };
    case 'waiting': {
      // No hardware position heard yet: nothing to pick up from (decision 7).
      const marker = status.marker;
      if (!marker) return { tone: 'none', text: DASH, sub: NO_VALUE_YET };
      const how = hint(marker.cc);
      const sub = `at ${format(marker.value)}${how ? ` · ${how}` : ''}`;
      return { tone: 'pickup', text: 'Waiting for pickup', sub };
    }
  }
}

/** The Source cell of a row. */
function sourceView(
  mapping: CcMapping | null,
  listening: boolean,
  heard: CcHeard | null,
  from: CcHeardFrom | undefined,
): CcSourceView {
  if (listening || !mapping) return { kind: 'listening' };
  if (heard) return { kind: 'heard', cc: heard.source.cc, rest: heardRest(heard.source) };
  const { device, channel, cc } = mapping.source;
  const heardLine = from ? `heard ${heardRest(from)}` : null;
  return { kind: 'set', device, channel, cc, heardLine, heardDevice: from?.device };
}

/** The Range cell's ends in the target's units: one when min equals max. */
const rangeCells = (mapping: CcMapping, format: (value: number) => string): string[] =>
  mapping.min === mapping.max ? [format(mapping.min)] : [format(mapping.min), format(mapping.max)];

/** One row; `mapping` null for the row learn adds for `target`. */
function rowOf(
  doc: ArrangementDocument,
  part: DocumentPart,
  target: CcTargetId,
  mapping: CcMapping | null,
  state: CcRowState,
): CcRowView {
  const patch = partPatch(doc, part);
  const title = laneTitle(part, target, patch);
  const row = laneRow(part, target, patch);
  const format = (value: number): string => (row ? readout(row, value) : String(value));
  const listening = state.learning?.part === part.slot && state.learning.target === target;
  const heard =
    state.heard?.part === part.slot && state.heard.target === target ? state.heard : null;
  const status = mapping ? state.status(part.slot, target) : undefined;
  const current = state.current(part.slot, target);
  const hint = (from: number): string | null =>
    row && mapping && current !== undefined
      ? pickupHint(row, mapping, current, from, format)
      : null;
  return {
    key: ccRowKey(part.slot, target),
    part: part.slot,
    target,
    partName: part.name,
    partColor: partColor(part.colour).hex,
    name: title.name,
    kindLine: title.kindLine,
    kindColor: LANE_KIND_COLOR[title.kind],
    row,
    mapping,
    source: sourceView(mapping, listening, heard, state.heardFrom(part.slot, target)),
    range: mapping ? rangeCells(mapping, format) : [],
    live: listening ? { tone: 'none', text: DASH, sub: null } : ccLiveView(status, format, hint),
    listening,
    flash: heard !== null,
  };
}

/**
 * The panel's rows: the selected part's mappings under This part, every
 * part's in slot order under All parts, and the row learn adds for a target
 * with no mapping yet, last under its part.
 */
export function ccRows(
  doc: ArrangementDocument,
  filter: CcFilter,
  selected: number,
  state: CcRowState,
): CcRowView[] {
  const parts =
    filter === 'all' ? doc.parts : [partAt(doc, selected)].filter((p) => p !== undefined);
  const learning = state.learning;
  return parts.flatMap((part) => {
    const rows = (part.ccMappings ?? []).map((m) => rowOf(doc, part, m.target, m, state));
    const adding = learning?.part === part.slot && !rows.some((r) => r.target === learning.target);
    return adding ? [...rows, rowOf(doc, part, learning.target, null, state)] : rows;
  });
}

/** The selected part's mapping count, the MIDI CC button's badge. */
export const ccMappingCount = (doc: ArrangementDocument, selected: number): number =>
  partAt(doc, selected)?.ccMappings?.length ?? 0;

/** One entry of a row's device or channel select; `CC_ANY` is Any. */
export interface CcSelectOption {
  readonly value: string;
  readonly label: string;
}

/** The value of Any in a device or channel select. */
export const CC_ANY = '';

/**
 * A row's devices: Any, each connected input, the mapping's own device
 * (marked "(disconnected)" when it is not connected, as the MIDI selector
 * marks it) and the one it last heard, so a row widened to Any can go back.
 */
export function ccDeviceOptions(
  device: string | null,
  connected: readonly string[],
  heard: string | null | undefined,
): CcSelectOption[] {
  const known = [device, heard].filter((d): d is string => typeof d === 'string');
  const names = [...new Set([...connected, ...known])];
  return [
    { value: CC_ANY, label: deviceLabel(null) },
    ...names.map((name) => ({
      value: name,
      label: connected.includes(name) ? name : `${name} (disconnected)`,
    })),
  ];
}

/** A row's channels: Any, then 1 to `max`. */
export const ccChannelOptions = (max: number): CcSelectOption[] => [
  { value: CC_ANY, label: channelLabel(null) },
  ...Array.from({ length: max }, (_, i) => ({ value: String(i + 1), label: channelLabel(i + 1) })),
];
