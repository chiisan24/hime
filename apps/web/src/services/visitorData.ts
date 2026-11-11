import type { CandidateSummary, ElectionSummary } from "../data/types.js";
import {
  POLICY_THEMES,
  TARGET_CANDIDATES,
  TARGET_ELECTION,
  type PolicyTheme,
} from "../data/visitorDisplayData.js";

/*
 * 利用者向け画面がデータを受け取る窓口。
 * 今は data/ の固定値を返すだけ。API に接続するときは、画面ではなくこのファイルの中身を差し替える。
 * API の URL・レスポンス形式は未確定のため、ここでは決めない（共同開発者の Task 5.3 で決める）。
 */

export function getTargetElection(): ElectionSummary {
  return TARGET_ELECTION;
}

export function listCandidates(): readonly CandidateSummary[] {
  return TARGET_CANDIDATES;
}

export function findCandidate(candidateId: string | undefined): CandidateSummary | undefined {
  return TARGET_CANDIDATES.find((candidate) => candidate.candidateId === candidateId);
}

export function listPolicyThemes(): readonly PolicyTheme[] {
  return POLICY_THEMES;
}
