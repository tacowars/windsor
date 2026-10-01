"""Short-time spectra and spectral flatness, shared by the measurements and the scores."""

import numpy as np

import constants as C

TINY = 1e-12


def stft_power(x, n_fft, hop):
    """Hann-windowed power spectra, frames centred at multiples of `hop`."""
    pad = np.pad(x, (n_fft // 2, n_fft // 2))
    frames = 1 + max(0, (len(pad) - n_fft) // hop)
    view = np.lib.stride_tricks.sliding_window_view(pad, n_fft)[::hop][:frames]
    return np.abs(np.fft.rfft(view * np.hanning(n_fft), axis=1)) ** 2


def flatness(p):
    """Geometric over arithmetic mean of power spectra (last axis), each floored relative to its own peak."""
    floor = np.max(p, axis=-1, keepdims=True) * 10 ** (C.FLATNESS_FLOOR_DB / 10) + TINY
    q = np.maximum(p, floor)
    return np.exp(np.mean(np.log(q), axis=-1)) / np.mean(q, axis=-1)
