#!/usr/bin/env python3
"""公開用リポジトリに入れるファイルだけを、別のフォルダへ書き出す (開発用リポジトリ専用)。

使い方:  py -3 tools/export_public.py <書き出し先のフォルダ>

- 許可リスト (ALLOW) にあるものだけをコピーする。画像 (スクリーンショット・モック)、
  開発用の文書 (CLAUDE.md、PLAN、TASK、MANUAL_TEST など) は入らない。
- 書き出し先は、空か、まだ無いフォルダにする (中身があるときは止まる。上書きしない)。
- 書き出した後に、禁止されているものが混ざっていないか確かめる。見つかったら失敗で終わる。
- このスクリプトは、公開用には入らない (tools/ は許可リストにない)。
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ディレクトリは丸ごと、ファイルは 1 つずつ。
ALLOW_DIRS = ['.github', 'src', 'static', 'scripts', 'test']
ALLOW_FILES = [
    '.gitignore', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md',
    'build.mjs', 'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts',
    'docs/INSTALL.md', 'docs/INSTALL.en.md', 'docs/FAQ.md',
    'docs/brand/icon-512.png', 'docs/brand/icon.svg',
]
# 許可した中から、さらに外すもの (開発用の文書を読むテスト)
EXCLUDE = ['test/install-docs.test.ts']

# 書き出し後の検査
ALLOWED_PNG = re.compile(r'^(static/brand/icon-\d+\.png|docs/brand/icon-512\.png)$')
ALLOWED_MD = {
    'README.md', 'THIRD_PARTY_NOTICES.md', 'docs/INSTALL.md', 'docs/INSTALL.en.md', 'docs/FAQ.md',
    '.github/ISSUE_TEMPLATE/selector-broken.md',
}
FORBIDDEN_NAMES = ['CLAUDE.md', 'screenshots', 'mockups', 'TASK_V', 'PLAN.md', 'MANUAL_TEST', 'PUBLISH.md', 'reports', 'research_notes']
IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}


def copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def patch_readme(path: Path) -> None:
    """開発用の文書へのリンクの行を外す (公開用には、その文書がない)。"""
    lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
    kept = [ln for ln in lines if 'docs/MANUAL_TEST.md' not in ln and 'docs/PLAN.md' not in ln]
    path.write_text(''.join(kept), encoding='utf-8', newline='')


def verify(out: Path) -> list[str]:
    errors: list[str] = []
    for p in sorted(out.rglob('*')):
        if not p.is_file():
            continue
        rel = p.relative_to(out).as_posix()
        if any(n in rel for n in FORBIDDEN_NAMES):
            errors.append(f'禁止の名前: {rel}')
        if p.suffix.lower() in IMAGE_EXT and not ALLOWED_PNG.match(rel):
            errors.append(f'許可していない画像: {rel}')
        if p.suffix.lower() == '.md' and rel not in ALLOWED_MD:
            errors.append(f'許可していない Markdown: {rel}')
    readme = (out / 'README.md').read_text(encoding='utf-8')
    for bad in ('docs/MANUAL_TEST.md', 'docs/PLAN.md', 'docs/screenshots'):
        if bad in readme:
            errors.append(f'README に {bad} へのリンクが残っています')
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out = Path(sys.argv[1]).resolve()
    if out == ROOT or ROOT in out.parents:
        print('書き出し先は、開発用リポジトリの外にしてください。')
        return 2
    if out.exists() and any(out.iterdir()):
        print(f'書き出し先が空ではありません: {out}')
        return 2
    out.mkdir(parents=True, exist_ok=True)

    for d in ALLOW_DIRS:
        base = ROOT / d
        for p in base.rglob('*'):
            if p.is_file() and 'node_modules' not in p.parts:
                rel = p.relative_to(ROOT).as_posix()
                if rel not in EXCLUDE:
                    copy_file(p, out / rel)
    for f in ALLOW_FILES:
        copy_file(ROOT / f, out / f)
    patch_readme(out / 'README.md')

    errors = verify(out)
    if errors:
        print('検査に失敗しました:')
        for e in errors:
            print('  -', e)
        return 1
    n = sum(1 for p in out.rglob('*') if p.is_file())
    print(f'OK: {n} ファイルを書き出しました → {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
