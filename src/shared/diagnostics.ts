/**
 * 診断情報 (ユーザーが「診断情報をコピー」を押したときだけ作る。自動送信しない)。
 *
 * 画面構造の骨格には、タグ名、role、data-testid、aria-* の「属性名」だけを入れる。
 * テキスト、リンク (href)、画像 URL、ユーザー名、ID、aria-* の値は一切含めない。深さは 8 まで、全体で 6KB まで。
 *
 * role と data-testid の値は構造の手がかりとして有用だが、data-testid に `UserAvatar-Container-<ユーザー名>` のように
 * ユーザー名が入ることがある。そこで値は「単語」に分解し、既知の UI 語彙にある単語だけを残して、それ以外は `?` に置き換える。
 */
export const MAX_DEPTH = 8;
export const MAX_BYTES = 6 * 1024;

/** 値に残してよい単語 (小文字)。X の data-testid / role に出てくる UI 部品の語彙 */
const VOCAB = new Set(
  (
    'article button group link img image text time tweet user name avatar container bookmark remove like unlike reply retweet unretweet share ' +
    'photo video player component card wrapper caret social context app bar tab list item cell inner content body header footer main nav ' +
    'primary column sidebar timeline conversation detail row menu dialog presentation heading banner region listitem navigation textbox ' +
    'tooltip toolbar tablist tabpanel switch checkbox radio status alert search icon label title subtitle action actions view views count ' +
    'analytics grok promoted ad badge verified follow unfollow more options engagement stat stats media quote thread detail layer sheet ' +
    'trend trends who suggestion suggestions cluster top left right center root scroll area info display unified ' +
    'a the of on in for and or to by is'
  ).split(/\s+/),
);

const ROLES = new Set(['article', 'group', 'link', 'button', 'img', 'presentation', 'none', 'list', 'listitem', 'region', 'heading', 'tab', 'tablist', 'tabpanel', 'main', 'navigation', 'banner', 'dialog', 'menu', 'menuitem', 'textbox', 'toolbar', 'status', 'time']);

/** 値を単語に分けて、語彙にある単語だけ残す。camelCase / kebab / snake / . で区切る */
export function sanitizeValue(v: string, extraBlocked: string[] = []): string {
  const blocked = new Set(extraBlocked.map((x) => x.toLowerCase()).filter((x) => x.length > 1));
  return v
    .split(/([-_.:\s]+)/)
    .map((seg) => {
      if (/^[-_.:\s]+$/.test(seg)) return seg;
      return seg
        .replace(/([a-z])([A-Z])/g, '$1\u0000$2')
        .split('\u0000')
        .map((w) => (VOCAB.has(w.toLowerCase()) && !blocked.has(w.toLowerCase()) ? w : '?'))
        .join('');
    })
    .join('')
    .replace(/\?(?:[-_.:]?\?)+/g, '?') // 伏せた単語が続くときは 1 つにまとめる (bob_99 → ?)
    .slice(0, 60);
}

/** 1 要素の記述: tag[role=…][testid=…] aria:名前,名前 */
function describe(el: Element, blocked: string[]): string {
  let out = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (role) out += `[role=${ROLES.has(role.toLowerCase()) ? role.toLowerCase() : '?'}]`;
  const tid = el.getAttribute('data-testid');
  if (tid) out += `[testid=${sanitizeValue(tid, blocked)}]`;
  const aria = el.getAttributeNames().filter((n) => n.startsWith('aria-')).sort();
  if (aria.length) out += ` ${aria.join(',')}`; // 属性名だけ。値は入れない
  return out;
}

/** article の DOM 構造の骨格 (インデントつきの行)。値のテキストは含めない */
export function skeleton(root: Element, blocked: string[] = []): string {
  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;
  const walk = (el: Element, depth: number) => {
    if (truncated) return;
    const line = `${'  '.repeat(depth)}${describe(el, blocked)}`;
    // 改行 1 バイト分を含めて上限内に収める
    if (bytes + line.length + 1 > MAX_BYTES - 20) {
      truncated = true;
      return;
    }
    lines.push(line);
    bytes += line.length + 1;
    if (depth >= MAX_DEPTH) return; // 深さ 8 まで (article を 0 とする)
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(root, 0);
  if (truncated) lines.push('…(truncated)');
  return lines.join('\n');
}

/** 骨格の中で伏せるべき文字列 (ポストの投稿者のハンドル/名前) を article から集める。値は出力しない */
export function blockedWords(article: Element): string[] {
  const out = new Set<string>();
  for (const a of article.querySelectorAll('a[href]')) {
    const m = (a.getAttribute('href') ?? '').match(/^\/([^/?#]+)/);
    if (m) out.add(m[1]);
  }
  return [...out];
}

export interface ReportInput {
  version: string;
  userAgent: string;
  uiLanguage: string;
  health: { state: string; checkedAt: number; missing: string[]; fallback: string[] } | null;
  /** x.com のタブから取れなかったときは null */
  skeleton: string | null;
}

/** 診断情報のテキスト (クリップボードにコピーする内容。ダイアログにも同じものを表示する) */
export function buildReport(r: ReportInput): string {
  const h = r.health;
  return [
    `PostShelf ${r.version}`,
    `userAgent: ${r.userAgent}`,
    `uiLanguage: ${r.uiLanguage}`,
    h
      ? `health: ${h.state} (checked ${new Date(h.checkedAt).toISOString()}) missing=[${h.missing.join(',')}] fallback=[${h.fallback.join(',')}]`
      : 'health: unknown',
    '',
    'article structure (tag / role / data-testid / aria-* names only):',
    r.skeleton ?? '(no x.com tab was available)',
  ].join('\n');
}
