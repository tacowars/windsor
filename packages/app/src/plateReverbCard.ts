/**
 * The Plate reverb insert's card (windsor#171): the `room` return's Starting
 * point picker and 13 space knobs, then Mix. Picking a space writes its
 * numbers into the insert; the knobs edit them from there. Three pages
 * (windsor#173): Space (the picker, pre-delay and size, then decay and mix
 * at the rack's big dial), Diffusion (the four diffusion knobs and the
 * modulation) and Tone (the four cuts). The on/off switch is the rack's
 * rail.
 */
import type { PlateReverbSpec } from '@windsor/engine';
import { DEFAULT_PLATE_REVERB, SPACES, plateSpace } from '@windsor/engine';
import type { InsertCard } from './insertCards';
import { PLATE_REVERB_KNOBS } from './insertKnobTables';
import { bigInsertKnobs, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { insertPage, wideColumn } from './insertLayout';
import { insertChange } from './insertTarget';
import { spacePicker } from './returnControls';

export const plateReverbCard: InsertCard = (ctx, slot, index) => {
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
  const knobs = (fields: Parameters<typeof pickKnobs<PlateReverbSpec>>[1]): HTMLElement[] =>
    insertKnobs(ctx, slot, index, pickKnobs(PLATE_REVERB_KNOBS, fields));
  const space = (): HTMLElement => {
    const picker = spacePicker(
      () => plateSpace(current()),
      (name) => commit({ ...current(), ...SPACES[name] }),
    );
    return insertPage(
      wideColumn(picker.root),
      ...insertKnobs(
        ctx,
        slot,
        index,
        pickKnobs(PLATE_REVERB_KNOBS, ['preDelay', 'size']),
        picker.refresh,
      ),
      ...bigInsertKnobs(
        ctx,
        slot,
        index,
        pickKnobs(PLATE_REVERB_KNOBS, ['decay', 'mix']),
        picker.refresh,
      ),
    );
  };
  return [
    { name: 'Space', build: space },
    {
      name: 'Diffusion',
      build: () =>
        insertPage(
          ...knobs(['diffusionIn1', 'diffusionIn2', 'diffusionTank1', 'diffusionTank2']),
          ...knobs(['modRate', 'modDepth']),
        ),
    },
    {
      name: 'Tone',
      build: () =>
        insertPage(...knobs(['inputLowCut', 'inputHighCut', 'tankLowCut', 'tankHighCut'])),
    },
  ];
};
