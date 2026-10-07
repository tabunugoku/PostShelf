/** UI 文言 (日本語)。将来の i18n に備えてここへ集約する。 */
export const STRINGS = {
  allFolderName: 'すべて',
  inboxName: '未分類',
  newFolderDefaultName: '新しいフォルダ',
  errors: {
    emptyName: 'フォルダ名を入力してください',
    builtinImmutable: '「すべて」は変更・削除できません',
    notFound: 'フォルダが見つかりません',
    invalidIcon: '使用できないアイコンです',
    invalidColor: '使用できない色です',
    invalidImport: 'ファイルの形式が正しくありません',
  },
} as const;

export const UI = {
  openFolders: 'フォルダに保存',
  newFolder: '新しいフォルダ',
  newFolderPlaceholder: 'フォルダ名',
  add: '追加',
  noFolders: 'フォルダがありません',
} as const;

export const MGR = {
  title: 'PostShelf',
  folders: 'ブックマーク',
  edit: '編集',
  postView: 'ポスト表示',
  listView: 'リスト表示',
  search: '検索',
  sortSavedDesc: '保存が新しい順',
  sortSavedAsc: '保存が古い順',
  sortPostedDesc: '投稿が新しい順',
  sortPostedAsc: '投稿が古い順',
  name: '名前',
  icon: 'アイコン',
  color: '色',
  colorOnlyFolder: '色はフォルダアイコンのときだけ選べます',
  save: '保存',
  cancel: 'キャンセル',
  delete: '削除',
  confirmDelete: 'このフォルダを削除しますか？ (ポスト自体は残ります)',
  empty: '保存されたポストはありません',
  openOnX: 'X で開く',
  newFolder: '新しいフォルダ',
  popupBookmarks: '件',
  recent: '最近保存した 3 件',
  settings: '設定',
  popupFolders: 'フォルダ',
  openManager: '管理画面を開く',
} as const;

export const IO = {
  export: 'エクスポート',
  import: 'インポート',
  importDone: (n: number) => `${n} 件のポストを取り込みました`,
  importFail: 'ファイルの形式が正しくありません',
  collectTitle: 'このページのポストを PostShelf に取り込む',
  collectDone: (n: number) => `${n} 件を「未分類」として取り込みました`,
} as const;
