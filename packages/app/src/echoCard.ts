/**
 * The Echo insert's card (windsor#171): the `echo` return's Time, Regen, Damp
 * and Q, then Mix, the tempo buttons and the on/off switch. A tempo button
 * writes the time in seconds at the song's bpm, as the return's does, so a
 * later bpm change needs the button pressed again.
 */
import type { EchoSpec } from '@windsor/engine';
import { DEFAULT_ECHO } from '@windsor/engine';
import { el, select } from './dom';
import type { InsertCard } from './insertCards';
import { ECHO_KNOBS, INSERT_LABELS, INSERT_SWITCH_OPTIONS } from './insertKnobTables';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertChange } from './insertTarget';
import { tempoRow } from './returnControls';

export const echoCard: InsertCard = (ctx, slot, index) => {
  const root = el('div', 'echo-card');
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
  const s = current();
  const row = el('div', 'knob-row');
  row.append(
    select(INSERT_LABELS.echo, INSERT_SWITCH_OPTIONS, s.enabled ? 'on' : 'off', (value) =>
      commit({ ...current(), enabled: value === 'on' }),
    ),
  );
  root.append(
    row,
    insertKnobs(ctx, slot, index, ECHO_KNOBS),
    tempoRow(ctx.model.doc.transport.bpm, s.delayTime, (seconds) =>
      commit({ ...current(), delayTime: seconds }),
    ),
  );
  return root;
};
