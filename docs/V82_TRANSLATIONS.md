# v82 の文言の変更: 更新の確認の説明 (updateCheckDesc)

v1.1.8 のリリースの準備で、更新の確認 (v73) の説明を直す。問い合わせるのは管理画面とサイドパネルを開いたときだけで、ポップアップは問い合わせない (前回の結果だけを出す)。いまの説明の「画面を開いたとき」では、ポップアップも含むように読めるため、開く画面を書く。

- 変えるキーは `updateCheckDesc` の 1 件。キーとプレースホルダーは変えない。
- 「管理画面」「サイドパネル」の言い方は、各言語の既存の `openManager`・`openSidePanel` にそろえる。
- 変えるのは開く画面を書いた部分だけ。残りの文は v73 のまま。
- ja は利用者が選んで先に直した (コミット 64001f2)。ほかの 7 言語は、利用者の指示 (訳を直す) でこの表のとおりに直す。

| 言語 | updateCheckDesc |
|---|---|
| ja | オンにすると、管理画面とサイドパネルを開いたときに 1 日 1 回まで、GitHub に最新のバージョン番号を問い合わせます。送るデータはありませんが、GitHub には、確かめた時刻・IP アドレス・ブラウザの種類と、PostShelf からの問い合わせであることが伝わります。更新は自動では行いません。 |
| en | When this is on, PostShelf asks GitHub for the latest version number when you open the manager or the side panel, at most once a day. No data is sent, but GitHub sees the time of the check, your IP address, your browser type, and that the request comes from PostShelf. Updates are never installed automatically. |
| zh_CN | 开启后，打开管理页面或侧边栏时最多每天一次向 GitHub 查询最新的版本号。不会发送任何数据，但 GitHub 会知道查询的时间、你的 IP 地址、浏览器类型，以及这是来自 PostShelf 的查询。不会自动更新。 |
| zh_TW | 開啟後，開啟管理頁面或側邊欄時最多每天一次向 GitHub 查詢最新的版本號碼。不會傳送任何資料，但 GitHub 會知道查詢的時間、你的 IP 位址、瀏覽器類型，以及這是來自 PostShelf 的查詢。不會自動更新。 |
| ko | 켜면 관리 페이지나 사이드 패널을 열 때 하루에 한 번까지 GitHub에 최신 버전 번호를 묻습니다. 보내는 데이터는 없지만, GitHub에는 확인한 시각, IP 주소, 브라우저 종류와 PostShelf에서 보낸 요청이라는 사실이 전달됩니다. 업데이트는 자동으로 하지 않습니다. |
| es | Si está activado, al abrir el administrador o el panel lateral se consulta a GitHub el número de la última versión, como máximo una vez al día. No se envía ningún dato, pero GitHub ve la hora de la consulta, tu dirección IP, tu tipo de navegador y que la consulta viene de PostShelf. Las actualizaciones nunca se instalan automáticamente. |
| pt_BR | Quando ativado, o PostShelf pergunta ao GitHub o número da versão mais recente ao abrir o gerenciador ou o painel lateral, no máximo uma vez por dia. Nenhum dado é enviado, mas o GitHub vê o horário da verificação, o seu endereço IP, o tipo do seu navegador e que a consulta vem do PostShelf. As atualizações nunca são instaladas automaticamente. |
| fr | Si cette option est activée, PostShelf demande à GitHub le numéro de la dernière version quand vous ouvrez le gestionnaire ou le panneau latéral, au plus une fois par jour. Aucune donnée n’est envoyée, mais GitHub voit l’heure de la vérification, votre adresse IP, votre type de navigateur et le fait que la demande vient de PostShelf. Les mises à jour ne sont jamais installées automatiquement. |
