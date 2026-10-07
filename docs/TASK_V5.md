# 追加タスク (v5): 全アイコンの色変更 / ダークモードの選択肢表示 / サイドパネル / 取り込み補助

前提: v4 は `claude/serene-johnson-j5tpe7` で実装済み (CI 成功)。続きで作業する (最初に `origin/main` をマージ)。

## 実機で見つかった問題 (ユーザーの Chrome、ダークモード、旧 v0.1.0 で確認)
- 並べ替えの `<select>` を開くと、選択肢のポップアップが白背景 + 薄い文字 (ほぼ白) で読めない。`static/manager.css` の `select` は `background:transparent; color:inherit` で、OS ダークのとき OS 標準のポップアップが白になる。v4 でも同じ CSS なので未解決の可能性が高い
- アイコンが `ti-folder` 以外のとき色を選べない (`src/shared/models.ts` の `supportsColor`)。ユーザーはすべてのアイコンで色を付けたい

## A. すべてのアイコンで色を選べるようにする
仕様変更: 「色はフォルダアイコンのときだけ」をやめる。どのアイコンでも色を設定できる。

1. `src/shared/models.ts` の `supportsColor` を廃止 (または常に true)。`src/shared/storage.ts` の `createFolder` / `updateFolder` の色の検証から `icon === FOLDER_ICON` 条件を外す (色の値の検証 = 許可リスト内か、は維持)
2. アイコンを変更しても色を削除しない (今は `delete next.color`)。アイコンを変えても色は保つ
3. 色の指定なしを選べるようにする: 色スウォッチの先頭に「色なし (既定)」(斜線の丸) を追加。選ぶと `color` を削除し、文字色 (`--text-primary`) で表示
4. 編集パネルの色行は常に有効 (薄く表示・操作不可にしない)
5. 「すべて」「未分類」の組み込みフォルダは今まで通り変更不可
6. 既存データの互換: 色なしのフォルダはそのまま。アイコンが folder 以外で色が欠けているデータも読める
7. 色の候補は 8 色のまま。余裕があればカスタム色 (`<input type="color">`) を「その他」として追加してよい (その場合は `#RRGGBB` だけ許可)。ダークでもライトでもコントラストが足りない色は警告するか、候補から外す
8. テスト更新: 任意のアイコンで色が保存・保持される、アイコン変更で色が消えない、色なしに戻せる、不正な色は拒否される。`docs/mockups/manager.html` も同じ挙動に更新する
9. CLAUDE.md の機能要件 3 と `docs/PLAN.md` の「色はフォルダアイコンのときのみ」の記述を更新する

## B. ダークモードで選択肢が読めない問題の修正
1. `static/manager.css` (および popup、x.com に注入する UI) で `:root { color-scheme: light dark; }` を設定し、`select`、`input`、`button`、スクロールバーが OS のダーク/ライトに追従するようにする
2. `option` と `optgroup` に明示的に `background: var(--surface-2); color: var(--text-primary);` を指定 (ブラウザによってはポップアップに CSS が効くため)
3. 並べ替えの選択を、ネイティブ `<select>` からアプリ内のドロップダウン (自前の listbox / メニュー) に置き換えるか、`select` のままにするかを判断し、最終報告に理由を書く。ネイティブのポップアップはヘッドレスのスクリーンショットに写らないので、置き換えた方が検証しやすい。置き換える場合はキーボード操作 (矢印、Enter、Esc)、フォーカスリング、`aria-*` を実装する
4. 「リスト表示」(ポスト表示と対のビュー) も、ダーク/ライトの両方でスクリーンショットを撮って文字が読めることを確認する。保存済みポストが 3 件以上ある fixture を使い、`docs/screenshots/` を更新する
5. WCAG: 通常文字のコントラスト 4.5:1 以上 (v4 C の基準を維持)。ダーク/ライトの全画面 (manager、popup、設定、編集パネル、複数選択中、ドロップダウンを開いた状態) を自己点検する

## C. 管理画面をサイドパネルでも開けるようにする
Chrome の `chrome.sidePanel` API (Chrome 114 以降) を使う。

1. `static/manifest.json`: `permissions` に `sidePanel` を追加。`side_panel: { default_path: "sidepanel.html" }`。`minimum_chrome_version: "114"`
2. `sidepanel.html` は manager と同じアプリ (`src/manager/`) を狭い幅向けのレイアウトで開く。ビルドは `build.mjs` に追加
3. 狭い幅 (幅 520px 未満、CSS container query またはメディアクエリ) のレイアウト:
   - 左サイドバー (フォルダ一覧) は、上部の横スクロールするチップ列またはドロップダウンに変える
   - ポスト表示はカードの余白を詰め、画像は幅いっぱい。リスト表示も 1 行表示を維持
   - 編集パネル・複数選択バー・一括操作は縦に積む。タップ領域は 32px 以上のまま
   - 管理画面 (タブ) の見た目は変えない
4. 開く手段 (すべて `chrome.sidePanel.open()`。ユーザー操作 (クリック) の中で呼ぶこと):
   - popup に「サイドパネルで開く」ボタン (既存の「管理画面を開く」の隣)
   - manager (タブ) のヘッダーに「サイドパネルで開く」アイコン、サイドパネルのヘッダーに「タブで開く」アイコン
   - 設定に「ツールバーアイコンのクリック時の動作」: `popup` (既定) / `sidepanel`。`sidepanel` のときは `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` を設定し、`chrome.action.setPopup({ popup: '' })` で popup を外す。`popup` に戻すときは両方を元に戻す。設定は `src/shared/settings.ts` の `actionMode: 'popup' | 'sidepanel'` で永続化し、background の起動時 (`chrome.runtime.onInstalled` と service worker 起動時) に反映する
   - x.com 上のポップオーバーの末尾に「サイドパネルで開く」リンク (任意)。`chrome.sidePanel.open` は content script から呼べないので、background へメッセージを送り、ユーザー操作の直後に呼ぶ。動かない場合はこの項目は省略してよい
5. サイドパネルを開いたままでも、x.com でポストを保存した結果がすぐ反映される (`chrome.storage.onChanged` で更新)
6. i18n: 追加した文言を全 8 言語 (ja, en, zh_CN, zh_TW, ko, es, pt_BR, fr) に追加。キー一致テストを通す
7. テスト: 設定値による `setPanelBehavior` / `setPopup` の呼び出し (chrome モックで検証)、狭い幅のレイアウトの CSS (jsdom で class が付くこと) 、キー一致
8. スクリーンショット: 幅 400px の狭いレイアウト (ライト/ダーク) を `docs/screenshots/` に保存
9. `docs/MANUAL_TEST.md` に追加: サイドパネルが開く、閉じる、x.com で保存した内容が反映される、ツールバーアイコンの動作を切り替える、Chrome 113 以下では popup のまま動く (該当する場合)

## D. モバイルからのブックマークと取り込み補助
事実の整理 (`docs/FAQ.md` に書く):
- PostShelf はデスクトップ版 Chrome の拡張機能で、データはその端末のブラウザ内にだけ保存される
- X のモバイルアプリでブックマークしたものは X のサーバー側に保存されるだけで、PostShelf には自動では届かない (拡張機能はモバイルアプリに入れられない)
- モバイルでブックマークした分を PostShelf に入れる手順: デスクトップの Chrome で x.com の `/i/bookmarks` を開き、取り込みたいポストが画面に出るまでスクロールして、右下の取り込みボタンを押す。自動スクロールや一括取得はしない方針は維持する
- X 側のブックマークの表示上限 (約 800〜1000 件とされるが公式には未確認) を超えて見えなくなった分は取り込めない。日常的にこまめに取り込むことを勧める

実装:
1. `/i/bookmarks` の取り込みボタンに「未取り込み N 件」を表示する (画面に出ているポストのうち、PostShelf に未保存のものの数)。0 件のときは「すべて取り込み済み」
2. 取り込み後は「N 件を取り込みました (未分類)」。すでに取り込み済みは重複させない (今の挙動を維持)
3. i18n 全言語。テスト: 件数の計算 (保存済み/未保存の混在)
4. 他の端末との同期は対象外。`docs/FAQ.md` に「JSON エクスポート/インポートで手動移行」と、将来の課題 (クラウド同期は『データは端末内のみ』の方針と衝突するため別途検討) を書く

## 完了条件
- `npm run typecheck`, `npm test`, `npm run build` がすべて通る (CI も成功)
- A / B / C / D を別コミットにする
- `docs/MANUAL_TEST.md` に実機確認項目を追加
- 最終報告: 変更点、スクリーンショット (ダークのドロップダウンとリスト表示を含む)、実機確認が必要な項目、B-3 の判断理由
