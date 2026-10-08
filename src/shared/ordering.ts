/**
 * 自動取り込み / 手動取り込みで、PostShelf の「保存が新しい順」を x.com のブックマークの並びと一致させる (v15-B-2)。
 *
 * x.com のブックマークは「新しく追加した順」で、下へスクロールするほど古くなる。取り込んだ時刻をそのまま savedAt にすると
 * 最初に出てくる (いちばん新しい) ポストの時刻が最も古くなり、順番が逆になる。そこで savedAt は、一覧での位置から決める。
 *
 * seq: 画面に出てきた順 (上から下) のポスト。savedAt があるものは取り込み済み (基準)、無いものは新しいポスト。
 * 新しいポストが連続する区間ごとに、すぐ上の取り込み済み (U) とすぐ下の取り込み済み (L) の savedAt から値を決める。
 */
export interface SeqItem {
  id: string;
  /** 取り込み済みのときの savedAt。undefined = 新しいポスト */
  savedAt?: number;
}

export function assignOrder(seq: SeqItem[], startedAt: number): Map<string, number> {
  const out = new Map<string, number>();
  let s = 0;
  while (s < seq.length) {
    if (seq[s].savedAt !== undefined) {
      s++;
      continue;
    }
    let e = s;
    while (e < seq.length && seq[e].savedAt === undefined) e++;
    const n = e - s;
    const U = s > 0 ? seq[s - 1].savedAt : undefined;
    const L = e < seq.length ? seq[e].savedAt : undefined;
    for (let i = 0; i < n; i++) {
      let v: number;
      if (U !== undefined && L !== undefined) {
        // 並びが合わない (U ≤ L) ときは U のすぐ下に入れる。データは失わない
        v = U > L ? L + ((U - L) * (n - i)) / (n + 1) : U - (i + 1);
      } else if (U !== undefined) {
        v = U - (i + 1) * 1000;
      } else if (L !== undefined) {
        // いちばん上の区間: 開始時刻から 1 秒ずつ。L より大きくならなければ L の上に積む
        v = startedAt - (n - 1) * 1000 > L ? startedAt - i * 1000 : L + (n - i) * 1000;
      } else {
        v = startedAt - i * 1000;
      }
      out.set(seq[s + i].id, v);
    }
    s = e;
  }
  return out;
}
