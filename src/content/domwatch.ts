const DEFAULT_ATTRIBUTES = ['src', 'poster'];
const subscribers = new Set<{ callback: () => void; attributes: boolean | readonly string[] }>();
let observer: MutationObserver | undefined;

/** body の変化を登録順に通知する。属性変更は希望した購読者だけに通知し、解除関数を返す */
export function watchBody(callback: () => void, attributes: boolean | readonly string[] = false): () => void {
  const subscriber = { callback, attributes };
  subscribers.add(subscriber);
  if (!observer) {
    observer = new MutationObserver((records) => {
      const childList = records.some((record) => record.type === 'childList');
      const changedAttributes = new Set(records
        .filter((record) => record.type === 'attributes')
        .map((record) => record.attributeName));
      for (const subscriber of subscribers) {
        // true の購読は従来の属性に限り、href は名前を指定した購読者だけに通知する。
        const attributes = subscriber.attributes === true ? DEFAULT_ATTRIBUTES : subscriber.attributes;
        if (!childList && (!attributes || !attributes.some((name) => changedAttributes.has(name)))) continue;
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
      attributeFilter: ['src', 'poster', 'href'],
    });
  }
  return () => {
    if (!subscribers.delete(subscriber)) return;
    if (!subscribers.size) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}
