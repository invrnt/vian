# Vian V1 release evidence — 2026-09-23

## Follow-up for preview.5 candidate — 2026-09-24

The code candidate is source revision `b7a257564441b9f418912d340bd92a7892bd1d17`, after preview.4. It adds background daemon activation with duplicate-start reporting, daemon stop/restart controls, foreground operation for systemd, and `vian service uninstall`. The installer and usage instructions now select the newest published release with a compatible Linux asset, including previews, without a version embedded in Markdown install commands.

At that revision, GitHub Actions Verify run [36045340126](https://github.com/invrnt/vian/actions/runs/36045340126) completed successfully. It ran schema consistency, the full check suite, build and foundation smoke. Local `bun run check` passed 122 tests and 753 assertions; `bun run build` passed. A compiled CLI smoke in temporary data paths verified daemon start, already-running response, status, restart and stop. The service unit and uninstall command were tested with the mocked service runner. The default installer was also run in a temporary directory; it selected the newest available release at that time, verified its checksum, installed the Bun script and passed `vian --help`.

**V1 release readiness remains BLOCKED.** This preview does not claim stable readiness. Live Telegram, Gateway and Gemini journeys, a fresh Linux systemd user-service lifecycle, and the 25 connected-bot idle-resource measurement still lack evidence, as recorded below. Publishing a preview makes these changes available for testing and does not waive those gates.

## Decision and scope

**BLOCKED: V1 release readiness is not established.** The combined source at `3942f52` passes the available local build and deterministic checks. Live Telegram, Gateway and Gemini journeys, a fresh Linux user-service install, and 25 connected Telegram bots remain unverified because their required external accounts or environment were unavailable. These are required gates, not waived features. No deployment, service installation, push or protected merge was performed.

This report uses PASS for a completed check, BLOCKED for a required check without adequate evidence, and FAIL only for a demonstrated failure. No unresolved test failure remains. An offline fixture does not establish live adapter compatibility. Previous owner evidence is reused where the code/dependency state is unchanged.

## Combined revision checks

| Gate | Result | Exact evidence and limit |
|---|---|---|
| T01 foundation | PASS | At base `3942f52`, `bun install --frozen-lockfile`, `bun run schema`, `git diff --exit-code -- schema/v1.json`, `bun run check`, `bun run build`, and `bun run smoke:foundation` all exited 0. Compiled `dist/vian --help` and the arbitrary-root local TypeScript import smoke passed. `packages/core` has no concrete Gate/provider imports by source search. H's only code change at `52fa171` adds one runtime test. |
| T02 storage/local | PASS for tested scope | 16 real-SQLite storage tests and 11 local CLI tests passed in the combined 105-test run. They cover WAL/foreign keys, transactions, online backup, migrations, moves/clones, init preservation, offline history and doctor. The fresh copied artifact initialized a nonempty temporary bot directory, listed/inspected it, preserved an unrelated file and existing `.env` entry, and reported missing secrets/database without contacting a provider. |
| T03 runtime/identity | PASS for tested scope | 25 runtime tests plus the `tests/integration/vertical.test.ts` §67 slice passed. Tests cover the ten §59.2 concurrency/crash scenarios, safe steering and queue mode, summary failure fallback, access, audit, outbox and isolation. O's live ChatGPT runtime tool/steering/stop/two-root checks are reused from `1ac8410`. |
| T04 tools/attachments | PASS for tested scope | Five tool/MCP tests and attachment delivery integration passed: validation, reload, allowlist, opaque handles, metadata-only audit, TTL and ordered file delivery. Compiled native tool loading passed. |
| T05 provider | PASS offline; BLOCKED live Gateway/Gemini | OAuth fixtures cover PKCE/state/callback, token rotation, terminal auth, SSE/tools/abort/errors and shared profile. P's live Vian-owned ChatGPT `gpt-5.5` login, response stream, tool, abort, forced refresh and two-root profile checks at `36e40e5` and O's live runtime checks at `1ac8410` are reused. No live Gateway or Gemini account/model check is recorded. |
| T06 Telegram | PASS HTTP fixtures; BLOCKED live | 12 Telegram tests passed for normalization, renderer, callback ACK, native stop shape, delivery classification, media and opaque buttons. No test bot/two users/group/topic existed for live drafts, attachments, buttons, replies or rate behavior. |
| T07 operations | PASS local; BLOCKED external | Six operations E2E tests passed for socket/daemon exclusion, fault isolation, rendered service and log rotation. O measured V009 compiled CLI budgets and fake idle 25-bot RSS at `1ac8410` (`benchmarks/results.md`). The 25 *connected* Telegram-bot budget and fresh user-session systemd lifecycle were not measured. |
| T08 release | BLOCKED | All 106 tests passed with 648 assertions; build/schema/foundation smoke passed. Full live Gate/provider journeys, fresh-host artifact/service installation and connected-resource measurements remain required. |

The current combined run was `bun run check`: TypeScript passed, 106 tests passed, 0 failed, 648 assertions. This run used the code/test tree committed at `52fa171`. The frozen install resolved Bun 1.4.2, TypeScript 7.0.2, AI SDK 7.0.111, grammY 1.46.0 and the exact root pins in `package.json`/`bun.lock`. `bun run build` produced `dist/vian` from 210 modules at base `3942f52`. H changed no executable code or dependency, so that artifact evidence still applies.

The artifact-copy smoke used a separate temporary directory for the binary, bot and `XDG_DATA_HOME`; `vian init <bot> --provider openai-chatgpt --model gpt-5.5`, `list --json`, `inspect --json` and `doctor --json` worked. The expected doctor result was `ok:false` for the intentionally absent Telegram token and database. The temporary `.env` had mode 0600 and `.vian` mode 0700. This tests an isolated artifact, not installation on another Linux image.

## Requirement traceability

The primary owner for each ID is the single owner in `execution-plan.md`. “PASS” below means the cited local acceptance is demonstrated; “BLOCKED” means at least one required acceptance clause still needs the named evidence. These are release statuses, not implementation completion statuses.

| ID | Release status | Evidence / missing evidence |
|---|---|---|
| V001 | PASS | Config/help and explicit native/MCP tool tests; no broad agent/shell capability exposed. |
| V002 | PASS | Frozen build, compiled help/tool import, pinned manifests, MIT license and OpenClaw notice. |
| V003 | PASS | Local init tests and isolated compiled artifact preserve existing files/env and register UUID. |
| V004 | PASS | Real SQLite registry move/clone/unregister test and compiled list. |
| V005 | PASS | Config/schema tests, schema diff and failed-restart isolation test. |
| V006 | PASS | Runtime context tests and fake provider capture. |
| V007 | PASS | Local CLI tests for offline commands, filters, JSON/JSONL, doctor and redaction; compiled smoke. |
| V008 | PASS | O's local `vian test` journey and isolated runtime tests; no Telegram required. |
| V009 | PASS | Compiled 20-sample CLI/control measurements in `benchmarks/results.md`; all named budgets met. |
| V010 | PASS | Runtime routing, binding, reply/topic fixtures and separate canonical IDs. |
| V011 | PASS | Pairing, expiry, revocation, admin and unauthorized-input tests. |
| V012 | PASS | FIFO/restart/duplicate/lease/concurrency tests. |
| V013 | PASS | Started-tool crash/recovery test; no replay. |
| V014 | PASS | Bot-local audit, golden vertical event path and metadata-only canary tests. |
| V015 | PASS | SQLite migration/backup/rollback/concurrent-writer tests. |
| V016 | PASS | Summary-tail and summary-failure fallback runtime tests (`52fa171`). |
| V017 | PASS | AI SDK tool continuation, failure, cancellation and persisted-final tests; live ChatGPT stream/tool evidence reused. |
| V018 | PASS | Multipart ordering, receipt, ambiguous hold/restart and confirmed retry fixtures. |
| V019 | PASS | Group initiator/admin and ordered `/new` tests. |
| V020 | PASS | Native module/schema/local import/reload tests and compiled import smoke. |
| V021 | PASS | Last-valid tool reload and failed bot restart tests. |
| V022 | PASS | Explicit stdio MCP allowlist and lifecycle fixture. |
| V023 | PASS | SHA-256/opaque attachment/expiry and cross-bot denial tests. |
| V024 | BLOCKED | Fake and Telegram HTTP attachment tests pass; live Telegram photo/document/report round trip unavailable. |
| V025 | PASS | TTL/metadata preservation and active delivery tests. |
| V026 | BLOCKED | Google/Gateway fixture streams and configured IDs pass; live auth/model/tool/stream for both unavailable. |
| V027 | PASS | Current OpenClaw MIT source provenance, Vian PKCE/loopback/transport fixtures, and P live ChatGPT login/stream/tool/abort evidence. Headless uses strict manual callback fallback, not a claimed device flow. |
| V028 | PASS | Atomic cross-process profile lock/rotation/terminal auth tests and P live forced refresh/two roots. |
| V029 | PASS | Two-root env isolation, restrictive profile, auth metadata and redaction canary tests. |
| V030 | PASS | Provider fixture partial failure, abort, missing usage/media and safe error tests; P live failure evidence. |
| V031 | BLOCKED | Fake Gate and Telegram HTTP normalization pass; live polling/chat admission unavailable. |
| V032 | BLOCKED | MarkdownV2/chunk/rejection fixture passes; live Telegram rendering/limit behavior unavailable. |
| V033 | BLOCKED | Native stop/draft fixtures and runtime cancellation pass; live Telegram draft/stop unavailable. |
| V034 | BLOCKED | Opaque action/ACK/revocation/callback fixtures pass; live button journey unavailable. |
| V035 | BLOCKED | DM/group/topic/reply/command fixtures pass; live group/topic/two-user journey unavailable. |
| V036 | BLOCKED | Receipt/flood/ambiguous HTTP fixtures pass; live file/button/text journey unavailable. |
| V037 | PASS | Same-user socket, duplicate daemon/bot ownership and control tests. |
| V038 | PASS | Broken-bot isolation, restart validation and shutdown/recovery tests. |
| V039 | BLOCKED | Rendered unit and mocked runner pass; fresh Linux user-session install/start/logout lifecycle not authorized/performed. |
| V040 | PASS | Rotated diagnostic logs, status/doctor/held delivery and offline history tests. |
| V041 | BLOCKED | Base RSS and fake 25-bot RSS are within budget; 25 real connected Telegram bots and idle traffic need tokens. |
| V042 | BLOCKED | Build, copied-artifact smoke, examples, exact pins and notices inspected. Fresh Linux install and full distribution artifact/license verification remain. |
| V043 | BLOCKED | This report and all available combined gates pass; required external T08 evidence remains. |
| V044 | PASS | Steering boundary, five follow-ups, queue mode, reset barrier, revoked sender and live ChatGPT tool/steer checks. |

## PRD §59.2, §63 and §68 reconciliation

The ten mandatory §59.2 scenarios map respectively to `packages/runtime/src/runtime.test.ts` cases for two principals; five follow-ups/FIFO restart; active callback; stale lease/restart; duplicate inbound; two tool calls; multipart ordering; partial provider failure; authorized stop; and started-tool interruption. The §67 end-to-end fake slice is `tests/integration/vertical.test.ts` and passed.

Every §63 Creation, Identity, History, Tools and CLI item has local evidence through V003–V007, V010–V015 and V020–V030. Runtime's one-daemon/25-bot item remains BLOCKED under V041, despite the fake load measurement; fault isolation, restart and serialization pass. Telegram's private live journey, native draft, attachments, buttons, reply/callback and flood items remain BLOCKED under V031–V036, while their deterministic fixtures pass. Provider Gateway and Gemini live items remain BLOCKED under V026; ChatGPT and credential items pass through V027–V030. Operations' installed service item remains BLOCKED under V039; shutdown, attachment cleanup and migrations pass locally.

The fifteen §68 invariants were checked as follows: (1–2) static `packages/core` import search at `3942f52` found no Gate or concrete-provider imports; (3) canonical identity/routing tests; (4) server-side tool context and access tests; (5) duplicate-inbound test; (6) session lease/concurrency tests; (7) tool-call audit/idempotency test; (8) durable final/outbox test; (9) Telegram formatting fallback test; (10) atomic profile replacement/refresh test; (11) unknown-user pairing/no-model test; (12) registry/storage separation inspection and tests; (13) registry move test; (14) captured model-context/history separation test; (15) pairing and authorization tests. All pass as local invariants; live Telegram-dependent behavior still needs its Gate gate.

## Provenance, security and remaining actions

`THIRD_PARTY_NOTICES.md` identifies the OpenClaw source revision `0e79899fedc26ae9a90a196a8bc41b97fd39d7e5`, adapted files and MIT license. The bundled runtime/dependency pins are fixed in `package.json` and `bun.lock`. `bun pm ls --all` was checked against the notice inventory: the notice covers installed Linux packages; the lock also lists TypeScript platform-optional binaries for other operating systems. Before distributing on those platforms, recheck their exact package notices and bundled artifact composition. No secret was placed in this report or test fixtures. Tests and the copied artifact check cover restrictive bot file permissions, global profile rotation, metadata-only audit, and safe CLI/provider errors.

To resolve the release block, supply disposable Telegram bot credentials plus two authorized users and group/topic test chats; authorized Gateway and Gemini test credentials/models; and an authorized fresh Linux user-session environment for service/artifact install. Run the exact T05/T06/T07 live journeys and 25 connected-bot/idle-traffic benchmark, then update this report with revisions, safe results and any defects. No real token value belongs in a command transcript, report or commit.

## Onboarding follow-up

At `4471736`, new bots default to global Google/Gateway API-key profiles, alongside the existing global ChatGPT OAuth profile. Each bot still selects its provider and model and keeps its Telegram token locally. The new `vian telegram connect <bot>` command accepts that token through a hidden prompt, checks Telegram `getMe`, and reloads a running bot. `bun run check` passed 110 tests and 677 assertions; the compiled build and foundation smoke passed. These changes did not add live Google, Gateway or Telegram journey evidence. **BLOCKED is a release-verification status, not a requirement for users to share credentials with this project.**
