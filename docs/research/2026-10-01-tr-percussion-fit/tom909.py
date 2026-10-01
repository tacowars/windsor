"""The 909 tom's glide and noise readings against its recording (windsor#318).

    python tom909.py REF.wav PATCH [PATCH ...] [--seeds 4]

Run from `scripts/sound-match/` with the toolkit's venv, as `fit.py` is:
`python ../../docs/research/2026-10-01-tr-percussion-fit/tom909.py ...`.

The toolkit's zero-crossing pitch track reads the beat of the 909 tom's two
inharmonic tones, not either tone, so the glide is read from spectral peaks
instead: a Hann window around each time, zero-padded to a 0.05 Hz grid, and
the strongest peak between 40 and 300 Hz (the upper tone, which leads in
every window). Early windows are short, to follow the glide, and cannot
part the two tones; the late ones are long enough to, and also give the
lower tone. The noise reading is the toolkit's own region band level,
2–6 kHz, at 0–5 and 30–150 ms. Both sides are aligned and normalised as
`compare.py` does; a patch is the mean over seeds 1..N.
"""

import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())

import numpy as np  # noqa: E402

import analyze  # noqa: E402
import audio  # noqa: E402
import comparison  # noqa: E402
import constants as C  # noqa: E402
import renderer as R  # noqa: E402

# (time read, window start, window end), ms.
GLIDE_WINDOWS = ((10, 0, 20), (30, 20, 40), (100, 70, 130), (300, 240, 360))
PEAK_RANGE_HZ = (40.0, 300.0)
FFT_SIZE = 1 << 20
NOISE_BAND = "2–6k"
NOISE_REGIONS = ("0–5 ms", "30–150 ms")


def peaks(x, t0, t1, count=2):
    """The `count` strongest spectral peaks in PEAK_RANGE_HZ over x[t0:t1] ms, strongest first."""
    seg = x[int(t0 * C.SR / 1000) : int(t1 * C.SR / 1000)]
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), FFT_SIZE))
    fr = np.fft.rfftfreq(FFT_SIZE, 1 / C.SR)
    m = (fr > PEAK_RANGE_HZ[0]) & (fr < PEAK_RANGE_HZ[1])
    s, f = sp[m], fr[m]
    is_peak = np.r_[False, (s[1:-1] > s[:-2]) & (s[1:-1] >= s[2:]), False]
    idx = np.where(is_peak)[0]
    idx = idx[np.argsort(-s[idx])][:count]
    return [(float(f[i]), float(20 * np.log10(s[i] / s[idx[0]]))) for i in idx]


def readings(x, signal):
    m = analyze.measure(signal)
    names = [b[0] for b in C.BANDS]
    k = names.index(NOISE_BAND)
    noise = {r["name"]: r["bands_db"][k] for r in m["regions"] if r["name"] in NOISE_REGIONS}
    glide = {t: peaks(x, a, b) for t, a, b in GLIDE_WINDOWS}
    return glide, noise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("patches", nargs="+")
    ap.add_argument("--seeds", type=int, default=4)
    a = ap.parse_args()
    ref = comparison.Reference(wav=a.ref)
    rg, rn = readings(ref.signal.x, ref.signal)
    print("reference:")
    for t, pk in rg.items():
        print(f"  {t:3d} ms  " + "  ".join(f"{f:6.1f} Hz ({d:+.0f} dB)" for f, d in pk))
    print("  2–6 kHz: " + "  ".join(f"{k} {v:.1f} dB" for k, v in rn.items()))
    with R.Renderer() as r:
        for src in a.patches:
            patch = R.load_patch(src)
            glides, noises = [], []
            for seed in range(1, a.seeds + 1):
                x = r.render(patch, seed=seed, **ref.render_options)
                sig = audio.prepare(x, ref.align, ref.norm, length=len(ref.signal.x))
                g, n = readings(sig.x, sig)
                glides.append(g)
                noises.append(n)
            print(f"{src}:")
            for t in rg:
                up = np.mean([g[t][0][0] for g in glides])
                err = 12 * np.log2(up / rg[t][0][0])
                line = f"  {t:3d} ms  upper {up:6.1f} Hz, {err:+.2f} st"
                if t >= 100 and len(rg[t]) > 1:
                    lows = [min(p[0] for p in g[t]) for g in glides]
                    lo = float(np.mean(lows))
                    line += f"; lower {lo:6.1f} Hz, {12 * np.log2(lo / min(p[0] for p in rg[t])):+.2f} st"
                print(line)
            print("  2–6 kHz: " + "  ".join(
                f"{k} {np.mean([n[k] for n in noises]) - rn[k]:+.1f} dB" for k in rn))


if __name__ == "__main__":
    main()
