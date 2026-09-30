# Tape expansion: compatibility, cost and browser checks

Run `node docs/research/2026-09-30-tape-expansion/measure.mjs` from the repo
root. The script compiles the source at the merged PR #143 commit and the
working source with the same esbuild settings; it does not read generated
worklets. Raw timings and parity counts are in `measurement.json`.

## Measured cost

Apple M1 arm64, Darwin 25.5.0, Node v24.21.0, V8 13.6.233.17-node.53.
Backend: source-bundled stereo DSP, no browser or audio device. Each timed
render is four seconds at 48 kHz with 128-frame configure calls. After one
four-second warmup, seven rounds alternate baseline/expanded order. The
browser QA session was closed before measurement.

| Scenario | Baseline median | Expanded median | Change |
|---|---:|---:|---:|
| Studio, steady controls, Hiss off | 85.29 ms | 53.63 ms | 37.1% less time |
| Ferric, Wear 63, Hiss -45 | 80.20 ms | 46.54 ms | 42.0% less time |
| Changing Drive/Bias and cycling legacy models | 77.45 ms | 77.89 ms | 0.6% more time |
| New VHS with independent wear and hiss | — | 47.37 ms | no equivalent baseline |

These timings measure this kernel and workload, not total app CPU, audio
thread scheduling, worst-case quantum time or underrun probability. Seven
models cost less than the original three at steady state because only the
audible model's filters run. Transitions retain multiple banks. The moving
scenario deliberately changes models frequently and should not be described
as a speedup. More filter state is preallocated for seven models.

## Legacy output

18 static configurations: three original models × Wear 0/63 × 44.1/48/96
kHz, with Drive 8, Bias -12, Hiss -45 and seed 123. All 6,912,000 stereo
Float32 samples match the baseline exactly and are finite. This establishes
parity for those cases, not every possible automation history. Live model
switches intentionally differ as documented in the decision record.

Permanent tests additionally check legacy Wear materialization without an
audio reset, isolated motion amounts, both rate controls, fast rate changes
from a slow interval, filter-bank reactivation, and complete song round trips.

## Browser check

Isolated Chrome 154.0.8037.58 at 1440px and 800px, local Vite server. Verified:

- Seven type choices, seven starting points and ten editable dials.
- Every starting point preserves Trim, Mix and bypass.
- Track/master edits persist to IndexedDB and restore with identical values.
- Importing an old `wear:47` insert displays three 47% amounts; the first
  Flutter increment saves Wow 47, Flutter 49, Dropouts 47 and `split:true`.
- Audio starts without captured application errors.
- Final labels and readouts fit without overlap at both widths.

Session screenshots: `/private/tmp/windsor-tape-expanded-desktop-fixed.png`
and `/private/tmp/windsor-tape-expanded-narrow-fixed.png` (local artifacts,
not durable repository assets). Musical listening approval remains pending.

Initial test attempts encountered a full local disk. Removing the session's
disposable Chrome profile allowed validation to continue; tests use
`--no-cache` to limit additional disk use. Root lint excludes the unrelated
`.claude/worktrees/` nested checkout, matching the tracked checkout's scope.

Final validation: typecheck, scoped root lint, tracked/untracked source
format check, worklet check, patch-index check and production build passed.
The full test run passed 267 files / 3,581 tests; three suites could not load
because temporary-file writes exhausted disk space. Rerunning those three
passed all 65 tests: 270 files / 3,646 tests covered in total. No test assertion
failed in those final runs, and no existing golden was changed.
