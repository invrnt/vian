# Delivery repair — 2026-09-29

Authorized scope: Presentation Maker bot reliability and 250 MiB Telegram uploads;
ownership transfer recorded in execution-plan.md. No new dependencies.

Evidence: pinned grammY 1.46.0 package and client.d.ts expose apiRoot and
 timeoutSeconds; Telegram https://core.telegram.org/bots/api#using-a-local-bot-api-server
and https://github.com/tdlib/telegram-bot-api (retrieved 2026-09-29) require api_id/hash,
--local and logOut migration, and document the local upload allowance of 2000 MB.
Application cap remains 250 MiB. Local fixture transferred 250 MiB through grammY's
multipart stream; no live account was used by tests.

Validation: `bun run check`: typecheck passed, 147 tests passed, 865 assertions, no failures. Runtime and SQLite must be deployed together.
Blocked: live 250 MiB upload until owner supplies Telegram API ID/hash and a local
Bot API server is installed. Do not label mocked/loopback transport as live compatibility.
