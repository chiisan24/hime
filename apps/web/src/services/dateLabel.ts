const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** "2022-11-20" を "2022年11月20日（日）" にする。形式が違う値はそのまま返す */
export function formatJapaneseDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (match === null) {
    return isoDate;
  }
  const [, year, month, day] = match;
  const weekday = WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
  return `${year}年${Number(month)}月${Number(day)}日（${weekday}）`;
}
