/**
 * The Grid device's controls (#603; in columns since windsor#368, decision
 * 5, as the insert rack lays its pages out): Step, Seed with Reseed beside
 * it, Randomize and Reverse; Octave, Length and Rotate; Vel, Acc vel and Acc
 * mod; Vary and Chance, with the Rests sound and Octave toggles side by side
 * under them (windsor#936, the approved mockup
 * `docs/design/step-variation-controls-mockup.html`). Every knob and toggle
 * writes the selected region's pattern through `changePattern`
 * (windsor#76), Vel aside, which is the part's, as is the seed. Randomize,
 * Reverse and Reseed run the pattern actions the Song tab's region menu runs
 * too (`patternActionRun.ts`, windsor#827).
 */
import type { GridSpec } from '@windsor/engine';
import { DEFAULT_GRID_CONFIG } from '@windsor/engine';
import { PITCH_COLOR } from './consoleColors';
import { el } from './dom';
import { GRID_KNOB_COLUMNS } from './gridDeviceTables';
import { GRID_TURN_REBASED, stepsForLength, turnGrid } from './gridModel';
import { octaveKnob } from './harmonyTables';
import { type KnobElement, makeKnob } from './knob';
import { changePattern } from './partEdits';
import { runPatternAction } from './patternActionRun';
import { seedField } from './seedField';
import { divisorPicker, tableKnob } from './seqFields';
import { GRID_KNOBS, GRID_LENGTH_KNOB, GRID_ROTATE_KNOB } from './sequencerKnobTables';
import { lanesForSteps } from './stepModLaneModel';
import type { Strip } from './stepStrip';
import { isVariationAmount, titleVariationKnob, variationToggles } from './stepVariationControls';

type GridStrip = Strip<GridSpec>;

/** The pattern's register octave: where its degrees sound (epic #703 decision 11). */
function octave(strip: GridStrip): HTMLElement {
  return makeKnob({
    ...octaveKnob('grid'),
    color: PITCH_COLOR,
    get: () => strip.spec()?.register.octave ?? octaveKnob('grid').def,
    set: (v) => {
      if (changePattern(strip.ctx, strip.slot, strip.region, { register: { octave: v } })) {
        strip.ctx.invalidate();
      }
    },
  });
}

/**
 * Rotate's offset from the pattern it last turned, and its knob. Length,
 * Randomize and Reverse replace that pattern, so they rebase the offset
 * (`turnGrid`) and redraw the knob at zero.
 */
interface GridRotor {
  turned: number;
  knob: KnobElement | null;
}

function rebase(rotor: GridRotor): void {
  rotor.turned = GRID_TURN_REBASED;
  rotor.knob?.refresh();
}

function lengthKnob(strip: GridStrip, rotor: GridRotor): HTMLElement {
  return makeKnob({
    ...GRID_LENGTH_KNOB,
    color: PITCH_COLOR,
    get: () => strip.spec()?.length ?? 1,
    set: (v) => {
      const spec = strip.spec();
      if (!spec) return;
      const length = Math.round(v);
      if (length === spec.length) return;
      rebase(rotor);
      const steps = stepsForLength(spec.steps, length);
      const lanes = lanesForSteps(spec.lanes, steps.length);
      if (changePattern(strip.ctx, strip.slot, strip.region, { length, steps, lanes }))
        strip.repaint();
    },
  });
}

/**
 * Rotate applies the turn since its last value, so the document holds the
 * rotated steps (their ratchets with them) and lanes, and no offset.
 */
function rotateKnob(strip: GridStrip, rotor: GridRotor): KnobElement {
  const knob = makeKnob({
    ...GRID_ROTATE_KNOB,
    color: PITCH_COLOR,
    get: () => rotor.turned,
    set: (v) => {
      const spec = strip.spec();
      if (!spec) return;
      const turn = turnGrid(spec, rotor.turned, v);
      rotor.turned = turn.turned;
      if (turn.change && changePattern(strip.ctx, strip.slot, strip.region, { ...turn.change }))
        strip.repaint();
    },
  });
  rotor.knob = knob;
  return knob;
}

function randomizeButton(strip: GridStrip, rotor: GridRotor): HTMLElement {
  const button = el('button', 'btn seq-btn', 'Randomize') as HTMLButtonElement;
  button.type = 'button';
  button.title = 'Every step: a random degree from the key, octave, accent and slide';
  button.onclick = (): void => {
    if (!strip.spec()) return;
    rebase(rotor);
    if (runPatternAction(strip.ctx, strip.slot, strip.region, 'randomize')) strip.repaint();
  };
  return button;
}

/** Reverse mirrors the loop in place, lanes with it (windsor#548), and rebases Rotate as Randomize does. */
function reverseButton(strip: GridStrip, rotor: GridRotor): HTMLElement {
  const button = el('button', 'btn seq-btn', 'Reverse') as HTMLButtonElement;
  button.type = 'button';
  button.title = 'Mirror the steps: every cell and lane value, last to first';
  button.onclick = (): void => {
    if (!strip.spec()) return;
    rebase(rotor);
    if (runPatternAction(strip.ctx, strip.slot, strip.region, 'reverse')) strip.repaint();
  };
  return button;
}

function column(className: string, nodes: readonly HTMLElement[]): HTMLElement {
  const col = el('div', `seq-col ${className}`);
  col.append(...nodes);
  return col;
}

/** A table knob by its field, Vary and Chance with their sentence in the tooltip. */
function tableKnobs(strip: GridStrip, field: string): HTMLElement[] {
  const entry = GRID_KNOBS.find((e) => e.f === field);
  if (!entry) return [];
  const node = tableKnob(strip.ctx, strip.slot, entry, PITCH_COLOR, strip.region);
  return [isVariationAmount(field) ? titleVariationKnob(node, field) : node];
}

/**
 * A knob column; the one holding Vary and Chance takes the Rests sound and
 * Octave toggles side by side in its third row, which costs no width.
 */
function knobColumn(strip: GridStrip, fields: readonly string[]): HTMLElement {
  const knobs = fields.flatMap((field) => tableKnobs(strip, field));
  if (!fields.some(isVariationAmount)) return column('k3', knobs);
  const pair = el('div', 'variation-pair');
  pair.append(...variationToggles({ ctx: strip.ctx, slot: strip.slot, region: strip.region }));
  return column('k3', [...knobs, pair]);
}

/** The controls' section: its label, then the columns. */
export function gridControls(strip: GridStrip): HTMLElement {
  const { ctx, slot, region } = strip;
  const seed = (): number => strip.spec()?.seed ?? DEFAULT_GRID_CONFIG.seed;
  const rotor: GridRotor = { turned: GRID_TURN_REBASED, knob: null };
  const body = el('div', 'seq-sec-body');
  body.append(
    column('wide', [
      divisorPicker(ctx, slot, region),
      seedField({ ctx, slot, region, device: 'grid', seed }),
      randomizeButton(strip, rotor),
      reverseButton(strip, rotor),
    ]),
    column('k3', [octave(strip), lengthKnob(strip, rotor), rotateKnob(strip, rotor)]),
    ...GRID_KNOB_COLUMNS.map((fields) => knobColumn(strip, fields)),
  );
  const section = el('div', 'seq-section');
  section.append(el('div', 'seq-sec-label', 'Play'), body);
  return section;
}
