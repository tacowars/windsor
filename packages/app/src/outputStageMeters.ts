/**
 * The output stage's meters on the master strip (windsor#94 decision 2):
 * input and output sample peaks for L and R, the gain-reduction gauge in
 * Limiter mode or the over-ceiling gauge in the clip modes, and the clip
 * light. The rules are `outputStageModel.ts`; this file draws them.
 *
 * It rides the console's one frame loop the way `compressorMeter.ts` does,
 * keyed on the stage's report `revision` (`meterRevision`) whatever the
 * transport is doing: the meters follow the audio, so a silent report is
 * what reads idle. The loop idles while the section is hidden. The clip
 * light reads the stage's watch (`outputStageWatch.ts`), which keeps the
 * latch across a re-render.
 */
import { masterOutput } from '@windsor/engine';
import type { OutputStage, OutputStageMode, OutputStageReport } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import {
  EMPTY_HOLD,
  type HeldPeak,
  type OutputMeterView,
  meterView,
  peakLabel,
  reportPeaks,
  stepHold,
} from './outputStageModel';
import {
  OUTPUT_GAUGE_MAX_DB,
  OUTPUT_PEAK_SCALE,
  OUTPUT_READOUT_HOLD_MS,
} from './outputStageTables';
import { meterRevision, watchOutputStage } from './outputStageWatch';
import { watchPlayhead } from './stepStrip';

export interface OutputStageMeters {
  readonly root: HTMLElement;
  /** Redraw at once, for a mode change before the next report lands. */
  refresh(): void;
  /** Clear the clip light (Reset peaks). */
  resetClip(): void;
}

const PEAK_ROWS = ['In L', 'In R', 'Out L', 'Out R'] as const;
const GAUGE_LABELS = { reduction: 'GR', over: 'Over', none: '' } as const;

function meterRow(
  label: string,
  min: number,
  max: number,
): { row: HTMLElement; meter: HTMLMeterElement; readout: HTMLElement } {
  const row = el('label', 'output-meter-row');
  const name = el('span', 'output-meter-name', label);
  const meter = document.createElement('meter');
  meter.min = min;
  meter.max = max;
  meter.value = min;
  const readout = el('span', 'readout');
  row.append(name, meter, readout);
  return { row, meter, readout };
}

type MeterRow = ReturnType<typeof meterRow>;
interface MeterBlock {
  root: HTMLElement;
  peaks: MeterRow[];
  gauge: MeterRow;
  offNote: HTMLElement;
  clip: HTMLElement;
}

function buildMeterBlock(): MeterBlock {
  const root = el('div', 'output-meters');
  const peaks = PEAK_ROWS.map((name) => {
    const row = meterRow(name, OUTPUT_PEAK_SCALE.floorDb, OUTPUT_PEAK_SCALE.ceilingDb);
    row.meter.high = 0;
    row.meter.setAttribute('aria-label', `Output stage ${name} sample peak`);
    root.appendChild(row.row);
    return row;
  });
  const gauge = meterRow('GR', 0, OUTPUT_GAUGE_MAX_DB);
  const offNote = el('p', 'hint output-off-note', 'Off: nothing limits or clips the output.');
  const clip = el('span', 'output-clip');
  clip.append(el('span', 'output-clip-dot'), el('span', '', 'Clip'));
  root.append(gauge.row, offNote, clip);
  return { root, peaks, gauge, offNote, clip };
}

/** The gauge row for the mode's gauge, or the Off note in its place. */
function paintGauge({ gauge, offNote }: MeterBlock, view: OutputMeterView): void {
  gauge.row.hidden = view.gauge === 'none';
  offNote.hidden = view.gauge !== 'none';
  gauge.row.firstChild!.textContent = GAUGE_LABELS[view.gauge];
  const name = view.gauge === 'over' ? 'Over the ceiling' : 'Gain reduction';
  gauge.meter.setAttribute('aria-label', name);
  gauge.meter.value = view.gaugeDb;
  gauge.readout.textContent = `${view.gaugeDb.toFixed(1)} dB`;
}

function paintClip({ clip }: MeterBlock, latched: boolean, mode: OutputStageMode): void {
  clip.classList.toggle('latched', latched);
  clip.title =
    mode === 'off'
      ? 'Latches on a sample above 0 dBFS; Reset peaks clears it'
      : 'Latches when the stage changes a sample; Reset peaks clears it';
}

export function outputStageMeters(ctx: AppCtx): OutputStageMeters {
  const block = buildMeterBlock();
  const stage = (): OutputStage | null => ctx.host.system?.engine.outputStage ?? null;
  let holds: HeldPeak[] = PEAK_ROWS.map(() => EMPTY_HOLD);
  let last: Readonly<OutputStageReport> | null = null;

  const paint = (report: Readonly<OutputStageReport> | null): void => {
    last = report;
    const mode = masterOutput(ctx.model.doc.master).mode;
    const view = meterView(report, mode);
    const now = performance.now();
    const linear = report ? reportPeaks(report) : null;
    holds = holds.map((hold, i) =>
      linear ? stepHold(hold, linear[i]!, now, OUTPUT_READOUT_HOLD_MS) : EMPTY_HOLD,
    );
    block.peaks.forEach(({ meter, readout }, i) => {
      meter.value = view.peaks[i]!;
      readout.textContent = peakLabel(holds[i]!.value);
    });
    paintGauge(block, view);
    const live = stage();
    paintClip(block, live ? watchOutputStage(live).latched : false, mode);
  };

  watchPlayhead({
    attached: () => block.root.isConnected,
    shown: () => block.root.closest('[hidden]') === null,
    playheadAt: () => meterRevision(stage()),
    mark: (revision) => paint(revision >= 0 ? (stage()?.read() ?? null) : null),
  });
  paint(null);
  return {
    root: block.root,
    refresh: () => paint(last),
    resetClip: () => {
      const live = stage();
      if (live) watchOutputStage(live).resetLatch();
      paint(last);
    },
  };
}
