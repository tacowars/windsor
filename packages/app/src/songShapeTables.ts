/**
 * The Shape tool's data (windsor#350; record `2026-10-01-song-automation-lanes`
 * decisions 12 and 13; the mockup `docs/design/automation-lanes-mockup.html`):
 * the shapes the popover offers with their icons, the Rate choices, the
 * limits of Phase and Duty, where a session starts, and where the popover
 * sits. The rules over them are `songShapeModel.ts`, the popover
 * `songShapePopover.ts`.
 */
import type { AutomationShapeKind } from '@windsor/engine';
import { PPQ, TICKS_PER_BAR } from '@windsor/engine';

/** One shape button: its label and its icon, an SVG path in a 30 × 16 box. */
export interface ShapeChoice {
  readonly kind: AutomationShapeKind;
  readonly label: string;
  readonly icon: string;
}

/** The shape buttons, in the engine's order (decision 3), drawn as in the mockup. */
export const SHAPE_CHOICES: readonly ShapeChoice[] = [
  { kind: 'triangle', label: 'Tri', icon: 'M1 14 L8 2 L15 14 L22 2 L29 14' },
  {
    kind: 'square',
    label: 'Square',
    icon: 'M1 14 L1 2 L8 2 L8 14 L15 14 L15 2 L22 2 L22 14 L29 14',
  },
  { kind: 'sawUp', label: 'Saw ↑', icon: 'M1 14 L10 2 L10 14 L19 2 L19 14 L28 2' },
  { kind: 'sawDown', label: 'Saw ↓', icon: 'M1 2 L10 14 L10 2 L19 14 L19 2 L28 14' },
  {
    kind: 'sine',
    label: 'Sine',
    icon: 'M1 8 C4 0, 8 0, 8 8 S 12 16, 15 8 S 19 0, 22 8 S 26 16, 29 8',
  },
  { kind: 'ramp', label: 'Ramp', icon: 'M1 14 L29 2' },
  { kind: 'sCurve', label: 'S-curve', icon: 'M1 14 C12 14, 18 2, 29 2' },
];

/** The shapes drawn once across the range, which ignore Rate and Phase. */
export const ONCE_SHAPES: ReadonlySet<AutomationShapeKind> = new Set(['ramp', 'sCurve']);

/** One Rate choice: its label and one cycle in song ticks. */
export interface ShapeRate {
  readonly label: string;
  readonly ticks: number;
}

/** The Rate slider's stops (decision 3), fast to slow. */
export const SHAPE_RATES: readonly ShapeRate[] = [
  { label: '1/32', ticks: PPQ / 8 },
  { label: '1/16', ticks: PPQ / 4 },
  { label: '1/8', ticks: PPQ / 2 },
  { label: '1/4', ticks: PPQ },
  { label: '1/2', ticks: PPQ * 2 },
  { label: '1 bar', ticks: TICKS_PER_BAR },
  { label: '2 bars', ticks: TICKS_PER_BAR * 2 },
  { label: '4 bars', ticks: TICKS_PER_BAR * 4 },
];

/** The sliders' ranges and steps (decision 3). */
export interface ShapeLimits {
  /** Phase runs 0..1 of a cycle (0–360°) in steps of 1 / `phaseSteps`. */
  readonly phaseSteps: number;
  readonly degreesPerCycle: number;
  /** The square's duty, its share of the cycle at the top. */
  readonly dutyMin: number;
  readonly dutyMax: number;
  readonly dutyStep: number;
  readonly percent: number;
  /** Top and Bottom move in display space (0..1 of the lane), in this step. */
  readonly heightStep: number;
}

export const SHAPE_LIMITS: ShapeLimits = {
  phaseSteps: 16,
  degreesPerCycle: 360,
  dutyMin: 0.1,
  dutyMax: 0.9,
  dutyStep: 0.05,
  percent: 100,
  heightStep: 0.005,
};

/** What the popover keeps for the session (decision 4): the last shape, rate, phase and duty. */
export interface ShapeSettings {
  readonly kind: AutomationShapeKind;
  readonly rateTicks: number;
  readonly phase: number;
  readonly duty: number;
}

/** Where a session starts (decision 4): a 1/16 square, duty 50%, phase 0. */
export const DEFAULT_SHAPE_SETTINGS: ShapeSettings = {
  kind: 'square',
  rateTicks: PPQ / 4,
  phase: 0,
  duty: 0.5,
};

/** Where the popover sits against its lane and the Song view (decision 2). */
export interface ShapePopoverGeometry {
  /** Between the lane's bottom edge and the popover. */
  readonly gapPx: number;
  /** The least space kept between the popover and the view's edges. */
  readonly marginPx: number;
}

export const SHAPE_POPOVER: ShapePopoverGeometry = {
  gapPx: 6,
  marginPx: 8,
};

/** How the readout prints the range's length in bars and its cycles. */
export const SHAPE_READOUT_DECIMALS = 2;
