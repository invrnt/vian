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

## 2026-09-30 retention follow-up

Added opt-in `deleteAfterDelivery` on trusted attachment registration, additive
SQLite migration 5, expiry eligibility based on durable successful outbox state
and no unresolved consumers. Runtime sweeps after confirmed delivery; assembly
sweeps after restart; daemon sweeps every minute. Active readers remain protected.
Bot-owned scratch and orphan attachment files older than 24h are also reclaimed.
No credentials, history or arbitrary external files are deleted.

Validation: `DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/vian-test-no-session-bus bun run check`
passed typecheck and 149 tests (874 assertions). The isolated bus prevents the
existing user service from affecting the daemon lifecycle fixture; an unisolated
run correctly encountered the live service. No live Telegram message was sent
for these tests. Storage tests cover uncertain delivery, multiple consumers,
TTL and restart recovery; registry tests cover active readers and crash leftovers.
