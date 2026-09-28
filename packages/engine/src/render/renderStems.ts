/**
 * Renders a song's stems offline (windsor#41): one stereo file per part and
 * per return, beside the master, from the same render as the song WAV
 * (`renderPass.ts`) with the stem taps attached (`stemTaps.ts`).
 *
 * Each pass renders the master on channels 0–1 and its stems on the pairs
 * after (decision 2); the plan is `stemPlan.ts`. The first pass's master is
 * handed on with its stems; every later pass's master must match it
 * (`stemLineup.ts`), or the passes did not line up and the export fails
 * rather than write stems that drift. That holds because every pass is built
 * from the same document, seeds and stops (windsor#40 decision 7).
 *
 * Every stem, like the master, starts at bar 1 on its first sample and runs
 * the song and its tail: the same frames of the same pass buffer.
 *
 * Stems arrive one at a time through `onStem`, and each pass's buffer is let
 * go once its stems are handed on, so a render holds one pass at a time.
 */
import type { ArrangementDocument } from '../song/arrangementDocument';
import { RENDER_CHANNELS, RENDER_SAMPLE_RATE_DEFAULT } from './renderConstants';
import { renderPass, throwIfAborted } from './renderPass';
import type { RenderSongOptions } from './renderSong';
import { planFor, renderRefusal, wholeSong } from './renderSong';
import type { Stem, StemChoice, StemPassLimits, StemSource } from './stemPlan';
import { STEM_PASS_LIMITS, passChannels, planStemPasses, stemSources } from './stemPlan';
import { blockEnvelope, envelopesMatch } from './stemLineup';
import { attachStems } from './stemTaps';

export interface RenderStemsOptions extends RenderSongOptions, StemChoice {
  /** How wide a pass may be; the shipped limits when absent (a test narrows them). */
  passLimits?: StemPassLimits;
}

/** One file's audio: which stem, and its two channels from bar 1 through the tail. */
export interface RenderedStem {
  stem: Stem;
  /** Views into the pass buffer, valid until `onStem`'s promise settles. */
  channels: Float32Array[];
  sampleRate: number;
}

export interface RenderedStems {
  /** The stems rendered, in the order they were handed on, the master first. */
  stems: Stem[];
  passes: number;
  sampleRate: number;
  songSeconds: number;
}

export async function renderStems(
  document: ArrangementDocument,
  options: RenderStemsOptions,
  onStem: (rendered: RenderedStem) => Promise<void>,
): Promise<RenderedStems> {
  const sampleRate = options.sampleRate ?? RENDER_SAMPLE_RATE_DEFAULT;
  const refusal = renderRefusal(document, options);
  if (refusal) throw new RangeError(refusal);
  const plan = planFor(document, options);
  const song = wholeSong(document);
  const sources = stemSources(song, options);
  const passes = planStemPasses(
    sources.length,
    plan.totalFrames,
    options.passLimits ?? STEM_PASS_LIMITS,
  );
  const handed: Stem[] = [];
  let first: Float64Array | null = null;
  for (const [index, indices] of passes.entries()) {
    const group = indices.map((i) => sources[i]!);
    const buffer = await renderPass(
      song,
      plan,
      {
        ...options,
        sampleRate,
        onProgress: (fraction) => options.onProgress?.((index + fraction) / passes.length),
      },
      { channels: passChannels(group.length), attach: (system) => attachStems(system, group) },
    );
    const pair = (first: number): Float32Array[] =>
      [first, first + 1].map((c) => buffer.getChannelData(c).subarray(plan.leadFrames));
    const master = pair(0);
    // One pass needs no check; with more, every master must match the first's.
    const envelope = passes.length > 1 ? blockEnvelope(master) : null;
    if (index === 0) {
      first = envelope;
      await handOn({ kind: 'master' }, master);
    } else if (!envelopesMatch(envelope!, first!)) {
      throw new Error(`stem pass ${index + 1} did not line up with the first; nothing was written`);
    }
    for (const [k, stem] of group.entries()) await handOn(stem, pair(RENDER_CHANNELS * (k + 1)));
  }
  return {
    stems: handed,
    passes: passes.length,
    sampleRate,
    songSeconds: plan.songFrames / sampleRate,
  };

  async function handOn(stem: Stem | StemSource, channels: Float32Array[]): Promise<void> {
    throwIfAborted(options.signal);
    handed.push(stem);
    await onStem({ stem, channels, sampleRate });
  }
}
