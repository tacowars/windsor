/**
 * The Chord device (#607, #705; a rack device since windsor#369, record
 * `2026-10-01-sequencer-rack-devices` decisions 1–4 and 7, look
 * `docs/research/2026-09-30-sequencer-rack/chord.html`): the body the Song
 * pane's frame (`sequencerDevice.ts`) puts beside the shared rail, at the
 * device's one height. Two sections: Play, the controls in columns — Base
 * step and Voicing; the Hit and Rest tiles and Delete last; Octave, Vel and
 * Gate — and Steps, the strip, labelled with its count and one pass in bars
 * (`chordDeviceModel.ts`).
 *
 * The strip is one column per step, 32 px wide and grouped by four: the Hit
 * or Rest tile, taking the height the device has left so it is a large
 * target to press and to drop on, then the Oct, Inv, Dur and Rep dials
 * (click up, shift-click down; a rest has only Dur and Rep), and the +
 * column that takes a drop or a click. The device grows with the steps and
 * never scrolls them sideways. The region's playhead (`regionPlayhead.ts`,
 * windsor#101) is bright on the step sounding while the song is inside the
 * region, a ghost on the step it would be on elsewhere. The device shows
 * no progression: a hit's chord is the harmony timeline's (epic #703
 * decision 15), and the Hit tile names and auditions the selected region's
 * chord — the one under the playhead while the song is inside the region,
 * else the one at its start (windsor#100) — and a step's tile does the same
 * with its own inversion and octave. The cells keep their tooltips; the
 * hint paragraph went with windsor#369.
 *
 * Every edit goes through `ctx.change` as a whole `steps` list (arrays
 * replace wholesale in the merge), into the pane's selected region's
 * pattern (windsor#75, `partEdits.ts`'s `changePattern`); the step
 * operations are `chordStepModel.ts`. The strip's cells, columns, lighting
 * and playhead loop are `stepStrip.ts` (#619), shared with the grid (#603)
 * and Euclidean (#610) cards.
 */
import type { ChordSpec, ChordStep, HarmonyChord } from '@windsor/engine';
import { CHORD_DIVISORS } from '@windsor/engine';
import { CHORD_AUDITION_VELOCITY } from './chordConstants';
import { chordStepsLabel } from './chordDeviceModel';
import { chordPicker, type Picker } from './chordPicker';
import { regionChord } from './chordRegionChord';
import {
  CHORD_STEPS_MAX,
  type StepDial,
  appendStep,
  dialLabel,
  dropOn,
  removeLast,
  stepLabel,
  stepNotes,
  turnDial,
  withStep,
} from './chordStepModel';
import type { AppCtx } from './context';
import { PITCH_COLOR } from './consoleColors';
import { el, select } from './dom';
import { keySignature } from './gridModel';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
import { changePattern } from './partEdits';
import { regionPlayheadAt } from './regionPlayhead';
import { tableKnob } from './seqFields';
import type { DeviceBody } from './sequencerDevice';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { CHORD_KNOBS } from './sequencerKnobTables';
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

const DIALS: ReadonlyArray<{ dial: StepDial; title: string }> = [
  { dial: 'octave', title: 'octave: click up, shift-click down' },
  { dial: 'inversion', title: 'inversion: click to cycle, shift-click back' },
  { dial: 'duration', title: 'duration × base step: click longer, shift-click shorter' },
  { dial: 'repeat', title: 'repeat: click more, shift-click fewer' },
];

/** This card's strip: one column per step of a `chord` progression, its picker and the Steps label's count. */
type ChordStrip = Strip<ChordSpec> & { picker: Picker | null; length: HTMLElement };

const commit = (strip: ChordStrip, edit: (spec: ChordSpec) => readonly ChordStep[]): void =>
  commitSteps(strip, edit);

/** The chord the card's tiles name and sound: its region's (`chordRegionChord.ts`, windsor#100). */
const chordNow = (strip: ChordStrip): HarmonyChord | null =>
  regionChord(strip.ctx, strip.slot, strip.region);

/**
 * Pressing a step's tile sounds the step as the sequencer would play it, until
 * release. A second press while one sounds (a second finger) releases the
 * first before it starts, so no handle is ever left unreleased.
 */
function bindTileAudition(strip: ChordStrip, node: HTMLElement, step: ChordStep): void {
  let sounding: { part: { noteOff(id: number): void }; ids: number[] } | null = null;
  const stop = (): void => {
    if (!sounding) return;
    for (const id of sounding.ids) sounding.part.noteOff(id);
    sounding = null;
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stop();
    const part = strip.ctx.host.part(strip.slot);
    const spec = strip.spec();
    if (!part || !spec) return;
    node.setPointerCapture(e.pointerId);
    const notes = stepNotes(strip.ctx.model.doc.harmony, chordNow(strip), step, spec);
    sounding = { part, ids: notes.map((n) => part.noteOn(n, CHORD_AUDITION_VELOCITY)) };
  });
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
}

function tileCell(strip: ChordStrip, index: number, spec: ChordSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step) return stripCell('', 'blank');
  const node = stripCell(stepLabel(step), step.kind === 'hit' ? 'chord' : 'rest');
  node.title = step.kind === 'hit' ? 'hit: press to hear the current chord as written' : 'rest';
  bindTileAudition(strip, node, step);
  return node;
}

/** A dial at its resting value (no octave shift, one repeat) reads faint, as the Grid's Oct does. */
const dimDial = (step: ChordStep, dial: StepDial): boolean =>
  (dial === 'octave' && step.kind === 'hit' && step.octave === 0) ||
  (dial === 'repeat' && step.repeat === 1);

function dialCell(strip: ChordStrip, index: number, spec: ChordSpec, dial: StepDial): HTMLElement {
  const step = spec.steps[index];
  if (!step) return stripCell('', 'blank');
  const label = dialLabel(step, dial);
  if (label === '') return stripCell('', 'blank');
  const node = stripCell(label, dimDial(step, dial) ? 'dial dim' : 'dial');
  node.title = DIALS.find((d) => d.dial === dial)?.title ?? dial;
  node.onclick = (event: MouseEvent): void =>
    commit(strip, (s) =>
      withStep(s.steps, index, turnDial(s.steps[index] ?? step, dial, event.shiftKey ? -1 : 1)),
    );
  return node;
}

function stepColumn(strip: ChordStrip, index: number, spec: ChordSpec): HTMLElement {
  const col = stripColumn(index, true, [
    tileCell(strip, index, spec),
    ...DIALS.map(({ dial }) => dialCell(strip, index, spec, dial)),
  ]);
  col.dataset.chordSlot = String(strip.slot);
  col.dataset.chordStep = String(index);
  return col;
}

/**
 * The last column: `+` appends a copy of the last step, and a drop here
 * appends the chip. Blank cells under it keep the + level with the tiles.
 * A full strip has none, so the device is no wider than its steps.
 */
function appendColumn(strip: ChordStrip, spec: ChordSpec): HTMLElement[] {
  if (spec.steps.length >= CHORD_STEPS_MAX) return [];
  const plus = stripCell('+', 'append');
  plus.title = 'append a step (a copy of the last); drop a chip here to append it';
  plus.onclick = (): void => commit(strip, (s) => appendStep(s.steps));
  const pads = DIALS.map(() => stripCell('', 'blank'));
  const col = stripColumn(spec.steps.length, true, [plus, ...pads]);
  col.classList.add('append');
  col.dataset.chordSlot = String(strip.slot);
  col.dataset.chordStep = String(spec.steps.length);
  return [col];
}

/** Redraw every column from the document, then the append column, the Steps count and the picker. */
function repaint(strip: ChordStrip): void {
  paintStrip(strip, (spec) => [
    ...spec.steps.map((_, index) => stepColumn(strip, index, spec)),
    ...appendColumn(strip, spec),
  ]);
  const spec = strip.spec();
  strip.length.textContent = spec ? chordStepsLabel(spec) : '';
  strip.picker?.repaint();
}

/** Root, scale and the region's chord: what the Hit tile's label depends on. */
function tileSignature(strip: ChordStrip): string {
  const { doc } = strip.ctx.model;
  const chord = chordNow(strip);
  return `${keySignature(doc.harmony)}|${chord ? chord.index : -1}|${JSON.stringify(doc.harmony.events)}`;
}

/**
 * Per frame while the card is on screen: the playhead (the engine's own step
 * for the audible tick, durations and repeats included, bright in the region
 * and a ghost outside it), and a repaint of the
 * Hit tile when the key, the timeline or the region's chord has changed since
 * it was drawn — a root edit goes through `ctx.change` alone, which
 * re-renders nothing, a region edit moves its start, and the playhead crosses
 * chord boundaries and enters or leaves the region on its own.
 */
function watch(strip: ChordStrip): void {
  let tileSig = tileSignature(strip);
  watchPlayhead({
    attached: () => strip.root.isConnected,
    shown: () => strip.root.closest('[hidden]') === null,
    playheadAt: () => regionPlayheadAt(strip.ctx, strip.slot, strip.region),
    mark: markStep(strip),
    repaintIf: () => {
      const sig = tileSignature(strip);
      if (sig === tileSig) return;
      tileSig = sig;
      strip.picker?.repaint();
    },
  });
}

const BASE_STEP_OPTIONS = DIVISOR_OPTIONS.filter((o) => CHORD_DIVISORS.includes(Number(o.value)));

/** The pattern’s register octave (epic #703 decision 11), above Vel and Gate. */
function octave(strip: ChordStrip): HTMLElement {
  return makeKnob({
    ...octaveKnob('chord'),
    color: PITCH_COLOR,
    get: () => strip.spec()?.register.octave ?? octaveKnob('chord').def,
    set: (v) => {
      if (changePattern(strip.ctx, strip.slot, strip.region, { register: { octave: v } })) {
        strip.ctx.invalidate();
      }
    },
  });
}

/** Write one field of the strip's region's pattern, and redraw if it took. */
function writeField(strip: ChordStrip, fields: Record<string, unknown>): void {
  if (changePattern(strip.ctx, strip.slot, strip.region, fields)) strip.repaint();
}

function baseStep(strip: ChordStrip): HTMLElement {
  return select('Base step', BASE_STEP_OPTIONS, String(strip.spec()?.divisor ?? ''), (v) =>
    writeField(strip, { divisor: Number(v) }),
  );
}

function deleteLast(strip: ChordStrip): HTMLElement {
  const button = el('button', 'btn seq-btn', 'Delete last') as HTMLButtonElement;
  button.type = 'button';
  button.title = 'delete the last step of the progression';
  button.onclick = (): void => commit(strip, (s) => removeLast(s.steps));
  return button;
}

function column(className: string, nodes: readonly HTMLElement[]): HTMLElement {
  const col = el('div', `seq-col ${className}`);
  col.append(...nodes);
  return col;
}

/** The Play section: Base step and Voicing; the tiles and Delete last; Octave, Vel and Gate. */
function controls(strip: ChordStrip, picker: Picker): HTMLElement {
  const knobs = CHORD_KNOBS.map((entry) =>
    tableKnob(strip.ctx, strip.slot, entry, PITCH_COLOR, strip.region),
  );
  const body = el('div', 'seq-sec-body');
  body.append(
    column('wide', [baseStep(strip), picker.voicing]),
    column('wide chord-sources', [picker.tiles, deleteLast(strip)]),
    column('k3', [octave(strip), ...knobs]),
  );
  const section = el('div', 'seq-section');
  section.append(el('div', 'seq-sec-label', 'Play'), body);
  return section;
}

/** The Steps section: its label and count, then the strip. */
function stepsSection(strip: ChordStrip): HTMLElement {
  const label = el('div', 'seq-sec-label', 'Steps');
  label.appendChild(strip.length);
  const body = el('div', 'seq-sec-body');
  body.appendChild(strip.root);
  const section = el('div', 'seq-section steps');
  section.append(label, body);
  return section;
}

/** The column under a client point, if it belongs to this card: its step index. */
function targetAt(strip: ChordStrip, x: number, y: number): number | null {
  const under = document.elementFromPoint(x, y);
  const col = under?.closest<HTMLElement>('[data-chord-step]');
  if (!col || col.dataset.chordSlot !== String(strip.slot)) return null;
  const index = Number(col.dataset.chordStep);
  return Number.isInteger(index) ? index : null;
}

function highlight(strip: ChordStrip, index: number | null): void {
  [...strip.root.children].forEach((col, i) => col.classList.toggle('drop-target', i === index));
}

/** The device body for a `chord` part's region `region`: the controls and the strip. */
export function chordCard(ctx: AppCtx, slot: number, region?: number): DeviceBody {
  const strip: ChordStrip = {
    ctx,
    slot,
    region,
    root: el('div', 'grid-strip chord-strip'),
    picker: null,
    length: el('em'),
    playing: -1,
    spec: () => specOf(ctx, slot, 'chord', region),
    repaint: () => repaint(strip),
  };
  const picker = chordPicker({
    harmony: () => ctx.model.doc.harmony,
    currentChord: () => chordNow(strip),
    spec: () => strip.spec(),
    part: () => ctx.host.part(slot),
    setVoicing: (voicing) => writeField(strip, { voicing }),
    targetAt: (x, y) => targetAt(strip, x, y),
    highlight: (index) => highlight(strip, index),
    drop: (payload, index) => commit(strip, (s) => dropOn(s.steps, index, payload)),
  });
  strip.picker = picker;
  const body = el('div', 'seq-device-body chord-device');
  body.append(controls(strip, picker), stepsSection(strip));
  repaint(strip);
  watch(strip);
  return { body, fit: 'fixed' };
}
