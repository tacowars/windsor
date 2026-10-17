/**
 * The shared track/master Dub delay card (record
 * `2026-10-17-dub-delay-regeneration`). Every control commits the whole
 * insert through ctx.change. Four pages: Time (starting point, routing, each
 * side's sync switch with its division or its ms, Feedback, Cross, Sustain
 * and dry / wet), Loop (the filter's shape, Cutoff, Resonance, Width and the
 * low cut), Color (the saturation's character, Drive, Damping and Output)
 * and Motion (the LFO's shape, Rate, Wow and Sweep). The note on how times
 * work is the sides' tooltip. The on/off switch is the rack's rail.
 */
import {
  DEFAULT_DELAY,
  DELAY_CHARACTERS,
  DELAY_DIVISIONS,
  DELAY_FILTERS,
  DELAY_MODES,
  DELAY_PRESETS,
  DELAY_WAVES,
  applyDelayPreset,
  matchingDelayPreset,
} from '@windsor/engine';
import type { DelaySpec } from '@windsor/engine';
import {
  DELAY_CHARACTER_LABELS,
  DELAY_FILTER_LABELS,
  DELAY_KNOBS,
  DELAY_MODE_LABELS,
  DELAY_WAVE_LABELS,
} from './delayTables';
import { targetChange } from './insertTarget';
import type { InsertCard } from './insertCards';
import type { InsertKnobEntry } from './insertKnobTables';
import { insertKnob, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { insertPage, insertSelect, insertSwitch, wideColumn } from './insertLayout';
import type { AppCtx } from './context';
import type { InsertTarget } from './insertTarget';

const DELAY_NOTE =
  'D = dotted · T = triplet. Synced times follow song BPM (maximum 12 s). Free times: 1–8000 ms. Time changes bend pitch.';
const SUSTAIN_NOTE =
  'Sustain holds the loop at full feedback and shuts the input out: what the lines carry keeps passing the filter and saturation. The dry signal stays.';

/** A field a knob may hold. */
type DelayField = Exclude<keyof DelaySpec, 'kind'>;

interface DelayView {
  readonly ctx: AppCtx;
  readonly slot: InsertTarget;
  readonly index: number;
  current(): DelaySpec;
  commit(spec: DelaySpec): void;
}

/** A knob's entry, named Mid and Side in place of Left and Right while the routing is mid / side. */
function sided(spec: DelaySpec, entry: InsertKnobEntry<DelaySpec>): InsertKnobEntry<DelaySpec> {
  if (spec.mode !== 'mid-side') return entry;
  return { ...entry, label: entry.label.replace('Left', 'Mid').replace('Right', 'Side') };
}

/** A picker over one of the spec's choices, its options labelled from `labels`. */
function choice<K extends 'mode' | 'filter' | 'character' | 'wave'>(
  view: DelayView,
  o: {
    field: K;
    label: string;
    values: readonly DelaySpec[K][];
    labels: Readonly<Record<DelaySpec[K], string>>;
  },
): HTMLElement {
  return insertSelect({
    label: o.label,
    options: o.values.map((value) => [value, o.labels[value]] as const),
    value: view.current()[o.field],
    change: (value) => view.commit({ ...view.current(), [o.field]: value }),
  });
}

/** One side's sync switch, then its division while synced or its time knob while free. */
function sideColumn(view: DelayView, side: 'left' | 'right', onKnob: () => void): HTMLElement {
  const s = view.current();
  const name =
    s.mode === 'mid-side' ? (side === 'left' ? 'Mid' : 'Side') : side === 'left' ? 'Left' : 'Right';
  const synced = s[`${side}Sync`];
  const sync = insertSwitch(`Sync ${name.toLowerCase()}`, synced, (on) =>
    view.commit({ ...view.current(), [`${side}Sync`]: on }),
  );
  const [entry] = pickKnobs(DELAY_KNOBS, [side === 'left' ? 'leftMs' : 'rightMs']);
  const time = synced
    ? insertSelect({
        label: name,
        ariaLabel: `${name} division`,
        options: Object.keys(DELAY_DIVISIONS).map((key) => [key, key] as const),
        value: s[`${side}Division`],
        change: (value) => view.commit({ ...view.current(), [`${side}Division`]: value }),
      })
    : insertKnob(view.ctx, view.slot, view.index, sided(s, entry!), onKnob);
  const column = wideColumn(sync, time);
  column.title = DELAY_NOTE;
  return column;
}

function timePage(view: DelayView): HTMLElement {
  const s = view.current();
  const preset = insertSelect({
    label: 'Starting point',
    options: [['', 'Custom'], ...DELAY_PRESETS.map((p) => [p.id, p.label] as const)],
    value: matchingDelayPreset(s) ?? '',
    change: (id) => view.commit(applyDelayPreset(view.current(), id)),
  });
  const routing = choice(view, {
    field: 'mode',
    label: 'Routing',
    values: DELAY_MODES,
    labels: DELAY_MODE_LABELS,
  });
  const showMatch = (): void => {
    preset.querySelector('select')!.value = matchingDelayPreset(view.current()) ?? '';
  };
  const sustain = insertSwitch('Sustain', s.sustain, (on) =>
    view.commit({ ...view.current(), sustain: on }),
  );
  const held = wideColumn(sustain);
  held.title = SUSTAIN_NOTE;
  const knobs = (fields: DelayField[]): HTMLElement[] =>
    insertKnobs(view.ctx, view.slot, view.index, pickKnobs(DELAY_KNOBS, fields), showMatch);
  return insertPage(
    wideColumn(preset, routing),
    sideColumn(view, 'left', showMatch),
    sideColumn(view, 'right', showMatch),
    ...knobs(['feedback', 'cross']),
    held,
    ...knobs(['mix']),
  );
}

function loopPage(view: DelayView): HTMLElement {
  const filter = choice(view, {
    field: 'filter',
    label: 'Filter',
    values: DELAY_FILTERS,
    labels: DELAY_FILTER_LABELS,
  });
  const banded = view.current().filter === 'bandpass' || view.current().filter === 'peak';
  const fields: DelayField[] = ['cutoff', 'resonance', ...(banded ? ['width' as const] : [])];
  return insertPage(
    wideColumn(filter),
    ...insertKnobs(view.ctx, view.slot, view.index, pickKnobs(DELAY_KNOBS, [...fields, 'lowCut'])),
  );
}

function colorPage(view: DelayView): HTMLElement {
  const character = choice(view, {
    field: 'character',
    label: 'Character',
    values: DELAY_CHARACTERS,
    labels: DELAY_CHARACTER_LABELS,
  });
  const fields: DelayField[] = ['drive', 'damping', 'dampingHz', 'outputDb'];
  return insertPage(
    wideColumn(character),
    ...insertKnobs(view.ctx, view.slot, view.index, pickKnobs(DELAY_KNOBS, fields)),
  );
}

function motionPage(view: DelayView): HTMLElement {
  const wave = choice(view, {
    field: 'wave',
    label: 'Shape',
    values: DELAY_WAVES,
    labels: DELAY_WAVE_LABELS,
  });
  const fields: DelayField[] = ['modRate', 'wow', 'sweep'];
  return insertPage(
    wideColumn(wave),
    ...insertKnobs(view.ctx, view.slot, view.index, pickKnobs(DELAY_KNOBS, fields)),
  );
}

export const delayCard: InsertCard = (ctx, slot, index) => {
  const view: DelayView = {
    ctx,
    slot,
    index,
    current: () => {
      const spec = insertsOf(ctx, slot)[index];
      return spec?.kind === 'delay' ? spec : DEFAULT_DELAY;
    },
    commit: (spec) => {
      const inserts = [...insertsOf(ctx, slot)];
      if (inserts[index]?.kind !== 'delay') return;
      inserts[index] = spec;
      if (ctx.change(targetChange(ctx, slot, inserts)).ok) ctx.render();
    },
  };
  return [
    { name: 'Time', build: () => timePage(view) },
    { name: 'Loop', build: () => loopPage(view) },
    { name: 'Color', build: () => colorPage(view) },
    { name: 'Motion', build: () => motionPage(view) },
  ];
};
