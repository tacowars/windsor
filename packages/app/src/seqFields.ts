/**
 * The Sequencers tab's field vocabulary (#70): knobs and pickers that write
 * one driver or section field through `ctx.change`, the density-modulator
 * controls, and the capture/release row (record §6).
 */
import type {
  ArrangementDocument,
  MusicPartId,
} from '../../../packages/client/src/audio/index-for-editor';
import { patternToString } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { DIVISOR_OPTIONS, el, fmt2, noteName, seg, select } from './dom';
import { makeKnob, type KnobSpec } from './knob';

export const PERC_COLOR = '#E0A44E';
export const PITCH_COLOR = '#5FA8A0';

export type KnobOpts = Omit<KnobSpec, 'get' | 'set' | 'label'> & { label?: string };

type Fields = Record<string, unknown>;

export const driverOf = (doc: ArrangementDocument, id: MusicPartId): Fields =>
  (doc[id]?.driver ?? {}) as unknown as Fields;

/** A knob writing one driver field. */
export function driverKnob(
  ctx: AppCtx,
  id: MusicPartId,
  field: string,
  spec: KnobOpts,
): HTMLElement {
  return makeKnob({
    ...spec,
    label: spec.label ?? field,
    get: () => Number(driverOf(ctx.model.doc, id)[field] ?? spec.def),
    set: (v) => void ctx.change({ [id]: { driver: { [field]: v } } }),
  });
}

/** A knob writing one part-section field (note, velocity, hold). */
export function sectionKnob(
  ctx: AppCtx,
  id: MusicPartId,
  field: string,
  spec: KnobOpts,
): HTMLElement {
  const sectionOf = (): Fields => (ctx.model.doc[id] ?? {}) as unknown as Fields;
  return makeKnob({
    ...spec,
    label: spec.label ?? field,
    get: () => Number(sectionOf()[field] ?? spec.def),
    set: (v) => void ctx.change({ [id]: { [field]: v } }),
  });
}

export function divisorPicker(ctx: AppCtx, id: MusicPartId): HTMLElement {
  return select('Step', DIVISOR_OPTIONS, String(driverOf(ctx.model.doc, id).divisor ?? 6), (v) => {
    const result = ctx.change({ [id]: { driver: { divisor: Number(v) } } });
    if (result.ok) ctx.render();
  });
}

const KIND_DEFAULTS: Record<string, Fields> = {
  lfoBars: { kind: 'lfoBars', bars: 8, shape: 'tri' },
  lfoHz: { kind: 'lfoHz', hz: 0.1, shape: 'tri' },
  walk: { kind: 'walk', stepChance: 0.5 },
};

const KIND_KNOBS: Record<string, { f: string; label: string; o: KnobOpts }> = {
  lfoBars: { f: 'bars', label: 'Bars', o: { min: 0.25, max: 64, def: 8, curve: 'log' } },
  lfoHz: {
    f: 'hz',
    label: 'Rate',
    o: { min: 0.01, max: 5, def: 0.1, curve: 'log', fmt: (v) => `${v.toFixed(2)}H` },
  },
  walk: { f: 'stepChance', label: 'Chance', o: { min: 0, max: 1, def: 0.5, fmt: fmt2 } },
};

function densityKnob(ctx: AppCtx, id: 'kick' | 'hat', kind: string): HTMLElement {
  const density = (): Fields => (driverOf(ctx.model.doc, id).density ?? {}) as Fields;
  const k = KIND_KNOBS[kind] ?? KIND_KNOBS['lfoBars'];
  if (!k) throw new Error('unreachable');
  return makeKnob({
    ...k.o,
    label: k.label,
    color: PERC_COLOR,
    get: () => Number(density()[k.f] ?? k.o.def),
    set: (v) => void ctx.change({ [id]: { driver: { density: { kind, [k.f]: v } } } }),
  });
}

function shapeSeg(ctx: AppCtx, id: 'kick' | 'hat', kind: string): HTMLElement {
  const density = (): Fields => (driverOf(ctx.model.doc, id).density ?? {}) as Fields;
  return seg(
    ['tri', 'sine', 'saw'].map((s) => ({ value: s, label: s })),
    () => String(density().shape ?? 'tri'),
    (s) => void ctx.change({ [id]: { driver: { density: { kind, shape: s } } } }),
    PERC_COLOR,
  );
}

/** The density modulator: kind picker plus the kind's own controls. */
export function densityControls(ctx: AppCtx, id: 'kick' | 'hat'): HTMLElement {
  const wrap = el('div');
  wrap.style.marginTop = '8px';
  wrap.appendChild(el('span', 'field-label', 'Density modulator'));
  const density = (): Fields => (driverOf(ctx.model.doc, id).density ?? {}) as Fields;
  const kind = String(density().kind ?? 'lfoBars');
  wrap.appendChild(
    seg(
      ['lfoBars', 'lfoHz', 'walk'].map((k) => ({ value: k, label: k })),
      () => kind,
      (k) => {
        const result = ctx.change({ [id]: { driver: { density: KIND_DEFAULTS[k] } } });
        if (result.ok) ctx.render();
      },
      PERC_COLOR,
    ),
  );
  const row = el('div', 'knob-row');
  row.appendChild(densityKnob(ctx, id, kind));
  wrap.appendChild(row);
  if (kind !== 'walk') wrap.appendChild(shapeSeg(ctx, id, kind));
  return wrap;
}

/** Capture freezes the sounding pattern into the document; release lets go. */
export function captureControls(ctx: AppCtx, id: MusicPartId, color: string): HTMLElement {
  const wrap = el('div', 'capture-row');
  const pattern = driverOf(ctx.model.doc, id).pattern as
    readonly (boolean | number | null)[] | null;
  const button = el('button', 'btn', pattern ? 'Release' : 'Capture') as HTMLButtonElement;
  button.type = 'button';
  button.style.borderColor = color;
  button.onclick = (): void => {
    if (pattern) ctx.release(id);
    else if (!ctx.capture(id)) ctx.status(`${id}: nothing sounding to capture yet`);
  };
  wrap.appendChild(button);
  const text = pattern ? patternText(id, pattern) : 'generative';
  wrap.appendChild(el('span', 'status', `pattern: ${text}`));
  return wrap;
}

function patternText(id: MusicPartId, pattern: readonly (boolean | number | null)[]): string {
  if (id === 'kick' || id === 'hat') return patternToString(pattern as readonly boolean[]);
  return (pattern as readonly (number | null)[])
    .map((n) => (n === null ? '·' : noteName(n)))
    .join(' ');
}
