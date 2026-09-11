# The audio bench arm, and what "audio load" means when the browser will not tell you

Date: 2026-09-11
Ticket: #445
Status: accepted

## Context

The music engine had never been in a reading. `main.ts` skipped the whole
`AudioSystem` under `?bench=1` — "a measurement window never pays for an
AudioContext" — so every M1–M4 line in `docs/research/` was taken with no
synth, no plate and no delay running. The only cost figures that existed were
two Node sanity checks: the plate at "~1 % of one core, not measured here"
(`docs/research/2026-08-31-52-dattorro-reverb/`) and 32 voices at ~10 % in
`docs/design/audio-architecture.md` §7, which labels itself "not a qualifying
measurement". Since #435 the music is a whole document Pat swaps with
`?music=<name>`, so a document can be arbitrarily heavier than `bed-01` and
nothing says what it costs.

Two different questions: does the music move the **frame** budget, and what
does the DSP cost on the **audio thread**. They need different instruments.

## Decisions

### 1. The arm is opt-in, and never in a control

`?bench=1` alone still builds no `AudioContext`. `?bench=1&audio=1` builds it
and plays `?music=<name>` through the window, and `run-bench.mjs --audio` pairs
that against **the same rung in silence** — same fort, same horde, same seed,
same route, same camera. So the pair varies the music and nothing else, and
every reading taken before this ticket remains a valid control for one taken
after it.

`?audio=1&music=0` is **refused by the options parser** rather than falling
back. The two ask for opposite things — build the audio and measure it, build
the audio and never start the transport — and unlike every other malformed
value here the header cannot tell you which happened: it would say `audio=1`
either way, and the line would read as a measurement of the music while
measuring a stopped transport.

The arm also gets one Chrome flag the control does not:
`--autoplay-policy=no-user-gesture-required`. A bench page disposes its input,
so no gesture is ever coming; without the flag the context stays suspended and
the arm measures silence. Because that flag is a real difference between the
two Chromes, **`contextState` is recorded at window open and a line that is
not `running` there is a recorder failure** — `run-bench.mjs` exits non-zero
naming the cause instead of emitting a second, accidental control.

### 2. The verdict does not change, and no audio field votes

The audio arm is a new `ArmKind` scored exactly as the VAT arm is: (a) the
three standing frame gates, re-derived from its own metrics, and (c) "the two
sides drew the same scene" — audio renders nothing, so its draw-call allowance
is only the terrain streamer's fractional wobble. The ±5 % band is **reported
and does not gate**: the arm exists to find out what the music costs, not to
assert in advance that it is free. Decision 7's on-screen gates never vote in
an audio pair either — both sides hold the same horde, so those gates would be
answering the horde's question rather than this arm's.

`loadPct`, `peakPct` and `underruns` are recorded and vote on nothing.
`bench/verdict.ts`'s thresholds are untouched.

### 3. "Load" is a duty cycle, sampled — because neither better path exists

The ticket asked for the first usable of three measurement paths. Probed on
this machine's Chrome 152 (`docs/research/2026-09-11-445-audio-bench-arm/`,
`probe.mjs`, reproducible):

- (a) `AudioContext.renderCapacity` — **absent**, and still absent under
  `--enable-experimental-web-platform-features` and two plausible
  `--enable-blink-features` names.
- (b) `performance.now()` inside `AudioWorkletGlobalScope` — **absent**
  (`typeof performance === 'undefined'`).
- (c) so, `Date.now()`: the only clock that scope has, at one-millisecond
  resolution against a **2.9 ms** quantum budget at 44.1 kHz.

One millisecond cannot time one quantum, so the processors do not try. They
read `Date.now()` either side of the render and add the difference, which is
the count of integer-millisecond boundaries that fell **inside** the call.
Boundaries arrive at a fixed rate in wall time, so counting the ones that land
inside `process()` and dividing by the interval's wall milliseconds estimates
the fraction of wall time the audio thread spent there. That is the DSP load,
sampled rather than measured.

Calibrated against synthetic loads of known duration (probe stage 2), the
estimator reads 0 % at rest and tracks the true load monotonically, **over-reading
it by roughly 2–3×** — the audio thread renders in bursts, so boundaries inside a
burst are not uniformly distributed over the call. The overlay line therefore
says `est`, `audioLoad.ts`'s header states the calibration, and the reference
docs tell a reader to take a single-digit `loadPct` as "the music is cheap"
rather than as a figure to two significant places.

`peakPct` inherits the same resolution and is a **lower bound**, which took a
review round to make true. A span of N boundary crossings proves the render
took more than `N − 1` ms and nothing about N itself, so the readout scales
`peakMs − 1`: one crossing reads 0 % (it proves nothing — the render may have
taken a microsecond and merely straddled a boundary), two crossings prove one
millisecond. It is useful exactly where it matters: a quantum near or over
budget crosses several boundaries and cannot hide.

### 4. The underrun count reports, and does not vote

`underruns` is the firmest number in the readout, and it is firm only because
it is deliberately conservative. The first draft counted a quantum whose
measured span *reached* the budget, which the review showed is wrong: a 2.2 ms
render from 1000.9 to 1003.1 ms crosses three millisecond boundaries and would
have been accused of missing a 2.902 ms deadline. Since N crossings prove only
`N − 1` ms of work, an underrun is counted when **`span − 1` reaches the whole
budget**. That under-counts real overruns by up to a millisecond's worth and
never invents one, which is the right direction for a number whose whole value
is that it cannot be argued with.

It is cumulative per processor, so a dropped report never loses one, and the
meter keeps a monotone total per id: the instantaneous fields expire when a
processor goes quiet, but a count of deadline misses is history and does not —
a window that suffered seven must not report zero because the part was disposed
afterwards.

It does not gate, for two reasons. There is no prior: no reading in this repo
has ever carried an underrun count, so a threshold would be invented rather
than derived. And the number this dev machine produces is not the number the
target box will produce — audio-thread scheduling is the most host-dependent
thing in the client. `audio-architecture.md` §7's "suggested criterion" (zero
underruns over a 60 s M3-equivalent window) stands as a *suggestion*, to be
argued in the first target reading's record with two real columns in front of
it.

### 5. Offline renders and the Node harness never report

The sampler is off until a `reportLoad` message turns it on, and only
`AudioSystem` sends one. `offlineRender.ts` builds its processors through
`processorOptions` and never posts, so a bake is untimed and unreported; the
Node harnesses likewise, except where a test drives the path deliberately. The
cost on a page that never turns it on is one branch per quantum.

## Consequences

- Bench schema is **11**: `header.audio` (null on every line before this
  ticket, and on every control) plus an `audio` metrics block of zeros on a
  non-audio line. Additive; a schema-1 reader still parses it.
- `AudioLoadReadout` reaches all three instruments through #245's shape — one
  `stats/lines/audio.ts` module, one `FrameSample` field pair in the single
  collector, one `summarise()` block — so the `?debug=1` frame window gets it
  for free and there is still one collector.
- The readout is the module #275 adds `audio.schedMs` to; that field is the
  main-thread half and is deliberately not in this ticket.
- The target-box session takes the first real pair after merge and re-runs the
  probe there. If that Chrome has `renderCapacity`, path (a) becomes available
  and the readout's internals change behind the same four fields — which is
  why the fields are defined in terms of what they mean, not how they are got.
