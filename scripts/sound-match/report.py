"""The diagnostic report: where a candidate differs from a reference, by time region.

Values read "candidate against reference"; differences are candidate minus
reference. Over several seeds every number is the mean over seeds, and the
scores also give their spread.
"""

import warnings

import numpy as np

import constants as C
import regions
import score

NAN = float("nan")


def summary(m):
    """The numbers the report reads from one measurement."""
    return dict(
        regions=[{k: v for k, v in r.items() if k != "cycles"} | _cyc(r["cycles"]) for r in m["regions"]],
        body=dict(m["body"]),
        peak_ms=m["level"]["peak_ms"],
        decay_ms=dict(m["level"]["decay_ms"]),
        click_db=m["click"]["peak_db"],
        click_bins_db=list(m["click"]["bins_db"]),
        pitch_hz=[regions.pitch_at(m["pitch"], t) for t in C.PITCH_CHECKPOINTS_MS],
    )


def _cyc(cyc):
    return dict(cycles=cyc["cycles"], harm_db=cyc["harm_db"], neg_pos_peak=cyc["neg_pos_peak"])


def mean_tree(items):
    """The element-wise mean of equally shaped nested dicts and lists, ignoring NaN."""
    first = items[0]
    if isinstance(first, dict):
        return {k: mean_tree([i[k] for i in items]) for k in first}
    if isinstance(first, (list, tuple)) and first and isinstance(first[0], dict):
        return [mean_tree([i[n] for i in items]) for n in range(len(first))]
    if isinstance(first, str):
        return first
    values = np.array(items, dtype=float)
    if np.all(np.isnan(values)):
        return NAN if values.ndim == 1 else [NAN] * values.shape[1]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # a column of NaN stays NaN
        mean = np.nanmean(values, axis=0)
    return float(mean) if np.ndim(mean) == 0 else [float(v) for v in mean]


def _f(v, fmt="+.1f"):
    return "—" if v is None or not np.isfinite(v) else format(v, fmt)


def _st(a, b):
    return 12 * np.log2(a / b) if a and b and np.isfinite(a) and np.isfinite(b) else NAN


def _hz(v):
    if not np.isfinite(v):
        return "—"
    return f"{v / 1000:.2f} kHz" if v >= 1000 else f"{v:.0f} Hz"


def _region_lines(c, r, tonal):
    names = [n for n, _, _ in C.BANDS]
    bands = " · ".join(f"{n} {_f(a - b)}" for n, a, b in zip(names, c["bands_db"], r["bands_db"]))
    lines = [
        f"{r['name']}:",
        f"  level {_f(c['rms_db'] - r['rms_db'])} dB; above 2 kHz {_f(c['high_db'] - r['high_db'])} dB",
        f"  bands: {bands} dB",
        f"  centroid {_hz(c['centroid_hz'])} against {_hz(r['centroid_hz'])};"
        f" flatness {_f(c['flatness_db'], '.0f')} dB against {_f(r['flatness_db'], '.0f')} dB",
    ]
    if tonal:
        lines.append(
            f"  pitch {_f(c['pitch_hz'], '.1f')} Hz against {_f(r['pitch_hz'], '.1f')} Hz"
            f" ({_f(_st(c['pitch_hz'], r['pitch_hz']))} st)"
        )
        if r["cycles"] and c["cycles"]:
            h = [f"H{k + 1} {_f(c['harm_db'][k] - r['harm_db'][k])}" for k in (1, 2, 3)]
            lines.append(
                f"  {', '.join(h)} dB; negative half-cycle peak {_f(c['neg_pos_peak'], '.2f')}"
                f" of positive against {_f(r['neg_pos_peak'], '.2f')}"
            )
    return lines


def _wrap_deg(radians):
    return float(np.degrees(np.angle(np.exp(1j * radians)))) if np.isfinite(radians) else NAN


def _body_lines(c, r):
    span = r["span_ms"]
    if not r["cycles"] or not c["cycles"]:
        return [f"body {span[0]:.0f}–{span[1]:.0f} ms: no cycles to compare"]
    diffs = ", ".join(f"H{k + 1} {_f(c['harm_db'][k] - r['harm_db'][k])}" for k in range(1, 6))
    ref_h = " ".join(_f(v, ".1f") for v in r["harm_db"][1:6])
    cand_h = " ".join(_f(v, ".1f") for v in c["harm_db"][1:6])
    phase = ", ".join(f"H{k + 1} {_f(_wrap_deg(c['harm_phase'][k] - r['harm_phase'][k]), '+.0f')}°" for k in (1, 2))
    return [
        f"body {span[0]:.0f}–{span[1]:.0f} ms ({r['cycles']:.0f} reference cycles):",
        f"  {diffs} dB (H2..H6 re H1: {cand_h} against {ref_h}); phase re H1 {phase}",
        f"  negative half-cycle {_f(c['neg_pos_peak'], '.2f')} of positive against {_f(r['neg_pos_peak'], '.2f')};"
        f" its duration {_f(c['neg_pos_ms'], '.2f')} of positive against {_f(r['neg_pos_ms'], '.2f')}",
        f"  fullness (mean over peak) +{_f(c['pos_full'], '.2f')} −{_f(c['neg_full'], '.2f')}"
        f" against +{_f(r['pos_full'], '.2f')} −{_f(r['neg_full'], '.2f')};"
        f" top (share above 0.9 of peak) +{_f(c['pos_top'], '.2f')} −{_f(c['neg_top'], '.2f')}"
        f" against +{_f(r['pos_top'], '.2f')} −{_f(r['neg_top'], '.2f')}",
    ]


def _global_lines(c, r, tonal):
    lines = []
    if tonal:
        pitch = ", ".join(
            f"{_f(_st(a, b))} st at {t:.0f} ms" for t, a, b in zip(C.PITCH_CHECKPOINTS_MS, c["pitch_hz"], r["pitch_hz"])
        )
        lines.append(f"pitch: {pitch}")
    d = [f"{k} dB at {c['decay_ms'][k]:.0f} ms against {r['decay_ms'][k]:.0f}" for k in r["decay_ms"]]
    lines.append(f"envelope: peak at {c['peak_ms']:.0f} ms against {r['peak_ms']:.0f}; " + "; ".join(d))
    bins = " ".join(_f(a - b, "+.0f") for a, b in zip(c["click_bins_db"], r["click_bins_db"]))
    lines.append(
        f"click (>1 kHz, 0–10 ms): peak {_f(c['click_db'])} dB against {_f(r['click_db'])} dB re each peak;"
        f" per ms {bins} dB"
    )
    return lines


def _score_lines(stats):
    lines = []
    for key in ("stft", "band", "harm", "pitch", "wave", "total"):
        if key not in stats:
            continue
        s = stats[key]
        if s["sd"] == 0 and s["min"] == s["max"]:
            lines.append(f"  {key:6s} {s['mean']:.4f}")
        else:
            lines.append(f"  {key:6s} {s['mean']:.4f} ± {s['sd']:.4f} [{s['min']:.4f}, {s['max']:.4f}]")
    return lines + _coverage_lines(stats)


def _coverage_lines(stats):
    """The tracks' coverage: shares of the reference's span, mean over seeds."""
    parts = [
        f"{name} missing {stats[f'{name}_missing']['mean']:.0%} extra {stats[f'{name}_extra']['mean']:.0%}"
        for name in ("harm", "pitch")
        if f"{name}_missing" in stats
    ]
    return ["  coverage (share of the reference's track span): " + "; ".join(parts)] if parts else []


def _lag_note(lag):
    if abs(lag) < C.WAVE_MAX_LAG_MS - 1e-9:
        return ""
    return " (at the search limit: the onsets or the pitch disagree)"


def build(ref, cands, label, weights=None):
    """The report for one reference: a JSON-ready dict and its text."""
    r = summary(ref.m)
    c = mean_tree([summary(x.m) for x in cands])
    stats = score.spread([x.scores for x in cands], weights)
    seeds = [x.seed for x in cands if x.seed is not None]
    seed_text = f"{len(seeds)} seeds ({', '.join(map(str, seeds))}), mean shown" if len(seeds) > 1 else (
        f"seed {seeds[0]}; the render does not depend on the seed" if seeds else "a recording"
    )
    tonal = "tonal" if ref.is_tonal else "noise-like"
    head = [
        f"== {ref.name}  against  {label} ==",
        f"note {ref.note}, velocity {ref.velocity}, gate {ref.gate if ref.gate is not None else 'none'};"
        f" {seed_text}",
        f"reference: {ref.signal.ms:.0f} ms from onset at {ref.signal.onset_ms:.2f} ms"
        f" (threshold {ref.align.threshold_db:g} dB, lead {ref.align.lead_ms:g} ms);"
        f" {tonal} (flatness 5–150 ms {ref.flatness_db:.1f} dB)",
        f"candidate onset at {np.mean([x.signal.onset_ms for x in cands]):.2f} ms;"
        f" waveform lag {stats['wave_lag_ms']['mean']:+.2f} ms{_lag_note(stats['wave_lag_ms']['mean'])}",
        "values read candidate against reference; differences are candidate − reference",
        "scores (lower is closer):" + (" mean ± sd [min, max] over seeds" if len(cands) > 1 else ""),
    ]
    lines = head + _score_lines(stats)
    for cr, rr in zip(c["regions"], r["regions"]):
        lines += _region_lines(cr, rr, ref.is_tonal)
    if ref.is_tonal:
        lines += _body_lines(c["body"], r["body"])
    lines += _global_lines(c, r, ref.is_tonal)
    data = dict(
        reference=ref.wav,
        candidate=label,
        note=ref.note,
        velocity=ref.velocity,
        gate=ref.gate,
        seeds=seeds,
        tonal=ref.is_tonal,
        flatness_db=ref.flatness_db,
        scores=stats,
        per_seed=[x.scores for x in cands],
        reference_summary=r,
        candidate_summary=c,
    )
    return data, "\n".join(lines)
