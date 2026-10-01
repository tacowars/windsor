"""The toolkit's fit.py with windsor#325's two rules added to its objective.

    cd scripts/sound-match
    python ../../docs/research/2026-10-01-tr909-kick-refit/fit_constrained.py SPEC.json [fit.py's options]

- **The level rule** (the spec's `peak`). With the voice drive on, nothing
  after the shaper sets the level, so a kick's peak follows its drive and
  the fit has to hold it. `{"target": <the library patch's peak>,
  "tolerance_db": 0.7, "weight_per_db": 2}` adds `weight_per_db` per dB
  that the render's raw peak (the first reference's conditions, its first
  seed) lies outside `target` ± `tolerance_db`.
- **Score caps** (the spec's optional `caps`). `{"band": 6.0}` with
  `cap_weight` adds `cap_weight` per unit that the first reference's mean
  `band` score lies above 6.0, so a fit can be held to "no component worse
  than the old patch" while it lowers the total.

Everything else is fit.py as committed: this file only wraps its
objective, so `scripts/sound-match/` is unchanged. The logged and printed
per-reference scores are the toolkit's own, without the penalties; the
logged `total` includes them.
"""

import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "scripts", "sound-match"))

import numpy as np  # noqa: E402

import fit  # noqa: E402


def rules(spec_path):
    with open(spec_path) as f:
        raw = json.load(f)
    return raw["peak"], raw.get("caps", {}), raw.get("cap_weight", 1.0)


def main():
    peak, caps, cap_weight = rules(next(a for a in sys.argv[1:] if a.endswith(".json")))
    scored = fit.Objective.score_patch

    def score_patch(self, patch):
        total, per_ref = scored(self, patch)
        ref = self.sp.references[0]
        x = self.r.render(patch, seed=self.seeds[0][0], **ref.render_options)
        db = float(20 * np.log10(max(np.max(np.abs(x)), 1e-9) / peak["target"]))
        per_ref[0]["peak_db"] = db
        total += peak["weight_per_db"] * max(0.0, abs(db) - peak["tolerance_db"])
        for key, cap in caps.items():
            total += cap_weight * max(0.0, per_ref[0][key] - cap)
        return total, per_ref

    fit.Objective.score_patch = score_patch
    fit.main()


if __name__ == "__main__":
    main()
