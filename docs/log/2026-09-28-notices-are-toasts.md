# Notices are toasts, not a header status line

- **Date:** 2026-09-28
- **Status:** accepted (Pat asked for it on 2026-09-28)

## Context

The console reported everything through one line of small text in the
header: a save, an import failure, a refused edit, the storage warning. That
line had three problems:

- **Each message erased the one before it.** The storage warning replaced
  "saved … in your library", and a failed enable was reported twice with
  only the second visible.
- **An error was as quiet as a confirmation.** Both were the same faint
  text, gone at the next edit.
- **It crowded the header.** The library summary sat beside it.

## Decision

Notices are toasts: a stack at the bottom right, drawn by `app/src/toast.ts`
over the pure `toastModel.ts`, with its tunables in `toastConstants.ts`.

- **One entry point.** `AppCtx.status(message)` became
  `AppCtx.notify(message, tone)`, and `toast.ts` exports the same `notify`
  for code with no context. It does nothing before the stack is mounted, so
  a DOM-free test is unaffected.
- **Four tones:** `info`, `success`, `warning` and `error`. Every call site
  chooses one. Info and success stay 4 s, a warning 8 s, and an error until
  it is dismissed.
- **Repeats join.** The same message in the same tone moves the showing
  toast to the newest place and counts it ("… ×3"). At most four show; a new
  one past that drops the oldest.
- **Reading pauses the timers.** Hovering over the stack, or focusing
  inside it, stops every timer; each toast has a × and Escape dismisses it.
  An error is `role="alert"`, and the rest sit in a polite live region.
- **The header holds no status text.** The library summary moved into the
  Parts tab's library row. The storage warning is a one-time warning toast.

## Consequences

- The engine's "`<part>` sounded" callback is no longer shown. It fired once
  per part on every build, and as toasts it would have stacked one per part
  each time audio started.
- A failed audio enable is reported once, by the host, which names the
  retry. The power button no longer repeats it.
- `LibraryModel.evictable` (from the follow-up to the user-library PR) is
  gone: the warning no longer needs a line to live on.
