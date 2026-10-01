# windsor#300: the voice drive stage, render cost

**Dev-machine indication only, and on a loaded machine.** Node renders
through the worklet harness, not an `AudioWorkletGlobalScope` in Chrome.
These are relative costs on one machine (CLAUDE.md invariant 5).

## Machine and method

| | |
|---|---|
| Machine | Apple M1 (laptop), macOS 26.5.1 |
| Runtime | Node v24.21.0, `npx tsx` (4.23.15), V8 JIT, one process per measurement |
| Load | other sessions were running test suites throughout: the 1-minute load average read 7 to 12 on 8 cores, so single readings scatter by ±25 % |
| Bench | `bench.mts` here: the #548 bench (`2026-09-15-548-fm-voice-loop-specialisation`) on today's paths. Four factory parts (`pad-drift`, `horde-horn`, `pickup-blip` and `hat` with sustain raised), three held notes each, 10 s of audio, filter on as the bank has it; each reading is the median of 5 runs of the four parts |
| Pairs | `pairs.mjs` here: before and after alternate, one process each, in alternating order, so the load falls on both; the result is the median of the per-round ratios after / before |
| Before | `main` at `191bb19` |
| After | this branch, rebased on `191bb19` |

A scenario sets both spellings of the drive, `filter.drive` (read before)
and `drive` (read after), so each checkout reads only its own.

## Results

### Against main (interleaved pairs)

| Scenario | Rounds | Median ratio after / before | Per-round ratios |
|---|---|---|---|
| Bypassed (gain 1) | 6 | 1.044 | 0.80, 1.04, 1.05, 1.04, 0.94, 0.93 |
| Bypassed (gain 1) | 10 | 1.046 | 0.81, 1.07, 1.18, 1.02, 1.08, 0.84, 0.73, 1.14, 0.95, 1.05 |
| Soft at gain 1.5 | 6 | 1.067 | 1.06, 1.09, 1.05, 1.07, 1.05, 1.13 |
| Soft at gain 1.5 | 10 | 1.091 | 1.04, 0.93, 1.11, 1.09, 1.09, 1.12, 0.86, 1.00, 1.10, 0.87 |

The bypassed stage adds one hoisted branch per sample; its ratio sits
inside the scatter (0.73 to 1.18). A soft drive costs about **7 %** more
than the old filter-held soft clip on this scenario: the new stage adds the
bias, the offset and the tone test to the same curve. The quieter first set
read 1.05 to 1.13 in every round.

### Each shape, after only (not interleaved)

Bias 0.2 for every shape but plain `soft`; `soft+bias+tone` adds tone 0.5.
Five processes each, median, with the readings:

| Scenario | Median | Readings (ms) |
|---|---|---|
| Bypassed | 513 ms | 498, 489, 513, 517, 558 |
| Soft | 634 ms | 595, 613, 652, 634, 664 |
| Soft, bias 0.2, tone 0.5 | 632 ms | 679, 654, 632, 590, 520 |
| Hard | 438 ms | 438, 442, 433, 435, 443 |
| Fold | 934 ms | 884, 934, 1045, 987, 905 |
| Tube | 1745 ms | 1585, 3065, 1869, 1730, 1745 |
| Diode | 2557 ms | 2557, 2978, 2230, 2346, 2844 |

These were not interleaved, so read only the large gaps: `tube` (a portable
tanh per sample) is about 3× the bypassed render and `diode` (two portable
log2 and two 2^x per sample) about 5×. In the scenario's terms the diode
adds about 2 s over 120 voice-seconds of audio, some 1.7 % of one core per
sounding voice on this machine. `hard` reading below bypassed is the load,
not the stage. A per-shape lookup table would cut the diode and the tube if
a patch library leans on them; nothing ships with them yet.

### The first version

The stage first ran as a `run()` method per sample, its curve another call
inside it. Against main, in single readings, not interleaved: bypassed
627.5 ms against 639.3 ms, but soft at gain 1.5 697.3 ms against 942.9 ms,
**+35 %**. The kernel is past V8's inlining budget, so the method stayed a
call. The shipped loops write `soft` and the tone pole out and call only for
the other shapes.

## Rerun

```
git archive <before> packages/engine/src | tar -x -C /tmp/before
node docs/research/2026-10-01-voice-drive/pairs.mjs /tmp/before . 10 bypassed,soft
node docs/research/2026-10-01-voice-drive/pairs.mjs - . 5 "" bypassed,soft,hard,diode,tube,fold
```

A quiet-machine rerun would tighten every figure here.
