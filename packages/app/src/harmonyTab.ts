/**
 * Harmony tab (#70, record §2): key, scale, degree weights, and the register
 * split per pitched part. Pitch only — the density LFOs live in Sequencers.
 * The knob specs are `harmonyTables.ts`.
 */
import type { ScaleName } from '../../../packages/client/src/audio/index-for-editor';
import {
  SCALE_NAMES,
  partAt,
  pitchClassName,
  scaleOffsets,
  uniformWeights,
} from '../../../packages/client/src/audio/index-for-editor';
import { CARRIER_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, section, select } from './dom';
import { ROOT_KNOB, WEIGHT_KNOB, octaveKnob, spanKnob } from './harmonyTables';
import { makeKnob } from './knob';

const COLOR = CARRIER_COLOR;

function rootKnob(ctx: AppCtx): HTMLElement {
  return makeKnob({
    ...ROOT_KNOB,
    color: COLOR,
    get: () => ctx.model.doc.key.root,
    set: (v) => void ctx.change({ key: { root: v } }),
  });
}

function scalePicker(ctx: AppCtx): HTMLElement {
  const { scale } = ctx.model.doc.key;
  const current = typeof scale === 'string' ? scale : 'custom';
  const options: { value: string; label: string }[] = SCALE_NAMES.map((name) => ({
    value: name,
    label: name,
  }));
  if (current === 'custom') options.push({ value: 'custom', label: 'custom' });
  return select('Scale', options, current, (name) => {
    const picked: ScaleName | undefined = SCALE_NAMES.find((known) => known === name);
    if (!picked) return;
    // Weights are per degree, so a new scale gets a fresh uniform set.
    const result = ctx.change({ key: { scale: picked, weights: uniformWeights(picked) } });
    if (result.ok) ctx.render();
  });
}

function weightKnobs(ctx: AppCtx): HTMLElement {
  const row = el('div', 'knob-row');
  const key = ctx.model.doc.key;
  const offsets = scaleOffsets(key.scale);
  offsets.forEach((offset, degree) => {
    row.appendChild(
      makeKnob({
        ...WEIGHT_KNOB,
        label: pitchClassName(key.root, offset),
        color: COLOR,
        get: () => ctx.model.doc.key.weights[degree] ?? 0,
        set: (v) => {
          const weights = [...ctx.model.doc.key.weights];
          weights[degree] = v;
          ctx.change({ key: { weights } });
        },
      }),
    );
  });
  return row;
}

function registerRow(ctx: AppCtx, slot: number, name: string): HTMLElement {
  const row = el('div', 'strip-row');
  row.appendChild(el('div', 'strip-name', name));
  const knobs = el('div', 'knob-row');
  const register = (): { octave: number; span: number } => {
    const sequencer = partAt(ctx.model.doc, slot)?.sequencer;
    if (sequencer?.kind === 'arp' || sequencer?.kind === 'step') return sequencer.register;
    // A grid line or a chord progression is written, not drawn, so it has an octave and no span (#602, #606).
    if (sequencer?.kind === 'grid' || sequencer?.kind === 'chord') {
      return { octave: sequencer.register.octave, span: 1 };
    }
    return { octave: 0, span: 1 };
  };
  const kind = partAt(ctx.model.doc, slot)?.sequencer.kind ?? 'none';
  const spanned = kind !== 'grid' && kind !== 'chord';
  knobs.appendChild(
    makeKnob({
      ...octaveKnob(kind),
      color: COLOR,
      get: () => register().octave,
      set: (v) => void ctx.change(partChange(slot, { sequencer: { register: { octave: v } } })),
    }),
  );
  if (spanned) {
    knobs.appendChild(
      makeKnob({
        ...spanKnob(kind),
        color: COLOR,
        get: () => register().span,
        set: (v) => void ctx.change(partChange(slot, { sequencer: { register: { span: v } } })),
      }),
    );
  }
  row.appendChild(knobs);
  return row;
}

export function renderHarmonyTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  const key = section(
    'Key & scale',
    'One shared sampler: every pitched part draws from these weights.',
  );
  const row = el('div', 'knob-row');
  row.appendChild(rootKnob(ctx));
  key.body.appendChild(scalePicker(ctx));
  key.body.appendChild(row);
  body.appendChild(key.root);

  const weights = section('Degree weights');
  weights.body.appendChild(weightKnobs(ctx));
  body.appendChild(weights.root);

  const registers = section(
    'Register split',
    'Where each pitched part draws, in octaves from the root.',
  );
  for (const part of ctx.model.doc.parts) {
    const { kind } = part.sequencer;
    if (kind === 'arp' || kind === 'step' || kind === 'grid' || kind === 'chord') {
      registers.body.appendChild(registerRow(ctx, part.slot, part.name));
    }
  }
  body.appendChild(registers.root);
}
