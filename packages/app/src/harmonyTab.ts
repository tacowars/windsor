/**
 * Harmony tab (#70, record §2; #705): the key — a pitch-class root and a
 * scale — the chord timeline as a plain event list (one row per event:
 * degree, triad or seventh, duration in bars and beats, delete; and append),
 * and each pitched part's absolute register octave. Pitch only — the density
 * LFOs live in Sequencers. The event list is a stopgap the Song view (#709)
 * replaces; its edits are `harmonyModel.ts`, the specs `harmonyTables.ts`.
 */
import type { HarmonyEvent, ScaleName } from '../../../packages/client/src/audio/index-for-editor';
import {
  BEATS_PER_BAR,
  CHORD_SIZE_SEVENTH,
  CHORD_SIZE_TRIAD,
  SCALE_NAMES,
  partAt,
  songTicksOf,
} from '../../../packages/client/src/audio/index-for-editor';
import { CARRIER_COLOR, PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, section, seg, select } from './dom';
import { degreeOptions } from './gridModel';
import {
  appendEvent,
  barsBeats,
  removeEvent,
  setDegree,
  setDuration,
  setSize,
  toTicks,
} from './harmonyModel';
import { ROOT_OPTIONS, octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';

const COLOR = CARRIER_COLOR;

const SIZE_OPTIONS = [
  { value: String(CHORD_SIZE_TRIAD), label: 'Triad' },
  { value: String(CHORD_SIZE_SEVENTH), label: '7th' },
];

function rootPicker(ctx: AppCtx): HTMLElement {
  return select('Root', ROOT_OPTIONS, String(ctx.model.doc.harmony.root), (value) => {
    if (ctx.change({ harmony: { root: Number(value) } }).ok) ctx.render();
  });
}

function scalePicker(ctx: AppCtx): HTMLElement {
  const { scale } = ctx.model.doc.harmony;
  const current = typeof scale === 'string' ? scale : 'custom';
  const options: { value: string; label: string }[] = SCALE_NAMES.map((name) => ({
    value: name,
    label: name,
  }));
  if (current === 'custom') options.push({ value: 'custom', label: 'custom' });
  return select('Scale', options, current, (name) => {
    const picked: ScaleName | undefined = SCALE_NAMES.find((known) => known === name);
    if (!picked) return;
    const result = ctx.change({ harmony: { scale: picked } });
    if (result.ok) ctx.render();
  });
}

/** Write a new event list and redraw: arrays replace wholesale, so the whole list goes. */
function writeEvents(ctx: AppCtx, events: readonly HarmonyEvent[]): void {
  if (ctx.change({ harmony: { events: [...events] } }).ok) ctx.render();
}

function numberField(
  label: string,
  value: number,
  max: number,
  onChange: (v: number) => void,
): HTMLElement {
  const wrap = el('div');
  wrap.appendChild(el('span', 'field-label', label));
  const input = document.createElement('input');
  input.className = 'field';
  input.type = 'number';
  input.min = '0';
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.onchange = (): void => onChange(Number(input.value));
  wrap.appendChild(input);
  return wrap;
}

function eventRow(ctx: AppCtx, index: number, event: HarmonyEvent): HTMLElement {
  const { doc } = ctx.model;
  const songTicks = songTicksOf(doc);
  const events = doc.harmony.events;
  const row = el('div', 'strip-row');
  const at = barsBeats(event.start);
  row.appendChild(el('div', 'strip-name', `bar ${at.bars + 1}.${at.beats + 1}`));
  const controls = el('div', 'bar-row');
  controls.appendChild(
    select('Degree', degreeOptions(doc.harmony), String(event.degree), (value) =>
      writeEvents(ctx, setDegree(events, index, Number(value))),
    ),
  );
  controls.appendChild(
    seg(
      SIZE_OPTIONS,
      () => String(event.size),
      (value) =>
        writeEvents(
          ctx,
          setSize(
            events,
            index,
            Number(value) === CHORD_SIZE_SEVENTH ? CHORD_SIZE_SEVENTH : CHORD_SIZE_TRIAD,
          ),
        ),
      PITCH_COLOR,
    ),
  );
  const length = barsBeats(event.duration);
  const setLength = (bars: number, beats: number): void =>
    writeEvents(ctx, setDuration(events, index, toTicks(bars, beats), songTicks));
  controls.appendChild(
    numberField('Bars', length.bars, doc.transport.bars, (v) => setLength(v, length.beats)),
  );
  controls.appendChild(
    numberField('Beats', length.beats, BEATS_PER_BAR - 1, (v) => setLength(length.bars, v)),
  );
  const remove = el('button', 'btn', 'Delete') as HTMLButtonElement;
  remove.type = 'button';
  remove.title = 'remove this chord; the one before it holds through its bars';
  remove.disabled = events.length <= 1;
  remove.onclick = (): void => writeEvents(ctx, removeEvent(events, index, songTicks));
  controls.appendChild(remove);
  row.appendChild(controls);
  return row;
}

function timelineSection(ctx: AppCtx): HTMLElement {
  const { doc } = ctx.model;
  const timeline = section(
    'Chord timeline',
    'One row per chord, in order from bar 1; each holds until the next, the last to the end of ' +
      'the song. A Hit in a Chord Player plays whichever chord is under the playhead.',
  );
  doc.harmony.events.forEach((event, index) =>
    timeline.body.appendChild(eventRow(ctx, index, event)),
  );
  const add = el('button', 'btn', 'Append chord') as HTMLButtonElement;
  add.type = 'button';
  add.title = 'add a chord at the end, taking a bar (or half) from the last one';
  add.onclick = (): void => writeEvents(ctx, appendEvent(doc.harmony.events, songTicksOf(doc)));
  timeline.body.appendChild(add);
  return timeline.root;
}

const PITCHED = new Set(['grid', 'chord', 'arp', 'bass']);

function registerRow(ctx: AppCtx, slot: number, name: string): HTMLElement {
  const row = el('div', 'strip-row');
  row.appendChild(el('div', 'strip-name', name));
  const knobs = el('div', 'knob-row');
  const octave = (): number => {
    const sequencer = partAt(ctx.model.doc, slot)?.sequencer;
    return sequencer && 'register' in sequencer ? sequencer.register.octave : 0;
  };
  const kind = partAt(ctx.model.doc, slot)?.sequencer.kind ?? 'none';
  knobs.appendChild(
    makeKnob({
      ...octaveKnob(kind),
      color: COLOR,
      get: octave,
      set: (v) => void ctx.change(partChange(slot, { sequencer: { register: { octave: v } } })),
    }),
  );
  row.appendChild(knobs);
  return row;
}

export function renderHarmonyTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  const key = section('Key & scale', 'One shared key: every pitched part reads its degrees.');
  const row = el('div', 'bar-row');
  row.appendChild(rootPicker(ctx));
  row.appendChild(scalePicker(ctx));
  key.body.appendChild(row);
  body.appendChild(key.root);
  body.appendChild(timelineSection(ctx));

  const registers = section(
    'Registers',
    'The absolute MIDI octave each pitched part sits at: octave 3 at root C is C3 (note 48).',
  );
  for (const part of ctx.model.doc.parts) {
    if (PITCHED.has(part.sequencer.kind)) {
      registers.body.appendChild(registerRow(ctx, part.slot, part.name));
    }
  }
  body.appendChild(registers.root);
}
