// Test environment for anything that touches Dexie or the write path.
//
// `fake-indexeddb/auto` installs a real IndexedDB implementation over an in-memory
// backend, so these are not mocks of Dexie — they are Dexie, running its actual schema
// upgrades, transactions and key ordering. A test that force-quits the app closes the
// connection and reopens it, and the data is still there, exactly as on a phone.
import 'fake-indexeddb/auto'

// clientId() needs a synchronous, persistent store. Node has no localStorage.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size
      },
    },
  })
}
