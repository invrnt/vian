# Tools attachments requirements

Source: [Vian V1 PRD](../../Vian-V1-PRD.md). Section references below include all subordinate clauses. Each ID covers its full stated scope, not only the acceptance examples. Required behavior remains required when its external dependency is blocked.

## V020: Native tools

Source: PRD §§15, 41, 49.2, 49.4, 49.8.

Load configured normal TypeScript exports with dependency-free JSON Schema declarations. Validate arguments including additionalProperties before execution. Run trusted code in-process, allow normal local imports, expose only explicit tools. Context contains canonical IDs, AbortSignal, attachments/logger and optional services, never model-visible.

Acceptance: Compile/run dependency-free sample module in arbitrary root, validate bad exports and arguments, duplicate names and local imports; safe ordinary exception cannot crash daemon; no shell or sandbox option is exposed.

## V021: Tool reload

Source: PRD §§40–41, 47.

Explicit restart reloads tool module and dependencies; validate before swap, never half-apply. Retain previous valid runtime where possible or explain error status.

Acceptance: Edit tool and local imported module, restart and see new behavior. Invalid import/schema preserves valid runtime when possible; cold invalid bot enters descriptive error without harming others.

## V022: MCP

Source: PRD §§16, 49.5.

Explicitly configure stdio servers and allowlisted tool names; listTools only supplies schemas, new remote tools do not expand explicit allowlists. Same validation/audit as native calls. Wildcard is only an explicit opt-in if supported.

Acceptance: Mock schema changes, server disconnect and denied tool; only allowlisted names become callable. Cancellation/shutdown releases configured child processes. No automatic server discovery.

## V023: Attachment registry

Source: PRD §§17.1–17.2, 15, 43.

Bot-local attachments with opaque ID, display name, MIME, size, SHA-256, origin, timestamps/expiry and runtime-only path. Model representation exposes id/name/mimeType/size only.

Acceptance: Register a generated file, verify hash/metadata and private path isolation. Wrong-bot or unavailable ID cannot access another bot file; unsafe names and size violations fail safely.

## V024: Attachment transport and tools

Source: PRD §§17.3–17.4, 20.3–20.4, 42.

Use Gate-neutral ID-based delivery and listing. Normalize incoming media to canonical references. Provider may consume supported media natively; otherwise expose metadata to model/application tools.

Acceptance: Round trip fake and Telegram photo/document with caption and generated report; send_attachment accepts ID, never path. Unsupported model media retains metadata; over-limit/download failure is audited without partial usable file.

## V025: Retention and cleanup

Source: PRD §§17.5, 48, 51, 56.

Delete expired bytes through lightweight shared infrequent maintenance; retain metadata with expired/deleted status and unavailable path. Keep history indefinitely and logs bounded.

Acceptance: Advance fake clock through TTL and active delivery: no deleted file remains usable, metadata/history survive, cleanup failures are logged safely and retried without busy polling.

