/**
 * The Drum device's Steps section (windsor#951; the approved mockup
 * `docs/design/drum-device-mockup.html`, record `2026-10-24-drum-device`):
 * one column per written step at the Grid's 32 px, 2 px apart and grouped
 * by the song's beats (`meterGrid.ts`), the steps past Length greyed; each
 * column's held cells are `drumStepCells.ts`'s (the square hit pad, Vel,
 * Pitch, A and the ratchet), the modulation lanes under them, their names,
 * × and readout in a column at the left with **+ Lane** in its corner. It
 * also builds the Play section's Length and Rotate knobs and the Randomize
 * and Reverse buttons, which turn and replace the line it draws.
 *
 * It draws on the Grid device's machinery: `stepStrip.ts`'s held columns
 * and `paintStrip`, the lanes of `stepModLane.ts` through a `LaneHost` as
 * `gridCard.ts` builds one, and the shared ratchet. Every edit writes the
 * selected region's pattern (`changePattern`), so each region keeps its own
 * line. Randomize, Reverse and Reseed run the pattern actions the Song
 * tab's region menu runs too (`patternActionRun.ts`); Randomize draws from
 * `Math.random`, as the Grid's does.
 */
import type { DrumSpec, DrumStep } from '@windsor/engine';
import { STEP_MOD_LANES_MAX } from '@windsor/engine';
import { PERC_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { drumLengthChange, turnDrum, withDrumStep } from './drumGridModel';
import { drumStepCells } from './drumStepCells';
import { DRUM_TEXT } from './drumTables';
import { GRID_TURN_REBASED } from './gridModel';
import { type KnobElement, makeKnob } from './knob';
import { groupColumns } from './meterGrid';
import { changePattern } from './partEdits';
import { type PatternAction } from './patternActionModel';
import { runPatternAction } from './patternActionRun';
import { DRUM_LENGTH_KNOB, DRUM_ROTATE_KNOB } from './sequencerKnobTables';
import {
  type LaneHost,
  fillLanePicker,
  laneCells,
  lanePicker,
  paintLaneNames,
  partPatch,
  patchBase,
} from './stepModLane';
import { type Strip, commitSteps, paintStrip, specOf, stripHeadColumn } from './stepStrip';

/** Something outside the strip that re-reads the line whenever the strip repaints. */
export interface Dependent {
  refresh(): void;
}

/** The Drum's strip: its scroller, lane names, corner and label, and what re-reads with it. */
export interface DrumStrip extends Strip<DrumSpec> {
  /** The vertical scroller holding the lane names and the columns. */
  readonly scroll: HTMLElement;
  readonly names: HTMLElement;
  readonly picker: HTMLSelectElement;
  /** The corner's "n of 4 lanes". */
  readonly lanesCount: HTMLElement;
  /** The Steps label's count: the loop's length. */
  readonly length: HTMLElement;
  readonly lanes: LaneHost;
  /** The Play section's controls that show the line: the Pattern picker, Length. */
  readonly dependents: Dependent[];
}

/** The pieces `drumCard.ts` places, and the rebase a line write outside them calls. */
export interface DrumGridParts {
  readonly strip: DrumStrip;
  readonly length: HTMLElement;
  readonly rotate: HTMLElement;
  readonly randomize: HTMLElement;
  readonly reverse: HTMLElement;
  readonly section: HTMLElement;
  /** Put Rotate back at zero: the line it turned has been replaced (a pattern pick). */
  rebase(): void;
}

/**
 * Rotate's offset from the line it last turned, and its knob, as the
 * Grid's: Length, Randomize, Reverse and a pattern pick replace that line,
 * so they rebase the offset and redraw the knob at zero (windsor#548).
 */
interface DrumRotor {
  turned: number;
  knob: KnobElement | null;
}

function rebase(rotor: DrumRotor): void {
  rotor.turned = GRID_TURN_REBASED;
  rotor.knob?.refresh();
}

/** Write one step, edited from what the document holds now. */
function editStep(strip: DrumStrip, index: number, edit: (step: DrumStep) => DrumStep): void {
  commitSteps(strip, (s) => {
    const now = s.steps[index];
    return now ? withDrumStep(s.steps, index, edit(now)) : [...s.steps];
  });
}

function column(strip: DrumStrip, spec: DrumSpec, index: number, step: DrumStep): HTMLElement {
  const head = drumStepCells({
    index,
    step,
    note: spec.note,
    edit: (edit) => editStep(strip, index, edit),
  });
  const under = laneCells(strip.lanes, index, step.kind === 'hit');
  return stripHeadColumn(index, index < spec.length, head, under);
}

/** Redraw every column, the lane names, the corner, the label and the dependents, keeping the scroll. */
function repaint(strip: DrumStrip): void {
  const scrollTop = strip.scroll.scrollTop;
  paintLaneNames(strip.names, strip.lanes);
  paintStrip(strip, (spec) =>
    groupColumns(
      spec.steps.map((step, index) => column(strip, spec, index, step)),
      spec.divisor,
      strip.ctx.model.doc.transport.meter,
    ),
  );
  fillLanePicker(strip.picker, strip.lanes);
  const spec = strip.spec();
  strip.lanesCount.textContent = `${spec?.lanes.length ?? 0} of ${STEP_MOD_LANES_MAX} lanes`;
  strip.length.textContent = String(spec?.length ?? '');
  strip.scroll.scrollTop = scrollTop;
  for (const dependent of strip.dependents) dependent.refresh();
}

function lengthKnob(strip: DrumStrip, rotor: DrumRotor): KnobElement {
  return makeKnob({
    ...DRUM_LENGTH_KNOB,
    color: PERC_COLOR,
    get: () => strip.spec()?.length ?? DRUM_LENGTH_KNOB.def,
    set: (v) => {
      const spec = strip.spec();
      const change = spec && drumLengthChange(spec, v);
      if (!change) return;
      rebase(rotor);
      if (changePattern(strip.ctx, strip.slot, strip.region, { ...change })) strip.repaint();
    },
  });
}

/** Rotate applies the turn since its last value, so the document holds the turned line and no offset. */
function rotateKnob(strip: DrumStrip, rotor: DrumRotor): KnobElement {
  const knob = makeKnob({
    ...DRUM_ROTATE_KNOB,
    color: PERC_COLOR,
    get: () => rotor.turned,
    set: (v) => {
      const spec = strip.spec();
      if (!spec) return;
      const turn = turnDrum(spec, rotor.turned, v);
      rotor.turned = turn.turned;
      if (turn.change && changePattern(strip.ctx, strip.slot, strip.region, { ...turn.change }))
        strip.repaint();
    },
  });
  rotor.knob = knob;
  return knob;
}

/** Randomize or Reverse: replaces the line, so Rotate rebases first. */
function actionButton(
  strip: DrumStrip,
  rotor: DrumRotor,
  action: PatternAction,
  words: { label: string; title: string },
): HTMLElement {
  const button = el('button', 'btn seq-btn', words.label) as HTMLButtonElement;
  button.type = 'button';
  button.title = words.title;
  button.onclick = (): void => {
    if (!strip.spec()) return;
    rebase(rotor);
    if (runPatternAction(strip.ctx, strip.slot, strip.region, action)) strip.repaint();
  };
  return button;
}

/** What the lanes need of this card, as `gridCard.ts`'s: the region's lanes and their write. A Drum has no slides. */
function laneHost(strip: Strip<DrumSpec>, scope: HTMLElement): LaneHost {
  const { ctx, slot, region } = strip;
  return {
    scope,
    lanes: () => strip.spec()?.lanes ?? null,
    base: (param) => patchBase(ctx, slot, param),
    patch: () => partPatch(ctx, slot),
    write: (lanes) => changePattern(ctx, slot, region, { lanes }),
    repaint: () => strip.repaint(),
    stepCount: () => strip.spec()?.steps.length ?? 0,
  };
}

/** The Steps section: its label and count, the lane names' column with + Lane in its corner, then the strip. */
function stepsSection(strip: DrumStrip): HTMLElement {
  const corner = el('div', 'strip-head seq-corner');
  corner.append(strip.picker, strip.lanesCount, el('span', 'seq-row-label', 'Ratchet'));
  const names = el('div', 'seq-names');
  names.append(corner, strip.names);
  strip.scroll.append(names, strip.root);
  const label = el('div', 'seq-sec-label', DRUM_TEXT.steps);
  label.appendChild(strip.length);
  const body = el('div', 'seq-sec-body');
  body.appendChild(strip.scroll);
  const section = el('div', 'seq-section steps');
  section.append(label, body);
  return section;
}

/** The Drum's strip for region `region` of the part on `slot` (the part's sequencer with none). */
export function drumGrid(ctx: AppCtx, slot: number, region: number | undefined): DrumGridParts {
  const scroll = el('div', 'seq-strip');
  const base: Strip<DrumSpec> = {
    ctx,
    slot,
    region,
    root: el('div', 'grid-strip'),
    playing: -1,
    spec: () => specOf(ctx, slot, 'drum', region),
    repaint: () => repaint(strip),
  };
  const lanes = laneHost(base, scroll);
  const strip: DrumStrip = {
    ...base,
    scroll,
    names: el('div', 'seq-lane-names'),
    picker: lanePicker(lanes),
    lanesCount: el('span', 'seq-meas'),
    length: el('em'),
    lanes,
    dependents: [],
  };
  const rotor: DrumRotor = { turned: GRID_TURN_REBASED, knob: null };
  const length = lengthKnob(strip, rotor);
  strip.dependents.push(length);
  const section = stepsSection(strip);
  repaint(strip);
  return {
    strip,
    length,
    rotate: rotateKnob(strip, rotor),
    randomize: actionButton(strip, rotor, 'randomize', {
      label: DRUM_TEXT.randomize,
      title: DRUM_TEXT.randomizeTitle,
    }),
    reverse: actionButton(strip, rotor, 'reverse', {
      label: DRUM_TEXT.reverse,
      title: DRUM_TEXT.reverseTitle,
    }),
    section,
    rebase: () => rebase(rotor),
  };
}
