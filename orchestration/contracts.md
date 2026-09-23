# Shared contracts

These are coordination requirements, not implemented APIs. Foundation must establish the narrow exported signatures, serializable schemas and conformance fixtures below before dependent branches begin. Existing PRD type examples are illustrative inputs, not competing code authorities. No agent may independently invent a second version of a shared DTO.

## Authority transition

Before foundation completion this file owns seam semantics. At foundation handoff, link each C-ID to its exact code exports and tests in `packages/core/`, except SQL migrations in `packages/storage/`. Then code schemas own field-level definitions; remove provisional field descriptions that would compete with code, retaining rationale and links. Physical database schema remains storage-owned. Version changes follow execution-plan.md, never an uncoordinated type cast in a consumer.

## C01: Configuration and commands

Proposed authority: `packages/core/src/config.ts`, `packages/core/src/commands.ts`, generated `schema/v1.json`.

Represent the PRD §13 manifest, mandatory version/UUID, path resolution, explicit one-Gate config, credential-reference union, validated runtime/context/attachment settings and MCP allowlist. Preserve sample defaults as specified rather than assuming model availability. Add explicit administrator principal IDs for the user-approved V019 rule. Default sameSessionPolicy to steer and retain explicit queue, following V044 rather than the superseded source example. Declare configuration errors with bot/path/field and redacted messages. Reject future schema versions.

Freeze a small command-module export so local, auth and operational commands can be wired without concurrent dispatcher edits. Define safe human/JSON output envelopes, exit behavior and offline/online probe distinction. Define `test --session` request separately from ephemeral test invocation. Do not make CLI parsing depend on runtime imports.

## C02: Canonical events and identity

Proposed authority: `packages/core/src/messages.ts`, `packages/core/src/identity.ts`.

Distinct opaque bot/principal/conversation/session/run/message/tool-call/attachment/action IDs prevent raw external identities at canonical session APIs. External identity and destination bindings include Gate type and external IDs; Telegram IDs stay in adapter metadata. Canonical messages use PRD §43 parts plus optional canonical reply target. Use stable event ordering in each bot store and a durable inbound uniqueness key scoped by bot/Gate/external event.

Normalized inbound input carries external sender/destination, event identity, received time, content or control/callback data and metadata. It is not authorized canonical input. Authorization resolves bindings first and produces a trusted principal/conversation reference or denial/pairing outcome. Never accept these trusted fields from model or callback payload. Persist session/run initiator and explicit administrator references for group-control checks. Bindings permit later explicit reassignment to another transport without rewriting history.

## C03: Storage transactions

Proposed API authority: `packages/core/src/storage.ts`; physical schema: `packages/storage/src/migrations/`.

Freeze atomic operations for registry registration/move/clone, pairing approval/revocation, binding resolution, deduplicated inbox accept, ordered queue claim/session lease, run/tool transitions with audit append, final-message-plus-outbox commit, delivery updates, context summaries, attachment metadata and offline history reads. An event append accompanies each state transition in the same transaction. Include an atomic ordered steering-batch claim with durable event-to-run consumption links and an ordered /new barrier. An input is claimed at most once; a crash must not cause side-effect replay. Return typed duplicate, lease-busy, invalid-transition and unavailable-storage outcomes.

Queries support required session/principal/time/tool filters and streaming JSONL export. Avoid inventing remote pagination; use bounded local batches or an ordered cursor for large history without dropping/repeating events. Lease recovery distinguishes interrupted started calls from safely pending input; no automatic tool replay. Storage owns SQL transaction boundaries, WAL/foreign-key configuration, migration versions and backup mechanisms.

## C04: Gate and delivery

Proposed authority: `packages/core/src/gate.ts`, `packages/core/src/delivery.ts`.

Freeze capabilities, validate/start/stop lifecycle, inbound callback, render, ephemeral draft/stop correlation, delivery and optional current-run tools/context from PRD §§18–19. Ports carry canonical parts and opaque attachment handles. Gate-specific context is transient. Delivery receipt records canonical message, destination binding, part index and external receipt IDs; retry classification carries a safe error and any server-supplied retry delay.

Durable states include queued, sending, succeeded, failed-retryable, failed-terminal and ambiguous. Retries occur only for confirmed failures and obey penalty windows. No external idempotency guarantee is assumed. Lost response after possibly accepted send is ambiguous and holds later destination work until reconciliation. Part identities are stable across restart. Rendering fallback creates a new attempt only after a confirmed formatting rejection. Stop events must correlate to the authorized actor and active run, never abort another run from a stale draft ID.

Gate timeouts/throttles are bounded policy values derived from current API limits, recorded by the adapter owner. Native draft lifetimes are distinct from persistent deliveries. Do not treat partial draft calls as successful final delivery.

## C05: Providers and credentials

Proposed authority: `packages/core/src/provider.ts`, `packages/core/src/secrets.ts`.

Resolve a configured model ID plus opaque credential reference to an AI SDK-compatible model. Normalize cancellation, auth-required, unsupported-input, rate-limit, retryable-transport and terminal-provider errors without credential-bearing payloads. Document AI SDK version/type compatibility and media capability behavior. Model metadata includes usage when supplied, finish reason, latency and safe correlation IDs.

Secret lookup is scoped by bot root; OAuth profile lookup delegates to the sole global credential owner. No secrets in serialized CLI/control payloads. Freeze profile metadata/list/status/login/logout/refresh boundaries and an atomic token sink that synchronizes auth CLI and daemon across processes. Terminal refresh marks re-auth-required; bounded retries must never rerun already-started tools. External OAuth endpoints/headers remain solely in the adapter and are blocked until verified.

## C06: Tools, MCP and attachments

Proposed authority: `packages/core/src/tools.ts`, `packages/core/src/attachments.ts`.

Preserve PRD §15 dependency-free exported tool shape, JSON Schema validation and server-only execution context. Add available tool-call ID/idempotency key to the context without serializing it into model input. Freeze tool success/safe-failure results, abort behavior, full/metadata-only audit policy and name-collision rejection across native/MCP/Gate tools. Execution never treats model output as authorization.

Attachment public handle exposes only id/name/mimeType/size. Registration accepts a trusted runtime path and records private bytes/metadata; resolution checks bot scope, availability and size. Runtime transfer API feeds adapters without exposing host paths to model. Listing/sending accepts IDs. Coordinate expiry with in-flight reads; metadata remains after deletion. MCP tools enter this same validation/audit/execution path and obey explicit allowlists.

## C07: Control and lifecycle

Proposed authority: `packages/core/src/control.ts`.

Versioned same-user local requests use request ID, operation and bot selector; replies echo request ID with typed status or safe error. Operations cover load/start/stop/restart/status and lifecycle control needed by PRD commands; enabled state persists through registry API. Freeze framing, maximum request size and bounded timeout in foundation. The Unix endpoint must reject incompatible versions and malformed/oversized requests without exposing secrets or enabling arbitrary code.

Runtime exports lifecycle composition and named command/service extension points so operations can assemble real adapters without a plugin loader. Restart validates a whole replacement before swapping. Shutdown stops admission, flushes safe durable state and handles unfinished runs according to recovery semantics. A process lock prevents duplicate daemon ownership.

## C08: Test adapters

Proposed authority: `packages/testing/` exports, implementing C02–C06.

Fake Gate can emit inbound/control/button/attachment events and capture drafts/delivery attempts/receipts. Fake provider scripts text, tool calls, usage, abort and failures before/after partial output. Controllable clock and barriers expose queue/recovery races without time-based flaky sleeps. Contract fixtures must run unchanged against runtime with either fake or real adapters where suitable. Foundation provides only enough fakes to freeze contracts; runtime extends them for mandatory scenarios.

## C09: Safe model-step continuation

Proposed authority: `packages/core/src/execution.ts`, implemented by runtime using the pinned AI SDK.

Define the boundary between a settled tool-call batch and the next model step. Runtime reads C03's finite ordered authorized steering batch, appends canonical user messages after settled tool results, and resumes through supported SDK step/message hooks. Preserve tool-call/result pairing and event-to-run links. If the pinned SDK cannot modify next-step messages safely, establish a supported SDK continuation strategy and conformance fixture before implementing; do not write a new ReAct engine or drop inputs.

No steering boundary opens while tool promises or their durable results remain unsettled. A /new barrier excludes later input from old-session context. Queue mode leaves all follow-ups for later runs. Provider finalization, cancellation and timeout do not silently consume pending messages. Product semantics live in V044; this seam supplies SDK-neutral continuation state, not another product policy.
