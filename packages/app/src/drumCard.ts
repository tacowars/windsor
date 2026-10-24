/**
 * The Drum device (windsor#951; the approved mockup
 * `docs/design/drum-device-mockup.html`, record `2026-10-24-drum-device`,
 * over the engine's `drum` kind, windsor#948): the body the Song pane's
 * frame (`sequencerDevice.ts`) puts beside the shared rail, at the device's
 * one height, laid out as the Arp's. Two sections:
 *
 * - **Play**, 12 px in from the rail: Pattern, Rate and Note in the first
 *   field column; Seed with Reseed, Randomize and Reverse in the second;
 *   then, behind a rule, Length and Rotate; Vel, Acc vel and Acc mod; Gate,
 *   Vary and Chance, with the Per effect, Rests sound and Octave toggles
 *   beside the last three, as the Arp draws them. Note is the Euclid's
 *   stepper (`C4 · 60`), a semitone a press.
 * - **Steps**, the strip (`drumGrid.ts`).
 *
 * Every control writes the document through `ctx.change`, a pattern field
 * into the pane's selected region's pattern and the seed into the part's
 * (windsor#75); a Rate edit rebuilds the part in the engine as the Arp's
 * does. A knob a lane holds is locked (`knobAutomation.ts`, through
 * `tableKnob`). The card's one playhead loop is here: `watchPlayhead` over
 * `regionPlayheadAt`, bright in the region, a ghost outside it, dark while
 * the transport is halted.
 */
import type { DrumSpec } from '@windsor/engine';
import { DEFAULT_DRUM_CONFIG } from '@windsor/engine';
import { PERC_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, select } from './dom';
import { divisorOptions } from './divisorLabels';
import { type DrumGridParts, type DrumStrip, drumGrid } from './drumGrid';
import { drumPatternChange, shownPattern } from './drumGridModel';
import { noteStep, noteText } from './drumModel';
import { drumPatternPicker } from './drumPatternPicker';
import { DRUM_KNOB_COLUMNS, DRUM_TEXT } from './drumTables';
import type { KnobElement } from './knob';
import { changePattern } from './partEdits';
import { regionPlayheadAt } from './regionPlayhead';
import { seedField } from './seedField';
import { tableKnob } from './seqFields';
import type { DeviceBody } from './sequencerDevice';
import { DRUM_KNOBS } from './sequencerKnobTables';
import { markStep, specOf, watchPlayhead } from './stepStrip';
import { isVariationAmount, titleVariationKnob, variationToggle } from './stepVariationControls';
import { ARP_VARIATION_ROWS } from './stepVariationTables';

/** The part on `slot`, and the region whose pattern the card edits (windsor#75). */
interface DrumTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
}

const spec = ({ ctx, slot, region }: DrumTarget): DrumSpec =>
  specOf(ctx, slot, 'drum', region) ?? { kind: 'drum', ...DEFAULT_DRUM_CONFIG };

const write = (target: DrumTarget, fields: Record<string, unknown>): boolean =>
  changePattern(target.ctx, target.slot, target.region, fields);

function column(className: string, nodes: readonly HTMLElement[]): HTMLElement {
  const col = el('div', `seq-col ${className}`);
  col.append(...nodes);
  return col;
}

function stepButton(text: string, label: string): HTMLButtonElement {
  const button = el('button', 'euclid-step', text) as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  return button;
}

/** The Note box (the Euclid's stepper): − name · number +, a semitone a press, repainting the Pitch cells. */
function noteBox(target: DrumTarget, strip: DrumStrip): KnobElement {
  const box = el('div', 'euclid-kn') as KnobElement;
  const value = el('span', 'euclid-kn-value euclid-stepper');
  const down = stepButton('−', DRUM_TEXT.noteDown);
  const up = stepButton('+', DRUM_TEXT.noteUp);
  const out = document.createElement('output');
  value.append(down, out, up);
  box.append(el('span', 'euclid-kn-label', DRUM_TEXT.note), value);
  box.refresh = (): void => {
    const { note } = spec(target);
    out.textContent = noteText(note);
    down.disabled = noteStep(note, -1) === null;
    up.disabled = noteStep(note, 1) === null;
  };
  const press = (delta: -1 | 1): void => {
    const note = noteStep(spec(target).note, delta);
    if (note !== null && write(target, { note })) strip.repaint();
  };
  down.onclick = (): void => press(-1);
  up.onclick = (): void => press(1);
  box.refresh();
  return box;
}

/** Pattern, Rate and Note. */
function fieldColumn(target: DrumTarget, grid: DrumGridParts): HTMLElement {
  const { ctx } = target;
  const pattern = drumPatternPicker({
    shown: () => shownPattern(spec(target)),
    pick: (id) => {
      const change = drumPatternChange(spec(target), id);
      if (!change) return;
      grid.rebase();
      if (write(target, { ...change })) grid.strip.repaint();
    },
  });
  const note = noteBox(target, grid.strip);
  grid.strip.dependents.push(pattern, note);
  const rate = select(
    'Rate',
    divisorOptions(ctx.model.doc.transport.meter),
    String(spec(target).divisor),
    (v) => {
      if (write(target, { divisor: Number(v) })) ctx.render();
    },
  );
  return column('wide arp-fields', [pattern, rate, note]);
}

/** The knob strip: Length and Rotate, then the table knobs in their columns, then the toggles. */
function knobStrip(target: DrumTarget, grid: DrumGridParts): HTMLElement {
  const { ctx, slot, region } = target;
  const knob = (field: string): HTMLElement[] => {
    const entry = DRUM_KNOBS.find((e) => e.f === field);
    if (!entry) return [];
    const node = tableKnob(ctx, slot, entry, PERC_COLOR, region);
    return [isVariationAmount(field) ? titleVariationKnob(node, field) : node];
  };
  const strip = el('div', 'arp-knobs');
  strip.append(
    column('k3', [grid.length, grid.rotate]),
    ...DRUM_KNOB_COLUMNS.map((fields) => column('k3', fields.flatMap(knob))),
    column(
      'k3 variation-col',
      ARP_VARIATION_ROWS.map((field) => variationToggle(target, field)),
    ),
  );
  return strip;
}

/** The Play section: the field columns, then the knob strip behind its rule. */
function controls(target: DrumTarget, grid: DrumGridParts): HTMLElement {
  const body = el('div', 'seq-sec-body');
  body.append(
    fieldColumn(target, grid),
    column('wide arp-fields', [
      seedField({ ...target, device: 'arp', seed: () => spec(target).seed }),
      grid.randomize,
      grid.reverse,
    ]),
    knobStrip(target, grid),
  );
  const section = el('div', 'seq-section play');
  section.append(el('div', 'seq-sec-label', 'Play'), body);
  return section;
}

/** The card's one playhead loop: the engine's step for the audible tick, lit on the strip. */
function watch(strip: DrumStrip): void {
  watchPlayhead({
    attached: () => strip.root.isConnected,
    shown: () => strip.root.closest('[hidden]') === null,
    playheadAt: () => regionPlayheadAt(strip.ctx, strip.slot, strip.region),
    mark: markStep(strip),
  });
}

/** The device body for a `drum` part's region `region`: the controls and the strip. */
export function drumCard(ctx: AppCtx, slot: number, region?: number): DeviceBody {
  const target: DrumTarget = { ctx, slot, region };
  const grid = drumGrid(ctx, slot, region);
  const body = el('div', 'seq-device-body arp-device drum-device');
  body.append(controls(target, grid), grid.section);
  watch(grid.strip);
  return { body, fit: 'fixed' };
}
