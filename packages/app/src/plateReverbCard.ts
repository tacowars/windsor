/**
 * The Plate reverb insert's card (windsor#171): the `room` return's Starting
 * point picker and 13 space knobs, then Mix, and the on/off switch. Picking a
 * space writes its numbers into the insert; the knobs edit them from there.
 */
import type { PlateReverbSpec } from '@windsor/engine';
import { DEFAULT_PLATE_REVERB, SPACES, plateSpace } from '@windsor/engine';
import { el, select } from './dom';
import type { InsertCard } from './insertCards';
import { INSERT_LABELS, INSERT_SWITCH_OPTIONS, PLATE_REVERB_KNOBS } from './insertKnobTables';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertChange } from './insertTarget';
import { spacePicker } from './returnControls';

export const plateReverbCard: InsertCard = (ctx, slot, index) => {
  const root = el('div', 'plate-card');
  const current = (): PlateReverbSpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'plate' ? spec : DEFAULT_PLATE_REVERB;
  };
  const commit = (spec: PlateReverbSpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'plate') return;
    inserts[index] = spec;
    if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
  };
  const s = current();
  const row = el('div', 'knob-row');
  const picker = spacePicker(
    () => plateSpace(current()),
    (name) => commit({ ...current(), ...SPACES[name] }),
  );
  row.append(
    picker.root,
    select(INSERT_LABELS.plate, INSERT_SWITCH_OPTIONS, s.enabled ? 'on' : 'off', (value) =>
      commit({ ...current(), enabled: value === 'on' }),
    ),
  );
  root.append(row, insertKnobs(ctx, slot, index, PLATE_REVERB_KNOBS, picker.refresh));
  return root;
};
