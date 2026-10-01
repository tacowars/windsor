"""`fit.py` with the patch's level held: a fit at the shipped peak.

Run from `scripts/sound-match/`, as `fit.py`:

    python ../../docs/research/2026-10-01-tr-clap-fit/fit_level.py SPEC [--budget N] [--out-dir DIR]

The toolkit's scores normalise each side to its own peak, so a fit is blind
to level, and with the drive on, level and saturation are one control: a
patch fitted at one level and then matched to another is not the patch that
was fitted. This adds one term to the objective,

    weight * max(0, |peak_db - target_db| - tolerance_db)

where `peak_db` is the mean over seeds 1-4 of the render's peak (dBFS, C4,
velocity 1, no gate), and the spec carries
`"level": {"target_db": ..., "tolerance_db": ..., "weight": ...}`. Every
other part of the fit is `fit.py`'s.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path.cwd()))
import fit  # noqa: E402

SEEDS = (1, 2, 3, 4)
SECONDS = 1.2


def level_of(spec_path):
    return json.loads(Path(spec_path).read_text())["level"]


def main():
    spec_path = next(a for a in sys.argv[1:] if not a.startswith("--") and a.endswith(".json"))
    level = level_of(spec_path)
    plain = fit.Objective.score_patch

    def score_patch(self, patch):
        total, per_ref = plain(self, patch)
        peaks = [np.abs(self.r.render(patch, seconds=SECONDS, seed=s)).max() for s in SEEDS]
        peak_db = float(np.mean([20 * np.log10(p) for p in peaks]))
        miss = max(0.0, abs(peak_db - level["target_db"]) - level["tolerance_db"])
        per_ref[0] = per_ref[0] | {"peak_db": peak_db}
        return total + level["weight"] * miss, per_ref

    fit.Objective.score_patch = score_patch
    fit.main()


if __name__ == "__main__":
    main()
