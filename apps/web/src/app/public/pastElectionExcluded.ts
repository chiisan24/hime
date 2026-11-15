import type { PastElection } from "./pastElectionTypes.js";

/*
 * 利用者向けのビルド・開発サーバー（npm run build / npm run dev）で #past-election として使う差し替え。
 * 過去の選挙（2022年）のデータと画面を、公開成果物に含めないためのもの（vite.config.ts）。
 * このビルドでは、data/electionDataSource.ts が "PAST_REAL" でも、モックデータの画面を表示する
 * （services/electionData.ts の getElectionDataSource）。
 * このファイルには、過去の選挙のデータを書かない。
 */
export const PAST_ELECTION: PastElection | null = null;
