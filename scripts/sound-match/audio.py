"""Loading, aligning and normalising audio for a comparison.

A reference is any WAV (8/16/24/32-bit integer or float, any rate, any channel
count), downmixed to mono and resampled to 48 kHz. Both sides of a comparison
are aligned on their onset and level-normalised, since the sample packs are
normalised per voice and their absolute level means nothing.
"""

from dataclasses import dataclass
from fractions import Fraction

import numpy as np
import scipy.io.wavfile as wavfile
import scipy.signal as ss

import constants as C


@dataclass(frozen=True)
class Align:
    """Onset alignment: start `lead_ms` before the first sample above `threshold_db` of the peak."""

    threshold_db: float = C.ALIGN_THRESHOLD_DB
    lead_ms: float = C.ALIGN_LEAD_MS

    @staticmethod
    def of(spec, fallback=None):
        """An Align from a dict like {"threshold_db": -6, "lead_ms": 1.5}, or the fallback."""
        base = fallback or Align()
        if not spec:
            return base
        return Align(
            float(spec.get("threshold_db", base.threshold_db)),
            float(spec.get("lead_ms", base.lead_ms)),
        )


@dataclass
class Signal:
    """A prepared signal: aligned, normalised, mono, 48 kHz."""

    x: np.ndarray
    onset_ms: float  # where the aligned start sat in the source (negative: padded)
    gain_db: float  # the normalisation applied

    @property
    def ms(self):
        return len(self.x) / C.SR * 1000.0


def _to_float(x):
    if x.dtype == np.uint8:
        return (x.astype(np.float64) - 128.0) / 128.0
    if np.issubdtype(x.dtype, np.integer):
        # scipy returns 24-bit PCM left-justified in int32, so this one scale fits both.
        return x.astype(np.float64) / float(-np.iinfo(x.dtype).min)
    return x.astype(np.float64)


def resample(x, sr):
    """`x` at `sr` resampled to 48 kHz (polyphase)."""
    if sr == C.SR:
        return x
    ratio = Fraction(C.SR, int(sr)).limit_denominator(1000)
    return ss.resample_poly(x, ratio.numerator, ratio.denominator)


def load_wav(path):
    """A WAV file as mono float64 at 48 kHz."""
    sr, x = wavfile.read(path)
    x = _to_float(x)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return resample(x, sr)


def onset(x, threshold_db):
    """The first index above `threshold_db` relative to the peak."""
    peak = np.abs(x).max()
    if peak == 0:
        return 0
    return int(np.argmax(np.abs(x) > peak * 10 ** (threshold_db / 20)))


def normalise(x, mode=C.NORM):
    """`x` scaled to unit peak, or unit RMS; and the gain applied, in dB."""
    ref = np.abs(x).max() if mode == "peak" else np.sqrt(np.mean(x**2))
    if ref == 0:
        return x, 0.0
    return x / ref, -20 * np.log10(ref)


def prepare(x, align=None, norm=C.NORM, length=None):
    """`x` aligned on its onset, cut or padded to `length` samples if given, and normalised."""
    align = align or Align()
    start = onset(x, align.threshold_db) - int(round(align.lead_ms * C.SR / 1000))
    # An onset closer to the start than the lead is padded, so both sides of a
    # comparison sit the same lead before their onsets.
    y = x[start:] if start >= 0 else np.concatenate([np.zeros(-start), x])
    y = y if length is None else fit_length(y, length)
    y, gain = normalise(y, norm)
    return Signal(y, start / C.SR * 1000.0, gain)


def fit_length(x, n):
    """`x` truncated or zero-padded to `n` samples."""
    if len(x) >= n:
        return x[:n]
    return np.concatenate([x, np.zeros(n - len(x))])
