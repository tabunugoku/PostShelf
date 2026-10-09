/** UI 文言は chrome.i18n 経由 (static/_locales/{ja,en}/messages.json)。直書きしない。 */
export function t(key: string, ...subs: (string | number)[]): string {
  return chrome.i18n.getMessage(key, subs.map(String)) || key;
}

/** 日付表示は UI 言語に従う */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(chrome.i18n.getUILanguage()).format(new Date(iso));
}

/** 画面の言語 (chrome.i18n の UI 言語。例: ja、en-US)。取れなければ空 */
export const uiLang = (): string => {
  try {
    return chrome.i18n.getUILanguage?.() ?? '';
  } catch {
    return '';
  }
};

/** 画面の言語を <html lang> に入れる (:lang(ja) の折り返しの規則を効かせるため。HTML の初期値は固定しない) */
export function setDocumentLang(doc: Document = document): void {
  const l = uiLang();
  if (l) doc.documentElement.lang = l;
}

/**
 * 日本語の折り返しは文節の区切りにする (word-break: auto-phrase)。Chrome 119 未満では無効になり、通常の折り返しになる (許容)。
 * 他の言語には足さない。X のページの中 (content script) では lang が X の言語なので、ルート要素に lang を付けて、このセレクタを使う。
 */
export const jaWrapRule = (selector: string): string => `${selector}:lang(ja){word-break:auto-phrase;line-break:strict}`;
