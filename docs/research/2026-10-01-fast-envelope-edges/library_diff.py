"""windsor#301: every library patch rendered on two checkouts, and what moved.

Usage (Python 3.12+ with scripts/sound-match/requirements.txt, Node 24):

    python library_diff.py <before root> <after root> [out.json]

Each root is a checkout (or a `git archive` of `packages/engine/src` and
`scripts/sound-match`) whose `worklet/generated/fm-processor.js` is built.
Every patch in the after root's `packages/engine/src/patches/` is rendered on
both through that root's `scripts/sound-match/render.mjs --server`: C4 (the
percussion note), velocity 1, seed 1, 2 s, note-off at 0.5 s so a release is
heard. For each patch that differs by a bit it prints the peak absolute
difference (linear, and in dB re the before render's peak) and the change in
level above 2 kHz over the first 5 ms from the note-on, measured as
`compare.py` measures its "above 2 kHz" line: the sound-match bands at and
above 2 kHz (zero-phase Butterworth), their RMS powers summed.
"""

import sys

sys.dont_write_bytecode = True

import json
import os
import subprocess

import numpy as np

BEFORE, AFTER = (os.path.abspath(p) for p in sys.argv[1:3])
OUT = sys.argv[3] if len(sys.argv) > 3 else None
sys.path.insert(0, os.path.join(AFTER, "scripts", "sound-match"))

import analyze  # noqa: E402
import constants as C  # noqa: E402

NOTE, VELOCITY, SECONDS, GATE, SEED = 60, 1.0, 2.0, 0.5, 1
EDGE_MS = 5.0
TINY = 1e-30


class Server:
    """One `render.mjs --server` of a root."""

    def __init__(self, root):
        mjs = os.path.join(root, "scripts", "sound-match", "render.mjs")
        self.proc = subprocess.Popen(["node", mjs, "--server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def render(self, patch):
        request = dict(patch=patch, note=NOTE, velocity=VELOCITY, seconds=SECONDS, gate=GATE, seed=SEED)
        self.proc.stdin.write((json.dumps(request) + "\n").encode())
        self.proc.stdin.flush()
        header = json.loads(self.proc.stdout.readline())
        if not header.get("ok"):
            raise RuntimeError(header.get("error"))
        return np.frombuffer(self.proc.stdout.read(header["frames"] * 4), dtype="<f4").astype(np.float64)

    def close(self):
        self.proc.stdin.close()
        self.proc.wait()


def high_db(x):
    """Level above 2 kHz over the first EDGE_MS, in dB: compare.py's sum of the high bands."""
    bands = analyze.band_signals(x)
    end = int(EDGE_MS * C.SR / 1000)
    power = 0.0
    for k, (_, lo, _) in enumerate(C.BANDS):
        if lo is not None and lo >= C.HIGH_BAND_HZ:
            power += float(np.mean(bands[k][:end] ** 2))
    return 10 * np.log10(max(power, TINY))


def main():
    patches_dir = os.path.join(AFTER, "packages", "engine", "src", "patches")
    ids = sorted(f[:-5] for f in os.listdir(patches_dir) if f.endswith(".json"))
    before, after = Server(BEFORE), Server(AFTER)
    rows, same = [], []
    for pid in ids:
        with open(os.path.join(patches_dir, f"{pid}.json")) as f:
            patch = json.load(f)["patch"]
        a, b = before.render(patch), after.render(patch)
        if np.array_equal(a, b):
            same.append(pid)
            continue
        peak = float(np.max(np.abs(a))) or TINY
        diff = float(np.max(np.abs(b - a)))
        rows.append(
            dict(
                id=pid,
                peak_diff=diff,
                peak_diff_db=20 * np.log10(max(diff, TINY) / peak),
                high5_before_db=high_db(a),
                high5_after_db=high_db(b),
            )
        )
    before.close()
    after.close()
    rows.sort(key=lambda r: -r["peak_diff"])
    print(f"{len(ids)} patches: {len(rows)} changed, {len(same)} bit-identical\n")
    print("| Patch | Peak abs. difference | re its peak | Above 2 kHz, 0–5 ms |")
    print("|---|---|---|---|")
    for r in rows:
        delta = r["high5_after_db"] - r["high5_before_db"]
        print(f"| `{r['id']}` | {r['peak_diff']:.4f} | {r['peak_diff_db']:+.1f} dB | {delta:+.1f} dB |")
    print("\nbit-identical: " + ", ".join(f"`{s}`" for s in same))
    if OUT:
        with open(OUT, "w") as f:
            json.dump(dict(changed=rows, same=same), f, indent=1)


main()
