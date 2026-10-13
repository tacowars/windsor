/**
 * The wave sets a patch needs, built on the main thread and sent ahead of it
 * (windsor#795), so a patch message costs the audio thread a cache install,
 * not a 2–5 ms table build: each operator's wave at the part's rate and
 * quantised Tone, its User partials, and the sets at twice the rate when the
 * patch's notes take it (`patchOversamples`). The build is the worklet's own
 * (`waveSetFor`, cached in this thread's copy of its cache, so a Tone drag
 * builds each step once), under the key the processor computes, so the
 * tables are the same bits.
 *
 * One sender per live context, since the worklet's wave cache is one per
 * context's global scope: it remembers the keys it sent, oldest first, the
 * warm-up's before them, and sends a key again once it has forgotten it. Its
 * memory is the processor's sent FIFO exactly (`WAVE_SENT_LIMIT` slots, the
 * warm-up and every install, nothing else, a key installed again moving to
 * newest), so it never believes the processor holds a key it has evicted.
 * The sets the processor builds on its own (a patch posted while a voice
 * sounds at twice the rate) go to a FIFO of their own and evict none it
 * sent. Should a set be missing anyway, the processor builds it, as it did
 * before: nothing fails to sound, and an offline context gets no sender, its
 * processors building their own.
 * `waveSetSender.test.ts` pins the sets and the bits.
 */
import type { Patch } from '../patch/patch';
import { SYNC_OVERSAMPLE } from '../worklet/fm/fmConstants';
import { OPERATOR_COUNT } from '../worklet/fm/patchDefaults';
import { patchOversamples, readsWaveSet } from '../worklet/fm/partWaveSets';
import { WARM_WAVES, WAVE_SENT_LIMIT, waveSetFor, waveSetKey } from '../worklet/fm/waveTables';
import type { WaveSetEntry } from './workletMessages';

/** Keys a sender remembers: the processor's sent FIFO, slot for slot. */
const SENT_MEMORY = WAVE_SENT_LIMIT;

/** One wave set's inputs, as `waveSetFor` takes them. */
interface WaveSetInputs {
  wave: number;
  rate: number;
  tone: number;
  partials: number[] | null;
  baseRate: number;
}

/** The sets `patch` reads at `rate`, at twice it when `twice`, each operator's base set before its 2× one. */
function waveSetInputs(patch: Patch, rate: number, twice: boolean): WaveSetInputs[] {
  const out: WaveSetInputs[] = [];
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const op = patch.ops[i]!;
    if (!readsWaveSet(op.wave)) continue;
    const base = { wave: op.wave, tone: patch.tone, partials: op.userPartials, baseRate: rate };
    out.push({ ...base, rate });
    if (twice) out.push({ ...base, rate: SYNC_OVERSAMPLE * rate });
  }
  return out;
}

/** A copy of `entry` to transfer: the sender's cache keeps its own arrays. */
function copyOf(key: string, set: { mips: Float32Array[]; gains: Float64Array }): WaveSetEntry {
  return { key, mips: set.mips.map((table) => table.slice()), gains: set.gains.slice() };
}

export class WaveSetSender {
  /** The keys sent, oldest first, at most `SENT_MEMORY`. */
  private readonly sent: string[] = [];

  /** `rate` is the context's sample rate, the worklet scope's `sampleRate`. */
  constructor(private readonly rate: number) {
    // What every processor's warm-up built at load (`warmWaveCache`), first.
    for (const wave of WARM_WAVES) this.remember(waveSetKey(wave, rate, 1, null));
  }

  /**
   * The sets `patch` reads that this context's processors may not hold yet,
   * built here (or found in this thread's cache) and copied, each remembered
   * as sent: empty when none is new. Post them before the patch, on the
   * part's port, transferring `wavesTransfer(sets)`.
   */
  setsFor(patch: Patch): WaveSetEntry[] {
    const out: WaveSetEntry[] = [];
    const rate = this.rate;
    for (const { wave, rate: at, tone, partials, baseRate } of waveSetInputs(
      patch,
      rate,
      patchOversamples(patch),
    )) {
      const key = waveSetKey(wave, at, tone, partials, baseRate);
      if (this.sent.includes(key)) continue;
      out.push(copyOf(key, waveSetFor(wave, at, tone, partials, baseRate)));
      this.remember(key);
    }
    return out;
  }

  /** `key` as the newest sent, as `installWaveSet` takes it: moved there if held, else over the oldest. */
  private remember(key: string): void {
    const at = this.sent.indexOf(key);
    if (at >= 0) this.sent.splice(at, 1);
    else if (this.sent.length >= SENT_MEMORY) this.sent.shift();
    this.sent.push(key);
  }
}

/** Every buffer under `sets`, to transfer with the message that carries them. */
export function wavesTransfer(sets: readonly WaveSetEntry[]): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const set of sets) {
    for (const table of set.mips) buffers.push(table.buffer as ArrayBuffer);
    buffers.push(set.gains.buffer as ArrayBuffer);
  }
  return buffers;
}

const SENDERS = new WeakMap<object, WaveSetSender>();

/**
 * The sender for `context`'s processors (one per context, as their wave cache
 * is), or null for an offline context, whose processors build their own sets
 * (windsor#795 decision 4), or one with no sample rate (a test's stand-in).
 */
export function waveSetSenderFor(context: BaseAudioContext): WaveSetSender | null {
  const offline = typeof (context as { startRendering?: unknown }).startRendering === 'function';
  if (offline || !(context.sampleRate > 0)) return null;
  let sender = SENDERS.get(context);
  if (!sender) SENDERS.set(context, (sender = new WaveSetSender(context.sampleRate)));
  return sender;
}
