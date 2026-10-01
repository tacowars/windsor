"""Overlays of a candidate on a reference, for `compare.py --png`.

Six panels: waveform 0–30 ms, level envelope, band envelopes, pitch,
per-cycle shape at three points of the body, and the spectrogram difference.
Black is the reference, red the candidate (its first seed). A sound shorter
than a panel's window is padded with silence to it.
"""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

import analyze  # noqa: E402
import audio  # noqa: E402
import constants as C  # noqa: E402
import spectra  # noqa: E402

SPEC_FFT = 1024
SPEC_HOP = 256
SPEC_MAX_HZ = 12000
SPEC_RANGE_DB = 30
SPEC_FLOOR_DB = -70
VIEW_MS = 500


def _waveform(ax, ref, cand):
    # A sound shorter than the window is padded with silence, so both traces span it.
    n = int(C.WAVE_WINDOW_MS * C.SR / 1000)
    for sig, colour, label in ((ref.signal, "k", "reference"), (cand.signal, "r", "candidate")):
        ax.plot(np.arange(n) / C.SR * 1000, audio.fit_length(sig.x, n), colour, lw=0.8, label=label)
    ax.set_title("waveform, 0–30 ms", fontsize=9)
    ax.set_xlabel("ms")
    ax.legend(fontsize=7)


def _level(ax, ref, cand):
    for m, colour in ((ref.m, "k"), (cand.m, "r")):
        ax.plot(m["level"]["t_ms"], m["level"]["db"], colour, lw=0.8)
    ax.set_ylim(-60, 3)
    ax.set_title("level envelope (dB re peak)", fontsize=9)
    ax.set_xlabel("ms")


def _bands(ax, ref, cand):
    colours = plt.cm.viridis(np.linspace(0, 0.9, len(C.BANDS)))
    for k, (name, _, _) in enumerate(C.BANDS):
        ax.plot(ref.m["bands"]["t_ms"], ref.m["bands"]["db"][k], color=colours[k], lw=1, label=name)
        ax.plot(cand.m["bands"]["t_ms"], cand.m["bands"]["db"][k], color=colours[k], lw=1, ls="--")
    ax.set_xscale("symlog", linthresh=30)
    ax.set_ylim(C.BAND_FLOOR_DB - 10, 3)
    ax.set_title("band envelopes (solid reference, dashed candidate)", fontsize=9)
    ax.set_xlabel("ms (linear to 30, log after)")
    ax.legend(fontsize=6, ncol=2)


def _pitch(ax, ref, cand):
    for m, colour in ((ref.m, "k"), (cand.m, "r")):
        ax.plot(m["pitch"]["t_ms"], m["pitch"]["hz"], colour + ".", ms=3)
    ax.set_yscale("log")
    ax.set_xlim(0, min(ref.signal.ms, VIEW_MS))
    ax.set_title("pitch (half-cycles, Hz)", fontsize=9)
    ax.set_xlabel("ms")


def _cycles(ax, ref, cand):
    rt, rs = analyze.cycle_waveforms(ref.signal.x)
    ct, cs = analyze.cycle_waveforms(cand.signal.x)
    a, b = ref.m["body"]["span_ms"]
    inside = [i for i, t in enumerate(rt) if a <= t < b]
    if not ref.is_tonal or not inside or not len(ct):
        ax.set_title("per-cycle shape: not tonal, or no cycles", fontsize=9)
        return
    picks = sorted({inside[0], inside[len(inside) // 2], inside[-1]})
    phase = np.arange(C.CYCLE_POINTS) / C.CYCLE_POINTS
    for n, i in enumerate(picks):
        j = int(np.argmin(np.abs(ct - rt[i])))
        ax.plot(phase + n, rs[i], "k", lw=0.8)
        ax.plot(phase + n, cs[j], "r", lw=0.8)
        ax.text(n + 0.02, -1.1, f"{rt[i]:.0f} ms", fontsize=7)
    ax.set_title("per-cycle shape in the body (unit peak)", fontsize=9)
    ax.set_xticks([])


def _spectrogram(ax, ref, cand):
    r = spectra.stft_power(ref.signal.x, SPEC_FFT, SPEC_HOP)
    c = spectra.stft_power(cand.signal.x, SPEC_FFT, SPEC_HOP)
    floor = r.max() * 10 ** (SPEC_FLOOR_DB / 10)  # both floored against the reference's loudest
    diff = 10 * np.log10(np.maximum(c, floor) / np.maximum(r, floor))
    freqs = np.fft.rfftfreq(SPEC_FFT, 1 / C.SR)
    keep = freqs <= SPEC_MAX_HZ
    frames = min(diff.shape[0], int(VIEW_MS * C.SR / 1000 / SPEC_HOP))
    extent = (0, frames * SPEC_HOP / C.SR * 1000, 0, SPEC_MAX_HZ)
    im = ax.imshow(
        diff[:frames, keep].T,
        origin="lower",
        aspect="auto",
        extent=extent,
        cmap="RdBu_r",
        vmin=-SPEC_RANGE_DB,
        vmax=SPEC_RANGE_DB,
    )
    ax.set_title("spectrogram, candidate − reference (dB)", fontsize=9)
    ax.set_xlabel("ms")
    plt.colorbar(im, ax=ax)


def overlay(path, ref, cand, title):
    """Write the six-panel overlay of `cand` (a comparison.Candidate) on `ref` to `path`."""
    fig, ax = plt.subplots(2, 3, figsize=(16, 7.5))
    _waveform(ax[0, 0], ref, cand)
    _level(ax[0, 1], ref, cand)
    _bands(ax[0, 2], ref, cand)
    _pitch(ax[1, 0], ref, cand)
    _cycles(ax[1, 1], ref, cand)
    _spectrogram(ax[1, 2], ref, cand)
    fig.suptitle(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)
