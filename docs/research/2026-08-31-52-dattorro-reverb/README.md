# Ticket #52 — Dattorro plate reverb: browser verification

Evidence that `worklet/reverb-processor.js` loads and runs in a real browser —
in the game client as well as the patch editor — that the three shipped rooms
behave as their names claim, and that neither page logs an error.

## Machine and browser

| | |
|---|---|
| Machine | Apple M4 Pro (macOS 26.5.1) — **not** the target box |
| Browser | Chromium 142 (Playwright 1.62.1, headless), `--mute-audio` |
| Pages | the game client (`npm run dev:client`, `localhost:5173`) and `tools/patch-editor/patch-editor.html` (`localhost:8765`) |
| Renderer | WebGL2 on SwiftShader — headless, **software**; no WebGPU adapter available |
| Context | `AudioContext` at 44 100 Hz; renders in `OfflineAudioContext` at 48 000 Hz |
| Build | this branch at `292e846` plus the review fixes |

## What form this evidence takes, and where it falls short

`AGENTS.md` asks a `scope:client` PR for `get-system-stats`, `query-a204-state`
around a scripted move, a `take-screenshot` per backend, and a console listing
with zero errors/warnings — via the Inspector CLI bridge and the
`chrome-devtools` MCP. This is not that, and the gaps are worth naming
precisely rather than waving at.

**Covered, and it matters.** The first draft of this evidence tested only the
patch editor, which was a real gap: `AudioSystem.init()` now loads a *second*
worklet module, and a URL that resolves in the editor's inlined-blob path
proves nothing about `new URL(…, import.meta.url)` under Vite. `main.ts`
swallows an audio failure by design (`console.warn('[a204] audio unavailable')`
and carry on silent), so the failure mode here is a quiet one. The game-client
run below closes that.

**Not covered, and arguably not applicable.** `query-a204-state` before/after a
scripted move, and a screenshot per backend, exist to show WebGPU and WebGL2
agree about the scene. This change touches no mesh, material, camera or
physics, and Web Audio has one backend — `AudioWorklet` output does not vary
with the graphics backend.

**Not covered, and a genuine shortfall.** The run is headless on **SwiftShader**
with no WebGPU adapter, so it is not a hardware-driver capture and there is no
WebGPU listing. The `chrome-devtools` MCP was unavailable this session — its
profile was locked by a running browser (`The browser is already running for
.../chrome-profile`) and the Claude-in-Chrome extension was not connected — so
Playwright stood in for it. The console listing below therefore has **zero
errors but four warnings**, every one of them a software-rendering artefact
(`No available adapters`, `GPU stall due to ReadPixels`) rather than anything
this change emits.

A reviewer who wants the hardware-driver capture before merge is entitled to
it; it needs the MCP free, not more work on the branch.

## Files

| File | What it is |
|---|---|
| `game-console.txt` | Every console message from a game-client boot |
| `game-worklets.json` | Both `addModule` calls the client made, and their outcomes |
| `game-boot.png` | The client, booted, with audio running |
| `console.txt` | Every console message and page error from the patch editor |
| `offline-render.json` | Editor status line, and the three room renders below |
| `reverb-panel.png` | The Reverb Send panel as it renders in the editor |
| `editor-full.png` | The whole editor with audio running |

## Results — the game client

`AudioWorklet.prototype.addModule` was wrapped before any application code ran,
because worklet module loads do **not** surface as page-level network requests
(a first attempt watched the network and saw nothing, while the modules had in
fact loaded). `game-worklets.json`:

| Module | Loaded |
|---|---|
| `/src/audio/worklet/fm-processor.js` | ok |
| `/src/audio/worklet/reverb-processor.js` | **ok** |

Both resolve under Vite through `new URL(…, import.meta.url)`, and
`AudioSystem.init()` ran to completion — no `[a204] audio unavailable` warning,
which is the only symptom a failure would have produced. `createBus` therefore
constructed the `dattorro-reverb` node against the real client's `AudioContext`.

`game-console.txt` — **zero errors**. Four warnings, all from the headless
software renderer:

```
[warning] No available adapters.                       <- no WebGPU in this environment
[warning] GL Driver Message ... GPU stall due to ReadPixels   (x4, then suppressed)
[info]    [a204] {"event":"engine","backend":"WebGL2","gpu":"ANGLE (Google, Vulkan 1.3.0 (SwiftShader ...
```

The `[a204]` engine line names SwiftShader explicitly: this is the software
path, not a hardware driver.

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
different rates**: 24 000 Hz (headless default on the first run), 44 100 Hz
(this `AudioContext`) and 48 000 Hz (the offline renders and the Node harness).

## Performance

Not measured here. The ~1% of one core figure quoted in `audioBus.ts` is from
the Node harness on this same M4 Pro, and is an order-of-magnitude sanity check
on a development machine — **not** a milestone reading under CLAUDE.md
invariant 3. No milestone criterion depends on the reverb; if one comes to,
it gets measured on the Ryzen 5600G / Vega 7 / Chrome-on-Ubuntu box like
everything else.
