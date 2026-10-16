/**
 * The Echo insert's card (windsor#171): the `echo` return's Time, Regen, Damp
 * and Q, then Mix, on one page (windsor#173), with a Sync switch beside Time
 * (windsor#816, record `2026-10-16-echo-follows-song-tempo`). Synced, Time
 * steps through the note values, shortest to longest, and the engine plays
 * the one picked at the song's tempo, whatever it becomes; its title gives
 * the length at the song's bpm now. Free, Time is the knob in ms. Each keeps
 * its own setting while the other is in use. The on/off switch is the
 * rack's rail.
 */
import type { EchoSpec } from '@windsor/engine';
import { DEFAULT_ECHO } from '@windsor/engine';
import type { AppCtx } from './context';
import type { InsertCard } from './insertCards';
import { ECHO_DIVISION_KNOB, ECHO_KNOBS, echoDivisionTitle } from './insertKnobTables';
import { bigInsertKnobs, insertKnob, insertsOf, pickKnobs } from './insertKnobs';
import { insertPage, insertSwitch, knobColumns, wideColumn } from './insertLayout';
import type { InsertTarget } from './insertTarget';
import { targetChange } from './insertTarget';
import { knobTitle } from './knob';

/** The synced Time knob, its title the note value's length at the song's bpm, re-read on each turn and look. */
function divisionKnob(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  read: () => EchoSpec,
): HTMLElement {
  let node: HTMLElement | null = null;
  const retitle = (): void => {
    if (!node) return;
    const length = echoDivisionTitle(read().division, ctx.model.doc.transport.bpm);
    node.title = knobTitle(`${ECHO_DIVISION_KNOB.label}, ${length}`);
  };
  node = insertKnob(ctx, slot, index, ECHO_DIVISION_KNOB, retitle);
  retitle();
  node.addEventListener('pointerenter', retitle);
  return node;
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
    if (ctx.change(targetChange(ctx, slot, inserts)).ok) ctx.render();
  };
  const build = (): HTMLElement => {
    const synced = current().sync;
    const sync = insertSwitch('Sync', synced, (on) => commit({ ...current(), sync: on }));
    const time = synced
      ? divisionKnob(ctx, slot, index, current)
      : insertKnob(ctx, slot, index, pickKnobs(ECHO_KNOBS, ['delayTime'])[0]!);
    const line = pickKnobs(ECHO_KNOBS, ['feedback', 'damp', 'resonance']).map((entry) =>
      insertKnob(ctx, slot, index, entry),
    );
    return insertPage(
      wideColumn(sync),
      ...knobColumns([time, ...line]),
      ...bigInsertKnobs(ctx, slot, index, pickKnobs(ECHO_KNOBS, ['mix'])),
    );
  };
  return [{ name: 'Echo', build }];
};
