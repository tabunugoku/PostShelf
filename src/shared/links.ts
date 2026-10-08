/** 外部リンクの定義 (1 か所)。リンクを開くだけで、診断情報などは自動では送らない */

/** GitHub のリポジトリ (設定画面の「GitHub で見る」。ブラウザが新しいタブで開くだけで、拡張自身は通信しない) */
export const REPO_URL = 'https://github.com/tabunugoku/PostShelf';

export const ISSUE_URL = `${REPO_URL}/issues/new?template=selector-broken.md`;

/** 手動インストールと更新の手順書 (リンクを開くだけ。外部への問い合わせはしない) */
export const INSTALL_URL = `${REPO_URL}/blob/main/docs/INSTALL.md`;
