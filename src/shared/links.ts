/** 外部リンクの定義 (1 か所)。リンクを開くだけで、診断情報などは自動では送らない。拡張自身が通信する先は RELEASES_API_URL だけ */

/** GitHub のリポジトリ (設定画面の「GitHub で見る」。ブラウザが新しいタブで開くだけで、拡張自身は通信しない) */
export const REPO_URL = 'https://github.com/tabunugoku/PostShelf';

export const ISSUE_URL = `${REPO_URL}/issues/new?template=selector-broken.md`;

/** 手動インストールと更新の手順書 (リンクを開くだけ。外部への問い合わせはしない) */
export const INSTALL_URL = `${REPO_URL}/blob/main/docs/INSTALL.md`;

/** リリースの一覧のページ (更新の案内のリンク。ブラウザが新しいタブで開くだけ) */
export const RELEASES_URL = `${REPO_URL}/releases/latest`;

/**
 * 更新の確認 (v73) で読む、最新のリリースの情報。外部通信なしの方針の唯一の例外 (CLAUDE.md の「守ること」)。
 * 設定でオンにしたときだけ GET で読む。`scripts/checks.mjs` の ALLOWED_NETWORK_URLS と同じ文字列にする
 */
export const RELEASES_API_URL = 'https://api.github.com/repos/tabunugoku/PostShelf/releases/latest';
