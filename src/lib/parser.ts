// lib/parser.ts
// Agent Logic: Two-stage parsing for water intake messages.
// Stage 1: Deterministic regex/heuristic parsing (ALWAYS attempted first)
// Stage 2: LLM fallback (ONLY if Stage 1 fails)

import type { Env, ParseResult, UserPreferences } from '../types';
import { nowISTString, validateRetroactiveTime, parseRelativeOffset } from './time';
import { extractWaterIntent } from './llm';

/**
 * Excluded beverage keywords. These MUST trigger rejection, NEVER a log.
 * INVARIANT: Check happens BEFORE any parsing attempt.
 */
const EXCLUDED_KEYWORDS = [
  'coffee',
  'tea',
  'latte',
  'cappuccino',
  'espresso',
  'soda',
  'coke',
  'cola',
  'juice',
  'beer',
  'wine',
  'alcohol',
];

/**
 * Checks if text contains excluded beverage keywords.
 * Case-insensitive word boundary check.
 */
export function containsExcludedBeverage(text: string): boolean {
  const lower = text.toLowerCase();
  return EXCLUDED_KEYWORDS.some(keyword => {
    // Word boundary check to avoid false positives
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    return regex.test(lower);
  });
}

/**
 * Stage 1: Deterministic regex parsing.
 * Attempts to extract amount_ml from common patterns.
 * 
 * INVARIANT: If this succeeds, LLM MUST NOT be called.
 */
export function parseWaterInputRegex(
  text: string,
  prefs: UserPreferences
): ParseResult {
  const lower = text.toLowerCase();
  
  // Pattern 1: Absolute volume in ml (e.g., "500ml", "500 ml")
  const mlMatch = lower.match(/(\d+)\s*ml\b/i);
  if (mlMatch) {
    const amount = parseInt(mlMatch[1], 10);
    if (amount > 0 && amount <= 10000) { // Sanity check
      return {
        success: true,
        amount_ml: amount,
        log_time: nowISTString(),
      };
    }
  }
  
  // Pattern 2: Volume in liters (e.g., "1L", "1.5l", "1 liter", "2 liters")
  const literMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:l|liter|liters|litre|litres)\b/i);
  if (literMatch) {
    const amount = Math.round(parseFloat(literMatch[1]) * 1000);
    if (amount > 0 && amount <= 10000) {
      return {
        success: true,
        amount_ml: amount,
        log_time: nowISTString(),
      };
    }
  }
  
  // Pattern 3: "half bottle", "half a bottle", "1/2 bottle"
  const halfBottleMatch = lower.match(/(?:half|1\/2)\s*(?:a\s*)?bottle/i);
  if (halfBottleMatch) {
    return {
      success: true,
      amount_ml: Math.round(prefs.bottle_size_ml * 0.5),
      log_time: nowISTString(),
    };
  }
  
  // Pattern 4: "quarter bottle", "1/4 bottle"
  const quarterBottleMatch = lower.match(/(?:quarter|1\/4)\s*(?:a\s*)?bottle/i);
  if (quarterBottleMatch) {
    return {
      success: true,
      amount_ml: Math.round(prefs.bottle_size_ml * 0.25),
      log_time: nowISTString(),
    };
  }
  
  // Pattern 5: "X bottles" (e.g., "2 bottles", "one bottle")
  const numericBottleMatch = lower.match(/(\d+)\s*bottles?\b/i);
  if (numericBottleMatch) {
    const count = parseInt(numericBottleMatch[1], 10);
    if (count > 0 && count <= 10) {
      return {
        success: true,
        amount_ml: prefs.bottle_size_ml * count,
        log_time: nowISTString(),
      };
    }
  }
  
  // Pattern 6: "one bottle", "a bottle", "bottle"
  const singleBottleMatch = lower.match(/(?:one|a|1)?\s*bottle\b/i);
  if (singleBottleMatch && !lower.includes('half') && !lower.includes('quarter')) {
    return {
      success: true,
      amount_ml: prefs.bottle_size_ml,
      log_time: nowISTString(),
    };
  }
  
  // Pattern 7: "a glass", "one glass", "X glasses"
  const glassMatch = lower.match(/(\d+)?\s*(?:a\s*)?glass(?:es)?\b/i);
  if (glassMatch) {
    const count = glassMatch[1] ? parseInt(glassMatch[1], 10) : 1;
    if (count > 0 && count <= 20) {
      return {
        success: true,
        amount_ml: 250 * count, // Standard glass = 250ml
        log_time: nowISTString(),
      };
    }
  }
  
  // Pattern 8: "a cup", "one cup", "X cups"
  const cupMatch = lower.match(/(\d+)?\s*(?:a\s*)?cups?\b/i);
  if (cupMatch) {
    const count = cupMatch[1] ? parseInt(cupMatch[1], 10) : 1;
    if (count > 0 && count <= 20) {
      return {
        success: true,
        amount_ml: 200 * count, // Standard cup = 200ml
        log_time: nowISTString(),
      };
    }
  }
  
  // No regex match found
  return { success: false };
}

/**
 * Stage 2: LLM fallback parsing.
 * Called when regex fails or when amount + time phrase present (retroactive).
 * Handles: log, clarify, no_action, edit, query, undo.
 */
/** User said "yesterday" / "last night" — we never log that as today. */
const YESTERDAY_REGEX = /\b(yesterday|last night)\b/i;

export async function parseWaterInputLLM(
  text: string,
  env: Env
): Promise<ParseResult> {
  const llmResult = await extractWaterIntent(text, env);

  // INVARIANT: If user said "yesterday" or "last night", never log as today — always clarify
  if (YESTERDAY_REGEX.test(text) && (llmResult.intent === 'log' || llmResult.amount_ml != null)) {
    return {
      success: false,
      needs_clarification: true,
      clarification_prompt: "I can only log water from today (up to 12 hours ago). I can't add yesterday's water to today's total 💕",
    };
  }

  // Non-log intents: return immediately with intent for index to handle
  if (llmResult.intent === 'no_action') {
    return { success: true, intent: 'no_action' };
  }
  if (llmResult.intent === 'chitchat') {
    return {
      success: true,
      intent: 'chitchat',
      chitchat_reply: llmResult.clarification_needed || undefined,
    };
  }
  if (llmResult.intent === 'query') {
    return { success: true, intent: 'query' };
  }
  if (llmResult.intent === 'undo') {
    const undo_count = llmResult.undo_count != null && llmResult.undo_count >= 1
      ? Math.min(llmResult.undo_count, 10)
      : 1;
    return { success: true, intent: 'undo', undo_count };
  }
  if (llmResult.intent === 'edit') {
    const adjust = llmResult.adjust_by_ml;
    if (typeof adjust !== 'number' || adjust <= 0 || adjust > 10000) {
      return {
        success: false,
        needs_clarification: true,
        clarification_prompt: "How much should I reduce by? (e.g. 500ml)",
      };
    }
    return { success: true, intent: 'edit', adjust_by_ml: adjust };
  }
  if (llmResult.intent === 'clarify' || llmResult.ambiguous || llmResult.amount_ml === null) {
    return {
      success: false,
      needs_clarification: true,
      clarification_prompt: llmResult.clarification_needed ||
        "I didn't quite catch that—how much water was it? 💧",
    };
  }

  // intent === 'log': validate amount and optional retroactive time
  if (llmResult.amount_ml <= 0 || llmResult.amount_ml > 10000) {
    return {
      success: false,
      needs_clarification: true,
      clarification_prompt: "That doesn't seem quite right. How much water was it in ml? 💧",
    };
  }

  if (llmResult.relative_time) {
    const offsetHours = parseRelativeOffset(llmResult.relative_time);
    if (offsetHours === null) {
      return {
        success: false,
        needs_clarification: true,
        clarification_prompt: "When did you drink that? I can only log water from today (up to 12 hours ago).",
      };
    }
    const validatedTime = validateRetroactiveTime(offsetHours);
    if (validatedTime === null) {
      return {
        success: false,
        needs_clarification: true,
        clarification_prompt: "I can only log water from today (up to 12 hours ago). Could you be more specific?",
      };
    }
    return {
      success: true,
      intent: 'log',
      amount_ml: llmResult.amount_ml,
      log_time: validatedTime,
    };
  }

  return {
    success: true,
    intent: 'log',
    amount_ml: llmResult.amount_ml,
    log_time: nowISTString(),
  };
}

/**
 * Main entry point for water input parsing.
 * Implements the two-stage parsing with proper routing.
 * 
 * Returns: ParseResult with either success data or clarification request.
 */
/** Time phrases that require LLM to compute retroactive log_time. */
const TIME_PHRASE_REGEX = /\b(ago|earlier|before|morning|afternoon|evening|hour|minute)\b/i;

export async function parseWaterInput(
  text: string,
  prefs: UserPreferences,
  env: Env
): Promise<ParseResult> {
  // Check for time reference first: "500ml 2 hours ago" must go to LLM so time is applied
  const hasTimeReference = TIME_PHRASE_REGEX.test(text);

  // Stage 1: Try deterministic regex parsing first
  const regexResult = parseWaterInputRegex(text, prefs);

  if (regexResult.success && !hasTimeReference) {
    // INVARIANT: Regex matched and no time phrase => do NOT call LLM
    return regexResult;
  }

  if (regexResult.success && hasTimeReference) {
    // Amount parseable by regex but time present => route to LLM for correct log_time
    return parseWaterInputLLM(text, env);
  }

  // Stage 2: Fall back to LLM (ambiguous amounts, edit/query/undo, negation, etc.)
  return parseWaterInputLLM(text, env);
}

/**
 * Checks if input looks like a bottle size response (for onboarding).
 * Returns the bottle size in ml if detected, null otherwise.
 */
export function parseBottleSizeResponse(text: string): number | null {
  const lower = text.toLowerCase().trim();
  
  // Check for affirmative responses (keep default 750ml)
  if (/^(?:yes|yeah|yep|yup|correct|ok|okay|sure|right)$/i.test(lower)) {
    return 750;
  }
  
  // Check for ml value
  const mlMatch = lower.match(/(\d+)\s*ml/i);
  if (mlMatch) {
    const size = parseInt(mlMatch[1], 10);
    if (size >= 100 && size <= 3000) {
      return size;
    }
  }
  
  // Check for liter value
  const literMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:l|liter|litre)/i);
  if (literMatch) {
    const size = Math.round(parseFloat(literMatch[1]) * 1000);
    if (size >= 100 && size <= 3000) {
      return size;
    }
  }
  
  // Check for just a number (assume ml if reasonable)
  const justNumber = lower.match(/^(\d+)$/);
  if (justNumber) {
    const size = parseInt(justNumber[1], 10);
    if (size >= 100 && size <= 3000) {
      return size;
    }
  }
  
  return null;
}
