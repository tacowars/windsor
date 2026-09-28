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
import {
  DELAY_FEEDBACK_MAX,
  DELAY_MAX_SECONDS,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
  RETURNS,
  RETURN_NAMES,
  REVERB_SPACE_RANGES,
  SECONDS_PER_MINUTE,
  SPACES,
  SPACE_NAMES,
} from '@windsor/engine';
import { RETURN_COLOR } from './consoleColors';
import { fmt2, fmtDb, fmtHz, fmtMs } from './consoleFormat';
import type { AppCtx } from './context';
import { el, html, section, select } from './dom';
import { makeKnob, type KnobSpec } from './knob';
import {
  DAMP_MAX,
  DAMP_MIN,
  DELAY_TIME_MIN,
  TEMPO_DIVISIONS,
  TEMPO_MATCH_TOLERANCE,
} from './mixerTables';

type SpaceKnob = { f: keyof ReverbSpace; label: string; o: Partial<KnobSpec> };

/** The 13 plate parameters, in signal order; ranges come from the worklet's table. */
const SPACE_KNOBS: readonly SpaceKnob[] = [
  { f: 'preDelay', label: 'Pre', o: { fmt: fmtMs } },
  { f: 'inputLowCut', label: 'In LC', o: { curve: 'log', fmt: fmtHz } },
  { f: 'inputHighCut', label: 'In HC', o: { curve: 'log', fmt: fmtHz } },
  { f: 'diffusionIn1', label: 'Diff 1', o: { fmt: fmt2 } },
  { f: 'diffusionIn2', label: 'Diff 2', o: { fmt: fmt2 } },
  { f: 'size', label: 'Size', o: { curve: 'log', fmt: fmt2 } },
  { f: 'decay', label: 'Decay', o: { fmt: fmt2 } },
  { f: 'diffusionTank1', label: 'Tank 1', o: { fmt: fmt2 } },
  { f: 'diffusionTank2', label: 'Tank 2', o: { fmt: fmt2 } },
  { f: 'tankLowCut', label: 'Tank LC', o: { curve: 'log', fmt: fmtHz } },
  { f: 'tankHighCut', label: 'Tank HC', o: { curve: 'log', fmt: fmtHz } },
  { f: 'modRate', label: 'Mod Hz', o: { fmt: fmt2 } },
  { f: 'modDepth', label: 'Mod ms', o: { fmt: fmt2 } },
];

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

function spaceKnob(ctx: AppCtx, name: string, spec: SpaceKnob): HTMLElement {
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
    set: (v) => void ctx.change({ returns: { [name]: { space: { [spec.f]: v } } } }),
  });
}

/** Write a named starting point's numbers into the document, then re-render the knobs. */
function spacePicker(ctx: AppCtx, name: string): HTMLElement {
  const current = returnValue(ctx, name);
  const match =
    current.kind === 'reverb'
      ? SPACE_NAMES.find((key) => JSON.stringify(SPACES[key]) === JSON.stringify(current.space))
      : undefined;
  const options: { value: string; label: string }[] = SPACE_NAMES.map((key) => ({
    value: key,
    label: key,
  }));
  if (!match) options.unshift({ value: '', label: 'custom' });
  return select('Starting point', options, match ?? '', (key) => {
    if (key === '') return;
    const space = SPACES[key as keyof typeof SPACES];
    const result = ctx.change({ returns: { [name]: { space: { ...space } } } });
    if (result.ok) {
      ctx.notify(`return "${name}" space → ${key}, in the document`);
      ctx.render();
    }
  });
}

function delayKnobs(ctx: AppCtx, name: string): HTMLElement[] {
  const base = RETURNS.echo;
  const value = (): { delayTime: number; feedback: number; damp: number; resonance: number } => {
    const spec = returnValue(ctx, name);
    return spec.kind === 'delay' ? spec : base;
  };
  const knob = (
    label: string,
    f: 'delayTime' | 'feedback' | 'damp' | 'resonance',
    o: Partial<KnobSpec>,
  ): HTMLElement =>
    makeKnob({
      label,
      min: 0,
      max: 1,
      def: base[f],
      color: RETURN_COLOR,
      ...o,
      get: () => value()[f],
      set: (v) => void ctx.change({ returns: { [name]: { [f]: v } } }),
    });
  return [
    knob('Time', 'delayTime', {
      min: DELAY_TIME_MIN,
      max: DELAY_MAX_SECONDS,
      curve: 'log',
      fmt: fmtMs,
    }),
    knob('Regen', 'feedback', { max: DELAY_FEEDBACK_MAX, fmt: fmt2 }),
    knob('Damp', 'damp', { min: DAMP_MIN, max: DAMP_MAX, curve: 'log', fmt: fmtHz }),
    // The emphasis at Damp (#647): at the floor the repeats always fade; above
    // it, high Regen runs away into the loop's soft clip.
    knob('Q', 'resonance', {
      min: DELAY_RESONANCE_MIN_DB,
      max: DELAY_RESONANCE_MAX_DB,
      fmt: fmtDb,
    }),
  ];
}

/** Seconds of `beats` at the document's bpm, inside the delay line's range. */
function tempoSeconds(bpm: number, beats: number): number {
  const seconds = (beats * SECONDS_PER_MINUTE) / bpm;
  return Math.min(DELAY_MAX_SECONDS, Math.max(DELAY_TIME_MIN, seconds));
}

/** One button per note value: sets the delay time to that value at the current bpm. */
function tempoRow(ctx: AppCtx, name: string): HTMLElement {
  const row = el('div', 'bar-row');
  row.style.marginTop = '6px';
  row.appendChild(el('span', 'field-label', `Sync to ${ctx.model.doc.transport.bpm} bpm`));
  const current = (): number => {
    const spec = returnValue(ctx, name);
    return spec.kind === 'delay' ? spec.delayTime : NaN;
  };
  for (const division of TEMPO_DIVISIONS) {
    const seconds = tempoSeconds(ctx.model.doc.transport.bpm, division.beats);
    const button = el('button', 'btn', division.label) as HTMLButtonElement;
    button.type = 'button';
    button.title = `${division.title} at ${ctx.model.doc.transport.bpm} bpm = ${fmtMs(seconds)}`;
    button.setAttribute(
      'aria-pressed',
      String(Math.abs(current() - seconds) < TEMPO_MATCH_TOLERANCE),
    );
    button.onclick = (): void => {
      const result = ctx.change({ returns: { [name]: { delayTime: seconds } } });
      if (!result.ok) return;
      ctx.notify(
        `return "${name}" time → ${division.title} (${fmtMs(seconds)} at ${ctx.model.doc.transport.bpm} bpm)`,
      );
      ctx.render();
    };
    row.appendChild(button);
  }
  return row;
}

function returnRow(ctx: AppCtx, name: string): HTMLElement {
  const spec = returnValue(ctx, name);
  const row = el('div', 'strip-row');
  row.appendChild(html('div', 'strip-name', `return: ${name} <small>(${spec.kind})</small>`));
  const knobs = el('div', 'knob-row');
  knobs.appendChild(levelKnob(ctx, name));
  if (spec.kind === 'delay') {
    for (const knob of delayKnobs(ctx, name)) knobs.appendChild(knob);
    row.appendChild(tempoRow(ctx, name));
  } else {
    row.appendChild(spacePicker(ctx, name));
    for (const spec2 of SPACE_KNOBS) knobs.appendChild(spaceKnob(ctx, name, spec2));
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
