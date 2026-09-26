/**
 * The power button (#70): the first user gesture, which creates the audio
 * context and builds the live system over the document; the console then
 * re-renders so every control drives a sounding part. The transport waits at
 * 1.1.1 for ▶ (#708).
 */
import type { AppCtx } from './context';

export function wirePowerButton(button: HTMLElement, ctx: AppCtx): void {
  button.onclick = (): void => {
    void ctx.host
      .enable(ctx.model.doc)
      .then(() => {
        button.textContent = 'Audio on';
        button.classList.remove('primary');
        ctx.status('audio on — press ▶ to play the document');
        ctx.render();
      })
      .catch((error: unknown) => ctx.status(`audio failed: ${String(error)}`));
  };
}
