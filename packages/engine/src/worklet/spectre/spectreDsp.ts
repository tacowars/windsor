/**
 * Spectre's signal path (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`): two channels of short-time spectral
 * processing (`SpectreChannel`), mixed with their own late dry signal.
 *
 * - **Frames:** every `hop` samples each channel takes a frame of `size`
 *   (`spectreFrameSize`: the resolution's bands × 2, doubled at high rates)
 *   and runs it through the chain; before it, the controls glide a frame,
 *   the LFO steps and Freeze glides, and each channel's curves are aimed:
 *   its share of Spread slides all three, and the LFO's three slots push
 *   their destinations (`spectreAim.ts`). The curves are the cells last
 *   posted (`cells`, loaded by the processor outside the render).
 * - **Scope and Listen:** while the scope is active each frame is binned,
 *   and a report closes every `1 / scopeHz` seconds; while `listen` is on,
 *   only the selected bands sound and the output is the wet path alone.
 * - **Latency** is `size − 1` samples, wet and dry alike, so Mix never combs
 *   and the switch never jumps in time.
 * - **Output:** `(dry + mix · (wet − dry)) · output`, Mix and Output glided a
 *   sample at a time.
 * - **The switch** (windsor#630) crossfades that toward the late dry over
 *   `INSERT_SWITCH_FADE_S`; fully off it is the late dry to the bit and no
 *   frame is computed (`bypassed`). On again from fully off, the wet path
 *   starts from rest.
 * - **A choice** (resolution, overlap, window) fades the whole output out
 *   over `transitionSeconds`, rebuilds from silence (the latency may change)
 *   and fades back in; an algorithm change resets that algorithm's state.
 * - **Sleep** (`drowse`, called by the processor after it sets each block's
 *   input `peak`): after a silent block, once no frame has written into the delays
 *   above the output floor for the memory's length and the modulations' own
 *   (`quietNeeded`), the wet path is cleared and frames stop; the controls,
 *   the LFO and Freeze still step every frame (the sleep rule). The first
 *   loud block wakes it, rendered in full from rest.
 *
 * Invariants: `tick` allocates nothing and takes and gives samples through
 * fields (worklet rule 2); every double field is born NaN (rule 7). Pinned by
 * `inserts/spectreAllocation.test.ts`; the path by `inserts/spectreDsp.test.ts`.
 */
import { INSERT_SWITCH_FADE_S } from '../../inserts/insertConstants';
import {
  SPECTRE_BANDS,
  SPECTRE_DSP,
  SPECTRE_LFO_DESTS,
  SPECTRE_MODS,
  SPECTRE_OVERLAP_FACTORS,
  SPECTRE_OVERLAPS,
  SPECTRE_SLEEP,
  SPECTRE_WINDOWS,
} from '../../inserts/spectreConstants';
import { exp2InPlace } from '../fm/portablePowers';
import { SpectreAxes, SpectreCellSet } from './spectreBandMap';
import { SpectreChannel } from './spectreChannel';
import { SpectreControls } from './spectreControls';
import type { SpectreParams } from './spectreControls';
import { SpectreFft } from './spectreFft';
import { SpectreLayouts } from './spectreLayouts';
import { SpectreLfo } from './spectreLfo';
import { SpectreScope } from './spectreScope';
import { SpectreRandom, SpectreTurns } from './spectreTurns';
import { SpectreWindows } from './spectreWindows';
import { aimChannel, aimLfo } from './spectreAim';

const SPECTRE_LOG2_E = 1.4426950408889634;
const SPECTRE_DB_LOG2 = 0.16609640474436813;
const SPECTRE_MS = 1000;
const SPECTRE_MOST_OVERLAP = 4;
/** The share of Spread each channel's curves slide by: half each way. */
const SPECTRE_LEFT_SIDE = -0.5,
  SPECTRE_RIGHT_SIDE = 0.5;

/** The frame-size multiplier at `rate`: 1 near 48 kHz, 2 near 96, 4 near 192. */
function spectreFrameScale(rate: number): number {
  let scale = 1;
  while (rate >= SPECTRE_DSP.referenceRate * SPECTRE_DSP.rateDoubling * scale) scale *= 2;
  return scale;
}

class SpectreDsp {
  readonly rate: number;
  readonly sizes: number[];
  readonly fft: SpectreFft;
  readonly windows: SpectreWindows;
  readonly layouts: SpectreLayouts;
  readonly axes: SpectreAxes;
  readonly cells: SpectreCellSet;
  readonly controls: SpectreControls;
  readonly scope: SpectreScope;
  /** The LFO's sum into each destination this frame (`aimLfo`). */
  readonly pushes: Float64Array;
  /** Only the selected bands sound, wet: the workbench's Listen. */
  listen: boolean;
  /** Samples since the scope's last report closed. */
  scopeSamples: number;
  readonly scopeEvery: number;
  readonly lfo: SpectreLfo;
  readonly leftChannel: SpectreChannel;
  readonly rightChannel: SpectreChannel;
  readonly slot: Float64Array;
  readonly sleeps: boolean;
  /** In and out: a sample of each channel. */
  inputLeft: number;
  inputRight: number;
  left: number;
  right: number;
  /** The analysis in force. */
  sizeIndex: number;
  overlapIndex: number;
  windowIndex: number;
  size: number;
  hop: number;
  latency: number;
  hopSeconds: number;
  untilFrame: number;
  window: Float64Array;
  /** A choice is waiting for the output's fade to reach silence. */
  changing: boolean;
  fade: number;
  readonly fadeStep: number;
  mix: number;
  gain: number;
  gainTarget: number;
  readonly samplePole: number;
  /** The switch's fade: 0 the late dry, 1 the processed. */
  level: number;
  readonly levelStep: number;
  enabled: boolean;
  bypassed: boolean;
  freeze: number;
  freezeStep: number;
  /** The delay's full scale and the grid's step, in frames, this frame. */
  timeFrames: number;
  gridFrames: number;
  asleep: boolean;
  /** Frames since one wrote above the floor, and how many make the memory inaudible. */
  quiet: number;
  quietNeeded: number;
  /** The longest delay a band may take, in frames: `maxSeconds`, within the memory. */
  reach: number;
  /** The processor's reading of the block's largest input sample. */
  peak: number;

  constructor(rate: number, params: SpectreParams, sleeps = true) {
    this.rate = this.inputLeft = this.inputRight = this.left = this.right = NaN;
    this.hopSeconds = this.fade = this.fadeStep = this.mix = this.gain = this.gainTarget = NaN;
    this.samplePole = this.level = this.levelStep = this.freeze = this.freezeStep = NaN;
    this.timeFrames = this.gridFrames = this.peak = this.scopeSamples = this.scopeEvery = NaN;
    this.rate = rate;
    this.sleeps = sleeps;
    const scale = spectreFrameScale(rate);
    this.sizes = SPECTRE_BANDS.map((bands) => 2 * Number(bands) * scale);
    const capacity = this.sizes[this.sizes.length - 1];
    this.fft = new SpectreFft(capacity);
    this.windows = new SpectreWindows(this.sizes, SPECTRE_WINDOWS.length);
    this.axes = new SpectreAxes(this.sizes, rate);
    this.cells = new SpectreCellSet(this.axes.octaves);
    this.controls = new SpectreControls();
    this.scope = new SpectreScope();
    this.pushes = new Float64Array(SPECTRE_LFO_DESTS.length);
    this.scopeEvery = rate / SPECTRE_DSP.scopeHz;
    const turns = new SpectreTurns(SPECTRE_DSP.turnPoints);
    this.lfo = new SpectreLfo(turns, new SpectreRandom(SPECTRE_DSP.seed));
    const memory = spectreMemoryFloats(rate, this.sizes);
    this.layouts = new SpectreLayouts(
      rate,
      this.sizes,
      SPECTRE_OVERLAPS.map((overlap) => SPECTRE_OVERLAP_FACTORS[overlap]),
      memory,
      this.windows,
    );
    const build = { capacity, memory, axes: this.axes, turns };
    this.leftChannel = SpectreChannel.build({
      ...build,
      side: SPECTRE_LEFT_SIDE,
      index: 0,
      seed: 1,
    });
    this.rightChannel = SpectreChannel.build({
      ...build,
      side: SPECTRE_RIGHT_SIDE,
      index: 1,
      seed: 2,
    });
    this.leftChannel.scope = this.rightChannel.scope = this.scope;
    this.slot = new Float64Array(1);
    this.inputLeft = this.inputRight = this.left = this.right = 0;
    this.sizeIndex = this.overlapIndex = this.windowIndex = -1;
    this.size = this.hop = this.latency = this.untilFrame = 0;
    this.hopSeconds = 0;
    this.window = this.windows.roots[0][0];
    this.changing = this.asleep = this.listen = this.enabled = this.bypassed = false;
    this.fade = 1;
    this.fadeStep = 1 / (SPECTRE_DSP.transitionSeconds * rate);
    this.pole(1);
    this.samplePole = this.slot[0];
    this.levelStep = 1 / (INSERT_SWITCH_FADE_S * rate);
    this.freeze = 0;
    this.freezeStep = 0;
    this.timeFrames = this.gridFrames = this.peak = this.scopeSamples = 0;
    this.quiet = this.quietNeeded = this.reach = 0;
    this.begin(params);
  }

  /** The first params, landed at once: the switch, the analysis, Mix, Output and Freeze, with no glide. */
  begin(params: SpectreParams): void {
    this.controls.read(params);
    this.enabled = this.controls.enabled;
    this.level = this.enabled ? 1 : 0;
    this.bypassed = !this.enabled;
    this.apply();
    this.configure(params);
    this.mix = this.controls.mix;
    this.gain = this.gainTarget;
    this.freeze = this.controls.freeze ? 1 : 0;
  }

  /** Into `slot[0]`: the one-pole step a period of `samples` takes toward a target over `smoothSeconds`. */
  pole(samples: number): void {
    const slot = this.slot;
    slot[0] = (-samples / (this.rate * SPECTRE_DSP.smoothSeconds)) * SPECTRE_LOG2_E;
    exp2InPlace(slot, 0);
    slot[0] = 1 - slot[0];
  }

  /** The quantum's params: the choices, the switch, the targets. */
  configure(params: SpectreParams): void {
    const c = this.controls;
    c.read(params);
    this.cells.aim(c.follow, c.pitches, false);
    const wantSize = clampIndex(c.bands, SPECTRE_BANDS.length),
      wantOverlap = clampIndex(c.overlap, SPECTRE_OVERLAPS.length),
      wantWindow = clampIndex(c.window, SPECTRE_WINDOWS.length);
    this.changing =
      wantSize !== this.sizeIndex ||
      wantOverlap !== this.overlapIndex ||
      wantWindow !== this.windowIndex;
    const mod = clampIndex(c.mod, SPECTRE_MODS.length);
    if (mod !== this.leftChannel.mods.mod) {
      this.leftChannel.mods.mod = this.rightChannel.mods.mod = mod;
      this.leftChannel.mods.reset();
      this.rightChannel.mods.reset();
    }
    this.lfo.shape = c.lfoShape;
    this.lfo.hz = c.lfoHz;
    if (c.enabled && this.level === 0 && !this.enabled) {
      this.leftChannel.clearWet();
      this.rightChannel.clearWet();
    }
    this.enabled = c.enabled;
    this.bypassed = !c.enabled && this.level === 0;
    const slot = this.slot;
    slot[0] = c.outputDb * SPECTRE_DB_LOG2;
    exp2InPlace(slot, 0);
    this.gainTarget = slot[0];
  }

  /** The choices the controls ask for, from silence: table reads only (`SpectreLayouts`). */
  apply(): void {
    const c = this.controls,
      layouts = this.layouts;
    this.sizeIndex = clampIndex(c.bands, SPECTRE_BANDS.length);
    this.overlapIndex = clampIndex(c.overlap, SPECTRE_OVERLAPS.length);
    this.windowIndex = clampIndex(c.window, SPECTRE_WINDOWS.length);
    const at = this.sizeIndex * layouts.overlaps + this.overlapIndex;
    const size = this.sizes[this.sizeIndex],
      hop = layouts.hops[at];
    this.size = size;
    this.hop = hop;
    this.latency = size - 1;
    this.hopSeconds = layouts.hopSeconds[at];
    this.untilFrame = hop;
    this.window = this.windows.roots[this.sizeIndex][this.windowIndex];
    this.fft.resize(size);
    this.layout(this.leftChannel);
    this.layout(this.rightChannel);
    this.lfo.hopSeconds = this.hopSeconds;
    this.controls.pole = layouts.poles[at];
    this.freezeStep = layouts.freezeSteps[at];
    this.reach = layouts.reaches[at];
    this.quietNeeded = layouts.quietNeeded[at];
    this.quiet = 0;
    this.changing = false;
  }

  /** A channel laid out for the analysis in force, from silence. */
  layout(channel: SpectreChannel): void {
    const layouts = this.layouts,
      at = this.sizeIndex * layouts.overlaps + this.overlapIndex;
    channel.frames.resize(this.size);
    channel.frames.gain = layouts.gains[at * layouts.shapes + this.windowIndex];
    channel.memory.resize(this.size / 2 + 1, layouts.memoryFrames[this.sizeIndex]);
    channel.mods.reset();
    channel.mods.axis = this.axes.bySize[this.sizeIndex];
    channel.mods.hopSeconds = this.hopSeconds;
  }

  /** The block's input peak (`peak`), before it renders: sleep or wake (see the header). */
  drowse(): void {
    if (!this.sleeps) return;
    const peak = this.peak;
    const gain = this.gainTarget > 1 ? this.gainTarget : 1;
    const loud = peak > SPECTRE_SLEEP.inputFloor / gain;
    if (this.asleep) {
      if (loud) this.asleep = false;
      return;
    }
    if (loud) {
      this.quiet = 0;
      return;
    }
    if (this.quiet < this.quietNeeded || !this.enabled || this.changing) return;
    this.leftChannel.clearWet();
    this.rightChannel.clearWet();
    this.asleep = true;
  }

  /** One sample of `inputLeft`/`inputRight` into `left`/`right`. */
  tick(): void {
    const l = this.leftChannel.frames,
      r = this.rightChannel.frames;
    l.input = this.inputLeft;
    r.input = this.inputRight;
    l.push();
    r.push();
    if (--this.untilFrame === 0) {
      this.untilFrame = this.hop;
      this.frame();
    }
    l.emit();
    r.emit();
    this.mix += this.samplePole * ((this.listen ? 1 : this.controls.mix) - this.mix);
    this.gain += this.samplePole * (this.gainTarget - this.gain);
    const mix = this.mix,
      gain = this.gain;
    let outL = (l.dry + mix * (l.wet - l.dry)) * gain,
      outR = (r.dry + mix * (r.wet - r.dry)) * gain;
    const level = this.level;
    if (level !== 1 || !this.enabled) {
      outL = level === 0 ? l.dry : l.dry + level * (outL - l.dry);
      outR = level === 0 ? r.dry : r.dry + level * (outR - r.dry);
      const moved = this.enabled ? level + this.levelStep : level - this.levelStep;
      this.level = moved < 0 ? 0 : moved > 1 ? 1 : moved;
    }
    if (this.changing || this.fade !== 1) this.transition();
    const fade = this.fade;
    this.left = fade === 1 ? outL : outL * fade;
    this.right = fade === 1 ? outR : outR * fade;
  }

  /** The choice's fade: down to silence, the rebuild, back up. */
  transition(): void {
    if (this.changing) {
      const fade = this.fade - this.fadeStep;
      this.fade = fade < 0 ? 0 : fade;
      if (this.fade === 0) this.apply();
      return;
    }
    const fade = this.fade + this.fadeStep;
    this.fade = fade > 1 ? 1 : fade;
  }

  /** A frame: the controls' glide, the LFO, Freeze, the scope's cadence, then each channel's chain unless resting. */
  frame(): void {
    this.controls.step();
    this.lfo.advance();
    const scope = this.scope;
    if (scope.active) {
      this.scopeSamples += this.hop;
      if (this.scopeSamples >= this.scopeEvery) {
        this.scopeSamples = 0;
        const cells = this.cells;
        scope.close(this.lfo.value, cells.follow === 0 ? 0 : cells.pitches);
      }
    }
    const freeze = this.controls.freeze ? 1 : 0;
    if (this.freeze !== freeze) {
      const moved = this.freeze + (freeze > this.freeze ? this.freezeStep : -this.freezeStep);
      this.freeze = moved < 0 ? 0 : moved > 1 ? 1 : moved;
    }
    if (this.bypassed || this.asleep) return;
    this.timeFrames = (this.controls.timeMs * this.rate) / (SPECTRE_MS * this.hop);
    this.gridFrames = (this.controls.gridMs * this.rate) / (SPECTRE_MS * this.hop);
    aimLfo(this);
    aimChannel(this, this.leftChannel);
    aimChannel(this, this.rightChannel);
    const axis = this.axes.bySize[this.sizeIndex];
    this.leftChannel.listen = this.rightChannel.listen = this.listen;
    this.leftChannel.frame(this.fft, this.window, this.cells, axis);
    this.rightChannel.frame(this.fft, this.window, this.cells, axis);
    const loudest =
      this.leftChannel.memory.loudest > this.rightChannel.memory.loudest
        ? this.leftChannel.memory.loudest
        : this.rightChannel.memory.loudest;
    this.quiet = loudest > SPECTRE_SLEEP.outputFloor ? 0 : this.quiet + 1;
  }
}

/** The band memory's floats: `maxSeconds` at the smallest hop any overlap reaches, and a frame's slack. */
function spectreMemoryFloats(rate: number, sizes: readonly number[]): number {
  const capacity = sizes[sizes.length - 1];
  return Math.ceil(
    SPECTRE_DSP.maxSeconds * rate * SPECTRE_MOST_OVERLAP * (1 + 2 / sizes[0]) + 2 * (capacity + 2),
  );
}

function clampIndex(value: number, count: number): number {
  return value < 0 ? 0 : value >= count ? count - 1 : value;
}

export { SpectreDsp, spectreFrameScale };
