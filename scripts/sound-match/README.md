# Sound match

Tools that let an agent "hear" a recording and a patch render by
measurement: where they differ, in terms that point at synth controls, and a
search of a patch's numbers toward the recording. The choices behind them
are in `docs/log/2026-10-01-sound-match-toolkit.md`. The method grew out of
the kick fit (`docs/research/2026-09-30-kick-fit/`); nothing here imports
it.

The numbers say where a render differs and by how much. Whether it sounds
right is tacowars's call, by ear.

## Setup

Node 24 (`.nvmrc`) renders; Python 3.12 or later measures and fits. From
this folder:

```bash
python3 -m venv /tmp/sound-match-venv          # anywhere outside the repository
/tmp/sound-match-venv/bin/pip install -r requirements.txt
source /tmp/sound-match-venv/bin/activate
```

`render.mjs` runs the generated `packages/engine/src/worklet/generated/fm-processor.js`.
If the DSP source has changed since that bundle was built, rebuild it from
the repository root first: `node scripts/build-worklets.mjs`.

Run every command from this folder: the Python scripts import each other.
They write no `__pycache__` here.

### Dependencies and licences

Windsor is AGPL-3.0 (root `CLAUDE.md`, invariant 7). Each dependency is
compatible:

| Package | Use | Licence |
|---|---|---|
| numpy | arrays, FFT | BSD-3-Clause |
| scipy | WAV reading, filters, resampling, Nelder–Mead | BSD-3-Clause |
| matplotlib | `--png` overlays | Matplotlib License (PSF-based, BSD-style) |
| cma | CMA-ES | BSD-3-Clause |

## The references

Recordings stay outside the repository; nothing derived from them (a WAV,
an excerpt) is committed. Every output goes to `<tmp>/sound-match/` unless
told otherwise (`python3 -c "import tempfile; print(tempfile.gettempdir())"`).

Any WAV loads: 8, 16, 24 or 32-bit integer or 32-bit float, any rate, any
channel count. It is mixed to mono and resampled to 48 kHz.

A spec's WAV paths expand `$VARS` and `~`, so a spec names no one's
folders. `specs/tr909-kick.json` reads `$SM_909_KICKS`:

```bash
export SM_909_KICKS="<…>/SamplesFromMars_909_kicks_digital_clean"
```

## Commands

### Render a patch: `render.mjs`

```bash
node render.mjs tr909-kick --note 60 --velocity 1 --seconds 1 --seed 1 --out /tmp/kick.wav
node render.mjs fitted.json --gate 0.25          # note-off after 250 ms
node render.mjs --server                          # JSON lines on stdin
```

The patch is a library id, a library file (`{ format, …, patch }`) or a bare
patch JSON. Without `--gate` no note-off is sent. The WAV is 32-bit float,
mono, 48 kHz. `--out` defaults to `<tmp>/sound-match/render.wav`.

Every render passes `processorOptions.seed` (default 1), so noise,
free-running start phases and random pan are reproducible here. Live
playback passes none and keeps drawing from `Math.random`.

Server mode reads one request per line, `{"patch", "note", "velocity",
"seconds", "gate", "seed", "out"}`, where `patch` may also be a patch object.
With `out` it writes that WAV and answers `{"ok":true,"frames":n,"out":…}`.
Without it the answer line is followed by `frames` little-endian float32
samples. `renderer.py` is the Python client.

### Measure one sound: `analyze.py`

```bash
python analyze.py sound.wav [--threshold-db -40] [--lead-ms 0.05] [--json out.json]
```

Prints a summary by region and writes every measurement as JSON.

### Compare: `compare.py`

```bash
python compare.py REF.wav [REF.wav ...] CANDIDATE [--note 60] [--velocity 1] [--gate S]
                  [--seeds 4] [--ref-threshold-db DB] [--ref-lead-ms MS]
                  [--tonal auto|yes|no] [--weights stft=1,wave=2] [--json PATH] [--png [PREFIX]]
```

CANDIDATE, the last argument, is a WAV or a patch. A patch is rendered for
each reference. One block of text per reference, the same as JSON in
`--json` (default `<tmp>/sound-match/compare/<candidate>.json`), and with
`--png` a six-panel overlay per reference (waveform 0–30 ms, level envelope,
band envelopes, pitch, per-cycle shape, spectrogram difference).

For the 909 pack, which carries about 2.5 ms of near silence before the
attack edge, align on the edge:
`--ref-threshold-db -6 --ref-lead-ms 1.5`.

### Fit: `fit.py`

```bash
python fit.py specs/tr909-kick.json [--budget N] [--method cma|nelder-mead] [--out-dir DIR]
```

The spec (format in `spec.py`'s docstring; example in `specs/`) names the
start patch, the parameters as JSON paths with bounds and scale, the
references (each with note, velocity, gate, weight and alignment), the
weights, the seeds and the optimizer. The structure stays the start patch's:
algorithm, waves and routing are chosen by whoever writes the spec, and the
optimizer moves only the numbers it names. One fit may span several
references, for example accent off at velocity 0.7 and accent on at 1.

It writes `best.json` (a bare patch, playable with `render.mjs`),
`log.jsonl` (every evaluation) and `summary.json` to `--out-dir` (default
`<tmp>/sound-match/fit-<spec>/`). The start patch is scored first and kept
unless beaten. A start value outside its bounds is clipped to them, with a
warning, before that first score, so `best.json` always stays in bounds. `--budget` counts every evaluation, the start's included,
and is never exceeded: when less than a CMA population remains, that many
candidates are evaluated and the search stops without learning from them.

### Which control moves what: `sensitivity.py`

```bash
python sensitivity.py specs/tr909-kick.json tr909-kick [--step 0.05] [--ref 0]
```

Moves each spec parameter by ±5 % of its range and tabulates how each
headline measurement moves per +step: decay times, click, pitch at 10 and
40 ms, body H2 and H3, symmetry, and centroid and band levels per region.
A parameter at a bound gets a one-sided difference over the side that moved,
scaled by its real change; one that cannot move at all shows "pinned".

### Render speed: `renderer.py`

```bash
python renderer.py tr909-kick --seconds 1 --count 200
```

## Alignment, level and noise

- **Onset.** The first sample above `threshold_db` of the peak, less
  `lead_ms` (default −40 dB, 0.05 ms). The candidate is aligned by the
  reference's rule unless given its own, and padded if its onset sits closer
  to the start than the lead.
- **Length.** The candidate is cut or padded to the reference's length. A
  render lasts the reference's length plus 50 ms, at most 4 s.
- **Level.** Each side is normalised to its own peak (or RMS, `--norm rms`).
  The packs are normalised per voice, so absolute level means nothing.
- **Seeds.** A patch with a Noise operator or a `phaseFree` operator
  depends on its seed by its structure, whatever that operator's level, so a
  fit that raises a silent noise level is still scored over every seed.
  Any other patch is rendered with two seeds, and depends on its seed if
  they differ by a sample (a random LFO, say). A seed-dependent patch is
  scored over `--seeds` seeds (default 4, from `--seed-base` 1). The report shows the mean, and each score's standard
  deviation, minimum and maximum. A fixed seed gives identical numbers on
  every run.

## What is measured

Each is a track over time; the report reads them by region, 0–5, 5–30,
30–150 ms and the tail.

- **Pitch:** a whole cycle's frequency from zero crossings two apart, on a
  500 Hz zero-phase low-passed copy, stepped per half-cycle.
- **Harmonic profile, per cycle:** H1..H12 in dB and phase relative to H1.
  Each cycle (rising crossing to rising crossing) is resampled to 256 points
  and FFT'd. The grid follows the sweep, and the level's decay across the
  cycle is undone, both at the rates the neighbouring cycles show; without
  that, a sweeping or decaying sine reads as rich in harmonics.
- **Symmetry, per cycle:** the negative half's peak and duration against
  the positive halves on either side; each half's fullness (mean over peak:
  0.64 for a sine, 1 for a square) and top (share above 0.9 of its peak).
- **The body:** from 5 ms to the reference's last cycle within 6 dB of its
  loudest. The candidate is summarised over the reference's span.
- **Band envelopes:** <150, 150–600, 600–2k, 2–6k, >6k Hz, RMS dB in 1 ms
  bins to 30 ms, then 5 ms bins.
- **Spectral centroid and flatness:** per 512-point frame; per region, from
  one FFT of the whole region.
- **Level envelope:** peak per ms, peak time, and the last time above −20
  and −40 dB.
- **The click:** above 1 kHz (causal high-pass) over 0–10 ms: peak and per-ms
  RMS, relative to the signal's peak.

A voice is tonal when the reference's spectral flatness over 5–150 ms is
below −25 dB; then pitch and harmonics count.

## Scores

Each is reported separately; lower is closer.

| Score | What | Default weight |
|---|---|---|
| `stft` | multi-resolution STFT loss: spectral convergence plus mean absolute log-magnitude difference, FFT sizes 256 / 1024 / 4096, hops at a quarter, floored 80 dB below the reference's loudest bin | 1 |
| `band` | RMS dB difference of the band envelopes, floored at −60 dB | 0.1 |
| `harm` | RMS dB difference of H2..H12 per reference cycle above −30 dB (tonal) | 0.04 |
| `pitch` | RMS semitones per half-cycle step, 2–300 ms (tonal) | 0.2 |
| `wave` | waveform MSE over 0–30 ms at the best lag within ±2 ms | 2 |

`wave` is the only score that sees polarity and where exactly a click
lands. The weights put each term on the same order at a typical kick
mismatch (stft about 0.7, band 5 dB, harm 12 dB, pitch 5 st, wave 0.4).
Tune them per fit in the spec. The tunables are in `constants.py`.

## Reading a report

Values read "candidate against reference"; differences are candidate minus
reference. Some readings and the controls they point at:

| Reading | Look at |
|---|---|
| 0–5 ms above 2 kHz well below | the click: an edge operator's level, phase, decay; the filter's cutoff |
| pitch high at 5–20 ms, right after | the pitch envelope's amount, decay and curve |
| pitch off by the same amount everywhere | the body's ratio or the note |
| −40 dB time short | the body's release or decay |
| body H2 low, negative half-cycle 1.00 against 1.2 | the body is symmetric where the recording is lopsided: a phase-locked second harmonic, feedback |
| a band's level off in one region only | the operator or envelope that sounds in that region |

`sensitivity.py` turns the guesses into numbers for a given patch.

## Speed

How fast the renderer and a fit run, on which machine and how it was
measured, is in `docs/research/2026-10-01-sound-match-throughput/`.

## Limits

- A per-cycle reading needs cycles: below about 30 Hz or above about 500 Hz
  (the low-pass) the pitch track and harmonic profile are not meaningful,
  and for noise voices they are skipped.
- The 909 tail's half-cycles are lopsided in the recording (the recording
  chain's coupling, most likely); the report shows it, and the body span
  keeps it out of the body summary.
- Velocity sensitivity, accent and gate are only fitted when the spec has
  references that differ in them.
