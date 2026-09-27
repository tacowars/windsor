/**
 * The quick clip check Save and Copy to new run in the browser (#563, epic
 * #564 decision 11): the headroom test's render — note 60 held a quarter
 * second at velocity 0.9, 400 blocks, sixteen voices — over a handful of
 * seeds, through the audio package's own offline render. It warns with the
 * peak and a suggested volume; it never blocks the write, because
 * `npm run verify` and the 16,384-seed sweep are the hard gate.
 */
import type { Patch } from '@windsor/engine';
import { renderPatchToBuffer } from '@windsor/engine';
import { LOUDNESS_RENDER, LOUDNESS_SEEDS } from './libraryConstants';
import { suggestedVolume } from './patchMetadata';

export interface LoudnessResult {
  peak: number;
  worstSeed: number;
  seeds: number;
  clips: boolean;
  /** `volume × 0.98 / peak` when it clips, else null. */
  suggestedVolume: number | null;
}

/** A rendered buffer's absolute peak across its channels. */
export function peakOf(buffer: {
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    for (const sample of buffer.getChannelData(channel)) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

/** The warning from a measured peak: pure, so the test can feed it a Node render. */
export function loudnessVerdict(
  patch: Patch,
  peaks: readonly { seed: number; peak: number }[],
): LoudnessResult {
  let worst = { seed: -1, peak: -Infinity };
  for (const reading of peaks) if (reading.peak > worst.peak) worst = reading;
  const clips = worst.peak > 1;
  return {
    peak: worst.peak,
    worstSeed: worst.seed,
    seeds: peaks.length,
    clips,
    suggestedVolume: clips ? suggestedVolume(patch.volume, worst.peak) : null,
  };
}

/** Render the check's seeds through the engine and judge them. */
export async function checkLoudness(
  patch: Patch,
  workletUrl?: string | URL,
  seeds: number = LOUDNESS_SEEDS,
): Promise<LoudnessResult> {
  const { sampleRate, noteOffFrame, blocks, blockFrames } = LOUDNESS_RENDER;
  const peaks: { seed: number; peak: number }[] = [];
  for (let seed = 0; seed < seeds; seed++) {
    const buffer = await renderPatchToBuffer(patch, {
      note: LOUDNESS_RENDER.note,
      velocity: LOUDNESS_RENDER.velocity,
      duration: noteOffFrame / sampleRate,
      tail: (blocks * blockFrames - noteOffFrame) / sampleRate,
      sampleRate,
      maxVoices: LOUDNESS_RENDER.voices,
      seed,
      ...(workletUrl === undefined ? {} : { workletUrl }),
    });
    peaks.push({ seed, peak: peakOf(buffer) });
  }
  return loudnessVerdict(patch, peaks);
}
