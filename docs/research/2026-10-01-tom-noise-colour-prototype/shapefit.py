"""How closely each noise-filter shape can match a recording's snappy band (windsor#361).

    python shapefit.py REF.wav [REF.wav ...]

Run from `scripts/sound-match/` with the toolkit's venv (it uses the toolkit's
WAV loader). No rendering: a Noise operator draws white noise, so its
filtered spectrum is the filter's |H|^2, and each filter family's response is
fitted directly to the recording's band shape, the measure windsor#353 used
(`docs/research/2026-10-01-tr-snare-fit/README.md`): Welch spectra (512
points) over 5–30 and 30–80 ms from the onset, third-octave bins from
500 Hz, the bins over 1–15 kHz with their mean removed. One static filter
must serve both spans, so the error is the RMS over both spans' bins. The
responses are the TPT forms' exactly (the bilinear transform, prewarped at
the cutoff), averaged over each bin as Welch's bins are.

Families: the one-pole lowpass and highpass (windsor#318's prototype), the
two-pole Butterworth pair, the two-pole pair with a resonance on each, and a
two-pole bandpass with its Q. A pair keeps its lowpass at or above its
highpass. Each is fitted by differential evolution over log-scaled cutoffs
(100 Hz–20 kHz), the lowpass-to-highpass ratio and Qs (0.5–8). The error is
a floor for the shape alone: a fitted patch also carries the tones, the
envelope and one noise realisation.
"""

import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())

import warnings  # noqa: E402

import numpy as np  # noqa: E402
from scipy.optimize import differential_evolution  # noqa: E402
from scipy.signal import welch  # noqa: E402

import audio  # noqa: E402

SR = 48000
EDGES = [500 * 2 ** (k / 3) for k in range(0, 17)]
CENTRES = np.array([np.sqrt(a * b) for a, b in zip(EDGES[:-1], EDGES[1:])])
SEL = (CENTRES > 1000) & (CENTRES < 15000)
SPANS = ((5, 30), (30, 80))
ONSET_DB = -40
LEAD = 2
HZ = (100.0, 20000.0)
Q = (0.5, 8.0)
GRID = 64
SEED = 1


def onset(x):
    peak = np.max(np.abs(x))
    on = int(np.argmax(np.abs(x) > peak * 10 ** (ONSET_DB / 20)))
    return x[max(0, on - LEAD):] / peak


def shape(db):
    s = db[SEL]
    return s - np.mean(s)


def reference_shapes(path):
    x = onset(np.asarray(audio.load_wav(path), dtype=np.float64))
    out = []
    for a, b in SPANS:
        f, p = welch(x[int(a * SR / 1000) : int(b * SR / 1000)], SR, nperseg=512)
        out.append(shape(np.array([10 * np.log10(np.mean(p[(f >= lo) & (f < hi)])) for lo, hi in zip(EDGES[:-1], EDGES[1:])])))
    return out


# Each bin's frequencies, for averaging |H|^2 over the bin.
BIN_F = [np.linspace(lo, hi, GRID) for lo, hi in zip(EDGES[:-1], EDGES[1:])]


def omega(f, fc):
    """The bilinear transform's frequency, prewarped at fc."""
    return np.tan(np.pi * f / SR) / np.tan(np.pi * min(fc, 0.45 * SR) / SR)


def lp1(f, fc):
    return np.abs(1 / (1 + 1j * omega(f, fc))) ** 2


def hp1(f, fc):
    w = omega(f, fc)
    return np.abs(1j * w / (1 + 1j * w)) ** 2


def lp2(f, fc, q):
    w = omega(f, fc)
    return np.abs(1 / (1 - w * w + 1j * w / q)) ** 2


def hp2(f, fc, q):
    w = omega(f, fc)
    return np.abs(-w * w / (1 - w * w + 1j * w / q)) ** 2


def bp2(f, fc, q):
    w = omega(f, fc)
    return np.abs((1j * w / q) / (1 - w * w + 1j * w / q)) ** 2


BUTTERWORTH = 1 / np.sqrt(2)
# A pair is (highpass Hz, lowpass / highpass ratio), the lowpass at or above the highpass. Without
# resonance, swapping the two cutoffs changes only the level, never the shape (|H|^2 of each is
# symmetric in f/fc), so nothing is lost by the order.
UNCROSSED = (1.0, 200.0)


def one_pole(f, v):
    return lp1(f, v[0] * v[1]) * hp1(f, v[0])


def two_pole(f, v):
    return lp2(f, v[0] * v[1], BUTTERWORTH) * hp2(f, v[0], BUTTERWORTH)


def two_pole_q(f, v):
    return lp2(f, v[0] * v[1], v[2]) * hp2(f, v[0], v[3])


def bandpass(f, v):
    return bp2(f, v[0], v[1])


def pair_text(v):
    text = f"highpass {v[0]:.0f} Hz, lowpass {v[0] * v[1]:.0f} Hz"
    return text + (f", Q {v[3]:.2f} / {v[2]:.2f}" if len(v) > 2 else "")


FAMILIES = {
    "one-pole LP + HP": ((HZ, UNCROSSED), one_pole, pair_text),
    "two-pole LP + HP": ((HZ, UNCROSSED), two_pole, pair_text),
    "two-pole LP + HP, each with Q": ((HZ, UNCROSSED, Q, Q), two_pole_q, pair_text),
    "two-pole BP with Q": ((HZ, Q), bandpass, lambda v: f"centre {v[0]:.0f} Hz, Q {v[1]:.2f}"),
}


def response_shape(fn, v):
    return shape(np.array([10 * np.log10(np.mean(fn(fb, v)) + 1e-30) for fb in BIN_F]))


def error(fn, v, refs):
    s = response_shape(fn, v)
    return float(np.sqrt(np.mean(np.concatenate([(s - r) ** 2 for r in refs]))))


def fit(bounds, fn, refs):
    logb = [(np.log(lo), np.log(hi)) for lo, hi in bounds]
    res = differential_evolution(lambda u: error(fn, np.exp(u), refs), logb, seed=SEED, tol=1e-8, polish=True)
    return np.exp(res.x), res.fun


def main():
    warnings.filterwarnings("ignore")
    for path in sys.argv[1:]:
        refs = reference_shapes(path)
        print(f"{os.path.basename(path)}: band shape over 1–15 kHz, 5–30 and 30–80 ms")
        flat = float(np.sqrt(np.mean(np.concatenate([r**2 for r in refs]))))
        print(f"  {'white (no filter)':32s} error {flat:.2f} dB")
        for name, (bounds, fn, text) in FAMILIES.items():
            v, err = fit(bounds, fn, refs)
            print(f"  {name:32s} error {err:.2f} dB  at {text(v)}")


if __name__ == "__main__":
    main()
