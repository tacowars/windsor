/**
 * The output stage's meters in the master column (windsor#194 decisions 2 to
 * 4; record `2026-09-30-master-column-and-meters`, decisions 3 to 5): In L
 * and R with their clip LEDs from the stage's input, one dBFS scale, Out L
 * and R with the ceiling line from its output, and the GR bar, which reads
 * Over in the clip modes and dims as Off in Off (`meterView`). They are the
 * Mixer's one set of meters; the master strip's own tap is no longer read.
 *
 * Built from windsor#193's parts (`meterBar.ts`) and painted by the meter
 * loop: `paint` reads the stage's latest report once and hands each bar its
 * peak. A readout click resets that bar's hold, and an LED click clears that
 * channel's input latch on the stage's watch, and nothing else. A mode or
 * ceiling edit renames the gauge and moves the ceiling lines at once,
 * through the link.
 */
import {
  type PeakBar,
  type ReductionBar,
  createPeakBar,
  createPeakScale,
  createReductionBar,
} from './meterBar';
import { amplitudeToDb } from './meterModel';
import { gaugeFor, meterView, reportPeaks } from './outputStageModel';
import type { OutputStageLink } from './outputStageLink';
import type { InputChannel } from './outputStageWatch';

export interface StageMeters {
  readonly inputs: readonly [PeakBar, PeakBar];
  readonly scale: HTMLElement;
  readonly outputs: readonly [PeakBar, PeakBar];
  readonly reduction: ReductionBar;
  /** Draw the latest report at frame time `nowMs`. */
  paint(nowMs: number): void;
  /** Back to the floor, nothing held. */
  reset(): void;
}

const CHANNELS: readonly InputChannel[] = ['left', 'right'];
const NAMES = { left: 'L', right: 'R' } as const;
const SILENCE = [0, 0, 0, 0] as const;

/** Every bar to the given height and channel width. */
export function createStageMeters(
  link: OutputStageLink,
  size: { heightPx: number; channelPx: number },
): StageMeters {
  const input = (channel: InputChannel): PeakBar =>
    createPeakBar({
      ...size,
      name: NAMES[channel],
      label: `Output stage input, ${channel}`,
      clipLed: { onClear: () => link.watch()?.clearInputOver(channel) },
    });
  const output = (channel: InputChannel): PeakBar =>
    createPeakBar({
      ...size,
      name: NAMES[channel],
      label: `Output stage output, ${channel}`,
      ceilingLine: true,
    });
  const inputs = [input('left'), input('right')] as const;
  const outputs = [output('left'), output('right')] as const;
  const reduction = createReductionBar({ ...size, label: 'Output stage gain reduction' });
  const scale = createPeakScale({ label: 'dBFS scale', heightPx: size.heightPx });
  const bars = [...inputs, ...outputs];

  const paintLatches = (): void => {
    const watch = link.watch();
    CHANNELS.forEach((channel, i) => inputs[i]!.setClip(watch?.inputOver(channel) ?? false));
  };
  const paintSettings = (): void => {
    const { mode, ceilingDb } = link.settings();
    // In Off nothing holds the output at the ceiling: the line hides (`.is-off`)
    // and the readouts redden above 0 dBFS.
    for (const bar of outputs) bar.setCeiling(mode === 'off' ? 0 : ceilingDb);
    reduction.setGauge(gaugeFor(mode));
    paintLatches();
  };
  link.onChange(paintSettings);
  paintSettings();

  return {
    inputs,
    scale,
    outputs,
    reduction,
    paint(nowMs) {
      const report = link.report();
      const peaks = report ? reportPeaks(report) : SILENCE;
      bars.forEach((bar, i) => bar.update(amplitudeToDb(peaks[i]!), nowMs));
      reduction.update(meterView(report, link.settings().mode).gaugeDb, nowMs);
      paintLatches();
    },
    reset() {
      for (const bar of bars) bar.reset();
      reduction.reset();
    },
  };
}
