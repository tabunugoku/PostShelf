# 追加タスク (v10): 日本語表現の修正 (v9 で増えた文言)

前提: v9 まで `claude/serene-johnson-j5tpe7` で実装済み。続きで作業する (最初に `origin/main` をマージ)。v8 と同じ進め方。ロジックは変えない。文言とドキュメントだけを直す。

## A. `static/_locales/ja/messages.json`
| キー | 修正後 |
|---|---|
| `saveCurrentWrongAccount` | 表示中のアカウントと、x.com でログイン中の $NAME$ が異なるため保存できません。表示するアカウントを $NAME$ に切り替えてください。 |
| `accountAssignDesc` | $NAME$ の保存データ（$COUNT$ 件）を、選んだアカウントへ移します。同じポストがすでにある場合は、そのポストが入っているフォルダを合わせます。 |
| `accountUnknownBanner` | 「アカウント未設定」に $COUNT$ 件のポストがあります。どのアカウントのものかを選んで、割り当ててください。 |
| `collectNoAccount` | ログイン中のアカウントを判定できないため、取り込めません |
| `accountAssignNone` | 割り当て先のアカウントがありません。x.com を開いてログインすると、割り当て先として選べるようになります。 |

理由 (コメントや commit に残さなくてよい):
- `saveCurrentWrongAccount`: 何を切り替えるのかが読み取れなかった。切り替える対象は、管理画面の表示アカウント (x.com 側ではない)
- `accountAssignDesc`: コードの動作は、同じポスト (tweetId) が移動先にあるとき、そのポストの所属フォルダ (`folderIds`) を合わせること。フォルダ同士を 1 つにまとめる意味に読めないようにする
- `accountUnknownBanner`: ボタン名「割り当て…」と言葉をそろえる
- `collectNoAccount`: `accountUnknown` や `saveCurrentNoAccount` の「判定できないため」と言い方をそろえる

## B. ドキュメント
1. `docs/FAQ.md`
   - 「同じポストがすでに移動先にある場合は、フォルダを統合します」 → 「同じポストがすでに移動先にある場合は、そのポストが入っているフォルダを合わせます」
   - 「アカウント対応 (v9) より前に保存したデータ」 → 「アカウントごとに分ける機能を入れる前に保存したデータ」。FAQ に「v9」などの内部の版名が他にも出ていれば、利用者に通じる言い方に直す
2. `docs/MANUAL_TEST.md`: `saveCurrentWrongAccount` を確認する項目 (「表示中のアカウントと x.com のログイン中のアカウントが違うと…」) の文言を、「異なる」にそろえる
3. `README.md` に同じ説明があれば、同様に直す

## C. 他の 7 言語への反映
`en` を先に直して基準にし、残りの 6 言語 (`zh_CN`, `zh_TW`, `ko`, `es`, `pt_BR`, `fr`) は en に合わせる。直す意味は次のとおり。
- `saveCurrentWrongAccount`: 「表示するアカウントを $NAME$ に切り替えてください」と、切り替える対象 (管理画面の表示アカウント) を明記する
- `accountAssignDesc`: 同じポストがある場合に合わせるのは、そのポストが入っているフォルダ (フォルダ同士を 1 つにまとめるのではない)
- `accountUnknownBanner`: 「割り当てる」ボタンの名前と同じ言葉で書く
- `collectNoAccount`: 「ログイン中のアカウントを判定できないため」の理由を書く
- `accountAssignNone`: ログインすると、割り当て先として選べるようになる (「現れる」ではない)

## 完了条件
- `npm run typecheck`, `npm test`, `npm run build` がすべて通る (CI も成功)。文言のテストの期待値があれば合わせる
- 1 コミット
- 最終報告: 直したキーの一覧と、8 言語に反映したことの確認
