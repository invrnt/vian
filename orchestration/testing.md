# Validation

## Status and commands

Planning checks actually performed: repository/ancestor instruction inventory; full PRD inspection in chunks; host version queries; Git absence checks; official Telegram/Codex source retrieval; generated-document structure, local-link, requirement-owner and DAG checks. The document validator checked 21 Markdown files, 44 requirement definitions with acceptance/source references, 44 single-primary assignments, nine correctly structured prompts and 12 DAG edges, with no errors. After the user confirmed 20 available subagent slots, a ready-first capacity simulation confirmed low/mid/high elapsed estimates of 12/16.5/21 effort-days, with a peak of five implementation units and total effort 23/31.5/40 days. F can handle integration as a sixth active role; serialized review backlog is not separately modeled. The schedule and rationale remain authoritative in execution-plan.md. A normalized path-resource check found no overlapping ownership between concurrently eligible units; sequential overlaps match the explicit transfers. No application test, install, build, benchmark or live account flow has run.

Verified inspection commands: `rg --files --hidden -g '!.git/**'`, `bun --version`, `node --version`, `git --version`. Git status/root queries failed because no repository exists. These are not product validation commands.

Commands to establish during foundation, not yet verified project commands:

- A pinned clean dependency install with frozen lockfile.
- Type checking, package/unit tests, deterministic integration tests and standalone build scripts in the root manifest.
- Targeted package-test invocation and combined release check.
- Compiled CLI smoke and benchmark invocation with isolated fixture roots.

Foundation must replace these descriptions with actual checked command lines and resulting artifact paths before dependent agents start. Do not claim `bun run build`, a CI task or a binary location exists until its script/artifact is established. CI uses those same commands. Local service installation and live smoke tests remain separately authorized checks.

## T01: Foundation and architecture

Verify standalone executable help plus loading a normal user TypeScript tool and its local import from a non-empty temporary project. Validate config schema and dependency pin compatibility. Assert core has no concrete Gate/provider imports, and local dispatcher has no eager runtime/SDK imports. Check notices for all adapted source. A compile/import incompatibility blocks contract release.

## T02: Storage and local CLI

Use real temporary SQLite files, not mocked SQL, for WAL/foreign keys, migrations, rollback, crash recovery, concurrent writes, backup/restore and ordered history export. Use fixtures for duplicate UUID, explicit move/clone, unavailable path, missing/future schema and unregister. Byte-compare unrelated init files and env comments/values. Test interruption of multi-file initialization and idempotent rerun; report incomplete setup clearly without corrupting existing files.

Run offline commands with network access unavailable and daemon stopped. Verify every specified doctor check, filters, output formats and redaction. User tool import is an explicit doctor action and may run trusted module initialization; isolate it in fixtures and report its timing separately.

## T03: Runtime and identity

Use fake Gate/provider and real storage. The first integrated milestone is PRD §67: init → registry → bot SQLite → fake Gate → authorization/canonical identity → session queue → fake provider → native tool → audit → fake delivery → history. Do not certify live Telegram before this passes.

Mandatory PRD §59.2 scenarios:

1. Two principals message one bot simultaneously, no context leakage.
2. One principal sends five messages during a long run, FIFO retained in explicit queue mode and safely consumed at tool boundaries in default steer mode.
3. Callback arrives while run is active, correct conversation and authorization.
4. Restart with queued messages preserves queue and leases.
5. Duplicate Telegram update produces one durable acceptance.
6. Two tool calls mutate audit state with consistent ordered events.
7. Multipart delivery overlaps another run without destination interleaving.
8. Provider fails after partial output, safe typed error and preserved audit.
9. User stops generation, abort and cancellation persisted, no hidden reasoning.
10. Daemon dies with tool state started, no automatic replay.

Test V044 safe steering after a settled multi-tool batch, durable claims, unchanged side-effect count, boundary/final-answer races and /new barriers before/after queued messages. Reset ordering must survive restart. Verify supported pinned SDK continuation with real tool-call/result shapes. Also test summary failure/tail fallback, step/time/concurrency bounds, wrong/stale control actors, /new history preservation, revoked access, pairing TTL and one-time codes, changed transport binding, active-session group permissions, shutdown, held ambiguous outbox and same-user control isolation. Use barriers/fault hooks instead of fragile sleep timing. Golden transcripts assert meaningful canonical event sequence and links, not volatile timestamps/token deltas.

## T04: Tools and attachments

Validate schema constraints before invoking code, duplicate tool names, context nonserialization, exception/cancellation behavior and idempotency keys. Test atomic tool/local-import reload and last-valid retention. MCP discovery returns only allowlisted tools even when the server adds names; stdio lifecycle/cancellation/disconnection is exercised with a fake server.

Use temporary bytes to verify SHA-256, opaque/public metadata, cross-bot denial, size enforcement, expiry/deletion and cleanup versus in-flight delivery. Native generated-report path never reaches model. Unsupported provider media becomes metadata, not silent input loss. Audit full/metadata-only policy uses canary sensitive values.

## T05: Provider contracts

Implementers own offline fixtures for each pinned adapter's streaming, tools, cancellation, missing usage, media, safe errors and terminal auth behavior. OAuth tests cover state/PKCE, callback rejection, expiry, simultaneous refresh by bots/CLI, process death during atomic replace, rotation persistence, logout and revocation without retry storms. No test uses a copied personal credential file. Live Google/Gateway/subscription flows are separately recorded with model ID, versions and safe outcome.

## T06: Telegram contracts

Mock the HTTP boundary, not core routing, for normalization, native draft/stop shapes, prompt callback acknowledgment, numeric identity, topic/reply routing and callback TTL/forgery/revocation. Corpus tests MarkdownV2 escaping/code/links/Unicode and chunk boundaries using verified platform limits.

Fault-inject known rejection, 429/retry_after, formatting rejection, connection failure before send and response loss after possible acceptance. Only confirmed failures auto-retry; ambiguous entries remain held through restart. Test receipt mapping and ordering across file/text parts. Live sandbox verifies private/group/topic chats, two authorized users, native drafts and stop, buttons, photos/documents and reply behavior. Do not claim generic exactly-once external delivery.

## T07: Operations and resources

Mock service execution for unit tests; use a disposable Linux user/session for actual systemd lifecycle. Verify mode/ownership of socket and credential/env files, duplicate-daemon exclusion, safe shutdown, log rotation/follow, atomic config restart and one broken bot alongside healthy bots. Check init load notification and explicit online doctor probes with combined adapters.

Benchmark compiled CLI budgets from V009, idle RSS and process/traffic budgets from V041. Record hardware, OS, runtime, versions, warm/cold state, sample count and observed distribution. Separate fake 25-bot load from 25 connected Telegram bots; the latter needs actual test tokens. Verify no idle model calls or provider processes. Profile measured regressions, not speculative optimization.

## T08: Release gates

Hardening checks the combined revision after all required implementations are integrated:

- T01–T07 and every feature acceptance criterion; all PRD §63 checklist items and all fifteen §68 invariants, each linked to a test or review result.
- Full first vertical slice, then live end-to-end user journeys for setup, pairing, two-user conversation/tool/report, callbacks, cancellation/reset, restart recovery, history and provider re-auth.
- Clean frozen install/build and fresh Linux artifact install; examples and documented commands actually work.
- Migration/backup recovery, configuration/schema generation, secret redaction, authorization and cross-bot isolation.
- CLI and messaging usability/accessibility: text alternatives for button choices, readable errors and help, no color-only status or secret prompts echoed, safe Unicode and formatting. No browser accessibility audit applies.
- Dependency/license provenance and security findings triaged, measured performance budgets and no out-of-scope capabilities.
- Requirement traceability contains exact revision/test evidence and no unowned or silently waived requirement.

Feature implementers own tests within their assigned paths; hardening owns combined gaps and integration fixes after explicit ownership transfer. Avoid duplicate low-value tests and arbitrary coverage percentages. Mock external services for deterministic recovery; real SQLite, compiled binary and live provider/Gate tests validate boundaries mocks cannot establish.

## Evidence and readiness

Each handoff records revision, changed paths/interfaces, exact command, result, fixture/environment and blocked/skipped checks. An unavailable credential/environment is BLOCKED, not PASS. Hardening creates `orchestration/release-report.md` only when actual evidence exists, with requirement/check references and readiness conclusion. Any unmet release requirement prevents claiming V1 ready; readiness never authorizes deployment.
