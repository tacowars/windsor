/**
 * Sequencers tab (#70, record §2): per-part driver — Euclidean k/n, density
 * modulator (the density LFO periods live here, not in Harmony: they modulate
 * density, not pitch), arp mode and skip, step divisor and gate — plus
 * capture-to-fixed (record §6) and the part on/off toggles (a slot absent
 * from the document builds no generator and makes no sound, #75).
 */
import type { MusicPartId } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { SLOT_DEFAULTS, SLOT_IDS } from './context';
import { el, fmt0, fmt2, noteName, section, seg } from './dom';
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
    kind: 'section',
    f: 'note',
    label: 'Note',
    o: { min: 24, max: 96, def: 36, step: 1, fmt: (v) => noteName(v) },
  },
  { kind: 'section', f: 'velocity', label: 'Vel', o: { min: 0, max: 1, def: 0.8, fmt: fmt2 } },
  {
    kind: 'section',
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

function knobRow(
  ctx: AppCtx,
  id: MusicPartId,
  table: typeof PERC_KNOBS,
  color: string,
): HTMLElement {
  const row = el('div', 'knob-row');
  for (const k of table) {
    const spec = { ...k.o, label: k.label, color };
    row.appendChild(
      k.kind === 'section' ? sectionKnob(ctx, id, k.f, spec) : driverKnob(ctx, id, k.f, spec),
    );
  }
  return row;
}

function pulsesRow(ctx: AppCtx, id: 'kick' | 'hat'): HTMLElement {
  const row = el('div', 'knob-row');
  const pulses = (): Record<string, unknown> =>
    (driverOf(ctx.model.doc, id).pulses ?? {}) as Record<string, unknown>;
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
        set: (v) => void ctx.change({ [id]: { driver: { pulses: { [field]: v } } } }),
      }),
    );
  }
  return row;
}

function percussionCard(ctx: AppCtx, id: 'kick' | 'hat'): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, id, PERC_KNOBS, PERC_COLOR));
  body.appendChild(pulsesRow(ctx, id));
  body.appendChild(divisorPicker(ctx, id));
  body.appendChild(densityControls(ctx, id));
  body.appendChild(captureControls(ctx, id, PERC_COLOR));
  return body;
}

function arpCard(ctx: AppCtx): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, 'arp', ARP_KNOBS, PITCH_COLOR));
  body.appendChild(el('span', 'field-label', 'Walk'));
  body.appendChild(
    seg(
      ['up', 'down', 'updown', 'random'].map((w) => ({ value: w, label: w })),
      () => String(driverOf(ctx.model.doc, 'arp').walk ?? 'updown'),
      (w) => void ctx.change({ arp: { driver: { walk: w as 'up' } } }),
      PITCH_COLOR,
    ),
  );
  body.appendChild(divisorPicker(ctx, 'arp'));
  body.appendChild(captureControls(ctx, 'arp', PITCH_COLOR));
  return body;
}

function droneCard(ctx: AppCtx): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, 'drone', DRONE_KNOBS, PITCH_COLOR));
  body.appendChild(divisorPicker(ctx, 'drone'));
  body.appendChild(captureControls(ctx, 'drone', PITCH_COLOR));
  return body;
}

function slotCard(ctx: AppCtx, id: MusicPartId): HTMLElement {
  const present = ctx.model.doc[id] !== undefined;
  const { root, body } = section(id);
  const toggle = el('button', 'btn', present ? 'On' : 'Off') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', String(present));
  toggle.onclick = (): void =>
    ctx.restructure((draft) => {
      if (present) delete draft[id];
      else draft[id] = SLOT_DEFAULTS[id];
    });
  root.querySelector('.section-title')?.appendChild(toggle);
  if (!present) {
    body.appendChild(el('p', 'hint', 'Part is absent from the document: no generator, no sound.'));
  } else if (id === 'kick' || id === 'hat') {
    body.appendChild(percussionCard(ctx, id));
  } else if (id === 'arp') {
    body.appendChild(arpCard(ctx));
  } else {
    body.appendChild(droneCard(ctx));
  }
  return root;
}

export function renderSequencersTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  for (const id of SLOT_IDS) body.appendChild(slotCard(ctx, id));
}
