"""The clap's structure: its bursts, its tail and the noise colour of each.

Run from `scripts/sound-match/` (it imports the toolkit's loader):

    python ../../docs/research/2026-10-01-tr-clap-fit/structure.py REF.wav [CANDIDATE.wav ...] [--json OUT]

A clap is a few short noise bursts and then a longer "reverb" tail. Each
segment runs from one onset to the next; an onset is a rise of at least
`RISE_DB` in the 0.25 ms peak envelope over its previous millisecond's
minimum, above `FLOOR_DB` of the file's peak and inside its first
`BURSTS_WITHIN_MS` (the tail's own flutter is not a burst). Per segment it prints the onset, the gap from the previous one,
the peak and first-millisecond RMS re the file's peak, how long the RMS
takes to fall 10 and 20 dB from its first millisecond, and the colour of
its noise: the spectral peak, the -3 and -6 dB edges about it (1/3-octave
smoothed), the centroid, and the bandpass Q the -3 dB width implies. The
last segment (the tail) also gets its -20 and -40 dB times re its own
loudest 5 ms and its decay rate between those.
"""

import argparse
import json
import sys
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path.cwd()))
warnings.filterwarnings("ignore")
from audio import load_wav  # noqa: E402

SR = 48000
BIN_MS = 0.25
RISE_DB = 12.0
MERGE_MS = 4.0
FLOOR_DB = -20.0
BURSTS_WITHIN_MS = 45.0
N_FFT = 8192


def peak_env(x, bin_ms=BIN_MS):
    n = int(round(bin_ms * SR / 1000))
    m = len(x) // n
    e = np.abs(x[: m * n]).reshape(m, n).max(1)
    return 20 * np.log10(e / np.abs(x).max() + 1e-12)


def onsets(x):
    db = peak_env(x)
    per_ms = int(round(1 / BIN_MS))
    found = []
    for i in range(1, len(db)):
        before = db[max(0, i - per_ms) : i].min()
        t = i * BIN_MS
        if t < BURSTS_WITHIN_MS and db[i] > FLOOR_DB and db[i] - before >= RISE_DB:
            if not found or t - found[-1] > MERGE_MS:
                found.append(t)
    if not found or found[0] > 1.0:
        found.insert(0, 0.0)
    # Refine to the first sample above a quarter of the burst's first 2 ms peak.
    out = []
    for t in found:
        a = max(0, int((t - 1) * SR / 1000))
        b = a + int(3 * SR / 1000)
        seg = np.abs(x[a:b])
        out.append((a + int(np.argmax(seg > 0.25 * seg.max()))) / SR * 1000)
    return out


def rms_db(y, ref):
    return 10 * np.log10(np.mean(y**2) / ref**2 + 1e-20)


def fall_times(y, ref):
    """ms for the 0.5 ms RMS to fall 10 and 20 dB below its first millisecond."""
    n = int(SR / 2000)
    m = len(y) // n
    if m < 3:
        return None, None
    r = 10 * np.log10(np.mean(y[: m * n].reshape(m, n) ** 2, axis=1) / ref**2 + 1e-20)
    start = max(r[0], r[1])
    out = []
    for drop in (10, 20):
        below = np.nonzero(r[2:] < start - drop)[0]
        out.append(None if len(below) == 0 else (below[0] + 2) * 0.5)
    return tuple(out)


def colour(y):
    """Spectral peak, -3 / -6 dB edges, centroid and Q of a segment's noise."""
    w = np.hanning(len(y))
    p = np.abs(np.fft.rfft(y * w, max(N_FFT, len(y)))) ** 2
    f = np.fft.rfftfreq(max(N_FFT, len(y)), 1 / SR)
    # 1/3-octave smoothing on a log grid, 200 Hz .. 16 kHz.
    grid = np.geomspace(200, 16000, 400)
    sm = np.array([p[(f >= g * 2 ** (-1 / 6)) & (f < g * 2 ** (1 / 6))].mean() for g in grid])
    db = 10 * np.log10(sm / sm.max() + 1e-20)
    k = int(np.argmax(db))

    def edge(level, step):
        j = k
        while 0 <= j + step < len(grid) and db[j + step] > level:
            j += step
        return grid[j]

    lo3, hi3 = edge(-3, -1), edge(-3, 1)
    lo6, hi6 = edge(-6, -1), edge(-6, 1)
    band = (f >= 100) & (f <= 20000)
    cent = float((f[band] * p[band]).sum() / p[band].sum())
    return {
        "peak_hz": float(grid[k]),
        "minus3_hz": [float(lo3), float(hi3)],
        "minus6_hz": [float(lo6), float(hi6)],
        "centroid_hz": cent,
        "q": float(grid[k] / max(hi3 - lo3, 1.0)),
        "db_at": {str(h): float(db[np.argmin(np.abs(grid - h))]) for h in (500, 1000, 2000, 4000, 8000)},
    }


def tail_times(y, ref):
    n = int(SR * 0.005)
    m = len(y) // n
    r = 10 * np.log10(np.mean(y[: m * n].reshape(m, n) ** 2, axis=1) / ref**2 + 1e-20)
    k = int(np.argmax(r))

    def cross(drop):
        below = np.nonzero(r[k:] < r[k] - drop)[0]
        return None if len(below) == 0 else (k + below[0]) * 5.0

    t20, t40 = cross(20), cross(40)
    rate = None if t20 is None or t40 is None else 20 / (t40 - t20)
    return {"loudest_5ms_at": k * 5.0, "loudest_db": float(r[k]), "minus20_ms": t20, "minus40_ms": t40, "db_per_ms": rate}


def structure(path):
    x = load_wav(path)
    ref = np.abs(x).max()
    on = onsets(x)
    segs = []
    for i, t in enumerate(on):
        a = int(t * SR / 1000)
        b = int(on[i + 1] * SR / 1000) if i + 1 < len(on) else len(x)
        y = x[a:b]
        f10, f20 = fall_times(y, ref)
        seg = {
            "onset_ms": round(t, 2),
            "gap_ms": None if i == 0 else round(t - on[i - 1], 2),
            "peak_db": float(20 * np.log10(np.abs(y).max() / ref)),
            "first_ms_rms_db": rms_db(y[: SR // 1000], ref),
            "fall10_ms": f10,
            "fall20_ms": f20,
            # The burst's colour from its first 8 ms, the tail's from 0–60 and 60–250 ms.
            "colour": colour(y[: int(0.008 * SR)]) if i + 1 < len(on) else colour(y[: int(0.06 * SR)]),
        }
        if i + 1 == len(on):
            seg["colour_late"] = colour(y[int(0.06 * SR) : int(0.25 * SR)])
            seg["tail"] = tail_times(y, ref)
        segs.append(seg)
    return {"file": Path(path).name, "length_ms": len(x) / SR * 1000, "segments": segs}


def show(s):
    print(f"{s['file']}: {s['length_ms']:.0f} ms, {len(s['segments'])} segments")
    print("  onset  gap   peak  1st-ms  -10dB  -20dB | peak  -3 dB band    -6 dB band     centroid  Q    | dB at 0.5 1 2 4 8 kHz")
    for g in s["segments"]:
        c = g["colour"]
        gap = "  — " if g["gap_ms"] is None else f"{g['gap_ms']:4.1f}"
        f10 = "  — " if g["fall10_ms"] is None else f"{g['fall10_ms']:4.1f}"
        f20 = "  — " if g["fall20_ms"] is None else f"{g['fall20_ms']:4.1f}"
        print(
            f"  {g['onset_ms']:5.2f} {gap} {g['peak_db']:6.1f} {g['first_ms_rms_db']:6.1f}  {f10}  {f20} |"
            f" {c['peak_hz']:5.0f} {c['minus3_hz'][0]:5.0f}-{c['minus3_hz'][1]:5.0f}"
            f"  {c['minus6_hz'][0]:5.0f}-{c['minus6_hz'][1]:5.0f}  {c['centroid_hz']:6.0f}  {c['q']:.2f} |"
            + " ".join(f"{v:5.1f}" for v in c["db_at"].values())
        )
    last = s["segments"][-1]
    c = last["colour_late"]
    t = last["tail"]
    print(
        f"  tail 60–250 ms: peak {c['peak_hz']:.0f}, -3 dB {c['minus3_hz'][0]:.0f}-{c['minus3_hz'][1]:.0f},"
        f" -6 dB {c['minus6_hz'][0]:.0f}-{c['minus6_hz'][1]:.0f}, centroid {c['centroid_hz']:.0f}, Q {c['q']:.2f}; dB at 0.5–8 kHz "
        + " ".join(f"{v:.1f}" for v in c["db_at"].values())
    )
    print(
        f"  tail level: loudest 5 ms at +{t['loudest_5ms_at']:.0f} ms ({t['loudest_db']:.1f} dB),"
        f" -20 dB at +{t['minus20_ms']} ms, -40 dB at +{t['minus40_ms']} ms,"
        f" {t['db_per_ms'] and round(t['db_per_ms'], 3)} dB/ms"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wavs", nargs="+")
    ap.add_argument("--json")
    a = ap.parse_args()
    out = [structure(p) for p in a.wavs]
    for s in out:
        show(s)
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
