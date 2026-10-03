/**
 * The Sequencers tab's field vocabulary (#70): knobs and pickers that write
 * one sequencer or part field through `ctx.change`, and the density-modulator
 * controls. The pitched capture/release row went with the arp and step cards
 * (#704); the Euclidean card captures by click-to-toggle. Every control addresses
 * its part by slot (#597) and a field by name the spec union knows (#618
 * decision 8), so a typo fails typecheck instead of writing a key the
 * normaliser drops. The specs are `sequencerKnobTables.ts`.
 *
 * A sequencer field is read from and written to one region's pattern
 * (windsor#75): the optional `region` names it, and `partEdits.ts`'s
 * `patternOf` / `changePattern` do the read and the full-copy write. With no
 * region named, the field is the part's `sequencer`.
 *
 * A Gate, Skip or Density knob locks under the part's sequencer lane on its
 * field (windsor#491, `knobAutomation.ts`'s `seqKnobAutomation`), whichever
 * card draws it.
 */
import type {
  ArrangementDocument,
  DensityMod,
  DensityModKind,
  SequencerSpec,
} from '@windsor/engine';
import { DEFAULT_EUCLIDEAN_CONFIG, DENSITY_MOD_KINDS, LFO_SHAPES, partAt } from '@windsor/engine';
import { PERC_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, seg, select } from './dom';
import { makeKnob } from './knob';
import { isSeqField, knobSongTick, seqKnobAutomation } from './knobAutomation';
import { changePattern, patternOf } from './partEdits';
import { divisorOptions } from './divisorLabels';
import { DENSITY_DEFAULTS, DENSITY_KNOBS } from './sequencerKnobTables';
import type { SequencerField, SequencerKnobEntry } from './sequencerKnobTables';

/**
 * The spec the part on `slot` plays in region `region`, or its sequencer when
 * no region is named; undefined when the part is gone.
 */
export const driverOf = (
  doc: ArrangementDocument,
  slot: number,
  region?: number,
): SequencerSpec | undefined => patternOf(doc, slot, region);

/** One field of a spec by name, whatever the kind; a field the kind lacks reads `undefined`. */
const fieldOf = (spec: SequencerSpec | undefined, field: SequencerField): unknown =>
  spec === undefined ? undefined : Reflect.get(spec, field);

/**
 * A knob writing one sequencer field (note, hold, gate …) of region `region`'s
 * pattern, locked while a lane on the part holds the field.
 */
export function driverKnob(
  ctx: AppCtx,
  slot: number,
  entry: Extract<SequencerKnobEntry, { kind: 'driver' }>,
  color: string,
  region?: number,
): HTMLElement {
  const field = entry.f;
  return makeKnob({
    ...entry.o,
    label: entry.label,
    color,
    get: () => Number(fieldOf(driverOf(ctx.model.doc, slot, region), field) ?? entry.o.def),
    set: (v) => void changePattern(ctx, slot, region, { [field]: v }),
    ...(isSeqField(field)
      ? {
          automation: () =>
            seqKnobAutomation(
              partAt(ctx.model.doc, slot),
              field,
              knobSongTick(ctx.model.doc, ctx.transport.position()),
            ),
        }
      : {}),
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

/** One table entry as a knob, bound to its part field or to region `region`'s sequencer field. */
export const tableKnob = (
  ctx: AppCtx,
  slot: number,
  entry: SequencerKnobEntry,
  color: string,
  region?: number,
): HTMLElement =>
  entry.kind === 'section'
    ? sectionKnob(ctx, slot, entry, color)
    : driverKnob(ctx, slot, entry, color, region);

/** One card's row of table knobs, its sequencer fields in region `region`'s pattern. */
export function knobRow(
  ctx: AppCtx,
  slot: number,
  table: readonly SequencerKnobEntry[],
  color: string,
  region?: number,
): HTMLElement {
  const row = el('div', 'knob-row');
  for (const entry of table) row.appendChild(tableKnob(ctx, slot, entry, color, region));
  return row;
}

export function divisorPicker(ctx: AppCtx, slot: number, region?: number): HTMLElement {
  const spec = driverOf(ctx.model.doc, slot, region);
  const divisor = spec && spec.kind !== 'none' ? spec.divisor : DEFAULT_EUCLIDEAN_CONFIG.divisor;
  return select('Step', divisorOptions(ctx.model.doc.transport.meter), String(divisor), (v) => {
    if (changePattern(ctx, slot, region, { divisor: Number(v) })) ctx.render();
  });
}

/** The pattern the density controls edit: the part on `slot`, in region `region` when one is named. */
interface DensityTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
}

/** The Euclidean pattern's density modulator, or the engine's default one when there is none. */
function densityOf({ ctx, slot, region }: DensityTarget): DensityMod {
  const spec = driverOf(ctx.model.doc, slot, region);
  return spec?.kind === 'euclidean' ? spec.density : DENSITY_DEFAULTS.lfoBars;
}

const writeDensity = (target: DensityTarget, density: Record<string, unknown>): boolean =>
  changePattern(target.ctx, target.slot, target.region, { density });

function densityKnob(target: DensityTarget, kind: DensityModKind): HTMLElement {
  const k = DENSITY_KNOBS[kind];
  return makeKnob({
    ...k.o,
    label: k.label,
    color: PERC_COLOR,
    get: () => Number(Reflect.get(densityOf(target), k.f) ?? k.o.def),
    set: (v) => void writeDensity(target, { kind, [k.f]: v }),
  });
}

function shapeSeg(target: DensityTarget, kind: DensityModKind): HTMLElement {
  return seg(
    LFO_SHAPES.map((s) => ({ value: s, label: s })),
    () => {
      const density = densityOf(target);
      return density.kind === 'walk' ? LFO_SHAPES[0] : density.shape;
    },
    (s) => void writeDensity(target, { kind, shape: s }),
    PERC_COLOR,
  );
}

/** The density modulator of a Euclidean pattern (region `region`'s): kind picker plus the kind's own controls. */
export function densityControls(ctx: AppCtx, slot: number, region?: number): HTMLElement {
  const target: DensityTarget = { ctx, slot, region };
  const wrap = el('div');
  wrap.style.marginTop = '8px';
  wrap.appendChild(el('span', 'field-label', 'Density modulator'));
  const kind = densityOf(target).kind;
  wrap.appendChild(
    seg(
      DENSITY_MOD_KINDS.map((k) => ({ value: k, label: k })),
      () => kind,
      (k) => {
        const picked = DENSITY_MOD_KINDS.find((known) => known === k);
        if (!picked) return;
        if (writeDensity(target, { ...DENSITY_DEFAULTS[picked] })) ctx.render();
      },
      PERC_COLOR,
    ),
  );
  const row = el('div', 'knob-row');
  row.appendChild(densityKnob(target, kind));
  wrap.appendChild(row);
  if (kind !== 'walk') wrap.appendChild(shapeSeg(target, kind));
  return wrap;
}
