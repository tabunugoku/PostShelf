# v73 の文言の提案: 新しい版を確かめる (更新の確認)

設定の「PostShelf について」の欄 (版の番号の下) に、オンとオフを切り替える項目を置く。既定はオフ。オンにしていて新しい版があれば、管理画面・サイドパネル・ポップアップの上部に案内を出す (既存の「PostShelf を更新しました」の案内と同じ場所)。案内のリンクは、GitHub の最新のリリースのページ (`https://github.com/tabunugoku/PostShelf/releases/latest`) を新しいタブで開く。

- 新しいキーは 5 件。
- プレースホルダーは `updateAvailable` の `$VERSION$` だけ (`content: "$1"`、例: `1.1.8`)。既存の `updateNotice` と同じ名前と定義にする。版の番号は、先頭の `v` を外して入れる (既存の `versionLabel` の表示にそろえる)。
- 説明 (`updateCheckDesc`) には、GitHub に伝わること (確かめた時刻・IP アドレス・ブラウザの種類 (User-Agent)・PostShelf からの問い合わせであること (Origin)) を必ず書く。
- 「新しいタブで開きます」の言い方は、各言語の既存の `githubLinkAria` にそろえる。
- 「GitHub」「PostShelf」は、どの言語でもそのまま。

採用するなら、この表の文言を 8 言語の `_locales` に足す。直したい文言があれば、その行を指定してください。

## ja / en

| キー | ja | en |
|---|---|---|
| updateCheck | 新しい版を確かめる | Check for new versions |
| updateCheckDesc | オンにすると、画面を開いたときに 1 日 1 回まで、GitHub に最新の版の番号を問い合わせます。送るデータはありませんが、GitHub には、確かめた時刻・IP アドレス・ブラウザの種類と、PostShelf からの問い合わせであることが伝わります。更新は自動では行いません。 | When this is on, PostShelf asks GitHub for the latest version number when you open it, at most once a day. No data is sent, but GitHub sees the time of the check, your IP address, your browser type, and that the request comes from PostShelf. Updates are never installed automatically. |
| updateAvailable | 新しい版 $VERSION$ が出ています | A new version, $VERSION$, is available |
| updateAvailableLink | リリースのページを開く | Open the release page |
| updateAvailableLinkAria | リリースのページを開く（新しいタブで開きます） | Open the release page (opens in a new tab) |

## zh_CN / zh_TW

| キー | zh_CN | zh_TW |
|---|---|---|
| updateCheck | 检查新版本 | 檢查新版本 |
| updateCheckDesc | 开启后，打开界面时最多每天一次向 GitHub 查询最新的版本号。不会发送任何数据，但 GitHub 会知道查询的时间、你的 IP 地址、浏览器类型，以及这是来自 PostShelf 的查询。不会自动更新。 | 開啟後，開啟畫面時最多每天一次向 GitHub 查詢最新的版本號碼。不會傳送任何資料，但 GitHub 會知道查詢的時間、你的 IP 位址、瀏覽器類型，以及這是來自 PostShelf 的查詢。不會自動更新。 |
| updateAvailable | 新版本 $VERSION$ 已发布 | 新版本 $VERSION$ 已發布 |
| updateAvailableLink | 打开发布页面 | 開啟發布頁面 |
| updateAvailableLinkAria | 打开发布页面（在新标签页中打开） | 開啟發布頁面（在新分頁中開啟） |

## ko / es

| キー | ko | es |
|---|---|---|
| updateCheck | 새 버전 확인하기 | Buscar versiones nuevas |
| updateCheckDesc | 켜면 화면을 열 때 하루에 한 번까지 GitHub에 최신 버전 번호를 묻습니다. 보내는 데이터는 없지만, GitHub에는 확인한 시각, IP 주소, 브라우저 종류와 PostShelf에서 보낸 요청이라는 사실이 전달됩니다. 업데이트는 자동으로 하지 않습니다. | Si está activado, al abrir PostShelf se consulta a GitHub el número de la última versión, como máximo una vez al día. No se envía ningún dato, pero GitHub ve la hora de la consulta, tu dirección IP, tu tipo de navegador y que la consulta viene de PostShelf. Las actualizaciones nunca se instalan automáticamente. |
| updateAvailable | 새 버전($VERSION$)이 나왔습니다 | Hay una versión nueva: $VERSION$ |
| updateAvailableLink | 릴리스 페이지 열기 | Abrir la página de la versión |
| updateAvailableLinkAria | 릴리스 페이지 열기(새 탭에서 열림) | Abrir la página de la versión (se abre en una pestaña nueva) |

## pt_BR / fr

| キー | pt_BR | fr |
|---|---|---|
| updateCheck | Verificar novas versões | Vérifier les nouvelles versions |
| updateCheckDesc | Quando ativado, o PostShelf pergunta ao GitHub o número da versão mais recente ao ser aberto, no máximo uma vez por dia. Nenhum dado é enviado, mas o GitHub vê o horário da verificação, o seu endereço IP, o tipo do seu navegador e que a consulta vem do PostShelf. As atualizações nunca são instaladas automaticamente. | Si cette option est activée, PostShelf demande à GitHub le numéro de la dernière version quand vous l’ouvrez, au plus une fois par jour. Aucune donnée n’est envoyée, mais GitHub voit l’heure de la vérification, votre adresse IP, votre type de navigateur et le fait que la demande vient de PostShelf. Les mises à jour ne sont jamais installées automatiquement. |
| updateAvailable | Há uma nova versão: $VERSION$ | Une nouvelle version est disponible : $VERSION$ |
| updateAvailableLink | Abrir a página da versão | Ouvrir la page de la version |
| updateAvailableLinkAria | Abrir a página da versão (abre em uma nova guia) | Ouvrir la page de la version (s’ouvre dans un nouvel onglet) |
