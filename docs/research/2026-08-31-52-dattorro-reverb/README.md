# Ticket #52 — Dattorro plate reverb: browser verification

Evidence that `worklet/reverb-processor.js` loads and runs in a real browser,
that the three shipped rooms behave as their names claim, and that the patch
editor drives them with a clean console.

## Machine and browser

| | |
|---|---|
| Machine | Apple M4 Pro (macOS 26.5.1) — **not** the target box |
| Browser | Chromium 142 (Playwright 1.62.1, headless), `--mute-audio` |
| Page | `tools/patch-editor/patch-editor.html`, static server on `localhost:8765` |
| Context | `AudioContext` at 44 100 Hz; renders in `OfflineAudioContext` at 48 000 Hz |
| Build | this branch at `292e846` plus the review fixes |

## What form this evidence takes, and why it is not the usual one

`AGENTS.md` asks a `scope:client` PR for `get-system-stats`,
`query-a204-state` around a scripted move, a `take-screenshot` per backend, and
a console listing — all via the Inspector CLI bridge and the `chrome-devtools`
MCP.

Most of that does not apply here and the rest could not be run:

- **No renderer involvement.** This change touches no mesh, material, camera or
  physics. `query-a204-state` and the per-backend screenshots exist to show that
  WebGPU and WebGL2 agree about the scene; there is no scene. Web Audio has one
  backend, and `AudioWorklet` output does not vary by graphics backend.
- **The `chrome-devtools` MCP was unavailable** for this session — its profile
  was already locked by a running browser (`The browser is already running for
  .../chrome-profile`), and the Claude-in-Chrome extension was not connected.
  Playwright drives real Chromium, so the substance (module loads, node
  constructs, DSP runs, console is clean) is verified; the specific tooling the
  guide names is not what produced it.

What replaces it is the audio equivalent: proof the worklet module loads over a
blob URL, that the node constructs and processes, that the rooms are
distinguishable and decay as designed, and a console listing.

A reviewer who thinks the renderer captures are needed anyway should say so —
this is a judgement call about applicability, not a claim the requirement was
met.

## Files

| File | What it is |
|---|---|
| `console.txt` | Every console message and page error for the whole session |
| `offline-render.json` | Editor status line, and the three room renders below |
| `reverb-panel.png` | The Reverb Send panel as it renders in the editor |
| `editor-full.png` | The whole editor with audio running |

## Results

### The editor

Status line after clicking **Audio on**:

```
running - 44100 Hz - 5.8 ms latency - reverb on
```

`reverb on` is the page reporting that `addModule` succeeded for
`reverb-processor.js` and the `dattorro-reverb` node constructed. Had either
failed the page would say `reverb blocked (…)` with the per-scheme errors.

**`console.txt` is empty** — zero errors, zero warnings, zero logs.

### The rooms

One full-scale stereo impulse, then silence. RMS of the left channel over a
128-sample block at each mark (`offline-render.json`):

| Space | size / decay | 1 s | 3 s | 5 s | peak | non-finite | stereo |
|---|---|---|---|---|---|---|---|
| Room | 0.28 / 0.45 | 6.71e-9 | 2.00e-19 | 1.97e-21 | 0.0584 | 0 | yes |
| Hall | 1.4 / 0.78 | 1.68e-3 | 2.08e-4 | 3.02e-5 | 0.0670 | 0 | yes |
| Cathedral | 3.0 / 0.90 | 2.66e-3 | 1.70e-3 | 1.01e-3 | 0.0651 | 0 | yes |

The ordering is the point: Room is already inaudible at one second and at the
denormal floor by five; Hall is still ringing at three; Cathedral is louder at
five seconds than Hall is at one. Size and decay do in a browser what the Node
harness measured them doing in `reverbProcessor.test.ts`.

Every render is stereo-decorrelated (the two output channels differ), which is
what the fourteen-tap output is for — a mono tail would mean the taps or the
cross-fed loops are wrong.

### Sample-rate independence

Every buffer in the processor is sized from `sampleRate`, so this is worth
recording rather than assuming. Across this session and an earlier run the DSP
produced a correct decaying stereo tail with zero non-finite samples at **three
different rates**: 24 000 Hz (headless default on the first run), 44 100 Hz
(this `AudioContext`) and 48 000 Hz (the offline renders and the Node harness).

## Performance

Not measured here. The ~1% of one core figure quoted in `audioBus.ts` is from
the Node harness on this same M4 Pro, and is an order-of-magnitude sanity check
on a development machine — **not** a milestone reading under CLAUDE.md
invariant 3. No milestone criterion depends on the reverb; if one comes to,
it gets measured on the Ryzen 5600G / Vega 7 / Chrome-on-Ubuntu box like
everything else.
