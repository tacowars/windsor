/**
 * The shared track/master delay card. Every control commits the whole insert
 * through ctx.change. Two pages (windsor#173): Time (starting point, routing,
 * each side's sync switch with its division or its ms, feedback and dry /
 * wet) and Tone (high pass, low pass, drive and output). The note on how
 * times work is the sides' tooltip. The on/off switch is the rack's rail.
 */
import {
  DEFAULT_DELAY,
  DELAY_DIVISIONS,
  DELAY_MODES,
  DELAY_PRESETS,
  applyDelayPreset,
  matchingDelayPreset,
} from '@windsor/engine';
import type { DelaySpec } from '@windsor/engine';
import { DELAY_KNOBS, DELAY_MODE_LABELS } from './delayTables';
import { insertChange } from './insertTarget';
import type { InsertCard } from './insertCards';
import type { InsertKnobEntry } from './insertKnobTables';
import { insertKnob, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { insertPage, insertSelect, insertSwitch, wideColumn } from './insertLayout';
import type { AppCtx } from './context';
import type { InsertTarget } from './insertTarget';

const DELAY_NOTE =
  'D = dotted · T = triplet. Synced times follow song BPM (maximum 12 s). Free times: 1–8000 ms. Time changes bend pitch. Feedback above 1 sustains regeneration.';

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
  const routing = insertSelect({
    label: 'Routing',
    options: DELAY_MODES.map((mode) => [mode, DELAY_MODE_LABELS[mode]] as const),
    value: s.mode,
    change: (mode) => view.commit({ ...view.current(), mode: mode as DelaySpec['mode'] }),
  });
  const showMatch = (): void => {
    preset.querySelector('select')!.value = matchingDelayPreset(view.current()) ?? '';
  };
  return insertPage(
    wideColumn(preset, routing),
    sideColumn(view, 'left', showMatch),
    sideColumn(view, 'right', showMatch),
    ...insertKnobs(
      view.ctx,
      view.slot,
      view.index,
      pickKnobs(DELAY_KNOBS, ['feedback', 'mix']),
      showMatch,
    ),
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
      if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
    },
  };
  const tone = pickKnobs(DELAY_KNOBS, ['highpass', 'lowpass', 'drive', 'outputDb']);
  return [
    { name: 'Time', build: () => timePage(view) },
    { name: 'Tone', build: () => insertPage(...insertKnobs(ctx, slot, index, tone)) },
  ];
};
