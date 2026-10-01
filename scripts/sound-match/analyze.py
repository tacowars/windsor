"""Measurements of one prepared signal, each over time.

    python analyze.py sound.wav [--threshold-db -40] [--lead-ms 0.05] [--json out.json]

prints a summary by region and optionally writes every measurement as JSON.
The measurements:

- pitch track: per half-cycle step, a cycle's frequency from a low-passed copy;
- pitch-synchronous harmonic profile: per cycle, H1..H12 in dB and phase
  relative to H1, the cycle resampled to a fixed length and FFT'd;
- waveform symmetry per cycle: peaks, half-cycle durations, fullness;
- band envelopes in 1 ms bins to 30 ms and 5 ms bins after;
- spectral centroid and flatness over time;
- level envelope and decay times;
- the click: above 1 kHz over the first 10 ms.
"""

import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts; the repo does not ignore it

import argparse
import json

import numpy as np
import scipy.signal as ss

import audio
import constants as C
import regions
import spectra

TINY = 1e-12


def _db(power):
    return 10 * np.log10(np.maximum(power, TINY))


def crossings(lp):
    """Fractional sample positions of the zero crossings of `lp`, and whether each rises."""
    s = np.signbit(lp)
    idx = np.where(s[:-1] != s[1:])[0]
    a, b = lp[idx], lp[idx + 1]
    frac = np.where(a != b, a / np.where(a != b, a - b, 1), 0.0)
    return idx + frac, b > a


def pitch_track(x, lp):
    """Per half-cycle step of the low-passed copy: time (ms), frequency (Hz) and level (dB re loudest).

    The frequency is a whole cycle's, from crossings two apart, centred on the
    crossing between them, so an asymmetric wave does not alternate.
    """
    z, _ = crossings(lp)
    if len(z) < 3:
        return dict(t_ms=np.array([]), hz=np.array([]), level_db=np.array([]))
    peaks = np.array([np.abs(lp[int(z[i]) : int(z[i + 2]) + 2]).max() for i in range(len(z) - 2)])
    level = 20 * np.log10(np.maximum(peaks / max(peaks.max(), TINY), TINY))
    keep = level > C.PITCH_MIN_LEVEL_DB
    t = (z[:-2] + z[2:]) / 2 / C.SR * 1000
    hz = C.SR / (z[2:] - z[:-2])
    return dict(t_ms=t[keep], hz=hz[keep], level_db=level[keep])


def _half(x, a, b, sign):
    """One half-cycle between crossings a and b: peak, mean over peak (fullness), share above 0.9 of peak (top)."""
    y = sign * x[int(np.ceil(a)) : int(np.floor(b)) + 1]
    peak = y.max() if len(y) else 0.0
    if peak <= 0:
        return 0.0, 0.0, 0.0
    return peak, float(np.mean(np.maximum(y, 0)) / peak), float(np.mean(y > C.TOP_FRACTION * peak))


def warp(z, i, phase):
    """Offsets (samples) into the cycle z[i]..z[i+2] at which it reaches each `phase` in [0, 1).

    A sweeping cycle is not periodic, and a plain resample leaks its
    fundamental into every harmonic. The frequency is taken to move linearly
    across the cycle, at the rate the neighbouring cycles' periods change, so
    the grid follows the sweep.
    """
    period = z[i + 2] - z[i]
    prev = period - (z[i] - z[i - 2]) if i >= 2 else None
    nxt = (z[i + 4] - z[i + 2]) - period if i + 4 < len(z) else None
    steps = [d for d in (prev, nxt) if d is not None]
    delta = np.clip(np.mean(steps) / 2, -C.WARP_MAX * period, C.WARP_MAX * period) if steps else 0.0
    f_s, f_e = 1 / (period - delta), 1 / (period + delta)
    scale = 2 / ((f_s + f_e) * period)
    a, b = scale * (f_e - f_s) / (2 * period), scale * f_s
    if abs(a) < TINY:
        return phase / b
    return (-b + np.sqrt(b * b + 4 * a * phase)) / (2 * a)


def _peak(x, a, b):
    seg = x[int(np.ceil(a)) : int(np.floor(b)) + 1]
    return np.abs(seg).max() if len(seg) else 0.0


def flatten(x, z, i, phase):
    """Gains that undo the level's change across the cycle z[i]..z[i+2].

    A decaying cycle is not periodic either; the level is taken to move
    exponentially at the rate the neighbouring cycles' peaks change.
    """
    here = _peak(x, z[i], z[i + 2])
    rates = []
    if i >= 2 and _peak(x, z[i - 2], z[i]) > 0 and here > 0:
        rates.append(np.log(here / _peak(x, z[i - 2], z[i])))
    if i + 4 < len(z) and _peak(x, z[i + 2], z[i + 4]) > 0 and here > 0:
        rates.append(np.log(_peak(x, z[i + 2], z[i + 4]) / here))
    rate = np.mean(rates) if rates else 0.0
    return np.exp(-rate * (phase - 0.5))


def cycle_shape(x, z, i):
    """The cycle z[i]..z[i+2] resampled to CYCLE_POINTS, following its sweep and undoing its decay."""
    phase = np.arange(C.CYCLE_POINTS) / C.CYCLE_POINTS
    return np.interp(z[i] + warp(z, i, phase), np.arange(len(x)), x) * flatten(x, z, i, phase)


def _cycle(x, z, i):
    """The cycle from rising crossing z[i] through falling z[i+1] to rising z[i+2]: harmonics and shape.

    The negative half is compared with the positive halves on both sides of it
    (geometric mean of peaks, mean of durations) when the next one exists, so a
    decaying or sweeping body does not read as asymmetric.
    """
    c0, c1, c2 = z[i], z[i + 1], z[i + 2]
    h = np.fft.rfft(cycle_shape(x, z, i))[1 : C.HARMONICS + 1]
    mag = np.abs(h)
    k = np.arange(1, C.HARMONICS + 1)
    pos_peak, pos_full, pos_top = _half(x, c0, c1, 1)
    neg_peak, neg_full, neg_top = _half(x, c1, c2, -1)
    pos_ms = (c1 - c0) / C.SR * 1000
    if i + 3 < len(z):
        next_peak, _, _ = _half(x, c2, z[i + 3], 1)
        pos_peak = np.sqrt(pos_peak * next_peak)
        pos_ms = (pos_ms + (z[i + 3] - c2) / C.SR * 1000) / 2
    return dict(
        t_ms=(c0 + c2) / 2 / C.SR * 1000,
        period_ms=(c2 - c0) / C.SR * 1000,
        harm_db=20 * np.log10(np.maximum(mag / max(mag[0], TINY), TINY)),
        harm_phase=np.angle(np.exp(1j * (np.angle(h) - k * np.angle(h[0])))),
        pos_peak=pos_peak,
        neg_peak=neg_peak,
        pos_ms=pos_ms,
        neg_ms=(c2 - c1) / C.SR * 1000,
        pos_full=pos_full,
        neg_full=neg_full,
        pos_top=pos_top,
        neg_top=neg_top,
        level=max(pos_peak, neg_peak),
    )


def low_pass(x):
    """The zero-phase low-passed copy whose crossings mark half-cycles."""
    sos = ss.butter(C.PITCH_LP_ORDER, C.PITCH_LP_HZ, "lowpass", fs=C.SR, output="sos")
    return ss.sosfiltfilt(sos, x)


def _cycle_starts(rising):
    return [i for i in range(len(rising) - 2) if rising[i] and not rising[i + 1] and rising[i + 2]]


def cycle_waveforms(x):
    """Every cycle's centre time (ms) and shape (CYCLE_POINTS, scaled to unit peak), for plots."""
    z, rising = crossings(low_pass(x))
    starts = _cycle_starts(rising)
    shapes = [cycle_shape(x, z, i) for i in starts]
    t = np.array([(z[i] + z[i + 2]) / 2 / C.SR * 1000 for i in starts])
    return t, [s / max(np.abs(s).max(), TINY) for s in shapes]


def cycle_profile(x, lp):
    """Per cycle (rising crossing to rising crossing of the low-passed copy): harmonics and symmetry."""
    z, rising = crossings(lp)
    cycles = [_cycle(x, z, i) for i in _cycle_starts(rising)]
    if not cycles:
        return dict(t_ms=np.array([]), level_db=np.array([]))
    out = {key: np.array([c[key] for c in cycles]) for key in cycles[0]}
    out["level_db"] = 20 * np.log10(np.maximum(out["level"] / out["level"].max(), TINY))
    keep = out["level_db"] > C.PITCH_MIN_LEVEL_DB
    return {key: value[keep] for key, value in out.items()}


def bin_edges_ms(length_ms):
    """Band-envelope bin edges: 1 ms to 30 ms, then 5 ms."""
    fine = np.arange(0, min(C.ENV_FINE_UNTIL_MS, length_ms) + 1e-9, C.ENV_FINE_MS)
    coarse = np.arange(C.ENV_FINE_UNTIL_MS + C.ENV_COARSE_MS, length_ms + 1e-9, C.ENV_COARSE_MS)
    return np.concatenate([fine, coarse])


def band_signals(x):
    """`x` split into the bands of `constants.BANDS` (zero-phase Butterworth)."""
    out = []
    for _, lo, hi in C.BANDS:
        if lo is None:
            sos = ss.butter(C.BAND_FILTER_ORDER, hi, "lowpass", fs=C.SR, output="sos")
        elif hi is None:
            sos = ss.butter(C.BAND_FILTER_ORDER, lo, "highpass", fs=C.SR, output="sos")
        else:
            sos = ss.butter(C.BAND_FILTER_ORDER, [lo, hi], "bandpass", fs=C.SR, output="sos")
        out.append(ss.sosfiltfilt(sos, x))
    return out


def band_envelopes(bands, length_ms):
    """Per band, RMS level in dB per bin."""
    edges = bin_edges_ms(length_ms)
    idx = (edges * C.SR / 1000).astype(int)
    db = [[_db(np.mean(b[idx[i] : idx[i + 1]] ** 2)) for i in range(len(idx) - 1)] for b in bands]
    return dict(edges_ms=edges, t_ms=(edges[:-1] + edges[1:]) / 2, db=np.array(db))


def spectral(x):
    """Spectral centroid (Hz) and flatness per frame; quiet frames are NaN."""
    p = spectra.stft_power(x, C.SPECTRAL_FFT, C.SPECTRAL_HOP)
    freqs = np.fft.rfftfreq(C.SPECTRAL_FFT, 1 / C.SR)
    total = p.sum(axis=1)
    loud = _db(total) > _db(total.max()) + C.SPECTRAL_MIN_LEVEL_DB
    centroid = np.where(loud, (p * freqs).sum(axis=1) / np.maximum(total, TINY), np.nan)
    flat = spectra.flatness(p)
    t = np.arange(len(p)) * C.SPECTRAL_HOP / C.SR * 1000
    return dict(t_ms=t, centroid_hz=centroid, flatness=np.where(loud, flat, np.nan), power=p, freqs=freqs)


def level_envelope(x):
    """Peak per window in dB, its peak time and the decay times of `constants.DECAY_DB`."""
    w = int(C.LEVEL_WINDOW_MS * C.SR / 1000)
    n = len(x) // w
    env = np.abs(x[: n * w]).reshape(n, w).max(axis=1)
    db = 20 * np.log10(np.maximum(env / max(env.max(), TINY), TINY))
    decay = {}
    for d in C.DECAY_DB:
        above = np.where(db > d)[0]
        decay[str(int(d))] = float((above[-1] + 1) * C.LEVEL_WINDOW_MS) if len(above) else 0.0
    t = (np.arange(n) + 0.5) * C.LEVEL_WINDOW_MS
    return dict(t_ms=t, db=db, peak_ms=float(t[np.argmax(db)]), decay_ms=decay)


def click(x):
    """Above 1 kHz (causal high-pass) over the first 10 ms: peak and per-ms RMS in dB re the signal peak."""
    sos = ss.butter(C.CLICK_HP_ORDER, C.CLICK_HP_HZ, "highpass", fs=C.SR, output="sos")
    h = ss.sosfilt(sos, x)
    peak = max(np.abs(x).max(), TINY)
    w = int(C.SR / 1000)
    n = int(C.CLICK_MS)
    head = audio.fit_length(h, n * w) / peak
    e = int(C.CLICK_ENERGY_MS * C.SR / 1000)
    return dict(
        peak_db=float(20 * np.log10(max(np.abs(head).max(), TINY))),
        bins_db=_db(np.mean(head.reshape(n, w) ** 2, axis=1)),
        hf_fraction=float(np.sum(h[:e] ** 2) / max(np.sum(x[:e] ** 2), TINY)),
    )


def measure(signal, body_ms=None):
    """Every measurement of a prepared `audio.Signal`, its region summaries and its body.

    `body_ms` is the span summarised as the body; by default the signal's own
    (`regions.body_span`). A comparison passes the reference's to the candidate.
    """
    x = signal.x
    lp = low_pass(x)
    bands = band_signals(x)
    m = dict(
        length_ms=signal.ms,
        onset_ms=signal.onset_ms,
        pitch=pitch_track(x, lp),
        cycles=cycle_profile(x, lp),
        bands=band_envelopes(bands, signal.ms),
        spectral=spectral(x),
        level=level_envelope(x),
        click=click(x),
    )
    m["regions"] = regions.summarise(m, bands, x)
    return regions.add_body(m, body_ms)


def jsonable(value):
    """Numpy values as plain JSON (NaN as null); bulky internals dropped."""
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items() if k not in ("power", "freqs")}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [jsonable(v) for v in value]
    if isinstance(value, (np.floating, float)):
        return None if not np.isfinite(value) else round(float(value), 6)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wav")
    ap.add_argument("--threshold-db", type=float, default=C.ALIGN_THRESHOLD_DB)
    ap.add_argument("--lead-ms", type=float, default=C.ALIGN_LEAD_MS)
    ap.add_argument("--norm", choices=("peak", "rms"), default=C.NORM)
    ap.add_argument("--json", help="write every measurement here")
    args = ap.parse_args()
    sig = audio.prepare(audio.load_wav(args.wav), audio.Align(args.threshold_db, args.lead_ms), args.norm)
    m = measure(sig)
    print(regions.describe(m))
    if args.json:
        with open(args.json, "w") as f:
            json.dump(jsonable(m), f, indent=1)
        print(f"wrote {args.json}")


if __name__ == "__main__":
    main()
