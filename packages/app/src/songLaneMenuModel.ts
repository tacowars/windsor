/**
 * The Song tab lane's context menu, as a spec (windsor#826; record
 * `2026-10-16-song-tab-context-menu`, decisions 1–4; the approved mockups
 * `docs/design/song-region-menu-mockup.html` and
 * `docs/design/song-region-menu-tablet-mockup.html`), pure so it is tested
 * in Node: from the pressed part, the region or gap under the press, the
 * pressed tick and the clipboard, the `MenuSpec` the shared context menu
 * draws. Every row's work, and every preview, goes through the commands the
 * caller hands in; `songLaneMenu.ts` wires them to the lane and the view.
 *
 * - **A region:** Cut, Copy, Paste at bar N, Duplicate, Delete and Split
 *   here; Zoom to region and Loop region; Set sequencer ▸ on a part with no
 *   sequencer, else the pattern group (`songLanePatternGroup.ts`, windsor#827:
 *   the card's pattern actions and Fit region to pattern); then Bounce part
 *   to Roll… where the pane offers it, and Part color….
 * - **A gap:** Paste at bar N, Add region here and Loop this bar.
 */
import type { Meter, MusicPart, PartRegion, SequencerKind } from '@windsor/engine';
import { SEQUENCER_KINDS } from '@windsor/engine';
import { bounceButtonState } from './bounceButtonModel';
import { laneHitAt } from './laneEditModel';
import type { MenuItem, MenuRow, MenuSpec } from './contextMenuModel';
import { SEPARATOR } from './contextMenuModel';
import type { LoopRange } from './loopBraceModel';
import { barLoopRange, regionLoopRange } from './loopBraceModel';
import { splitPartRegion } from './partEdits';
import type { LaneScale } from './partLaneModel';
import { partLaneGeometry, pressedRegion } from './partLaneModel';
import type { RegionClip } from './regionClipboard';
import { pasteRegion, pasteTick } from './regionClipboard';
import { snapTick } from './regionModel';
import type { Placement } from './regionPlacement';
import type { RollSnap } from './rollTables';
import { KIND_LABELS } from './sequencerConstants';
import type { PatternGroupCommands } from './songLanePatternGroup';
import { patternGroup } from './songLanePatternGroup';
import { boxTick, pxToTick } from './songViewTables';

/** The menu's words, in US English (decision 11). */
export const LANE_MENU_TEXT = {
  cut: 'Cut',
  copy: 'Copy',
  paste: (bar: number): string => `Paste at bar ${bar}`,
  duplicate: 'Duplicate',
  delete: 'Delete',
  split: 'Split here',
  zoom: 'Zoom to region',
  loopRegion: 'Loop region',
  setSequencer: 'Set sequencer',
  bounce: 'Bounce part to Roll…',
  colour: 'Part color…',
  loadRack: 'Load rack…',
  add: 'Add region here',
  loopBar: 'Loop this bar',
  nothingCopied: 'nothing copied',
  clipIs: (kind: SequencerKind): string => `clip is ${KIND_LABELS[kind]}`,
} as const;

/** The keyboard hints a mouse-opened menu shows beside today's commands. */
export const LANE_MENU_KEYS = {
  cut: '⌘X',
  copy: '⌘C',
  duplicate: '⌘D',
  delete: '⌫',
  split: '⌥-click',
} as const;

type LanePart = Pick<MusicPart, 'name' | 'slot' | 'sequencer' | 'regions'>;

/** The press that opened the menu, and what the menu reads besides. */
export interface LaneMenuPress {
  readonly part: LanePart;
  /** The pressed region's index, or null on a gap. */
  readonly region: number | null;
  /** The pressed tick from the song's start; on a region, inside its span. */
  readonly tick: number;
  /** One bar of the song's meter, in ticks. */
  readonly bar: number;
  readonly meter: Meter | undefined;
  readonly songTicks: number;
  /** The Roll card's Snap for the part: what Quantize names and snaps to. */
  readonly snap: RollSnap;
  /** The view's clipboard: what Copy or Cut last took. */
  readonly clip: RegionClip | null;
  /** On a gap, what a click there would draw (`drawRegionChange`); null when it draws nothing. */
  readonly added: Placement | null;
}

/** A span of the song, in ticks. */
export interface TickSpan {
  readonly start: number;
  readonly duration: number;
}

/** What the rows do, and the previews they draw: `songLaneMenu.ts` implements them. */
export interface LaneMenuCommands extends PatternGroupCommands {
  /** The view's clipboard now, which Paste checks at the run against the clip it was built for. */
  clipboard(): RegionClip | null;
  cut(index: number): void;
  copy(index: number): void;
  /** ⌘D's duplicate, which does nothing on a region that ends the song. */
  duplicate(index: number): void;
  delete(index: number): void;
  /** Commit regions a paste, a split or an add made, and select the one at `placed.index`. */
  place(placed: Placement): void;
  zoom(span: TickSpan): void;
  /** Set the song loop to `range` and turn it on, as one undo step. */
  loop(range: LoopRange): void;
  bounce(): void;
  colour(): void;
  /** Open the browser on Racks with this part as the target (windsor#885). */
  loadRack(): void;
  setKind(kind: SequencerKind): void;
  /** Preview: a dashed box where a region would land. */
  showRegion(span: TickSpan): void;
  /** Preview: a line where a split would cut. */
  showCut(tick: number): void;
  /** Preview: the loop brace a loop command would set. */
  showLoop(range: LoopRange): void;
  /** Take any preview away. */
  unpreview(): void;
}

/**
 * What a press `px` into a lane of `regions` lands on, as a click reads it:
 * the region whose drawn block it hits (on a seam, the region holding its
 * tick), or null in a gap; and the pressed tick, mapped through a region's
 * drawn box as Alt-click maps it, so a block widened past its span still
 * presses inside it.
 */
export function lanePressAt(
  regions: readonly PartRegion[],
  px: number,
  scale: LaneScale,
): { readonly region: number | null; readonly tick: number } {
  const geometry = partLaneGeometry(regions, scale);
  const tick = pxToTick(px, scale.pxPerBar, scale.bar);
  const index = pressedRegion(regions, { hit: laneHitAt(geometry, px), tick });
  const region = regions[index];
  const box = geometry.boxes[index];
  if (!region || !box) return { region: null, tick };
  const span = { startTick: region.start, durationTicks: region.duration };
  return { region: index, tick: boxTick(box, px, span, scale.pxPerBar, scale.bar) };
}

/** The 1-based bar holding `tick`. */
const barNumber = (tick: number, bar: number): number => Math.floor(tick / bar) + 1;

function row(label: string, run: () => void, extra: Partial<Omit<MenuRow, 'kind'>> = {}): MenuRow {
  return { kind: 'row', label, run, ...extra };
}

/** A row that previews with `show` and takes it away with the commands' `unpreview`. */
function previewed(
  label: string,
  run: () => void,
  show: () => void,
  commands: LaneMenuCommands,
): MenuRow {
  return row(label, run, { preview: show, unpreview: () => commands.unpreview() });
}

/**
 * Paste at bar N (decision 2): the clip laid down at the pressed bar,
 * rounded down, exactly as ⌘V lays it at that bar; disabled with its reason
 * when nothing is copied or the clip is another kind. It pastes only the clip
 * it was built for: once the clipboard holds another, the row is refused.
 */
export function pasteRow(press: LaneMenuPress, commands: LaneMenuCommands): MenuRow {
  const { part, clip, tick, bar, songTicks } = press;
  const start = pasteTick(tick, songTicks, bar);
  const label = LANE_MENU_TEXT.paste(barNumber(start, bar));
  if (!clip)
    return row(label, () => undefined, { tag: LANE_MENU_TEXT.nothingCopied, disabled: true });
  if (clip.kind !== part.sequencer.kind) {
    return row(label, () => undefined, { tag: LANE_MENU_TEXT.clipIs(clip.kind), disabled: true });
  }
  const placed = pasteRegion(part, clip, start, songTicks);
  if ('refused' in placed) return row(label, () => undefined, { disabled: true });
  const region = placed.regions[placed.index];
  const show = (): void => {
    if (region) commands.showRegion(region);
  };
  const run = (): void => {
    if (commands.clipboard() === clip) commands.place(placed);
  };
  return previewed(label, run, show, commands);
}

/** Split here (decision 2): Alt-click's cut at the nearest bar line, disabled where Alt-click refuses. */
function splitRow(press: LaneMenuPress, index: number, commands: LaneMenuCommands): MenuRow {
  const regions = splitPartRegion(press.part, index, press.tick, false, press.bar);
  const extra = { tag: LANE_MENU_KEYS.split, kbd: true };
  if (!regions) return row(LANE_MENU_TEXT.split, () => undefined, { ...extra, disabled: true });
  const cut = snapTick(press.tick, press.bar);
  return row(LANE_MENU_TEXT.split, () => commands.place({ regions, index: index + 1 }), {
    ...extra,
    preview: () => commands.showCut(cut),
    unpreview: () => commands.unpreview(),
  });
}

/** Today's commands: Cut, Copy, Paste at bar N, Duplicate, Delete, Split here. */
function editRows(press: LaneMenuPress, index: number, commands: LaneMenuCommands): MenuItem[] {
  const keyed = (tag: string): Partial<MenuRow> => ({ tag, kbd: true });
  return [
    row(LANE_MENU_TEXT.cut, () => commands.cut(index), keyed(LANE_MENU_KEYS.cut)),
    row(LANE_MENU_TEXT.copy, () => commands.copy(index), keyed(LANE_MENU_KEYS.copy)),
    pasteRow(press, commands),
    row(LANE_MENU_TEXT.duplicate, () => commands.duplicate(index), keyed(LANE_MENU_KEYS.duplicate)),
    row(LANE_MENU_TEXT.delete, () => commands.delete(index), keyed(LANE_MENU_KEYS.delete)),
    splitRow(press, index, commands),
  ];
}

/** Set sequencer ▸ (decision 4): every kind but none, as the Parts tab's Seq picker lists them. */
function setSequencerMenu(commands: LaneMenuCommands, kinds: readonly SequencerKind[]): MenuItem {
  const items = kinds
    .filter((kind) => kind !== 'none')
    .map((kind) => row(KIND_LABELS[kind], () => commands.setKind(kind)));
  return { kind: 'submenu', label: LANE_MENU_TEXT.setSequencer, items };
}

/** Load rack… (windsor#885), Bounce part to Roll… where the pane's button is, and Part color…. */
function partRows(part: LanePart, commands: LaneMenuCommands): MenuItem[] {
  const bounce = bounceButtonState(part);
  const load = row(LANE_MENU_TEXT.loadRack, () => commands.loadRack());
  const colour = row(LANE_MENU_TEXT.colour, () => commands.colour());
  if (!bounce) return [load, colour];
  return [
    load,
    row(LANE_MENU_TEXT.bounce, () => commands.bounce(), { disabled: bounce.disabled }),
    colour,
  ];
}

/** The region head: `<part> · bars <s>–<e> · at bar <n>`. */
const regionHead = (part: LanePart, region: PartRegion, press: LaneMenuPress): string => {
  const first = barNumber(region.start, press.bar);
  const last = Math.ceil((region.start + region.duration) / press.bar);
  return `${part.name} · bars ${first}–${last} · at bar ${barNumber(press.tick, press.bar)}`;
};

function regionMenu(
  press: LaneMenuPress,
  index: number,
  commands: LaneMenuCommands,
  kinds: readonly SequencerKind[],
): MenuSpec | null {
  const { part, songTicks } = press;
  const region = part.regions[index];
  if (!region) return null;
  const range = regionLoopRange(region, songTicks);
  const view = [
    row(LANE_MENU_TEXT.zoom, () => commands.zoom(region)),
    previewed(
      LANE_MENU_TEXT.loopRegion,
      () => commands.loop(range),
      () => commands.showLoop(range),
      commands,
    ),
  ];
  const group =
    part.sequencer.kind === 'none'
      ? [setSequencerMenu(commands, kinds)]
      : patternGroup(press, index, commands);
  const pattern = group.length > 0 ? [SEPARATOR, ...group] : [];
  return {
    head: regionHead(part, region, press),
    items: [
      ...editRows(press, index, commands),
      SEPARATOR,
      ...view,
      ...pattern,
      SEPARATOR,
      ...partRows(part, commands),
    ],
  };
}

function gapMenu(press: LaneMenuPress, commands: LaneMenuCommands): MenuSpec {
  const { part, added, tick, bar, songTicks } = press;
  const region = added?.regions[added.index];
  const add =
    added && region
      ? previewed(
          LANE_MENU_TEXT.add,
          () => commands.place(added),
          () => commands.showRegion(region),
          commands,
        )
      : row(LANE_MENU_TEXT.add, () => undefined, { disabled: true });
  const range = barLoopRange(tick, bar, songTicks);
  const loop = previewed(
    LANE_MENU_TEXT.loopBar,
    () => commands.loop(range),
    () => commands.showLoop(range),
    commands,
  );
  return {
    head: `${part.name} · bar ${barNumber(tick, bar)}`,
    items: [pasteRow(press, commands), add, loop, SEPARATOR, ...partRows(part, commands)],
  };
}

/**
 * The menu a press on a lane opens: the region menu on a region, the
 * empty-lane menu on a gap (or on a region index the part no longer has).
 */
export function laneMenu(
  press: LaneMenuPress,
  commands: LaneMenuCommands,
  kinds: readonly SequencerKind[] = SEQUENCER_KINDS,
): MenuSpec {
  const onRegion = press.region === null ? null : regionMenu(press, press.region, commands, kinds);
  return onRegion ?? gapMenu(press, commands);
}

/** `item`, its rows (and a submenu's) running and previewing only while `fresh()` holds, `ran` told first. */
function freshItem(item: MenuItem, fresh: () => boolean, ran: () => void): MenuItem {
  if (item.kind === 'separator') return item;
  if (item.kind === 'submenu')
    return { ...item, items: item.items.map((i) => freshItem(i, fresh, ran)) };
  const { preview } = item;
  return {
    ...item,
    run: () => {
      ran();
      if (fresh()) item.run();
    },
    ...(preview && {
      preview: () => {
        if (fresh()) preview();
      },
    }),
  };
}

/**
 * `spec`, built for one document, refusing every row once `fresh()` says the
 * document has changed (a region key, an undo or redo, or an edit made
 * elsewhere while the menu is open): a stale row's region index and
 * placements would act on the wrong region or overwrite that edit. The lane
 * also closes the menu on that change (`songLaneMenu.ts`); this keeps a row
 * that still runs from acting stale. An unpreview always runs, so nothing
 * shown is left behind. `ran` hears of every row run, fresh or not, before
 * it runs: the menu has closed by then (`songLaneMenu.ts` ends its watch).
 */
export const whileFresh = (
  spec: MenuSpec,
  fresh: () => boolean,
  ran: () => void = () => undefined,
): MenuSpec => ({
  ...spec,
  items: spec.items.map((item) => freshItem(item, fresh, ran)),
});
