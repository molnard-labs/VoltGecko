/** The update can arrive before React mounts; retain it until a listener subscribes. */
export type ApplyPwaUpdate = () => Promise<void>;

export function createPwaUpdateStore() {
  let pending: ApplyPwaUpdate | undefined;
  const listeners = new Set<(apply: ApplyPwaUpdate) => void>();
  return {
    publish(apply: ApplyPwaUpdate) {
      pending = apply;
      for (const listener of listeners) listener(apply);
    },
    subscribe(listener: (apply: ApplyPwaUpdate) => void) {
      listeners.add(listener);
      if (pending) listener(pending);
      return () => { listeners.delete(listener); };
    }
  };
}

export const pwaUpdates = createPwaUpdateStore();

/** Check for a waiting release when the user returns; never activate it here. */
export function watchPwaUpdates(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
  windowEvents: EventTarget,
  documentEvents: EventTarget & { readonly visibilityState: string },
  isOnline: () => boolean,
  now: () => number = Date.now
): () => void {
  const minIntervalMs = 60_000;
  let lastCheck = -Infinity;
  let checking = false;
  const check = () => {
    if (!isOnline() || documentEvents.visibilityState !== 'visible' || checking || now() - lastCheck < minIntervalMs) return;
    lastCheck = now();
    checking = true;
    void Promise.resolve().then(() => registration.update()).catch(() => undefined).finally(() => { checking = false; });
  };
  windowEvents.addEventListener('focus', check);
  windowEvents.addEventListener('online', check);
  documentEvents.addEventListener('visibilitychange', check);
  return () => {
    windowEvents.removeEventListener('focus', check);
    windowEvents.removeEventListener('online', check);
    documentEvents.removeEventListener('visibilitychange', check);
  };
}
