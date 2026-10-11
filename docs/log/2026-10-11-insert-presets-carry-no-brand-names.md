# Insert presets carry no brand names

- **Date:** 2026-10-11
- **Status:** accepted (tacowars's direction, with the names chosen from
  proposed sets)
- **Links:** #695 · `docs/research/2026-09-25-695-ensemble.md`

## Context

#695 labelled the chorus's and the ensemble's presets after the machines
their numbers come from: Juno I, Juno II and Juno I + II on the chorus, and
"ARP Solina / Logan String Melody" and "Roland RS-202 (Ensemble I)" on the
ensemble (#695 decisions 4 and 9). tacowars wants the labels generic, with
no brand or model names.

## Decisions

1. **A preset is named for what it does.** Its id and label name no
   manufacturer or model. The chorus's presets are Slow (`slow`, Juno-60
   mode I), Fast (`fast`, mode II) and Both (`both`, I + II). The
   ensemble's are Light (`light`, the Solina and Logan String Melody
   values, still the kind's defaults) and Deep (`deep`, the RS-202's
   Ensemble I).
2. **Provenance stays.** Each preset keeps its `source` URLs, and the
   comments in `chorusPresetTables.ts` and `ensemblePresetTables.ts` still
   name the machine and the measurement behind every value. A preset still
   needs a public source; this changes the label, not that rule.
3. **No format change.** A song stores an insert's values, never a preset
   id (`insertPresets.ts`), and the picker matches values back to a preset,
   so a saved song shows the new label with nothing to upgrade.
