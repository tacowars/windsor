"""Which seeds a patch is scored over: one, or C.SEEDS when its render can depend on the seed.

The worklet's random sources are listed in `constants.py`. A patch counts as
seed-dependent when either

- its structure draws randomness at its current values (`seeded_structure`):
  a Noise operator, a `phaseFree` operator, an S&H or Drift LFO, or a
  non-zero `panRandom`; or
- a fitted parameter's path controls one of those sources (`seeded_paths`):
  `panRandom`, an operator's `wave` or `phaseFree`, anything of an operator
  whose wave is Noise or is fitted, an LFO's `shape`, and any depth or
  setting of an LFO whose shape is random or is fitted. Then the decision
  holds for the whole fit, whatever the start value, since the search can
  move that parameter off a silent value.

Otherwise the patch is rendered with two seeds and compared sample for sample.
A given count (a spec's "seeds", a tool's --seeds) skips all of it.
"""

import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts; the repo does not ignore it

import numpy as np

import constants as C
from spec import parse_path


def seeded_structure(patch):
    """True when the patch draws randomness at its current values."""
    if float(patch.get("panRandom") or 0) != 0:
        return True
    if any(op.get("wave") == C.NOISE_WAVE or op.get("phaseFree") for op in patch.get("ops", [])):
        return True
    return any((patch.get(key) or {}).get("shape") in C.RANDOM_LFO_SHAPES for key in C.LFO_KEYS)


def _path_seeded(patch, tokens, fitted):
    """True when the path `tokens` controls a random source of `patch`, given every fitted path's tokens."""
    if tuple(tokens) in C.SEEDED_PATCH_PATHS:
        return True
    ops = patch.get("ops", [])
    if len(tokens) >= 3 and tokens[0] == "ops" and isinstance(tokens[1], int):
        i = tokens[1]
        if tokens[2] in C.SEEDED_OP_KEYS:
            return True
        noise = i < len(ops) and ops[i].get("wave") == C.NOISE_WAVE
        return noise or ("ops", i, "wave") in fitted
    lfo = C.LFO_DEPTH_PATHS.get(tuple(tokens), tokens[0] if len(tokens) >= 2 and tokens[0] in C.LFO_KEYS else None)
    if lfo is None:
        return False
    if len(tokens) == 2 and tokens == [lfo, "shape"]:
        return True
    return (patch.get(lfo) or {}).get("shape") in C.RANDOM_LFO_SHAPES or (lfo, "shape") in fitted


def seeded_paths(patch, paths):
    """True when any of the fitted `paths` controls one of the worklet's random sources."""
    tokens = [parse_path(p) for p in paths]
    fitted = {tuple(t) for t in tokens}
    return any(_path_seeded(patch, t, fitted) for t in tokens)


def seed_list(renderer, patch, opts, count=None, base=C.SEED_BASE, paths=()):
    """The seeds to score `patch` over: `count` of them if given, else C.SEEDS if it can depend on the seed, else one.

    `paths` are the fitted parameters' paths (a fit's or a sensitivity map's),
    so a parameter that can switch a random source on keeps every seed from
    the start, whatever its start value.
    """
    if count is not None:
        return list(range(base, base + max(1, count)))
    many = list(range(base, base + C.SEEDS))
    if seeded_structure(patch) or seeded_paths(patch, paths):
        return many
    a = renderer.render(patch, seed=base, **opts)
    b = renderer.render(patch, seed=base + 1, **opts)
    return many if not np.array_equal(a, b) else [base]
