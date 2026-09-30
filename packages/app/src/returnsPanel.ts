/**
 * The Mixer tab's send buses (windsor#172; record
 * `2026-09-30-insert-rack-and-send-bus-chains` §6): Send A and Send B, each
 * a head (its name, its Level knob and the parts that send to it, the
 * mockup's `.bus-head`) beside its insert chain, the chain drawn by
 * `stripInserts` as a part's or the master's is, in the bus's `--carrier`
 * accent. Everything goes into the document's `returns` section through
 * `ctx.change`, applied live and undoable like every strip edit. The plate's
 * space and the echo's line are the Plate reverb and Echo cards' own
 * controls (windsor#171).
 */
import type { ReturnName } from '@windsor/engine';
import { RETURNS, RETURN_NAMES } from '@windsor/engine';
import { CARRIER_COLOR } from './consoleColors';
import { fmt2 } from './consoleFormat';
import type { AppCtx } from './context';
import { el, section } from './dom';
import { makeKnob } from './knob';
import { BUS_LABELS } from './mixerTables';
import { busSenders, busSendersLine } from './sendBusModel';
import { stripInserts } from './stripInserts';

function levelKnob(ctx: AppCtx, name: ReturnName): HTMLElement {
  return makeKnob({
    label: 'Level',
    min: 0,
    max: 1,
    def: RETURNS[name].level,
    color: CARRIER_COLOR,
    dial: 'rack-big',
    fmt: fmt2,
    get: () => ctx.model.doc.returns?.[name]?.level ?? RETURNS[name].level,
    set: (v) => void ctx.change({ returns: { [name]: { level: v } } }),
  });
}

function busHead(ctx: AppCtx, name: ReturnName): HTMLElement {
  const head = el('div', 'bus-head');
  const title = el('div', 'bus-name', BUS_LABELS[name]);
  const dot = el('span', 'bus-dot', '●');
  dot.setAttribute('aria-hidden', 'true');
  title.appendChild(dot);
  head.append(
    title,
    levelKnob(ctx, name),
    el('div', 'bus-sub', busSendersLine(busSenders(ctx.model.doc, name))),
  );
  return head;
}

function busRow(ctx: AppCtx, name: ReturnName): HTMLElement {
  const row = el('div', 'bus-line');
  row.append(busHead(ctx, name), stripInserts(ctx, name, 'bus'));
  return row;
}

export function renderReturnsSection(ctx: AppCtx): HTMLElement {
  const buses = section(
    'Send buses',
    'Every part reaches both buses through its sends. Each bus runs what it is sent through its ' +
      'inserts at its level, and both are saved with the song.',
  );
  for (const name of RETURN_NAMES) buses.body.appendChild(busRow(ctx, name));
  return buses.root;
}
