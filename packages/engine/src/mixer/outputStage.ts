/**
 * The output stage's main-thread half (windsor#93): the worklet node the
 * engine puts between its master and the destination, its settings, its
 * latency and its telemetry.
 *
 * The settings are the processor's k-rate parameters, set by value: a change
 * reaches the audio thread on the next block with no graph rebuilt, and a
 * value set before an offline render starts holds from its first frame. The
 * processor reports whenever the context runs (decision 10); `read()` is the
 * latest report and `revision` counts them, as `PeakMeter` does, and
 * `subscribe` hands each one on as it lands. `outputStage.test.ts` pins it.
 */
import { OUTPUT_STAGE_MODES, OUTPUT_STAGE_NAME, silentReport } from './outputStageConstants';
import type { OutputStageReport } from './outputStageConstants';
import { outputStageLatency } from './outputStageDsp';
import type { OutputStageSettings } from './outputStageSpec';
import { DEFAULT_OUTPUT_STAGE } from './outputStageSpec';

/** The generated processor: the bundle `scripts/build-worklets.mjs` writes from `worklet/outputStage/`. */
export const OUTPUT_STAGE_WORKLET_URL = new URL(
  '../worklet/generated/output-stage-processor.js',
  import.meta.url,
);

export interface OutputStage {
  /** Where the stage's input is: the engine's master connects here. */
  readonly node: AudioNode;
  readonly settings: OutputStageSettings;
  /** The frames the output lags the input by, for the current settings (decision 9). */
  readonly latencyFrames: number;
  /** Bumped by every report. */
  readonly revision: number;
  /** The latest report; silence until the first one. */
  read(): Readonly<OutputStageReport>;
  /** Each report as it lands; the return unsubscribes. */
  subscribe(listener: (report: Readonly<OutputStageReport>) => void): () => void;
  /** Change the mode, ceiling or lookahead in place. Normalised settings only. */
  set(settings: OutputStageSettings): void;
  dispose(): void;
}

export function createOutputStage(
  context: BaseAudioContext,
  initial: OutputStageSettings = DEFAULT_OUTPUT_STAGE,
): OutputStage {
  const node = new AudioWorkletNode(context, OUTPUT_STAGE_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: paramValues(initial),
  });
  let settings = initial;
  let report: OutputStageReport = silentReport();
  let revision = 0;
  const listeners = new Set<(report: Readonly<OutputStageReport>) => void>();
  node.port.onmessage = ({ data }: MessageEvent<OutputStageReport>): void => {
    if (data?.type !== 'outputStage') return;
    report = data;
    revision++;
    for (const listener of listeners) listener(report);
  };
  const param = (name: string): AudioParam | undefined => node.parameters.get(name);
  return {
    node,
    get settings(): OutputStageSettings {
      return settings;
    },
    get latencyFrames(): number {
      return outputStageLatency(settings, context.sampleRate);
    },
    get revision(): number {
      return revision;
    },
    read: () => report,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next): void {
      settings = next;
      for (const [name, value] of Object.entries(paramValues(next))) {
        const target = param(name);
        if (target) target.value = value;
      }
    },
    dispose(): void {
      listeners.clear();
      node.port.postMessage({ type: 'stop' });
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
    },
  };
}

/** The processor's parameter values for `settings`. */
export function paramValues(settings: OutputStageSettings): Record<string, number> {
  return {
    mode: OUTPUT_STAGE_MODES.indexOf(settings.mode),
    ceilingDb: settings.ceilingDb,
    lookahead: settings.lookahead ? 1 : 0,
  };
}
