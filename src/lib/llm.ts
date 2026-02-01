// lib/llm.ts
// Agent Logic: OpenAI-compatible LLM abstraction for fallback parsing.
// This module is ONLY called when regex parsing fails.

import type { Env, LLMExtractionResult, WaterIntent } from '../types';

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const LLM_REQUEST_TIMEOUT_MS = 15000;
const MAX_USER_MESSAGE_LENGTH = 500;

/**
 * System prompt for water intake extraction and intent classification.
 * Instructs the LLM to return structured JSON with intent and optional fields.
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a water intake parser for a single-user hydration bot. The bot has a cutesy, daisy, lovely personality — like a caring boyfriend. Classify intent and extract data.

Tone for any text you generate (clarification_needed, chitchat replies): OVERLY cringey, obsessively lovey-dovey. Use EXCESSIVE heart and sparkle emojis (💕❤️💖✨🥺💗💓). Add loving "boyfriend" lines constantly (e.g. "You're doing great!!! Love you!!! 💕💕💕", "So proud of you my love!!! ✨💖"). Be embarrassingly affectionate. Keep replies short but PACKED with hearts and sparkles.

Return ONLY valid JSON in this exact format:
{
  "intent": "<log|clarify|no_action|edit|query|undo|chitchat>",
  "amount_ml": <number or null if unclear>,
  "relative_time": <string like "2 hours ago" or null if drinking now>,
  "ambiguous": <true if you cannot determine the exact amount>,
  "clarification_needed": <string: cutesy friendly question if ambiguous, or warm loving short reply for chitchat, or null>,
  "adjust_by_ml": <number only for intent "edit", else null>,
  "undo_count": <number only for intent "undo", default 1, else null>
}

Intent rules:
- log: User is reporting water intake (e.g. "500ml", "drank 2 glasses", "500ml 2 hours ago"). Extract amount_ml and optional relative_time. ONLY for water drunk TODAY or "X hours ago" (same day). NEVER log if user said "yesterday".
- clarify: Vague amount ("some water", "I had water earlier", "a small glass") — set ambiguous: true and a short, cutesy clarification_needed question with emojis. Do NOT guess amount. If user says "yesterday" or "last night" for when they drank, use intent clarify and say you can only log today's water (with a loving tone).
- no_action: Negation — user says they did NOT drink (e.g. "I didn't drink 500ml", "I did not drink water"). Set intent no_action, amount_ml null. Do not log.
- edit: User wants to reduce today's total (e.g. "reduce by 500ml", "remove 500ml", "subtract 500ml"). Set intent edit and adjust_by_ml (positive number to subtract).
- query: User asks for today's total or logs (e.g. "show me today's logs", "how much did I drink today?"). Set intent query. No log.
- undo: User wants to remove last log(s) (e.g. "that was a mistake", "undo last", "undo"). Set intent undo and undo_count (1 if not specified).
- chitchat: User is greeting, thanking, or making small talk (e.g. "hi", "hello", "hey", "thanks", "how are you", "what's up"). Set intent chitchat and clarification_needed to a short, cutesy, loving one-sentence reply with emojis (e.g. "Hey you! 💕 How can I help you with your water today?").

Amount rules:
- Convert liters to ml (1L = 1000ml). "a glass" = 250ml, "a cup" = 200ml.
- "a bottle" = null (user has custom bottle size).
- If time is mentioned (e.g. "2 hours ago"), extract relative_time. NEVER accept "yesterday" or "last night" — always return intent clarify with a cutesy message that you can only log today's water (up to 12 hours ago).
- Negation: "I did not drink X" / "I didn't drink X" → intent no_action, no log.
- Keep all clarification and chitchat replies short, friendly, and cutesy with emojis.`;

/**
 * Extracts water intake information using LLM.
 * Returns structured result for further processing.
 * 
 * INVARIANT: This function MUST NOT throw. On failure, returns ambiguous result.
 */
export async function extractWaterIntent(
  text: string,
  env: Env
): Promise<LLMExtractionResult> {
  // Check if LLM is configured
  if (!env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not configured, returning ambiguous result');
    return {
      intent: 'clarify',
      amount_ml: null,
      relative_time: null,
      ambiguous: true,
      clarification_needed: "I didn't quite catch that—how much water was it? (Set OPENAI_API_KEY for natural language.)",
    };
  }

  const baseUrl = env.OPENAI_BASE_URL || DEFAULT_OPENAI_URL;
  const model = env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const userContent = text.length > MAX_USER_MESSAGE_LENGTH
    ? text.slice(0, MAX_USER_MESSAGE_LENGTH)
    : text;

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1, // Low temperature for deterministic extraction
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`LLM API error: ${response.status} ${response.statusText}`);
      return createFallbackResult();
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('LLM returned empty content');
      return createFallbackResult();
    }

    // Parse JSON response
    const parsed = parseJSONSafely(content);
    if (!parsed) {
      console.error('Failed to parse LLM JSON response:', content);
      return createFallbackResult();
    }

    const validIntents: WaterIntent[] = ['log', 'clarify', 'no_action', 'edit', 'query', 'undo', 'chitchat'];
    const intent = validIntents.includes(parsed.intent as WaterIntent)
      ? (parsed.intent as WaterIntent)
      : (parsed.ambiguous ? 'clarify' : 'log');

    return {
      intent,
      amount_ml: typeof parsed.amount_ml === 'number' ? parsed.amount_ml : null,
      relative_time: typeof parsed.relative_time === 'string' ? parsed.relative_time : null,
      ambiguous: Boolean(parsed.ambiguous),
      clarification_needed: typeof parsed.clarification_needed === 'string'
        ? parsed.clarification_needed
        : undefined,
      adjust_by_ml: typeof parsed.adjust_by_ml === 'number' ? parsed.adjust_by_ml : null,
      undo_count: typeof parsed.undo_count === 'number' ? parsed.undo_count : null,
    };
  } catch (error) {
    console.error('LLM extraction failed:', error);
    return createFallbackResult();
  }
}

/**
 * Creates a fallback result when LLM fails.
 */
function createFallbackResult(): LLMExtractionResult {
  return {
    intent: 'clarify',
    amount_ml: null,
    relative_time: null,
    ambiguous: true,
    clarification_needed: "I didn't quite catch that—how much water was it? 💧",
  };
}

/**
 * Safely parses JSON, handling common LLM formatting issues.
 */
function parseJSONSafely(content: string): Record<string, unknown> | null {
  try {
    // Try direct parse first
    return JSON.parse(content);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        return null;
      }
    }
    
    // Try to find JSON object in the response
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    
    return null;
  }
}

/**
 * System prompt for hourly love reminder. NOT about hydration.
 * Generates cutesy love message, love joke, cringe meme, or emoji spam.
 */
const LOVE_REMINDER_SYSTEM_PROMPT = `You are an obsessively lovey-dovey boyfriend sending a random message to your girlfriend. This is NOT about water or hydration.

Send ONE short message only (1-3 sentences max). Pick ONE of these styles at random:
- A cutesy love message (how much you love her, thinking of her)
- A cheesy love joke or pun
- A cringe meme / "that's the tweet" style line
- Pure emoji spam: hearts and sparkles (💕❤️💖✨🥺💗💓) — can be mostly or all emojis

Be OVER THE TOP cringey and affectionate. Use LOTS of heart and sparkle emojis. No quotes or labels — reply with ONLY the message.`;

/**
 * Generates a short cutesy love message (not about hydration) for the hourly cron.
 * Returns null if LLM is not configured or the request fails.
 */
export async function generateLoveMessage(env: Env): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;

  const baseUrl = env.OPENAI_BASE_URL || DEFAULT_OPENAI_URL;
  const model = env.OPENAI_MODEL ?? DEFAULT_MODEL;

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: LOVE_REMINDER_SYSTEM_PROMPT },
          { role: 'user', content: 'Generate one random love message / joke / meme / or emoji spam for her right now.' },
        ],
        temperature: 0.9,
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch {
    return null;
  }
}
