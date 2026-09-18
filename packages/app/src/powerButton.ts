/**
 * The power button (#70): the first user gesture, which creates the audio
 * context and builds the live system over the document; the console then
 * re-renders so every control drives a sounding part.
 */
import type { AppCtx } from './context';

export function wirePowerButton(button: HTMLElement, ctx: AppCtx): void {
  button.onclick = (): void => {
    void ctx.host
      .enable(ctx.model.doc)
      .then(() => {
        button.textContent = 'Audio on';
        button.classList.remove('primary');
        ctx.status('running — the real AudioSystem is playing the document');
        ctx.render();
      })
      .catch((error: unknown) => ctx.status(`audio failed: ${String(error)}`));
  };
}
