/**
 * The Bass / Drone card (#707 decision 5): the pitch mode, Root bias (Follow
 * Chord only), the Fixed degree (Fixed only, named from the key), Rate, Gate,
 * Density, Reg, Vel and the part's seed with Reseed. No strip and no
 * playhead: the generator draws each step from the chord under it, so there
 * is no written line to show. Every control writes the document through
 * `ctx.change`; the pure rules are `bassModel.ts`.
 */
import type { BassPitchMode, BassSpec } from '../../../packages/client/src/audio/index-for-editor';
import { DEFAULT_BASS_CONFIG, partAt } from '../../../packages/client/src/audio/index-for-editor';
import { BASS_DISABLED_OPACITY } from './bassConstants';
import {
  BASS_MODE_OPTIONS,
  bassControlsEnabled,
  fixedDegreeOptions,
  isBassPitchMode,
  reseedChange,
  seedFromText,
} from './bassModel';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, seg, select } from './dom';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { knobRow, tableKnob } from './seqFields';
import { BASS_KNOBS, BASS_ROOT_BIAS_KNOB } from './sequencerKnobTables';

/** The part's bass spec, or the engine's defaults while the document is mid-change. */
function specOf(ctx: AppCtx, slot: number): BassSpec {
  const sequencer = partAt(ctx.model.doc, slot)?.sequencer;
  return sequencer?.kind === 'bass' ? sequencer : { kind: 'bass', ...DEFAULT_BASS_CONFIG };
}

const send = (ctx: AppCtx, slot: number, fields: Record<string, unknown>): boolean =>
  ctx.change(partChange(slot, { sequencer: fields })).ok;

/** Dim and disable a mode-bound control the current mode ignores. */
function setEnabled(node: HTMLElement, enabled: boolean): void {
  node.inert = !enabled;
  node.setAttribute('aria-disabled', String(!enabled));
  node.style.opacity = enabled ? '' : BASS_DISABLED_OPACITY;
}

function registerKnob(ctx: AppCtx, slot: number): HTMLElement {
  return makeKnob({
    ...octaveKnob('bass'),
    label: 'Reg',
    color: PITCH_COLOR,
    get: () => specOf(ctx, slot).register.octave,
    set: (v) => void send(ctx, slot, { register: { octave: v } }),
  });
}

function fixedDegreePicker(ctx: AppCtx, slot: number): HTMLElement {
  const { fixedDegree } = specOf(ctx, slot);
  const options = fixedDegreeOptions(ctx.model.doc.harmony, fixedDegree);
  return select('Fixed degree', options, String(fixedDegree), (v) => {
    send(ctx, slot, { fixedDegree: Number(v) });
  });
}

function ratePicker(ctx: AppCtx, slot: number): HTMLElement {
  return select('Rate', DIVISOR_OPTIONS, String(specOf(ctx, slot).divisor), (v) => {
    if (send(ctx, slot, { divisor: Number(v) })) ctx.render();
  });
}

/** The seed as a field plus Reseed; either rebuilds the part, restarting its stream at once. */
function seedControls(ctx: AppCtx, slot: number): HTMLElement {
  const wrap = el('div');
  wrap.appendChild(el('span', 'field-label', 'Seed'));
  const input = document.createElement('input');
  input.className = 'field';
  input.name = `bass-seed-${slot}`;
  input.setAttribute('aria-label', 'Seed');
  const show = (): void => {
    input.value = String(specOf(ctx, slot).seed);
  };
  input.onchange = (): void => {
    const seed = seedFromText(input.value);
    if (seed !== null && seed !== specOf(ctx, slot).seed) send(ctx, slot, { seed });
    show();
  };
  const reseed = el('button', '', 'Reseed') as HTMLButtonElement;
  reseed.type = 'button';
  reseed.title = 'a fresh seed: the part restarts its stream now';
  reseed.onclick = (): void => {
    send(ctx, slot, reseedChange());
    show();
  };
  show();
  wrap.append(input, reseed);
  return wrap;
}

export function bassCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  const rootBias = tableKnob(ctx, slot, BASS_ROOT_BIAS_KNOB, PITCH_COLOR);
  const fixedDegree = fixedDegreePicker(ctx, slot);
  const sync = (mode: BassPitchMode): void => {
    const enabled = bassControlsEnabled(mode);
    setEnabled(rootBias, enabled.rootBias);
    setEnabled(fixedDegree, enabled.fixedDegree);
  };
  body.appendChild(el('span', 'field-label', 'Pitch mode'));
  body.appendChild(
    seg(
      BASS_MODE_OPTIONS,
      () => specOf(ctx, slot).pitchMode,
      (mode) => {
        if (isBassPitchMode(mode) && send(ctx, slot, { pitchMode: mode })) sync(mode);
      },
      PITCH_COLOR,
    ),
  );
  const knobs = knobRow(ctx, slot, BASS_KNOBS, PITCH_COLOR);
  knobs.prepend(rootBias, registerKnob(ctx, slot));
  body.appendChild(knobs);
  const fields = el('div', 'bar-row');
  fields.append(fixedDegree, ratePicker(ctx, slot), seedControls(ctx, slot));
  body.appendChild(fields);
  sync(specOf(ctx, slot).pitchMode);
  return body;
}
