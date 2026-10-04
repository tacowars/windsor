/**
 * The header's power button (#70). Since the audio gate (windsor#578,
 * `audioGate.ts`) the gate's button is the gesture that creates the audio
 * context, so this one is hidden until audio first comes on and is then the
 * CPU meter (windsor#13, `cpuMeter.ts`), with the output stage's light
 * beside it (windsor#94, `outputStageLight.ts`). Its click still calls
 * `enable`, which with audio on only unlocks the context: harmless.
 */
import type { AppCtx } from './context';
import { mountCpuMeter } from './cpuMeter';
import { outputStageLight } from './outputStageLight';

/** The power button's side of an enable that succeeded. */
export interface PowerButton {
  /** Audio is on: show the meter (the first time) and re-render the console. */
  audioOn(): void;
}

export function wirePowerButton(button: HTMLElement, ctx: AppCtx): PowerButton {
  let metered = false;
  const audioOn = (): void => {
    if (!metered) {
      metered = true;
      mountCpuMeter(button, ctx);
      button.after(outputStageLight(ctx));
      button.hidden = false;
    }
    ctx.render();
  };
  button.hidden = true;
  button.onclick = (): void => {
    void ctx.host
      .enable(ctx.model.doc)
      .then(audioOn)
      // The host has already said why (`EngineHost.enable`), and the gate retries.
      .catch(() => undefined);
  };
  return { audioOn };
}
