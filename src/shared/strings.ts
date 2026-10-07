/** UI 文言 (日本語)。将来の i18n に備えてここへ集約する。 */
export const STRINGS = {
  allFolderName: 'すべて',
  newFolderDefaultName: '新しいフォルダ',
  errors: {
    emptyName: 'フォルダ名を入力してください',
    builtinImmutable: '「すべて」は変更・削除できません',
    notFound: 'フォルダが見つかりません',
    invalidIcon: '使用できないアイコンです',
    invalidColor: '使用できない色です',
  },
} as const;

export const UI = {
  openFolders: 'フォルダに保存',
  newFolder: '新しいフォルダ',
  newFolderPlaceholder: 'フォルダ名',
  add: '追加',
  noFolders: 'フォルダがありません',
} as const;
