/**
 * Harmony tab (#70, record §2): key, scale, and each pitched part's register
 * octave. Pitch only — the density LFOs live in Sequencers. The degree
 * weights and the register span went with the arpeggiator and step sequencer
 * (#704, epic #703 decision 3). The knob specs are `harmonyTables.ts`.
 */
import type { ScaleName } from '../../../packages/client/src/audio/index-for-editor';
import { SCALE_NAMES, partAt } from '../../../packages/client/src/audio/index-for-editor';
import { CARRIER_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, section, select } from './dom';
import { ROOT_KNOB, octaveKnob } from './harmonyTables';
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
    const result = ctx.change({ key: { scale: picked } });
    if (result.ok) ctx.render();
  });
}

function registerRow(ctx: AppCtx, slot: number, name: string): HTMLElement {
  const row = el('div', 'strip-row');
  row.appendChild(el('div', 'strip-name', name));
  const knobs = el('div', 'knob-row');
  // A grid line or a chord progression is written, not drawn: an octave and no span (#602, #606).
  const octave = (): number => {
    const sequencer = partAt(ctx.model.doc, slot)?.sequencer;
    return sequencer?.kind === 'grid' || sequencer?.kind === 'chord'
      ? sequencer.register.octave
      : 0;
  };
  const kind = partAt(ctx.model.doc, slot)?.sequencer.kind ?? 'none';
  knobs.appendChild(
    makeKnob({
      ...octaveKnob(kind),
      color: COLOR,
      get: octave,
      set: (v) => void ctx.change(partChange(slot, { sequencer: { register: { octave: v } } })),
    }),
  );
  row.appendChild(knobs);
  return row;
}

export function renderHarmonyTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  const key = section('Key & scale', 'One shared key: every pitched part reads its degrees.');
  const row = el('div', 'knob-row');
  row.appendChild(rootKnob(ctx));
  key.body.appendChild(scalePicker(ctx));
  key.body.appendChild(row);
  body.appendChild(key.root);

  const registers = section(
    'Register split',
    'Where each pitched part sits, in octaves from the root.',
  );
  for (const part of ctx.model.doc.parts) {
    const { kind } = part.sequencer;
    if (kind === 'grid' || kind === 'chord') {
      registers.body.appendChild(registerRow(ctx, part.slot, part.name));
    }
  }
  body.appendChild(registers.root);
}
