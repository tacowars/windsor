/**
 * What the master column's parts share (windsor#194): the song's output
 * stage settings, the live stage with its latest report and its watch
 * (`outputStageWatch.ts`), the one write every control makes, and a change
 * signal. A mode or ceiling edit, or a click that clears a latch, calls
 * `changed()`, and each part that draws from the settings or the latches
 * (the GR bar's name, the ceiling lines, the curve, the lamps, the bridge's
 * text) redraws at once rather than waiting for the next report.
 *
 * One link per Mixer render, so its listeners go with the render.
 */
import { masterOutput } from '@windsor/engine';
import type { OutputStage, OutputStageReport, OutputStageSettings } from '@windsor/engine';
import type { AppCtx } from './context';
import { outputEdit } from './outputStageModel';
import { type OutputStageWatch, meterRevision, watchOutputStage } from './outputStageWatch';

export interface OutputStageLink {
  /** The settings in force: the song's `master.output`, or the default. */
  settings(): OutputStageSettings;
  /** The live stage, or `null` before audio is on. */
  stage(): OutputStage | null;
  /** The stage's latest report, or `null` with no live stage. */
  report(): Readonly<OutputStageReport> | null;
  /** The stage's watch, or `null` with no live stage. */
  watch(): OutputStageWatch | null;
  /** The meter loop's key: the report revision (`meterRevision`). */
  revision(): number;
  /** One `ctx.change` with the whole `output` (`outputEdit`), then `changed()`. */
  write(edit: Partial<OutputStageSettings>): void;
  /** Follow edits and cleared latches. */
  onChange(listener: () => void): void;
  /** Tell every part the settings or the latches changed. */
  changed(): void;
}

export function createOutputStageLink(ctx: AppCtx): OutputStageLink {
  const listeners = new Set<() => void>();
  const stage = (): OutputStage | null => ctx.host.system?.engine.outputStage ?? null;
  const changed = (): void => listeners.forEach((listener) => listener());
  return {
    settings: () => masterOutput(ctx.model.doc.master),
    stage,
    report: () => stage()?.read() ?? null,
    watch: () => {
      const live = stage();
      return live ? watchOutputStage(live) : null;
    },
    revision: () => meterRevision(stage()),
    write: (edit) => {
      ctx.change(outputEdit(ctx.model.doc.master, edit));
      changed();
    },
    onChange: (listener) => void listeners.add(listener),
    changed,
  };
}
