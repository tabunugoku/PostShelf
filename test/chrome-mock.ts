import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Dict = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
export const loadMessages = (lang: string): Dict =>
  JSON.parse(readFileSync(resolve(process.cwd(), `static/_locales/${lang}/messages.json`), 'utf8'));

/** chrome.i18n.getMessage 相当 ($name$ プレースホルダを $1.. で置換) */
export function makeGetMessage(dict: Dict) {
  return (key: string, subs: string[] = []) => {
    const m = dict[key];
    if (!m) return '';
    return m.message.replace(/\$(\w+)\$/g, (_, name: string) => {
      const c = m.placeholders?.[name.toLowerCase()]?.content ?? '';
      return c.replace(/\$(\d)/g, (_x, i: string) => subs[Number(i) - 1] ?? '');
    });
  };
}

/** chrome.storage.local のインメモリ実装 + i18n (既定 ja) */
/** サイドパネル/アクション/ウィンドウ API のスパイ付きモック (必要なテストだけ installPanelMock で追加する) */
export function installPanelMock() {
  const calls = { behavior: [] as unknown[], popup: [] as unknown[], open: [] as unknown[], messages: [] as unknown[] };
  const c = (globalThis as any).chrome;
  c.sidePanel = {
    setPanelBehavior: async (v: unknown) => void calls.behavior.push(v),
    open: async (v: unknown) => void calls.open.push(v),
  };
  c.action = { setPopup: async (v: unknown) => void calls.popup.push(v) };
  c.windows = { getCurrent: async () => ({ id: 7 }) };
  c.tabs = { create: async () => ({}) };
  const handlers: any[] = [];
  c.runtime = {
    getManifest: () => ({ version: '9.9.9' }),
    getURL: (p: string) => `chrome-extension://x/${p}`,
    sendMessage: async (m: unknown) => void calls.messages.push(m),
    onInstalled: { addListener: (h: any) => handlers.push(h) },
    onMessage: { addListener: (h: any) => (calls as any).onMessage = h },
  };
  return calls as typeof calls & { onMessage?: (m: any, s: any) => void };
}

/** installChromeMock が作った storage.session の中身 (ブラウザの終了で消える領域) */
export const sessionDataOf = (): Record<string, unknown> => (globalThis as any).chrome.storage.session.data;

export function installChromeMock(lang = 'ja'): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const sessionData: Record<string, unknown> = {};
  const listeners = new Set<(c: Record<string, unknown>, area: string) => void>();
  (globalThis as any).chrome = {
    i18n: { getMessage: makeGetMessage(loadMessages(lang)), getUILanguage: () => lang },
    runtime: { getManifest: () => ({ version: '9.9.9' }), getURL: (p: string) => `chrome-extension://x/${p}` },
    storage: {
      local: {
        async getKeys() {
          return Object.keys(data);
        },
        async get(key: string | string[] | null) {
          const keys = key === null ? Object.keys(data) : Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
        },
        async set(items: Record<string, unknown>) {
          const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { oldValue: data[k], newValue: v }]));
          for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
          for (const l of listeners) l(changes, 'local');
        },
        async remove(key: string | string[]) {
          const keys = Array.isArray(key) ? key : [key];
          const changes = Object.fromEntries(keys.filter((k) => k in data).map((k) => [
            k, { oldValue: data[k], newValue: undefined },
          ]));
          for (const k of keys) delete data[k];
          for (const l of listeners) l(changes, 'local');
        },
        async clear() {
          const changes = Object.fromEntries(Object.keys(data).map((k) => [k, { oldValue: data[k] }]));
          for (const k of Object.keys(data)) delete data[k];
          for (const l of listeners) l(changes, 'local');
        },
      },
      session: {
        data: sessionData,
        async get(key: string | string[] | null) {
          const keys = key === null ? Object.keys(sessionData) : Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter((k) => k in sessionData).map((k) => [k, structuredClone(sessionData[k])]));
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) sessionData[k] = structuredClone(v);
        },
        async remove(key: string | string[]) {
          for (const k of Array.isArray(key) ? key : [key]) delete sessionData[k];
        },
      },
      onChanged: { addListener: (l: any) => listeners.add(l), removeListener: (l: any) => listeners.delete(l) },
    },
  };
  return data;
}
