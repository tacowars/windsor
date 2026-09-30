/**
 * The controls the returns and the inserts that run their DSP share
 * (windsor#171): the plate's 13 space knobs and its Starting point picker,
 * the delay line's Time, Regen, Damp and Q, and the tempo buttons. The
 * Mixer tab's returns (`returnsPanel.ts`) and the Plate reverb and Echo
 * cards bind them to their own fields, so the two cannot drift apart.
 */
import type { ReverbSpace, SpaceName } from '@windsor/engine';
import {
  DELAY_FEEDBACK_MAX,
  DELAY_MAX_SECONDS,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
  SECONDS_PER_MINUTE,
  SPACES,
  SPACE_NAMES,
} from '@windsor/engine';
import { fmt2, fmtDb, fmtHz, fmtMs } from './consoleFormat';
import { el, select } from './dom';
import type { KnobSpec } from './knob';
import {
  DAMP_MAX,
  DAMP_MIN,
  DELAY_TIME_MIN,
  TEMPO_DIVISIONS,
  TEMPO_MATCH_TOLERANCE,
} from './mixerTables';

export type SpaceKnob = { f: keyof ReverbSpace; label: string; o: Partial<KnobSpec> };

/** The 13 plate parameters, in signal order; ranges come from the worklet's table. */
export const SPACE_KNOBS: readonly SpaceKnob[] = [
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

export type DelayLineField = 'delayTime' | 'feedback' | 'damp' | 'resonance';
export type DelayLineKnob = {
  f: DelayLineField;
  label: string;
  o: Pick<KnobSpec, 'min' | 'max'> & Partial<KnobSpec>;
};

/** The delay line's four knobs, with the ranges the console dials them over. */
export const DELAY_LINE_KNOBS: readonly DelayLineKnob[] = [
  {
    f: 'delayTime',
    label: 'Time',
    o: { min: DELAY_TIME_MIN, max: DELAY_MAX_SECONDS, curve: 'log', fmt: fmtMs },
  },
  { f: 'feedback', label: 'Regen', o: { min: 0, max: DELAY_FEEDBACK_MAX, fmt: fmt2 } },
  { f: 'damp', label: 'Damp', o: { min: DAMP_MIN, max: DAMP_MAX, curve: 'log', fmt: fmtHz } },
  // The emphasis at Damp (#647): at the floor the repeats always fade; above
  // it, high Regen runs away into the loop's soft clip.
  {
    f: 'resonance',
    label: 'Q',
    o: { min: DELAY_RESONANCE_MIN_DB, max: DELAY_RESONANCE_MAX_DB, fmt: fmtDb },
  },
];

/** The named starting point whose numbers `space` holds exactly, field by field, if any. */
export function matchingSpace(space: ReverbSpace | undefined): SpaceName | undefined {
  if (!space) return undefined;
  return SPACE_NAMES.find((key) => {
    const named = SPACES[key];
    return (Object.keys(named) as (keyof ReverbSpace)[]).every((f) => named[f] === space[f]);
  });
}

/** A control that re-reads the document when a knob beside it edits what it shows. */
export interface RefreshingControl {
  readonly root: HTMLElement;
  refresh(): void;
}

/**
 * The Starting point picker: the named spaces, and "custom" when the space
 * `read` returns matches none. Picking one hands its name to `onPick`, which
 * writes its numbers into the document. `refresh` re-evaluates the match, so
 * a knob turn that leaves every space reads "custom", and picking the space
 * it left is a one-step reset.
 */
export function spacePicker(
  read: () => ReverbSpace | undefined,
  onPick: (name: SpaceName) => void,
): RefreshingControl {
  const options = SPACE_NAMES.map((key) => ({ value: key, label: key }));
  const root = select('Starting point', options, '', (key) => {
    if (key === '') return;
    onPick(key as SpaceName);
  });
  const sel = root.querySelector('select') as HTMLSelectElement;
  const custom = new Option('custom', '');
  const refresh = (): void => {
    const match = matchingSpace(read());
    if (match) custom.remove();
    else if (custom.parentElement !== sel) sel.add(custom, 0);
    sel.value = match ?? '';
  };
  refresh();
  return { root, refresh };
}

/** Seconds of `beats` at `bpm`, inside the delay line's range. */
export function tempoSeconds(bpm: number, beats: number): number {
  const seconds = (beats * SECONDS_PER_MINUTE) / bpm;
  return Math.min(DELAY_MAX_SECONDS, Math.max(DELAY_TIME_MIN, seconds));
}

export type TempoDivision = (typeof TEMPO_DIVISIONS)[number];

/** Whether a delay time of `seconds` is `division` at `bpm`. */
export function tempoMatches(bpm: number, seconds: number, division: TempoDivision): boolean {
  return Math.abs(seconds - tempoSeconds(bpm, division.beats)) < TEMPO_MATCH_TOLERANCE;
}

/**
 * One button per note value at `bpm`, pressed when the time `read` returns
 * (seconds) is that value. A press hands `onPick` the seconds to store: the
 * time is what is saved, so a later bpm change needs the button pressed
 * again. `refresh` re-reads the time, so a Time knob turn releases a button.
 */
export function tempoRow(
  bpm: number,
  read: () => number,
  onPick: (seconds: number, division: TempoDivision) => void,
): RefreshingControl {
  const root = el('div', 'bar-row');
  root.style.marginTop = '6px';
  root.appendChild(el('span', 'field-label', `Sync to ${bpm} bpm`));
  const buttons = TEMPO_DIVISIONS.map((division) => {
    const seconds = tempoSeconds(bpm, division.beats);
    const button = el('button', 'btn', division.label) as HTMLButtonElement;
    button.type = 'button';
    button.title = `${division.title} at ${bpm} bpm = ${fmtMs(seconds)}`;
    button.onclick = (): void => onPick(seconds, division);
    root.appendChild(button);
    return { button, division };
  });
  const refresh = (): void => {
    const current = read();
    for (const { button, division } of buttons) {
      button.setAttribute('aria-pressed', String(tempoMatches(bpm, current, division)));
    }
  };
  refresh();
  return { root, refresh };
}
