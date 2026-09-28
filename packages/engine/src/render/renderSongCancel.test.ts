/**
 * A cancelled song render (windsor#51 decisions 3 and 5): an abort is heard
 * for the whole of the render, after its last stop too, through one listener
 * that never outlives it; and an abort at a scheduled stop resumes the
 * context, so the offline render settles and lets go of its buffer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import type { OfflineContextInit, RenderSongOptions } from './renderSong';
import { renderSong } from './renderSong';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installFakeAudioWorklet();
});
afterAll(() => restore());

/** Low enough to keep the headless renders cheap. */
const RATE = 16000;

/** An abort controller whose signal counts the abort listeners still attached. */
function countedAbort(): { controller: AbortController; listeners: () => number } {
  const controller = new AbortController();
  const { signal } = controller;
  const live = new Set<unknown>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((type: string, listener: EventListener, opts?: unknown) => {
    if (type === 'abort') live.add(listener);
    add(type, listener, opts as AddEventListenerOptions);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((type: string, listener: EventListener) => {
    if (type === 'abort') live.delete(listener);
    remove(type, listener);
  }) as typeof signal.removeEventListener;
  // A `once` listener detaches itself when the signal fires.
  add('abort', () => live.clear());
  return { controller, listeners: () => live.size };
}

/** The song's render context (not the opening's one-block probe), and its `startRendering()` promise. */
class WatchedContext extends FakeOfflineContext {
  rendering: Promise<AudioBuffer> | null = null;
  afterRender: (() => void) | null = null;

  override startRendering(): Promise<AudioBuffer> {
    this.rendering = super.startRendering().then((buffer) => {
      this.afterRender?.();
      return buffer;
    });
    return this.rendering;
  }
}

function render(options: RenderSongOptions, onContext: (context: WatchedContext) => void) {
  return renderSong(FULL_DOCUMENT, {
    sampleRate: RATE,
    tailSeconds: 0,
    createContext: (init: OfflineContextInit) => {
      const context = new WatchedContext(init);
      onContext(context);
      return context;
    },
    ...options,
  });
}

describe('cancelling a render', () => {
  it('removes its abort listener when the render completes', async () => {
    const { controller, listeners } = countedAbort();
    await render({ signal: controller.signal }, () => {});
    expect(listeners()).toBe(0);
  });

  it('rejects on an abort after the final stop, and no listener outlives it', async () => {
    const { controller, listeners } = countedAbort();
    const rendered = render({ signal: controller.signal }, (context) => {
      // Every block rendered, every stop passed: the buffer is on its way back.
      context.afterRender = () => controller.abort();
    });
    await expect(rendered).rejects.toMatchObject({ name: 'AbortError' });
    expect(listeners()).toBe(0);
  });

  it('resumes the context at the next stop after an abort, so the render settles', async () => {
    const { controller, listeners } = countedAbort();
    const contexts: WatchedContext[] = [];
    let stopsAtAbort = -1;
    const rendered = render(
      {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (fraction < 0.2 || controller.signal.aborted) return;
          stopsAtAbort = contexts.at(-1)!.suspendFrames.length;
          controller.abort();
        },
      },
      (context) => contexts.push(context),
    );
    await expect(rendered).rejects.toMatchObject({ name: 'AbortError' });
    const song = contexts.at(-1)!;
    // The context runs on to its end instead of waiting at a stop for ever.
    const buffer = await song.rendering!;
    expect(buffer.length).toBe(song.length);
    // The stop scheduled by the stop the abort came in is the last one.
    expect(song.suspendFrames).toHaveLength(stopsAtAbort + 1);
    expect(listeners()).toBe(0);
  });
});
