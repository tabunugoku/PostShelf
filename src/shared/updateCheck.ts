import { RELEASES_API_URL } from './links';
import { getSettings, getUpdateCheckState, saveUpdateCheckState } from './settings';
import { currentVersion } from './version';

/**
 * 更新の確認 (v73)。設定「新しいバージョンを確かめる」がオンのときだけ、GitHub の最新のリリースのバージョン番号を読む。
 * 外部通信なしの方針の唯一の例外 (CLAUDE.md の「守ること」)。読むだけで、ダウンロードと適用はしない。
 * 背景で定期的には動かさない (alarms の権限を増やさない)。画面を開いたときに呼ぶ
 */

/** 前回から、この時間がたつまでは問い合わせない */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 'v1.2.3' / '1.2.3' を数の配列にする。数字と点だけの形 (1〜4 個) でなければ null (例: 'v1.2.0-beta') */
export function parseVersion(text: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+){0,3})$/.exec(text.trim());
  return m ? m[1].split('.').map(Number) : null;
}

/** 画面に出すバージョン番号 (先頭の v を外す。設定の「バージョン 1.1.7」の表示にそろえる) */
export const displayVersion = (tag: string): string => tag.trim().replace(/^v/, '');

/** latest が current より新しいバージョンか。どちらかが読めない形なら false (案内を出さない側に倒す) */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export interface UpdateCheckDeps {
  fetch: typeof fetch;
  now: () => number;
  /** いま動いているバージョン (manifest の version) */
  current: () => string;
}

export const defaultUpdateCheckDeps: UpdateCheckDeps = {
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  current: currentVersion,
};

/** 最新のリリースの tag_name を読む。読めなければ null (通信の失敗・制限 (403)・リリースなし (404) を含む) */
async function readLatestTag(deps: UpdateCheckDeps): Promise<string | null> {
  try {
    // Cookie と Referer を送らない。独自のヘッダーは付けない (付けると CORS の事前確認が増える)。
    // ブラウザが付ける User-Agent と Origin (chrome-extension://…) は止められないので、設定の説明に書く
    const res = await deps.fetch(RELEASES_API_URL, {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown };
    return typeof body.tag_name === 'string' ? body.tag_name : null;
  } catch {
    return null;
  }
}

/**
 * 新しいバージョンがあれば、そのバージョン番号 (tag_name) を返す。無い・オフ・確かめられないときは null。
 * 前回から 24 時間たっていなければ問い合わせず、前回読めた結果だけで判断する (画面を開くたびに案内は出し続ける)。
 * 問い合わせる前に時刻を記録する (失敗が続いても、何度も問い合わせない)。
 * 管理画面とポップアップを同時に開くと、記録の前に両方が読むことがあり、まれに 2 回問い合わせ得る
 */
export async function checkForUpdate(deps: UpdateCheckDeps = defaultUpdateCheckDeps): Promise<string | null> {
  if (!(await getSettings()).updateCheck) return null;
  const current = deps.current();
  const now = deps.now();
  const state = await getUpdateCheckState();
  let latest = state.latest;
  // 時計が戻ったとき (記録が未来) も、確かめ直す
  const due = now - state.checkedAt >= UPDATE_CHECK_INTERVAL_MS || now < state.checkedAt;
  if (due) {
    await saveUpdateCheckState({ ...state, checkedAt: now });
    const tag = await readLatestTag(deps);
    if (tag !== null) {
      latest = tag;
      await saveUpdateCheckState({ checkedAt: now, latest: tag });
    }
  }
  return latest && isNewerVersion(latest, current) ? latest : null;
}

/**
 * 前回読めた結果だけで判断し、問い合わせはしない (ポップアップ用)。
 * ポップアップはすぐ閉じられることがあり、問い合わせの途中で閉じると、時刻だけ記録して 24 時間確かめなくなるため
 */
export async function cachedUpdate(current: string = currentVersion()): Promise<string | null> {
  if (!(await getSettings()).updateCheck) return null;
  const { latest } = await getUpdateCheckState();
  return latest && isNewerVersion(latest, current) ? latest : null;
}
