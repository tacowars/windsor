"""Measurements summarised by time region (0–5, 5–30, 30–150 ms, tail) and the body."""

import numpy as np
import scipy.signal as ss

import constants as C
import spectra

TINY = 1e-12
NAN = float("nan")


def _span(start, end, length_ms):
    return start, length_ms if end is None else min(end, length_ms)


def _rms_db(y):
    return float(10 * np.log10(max(np.mean(y**2), TINY))) if len(y) else NAN


def _median(values):
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    return float(np.median(values)) if len(values) else NAN


SHAPE_KEYS = ("neg_pos_peak", "neg_pos_ms", "pos_full", "neg_full", "pos_top", "neg_top")


def cycles_between(cycles, start, end):
    """The cycles centred in [start, end) ms, summarised: medians of harmonics and shape."""
    t = cycles.get("t_ms", np.array([]))
    sel = (t >= start) & (t < end) if len(t) else np.array([], dtype=bool)
    n = int(sel.sum())
    if n == 0:
        nan = [NAN] * C.HARMONICS
        shape = {k: NAN for k in SHAPE_KEYS}
        return dict(cycles=0, harm_db=nan, harm_phase=nan, **shape)
    phase = cycles["harm_phase"][sel]
    return dict(
        cycles=n,
        harm_db=[_median(cycles["harm_db"][sel][:, k]) for k in range(C.HARMONICS)],
        harm_phase=[float(np.angle(np.mean(np.exp(1j * phase[:, k])))) for k in range(C.HARMONICS)],
        neg_pos_peak=_median(cycles["neg_peak"][sel] / np.maximum(cycles["pos_peak"][sel], TINY)),
        neg_pos_ms=_median(cycles["neg_ms"][sel] / np.maximum(cycles["pos_ms"][sel], TINY)),
        **{k: _median(cycles[k][sel]) for k in SHAPE_KEYS[2:]},
    )


def _spectral_between(y):
    """Centroid and flatness of one segment: a Tukey-windowed FFT of the whole segment."""
    if len(y) < 2:
        return NAN, NAN
    n = max(C.REGION_FFT_MIN, 1 << (len(y) - 1).bit_length())
    p = np.abs(np.fft.rfft(y * ss.windows.tukey(len(y), 0.25), n)) ** 2
    total = p.sum()
    if total <= TINY:
        return NAN, NAN
    freqs = np.fft.rfftfreq(n, 1 / C.SR)
    return float((p * freqs).sum() / total), float(spectra.flatness(p))


def summarise(m, bands, x):
    """One dict per region of `constants.REGIONS`."""
    out = []
    high = [i for i, (_, lo, _) in enumerate(C.BANDS) if lo is not None and lo >= C.HIGH_BAND_HZ]
    for name, start, end in C.REGIONS:
        a, b = _span(start, end, m["length_ms"])
        i, j = int(a * C.SR / 1000), int(b * C.SR / 1000)
        band_db = [_rms_db(band[i:j]) for band in bands]
        high_power = sum(10 ** (band_db[k] / 10) for k in high) if j > i else NAN
        centroid, flatness = _spectral_between(x[i:j])
        pt = m["pitch"]["t_ms"]
        out.append(
            dict(
                name=name,
                start_ms=a,
                end_ms=b,
                rms_db=_rms_db(x[i:j]),
                bands_db=band_db,
                high_db=float(10 * np.log10(max(high_power, TINY))) if j > i else NAN,
                centroid_hz=centroid,
                flatness_db=float(10 * np.log10(max(flatness, TINY))) if np.isfinite(flatness) else NAN,
                pitch_hz=_median(m["pitch"]["hz"][(pt >= a) & (pt < b)]) if len(pt) else NAN,
                cycles=cycles_between(m["cycles"], a, b),
            )
        )
    return out


def pitch_at(pitch, t_ms):
    """The half-cycle frequency at `t_ms`, interpolated in log frequency; NaN outside the track."""
    t, hz = np.asarray(pitch["t_ms"]), np.asarray(pitch["hz"])
    if len(t) < 2 or t_ms < t[0] or t_ms > t[-1]:
        return NAN
    return float(2 ** np.interp(t_ms, t, np.log2(hz)))


def tonal_flatness_db(m):
    """Median spectral flatness (dB) over `constants.TONAL_SPAN_MS`; it decides whether a voice is tonal."""
    flat = m["spectral"]["flatness"]
    t = m["spectral"]["t_ms"]
    sel = (t >= C.TONAL_SPAN_MS[0]) & (t < C.TONAL_SPAN_MS[1]) & np.isfinite(flat)
    return float(10 * np.log10(max(_median(flat[sel]), TINY))) if sel.any() else NAN


def body_span(m):
    """The body: from BODY_START_MS to the last cycle within BODY_DB of the loudest."""
    cyc = m["cycles"]
    t = cyc.get("t_ms", np.array([]))
    sel = (t >= C.BODY_START_MS) & (cyc.get("level_db", t) > C.BODY_DB) if len(t) else []
    end = float(t[sel].max()) + 1e-6 if np.any(sel) else C.BODY_START_MS
    return (C.BODY_START_MS, end)


def add_body(m, span=None):
    """`m` with its body summary over `span` (default: its own body span)."""
    span = span or body_span(m)
    m["body"] = dict(span_ms=list(span), **cycles_between(m["cycles"], *span))
    return m


def _fmt(v, spec="+.1f", none="—"):
    return none if v is None or not np.isfinite(v) else format(v, spec)


def describe(m):
    """A one-signal summary by region, for `analyze.py`."""
    lines = [f"length {m['length_ms']:.0f} ms, onset at {m['onset_ms']:.2f} ms in the file"]
    lv = m["level"]
    lines.append(
        f"peak at {lv['peak_ms']:.0f} ms; −20 dB at {lv['decay_ms']['-20']:.0f} ms, −40 dB at {lv['decay_ms']['-40']:.0f} ms;"
        f" click >1 kHz peak {_fmt(m['click']['peak_db'])} dB; flatness 5–150 ms {_fmt(tonal_flatness_db(m), '.1f')} dB"
    )
    names = " ".join(f"{n:>8s}" for n, _, _ in C.BANDS)
    lines.append(f"body {m['body']['span_ms'][0]:.0f}–{m['body']['span_ms'][1]:.0f} ms: {_cycles_line(m['body'])}")
    for r in m["regions"]:
        cyc = r["cycles"]
        lines.append(f"{r['name']}:")
        lines.append(f"  bands dB  {names}")
        lines.append("            " + " ".join(f"{_fmt(v, '8.1f')}" for v in r["bands_db"]))
        lines.append(
            f"  centroid {_fmt(r['centroid_hz'], '.0f')} Hz, flatness {_fmt(r['flatness_db'], '.1f')} dB,"
            f" pitch {_fmt(r['pitch_hz'], '.1f')} Hz"
        )
        if cyc["cycles"]:
            lines.append(f"  {_cycles_line(cyc)}")
    return "\n".join(lines)


def _cycles_line(cyc):
    if not cyc["cycles"]:
        return "no cycles"
    harm = " ".join(_fmt(v, ".1f") for v in cyc["harm_db"][1:6])
    return (
        f"{cyc['cycles']} cycles: H2..H6 {harm} dB re H1; negative/positive peak {cyc['neg_pos_peak']:.2f},"
        f" duration {cyc['neg_pos_ms']:.2f}; fullness +{cyc['pos_full']:.2f} −{cyc['neg_full']:.2f};"
        f" top +{cyc['pos_top']:.2f} −{cyc['neg_top']:.2f}"
    )
