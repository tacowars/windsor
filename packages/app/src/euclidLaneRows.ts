/**
 * The Euclid card's lane rows (windsor#356, decisions 5 and 6 of the issue):
 * one row per lane, accent, pitch, then the sound lanes, each with its name
 * block (the name and a remove ×, then − `N steps` + for its length 1–32,
 * then the hover reading, windsor#393, as the Grid's lanes read) and its
 * cells, laid out at the lane's own length or under the hits
 * (`euclidLaneView.ts`).
 *
 * - **Accent**: a 16 px on/off cell in `--hot`; a click toggles it.
 * - **Pitch**: a 44 px bipolar cell in `--return` with its semitone number;
 *   a vertical drag sets it (one semitone per `EUCLID_PX_PER_SEMITONE` px,
 *   previewed and written once on release), a double-click resets it to 0,
 *   and the up and down arrows step it.
 * - **Sound**: the grid's step-mod lane cell and painting (`stepModLane.ts`)
 *   in `--modulator`, the cell showing the lane index its layout maps it to.
 *
 * Every edit writes the lane index the cell shows, through `card.write`.
 */
import type { EuclideanSpec, VoiceTargetPath } from '@windsor/engine';
import { EUCLID_LANE_STEPS_MAX, EUCLID_PITCH_LANE_MAX } from '@windsor/engine';
import { el } from './dom';
import type { EuclidCard } from './euclidCardState';
import {
  EUCLID_PITCH_BAR_MIN,
  EUCLID_PITCH_KEY_STEP,
  EUCLID_PX_PER_SEMITONE,
} from './euclidConstants';
import {
  type EuclidLaneRef,
  type RowFields,
  clampLaneLength,
  laneLength,
  laneName,
  laneValues,
  lanesOf,
  pitchFromDrag,
  removeLane,
  resizeLane,
  setPitch,
  toggleAccent,
} from './euclidLaneModel';
import {
  type LaneLayout,
  type LaneView,
  cellCount,
  cellLaneIndex,
  dimmedAt,
  laneHead,
  restartsAt,
} from './euclidLaneView';
import { ROW_KEY_ATTRIBUTE } from './euclidRowFocus';
import { type RowHead, cellStrip, nameButton, row } from './euclidRowParts';
import type { Figure } from './euclidModel';
import type { StepGroup } from './meterGrid';
import { type LaneHost, laneCell, partPatch, patchBase } from './stepModLane';

/** What every lane row is drawn against: the card, the spec and figure as built, the view and pass. */
export interface LaneRowsInput {
  readonly card: EuclidCard;
  readonly spec: EuclideanSpec;
  readonly figure: Figure;
  readonly view: LaneView;
  readonly pass: number;
  /** The gap before each cell: the song's beat or bar line (windsor#431). */
  readonly group: (index: number) => StepGroup;
  /** The element holding every row: where a sound lane's drag finds its cells. */
  readonly scope: HTMLElement;
}

/** Where a lane's hover reading goes: the line under its name. Null clears it. */
type Say = (text: string | null) => void;

const layoutOf = (input: LaneRowsInput, length: number): LaneLayout => ({
  view: input.view,
  steps: input.spec.steps,
  pass: input.pass,
  length,
});

/** Write an edit built from the spec as it is now. */
const edit = (card: EuclidCard, make: (spec: EuclideanSpec) => RowFields): void => {
  const spec = card.spec();
  if (spec) card.write(make(spec));
};

/** The lane's name block: the name and ×, − `N steps` +, and the hover reading line. */
function laneNameBlock(
  input: LaneRowsInput,
  ref: EuclidLaneRef,
  length: number,
): { block: HTMLElement; say: Say } {
  const { card } = input;
  const title = laneName(ref, partPatch(card.ctx, card.slot));
  const shorter = nameButton('−', `Shorten the ${title} lane`, 'euclid-len');
  shorter.disabled = length <= 1;
  shorter.onclick = (): void =>
    edit(card, (spec) => resizeLane(spec, ref, laneLength(spec, ref) - 1));
  const longer = nameButton('+', `Lengthen the ${title} lane`, 'euclid-len');
  longer.disabled = length >= EUCLID_LANE_STEPS_MAX;
  longer.onclick = (): void =>
    edit(card, (spec) => resizeLane(spec, ref, clampLaneLength(laneLength(spec, ref) + 1)));
  const remove = nameButton('×', `Remove the ${title} lane`, 'euclid-x');
  remove.onclick = (): void => edit(card, (spec) => removeLane(spec, ref));
  const top = el('div', 'euclid-lane-top');
  const name = el('b', '', title);
  name.title = title;
  top.append(name, remove);
  const size = el('div', 'euclid-lane-len');
  size.append(shorter, el('span', '', `${length} steps`), longer);
  const reading = el('div', 'euclid-read');
  reading.setAttribute('aria-live', 'polite');
  const block = el('div', 'euclid-lane-name');
  block.append(top, size, reading);
  return { block, say: (text) => void (reading.textContent = text ?? '') };
}

const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));

function describe(ref: EuclidLaneRef, index: number, length: number, value: number): string {
  const at = `${laneName(ref)} · step ${index + 1} of ${length}`;
  if (ref.kind === 'accent') return `${at} · ${value ? 'accent' : 'plain'}`;
  return `${at} · ${signed(value)} semitone${Math.abs(value) === 1 ? '' : 's'}`;
}

/** The reading under a lane's name, as the Grid's: the step, then its value. */
function reading(ref: EuclidLaneRef, index: number, value: number): string {
  if (ref.kind === 'accent') return `${index + 1}: ${value ? 'accent' : 'plain'}`;
  return `${index + 1}: ${signed(value)} st`;
}

function accentCell(input: LaneRowsInput, index: number, value: number): HTMLElement {
  const cell = el('button', 'ecell euclid-accent') as HTMLButtonElement;
  cell.type = 'button';
  cell.classList.toggle('on', value !== 0);
  cell.setAttribute('aria-pressed', String(value !== 0));
  cell.onclick = (): void => edit(input.card, (spec) => toggleAccent(spec, index));
  return cell;
}

function drawPitch(cell: HTMLElement, value: number): void {
  const mag =
    value === 0 ? 0 : Math.max(EUCLID_PITCH_BAR_MIN, Math.abs(value) / EUCLID_PITCH_LANE_MAX);
  cell.style.setProperty('--mag', String(mag));
  cell.classList.toggle('neg', value < 0);
  cell.classList.toggle('zero', value === 0);
  const label = cell.querySelector('.euclid-st');
  if (label) label.textContent = signed(value);
}

/** A pitch cell: drag to set, double-click for 0, arrows to step; one write per gesture. */
function pitchCell(input: LaneRowsInput, index: number, value: number, say: Say): HTMLElement {
  const { card } = input;
  const cell = el('div', 'ecell euclid-pitch');
  cell.tabIndex = 0;
  cell.append(el('span', 'euclid-bar'), el('span', 'euclid-st'));
  drawPitch(cell, value);
  const commit = (v: number): void => void edit(card, (spec) => setPitch(spec, index, v));
  cell.ondblclick = (): void => commit(0);
  cell.onkeydown = (e): void => {
    const step = { ArrowUp: EUCLID_PITCH_KEY_STEP, ArrowDown: -EUCLID_PITCH_KEY_STEP }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    commit(value + step);
  };
  cell.onpointerdown = (down): void => {
    if (down.button !== 0) return;
    down.preventDefault();
    cell.focus();
    let v = value;
    try {
      cell.setPointerCapture(down.pointerId);
    } catch {
      // A pointer the browser does not track: the drag runs on the cell's own events.
    }
    cell.onpointermove = (e): void => {
      v = pitchFromDrag(value, e.clientY - down.clientY, EUCLID_PX_PER_SEMITONE);
      drawPitch(cell, v);
      say(reading({ kind: 'pitch' }, index, v));
    };
    const end = (write: boolean): void => {
      cell.onpointermove = null;
      cell.onpointerup = null;
      cell.onpointercancel = null;
      if (write && v !== value) commit(v);
      else drawPitch(cell, value);
    };
    cell.onpointerup = (): void => end(true);
    cell.onpointercancel = (): void => end(false);
  };
  return cell;
}

/**
 * The step-mod lanes' host: the grid's lane cell and painting over this
 * card's sound lanes. Built afresh on every repaint, so its click gate is
 * kept under the card (`gateKey`), and a double-click survives the repaint
 * its first press's write brings.
 */
function soundHost(input: LaneRowsInput, readings: ReadonlyMap<number, Say>): LaneHost {
  const { card, spec } = input;
  const lengthOf = (k: number): number => spec.modLanes?.[k]?.values.length ?? 1;
  return {
    // The rows repaint between a double-click's presses with a new host; the gate is the card's.
    gateKey: card,
    scope: input.scope,
    lanes: () => card.spec()?.modLanes ?? null,
    base: (param: VoiceTargetPath) => patchBase(card.ctx, card.slot, param),
    patch: () => partPatch(card.ctx, card.slot),
    write: (lanes) => card.write({ modLanes: lanes }),
    repaint: () => card.refresh(),
    stepCount: () => spec.steps,
    valueIndex: (k, cell) => cellLaneIndex(layoutOf(input, lengthOf(k)), cell),
    say: (k, step, text) => readings.get(k)?.(text === null ? null : `${step + 1}: ${text}`),
  };
}

/** A sound lane's index in `modLanes`. */
const soundAt = (spec: EuclideanSpec, param: VoiceTargetPath): number =>
  (spec.modLanes ?? []).findIndex((lane) => lane.param === param);

/** One lane's row, its playhead and its reading line. */
function laneRow(
  input: LaneRowsInput,
  ref: EuclidLaneRef,
  host: LaneHost,
): RowHead & { row: HTMLElement; say: Say } {
  const values = laneValues(input.spec, ref);
  const layout = layoutOf(input, values.length);
  const name = laneNameBlock(input, ref, values.length);
  const k = ref.kind === 'sound' ? soundAt(input.spec, ref.param) : -1;
  const cells = cellStrip(cellCount(layout), input.group, (i) => {
    const at = cellLaneIndex(layout, i);
    const value = values[at] ?? 0;
    const dim = dimmedAt(layout, input.figure, i);
    const cell =
      ref.kind === 'accent'
        ? accentCell(input, at, value)
        : ref.kind === 'pitch'
          ? pitchCell(input, at, value, name.say)
          : laneCell(host, k, i, !dim);
    cell.classList.toggle('rest', dim);
    cell.classList.toggle('wrap', restartsAt(layout, i));
    if (ref.kind !== 'sound') {
      cell.setAttribute('aria-label', describe(ref, at, values.length, value));
      cell.title = describe(ref, at, values.length, value);
      cell.onpointerenter = (): void => name.say(reading(ref, at, value));
      cell.onpointerleave = (): void => name.say(null);
    }
    return cell;
  });
  const parts = [cells];
  if (input.view === 'own') parts.push(el('span', 'euclid-loop-end', `↺ ${values.length}`));
  const node = row(`euclid-lane euclid-lane-${ref.kind}`, name.block, ...parts);
  node.setAttribute(ROW_KEY_ATTRIBUTE, ref.kind === 'sound' ? `sound:${ref.param}` : ref.kind);
  return { row: node, cells, head: (at) => laneHead(at, layout), say: name.say };
}

/** Every lane's row, in the card's order, with the playheads the loop lights. */
export function laneRows(input: LaneRowsInput): { rows: HTMLElement[]; heads: RowHead[] } {
  // Each sound lane's reading line, by its index in `modLanes`: filled as its row is built.
  const readings = new Map<number, Say>();
  const host = soundHost(input, readings);
  const built = lanesOf(input.spec).map((ref) => {
    const lane = laneRow(input, ref, host);
    if (ref.kind === 'sound') readings.set(soundAt(input.spec, ref.param), lane.say);
    return lane;
  });
  return { rows: built.map((b) => b.row), heads: built };
}
