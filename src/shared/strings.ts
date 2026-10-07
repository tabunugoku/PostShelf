/** UI 文言は chrome.i18n 経由 (static/_locales/{ja,en}/messages.json)。直書きしない。 */
export function t(key: string, ...subs: (string | number)[]): string {
  return chrome.i18n.getMessage(key, subs.map(String)) || key;
}

/** 日付表示は UI 言語に従う */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(chrome.i18n.getUILanguage()).format(new Date(iso));
}
