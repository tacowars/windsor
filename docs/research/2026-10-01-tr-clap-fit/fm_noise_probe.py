"""Decision 4's probe: the colour of FM-coloured noise against the shared bandpass.

Run from `scripts/sound-match/`:

    python ../../docs/research/2026-10-01-tr-clap-fit/fm_noise_probe.py

FM-coloured noise (#327) is a sine at a fixed frequency phase-modulated by a
Noise operator. The engine's modulation is phase modulation by a fresh
uniform draw each sample, so the spectrum should be a line at the carrier
plus a flat floor, whatever the depth, rather than a band. This renders
the carrier (1 kHz, algorithm 5, D the Noise modulator, the filter and drive
off) at several modulator levels, and white noise through the shared
2-pole bandpass at 1 kHz for comparison, then reads each with the same
colour measure as `structure.py`, plus the share of power within ±20 Hz of
the carrier (the line).
"""

import copy
import sys
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path.cwd()))
sys.path.insert(0, str(Path(__file__).resolve().parent))
warnings.filterwarnings("ignore")
import renderer as R  # noqa: E402
from structure import colour  # noqa: E402

SR = 48000
CARRIER_HZ = 1000.0


def env_held():
    return dict(initLevel=1, attackTime=0, attackCurve=0, peakLevel=1, decayTime=0, decayCurve=0,
                sustainLevel=1, releaseTime=5, releaseCurve=0, endLevel=0, loopMode=2, keyScale=0)


def op(wave, level, fixed_hz=100.0):
    return dict(wave=wave, userPartials=None, ratio=1, fixed=True, fixedHz=fixed_hz, detune=0, level=level,
                feedback=0, velSens=0, levelKeyScale=0, phase=0, phaseFree=True, env=env_held())


def base():
    p = R.load_patch("tr808-clap")
    p = copy.deepcopy(p)
    p["algorithm"] = 5
    p["lfo"] = dict(shape=0, rate=5, amount=0, delay=0, retrigger=False, toPitch=0, modWheelDepth=0, toOp=[0, 0, 0, 0])
    p["drive"] = dict(on=False, gain=1, shape=0, bias=0, tone=1)
    p["filter"]["mode"] = 0
    return p


def fm(level):
    p = base()
    p["ops"] = [op(0, 1, CARRIER_HZ), op(0, 0), op(0, 0), op(4, level)]
    return p


def bandpassed(resonance):
    p = base()
    p["algorithm"] = 7
    p["ops"] = [op(4, 1), op(0, 0), op(0, 0), op(0, 0)]
    p["filter"].update(mode=3, cutoff=CARRIER_HZ, resonance=resonance, slope24=False, envAmount=0)
    return p


def line_share(x):
    p = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float(p[np.abs(f - CARRIER_HZ) <= 20].sum() / p.sum())


def main():
    rows = [(f"FM, Noise level {lv}", fm(lv)) for lv in (0.2, 0.3, 0.3536, 0.4, 0.5, 0.7071, 1.0)]
    rows += [(f"Noise into the bandpass, Reso {q}", bandpassed(q)) for q in (2, 3.5)]
    print("source                            line   peak  -3 dB band    -6 dB band    Q    | dB at 0.5 1 2 4 8 kHz")
    with R.Renderer() as r:
        for name, patch in rows:
            x = r.render(patch, seconds=0.5, seed=1)[int(0.05 * SR) :]
            c = colour(x)
            print(
                f"{name:32s} {line_share(x):5.2f}  {c['peak_hz']:5.0f} {c['minus3_hz'][0]:5.0f}-{c['minus3_hz'][1]:5.0f}"
                f"  {c['minus6_hz'][0]:5.0f}-{c['minus6_hz'][1]:5.0f}  {c['q']:4.2f} |"
                + " ".join(f"{v:5.1f}" for v in c["db_at"].values())
            )


if __name__ == "__main__":
    main()
