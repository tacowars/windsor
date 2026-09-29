/**
 * The Arp card's step strip (windsor#137, epic windsor#126): one column per
 * cell of the arp's cycle, each a note, tie or rest with its octave shift,
 * accent and slide, the modulation lanes under them, the Rotate knob, the
 * Randomize button and a playhead. `arpCard.ts` places the pieces.
 *
 * The strip shows `arpCellCount` cells (`arpGridModel.ts`): one cycle of the
 * style over the chord the card reads, so it grows and shrinks with the
 * chord, Octaves, Voicing, Reg and Style. The count is re-read every frame
 * the card is on screen, and the strip repaints when it moves, so a picker,
 * a knob or the playhead crossing into a chord of another size redraws it
 * without a render. The cells past it stay in the document, unshown.
 *
 * It draws on the grid card's machinery: `stepStrip.ts`'s cells, columns
 * and playhead loop, `gridModel.ts`'s cell edits, the lanes of
 * `stepModLane.ts` through a `LaneHost` as `gridCard.ts` builds one, and
 * the region playhead (`regionPlayhead.ts`), the engine's
 * `Arpeggiator.stepAt`. Every edit writes the selected region's pattern
 * (`changePattern`), so each region keeps its own cells.
 */
import type { ArpSpec, ArpStep } from '@windsor/engine';
import { ARP_STEPS_MAX } from '@windsor/engine';
import {
  arpCellCount,
  arpKindLabel,
  arpOctaveLabel,
  arpSlideAt,
  nextArpKind,
  randomArpCells,
  rotateArp,
} from './arpGridModel';
import { regionChord } from './chordRegionChord';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { cycleOctave, toggleFlag, withStep } from './gridModel';
import { makeKnob } from './knob';
import { changePattern } from './partEdits';
import { regionPlayheadAt } from './regionPlayhead';
import { ARP_ROTATE_KNOB } from './sequencerKnobTables';
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
  stripCell,
  stripColumn,
  watchPlayhead,
} from './stepStrip';

/** The arp's strip: its scroller, lane names and picker, and the cell count it last drew. */
interface ArpStrip extends Strip<ArpSpec> {
  scroll: HTMLElement;
  names: HTMLElement;
  picker: HTMLSelectElement | null;
  lanes: LaneHost;
  count: number;
}

/** The pieces `arpCard.ts` places: Rotate in the knob row, the tools row, the strip. */
export interface ArpGridParts {
  rotate: HTMLElement;
  tools: HTMLElement;
  strip: HTMLElement;
}

const cell = stripCell;

/** The cells the strip shows now: one cycle over the chord the card reads. */
function countOf(strip: Strip<ArpSpec>): number {
  const spec = strip.spec();
  if (!spec) return 0;
  const chord = regionChord(strip.ctx, strip.slot, strip.region);
  return arpCellCount(spec, strip.ctx.model.doc.harmony, chord);
}

/** Write one cell, edited from what the document holds now. */
function editCell(strip: ArpStrip, index: number, edit: (step: ArpStep) => ArpStep): void {
  commitSteps(strip, (s) => {
    const now = s.steps[index];
    return now ? withStep(s.steps, index, edit(now)) : [...s.steps];
  });
}

function kindCell(strip: ArpStrip, index: number, step: ArpStep): HTMLElement {
  const node = cell(arpKindLabel(step), step.kind === 'note' ? 'note' : '');
  node.title = `${step.kind}: click for note → tie → rest`;
  node.onclick = (): void => editCell(strip, index, nextArpKind);
  return node;
}

function octaveCell(strip: ArpStrip, index: number, step: ArpStep): HTMLElement {
  if (step.kind !== 'note') return cell('', 'blank');
  const node = cell(arpOctaveLabel(step.octave));
  node.title = 'octave shift: click up, shift-click down';
  node.onclick = (event: MouseEvent): void =>
    editCell(strip, index, (s) => cycleOctave(s, event.shiftKey ? -1 : 1));
  return node;
}

function flagCell(
  strip: ArpStrip,
  index: number,
  step: ArpStep,
  flag: 'accent' | 'slide',
): HTMLElement {
  if (step.kind !== 'note') return cell('', 'blank');
  const node = cell(flag === 'accent' ? 'A' : 'S');
  node.title = flag;
  node.setAttribute('aria-pressed', String(step[flag]));
  node.onclick = (): void => editCell(strip, index, (s) => toggleFlag(s, flag));
  return node;
}

function column(strip: ArpStrip, index: number, step: ArpStep): HTMLElement {
  return stripColumn(index, true, [
    kindCell(strip, index, step),
    octaveCell(strip, index, step),
    flagCell(strip, index, step, 'accent'),
    flagCell(strip, index, step, 'slide'),
    ...laneCells(strip.lanes, index, step.kind === 'note'),
  ]);
}

/** Redraw the shown cells, the lane names and the picker from the document, keeping the scroll. */
function repaint(strip: ArpStrip): void {
  const scrollLeft = strip.scroll.scrollLeft;
  strip.count = countOf(strip);
  paintLaneNames(strip.names, strip.lanes);
  paintStrip(strip, (spec) =>
    spec.steps.slice(0, strip.count).map((step, index) => column(strip, index, step)),
  );
  if (strip.picker) fillLanePicker(strip.picker, strip.lanes);
  strip.scroll.scrollLeft = scrollLeft;
}

/**
 * Per frame while the card is on screen: a repaint when the shown count
 * has moved (a Style, Octaves, Voicing or Reg edit, or the playhead in a
 * chord of another size) or Skip has moved to or from 0, which decides
 * whether a slide's hold on a lane is certain; then the playhead.
 */
function watch(strip: ArpStrip): void {
  const signature = (): string => `${countOf(strip)}|${(strip.spec()?.skipChance ?? 0) > 0}`;
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
function rotateKnob(strip: ArpStrip): HTMLElement {
  let turned = 0;
  return makeKnob({
    ...ARP_ROTATE_KNOB,
    color: PITCH_COLOR,
    get: () => turned,
    set: (v) => {
      const target = Math.round(v);
      const by = target - turned;
      if (by === 0) return;
      turned = target;
      const spec = strip.spec();
      if (!spec) return;
      const rotated = rotateArp(spec, by, countOf(strip));
      if (changePattern(strip.ctx, strip.slot, strip.region, rotated)) strip.repaint();
    },
  });
}

function randomizeButton(strip: ArpStrip): HTMLElement {
  const button = el('button', 'btn', 'Randomize') as HTMLButtonElement;
  button.type = 'button';
  button.style.borderColor = PITCH_COLOR;
  button.title = 'The shown cells: accent, slide, an octave now and then, a tie or rest';
  button.onclick = (): void =>
    commitSteps(strip, (spec) => randomArpCells(spec.steps, countOf(strip), Math.random));
  return button;
}

/**
 * What the lanes need of this card, as `gridCard.ts`'s `laneHost()`: the
 * region's lanes, their write into its pattern, the patch they push, and
 * the region's cells for the slide readout. A new lane holds a value for
 * every stored cell (`ARP_STEPS_MAX`), and a paint reaches only the shown.
 */
function laneHost(strip: Strip<ArpSpec>, scope: HTMLElement, shown: () => number): LaneHost {
  const { ctx, slot, region } = strip;
  const spec = (): ArpSpec | null => strip.spec();
  return {
    scope,
    lanes: () => spec()?.lanes ?? null,
    base: (param) => patchBase(ctx, slot, param),
    write: (lanes) => changePattern(ctx, slot, region, { lanes }),
    repaint: () => strip.repaint(),
    stepCount: () => ARP_STEPS_MAX,
    slide: (index) => {
      const s = spec();
      return s ? arpSlideAt(s, index, shown()) : NO_SLIDE;
    },
  };
}

/** The arp's step grid for region `region` of the part on `slot` (the part's sequencer with none). */
export function arpGrid(ctx: AppCtx, slot: number, region: number | undefined): ArpGridParts {
  const scroll = el('div', 'grid-scroll');
  const base: Strip<ArpSpec> = {
    ctx,
    slot,
    region,
    root: el('div', 'grid-strip'),
    playing: -1,
    spec: () => specOf(ctx, slot, 'arp', region),
    repaint: () => repaint(strip),
  };
  const strip: ArpStrip = {
    ...base,
    scroll,
    names: el('div', 'mod-names'),
    picker: null,
    count: 0,
    lanes: laneHost(base, scroll, () => strip.count),
  };
  const tools = el('div', 'capture-row');
  tools.appendChild(randomizeButton(strip));
  strip.picker = lanePicker(strip.lanes);
  const lanes = el('div');
  lanes.append(el('span', 'field-label', 'Lanes'), strip.picker);
  tools.appendChild(lanes);
  strip.scroll.append(strip.names, strip.root);
  repaint(strip);
  watch(strip);
  return { rotate: rotateKnob(strip), tools, strip: strip.scroll };
}
