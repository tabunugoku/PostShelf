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
export function installChromeMock(lang = 'ja'): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  (globalThis as any).chrome = {
    i18n: { getMessage: makeGetMessage(loadMessages(lang)), getUILanguage: () => lang },
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
