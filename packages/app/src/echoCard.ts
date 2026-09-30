/**
 * The Echo insert's card (windsor#171): the `echo` return's Time, Regen, Damp
 * and Q, then Mix, and the tempo picker, on one page (windsor#173). Picking
 * a note value writes the time in seconds at the song's bpm, as the
 * return's tempo buttons do, so a later bpm change needs it picked again; a
 * time that is no note value reads Free. The on/off switch is the rack's
 * rail.
 */
import type { EchoSpec } from '@windsor/engine';
import { DEFAULT_ECHO } from '@windsor/engine';
import type { InsertCard } from './insertCards';
import { ECHO_KNOBS } from './insertKnobTables';
import { bigInsertKnobs, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { insertPage, insertSelect, wideColumn } from './insertLayout';
import { insertChange } from './insertTarget';
import { TEMPO_DIVISIONS } from './mixerTables';
import { tempoMatches, tempoSeconds } from './returnControls';

/** The note value picker at `bpm`, and a refresh that re-reads the time. */
function tempoPicker(
  bpm: number,
  read: () => number,
  pick: (seconds: number) => void,
): { readonly root: HTMLElement; refresh(): void } {
  const shown = (): string =>
    TEMPO_DIVISIONS.find((division) => tempoMatches(bpm, read(), division))?.label ?? '';
  const root = insertSelect({
    label: `Sync to ${bpm} bpm`,
    options: [['', 'Free'], ...TEMPO_DIVISIONS.map((d) => [d.label, d.label] as const)],
    value: shown(),
    change: (label) => {
      const division = TEMPO_DIVISIONS.find((d) => d.label === label);
      if (division) pick(tempoSeconds(bpm, division.beats));
      else refresh();
    },
  });
  const select = root.querySelector('select')!;
  const refresh = (): void => {
    select.value = shown();
  };
  TEMPO_DIVISIONS.forEach((division, at) => {
    const option = select.options[at + 1];
    if (option) option.title = `${division.title} at ${bpm} bpm`;
  });
  return { root, refresh };
}

export const echoCard: InsertCard = (ctx, slot, index) => {
  const current = (): EchoSpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'echo' ? spec : DEFAULT_ECHO;
  };
  const commit = (spec: EchoSpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'echo') return;
    inserts[index] = spec;
    if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
  };
  const build = (): HTMLElement => {
    const tempo = tempoPicker(
      ctx.model.doc.transport.bpm,
      () => current().delayTime,
      (seconds) => commit({ ...current(), delayTime: seconds }),
    );
    const knobs = pickKnobs(ECHO_KNOBS, ['delayTime', 'feedback', 'damp', 'resonance']);
    return insertPage(
      wideColumn(tempo.root),
      ...insertKnobs(ctx, slot, index, knobs, tempo.refresh),
      ...bigInsertKnobs(ctx, slot, index, pickKnobs(ECHO_KNOBS, ['mix'])),
    );
  };
  return [{ name: 'Echo', build }];
};
