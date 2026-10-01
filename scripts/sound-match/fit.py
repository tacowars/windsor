"""Fit a patch's numbers to one or more recordings.

    python fit.py spec.json [--budget N] [--method cma|nelder-mead] [--out-dir DIR]

The spec (`spec.py`) names the start patch, the parameters and their bounds,
the references and the weights. The objective is the weighted mean, over
references, of each reference's total score averaged over seeds (a render
that does not depend on the seed is scored once). Parameters are searched in
[0, 1] per parameter, linear or log as the spec says.

CMA-ES (`cma`) is the default; Nelder–Mead (scipy) is available. The start
patch is scored first and kept if nothing beats it, so a fit never ends worse
than it began. A start value outside its bounds is clipped to them (with a
warning) before that first score, so the start is a point the search can
reach and best.json stays within the bounds. Writes, to --out-dir (default <tmp>/sound-match/fit-<spec>):

- best.json:   the best patch, bare;
- log.jsonl:   every evaluation: its parameters, total and per-reference scores;
- summary.json: start and best scores, evaluations, renders, wall time.
"""

import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts; the repo does not ignore it

import argparse
import json
import os
import tempfile
import time
import warnings

import cma
import numpy as np
import scipy.optimize as so

import comparison
import renderer as R
import score
import spec as S
from analyze import jsonable


class Objective:
    """Scores patches against the spec's references and keeps the best."""

    def __init__(self, sp, renderer, log):
        self.sp, self.r, self.log = sp, renderer, log
        self.seeds = [
            R.seed_list(renderer, sp.start, ref.render_options, sp.seeds, sp.seed_base) for ref in sp.references
        ]
        self.evals = 0
        self.best = None

    def score_patch(self, patch):
        """The weighted total, and per reference the mean of each score over seeds."""
        per_ref, weighted, weight = [], 0.0, 0.0
        for ref, seeds in zip(self.sp.references, self.seeds):
            cands = comparison.render_candidates(self.r, patch, ref, seeds, self.sp.candidate_align)
            stats = score.spread([c.scores for c in cands], self.sp.weights)
            per_ref.append({k: v["mean"] for k, v in stats.items()} | {"total_sd": stats["total"]["sd"]})
            weighted += ref.weight * stats["total"]["mean"]
            weight += ref.weight
        return weighted / weight, per_ref

    def __call__(self, unit, values=None):
        """Score one point; `values` overrides the values `unit` maps to (the start's exact values)."""
        values = values or [p.from_unit(u) for p, u in zip(self.sp.params, unit)]
        patch = S.apply(self.sp.start, self.sp.params, values)
        total, per_ref = self.score_patch(patch)
        record = dict(eval=self.evals, total=total, params=dict(zip([p.name for p in self.sp.params], values)))
        record["references"] = per_ref
        self.log.write(json.dumps(jsonable(record)) + "\n")
        if self.best is None or total < self.best["total"]:
            self.best = dict(record, patch=patch)
        self.evals += 1
        return total


def run_cma(f, u0, opt):
    options = {"bounds": [0, 1], "maxfevals": opt["budget"], "seed": opt["seed"], "verbose": -9}
    if opt.get("popsize"):
        options["popsize"] = opt["popsize"]
    es = cma.CMAEvolutionStrategy(u0, opt["sigma0"], options)
    # The start patch's evaluation counts against the budget. CMA learns only
    # from a whole population, so a remainder smaller than one is spent on the
    # first candidates of the next and not told: the best is still kept, and
    # the evaluations never exceed the budget.
    while not es.stop() and f.evals < opt["budget"]:
        xs = es.ask()
        remaining = opt["budget"] - f.evals
        if remaining < len(xs):
            for x in xs[:remaining]:
                f(np.clip(x, 0, 1))
            break
        es.tell(xs, [f(np.clip(x, 0, 1)) for x in xs])


class BudgetSpent(Exception):
    pass


def run_nelder_mead(f, u0, opt):
    """scipy checks `maxfev` only between iterations, so the budget is enforced here."""

    def bounded(u):
        if f.evals >= opt["budget"]:
            raise BudgetSpent
        return f(np.clip(u, 0, 1))

    n = len(u0)
    simplex = [u0] + [np.clip(u0 + opt["sigma0"] * np.eye(n)[i] * (1 if u0[i] < 0.5 else -1), 0, 1) for i in range(n)]
    try:
        so.minimize(
            bounded,
            u0,
            method="Nelder-Mead",
            options=dict(maxfev=opt["budget"], initial_simplex=np.array(simplex), adaptive=True, xatol=1e-4, fatol=1e-6),
        )
    except BudgetSpent:
        pass


def arguments():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--budget", type=int, help="evaluations (overrides the spec)")
    ap.add_argument("--method", choices=("cma", "nelder-mead"), help="overrides the spec")
    ap.add_argument("--out-dir")
    return ap.parse_args()


def _ref_lines(label, per_ref, refs):
    keys = ("stft", "band", "harm", "pitch", "wave", "total")
    lines = [f"{label}:"]
    for ref, s in zip(refs, per_ref):
        parts = " ".join(f"{k} {s[k]:.4f}" for k in keys if k in s)
        lines.append(f"  {ref.name} (note {ref.note}, velocity {ref.velocity}): {parts}")
    return lines


def start_point(sp):
    """The start's values, clipped to the bounds: the first evaluation is a point the search can be at.

    Each clipped parameter, and each tied group whose paths start apart (the
    fit sets them all to the first path's value), gets a warning.
    """
    values = []
    for p in sp.params:
        raw = [float(S.get_path(sp.start, path)) for path in p.paths]
        v = float(np.clip(raw[0], p.lo, p.hi))
        if v != raw[0]:
            print(f"warning: start {p.name} = {raw[0]:.6g} is outside [{p.lo:.6g}, {p.hi:.6g}]; starting at {v:.6g}")
        if any(r != raw[0] for r in raw[1:]):
            tied = ", ".join(f"{path} = {r:.6g}" for path, r in zip(p.paths, raw))
            print(f"warning: tied parameter starts apart ({tied}); starting all at {v:.6g}")
        values.append(v)
    return values


def main():
    warnings.filterwarnings("ignore", message="Chunk")
    args = arguments()
    sp = S.load(args.spec)
    opt = dict(sp.optimizer)
    opt["budget"] = args.budget or opt["budget"]
    opt["method"] = args.method or opt["method"]
    out_dir = args.out_dir or os.path.join(tempfile.gettempdir(), "sound-match", f"fit-{sp.name}")
    os.makedirs(out_dir, exist_ok=True)
    started = time.perf_counter()
    with R.Renderer() as r, open(os.path.join(out_dir, "log.jsonl"), "w") as log:
        f = Objective(sp, r, log)
        values = start_point(sp)
        u0 = np.array([p.to_unit(v) for p, v in zip(sp.params, values)])
        f(u0, values=values)
        start = f.best
        (run_cma if opt["method"] == "cma" else run_nelder_mead)(f, u0, opt)
        renders, render_rate = r.renders, r.rate
    wall = time.perf_counter() - started
    best = f.best
    with open(os.path.join(out_dir, "best.json"), "w") as out:
        json.dump(best["patch"], out, indent=2)
    summary = dict(
        spec=os.path.abspath(args.spec),
        method=opt["method"],
        budget=opt["budget"],
        evaluations=f.evals,
        seeds=f.seeds,
        renders=renders,
        wall_s=wall,
        renders_per_s_wall=renders / wall,
        renders_per_s_renderer=render_rate,
        start=dict(total=start["total"], references=start["references"]),
        best=dict(total=best["total"], eval=best["eval"], params=best["params"], references=best["references"]),
    )
    with open(os.path.join(out_dir, "summary.json"), "w") as out:
        json.dump(jsonable(summary), out, indent=1)
    lines = [f"{sp.name}: {opt['method']}, {f.evals} evaluations, {renders} renders in {wall:.1f} s"]
    lines.append(f"  ({renders / wall:.1f} renders/s overall, {render_rate:.1f} renders/s in the renderer)")
    lines.append(f"total: start {start['total']:.4f}, best {best['total']:.4f} (evaluation {best['eval']})")
    lines += _ref_lines("start", start["references"], sp.references)
    lines += _ref_lines("best", best["references"], sp.references)
    lines.append("best parameters:")
    lines += [f"  {k} = {v:.6g}" for k, v in best["params"].items()]
    lines.append(f"wrote {out_dir}/best.json, log.jsonl, summary.json")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
