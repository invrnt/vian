# Telegram Gate

Vian V1 supports one Telegram Gate per bot. Run `vian telegram connect <bot>` to enter the token in a hidden prompt. It validates the token, saves it in that bot's mode-0600 `.env`, and reloads the bot when the daemon is running. `vian.json` references it as `env:TELEGRAM_BOT_TOKEN`. Private users can pair with an owner-approved code. Manage access locally with `vian access pending|list|approve|revoke`.

The Gate normalizes Telegram messages, callbacks and attachments into canonical events. It renders replies as MarkdownV2, falls back to plain text after a confirmed format rejection, and stores final answers before delivery. Native drafts support streaming in private chats. A user can stop generation; the runtime records cancellation without turning partial draft text into final history. Group behavior requires explicit enablement and approved identities.

Telegram network failures after a send may be ambiguous. Vian holds such deliveries instead of risking an automatic duplicate. Check bot status, logs and history before resolving the external outcome.
