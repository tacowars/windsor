/**
 * The FM part's run for `workletAllocationProbe.ts` (windsor#233): a cycle of
 * note events over the part's four parameters. The test writes the events
 * (note-ons, some mid-quantum, some with a step's offsets or a per-note mod,
 * and note-offs), so one cycle holds a chord, changes one over it, steals
 * voices from a full pool, releases and, for a patch that sustains at 0, lets
 * held voices fall dormant and then ends or steals them. A parameter changes
 * every `period` quanta throughout (bend, wheel, cutoff and gain, each
 * toggled between its default and another value in turn). After a cycle's
 * last event the part plays out until no voice is left, then rests silent for
 * `rest` quanta, and the next cycle starts: it follows the voices' own state,
 * not a fixed schedule, so a retuned tunable cannot starve it.
 *
 * Every message, and the event wrapping it, is built once here and reused:
 * what the run measures is the processor's handling of a message, not a new
 * object for each (in Chrome the port's deserialisation makes one, outside
 * the render). A note's handle moves on by `idStride` each cycle, as the
 * sequencer's handles are new for every note.
 *
 * The part's random source is swapped for a constant before the run, as the
 * load meter is turned off: a voice start draws from it up to five times (a
 * free-running phase for each operator, and the pan), and V8 returns each
 * draw of `Math.random` (or of the seeded source, whose state is a boxed
 * number) as a new heap number, which no form of the part's source avoids.
 * The constant is a literal, which V8 returns without allocating. What the
 * draws cost in Chrome is in `docs/research/2026-09-30-worklet-gc-in-chrome/`.
 *
 * The probe imports this by path in its child Node, which runs it directly
 * (its types are stripped), so it imports nothing at run time but Node's own
 * `node:v8`. At the end of the measured run it throws, failing the probe,
 * unless that run took every path in `paths`.
 *
 * The warm-up ends by reading the heap as the probe's measured run does: V8
 * otherwise compiles that reading's own code during the measured run
 * (windsor#229, `compressorChangeScenario.ts`).
 */
import v8 from 'node:v8';
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

/** Heap reads at the end of the warm-up: enough for V8 to compile the reading. */
const WARM_READS = 64;
const QUANTUM = 128;

/** One event of the cycle, at quantum `at` from its start and `offset` frames into that quantum. */
export interface FmPartEvent {
  at: number;
  offset: number;
  type: 'noteOn' | 'noteOff';
  /** The note's handle within the cycle. */
  key: number;
  note?: number;
  velocity?: number;
  mod?: number;
  stepMod?: number[];
}

/**
 * A path the run must take: a gated voice, one fading from a steal, one
 * released and ringing, one dormant, a voice that ended, and the part silent.
 */
export type FmPartPath = 'held' | 'stolen' | 'released' | 'dormant' | 'ended' | 'silent';

export interface FmPartChangeConfig {
  /** The cycle's events, in order of `at`. */
  events: FmPartEvent[];
  /** Quanta between parameter changes. */
  period: number;
  /** Each change toggles one parameter between its default and this value, in turn. */
  toggles: [string, number][];
  /** Silent quanta after the part has played out, before the next cycle. */
  rest: number;
  /** Handles move on by this much each cycle: more than any `key`. */
  idStride: number;
  /** The paths the measured run must take. */
  paths: FmPartPath[];
  /**
   * Quanta between an event's message and the quantum it lands in, as the
   * scheduler posts ahead; omitted, 0 (it lands in the quantum it is sent
   * before). Every event, and the cycle, moves this much later.
   */
  lookahead?: number;
  /**
   * Keep every accessor of the part's event queue from being optimised, and
   * so from being inlined, as V8 may decline to inline a call in a larger
   * render: whatever such an accessor returns then crosses a real return.
   * The child needs `--allow-natives-syntax`.
   */
  outlineQueueAccessors?: boolean;
  /**
   * The warm-up ends by setting every sounding voice's `age` to this, so a
   * voice held through the measured run (a drone, dormant or not) counts
   * its frames past 2^31, as one held for about 12 hours at 48 kHz.
   */
  seedAge?: number;
  /**
   * The warm-up ends by giving the part a new event queue, as a fresh part
   * has, so the measured run holds the queue's first events and its first
   * burst while the code is warm (windsor#270). The run then throws unless
   * the queue kept its arrays, at their length, and a burst filled its
   * posted slots. The queue must be empty when the warm-up ends.
   */
  freshQueue?: boolean;
}

/** What the run reads of each voice: flags only, since reading a double field can box it here. */
interface VoiceState {
  active: boolean;
  gate: boolean;
  fading: boolean;
  dormant: boolean;
}

const PATHS: FmPartPath[] = ['held', 'stolen', 'released', 'dormant', 'ended', 'silent'];

/** Every sounding voice's age set to `age`: a write the run makes once, before it is measured. */
function seedAges(probe: ProbeRig, age: number): void {
  const voices = (probe.processor as unknown as { voices: (VoiceState & { age: number })[] })
    .voices;
  let seeded = 0;
  for (const voice of voices) {
    if (!voice.active) continue;
    voice.age = age;
    seeded++;
  }
  if (seeded === 0) throw new Error('no voice was sounding to age');
}

/** What the run reads of the part's event queue: its storage and how many messages wait. */
interface QueueStorage {
  items: unknown[];
  frames: Float64Array;
  posted: unknown[];
  postedCount: number;
  empty: boolean;
}

/** The part's queue storage as the run reads it. */
const queueOf = (probe: ProbeRig): QueueStorage =>
  (probe.processor as unknown as { events: QueueStorage }).events;

/**
 * Swap a new event queue into the part, built by the queue's own class, and
 * return a check that it has not grown since and that `peak` posted messages
 * reached its capacity.
 */
function freshQueue(probe: ProbeRig): (peak: number) => void {
  const old = queueOf(probe);
  if (!old.empty || old.postedCount !== 0)
    throw new Error('the event queue was not empty to replace');
  const Queue = old.constructor as new () => QueueStorage;
  const fresh = new Queue();
  (probe.processor as unknown as { events: QueueStorage }).events = fresh;
  const { items, frames, posted } = fresh;
  const lengths = [items.length, frames.length, posted.length].join();
  return (peak) => {
    const now = queueOf(probe);
    const kept = now.items === items && now.frames === frames && now.posted === posted;
    const at = [now.items.length, now.frames.length, now.posted.length].join();
    if (!kept || at !== lengths) {
      throw new Error(`the event queue grew in the measured run: ${lengths} to ${at}`);
    }
    if (peak < posted.length) throw new Error(`the burst posted ${peak} of ${posted.length}`);
  };
}

/** The part's random source, the processor's and each voice's copy of it. */
interface RandomSource {
  random: () => number;
  voices: { random: () => number }[];
}

/** Every draw from the part's random source, a literal: V8 returns it without allocating. */
const constantDraw = (): number => 0.5;

/** Mark each getter on the part's event queue's prototype never to be optimised (`%NeverOptimizeFunction`). */
function outlineQueueAccessors(probe: ProbeRig): void {
  const queue = (probe.processor as unknown as { events: object }).events;
  // Natives syntax is not TypeScript, so the call is compiled at run time.
  const neverOptimise = new Function('f', '%NeverOptimizeFunction(f);') as (f: unknown) => void;
  const proto = Object.getPrototypeOf(queue) as object;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(proto))) {
    if (descriptor.get) neverOptimise(descriptor.get);
  }
}

function swapRandom(probe: ProbeRig): void {
  const part = probe.processor as unknown as RandomSource;
  part.random = constantDraw;
  for (const voice of part.voices) voice.random = constantDraw;
}

interface Message {
  type: string;
  id: number;
  frame: number;
}

/** The cycle's messages, each in its event wrapper, built once. */
function messages(events: FmPartEvent[], startFrame: number): { data: Message }[] {
  return events.map(({ type, key, note, velocity, mod, stepMod }) => {
    const data =
      type === 'noteOn'
        ? {
            type,
            id: key,
            note,
            velocity,
            frame: startFrame,
            mod: mod ?? 0,
            stepMod: stepMod ?? null,
          }
        : { type, id: key, frame: startFrame };
    // `frame` starts at the run's first frame, so a frame past 2^31 is a double from the start.
    return { data: data as Message };
  });
}

/** The cycle, one quantum at a time, and the paths it has passed through. */
interface Cycle {
  /** Before quantum `q` renders: its events and its parameter change. */
  step(q: number): void;
  /** After it renders: the paths the voices are on. */
  note(): void;
  seen: Uint8Array;
  /** The most messages posted between two quanta since the last `restart`. */
  peak: () => number;
  restart: () => void;
}

// One cycle's bookkeeping, read top to bottom: the events, the play-out, the rest.
// eslint-disable-next-line max-lines-per-function -- the cycle's three phases and its path record share its counters
function fmCycle(probe: ProbeRig, config: FmPartChangeConfig): Cycle {
  const { params } = probe;
  const port = probe.processor.port;
  const voices = (probe.processor as unknown as { voices: VoiceState[] }).voices;
  const events = config.events;
  const startFrame = probe.config.startFrame ?? 0;
  const lookahead = config.lookahead ?? 0;
  const wrapped = messages(events, startFrame);
  // Played out only once the last event has landed.
  const last = events[events.length - 1]!.at + lookahead;
  const arrays = config.toggles.map(([name]) => params[name]!);
  // Float32, as the parameter arrays are, so a toggle compares like with like.
  const others = Float32Array.from(config.toggles, ([, value]) => value);
  const defaults = Float32Array.from(arrays, (values) => values[0]!);
  const required = new Uint8Array(PATHS.length);
  for (const path of config.paths) required[PATHS.indexOf(path)] = 1;
  const seen = new Uint8Array(PATHS.length);
  const wasActive = new Uint8Array(voices.length);
  let start = 0;
  let cycle = 0;
  let next = 0;
  let resting = -1;
  let change = 0;
  let peak = 0;

  const toggle = (): void => {
    const k = change++ % arrays.length;
    const values = arrays[k]!;
    values[0] = values[0] === others[k] ? defaults[k]! : others[k]!;
  };
  const anyActive = (): boolean => {
    for (let i = 0; i < voices.length; i++) if (voices[i]!.active) return true;
    return false;
  };
  const step = (q: number): void => {
    if (q % config.period === 0) toggle();
    const t = q - start;
    while (next < events.length && events[next]!.at === t) {
      const event = wrapped[next]!;
      event.data.id = events[next]!.key + cycle * config.idStride;
      event.data.frame = startFrame + (q + lookahead) * QUANTUM + events[next]!.offset;
      port.onmessage!(event);
      next++;
    }
    const waiting = queueOf(probe).postedCount;
    if (waiting > peak) peak = waiting;
    if (t < last) return;
    // Played out: rest, then start the next cycle at the next quantum.
    if (resting < 0 && !anyActive()) resting = config.rest;
    if (resting >= 0 && resting-- === 0) {
      start = q + 1;
      cycle++;
      next = 0;
      resting = -1;
    }
  };
  const note = (): void => {
    let active = 0;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i]!;
      if (wasActive[i] === 1 && !v.active) seen[4] = 1;
      wasActive[i] = v.active ? 1 : 0;
      if (!v.active) continue;
      active++;
      if (v.fading) seen[1] = 1;
      else if (!v.gate) seen[2] = 1;
      else if (v.dormant) seen[3] = 1;
      else seen[0] = 1;
    }
    if (active === 0) seen[5] = 1;
  };
  for (let p = 0; p < PATHS.length; p++) if (!required[p]) seen[p] = 1;
  return {
    step,
    note,
    seen,
    peak: () => peak,
    restart: () => {
      peak = 0;
    },
  };
}

export default function fmPartChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as FmPartChangeConfig;
  swapRandom(probe);
  if (config.outlineQueueAccessors) outlineQueueAccessors(probe);
  const { step, note, seen, peak, restart } = fmCycle(probe, config);
  let checkQueue: ((peak: number) => void) | undefined;
  const { warmup, measure } = probe.config;
  const none: Float32Array[][] = [];
  // Quanta [from, to). The measured run calls this same function, so it
  // measures code already hot.
  const drive = (from: number, to: number): void => {
    for (let q = from; q < to; q++) {
      step(q);
      probe.render(q, none);
      note();
    }
    if (to !== warmup + measure) return;
    if (seen.includes(0)) {
      const missed = PATHS.filter((_, p) => seen[p] === 0);
      throw new Error(`the measured run missed a path: ${missed.join(', ')}`);
    }
    checkQueue?.(peak());
  };
  const chunk = config.period * 16;
  const chunks = (from: number, to: number): void => {
    for (let q = from; q < to; q += chunk) drive(q, Math.min(to, q + chunk));
  };
  const optional = Uint8Array.from(seen);
  return {
    warm: () => {
      // The load meter on for the first half, then the measured cadence
      // (off, 0): a load report reads Date.now() twice a quantum, and V8
      // returns each as a new heap number.
      // A first swap, so the part's `events` field is already rewritten, and
      // the code that read it deoptimised and optimised again, by the time
      // the swap that matters comes: V8 tracks a field written only by the
      // constructor as constant, and the first other write deoptimises.
      if (config.freshQueue) freshQueue(probe);
      probe.report(64);
      chunks(0, warmup / 2);
      probe.report(probe.config.loadQuanta);
      chunks(warmup / 2, warmup);
      seen.set(optional);
      if (config.seedAge !== undefined) seedAges(probe, config.seedAge);
      if (config.freshQueue) checkQueue = freshQueue(probe);
      restart();
      for (let r = 0; r < WARM_READS; r++) v8.getHeapStatistics();
    },
    drive,
  };
}
