/**
 * Harmony tab (#70, record §2): key, scale, degree weights, and the register
 * split per pitched part. Pitch only — the density LFOs live in Sequencers.
 */
import {
  SCALE_NAMES,
  partAt,
  scaleOffsets,
  uniformWeights,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';
import { NOTE_NAMES, el, fmt0, fmt2, noteName, section, select } from './dom';
import { makeKnob } from './knob';

const COLOR = '#E0A44E';

function rootKnob(ctx: AppCtx): HTMLElement {
  return makeKnob({
    label: 'Root',
    min: 24,
    max: 84,
    def: 50,
    step: 1,
    color: COLOR,
    fmt: (v) => noteName(v),
    get: () => ctx.model.doc.key.root,
    set: (v) => void ctx.change({ key: { root: v } }),
  });
}

function scalePicker(ctx: AppCtx): HTMLElement {
  const { scale } = ctx.model.doc.key;
  const current = typeof scale === 'string' ? scale : 'custom';
  const options = SCALE_NAMES.map((name) => ({ value: name, label: name }));
  if (current === 'custom') options.push({ value: 'custom', label: 'custom' } as never);
  return select('Scale', options, current, (name) => {
    if (name === 'custom') return;
    // Weights are per degree, so a new scale gets a fresh uniform set.
    const result = ctx.change({
      key: { scale: name as never, weights: uniformWeights(name as never) },
    });
    if (result.ok) ctx.render();
  });
}

function weightKnobs(ctx: AppCtx): HTMLElement {
  const row = el('div', 'knob-row');
  const key = ctx.model.doc.key;
  const offsets = scaleOffsets(key.scale);
  offsets.forEach((offset, degree) => {
    const label = NOTE_NAMES[(((key.root + offset) % 12) + 12) % 12] ?? String(degree);
    row.appendChild(
      makeKnob({
        label,
        min: 0,
        max: 4,
        def: 1,
        color: COLOR,
        fmt: fmt2,
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
  const label = el('div', 'strip-name');
  label.textContent = name;
  row.appendChild(label);
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
  const kind = partAt(ctx.model.doc, slot)?.sequencer.kind;
  const spanned = kind !== 'grid' && kind !== 'chord';
  knobs.appendChild(
    makeKnob({
      label: 'Octave',
      min: -4,
      max: 4,
      def: 0,
      step: 1,
      color: COLOR,
      fmt: fmt0,
      get: () => register().octave,
      set: (v) => void ctx.change(partChange(slot, { sequencer: { register: { octave: v } } })),
    }),
  );
  if (spanned) knobs.appendChild(spanKnob(ctx, slot, register));
  row.appendChild(knobs);
  return row;
}

function spanKnob(
  ctx: AppCtx,
  slot: number,
  register: () => { octave: number; span: number },
): HTMLElement {
  return makeKnob({
    label: 'Span',
    min: 1,
    max: 4,
    def: 1,
    step: 1,
    color: COLOR,
    fmt: fmt0,
    get: () => register().span,
    set: (v) => void ctx.change(partChange(slot, { sequencer: { register: { span: v } } })),
  });
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
