/**
 * Spectre's workbench tunables (record `2026-10-17-spectre-drawn-cells`
 * decision 10): its tools and their keys, the brush's ranges, the
 * generators and their settings, the lanes' layout, the spectrum's range and
 * every label the workbench shows.
 */
import type { SpectreCurve } from '@windsor/engine';

/** The brushes on the tool rail, in order, with the key that picks each. */
export const SPECTRE_TOOLS = [
  {
    id: 'draw',
    label: 'Draw',
    key: 'd',
    hint: 'Draw: set cells to where you press. Shift draws a line',
  },
  { id: 'push', label: 'Push', key: 'p', hint: 'Push: drag up or down to raise or lower, softly' },
  { id: 'smooth', label: 'Smooth', key: 's', hint: 'Smooth: even out the cells under the brush' },
  { id: 'erase', label: 'Erase', key: 'e', hint: 'Erase: put cells back at rest' },
  {
    id: 'select',
    label: 'Select',
    key: 'm',
    hint: 'Select: mark bands. Shift adds, Alt removes, double-click clears',
  },
] as const;
export type SpectreTool = (typeof SPECTRE_TOOLS)[number]['id'];

/** The brush: its width in cells, and the Levels it can snap drawn values to (0 is off). */
export const SPECTRE_BRUSH = {
  width: 3,
  widthRange: [1, 36],
  levels: [0, 2, 3, 4, 5, 6, 8, 12, 16],
  /** How far a Push drag of the lane's whole height moves a cell. */
  pushPerHeight: 1,
  /** A Smooth pass's pull toward the local average, at full pressure. */
  smoothStrength: 0.5,
  /** A mouse reports no pressure: it presses at this. */
  mousePressure: 0.5,
} as const;

/** The generators of the Shape row, in order. */
export const SPECTRE_GENERATORS = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Tri' },
  { id: 'square', label: 'Square' },
  { id: 'sawUp', label: 'Saw ↑' },
  { id: 'sawDown', label: 'Saw ↓' },
  { id: 'random', label: 'Random' },
  { id: 'harmonics', label: 'Harmonics' },
  { id: 'key', label: 'Key' },
] as const;
export type SpectreGenerator = (typeof SPECTRE_GENERATORS)[number]['id'];

/** A generator's settings, each a knob on the Shape row: range, default and readout. */
export const SPECTRE_SHAPE_SETTINGS = {
  amount: { label: 'Amount', range: [0, 1], def: 0.6 },
  base: { label: 'Base', range: [0, 1], def: 0.2 },
  period: { label: 'Period', range: [0.1, 4], def: 1 },
  phase: { label: 'Phase', range: [0, 1], def: 0 },
  root: { label: 'Root', range: [24, 84], def: 36 },
  count: { label: 'Count', range: [1, 32], def: 12 },
  width: { label: 'Width', range: [1, 9], def: 2 },
  seed: { label: 'Seed', range: [1, 99], def: 1 },
} as const;
export type SpectreShapeSetting = keyof typeof SPECTRE_SHAPE_SETTINGS;

/** Which settings each generator shows. */
export const SPECTRE_GENERATOR_SETTINGS: Readonly<
  Record<SpectreGenerator, readonly SpectreShapeSetting[]>
> = {
  sine: ['amount', 'base', 'period', 'phase'],
  triangle: ['amount', 'base', 'period', 'phase'],
  square: ['amount', 'base', 'period', 'phase'],
  sawUp: ['amount', 'base', 'period', 'phase'],
  sawDown: ['amount', 'base', 'period', 'phase'],
  random: ['amount', 'base', 'seed'],
  harmonics: ['amount', 'base', 'root', 'count', 'width'],
  key: ['amount', 'base', 'width'],
};

/** The transforms of the Shape row, in order. */
export const SPECTRE_TRANSFORMS = [
  { id: 'smooth', label: 'Smooth', hint: 'Even the cells out' },
  { id: 'quantize', label: 'Quantize', hint: 'Snap to the grid (delay) or to Levels' },
  { id: 'flip', label: 'Flip ↔', hint: 'Mirror along the axis, within the selection' },
  { id: 'invert', label: 'Invert ↕', hint: 'Turn the values upside down' },
  { id: 'left', label: '◀', hint: 'Nudge one cell down (←)' },
  { id: 'right', label: '▶', hint: 'Nudge one cell up (→)' },
  { id: 'copyLR', label: 'L→R', hint: 'Copy the left channel to the right' },
  { id: 'copyRL', label: 'R→L', hint: 'Copy the right channel to the left' },
  { id: 'reset', label: 'Reset', hint: 'Put the cells back at rest' },
] as const;
export type SpectreTransform = (typeof SPECTRE_TRANSFORMS)[number]['id'];

/** The lanes, top to bottom, and the key that aims the Shape row at each. */
export const SPECTRE_LANES: readonly { readonly curve: SpectreCurve; readonly key: string }[] = [
  { curve: 'gain', key: '1' },
  { curve: 'delay', key: '2' },
  { curve: 'feedback', key: '3' },
];

/** Each lane's accent, a palette custom property, so the lanes read apart. */
export const SPECTRE_LANE_COLOR: Readonly<Record<SpectreCurve, string>> = {
  gain: '--ink-dim',
  delay: '--modulator',
  feedback: '--return',
};

/** The workbench's canvas: its gutter for lane names, ruler, gaps and the spectrum's floor. */
export const SPECTRE_BENCH = {
  /** Left of the cells: each lane's name and scale. */
  gutterPx: 64,
  rulerPx: 30,
  laneGapPx: 10,
  /** Below this the lanes stop shrinking and the canvas scrolls. */
  minLanePx: 90,
  /** The spectrum's range, in dB of full scale. */
  floorDb: -84,
  ceilingDb: 0,
  /** What the window keeps across and down for the overlay's chrome. */
  sidePx: 320,
  chromePx: 220,
  font: '10px "IBM Plex Mono", ui-monospace, monospace',
  smallFont: '9px "IBM Plex Mono", ui-monospace, monospace',
} as const;

/** The drawing's marks: the ghost's dash, the ruler's C octaves, tick and key-dot sizes, alphas. */
export const SPECTRE_DRAW = {
  ghostDash: [3, 2],
  octavesOfC: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  semitones: 12,
  tickPx: 5,
  keyDotPx: 2,
  maxGridLines: 32,
  barAlpha: 0.55,
  selectAlpha: 0.16,
  spectrumAlpha: 0.22,
  gridAlpha: 0.5,
  gapFromPx: 4,
  labelInset: 6,
  labelLine: 12,
} as const;

/** The LFO's slots, as the card's LFO page lays them out. */
export const SPECTRE_LFO_SLOT_NUMBERS = [1, 2, 3] as const;

/** Each lane's scale, top then bottom. */
export const SPECTRE_LANE_SCALE: Readonly<Record<SpectreCurve, readonly [string, string]>> = {
  gain: ['0 dB', '−∞'],
  delay: ['full', '0'],
  feedback: ['100%', '0%'],
};

export const SPECTRE_LANE_LABELS: Readonly<Record<SpectreCurve, string>> = {
  gain: 'Gain',
  delay: 'Delay',
  feedback: 'Feedback',
};

/** The ruler's frequency labels. */
export const SPECTRE_RULER_HZ = [
  [30, '30'],
  [50, '50'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [5000, '5k'],
  [10000, '10k'],
] as const;

export const SPECTRE_BENCH_LABELS = {
  title: 'Spectre — workbench',
  note: 'Esc closes',
  close: 'Close',
  listen: 'Listen',
  listenHint: 'Listen: hear only the selected bands, wet',
  key: 'Key',
  follow: 'Follow',
  keyHint: 'Mark the song’s scale on the ruler',
  steps: 'Steps',
  stepsHint: 'Steps: each band reads its nearest cell, hard edged',
  link: 'Link',
  linkHint: 'Link: one set of cells for both channels',
  width: 'Width',
  levels: 'Levels',
  snap: 'Snap',
  snapHint: 'Snap: drawn delays land on the grid',
  shape: 'Shape',
  apply: 'Apply',
  applyHint: 'Write the shape into the lane (Enter); Esc drops it',
  transform: 'Transform',
  lane: 'Lane',
  canvas:
    'Spectre workbench: three lanes of cells over frequency. Draw with the pointer; keys D P S E M pick a tool, [ and ] set the width',
  undo: 'Spectre',
  select: 'Spectre selection',
  presetPicker: 'Starting point',
  offAxis: '—',
} as const;
