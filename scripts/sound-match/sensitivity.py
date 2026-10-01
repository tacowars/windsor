"""Which control moves which measurement: a sensitivity map.

    python sensitivity.py spec.json PATCH [--step 0.05] [--ref 0] [--json out.json]

Each of the spec's parameters is moved by ±step of its range (in its scale,
linear or log) from its value in PATCH (a library id, a patch file or a fit's
best.json), and the patch is rendered as the spec's reference --ref plays it.
The table shows, per headline measurement, how far it moves per +step: half
the difference between the +step and −step renders. Seed-dependent renders
use the same seeds on both sides and are averaged. The JSON (default
<tmp>/sound-match/sensitivity-<spec>.json) holds both sides.
"""

import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts; the repo does not ignore it

import argparse
import json
import os
import tempfile
import warnings

import numpy as np

import comparison
import constants as C
import regions
import renderer as R
import spec as S
from analyze import jsonable

SHORT = {"0–5 ms": "0-5", "5–30 ms": "5-30", "30–150 ms": "30-150", "tail": "tail"}


def headline(m):
    """The measurements the map tracks, as {name: (value, unit)}; Hz rows move in semitones."""
    out = {
        "-20 dB time": (m["level"]["decay_ms"]["-20"], "ms"),
        "-40 dB time": (m["level"]["decay_ms"]["-40"], "ms"),
        "click peak": (m["click"]["peak_db"], "dB"),
        "pitch at 10 ms": (regions.pitch_at(m["pitch"], 10.0), "Hz"),
        "pitch at 40 ms": (regions.pitch_at(m["pitch"], 40.0), "Hz"),
        "body H2": (m["body"]["harm_db"][1], "dB"),
        "body H3": (m["body"]["harm_db"][2], "dB"),
        "body neg/pos peak": (m["body"]["neg_pos_peak"], "x"),
    }
    for r in m["regions"]:
        name = SHORT.get(r["name"], r["name"])
        out[f"centroid {name}"] = (r["centroid_hz"], "Hz")
        for (band, _, _), level in zip(C.BANDS, r["bands_db"]):
            out[f"{band} {name}"] = (level, "dB")
    return out


def _mean_headline(cands):
    rows = [headline(c.m) for c in cands]
    return {k: (float(np.nanmean([r[k][0] for r in rows])), rows[0][k][1]) for k in rows[0]}


def _delta(a, b, unit):
    if not (np.isfinite(a) and np.isfinite(b)):
        return float("nan")
    if unit == "Hz":
        return 12 * np.log2(a / b) if a > 0 and b > 0 else float("nan")
    return a - b


def arguments():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("patch")
    ap.add_argument("--step", type=float, default=0.05, help="share of each parameter's range")
    ap.add_argument("--ref", type=int, default=0, help="which reference's note, velocity and gate to play")
    ap.add_argument("--json")
    return ap.parse_args()


def table(params, base, sides):
    """Rows of measurements, a column per parameter: the move per +step."""
    width = max(len(k) for k in base) + 2
    head = "".join(f"{f'p{i + 1}':>9s}" for i in range(len(params)))
    lines = [f"{'measurement':<{width}s}{'unit':>5s}{'base':>10s}{head}"]
    for key, (value, unit) in base.items():
        cells = []
        for plus, minus in sides:
            d = (_delta(plus[key][0], value, unit) - _delta(minus[key][0], value, unit)) / 2
            cells.append(f"{d:+9.2f}" if np.isfinite(d) else f"{'—':>9s}")
        lines.append(f"{key:<{width}s}{unit:>5s}{value:10.2f}{''.join(cells)}")
    return lines


def main():
    warnings.filterwarnings("ignore", message="Chunk")
    args = arguments()
    sp = S.load(args.spec)
    ref = sp.references[args.ref]
    patch = R.load_patch(args.patch)
    values = S.start_values(patch, sp.params)
    with R.Renderer() as r:
        seeds = R.seed_list(r, patch, ref.render_options, sp.seeds, sp.seed_base)

        def measure(p):
            return _mean_headline(comparison.render_candidates(r, p, ref, seeds, sp.candidate_align))

        base = measure(patch)
        sides, moves = [], []
        for i, prm in enumerate(sp.params):
            u = prm.to_unit(values[i])
            pair = []
            for sign in (1, -1):
                v = list(values)
                v[i] = prm.from_unit(u + sign * args.step)
                pair.append((v[i], measure(S.apply(patch, sp.params, v))))
            sides.append((pair[0][1], pair[1][1]))
            moves.append(dict(param=prm.name, base=values[i], plus=pair[0][0], minus=pair[1][0]))
    lines = [f"{os.path.basename(args.patch)} as {ref.name} plays it (note {ref.note}, velocity {ref.velocity});"]
    lines.append(f"seeds {seeds}; step {args.step} of each range; cells: move per +step (semitones for Hz rows)")
    lines += [f"  p{i + 1} {m['param']} = {m['base']:.6g} (+step {m['plus']:.6g}, −step {m['minus']:.6g})" for i, m in enumerate(moves)]
    lines += table(sp.params, base, sides)
    print("\n".join(lines))
    path = args.json or os.path.join(tempfile.gettempdir(), "sound-match", f"sensitivity-{sp.name}.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = dict(base=base, params=[dict(m, plus_values=s[0], minus_values=s[1]) for m, s in zip(moves, sides)])
    with open(path, "w") as f:
        json.dump(jsonable(data), f, indent=1)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
