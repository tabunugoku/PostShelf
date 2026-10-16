// 使い方: node .claude/codex/apply-commit-plan.mjs <worktree> <last.json> [--dry-run]
// Codex が返したコミット計画のとおり、項目ごとに git add と git commit をする。
// 複数の項目が触るファイル (shared_files) があれば、何もせずに止める (手で git add -p で分ける)。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [worktree, planPath, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const git = (...args) => execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' });
const trailer = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n';

if (plan.shared_files.length) {
  console.error('shared_files があるので止める:', plan.shared_files.map((f) => f.path).join(', '));
  process.exit(2);
}
const changed = new Set(git('status', '--porcelain', '-uall').split('\n').filter(Boolean).map((l) => l.slice(3)));
const planned = plan.items.flatMap((item) => item.files);
const missing = [...changed].filter((path) => !planned.includes(path));
if (missing.length) {
  console.error('計画に無い変更があるので止める:', missing.join(', '));
  process.exit(3);
}
for (const item of plan.items) {
  console.log(`${item.id}: ${item.message} (${item.files.length} files)`);
  if (dryRun) continue;
  git('add', '--', ...item.files);
  git('commit', '-q', '-m', item.message + trailer);
}
