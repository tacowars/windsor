# UI text is US English

- **Date:** 2026-10-16
- **Status:** accepted: tacowars's direction in windsor#821
- **Links:** windsor#821 · `CLAUDE.md` (Conventions, "Spelling")

## Context

tacowars writes US English. Windsor's code came from Aotearoa204 with
British spelling, and a few labels, hints and messages carried it to the
user: the part color picker's "Colour", the Roll's "Quantise", the Settings
tab's "Normalisation report", and "cancelled" in the export, render and
checksum errors. New labels were written in whichever spelling the file
around them used.

## Decision

1. **User-visible text is US English.** Labels, titles, `aria-label`s,
   hints, toasts, report lines, error messages and the built-in patches'
   descriptions, which the patch browser shows: color, quantize,
   normalize, canceled, center, gray. windsor#821 changed the strings that
   did not follow it, and `CLAUDE.md` carries the rule so a new label is
   written in US English from the start.
2. **Identifiers and the format keep their spelling.** Code identifiers
   (`normalise()`, `partColourPicker.ts`), file names, CSS classes,
   comments, union tags such as the `'cancelled'` export outcome, and the
   song format's `colour` field stay as they are. Renaming the `colour`
   field is a format change, which bumps `ARRANGEMENT_VERSION` and refuses
   every saved song for no gain a user sees. Renaming identifiers is churn
   across hundreds of lines that no user sees either.
3. **Docs prose is not covered.** The rule is about what the app shows.

## Consequences

- A string a user can read and an identifier beside it may spell a word
  differently (`'Color'` inside `partColourPicker.ts`). That is expected.
- A review that finds British spelling in a label, hint or message treats
  it as a bug against this record.
