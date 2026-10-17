# v83 の文言の変更案: サイドパネルの最低バージョン (actionModeNote)

v83 (スキーマ 3) で、manifest の `minimum_chrome_version` を 114 から 130 に上げた。設定の「ツールバーアイコンのクリック時の動作」の下の説明 `actionModeNote` は、いまも「Chrome 114 以降で使えます」のままで、拡張機能そのものの最低バージョンと合わない。130 未満の Chrome では PostShelf を読み込めないので、この説明は、どの利用者にとっても当てはまる注意になっている。

利用者が案 B (説明を消す) を選んだ (2026-10-17)。8 言語の `actionModeNote` と、`src/manager/Settings.tsx` の説明の段落を消した。

## 案 A: 数字だけを 130 にする

- 変えるキーは `actionModeNote` の 1 件。キーとプレースホルダーは変えない。
- 変えるのは数字だけ。文の形は今のまま。

| 言語 | actionModeNote |
|---|---|
| ja | サイドパネルは Chrome 130 以降で使えます。 |
| en | The side panel requires Chrome 130 or later. |
| zh_CN | 侧边栏需要 Chrome 130 或更高版本。 |
| zh_TW | 側邊欄需要 Chrome 130 或更新版本。 |
| ko | 사이드 패널은 Chrome 130 이상에서 사용할 수 있습니다. |
| es | El panel lateral requiere Chrome 130 o posterior. |
| pt_BR | O painel lateral requer o Chrome 130 ou posterior. |
| fr | Le panneau latéral nécessite Chrome 130 ou version ultérieure. |

## 案 B: 説明を消す

- 8 言語から `actionModeNote` を消し、`src/manager/Settings.tsx` の説明の段落も消す。
- PostShelf が動く Chrome では、サイドパネルは必ず使える。そのため、この説明はなくても困らない。
- 訳は要らない。

## 案 C: 今のままにする

- 「114 以降」は、130 以降の Chrome でも正しい。ただし、拡張機能の最低バージョン (130) と数字が食い違って見える。
