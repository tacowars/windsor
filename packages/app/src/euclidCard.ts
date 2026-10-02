/**
 * The Euclid card (#610; the device of windsor#356, record
 * `2026-10-01-euclid-lanes-and-ratchets` decisions 9 and 10, and its
 * mockup): rail buttons (`euclidRail.ts`) for the sequencer device's shared
 * rail (`sequencerDevice.ts`, windsor#368) and two pages under tabs
 * (`euclidTabs.ts`). **Pattern** (`euclidPatternPage.ts`) holds the Play
 * knobs and the stack of rows: the ratchet row over the trigger figure, and
 * the drawn lanes below it (`euclidRows.ts`, `euclidLaneRows.ts`).
 * **Density** (`euclidDensityPage.ts`) holds the modulator, its plot of `k`
 * and the `k` bounds. The page and the lane view are the session's.
 *
 * Every edit goes through `ctx.change` into the pane's selected region's
 * pattern (windsor#75, `changePattern`) and, since the engine reconfigures
 * a Euclidean part live, none restarts the sequencer. The trigger row shows
 * the player's live figure for that region while the transport is inside
 * it, elsewhere the region's own preview (`euclidFigure.ts`), so Capture
 * freezes the selected region's figure.
 *
 * One playhead loop (`stepStrip.ts`'s `watchPlayhead`): each frame reads the
 * region's step once (the engine's `regionStepAt`, its `localStep` the
 * lanes' clock), rebuilds the rows when what they show changed (the
 * document, the figure, the view, or the pass under the hits), and lights
 * every row's ring on its own step.
 */
import type { EuclideanSpec, RegionStep } from '@windsor/engine';
import { PPQ, TICKS_PER_BAR, partAt } from '@windsor/engine';
import { PERC_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { type EuclidCard, setView, viewOf, writeRows } from './euclidCardState';
import { EUCLID_PLOT_SECONDS_DIGITS, EUCLID_READOUT_HINT } from './euclidConstants';
import { BarLineWatch, plotSeconds } from './euclidBarLines';
import { densityNote, plotBar } from './euclidDensityModel';
import { type DensityPage, densityPage } from './euclidDensityPage';
import { regionFigure } from './euclidFigure';
import { laneChoices, laneLength, lanesOf } from './euclidLaneModel';
import { cycleText, fullCycle } from './euclidLaneView';
import { type Figure, countOnsets, figureKey, stepsPerBeat } from './euclidModel';
import { shownPass } from './euclidPass';
import { type PatternPage, fillPicker, patternPage } from './euclidPatternPage';
import { holdWhilePressed } from './euclidPressHold';
import { euclidRailTools } from './euclidRail';
import type { RowHead } from './euclidRowParts';
import { paintRows } from './euclidRows';
import { euclidTabs } from './euclidTabs';
import { lightPlayhead } from './regionPlayhead';
import type { DeviceBody } from './sequencerDevice';
import { specOf, watchPlayhead } from './stepStrip';

const SECONDS_PER_MINUTE = 60;

/** The card's handle plus what its loop keeps between frames. */
interface Live {
  readonly card: EuclidCard;
  readonly pattern: PatternPage;
  readonly density: DensityPage;
  readonly note: HTMLElement;
  /** What the rows were built from; they are rebuilt when it differs. */
  rowsKey: string;
  heads: RowHead[];
  /** Each row's lit playhead, so a frame relights only what moved. */
  lit: number[];
  plotKey: string;
  /** The bar lines the scheduler issued while the card watched: the Hz plot's anchor. */
  readonly bars: BarLineWatch;
}

/** The region's step at the transport's tick; the part's own step with no region named. */
function stepAtPosition(ctx: AppCtx, slot: number, region: number | undefined): RegionStep | null {
  const tick = ctx.transport.position();
  if (region !== undefined) return ctx.host.regionStepAt(slot, region, tick);
  const step = ctx.host.stepAt(slot, tick);
  return step < 0 ? null : { step, live: true };
}

/** The region's step at the audible tick: null while halted. */
function readAt(ctx: AppCtx, slot: number, region: number | undefined): RegionStep | null {
  return ctx.transport.running ? stepAtPosition(ctx, slot, region) : null;
}

function figureOf(ctx: AppCtx, slot: number, region: number | undefined): Figure {
  const source = {
    doc: ctx.model.doc,
    capturePattern: (s: number, r?: number) => ctx.host.capturePattern(s, r),
    regionStepAt: (s: number, r: number, tick: number) => ctx.host.regionStepAt(s, r, tick),
    position: () => ctx.transport.position(),
  };
  return regionFigure(source, slot, region);
}

/** Everything the rows show, as one string: the rows rebuild when it changes. */
function rowsKeyOf(live: Live, spec: EuclideanSpec, figure: Figure, pass: number): string {
  const { ratchets, accentLane, pitchLane, modLanes, steps, divisor, rotate } = spec;
  const view = viewOf(live.card.slot).lanes;
  const shown = [ratchets, accentLane, pitchLane, modLanes, steps, divisor, rotate];
  return JSON.stringify([shown, spec.pattern != null, figureKey(figure), view, pass]);
}

function paintAll(live: Live, spec: EuclideanSpec, figure: Figure, pass: number): void {
  const { card, pattern } = live;
  const view = viewOf(card.slot).lanes;
  const group = stepsPerBeat(spec.divisor);
  live.heads = paintRows(pattern.rows, { card, spec, figure, view, pass, group });
  live.lit = live.heads.map(() => Number.NaN);
  fillPicker(pattern.picker, laneChoices(spec));
  const lengths = lanesOf(spec).map((ref) => laneLength(spec, ref));
  pattern.cycle.textContent = cycleText(fullCycle(spec.steps, lengths, spec.divisor));
  pattern.captureButton.textContent = spec.pattern ? 'Release' : 'Capture';
}

/** Rebuild the rows if what they show changed, unless a press is held on them. */
function repaintRows(live: Live, spec: EuclideanSpec, figure: Figure): void {
  const { ctx, slot, region, at } = live.card;
  const view = viewOf(slot).lanes;
  const pass = shownPass({
    view,
    steps: spec.steps,
    at,
    state: ctx.transport.state,
    heldStep: () => stepAtPosition(ctx, slot, region),
  });
  const key = rowsKeyOf(live, spec, figure, pass);
  if (key === live.rowsKey || live.card.pressing) return;
  live.rowsKey = key;
  paintAll(live, spec, figure, pass);
}

function lightRows(live: Live): void {
  live.heads.forEach((row, i) => {
    const head = row.head(live.card.at);
    if (head === live.lit[i]) return;
    live.lit[i] = head;
    lightPlayhead(row.cells, head);
  });
}

/**
 * Watch the scheduler's bar lines while it runs (`euclidBarLines.ts`);
 * halted, the log is dropped, since a seek or a stop restamps the lines.
 */
function followBars(live: Live): void {
  const { ctx } = live.card;
  const system = ctx.host.system;
  live.bars.follow(system && ctx.transport.running ? system.scheduler : null);
}

/**
 * The transport seconds on the audible bar's line: what an Hz LFO reads
 * there, whether or not the song is in the card's region. The scheduler's
 * own stamp on that line when the card saw it issued, so a tempo or swing
 * edit with ticks queued cannot move it (windsor#383); otherwise the
 * engine's clock wound back (`barLineSeconds`). 0 before audio.
 */
function transportSeconds(live: Live): number {
  const { ctx } = live.card;
  const system = ctx.host.system;
  if (!system) return 0;
  const at = { tick: ctx.transport.position(), now: system.engine.context.currentTime };
  return plotSeconds(live.bars.log, system.scheduler.transport, at);
}

/** The tab row's note and, on the Density page, the plot of `k`. */
function paintDensity(live: Live, spec: EuclideanSpec, figure: Figure): void {
  const k = countOnsets(figure);
  const note = densityNote(spec, k);
  if (live.note.textContent !== note) live.note.textContent = note;
  if (viewOf(live.card.slot).page !== 'density') return;
  const { ctx, at } = live.card;
  const songBar = ctx.transport.running ? Math.floor(ctx.transport.position() / TICKS_PER_BAR) : 0;
  const bar = plotBar(at, spec.divisor, songBar);
  const bpm = ctx.model.doc.transport.bpm;
  const seconds = transportSeconds(live);
  const clock = { bar, seconds, secondsPerBar: (SECONDS_PER_MINUTE / bpm) * (TICKS_PER_BAR / PPQ) };
  const shown = spec.density.kind === 'lfoHz' ? seconds.toFixed(EUCLID_PLOT_SECONDS_DIGITS) : bar;
  const key = JSON.stringify([spec.pulses, spec.density, spec.steps, k, shown, bpm]);
  if (key === live.plotKey) return;
  live.plotKey = key;
  live.density.paint(spec, k, clock);
}

/** Per frame while the card is on screen: the step, the rows, the rings, the density readouts. */
function watch(live: Live, root: HTMLElement): void {
  const { card } = live;
  watchPlayhead({
    attached: () => {
      if (!root.isConnected) live.bars.close();
      return root.isConnected;
    },
    shown: () => root.closest('[hidden]') === null,
    // Each row lights its own ring in `repaintIf`, from the one step read there.
    playheadAt: () => 0,
    mark: () => undefined,
    repaintIf: () => {
      card.at = readAt(card.ctx, card.slot, card.region);
      const spec = card.spec();
      if (!spec) return;
      const figure = card.figure();
      repaintRows(live, spec, figure);
      lightRows(live);
      followBars(live);
      paintDensity(live, spec, figure);
    },
  });
}

function capture(card: EuclidCard, pattern: Figure | null): void {
  if (!card.write({ pattern })) return;
  card.ctx.notify(
    pattern
      ? `part ${card.slot}: captured — the figure is a literal array in the document`
      : `part ${card.slot}: released back to the modulator`,
  );
}

/** The card's handle; `ref.live` is filled in once its pages exist. */
function handle(
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
  ref: { live: Live | null },
): EuclidCard {
  const card: EuclidCard = {
    ctx,
    slot,
    region,
    at: null,
    pressing: false,
    dependents: [],
    spec: () => specOf(ctx, slot, 'euclidean', region),
    figure: () => figureOf(ctx, slot, region),
    write: (fields) => writeRows(ctx, slot, region, fields),
    say: (text) => {
      if (ref.live) ref.live.pattern.readout.textContent = text ?? EUCLID_READOUT_HINT;
    },
    capture: (pattern) => capture(card, pattern),
    refresh: () => {
      if (ref.live) ref.live.rowsKey = '';
    },
  };
  return card;
}

/**
 * The card for a Euclidean part's region `region`: the tabs and the Pattern
 * and Density pages as its device's body (`sequencerDevice.ts`,
 * windsor#368), and the lane-view toggle and **?** for the shared rail.
 */
export function euclidCard(ctx: AppCtx, slot: number, region?: number): DeviceBody {
  const ref: { live: Live | null } = { live: null };
  const card = handle(ctx, slot, region, ref);
  const pattern = patternPage(card);
  const density = densityPage(card);
  const view = viewOf(slot);
  const tabs = euclidTabs({ pattern: pattern.root, density: density.root }, view.page, (page) => {
    setView(slot, { page });
    if (ref.live) ref.live.plotKey = '';
  });
  const state: Live = {
    card,
    pattern,
    density,
    note: tabs.note,
    rowsKey: '',
    heads: [],
    lit: [],
    plotKey: '',
    bars: new BarLineWatch(),
  };
  ref.live = state;
  holdWhilePressed(card, pattern.rows, window);
  const tools = euclidRailTools(view.lanes, (lanes) => {
    setView(slot, { lanes });
    card.refresh();
  });
  const body = el('div', 'euclid-body');
  body.style.setProperty('--kc', PERC_COLOR);
  body.append(tabs.row, pattern.root, density.root);
  const spec = card.spec();
  if (spec) repaintRows(state, spec, card.figure());
  watch(state, body);
  const note = partAt(ctx.model.doc, slot)?.name ?? '';
  return { body, fit: 'natural', tools, note, className: 'euclid-card' };
}
