# WebGL2 page — console and network evidence (#75)

Page: `http://localhost:5173/?debug=1&backend=webgl2` via chrome-devtools MCP
`new_page`.

## Console (final listing, after screenshot) — zero errors, zero warnings

```
msgid=1  [debug] [vite] connecting...
msgid=2  [debug] [vite] connected.
msgid=3  [log] BJS - [23:00:53]: Babylon.js v9.23.0 - WebGL2 - Parallel shader compilation
msgid=4  [info] [a204] {"event":"engine","backend":"WebGL2","gpu":"ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version) (Google Inc. (Apple); WebGL 2.0 (OpenGL ES 3.0 Chromium))"}
msgid=5  [info] [a204] {"event":"debug","shim":true,"bridge":true}
msgid=6  [info] [a204] {"event":"bridge","name":"Aotearoa204 WebGL2","port":4400,"connected":true}
msgid=7  [info] [a204] {"event":"chunks","built":1785,"disposed":0,"queued":0,"ms":504}
msgid=8  [info] [a204] {"event":"music","state":"started","bpm":96,"root":50,"scale":"dorian"}
msgid=9  [info] [a204] {"event":"music","state":"note","part":"kick","tick":0}
msgid=10 [info] [a204] {"event":"music","state":"note","part":"hat","tick":0}
msgid=11 [info] [a204] {"event":"music","state":"note","part":"arp","tick":0}
msgid=12 [info] [a204] {"event":"music","state":"note","part":"drone","tick":0}
```

(The final listing taken after `take-screenshot` adds only the known
`DumpTools` encoder banner, per browser-testing §5.)

- msgid=8: the transport started from the **JSON document** — bpm 96, root
  50, dorian, i.e. `arrangements/bed-01.json` — with no `arrangement`
  corrections event: the committed document normalised with zero corrections
  in the running game, on this backend too.
- msgid=9–12: all four parts announce their first note.

## Live apply over the document model (`__a204.audio.apply`, evaluate_script)

```js
__a204.audio.apply({ mix: { hat: { level: 0.3, sends: { echo: 0.4 } } }, wat: 1 })
// → { ok: true, ignored: ["wat"] }
__a204.audio.readout()
// → bpm 96, running: true, counters { kick: 49, hat: 121, arp: 158, drone: 12 }
```

The generalised `AudioSystem.apply` takes the document model live: the mix
section lands on the running strips, the unknown key is ignored and reported
by path, and the transport keeps running with all four counters advancing.

## Network (`list_network_requests`, paired per §7)

334 requests, every one `200` or `304` — no failures, no 404s.
`GET /src/audio/arrangements/bed-01.json?import [304]` is the build-time
module import; no runtime fetch exists.

## Cross-backend determinism note

The scripted move (`a204-motor {"x":0,"z":6,"seconds":3}`) ended at exactly
the same position on both backends — x 31.926960270031348,
z 49.83365709695272 — from the same start (x 31.94042669692059,
z 32.02891091424217): the shared sim is backend-independent, as invariant 1
requires.
