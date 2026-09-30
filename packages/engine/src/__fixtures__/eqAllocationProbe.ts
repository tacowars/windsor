/**
 * The child process of `inserts/eqAllocation.test.ts` (windsor#198): it runs
 * the shipped Parametric EQ bundle in a Node of its own, where the test can
 * set V8's flags (`--expose-gc`, the young generation's size,
 * `--trace-generalization`), and reports how many bytes the heap grew while
 * type, slope and on toggled on every band, after a warm-up of every path. Node runs it directly (its types
 * are stripped), so it imports nothing but Node's own modules; the test passes
 * the parameter names and values as one JSON argument.
 *
 * The bundle is compiled as a script named `eq-processor.js`, so each line V8
 * traces from it names that file and the line in it. The parameter names come
 * keyed by their `EQ_BAND_PARAMS` field (`Freq` … `On`), so no object here
 * shares its keys, and so its hidden class, with one of the bundle's.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';

export type ProbeField = 'Freq' | 'Gain' | 'Q' | 'Type' | 'Slope' | 'On';

export interface ProbeConfig {
  bundle: string;
  rate: number;
  /** Every parameter's starting value, by name. */
  params: Record<string, number>;
  /** Each field's parameter names, band by band. */
  names: Record<ProbeField, string[]>;
  typeCount: number;
  slopeCount: number;
  /** Quanta of warm-up (every path the audio thread has), then of measured toggling. */
  warmup: number;
  measure: number;
  /** Quanta between toggles: long enough for a fade out and back in. */
  period: number;
}

export const PROBE_SCRIPT_NAME = 'eq-processor.js';
export const PROBE_RESULT = 'EQ_ALLOCATION ';
const QUANTUM = 128;
/** The measured run is read in this many windows, to show where any growth falls. */
const WINDOWS = 10;

interface Processor {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: object): boolean;
}

function load(config: ProbeConfig): Processor {
  const source = `(function (AudioWorkletProcessor, sampleRate, registerProcessor) {\n${readFileSync(config.bundle, 'utf8')}\n})`;
  let ctor: (new () => Processor) | undefined;
  class Base {
    port = { onmessage: null, postMessage(): void {} };
  }
  vm.runInThisContext(source, { filename: PROBE_SCRIPT_NAME })(
    Base,
    config.rate,
    (_name: string, value: new () => Processor) => {
      ctor = value;
    },
  );
  return new ctor!();
}

/** One Float32Array per parameter, and each band's arrays in a fixed order. */
function arrays(config: ProbeConfig): {
  params: Record<string, Float32Array>;
  band: (field: ProbeField) => Float32Array[];
} {
  const params: Record<string, Float32Array> = {};
  for (const [name, value] of Object.entries(config.params))
    params[name] = new Float32Array([value]);
  const band = (field: ProbeField): Float32Array[] =>
    config.names[field].map((name) => params[name]!);
  return { params, band };
}

function noise(): [Float32Array, Float32Array] {
  const left = new Float32Array(QUANTUM);
  const right = new Float32Array(QUANTUM);
  let s = 1;
  for (let i = 0; i < QUANTUM; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    left[i] = s / 2 ** 32 - 0.5;
    right[i] = -left[i]!;
  }
  return [left, right];
}

// eslint-disable-next-line max-lines-per-function -- one scenario, read top to bottom: the rig, the warm-up's phases, the measured run
function run(config: ProbeConfig): { bytes: number; windows: number[]; gcs: number } {
  const processor = load(config);
  const { params, band } = arrays(config);
  const [types, slopes, ons] = [band('Type'), band('Slope'), band('On')];
  const [freqs, gains, qs] = [band('Freq'), band('Gain'), band('Q')];
  const [left, right] = noise();
  const silence = new Float32Array(QUANTUM);
  const sound: Float32Array[][] = [[left, right]];
  const quiet: Float32Array[][] = [[silence, silence]];
  const outputs: Float32Array[][] = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
  const count = types.length;
  // Type, slope and on in turn, for every band at once (preallocated: nothing here allocates).
  const toggle = (q: number): void => {
    if (q % config.period !== 0) return;
    const kind = (q / config.period) % 3;
    for (let b = 0; b < count; b++) {
      if (kind === 0) types[b]![0] = (types[b]![0]! + 1) % config.typeCount;
      else if (kind === 1) slopes[b]![0] = (slopes[b]![0]! + 1) % config.slopeCount;
      else ons[b]![0] = 1 - ons[b]![0]!;
    }
  };
  const glide = (q: number): void => {
    if (q % config.period !== 0) return;
    const step = (q / config.period) % 2 === 0 ? 1.5 : 1 / 1.5;
    for (let b = 0; b < count; b++) {
      freqs[b]![0] = freqs[b]![0]! * step;
      qs[b]![0] = qs[b]![0]! * step;
      gains[b]![0] = -gains[b]![0]!;
    }
  };
  // Every other change the warm-up makes: the output and the enable, and silence now and then.
  const vary = (q: number): Float32Array[][] => {
    if (q % (config.period * 16) === 0) {
      params.output![0] = params.output![0] === 0 ? 3.5 : 0;
      params.enabled![0] = q % (config.period * 32) === 0 ? 0 : 1;
    }
    return q % 97 < 8 ? quiet : sound;
  };
  // Quanta [from, to): the warm-up's glides and changes, or toggling alone. The
  // measured run calls this same function, so it measures code already hot.
  const drive = (from: number, to: number, warm: boolean): void => {
    for (let q = from; q < to; q++) {
      if (warm) glide(q);
      else toggle(q);
      processor.process(warm ? vary(q) : sound, outputs, params);
    }
  };
  // A load report reads Date.now() twice a quantum, and V8 returns each as a
  // new heap number: the warm-up runs it, and turns it off before the reading.
  const report = (quanta: number): void =>
    processor.port.onmessage!({ data: { type: 'reportLoad', quanta } });
  report(64);
  drive(0, config.warmup / 4, true);
  report(0);
  params.enabled![0] = 1;
  params.output![0] = 0;
  // Toggling in short runs, so `drive` itself is optimised whole and not only
  // mid-loop (on-stack replacement), as the measured run calls it.
  const chunk = config.period * 16;
  for (let q = config.warmup / 4; q < config.warmup; q += chunk) drive(q, q + chunk, false);
  // The measured run: toggling only, the heap read after forced collections and at the end.
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
  marks[0] = v8.getHeapStatistics().used_heap_size;
  for (let w = 0; w < WINDOWS; w++) {
    drive(w * span, (w + 1) * span, false);
    marks[w + 1] = v8.getHeapStatistics().used_heap_size;
  }
  const windows = Array.from({ length: WINDOWS }, (_, w) => marks[w + 1]! - marks[w]!);
  return { bytes: marks[WINDOWS]! - marks[0]!, windows, gcs: gcs.stop()!.statistics.length };
}

// Run only as the child; the test imports this module for its types and names.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(process.argv[2]!) as ProbeConfig;
  process.stdout.write(`${PROBE_RESULT}${JSON.stringify(run(config))}\n`);
}
