# Telegram activity and localized feedback

Source revision: `85fd3199895ac9b9047fc949574f5818af2e038b`, plus the current uncommitted working tree. Assignment and acknowledgment are recorded in execution-plan.md. Requirements: V033/V036, C01/C04, T01/T03/T06. The referenced original `Vian-V1-PRD.md` is absent from this checkout; preserved product sections and the user's explicit extension supplied the behavior authority.

Changed paths: core config/schema and tests, Gate activity hooks/correlation, shared `ui-messages.ts` catalog/export; Telegram `activity.ts`, HTTP fixtures and adapter wiring; runtime activity lifecycle, empty-output/error notices and tests; CLI assembly language wiring; generated `schema/v1.json`; operations and orchestration documentation. No manifests, lockfile, storage contracts or migrations changed.

## Dependency and API evidence

Inspected root/package manifests, `bun.lock`, `.tool-versions` and installed grammY manifest before retrieval. Bun 1.4.2, TypeScript 7.0.2, grammY 1.46.0, installed Telegram types 5.0.0, AI SDK 7.0.111.

Retrieved 2026-09-29:

- [grammY v1.46.0 API source](https://github.com/grammyjs/grammY/blob/v1.46.0/src/core/api.ts): pinned sendMessage/editMessageText/deleteMessage wrappers; locally verified signatures in `node_modules/grammy/out/core/api.d.ts`. Native Bun AbortSignal is structurally adapted at the grammY boundary as in the existing polling code. No external source was copied or adapted.
- [Telegram Bot API 10.3](https://core.telegram.org/bots/api#editmessagetext): plain-text message editing, message ID targeting and topic-aware sendMessage. deleteMessage permits cleanup of bot messages subject to platform restrictions; UI deletion rejection falls back to localized completion text. Documentation supports API shape, not live compatibility.

## Validation

Environment: local Linux checkout, Bun 1.4.2; temporary bot roots and real SQLite; fake providers and grammY HTTP boundary fixtures. No live provider/Telegram credentials used.

- `/home/cami/.bun/bin/bun run schema`: PASS; generated locale enum/default, verified by config test.
- `XDG_RUNTIME_DIR=/tmp/vian-tests-no-runtime DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/vian-tests-no-user-bus /home/cami/.bun/bin/bun run check`: PASS, TypeScript and 144 tests, 0 failures, 851 assertions across 25 files. Includes silent-provider timeout, tool-phase cancellation, both locales, durable notices, status failure isolation, topic/run isolation, file/text cleanup, ambiguous delivery and in-flight animation cleanup.
- `/home/cami/.bun/bin/bun run build`: PASS, compiled `dist/vian` (217 modules).
- `git diff --check`: PASS.

Initial unisolated full validation and a retry isolating only DBUS_SESSION_BUS_ADDRESS each had 142 passing tests and one unrelated daemon E2E failure. The pre-existing daemon test probes the host user service even with temporary Vian data roots, then invokes daemon stop in cleanup. That stopped the previously active `vian.service`. Restored it with `systemctl --user start vian.service` after each attempt. Verified the service is `active` after final validation. The successful command also isolates XDG_RUNTIME_DIR, preventing access to systemd's private user socket. No test/product behavior was changed to bypass that failure; the existing E2E isolation issue is documented in testing.md.

## Limits

No live Telegram client/provider validation, release publication, deployment or installation of a user service. Normal stop settles activity, but transient message IDs are process-local: forced process death or a lost send acknowledgment may leave an old message. UI cleanup failures do not alter durable final answer delivery or ambiguous-outcome retry policy. Existing pairing/command copy and diagnostic/audit strings are outside this generation-feedback localization scope.
