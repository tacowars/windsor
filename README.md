# Windsor

A browser-based sequencer and DAW built on a custom four-operator FM engine:

- **Synthesis:** FM, harmonic waveforms and subtractive filtering in
  AudioWorklets.
- **Sequencers:** Euclidean, grid, chord, arpeggiator and bass/drone, driven
  by a harmony timeline.
- **Mixer:** channel strips with up to eight inserts each (compressor,
  classic and advanced drive, chorus, ensemble, phaser, dub delay, retro
  reverb), a plate and delay return, and a song master.

Everything runs in the browser, and the app deploys as static files. Try it
at <https://tacowars.github.io/windsor/>. Chrome is the tested browser.

Windsor began as the music engine and arrangement console of the game
Aotearoa204 and was forked on 2026-09-27. `#<n>` references in the code and
docs point at that repository's issues.

## Getting started

```bash
nvm use            # Node 24
npm ci
npm run dev        # http://localhost:5173
```

Click **Enable audio**, pick a sequencer for Part 1 and press ▶. Audition
with the QWERTY keys, the on-screen keyboard or a MIDI controller.

## Building and deploying

```bash
npm run build      # writes packages/app/dist/
npm run preview    # serves it locally
```

`packages/app/dist/` is a plain static site: HTML, the hashed app bundle and
one file per DSP worklet. Serve it from any static host over http(s); worklets
don't load from `file://`. The build uses a relative base, so it works under a
sub-path such as a GitHub Pages project site. Set `WINDSOR_BASE` to override
it.

CI (`.github/workflows/ci.yml`) runs `npm run verify` on every pull request
and every push to `main`. GitHub Pages serves the `gh-pages` branch:

- **Live:** a push to `main` that passes publishes the build to the branch
  root, <https://tacowars.github.io/windsor/>.
- **Previews:** a pull request from this repo that touches code publishes
  its build to `https://tacowars.github.io/windsor/pr-preview/pr-<N>/` and
  comments the link on the PR. Closing or merging removes it.

## Repository layout

- `packages/engine/`: `@windsor/engine`, the audio engine and its patch
  library.
- `packages/app/`: `@windsor/app`, the browser UI, plus the patch-library
  scripts.
- `scripts/`: the worklet bundler and the patch-library index.
- `docs/`: the design docs, decision records and research.

`npm run verify` is the gate every change passes. `CLAUDE.md` holds the
engineering rules.

## Licence

[GNU Affero General Public License v3.0](LICENSE).
