"""One reference against one candidate, over seeds: the core every tool shares.

A `Reference` is a recording prepared and measured once. A candidate is a
patch rendered per seed (or a WAV), prepared to the reference's length,
measured over the reference's body span and scored.
"""

import os
from dataclasses import dataclass, field

import analyze
import audio
import constants as C
import regions
import score


@dataclass
class Reference:
    """A recording and how to render a candidate against it."""

    wav: str
    note: int = 60
    velocity: float = 1.0
    gate: float | None = None
    seconds: float | None = None
    weight: float = 1.0
    align: audio.Align = field(default_factory=audio.Align)
    tonal: str | bool = "auto"
    norm: str = C.NORM

    def __post_init__(self):
        self.wav = os.path.expanduser(os.path.expandvars(self.wav))
        self.signal = audio.prepare(audio.load_wav(self.wav), self.align, self.norm)
        self.m = analyze.measure(self.signal)
        self.flatness_db = regions.tonal_flatness_db(self.m)
        if self.tonal == "auto":
            self.is_tonal = bool(self.flatness_db < C.TONAL_MAX_FLATNESS_DB)
        else:
            self.is_tonal = bool(self.tonal)
        if self.seconds is None:
            self.seconds = min(self.signal.ms / 1000 + C.RENDER_MARGIN_S, C.RENDER_MAX_S)

    @property
    def name(self):
        return os.path.basename(self.wav)

    @property
    def render_options(self):
        return dict(note=self.note, velocity=self.velocity, seconds=self.seconds, gate=self.gate)

    @staticmethod
    def from_spec(entry, defaults=None):
        """A Reference from a spec entry: {"wav", "note", "velocity", "gate", "seconds", "weight", "align", "tonal"}."""
        d = {**(defaults or {}), **entry}
        return Reference(
            wav=d["wav"],
            note=int(d.get("note", 60)),
            velocity=float(d.get("velocity", 1.0)),
            gate=d.get("gate"),
            seconds=d.get("seconds"),
            weight=float(d.get("weight", 1.0)),
            align=audio.Align.of(d.get("align")),
            tonal=d.get("tonal", "auto"),
            norm=d.get("norm", C.NORM),
        )


@dataclass
class Candidate:
    """One prepared candidate signal, its measurements and its scores against a reference."""

    seed: int | None
    signal: audio.Signal
    m: dict
    scores: dict


def candidate(ref, x, seed=None, align=None):
    """Raw candidate samples prepared (aligned as `ref` is, unless `align` is given), measured and scored."""
    sig = audio.prepare(x, align or ref.align, ref.norm, length=len(ref.signal.x))
    m = analyze.measure(sig, body_ms=ref.m["body"]["span_ms"])
    return Candidate(seed, sig, m, score.scores(ref.signal, ref.m, sig, m, ref.is_tonal))


def render_candidates(renderer, patch, ref, seeds, align=None):
    """`patch` rendered once per seed against `ref`."""
    return [candidate(ref, renderer.render(patch, seed=s, **ref.render_options), s, align) for s in seeds]


def mean_total(cands, weights=None):
    """The fit objective for one reference: the mean total over seeds."""
    return sum(score.total(c.scores, weights) for c in cands) / len(cands)
