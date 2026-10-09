import { useEffect, useState } from 'preact/hooks';
import { useCacheView } from './cacheView';

/**
 * 画像 1 枚の表示。キャッシュがあればキャッシュ (Blob から作った object URL。使い終わったら解放) を使い、
 * 無いときだけ X の URL を読む。キャッシュがオフなら、いつもどおり URL をそのまま読む。
 * name: キャッシュ上の名前 ('1', '2', … / 'video-thumb')。cacheable: false のときは (ビューアが別の URL を試すとき) キャッシュを見ない
 */
export interface MediaImgProps {
  tweetId: string;
  name: string;
  src: string;
  cacheable?: boolean;
  alt?: string;
  loading?: 'lazy' | 'eager';
  onError?: () => void;
}

export function MediaImg(props: MediaImgProps) {
  const view = useCacheView();
  const useCache = view.enabled && !!view.store && props.cacheable !== false;
  const [cached, setCached] = useState<{ key: string; url: string | null } | null>(null);
  const key = `${props.tweetId}/${props.name}/${view.version}/${props.src}`;
  useEffect(() => {
    if (!useCache || !view.store) return;
    let alive = true;
    let obj: string | null = null;
    view.store
      .get(props.tweetId, props.name)
      .then((blob) => {
        if (!alive) return;
        obj = blob ? URL.createObjectURL(blob) : null;
        setCached({ key, url: obj });
      })
      .catch(() => alive && setCached({ key, url: null })); // 読めなければ X の URL へ
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [useCache, view.store, key]);

  // 設定を読み終えるまで / キャッシュを確かめ終えるまでは、X の URL を読みに行かない
  const waiting = !view.ready || (useCache && cached?.key !== key);
  if (waiting) return <img alt={props.alt ?? ''} decoding="async" style="visibility:hidden" />;
  const url = useCache && cached?.key === key && cached.url ? cached.url : props.src;
  return <img src={url} alt={props.alt ?? ''} decoding="async" loading={props.loading} onError={props.onError} />;
}
