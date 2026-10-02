/**
 * The Grid device's controls (#603; in columns since windsor#368, decision
 * 5, as the insert rack lays its pages out): Step and Randomize; Octave,
 * Length and Rotate; Vel, Acc vel and Acc mod; Skip. Every knob writes the
 * selected region's pattern through `changePattern` (windsor#76), Vel
 * aside, which is the part's.
 */
import type { GridSpec } from '@windsor/engine';
import { scaleOffsets } from '@windsor/engine';
import { PITCH_COLOR } from './consoleColors';
import { el } from './dom';
import { GRID_KNOB_COLUMNS } from './gridDeviceTables';
import { GRID_TURN_REBASED, randomSteps, stepsForLength, turnGrid } from './gridModel';
import { octaveKnob } from './harmonyTables';
import { type KnobElement, makeKnob } from './knob';
import { changePattern } from './partEdits';
import { divisorPicker, tableKnob } from './seqFields';
import { GRID_KNOBS, GRID_LENGTH_KNOB, GRID_ROTATE_KNOB } from './sequencerKnobTables';
import { lanesForSteps } from './stepModLaneModel';
import { type Strip, commitSteps } from './stepStrip';

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
 * Rotate's offset from the pattern it last turned, and its knob. Length
 * and Randomize replace that pattern, so they rebase the offset
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
    rebase(rotor);
    commitSteps(strip, (spec) =>
      randomSteps(
        spec.steps.length,
        scaleOffsets(strip.ctx.model.doc.harmony.scale).length,
        Math.random,
      ),
    );
  };
  return button;
}

function column(className: string, nodes: readonly HTMLElement[]): HTMLElement {
  const col = el('div', `seq-col ${className}`);
  col.append(...nodes);
  return col;
}

/** The controls' section: its label, then the four columns. */
export function gridControls(strip: GridStrip): HTMLElement {
  const { ctx, slot, region } = strip;
  const knob = (field: string): HTMLElement[] => {
    const entry = GRID_KNOBS.find((e) => e.f === field);
    return entry ? [tableKnob(ctx, slot, entry, PITCH_COLOR, region)] : [];
  };
  const rotor: GridRotor = { turned: GRID_TURN_REBASED, knob: null };
  const body = el('div', 'seq-sec-body');
  body.append(
    column('wide', [divisorPicker(ctx, slot, region), randomizeButton(strip, rotor)]),
    column('k3', [octave(strip), lengthKnob(strip, rotor), rotateKnob(strip, rotor)]),
    ...GRID_KNOB_COLUMNS.map((fields) => column('k3', fields.flatMap(knob))),
  );
  const section = el('div', 'seq-section');
  section.append(el('div', 'seq-sec-label', 'Play'), body);
  return section;
}
