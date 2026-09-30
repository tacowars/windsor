# Measure four-instance Tape cost in the browser on a music program

Windsor [#211](https://github.com/tacowars/windsor/issues/211) is the
milestone C child of [epic #146](https://github.com/tacowars/windsor/issues/146)
that measures browser cost. The epic's target is four Tape instances in
under half a 48 kHz quantum, **1.33 ms, edits included**, on the recorded
M1 and Chrome. Phase 3's only browser figures were coarse 1 ms duty-cycle
counters on a synthetic probe, which cannot certify that target.

## Decision

Measure **mean** cost exactly and say plainly what that leaves open about
**peak**:

- **Mean.** A fresh `OfflineAudioContext` renders a deterministic
  20-second music program through one or four instances. The main thread
  times `startRendering()`, five repeats per cell. Duty is render time over
  20 s, and ms per quantum is duty × 2.6667.
- **Real time.** Each four-instance cell also runs a two-second
  `AudioContext` trial after phase 3's warmup. It keeps phase 3's
  `Date.now` boundary counters and adds a counter batched over 64 calls.
  `renderCapacity` would be reported if this Chrome had it.
- **Configurations.** Seven, declared before the run:
  - phase-2 legacy `TapeDsp`;
  - an identity core at 4×, for the filter's cost alone;
  - RK4 at 2× and 4×, and RK2 and RK4 at 8×, each with the span-48 pair
    and the symmetric decimator;
  - RK4 at 4× with phase 3's span-32 pair.

  Each runs steady and with phase 3's unsmoothed edits, with one and four
  instances: 28 offline cells.
- **Program.** FM bass, a detuned chord, noise hats and a 60 Hz kick,
  mixed to -6 dBFS. It is generated with basic arithmetic only, so Node
  and Chrome hash it identically.
- **Rule.** A configuration is **mean within target** when both
  four-instance offline medians are at most 1.33 ms. It is **not
  measured** when either has fewer than five repeats. Peak stays
  **unresolved** unless `renderCapacity` shows no underrun and
  `peakLoad` below 0.5.

The run is one `browser.mjs` invocation in an isolated, muted headless
Chrome, under a 900-second bound. The cells the assessment needs run
first. The core is Jatin Chowdhury's GPL-3.0-only CHOW Tape adaptation at
upstream `604372e4ffd9690c3e283362e4598cb43edbb475`, run raw, with no
`knee` policy. The
[research README](../research/2026-09-30-tape-browser-cost/README.md)
has the method, every table and the environment.

## Outcome

Apple M1, Chrome 154.0.8037.58, headless, muted. The bound expired at
900.3 s. All 14 four-instance cells and all 14 real-time trials completed.
Five one-instance cells were not reached. The page's program hash matched
Node's.

| Configuration | Four, steady (ms) | Four, edits (ms) | Multiple of legacy | Mean |
|---|---:|---:|---:|---|
| `legacy` | 0.178 | 0.203 | 1× | within target |
| `identity/4x/48s` | 0.552 | 0.549 | 3.11× / 2.71× | within target |
| `rk4/2x/48s` | 0.852 | 0.832 | 4.79× / 4.10× | **within target** |
| `rk4/4x/32` | 1.479 | 1.457 | 8.31× / 7.18× | outside target |
| `rk4/4x/48s` | 1.687 | 1.659 | 9.49× / 8.18× | outside target |
| `rk2/8x/48s` | 2.310 | 2.276 | 12.99× / 11.22× | outside target |
| `rk4/8x/48s` | 3.313 | 3.287 | 18.63× / 16.20× | outside target |

- **Filter share.** The span-48 pair alone is 32.7% of `rk4/4x/48s`
  steady and 33.1% with edits.
- **Peak.** Unresolved for every configuration.
  `AudioContext.renderCapacity` is absent in this Chrome. No trial showed
  a provable deadline miss, but that count is a lower bound.
- **One path or two.** One magnetic path, `rk4/2x/48s`, is within target
  on mean, at 64% of it. Every 4× and 8× candidate is outside. The numbers
  do not force an inexpensive/magnetic pair, but they allow one magnetic
  core for all uses only at 2×. Its accuracy is not measured here, and its
  peak is unresolved.
- **Two readings corrected or qualified.**
  - The declaration read a single long wall-clock batch as proof of lag.
    Device-callback jitter produces such batches even for legacy, so only
    a trial's mean carries that signal.
  - The real-time busy estimate is 0.73–0.94 of the offline median. This
    run does not say why.

**No product path, solver, factor, filter or default is chosen here.** No
candidate is certified.

## Still unresolved

- Candidate accuracy on the corner tones, including RK4 at 2×.
- Peak per-quantum cost, and the gap between the offline and real-time
  figures.
- The five one-instance cells this run did not reach.
- Milestone D: the product field-bounding method and the latency and
  bypass design.
- Milestone E: the original shipping implementation and its own
  measurement.
- The audition.
