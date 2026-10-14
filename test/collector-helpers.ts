// 版: v50
import { readFileSync } from 'node:fs';
import { AutoCollector, defaultDeps } from '../src/content/autocollect';

/** 推測を明記した fixture を読み、jsdom で取得できない画像の読み込み状態を設定する。 */
export function loadFixture(file: string): void {
  document.body.innerHTML = readFileSync(`test/fixtures/${file}`, 'utf8');
  for (const img of document.querySelectorAll('img')) markLoaded(img);
}

/** 画像の DOM 挿入後の読み込み完了を模擬する。通信は行わない。 */
export function markLoaded(img: HTMLImageElement): void {
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: 48, configurable: true });
}

/** 待ちのたびに仮想時計を進め、実際の DOM を既存の visible で読み直す取り込み。 */
export function collectorWorld(onSleep: (now: number) => void = () => {}) {
  const clock = { now: 0, sleeps: [] as number[] };
  const collector = new AutoCollector({
    ...defaultDeps(),
    now: () => clock.now,
    random: () => 0,
    sleep: async (ms) => {
      clock.sleeps.push(ms);
      clock.now += ms;
      onSleep(clock.now);
    },
    savedIds: async () => new Set(),
    saveRun: async () => {},
  });
  collector.state = {
    status: 'running', accountId: 'me', startedAt: 1000,
    imported: 0, skipped: 0, failed: 0, speed: 'slow', cap: 0, updatedAt: 1000,
  };
  const read = () => (collector as any).readVisible(0) as Promise<number>;
  const flush = () => (collector as any).flush() as Promise<void>;
  return { collector, clock, read, flush };
}
