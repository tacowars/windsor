# Long audio exports: memory of the whole-file and streamed paths (windsor#822)

The measurement behind windsor#822 decision 6, and behind the stream cap in
`docs/log/2026-10-16-long-exports-stream-to-the-file.md`.

## What was measured

Each case exports one song through the app's own run, in a headless Chrome
of its own, into a file in the origin-private file system
(`navigator.storage.getDirectory()`). A headless browser cannot drive the
native save dialog, so the file handle comes from OPFS instead, and it gives
the same `FileSystemWritableFileStream` a save picker's handle does.

- **Whole file** is today's Save as path: `runAudioExport` renders, encodes
  the whole WAV with `encodeWavAsync`, wraps it in a `Blob`, and
  `writeInChunks` writes the `Blob` into the writable in 1 MiB slices.
- **Streamed** is the new path: `runStreamedExport` renders, opens the
  writable, and `encodeWavStream` writes the header and then 65 536 frames
  at a time into it.

Both paths render with the cap lifted to `RENDER_STREAM_MAX_FRAMES`, so the
whole-file path is measured at lengths the app refuses it.

The song is the engine's fixture `FULL_DOCUMENT` (a kick, a hat, an arp line
and a chord pad, each live for the whole song) at three lengths, all 48 kHz,
stereo:

| song | transport | tail | rendered |
|---|---|---|---|
| 15 min | 225 bars of 4/4 at 60 BPM | 2 s | 15.0 min |
| 30 min | 225 bars of 4/4 at 30 BPM | 2 s | 30.0 min |
| stream cap | 256 bars of 12/8 at 20 BPM, the longest song the format holds | 10 s | 77.0 min |

Memory is the resident set size (`ps -o rss`) of every process of that
browser's profile, sampled once a second for the whole run. "Renderer" is
the largest renderer process, which runs the page, the offline render and
the encoder. "Browser" is the browser process, which holds a `Blob`'s bytes
and does the file writes. Each case runs in a fresh browser, so no case
inherits another's heap.

Render is `renderSong` alone. Encode + write is everything after it: the
encode, the `Blob` and the writes on the whole-file path, the streamed
encode and writes on the other, both up to the writable's `close()`. Every
file was read back from OPFS and its header checked against the render: RIFF,
format 1 (PCM) or 3 (IEEE float), 2 channels, 48 kHz, the bit depth, a `fact`
chunk equal to the frame count for float, a data chunk of frames × 2 ×
bytes per sample, and a file of exactly the header plus the data. Every file
passed. Each file was deleted after its case, and the profile with the
browser.

**Machine:** a 14-core arm64 laptop with 64 GB of memory, macOS 26.5.1,
Chrome 155.0.8059.80 headless (`--headless=new`), the same Chrome the
project's headless browser runs, in an instance of its own so that the
renderer process sampled is this page's alone. Offline rendering
(`OfflineAudioContext`). 2026-10-16, one run per case, the raw figures in
`results/2026-10-16T14-39-05-386Z.json`.

## Results

| song | path | depth | render s | encode + write s | file MiB | renderer peak MiB | browser peak MiB |
|---|---|---|---|---|---|---|---|
| 15 min | whole file | 24-bit | 16.1 | 4.7 | 248 | 831 | 761 |
| 15 min | whole file | 32-bit float | 16.1 | 4.3 | 330 | 915 | 931 |
| 15 min | streamed | 24-bit | 15.7 | 0.7 | 248 | 584 | 255 |
| 15 min | streamed | 32-bit float | 15.9 | 0.4 | 330 | 586 | 256 |
| 30 min | whole file | 24-bit | 31.2 | 9.3 | 495 | 1 357 | 1 269 |
| 30 min | whole file | 32-bit float | 31.4 | 8.2 | 660 | 1 563 | 1 159 |
| 30 min | streamed | 24-bit | 31.6 | 1.4 | 495 | 902 | 261 |
| 30 min | streamed | 32-bit float | 31.5 | 0.8 | 660 | 904 | 264 |
| stream cap (77.0 min) | whole file | 24-bit | 79.6 | 25.2 | 1 268 | 3 682 | 2 086 |
| stream cap (77.0 min) | whole file | 32-bit float | 79.3 | 23.2 | 1 691 | 5 332 | 1 592 |
| stream cap (77.0 min) | streamed | 24-bit | 78.7 | 3.6 | 1 268 | 1 957 | 305 |
| stream cap (77.0 min) | streamed | 32-bit float | 78.1 | 2.1 | 1 691 | 1 957 | 314 |

## Reading

- **Chrome exports the stream cap's length.** Every case completed,
  including the format's longest song at 32-bit float on the whole-file
  path (5.3 GB in the renderer). So the stream cap is the full 77 minutes
  (windsor#822 decision 3), not the 35-minute fallback.
- **The streamed path's renderer peak is the float render plus the page.**
  At 15, 30 and 77 minutes it is 584, 902 and 1 957 MiB; the float render
  alone is 330, 660 and 1 691 MiB (frames × 2 channels × 4 bytes), which
  leaves about 255–265 MiB for the page, the engine and the patch library.
  It does not change with the bit depth, since the file is never held:
  1 957 MiB at the cap at both depths.
- **The whole-file path adds at least the file.** Its renderer peak sits
  above the streamed path's by 0.9–1.0 times the file's size at 15 and
  30 minutes, and by 1.4 times (24-bit, +1 725 MiB on a 1 268 MiB file)
  and 2.0 times (float, +3 375 MiB on 1 691 MiB) at the cap. The encoded
  `Uint8Array` accounts for one file's worth; the rest at the cap is
  presumably the `Blob`'s copy while the browser process takes it, which
  this sampling cannot tell apart. The browser process holds the `Blob`
  too: 761–2 086 MiB against 255–314 MiB streamed.
- **Streaming is also faster.** Encode + write at the cap fell from 25.2 s
  to 3.6 s at 24-bit and from 23.2 s to 2.1 s at float. Not measured
  apart, but one likely share: the whole-file encoder yields with
  `setTimeout(0)` after each of its 3 383 chunks at the cap, and Chrome
  clamps a timer nested five deep to 4 ms, about 13.5 s by arithmetic. The
  streamed encoder pauses only on its awaited writes. Float encodes faster
  than 24-bit PCM on both paths, one `setFloat32` a sample against three
  byte stores and a rounding.
- **Render time is the same on both paths**, about 58× real time for this
  four-part song (78–80 s for 77 minutes).
- What the measurement does not show: a machine with less memory, where the
  whole-file path's 3.7–5.3 GB at the cap would be the first to fail, and a
  heavier song, which renders slower but holds the same buffers.

## Reproduce

From the repo root, with the engine's worklet bundles built:

```bash
node docs/research/2026-10-16-long-audio-export/measure.mjs --profile-root <a scratch folder>
# or a subset: --cases 30min-stream,cap-stream-32
```

`WINDSOR_CHROME` names another browser binary (the default is the macOS
Chrome app). The run writes `results/<timestamp>.json`. The files it writes
reach about 1.8 GB at once at the stream cap in 32-bit float, inside the
throwaway profile under `--profile-root`, and are deleted as it goes.
