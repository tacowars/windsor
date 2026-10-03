/**
 * The Arp device's Cycle section (windsor#137, epic windsor#126; the device,
 * windsor#370, look `docs/research/2026-09-30-sequencer-rack/arp.html`):
 * one column per cell of the arp's cycle, each a note, tie or rest with its
 * octave shift, accent, slide and ratchet held at the top of the strip, the
 * modulation lanes under them, their names, × and readout in a column at the
 * left with **+ Lane** in its corner, the Rotate knob, the Randomize and
 * Reverse buttons and a playhead. `arpCard.ts` places the pieces.
 *
 * The strip shows `arpListCount` cells (`arpGridModel.ts`): one cycle of the
 * style over the chord the card reads, so the device grows and shrinks with
 * the chord, Octaves, Voicing, Octave and Style. The count is re-read every
 * frame the card is on screen, and the strip repaints when it moves, so a
 * picker, a knob or the playhead crossing into a chord of another size
 * redraws it without a render. The cells past it stay in the document,
 * unshown. Nothing scrolls sideways; the lanes scroll vertically under the
 * step rows.
 *
 * It draws on the Grid device's machinery: `stepStrip.ts`'s held columns
 * and playhead loop, the step cells of `arpStepCells.ts` (which Basslead
 * shares, windsor#371) with the shared ratchet (record
 * `2026-10-01-sequencer-rack-devices` decision 6), the lanes of
 * `stepModLane.ts` through a `LaneHost` as `gridCard.ts` builds one, and the
 * region playhead (`regionPlayhead.ts`), the engine's `Arpeggiator.stepAt`.
 * Every edit writes the selected region's pattern (`changePattern`), so each
 * region keeps its own cells.
 */
import type { ArpSpec, ArpStep } from '@windsor/engine';
import { ARP_STEPS_MAX, STEP_MOD_LANES_MAX } from '@windsor/engine';
import {
  arpCycleLabel,
  arpListCount,
  arpShownList,
  arpSlideAt,
  randomArpCells,
  reverseArp,
  rotateArp,
} from './arpGridModel';
import { arpStepCells } from './arpStepCells';
import { regionChord } from './chordRegionChord';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { GRID_TURN_REBASED, withStep } from './gridModel';
import { type KnobElement, makeKnob } from './knob';
import { changePattern } from './partEdits';
import { regionPlayheadAt } from './regionPlayhead';
import { ARP_ROTATE_KNOB } from './sequencerKnobTables';
import {
  type LaneHost,
  fillLanePicker,
  laneCells,
  lanePicker,
  paintLaneNames,
  partPatch,
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

/** The arp's strip: its scroller, lane names, corner and label, and the note list and cell count it last drew. */
interface ArpStrip extends Strip<ArpSpec> {
  /** The vertical scroller holding the lane names and the columns. */
  scroll: HTMLElement;
  names: HTMLElement;
  picker: HTMLSelectElement;
  /** The corner's "n of 4 lanes". */
  lanesCount: HTMLElement;
  /** The Cycle label's count and chord. */
  label: HTMLElement;
  lanes: LaneHost;
  list: readonly number[];
  count: number;
}

/** The pieces `arpCard.ts` places: Rotate, Randomize and Reverse in the controls, the Cycle section. */
export interface ArpGridParts {
  rotate: HTMLElement;
  randomize: HTMLElement;
  reverse: HTMLElement;
  section: HTMLElement;
}

/**
 * Rotate's offset from the cells it last turned, and its knob, as the
 * Grid's: Reverse replaces those cells, so it rebases the offset and
 * redraws the knob at zero (windsor#548).
 */
interface ArpRotor {
  turned: number;
  knob: KnobElement | null;
}

function rebase(rotor: ArpRotor): void {
  rotor.turned = GRID_TURN_REBASED;
  rotor.knob?.refresh();
}

/** The notes the arp walks over the chord the card reads now; empty with no spec or chord. */
function listOf(strip: Strip<ArpSpec>): number[] {
  const spec = strip.spec();
  if (!spec) return [];
  const chord = regionChord(strip.ctx, strip.slot, strip.region);
  return arpShownList(spec, strip.ctx.model.doc.harmony, chord);
}

/** The cells the strip shows now: one cycle over the chord the card reads. */
function countOf(strip: Strip<ArpSpec>): number {
  const spec = strip.spec();
  return spec ? arpListCount(spec.style, listOf(strip)) : 0;
}

/** Write one cell, edited from what the document holds now. */
function editCell(strip: ArpStrip, index: number, edit: (step: ArpStep) => ArpStep): void {
  commitSteps(strip, (s) => {
    const now = s.steps[index];
    return now ? withStep(s.steps, index, edit(now)) : [...s.steps];
  });
}

function column(strip: ArpStrip, index: number, step: ArpStep): HTMLElement {
  const head = arpStepCells(index, step, (edit) => editCell(strip, index, edit));
  return stripHeadColumn(index, true, head, laneCells(strip.lanes, index, step.kind === 'note'));
}

/** Redraw the shown cells, the lane names, the corner and the label from the document, keeping the scroll. */
function repaint(strip: ArpStrip): void {
  const scrollTop = strip.scroll.scrollTop;
  const spec = strip.spec();
  strip.list = listOf(strip);
  strip.count = spec ? arpListCount(spec.style, strip.list) : 0;
  paintLaneNames(strip.names, strip.lanes);
  paintStrip(strip, (spec) =>
    spec.steps.slice(0, strip.count).map((step, index) => column(strip, index, step)),
  );
  fillLanePicker(strip.picker, strip.lanes);
  strip.lanesCount.textContent = `${spec?.lanes.length ?? 0} of ${STEP_MOD_LANES_MAX} lanes`;
  const chord = regionChord(strip.ctx, strip.slot, strip.region);
  strip.label.textContent = arpCycleLabel(strip.count, strip.ctx.model.doc.harmony, chord);
  strip.scroll.scrollTop = scrollTop;
}

/**
 * Per frame while the card is on screen: a repaint when the style or the
 * notes it walks have moved (a Style, Octaves, Voicing or Octave edit, or
 * the playhead in another chord), which move the shown count, the label and
 * which slides land on the held pitch, or Skip has moved to or from 0, which
 * decides whether a slide's hold on a lane is certain; then the playhead.
 */
function watch(strip: ArpStrip): void {
  const signature = (): string => {
    const spec = strip.spec();
    return `${spec?.style}|${listOf(strip).join(',')}|${(spec?.skipChance ?? 0) > 0}`;
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

/** Rotate applies the turn since its last value to the shown cells, so the document holds no offset. */
function rotateKnob(strip: ArpStrip, rotor: ArpRotor): HTMLElement {
  const knob = makeKnob({
    ...ARP_ROTATE_KNOB,
    color: PITCH_COLOR,
    get: () => rotor.turned,
    set: (v) => {
      const target = Math.round(v);
      const by = target - rotor.turned;
      if (by === 0) return;
      rotor.turned = target;
      const spec = strip.spec();
      if (!spec) return;
      const rotated = rotateArp(spec, by, countOf(strip));
      if (changePattern(strip.ctx, strip.slot, strip.region, rotated)) strip.repaint();
    },
  });
  rotor.knob = knob;
  return knob;
}

function randomizeButton(strip: ArpStrip): HTMLElement {
  const button = el('button', 'btn seq-btn', 'Randomize') as HTMLButtonElement;
  button.type = 'button';
  button.title = 'The shown cells: accent, slide, an octave now and then, a tie or rest, a ratchet';
  button.onclick = (): void =>
    commitSteps(strip, (spec) => randomArpCells(spec.steps, countOf(strip), Math.random));
  return button;
}

/** Reverse mirrors the shown cells, the span Rotate turns, lanes with them (windsor#548). */
function reverseButton(strip: ArpStrip, rotor: ArpRotor): HTMLElement {
  const button = el('button', 'btn seq-btn', 'Reverse') as HTMLButtonElement;
  button.type = 'button';
  button.title = 'Mirror the shown cells: every cell and lane value, last to first';
  button.onclick = (): void => {
    const spec = strip.spec();
    if (!spec) return;
    rebase(rotor);
    const reversed = reverseArp(spec, countOf(strip));
    if (changePattern(strip.ctx, strip.slot, strip.region, reversed)) strip.repaint();
  };
  return button;
}

/**
 * What the lanes need of this card, as `gridCard.ts`'s `laneHost()`: the
 * region's lanes, their write into its pattern, the patch they push, and
 * the region's cells over the shown notes for the slide readout. A new
 * lane holds a value for every stored cell (`ARP_STEPS_MAX`), and a paint
 * reaches only the shown.
 */
function laneHost(
  strip: Strip<ArpSpec>,
  scope: HTMLElement,
  shown: () => readonly number[],
): LaneHost {
  const { ctx, slot, region } = strip;
  const spec = (): ArpSpec | null => strip.spec();
  return {
    scope,
    lanes: () => spec()?.lanes ?? null,
    base: (param) => patchBase(ctx, slot, param),
    patch: () => partPatch(ctx, slot),
    write: (lanes) => changePattern(ctx, slot, region, { lanes }),
    repaint: () => strip.repaint(),
    stepCount: () => ARP_STEPS_MAX,
    slide: (index) => {
      const s = spec();
      return s ? arpSlideAt(s, index, shown()) : NO_SLIDE;
    },
  };
}

/** The lane names' column: + Lane and the lane count in the corner, level with the step rows, then a row per lane. */
function namesColumn(strip: ArpStrip): HTMLElement {
  const corner = el('div', 'strip-head seq-corner');
  corner.append(strip.picker, strip.lanesCount, el('span', 'seq-row-label', 'Ratchet'));
  const column = el('div', 'seq-names');
  column.append(corner, strip.names);
  return column;
}

/** The Cycle section: its label with the count and chord, then the strip. */
function cycleSection(strip: ArpStrip): HTMLElement {
  const label = el('div', 'seq-sec-label', 'Cycle');
  label.appendChild(strip.label);
  strip.scroll.append(namesColumn(strip), strip.root);
  const body = el('div', 'seq-sec-body');
  body.appendChild(strip.scroll);
  const section = el('div', 'seq-section steps');
  section.append(label, body);
  return section;
}

/** The arp's step grid for region `region` of the part on `slot` (the part's sequencer with none). */
export function arpGrid(ctx: AppCtx, slot: number, region: number | undefined): ArpGridParts {
  const scroll = el('div', 'seq-strip');
  const base: Strip<ArpSpec> = {
    ctx,
    slot,
    region,
    root: el('div', 'grid-strip'),
    playing: -1,
    spec: () => specOf(ctx, slot, 'arp', region),
    repaint: () => repaint(strip),
  };
  const lanes = laneHost(base, scroll, () => strip.list);
  const strip: ArpStrip = {
    ...base,
    scroll,
    names: el('div', 'seq-lane-names'),
    picker: lanePicker(lanes),
    lanesCount: el('span', 'seq-meas'),
    label: el('em'),
    lanes,
    list: [],
    count: 0,
  };
  const section = cycleSection(strip);
  repaint(strip);
  watch(strip);
  const rotor: ArpRotor = { turned: GRID_TURN_REBASED, knob: null };
  return {
    rotate: rotateKnob(strip, rotor),
    randomize: randomizeButton(strip),
    reverse: reverseButton(strip, rotor),
    section,
  };
}
