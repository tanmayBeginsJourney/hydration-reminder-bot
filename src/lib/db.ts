// lib/db.ts
// Agent Logic: D1 database query wrappers.
// All persistence operations go through this module.
// Uses raw SQL via env.DB.prepare() as required.

import type { UserPreferences, WaterLog } from '../types';
import { todayMidnightISTString, yesterdayMidnightISTString } from './time';

/**
 * Gets user preferences for a chat_id, or creates default preferences if not exists.
 * Implements the single-user pattern: if user doesn't exist, they become the canonical user.
 */
export async function getOrCreateUser(
  db: D1Database,
  chatId: string
): Promise<UserPreferences> {
  try {
    // Try to get existing user
    const existing = await db
      .prepare('SELECT * FROM user_preferences WHERE chat_id = ?')
      .bind(chatId)
      .first<UserPreferences>();

    if (existing) {
      return existing;
    }

    // Create new user with defaults (onboarding_complete = 0)
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO user_preferences (chat_id, target_ml, bottle_size_ml, onboarding_complete, timezone, created_at)
         VALUES (?, 3500, 750, 0, 'Asia/Kolkata', ?)`
      )
      .bind(chatId, now)
      .run();

    return {
      chat_id: chatId,
      target_ml: 3500,
      bottle_size_ml: 750,
      onboarding_complete: 0,
      timezone: 'Asia/Kolkata',
      created_at: now,
    };
  } catch (error) {
    console.error('getOrCreateUser failed:', error);
    throw error;
  }
}

/**
 * Updates user preferences (bottle size) and marks onboarding as complete.
 */
export async function updateBottleSize(
  db: D1Database,
  chatId: string,
  bottleSizeMl: number
): Promise<void> {
  try {
    await db
      .prepare('UPDATE user_preferences SET bottle_size_ml = ?, onboarding_complete = 1 WHERE chat_id = ?')
      .bind(bottleSizeMl, chatId)
      .run();
  } catch (error) {
    console.error('updateBottleSize failed:', error);
    throw error;
  }
}

/**
 * Resets onboarding state (used when user sends /start).
 */
export async function resetOnboarding(
  db: D1Database,
  chatId: string
): Promise<void> {
  try {
    await db
      .prepare('UPDATE user_preferences SET onboarding_complete = 0 WHERE chat_id = ?')
      .bind(chatId)
      .run();
  } catch (error) {
    console.error('resetOnboarding failed:', error);
    throw error;
  }
}

/**
 * Deletes all water logs for a user (full reset).
 */
export async function deleteAllWaterLogs(
  db: D1Database,
  chatId: string
): Promise<void> {
  try {
    await db
      .prepare('DELETE FROM water_logs WHERE chat_id = ?')
      .bind(chatId)
      .run();
  } catch (error) {
    console.error('deleteAllWaterLogs failed:', error);
    throw error;
  }
}

/**
 * Inserts a new water log entry.
 */
export async function insertWaterLog(
  db: D1Database,
  log: Omit<WaterLog, 'id' | 'created_at'>
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO water_logs (chat_id, amount_ml, log_time, input_raw)
         VALUES (?, ?, ?, ?)`
      )
      .bind(log.chat_id, log.amount_ml, log.log_time, log.input_raw)
      .run();
  } catch (error) {
    console.error('insertWaterLog failed:', error);
    throw error;
  }
}

/**
 * Gets the sum of water consumed today (IST day) for a user.
 */
export async function getTodayTotal(
  db: D1Database,
  chatId: string
): Promise<number> {
  try {
    const todayStart = todayMidnightISTString();
    
    const result = await db
      .prepare(
        `SELECT COALESCE(SUM(amount_ml), 0) as total
         FROM water_logs
         WHERE chat_id = ? AND log_time >= ?`
      )
      .bind(chatId, todayStart)
      .first<{ total: number }>();

    return result?.total ?? 0;
  } catch (error) {
    console.error('getTodayTotal failed:', error);
    return 0;
  }
}

/**
 * Gets the sum of water consumed yesterday (IST day) for a user.
 * Used for daily summary at midnight.
 */
export async function getYesterdayTotal(
  db: D1Database,
  chatId: string
): Promise<number> {
  try {
    const yesterdayStart = yesterdayMidnightISTString();
    const todayStart = todayMidnightISTString();
    
    const result = await db
      .prepare(
        `SELECT COALESCE(SUM(amount_ml), 0) as total
         FROM water_logs
         WHERE chat_id = ? AND log_time >= ? AND log_time < ?`
      )
      .bind(chatId, yesterdayStart, todayStart)
      .first<{ total: number }>();

    return result?.total ?? 0;
  } catch (error) {
    console.error('getYesterdayTotal failed:', error);
    return 0;
  }
}

/**
 * Gets all water logs for today (IST day) for a user.
 */
export async function getTodayLogs(
  db: D1Database,
  chatId: string
): Promise<WaterLog[]> {
  try {
    const todayStart = todayMidnightISTString();

    const result = await db
      .prepare(
        `SELECT * FROM water_logs
         WHERE chat_id = ? AND log_time >= ?
         ORDER BY log_time ASC`
      )
      .bind(chatId, todayStart)
      .all<WaterLog>();

    return result.results ?? [];
  } catch (error) {
    console.error('getTodayLogs failed:', error);
    return [];
  }
}

/**
 * Deletes the last N water logs for a user (by log_time desc, then id desc).
 * Returns the number of rows deleted.
 */
export async function deleteLastLogs(
  db: D1Database,
  chatId: string,
  count: number
): Promise<number> {
  if (count < 1) return 0;
  try {
    // Subquery: select ids of last N logs for this user
    const idsResult = await db
      .prepare(
        `SELECT id FROM water_logs
         WHERE chat_id = ?
         ORDER BY log_time DESC, id DESC
         LIMIT ?`
      )
      .bind(chatId, count)
      .all<{ id: number }>();

    const ids = idsResult.results?.map((r) => r.id) ?? [];
    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(
      `DELETE FROM water_logs WHERE id IN (${placeholders})`
    );
    const result = await stmt.bind(...ids).run();
    return result.meta.changes ?? 0;
  } catch (error) {
    console.error('deleteLastLogs failed:', error);
    throw error;
  }
}

/**
 * Gets the most recent/canonical user (for cron jobs).
 * Returns the user with the most recent created_at timestamp.
 */
export async function getCanonicalUser(
  db: D1Database
): Promise<UserPreferences | null> {
  try {
    const result = await db
      .prepare(
        `SELECT * FROM user_preferences
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .first<UserPreferences>();

    return result ?? null;
  } catch (error) {
    console.error('getCanonicalUser failed:', error);
    return null;
  }
}

/**
 * Checks if a user exists in the database.
 */
export async function userExists(
  db: D1Database,
  chatId: string
): Promise<boolean> {
  try {
    const result = await db
      .prepare('SELECT 1 FROM user_preferences WHERE chat_id = ?')
      .bind(chatId)
      .first();

    return result !== null;
  } catch (error) {
    console.error('userExists failed:', error);
    return false;
  }
}
