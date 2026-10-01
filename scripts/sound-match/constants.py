"""The toolkit's tunables: analysis grids, bands, floors and default weights.

Everything numeric the measurements and scores depend on lives here, so a
sweep or a spec can override it without editing the logic.
"""

SR = 48000

# Time regions of the diagnostic report, in ms. `None` is the end of the sound.
REGIONS = (
    ("0–5 ms", 0.0, 5.0),
    ("5–30 ms", 5.0, 30.0),
    ("30–150 ms", 30.0, 150.0),
    ("tail", 150.0, None),
)
# "The body", whose cycles are summarised for harmonics and symmetry: from
# BODY_START_MS to the last cycle of the reference within BODY_DB of its
# loudest. The candidate is summarised over the reference's span.
BODY_START_MS = 5.0
BODY_DB = -6.0

# Bands for the band envelopes, in Hz. `None` is open-ended.
BANDS = (
    ("<150", None, 150.0),
    ("150–600", 150.0, 600.0),
    ("600–2k", 600.0, 2000.0),
    ("2–6k", 2000.0, 6000.0),
    (">6k", 6000.0, None),
)
BAND_FILTER_ORDER = 4
# Bands at or above this edge are summed into the report's "above 2 kHz" line.
HIGH_BAND_HZ = 2000.0

# Band-envelope bins: 1 ms to 30 ms, 5 ms after.
ENV_FINE_MS = 1.0
ENV_FINE_UNTIL_MS = 30.0
ENV_COARSE_MS = 5.0

# Pitch track: half-cycles of a low-passed copy (zero phase).
PITCH_LP_HZ = 500.0
PITCH_LP_ORDER = 2
# Half-cycles and cycles quieter than this, relative to the loudest, are dropped.
PITCH_MIN_LEVEL_DB = -40.0
# Pitch is read at these times for the report.
PITCH_CHECKPOINTS_MS = (2.0, 5.0, 10.0, 20.0, 40.0, 80.0)

# Pitch-synchronous harmonic profile.
HARMONICS = 12
CYCLE_POINTS = 256
# The sweep correction moves a cycle's ends by at most this share of its period.
WARP_MAX = 0.4

# Waveform symmetry: a half-cycle's "top" is its share above this fraction of its peak.
TOP_FRACTION = 0.9

# Spectral centroid and flatness over time.
SPECTRAL_FFT = 512
SPECTRAL_HOP = 96
# Frames quieter than this, relative to the loudest, get no centroid.
SPECTRAL_MIN_LEVEL_DB = -60.0
# Flatness floors each bin this far below the frame's loudest, so empty bins
# above the sound's bandwidth do not drive it to zero.
FLATNESS_FLOOR_DB = -80.0
# A region's centroid and flatness come from one FFT of the whole region, at least this long.
REGION_FFT_MIN = 4096

# Level envelope: peak per window; decay times are the last window above these.
LEVEL_WINDOW_MS = 1.0
DECAY_DB = (-20.0, -40.0)

# The click: above this frequency, over the first CLICK_MS.
CLICK_HP_HZ = 1000.0
CLICK_HP_ORDER = 4
CLICK_MS = 10.0
CLICK_ENERGY_MS = 20.0

# Alignment defaults: onset is the first sample above `threshold_db` of the
# peak; the signal starts `lead_ms` before it.
ALIGN_THRESHOLD_DB = -40.0
ALIGN_LEAD_MS = 0.05

# Normalisation per comparison: "peak" or "rms".
NORM = "peak"

# Tonal detection: a reference whose spectral flatness from BODY_START_MS to
# 150 ms is below this (dB) is treated as tonal (pitch and harmonic scores apply).
TONAL_SPAN_MS = (5.0, 150.0)
TONAL_MAX_FLATNESS_DB = -25.0

# Scores.
STFT_SIZES = (256, 1024, 4096)
STFT_FLOOR_DB = -80.0
BAND_FLOOR_DB = -60.0
HARM_FLOOR_DB = -60.0
# Cycles below this (re the loudest) do not count toward the harmonic score.
HARM_MIN_LEVEL_DB = -30.0
PITCH_SCORE_MS = (2.0, 300.0)
PITCH_MISSING_ST = 24.0
HARM_MISSING_DB = 60.0
# Coverage penalties: the harmonic and pitch scores compare only where the
# candidate's track overlaps the reference's, and add this much per unit of
# the reference's span the candidate misses (plus per unit of the candidate's
# span past the reference's). A track ending at half the reference's span
# adds half of it, so it scores clearly worse than a full-length track with
# the same error; a track missing entirely costs the *_MISSING value.
HARM_UNCOVERED_DB = HARM_MISSING_DB
PITCH_UNCOVERED_ST = PITCH_MISSING_ST
WAVE_WINDOW_MS = 30.0
WAVE_MAX_LAG_MS = 2.0

# Default weights of the total. Tonal terms count only for tonal voices.
# They are set so each term is of the same order at a typical kick mismatch
# (stft about 0.7, band 5 dB, harm 12 dB, pitch 5 st, wave 0.4); a spec
# overrides them.
WEIGHTS = {"stft": 1.0, "band": 0.1, "harm": 0.04, "pitch": 0.2, "wave": 2.0}

# Noise: renders that depend on the seed are scored over this many seeds,
# unless a spec's "seeds" or a tool's --seeds forces a count.
SEEDS = 4
SEED_BASE = 1
# The index of 'Noise' in the engine's WAVE_NAMES (packages/engine/src/patch/patch.ts).
NOISE_WAVE = 4
# The patch's LFOs, and the shapes that draw from the voice's random source:
# LFO_SH (S&H) and LFO_DRIFT in packages/engine/src/worklet/fm/modeIds.ts.
LFO_KEYS = ("lfo", "lfo2")
RANDOM_LFO_SHAPES = (5, 6)

# Render length when none is given: the reference's, plus this, capped.
RENDER_MARGIN_S = 0.05
RENDER_MAX_S = 4.0
