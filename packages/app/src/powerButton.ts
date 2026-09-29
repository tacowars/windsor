/**
 * The power button (#70): the first user gesture, which creates the audio
 * context and builds the live system over the document; the console then
 * re-renders so every control drives a sounding part. The transport waits at
 * 1.1.1 for ▶ (#708). Once audio is on the button becomes the CPU meter
 * (windsor#13, `cpuMeter.ts`); a click still does what it did. Beside it
 * goes the output stage's light (windsor#94, `outputStageLight.ts`).
 */
import type { AppCtx } from './context';
import { mountCpuMeter } from './cpuMeter';
import { outputStageLight } from './outputStageLight';

export function wirePowerButton(button: HTMLElement, ctx: AppCtx): void {
  let metered = false;
  button.onclick = (): void => {
    void ctx.host
      .enable(ctx.model.doc)
      .then(() => {
        button.classList.remove('primary');
        if (!metered) {
          metered = true;
          mountCpuMeter(button, ctx);
          button.after(outputStageLight(ctx));
        }
        ctx.notify('audio on — press ▶ to play the document');
        ctx.render();
      })
      // The host has already said why, and that the button retries (`EngineHost.enable`).
      .catch(() => undefined);
  };
}
