/**
 * The Drum device's step strip without the DOM (windsor#951; the approved
 * mockup `docs/design/drum-device-mockup.html`, record
 * `2026-10-24-drum-device`): what a click on a hit cell, a drag on a Vel
 * bar, A and the ratchet do to a step; what Length, Rotate, Reverse and
 * Randomize do to the line and its lanes; and the pattern the picker shows
 * and writes. Every function returns new values for one `ctx.change`, where
 * arrays replace wholesale. A hit's velocity of 1 and ratchet of 1 leave no
 * key, as the engine's normaliser writes a step.
 *
 * The bank is the engine's (`DRUM_PATTERNS`, `applyDrumPattern`,
 * `drumPatternOf`); nothing here restates a pattern or the match rule.
 */
import type { DrumHitStep, DrumSpec, DrumStep, StepModLane } from '@windsor/engine';
import {
  DRUM_PATTERNS,
  GRID_STEPS_MAX,
  RATCHET_MAX,
  applyDrumPattern,
  drumHit,
  drumPatternOf,
} from '@windsor/engine';
import type { Mutable } from './drumModel';
import { DRUM_GHOST_BELOW, DRUM_RANDOM, type DrumRandomTable } from './drumTables';
import { snapVelocity } from './figureModel';
import { type Draw, reverseLanes, reverseSteps, rotateLanes, rotateSteps } from './gridModel';
import { nextRatchet } from './ratchetModel';
import { lanesForSteps } from './stepModLaneModel';

/** The line the strip's edits read: its loop, its steps and their lanes. */
export type DrumLine = Pick<DrumSpec, 'length' | 'steps' | 'lanes'>;

/** The steps and lanes a line edit writes. */
export type DrumLineChange = {
  readonly steps: DrumStep[];
  readonly lanes: StepModLane[];
};

const REST: DrumStep = { kind: 'rest' };

/** A hit's velocity, absent 1; a rest reads 0. */
export const hitVelocity = (step: DrumStep): number =>
  step.kind === 'hit' ? (step.velocity ?? 1) : 0;

/** Decision 3: a hit under `below` is a ghost, its dot dimmed. */
export const isGhost = (step: DrumStep, below = DRUM_GHOST_BELOW): boolean =>
  step.kind === 'hit' && hitVelocity(step) < below;

/** A hit's roll, absent one; a rest reads one. */
export const hitRatchet = (step: DrumStep): number =>
  step.kind === 'hit' ? (step.ratchet ?? 1) : 1;

/** The hit cell's click: a hit becomes a rest, a rest a plain hit at velocity 1. */
export const toggleHit = (step: DrumStep): DrumStep => (step.kind === 'hit' ? REST : drumHit());

/** A hit with `key` set to `value`, or dropped at its `plain` default. */
function withKey<K extends 'velocity' | 'ratchet'>(
  step: DrumHitStep,
  key: K,
  value: number,
  plain: number,
): DrumHitStep {
  const next: Mutable<DrumHitStep> = { ...step };
  if (value === plain) delete next[key];
  else next[key] = value;
  return next;
}

/** The hit at velocity `velocity`, snapped to the Vel bar's 0.05 (`snapVelocity`); a rest as it is. */
export const setHitVelocity = (step: DrumStep, velocity: number): DrumStep =>
  step.kind === 'hit' ? withKey(step, 'velocity', snapVelocity(velocity), 1) : step;

/** A: the hit's accent toggled; a rest as it is. */
export const toggleHitAccent = (step: DrumStep): DrumStep =>
  step.kind === 'hit' ? { ...step, accent: !step.accent } : step;

/** The ratchet cell's click: ×1 → ×2 → ×3 → ×4 → ×1; a rest as it is. */
export const cycleHitRatchet = (step: DrumStep, max = RATCHET_MAX): DrumStep =>
  step.kind === 'hit' ? withKey(step, 'ratchet', nextRatchet(hitRatchet(step), max), 1) : step;

/** The list with step `index` replaced. */
export const withDrumStep = (
  steps: readonly DrumStep[],
  index: number,
  step: DrumStep,
): DrumStep[] => steps.map((s, i) => (i === index ? step : s));

/**
 * Length (the Grid's): the loop at `length`, 1 to `GRID_STEPS_MAX`; the
 * list grown with rests when the loop runs past it, never shortened (the
 * steps past the loop stay, greyed), the lanes padded to match. Null when
 * the loop is already there.
 */
export function drumLengthChange(
  line: DrumLine,
  length: number,
): (DrumLineChange & { length: number }) | null {
  const target = Math.max(1, Math.min(GRID_STEPS_MAX, Math.round(length)));
  if (target === line.length) return null;
  const grown = Math.max(0, target - line.steps.length);
  const steps = [...line.steps, ...Array.from({ length: grown }, () => REST)];
  return { length: target, steps, lanes: lanesForSteps(line.lanes, steps.length) };
}

/** The Rotate knob after a move: its new value, and the write the move makes (null when nothing turns). */
export interface DrumTurn {
  readonly turned: number;
  readonly change: DrumLineChange | null;
}

/**
 * Rotate (the Grid's `turnGrid`): the move from `turned` to `target`
 * turns the loop's steps and their lane values by the difference, the
 * steps past the loop left where they are, so the document holds no offset.
 */
export function turnDrum(line: DrumLine, turned: number, target: number): DrumTurn {
  const to = Math.round(target);
  const by = to - turned;
  if (by === 0) return { turned: to, change: null };
  return {
    turned: to,
    change: {
      steps: rotateSteps(line.steps, by, line.length),
      lanes: rotateLanes(line.lanes, by, line.length),
    },
  };
}

/** Reverse (the Grid's): the loop's steps and their lane values mirrored, each hit whole. */
export const reverseDrum = (line: DrumLine): DrumLineChange => ({
  steps: reverseSteps(line.steps, line.length),
  lanes: reverseLanes(line.lanes, line.length),
});

/** A new hit's velocity from one draw: `velocityMin` to 1 in `velocityStep`s, each as likely. */
function randomVelocity(draw: Draw, table: DrumRandomTable): number {
  const levels = Math.round((1 - table.velocityMin) / table.velocityStep) + 1;
  const level = Math.min(levels - 1, Math.floor(draw() * levels));
  return snapVelocity(table.velocityMin + level * table.velocityStep);
}

/**
 * Randomize (decision 4): as many hits as the loop holds now, at least
 * one, at new places in the loop, each a plain hit (no accent, pitch or
 * ratchet) at a velocity from `velocityMin` to 1. The places are a partial
 * shuffle of the loop's indices, one draw per hit, then one draw per hit's
 * velocity in the order placed, so a test can script them. The steps past
 * the loop and the lanes are kept.
 */
export function randomDrumSteps(
  steps: readonly DrumStep[],
  length: number,
  draw: Draw,
  table: DrumRandomTable = DRUM_RANDOM,
): DrumStep[] {
  const n = Math.max(1, Math.min(Math.trunc(length), steps.length));
  const hits = steps.slice(0, n).filter((s) => s.kind === 'hit').length;
  const want = Math.max(1, hits);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < want; k++) {
    const pick = k + Math.min(n - k - 1, Math.floor(draw() * (n - k)));
    [order[k], order[pick]] = [order[pick]!, order[k]!];
  }
  const out = [...Array.from({ length: n }, () => REST), ...steps.slice(n)];
  for (const at of order.slice(0, want)) {
    const velocity = randomVelocity(draw, table);
    out[at] = drumHit(velocity < 1 ? { velocity } : {});
  }
  return out;
}

/** What the picker shows (decision 2): the bank pattern the line still is, or '' for Custom. */
export const shownPattern = (line: Pick<DrumSpec, 'steps' | 'length'>): string =>
  drumPatternOf(line.steps, line.length) ?? '';

/**
 * A pick: the pattern's steps and its length (`applyDrumPattern`), the
 * lanes fitted to the new steps, as one write. Null for Custom or an id
 * the bank lacks, which writes nothing.
 */
export function drumPatternChange(
  line: DrumLine,
  id: string,
): (DrumLineChange & { length: number }) | null {
  if (!DRUM_PATTERNS.some((p) => p.id === id)) return null;
  const applied = applyDrumPattern(line, id);
  const steps = [...applied.steps];
  return { steps, length: applied.length, lanes: lanesForSteps(line.lanes, steps.length) };
}
