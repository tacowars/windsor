"""A fit spec: the start patch, the parameters, the references, the weights and the optimizer.

    {
      "start": "tr909-kick",
      "params": [
        {"path": "pitchEnvAmount", "min": 8, "max": 48},
        {"path": "ops[0].env.decayTime", "min": 0.005, "max": 0.3, "scale": "log"},
        {"path": ["ops[2].level", "ops[3].level"], "min": 0, "max": 1}
      ],
      "references": [
        {"wav": "$SM_909/02. Medium/BD 909 Clean Medium C 03.wav", "note": 60,
         "velocity": 1, "gate": null, "weight": 1,
         "align": {"threshold_db": -6, "lead_ms": 1.5}}
      ],
      "weights": {"stft": 1, "band": 0.05, "harm": 0.02, "pitch": 0.2, "wave": 5},
      "seeds": 6,
      "optimizer": {"method": "cma", "budget": 300, "sigma0": 0.2, "seed": 1}
    }

`start` is a library id, a patch file (relative to the spec) or an inline
patch. A parameter's `path` is a JSON path into the bare patch; a list of
paths ties them to one value. `scale` is "linear" (default) or "log". WAV
paths expand `$VARS` and `~`, so a spec need not carry a machine's folders.
A reference's other fields default to the spec's `defaults` entry.
`seeds` is optional: left out, the seed count is decided from the start
patch and the fitted paths (see `seeds.py`); 1 forces a single seed and
N > 1 forces N.
The structure (algorithm, waves, routing) is the start patch's; a fit only
moves the numbers the spec names.
"""

import copy
import json
import os
import re
from dataclasses import dataclass

import numpy as np

import audio
import comparison
import constants as C
import renderer as R

TOKEN = re.compile(r"([^.\[\]]+)|\[(\d+)\]")


def parse_path(path):
    """`ops[2].env.decayTime` as ["ops", 2, "env", "decayTime"]."""
    return [int(index) if index else key for key, index in TOKEN.findall(path)]


def get_path(patch, path):
    node = patch
    for token in parse_path(path):
        node = node[token]
    return node


def set_path(patch, path, value):
    tokens = parse_path(path)
    node = patch
    for token in tokens[:-1]:
        node = node[token]
    node[tokens[-1]] = value


@dataclass
class Param:
    paths: list
    lo: float
    hi: float
    scale: str = "linear"

    @property
    def name(self):
        return self.paths[0] if len(self.paths) == 1 else "=".join(self.paths)

    def to_unit(self, v):
        v = float(np.clip(v, self.lo, self.hi))
        if self.scale == "log":
            return float(np.log(v / self.lo) / np.log(self.hi / self.lo))
        return (v - self.lo) / (self.hi - self.lo)

    def from_unit(self, u):
        u = float(np.clip(u, 0.0, 1.0))
        if self.scale == "log":
            return float(self.lo * (self.hi / self.lo) ** u)
        return float(self.lo + u * (self.hi - self.lo))

    @staticmethod
    def of(entry):
        paths = entry["path"] if isinstance(entry["path"], list) else [entry["path"]]
        p = Param(paths, float(entry["min"]), float(entry["max"]), entry.get("scale", "linear"))
        if p.scale == "log" and p.lo <= 0:
            raise ValueError(f"{p.name}: a log-scaled parameter needs min > 0")
        return p


def apply(patch, params, values):
    """A copy of `patch` with each parameter set to its value."""
    out = copy.deepcopy(patch)
    for p, v in zip(params, values):
        for path in p.paths:
            set_path(out, path, v)
    return out


def start_values(patch, params):
    return [float(get_path(patch, p.paths[0])) for p in params]


@dataclass
class Spec:
    name: str
    start: dict
    params: list
    references: list
    weights: dict
    seeds: int | None
    seed_base: int
    optimizer: dict
    candidate_align: object


def load(path):
    """A Spec from a JSON file; references are loaded and measured here."""
    with open(path) as f:
        raw = json.load(f)
    base = os.path.dirname(os.path.abspath(path))
    defaults = raw.get("defaults", {})
    cand_align = raw.get("candidate_align")
    return Spec(
        name=os.path.splitext(os.path.basename(path))[0],
        start=R.load_patch(raw["start"], base),
        params=[Param.of(e) for e in raw["params"]],
        references=[comparison.Reference.from_spec(e, defaults) for e in raw["references"]],
        weights={**C.WEIGHTS, **raw.get("weights", {})},
        seeds=int(raw["seeds"]) if raw.get("seeds") is not None else None,
        seed_base=int(raw.get("seed_base", C.SEED_BASE)),
        optimizer={"method": "cma", "budget": 200, "sigma0": 0.2, "seed": 1, **raw.get("optimizer", {})},
        candidate_align=audio.Align.of(cand_align) if cand_align else None,
    )
