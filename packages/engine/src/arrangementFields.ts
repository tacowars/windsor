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
import { isBarDivisor, TICKS_PER_BAR } from './scheduler';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const show = (value: unknown): string => JSON.stringify(value) ?? String(value);

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
}
