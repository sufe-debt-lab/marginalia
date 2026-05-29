import { useSyncExternalStore } from "react";

/**
 * Tiny shared-resource cache so multiple components that need the same
 * server data (workspaces, providers) share ONE fetch + ONE snapshot instead
 * of each calling the API independently. Keyed per ApiClient instance, so
 * tests with fresh fake clients stay isolated.
 */
export interface Snapshot<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

class Resource<T> {
  snapshot: Snapshot<T>;
  private subscribers = new Set<() => void>();
  private started = false;

  constructor(
    private readonly fetcher: () => Promise<T>,
    initial: T
  ) {
    this.snapshot = { data: initial, loading: true, error: null };
  }

  subscribe = (cb: () => void): (() => void) => {
    this.subscribers.add(cb);
    this.ensureStarted();
    return () => {
      this.subscribers.delete(cb);
    };
  };

  getSnapshot = (): Snapshot<T> => this.snapshot;

  setData(updater: (prev: T) => T): void {
    this.update({ data: updater(this.snapshot.data) });
  }

  refresh(): void {
    this.update({ loading: true });
    this.fetcher()
      .then((data) => this.update({ data, loading: false, error: null }))
      .catch((error: Error) => this.update({ loading: false, error }));
  }

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.refresh();
  }

  private update(partial: Partial<Snapshot<T>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const cb of this.subscribers) cb();
  }
}

const caches = new WeakMap<object, Map<string, Resource<unknown>>>();

function getResource<T>(
  api: object,
  key: string,
  fetcher: () => Promise<T>,
  initial: T
): Resource<T> {
  let perApi = caches.get(api);
  if (!perApi) {
    perApi = new Map();
    caches.set(api, perApi);
  }
  let resource = perApi.get(key) as Resource<T> | undefined;
  if (!resource) {
    resource = new Resource<T>(fetcher, initial);
    perApi.set(key, resource as Resource<unknown>);
  }
  return resource;
}

/** Subscribe to a shared resource; returns its snapshot + the Resource handle for mutations. */
export function useResource<T>(
  api: object,
  key: string,
  fetcher: () => Promise<T>,
  initial: T
): { snapshot: Snapshot<T>; resource: Resource<T> } {
  const resource = getResource(api, key, fetcher, initial);
  const snapshot = useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot
  );
  return { snapshot, resource };
}
