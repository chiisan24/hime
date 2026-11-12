import type { BuildKind } from "@ehime-vote-navigator/contracts";

/** Fixed failure texts for when there is no verified bundle from which to read content. */
export const LOAD_FAILURE_TEXTS: Readonly<Record<BuildKind, string>> = {
  DEMO: "データの読み込みに失敗しました。",
  PUBLIC: "準備中",
};