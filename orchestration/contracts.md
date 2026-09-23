# Shared contracts

Code owns field-level definitions as of foundation revision. Changes follow the transfer and integration procedure in [execution-plan.md](execution-plan.md). Storage owns physical SQLite schemas and migrations. The contracts below fix the boundary and point consumers to the only code authority.

## C01: Configuration and commands

Authority: [config.ts](../packages/core/src/config.ts), [commands.ts](../packages/core/src/commands.ts), generated [v1.json](../schema/v1.json), and [config.test.ts](../packages/core/src/config.test.ts). Manifest parsing rejects unknown fields and future versions. Credential references accept bot-root `env:`, named `profile:`, and explicit `oauth:openai-chatgpt:<profile>` syntax; token resolution stays behind C05. The default same-session policy is steer; queue remains explicit. CLI commands export a narrow run function. The schema is generated from the Zod authority.

## C02: Canonical events and identity

Authority: [identity.ts](../packages/core/src/identity.ts), [messages.ts](../packages/core/src/messages.ts), and [contracts.test.ts](../packages/core/src/contracts.test.ts). Transport identities remain separate from canonical identities. Authorization produces trusted canonical context.

## C03: Storage transactions

API authority: [storage.ts](../packages/core/src/storage.ts), [execution.ts](../packages/core/src/execution.ts). Physical schema and transactional implementation belong to S. State transitions and audit append must share a transaction; started tool work must not replay after a crash.

## C04: Gate and delivery

Authority: [gate.ts](../packages/core/src/gate.ts), [delivery.ts](../packages/core/src/delivery.ts). Gates normalize transport events and render/deliver canonical output. Ambiguous sends remain held; only confirmed failures may retry.

## C05: Providers and credentials

Authority: [provider.ts](../packages/core/src/provider.ts), [secrets.ts](../packages/core/src/secrets.ts). Providers resolve an AI SDK model; credential profiles have one cross-process writer. Errors and public metadata contain no secrets.

## C06: Tools, MCP and attachments

Authority: [tools.ts](../packages/core/src/tools.ts), [attachments.ts](../packages/core/src/attachments.ts). Tool context stays server-side and includes a durable call idempotency key. Attachments expose opaque handles; file paths stay private.

## C07: Control and lifecycle

Authority: [control.ts](../packages/core/src/control.ts), [commands.ts](../packages/core/src/commands.ts). Version 1 frames are newline-delimited JSON, limited to 65,536 UTF-8 bytes, with a 5-second operation timeout. The endpoint is same-user and local.

## C08: Test adapters

Authority: [testing exports](../packages/testing/src/index.ts), [contracts.test.ts](../packages/testing/src/contracts.test.ts). Foundation fakes are minimal. R owns extension after the recorded transfer.

## C09: Safe model-step continuation

Authority: [execution.ts](../packages/core/src/execution.ts), [contracts.test.ts](../packages/testing/src/contracts.test.ts). The pinned AI SDK 7.0.111 `prepareStep` hook accepts a message override after a completed tool batch. Runtime claims an ordered, authorized finite steering batch only at that boundary. The SDK conformance test proves tool-call/result pairing survives and the tool runs once.
