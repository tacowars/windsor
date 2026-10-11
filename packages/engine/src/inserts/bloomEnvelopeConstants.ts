/**
 * bloom's per-band envelope (`worklet/bloom/bloomEnvelope.ts`): how each
 * band's level follows its input. At the defaults it follows instantly.
 * Swell, Sustain and Freeze act here; their tunables go in this table.
 *
 * The laws (seconds s, host rate R):
 * - Swell s: a one-pole attack on each band's level that reaches 90 % of a
 *   steady level (−0.9 dB) s seconds after it starts: e ← x + a·(e − x),
 *   a = 10^(−`swellDecades`/(s·R)).
 * - Sustain s: a one-pole release that falls 60 dB in s seconds once the
 *   band's input has gone: r = 10^(−`sustainDecades`/(s·R)).
 * - Freeze: release r = 1 (held for ever) and the input gated off over
 *   `freezeSeconds`; on release the held bands fall 60 dB in at most
 *   max(Sustain, `freezeSeconds`).
 */
export const BLOOM_ENVELOPE = {
  /** Swell's attack reaches 1 − 10^(−this) of its target in Swell seconds: 1 is 90 %. */
  swellDecades: 1,
  /** Sustain's release falls 10^(−this) in Sustain seconds: 3 is 60 dB. */
  sustainDecades: 3,
  /**
   * What Sustain and Freeze hold is a charge that reaches 90 % of a band's
   * level in this, seconds: a note held this long sustains at its level, and
   * a blip (a neighbour band the onset passes through) far under it.
   */
  chargeSeconds: 0.1,
  /** Freeze's input gate ramps linearly over this, seconds; a band unfrozen falls 60 dB in at least this. */
  freezeSeconds: 0.05,
  /** A held band coming back to its input crossfades its phase over this, seconds. */
  relockSeconds: 0.02,
  /**
   * Presence: each band keeps a peak of its first filter stage's power that
   * decays at a quarter of the stage's own ring-down rate (its per-sample
   * factor is |pole|^½), so once the input stops the stage's amplitude falls
   * against the peak's as |pole|^(¾n). A one-pole's ring-down falls from its
   * first sample (the band's two-pole output starts falling only slowly), so
   * the input has left once the ratio is under `leaveRatio`: about 6 ms at
   * 220 Hz. It is back once the ratio reaches `returnRatio`. Both sit under
   * the ratio's ripple from a steady sine's image frequency (a few %).
   */
  leaveRatio: 0.9,
  returnRatio: 0.95,
  /**
   * The turn a held band keeps is captured every `captureRings`/(1 − |pole|)
   * samples, two deep, so it is older than presence's latency
   * (−ln(leaveRatio)/0.75 = 0.14 of the same unit): from before the
   * ring-down drifts the band's pitch towards its centre.
   */
  captureRings: 0.15,
  /** The peak under this is 0 (no denormals while a band is held for minutes). */
  powerFloor: 1e-30,
  /**
   * A band is selected while its gate is at least `closingGate`. A selection
   * that closes before `selectRings`/(1 − |pole|) samples (3 time constants
   * of its ring-down: 130 ms at 220 Hz) was an onset passing through the
   * band, or a glide: the band is fleeting, and Sustain holds it only
   * `closingSeconds` (60 dB), as is a band outside Low…High (`bands.enabled`),
   * even frozen. Selection is judged only while the band's input
   * level is at least `selectShare` × its level (its input drives it; a
   * ring-down's frequency wanders). A held band relocks only to its input
   * while selected, never to a neighbour's leak.
   */
  closingGate: 0.99,
  closingSeconds: 0.02,
  selectRings: 3,
  /** A held band relocks once selected this long (the same unit: 44 ms at 220 Hz). */
  relockRings: 1,
  selectShare: 0.5,
  /** A held band under this level (−140 dB) stops sounding. */
  levelFloor: 1e-7,
  /** A held phase smaller than this (no direction) is restarted at this magnitude. */
  phaseFloor: 1e-6,
};
