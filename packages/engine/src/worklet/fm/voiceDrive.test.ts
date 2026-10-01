/**
 * The voice's drive stage (windsor#300), as a unit: `soft` is the filter's
 * former soft clip to the bit, the other shapes are Advanced Drive's curves
 * of the same names, and the control half bypasses unity, takes the bias's
 * offset from the same curve and sets the tone pole. The per-sample stage is
 * written out in the render loops, so the silence, the bias's H2 and the
 * tone's response are measured through the voice:
 * `synth/fmProcessorDrive.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { DriveSettings } from '../../patch/patch';
import { DRIVE_DSP, DRIVE_SHAPERS } from '../../inserts/advancedDriveConstants';
import { DriveShaper } from '../../inserts/advancedDriveCurves';
import { DRIVE_DIODE_KNEE, DRIVE_TUBE_EVEN } from './fmConstants';
import { DRIVE_GAIN_RANGE } from './patchDefaults';
import { DRIVE_SHAPE } from './modeIds';
import type { Voice } from './voice';
import { VoiceDrive, updateVoiceDrive } from './voiceDrive';

const SR = 48000;
const SHAPES = Object.entries(DRIVE_SHAPE);

/** A voice as far as `updateVoiceDrive` reads one. */
function driveFor(settings: Partial<DriveSettings>): VoiceDrive {
  const drive = new VoiceDrive();
  const patch = {
    drive: { on: true, gain: 1, shape: DRIVE_SHAPE.SOFT, bias: 0, tone: 1, ...settings },
  };
  updateVoiceDrive({ patch, drive, sr: SR } as unknown as Voice);
  return drive;
}

const curveOf = (shape: number, x: number): number => {
  const drive = new VoiceDrive();
  drive.shape = shape;
  drive.point = x;
  drive.curve();
  return drive.point;
};

/** The filter's drive before windsor#300 (`svf.ts`'s `softClip`), as it was written. */
function formerSoftClip(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  return (x * (27 + x * x)) / (27 + 9 * x * x);
}

/** −8 … 8 in steps that land on and between the curves' corners. */
const SWEEP = Array.from({ length: 6401 }, (_, i) => (i - 3200) / 400);

describe('the drive shapes (windsor#300)', () => {
  it('numbers its shapes in the order the patch names them', () => {
    expect(SHAPES.map(([name]) => name)).toEqual(['SOFT', 'HARD', 'DIODE', 'TUBE', 'FOLD']);
  });

  it("plays soft as the filter's former soft clip, to the bit", () => {
    for (const x of SWEEP)
      expect(Object.is(curveOf(DRIVE_SHAPE.SOFT, x), formerSoftClip(x))).toBe(true);
  });

  it("shares Advanced Drive's constants for the diode and the tube", () => {
    expect(DRIVE_TUBE_EVEN).toBe(DRIVE_DSP.tubeEven);
    expect(DRIVE_DIODE_KNEE).toBe(DRIVE_DSP.diodeKnee);
  });

  it.each(['hard', 'diode', 'tube', 'fold'] as const)(
    "plays %s as Advanced Drive's curve of that name",
    (name) => {
      const shaper = new DriveShaper();
      shaper.name = DRIVE_SHAPERS[DRIVE_SHAPERS.indexOf(name)]!;
      const id = DRIVE_SHAPE[name.toUpperCase() as keyof typeof DRIVE_SHAPE];
      const wide = [...SWEEP, 1e-9, -3e-7, 2 ** -20, 5e5, -2e6, 37.25];
      for (const x of wide) {
        shaper.point = x;
        shaper.curve();
        // Relative to |x| past 1: Advanced Drive's fold takes sin(πx/2), which rounds there.
        expect(Math.abs(curveOf(id, x) - shaper.point)).toBeLessThan(
          1e-13 * Math.max(1, Math.abs(x)),
        );
      }
    },
  );
});

describe('the drive stage at its bounds (windsor#308)', () => {
  const INPUTS = [1, -1, 1e6, -1e6, 1e300, -1e300, Number.MAX_VALUE, -Number.MAX_VALUE];

  it.each(SHAPES)(
    'keeps %s finite at the largest gain, either bias, any finite input',
    (_n, shape) => {
      for (const bias of [-1, 1]) {
        const drive = driveFor({ gain: DRIVE_GAIN_RANGE.max, shape, bias });
        expect(Number.isFinite(drive.offset)).toBe(true);
        for (const x of INPUTS) {
          // What the loops compute: shape(x · gain + bias) − offset; past 1e306 the operand is ±∞.
          const y = curveOf(shape, x * drive.gain + bias) - drive.offset;
          expect(Number.isFinite(y), `x ${x}, bias ${bias}`).toBe(true);
        }
      }
    },
  );

  it('folds an infinite operand to 0 and a huge finite one to a finite value', () => {
    expect(curveOf(DRIVE_SHAPE.FOLD, Infinity)).toBe(0);
    expect(curveOf(DRIVE_SHAPE.FOLD, -Infinity)).toBe(0);
    expect(Number.isFinite(curveOf(DRIVE_SHAPE.FOLD, Number.MAX_VALUE))).toBe(true);
  });
});

describe("the drive's control half (windsor#300)", () => {
  it('is bypassed at unity gain with no bias, whatever the shape and tone', () => {
    expect(driveFor({ shape: DRIVE_SHAPE.FOLD, tone: 0 }).on).toBe(false);
    expect(driveFor({ gain: 2 }).on).toBe(true);
    expect(driveFor({ bias: -0.2 }).on).toBe(true);
    expect(driveFor({ gain: 2 }).toned).toBe(false);
    expect(driveFor({ gain: 2, tone: 0.5 }).toned).toBe(true);
  });

  it("is bypassed when the patch's switch is off, whatever the gain, bias and tone (windsor#309)", () => {
    const off = driveFor({ on: false, gain: 4, shape: DRIVE_SHAPE.TUBE, bias: 0.5, tone: 0.2 });
    expect(off.on).toBe(false);
    expect(off.toned).toBe(false);
    expect(off.toneState).toBe(0);
    // On at unity with no bias still does nothing, so it still costs nothing.
    expect(driveFor({ on: true, tone: 0 }).on).toBe(false);
  });

  it.each(SHAPES)(
    'takes its offset from the same curve at the bias for %s, so silence stays silent',
    (_n, shape) => {
      for (const bias of [-1, -0.3, 0.3, 1]) {
        const drive = driveFor({ gain: 3, shape, bias });
        // What the loops compute for a silent sample: shape(0 * gain + bias) - offset.
        expect(curveOf(shape, 0 * drive.gain + bias) - drive.offset).toBe(0);
      }
    },
  );

  it('sets the tone pole from about 1 kHz at 0, an octave per 1/4.25 above', () => {
    const coef = (hz: number): number => {
      const g = (Math.PI * hz) / SR;
      return g / (1 + g);
    };
    expect(driveFor({ gain: 2, tone: 0 }).toneCoef).toBeCloseTo(coef(1000), 12);
    expect(driveFor({ gain: 2, tone: 1 / 4.25 }).toneCoef).toBeCloseTo(coef(2000), 12);
  });

  it('keeps no tone state while the pole is not running', () => {
    const drive = driveFor({ gain: 2, tone: 0.2 });
    drive.toneState = 0.4;
    const voice = {
      patch: { drive: { on: true, gain: 2, shape: 0, bias: 0, tone: 1 } },
      drive,
      sr: SR,
    };
    updateVoiceDrive(voice as unknown as Voice);
    expect(drive.toneState).toBe(0);
  });
});
