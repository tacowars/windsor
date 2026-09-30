/**
 * The drive insert's card (#641): Drive, Tone and Mix, and the on/off switch
 * (windsor#171). A strip's Level feeds the insert, so Level changes how hard
 * it drives; Drive is the trim.
 */
import type { DriveSpec } from '@windsor/engine';
import { DEFAULT_DRIVE } from '@windsor/engine';
import { el, select } from './dom';
import type { InsertCard } from './insertCards';
import { DRIVE_KNOBS, INSERT_LABELS, INSERT_SWITCH_OPTIONS } from './insertKnobTables';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertChange } from './insertTarget';

export const driveCard: InsertCard = (ctx, slot, index) => {
  const root = el('div', 'drive-card');
  const current = (): DriveSpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'drive' ? spec : DEFAULT_DRIVE;
  };
  const commit = (spec: DriveSpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'drive') return;
    inserts[index] = spec;
    if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
  };
  const row = el('div', 'knob-row');
  row.append(
    select(INSERT_LABELS.drive, INSERT_SWITCH_OPTIONS, current().enabled ? 'on' : 'off', (value) =>
      commit({ ...current(), enabled: value === 'on' }),
    ),
  );
  root.append(row, insertKnobs(ctx, slot, index, DRIVE_KNOBS));
  return root;
};
