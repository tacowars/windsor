/**
 * The Sequencers tab's field vocabulary (#70): knobs and pickers that write
 * one sequencer or part field through `ctx.change`, the density-modulator
 * controls, and the capture/release row (record §6). Every control addresses
 * its part by slot (#597) and a field by name the spec union knows (#618
 * decision 8), so a typo fails typecheck instead of writing a key the
 * normaliser drops. The specs are `sequencerKnobTables.ts`.
 */
import type {
  ArrangementDocument,
  DensityMod,
  DensityModKind,
  SequencerSpec,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  DENSITY_MOD_KINDS,
  LFO_SHAPES,
  partAt,
  patternToString,
} from '../../../packages/client/src/audio/index-for-editor';
import { PERC_COLOR } from './consoleColors';
import { noteName } from './consoleFormat';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, seg, select } from './dom';
import { makeKnob } from './knob';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { DENSITY_DEFAULTS, DENSITY_KNOBS } from './sequencerKnobTables';
import type { SequencerField, SequencerKnobEntry } from './sequencerKnobTables';

/** The sequencer spec of the part on `slot`, if the part exists. */
export const driverOf = (doc: ArrangementDocument, slot: number): SequencerSpec | undefined =>
  partAt(doc, slot)?.sequencer;

/** One field of a spec by name, whatever the kind; a field the kind lacks reads `undefined`. */
const fieldOf = (spec: SequencerSpec | undefined, field: SequencerField): unknown =>
  spec === undefined ? undefined : Reflect.get(spec, field);

/** A sequencer-field partial for the part on `slot`. */
const sequencerChange = (slot: number, fields: Record<string, unknown>) =>
  partChange(slot, { sequencer: fields });

/** A knob writing one sequencer field (note, hold, gate …). */
export function driverKnob(
  ctx: AppCtx,
  slot: number,
  entry: Extract<SequencerKnobEntry, { kind: 'driver' }>,
  color: string,
): HTMLElement {
  return makeKnob({
    ...entry.o,
    label: entry.label,
    color,
    get: () => Number(fieldOf(driverOf(ctx.model.doc, slot), entry.f) ?? entry.o.def),
    set: (v) => void ctx.change(sequencerChange(slot, { [entry.f]: v })),
  });
}

/** A knob writing one part field (velocity). */
export function sectionKnob(
  ctx: AppCtx,
  slot: number,
  entry: Extract<SequencerKnobEntry, { kind: 'section' }>,
  color: string,
): HTMLElement {
  return makeKnob({
    ...entry.o,
    label: entry.label,
    color,
    get: () => partAt(ctx.model.doc, slot)?.[entry.f] ?? entry.o.def,
    set: (v) => void ctx.change(partChange(slot, { [entry.f]: v })),
  });
}

/** One table entry as a knob, bound to its part or sequencer field. */
export const tableKnob = (
  ctx: AppCtx,
  slot: number,
  entry: SequencerKnobEntry,
  color: string,
): HTMLElement =>
  entry.kind === 'section'
    ? sectionKnob(ctx, slot, entry, color)
    : driverKnob(ctx, slot, entry, color);

/** One card's row of table knobs. */
export function knobRow(
  ctx: AppCtx,
  slot: number,
  table: readonly SequencerKnobEntry[],
  color: string,
): HTMLElement {
  const row = el('div', 'knob-row');
  for (const entry of table) row.appendChild(tableKnob(ctx, slot, entry, color));
  return row;
}

export function divisorPicker(ctx: AppCtx, slot: number): HTMLElement {
  const spec = driverOf(ctx.model.doc, slot);
  const divisor = spec && spec.kind !== 'none' ? spec.divisor : DEFAULT_EUCLIDEAN_CONFIG.divisor;
  return select('Step', DIVISOR_OPTIONS, String(divisor), (v) => {
    const result = ctx.change(sequencerChange(slot, { divisor: Number(v) }));
    if (result.ok) ctx.render();
  });
}

/** The Euclidean part's density modulator, or the engine's default one when the part has none. */
function densityOf(ctx: AppCtx, slot: number): DensityMod {
  const spec = driverOf(ctx.model.doc, slot);
  return spec?.kind === 'euclidean' ? spec.density : DENSITY_DEFAULTS.lfoBars;
}

function densityKnob(ctx: AppCtx, slot: number, kind: DensityModKind): HTMLElement {
  const k = DENSITY_KNOBS[kind];
  return makeKnob({
    ...k.o,
    label: k.label,
    color: PERC_COLOR,
    get: () => Number(Reflect.get(densityOf(ctx, slot), k.f) ?? k.o.def),
    set: (v) => void ctx.change(sequencerChange(slot, { density: { kind, [k.f]: v } })),
  });
}

function shapeSeg(ctx: AppCtx, slot: number, kind: DensityModKind): HTMLElement {
  return seg(
    LFO_SHAPES.map((s) => ({ value: s, label: s })),
    () => {
      const density = densityOf(ctx, slot);
      return density.kind === 'walk' ? LFO_SHAPES[0] : density.shape;
    },
    (s) => void ctx.change(sequencerChange(slot, { density: { kind, shape: s } })),
    PERC_COLOR,
  );
}

/** The density modulator of a Euclidean part: kind picker plus the kind's own controls. */
export function densityControls(ctx: AppCtx, slot: number): HTMLElement {
  const wrap = el('div');
  wrap.style.marginTop = '8px';
  wrap.appendChild(el('span', 'field-label', 'Density modulator'));
  const kind = densityOf(ctx, slot).kind;
  wrap.appendChild(
    seg(
      DENSITY_MOD_KINDS.map((k) => ({ value: k, label: k })),
      () => kind,
      (k) => {
        const picked = DENSITY_MOD_KINDS.find((known) => known === k);
        if (!picked) return;
        const result = ctx.change(sequencerChange(slot, { density: DENSITY_DEFAULTS[picked] }));
        if (result.ok) ctx.render();
      },
      PERC_COLOR,
    ),
  );
  const row = el('div', 'knob-row');
  row.appendChild(densityKnob(ctx, slot, kind));
  wrap.appendChild(row);
  if (kind !== 'walk') wrap.appendChild(shapeSeg(ctx, slot, kind));
  return wrap;
}

/** Capture freezes the sounding pattern into the document; release lets go. */
export function captureControls(ctx: AppCtx, slot: number, color: string): HTMLElement {
  const wrap = el('div', 'capture-row');
  const spec = driverOf(ctx.model.doc, slot);
  const pattern = fieldOf(spec, 'pattern') as readonly (boolean | number | null)[] | null;
  const button = el('button', 'btn', pattern ? 'Release' : 'Capture') as HTMLButtonElement;
  button.type = 'button';
  button.style.borderColor = color;
  button.onclick = (): void => {
    if (pattern) ctx.release(slot);
    else if (!ctx.capture(slot)) ctx.status(`part ${slot}: nothing sounding to capture yet`);
  };
  wrap.appendChild(button);
  const text = pattern ? patternText(spec?.kind === 'euclidean', pattern) : 'generative';
  wrap.appendChild(el('span', 'status', `pattern: ${text}`));
  return wrap;
}

function patternText(onsets: boolean, pattern: readonly (boolean | number | null)[]): string {
  if (onsets) return patternToString(pattern as readonly boolean[]);
  return (pattern as readonly (number | null)[])
    .map((n) => (n === null ? '·' : noteName(n)))
    .join(' ');
}
