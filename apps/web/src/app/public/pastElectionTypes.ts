import type { ComponentType } from "react";

import type { CandidateSummary } from "../../data/types.js";
import type { FeatureLink, HomeTileDetail } from "./pageParts.js";

/** 過去の選挙の政策比較に渡す、比べる項目（公開の政策比較と同じ項目。pages.tsx の COMPARISON_FIELDS） */
export type PastComparisonPageProps = Readonly<{
  fields: readonly string[];
  /** 項目のうち、初めての人に説明が必要なものの説明 */
  fieldNotes: Readonly<Record<string, string | undefined>>;
}>;

/**
 * 過去の選挙（data/electionDataSource.ts の "PAST_REAL"）の表示データと画面。
 * #past-election が PAST_ELECTION として書き出す。実体は vite.config.ts がモードで選び、
 * pastElection.tsx（過去の選挙を含む）と pastElectionExcluded.ts（null）のどちらも、この型で書き出す。
 * 過去の選挙を含まないビルド（利用者向けの公開ビルド）では、PAST_ELECTION は null になる。
 */
export type PastElection = Readonly<{
  /** 対象候補者（並びは公式届出順を確認できるまでの暫定順） */
  candidates: readonly CandidateSummary[];
  /** ホームの入口（候補者ごとの詳細への入口を含む） */
  homeLinks: readonly FeatureLink[];
  /** ホームのカードに出す名前と説明（行き先の path ごと） */
  homeTileDetails: Readonly<Record<string, HomeTileDetail>>;
  /** ホームの選挙情報のカードと、政策の準備状態の表示 */
  HomeElectionSummary: ComponentType;
  SchedulePage: ComponentType;
  CandidatesPage: ComponentType;
  CandidateDetailPage: ComponentType;
  ComparisonPage: ComponentType<PastComparisonPageProps>;
  VenuePage: ComponentType;
  /** 共通の枠（shared/ui/AppShell.tsx）に出す、過去の選挙の表示 */
  shell: Readonly<{
    /** ヘッダーの帯に出す、過去の選挙であることの注意 */
    notice: string;
    /** データ種別 REAL_AI の表示名 */
    realAiDataKindLabel: string;
    /** フッターに出す対象の選挙 */
    footerTarget: string;
  }>;
}>;
