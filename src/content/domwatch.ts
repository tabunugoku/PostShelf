const subscribers: { callback: () => void; attributes: boolean }[] = [];
let observer: MutationObserver | undefined;

/** body の変化を登録順に通知する。属性変更は希望した購読者だけに通知する */
export function watchBody(callback: () => void, attributes = false): void {
  subscribers.push({ callback, attributes });
  if (observer) return;
  observer = new MutationObserver((records) => {
    const childList = records.some((record) => record.type === 'childList');
    for (const subscriber of subscribers) {
      if (!childList && !subscriber.attributes) continue;
      try {
        subscriber.callback();
      } catch (error) {
        // 従来の別々の監視と同様、1 か所の例外で後続の通知を止めない。
        queueMicrotask(() => { throw error; });
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'poster'],
  });
}
