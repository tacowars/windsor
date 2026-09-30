/**
 * The Mixer tab's returns (#435): the plate's space and level, the delay's
 * time, regeneration, damping and level — all in the document's `returns`
 * section, applied live through `ctx.change` like every other field. The
 * named `SPACES` are starting points: picking one writes its numbers into the
 * document, and the knobs edit them from there. The tempo buttons set the
 * delay time to a note value at the document's bpm; the time is what is
 * stored, so a later bpm change needs the button pressed again.
 */
import type { ReturnSpec, ReverbSpace } from '@windsor/engine';
import { RETURNS, RETURN_NAMES, REVERB_SPACE_RANGES, SPACES } from '@windsor/engine';
import { RETURN_COLOR } from './consoleColors';
import { fmt2, fmtMs } from './consoleFormat';
import type { AppCtx } from './context';
import { el, html, section } from './dom';
import { makeKnob } from './knob';
import type { RefreshingControl, SpaceKnob } from './returnControls';
import { DELAY_LINE_KNOBS, SPACE_KNOBS, spacePicker, tempoRow } from './returnControls';

/** The return as the document has it, else as the code ships it. */
function returnValue(ctx: AppCtx, name: string): ReturnSpec {
  return ctx.model.doc.returns?.[name] ?? RETURNS[name as keyof typeof RETURNS];
}

function levelKnob(ctx: AppCtx, name: string): HTMLElement {
  return makeKnob({
    label: 'Level',
    min: 0,
    max: 1,
    def: RETURNS[name as keyof typeof RETURNS].level,
    color: RETURN_COLOR,
    fmt: fmt2,
    get: () => returnValue(ctx, name).level,
    set: (v) => void ctx.change({ returns: { [name]: { level: v } } }),
  });
}

function spaceKnob(ctx: AppCtx, name: string, spec: SpaceKnob, onChange: () => void): HTMLElement {
  const [min, max] = REVERB_SPACE_RANGES[spec.f];
  const base = RETURNS.room.space[spec.f];
  return makeKnob({
    label: spec.label,
    min,
    max,
    def: base,
    color: RETURN_COLOR,
    ...spec.o,
    get: () => {
      const spec2 = returnValue(ctx, name);
      return spec2.kind === 'reverb' ? spec2.space[spec.f] : base;
    },
    set: (v) => {
      if (ctx.change({ returns: { [name]: { space: { [spec.f]: v } } } }).ok) onChange();
    },
  });
}

/** Write a named starting point's numbers into the document, then re-render the knobs. */
function returnSpacePicker(ctx: AppCtx, name: string): RefreshingControl {
  const read = (): ReverbSpace | undefined => {
    const current = returnValue(ctx, name);
    return current.kind === 'reverb' ? current.space : undefined;
  };
  return spacePicker(read, (key) => {
    const result = ctx.change({ returns: { [name]: { space: { ...SPACES[key] } } } });
    if (result.ok) {
      ctx.notify(`return "${name}" space → ${key}, in the document`);
      ctx.render();
    }
  });
}

function delayKnobs(ctx: AppCtx, name: string, onChange: () => void): HTMLElement[] {
  const base = RETURNS.echo;
  const value = (): { delayTime: number; feedback: number; damp: number; resonance: number } => {
    const spec = returnValue(ctx, name);
    return spec.kind === 'delay' ? spec : base;
  };
  return DELAY_LINE_KNOBS.map(({ f, label, o }) =>
    makeKnob({
      label,
      def: base[f],
      color: RETURN_COLOR,
      ...o,
      get: () => value()[f],
      set: (v) => {
        if (ctx.change({ returns: { [name]: { [f]: v } } }).ok) onChange();
      },
    }),
  );
}

/** The tempo buttons: each sets the delay time to a note value at the document's bpm. */
function returnTempoRow(ctx: AppCtx, name: string): RefreshingControl {
  const bpm = ctx.model.doc.transport.bpm;
  const read = (): number => {
    const spec = returnValue(ctx, name);
    return spec.kind === 'delay' ? spec.delayTime : NaN;
  };
  return tempoRow(bpm, read, (seconds, division) => {
    const result = ctx.change({ returns: { [name]: { delayTime: seconds } } });
    if (!result.ok) return;
    ctx.notify(
      `return "${name}" time → ${division.title} (${fmtMs(seconds)} at ${ctx.model.doc.transport.bpm} bpm)`,
    );
    ctx.render();
  });
}

function returnRow(ctx: AppCtx, name: string): HTMLElement {
  const spec = returnValue(ctx, name);
  const row = el('div', 'strip-row');
  row.appendChild(html('div', 'strip-name', `return: ${name} <small>(${spec.kind})</small>`));
  const knobs = el('div', 'knob-row');
  knobs.appendChild(levelKnob(ctx, name));
  if (spec.kind === 'delay') {
    const tempo = returnTempoRow(ctx, name);
    for (const knob of delayKnobs(ctx, name, tempo.refresh)) knobs.appendChild(knob);
    row.appendChild(tempo.root);
  } else {
    const picker = returnSpacePicker(ctx, name);
    row.appendChild(picker.root);
    for (const spec2 of SPACE_KNOBS) {
      knobs.appendChild(spaceKnob(ctx, name, spec2, picker.refresh));
    }
  }
  row.appendChild(knobs);
  return row;
}

export function renderReturnsSection(ctx: AppCtx): HTMLElement {
  const returns = section(
    'Returns',
    'The plate and the delay are shared by every part through its strip’s sends. Their settings ' +
      'and levels are saved with the song, and the tempo buttons set the delay time to a note value ' +
      'at the song’s tempo.',
  );
  for (const name of RETURN_NAMES) returns.body.appendChild(returnRow(ctx, name));
  return returns.root;
}
