# Dub delay — verification and audition

The original effect requested in #698 is in the Mixer insert picker on every
track and the song Master. The standalone page is generated from the real
engine. Open this ticket worktree's `tools/patch-editor/patch-editor.html`.

## Audition

Enable audio, choose a sound in Parts, then add **Dub delay** in Mixer.
Keep the existing Echo/Room sends down when assessing this insert alone.

- **Stereo trance:** play a short bright chord or arpeggio; left dotted
  eighth and right quarter repeats follow the Arrangement BPM. Change BPM
  while playing and listen to the pitch glide into the new time.
- **Dotted ping pong:** play one stab and release. Repeats alternate left
  and right. Each lane contributes its own wait, so changing just Right
  changes every other interval.
- **Long dub:** play a short chord, release, then turn Feedback toward 1.
  Sweep Low pass down and High pass up, then adjust Drive. Above 1 feedback
  can sustain regeneration; lower Feedback to let it end. Free clock mode
  exposes millisecond knobs for pitch-bending time sweeps.
- **Mid / side space:** use a stereo pad. The center and difference signal
  repeat at different times. A mono sound has no Side content by definition.

Mix controls only dry/wet; Output follows the blend. Preset selection keeps
Mix, Output and bypass. A manual change shows Custom. Export on Arrangement
saves all values, including each lane's inactive free-time/sync setting.

tacowars's listening verdict is pending. Mechanical results do not establish an
Ableton sound match or musical approval.

## Mechanical evidence

`inserts/delayDsp.test.ts` runs the generated processor: exact impulse timing,
channel isolation, alternating repeats, mid/side encoding, progressive
filtering, dry/bypass identity, output gain, 12-second storage, regeneration
and release, extreme edits at 44.1/48/96 kHz, and load/stop messages.
`delayMusical.test.ts` drives it with the real seeded FM processor playing
articulated saw bass and sustained pad chords.

`delayInsert.test.ts` checks fixed graph edits, mixer-owned output edges,
disposal, metering and initial/live/rejected/deferred tempo updates on track
and Master. `delaySpec.test.ts` checks correction reports, preset settings
and track/Master document round trips. Console tables are pinned to engine
defaults and bounds. The engine module-loading test covers file and override
URLs, including the new worklet.

`browser-check.mjs` uses Playwright against the generated file page. It
checks live track/Master insertion, preset and knob changes, mode changes
preserving prior edits, BPM propagation, export/re-import and real
OfflineAudioContext impulses in all three modes. Retained `browser.json`
records Chromium version, settings, render output and an empty console-error
list. This is a local audio/editor check, not game-renderer or target-machine
performance evidence. Run with Node 24 from the worktree root:

```sh
node docs/research/2026-09-25-698-delay/browser-check.mjs
```

## Production size

Node 24.20.0, macOS Apple Silicon, the lockfile-installed Vite; baseline is
the tracked files at `0658ab90` with the same dependencies (excluding the
maintainer's untracked local song). Client `dist/`, excluding source maps:
29,797,715 → 29,808,906 bytes, **+11,191 bytes**. The new processor is 8,308
bytes; the entry grows 751,746 → 754,629 bytes. No assets were added. Build
timestamps/commit metadata may slightly change future byte totals. This is
bundle size, not a runtime performance reading.
