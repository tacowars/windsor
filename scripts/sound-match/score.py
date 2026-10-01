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
         both compare only where the two tracks overlap (never extrapolating
         a track past its end) and add HARM_UNCOVERED_DB / PITCH_UNCOVERED_ST
         per unit of the reference's span the candidate's track misses, and
         of the candidate's span past the reference's ("coverage" below);
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


def coverage(t_ref, t_cand):
    """How the candidate's track spans the reference's, never extrapolated.

    Returns the mask of `t_ref` inside the candidate's span, the share of the
    reference's span the candidate does not cover ("missing") and the
    candidate's span outside the reference's ("extra"), both in units of the
    reference's span and capped at 1.
    """
    t_ref, t_cand = np.asarray(t_ref), np.asarray(t_cand)
    if len(t_ref) == 0 or len(t_cand) == 0:
        return np.zeros(len(t_ref), bool), (1.0 if len(t_ref) else 0.0), (1.0 if len(t_cand) else 0.0)
    r0, r1, c0, c1 = t_ref.min(), t_ref.max(), t_cand.min(), t_cand.max()
    inside = (t_ref >= c0) & (t_ref <= c1)
    span = r1 - r0
    if span <= 0:
        return inside, float(not inside.any()), 0.0
    overlap = max(0.0, min(r1, c1) - max(r0, c0))
    missing = 1.0 - overlap / span
    extra = min(1.0, ((c1 - c0) - overlap) / span)
    return inside, float(missing), float(extra)


def _harm_tracks(ref_m, cand_m):
    """The reference's and the candidate's cycles above HARM_MIN_LEVEL_DB (each re its own loudest)."""
    rc, cc = ref_m["cycles"], cand_m["cycles"]
    r_sel = rc["level_db"] > C.HARM_MIN_LEVEL_DB if len(rc.get("t_ms", [])) else np.zeros(0, bool)
    c_sel = cc["level_db"] > C.HARM_MIN_LEVEL_DB if len(cc.get("t_ms", [])) else np.zeros(0, bool)
    return rc, r_sel, cc, c_sel


def harm_coverage(ref_m, cand_m):
    """(missing, extra) of the candidate's harmonic track against the reference's."""
    rc, r_sel, cc, c_sel = _harm_tracks(ref_m, cand_m)
    _, missing, extra = coverage(rc.get("t_ms", np.zeros(0))[r_sel], cc.get("t_ms", np.zeros(0))[c_sel])
    return missing, extra


def harm_error(ref_m, cand_m, floor_db=C.HARM_FLOOR_DB, penalty_db=C.HARM_UNCOVERED_DB):
    """RMS dB of H2..H12 over the reference cycles the candidate's track covers, plus
    `penalty_db` per unit of the reference's span the candidate misses and of the
    candidate's span past the reference's. Nothing is extrapolated."""
    rc, r_sel, cc, c_sel = _harm_tracks(ref_m, cand_m)
    if not r_sel.any():
        return 0.0
    t = rc["t_ms"][r_sel]
    inside, missing, extra = coverage(t, cc.get("t_ms", np.zeros(0))[c_sel])
    if not inside.any():
        return C.HARM_MISSING_DB
    tc = cc["t_ms"][c_sel]
    r = np.maximum(rc["harm_db"][r_sel][inside][:, 1:], floor_db)
    c = np.maximum(cc["harm_db"][c_sel][:, 1:], floor_db)
    ci = np.stack([np.interp(t[inside], tc, c[:, k]) for k in range(c.shape[1])], axis=1)
    return float(np.sqrt(np.mean((ci - r) ** 2)) + penalty_db * (missing + extra))


def _pitch_tracks(ref_m, cand_m, window_ms):
    rp, cp = ref_m["pitch"], cand_m["pitch"]
    t, tc = np.asarray(rp["t_ms"]), np.asarray(cp["t_ms"])
    sel = (t >= window_ms[0]) & (t <= window_ms[1])
    c_sel = (tc >= window_ms[0]) & (tc <= window_ms[1])
    return rp, sel, cp, c_sel


def pitch_coverage(ref_m, cand_m, window_ms=C.PITCH_SCORE_MS):
    """(missing, extra) of the candidate's pitch track against the reference's, within the window."""
    rp, sel, cp, c_sel = _pitch_tracks(ref_m, cand_m, window_ms)
    _, missing, extra = coverage(np.asarray(rp["t_ms"])[sel], np.asarray(cp["t_ms"])[c_sel])
    return missing, extra


def pitch_error(ref_m, cand_m, window_ms=C.PITCH_SCORE_MS, penalty_st=C.PITCH_UNCOVERED_ST):
    """RMS semitones over the reference half-cycles the candidate's track covers, plus
    `penalty_st` per unit of uncovered span either way. Nothing is extrapolated."""
    rp, sel, cp, c_sel = _pitch_tracks(ref_m, cand_m, window_ms)
    if not sel.any():
        return 0.0
    if c_sel.sum() < 2:
        return C.PITCH_MISSING_ST
    t = np.asarray(rp["t_ms"])[sel]
    tc = np.asarray(cp["t_ms"])[c_sel]
    inside, missing, extra = coverage(t, tc)
    if not inside.any():
        return C.PITCH_MISSING_ST
    ours = np.interp(t[inside], tc, np.log2(np.asarray(cp["hz"])[c_sel]))
    err = np.sqrt(np.mean((12 * (ours - np.log2(np.asarray(rp["hz"])[sel][inside]))) ** 2))
    return float(err + penalty_st * (missing + extra))


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
    if tonal:
        out["harm_missing"], out["harm_extra"] = harm_coverage(ref_m, cand_m)
        out["pitch_missing"], out["pitch_extra"] = pitch_coverage(ref_m, cand_m)
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
