/**
 * 画像キャッシュ用の「任意の」ホスト権限 (manifest の optional_host_permissions)。
 * 必須の permissions / host_permissions は増やさない。キャッシュをオンにするユーザーのクリックの中で request する。
 */
export const IMAGE_ORIGINS = ['https://pbs.twimg.com/*'];

export async function hasImagePermission(): Promise<boolean> {
  try {
    return !!(await chrome.permissions?.contains({ origins: IMAGE_ORIGINS }));
  } catch {
    return false;
  }
}

/** ユーザーのクリックのイベントハンドラの中で、最初の await として呼ぶ (確認画面にはユーザー操作が必要) */
export async function requestImagePermission(): Promise<boolean> {
  try {
    return !!(await chrome.permissions?.request({ origins: IMAGE_ORIGINS }));
  } catch {
    return false;
  }
}
