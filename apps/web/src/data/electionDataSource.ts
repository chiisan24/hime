/*
 * 選挙関連ページ（選挙日程・候補者・政策比較・会場閲覧）が表示するデータの種類を決める設定。
 *
 * - "MOCK"      : モックデータ（data/mock/electionMockData.ts）。既定。
 *                 提供されていない画面は空状態になり、ナビゲーションとホームからも外れる。
 * - "PAST_REAL" : 過去の選挙（2022年）の既存データ（data/visitorDisplayData.ts）。
 *                 元の表示を復元するための退避用で、通常は使わない。
 *
 * 切り替えはこの定数の書き換えだけで行う。URL・cookie・Web Storage・API応答などの
 * 実行時の入力では切り替えられない（利用者が過去の選挙データを呼び出せないようにするため）。
 * この値を読むのは services/electionData.ts だけにする。
 */
export type ElectionDataSource = "MOCK" | "PAST_REAL";

export const ELECTION_DATA_SOURCE: ElectionDataSource = "MOCK";
