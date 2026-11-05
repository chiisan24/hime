/*
 * アプリ全体のデータ型定義。
 * ここで定義する型が「UI と バックエンド/データ処理の境界」になる。
 * 実データは共同開発者の API に差し替える前提で、UI は型にのみ依存する。
 */

/** 政策テーマ（子育て・教育・経済・防災 など） */
export interface PolicyTheme {
  id: string
  label: string
}

/** 候補者の個別政策 */
export interface CandidatePolicy {
  themeId: string
  /** AIによる要約（1〜2文） */
  aiSummary: string
  /** 政策の原文・公約の抜粋 */
  originalText: string
  /** 出典URL（公式サイト等） */
  sourceUrl?: string
  sourceLabel?: string
}

/** 候補者 */
export interface Candidate {
  id: string
  name: string
  /** ふりがな */
  kana?: string
  /** 所属政党（無所属含む） */
  party: string
  age: number
  /** 顔写真URL（未設定時はプレースホルダ表示） */
  photoUrl?: string
  /** 主な政策テーマ（最大3つ想定） */
  mainThemeIds: string[]
  /** カード用のAI政策要約（1〜2文） */
  aiSummary: string
  profile?: string
  career?: string[]
  policies: CandidatePolicy[]
}

/** 選挙情報 */
export interface Election {
  id: string
  name: string
  /** 投票日（ISO文字列） */
  votingDate: string
  /** 期日前投票 開始日 */
  earlyVotingStart: string
  /** 期日前投票 終了日 */
  earlyVotingEnd: string
  /** デモ/サンプル表記フラグ */
  isDemo?: boolean
}

/** 当日投票所 */
export interface DayPollingPlace {
  id: string
  /** 対象となる地区名 */
  area: string
  name: string
  address: string
  /** 投票時間（例: 7:00〜20:00） */
  hours: string
}

/** 期日前投票所 */
export interface EarlyPollingPlace {
  id: string
  name: string
  address: string
  /** 現在地からの距離(km)。UIでは「約◯km」と表示 */
  distanceKm: number
  /** 開設期間（例: 10/11〜10/26） */
  period: string
  /** 受付時間（例: 8:30〜20:00） */
  hours: string
}

/** AIチャットのメッセージ */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: { label: string; url: string }[]
}
