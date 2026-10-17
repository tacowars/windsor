/**
 * The Song tab lane menu tests' song and helpers (windsor#826, windsor#885):
 * the mockups' 16-bar test song with its five parts, a press on a lane, the
 * recording commands, and how a spec's rows read.
 */
import type { PartRegion, SequencerSpec } from '@windsor/engine';
import {
  DEFAULT_ARP_CONFIG,
  DEFAULT_EUCLIDEAN_CONFIG,
  DEFAULT_GRID_CONFIG,
  DEFAULT_ROLL_CONFIG,
  TICKS_PER_BAR,
} from '@windsor/engine';
import type { MenuItem, MenuRow, MenuSpec } from '../contextMenuModel';
import type { RegionClip } from '../regionClipboard';
import { ROLL_SNAPS, ROLL_SNAP_DEFAULT } from '../rollTables';
import type { LaneMenuCommands, LaneMenuPress } from '../songLaneMenuModel';

export const BAR = TICKS_PER_BAR;
export const SONG = 16 * BAR;
/** A region from 1-based bar `first`, `bars` long. */
export const bars = (first: number, length: number): PartRegion => ({
  start: (first - 1) * BAR,
  duration: length * BAR,
});

export type LanePart = LaneMenuPress['part'];
export const part = (
  slot: number,
  name: string,
  sequencer: SequencerSpec,
  regions: PartRegion[],
): LanePart => ({ slot, name, sequencer, regions }) as LanePart;

export const acid = part(0, 'acid', { ...DEFAULT_GRID_CONFIG, kind: 'grid' }, [
  bars(1, 4),
  bars(5, 4),
  bars(13, 4),
]);
export const kick = part(
  1,
  'kick',
  { ...DEFAULT_EUCLIDEAN_CONFIG, kind: 'euclidean', note: 36, hold: 1 },
  [bars(1, 8), bars(9, 8)],
);
/** lead's roll: notes on a 3-bar loop, as the mockups draw it (one note stands in for their four). */
export const notes = [{ tick: 0, pitch: 60, ticks: 6, velocity: 100 }];
export const roll = { ...DEFAULT_ROLL_CONFIG, kind: 'roll' as const, loopTicks: 3 * BAR, notes };
export const lead = part(2, 'lead', roll, [bars(5, 4), bars(9, 4)]);
export const arp = part(3, 'arp', { ...DEFAULT_ARP_CONFIG, kind: 'arp' }, [bars(1, 8), bars(9, 8)]);
export const pad = part(4, 'pad', { kind: 'none' }, [bars(1, 16)]);

/** A press `at` bars from the song's start (0-based, as the mockups' states give it). */
export const press = (
  on: LanePart,
  region: number | null,
  at: number,
  clip: RegionClip | null = null,
): LaneMenuPress => ({
  part: on,
  region,
  tick: at * BAR,
  bar: BAR,
  meter: '4/4',
  songTicks: SONG,
  snap: ROLL_SNAPS[ROLL_SNAP_DEFAULT] ?? { label: '1/16', ticks: 6 },
  clip,
  added: null,
});

/** The commands, each recording its call, over the clipboard `clipboard` reads. */
export function spy(clipboard: () => RegionClip | null = () => null): {
  commands: LaneMenuCommands;
  calls: [string, unknown][];
} {
  const calls: [string, unknown][] = [];
  const record =
    (name: string) =>
    (arg?: unknown): void => {
      calls.push([name, arg]);
    };
  const names =
    'cut copy duplicate delete place zoom loop bounce colour loadRack setKind pattern showRegion showCut showLoop unpreview'.split(
      ' ',
    );
  const commands = {
    ...Object.fromEntries(names.map((n) => [n, record(n)])),
    clipboard,
  } as unknown as LaneMenuCommands;
  return { commands, calls };
}

/** Each item as the mockups read it: a label with its tag, `(off)` when disabled, `▸` for a submenu, `—` a separator. */
export const shown = (items: readonly MenuItem[]): string[] =>
  items.map((item) => {
    if (item.kind === 'separator') return '—';
    if (item.kind === 'submenu') return `${item.label} ▸`;
    const tag = item.tag === undefined ? '' : ` [${item.tag}]`;
    return `${item.label}${tag}${item.disabled === true ? ' (off)' : ''}`;
  });

export const rowOf = (spec: MenuSpec, label: string): MenuRow => {
  const item = spec.items.find((i) => i.kind === 'row' && i.label.startsWith(label));
  if (item?.kind !== 'row') throw new Error(`no row ${label}`);
  return item;
};

export const EDITS = (paste: string): string[] => [
  'Cut [⌘X]',
  'Copy [⌘C]',
  paste,
  'Duplicate [⌘D]',
  'Delete [⌫]',
  'Split here [⌥-click]',
  '—',
  'Zoom to region',
  'Loop region',
  '—',
];
