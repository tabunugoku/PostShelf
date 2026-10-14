# v70 の文言の提案: 親子のフォルダの動きを試す (設定の「フォルダ」の欄)

設定の「動作」→「フォルダ」の「親フォルダにも表示する」の下に、折りたたみ (`<details>`、既定は閉じる) で置くデモの文言。タブの管理画面だけに出す (サイドパネルには出さない)。保存データは変えない。

- 新しいキーは 24 件。既存の `allFolderName` (すべて)・`inboxName` (未分類) はそのまま使う。
- フォルダ名の A・C・G・B は、どの言語でも同じ記号のままにする。
- プレースホルダーは `demoDeleted` の `$NAME$` だけ (`content: "$1"`、例: `C`)。8 言語で同じ定義にする。
- 引用符は、各言語の既存の文言にそろえる (zh_CN “”、zh_TW 「」、ko と pt_BR は ""、es «»、fr « »)。
- ボタンの名前を引用する文 (`demoStart`、`demoNoFolder`) は、同じ言語のボタンの文言 (`demoOpSave`、`demoOpReset`) と一致させる。
- ja と en は、利用者が確認済み (`demoResMove` は、コードの動きに合わせて「A の下のほかのフォルダにも入っているポストは A に残る」と書く)。

採用するなら、この表の文言を 8 言語の `_locales` に足す。

## ja / en

| キー | ja | en |
|---|---|---|
| demoSummary | 親子のフォルダの動きを試す | Try how nested folders work |
| demoNote | フォルダを操作すると、ポストの所属先と表示がどう変わるかを、架空のポスト 1 件で試せます。保存データは変わりません。 | Try folder actions on one sample post and see how they change where it belongs and where it shows. Your saved data doesn't change. |
| demoAncestorsToggle | 親フォルダにも表示する（この図の中だけ） | Also show in parent folders (this sample only) |
| demoTreeHeading | フォルダ（右: その一覧にこのポストが出るか） | Folders (right: is the post listed here?) |
| demoStoredHeading | 保存される所属先（祖先も入る） | Saved folders (ancestors included) |
| demoShownHeading | ポストに表示される所属先 | Folders shown on the post |
| demoListed | 出る | Listed |
| demoMemberHidden | 所属しているが出ない | In folder, not listed |
| demoDeleted | $NAME$（削除済み） | $NAME$ (deleted) |
| demoOpSave | 孫 G に保存 | Save to grandchild G |
| demoOpAdd | B にも入れる | Also add to B |
| demoOpUncheckChild | 子 C を外す | Uncheck child C |
| demoOpUncheckParent | 親 A を外す | Uncheck parent A |
| demoOpMove | C を B の下へ移す | Move C under B |
| demoOpDelete | フォルダ C を削除 | Delete folder C |
| demoOpReset | 最初に戻す | Start over |
| demoStart | 「孫 G に保存」から試してください。 | Start with "Save to grandchild G". |
| demoResSave | G を選ぶと、祖先の C と A にも保存されます。ポストに表示されるのは、いちばん下の G だけです。 | Choosing G also saves the post to its ancestors C and A. Only G, the lowest folder, is shown on the post. |
| demoResAdd | B に入れても、G・C・A への所属はそのままです。ポストに表示されるのは G と B です。 | Adding B keeps G, C and A. The post shows G and B. |
| demoResUncheckChild | C を外すと、その下の G も外れます。親の A は残ります。 | Unchecking C also removes G under it. Parent A stays. |
| demoResUncheckParent | A を外すと、その下の C と G も外れます。何も残らなければ「未分類」に入ります（保存は消えません）。 | Unchecking A also removes C and G under it. If nothing is left, the post goes to Unsorted (it isn't deleted). |
| demoResMove | C を（G ごと）B の下へ移すと、C と G に入っていたポストは A から外れ、B に入ります。A の下のほかのフォルダにも入っているポストは、A に残ります。 | Moving C (with G) under B takes its posts out of A and puts them in B. Posts that are also in another folder under A stay in A. |
| demoResDelete | C を削除すると、その下の G も消えます（G を上の段へ移すことはしません）。ポストの A への所属は残ります。 | Deleting C also deletes G under it (G isn't moved up). The post stays in A. |
| demoNoFolder | C はすでに削除されています。「最初に戻す」で元に戻せます。 | C is already deleted. Press "Start over" to bring it back. |

## zh_CN / zh_TW

| キー | zh_CN | zh_TW |
|---|---|---|
| demoSummary | 试试多层文件夹的运作方式 | 試試多層資料夾的運作方式 |
| demoNote | 用一条示例帖子试试：操作文件夹后，帖子的所属文件夹和显示位置会如何变化。保存的数据不会改变。 | 用一則範例貼文試試：操作資料夾後，貼文所屬的資料夾和顯示位置會如何變化。儲存的資料不會改變。 |
| demoAncestorsToggle | 也在父文件夹中显示（仅限此示例） | 也在上層資料夾中顯示（僅限此範例） |
| demoTreeHeading | 文件夹（右侧：该文件夹的列表中是否显示这条帖子） | 資料夾（右側：該資料夾的列表中是否顯示這則貼文） |
| demoStoredHeading | 保存的所属文件夹（含上层） | 儲存的所屬資料夾（含上層） |
| demoShownHeading | 帖子上显示的所属文件夹 | 貼文上顯示的所屬資料夾 |
| demoListed | 显示 | 顯示 |
| demoMemberHidden | 属于此文件夹但不显示 | 屬於此資料夾但不顯示 |
| demoDeleted | $NAME$（已删除） | $NAME$（已刪除） |
| demoOpSave | 保存到孙文件夹 G | 儲存到孫資料夾 G |
| demoOpAdd | 也放入 B | 也放入 B |
| demoOpUncheckChild | 取消勾选子文件夹 C | 取消勾選子資料夾 C |
| demoOpUncheckParent | 取消勾选父文件夹 A | 取消勾選上層資料夾 A |
| demoOpMove | 将 C 移到 B 下 | 將 C 移到 B 底下 |
| demoOpDelete | 删除文件夹 C | 刪除資料夾 C |
| demoOpReset | 重新开始 | 重新開始 |
| demoStart | 请先试试“保存到孙文件夹 G”。 | 請先試試「儲存到孫資料夾 G」。 |
| demoResSave | 选择 G 后，也会保存到它的上层 C 和 A。帖子上只显示最下层的 G。 | 選擇 G 後，也會儲存到它的上層 C 和 A。貼文上只顯示最下層的 G。 |
| demoResAdd | 放入 B 后，G、C、A 的所属保持不变。帖子上显示的是 G 和 B。 | 放入 B 後，G、C、A 的所屬維持不變。貼文上顯示的是 G 和 B。 |
| demoResUncheckChild | 取消勾选 C 后，它下面的 G 也会被移除。父文件夹 A 保留。 | 取消勾選 C 後，它底下的 G 也會被移除。上層資料夾 A 保留。 |
| demoResUncheckParent | 取消勾选 A 后，它下面的 C 和 G 也会被移除。如果没有剩下任何文件夹，帖子会进入“未分类”（不会被删除）。 | 取消勾選 A 後，它底下的 C 和 G 也會被移除。如果沒有剩下任何資料夾，貼文會進入「未分類」（不會被刪除）。 |
| demoResMove | 将 C（连同 G）移到 B 下后，原本在 C 和 G 中的帖子会从 A 移除，并放入 B。同时也在 A 下其他文件夹中的帖子，会保留在 A。 | 將 C（連同 G）移到 B 底下後，原本在 C 和 G 中的貼文會從 A 移除，並放入 B。同時也在 A 底下其他資料夾中的貼文，會保留在 A。 |
| demoResDelete | 删除 C 后，它下面的 G 也会被删除（G 不会移到上一层）。帖子在 A 中的所属会保留。 | 刪除 C 後，它底下的 G 也會被刪除（G 不會移到上一層）。貼文在 A 中的所屬會保留。 |
| demoNoFolder | C 已被删除。点击“重新开始”即可恢复。 | C 已被刪除。按「重新開始」即可復原。 |

## ko

| キー | ko |
|---|---|
| demoSummary | 중첩 폴더의 동작 체험하기 |
| demoNote | 예시 게시물 1개로, 폴더를 조작하면 게시물의 소속 폴더와 표시 위치가 어떻게 바뀌는지 확인할 수 있습니다. 저장된 데이터는 변경되지 않습니다. |
| demoAncestorsToggle | 상위 폴더에도 표시 (이 예시에서만) |
| demoTreeHeading | 폴더 (오른쪽: 그 폴더 목록에 이 게시물이 나오는지) |
| demoStoredHeading | 저장되는 소속 폴더 (상위 포함) |
| demoShownHeading | 게시물에 표시되는 소속 폴더 |
| demoListed | 표시 |
| demoMemberHidden | 소속되어 있지만 표시 안 됨 |
| demoDeleted | $NAME$ (삭제됨) |
| demoOpSave | 손자 폴더 G에 저장 |
| demoOpAdd | B에도 넣기 |
| demoOpUncheckChild | 하위 폴더 C 체크 해제 |
| demoOpUncheckParent | 상위 폴더 A 체크 해제 |
| demoOpMove | C를 B 아래로 이동 |
| demoOpDelete | 폴더 C 삭제 |
| demoOpReset | 처음으로 되돌리기 |
| demoStart | "손자 폴더 G에 저장"부터 해 보세요. |
| demoResSave | G를 선택하면 상위 폴더인 C와 A에도 저장됩니다. 게시물에는 가장 하위의 G만 표시됩니다. |
| demoResAdd | B에 넣어도 G·C·A 소속은 그대로입니다. 게시물에 표시되는 것은 G와 B입니다. |
| demoResUncheckChild | C를 체크 해제하면 그 아래의 G도 해제됩니다. 상위 폴더 A는 남습니다. |
| demoResUncheckParent | A를 체크 해제하면 그 아래의 C와 G도 해제됩니다. 남은 폴더가 없으면 "미분류"로 들어갑니다 (삭제되지 않습니다). |
| demoResMove | C를 (G와 함께) B 아래로 옮기면, C와 G에 들어 있던 게시물은 A에서 빠지고 B에 들어갑니다. A 아래의 다른 폴더에도 들어 있는 게시물은 A에 남습니다. |
| demoResDelete | C를 삭제하면 그 아래의 G도 삭제됩니다 (G를 위 단계로 옮기지 않습니다). 게시물의 A 소속은 남습니다. |
| demoNoFolder | C는 이미 삭제되었습니다. "처음으로 되돌리기"를 누르면 되돌릴 수 있습니다. |

## es / pt_BR

| キー | es | pt_BR |
|---|---|---|
| demoSummary | Prueba cómo funcionan las carpetas anidadas | Experimente como funcionam as pastas aninhadas |
| demoNote | Prueba acciones de carpetas con una publicación de ejemplo y mira cómo cambian las carpetas a las que pertenece y dónde aparece. Tus datos guardados no cambian. | Teste ações de pastas com um post de exemplo e veja como mudam as pastas às quais ele pertence e onde ele aparece. Seus dados salvos não mudam. |
| demoAncestorsToggle | Mostrar también en las carpetas superiores (solo en este ejemplo) | Mostrar também nas pastas superiores (só neste exemplo) |
| demoTreeHeading | Carpetas (derecha: ¿aparece la publicación en esta carpeta?) | Pastas (à direita: o post aparece nesta pasta?) |
| demoStoredHeading | Carpetas guardadas (incluidas las superiores) | Pastas salvas (incluindo as superiores) |
| demoShownHeading | Carpetas que se muestran en la publicación | Pastas mostradas no post |
| demoListed | Aparece | Aparece |
| demoMemberHidden | En la carpeta, no aparece | Na pasta, não aparece |
| demoDeleted | $NAME$ (eliminada) | $NAME$ (excluída) |
| demoOpSave | Guardar en G (nieta) | Salvar em G (neta) |
| demoOpAdd | Añadir también a B | Adicionar também a B |
| demoOpUncheckChild | Desmarcar C (hija) | Desmarcar C (filha) |
| demoOpUncheckParent | Desmarcar A (superior) | Desmarcar A (superior) |
| demoOpMove | Mover C dentro de B | Mover C para dentro de B |
| demoOpDelete | Eliminar la carpeta C | Excluir a pasta C |
| demoOpReset | Empezar de nuevo | Recomeçar |
| demoStart | Empieza por «Guardar en G (nieta)». | Comece por "Salvar em G (neta)". |
| demoResSave | Al elegir G, la publicación también se guarda en sus carpetas superiores C y A. En la publicación solo se muestra G, la de nivel más bajo. | Ao escolher G, o post também é salvo nas pastas superiores C e A. No post, só aparece G, a de nível mais baixo. |
| demoResAdd | Al añadir B, se mantienen G, C y A. La publicación muestra G y B. | Ao adicionar B, G, C e A continuam. O post mostra G e B. |
| demoResUncheckChild | Al desmarcar C, también se quita G, que está dentro. A, la superior, se mantiene. | Ao desmarcar C, G, que está dentro dela, também sai. A, a superior, continua. |
| demoResUncheckParent | Al desmarcar A, también se quitan C y G, que están dentro. Si no queda ninguna, la publicación pasa a «Sin clasificar» (no se elimina). | Ao desmarcar A, C e G, que estão dentro dela, também saem. Se não sobrar nenhuma, o post vai para "Sem categoria" (não é excluído). |
| demoResMove | Al mover C (con G) dentro de B, las publicaciones de C y G salen de A y entran en B. Las que también están en otra carpeta dentro de A se quedan en A. | Ao mover C (com G) para dentro de B, os posts de C e G saem de A e entram em B. Os que também estão em outra pasta dentro de A continuam em A. |
| demoResDelete | Al eliminar C, también se elimina G, que está dentro (G no sube de nivel). La publicación sigue en A. | Ao excluir C, G, que está dentro dela, também é excluída (G não sobe de nível). O post continua em A. |
| demoNoFolder | C ya está eliminada. Pulsa «Empezar de nuevo» para recuperarla. | C já foi excluída. Clique em "Recomeçar" para trazê-la de volta. |

## fr

| キー | fr |
|---|---|
| demoSummary | Essayer le fonctionnement des dossiers imbriqués |
| demoNote | Testez les actions sur les dossiers avec un post d’exemple et voyez comment changent ses dossiers et les endroits où il s’affiche. Vos données enregistrées ne changent pas. |
| demoAncestorsToggle | Afficher aussi dans les dossiers parents (dans cet exemple uniquement) |
| demoTreeHeading | Dossiers (à droite : le post est-il listé ici ?) |
| demoStoredHeading | Dossiers enregistrés (parents inclus) |
| demoShownHeading | Dossiers affichés sur le post |
| demoListed | Listé |
| demoMemberHidden | Dans le dossier, non listé |
| demoDeleted | $NAME$ (supprimé) |
| demoOpSave | Enregistrer dans G (petit-enfant) |
| demoOpAdd | Ajouter aussi à B |
| demoOpUncheckChild | Décocher C (enfant) |
| demoOpUncheckParent | Décocher A (parent) |
| demoOpMove | Déplacer C sous B |
| demoOpDelete | Supprimer le dossier C |
| demoOpReset | Recommencer |
| demoStart | Commencez par « Enregistrer dans G (petit-enfant) ». |
| demoResSave | Choisir G enregistre aussi le post dans ses dossiers parents C et A. Seul G, le plus bas, s’affiche sur le post. |
| demoResAdd | Ajouter B conserve G, C et A. Le post affiche G et B. |
| demoResUncheckChild | Décocher C retire aussi G, qui est dessous. Le parent A reste. |
| demoResUncheckParent | Décocher A retire aussi C et G, qui sont dessous. S’il ne reste aucun dossier, le post passe dans « Non classés » (il n’est pas supprimé). |
| demoResMove | Déplacer C (avec G) sous B retire ses posts de A et les place dans B. Ceux qui sont aussi dans un autre dossier sous A restent dans A. |
| demoResDelete | Supprimer C supprime aussi G, qui est dessous (G ne remonte pas d’un niveau). Le post reste dans A. |
| demoNoFolder | C est déjà supprimé. Cliquez sur « Recommencer » pour le rétablir. |
