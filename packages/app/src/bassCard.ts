/**
 * The Bass / Drone card (#707 decision 5): the pitch mode, Root bias (Follow
 * Chord only), the Fixed degree (Fixed only, named from the key), Rate, Gate,
 * Density, Reg, Vel and the part's seed with Reseed. No strip and no
 * playhead: the generator draws each step from the chord under it, so there
 * is no written line to show. Every control writes the document through
 * `ctx.change`, a pattern field into the pane's selected region's pattern and
 * the seed into the part's (windsor#75); the pure rules are `bassModel.ts`.
 */
import type { BassPitchMode, BassSpec } from '@windsor/engine';
import { DEFAULT_BASS_CONFIG } from '@windsor/engine';
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
import { el, seg, select } from './dom';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
import { changePattern, patternOf } from './partEdits';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { knobRow, tableKnob } from './seqFields';
import { BASS_KNOBS, BASS_ROOT_BIAS_KNOB } from './sequencerKnobTables';

/** The part on `slot`, and the region whose pattern the card edits (windsor#75). */
interface BassTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
}

/** The region's bass spec, or the engine's defaults while the document is mid-change. */
function specOf({ ctx, slot, region }: BassTarget): BassSpec {
  const sequencer = patternOf(ctx.model.doc, slot, region);
  return sequencer?.kind === 'bass' ? sequencer : { kind: 'bass', ...DEFAULT_BASS_CONFIG };
}

/** A pattern field into the region's pattern; a `seed` goes to the part (`changePattern`). */
const send = (target: BassTarget, fields: Record<string, unknown>): boolean =>
  changePattern(target.ctx, target.slot, target.region, fields);

/** Dim and disable a mode-bound control the current mode ignores. */
function setEnabled(node: HTMLElement, enabled: boolean): void {
  node.inert = !enabled;
  node.setAttribute('aria-disabled', String(!enabled));
  node.style.opacity = enabled ? '' : BASS_DISABLED_OPACITY;
}

function registerKnob(target: BassTarget): HTMLElement {
  return makeKnob({
    ...octaveKnob('bass'),
    label: 'Reg',
    color: PITCH_COLOR,
    get: () => specOf(target).register.octave,
    set: (v) => void send(target, { register: { octave: v } }),
  });
}

function fixedDegreePicker(target: BassTarget): HTMLElement {
  const { fixedDegree } = specOf(target);
  const options = fixedDegreeOptions(target.ctx.model.doc.harmony, fixedDegree);
  return select('Fixed degree', options, String(fixedDegree), (v) => {
    send(target, { fixedDegree: Number(v) });
  });
}

function ratePicker(target: BassTarget): HTMLElement {
  return select('Rate', DIVISOR_OPTIONS, String(specOf(target).divisor), (v) => {
    if (send(target, { divisor: Number(v) })) target.ctx.render();
  });
}

/** The seed as a field plus Reseed; either rebuilds the part, restarting its stream at once. */
function seedControls(target: BassTarget): HTMLElement {
  const { slot } = target;
  const wrap = el('div');
  wrap.appendChild(el('span', 'field-label', 'Seed'));
  const input = document.createElement('input');
  input.className = 'field';
  input.name = `bass-seed-${slot}`;
  input.setAttribute('aria-label', 'Seed');
  const show = (): void => {
    input.value = String(specOf(target).seed);
  };
  input.onchange = (): void => {
    const seed = seedFromText(input.value);
    if (seed !== null && seed !== specOf(target).seed) send(target, { seed });
    show();
  };
  const reseed = el('button', '', 'Reseed') as HTMLButtonElement;
  reseed.type = 'button';
  reseed.title = 'a fresh seed: the part restarts its stream now';
  reseed.onclick = (): void => {
    send(target, reseedChange());
    show();
  };
  show();
  wrap.append(input, reseed);
  return wrap;
}

export function bassCard(ctx: AppCtx, slot: number, region?: number): HTMLElement {
  const target: BassTarget = { ctx, slot, region };
  const body = el('div');
  const rootBias = tableKnob(ctx, slot, BASS_ROOT_BIAS_KNOB, PITCH_COLOR, region);
  const fixedDegree = fixedDegreePicker(target);
  const sync = (mode: BassPitchMode): void => {
    const enabled = bassControlsEnabled(mode);
    setEnabled(rootBias, enabled.rootBias);
    setEnabled(fixedDegree, enabled.fixedDegree);
  };
  body.appendChild(el('span', 'field-label', 'Pitch mode'));
  body.appendChild(
    seg(
      BASS_MODE_OPTIONS,
      () => specOf(target).pitchMode,
      (mode) => {
        if (isBassPitchMode(mode) && send(target, { pitchMode: mode })) sync(mode);
      },
      PITCH_COLOR,
    ),
  );
  const knobs = knobRow(ctx, slot, BASS_KNOBS, PITCH_COLOR, region);
  knobs.prepend(rootBias, registerKnob(target));
  body.appendChild(knobs);
  const fields = el('div', 'bar-row');
  fields.append(fixedDegree, ratePicker(target), seedControls(target));
  body.appendChild(fields);
  sync(specOf(target).pitchMode);
  return body;
}
