/**
 * Timezone configuration.
 *
 * Set the TIMEZONE environment variable in your .env file to match
 * where the campus is located. Defaults to Asia/Kolkata (IST) if not set.
 *
 * Examples:
 *   TIMEZONE=Asia/Kolkata
 *   TIMEZONE=Asia/Dubai
 *   TIMEZONE=America/New_York
 *
 * Full list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
 */
export const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

/**
 * Returns today's date as a YYYY-MM-DD string in the configured timezone.
 * Use this everywhere a "current date" is needed — never use toISOString() directly,
 * as that returns UTC and will roll over at the wrong time for most campuses.
 */
export function getLocalDate(timezone = TIMEZONE): string {
  return new Date().toLocaleDateString('sv', { timeZone: timezone });
}
