# Water Reminder (waterReminer)

A **single-user Telegram bot** that helps track daily water intake. It runs as a **Cloudflare Worker** with **D1** for storage and an optional **OpenAI-compatible LLM** (e.g. Groq) for natural-language parsing. The bot uses a very affectionate, lovey-dovey tone and sends hourly love messages plus hydration reminders.

## What it does

- **Log water:** User sends messages like `500ml`, `1 bottle`, `half bottle`, or (with LLM) `500ml 2 hours ago`, `drank 2 glasses`.
- **Query / undo / edit:** With LLM: “show today’s logs”, “that was a mistake”, “reduce by 500ml”. Negation (“I didn’t drink 500ml”) is handled and no log is added.
- **Onboarding:** First run: user sets bottle size (e.g. 750ml or 1 liter); then they can say “1 bottle”, “half bottle”, etc.
- **Excluded beverages:** Words like coffee, tea, juice are rejected with a playful message; only water is logged.
- **Scheduled messages (IST):**
  - **Every hour:** A love message (LLM-generated or fallback) and a hydration reminder. Hydration reminders are **disabled between 12 AM and 8 AM IST**.
  - **Midnight IST (18:30 UTC):** Daily summary (yesterday’s total vs goal).

All user-facing text is warm and affectionate, with lots of hearts and sparkles.

## Tech stack

- **Runtime:** Cloudflare Worker (TypeScript).
- **Database:** Cloudflare D1 (SQLite). Tables: `user_preferences` (bottle size, target, onboarding), `water_logs` (amount, time, chat_id).
- **LLM:** Optional. Any OpenAI-compatible API (Groq, OpenRouter, OpenAI). Used for intent parsing (log / query / undo / edit / chitchat / clarify) and for generating hourly love messages. Without an API key, only regex parsing works (simple amounts like `500ml`, `1 bottle`).

## Setup

### 1. Prerequisites

- Node.js and npm.
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- A Cloudflare account with a D1 database and Worker (or create them via Wrangler).

### 2. Install and deploy

```bash
npm install
npx wrangler deploy
```

### 3. Secrets and config

**Required**

- **TELEGRAM_BOT_TOKEN**  
  ```bash
  npx wrangler secret put TELEGRAM_BOT_TOKEN
  ```
- **Webhook:** After deploy, set Telegram’s webhook to your Worker URL (from the deploy output):
  ```bash
  curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_WORKER_URL"
  ```
  Example: `YOUR_WORKER_URL` = `https://hydration-bot.<your-subdomain>.workers.dev`
- **TELEGRAM_WEBHOOK_SECRET** (optional): If set, the Worker rejects webhook requests that don’t include the header `X-Telegram-Bot-Api-Secret-Token` matching this value. Set the same value when calling `setWebhook` with the `secret_token` parameter to prevent spoofed webhooks.

**Optional (for natural language and hourly love messages)**

- **OPENAI_API_KEY** – Set to your provider’s API key (Groq, OpenRouter, or OpenAI):
  ```bash
  npx wrangler secret put OPENAI_API_KEY
  ```
- **OPENAI_BASE_URL** and **OPENAI_MODEL** – If not using OpenAI, set in `wrangler.toml` under `[vars]`, for example:
  - **Groq:**  
    `OPENAI_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"`  
    `OPENAI_MODEL = "llama-3.3-70b-versatile"` (or another model ID)
  - **OpenRouter:**  
    `OPENAI_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"`  
    `OPENAI_MODEL = "meta-llama/llama-3.2-3b-instruct:free"` (or another model)

Without an API key, the bot still works for simple regex inputs and sends fallback love messages (no LLM).

## Cron schedule

| Cron           | When (UTC)        | What runs |
|----------------|-------------------|-----------|
| `0 * * * *`    | Every hour at :00 | Love message (always) + hydration reminder (skipped 12 AM–8 AM IST) |
| `30 18 * * *`  | 18:30 daily       | Daily summary (midnight IST) |

Times are implemented in code using IST (e.g. hydration is disabled when IST hour is 0–7).

## Project layout

- `src/index.ts` – Worker entry; webhook and scheduled handlers; routes to onboarding, water intake, reminders, summary.
- `src/lib/parser.ts` – Two-stage parsing: regex first, then LLM for ambiguous or time phrases. Handles “yesterday” by clarifying (no log).
- `src/lib/llm.ts` – LLM client: intent extraction for water messages and `generateLoveMessage` for hourly love reminders.
- `src/lib/personality.ts` – All reply templates (success, clarification, reminders, love fallbacks, etc.).
- `src/lib/db.ts` – D1 access (user prefs, water logs).
- `src/lib/telegram.ts` – Sending messages and parsing incoming webhook payloads.
- `src/lib/time.ts` – IST helpers and retroactive time validation (e.g. “2 hours ago”, same day, ≤12h).
- `src/types.ts` – Shared types (Env, ParseResult, WaterIntent, etc.).
- `wrangler.toml` – Worker name, D1 binding, crons, `[vars]` for optional LLM URL/model.

## Testing

See [TESTING.md](TESTING.md) for a short checklist of messages to send in Telegram and expected behavior with and without an LLM API key.
