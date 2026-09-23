# Architecture

## Verified baseline

Inspected 2026-09-22, project root `/home/jc/dev/personal/vian`.

- The only initial project file is `Vian-V1-PRD.md`, 74,511 bytes. No source, manifest, lockfile, tests, CI, design assets or existing interface definitions exist.
- `git rev-parse --show-toplevel` and `git status --short` report no Git repository. Git is installed, version 2.55.0.
- `bun --version` returns 1.4.2; `node --version` returns v26.7.0. These are host observations, not established project compatibility or dependency versions.
- At the initial inspection, the project and checked ancestors contained no on-disk AGENTS.md. The orchestration task has since placed its working rules at the project root as AGENTS.md. User-supplied Sentry instructions remain separate.
- No install, build, tests or service commands have been run. There are no verified application commands or CI requirements to reuse.

All paths below are proposed. There is no existing functionality to reuse. Follow the PRD's chosen Bun/TypeScript, AI SDK, grammY and bun:sqlite architecture, with only real subsystem packages.

## Proposed structure

| Path | Responsibility |
|---|---|
| `packages/core/` | Pure canonical types, config schema, secret-reference syntax, shared error types and narrow ports. No I/O or concrete adapters. |
| `packages/storage/` | Registry and per-bot SQLite, migrations, transaction operations, read APIs, identity/binding persistence, inbox/outbox and attachment metadata. |
| `packages/runtime/` | Authorization, routing, session coordinator, context, model loop, bot lifecycle, outbox orchestration and daemon control. |
| `packages/tools/` | Trusted module loading/execution, schema validation, attachment bytes, audit redaction and safe attachment tools. |
| `packages/mcp/` | Explicit stdio MCP adapter feeding the same tool executor. |
| `packages/gate-telegram/` | grammY transport, normalization, rendering, draft/stop adapter, callbacks and platform retry classification. |
| `packages/provider-google/`, `packages/provider-vercel/` | Official AI SDK provider adapters. |
| `packages/credentials/` | Bot-scoped environment resolution, secret-safe profile storage and cross-process profile locking. OAuth payloads remain opaque here. |
| `packages/provider-openai-chatgpt/` | Subscription transport, OAuth protocol implementation and refresh orchestration through the credential store. This is the package equivalent of the PRD §31.5 conceptual `providers/openai-chatgpt/` path. |
| `packages/cli/` | Lazy dispatcher, local commands, provider-auth command and runtime/service command modules. |
| `packages/testing/` | Deterministic fake Gate/provider, fake clock, scripted failures and canonical transcript fixtures. |
| `tests/integration/`, `tests/e2e/`, `benchmarks/` | Combined product verification and release measurements. |
| `docs/`, `examples/` | User/operator documentation and hello/attachment examples. |
| `package.json`, `bun.lock`, `tsconfig.json`, `.github/workflows/`, `scripts/`, `schema/`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | Build, pinned dependencies, checks, distribution and provenance. |

Assumption: use a Bun workspace with one CLI executable entrypoint and internal workspace packages. No web framework. Start with installed Bun 1.4.2 if its compilation and dynamic tool-loading probes pass; pin the tested runtime and exact compatible dependency versions during foundation. No dependency version has been selected or verified yet. Use Bun's test runner and TypeScript checking unless a demonstrated incompatibility requires a documented change.

## Dependency direction

CLI local commands import core and storage lazily. The daemon entrypoint loads runtime only for daemon/control operations. Runtime depends on core, storage and tools; its composition layer chooses static provider/Gate/MCP adapters. Adapters depend on core ports, never on CLI or concrete session implementation. Storage imports core, not runtime. Testing fakes implement core ports.

Core must not import grammY, Telegram types, a concrete provider or runtime. Keep AI SDK-specific model typing at the provider/runtime boundary using a type-only port selected during foundation. Do not import AI SDK or provider implementations when listing the registry. Native tool modules do not need a Vian SDK dependency.

## Data ownership and transactions

Global machine-local paths contain registry metadata, credential profiles and local control endpoint only. Bot roots own history, queues, summaries, bindings, attachment metadata/bytes and rotated logs. See product requirements for exact durable behavior and retention. Storage owns physical tables and migrations; consumers use transaction APIs instead of writing ad hoc SQL. Registry metadata may be cached but cannot become a second history store.

Persist inbound acceptance before execution. Session coordination and outbox coordination are separate. Keep one canonical assistant event linked to ordered delivery parts. Commit durable state and its audit boundary in one transaction. External network side effects are outside SQLite transactions and require explicit ambiguous-outcome handling.

The subscription adapter coordinates refresh through the shared credential store and profile lock. This path is the only refresh writer, including when auth CLI and daemon overlap. Use profile-level cross-process coordination and atomic replace, not merely an in-memory mutex. Per-bot environment resolution must not mutate process-wide environment and leak secrets between bots.

## Boundaries and reuse

Use AI SDK's tool/stream loop, bun:sqlite and grammY rather than duplicate frameworks. A small direct Telegram helper is permitted only for verified methods absent from the pinned grammY API. Tool execution stays trusted and in-process; an internal executor boundary enables later isolation without implementing it now. MCP child processes are explicitly configured servers, not a process per bot/provider architecture.

Compilation must retain the ability to import user tool files and their local dependencies from arbitrary bot roots. Prove this early with a compiled binary in a temporary non-empty project. An unsupported compiled dynamic import path is a foundation blocker, not a reason to replace the tool contract silently.

Linux uses a same-user Unix socket. Isolate platform path/control/service handling so core develops on macOS/Windows without requiring Linux systemd. Other-OS service support is not a V1 commitment. No public control server.

## Open technical decisions

Foundation must establish exact package versions, build/test scripts, schema generation and control framing through minimal compatibility probes. contracts.md defines the required seam decisions, including C09 for the user-approved safe steering default. The original PRD queue default is superseded by product/identity-history.md V044. Do not publish or depend on the example `vian.dev` schema URL without an established hosting/release contract; generate a local schema first.

Optional scope choices are authoritative in product/platform.md, Scope interpretation. Global concurrency, TTLs, retry limits and throttles need named, tested bounded values; safety-sensitive choices belong in the relevant product decision sections.
