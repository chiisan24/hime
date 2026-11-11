import type { ElectionSummary } from "./types.js";

/*
 * 利用者向け画面の固定データ。
 * モックではなく、仕様書（.kiro/specs/ehime-vote-navigator/requirements.md）に記載の
 * 確認済み一次情報（愛媛県・愛媛県選挙管理委員会の公式ページ）に基づく値だけを置く。
 * 架空のデータはここに置かない（架空 fixture は packages/fixtures 側で扱う）。
 */

export const TARGET_ELECTION: ElectionSummary = {
  electionId: "ehime-governor-2022-20",
  name: "令和4年（2022年）第20回愛媛県知事選挙",
  electionDate: "2022-11-20",
};

/**
 * 対象候補者。並びは公式届出順を確認できるまでの暫定順（Req 12.10）。
 * 候補者IDは packages/contracts と共同開発者の選挙レジストリの値と同じにする。
 */
export const TARGET_CANDIDATES = [
  {
    candidateId: "nakamura-tokihiro",
    name: "中村時広氏",
  },
  {
    candidateId: "hayashi-noriko",
    name: "林紀子氏",
  },
] as const;

/** 政策比較の共通テーマ（Req 13.1 の7件、この順番） */
export const POLICY_THEMES = [
  "子育て",
  "教育",
  "経済",
  "福祉",
  "防災",
  "地域振興",
  "交通",
] as const;

export type PolicyTheme = (typeof POLICY_THEMES)[number];
