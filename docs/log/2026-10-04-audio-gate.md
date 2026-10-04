# The audio gate: a modal that starts or resumes audio whenever it is not running

- **Date:** 2026-10-04
- **Status:** accepted; built by windsor#578.
- **Mockup:** `docs/design/audio-gate-mockup.html`, approved by tacowars on
  2026-10-04. It sets the layout, the mark, the copy and the four states
  (first load, starting, failed, back from another tab). Its stand-in
  console is not built: the real console sits behind the scrim.
- **Builds on:** `2026-08-31-arrangement-console-and-runtime-arrangements`
  (the power button as the first user gesture), the CPU meter (windsor#13)

## Context

A browser keeps a page silent until a user gesture creates or resumes its
`AudioContext`. Windsor's one such gesture was the small "Enable audio"
button in the header, so people pressed ▶ first and heard nothing. On a
phone it was worse: iOS Safari suspends the context whenever the page goes
to the background (or marks it `interrupted` during a call), and the only
way back was to notice and click the CPU meter, which the power button had
become.

## Decision

1. **It cannot be dismissed.** The gate is a native `<dialog>` opened with
   `showModal()` and `closedby="none"`. `cancel` is prevented and a click
   on the backdrop does nothing. Chrome still lets a second Escape close a
   dialog whose `cancel` was prevented, so a `close` while audio is not
   running reopens the gate at once. The only way past it is its button,
   which calls `host.enable(doc)`: create and build on the first press,
   `unlock` (a `resume`) afterwards. While that is pending the gate shows
   *starting*, its button disabled; a throw shows *failed* with the error
   text, and the next press is a real retry (#617).
2. **It shows whenever audio is not running, never by device detection.**
   On load there is no context, and the gate shows *first load*. Once audio
   has come on, the gate follows the host's context: it opens in *back*
   when the context leaves `running` (`suspended`, or Safari's
   `interrupted`), checked on the context's `statechange` and on a
   `visibilitychange` back to visible, and it closes again if the context
   returns to `running` by itself. Desktop Chrome keeps the context running
   across a tab switch, so it never sees the gate again; iOS Safari does.
   No user-agent sniffing: the context's own state is the one fact that
   says whether a press is needed. `EngineHost` exposes that state and a
   subscription to it, which follows the context across a rebuild (which
   keeps it) and a failed start (which discards it), so the gate never
   listens to a closed context. The rules are a pure model,
   `audioGateModel.ts`, with its test.
3. **The header's power button loses its pre-audio state.** `#power` is
   hidden until audio first comes on, then becomes the CPU meter as before.
   Its click still calls `enable`, which with audio on only unlocks the
   context: harmless, and the gate covers it whenever unlocking is needed.
   The "audio on — press ▶ to play the document" toast is removed; the gate
   closing is the confirmation.
4. **The build line is stamped at build time.** Both `package.json`
   versions are `0.0.0`, so `vite.config.ts` injects the short commit and
   the UTC build date through `define` as `__WINDSOR_BUILD__` (declared in
   `src/buildStamp.d.ts`), null under `npm run dev`. The formats are the
   mockup's: `Windsor 9543344 · 4 Oct 2026` on a main build, `Windsor PR
   #576 · abc1234 · 4 Oct 2026` on a PR preview, `Windsor dev` under the dev
   server. On a pull request CI checks out a merge commit whose SHA names
   nothing a reader can find, so the `verify` step sets `WINDSOR_COMMIT`
   and `WINDSOR_PR` from the pull request's head SHA and number, and the
   build prefers them; otherwise the commit is `git rev-parse --short HEAD`.
   The footer's links are "Source" (the repository) and "AGPL-3.0" (its
   `LICENSE`).

## Consequences

- ▶ plays at once after the gate closes: no press is ever spent on a silent
  console.
- The card is centred on the screen (viewport units), not only in the
  fixed layout viewport: at 390 px the console's transport row is wider
  than the screen, and a phone widens the layout viewport to fit it, which
  would put a plainly centred card off to the side.
- The gate's mark is also the favicon (`packages/app/public/favicon.svg`).
- The *starting* state shows on a resume as well as on the first press. A
  resume is quick, so it is a flash at most.
- Every other modal (the restore question on reload, the metadata dialog)
  can open over the gate; the top layer stacks them in opening order, and
  the gate is still there when they close.
