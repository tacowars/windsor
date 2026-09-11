/**
 * The Mixer tab's returns (#435): the plate's space and level, the delay's
 * time, feedback, damping and level — all in the document's `returns`
 * section, applied live through `ctx.change` like every other field. The
 * named `SPACES` are starting points: picking one writes its numbers into the
 * document, and the knobs edit them from there.
 */
import type { ReturnSpec, ReverbSpace } from '../../../packages/client/src/audio/index-for-editor';
import {
  RETURNS,
  RETURN_NAMES,
  REVERB_SPACE_RANGES,
  SPACES,
  SPACE_NAMES,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { el, fmt2, fmtHz, section, select } from './dom';
import { makeKnob, type KnobSpec } from './knob';

const RETURN_COLOR = '#9C7BD0';

type SpaceKnob = { f: keyof ReverbSpace; label: string; o: Partial<KnobSpec> };

const fmtMs = (v: number): string => `${(v * 1000).toFixed(0)}m`;

/** The 13 plate parameters, in signal order; ranges come from the worklet's table. */
const SPACE_KNOBS: readonly SpaceKnob[] = [
  { f: 'preDelay', label: 'Pre', o: { fmt: fmtMs } },
  { f: 'inputLowCut', label: 'In LC', o: { curve: 'log', fmt: fmtHz } },
  { f: 'inputHighCut', label: 'In HC', o: { curve: 'log', fmt: fmtHz } },
  { f: 'diffusionIn1', label: 'Diff 1', o: { fmt: fmt2 } },
  { f: 'diffusionIn2', label: 'Diff 2', o: { fmt: fmt2 } },
  { f: 'size', label: 'Size', o: { curve: 'log', fmt: fmt2 } },
  { f: 'decay', label: 'Decay', o: { fmt: fmt2 } },
  { f: 'diffusionTank1', label: 'Tank 1', o: { fmt: fmt2 } },
  { f: 'diffusionTank2', label: 'Tank 2', o: { fmt: fmt2 } },
  { f: 'tankLowCut', label: 'Tank LC', o: { curve: 'log', fmt: fmtHz } },
  { f: 'tankHighCut', label: 'Tank HC', o: { curve: 'log', fmt: fmtHz } },
  { f: 'modRate', label: 'Mod Hz', o: { fmt: fmt2 } },
  { f: 'modDepth', label: 'Mod ms', o: { fmt: fmt2 } },
];

/** The return as the document has it, else as the code ships it. */
function returnValue(ctx: AppCtx, name: string): ReturnSpec {
  return ctx.model.doc.returns?.[name] ?? RETURNS[name as keyof typeof RETURNS];
}

function levelKnob(ctx: AppCtx, name: string): HTMLElement {
  return makeKnob({
    label: 'Level',
    min: 0,
    max: 1,
    def: RETURNS[name as keyof typeof RETURNS].level,
    color: RETURN_COLOR,
    fmt: fmt2,
    get: () => returnValue(ctx, name).level,
    set: (v) => void ctx.change({ returns: { [name]: { level: v } } }),
  });
}

function spaceKnob(ctx: AppCtx, name: string, spec: SpaceKnob): HTMLElement {
  const [min, max] = REVERB_SPACE_RANGES[spec.f];
  const base = RETURNS.room.space[spec.f];
  return makeKnob({
    label: spec.label,
    min,
    max,
    def: base,
    color: RETURN_COLOR,
    ...spec.o,
    get: () => {
      const spec2 = returnValue(ctx, name);
      return spec2.kind === 'reverb' ? spec2.space[spec.f] : base;
    },
    set: (v) => void ctx.change({ returns: { [name]: { space: { [spec.f]: v } } } }),
  });
}

/** Write a named starting point's numbers into the document, then re-render the knobs. */
function spacePicker(ctx: AppCtx, name: string): HTMLElement {
  const current = returnValue(ctx, name);
  const match =
    current.kind === 'reverb'
      ? SPACE_NAMES.find((key) => JSON.stringify(SPACES[key]) === JSON.stringify(current.space))
      : undefined;
  const options = SPACE_NAMES.map((key) => ({ value: key, label: key }));
  if (!match) options.unshift({ value: '', label: 'custom' } as never);
  return select('Starting point', options, match ?? '', (key) => {
    if (key === '') return;
    const space = SPACES[key as keyof typeof SPACES];
    const result = ctx.change({ returns: { [name]: { space: { ...space } } } });
    if (result.ok) {
      ctx.status(`return "${name}" space → ${key}, in the document`);
      ctx.render();
    }
  });
}

function delayKnobs(ctx: AppCtx, name: string): HTMLElement[] {
  const base = RETURNS.echo;
  const value = (): { delayTime: number; feedback: number; damp: number } => {
    const spec = returnValue(ctx, name);
    return spec.kind === 'delay' ? spec : base;
  };
  const knob = (
    label: string,
    f: 'delayTime' | 'feedback' | 'damp',
    o: Partial<KnobSpec>,
  ): HTMLElement =>
    makeKnob({
      label,
      min: 0,
      max: 1,
      def: base[f],
      color: RETURN_COLOR,
      ...o,
      get: () => value()[f],
      set: (v) => void ctx.change({ returns: { [name]: { [f]: v } } }),
    });
  return [
    knob('Time', 'delayTime', { min: 0.02, max: 2, curve: 'log', fmt: fmtMs }),
    knob('Feedback', 'feedback', { max: 0.95, fmt: fmt2 }),
    knob('Damp', 'damp', { min: 200, max: 16000, curve: 'log', fmt: fmtHz }),
  ];
}

function returnRow(ctx: AppCtx, name: string): HTMLElement {
  const spec = returnValue(ctx, name);
  const row = el('div', 'strip-row');
  row.appendChild(el('div', 'strip-name', `return: ${name} <small>(${spec.kind})</small>`));
  const knobs = el('div', 'knob-row');
  knobs.appendChild(levelKnob(ctx, name));
  if (spec.kind === 'delay') {
    for (const knob of delayKnobs(ctx, name)) knobs.appendChild(knob);
  } else {
    row.appendChild(spacePicker(ctx, name));
    for (const spec2 of SPACE_KNOBS) knobs.appendChild(spaceKnob(ctx, name, spec2));
  }
  row.appendChild(knobs);
  return row;
}

export function renderReturnsSection(ctx: AppCtx): HTMLElement {
  const returns = section(
    'Returns',
    'Space, level and the delay line land in the document (returns section) and on the live buses. ' +
      'Which returns exist is code-owned (packages/client/src/audio/mix.ts).',
  );
  for (const name of RETURN_NAMES) returns.body.appendChild(returnRow(ctx, name));
  return returns.root;
}
