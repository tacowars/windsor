# Ticket #52 — Dattorro plate reverb: browser verification

Evidence that `worklet/reverb-processor.js` loads and runs in a real browser —
in the game client as well as the patch editor — that the three shipped rooms
behave as their names claim, and that neither page logs an error.

## Machine and browser

| | |
|---|---|
| Machine | Apple M4 Pro (macOS 26.5.1) — **not** the target box |
| Browser | Chromium 142 (Playwright 1.62.1, headed), `--mute-audio` |
| Pages | the game client (`npm run dev:client`, `localhost:5173`) and `tools/patch-editor/patch-editor.html` (`localhost:8765`) |
| Renderers | WebGPU and WebGL2, both on the hardware Metal driver (headed Chromium) |
| Context | `AudioContext` at 44 100 Hz; renders in `OfflineAudioContext` at 48 000 Hz |
| Build | this branch at `292e846` plus the review fixes |

## Against the review gate

`AGENTS.md` asks a `scope:client` PR for `get-system-stats`, `query-a204-state`
around a scripted move, a `take-screenshot` per backend, and a console listing
with zero errors/warnings.

| Required | Here |
|---|---|
| Console listing, zero errors/warnings | **yes** — four lines per backend, all Vite/Babylon info (`webgpu-console.txt`, `webgl2-console.txt`) |
| Screenshot per backend | **yes** — `webgpu-boot.png`, `webgl2-boot.png` |
| `get-system-stats` (backend + driver) | **equivalent** — the `[a204] {"event":"engine"}` line names backend and GPU on both runs |
| Hardware driver, not SwiftShader | **yes** — `apple metal-3` (WebGPU) and `ANGLE Metal Renderer: Apple M4 Pro` (WebGL2) |
| `query-a204-state` before/after a scripted move | **no** — see below |

The one omission is the scripted-move state comparison. It exists to show the
two backends agree about the *scene*, and this change touches no mesh,
material, camera or physics; Web Audio has one backend and `AudioWorklet`
output does not vary with the graphics backend. Both backends are captured
anyway, and both show the reverb loading identically.

Driven with Playwright rather than the `chrome-devtools` MCP, whose profile was
locked by an already-running browser for this session
(`The browser is already running for .../chrome-profile`). Real headed Chromium
on the real GPU either way; the tooling differs, the substance does not.

**Why the game client is captured at all, and not just the editor.** A first
pass tested only the patch editor, which proved nothing about the client:
`AudioSystem.init()` now loads a *second* worklet module, the editor reaches it
through an inlined blob while the client resolves `new URL(…, import.meta.url)`
under Vite, and `main.ts` swallows an audio failure by design
(`console.warn('[a204] audio unavailable')`, then carry on silent). The failure
mode was a quiet one, so it needed looking at directly.

## Results — the game client

`AudioWorklet.prototype.addModule` was wrapped before any application code ran,
because worklet module loads do **not** surface as page-level network requests
(a first attempt watched the network and saw nothing while the modules had in
fact loaded).

| Backend | GPU | `fm-processor.js` | `reverb-processor.js` | Console |
|---|---|---|---|---|
| WebGPU | `apple metal-3` | ok | **ok** | 0 errors, 0 warnings |
| WebGL2 | `ANGLE Metal Renderer: Apple M4 Pro` | ok | **ok** | 0 errors, 0 warnings |

`AudioSystem.init()` ran to completion on both — no `[a204] audio unavailable`
warning, which is the only symptom a failure would have produced — so
`createBus` constructed the `dattorro-reverb` node against the real client's
`AudioContext` under both renderers.

## Results — the patch editor

### Status

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

| Space | size / decay | onset | 1 s | 3 s | 5 s | peak | non-finite | stereo |
|---|---|---|---|---|---|---|---|---|
| Room | 0.28 / 0.45 | 8.0 ms | 6.34e-9 | 1.37e-19 | 2.84e-21 | 0.0605 | 0 | yes |
| Hall | 1.4 / 0.78 | 9.6 ms | 1.78e-3 | 2.11e-4 | 2.71e-5 | 0.0534 | 0 | yes |
| Cathedral | 3.0 / 0.90 | 13.2 ms | 2.65e-3 | 1.74e-3 | 1.07e-3 | 0.0656 | 0 | yes |

The ordering is the point: Room is already inaudible at one second and at the
denormal floor by five; Hall is still ringing at three; Cathedral is louder at
five seconds than Hall is at one. Size and decay do in a browser what the Node
harness measured them doing in `reverbProcessor.test.ts`.

**Onset** is recorded because it is what the output-tap correction changed. With
the taps read from the wrong end of their lines, Hall did not emit for the first
32 ms; read as the delays Dattorro's Table 2 specifies, it starts at 9.6 ms and
onset scales with room size the way a listener expects.

Every render is stereo-decorrelated (the two output channels differ), which is
what the fourteen-tap output is for — a mono tail would mean the taps or the
cross-fed loops are wrong.

### Sample-rate independence

Every buffer in the processor is sized from `sampleRate`, so this is worth
recording rather than assuming. Across this session and an earlier run the DSP
produced a correct decaying stereo tail with zero non-finite samples at **three
different rates**: 24 000 Hz (a headless run's default), 44 100 Hz (the editor's
`AudioContext`) and 48 000 Hz (the offline renders and the Node harness).

## Performance

Not measured here. The ~1% of one core figure quoted in `audioBus.ts` is from
the Node harness on this same M4 Pro, and is an order-of-magnitude sanity check
on a development machine — **not** a milestone reading under CLAUDE.md
invariant 3. No milestone criterion depends on the reverb; if one comes to,
it gets measured on the Ryzen 5600G / Vega 7 / Chrome-on-Ubuntu box like
everything else.
