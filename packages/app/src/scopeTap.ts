/**
 * Which node feeds the Output display's analyser (windsor#964): the selected
 * part's own output, the patch as synthesized, before its strip. The scope's
 * frame loop calls `follow` every tick with the node it resolves, so a
 * selection change, a rebuilt system and a removed part all land here with no
 * event plumbing; an unchanged node is an identity compare.
 */

export interface ScopeTap {
  /** Feed the analyser from `source` alone, or from nothing for `null`. */
  follow(source: AudioNode | null): void;
}

export function createScopeTap(analyser: () => AnalyserNode | null): ScopeTap {
  let source: AudioNode | null = null;
  let target: AnalyserNode | null = null;
  return {
    follow(next: AudioNode | null): void {
      const nextTarget = next ? analyser() : null;
      if (next === source && nextTarget === target) return;
      if (source && target) {
        try {
          source.disconnect(target);
        } catch (err) {
          // A disposed part's node was already disconnected by the engine.
          if (!(err instanceof DOMException && err.name === 'InvalidAccessError')) throw err;
        }
      }
      source = nextTarget ? next : null;
      target = nextTarget;
      if (source && target) source.connect(target);
    },
  };
}
