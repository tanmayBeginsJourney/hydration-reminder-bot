// lib/time.ts
// Agent Logic: All time calculations are anchored to IST (Asia/Kolkata, UTC+5:30).
// This module provides utilities for IST conversion and date boundary calculations.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +5:30 in milliseconds

/**
 * Returns current time as a Date object adjusted to IST.
 * Note: The Date object itself is still in UTC internally,
 * but the values represent IST time.
 */
export function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/**
 * Returns today's midnight (00:00:00) in IST as a Date.
 */
export function todayMidnightIST(): Date {
  const now = nowIST();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Returns yesterday's midnight (00:00:00) in IST as a Date.
 */
export function yesterdayMidnightIST(): Date {
  const today = todayMidnightIST();
  return new Date(today.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * Converts a Date to an ISO8601 string with IST timezone offset.
 * Format: YYYY-MM-DDTHH:mm:ss+05:30
 */
export function toISTString(date: Date): string {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const hours = String(istDate.getUTCHours()).padStart(2, '0');
  const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(istDate.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;
}

/**
 * Returns current time as an ISO8601 string in IST.
 */
export function nowISTString(): string {
  return toISTString(new Date());
}

/**
 * Returns today's midnight as an ISO8601 string in IST.
 */
export function todayMidnightISTString(): string {
  const now = nowIST();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00+05:30`;
}

/**
 * Returns yesterday's midnight as an ISO8601 string in IST.
 */
export function yesterdayMidnightISTString(): string {
  const yesterday = yesterdayMidnightIST();
  const istYesterday = new Date(yesterday.getTime() + IST_OFFSET_MS);
  const year = istYesterday.getUTCFullYear();
  const month = String(istYesterday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istYesterday.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00+05:30`;
}

/**
 * Checks if a given offset in hours is within the allowed retroactive window.
 * Constraints: <= 12 hours AND must not cross into a previous IST calendar day.
 * Returns the computed log_time as ISO string if valid, null otherwise.
 */
export function validateRetroactiveTime(offsetHours: number): string | null {
  // Constraint 1: Must be <= 12 hours
  if (offsetHours > 12 || offsetHours < 0) {
    return null;
  }

  const now = new Date();
  const targetTime = new Date(now.getTime() - offsetHours * 60 * 60 * 1000);
  
  // Constraint 2: Must be within the same IST calendar day
  const todayMidnight = todayMidnightIST();
  const todayMidnightUTC = new Date(todayMidnight.getTime() - IST_OFFSET_MS);
  
  if (targetTime < todayMidnightUTC) {
    return null; // Crosses into previous day
  }

  return toISTString(targetTime);
}

/**
 * Parses a relative time string like "2 hours ago" into hours.
 * Returns null if the format is not recognized.
 */
export function parseRelativeOffset(relativeTime: string | null): number | null {
  if (!relativeTime) return null;
  
  const lower = relativeTime.toLowerCase().trim();
  
  // Pattern: "X hours ago" or "X hour ago"
  const hoursMatch = lower.match(/(\d+)\s*hours?\s*ago/);
  if (hoursMatch) {
    return parseInt(hoursMatch[1], 10);
  }
  
  // Pattern: "X minutes ago" or "X min ago"
  const minutesMatch = lower.match(/(\d+)\s*(?:minutes?|mins?)\s*ago/);
  if (minutesMatch) {
    return parseInt(minutesMatch[1], 10) / 60;
  }
  
  // Vague terms - return null to trigger clarification
  if (lower === 'earlier' || lower === 'before' || lower === 'some time ago') {
    return null;
  }
  
  return null;
}
