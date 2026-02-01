// types.ts
// Agent Logic: Central type definitions for the Hydration Bot.
// All interfaces are exported for use across the application.

/**
 * Cloudflare Worker environment bindings.
 * DB: D1 database binding (pre-provisioned)
 * TELEGRAM_BOT_TOKEN: Bot authentication (required)
 * TELEGRAM_WEBHOOK_SECRET: Optional. If set, webhook requests must include X-Telegram-Bot-Api-Secret-Token header matching this value.
 * OPENAI_API_KEY: LLM fallback (optional)
 * OPENAI_BASE_URL: Allows model/provider swapping (optional)
 * OPENAI_MODEL: Model ID when using alternate provider (optional)
 */
export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

/**
 * Application entity for a single water intake log.
 * Maps directly to the water_logs table.
 */
export interface WaterLog {
  id?: number;
  chat_id: string;
  amount_ml: number;
  log_time: string; // ISO8601 string in IST
  input_raw: string | null;
  created_at?: number;
}

/**
 * User preferences row from user_preferences table.
 * Single-user pattern: only one active user at a time.
 */
export interface UserPreferences {
  chat_id: string;
  target_ml: number;
  bottle_size_ml: number;
  onboarding_complete: number; // 0 = pending, 1 = complete
  timezone: string;
  created_at: number;
}

/**
 * Incoming Telegram webhook update payload.
 * We only handle message updates (not callbacks, edits, etc.)
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/**
 * Telegram message structure (minimal shape for our needs).
 */
export interface TelegramMessage {
  message_id: number;
  chat: {
    id: number; // Becomes chat_id as string
    type: string;
  };
  from?: {
    id: number;
    first_name?: string;
  };
  date: number; // Unix timestamp
  text?: string;
}

/**
 * Intent classified by parser/LLM.
 * log = add a water intake entry; clarify = ask how much; no_action = negation, do nothing;
 * edit = reduce today's total by X ml; query = show today's total/logs; undo = remove last N logs;
 * chitchat = greeting/small talk, reply warmly.
 */
export type WaterIntent = 'log' | 'clarify' | 'no_action' | 'edit' | 'query' | 'undo' | 'chitchat';

/**
 * Result from the two-stage parser (regex or LLM).
 * Used to determine next action: log, clarify, no_action, edit, query, undo, chitchat.
 */
export interface ParseResult {
  success: boolean;
  intent?: WaterIntent; // only set when LLM path; regex path implies 'log'
  amount_ml?: number;
  log_time?: string; // ISO8601, defaults to "now" if not retroactive
  needs_clarification?: boolean;
  clarification_prompt?: string;
  /** For intent 'edit': amount to subtract from today's total (ml). */
  adjust_by_ml?: number;
  /** For intent 'undo': number of last logs to remove (default 1). */
  undo_count?: number;
  /** For intent 'chitchat': warm reply to greetings/small talk (from LLM or fallback). */
  chitchat_reply?: string;
}

/**
 * LLM extraction response structure.
 * The LLM returns this JSON when parsing ambiguous or intent-rich input.
 */
export interface LLMExtractionResult {
  intent: WaterIntent;
  amount_ml: number | null;
  relative_time: string | null; // e.g., "2 hours ago", "earlier", null
  ambiguous: boolean;
  clarification_needed?: string;
  /** For intent 'edit': ml to subtract from today's total. */
  adjust_by_ml?: number | null;
  /** For intent 'undo': number of last logs to remove (default 1). */
  undo_count?: number | null;
}
