import type { DayPollingPlace, EarlyPollingPlace } from './types'

/**
 * 当日投票所の仮データ。
 * 実際は住所から指定投票所を判定するが、ここではデモ用の固定データを返す。
 */
export const dayPollingPlaces: DayPollingPlace[] = [
  {
    id: 'd1',
    area: '松山市中央',
    name: '松山市立〇〇小学校 体育館',
    address: '愛媛県松山市〇〇町1-2-3',
    hours: '7:00〜20:00',
  },
  {
    id: 'd2',
    area: '松山市北部',
    name: '△△公民館',
    address: '愛媛県松山市△△2-4-6',
    hours: '7:00〜19:00',
  },
]

/**
 * 期日前投票所の仮データ（現在地からの距離付き）。
 * UIでは距離の近い順に並べて表示する。
 */
export const earlyPollingPlaces: EarlyPollingPlace[] = [
  {
    id: 'e1',
    name: '松山市役所 本館',
    address: '愛媛県松山市二番町4-7-2',
    distanceKm: 1.2,
    period: '10/11〜10/26',
    hours: '8:30〜20:00',
  },
  {
    id: 'e2',
    name: '松山市総合コミュニティセンター',
    address: '愛媛県松山市湊町7-5',
    distanceKm: 2.8,
    period: '10/11〜10/26',
    hours: '9:00〜18:00',
  },
  {
    id: 'e3',
    name: '県庁 別館',
    address: '愛媛県松山市一番町4-4-2',
    distanceKm: 3.4,
    period: '10/11〜10/26',
    hours: '9:00〜19:00',
  },
]
