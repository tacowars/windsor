# #33 FM audio engine — browser verification (indicative only, macOS)

Browser evidence for the `scope:client` change in PR #39, gathered by following
`docs/reference/browser-testing.md` §5 on the **macOS development machine**.

Every number here is **indicative only** (tech-demo proposal §5): this is not the
target machine, and a CDP client was attached throughout. **No performance claim
is made by #33 or by this record.** What these files establish is correctness —
the audio subsystem initialises on a normal startup, the worklet resolves and
runs on both the dev server and the production build, and the client still boots
and moves with audio wired in.

| Item | Value |
|---|---|
| Machine | Apple Silicon (macOS, Darwin 25.5.0), 1426×877 CSS render size in the `chrome-devtools` MCP's Chrome |
| Chrome | the `chrome-devtools` MCP's own instance (`new_page`), CDP attached |
| Build | Vite dev server, commit `672810c-dirty` (this branch, before the review fixes) |
| Versions | `@babylonjs/core` 9.23.0, `@babylonjs/inspector` 9.23.0, `@babylonjs/havok` 1.3.14, Node 24.20.0 |
| Bridge | `npx babylon-inspector` daemon, defaults (browser 4400 / CLI 4401), no `.babyloninspector` |
| Backends | WebGPU (session 1, `?debug=1`) and WebGL2 (session 2, `?debug=1&backend=webgl2`) |
| Standing | Indicative. Correctness only. |

## Files

Per backend (`webgpu-*`, `webgl2-*`):

- `get-system-stats.json` — engine and driver. WebGPU reports `driver: ""`
  (Babylon 9.23 `extractDriverInfo()` is empty on WebGPU); the hardware adapter
  is in `query-a204-state.gpu` (`apple metal-3`). WebGL2 names
  `ANGLE Metal Renderer: Apple M1` — a hardware renderer, not SwiftShader.
- `get-count-stats.json` — 1,790 meshes, 94 active, 94 draw calls at spawn.
- `query-a204-state-before.json` / `-after.json` — before and after the scripted
  move.
- `a204-motor.json` — the scripted move: `{"x":0,"z":6,"seconds":3,"yaw":1.57}`,
  180 ticks (3 s at the fixed 60 Hz step).

Shared:

- `after-move.png` — 960×540, after the scripted move. **One image, not one per
  backend** — see the note below.
- `audio-probe.json` — audio-specific evidence, since the standard command set
  has none.

## Result

**Both backends move identically and stay grounded.** Player z 32.03 → 49.83 over
3 s — 17.8 m at the scripted 6 m/s — with `support: "supported"`, `groundError`
≈ 0.14 m, and `fallthroughs: 0` on both. Audio being wired in changed nothing
about physics or streaming.

**Console is clean on both backends: zero errors, zero warnings.** The only
entries are Babylon's banner and the `[a204]` info events (`engine`, `debug`,
`chunks`, `bridge`). Critically, **no `[a204] audio unavailable` warning** —
`main.ts` wraps audio startup in a guard that would log one and continue silent,
so its absence is positive evidence that `AudioSystem.init()` succeeded on a
normal startup, on both backends.

**Audio, from `audio-probe.json`:** the dev server serves the worklet (200,
registers `fm-part`), it renders through `addModule` without a non-finite sample
(peak 0.5429), and a live `AudioContext` reaches `running` at 5.33 ms base
latency. For the production path, the build emits
`assets/fm-processor-D0Mo2pDI.js` (38,598 B), the entry chunk references that
exact name, and the built client — served with COOP/COEP, `crossOriginIsolated`
true, booting on WebGPU — loads and renders from it (peak 0.5655). That is the
evidence that `new URL(…, import.meta.url)` resolves the worklet in a real build,
which is what let the design doc close its worklet-bundling question.

## Note on the screenshot: #26 reproduced

The protocol asks for one screenshot per backend. Taking both produced
**byte-identical PNGs** (MD5 `b169d673…`, 64,596 B each) from two sessions that
`query-a204-state` correctly reports as WebGPU and WebGL2 respectively.

That is exactly the symptom in open issue **#26**: the bridge's `take-screenshot`
renders via the offscreen WebGL2 dump engine `DumpTools` creates, so the image is
backend-neutral and cannot show that the WebGPU path rendered. Rather than file
two identical images under names implying otherwise, this record keeps **one**,
named neutrally, and takes its backend attribution from the JSON
(`query-a204-state.backend`, `get-system-stats`), which is backend-faithful.

The identical hashes are independent confirmation of #26 from a second ticket.
PR #32 is revising the protocol wording; nothing here depends on the outcome.
