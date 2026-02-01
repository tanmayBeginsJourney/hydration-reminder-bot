// index.ts
// Agent Logic: Cloudflare Worker entry point.
// Handles both fetch (webhook) and scheduled (cron) events.
// This is the main orchestration layer that routes to appropriate handlers.

import type { Env, TelegramUpdate } from './types';
import { sendMessage, parseTelegramPayload, extractMessageData, escapeHtmlForTelegram } from './lib/telegram';
import {
  getOrCreateUser,
  insertWaterLog,
  getTodayTotal,
  getYesterdayTotal,
  getTodayLogs,
  getCanonicalUser,
  updateBottleSize,
  resetOnboarding,
  deleteAllWaterLogs,
  deleteLastLogs,
} from './lib/db';
import { 
  parseWaterInput, 
  containsExcludedBeverage,
  parseBottleSizeResponse,
} from './lib/parser';
import { nowIST, nowISTString } from './lib/time';
import {
  successReply,
  coffeeReply,
  reminderReply,
  summaryReply,
  welcomeReply,
  bottleConfirmedReply,
  clarificationReply,
  chitchatReply,
  errorReply,
  noActionReply,
  undoReply,
  undoNothingReply,
  queryReply,
  editReply,
  loveReminderFallback,
} from './lib/personality';
import { generateLoveMessage } from './lib/llm';

export default {
  /**
   * Fetch handler: Processes incoming Telegram webhook requests.
   * 
   * INVARIANT: Must ALWAYS return 200 OK to Telegram to prevent retry storms.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Optional webhook secret: reject requests that don't match (prevents spoofed webhooks)
    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const headerToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (headerToken !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    // Verify bot token exists
    if (!env.TELEGRAM_BOT_TOKEN) {
      console.error('TELEGRAM_BOT_TOKEN not configured');
      return new Response('OK', { status: 200 });
    }

    try {
      // Parse request body
      const body = await request.json();
      const update = parseTelegramPayload(body);
      
      if (!update) {
        console.warn('Invalid Telegram payload');
        return new Response('OK', { status: 200 });
      }

      // Process the update in the background to return quickly
      ctx.waitUntil(handleTelegramUpdate(update, env));
      
      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('Fetch handler error:', error);
      return new Response('OK', { status: 200 });
    }
  },

  /**
   * Scheduled handler: Processes cron triggers.
   * Routes based on the cron expression that fired.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cronString = event.cron;
    
    console.log(`Cron triggered: ${cronString}`);

    // Route based on cron expression (exact string match)
    if (cronString === '30 18 * * *') {
      // Midnight IST -> Daily Summary
      ctx.waitUntil(handleDailySummary(env));
    } else if (cronString === '0 * * * *') {
      // Every 1 hour -> Love message (always) + Hydration reminder (skipped 12 AM–8 AM IST in handler)
      ctx.waitUntil(Promise.all([handleLoveReminder(env), handlePeriodicReminder(env)]));
    } else {
      console.warn(`Unknown cron expression: ${cronString}`);
    }
  },
};

/**
 * Main handler for Telegram updates (messages).
 */
async function handleTelegramUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const messageData = extractMessageData(update);
  
  if (!messageData) {
    // No text message, ignore
    return;
  }

  const { chatId, text, firstName } = messageData;

  try {
    // Get or create user - this gives us onboarding state
    const user = await getOrCreateUser(env.DB, chatId);
    
    // Handle /start command - full profile reset
    if (text === '/start') {
      // Delete all water logs (fresh start)
      await deleteAllWaterLogs(env.DB, chatId);
      // Reset onboarding state so user goes through bottle size confirmation again
      await resetOnboarding(env.DB, chatId);
      await sendMessage(chatId, welcomeReply(), env.TELEGRAM_BOT_TOKEN);
      return;
    }

    // CRITICAL GUARD: If onboarding not complete, ONLY accept bottle size responses
    // This prevents "4L" from being logged as water intake during onboarding
    // Use falsy check to handle null/undefined from SQLite
    if (!user.onboarding_complete) {
      await handleOnboardingResponse(chatId, text, env);
      return;
    }

    // INVARIANT: Check for excluded beverages BEFORE any other processing
    if (containsExcludedBeverage(text)) {
      await sendMessage(chatId, coffeeReply(), env.TELEGRAM_BOT_TOKEN);
      return;
    }

    // Handle regular water intake message (only if onboarding is complete)
    await handleWaterIntake(chatId, text, env);
  } catch (error) {
    console.error('handleTelegramUpdate error:', error);
    // Graceful degradation: send friendly error message
    await sendMessage(chatId, errorReply(), env.TELEGRAM_BOT_TOKEN);
  }
}

/**
 * Handles responses during onboarding (bottle size confirmation).
 * INVARIANT: This function NEVER logs water intake.
 */
async function handleOnboardingResponse(
  chatId: string, 
  text: string, 
  env: Env
): Promise<void> {
  // Try to parse as bottle size response
  const bottleSize = parseBottleSizeResponse(text);
  
  if (bottleSize !== null) {
    // Valid bottle size - update and complete onboarding
    await updateBottleSize(env.DB, chatId, bottleSize);
    await sendMessage(chatId, bottleConfirmedReply(bottleSize), env.TELEGRAM_BOT_TOKEN);
    return;
  }

  // Not a valid bottle size response - ask for clarification
  // DO NOT fall through to water intake parsing
  await sendMessage(
    chatId, 
    "Just tell me your bottle size first!!! 💧💕\n\nYou can say:\n• \"yes\" (to confirm 750ml)\n• \"1 liter\" or \"500ml\" ✨💖", 
    env.TELEGRAM_BOT_TOKEN
  );
}

/**
 * Handles water intake messages (the main flow).
 * Branches on intent: log, clarify, no_action, chitchat, edit, query, undo.
 */
async function handleWaterIntake(chatId: string, text: string, env: Env): Promise<void> {
  const prefs = await getOrCreateUser(env.DB, chatId);
  const parseResult = await parseWaterInput(text, prefs, env);

  if (!parseResult.success) {
    const prompt = parseResult.clarification_prompt ||
      "I didn't quite catch that—how much water was it? 💧";
    const safePrompt = parseResult.clarification_prompt ? escapeHtmlForTelegram(prompt) : prompt;
    await sendMessage(chatId, clarificationReply(safePrompt), env.TELEGRAM_BOT_TOKEN);
    return;
  }

  const intent = parseResult.intent ?? 'log';

  if (intent === 'no_action') {
    await sendMessage(chatId, noActionReply(), env.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (intent === 'chitchat') {
    const reply = parseResult.chitchat_reply || chitchatReply();
    const safeReply = parseResult.chitchat_reply ? escapeHtmlForTelegram(reply) : reply;
    await sendMessage(chatId, safeReply, env.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (intent === 'query') {
    const todayTotal = await getTodayTotal(env.DB, chatId);
    const logs = await getTodayLogs(env.DB, chatId);
    await sendMessage(
      chatId,
      queryReply(todayTotal, prefs.target_ml, logs),
      env.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  if (intent === 'undo') {
    const count = parseResult.undo_count ?? 1;
    try {
      const deleted = await deleteLastLogs(env.DB, chatId, count);
      const reply = deleted === 0 ? undoNothingReply() : undoReply(deleted);
      await sendMessage(chatId, reply, env.TELEGRAM_BOT_TOKEN);
    } catch (error) {
      console.error('Failed to undo log(s):', error);
      await sendMessage(chatId, errorReply(), env.TELEGRAM_BOT_TOKEN);
    }
    return;
  }

  if (intent === 'edit') {
    const adjust = parseResult.adjust_by_ml!;
    try {
      await insertWaterLog(env.DB, {
        chat_id: chatId,
        amount_ml: -adjust,
        log_time: nowISTString(),
        input_raw: `reduce by ${adjust}ml`,
      });
      const newTotal = await getTodayTotal(env.DB, chatId);
      await sendMessage(chatId, editReply(adjust, Math.max(0, newTotal)), env.TELEGRAM_BOT_TOKEN);
    } catch (error) {
      console.error('Failed to apply edit:', error);
      await sendMessage(chatId, errorReply(), env.TELEGRAM_BOT_TOKEN);
    }
    return;
  }

  // intent === 'log': insert log and send success
  try {
    await insertWaterLog(env.DB, {
      chat_id: chatId,
      amount_ml: parseResult.amount_ml!,
      log_time: parseResult.log_time!,
      input_raw: text,
    });

    const todayTotal = await getTodayTotal(env.DB, chatId);
    const percentage = Math.round((todayTotal / prefs.target_ml) * 100);

    let reply = successReply(parseResult.amount_ml!);
    if (percentage >= 100) {
      reply += `\n\n🎉 You've hit your ${prefs.target_ml}ml goal for today!`;
    } else if (percentage >= 75) {
      reply += `\n\nYou're at ${percentage}% of your daily goal! Almost there!`;
    }

    await sendMessage(chatId, reply, env.TELEGRAM_BOT_TOKEN);
  } catch (error) {
    console.error('Failed to log water intake:', error);
    await sendMessage(chatId, errorReply(), env.TELEGRAM_BOT_TOKEN);
  }
}

/**
 * Handles daily summary cron (runs at midnight IST / 18:30 UTC).
 */
async function handleDailySummary(env: Env): Promise<void> {
  // Get the canonical (most recent) user
  const user = await getCanonicalUser(env.DB);
  
  if (!user) {
    console.log('No user found for daily summary');
    return;
  }

  try {
    // Get yesterday's total (the day that just ended)
    const yesterdayTotal = await getYesterdayTotal(env.DB, user.chat_id);
    
    // Compose and send summary
    const summary = summaryReply(yesterdayTotal, user.target_ml);
    await sendMessage(user.chat_id, summary, env.TELEGRAM_BOT_TOKEN);
    
    console.log(`Daily summary sent to ${user.chat_id}: ${yesterdayTotal}ml / ${user.target_ml}ml`);
  } catch (error) {
    console.error('Daily summary error:', error);
  }
}

/**
 * Handles hourly love reminder cron. LLM-generated cutesy message, love joke, meme, or emoji spam. NOT about hydration.
 */
async function handleLoveReminder(env: Env): Promise<void> {
  const user = await getCanonicalUser(env.DB);
  if (!user) return;

  try {
    const message = await generateLoveMessage(env) ?? loveReminderFallback();
    await sendMessage(user.chat_id, message, env.TELEGRAM_BOT_TOKEN);
    console.log(`Love reminder sent to ${user.chat_id}`);
  } catch (error) {
    console.error('Love reminder error:', error);
  }
}

/**
 * Handles periodic hydration reminder cron (every hour; disabled 12 AM–8 AM IST).
 */
async function handlePeriodicReminder(env: Env): Promise<void> {
  const user = await getCanonicalUser(env.DB);
  if (!user) return;

  const istNow = nowIST();
  const hourOfDay = istNow.getUTCHours();

  // Disabled between 12 AM and 8 AM IST
  if (hourOfDay >= 0 && hourOfDay < 8) {
    console.log(`Skipping hydration reminder (${hourOfDay}:00 IST, 12 AM–8 AM window)`);
    return;
  }

  try {
    const todayTotal = await getTodayTotal(env.DB, user.chat_id);
    
    // Compose and send reminder
    const reminder = reminderReply(todayTotal, user.target_ml, hourOfDay);
    await sendMessage(user.chat_id, reminder, env.TELEGRAM_BOT_TOKEN);
    console.log(`Hydration reminder sent to ${user.chat_id}: ${todayTotal}ml / ${user.target_ml}ml`);
  } catch (error) {
    console.error('Periodic reminder error:', error);
  }
}
