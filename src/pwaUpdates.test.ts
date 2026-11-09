import { describe, expect, it, vi } from 'vitest';
import { createPwaUpdateStore, watchPwaUpdates } from './pwaUpdates';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('PWA updates', () => {
  it('retains a waiting update reported before React subscribes and replays it after remount', async () => {
    const updates = createPwaUpdateStore();
    const apply = vi.fn(async () => {});
    updates.publish(apply);
    const first = vi.fn();
    const unsubscribe = updates.subscribe(first);
    expect(first).toHaveBeenCalledWith(apply);
    unsubscribe();
    const second = vi.fn();
    updates.subscribe(second);
    expect(second).toHaveBeenCalledWith(apply);
    expect(apply).not.toHaveBeenCalled();
    await second.mock.calls[0][0]();
    expect(apply).toHaveBeenCalledOnce();
  });

  it('checks on return or reconnection only while visible and online, with throttling and cleanup', async () => {
    const windowEvents = new EventTarget();
    const documentEvents = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
    let online = true, time = 1_000;
    const update = vi.fn(async () => ({}) as ServiceWorkerRegistration);
    const stop = watchPwaUpdates({ update }, windowEvents, documentEvents, () => online, () => time);
    windowEvents.dispatchEvent(new Event('focus'));
    await flush();
    expect(update).not.toHaveBeenCalled();
    documentEvents.visibilityState = 'visible';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    windowEvents.dispatchEvent(new Event('focus'));
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
    time += 59_999;
    windowEvents.dispatchEvent(new Event('focus'));
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
    time += 1;
    online = false;
    windowEvents.dispatchEvent(new Event('focus'));
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
    online = true;
    windowEvents.dispatchEvent(new Event('online'));
    await flush();
    expect(update).toHaveBeenCalledTimes(2);
    stop();
    time += 60_000;
    windowEvents.dispatchEvent(new Event('focus'));
    await flush();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does not create unhandled errors if the update check fails', async () => {
    const windowEvents = new EventTarget();
    const documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const update = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    const stop = watchPwaUpdates({ update }, windowEvents, documentEvents, () => true);
    windowEvents.dispatchEvent(new Event('online'));
    await flush();
    expect(update).toHaveBeenCalledOnce();
    stop();
  });
});
