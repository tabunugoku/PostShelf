// release:check の個々の確認 (副作用なし。test からも使う)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { extensionIdFromKey, idFromDoc, listZip } from './lib.mjs';

/** 必須の権限。増やすときは、利用者への影響を確認してから、ここと test を一緒に直す */
export const REQUIRED_PERMISSIONS = ['storage', 'unlimitedStorage', 'sidePanel'];
export const REQUIRED_HOST_PERMISSIONS = ['https://x.com/*', 'https://twitter.com/*'];
/** 任意の権限 (利用者が許可したときだけ使う。画像のキャッシュ用)。permissions の optional は使わない */
export const OPTIONAL_HOST_PERMISSIONS = ['https://pbs.twimg.com/*'];
/** コードの中の fetch などで、絶対 URL の文字列を直接渡してよいホスト */
export const ALLOWED_NETWORK_HOSTS = ['x.com', 'twitter.com', 'pbs.twimg.com'];
export const LOCALES = ['ja', 'en', 'zh_CN', 'zh_TW', 'ko', 'es', 'pt_BR', 'fr'];

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function checkVersion(manifest, pkg) {
  return manifest.version === pkg.version ? [] : [`manifest の version (${manifest.version}) が package.json (${pkg.version}) と違います`];
}

/** リリースノートの節。英語が先で、日本語の原文は折りたたむ (CLAUDE.md の「リリース」) */
export const RELEASE_NOTES_HEADINGS = ['## Added', '## Fixed', '<summary>日本語 (Japanese)</summary>', '## 追加', '## 修正'];

export function checkReleaseNotes(notes) {
  if (!notes) return ['リリースノートがありません'];
  const errors = RELEASE_NOTES_HEADINGS.filter((h) => !notes.includes(h)).map((h) => `「${h}」がありません`);
  // 英語の節を、折りたたんだ日本語より前に置く
  const english = notes.indexOf('## Added');
  const folded = notes.indexOf('<details>');
  if (english >= 0 && folded >= 0 && english > folded) errors.push('英語の節が、日本語の折りたたみより後ろにあります');
  return errors;
}

export function checkPermissions(manifest) {
  const errors = [];
  if (!same(manifest.permissions, REQUIRED_PERMISSIONS)) errors.push(`permissions が現在の一覧と違います: ${JSON.stringify(manifest.permissions)}`);
  if (!same(manifest.host_permissions, REQUIRED_HOST_PERMISSIONS)) errors.push(`host_permissions が現在の一覧と違います: ${JSON.stringify(manifest.host_permissions)}`);
  if (!same(manifest.optional_host_permissions, OPTIONAL_HOST_PERMISSIONS)) {
    errors.push(`optional_host_permissions が現在の一覧と違います: ${JSON.stringify(manifest.optional_host_permissions)}`);
  }
  if (manifest.optional_permissions && manifest.optional_permissions.length > 0) {
    errors.push(`optional_permissions は使いません: ${JSON.stringify(manifest.optional_permissions)}`);
  }
  return errors;
}

/** localeMessages: { ja: {key: {message, placeholders?}}, ... } */
export function checkLocales(localeMessages) {
  const errors = [];
  const tokens = (e) => [...new Set([...(e.message.match(/\$[A-Za-z0-9_]+\$/g) ?? []), ...(e.message.match(/\$\d/g) ?? [])])].sort();
  const phs = (e) => Object.keys(e.placeholders ?? {}).sort();
  const base = localeMessages.en;
  for (const [loc, msgs] of Object.entries(localeMessages)) {
    if (loc === 'en') continue;
    for (const k of Object.keys(base)) if (!(k in msgs)) errors.push(`${loc}: キー ${k} がありません`);
    for (const k of Object.keys(msgs)) if (!(k in base)) errors.push(`${loc}: en にないキー ${k} があります`);
    for (const k of Object.keys(base)) {
      if (!(k in msgs)) continue;
      if (!same(tokens(base[k]), tokens(msgs[k])) || !same(phs(base[k]), phs(msgs[k]))) errors.push(`${loc}: ${k} のプレースホルダーが en と一致しません`);
    }
  }
  return errors;
}

const URL_ARG = String.raw`["'\x60]((?:https?|wss?):\/\/[^"'\x60\s]+)["'\x60]`;
/**
 * 通信の呼び出しで、引数が許可していないホストの文字列リテラルになっているもの。単純な形だけを見る:
 * fetch("https://...") / sendBeacon("https://...") / new WebSocket("wss://...") / XMLHttpRequest を使うファイルの .open("GET", "https://...")。
 * 変数・連結・テンプレートの式で URL を組み立てる書き方や、new Request(...) 経由は見つけられない。
 */
const NETWORK_RULES = [
  [new RegExp(String.raw`\bfetch\s*\(\s*${URL_ARG}`, 'g'), 'fetch'],
  [new RegExp(String.raw`\bsendBeacon\s*\(\s*${URL_ARG}`, 'g'), 'sendBeacon'],
  [new RegExp(String.raw`\bnew\s+WebSocket\s*\(\s*${URL_ARG}`, 'g'), 'WebSocket'],
  [
    new RegExp(String.raw`\.open\s*\(\s*["'\x60][A-Za-z]+["'\x60]\s*,\s*${URL_ARG}`, 'g'),
    'XMLHttpRequest',
    /\bnew\s+XMLHttpRequest\b/,
  ],
];

function disallowedHost(url) {
  if (url.includes('${')) return null; // テンプレートの式を含むものは、ホストを決められない
  try {
    const host = new URL(url).hostname;
    return ALLOWED_NETWORK_HOSTS.includes(host) ? null : host;
  } catch {
    return null;
  }
}

/** 外部のスクリプト URL、eval、new Function、リモートコードの読み込み、許可していないホストへの通信 */
export function checkNoRemoteCode(distDir) {
  const errors = [];
  const rules = [
    [/\beval\s*\(/, 'eval'],
    [/\bnew\s+Function\s*\(/, 'new Function'],
    [/\bimportScripts\s*\(/, 'importScripts'],
    [/\bimport\s*\(\s*["'`]https?:/, '外部の動的 import'],
    [/\bsrc\s*=\s*["'`]https?:/, '外部の src の代入'],
    [/<script[^>]+src\s*=\s*["']?(https?:)?\/\//i, '外部の <script src>'],
    [/\.src\s*=\s*["'`]https?:/, '外部の .src の代入'],
  ];
  for (const f of walk(distDir)) {
    if (!/\.(js|mjs|html)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const [re, label] of rules) if (re.test(text)) errors.push(`${relative(distDir, f)}: ${label} が含まれています`);
    if (!f.endsWith('.js') && !f.endsWith('.mjs')) continue;
    for (const [re, label, guard] of NETWORK_RULES) {
      if (guard && !guard.test(text)) continue;
      for (const m of text.matchAll(re)) {
        const host = disallowedHost(m[1]);
        if (host) errors.push(`${relative(distDir, f)}: ${label} が許可していないホスト (${host}) を指しています`);
      }
    }
  }
  return errors;
}

/** manifest が指すファイル (パス) の一覧。web_accessible_resources の glob は前置きのディレクトリ/ファイルを返す */
export function manifestFiles(manifest) {
  const files = new Set();
  const add = (p) => p && files.add(p);
  Object.values(manifest.icons ?? {}).forEach(add);
  Object.values(manifest.action?.default_icon ?? {}).forEach(add);
  add(manifest.action?.default_popup);
  add(manifest.background?.service_worker);
  add(manifest.side_panel?.default_path);
  for (const cs of manifest.content_scripts ?? []) [...(cs.js ?? []), ...(cs.css ?? [])].forEach(add);
  for (const w of manifest.web_accessible_resources ?? []) for (const r of w.resources) files.add(r);
  return [...files];
}

export function checkManifestFilesInZip(manifest, zipNames) {
  const errors = [];
  const set = new Set(zipNames);
  if (!set.has('manifest.json')) errors.push('zip の直下に manifest.json がありません');
  if (!set.has('_locales/en/messages.json')) errors.push('zip に _locales/en/messages.json がありません');
  for (const f of manifestFiles(manifest)) {
    const ok = f.includes('*') ? zipNames.some((n) => n.startsWith(f.slice(0, f.indexOf('*')))) : set.has(f);
    if (!ok) errors.push(`manifest が指す ${f} が zip にありません`);
  }
  for (const n of zipNames) {
    if (/\.map$|\.ts$|\.tsx$/.test(n) || n.split('/').includes('node_modules') || /^(test|src)\//.test(n)) errors.push(`zip に入れてはいけないファイル: ${n}`);
  }
  return errors;
}

export function checkKeyId(manifest, installMd) {
  if (!manifest.key) return ['manifest に key がありません'];
  const id = extensionIdFromKey(manifest.key);
  const doc = idFromDoc(installMd);
  if (!doc) return ['docs/INSTALL.md に拡張機能 ID が見つかりません'];
  return doc === id ? [] : [`key から求めた ID (${id}) が docs/INSTALL.md の ID (${doc}) と違います`];
}

export function distNames(distDir) {
  return walk(distDir).map((f) => relative(distDir, f).split(sep).join('/'));
}
export { existsSync, listZip };
