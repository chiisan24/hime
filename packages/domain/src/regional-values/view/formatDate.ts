/**
 * Dates for the screens, in Japan Standard Time, by integer arithmetic only: no `Intl`,
 * no `Date`, no local time zone. A date is "YYYY年M月D日" and a time "YYYY年M月D日 HH:mm".
 */

const JST_OFFSET_MINUTES = 9 * 60;
const MINUTES_PER_DAY = 24 * 60;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isRealDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Days since 1970-01-01 of a calendar date (proleptic Gregorian). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const monthFromMarch = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days: number): readonly [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1;
  const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  const year = yearOfEra + era * 400;
  return [month <= 2 ? year + 1 : year, month, day];
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u;

function numberOf(part: string | undefined): number {
  return Number(part ?? "");
}

/** "2026-05-01" to "2026年5月1日". A date that does not exist (such as February 30) is a RangeError. */
export function formatDate(date: string): string {
  const match = DATE.exec(date);
  const year = numberOf(match?.[1]);
  const month = numberOf(match?.[2]);
  const day = numberOf(match?.[3]);
  if (match === null || !isRealDate(year, month, day)) {
    throw new RangeError("Not a real date in YYYY-MM-DD form");
  }
  return `${year}年${month}月${day}日`;
}

/**
 * An ISO 8601 instant with `Z` or an offset, to Japan Standard Time:
 * "2026-05-01T15:00:00Z" to "2026年5月2日 00:00". Seconds are cut off. An instant
 * without a time zone, or one that does not exist, is a RangeError.
 */
export function formatDateTime(instant: string): string {
  const match = INSTANT.exec(instant);
  const year = numberOf(match?.[1]);
  const month = numberOf(match?.[2]);
  const day = numberOf(match?.[3]);
  const hour = numberOf(match?.[4]);
  const minute = numberOf(match?.[5]);
  const zone = match?.[7] ?? "";
  const offsetHours = zone === "Z" ? 0 : numberOf(zone.slice(1, 3));
  const offsetMinutes = zone === "Z" ? 0 : numberOf(zone.slice(4, 6));
  if (
    match === null ||
    !isRealDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    offsetHours > 23 ||
    offsetMinutes > 59
  ) {
    throw new RangeError("Not a real ISO 8601 instant with a time zone");
  }
  const sign = zone.startsWith("-") ? -1 : 1;
  const utcMinutes = daysFromCivil(year, month, day) * MINUTES_PER_DAY + hour * 60 + minute - sign * (offsetHours * 60 + offsetMinutes);
  const jstMinutes = utcMinutes + JST_OFFSET_MINUTES;
  const jstDays = Math.floor(jstMinutes / MINUTES_PER_DAY);
  const minuteOfDay = jstMinutes - jstDays * MINUTES_PER_DAY;
  const [y, m, d] = civilFromDays(jstDays);
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  return `${y}年${m}月${d}日 ${hh}:${mm}`;
}