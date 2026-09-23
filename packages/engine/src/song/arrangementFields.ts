/**
 * The field-level normalising vocabulary behind `makeArrangement` — the
 * `num(raw.volume, 0.8)` clamping idiom of `fm-processor.js` and
 * `makeSpace(Partial<ReverbSpace>)` (`reverbSpace.ts:129`), extended with the
 * report the document layer returns: every clamp, junk replacement and
 * dropped key lands in `corrections`; names the code does not define land in
 * `dangling`, because clamping cannot fix a dangling name (record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §5). An absent
 * optional field takes its default silently — only what was *present and
 * wrong* is a correction.
 *
 * `ArrangementNormaliser` (`arrangementNormalise.ts`) builds the document
 * sections on top of this vocabulary.
 */
import { MIDI_NOTE_MAX } from '../audioConstants';
import { isBarDivisor, TICKS_PER_BAR } from '../sequencing/scheduler';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Format a value for a correction message. Guarded: `JSON.stringify` throws
 * on BigInt and cyclic values, and this layer must never throw. */
export const show = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** One normalisation pass: the field helpers plus the accumulated report. */
export class FieldNormaliser {
  readonly corrections: string[] = [];
  readonly dangling: string[] = [];

  correction(message: string): void {
    this.corrections.push(message);
  }

  /** `raw` as an object section, or `{}` (with a correction when it was junk). */
  section(raw: unknown, path: string): Record<string, unknown> {
    if (isRecord(raw)) return raw;
    if (raw !== undefined)
      this.correction(`${path}: ${show(raw)} is not an object — using defaults`);
    return {};
  }

  /** Report every key `known` does not name; the caller simply never reads them. */
  dropUnknown(raw: Record<string, unknown>, known: readonly string[], path: string): void {
    for (const key of Object.keys(raw)) {
      if (!known.includes(key)) {
        this.correction(`${path === '' ? key : `${path}.${key}`}: unknown key dropped`);
      }
    }
  }

  /** A boolean; `fallback` when absent or junk (a string is junk: 'false' would read as true). */
  bool(raw: unknown, fallback: boolean, path: string): boolean {
    if (typeof raw === 'boolean') return raw;
    if (raw !== undefined) {
      this.correction(`${path}: ${show(raw)} is not a boolean — using ${fallback}`);
    }
    return fallback;
  }

  /** A finite number clamped into [min, max]; `fallback` when absent or junk. */
  num(raw: unknown, fallback: number, min: number, max: number, path: string): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      if (raw !== undefined) {
        this.correction(`${path}: ${show(raw)} is not a number — using ${fallback}`);
      }
      return fallback;
    }
    const clamped = Math.min(max, Math.max(min, raw));
    if (clamped !== raw) this.correction(`${path}: clamped ${raw} to ${clamped}`);
    return clamped;
  }

  int(raw: unknown, fallback: number, min: number, max: number, path: string): number {
    const value = this.num(raw, fallback, min, max, path);
    const rounded = Math.round(value);
    if (rounded !== value) this.correction(`${path}: rounded ${value} to ${rounded}`);
    return rounded;
  }

  pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T, path: string): T {
    if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) return raw as T;
    if (raw !== undefined) {
      this.correction(
        `${path}: ${show(raw)} is not one of ${allowed.join('|')} — using ${fallback}`,
      );
    }
    return fallback;
  }

  /** A step divisor: a positive integer that divides the 96-tick bar. */
  divisor(raw: unknown, fallback: number, path: string): number {
    const value = this.int(raw, fallback, 1, TICKS_PER_BAR, path);
    if (isBarDivisor(value)) return value;
    this.correction(
      `${path}: ${value} does not divide the ${TICKS_PER_BAR}-tick bar — using ${fallback}`,
    );
    return fallback;
  }

  /**
   * A captured percussion figure (issue #70, record §6): one boolean per step
   * (0/1 accepted), resized to the figure's `steps`. `null` — the default —
   * is generative; a captured pattern is a literal array in the document.
   */
  stepPattern(raw: unknown, steps: number, path: string): readonly boolean[] | null {
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw) || raw.length === 0) {
      this.correction(`${path}: ${show(raw)} is not a captured figure — staying generative`);
      return null;
    }
    const out: boolean[] = [];
    for (let i = 0; i < steps; i++) {
      const v: unknown = raw[i];
      if (typeof v === 'boolean') out.push(v);
      else if (v === 0 || v === 1) out.push(v === 1);
      else {
        if (i < raw.length) {
          this.correction(`${path}[${i}]: ${show(v)} is not a step — using a rest`);
        }
        out.push(false);
      }
    }
    if (raw.length !== steps) {
      this.correction(`${path}: ${raw.length} steps for a ${steps}-step figure — resized`);
    }
    return out;
  }

  /**
   * A captured pitched bar (issue #70, record §6): a MIDI note or `null` (a
   * rest) per step, looped by the generator. `null` for the whole field is
   * generative.
   */
  notePattern(raw: unknown, path: string): readonly (number | null)[] | null {
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw) || raw.length === 0) {
      this.correction(`${path}: ${show(raw)} is not a captured bar — staying generative`);
      return null;
    }
    const capped = raw.length > MAX_PATTERN_STEPS ? raw.slice(0, MAX_PATTERN_STEPS) : raw;
    if (capped.length !== raw.length) {
      this.correction(`${path}: ${raw.length} steps capped to ${MAX_PATTERN_STEPS}`);
    }
    return capped.map((v: unknown, i) => {
      if (v === null) return null;
      if (typeof v === 'number' && Number.isFinite(v)) {
        return this.int(v, 0, 0, MIDI_NOTE_MAX, `${path}[${i}]`);
      }
      this.correction(`${path}[${i}]: ${show(v)} is not a note — using a rest`);
      return null;
    });
  }
}

/** A pitched bar is at most 96 steps (divisor 1); anything longer is junk. */
const MAX_PATTERN_STEPS = 96;
