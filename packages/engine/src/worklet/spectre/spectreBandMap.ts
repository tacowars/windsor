/**
 * The curves read band by band (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`): for one channel, each band's input
 * gain, delay in frames and feedback, from the three curves' drawn cells,
 * each slid along the log-frequency axis by its `shift` (octaves), with its
 * `offset` and, on the selected cells, its `select` added first (shares of
 * full scale).
 *
 * - **The axis:** a band sits at `log2(f / low) / log2(high / low)`, built for
 *   every frame size once (`SpectreAxes`). A shift of s octaves reads the
 *   curve s octaves lower, so the drawn shape moves up.
 * - **A curve** is `SPECTRE_CELLS` cells, each the same share of the axis.
 *   A band reads between the two nearest cell centres, the ends held past
 *   the first and last; with the curve's Steps on, its nearest cell. The
 *   result is held to 0..1 (`inserts/spectreCells.ts`'s `spectreCellRead`).
 * - **Gain:** 0 is silence; above it, `(v − 1) · gainRangeDb` dB.
 * - **Delay:** the value of `timeFrames` (the full scale in frames), plus the
 *   band's fixed scatter draw times `scatter` of it, snapped to the nearest
 *   multiple of `gridFrames` when that is above 0, held to `limit`.
 * - **Feedback:** the value itself.
 * - **Selected:** each band's cell (unshifted) in the selection in force
 *   (`SpectreCellSet.active`), for the Select moves and Listen.
 * - **Follow:** with the key or the chord followed, the selection in force is
 *   the cells within `toneSemitones` of one of its pitch classes, in every
 *   octave, inside what is drawn (or everywhere, when nothing is).
 *
 * Invariants: nothing allocates after construction and no double crosses a
 * call: the moves are fields, the cells `SpectreCellSet`'s arrays, the
 * results this map's arrays (worklet rule 2). Pinned by
 * `inserts/spectreBands.test.ts`.
 */
import {
  SPECTRE_PAYLOAD_LENGTH,
  SPECTRE_PAYLOAD_MASK,
  SPECTRE_PAYLOAD_STEPS,
} from '../../inserts/spectreCells';
import { SPECTRE_CELLS, SPECTRE_DSP } from '../../inserts/spectreConstants';

/** Where a cell's centre sits across it. */
const SPECTRE_CENTRE = 0.5;
const SPECTRE_SEMITONES = 12;
const SPECTRE_A4_MIDI = 69;
const SPECTRE_A4_HZ = 440;
import { exp2InPlace, log2InPlace } from '../fm/portablePowers';

const SPECTRE_LOG2_10_OVER_20 = 0.16609640474436813;
const SPECTRE_CURVE_COUNT = 3;
const SPECTRE_GAIN = 0,
  SPECTRE_DELAY = 1,
  SPECTRE_FEEDBACK = 2;

/** Each frame size's band positions on the axis, built once. */
class SpectreAxes {
  readonly bySize: Float64Array[];
  /** The axis's span in octaves. */
  readonly octaves: number;

  constructor(sizes: readonly number[], rate: number) {
    this.octaves = NaN;
    const slot = new Float64Array(1);
    slot[0] = SPECTRE_DSP.axisHighHz / SPECTRE_DSP.axisLowHz;
    log2InPlace(slot, 0);
    const octaves = slot[0];
    this.octaves = octaves;
    this.bySize = sizes.map((n) => {
      const half = n >> 1,
        axis = new Float64Array(half + 1);
      for (let k = 0; k <= half; k++) {
        const hz = (k * rate) / n;
        if (hz <= SPECTRE_DSP.axisLowHz) {
          axis[k] = 0;
          continue;
        }
        slot[0] = hz / SPECTRE_DSP.axisLowHz;
        log2InPlace(slot, 0);
        const x = slot[0] / octaves;
        axis[k] = x > 1 ? 1 : x;
      }
      return axis;
    });
  }
}

/**
 * The curves as last posted (`inserts/spectreCells.ts`'s payload): curve c's
 * channel ch at `(c · 2 + ch) · SPECTRE_CELLS`, the drawn selection's 0/1
 * mask and each curve's Steps; and `active`, the selection in force once the
 * key or the chord is followed. Until a payload arrives the gain rests whole
 * and the delay and feedback at 0.
 */
class SpectreCellSet {
  readonly cells: Float64Array;
  readonly mask: Float64Array;
  readonly active: Float64Array;
  readonly steps: Int32Array;
  /** Each cell centre's pitch as a MIDI note, fractional. */
  readonly pitch: Float64Array;
  /** What `active` was built from: 0 off, 1 key, 2 chord, and the pitch classes. */
  follow: number;
  pitches: number;

  constructor(octaves: number) {
    this.cells = new Float64Array(SPECTRE_PAYLOAD_MASK);
    this.mask = new Float64Array(SPECTRE_CELLS);
    this.active = new Float64Array(SPECTRE_CELLS);
    this.steps = new Int32Array(SPECTRE_CURVE_COUNT);
    this.pitch = new Float64Array(SPECTRE_CELLS);
    this.cells.fill(1, 0, 2 * SPECTRE_CELLS);
    const slot = new Float64Array(1);
    slot[0] = SPECTRE_DSP.axisLowHz / SPECTRE_A4_HZ;
    log2InPlace(slot, 0);
    const foot = slot[0];
    for (let i = 0; i < SPECTRE_CELLS; i++) {
      const x = (i + SPECTRE_CENTRE) / SPECTRE_CELLS;
      this.pitch[i] = SPECTRE_A4_MIDI + SPECTRE_SEMITONES * (x * octaves + foot);
    }
    this.follow = 0;
    this.pitches = 0;
  }

  /** `active` for `follow` and `pitches` (a 12-bit mask), rebuilt only when either, or the payload, moved. */
  aim(follow: number, pitches: number, force: boolean): void {
    if (!force && follow === this.follow && pitches === this.pitches) return;
    this.follow = follow;
    this.pitches = pitches;
    const mask = this.mask,
      active = this.active;
    if (follow === 0) {
      for (let i = 0; i < SPECTRE_CELLS; i++) active[i] = mask[i];
      return;
    }
    let drawn = false;
    for (let i = 0; i < SPECTRE_CELLS; i++) if (mask[i] !== 0) drawn = true;
    const near = SPECTRE_DSP.toneSemitones,
      pitch = this.pitch;
    for (let i = 0; i < SPECTRE_CELLS; i++) {
      const m = pitch[i],
        note = Math.round(m),
        off = m - note;
      const pc = ((note % SPECTRE_SEMITONES) + SPECTRE_SEMITONES) % SPECTRE_SEMITONES;
      const tone = (off < 0 ? -off : off) <= near && ((pitches >> pc) & 1) === 1;
      active[i] = tone && (!drawn || mask[i] !== 0) ? 1 : 0;
    }
  }

  /** A posted payload copied in; one of the wrong length is ignored. Called outside `process()`. */
  load(payload: Float32Array): void {
    if (payload.length !== SPECTRE_PAYLOAD_LENGTH) return;
    const cells = this.cells,
      mask = this.mask,
      steps = this.steps;
    for (let i = 0; i < SPECTRE_PAYLOAD_MASK; i++) cells[i] = payload[i];
    for (let i = 0; i < SPECTRE_CELLS; i++) mask[i] = payload[SPECTRE_PAYLOAD_MASK + i];
    for (let c = 0; c < SPECTRE_CURVE_COUNT; c++) steps[c] = payload[SPECTRE_PAYLOAD_STEPS + c];
    this.aim(this.follow, this.pitches, true);
  }
}

class SpectreBandMap {
  readonly gain: Float64Array;
  readonly feedback: Float64Array;
  readonly delay: Int32Array;
  /** Each band's cell in the selection: 1 or 0. */
  readonly selected: Float64Array;
  /** One draw in 0..1 a band, fixed for the instance: the scatter's shape. */
  readonly draws: Float64Array;
  readonly slot: Float64Array;
  /** The cells this read uses, with the offset and the select added. */
  readonly moved: Float64Array;
  /** Which channel's cells: 0 left, 1 right. */
  readonly channel: number;
  /** The moves, set by the DSP each frame. */
  gainShift: number;
  delayShift: number;
  feedbackShift: number;
  gainOffset: number;
  delayOffset: number;
  feedbackOffset: number;
  gainSelect: number;
  delaySelect: number;
  feedbackSelect: number;
  scatter: number;
  timeFrames: number;
  gridFrames: number;
  limit: number;
  /** `read`'s operands: which curve, its shift, offset and select, into `values`. */
  curve: number;
  shift: number;
  offset: number;
  select: number;
  readonly values: Float64Array;
  /** The axis's span in octaves, which turns a shift into axis units. */
  readonly octaves: number;

  constructor(maxBands: number, draws: Float64Array, axes: SpectreAxes, channel: number) {
    this.octaves = this.channel = NaN;
    this.gainShift = this.delayShift = this.feedbackShift = NaN;
    this.gainOffset = this.delayOffset = this.feedbackOffset = NaN;
    this.gainSelect = this.delaySelect = this.feedbackSelect = NaN;
    this.scatter = this.timeFrames = this.gridFrames = NaN;
    this.shift = this.offset = this.select = NaN;
    this.gain = new Float64Array(maxBands);
    this.feedback = new Float64Array(maxBands);
    this.delay = new Int32Array(maxBands);
    this.selected = new Float64Array(maxBands);
    this.values = new Float64Array(maxBands);
    this.moved = new Float64Array(SPECTRE_CELLS);
    this.slot = new Float64Array(1);
    this.draws = draws;
    this.octaves = axes.octaves;
    this.channel = channel;
    this.gainShift = this.delayShift = this.feedbackShift = 0;
    this.gainOffset = this.delayOffset = this.feedbackOffset = 0;
    this.gainSelect = this.delaySelect = this.feedbackSelect = 0;
    this.scatter = this.timeFrames = this.gridFrames = 0;
    this.shift = this.offset = this.select = 0;
    this.limit = 0;
    this.curve = 0;
  }

  /** Every band's gain, delay, feedback and selection for `bands` bands on `axis`. */
  map(cells: SpectreCellSet, axis: Float64Array, bands: number): void {
    const octaves = this.octaves;
    this.curve = SPECTRE_GAIN;
    this.shift = this.gainShift / octaves;
    this.offset = this.gainOffset;
    this.select = this.gainSelect;
    this.read(cells, axis, bands);
    const values = this.values,
      gain = this.gain,
      slot = this.slot;
    const range = SPECTRE_DSP.gainRangeDb * SPECTRE_LOG2_10_OVER_20;
    for (let k = 0; k < bands; k++) {
      const v = values[k];
      if (v <= 0) {
        gain[k] = 0;
        continue;
      }
      slot[0] = (v - 1) * range;
      exp2InPlace(slot, 0);
      gain[k] = slot[0];
    }
    this.curve = SPECTRE_FEEDBACK;
    this.shift = this.feedbackShift / octaves;
    this.offset = this.feedbackOffset;
    this.select = this.feedbackSelect;
    this.read(cells, axis, bands);
    const feedback = this.feedback;
    for (let k = 0; k < bands; k++) feedback[k] = values[k];
    this.curve = SPECTRE_DELAY;
    this.shift = this.delayShift / octaves;
    this.offset = this.delayOffset;
    this.select = this.delaySelect;
    this.read(cells, axis, bands);
    this.delays(bands);
    const mask = cells.active,
      selected = this.selected,
      last = SPECTRE_CELLS - 1;
    for (let k = 0; k < bands; k++) {
      const i = Math.floor(axis[k] * SPECTRE_CELLS);
      selected[k] = mask[i > last ? last : i];
    }
  }

  /** `values` from `values` (the delay curve's): frames, scattered, snapped and held. */
  delays(bands: number): void {
    const values = this.values,
      delay = this.delay,
      draws = this.draws;
    const full = this.timeFrames,
      spread = this.scatter * full,
      grid = this.gridFrames,
      limit = this.limit;
    for (let k = 0; k < bands; k++) {
      let frames = values[k] * full + spread * draws[k];
      if (grid > 0) frames = Math.round(frames / grid) * grid;
      let whole = Math.round(frames);
      if (whole > limit) whole = limit;
      delay[k] = whole < 0 ? 0 : whole;
    }
  }

  /** Curve `curve`'s value at every band, read `shift` axis units lower, its cells moved first, held to 0..1. */
  read(cells: SpectreCellSet, axis: Float64Array, bands: number): void {
    const base = (this.curve * 2 + this.channel) * SPECTRE_CELLS,
      source = cells.cells,
      mask = cells.active,
      moved = this.moved,
      offset = this.offset,
      select = this.select;
    for (let i = 0; i < SPECTRE_CELLS; i++) moved[i] = source[base + i] + offset + select * mask[i];
    const values = this.values,
      shift = this.shift,
      steps = cells.steps[this.curve] !== 0,
      last = SPECTRE_CELLS - 1;
    for (let k = 0; k < bands; k++) {
      const x = axis[k] - shift;
      let v: number;
      if (steps) {
        const i = Math.floor(x * SPECTRE_CELLS);
        v = moved[i < 0 ? 0 : i > last ? last : i];
      } else {
        const p = x * SPECTRE_CELLS - SPECTRE_CENTRE;
        if (p <= 0) v = moved[0];
        else if (p >= last) v = moved[last];
        else {
          const i = Math.floor(p);
          v = moved[i] + (p - i) * (moved[i + 1] - moved[i]);
        }
      }
      values[k] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
}

export { SpectreAxes, SpectreBandMap, SpectreCellSet };
