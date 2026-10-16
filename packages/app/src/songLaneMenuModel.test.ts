/**
 * The Song tab lane's context menu (windsor#826; record
 * `2026-10-16-song-tab-context-menu`): the rows of the approved mockups'
 * Grid, Arp, Roll, Euclid, gap and no-sequencer states, in order with their
 * tags (the pattern group is the next ticket), and what each row runs and
 * previews. The parts are the mockups' 16-bar test song.
 */
import { describe, expect, it } from 'vitest';

import type { PartRegion, SequencerSpec } from '@windsor/engine';
import {
  DEFAULT_ARP_CONFIG,
  DEFAULT_EUCLIDEAN_CONFIG,
  DEFAULT_GRID_CONFIG,
  DEFAULT_ROLL_CONFIG,
  TICKS_PER_BAR,
} from '@windsor/engine';
import type { MenuItem, MenuRow, MenuSpec } from './contextMenuModel';
import { partLaneGeometry } from './partLaneModel';
import type { RegionClip } from './regionClipboard';
import { copyRegion, pasteRegion } from './regionClipboard';
import { splitPartRegion } from './partEdits';
import type { LaneMenuCommands, LaneMenuPress } from './songLaneMenuModel';
import { laneMenu, lanePressAt, whileFresh } from './songLaneMenuModel';

const BAR = TICKS_PER_BAR;
const SONG = 16 * BAR;
/** A region from 1-based bar `first`, `bars` long. */
const bars = (first: number, length: number): PartRegion => ({
  start: (first - 1) * BAR,
  duration: length * BAR,
});

type LanePart = LaneMenuPress['part'];
const part = (
  slot: number,
  name: string,
  sequencer: SequencerSpec,
  regions: PartRegion[],
): LanePart => ({ slot, name, sequencer, regions }) as LanePart;

const acid = part(0, 'acid', { ...DEFAULT_GRID_CONFIG, kind: 'grid' }, [
  bars(1, 4),
  bars(5, 4),
  bars(13, 4),
]);
const kick = part(
  1,
  'kick',
  { ...DEFAULT_EUCLIDEAN_CONFIG, kind: 'euclidean', note: 36, hold: 1 },
  [bars(1, 8), bars(9, 8)],
);
const lead = part(2, 'lead', { ...DEFAULT_ROLL_CONFIG, kind: 'roll' }, [bars(5, 4), bars(9, 4)]);
const arp = part(3, 'arp', { ...DEFAULT_ARP_CONFIG, kind: 'arp' }, [bars(1, 8), bars(9, 8)]);
const pad = part(4, 'pad', { kind: 'none' }, [bars(1, 16)]);

/** A press `at` bars from the song's start (0-based, as the mockups' states give it). */
const press = (
  on: LanePart,
  region: number | null,
  at: number,
  clip: RegionClip | null = null,
): LaneMenuPress => ({
  part: on,
  region,
  tick: at * BAR,
  bar: BAR,
  songTicks: SONG,
  clip,
  added: null,
});

/** The commands, each recording its call, over the clipboard `clipboard` reads. */
function spy(clipboard: () => RegionClip | null = () => null): {
  commands: LaneMenuCommands;
  calls: [string, unknown][];
} {
  const calls: [string, unknown][] = [];
  const record =
    (name: string) =>
    (arg?: unknown): void => {
      calls.push([name, arg]);
    };
  const names = [
    'cut',
    'copy',
    'duplicate',
    'delete',
    'place',
    'zoom',
    'loop',
    'bounce',
    'colour',
    'setKind',
    'showRegion',
    'showCut',
    'showLoop',
    'unpreview',
  ] as const;
  const commands = {
    ...Object.fromEntries(names.map((n) => [n, record(n)])),
    clipboard,
  } as unknown as LaneMenuCommands;
  return { commands, calls };
}

/** Each item as the mockups read it: a label with its tag, `(off)` when disabled, `▸` for a submenu, `—` a separator. */
const shown = (items: readonly MenuItem[]): string[] =>
  items.map((item) => {
    if (item.kind === 'separator') return '—';
    if (item.kind === 'submenu') return `${item.label} ▸`;
    const tag = item.tag === undefined ? '' : ` [${item.tag}]`;
    return `${item.label}${tag}${item.disabled === true ? ' (off)' : ''}`;
  });

const rowOf = (spec: MenuSpec, label: string): MenuRow => {
  const item = spec.items.find((i) => i.kind === 'row' && i.label.startsWith(label));
  if (item?.kind !== 'row') throw new Error(`no row ${label}`);
  return item;
};

const EDITS = (paste: string): string[] => [
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

describe("the mockups' states", () => {
  const { commands } = spy();
  const gridClip = copyRegion(acid, 0);

  it('Grid: acid bars 5–8 pressed in bar 6, a Grid clip copied', () => {
    const spec = laneMenu(press(acid, 1, 5.3, gridClip), commands);
    expect(spec.head).toBe('acid · bars 5–8 · at bar 6');
    expect(shown(spec.items)).toEqual([
      ...EDITS('Paste at bar 6'),
      'Bounce part to Roll…',
      'Part color…',
    ]);
  });

  it('Arp and Euclid offer Bounce; Roll does not', () => {
    const arpSpec = laneMenu(press(arp, 0, 2.4), commands);
    expect(arpSpec.head).toBe('arp · bars 1–8 · at bar 3');
    expect(shown(arpSpec.items).slice(-2)).toEqual(['Bounce part to Roll…', 'Part color…']);
    const euclidSpec = laneMenu(press(kick, 1, 11.3), commands);
    expect(euclidSpec.head).toBe('kick · bars 9–16 · at bar 12');
    expect(shown(euclidSpec.items).slice(-2)).toEqual(['Bounce part to Roll…', 'Part color…']);
    const rollSpec = laneMenu(press(lead, 0, 5.4), commands);
    expect(rollSpec.head).toBe('lead · bars 5–8 · at bar 6');
    expect(shown(rollSpec.items)).toEqual([
      ...EDITS('Paste at bar 6 [nothing copied] (off)'),
      'Part color…',
    ]);
  });

  it('a gap: acid pressed in bar 10', () => {
    const added = { regions: [...acid.regions, bars(10, 1)], index: 3 };
    const spec = laneMenu({ ...press(acid, null, 9.4, gridClip), added }, commands);
    expect(spec.head).toBe('acid · bar 10');
    expect(shown(spec.items)).toEqual(['Paste at bar 10', 'Add region here', 'Loop this bar']);
    // Where a click would draw nothing, Add region here is off.
    expect(rowOf(laneMenu(press(acid, null, 9.4), commands), 'Add region').disabled).toBe(true);
  });

  it('no sequencer: pad’s ∞ region offers Set sequencer ▸ with every kind, and no Bounce', () => {
    const spec = laneMenu(press(pad, 0, 9.4), commands);
    expect(spec.head).toBe('pad · bars 1–16 · at bar 10');
    expect(shown(spec.items)).toEqual([
      ...EDITS('Paste at bar 10 [nothing copied] (off)'),
      'Set sequencer ▸',
      '—',
      'Part color…',
    ]);
    const sub = spec.items.find((i) => i.kind === 'submenu');
    expect(sub?.kind === 'submenu' && shown(sub.items)).toEqual([
      'Euclid',
      'Grid',
      'Chord',
      'Arp',
      'Basslead',
      'Figure',
      'Roll',
    ]);
  });

  it('only a part with no sequencer offers Set sequencer', () => {
    for (const on of [acid, kick, lead, arp]) {
      const spec = laneMenu(press(on, 0, 0.5), commands);
      expect(spec.items.some((i) => i.kind === 'submenu')).toBe(false);
    }
  });
});

describe('Paste at bar N', () => {
  it('is disabled with its reason on an empty clipboard and on another kind’s clip', () => {
    const { commands } = spy();
    expect(rowOf(laneMenu(press(acid, 1, 5.3), commands), 'Paste')).toMatchObject({
      tag: 'nothing copied',
      disabled: true,
    });
    const euclidClip = copyRegion(kick, 0);
    expect(rowOf(laneMenu(press(acid, 1, 5.3, euclidClip), commands), 'Paste')).toMatchObject({
      tag: 'clip is Euclid',
      disabled: true,
    });
  });

  it('lands at the pressed bar, rounded down, and previews the region there', () => {
    const clip = copyRegion(acid, 0);
    if (!clip) throw new Error('no clip');
    const { commands, calls } = spy(() => clip);
    const paste = rowOf(laneMenu(press(acid, null, 9.4, clip), commands), 'Paste at bar 10');
    paste.preview?.();
    paste.run();
    expect(calls[0]).toEqual(['showRegion', { ...bars(10, 4), pattern: clip.pattern }]);
    expect(calls[1]).toEqual(['place', pasteRegion(acid, clip, 9 * BAR, SONG)]);
  });

  it('near the song’s end lands and clips exactly as ⌘V does at that bar', () => {
    const clip = copyRegion(kick, 0);
    if (!clip) throw new Error('no clip');
    const { commands, calls } = spy(() => clip);
    const paste = rowOf(laneMenu(press(kick, 1, 14.5, clip), commands), 'Paste at bar 15');
    paste.run();
    const placed = pasteRegion(kick, clip, 14 * BAR, SONG);
    expect(calls).toEqual([['place', placed]]);
    expect('regions' in placed && placed.regions[placed.index]).toEqual({
      ...bars(15, 2),
      pattern: clip.pattern,
    });
  });
});

describe('a Paste row built under one clipboard', () => {
  it('pastes that clip while the clipboard still holds it, and is refused once it holds another', () => {
    const first = copyRegion(acid, 0);
    const second = copyRegion(acid, 2);
    if (!first || !second) throw new Error('no clip');
    let clipboard: RegionClip | null = first;
    const { commands, calls } = spy(() => clipboard);
    const paste = rowOf(laneMenu(press(acid, null, 9.4, first), commands), 'Paste at bar 10');
    clipboard = second;
    paste.run();
    clipboard = null;
    paste.run();
    expect(calls).toEqual([]);
    clipboard = first;
    paste.run();
    expect(calls).toEqual([['place', pasteRegion(acid, first, 9 * BAR, SONG)]]);
  });
});

describe('the region rows', () => {
  it('Split here cuts at the nearest bar line and selects the right half, as Alt-click does', () => {
    const { commands, calls } = spy();
    const split = rowOf(laneMenu(press(acid, 1, 5.6), commands), 'Split here');
    split.preview?.();
    split.run();
    expect(calls).toEqual([
      ['showCut', 6 * BAR],
      ['place', { regions: splitPartRegion(acid, 1, 5.6 * BAR, false, BAR), index: 2 }],
    ]);
  });

  it('Split here at a region’s first or last bar is disabled where Alt-click refuses', () => {
    const { commands } = spy();
    // acid's bars 5–8 run from bar line 4 to 8: a press nearest either edge cuts nothing.
    for (const at of [4.3, 7.7]) {
      expect(splitPartRegion(acid, 1, at * BAR, false, BAR)).toBeNull();
      expect(rowOf(laneMenu(press(acid, 1, at), commands), 'Split here').disabled).toBe(true);
    }
  });

  it('Cut, Copy, Duplicate and Delete run their keys’ commands on the pressed region', () => {
    const { commands, calls } = spy();
    const spec = laneMenu(press(acid, 1, 5), commands);
    for (const label of ['Cut', 'Copy', 'Duplicate', 'Delete']) rowOf(spec, label).run();
    expect(calls).toEqual([
      ['cut', 1],
      ['copy', 1],
      ['duplicate', 1],
      ['delete', 1],
    ]);
  });

  it('Zoom to region fits the region; Loop region loops it and previews the brace', () => {
    const { commands, calls } = spy();
    const spec = laneMenu(press(acid, 1, 5), commands);
    rowOf(spec, 'Zoom to region').run();
    const loop = rowOf(spec, 'Loop region');
    loop.preview?.();
    loop.unpreview?.();
    loop.run();
    const range = { start: 4 * BAR, end: 8 * BAR };
    expect(calls).toEqual([
      ['zoom', bars(5, 4)],
      ['showLoop', range],
      ['unpreview', undefined],
      ['loop', range],
    ]);
  });

  it('Bounce, Part color and a Set sequencer kind run their commands', () => {
    const { commands, calls } = spy();
    rowOf(laneMenu(press(acid, 0, 0), commands), 'Bounce').run();
    rowOf(laneMenu(press(acid, 0, 0), commands), 'Part color').run();
    const sub = laneMenu(press(pad, 0, 0), commands).items.find((i) => i.kind === 'submenu');
    const roll =
      sub?.kind === 'submenu'
        ? sub.items.find((i) => i.kind === 'row' && i.label === 'Roll')
        : undefined;
    if (roll?.kind === 'row') roll.run();
    expect(calls).toEqual([
      ['bounce', undefined],
      ['colour', undefined],
      ['setKind', 'roll'],
    ]);
  });
});

describe('the empty-lane rows', () => {
  it('Add region here draws what a click there would, and Loop this bar loops the pressed bar', () => {
    const { commands, calls } = spy();
    const added = { regions: [...acid.regions, bars(10, 1)], index: 3 };
    const spec = laneMenu({ ...press(acid, null, 9.4), added }, commands);
    const add = rowOf(spec, 'Add region here');
    add.preview?.();
    add.run();
    const loop = rowOf(spec, 'Loop this bar');
    loop.preview?.();
    loop.run();
    const range = { start: 9 * BAR, end: 10 * BAR };
    expect(calls).toEqual([
      ['showRegion', bars(10, 1)],
      ['place', added],
      ['showLoop', range],
      ['loop', range],
    ]);
  });
});

describe('where a press lands', () => {
  const scale = { pxPerBar: 96, bar: BAR };

  it('on a block, its region and the tick inside it; in a gap, none', () => {
    expect(lanePressAt(acid.regions, 5.5 * 96, scale)).toEqual({ region: 1, tick: 5.5 * BAR });
    expect(lanePressAt(acid.regions, 9.5 * 96, scale)).toEqual({ region: null, tick: 9.5 * BAR });
  });

  it('on a block widened past its span, a tick inside its span', () => {
    // A beat-long region at a scale so small its block is widened to the minimum width.
    const tiny = { pxPerBar: 8, bar: BAR };
    const regions = [{ start: 0, duration: BAR / 4 }];
    const box = partLaneGeometry(regions, tiny).boxes[0];
    if (!box) throw new Error('no box');
    const at = lanePressAt(regions, box.leftPx + box.widthPx - 0.5, tiny);
    expect(at.region).toBe(0);
    expect(at.tick).toBeLessThanOrEqual(BAR / 4);
  });
});

describe('a menu built for one document', () => {
  const rows = (items: readonly MenuItem[]): MenuRow[] =>
    items.flatMap((i) => (i.kind === 'row' ? [i] : i.kind === 'submenu' ? rows(i.items) : []));

  it('refuses every row, and every preview, once the document has changed', () => {
    const { commands, calls } = spy();
    let doc = 1;
    const built = doc;
    const spec = whileFresh(laneMenu(press(acid, 1, 5.5), commands), () => doc === built);
    rowOf(spec, 'Delete').run();
    expect(calls).toEqual([['delete', 1]]);
    // A region key, an undo or an edit elsewhere replaces the document.
    doc = 2;
    calls.length = 0;
    for (const row of rows(spec.items)) {
      row.preview?.();
      row.run();
    }
    expect(calls.filter(([name]) => name !== 'unpreview')).toEqual([]);
  });
});
