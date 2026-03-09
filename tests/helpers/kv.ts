import { vi } from "vitest";

export interface MockKVNamespace extends KVNamespace {
  store: Map<string, string>;
  putCalls: Array<{
    key: string;
    value: string;
    options?: KVNamespacePutOptions;
  }>;
}

export function createMockKV(): MockKVNamespace {
  const store = new Map<string, string>();
  const putCalls: MockKVNamespace["putCalls"] = [];

  return {
    store,
    putCalls,
    get: vi.fn(async (key: string, type?: KVNamespaceGetOptions | "text" | "json") => {
      const value = store.get(key);
      if (value == null) {
        return null;
      }
      if (type === "json" || type?.type === "json") {
        return JSON.parse(value);
      }
      return value;
    }),
    put: vi.fn(async (key: string, value: string, options?: KVNamespacePutOptions) => {
      store.set(key, value);
      putCalls.push({ key, value, options });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({
      keys: Array.from(store.keys()).map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    })),
    getWithMetadata: vi.fn(),
  } as unknown as MockKVNamespace;
}
