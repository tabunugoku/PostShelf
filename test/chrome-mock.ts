/** chrome.storage.local のインメモリ実装 */
export function installChromeMock(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        async get(key: string) {
          return key in data ? { [key]: structuredClone(data[key]) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
        },
      },
    },
  };
  return data;
}
