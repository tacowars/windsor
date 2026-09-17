/**
 * Sequencers tab (#70, record §2): one card per part, drawn for the part's
 * sequencer kind (#597) — Euclidean k/n, density modulator (the density LFO
 * periods live here, not in Harmony: they modulate density, not pitch), arp
 * mode and skip, step divisor and gate — plus capture-to-fixed (record §6).
 * Adding, removing and re-kinding parts is the part list's job (#598).
 */
import type { MusicPart } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, escapeHtml, fmt0, fmt2, noteName, section, seg } from './dom';
import { gridCard } from './gridCard';
import { makeKnob } from './knob';
import {
  PERC_COLOR,
  PITCH_COLOR,
  captureControls,
  densityControls,
  divisorPicker,
  driverKnob,
  driverOf,
  sectionKnob,
  type KnobOpts,
} from './seqFields';

const PERC_KNOBS: ReadonlyArray<{
  kind: 'section' | 'driver';
  f: string;
  label: string;
  o: KnobOpts;
}> = [
  {
    kind: 'driver',
    f: 'note',
    label: 'Note',
    o: { min: 24, max: 96, def: 36, step: 1, fmt: (v) => noteName(v) },
  },
  { kind: 'section', f: 'velocity', label: 'Vel', o: { min: 0, max: 1, def: 0.8, fmt: fmt2 } },
  {
    kind: 'driver',
    f: 'hold',
    label: 'Hold',
    o: { min: 0.005, max: 2, def: 0.1, curve: 'log', fmt: (v) => `${(v * 1000).toFixed(0)}m` },
  },
  {
    kind: 'driver',
    f: 'steps',
    label: 'Steps n',
    o: { min: 1, max: 32, def: 16, step: 1, fmt: fmt0 },
  },
  {
    kind: 'driver',
    f: 'rotate',
    label: 'Rotate',
    o: { min: -16, max: 16, def: 0, step: 1, fmt: fmt0 },
  },
];

const ARP_KNOBS: typeof PERC_KNOBS = [
  { kind: 'section', f: 'velocity', label: 'Vel', o: { min: 0, max: 1, def: 0.7, fmt: fmt2 } },
  {
    kind: 'driver',
    f: 'poolSize',
    label: 'Pool',
    o: { min: 1, max: 16, def: 4, step: 1, fmt: fmt0 },
  },
  {
    kind: 'driver',
    f: 'refreshBars',
    label: 'Refresh',
    o: { min: 1, max: 64, def: 4, step: 1, fmt: fmt0 },
  },
  { kind: 'driver', f: 'skipChance', label: 'Skip', o: { min: 0, max: 1, def: 0.3, fmt: fmt2 } },
  { kind: 'driver', f: 'gate', label: 'Gate', o: { min: 0.01, max: 1, def: 0.6, fmt: fmt2 } },
];

const DRONE_KNOBS: typeof PERC_KNOBS = [
  { kind: 'section', f: 'velocity', label: 'Vel', o: { min: 0, max: 1, def: 0.8, fmt: fmt2 } },
  { kind: 'driver', f: 'gate', label: 'Gate', o: { min: 0.01, max: 1, def: 1, fmt: fmt2 } },
];

function knobRow(ctx: AppCtx, slot: number, table: typeof PERC_KNOBS, color: string): HTMLElement {
  const row = el('div', 'knob-row');
  for (const k of table) {
    const spec = { ...k.o, label: k.label, color };
    row.appendChild(
      k.kind === 'section' ? sectionKnob(ctx, slot, k.f, spec) : driverKnob(ctx, slot, k.f, spec),
    );
  }
  return row;
}

function pulsesRow(ctx: AppCtx, slot: number): HTMLElement {
  const row = el('div', 'knob-row');
  const pulses = (): Record<string, unknown> =>
    (driverOf(ctx.model.doc, slot).pulses ?? {}) as Record<string, unknown>;
  const defs: Record<string, number> = { min: 2, max: 9, start: 4 };
  for (const field of ['min', 'max', 'start']) {
    row.appendChild(
      makeKnob({
        label: `k ${field}`,
        min: 0,
        max: 32,
        def: defs[field] ?? 0,
        step: 1,
        color: PERC_COLOR,
        fmt: fmt0,
        get: () => Number(pulses()[field] ?? defs[field] ?? 0),
        set: (v) => void ctx.change(partChange(slot, { sequencer: { pulses: { [field]: v } } })),
      }),
    );
  }
  return row;
}

function euclideanCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, slot, PERC_KNOBS, PERC_COLOR));
  body.appendChild(pulsesRow(ctx, slot));
  body.appendChild(divisorPicker(ctx, slot));
  body.appendChild(densityControls(ctx, slot));
  body.appendChild(captureControls(ctx, slot, PERC_COLOR));
  return body;
}

function arpCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, slot, ARP_KNOBS, PITCH_COLOR));
  body.appendChild(el('span', 'field-label', 'Walk'));
  body.appendChild(
    seg(
      ['up', 'down', 'updown', 'random'].map((w) => ({ value: w, label: w })),
      () => String(driverOf(ctx.model.doc, slot).walk ?? 'updown'),
      (w) => void ctx.change(partChange(slot, { sequencer: { walk: w } })),
      PITCH_COLOR,
    ),
  );
  body.appendChild(divisorPicker(ctx, slot));
  body.appendChild(captureControls(ctx, slot, PITCH_COLOR));
  return body;
}

function stepCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, slot, DRONE_KNOBS, PITCH_COLOR));
  body.appendChild(divisorPicker(ctx, slot));
  body.appendChild(captureControls(ctx, slot, PITCH_COLOR));
  return body;
}

const KIND_LABELS = {
  none: 'no sequencer',
  euclidean: 'Euclidean',
  arp: 'arpeggiator',
  step: 'step',
  grid: 'grid',
};

function partCard(ctx: AppCtx, part: MusicPart): HTMLElement {
  const { kind } = part.sequencer;
  const { root, body } = section(`${escapeHtml(part.name)} · ${KIND_LABELS[kind]}`);
  if (kind === 'euclidean') body.appendChild(euclideanCard(ctx, part.slot));
  else if (kind === 'arp') body.appendChild(arpCard(ctx, part.slot));
  else if (kind === 'step') body.appendChild(stepCard(ctx, part.slot));
  else if (kind === 'grid') body.appendChild(gridCard(ctx, part.slot));
  else body.appendChild(el('p', 'hint', 'No sequencer: this part plays only from the keyboard.'));
  return root;
}

export function renderSequencersTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  for (const part of ctx.model.doc.parts) body.appendChild(partCard(ctx, part));
}
