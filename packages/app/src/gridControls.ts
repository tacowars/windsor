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
import { randomSteps, rotateLanes, rotateSteps, stepsForLength } from './gridModel';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
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

function lengthKnob(strip: GridStrip): HTMLElement {
  return makeKnob({
    ...GRID_LENGTH_KNOB,
    color: PITCH_COLOR,
    get: () => strip.spec()?.length ?? 1,
    set: (v) => {
      const spec = strip.spec();
      if (!spec) return;
      const length = Math.round(v);
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
function rotateKnob(strip: GridStrip): HTMLElement {
  let turned = 0;
  return makeKnob({
    ...GRID_ROTATE_KNOB,
    color: PITCH_COLOR,
    get: () => turned,
    set: (v) => {
      const target = Math.round(v);
      const by = target - turned;
      if (by === 0) return;
      turned = target;
      const spec = strip.spec();
      if (!spec) return;
      const steps = rotateSteps(spec.steps, by, spec.length);
      const lanes = rotateLanes(spec.lanes, by, spec.length);
      if (changePattern(strip.ctx, strip.slot, strip.region, { steps, lanes })) strip.repaint();
    },
  });
}

function randomizeButton(strip: GridStrip): HTMLElement {
  const button = el('button', 'btn seq-btn', 'Randomize') as HTMLButtonElement;
  button.type = 'button';
  button.title = 'Every step: a random degree from the key, octave, accent and slide';
  button.onclick = (): void =>
    commitSteps(strip, (spec) =>
      randomSteps(
        spec.steps.length,
        scaleOffsets(strip.ctx.model.doc.harmony.scale).length,
        Math.random,
      ),
    );
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
  const body = el('div', 'seq-sec-body');
  body.append(
    column('wide', [divisorPicker(ctx, slot, region), randomizeButton(strip)]),
    column('k3', [octave(strip), lengthKnob(strip), rotateKnob(strip)]),
    ...GRID_KNOB_COLUMNS.map((fields) => column('k3', fields.flatMap(knob))),
  );
  const section = el('div', 'seq-section');
  section.append(el('div', 'seq-sec-label', 'Play'), body);
  return section;
}
