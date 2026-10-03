/**
 * The Figure device's strip (windsor#490, look
 * `docs/research/2026-10-03-figure-sequencer/figure.html`): one 32 px
 * column per written cell, grouped by the song's beats, its held rows
 * `figureCells.ts`'s and the modulation lanes under them, their names, ×
 * and readout in a column at the left with **+ Lane** in its corner. The
 * device is as wide as its cells and never scrolls them sideways; the
 * lanes scroll vertically under the held rows. The page tabs take the 20 px
 * a section label would, so the strip has none.
 *
 * It draws on the shared machinery: `stepStrip.ts`'s held columns,
 * `paintStrip` and the one playhead loop, the lanes of `stepModLane.ts`
 * through a `LaneHost`, and the region playhead (`regionPlayhead.ts`), the
 * engine's `regionStepAt`: the cell sounding after the schedule and the
 * drift, or for a canon its leader's cell. Every edit writes the selected
 * region's pattern (`changePattern`).
 *
 * A tone reads over the chord under the playhead (`chordRegionChord.ts`),
 * and cells past the stage in play are dimmed, not hidden. With a source
 * the strip draws the leader's cells greyed and read-only, with no lanes,
 * under the follower's own playhead. A frame repaints the strip when the
 * chord, the stage, the leader's line or Skip's zero has moved, and runs
 * the card's own per-frame paint (`onFrame`) in the same loop.
 */
import type { FigureCell, FigureSpec } from '@windsor/engine';
import { STEP_MOD_LANES_MAX, partAt, songTicksOf, ticksPerBar } from '@windsor/engine';
import { regionChord } from './chordRegionChord';
import type { AppCtx } from './context';
import { el } from './dom';
import { figureColumn } from './figureCells';
import { FIGURE_SUMMARY_STACK } from './figureConstants';
import { leaderOf, regionBar, stageIndexAt } from './figureProcessModel';
import { withStep } from './gridModel';
import { groupColumns } from './meterGrid';
import { changePattern } from './partEdits';
import { regionPlayheadAt } from './regionPlayhead';
import {
  type LaneHost,
  fillLanePicker,
  laneCells,
  lanePicker,
  paintLaneNames,
  patchBase,
} from './stepModLane';
import { NO_SLIDE } from './stepModLaneModel';
import { type Strip, markStep, paintStrip, specOf, watchPlayhead } from './stepStrip';

/** What the strip draws this frame: whose line, over which chord, at which stage. */
export interface FigureView {
  /** The line drawn: the part's own, or with a source its leader's. */
  readonly line: FigureSpec | null;
  /** True when the line is a leader's: read-only, greyed. */
  readonly borrowed: boolean;
  readonly leader: string | null;
  /** The chord's stack the tones read over. */
  readonly stack: readonly number[];
  /** The chord, or null with none. */
  readonly chord: ReturnType<typeof regionChord>;
  /** The region's local bar while the song is in it, else null. */
  readonly bar: number | null;
  /** The stage in play on the drawn line, -1 with no schedule. */
  readonly stage: number;
}

/** The Figure's strip and what it last drew. */
export interface FigureStrip extends Strip<FigureSpec> {
  /** The vertical scroller holding the lane names and the columns. */
  readonly scroll: HTMLElement;
  readonly names: HTMLElement;
  readonly picker: HTMLSelectElement;
  /** The corner's "n of 4 lanes". */
  readonly lanesCount: HTMLElement;
  readonly lanes: LaneHost;
  /** The section, greyed while the line is borrowed. */
  readonly section: HTMLElement;
  /** What it drew last. */
  view: FigureView;
}

/** What the strip shows now, read from the document and the transport. */
export function figureView(ctx: AppCtx, slot: number, region: number | undefined): FigureView {
  const own = specOf(ctx, slot, 'figure', region);
  const lead = own?.source ? leaderOf(ctx.model.doc, own.source) : null;
  const line = own?.source ? (lead?.spec ?? null) : own;
  const chord = regionChord(ctx, slot, region);
  const doc = ctx.model.doc;
  const bar = ctx.transport.running
    ? regionBar({
        regions: partAt(doc, slot)?.regions ?? [],
        songTicks: songTicksOf(doc),
        tick: ctx.transport.position(),
        region,
        barTicks: ticksPerBar(doc.transport.meter),
      })
    : null;
  return {
    line,
    borrowed: own?.source !== undefined,
    leader: lead?.name ?? null,
    stack: chord?.stack ?? FIGURE_SUMMARY_STACK,
    chord,
    bar,
    stage: line?.schedule?.length ? Math.max(0, stageIndexAt(line.schedule, bar ?? 0)) : -1,
  };
}

/** The cells the stage in play reaches: its length, or the line's with no schedule. */
const activeLength = (view: FigureView): number =>
  view.line?.schedule?.[view.stage]?.length ?? view.line?.length ?? 0;

/** Everything the strip shows, as one string: a frame repaints when it changes. */
function signature(strip: FigureStrip, view: FigureView): string {
  const own = strip.spec();
  const line = view.borrowed ? JSON.stringify(view.line) : '';
  return `${view.stack.join(',')}|${activeLength(view)}|${line}|${(own?.skipChance ?? 0) > 0}`;
}

/** Write one cell, edited from what the document holds now, into the region's pattern. */
function editCell(strip: FigureStrip, index: number, edit: (cell: FigureCell) => FigureCell): void {
  const spec = strip.spec();
  const now = spec?.cells[index];
  if (!spec || !now) return;
  const cells = withStep(spec.cells, index, edit(now));
  if (changePattern(strip.ctx, strip.slot, strip.region, { cells })) strip.repaint();
}

function columns(strip: FigureStrip, view: FigureView): HTMLElement[] {
  const line = view.line;
  if (!line) return [];
  const length = activeLength(view);
  return line.cells.map((cell, index) =>
    figureColumn({
      index,
      cell,
      stack: view.stack,
      active: index < length,
      edit: view.borrowed ? null : (edit) => editCell(strip, index, edit),
      under: view.borrowed ? [] : laneCells(strip.lanes, index, cell.kind === 'note'),
    }),
  );
}

/** Redraw the columns, the lane names and the corner from the document, keeping the scroll. */
function repaint(strip: FigureStrip): void {
  const scrollTop = strip.scroll.scrollTop;
  const view = figureView(strip.ctx, strip.slot, strip.region);
  strip.view = view;
  strip.section.classList.toggle('figure-borrowed', view.borrowed);
  paintLaneNames(strip.names, strip.lanes);
  strip.names.hidden = view.borrowed;
  paintStrip(strip, () =>
    groupColumns(
      columns(strip, view),
      view.line?.divisor ?? 1,
      strip.ctx.model.doc.transport.meter,
    ),
  );
  fillLanePicker(strip.picker, strip.lanes);
  strip.picker.disabled = view.borrowed;
  const spec = strip.spec();
  strip.lanesCount.textContent = view.borrowed
    ? `${view.leader ?? 'the leader'}'s cells`
    : `${spec?.lanes.length ?? 0} of ${STEP_MOD_LANES_MAX} lanes`;
  strip.scroll.scrollTop = scrollTop;
}

/** The one loop: a repaint when what the strip shows has moved, the card's own paint, then the playhead. */
function watch(strip: FigureStrip, hooks: FigureGridHooks): void {
  let drawn = signature(strip, strip.view);
  watchPlayhead({
    attached: () => strip.root.isConnected,
    // The device, not the strip: the strip's page hides while Process shows, and the loop still paints it.
    shown: () => (hooks.device() ?? strip.root).closest('[hidden]') === null,
    playheadAt: () => regionPlayheadAt(strip.ctx, strip.slot, strip.region),
    mark: markStep(strip),
    repaintIf: () => {
      const view = figureView(strip.ctx, strip.slot, strip.region);
      const now = signature(strip, view);
      if (now !== drawn) {
        drawn = now;
        strip.repaint();
      }
      hooks.onFrame(view);
    },
  });
}

/** What the lanes need of this card: the region's lanes, their write into its pattern, the patch they push. */
function laneHost(strip: Strip<FigureSpec>, scope: HTMLElement): LaneHost {
  const { ctx, slot, region } = strip;
  return {
    scope,
    lanes: () => strip.spec()?.lanes ?? null,
    base: (param) => patchBase(ctx, slot, param),
    write: (lanes) => changePattern(ctx, slot, region, { lanes }),
    repaint: () => strip.repaint(),
    stepCount: () => strip.spec()?.cells.length ?? 0,
    slide: () => NO_SLIDE,
  };
}

/** The lane names' column: + Lane and the lane count in the corner, level with the held rows. */
function namesColumn(strip: FigureStrip): HTMLElement {
  const corner = el('div', 'strip-head seq-corner');
  corner.append(strip.picker, strip.lanesCount, el('span', 'seq-row-label', 'Ratchet'));
  const column = el('div', 'seq-names');
  column.append(corner, strip.names);
  return column;
}

/** What the card hands the strip's loop. */
export interface FigureGridHooks {
  /** Called with what the strip shows on every frame the device is on screen. */
  onFrame(view: FigureView): void;
  /** The device body, whose hiding idles the loop; null until it is built. */
  device(): HTMLElement | null;
}

/** The strip for region `region` of the Figure part on `slot`, and its loop. */
export function figureGrid(
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
  hooks: FigureGridHooks,
): FigureStrip {
  const scroll = el('div', 'seq-strip');
  const base: Strip<FigureSpec> = {
    ctx,
    slot,
    region,
    root: el('div', 'grid-strip'),
    playing: -1,
    spec: () => specOf(ctx, slot, 'figure', region),
    repaint: () => repaint(strip),
  };
  const lanes = laneHost(base, scroll);
  const strip: FigureStrip = {
    ...base,
    scroll,
    names: el('div', 'seq-lane-names'),
    picker: lanePicker(lanes),
    lanesCount: el('span', 'seq-meas'),
    lanes,
    section: el('div', 'seq-section steps figure-strip'),
    view: figureView(ctx, slot, region),
  };
  scroll.append(namesColumn(strip), strip.root);
  const body = el('div', 'seq-sec-body');
  body.appendChild(scroll);
  strip.section.appendChild(body);
  repaint(strip);
  watch(strip, hooks);
  return strip;
}
