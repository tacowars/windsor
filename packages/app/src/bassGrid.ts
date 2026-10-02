/**
 * The Basslead device's Steps section (windsor#371, record
 * `2026-10-01-sequencer-rack-devices` decision 9; look
 * `docs/research/2026-09-30-sequencer-rack/bass.html`): one column per
 * written step, 32 px wide and grouped by four, each the Arp's `♪ — ·`
 * cell, Oct, A, S and the ratchet held at the top of the strip
 * (`arpStepCells.ts`), the modulation lanes under them, their names, × and
 * readout in a column at the left with **+ Lane** in its corner. The steps
 * past Length are greyed and kept, as on the Grid. Nothing scrolls
 * sideways; the lanes scroll vertically under the step rows. The pitch
 * mode still picks each note's pitch, so there is no pitch lane and no
 * degree row: the per-step Oct is the octave modifier.
 *
 * It also builds the Length and Rotate knobs and the Randomize button,
 * which `bassCard.ts` places among the controls (`bassGridModel.ts` holds
 * what they write). Every edit writes the selected region's pattern
 * (`changePattern`), so each region keeps its own steps and lanes. The
 * playhead is the engine's `BassSequencer.stepAt` through
 * `regionPlayhead.ts`.
 */
import type { BassSpec, BassStep } from '@windsor/engine';
import { STEP_MOD_LANES_MAX } from '@windsor/engine';
import { arpStepCells } from './arpStepCells';
import {
  bassLengthChange,
  bassSlideAt,
  bassStepsLabel,
  randomBassSteps,
  rotateBass,
} from './bassGridModel';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { withStep } from './gridModel';
import { makeKnob } from './knob';
import { changePattern } from './partEdits';
import { regionPlayheadAt } from './regionPlayhead';
import { BASS_LENGTH_KNOB, BASS_ROTATE_KNOB } from './sequencerKnobTables';
import {
  type LaneHost,
  fillLanePicker,
  laneCells,
  lanePicker,
  paintLaneNames,
  patchBase,
} from './stepModLane';
import { NO_SLIDE } from './stepModLaneModel';
import {
  type Strip,
  commitSteps,
  markStep,
  paintStrip,
  specOf,
  stripHeadColumn,
  watchPlayhead,
} from './stepStrip';

/** The bass's strip: its scroller, lane names, corner and label. */
interface BassStripView extends Strip<BassSpec> {
  /** The vertical scroller holding the lane names and the columns. */
  scroll: HTMLElement;
  names: HTMLElement;
  picker: HTMLSelectElement;
  /** The corner's "n of 4 lanes". */
  lanesCount: HTMLElement;
  /** The Steps label's loop and bars. */
  label: HTMLElement;
  lanes: LaneHost;
}

/** The pieces `bassCard.ts` places: Length, Rotate and Randomize in the controls, the Steps section. */
export interface BassGridParts {
  length: HTMLElement;
  rotate: HTMLElement;
  randomize: HTMLElement;
  section: HTMLElement;
}

/** Write one step, edited from what the document holds now. */
function editStep(strip: BassStripView, index: number, edit: (step: BassStep) => BassStep): void {
  commitSteps(strip, (s) => {
    const now = s.steps[index];
    return now ? withStep(s.steps, index, edit(now)) : [...s.steps];
  });
}

/** Step `index`'s column: the held cells, then its lane cells; greyed past the loop. */
function column(strip: BassStripView, spec: BassSpec, index: number): HTMLElement {
  const step = spec.steps[index];
  if (!step) return el('div');
  const head = arpStepCells(index, step, (edit) => editStep(strip, index, edit));
  const under = laneCells(strip.lanes, index, step.kind === 'note');
  return stripHeadColumn(index, index < spec.length, head, under);
}

/** Redraw every column, the lane names, the corner and the label from the document, keeping the scroll. */
function repaint(strip: BassStripView): void {
  const scrollTop = strip.scroll.scrollTop;
  paintLaneNames(strip.names, strip.lanes);
  paintStrip(strip, (spec) => spec.steps.map((_, index) => column(strip, spec, index)));
  fillLanePicker(strip.picker, strip.lanes);
  const spec = strip.spec();
  strip.lanesCount.textContent = `${spec?.lanes.length ?? 0} of ${STEP_MOD_LANES_MAX} lanes`;
  strip.label.textContent = spec ? bassStepsLabel(spec.length, spec.divisor) : '';
  strip.scroll.scrollTop = scrollTop;
}

/**
 * Per frame while the card is on screen: a repaint when the pitch mode or
 * Density's side of 1 has moved, which decide what a slide does to the
 * lanes (a knob writes through `ctx.change` alone, which re-renders
 * nothing), then the playhead.
 */
function watch(strip: BassStripView): void {
  const signature = (): string => {
    const spec = strip.spec();
    return `${spec?.pitchMode}|${(spec?.density ?? 1) < 1}`;
  };
  let drawn = signature();
  watchPlayhead({
    attached: () => strip.root.isConnected,
    shown: () => strip.root.closest('[hidden]') === null,
    playheadAt: () => regionPlayheadAt(strip.ctx, strip.slot, strip.region),
    mark: markStep(strip),
    repaintIf: () => {
      const now = signature();
      if (now === drawn) return;
      drawn = now;
      strip.repaint();
    },
  });
}

const write = (strip: Strip<BassSpec>, fields: Record<string, unknown>): void => {
  if (changePattern(strip.ctx, strip.slot, strip.region, fields)) strip.repaint();
};

/** Length pads the steps and lanes past the written ones, and greys the steps past a shorter loop. */
function lengthKnob(strip: Strip<BassSpec>): HTMLElement {
  return makeKnob({
    ...BASS_LENGTH_KNOB,
    color: PITCH_COLOR,
    get: () => strip.spec()?.length ?? BASS_LENGTH_KNOB.def,
    set: (v) => {
      const spec = strip.spec();
      if (spec && Math.round(v) !== spec.length) write(strip, { ...bassLengthChange(spec, v) });
    },
  });
}

/** Rotate applies the turn since its last value, so the document holds the turned steps and lanes. */
function rotateKnob(strip: Strip<BassSpec>): HTMLElement {
  let turned = 0;
  return makeKnob({
    ...BASS_ROTATE_KNOB,
    color: PITCH_COLOR,
    get: () => turned,
    set: (v) => {
      const target = Math.round(v);
      const by = target - turned;
      if (by === 0) return;
      turned = target;
      const spec = strip.spec();
      if (spec) write(strip, { ...rotateBass(spec, by) });
    },
  });
}

function randomizeButton(strip: Strip<BassSpec>): HTMLElement {
  const button = el('button', 'btn seq-btn', 'Randomize') as HTMLButtonElement;
  button.type = 'button';
  button.title =
    'Reroll the rhythm: notes, ties, rests, octaves, accents, slides and ratchets. The pitch mode keeps the pitch';
  button.onclick = (): void =>
    commitSteps(strip, (spec) => randomBassSteps(spec.steps, Math.random));
  return button;
}

/**
 * What the lanes need of this card, as `gridCard.ts`'s `laneHost()`: the
 * region's lanes, their write into its pattern, the patch they push, and
 * the region's steps for the slide readout.
 */
function laneHost(strip: Strip<BassSpec>, scope: HTMLElement): LaneHost {
  const { ctx, slot, region } = strip;
  const spec = (): BassSpec | null => strip.spec();
  return {
    scope,
    lanes: () => spec()?.lanes ?? null,
    base: (param) => patchBase(ctx, slot, param),
    write: (lanes) => changePattern(ctx, slot, region, { lanes }),
    repaint: () => strip.repaint(),
    stepCount: () => spec()?.steps.length ?? 0,
    slide: (index) => {
      const s = spec();
      return s ? bassSlideAt(s, index) : NO_SLIDE;
    },
  };
}

/** The lane names' column: + Lane and the lane count in the corner, level with the step rows, then a row per lane. */
function namesColumn(strip: BassStripView): HTMLElement {
  const corner = el('div', 'strip-head seq-corner');
  corner.append(strip.picker, strip.lanesCount, el('span', 'seq-row-label', 'Ratchet'));
  const names = el('div', 'seq-names');
  names.append(corner, strip.names);
  return names;
}

/** The Steps section: its label with the loop and bars, then the strip. */
function stepsSection(strip: BassStripView): HTMLElement {
  const label = el('div', 'seq-sec-label', 'Steps');
  label.appendChild(strip.label);
  strip.scroll.append(namesColumn(strip), strip.root);
  const body = el('div', 'seq-sec-body');
  body.appendChild(strip.scroll);
  const section = el('div', 'seq-section steps');
  section.append(label, body);
  return section;
}

/** The bass's strip for region `region` of the part on `slot` (the part's sequencer with none). */
export function bassGrid(ctx: AppCtx, slot: number, region: number | undefined): BassGridParts {
  const scroll = el('div', 'seq-strip');
  const base: Strip<BassSpec> = {
    ctx,
    slot,
    region,
    root: el('div', 'grid-strip'),
    playing: -1,
    spec: () => specOf(ctx, slot, 'bass', region),
    repaint: () => repaint(strip),
  };
  const lanes = laneHost(base, scroll);
  const strip: BassStripView = {
    ...base,
    scroll,
    names: el('div', 'seq-lane-names'),
    picker: lanePicker(lanes),
    lanesCount: el('span', 'seq-meas'),
    label: el('em'),
    lanes,
  };
  const section = stepsSection(strip);
  repaint(strip);
  watch(strip);
  return {
    length: lengthKnob(strip),
    rotate: rotateKnob(strip),
    randomize: randomizeButton(strip),
    section,
  };
}
