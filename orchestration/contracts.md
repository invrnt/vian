# Shared contracts

Code owns field-level definitions as of foundation revision. Changes follow the transfer and integration procedure in [execution-plan.md](execution-plan.md). Storage owns physical SQLite schemas and migrations. The contracts below fix the boundary and point consumers to the only code authority.

## C01: Configuration and commands

Authority: [config.ts](../packages/core/src/config.ts), [commands.ts](../packages/core/src/commands.ts), generated [v1.json](../schema/v1.json), and [config.test.ts](../packages/core/src/config.test.ts). Manifest parsing rejects unknown fields and future versions. Credential references accept bot-root `env:`, named `profile:`, and explicit `oauth:openai-chatgpt:<profile>` syntax; token resolution stays behind C05. The default same-session policy is steer; queue remains explicit. CLI commands export a narrow run function. The schema is generated from the Zod authority.

## C02: Canonical events and identity

Authority: [identity.ts](../packages/core/src/identity.ts), [messages.ts](../packages/core/src/messages.ts), and [contracts.test.ts](../packages/core/src/contracts.test.ts). Transport identities remain separate from canonical identities. Authorization produces trusted canonical context.

## C03: Storage transactions

API authority: [storage.ts](../packages/core/src/storage.ts), [execution.ts](../packages/core/src/execution.ts). Physical schema and transactional implementation belong to S. Privileged attachment storage lookup, expiry enumeration and deletion status remain bot-local. New registrations require SHA-256, origin and creation time; privileged legacy reads may lack this metadata after migration and must never expose private paths through the public attachment handle. State transitions and audit append must share a transaction; started tool work must not replay after a crash. Unknown private actors receive a deduplicated durable pairing notice without model access; rejected queued/claimed input is consumed with an audit event after authorization recheck. The BotStore port also owns explicit binding/administrator updates, session enumeration and current control authority, ordered pending-inbound reads, interruption recovery, terminal run failure/cancellation, and callback-action consumption. Storage exports a standalone read-only schema inspector with an explicit existence result that never creates or migrates a database. BotStore provides trusted reverse destination lookup for Gate button actions. Applying an ordered reset barrier creates a new session only after prior input and the active run settle, with session_reset audit in the same transaction.

## C04: Gate and delivery

Authority: [gate.ts](../packages/core/src/gate.ts), [delivery.ts](../packages/core/src/delivery.ts). Gates normalize transport events and render/deliver canonical output. Runtime supplies attachment ingest/open/list, action and trusted conversation-to-destination resolution ports at Gate start, plus bot-scoped attachment open during delivery. Rendered button labels carry opaque action IDs. Actorless group stop updates must be dropped by the Gate. Ambiguous sends remain held; only confirmed failures may retry.

## C05: Providers and credentials

Authority: [provider.ts](../packages/core/src/provider.ts), [secrets.ts](../packages/core/src/secrets.ts). Providers resolve an AI SDK model; credential profiles have one cross-process writer. Errors and public metadata contain no secrets.

## C06: Tools, MCP and attachments

Authority: [tools.ts](../packages/core/src/tools.ts), [attachments.ts](../packages/core/src/attachments.ts). Tool context stays server-side and includes a durable call idempotency key. Attachments expose opaque handles; file paths stay private. Inbound Gate media enters through byte-stream ingest; outbound Gate media uses bot-scoped open/release. [actions.ts](../packages/core/src/actions.ts) owns opaque callback action types, bounded ID size and atomic consume semantics.

## C07: Control and lifecycle

Authority: [control.ts](../packages/core/src/control.ts), [commands.ts](../packages/core/src/commands.ts). Version 1 frames are newline-delimited JSON, limited to 65,536 UTF-8 bytes, with a 5-second operation timeout. The endpoint is same-user and local.

## C08: Test adapters

Authority: [testing exports](../packages/testing/src/index.ts), [contracts.test.ts](../packages/testing/src/contracts.test.ts). Foundation fakes are minimal. R owns extension after the recorded transfer.

## C09: Safe model-step continuation

Authority: [execution.ts](../packages/core/src/execution.ts), [contracts.test.ts](../packages/testing/src/contracts.test.ts). The pinned AI SDK 7.0.111 `prepareStep` hook accepts a message override after a completed tool batch. Runtime claims an ordered, authorized finite steering batch only at that boundary. The SDK conformance test proves tool-call/result pairing survives and the tool runs once.
