import type { Candidate } from './types'

/**
 * 候補者の仮データ（デモ）。
 * 実データは共同開発者のAPIに差し替える前提。
 * 政党は「事実情報」として表示するが、UI上は政党を連想させる色で強調しない。
 */
export const candidates: Candidate[] = [
  {
    id: 'a',
    name: '候補 一郎',
    kana: 'こうほ いちろう',
    party: '無所属',
    age: 58,
    mainThemeIds: ['childcare', 'transport', 'economy'],
    aiSummary:
      '子育て支援と地域交通の充実を軸に、働く世代が暮らしやすい県政を目指すとしています。',
    profile:
      '県内の市議会議員を3期務めたのち、県政への挑戦を表明。暮らしに身近な行政をテーマに掲げています。',
    career: ['〇〇市議会議員（3期）', '県内NPO理事', '△△大学 法学部 卒業'],
    policies: [
      {
        themeId: 'childcare',
        aiSummary: '保育の受け皿を増やし、第2子以降の保育料無償化を段階的に進めるとしています。',
        originalText:
          '待機児童の解消に向け保育施設の整備を加速し、第2子以降の保育料無償化を段階的に実施します。放課後児童クラブの受け入れ枠も拡大します。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/a/childcare',
      },
      {
        themeId: 'transport',
        aiSummary: '過疎地域の路線バス維持と、乗り合い交通の導入支援を掲げています。',
        originalText:
          '中山間地域の移動手段を守るため、路線バスの運行維持を支援し、デマンド型乗り合い交通の導入を後押しします。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/a/transport',
      },
      {
        themeId: 'economy',
        aiSummary: '地元中小企業の設備投資とデジタル化を支援するとしています。',
        originalText:
          '県内中小企業の設備投資や業務のデジタル化に対する補助を拡充し、生産性の向上を支援します。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/a/economy',
      },
    ],
  },
  {
    id: 'b',
    name: '愛媛 花子',
    kana: 'えひめ はなこ',
    party: '無所属',
    age: 50,
    mainThemeIds: ['economy', 'welfare', 'industry'],
    aiSummary:
      '地域経済の活性化と医療・福祉の充実を両立させ、安心して働ける環境づくりを掲げています。',
    profile:
      '民間企業での勤務を経て、地域経済団体の役員を歴任。産業振興と福祉の両立を訴えています。',
    career: ['地域経済団体 役員', '民間企業 管理職', '□□大学 経済学部 卒業'],
    policies: [
      {
        themeId: 'economy',
        aiSummary: '観光と一次産業を結びつけ、県産品のブランド化を進めるとしています。',
        originalText:
          '観光と農林水産業を連携させ、県産品のブランド化と販路拡大を進めます。海外への販路開拓も支援します。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/b/economy',
      },
      {
        themeId: 'welfare',
        aiSummary: '医師不足地域への支援と、在宅医療・介護の連携強化を掲げています。',
        originalText:
          '医師が不足する地域への診療支援を強化し、在宅医療と介護の連携体制を整えることで、住み慣れた地域での暮らしを支えます。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/b/welfare',
      },
      {
        themeId: 'industry',
        aiSummary: '若者の県内就職を後押しし、起業支援の充実を訴えています。',
        originalText:
          '若者の県内就職を促すインターンシップ支援や、起業家向けの相談・資金支援の窓口を充実させます。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/b/industry',
      },
    ],
  },
  {
    id: 'c',
    name: '瀬戸 太郎',
    kana: 'せと たろう',
    party: '無所属',
    age: 36,
    mainThemeIds: ['education', 'environment', 'disaster'],
    aiSummary:
      '教育環境の充実と環境・防災対策に力を入れ、次世代が安心して暮らせる地域づくりを目指すとしています。',
    profile:
      '教育関連の活動に携わり、若い世代の視点から県政への参加を呼びかけています。',
    career: ['教育関連NPO 代表', '◇◇大学大学院 修了'],
    policies: [
      {
        themeId: 'education',
        aiSummary: '学校のICT環境整備と、教員の負担軽減を進めるとしています。',
        originalText:
          '学校のICT環境を計画的に整備するとともに、事務作業のデジタル化などで教員の負担を軽減し、子どもと向き合う時間を増やします。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/c/education',
      },
      {
        themeId: 'environment',
        aiSummary: '再生可能エネルギーの導入と、瀬戸内海の環境保全を掲げています。',
        originalText:
          '地域に適した再生可能エネルギーの導入を支援し、瀬戸内海の水質保全や海洋ごみ対策に取り組みます。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/c/environment',
      },
      {
        themeId: 'disaster',
        aiSummary: '防災情報の発信強化と、避難所環境の改善を訴えています。',
        originalText:
          '災害時の情報発信を多言語・多様な手段で強化し、避難所の生活環境（プライバシーや衛生）の改善を進めます。',
        sourceLabel: '公式サイト 政策ページ',
        sourceUrl: 'https://example.com/c/disaster',
      },
    ],
  },
]

/** IDから候補者を取得 */
export function getCandidateById(id: string): Candidate | undefined {
  return candidates.find((c) => c.id === id)
}
