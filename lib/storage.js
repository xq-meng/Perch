import { STORAGE_KEY, normalizeState } from './model.js?v=1.2.0';

export function createStorage(environment = globalThis) {
  const extension = environment.chrome?.runtime?.id && environment.chrome?.storage?.local;
  return {
    async read() {
      const raw = extension
        ? (await environment.chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]
        : JSON.parse(environment.localStorage.getItem(STORAGE_KEY) || 'null');
      return normalizeState(raw);
    },
    async write(state) {
      if (extension) await environment.chrome.storage.local.set({ [STORAGE_KEY]: state });
      else environment.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
    subscribe(callback) {
      if (extension) {
        const listener = (changes, area) => {
          if (area === 'local' && Object.hasOwn(changes, STORAGE_KEY)) callback(normalizeState(changes[STORAGE_KEY].newValue));
        };
        environment.chrome.storage.onChanged.addListener(listener);
        return () => environment.chrome.storage.onChanged.removeListener(listener);
      }
      const listener = (event) => {
        if (event.key !== STORAGE_KEY && event.key !== null) return;
        try { callback(normalizeState(JSON.parse(event.newValue || 'null'))); } catch { /* Ignore malformed external writes. */ }
      };
      environment.addEventListener('storage', listener);
      return () => environment.removeEventListener('storage', listener);
    },
  };
}
