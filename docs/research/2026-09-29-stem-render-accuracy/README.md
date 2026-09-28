# How closely the stems sum to the master (windsor#41)

The stem export renders one WAV per part and per return beside the master
(`packages/engine/src/render/renderStems.ts`). The issue asks three things:
that the stems summed equal the master with its dynamics bypassed, within a
stated tolerance; that every stem has the master's length and start; and
that a render split into passes lines up exactly. This note records what was
measured for each, and two things the measurement turned up about the
master WAV itself.

Every number below is a sample value, not a timing, read on one machine: an
Apple M1 running macOS 26.5.1. "Node" is Node 24.20 running the headless fake
graph (`__fixtures__/fakeAudioNodes.ts`) under Vitest. "Chrome" is headless
Chrome 153 (`HeadlessChrome/153.0.0.0`) and its own `OfflineAudioContext`,
driven through the Vite dev server with the real worklets.

## The song

The fixture song, `__fixtures__/fullArrangement.ts`: four parts (kick, hat,
arp, drone), with the hat sending to the echo and the arp and drone to the
room. That makes six stems. Its master was set to no inserts, so the only
dynamics left are the engine's safety limiter.

## Stems summed against the master before its dynamics

The reference is the master tapped just before the limiter
(`engine.master`, after the master's level, the music fader and the output
gain), in the same pass as the stems.

| Where | Master level | Reference peak | Largest error | RMS error |
|---|---|---|---|---|
| Node, 8 kHz | 0.7 | 0.54 | 9.2e-8 | — |
| Chrome, 48 kHz | 1.0 | 1.42 | 2.35e-7 (−132.6 dBFS) | 1.5e-8 |
| Chrome, 48 kHz | 0.25 | 0.36 | 4.9e-8 (−146.3 dBFS) | 3.6e-9 |

What is left over is float32 rounding: each part's stem runs through its own
copy of the music bus's 30 Hz highpass, and the stems are summed in a
different order from the master's. The stated tolerance is **1e-6 of full
scale**, which `renderStems.test.ts` asserts on the headless graph. The
largest error measured is below one 24-bit step (1.19e-7) when the stems are
at or below unity gain, and at most two steps above it.

## Length and start

In both environments every stem, like the master, is the song plus its tail
in frames, taken from the same pass buffer past the same lead-in. For
example, Chrome at 44.1 kHz with a 2 s tail gives 529,200 frames in every
file.

## Passes line up

Chrome rendered the song twice at 44.1 kHz: once in one pass, and once in
six passes of one stem each (`passLimits: { maxChannels: 4 }`). All six
stems came out **bit-identical** between the two. The master did not: it
differed by up to 4.8e-7.

## Finding: the master itself is not bit-identical from render to render in Chrome

Two plain `renderSong` renders of the same song in Chrome differ by up to
1.0e-6, starting a few hundred frames in. Every stem is bit-identical across
renders; only the master differs.

The master's input sums three or more sources: the dry bus and each return.
Chrome does not fix the order in which it sums a node's inputs, and float
addition is not associative, so the rounding changes from one render to the
next. A sum of two inputs is exact in either order, which is why the room
return, fed by two sends, came out bit-identical.

The WAV export's claim that two renders are bit-identical (windsor#40
decision 7) holds on the headless graph, where its test runs. In Chrome it
holds to about −120 dBFS: a few 24-bit steps.

For this reason the stem render does not check its passes bit for bit. It
keeps a copy of the first pass's master and compares each later pass's
master with it frame by frame (`stemLineup.ts`). The largest absolute
difference at any one frame must be at most 1e-5
(`RENDER_STEM_LINEUP_TOLERANCE`), ten times the 1.0e-6 measured here.
The comparison runs in chunks of 65,536 frames. Between chunks it yields to
the event loop and checks for Cancel, as the WAV encoder does.

A pass that drifted, even by a single frame, moves real audio against
itself, and the difference is of the order of the audio. An earlier version
compared per-quantum envelopes instead. Code review caught that a transient
moving within its 128-frame block leaves the envelope unchanged, so that
check would have let a sub-quantum drift through.

## Finding: the limiter delays and lifts the master

Aligning the limited master (the master WAV) with the stems' sum, the best
fit was a lag of **288 frames at 48 kHz: 6 ms**. That is the lookahead of
Chrome's `DynamicsCompressorNode`.

Chrome's compressor also applies automatic makeup gain. With the master
level at 0.25, well below the −6 dBFS threshold, the limited master peaked
at 0.53 while the signal before the limiter peaked at 0.36.

So, in Chrome:

- the master WAV (windsor#40) starts 6 ms after bar 1;
- the master WAV is louder than the mix before the limiter, even where the
  limiter is not limiting;
- the stems, taken before the limiter, sit 6 ms ahead of the master WAV in
  the same zip.

The stems are what the issue asks for (the master before its dynamics).
Whether the master WAV should compensate for the lookahead, or bypass the
safety limiter's makeup gain, is a question about windsor#40's export, not
this one.
