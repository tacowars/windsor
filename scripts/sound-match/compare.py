"""The diagnostic report: one candidate against one or more references.

    python compare.py REF.wav [REF.wav ...] CANDIDATE [options]

CANDIDATE is the last argument: a WAV, or a patch (a library id such as
`tr909-kick`, a library file or a bare patch JSON), which is rendered through
the shipped worklet for each reference. A patch whose render depends on the
seed (a Noise operator, a free-running phase, a random LFO) is rendered over
several seeds (--seeds N forces the count);
the report shows the mean and the scores' spread.

Each reference gets one block of text. The same, as JSON, goes to --json
(default: <tmp>/sound-match/compare/<candidate>.json); --png adds overlays.
"""

import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts; the repo does not ignore it

import argparse
import json
import os
import tempfile
import warnings

import audio
import comparison
import constants as C
import plot
import renderer as R
import report
from analyze import jsonable


def parse_weights(text):
    """`stft=1,wave=5` as a dict."""
    if not text:
        return None
    return {k: float(v) for k, v in (pair.split("=") for pair in text.split(","))}


def arguments():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="references, then the candidate")
    ap.add_argument("--note", type=int, default=60)
    ap.add_argument("--velocity", type=float, default=1.0)
    ap.add_argument("--gate", type=float, default=None, help="note-off after this many seconds (default: none)")
    ap.add_argument("--seconds", type=float, default=None, help="render length (default: the reference's)")
    ap.add_argument("--seeds", type=int, help="force this many seeds (default: automatic, see README)")
    ap.add_argument("--seed-base", type=int, default=C.SEED_BASE)
    ap.add_argument("--ref-threshold-db", type=float, default=C.ALIGN_THRESHOLD_DB)
    ap.add_argument("--ref-lead-ms", type=float, default=C.ALIGN_LEAD_MS)
    ap.add_argument("--cand-threshold-db", type=float, default=None, help="default: the reference's")
    ap.add_argument("--cand-lead-ms", type=float, default=None, help="default: the reference's")
    ap.add_argument("--norm", choices=("peak", "rms"), default=C.NORM)
    ap.add_argument("--tonal", choices=("auto", "yes", "no"), default="auto")
    ap.add_argument("--weights", help="score weights, e.g. stft=1,band=0.05,wave=5")
    ap.add_argument("--json", help="JSON output path")
    ap.add_argument("--png", nargs="?", const="", help="write overlays (optionally to this path prefix)")
    return ap.parse_args()


def references(args):
    tonal = {"auto": "auto", "yes": True, "no": False}[args.tonal]
    align = audio.Align(args.ref_threshold_db, args.ref_lead_ms)
    return [
        comparison.Reference(
            wav=path,
            note=args.note,
            velocity=args.velocity,
            gate=args.gate,
            seconds=args.seconds,
            align=align,
            tonal=tonal,
            norm=args.norm,
        )
        for path in args.files[:-1]
    ]


def candidates(args, refs):
    """Per reference, the candidate renders (or the candidate recording); and the label."""
    source = args.files[-1]
    align = audio.Align(
        args.ref_threshold_db if args.cand_threshold_db is None else args.cand_threshold_db,
        args.ref_lead_ms if args.cand_lead_ms is None else args.cand_lead_ms,
    )
    if source.lower().endswith(".wav"):
        x = audio.load_wav(source)
        return [[comparison.candidate(ref, x, None, align)] for ref in refs], os.path.basename(source)
    patch = R.load_patch(source)
    out = []
    with R.Renderer() as r:
        for ref in refs:
            seeds = R.seed_list(r, patch, ref.render_options, args.seeds, args.seed_base)
            out.append(comparison.render_candidates(r, patch, ref, seeds, align))
    return out, os.path.basename(source)


def main():
    warnings.filterwarnings("ignore", message="Chunk")  # packs carry chunks scipy skips
    args = arguments()
    if len(args.files) < 2:
        raise SystemExit("give at least one reference and a candidate")
    out_dir = os.path.join(tempfile.gettempdir(), "sound-match", "compare")
    os.makedirs(out_dir, exist_ok=True)
    refs = references(args)
    per_ref, label = candidates(args, refs)
    weights = parse_weights(args.weights)
    blocks = []
    for i, (ref, cands) in enumerate(zip(refs, per_ref)):
        data, text = report.build(ref, cands, label, weights, forced=args.seeds is not None)
        blocks.append(data)
        print(text)
        print()
        if args.png is not None:
            prefix = args.png or os.path.join(out_dir, os.path.splitext(label)[0])
            path = f"{prefix}-{i + 1}.png"
            plot.overlay(path, ref, cands[0], f"{ref.name} against {label}")
            print(f"wrote {path}")
    path = args.json or os.path.join(out_dir, f"{os.path.splitext(label)[0]}.json")
    with open(path, "w") as f:
        json.dump(jsonable(blocks), f, indent=1)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
