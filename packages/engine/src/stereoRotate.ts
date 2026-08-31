/**
 * The channel strip's pan: a stereo rotation, not a `StereoPannerNode`.
 *
 * Every part's worklet output is already stereo -- `pan`, `panKey`, `panRandom`
 * and `spread` place voices across the image inside the part. Per the Web
 * Audio spec a `StereoPannerNode` fed a stereo input does not reposition it: it
 * switches to a balance law that attenuates one side, so panning a wide pad
 * right would mute its left half and collapse it rather than move it.
 *
 * A rotation keeps the width and moves the centre:
 *
 *   L' = L·cos θ − R·sin θ
 *   R' = L·sin θ + R·cos θ        θ = pan · π/4
 *
 * Built from a splitter, four gains and a merger -- six native nodes, all in
 * the audio thread. Decision: docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md §4.
 *
 * The splitter is `channelInterpretation: 'discrete'` by spec, so a mono source
 * would land on the left input only; feed this stereo, which every part is.
 */

/** Gains of the 2x2 matrix, named output·input: `lr` is R's contribution to L'. */
export interface RotationGains {
  ll: number;
  lr: number;
  rl: number;
  rr: number;
}

/** Hard left or right is a quarter turn: a centred source lands fully on one side. */
export const PAN_ANGLE_MAX = Math.PI / 4;

export function clampPan(pan: number): number {
  return Math.min(1, Math.max(-1, pan));
}

export function rotationAngle(pan: number): number {
  return clampPan(pan) * PAN_ANGLE_MAX;
}

export function rotationGains(pan: number): RotationGains {
  const theta = rotationAngle(pan);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { ll: c, lr: -s, rl: s, rr: c };
}

export interface StereoRotate {
  /** Connect the stereo source here. */
  readonly input: ChannelSplitterNode;
  /** Route this onward. */
  readonly output: ChannelMergerNode;
  /** The four matrix gains, for graph assertions. */
  readonly gains: Readonly<Record<keyof RotationGains, GainNode>>;
  readonly pan: number;
  setPan(pan: number): void;
  dispose(): void;
}

/** Wire a rotation set to `pan` (-1 left .. 1 right). */
export function createStereoRotate(context: BaseAudioContext, pan = 0): StereoRotate {
  const input = context.createChannelSplitter(2);
  const output = context.createChannelMerger(2);
  const gains = {
    ll: context.createGain(),
    lr: context.createGain(),
    rl: context.createGain(),
    rr: context.createGain(),
  };

  // Splitter output 0 is L, 1 is R; merger input 0 becomes L', 1 becomes R'.
  input.connect(gains.ll, 0);
  input.connect(gains.lr, 1);
  input.connect(gains.rl, 0);
  input.connect(gains.rr, 1);
  gains.ll.connect(output, 0, 0);
  gains.lr.connect(output, 0, 0);
  gains.rl.connect(output, 0, 1);
  gains.rr.connect(output, 0, 1);

  let current = clampPan(pan);
  const apply = (): void => {
    const g = rotationGains(current);
    gains.ll.gain.value = g.ll;
    gains.lr.gain.value = g.lr;
    gains.rl.gain.value = g.rl;
    gains.rr.gain.value = g.rr;
  };
  apply();

  return {
    input,
    output,
    gains,
    get pan() {
      return current;
    },
    setPan(next: number): void {
      current = clampPan(next);
      apply();
    },
    dispose(): void {
      input.disconnect();
      for (const gain of Object.values(gains)) gain.disconnect();
      output.disconnect();
    },
  };
}
