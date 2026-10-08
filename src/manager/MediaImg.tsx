/**
 * 画像 1 枚の表示。いまは保存済みの URL をそのまま読む (キャッシュの利用は後続の変更で、ここに集約する)。
 * name: キャッシュ上の名前 ('1', '2', … / 'video-thumb')。cacheable: ビューアの大きい画像のように、保存した画像と別の URL を読むときは false
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
  return <img src={props.src} alt={props.alt ?? ''} loading={props.loading} onError={props.onError} />;
}
