"""Scores of a candidate against a reference, each separately, and their weighted total.

All take prepared signals of equal length (`audio.prepare` with the
reference's length) and their measurements (`analyze.measure`). Lower is
closer for every score:

- stft:  multi-resolution STFT loss (spectral convergence plus mean absolute
         log-magnitude difference, averaged over FFT sizes 256 / 1024 / 4096
         with hops at a quarter); magnitudes floored 80 dB below the
         reference's loudest bin, so silence against a noise floor costs little;
- band:  RMS dB difference of the band envelopes, floored at −60 dB;
- harm:  RMS dB difference of H2..H12 per cycle (tonal voices);
- pitch: RMS pitch difference in semitones per half-cycle (tonal voices);
- wave:  waveform MSE over the first 30 ms at the best lag within ±2 ms; the
         one score that sees polarity and exactly where a click lands.
"""

import numpy as np

import constants as C
import spectra

TINY = 1e-12
TONAL_ONLY = ("harm", "pitch")


def stft_loss(ref, cand, sizes=C.STFT_SIZES, floor_db=C.STFT_FLOOR_DB):
    total = 0.0
    for n in sizes:
        r = np.sqrt(spectra.stft_power(ref, n, n // 4))
        c = np.sqrt(spectra.stft_power(cand, n, n // 4))
        floor = r.max() * 10 ** (floor_db / 20) + TINY
        r, c = np.maximum(r, floor), np.maximum(c, floor)
        convergence = np.linalg.norm(r - c) / np.linalg.norm(r)
        log_mag = np.mean(np.abs(np.log(r) - np.log(c)))
        total += convergence + log_mag
    return float(total / len(sizes))


def band_error(ref_m, cand_m, floor_db=C.BAND_FLOOR_DB):
    r = np.maximum(ref_m["bands"]["db"], floor_db)
    c = np.maximum(cand_m["bands"]["db"], floor_db)
    n = min(r.shape[1], c.shape[1])
    return float(np.sqrt(np.mean((c[:, :n] - r[:, :n]) ** 2)))


def harm_error(ref_m, cand_m, floor_db=C.HARM_FLOOR_DB):
    """Per reference cycle above HARM_MIN_LEVEL_DB, H2..H12 against the candidate's at that time."""
    rc, cc = ref_m["cycles"], cand_m["cycles"]
    if len(rc.get("t_ms", [])) == 0:
        return 0.0
    sel = rc["level_db"] > C.HARM_MIN_LEVEL_DB
    if len(cc.get("t_ms", [])) == 0:
        return C.HARM_MISSING_DB
    t = rc["t_ms"][sel]
    r = np.maximum(rc["harm_db"][sel][:, 1:], floor_db)
    c = np.maximum(cc["harm_db"][:, 1:], floor_db)
    ci = np.stack([np.interp(t, cc["t_ms"], c[:, k]) for k in range(c.shape[1])], axis=1)
    return float(np.sqrt(np.mean((ci - r) ** 2)))


def pitch_error(ref_m, cand_m, window_ms=C.PITCH_SCORE_MS):
    rp, cp = ref_m["pitch"], cand_m["pitch"]
    t = np.asarray(rp["t_ms"])
    sel = (t >= window_ms[0]) & (t <= window_ms[1])
    if not sel.any():
        return 0.0
    if len(cp["t_ms"]) < 2:
        return C.PITCH_MISSING_ST
    ours = np.interp(t[sel], cp["t_ms"], np.log2(cp["hz"]))
    return float(np.sqrt(np.mean((12 * (ours - np.log2(rp["hz"][sel]))) ** 2)))


def wave_error(ref, cand, window_ms=C.WAVE_WINDOW_MS, max_lag_ms=C.WAVE_MAX_LAG_MS):
    """Lowest MSE over lags; and that lag in ms (positive: the candidate is late)."""
    n = int(window_ms * C.SR / 1000)
    lag = int(max_lag_ms * C.SR / 1000)
    r = np.pad(ref, (lag, lag + n))
    c = np.pad(cand, (0, n))[:n]
    errors = [np.mean((r[lag + k : lag + k + n] - c) ** 2) for k in range(-lag, lag + 1)]
    best = int(np.argmin(errors))
    return float(errors[best]), -(best - lag) / C.SR * 1000


def scores(ref, ref_m, cand, cand_m, tonal):
    """Every score of one candidate render; tonal-only scores are None for a noise voice."""
    wave, lag = wave_error(ref.x, cand.x)
    out = dict(
        stft=stft_loss(ref.x, cand.x),
        band=band_error(ref_m, cand_m),
        harm=harm_error(ref_m, cand_m) if tonal else None,
        pitch=pitch_error(ref_m, cand_m) if tonal else None,
        wave=wave,
    )
    out["wave_lag_ms"] = lag
    return out


def total(s, weights=None):
    """The weighted sum of the scores present."""
    weights = {**C.WEIGHTS, **(weights or {})}
    return float(sum(w * s[k] for k, w in weights.items() if s.get(k) is not None))


def spread(per_seed, weights=None):
    """Mean, standard deviation, min and max of every score (and the total) over seeds."""
    rows = [{**s, "total": total(s, weights)} for s in per_seed]
    out = {}
    for key in rows[0]:
        values = [r[key] for r in rows if r[key] is not None]
        if values:
            out[key] = dict(
                mean=float(np.mean(values)),
                sd=float(np.std(values)),
                min=float(np.min(values)),
                max=float(np.max(values)),
            )
    return out
