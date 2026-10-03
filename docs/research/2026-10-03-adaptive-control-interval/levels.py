"""windsor#326: per-window RMS level and band-energy change between two roots, for the most-changed patches.

Usage (the sound-match Python, Node 24): python levels.py <before root> <after root> <id>[,<id>...]
Renders as ../2026-10-01-fast-envelope-edges/library_diff.py does: C4, velocity 1, seed 1, 2 s, note-off at 0.5 s.
"""
import json, os, subprocess, sys
import numpy as np

BEFORE, AFTER = sys.argv[1:3]
IDS = sys.argv[3].split(',')
NOTE, VELOCITY, SECONDS, GATE, SEED = 60, 1.0, 2.0, 0.5, 1
SR = 48000
WIN = int(0.05 * SR)


class Server:
    def __init__(self, root):
        mjs = os.path.join(root, "scripts", "sound-match", "render.mjs")
        self.proc = subprocess.Popen(["node", mjs, "--server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def render(self, patch):
        request = dict(patch=patch, note=NOTE, velocity=VELOCITY, seconds=SECONDS, gate=GATE, seed=SEED)
        self.proc.stdin.write((json.dumps(request) + "\n").encode())
        self.proc.stdin.flush()
        header = json.loads(self.proc.stdout.readline())
        return np.frombuffer(self.proc.stdout.read(header["frames"] * 4), dtype="<f4").astype(np.float64)


def windows(x):
    n = len(x) // WIN
    return x[: n * WIN].reshape(n, WIN)


b, a = Server(BEFORE), Server(AFTER)
for pid in IDS:
    patch = json.load(open(os.path.join(AFTER, "packages/engine/src/patches", pid + ".json")))["patch"]
    x, y = b.render(patch), a.render(patch)
    wx, wy = windows(x), windows(y)
    rx = np.sqrt(np.mean(wx ** 2, axis=1))
    ry = np.sqrt(np.mean(wy ** 2, axis=1))
    peak = rx.max()
    live = rx > peak * 10 ** (-60 / 20)
    level = np.max(np.abs(20 * np.log10(ry[live] / rx[live])))
    # spectral: per-window magnitude spectrum in 1/3-octave-ish bands, max dB change in bands within 40 dB of the window's loudest
    worst_band = 0.0
    edges = 100 * 2 ** (np.arange(0, 8.0, 1 / 3))
    f = np.fft.rfftfreq(WIN, 1 / SR)
    for i in np.nonzero(live)[0]:
        X = np.abs(np.fft.rfft(wx[i] * np.hanning(WIN))) ** 2
        Y = np.abs(np.fft.rfft(wy[i] * np.hanning(WIN))) ** 2
        bx = np.array([X[(f >= lo) & (f < hi)].sum() for lo, hi in zip(edges[:-1], edges[1:])])
        by = np.array([Y[(f >= lo) & (f < hi)].sum() for lo, hi in zip(edges[:-1], edges[1:])])
        keep = bx > bx.max() * 1e-4
        if keep.any():
            worst_band = max(worst_band, float(np.max(np.abs(10 * np.log10(by[keep] / bx[keep])))))
    print(f"{pid}: 50 ms RMS within {level:.2f} dB; third-octave bands within 40 dB of the loudest: {worst_band:.2f} dB")
