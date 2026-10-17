/**
 * Spectre's card tunables (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`): the Curves page's thumbnail, the card's
 * labels, the LFO destinations' names, and the knobs on the engine's ranges
 * and defaults. The workbench's own are `spectreBenchTables.ts`.
 */
import { DEFAULT_SPECTRE, SPECTRE_BOUNDS } from '@windsor/engine';
import type { SpectreLfoDest, SpectreSpec } from '@windsor/engine';
import { fmt2, fmtDb, fmtMs } from './consoleFormat';
import type { InsertKnobEntry } from './insertKnobTables';

/** The Curves page's thumbnail: the Pump's plot's size; a click opens the workbench. */
export const SPECTRE_THUMB = {
  width: 384,
  height: 160,
  gapPx: 4,
} as const;

export const SPECTRE_LABELS = {
  thumb: 'Spectre’s three lanes: gain, delay and feedback. Press to open the workbench',
  sync: 'Sync',
  division: 'Time',
  grid: 'Grid',
  bands: 'Bands',
  overlap: 'Overlap',
  window: 'Window',
  mod: 'Modulation',
  follow: 'Follow',
  lfoShape: 'LFO',
  lfoDivision: 'Rate',
  lfoDest: 'LFO',
  freezeMode: 'Freeze mode',
  freezeOn: 'Freeze: every band holds what it carries. Press to let go',
  freezeOff: 'Freeze: close every band’s input and hold what the delays carry',
  expand: 'Expand: open the workbench',
} as const;

/** What each LFO destination is called in its picker. */
export const SPECTRE_LFO_DEST_LABELS: Readonly<Record<SpectreLfoDest, string>> = {
  gainShift: 'Gain shift',
  delayShift: 'Delay shift',
  feedbackShift: 'Feedback shift',
  gainOffset: 'Gain offset',
  delayOffset: 'Delay offset',
  feedbackOffset: 'Feedback offset',
  gainSelect: 'Gain select',
  delaySelect: 'Delay select',
  feedbackSelect: 'Feedback select',
  modA: 'Mod A',
};

/** The page names, in order. */
export const SPECTRE_PAGES = ['Curves', 'Time', 'Spectrum', 'LFO'] as const;

const PERCENT = 100;
const MS_PER_SECOND = 1000;
const percent = (v: number): string => `${Math.round(v * PERCENT)}%`;
const signed = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v * PERCENT)}%`;
const octaves = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(2)} oct`;
const B = SPECTRE_BOUNDS;
const D = DEFAULT_SPECTRE;

type Entry = InsertKnobEntry<SpectreSpec>;
const knob = (
  f: Entry['f'] & keyof typeof B,
  label: string,
  fmt: (v: number) => string,
  more: Partial<Entry['o']> = {},
): Entry => ({
  f,
  label,
  o: { min: B[f][0], max: B[f][1], def: D[f] as number, fmt, ...more },
});

export const SPECTRE_KNOBS: readonly Entry[] = [
  knob('gainShift', 'G shift', octaves),
  knob('gainOffset', 'G offset', signed),
  knob('gainSelect', 'G select', signed),
  knob('delayShift', 'D shift', octaves),
  knob('delayOffset', 'D offset', signed),
  knob('delaySelect', 'D select', signed),
  knob('feedbackShift', 'F shift', octaves),
  knob('feedbackOffset', 'F offset', signed),
  knob('feedbackSelect', 'F select', signed),
  knob('timeMs', 'Time', (v) => fmtMs(v / MS_PER_SECOND), { curve: 'log' }),
  knob('scatter', 'Scatter', percent),
  knob('spread', 'Spread', octaves),
  knob('mix', 'Mix', percent),
  knob('outputDb', 'Output', fmtDb),
  knob('modA', 'A', fmt2),
  knob('modB', 'B', fmt2),
  knob('modC', 'C', fmt2),
  knob('lfoHz', 'Rate', (v) => `${v.toFixed(2)}Hz`, { curve: 'log' }),
  knob('lfoDepth1', 'Depth 1', signed),
  knob('lfoDepth2', 'Depth 2', signed),
  knob('lfoDepth3', 'Depth 3', signed),
];
