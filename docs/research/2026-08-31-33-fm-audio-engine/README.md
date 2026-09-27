# #33 FM audio engine — browser verification (indicative only, macOS)

Browser evidence for the `scope:client` change in PR #39, following
`docs/reference/browser-testing.md` §5 on the **macOS development machine**.

Every number here is **indicative only** (tech-demo proposal §5): not the target
machine, CDP attached throughout. **No performance claim is made by #33 or by
this record.** What these files establish is correctness — the audio subsystem
initialises on a normal startup, the worklet resolves and runs on both the dev
server and the production build, and the client still boots, renders and moves
with audio wired in.

| Item | Value |
|---|---|
| Machine | Apple Silicon (macOS, Darwin 25.5.0), 1426×877 CSS render size in the `chrome-devtools` MCP's Chrome |
| Chrome | the `chrome-devtools` MCP's own instance (`new_page`), CDP attached |
| Build | Vite dev server, branch `feature/33-fm-audio-engine` after merging `origin/main` at `f6d880e` |
| Versions | `@babylonjs/core` 9.23.0, `@babylonjs/inspector` 9.23.0, `@babylonjs/havok` 1.3.14, Node 24.20.0 |
| Bridge | `npx babylon-inspector` daemon, defaults (browser 4400 / CLI 4401), no `.babyloninspector` |
| Backends | WebGPU (session 3, `?debug=1`) and WebGL2 (session 5, `?debug=1&backend=webgl2`) |
| Standing | Indicative. Correctness only. |

## Files

Per backend (`webgpu-*`, `webgl2-*`):

- `get-system-stats.json` — engine and driver. WebGPU reports `driver: ""`
  (Babylon 9.23's `extractDriverInfo()` is empty on WebGPU); the hardware adapter
  is in `query-a204-state.gpu` (`apple metal-3`). WebGL2 names
  `ANGLE Metal Renderer: Apple M1` — a hardware renderer, not SwiftShader.
- `get-count-stats.json` — 1,790 meshes, 95 active, 95 draw calls at spawn.
- `state-before.json` / `state-after.json` — `query-a204-state` either side of the
  scripted move.
- `a204-motor.json` — the move: `{"x":0,"z":6,"seconds":3,"yaw":1.57}`, 180 ticks
  (3 s at the fixed 60 Hz step).
- `screenshot.png` — 960×540, after the move.
- `console.txt` — the full `list_console_messages` listing.

Shared:

- `audio-probe.json` — audio-specific evidence, since the standard command set
  has none.

## Result

**Both backends move identically and stay grounded.** Player z 32.03 → 49.83 over
3 s — 17.8 m at the scripted 6 m/s — with `support: "supported"`, `groundError`
≈ 0.14 m, `fallthroughs: 0`, and 95 draw calls on both. Wiring audio in changed
nothing about rendering, physics or streaming.

**Console is clean on both backends: zero errors, zero warnings** — the listings
are in `webgpu-console.txt` and `webgl2-console.txt`, not merely asserted here.
The only entries are Babylon's banner and the `[a204]` info events. On WebGL2 a
second Babylon banner appears at the first screenshot; that is `DumpTools`'
PNG encoder, documented in browser-testing.md §5, not a stray engine.

**The audio-relevant assertion is a negative one.** `main.ts` wraps audio startup
in a guard that logs `[a204] audio unavailable` and continues silent. Neither
listing contains it, so `AudioSystem.init()` — which loads the worklet and builds
the buses — succeeded on a normal startup, on both backends.

**Audio, from `audio-probe.json`.** On the dev server the worklet is served (200,
registers `fm-part`) and renders through `addModule` with no non-finite sample
(peak 0.5429); a live `AudioContext` reaches `running` at 5.33 ms base latency.
For the production path, `npm run build -w packages/client` emits
`assets/fm-processor-D0Mo2pDI.js` (38,598 B) and the entry chunk references that
exact hashed name — which is what proves `new URL(…, import.meta.url)` resolves
the worklet in a real build, and is why the design doc could close its
worklet-bundling question.

## Note on the screenshots

The two captures are **byte-identical** (MD5 `a4265ae4…`, 64,434 B each). That is
expected and already documented: browser-testing.md §5, from decision
`2026-08-31-bridge-screenshot-backend-fidelity` (#26/#32), records that on this
machine the WebGPU and WebGL2 captures of the placeholder scene come out
byte-identical, and that a PNG never proves which backend ran.

Both are kept, per that protocol, as composition evidence — the pixels are
backend-faithful, rendered into an offscreen target on the active engine. Backend
attribution comes from `get-system-stats` and the `[a204] engine` event, which is
where this record takes it.
