import type { ElectionMockData } from "./types.js";

/*
 * 選挙関連ページのモックデータ。現在は未提供のため空にしている。
 *
 * 追加の方法:
 *   1. 提供された内容を、下の ELECTION_MOCK_DATA に項目ごとに書く（型は ./types.ts）。
 *        schedule   : 選挙日程ページ
 *        candidates : 候補者一覧と候補者詳細ページ（1件以上）
 *        comparison : 政策比較ページ（テーマ1件以上）
 *        venue      : 会場閲覧ページ（セクション1件以上）
 *   2. 書いた項目に対応するページだけが、モックデータ表示になる。
 *      ナビゲーションとホームの入口も、そのページの分だけ表示される。
 *      書いていない項目のページは、これまでどおり空状態のまま。
 *   3. 実在の候補者・政策の情報は、提供された内容をそのまま書く。補ったり変えたりしない。
 *
 * 過去の選挙（2022年）のデータはここに書かない。それは data/visitorDisplayData.ts にあり、
 * data/electionDataSource.ts が "PAST_REAL" のときだけ使われる。
 */
export const ELECTION_MOCK_DATA: ElectionMockData = {};
