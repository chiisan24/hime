import type { ElectionMockData } from "./types.js";

/*
 * 選挙関連ページのモックデータ。現在は未提供のため空にしている。
 *
 * 追加の方法:
 *   1. 提供された内容を、下の ELECTION_MOCK_DATA に項目ごとに書く（型と各項目の説明は ./types.ts）。
 *        schedule   : 選挙日程ページ（ホームの「選挙情報」にも出る）
 *        candidates : 候補者一覧と候補者詳細ページ（1件以上。ホームの候補者ごとの入口にもなる）
 *        comparison : 政策比較ページ（テーマ1件以上）
 *        venue      : 会場閲覧ページ（セクション1件以上）
 *      書く形（「…」は、すべて提供された内容に置き換える。「省略可」の項目は、提供がなければ書かない）:
 *        export const ELECTION_MOCK_DATA: ElectionMockData = {
 *          schedule: {
 *            election: { electionId: "…", name: "…", electionDate: "YYYY-MM-DD" },
 *            votingHours: "…", // 省略可
 *            earlyVoting: "…", // 省略可
 *            note: "…", // 省略可
 *          },
 *          candidates: [
 *            // party・profile・summary は省略可
 *            { candidateId: "…", name: "…", party: "…", profile: "…", summary: "…" },
 *          ],
 *          comparison: {
 *            themes: ["…"],
 *            entries: [{ candidateId: "…", theme: "…", summary: "…" }],
 *          },
 *          venue: { sections: [{ heading: "…", body: "…" }] },
 *        };
 *      - electionDate は日本標準時の日付。選挙の状態（予定・実施中・終了済み）の表示に使う。
 *      - candidateId は URL（/candidates/:candidateId）に使う。空白や記号を含まない識別子にする。
 *      - comparison.entries の candidateId と theme は、candidates と themes に書いた値と同じにする
 *        （candidates にない candidateId は、氏名の代わりに candidateId を表示する）。
 *   2. 書いた項目に対応するページだけが、モックデータ表示（「デモ用データ」の表示つき）になる。
 *      書いていない項目のページは、既存のデザインのまま「開発中」の空状態になる。
 *      ナビゲーションとホームの入口は、書いたかどうかにかかわらず表示する
 *      （ホームのカードには、書いていないページに「開発中」と出る）。
 *   3. 実在の候補者・政策の情報は、提供された内容をそのまま書く。補ったり変えたりしない。
 *
 * 過去の選挙（2022年）のデータはここに書かない。それは data/visitorDisplayData.ts にあり、
 * #past-election（vite.config.ts）からだけ読み込まれる。利用者向けの公開ビルドには含まれない。
 */
export const ELECTION_MOCK_DATA: ElectionMockData = {};
