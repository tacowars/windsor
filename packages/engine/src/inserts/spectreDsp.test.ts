/**
 * Spectre's signal path on the shipped bundle (records
 * `2026-10-16-spectre-insert` and `2026-10-17-spectre-drawn-cells`): the
 * analysis and resynthesis are transparent at every resolution, overlap past
 * 1× and window, at 44.1, 48 and 96 kHz, late by the frame less one; a band's
 * echo lands at its delay and its repeats fall by its feedback; Freeze holds
 * what the memory has in Hold and lets drawn feedback decay in Carve; Mix 0
 * is the late dry to the bit; a change of resolution fades through silence
 * and comes back at the new latency; posted cells are heard from the next
 * frame; Listen keeps only the selection; the scope bins each cell.
 */
import { describe, expect, it } from 'vitest';
import {
  SPECTRE_TRANSPARENT,
  loadSpectre,
  runSpectre,
  setSpectre,
  spectreFlat as flat,
  spectreParams,
  spectreSignal,
} from '../__fixtures__/spectreHarness';
import { spectreCellAt } from './spectreCells';
import {
  SPECTRE_BANDS,
  SPECTRE_CELLS,
  SPECTRE_OVERLAPS,
  SPECTRE_WINDOWS,
} from './spectreConstants';
import { spectreAxisAt } from './spectreCurves';
import type { SpectreSpec } from './spectreSpec';

const tone = (i: number, rate: number): number =>
  0.4 * Math.sin((2 * Math.PI * 440 * i) / rate) + 0.2 * Math.sin((2 * Math.PI * 3100 * i) / rate);

/** The largest |out[i] − input[i − latency]| over [from, to). */
function lateError(out: Float32Array, input: Float32Array, latency: number, from: number): number {
  let most = 0;
  for (let i = from; i < out.length; i++)
    most = Math.max(most, Math.abs(out[i]! - input[i - latency]!));
  return most;
}

const rms = (x: Float32Array, from: number, to: number): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / (to - from));
};

describe('Spectre’s analysis and resynthesis', () => {
  it.each([44100, 48000, 96000])(
    'is transparent at %i Hz, late by the frame less one',
    (rate) => {
      const scale = rate >= 84000 ? 2 : 1;
      for (const bands of SPECTRE_BANDS) {
        for (const overlap of SPECTRE_OVERLAPS.slice(1)) {
          for (const window of SPECTRE_WINDOWS) {
            const params = spectreParams({ ...SPECTRE_TRANSPARENT, bands, overlap, window });
            const processor = loadSpectre(rate, params);
            const size = 2 * Number(bands) * scale;
            expect(processor.dsp.latency, `${bands} ${overlap} ${window}`).toBe(size - 1);
            const input = spectreSignal(3 * size + 2048, (i) => tone(i, rate))[0]!;
            const out = runSpectre(processor, [input, input], params);
            expect(lateError(out.left, input, size - 1, 2 * size)).toBeLessThan(1e-6);
          }
        }
      }
    },
    60_000,
  );
});

describe('Spectre’s band delays', () => {
  const rate = 48000;
  const burst = (frames: number) =>
    spectreSignal(frames, (i) => (i < 2400 ? 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate) : 0));
  const echo: Partial<SpectreSpec> = {
    ...SPECTRE_TRANSPARENT,
    sync: false,
    timeMs: 1000,
    curves: { gain: flat(1), delay: flat(0.25), feedback: flat(0.5) },
  };

  it('repeat a burst at their delay, each repeat falling by the feedback', () => {
    const params = spectreParams(echo);
    const processor = loadSpectre(rate, params);
    const out = runSpectre(processor, burst(rate), params).left;
    const at = (seconds: number): number => Math.round(seconds * rate) + processor.dsp.latency;
    // Nothing between the burst's frames and its first repeat 250 ms on.
    expect(rms(out, at(0.1), at(0.2))).toBeLessThan(1e-6);
    const first = rms(out, at(0.25), at(0.3)),
      second = rms(out, at(0.5), at(0.55));
    expect(first).toBeGreaterThan(0.1);
    expect(second / first).toBeCloseTo(0.5, 1);
  });

  it('hold what they carry under Freeze, and pass nothing new', () => {
    const spec = { ...echo, curves: { ...echo.curves!, feedback: flat(0.2) } };
    const params = spectreParams(spec);
    const processor = loadSpectre(rate, params);
    const input = spectreSignal(3 * rate, (i) => {
      if (i < 2400) return 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate);
      // A second burst while frozen, which must not be heard.
      if (i > rate && i < rate + 2400) return 0.5 * Math.sin((2 * Math.PI * 300 * i) / rate);
      return 0;
    });
    const out = runSpectre(processor, input, params, (q) => {
      if (q === 100) setSpectre(params, { ...spec, freeze: true });
    }).left;
    // The loop's period is the delay in whole frames: compare two periods with two later ones.
    const period = Math.round((0.25 * rate) / processor.dsp.hop) * processor.dsp.hop;
    const late = rms(out, 1.5 * rate, 1.5 * rate + 2 * period),
      later = rms(out, 2.5 * rate, 2.5 * rate + 2 * period);
    expect(late).toBeGreaterThan(0.05);
    expect(Math.abs(later / late - 1)).toBeLessThan(1e-3);
    expect(processor.dsp.freeze).toBe(1);
  });

  it('give the late dry signal to the bit at Mix 0', () => {
    const params = spectreParams({ mix: 0 });
    const processor = loadSpectre(rate, params);
    const input = spectreSignal(rate / 2, (i) => tone(i, rate))[0]!;
    const out = runSpectre(processor, [input, input], params).left;
    const latency = processor.dsp.latency;
    for (let i = latency; i < out.length; i++) expect(out[i]).toBe(input[i - latency]);
  });
});

describe('a change of resolution', () => {
  it('fades through silence, rebuilds and plays on at the new latency', () => {
    const rate = 48000;
    const params = spectreParams({ ...SPECTRE_TRANSPARENT, bands: '512' });
    const processor = loadSpectre(rate, params);
    const input = spectreSignal(rate, (i) => tone(i, rate))[0]!;
    const change = 100;
    const out = runSpectre(processor, [input, input], params, (q) => {
      if (q === change) setSpectre(params, { ...SPECTRE_TRANSPARENT, bands: '2048' });
    }).left;
    expect(processor.dsp.latency).toBe(4095);
    // Down to silence within the transition, and no louder than the tone on the way.
    const fadeEnd = change * 128 + Math.ceil(0.008 * rate) + 1;
    expect(Math.abs(out[fadeEnd]!)).toBe(0);
    for (let i = change * 128; i < fadeEnd; i++) expect(Math.abs(out[i]!)).toBeLessThan(0.61);
    expect(lateError(out, input, 4095, fadeEnd + 4096 + 2048)).toBeLessThan(1e-6);
  });
});

describe('Freeze in Carve', () => {
  it('lets a band drawn below full feedback decay while one at full holds', () => {
    const rate = 48000;
    // Two tones; the cells under the high one are drawn at half feedback, the rest at full.
    const high = spectreCellAt(spectreAxisAt(3000));
    const feedback = Array.from({ length: SPECTRE_CELLS }, (_, i) =>
      Math.abs(i - high) <= 6 ? 0.5 : 1,
    );
    const spec: Partial<SpectreSpec> = {
      ...SPECTRE_TRANSPARENT,
      sync: false,
      timeMs: 200,
      freezeMode: 'carve',
      curves: {
        gain: flat(1),
        delay: flat(1),
        feedback: { left: feedback, link: true, steps: true },
      },
    };
    const params = spectreParams(spec);
    const processor = loadSpectre(rate, params);
    const input = spectreSignal(3 * rate, (i) =>
      i < rate / 2
        ? 0.3 * Math.sin((2 * Math.PI * 300 * i) / rate) +
          0.3 * Math.sin((2 * Math.PI * 3000 * i) / rate)
        : 0,
    );
    const out = runSpectre(processor, input, params, (q) => {
      if (q === Math.round(rate / 2 / 128)) setSpectre(params, { ...spec, freeze: true });
    }).left;
    // Goertzel power at a frequency over a window.
    const power = (hz: number, from: number, length: number): number => {
      const w = (2 * Math.PI * hz) / rate;
      let s1 = 0,
        s2 = 0;
      for (let i = from; i < from + length; i++) {
        const s0 = out[i]! + 2 * Math.cos(w) * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2;
    };
    const window = rate / 5;
    const lowEarly = power(300, rate, window),
      lowLate = power(300, 2 * rate, window);
    const highEarly = power(3000, rate, window),
      highLate = power(3000, 2 * rate, window);
    expect(lowLate / lowEarly).toBeGreaterThan(0.5);
    expect(highLate / highEarly).toBeLessThan(0.01);
  });
});

describe('the posted cells', () => {
  it('are heard from the next frame: a gain cell drawn to 0 silences its band', () => {
    const rate = 48000;
    const params = spectreParams({ ...SPECTRE_TRANSPARENT });
    const processor = loadSpectre(rate, params);
    const input = spectreSignal(rate, (i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate));
    const cell = spectreCellAt(spectreAxisAt(1000));
    const gain = Array.from({ length: SPECTRE_CELLS }, (_, i) => (Math.abs(i - cell) <= 8 ? 0 : 1));
    const change = 200;
    const out = runSpectre(processor, input, params, (q) => {
      if (q === change)
        setSpectre(params, {
          ...SPECTRE_TRANSPARENT,
          curves: { ...SPECTRE_TRANSPARENT.curves!, gain: { left: gain, link: true, steps: true } },
        });
    }).left;
    expect(rms(out, 100 * 128, change * 128)).toBeGreaterThan(0.3);
    const settled = change * 128 + 4 * processor.dsp.size;
    expect(rms(out, settled, out.length)).toBeLessThan(1e-3);
  });
});

describe('Listen and the scope', () => {
  const rate = 48000;
  const twoTones = (i: number): number =>
    0.3 * Math.sin((2 * Math.PI * 300 * i) / rate) +
    0.3 * Math.sin((2 * Math.PI * 3000 * i) / rate);

  it('Listen keeps only the selected bands, wet, whatever the Mix', () => {
    const high = spectreCellAt(spectreAxisAt(3000));
    const params = spectreParams({
      ...SPECTRE_TRANSPARENT,
      mix: 0,
      selection: [[high - 6, high + 7]],
    });
    const processor = loadSpectre(rate, params);
    processor.port.onmessage({ data: { type: 'listen', enabled: true } });
    const out = runSpectre(processor, spectreSignal(rate, twoTones), params).left;
    const from = rate / 2;
    const tone = (hz: number): number => {
      let re = 0,
        im = 0;
      for (let i = from; i < out.length; i++) {
        re += out[i]! * Math.cos((2 * Math.PI * hz * i) / rate);
        im += out[i]! * Math.sin((2 * Math.PI * hz * i) / rate);
      }
      return Math.hypot(re, im) / (out.length - from);
    };
    expect(tone(3000)).toBeGreaterThan(0.1);
    expect(tone(300)).toBeLessThan(1e-3);
  });

  it('the scope posts each cell’s loudest band, in and out, no more than scopeHz a second', () => {
    const params = spectreParams({ ...SPECTRE_TRANSPARENT });
    const processor = loadSpectre(rate, params);
    processor.port.onmessage({ data: { type: 'scope', enabled: true } });
    runSpectre(processor, spectreSignal(rate, twoTones), params);
    const reports = processor.port.posted.filter(
      (m): m is { type: 'scope'; input: Float32Array; output: Float32Array } =>
        (m as { type?: string }).type === 'scope',
    );
    expect(reports.length).toBeGreaterThan(20);
    expect(reports.length).toBeLessThanOrEqual(31);
    const last = reports[reports.length - 1]!;
    const peak = (cells: Float32Array, channel: number): number => {
      let best = 0;
      for (let i = 1; i < SPECTRE_CELLS; i++)
        if (cells[channel * SPECTRE_CELLS + i]! > cells[channel * SPECTRE_CELLS + best]!) best = i;
      return best;
    };
    const loudest = peak(last.input, 0);
    expect([spectreCellAt(spectreAxisAt(300)), spectreCellAt(spectreAxisAt(3000))]).toContain(
      loudest,
    );
    expect(peak(last.output, 1)).toBe(peak(last.input, 1));
  });
});
