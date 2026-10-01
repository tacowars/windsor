"""The snares' noise against their recordings: band shape, and level by band (windsor#361).

    python snarenoise.py REF.wav PATCH [PATCH ...]

Run from a toolkit folder (`scripts/sound-match/`, or a mirror `build.py`
wrote, for a patch with the noise fields) with the toolkit's venv. Each
patch is rendered over noise seeds 1–4 and the mean is shown. Both sides
start 2 samples before the first sample above −40 dB re peak and are
normalised to their peak, as windsor#353's readings were.

- **Band shape** (windsor#353's measure, `docs/research/2026-10-01-tr-snare-fit/`):
  Welch spectra (512 points) over 5–30 and 30–80 ms, third-octave bins from
  500 Hz; over 1–15 kHz, each side's mean removed, the candidate minus the
  recording per bin, and the RMS of that (the shape error).
- **Level by band**: the power in 2–6, 6–10 and 10–24 kHz over 0–5, 5–30,
  30–80 and 80–150 ms, dB re the peak; the recording's, then each patch's
  minus the recording's. And the slope of the third-octave spectrum over
  2–16 kHz across 5–80 ms (least squares, dB per octave).
"""

import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())

import warnings  # noqa: E402

import numpy as np  # noqa: E402
from scipy.signal import welch  # noqa: E402

import audio  # noqa: E402
import renderer as R  # noqa: E402

SR = 48000
SEEDS = (1, 2, 3, 4)
RENDER_SECONDS = 0.3
ONSET_DB = -40
LEAD = 2
EDGES = [500 * 2 ** (k / 3) for k in range(0, 17)]
CENTRES = np.array([np.sqrt(a * b) for a, b in zip(EDGES[:-1], EDGES[1:])])
SEL = (CENTRES > 1000) & (CENTRES < 15000)
SHAPE_SPANS = ((5, 30), (30, 80))
LEVEL_SPANS = ((0, 5), (5, 30), (30, 80), (80, 150))
LEVEL_BANDS = ((2000, 6000), (6000, 10000), (10000, 24000))
SLOPE_EDGES = [2000 * 2 ** (k / 3) for k in range(0, 10)]
SLOPE_SPAN = (5, 80)


def onset(x):
    x = np.asarray(x, dtype=np.float64)
    peak = np.max(np.abs(x))
    on = int(np.argmax(np.abs(x) > peak * 10 ** (ONSET_DB / 20)))
    return x[max(0, on - LEAD) :] / peak


def span(x, a, b, nperseg=512):
    seg = x[int(a * SR / 1000) : int(b * SR / 1000)]
    return welch(seg, SR, nperseg=min(nperseg, len(seg)))


def shapes(x):
    out = []
    for a, b in SHAPE_SPANS:
        f, p = span(x, a, b)
        row = np.array([10 * np.log10(np.mean(p[(f >= lo) & (f < hi)])) for lo, hi in zip(EDGES[:-1], EDGES[1:])])
        out.append(row[SEL] - np.mean(row[SEL]))
    return out


def levels(x):
    out = []
    for a, b in LEVEL_SPANS:
        f, p = span(x, a, b)
        out += [10 * np.log10(np.sum(p[(f >= lo) & (f < hi)]) * (f[1] - f[0]) + 1e-20) for lo, hi in LEVEL_BANDS]
    f, p = span(x, *SLOPE_SPAN)
    cs = [np.sqrt(a * b) for a, b in zip(SLOPE_EDGES[:-1], SLOPE_EDGES[1:])]
    db = [10 * np.log10(np.mean(p[(f >= a) & (f < b)])) for a, b in zip(SLOPE_EDGES[:-1], SLOPE_EDGES[1:])]
    return np.array(out + [np.polyfit(np.log2(cs), db, 1)[0]])


def label(path):
    base = os.path.splitext(os.path.basename(path))[0]
    return os.path.basename(os.path.dirname(path)) if base == "best" else base


def main():
    warnings.filterwarnings("ignore")
    ref = onset(audio.load_wav(sys.argv[1]))
    ref_shapes, ref_levels = shapes(ref), levels(ref)
    cols = [f"{a}–{b} ms {lo // 1000}–{hi // 1000}k" for a, b in LEVEL_SPANS for lo, hi in LEVEL_BANDS]
    shape_rows, level_rows = [], []
    with R.Renderer() as r:
        for path in sys.argv[2:]:
            patch = R.load_patch(path)
            xs = [onset(r.render(patch, seconds=RENDER_SECONDS, seed=s)) for s in SEEDS]
            diffs = [[c - rs for c, rs in zip(shapes(x), ref_shapes)] for x in xs]
            for k, (a, b) in enumerate(SHAPE_SPANS):
                d = [row[k] for row in diffs]
                err = np.mean([np.sqrt(np.mean(v**2)) for v in d])
                shape_rows.append(f"  {label(path)[:24]:24s} {a:2d}–{b:2d} ms "
                                  + " ".join(f"{v:+5.1f}" for v in np.mean(d, axis=0)) + f"   error {err:.2f} dB")
            lv = np.mean([levels(x) for x in xs], axis=0)
            level_rows.append(f"  {label(path)[:24]:24s} " + " ".join(f"{v:+7.1f}" for v in (lv - ref_levels)[:-1])
                              + f"   {lv[-1]:+.1f} dB/oct")
    print(f"{os.path.basename(sys.argv[1])}: band shape, candidate − recording per third-octave (kHz)")
    print(f"  {'':24s} {'':8s} " + " ".join(f"{c / 1000:5.1f}" for c in CENTRES[SEL]))
    print("\n".join(shape_rows))
    print("level by band, dB re peak (recording) and candidate − recording; slope 2–16 kHz over 5–80 ms")
    print(f"  {'':24s} " + " ".join(f"{c[: c.index(' ms')]:>7s}" for c in cols))
    print(f"  {'':24s} " + " ".join(f"{c[c.index(' ms') + 4 :]:>7s}" for c in cols))
    print(f"  {'recording':24s} " + " ".join(f"{v:7.1f}" for v in ref_levels[:-1]) + f"   {ref_levels[-1]:+.1f} dB/oct")
    print("\n".join(level_rows))


if __name__ == "__main__":
    main()
