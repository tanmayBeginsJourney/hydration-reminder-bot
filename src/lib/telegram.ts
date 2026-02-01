// lib/telegram.ts
// Agent Logic: Telegram API interaction layer.
// Handles sending messages and parsing incoming webhook payloads.

import type { TelegramUpdate, TelegramMessage } from '../types';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Escapes text for Telegram HTML parse_mode so that &, <, > are not interpreted as HTML.
 * Use for LLM-generated or other untrusted content before sending with parse_mode: 'HTML'.
 */
export function escapeHtmlForTelegram(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sends a message to a Telegram chat.
 * Uses HTML parse_mode for formatting support.
 * 
 * INVARIANT: This function MUST NOT throw. On failure, it logs and returns false.
 */
export async function sendMessage(
  chatId: string,
  text: string,
  token: string
): Promise<boolean> {
  const url = `${TELEGRAM_API_BASE}${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      console.error(`Telegram API error: ${response.status} ${response.statusText}`);
      return false;
    }

    return true;
  } catch (error) {
    // INVARIANT: Never throw, log and return false
    console.error('Telegram sendMessage failed:', error);
    return false;
  }
}

/**
 * Parses the incoming Telegram webhook JSON body into a TelegramUpdate.
 * Returns null if parsing fails or the payload is malformed.
 */
export function parseTelegramPayload(body: unknown): TelegramUpdate | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const update = body as Record<string, unknown>;

  // Validate required fields
  if (typeof update.update_id !== 'number') {
    return null;
  }

  // Message is optional (could be other update types we don't handle)
  if (!update.message) {
    return { update_id: update.update_id };
  }

  const message = update.message as Record<string, unknown>;

  // Validate message structure
  if (
    typeof message.message_id !== 'number' ||
    !message.chat ||
    typeof (message.chat as Record<string, unknown>).id !== 'number'
  ) {
    return null;
  }

  const chat = message.chat as Record<string, unknown>;

  const telegramMessage: TelegramMessage = {
    message_id: message.message_id as number,
    chat: {
      id: chat.id as number,
      type: (chat.type as string) || 'private',
    },
    date: (message.date as number) || Math.floor(Date.now() / 1000),
    text: typeof message.text === 'string' ? message.text : undefined,
  };

  // Optional: from field
  if (message.from && typeof message.from === 'object') {
    const from = message.from as Record<string, unknown>;
    telegramMessage.from = {
      id: from.id as number,
      first_name: from.first_name as string | undefined,
    };
  }

  return {
    update_id: update.update_id as number,
    message: telegramMessage,
  };
}

/**
 * Extracts chat_id and text from a TelegramMessage.
 * Returns null if message or required fields are missing.
 */
export function extractMessageData(
  update: TelegramUpdate
): { chatId: string; text: string; firstName?: string } | null {
  if (!update.message || !update.message.text) {
    return null;
  }

  return {
    chatId: String(update.message.chat.id),
    text: update.message.text,
    firstName: update.message.from?.first_name,
  };
}
