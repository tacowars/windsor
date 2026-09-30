/**
 * The Echo insert's card (windsor#171): the `echo` return's Time, Regen, Damp
 * and Q, then Mix, and the tempo buttons, on one page (windsor#173). A tempo
 * button writes the time in seconds at the song's bpm, as the return's does,
 * so a later bpm change needs the button pressed again. The on/off switch is
 * the rack's rail.
 */
import type { EchoSpec } from '@windsor/engine';
import { DEFAULT_ECHO } from '@windsor/engine';
import type { InsertCard } from './insertCards';
import { ECHO_KNOBS } from './insertKnobTables';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertPage, wideColumn } from './insertLayout';
import { insertChange } from './insertTarget';
import { tempoRow } from './returnControls';

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
    const tempo = tempoRow(
      ctx.model.doc.transport.bpm,
      () => current().delayTime,
      (seconds) => commit({ ...current(), delayTime: seconds }),
    );
    tempo.root.classList.add('insert-tempo');
    return insertPage(
      wideColumn(tempo.root),
      ...insertKnobs(ctx, slot, index, ECHO_KNOBS, tempo.refresh),
    );
  };
  return [{ name: 'Echo', build }];
};
