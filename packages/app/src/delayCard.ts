/** The shared track/master delay card. Every control commits the whole insert through ctx.change. */
import {
  DEFAULT_DELAY,
  DELAY_DIVISIONS,
  DELAY_MODES,
  DELAY_PRESETS,
  applyDelayPreset,
  matchingDelayPreset,
} from '../../../packages/client/src/audio/index-for-editor';
import type { DelaySpec } from '../../../packages/client/src/audio/index-for-editor';
import { DELAY_KNOBS, DELAY_MODE_LABELS } from './delayTables';
import { insertChange } from './insertTarget';
import { el } from './dom';
import type { InsertCard } from './insertCards';
import { insertKnobs, insertsOf } from './insertKnobs';

function select(
  label: string,
  entries: readonly (readonly [string, string])[],
  value: string,
  change: (value: string) => void,
): HTMLElement {
  const wrap = el('label', 'field-wrap', label);
  const input = document.createElement('select');
  input.className = 'field';
  input.setAttribute('aria-label', label);
  for (const [id, text] of entries) input.add(new Option(text, id));
  input.value = value;
  input.onchange = (): void => change(input.value);
  wrap.append(input);
  return wrap;
}

// eslint-disable-next-line max-lines-per-function -- one card construction binds the shared current/commit closures and its controls
export const delayCard: InsertCard = (ctx, slot, index) => {
  const root = el('div', 'delay-card');
  const current = (): DelaySpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'delay' ? spec : DEFAULT_DELAY;
  };
  const commit = (spec: DelaySpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'delay') return;
    inserts[index] = spec;
    if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
  };
  const s = current();
  const row = el('div', 'knob-row');
  const preset = select(
    'Starting point',
    [['', 'Custom'], ...DELAY_PRESETS.map((p) => [p.id, p.label] as const)],
    matchingDelayPreset(s) ?? '',
    (id) => commit(applyDelayPreset(current(), id)),
  );
  row.append(
    preset,
    select(
      'Routing',
      DELAY_MODES.map((mode) => [mode, DELAY_MODE_LABELS[mode]]),
      s.mode,
      (mode) => commit({ ...current(), mode: mode as DelaySpec['mode'] }),
    ),
  );
  row.append(
    select(
      'Delay',
      [
        ['on', 'Enabled'],
        ['off', 'Bypassed'],
      ],
      s.enabled ? 'on' : 'off',
      (value) => commit({ ...current(), enabled: value === 'on' }),
    ),
  );
  root.append(row);
  root.append(timingControls(current, commit));
  const entries = DELAY_KNOBS.filter(
    ({ f }) => (f !== 'leftMs' || !s.leftSync) && (f !== 'rightMs' || !s.rightSync),
  ).map((entry) =>
    s.mode === 'mid-side'
      ? { ...entry, label: entry.label.replace('Left', 'Mid').replace('Right', 'Side') }
      : entry,
  );
  root.append(
    insertKnobs(ctx, slot, index, entries, () => {
      preset.querySelector('select')!.value = matchingDelayPreset(current()) ?? '';
    }),
  );
  root.append(
    el(
      'div',
      'muted',
      'D = dotted · T = triplet. Synced times follow song BPM (maximum 12 s). Free times: 1–8000 ms. Time changes bend pitch. Feedback above 1 sustains regeneration.',
    ),
  );
  return root;
};

function timingControls(current: () => DelaySpec, commit: (spec: DelaySpec) => void): HTMLElement {
  const s = current();
  const row = el('div', 'knob-row');
  for (const side of ['left', 'right'] as const) {
    const label =
      s.mode === 'mid-side'
        ? side === 'left'
          ? 'Mid'
          : 'Side'
        : side === 'left'
          ? 'Left'
          : 'Right';
    row.append(
      select(
        `${label} clock`,
        [
          ['sync', 'Sync'],
          ['free', 'Free (ms)'],
        ],
        s[`${side}Sync`] ? 'sync' : 'free',
        (value) => commit({ ...current(), [`${side}Sync`]: value === 'sync' }),
      ),
    );
    if (s[`${side}Sync`])
      row.append(
        select(
          `${label} division`,
          Object.keys(DELAY_DIVISIONS).map((key) => [key, key]),
          s[`${side}Division`],
          (value) => commit({ ...current(), [`${side}Division`]: value }),
        ),
      );
  }
  return row;
}
