/**
 * Behavioural tests for `worklet/reverb-processor.js`.
 *
 * A reverb has no single correct output to assert against, so these pin the
 * properties that make it usable and the two failures found while building it:
 * a tank that grows without bound at high diffusion, and a SIZE sweep that
 * stepped its delay lengths once per block instead of once per sample.
 */
import { describe, expect, it } from 'vitest';

import type { Automate, Feed } from './__fixtures__/reverbHarness';
import {
  impulse,
  internals,
  loadReverb,
  noiseBurst,
  renderReverb,
  rmsAt,
  tailSeconds,
} from './__fixtures__/reverbHarness';

const loaded = loadReverb();

describe('the tail', () => {
  it('rings on after the input stops, in stereo, without going non-finite', () => {
    const result = renderReverb(loaded, 4, impulse);

    expect(result.nonFinite).toBe(0);
    expect(result.stereo).toBe(true);
    expect(rmsAt(result, 1)).toBeGreaterThan(0);
  });

  it('lengthens with decay', () => {
    const short = tailSeconds(renderReverb(loaded, 30, impulse, { decay: 0.3 }));
    const medium = tailSeconds(renderReverb(loaded, 30, impulse, { decay: 0.7 }));
    const long = tailSeconds(renderReverb(loaded, 30, impulse, { decay: 0.9 }));

    expect(short).toBeLessThan(medium);
    expect(medium).toBeLessThan(long);
  });

  it('lengthens with size, which is what makes one plate cover every room', () => {
    const box = tailSeconds(renderReverb(loaded, 30, impulse, { size: 0.1 }));
    const room = tailSeconds(renderReverb(loaded, 30, impulse, { size: 1 }));
    const cathedral = tailSeconds(renderReverb(loaded, 30, impulse, { size: 4 }));

    expect(box).toBeLessThan(room);
    expect(room).toBeLessThan(cathedral);
    // The advertised range: a tight box under half a second, a cathedral past ten.
    expect(box).toBeLessThan(0.5);
    expect(cathedral).toBeGreaterThan(10);
  });
});

describe('the output taps', () => {
  /**
   * Dattorro's Table 2 taps are delays from where each line is written
   * (`node48_54[266]` indexes from node 48, the input). Reading them from the
   * other end -- as khoin/DattorroReverbNode does, and as this did until the
   * paper was checked -- puts every tap near the far end of its line, so the
   * plate emits *nothing* for the first 50 ms and the early reflections are
   * gone. Measured: RMS over the first 50 ms was exactly zero, and the count of
   * samples above 0.002 in the first 100 ms was 94 rather than 1020.
   *
   * The late tail is nearly identical either way, which is what made this
   * survive a listening test; early energy is the thing to assert on.
   */
  it('start the plate within milliseconds, not after a whole delay line', () => {
    const result = renderReverb(loaded, 4, impulse, { size: 1.4, decay: 0.78 });
    const onset = result.trace.findIndex((rms) => rms > 1e-5);
    const onsetMs = ((onset * 128) / loaded.sampleRate) * 1000;

    // Reading from the wrong end put onset at block 12 (32 ms) with eleven
    // blocks of pure silence first; reading them as delays puts it at block 3.
    // Asserting the onset rather than a level matters: both variants reach a
    // similar peak inside the first 50 ms, so a threshold on level passes
    // either way and tests nothing.
    expect(onset).toBeGreaterThanOrEqual(0);
    expect(onsetMs).toBeLessThan(20);
  });
});

describe('wet and dry', () => {
  it('passes the input through untouched at dry 1, wet 0', () => {
    const result = renderReverb(loaded, 0.1, impulse, { dry: 1, wet: 0 });

    expect(result.peak).toBeCloseTo(1, 5);
  });

  it('stays inaudible on silence, so an idle send adds no noise', () => {
    const result = renderReverb(loaded, 1, () => {}, { dry: 1, wet: 1 });

    // Not exactly zero: the tank carries a +/-1e-20 offset that keeps a decaying
    // loop out of denormal range, and the output taps sum it. Measured at 6e-21,
    // about -400 dBFS -- below the float32 noise floor of any real signal, but
    // an assertion of exact silence would be wrong rather than strict.
    expect(result.peak).toBeLessThan(1e-15);
    expect(result.nonFinite).toBe(0);
  });
});

describe('stability', () => {
  /**
   * The reference implementation exposes the tank all-pass coefficients up to
   * 0.999999, where the tank stops decaying and starts growing -- measured at
   * peak 54 and still climbing 60 s after the input stopped. The processor caps
   * them instead, and this is the test that says so: the harness writes raw
   * parameter values, bypassing AudioParam clamping, so it can drive the
   * processor past its own ceiling deliberately.
   */
  it('does not run away at maximum diffusion and decay', () => {
    const result = renderReverb(loaded, 45, noiseBurst(2), {
      decay: 1,
      diffusionTank1: 0.8,
      diffusionTank2: 0.8,
      tankLowCut: 10,
      tankHighCut: 20000,
    });

    expect(result.nonFinite).toBe(0);
    expect(rmsAt(result, 40)).toBeLessThanOrEqual(rmsAt(result, 10));
  });

  it('holds a frozen tank steady rather than decaying or building', () => {
    const result = renderReverb(loaded, 30, noiseBurst(0.5), { hold: 1 });

    expect(result.nonFinite).toBe(0);
    const early = rmsAt(result, 5);
    expect(early).toBeGreaterThan(0.01);
    // Freeze is meant to be indefinite: still within a factor of two at 30 s.
    expect(rmsAt(result, 29)).toBeGreaterThan(early * 0.5);
  });

  /**
   * HOLD used to bypass the tank filters by zeroing the high-pass coefficient,
   * which froze `_dampHp` at its last value and left the tank subtracting that
   * constant every pass -- DC into a lossless loop, which integrates.
   *
   * Broadband noise hides this completely, which is why the test above passed
   * while the bug was live: noise barely charges a 20 Hz high-pass. A sustained
   * low tone does, and took a frozen tank from 0.85 to 5.9 RMS over 55 s.
   */
  it.each([40, 80, 220])('does not ramp when frozen after a %i Hz tone', (hz) => {
    const result = renderReverb(loaded, 50, sine(hz, 1), {}, holdFrom(1.2));

    expect(result.nonFinite).toBe(0);
    const early = rmsAt(result, 6);
    expect(early).toBeGreaterThan(0.01);
    // A DC injection climbs steadily; a frozen tank only wanders with its mod.
    expect(rmsAt(result, 45)).toBeLessThan(early * 3);
  });
});

/** A sine at `hz` and 0.8 amplitude for `seconds`, then silence. */
function sine(hz: number, seconds: number): Feed {
  const until = Math.round((seconds * loaded.sampleRate) / 128);
  return (block, left, right) => {
    if (block >= until) return;
    for (let i = 0; i < left.length; i++) {
      const t = (block * 128 + i) / loaded.sampleRate;
      left[i] = right[i] = Math.sin(2 * Math.PI * hz * t) * 0.8;
    }
  };
}

/** Engage HOLD at `seconds` and leave it on. */
function holdFrom(seconds: number): Automate {
  const at = Math.round((seconds * loaded.sampleRate) / 128);
  return (block, values) => {
    const hold = values.hold;
    if (hold) hold[0] = block >= at ? 1 : 0;
  };
}

const TONE_HZ = 220;
const TONE_AMPLITUDE = 0.3;

/** A steady 220 Hz tone, the signal the sweep is judged against. */
const tone: Feed = (block, left, right) => {
  for (let i = 0; i < left.length; i++) {
    const t = (block * 128 + i) / loaded.sampleRate;
    left[i] = right[i] = Math.sin(2 * Math.PI * TONE_HZ * t) * TONE_AMPLITUDE;
  }
};

/** Move `size` from `from` to `to` over two seconds, then hold. */
function sweepSize(from: number, to: number): Automate {
  const blocks = Math.round((2 * loaded.sampleRate) / 128);
  return (block, values) => {
    const size = values.size;
    if (size) size[0] = from + Math.min(1, block / blocks) * (to - from);
  };
}

/**
 * The largest step a clean render of this tone can show: one sample of slew at
 * whatever peak the reverb reaches, with headroom for the plate's own texture.
 */
function slewCeiling(peak: number): number {
  return ((2 * Math.PI * TONE_HZ) / loaded.sampleRate) * peak * 3;
}

describe('size automation', () => {
  /**
   * Sweeping SIZE moves each tank line's read point. Recomputing the lengths
   * once per block left a step at every block boundary: on this signal it
   * measured 0.375 against a natural slew of about 0.036 -- ten times the
   * signal, and plainly audible. The lengths now ramp per sample, leaving only
   * the Doppler shift a swept delay is supposed to produce.
   */
  it('sweeps without stepping the delay lines', () => {
    const swept = renderReverb(loaded, 4, tone, {}, sweepSize(0.3, 3));

    expect(swept.nonFinite).toBe(0);
    expect(swept.maxStep).toBeLessThan(slewCeiling(swept.peak));
  });

  it('actually moves the tail, so the sweep above is not a no-op', () => {
    const swept = renderReverb(loaded, 4, tone, {}, sweepSize(0.3, 3));
    const still = renderReverb(loaded, 4, tone, { size: 0.3 });

    expect(swept.trace.at(-1)).not.toBeCloseTo(still.trace.at(-1) ?? 0, 4);
  });

  it('is quiet when size holds still', () => {
    const steady = renderReverb(loaded, 4, tone, { size: 1 });

    expect(steady.maxStep).toBeLessThan(slewCeiling(steady.peak));
  });
});

describe('the delay readers', () => {
  /**
   * `_read` and `_readCubic` must locate the same point in a line from the same
   * (length, offset). They are separate implementations -- linear and cubic --
   * and an earlier version of `_readCubic` floored `write - length` on its own
   * and took its fraction from `offset` alone, silently dropping the fractional
   * part of the length. On a ramp both interpolators are exact, so any
   * disagreement is a positioning error and nothing else.
   *
   * This is asserted here rather than at the output because the tank diffuses a
   * one-sample error down to about 1% by the time it reaches the taps -- real,
   * but far below anything an output assertion could distinguish from texture.
   */
  it('agree on where they are reading from', () => {
    const line = 4;
    const processor = internals(loaded.create());
    const buffer = processor._buffers[line];
    expect(buffer).toBeDefined();
    if (!buffer) return;

    // A ramp, so exact interpolation is a linear function of the position.
    for (let i = 0; i < buffer.length; i++) buffer[i] = i;
    processor._write[line] = buffer.length >> 1;

    for (const length of [64, 64.25, 64.5, 63.75, 100.1]) {
      for (const offset of [0, 0.5, 1.25, 7.75]) {
        processor._length[line] = length;
        const linear = processor._read(line, offset);
        const cubic = processor._readCubic(line, offset);
        expect(cubic, `length ${length}, offset ${offset}`).toBeCloseTo(linear, 6);
      }
    }
  });
});
