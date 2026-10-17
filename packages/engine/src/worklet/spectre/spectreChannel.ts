/**
 * One channel of Spectre (record `2026-10-16-spectre-insert`): its framing,
 * band delays, band map and modulation state, and the frame's pass through
 * them, in the order the signal takes:
 *
 *   input ring → window → FFT → input modulation → curves read →
 *   band delays (gain at the door, delay, feedback) → inverse FFT →
 *   window → overlap-add
 *
 * `side` is −½ for the left and +½ for the right: the share of Spread that
 * slides this channel's curves; `index` (0 left, 1 right) picks its cells.
 * While the scope runs, the frame's bands are binned after the FFT (input)
 * and after the delays (output); while Listen is on, the bands outside the
 * selection are silenced after the delays (record
 * `2026-10-17-spectre-drawn-cells` decisions 8 and 9).
 *
 * Invariants: `frame` allocates nothing and passes no double (worklet rule
 * 2). Pinned by `inserts/spectreDsp.test.ts`.
 */
import { SPECTRE_DSP } from '../../inserts/spectreConstants';
import { SpectreBandMap } from './spectreBandMap';
import type { SpectreAxes, SpectreCellSet } from './spectreBandMap';
import type { SpectreFft } from './spectreFft';
import { SpectreFrames } from './spectreFrames';
import { SpectreMemory } from './spectreMemory';
import { SpectreMods } from './spectreMods';
import type { SpectreScope } from './spectreScope';
import { SpectreRandom } from './spectreTurns';
import type { SpectreTurns } from './spectreTurns';

/** What a channel is built from: the largest frame, the memory's floats, the shared tables, its side and seed. */
interface SpectreChannelPlan {
  readonly capacity: number;
  readonly memory: number;
  readonly axes: SpectreAxes;
  readonly turns: SpectreTurns;
  readonly side: number;
  /** 0 the left, 1 the right: which cells it reads and where its scope bins go. */
  readonly index: number;
  /** Added to `SPECTRE_DSP.seed`: each channel draws its own scatter and modulations. */
  readonly seed: number;
}

class SpectreChannel {
  readonly frames: SpectreFrames;
  readonly memory: SpectreMemory;
  readonly map: SpectreBandMap;
  readonly mods: SpectreMods;
  readonly side: number;
  readonly index: number;
  /** The DSP's scope, which a frame bins into while it is active. */
  scope: SpectreScope | null;
  /** Only the selected bands sound: the workbench's Listen, set by the DSP each frame. */
  listen: boolean;

  /** A channel at rest, its scatter drawn once from its own seed. */
  static build(plan: SpectreChannelPlan): SpectreChannel {
    const bands = plan.capacity / 2 + 1;
    const random = new SpectreRandom(SPECTRE_DSP.seed + plan.seed);
    const draws = new Float64Array(bands);
    for (let k = 0; k < bands; k++) {
      random.next();
      draws[k] = random.value;
    }
    return new SpectreChannel(
      new SpectreFrames(plan.capacity),
      new SpectreMemory(plan.memory),
      new SpectreBandMap(bands, draws, plan.axes, plan.index),
      new SpectreMods(bands, random, plan.turns),
      plan,
    );
  }

  constructor(
    frames: SpectreFrames,
    memory: SpectreMemory,
    map: SpectreBandMap,
    mods: SpectreMods,
    place: { readonly side: number; readonly index: number },
  ) {
    this.side = this.index = NaN;
    this.frames = frames;
    this.memory = memory;
    this.map = map;
    this.mods = mods;
    this.side = place.side;
    this.index = place.index;
    this.scope = null;
    this.listen = false;
  }

  /**
   * The frame ending at the last pushed sample through the chain, summed back
   * into the ring; binned into `scope` while it is active, and with only the
   * selected bands kept while `listen`.
   */
  frame(fft: SpectreFft, window: Float64Array, cells: SpectreCellSet, axis: Float64Array): void {
    const bands = fft.half + 1,
      map = this.map,
      re = fft.re,
      im = fft.im,
      scope = this.scope;
    this.frames.take(fft.frame, window);
    fft.forward();
    if (scope && scope.active) {
      scope.channel = this.index;
      scope.bin(re, im, axis, bands, false);
    }
    this.mods.run(re, im, bands);
    map.map(cells, axis, bands);
    this.memory.run(re, im, map.gain, map.delay, map.feedback);
    if (this.listen) {
      const selected = map.selected;
      for (let k = 0; k < bands; k++) {
        if (selected[k] !== 0) continue;
        re[k] = 0;
        im[k] = 0;
      }
    }
    if (scope && scope.active) scope.bin(re, im, axis, bands, true);
    fft.inverse();
    this.frames.add(fft.frame, window);
  }

  /** The wet path back to rest: the delays, the modulation and the overlap-add, the dry kept. */
  clearWet(): void {
    this.memory.clear();
    this.mods.reset();
    this.frames.clearWet();
  }
}

export { SpectreChannel };
