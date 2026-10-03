/**
 * The Grid device (#603; a rack device since windsor#368, record
 * `2026-10-01-sequencer-rack-devices`, look
 * `docs/research/2026-09-30-sequencer-rack/grid.html`): the body the Song
 * pane's frame (`sequencerDevice.ts`) puts beside the shared rail, at the
 * device's one height. Two sections: Play, the controls in columns
 * (`gridControls.ts`), and Steps, the strip.
 *
 * The strip is one column per written step, 32 px wide and grouped by the
 * song's beats (`meterGrid.ts`, windsor#431), its cells `gridCells.ts`'s:
 * the note cell, the degree picker, Oct, A, S and the
 * ratchet held at the top, and a cell per modulation lane (windsor#31)
 * under them. The device is as wide as its steps and never scrolls them
 * sideways; the lanes scroll vertically under the step rows, their names,
 * × and readout in a column at the left with **+ Lane** in its corner.
 * Length pads the lanes with the steps, and Rotate turns them, and the
 * ratchets, with the steps. A lane click writes on its release, so every
 * edit here reads lanes the document already holds.
 *
 * Every edit writes a full copy of the selected region's pattern
 * (windsor#76, `changePattern`), never `part.sequencer`, so two regions of
 * one part keep their own steps and lanes. The cells keep their tooltips;
 * the hint paragraph went with windsor#368.
 */
import type { GridSpec } from '@windsor/engine';
import { STEP_MOD_LANES_MAX } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { gridColumn } from './gridCells';
import { gridControls } from './gridControls';
import { keySignature, slideAt } from './gridModel';
import { groupColumns } from './meterGrid';
import { changePattern } from './partEdits';
import { regionPlayheadAt } from './regionPlayhead';
import type { DeviceBody } from './sequencerDevice';
import {
  type LaneHost,
  fillLanePicker,
  lanePicker,
  paintLaneNames,
  partPatch,
  patchBase,
} from './stepModLane';
import { NO_SLIDE } from './stepModLaneModel';
import { type Strip, markStep, paintStrip, specOf, watchPlayhead } from './stepStrip';

/**
 * This card's strip: one column per written step of a `grid` spec, and its
 * lanes. Its `playing` is a `regionPlayhead.ts` number: a bright step, a
 * ghost step or dark, which `paintStrip` relights after every repaint.
 */
interface GridStrip extends Strip<GridSpec> {
  /** The vertical scroller holding the lane names and the columns. */
  scroll: HTMLElement;
  names: HTMLElement;
  picker: HTMLSelectElement;
  /** The corner's "n of 4 lanes". */
  count: HTMLElement;
  /** The Steps label's count. */
  length: HTMLElement;
  lanes: LaneHost;
}

/** Redraw every column, the lane names, the corner and the label from the document, keeping the scroll. */
function repaint(strip: GridStrip): void {
  const scrollTop = strip.scroll.scrollTop;
  paintLaneNames(strip.names, strip.lanes);
  paintStrip(strip, (spec) =>
    groupColumns(
      spec.steps.map((_, index) => gridColumn(strip, strip.lanes, index, spec)),
      spec.divisor,
      strip.ctx.model.doc.transport.meter,
    ),
  );
  fillLanePicker(strip.picker, strip.lanes);
  const spec = strip.spec();
  strip.count.textContent = `${spec?.lanes.length ?? 0} of ${STEP_MOD_LANES_MAX} lanes`;
  strip.length.textContent = String(spec?.length ?? '');
  strip.scroll.scrollTop = scrollTop;
}

/**
 * Per frame while the card is on screen: the playhead (the engine's own step
 * for the audible tick, bright in the region and a ghost outside it —
 * `regionPlayhead.ts`, windsor#97), and a repaint when the transport strip's
 * root or scale has changed since the labels were drawn — a root knob goes
 * through `ctx.change` alone, which re-renders nothing — or Skip has moved to
 * or from 0, which decides whether a slide's hold on a lane is certain.
 */
function watch(strip: GridStrip): void {
  const signature = (): string =>
    `${keySignature(strip.ctx.model.doc.harmony)}|${(strip.spec()?.skipChance ?? 0) > 0}`;
  let keySig = signature();
  watchPlayhead({
    attached: () => strip.root.isConnected,
    shown: () => strip.root.closest('[hidden]') === null,
    playheadAt: () => regionPlayheadAt(strip.ctx, strip.slot, strip.region),
    mark: markStep(strip),
    repaintIf: () => {
      const sig = signature();
      if (sig === keySig) return;
      keySig = sig;
      strip.repaint();
    },
  });
}

/**
 * What the lanes need of this card: its region's lanes, their write into that
 * region's pattern (windsor#76), the patch they push, and the region's own
 * steps for the slide readout and the held-cell dimming.
 */
function laneHost(strip: Strip<GridSpec>, scope: HTMLElement): LaneHost {
  const { ctx, slot, region } = strip;
  const spec = (): GridSpec | null => strip.spec();
  return {
    scope,
    lanes: () => spec()?.lanes ?? null,
    base: (param) => patchBase(ctx, slot, param),
    patch: () => partPatch(ctx, slot),
    write: (lanes) => changePattern(ctx, slot, region, { lanes }),
    repaint: () => strip.repaint(),
    stepCount: () => spec()?.steps.length ?? 0,
    slide: (index) => {
      const s = spec();
      return s ? slideAt(s, index, ctx.model.doc.harmony) : NO_SLIDE;
    },
  };
}

/** The lane names' column: + Lane and the lane count in the corner, level with the step rows, then a row per lane. */
function namesColumn(strip: GridStrip): HTMLElement {
  const corner = el('div', 'strip-head seq-corner');
  corner.append(strip.picker, strip.count, el('span', 'seq-row-label', 'Ratchet'));
  const column = el('div', 'seq-names');
  column.append(corner, strip.names);
  return column;
}

/** The Steps section: its label and count, then the strip. */
function stepsSection(strip: GridStrip): HTMLElement {
  const label = el('div', 'seq-sec-label', 'Steps');
  label.appendChild(strip.length);
  strip.scroll.append(namesColumn(strip), strip.root);
  const body = el('div', 'seq-sec-body');
  body.appendChild(strip.scroll);
  const section = el('div', 'seq-section steps');
  section.append(label, body);
  return section;
}

/**
 * The device body for a `grid` part's region `region` (windsor#76): the
 * controls and the strip with its lanes. With no region named it edits the
 * part's sequencer.
 */
export function gridCard(ctx: AppCtx, slot: number, region?: number): DeviceBody {
  const scroll = el('div', 'seq-strip');
  const base: Strip<GridSpec> = {
    ctx,
    slot,
    region,
    root: el('div', 'grid-strip'),
    playing: -1,
    spec: () => specOf(ctx, slot, 'grid', region),
    repaint: () => repaint(strip),
  };
  const lanes = laneHost(base, scroll);
  const strip: GridStrip = {
    ...base,
    scroll,
    names: el('div', 'seq-lane-names'),
    picker: lanePicker(lanes),
    count: el('span', 'seq-meas'),
    length: el('em'),
    lanes,
  };
  const body = el('div', 'seq-device-body grid-device');
  body.append(gridControls(strip), stepsSection(strip));
  repaint(strip);
  watch(strip);
  return { body, fit: 'fixed' };
}
