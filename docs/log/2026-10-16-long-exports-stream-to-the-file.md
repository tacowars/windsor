# Long exports stream to the file, and a WAV can be 32-bit float

- **Date:** 2026-10-16
- **Status:** proposed (windsor#822, awaiting tacowars's look)
- **Links:** windsor#822 · the measurement
  `docs/research/2026-10-16-long-audio-export/` · the export records of
  windsor#40, windsor#41 and windsor#51 · the follow-up for streamed stems,
  windsor#829

## Context

An export refused any render past `RENDER_MAX_FRAMES`, 15 minutes at
48 kHz, so a 30-minute song could not be exported at all. The cap guards
the tab's memory: a song export held the float render, then the whole
encoded WAV in one `Uint8Array`, then a `Blob` wrapping it for the sink.

Save as writes through a `FileSystemWritableFileStream`, which keeps the
picked file's old contents until `close()`. The WAV can therefore go into
it chunk by chunk as it is encoded, and a cancel or a failure still leaves
the file as it was.

## Decision

1. **Save as of the mix streams** (issue decisions 1 and 2). With the save
   picker and Stems off, `runStreamedExport` (`audioExportStream.ts`)
   renders the song, opens the picked file's writable, and has the engine's
   `encodeWavStream` write the header and then one chunk of
   `WAV_ENCODE_CHUNK_FRAMES` frames at a time, each write awaited, from one
   reused chunk buffer. The chunks together are `encodeWav`'s file byte for
   byte. On success the run closes the writable once. On a cancel or a
   failure at any point it aborts the writable, if it is open, and reports
   `cancelled` or `failed`. This path makes no whole-file `Uint8Array` or
   `Blob`. The old rule, "nothing reaches the sink until the file is whole"
   (`runToSink`), becomes for this path "nothing reaches the picked file
   until the writable closes". The close is still the commit point
   (windsor#51 decision 2): a Cancel once it is called changes nothing.
2. **Two caps** (issue decision 3).
   - `RENDER_MAX_FRAMES` keeps its value and meaning for the in-memory
     paths: Download, and Stems on either destination.
   - `RENDER_STREAM_MAX_FRAMES` covers the streamed path: 77 minutes at
     48 kHz. The longest song the format holds is 256 bars of 12/8 at
     20 BPM, 76.8 minutes by `songSeconds`. With the 10 s tail, the 60 ms
     lead-in and the output stage's latency it fits, less than two seconds
     under the cap, which `renderRefusal.test.ts` pins in every output stage
     mode. Headless Chrome 155 on an Apple M4 Pro exported that song at
     24-bit and at 32-bit float through the streamed run, with the
     renderer's peak at 1 957 MiB, against 3 682 and 5 332 MiB for today's
     whole-file path (`docs/research/2026-10-16-long-audio-export/`). So
     the cap is the full length, not the issue's 35-minute fallback.
   - `renderRefusal` and `renderSong` take the cap as a parameter that
     defaults to `RENDER_MAX_FRAMES`. The console's `exportRefusal` passes
     the stream cap for Save as with Stems off. `renderRefusal` also takes
     the text's last clause, what the user can change.
   - A Download refused only by the smaller cap, in a browser with the save
     picker, says so and names Save as: "the song and its tail run 30.0
     minutes, longer than the 15.0 minutes this export can hold at this
     sample rate — a download holds the whole file in memory; Save as…
     writes the WAV to the file as it encodes and can export it". Every
     other refusal ends as before: "choose a lower sample rate, a shorter
     tail, fewer bars or a faster tempo". The refusal's "a render can hold"
     became "this export can hold", since the two caps belong to the
     exports, not the render.
3. **32-bit float WAV** (issue decisions 4 and 5). `WAV_BIT_DEPTHS` is
   `[16, 24, 32]`, and 32 (`WAV_FLOAT_BIT_DEPTH`) means IEEE float.
   `WAV_BIT_DEPTH_DEFAULT` stays 24.
   - The header is `WAVE_FORMAT_IEEE_FLOAT` (3), with an 18-byte `fmt `
     chunk (`cbSize` 0) and a `fact` chunk carrying the frame count before
     `data`: 58 bytes. Every new number is in `renderConstants.ts`.
   - Samples are written as they are: little-endian float32, no dither, no
     clip. A non-finite sample is written as 0.
   - `clipped` counts the samples beyond ±1 that a float file kept, and its
     non-finite samples too. The toast is a `warning`: "saved a.wav to x —
     3 samples over full scale, kept in the float file". A PCM file's toast
     is unchanged ("… clipped at full scale; lower the master level and
     export again").
   - The control's third option reads `32-bit float`; 16 and 24 keep their
     labels. Stems take the same setting, so each stem WAV can be float.
   - A header whose RIFF size would pass its 32-bit field (a file past
     4 GiB) is refused with a `RangeError`. No cap reaches it: the longest
     streamed float file is about 1.77 GB.
4. **Stems stay in memory** (issue decision 7). Stems keep
   `RENDER_MAX_FRAMES` and their in-memory zip on both destinations. A
   streamed stored zip, with a data descriptor after each entry, is
   windsor#829. At 32-bit float a stems zip reaches 4 GiB sooner, and
   `StoredZipWriter` refuses it with a `RangeError`, as it always has past
   4 GiB.

## Consequences

- A song up to the longest the format holds exports through Save as. A
  browser without the save picker still exports up to
  15 minutes at 48 kHz.
- The streamed export holds the float render whole: about 1.77 GB at the
  stream cap. It is also quicker to finish: encode and write took 2.1–3.6 s
  at the cap against 23–25 s for the whole-file path. Streaming the render itself (an offline render in passes) is
  not part of this change.
- `RenderStemsOptions` and the stems' run are unchanged; they pass no cap
  and get `RENDER_MAX_FRAMES`.
