# Manual test checklist

Send each message in Telegram and check the response matches the table. Use this to verify behavior without an API key (regex only) vs with an API key (full LLM).

| # | Send | No API | With API |
|---|------|--------|----------|
| 1 | `500ml` | Logged | Same |
| 2 | `1 bottle` | Logged (uses your bottle size) | Same |
| 3 | `500ml 2 hours ago` | Clarify (+ hint to set API key) | Logged at now−2h |
| 4 | `show today's logs` | Clarify | Today total + list |
| 5 | `that was a mistake` | Clarify | Last log removed |
| 6 | `reduce by 500ml` | Clarify | Total reduced |
| 7 | `I didn't drink 500ml` | Clarify | No log; no_action reply |
| 8 | `coffee` | Rejected | Same |
| 9 | `hi` or `hey` | Clarify | Chitchat reply |
| 10 | After `/start`: `1 liter` | Bottle set | Same |

**Copy-paste list**

1. `500ml`
2. `1 bottle`
3. `500ml 2 hours ago`
4. `show today's logs`
5. `that was a mistake`
6. `reduce by 500ml`
7. `I didn't drink 500ml`
8. `coffee`
9. `hi`
10. `/start` then `1 liter`

Tick each row when the response matches.
