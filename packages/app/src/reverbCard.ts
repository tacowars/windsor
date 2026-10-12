/**
 * The Reverb insert's card (windsor#171): the `room` return's Starting
 * point picker and 16 space knobs, then Mix. Picking a space writes its
 * numbers into the insert; the knobs edit them from there. Three pages
 * (windsor#173): Space (the picker, pre-delay and size, then decay and mix
 * at the rack's big dial), Diffusion (the voicing's `Plate | Room` switch
 * (windsor#746), the two input diffusion knobs, Build in a column of its own
 * (windsor#761), the two tank diffusion knobs, and the modulation) and Tone
 * (the four cuts, then the low band's `Low ×` and
 * `Low Hz`, windsor#748). The on/off switch is the rack's
 * rail.
 */
import type { ReverbInsertSpec } from '@windsor/engine';
import { DEFAULT_REVERB, SPACES, plateSpace } from '@windsor/engine';
import { STRIP_COLOR } from './consoleColors';
import { el, seg } from './dom';
import type { InsertCard } from './insertCards';
import { REVERB_KNOBS } from './insertKnobTables';
import { bigInsertKnobs, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { fitColumn, insertPage, wideColumn } from './insertLayout';
import { targetChange } from './insertTarget';
import type { PlateVoicing } from './returnControls';
import { VOICING_OPTIONS, spacePicker } from './returnControls';

/**
 * The voicing's `Plate | Room` switch (windsor#746), labelled as the Filter's
 * mode is, in a column of its own: which tables the tank reads. Flipping it
 * commits `voicing` alone; a starting point sets it with its knobs, and the
 * card re-renders on either.
 */
function voicingSwitch(read: () => PlateVoicing, pick: (value: PlateVoicing) => void): HTMLElement {
  const wrap = el('div');
  wrap.append(
    el('span', 'field-label', 'Voicing'),
    seg(VOICING_OPTIONS, read, (value) => pick(value as PlateVoicing), STRIP_COLOR),
  );
  return fitColumn(wrap);
}

export const reverbCard: InsertCard = (ctx, slot, index) => {
  const current = (): ReverbInsertSpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'reverb' ? spec : DEFAULT_REVERB;
  };
  const commit = (spec: ReverbInsertSpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'reverb') return;
    inserts[index] = spec;
    if (ctx.change(targetChange(ctx, slot, inserts)).ok) ctx.render();
  };
  const knobs = (
    fields: Parameters<typeof pickKnobs<ReverbInsertSpec>>[1],
    refresh?: () => void,
  ): HTMLElement[] => insertKnobs(ctx, slot, index, pickKnobs(REVERB_KNOBS, fields), refresh);
  const space = (): HTMLElement => {
    const picker = spacePicker(
      () => plateSpace(current()),
      (name) => commit({ ...current(), ...SPACES[name] }),
    );
    return insertPage(
      wideColumn(picker.root),
      ...knobs(['preDelay', 'size'], picker.refresh),
      ...bigInsertKnobs(
        ctx,
        slot,
        index,
        pickKnobs(REVERB_KNOBS, ['decay', 'mix']),
        picker.refresh,
      ),
    );
  };
  const voicing = (): HTMLElement =>
    voicingSwitch(
      () => current().voicing,
      (value) => commit({ ...current(), voicing: value }),
    );
  return [
    { name: 'Space', build: space },
    {
      name: 'Diffusion',
      build: () =>
        insertPage(
          // In signal order: the voicing, the input diffusers, Build alone,
          // the tank's diffusers.
          voicing(),
          ...knobs(['diffusionIn1', 'diffusionIn2']),
          ...knobs(['build']),
          ...knobs(['diffusionTank1', 'diffusionTank2']),
          ...knobs(['modRate', 'modDepth']),
        ),
    },
    {
      name: 'Tone',
      build: () =>
        insertPage(
          ...knobs(['inputLowCut', 'inputHighCut', 'tankLowCut', 'tankHighCut']),
          ...knobs(['lowDecay', 'lowCross']),
        ),
    },
  ];
};
