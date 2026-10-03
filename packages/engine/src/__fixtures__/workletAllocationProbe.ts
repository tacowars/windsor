/**
 * The child process of the worklet allocation tests (windsor#198,
 * windsor#214): it runs one shipped worklet bundle in a Node of its own, where
 * the test can set V8's flags (`--expose-gc`, the young generation's size,
 * sweeping on the main thread, `--trace-generalization`), and reports how
 * many bytes the heap grew over a measured run of render quanta, after a
 * warm-up of every path the run takes.
 * Node runs it directly (its types are stripped), so it imports nothing but
 * Node's own modules; the test passes the config as one JSON argument, and a
 * file path the probe writes its result to as JSON. The result has a file of
 * its own because stdout carries V8's trace, and on Linux the trace has run
 * into it on one line.
 *
 * The bundle is compiled as a script named after its file (`eq-processor.js`),
 * so each line V8 traces from it names that file and the line in it. Every
 * parameter the processor declares is fed its default unless the config names
 * a value. `currentFrame` advances a quantum at a time, as the real scope's
 * does, for the processors that read it (the FM part's event queue). It is
 * held in a `Float64Array` slot, the bundle's reads of the name rewritten to
 * read the slot: a frame past 2^31 is a double, and storing one in a `let`
 * would box it every quantum, which is the probe's cost, not the processor's
 * (in Chrome the scope's own accessor supplies it).
 *
 * What the run does is the scenario's: by default a steady render of a noise
 * input (or of no input, for a source), with the load meter reporting every
 * `loadQuanta` quanta or off. A config naming a `scenario` module drives the
 * processor through that module's default export instead (the EQ's toggling,
 * `eqToggleScenario.ts`).
 */
// reads-by-path: packages/engine/src/worklet/generated/**, packages/engine/src/__fixtures__/**
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';

export interface ProbeConfig {
  bundle: string;
  rate: number;
  /** Parameter values by name; a parameter this omits takes its descriptor's default. */
  params: Record<string, number>;
  /** The constructor's `processorOptions` (the FM part's patch and seed). */
  options: unknown;
  /** Messages the port receives before the first quantum (the FM part's note-ons). */
  messages: unknown[];
  /** Channels of the processor's one input; 0 feeds it no input, as a source has. */
  inputChannels: number;
  /** The load meter's cadence in quanta during the measured run; 0 is the meter off. */
  loadQuanta: number;
  /** Quanta of warm-up, then of the measured run. */
  warmup: number;
  /**
   * `currentFrame` at quantum 0; omitted, 0. Past 2^31 every frame is a
   * double in V8, as in a context that has run for about 12 hours at 48 kHz.
   */
  startFrame?: number;
  measure: number;
  /** A module whose default export builds the run (`ProbeScenario`); omitted, a steady render. */
  scenario?: string;
  /** What that module reads. */
  scenarioConfig?: unknown;
}

export interface ProbeResult {
  bytes: number;
  /** The growth in each tenth of the measured run. */
  windows: number[];
  /** Collections during the measured run: any, and the reading means nothing. */
  gcs: number;
}

export interface ProbeProcessor {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: object): boolean;
}

/** What a scenario drives: the processor, its parameter arrays and the quantum's buffers. */
export interface ProbeRig {
  config: ProbeConfig;
  processor: ProbeProcessor;
  params: Record<string, Float32Array>;
  /** The processor's input: noise on every channel, or none. */
  sound: Float32Array[][];
  /** The same input silent. */
  quiet: Float32Array[][];
  /** Quantum `q`, from `inputs`. */
  render(q: number, inputs: Float32Array[][]): void;
  /** A `reportLoad` message: the meter on at this cadence, or off at 0. */
  report(quanta: number): void;
}

/** A run: everything before the measurement, then quanta [from, to) of it. */
export interface ProbeScenario {
  warm(): void;
  drive(from: number, to: number): void;
}

const QUANTUM = 128;
/** The measured run is read in this many windows, to show where any growth falls. */
const WINDOWS = 10;
/** Steady quanta run in chunks this long, so the loop that runs them is optimised whole. */
const CHUNK = 128;
/** The warm-up's load meter cadence. */
const WARM_LOAD_QUANTA = 64;

interface Descriptor {
  name: string;
  defaultValue?: number;
}
interface ProcessorClass {
  new (options: object): ProbeProcessor;
  parameterDescriptors?: Descriptor[];
}

/** The bundle evaluated as a script named `filename`: its processor class and the slot it reads `currentFrame` from. */
function load(
  config: ProbeConfig,
  filename: string,
): { ctor: ProcessorClass; frame: Float64Array } {
  const bundle = readFileSync(config.bundle, 'utf8').replace(
    /\bcurrentFrame\b/g,
    'currentFrame[0]',
  );
  const source = `(function (AudioWorkletProcessor, sampleRate, registerProcessor, currentFrame) {\n${bundle}\n})`;
  const frame = new Float64Array(1);
  let ctor: ProcessorClass | undefined;
  class Base {
    port = { onmessage: null, postMessage(): void {} };
  }
  vm.runInThisContext(source, { filename })(
    Base,
    config.rate,
    (_name: string, value: ProcessorClass) => {
      ctor = value;
    },
    frame,
  );
  return { ctor: ctor!, frame };
}

/**
 * Every parameter's value: its descriptor's default, or the config's. The
 * descriptors come from a second copy of the bundle under another name: the
 * scope builds them once, at registration, and the objects that builds are
 * no field of the running processor, so their generalisations stay out of
 * the trace the test reads.
 */
function parameterValues(config: ProbeConfig): Record<string, number> {
  const values: Record<string, number> = {};
  const { ctor } = load(config, `descriptors-${basename(config.bundle)}`);
  for (const d of ctor.parameterDescriptors ?? []) values[d.name] = d.defaultValue ?? 0;
  return Object.assign(values, config.params);
}

function noise(channels: number): Float32Array[] {
  let s = 1;
  return Array.from({ length: channels }, () => {
    const channel = new Float32Array(QUANTUM);
    for (let i = 0; i < QUANTUM; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      channel[i] = s / 2 ** 32 - 0.5;
    }
    return channel;
  });
}

function rig(config: ProbeConfig): ProbeRig {
  const values = parameterValues(config);
  const { ctor, frame } = load(config, basename(config.bundle));
  const startFrame = config.startFrame ?? 0;
  const params: Record<string, Float32Array> = {};
  for (const [name, value] of Object.entries(values)) params[name] = new Float32Array([value]);
  const processor = new ctor({ processorOptions: config.options, parameterData: values });
  for (const data of config.messages) processor.port.onmessage?.({ data });
  const inputs = config.inputChannels > 0;
  const silence = new Float32Array(QUANTUM);
  const sound = inputs ? [noise(config.inputChannels)] : [];
  const quiet = inputs ? [Array.from({ length: config.inputChannels }, () => silence)] : [];
  const outputs = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
  return {
    config,
    processor,
    params,
    sound,
    quiet,
    render: (q, from) => {
      frame[0] = startFrame + q * QUANTUM;
      processor.process(from, outputs, params);
    },
    report: (quanta) => processor.port.onmessage!({ data: { type: 'reportLoad', quanta } }),
  };
}

/**
 * The default run: the meter on for the first half of the warm-up, so its
 * path is hot, then at the measured cadence for the second, and noise in.
 */
function steady(probe: ProbeRig): ProbeScenario {
  const { config, sound } = probe;
  const drive = (from: number, to: number): void => {
    for (let q = from; q < to; q++) probe.render(q, sound);
  };
  const chunks = (from: number, to: number): void => {
    for (let q = from; q < to; q += CHUNK) drive(q, Math.min(to, q + CHUNK));
  };
  return {
    warm: () => {
      probe.report(WARM_LOAD_QUANTA);
      chunks(0, config.warmup / 2);
      probe.report(config.loadQuanta);
      chunks(config.warmup / 2, config.warmup);
    },
    drive: chunks,
  };
}

async function run(config: ProbeConfig): Promise<ProbeResult> {
  const probe = rig(config);
  const scenario = config.scenario
    ? (
        (await import(pathToFileURL(config.scenario).href)) as {
          default: (rig: ProbeRig) => ProbeScenario;
        }
      ).default(probe)
    : steady(probe);
  scenario.warm();
  // The measured run: the heap read after forced collections and at the end.
  // The child sweeps on the main thread (`--no-concurrent-sweeping`, set by
  // `workletAllocation.ts`), so no background sweeper is still settling what
  // the collections freed while the first window is read (windsor#269).
  const gcs = new v8.GCProfiler();
  const gc = (globalThis as { gc?: () => void }).gc!;
  gc();
  gc();
  gcs.start();
  // Measured: the first reading after a collection comes out about 18 KB above
  // one taken straight after it, with nothing run between, so it is dropped.
  // Each later reading makes its own result object, about 600 bytes.
  v8.getHeapStatistics();
  const marks = new Float64Array(WINDOWS + 1);
  const span = config.measure / WINDOWS;
  const start = config.warmup;
  marks[0] = v8.getHeapStatistics().used_heap_size;
  for (let w = 0; w < WINDOWS; w++) {
    scenario.drive(start + w * span, start + (w + 1) * span);
    marks[w + 1] = v8.getHeapStatistics().used_heap_size;
  }
  const windows = Array.from({ length: WINDOWS }, (_, w) => marks[w + 1]! - marks[w]!);
  return { bytes: marks[WINDOWS]! - marks[0]!, windows, gcs: gcs.stop()!.statistics.length };
}

// Run only as the child; the tests import this module for its types.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(process.argv[2]!) as ProbeConfig;
  writeFileSync(process.argv[3]!, JSON.stringify(await run(config)));
}
