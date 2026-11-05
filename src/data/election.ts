import type { Election } from './types'

/**
 * 選挙日程の仮データ（デモ）。
 * 実際の日程は共同開発者のデータ/APIに差し替える。
 */
export const currentElection: Election = {
  id: 'ehime-governor-demo',
  name: '愛媛県知事選挙（デモ）',
  votingDate: '2026-10-27',
  earlyVotingStart: '2026-10-11',
  earlyVotingEnd: '2026-10-26',
  isDemo: true,
}
