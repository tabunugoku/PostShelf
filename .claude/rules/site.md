---
paths:
  - "site/**"
  - ".github/workflows/pages.yml"
---

## 紹介サイト (GitHub Pages)
`site/index.html` (静的な 1 ページ。日本語と英語の併用で、ブラウザの言語が日本語なら日本語、それ以外は英語を表示し、ヘッダーの切替で変えられる (各文言は `<span class="ja">` / `<span class="en">` の対。新しい文言は両方に書く)。ビルド不要)。「外部通信なし」の制約は拡張機能だけのもので、このサイトには適用しない。フォントは Google Fonts (Geist, Noto Sans JP) を読み込み、作者のアイコンは GitHub のアバター画像を参照している。ライト・ダークは、ヘッダーの 3 択 (ライト / 自動 / ダーク) で切り替えられ、選んだ値を `localStorage` (`ps-theme`) に保存する。ロゴと強調色は、拡張機能のアイコンの青 (`#1D9BF0`、`docs/brand/icon.svg`) にそろえる。`.github/workflows/pages.yml` が、`main` への push で `site/` を公開する (リポジトリの Settings → Pages → Source を「GitHub Actions」にしてから動く)。スクリーンショットは載せず、画面のイメージはマークアップで描く。サンプルは架空のアカウントだけ。比較表は日付つきで、公開ページの記載に基づく (変わったら更新する)。
