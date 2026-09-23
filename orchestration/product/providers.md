# Providers requirements

Source: [Vian V1 PRD](../../Vian-V1-PRD.md). Section references below include all subordinate clauses. Each ID covers its full stated scope, not only the acceptance examples. Required behavior remains required when its external dependency is blocked.

## V026: Provider-neutral adapters

Source: PRD §§6, 9.10, 28–30.

Static adapters resolve AI SDK-compatible models, streaming/tools and configurable model IDs. Use official Gateway and Google integrations; no baked-in example model availability assumptions.

Acceptance: Same scripted runtime journey works with each adapter contract; live smoke separately proves configured Gateway and Gemini auth/model/tool/stream support. Provider-specific payloads never enter canonical schema.

## V027: Subscription OAuth

Source: PRD §§31, 70–71.

Support specifically ChatGPT/Codex subscription model OAuth, not generic identity login. Implement verified authorization-code/PKCE, supported loopback redirect, random validated state, expiry, token exchange and headless device/manual path only where supported. Keep subscription transport isolated.

Acceptance: Contract-test success, rejected/replayed state, redirect failure, expiry and terminal errors; live authorized account verifies model streaming/tools. Record actual supported client/endpoint/redirect contract before coding transport assumptions.

## V028: Credential ownership and rotation

Source: PRD §§11, 31.3–31.5, 32, 49.3, 68.10.

One global canonical credential profile with central refresh writer, atomic rotation and restrictive permissions. Never copy refresh tokens into bots or silently read external credential stores. Terminal OAuth errors require re-auth, no retry storm.

Acceptance: Two bots plus auth CLI concurrently refresh one profile without token loss; interrupt writes and recover; revoke credentials and prove bounded failure/re-auth state. Auth login/list/status/logout show safe metadata only.

## V029: Secret resolution and redaction

Source: PRD §§10, 32, 47–49, 52.

Resolve env relative to each bot and OAuth by global reference. Reject obvious inline tokens unless explicitly overridden. No secrets in list/inspect/logs/audit or prompts except deliberately exposed application-tool data.

Assumption: Google and Gateway API keys may use global, provider-specific `profile:google-default` and `profile:vercel-ai-gateway-default` references, created by hidden `vian auth set` prompts. New bots select these global profiles by default. Explicit bot-local `env:` references remain valid for existing setups. This keeps model/provider selection per bot while avoiding repeated account credentials; validate with profile and adapter tests.

Acceptance: Canary secrets from two bot roots never cross and cannot be found in captured CLI/log/history/provider error output; restrictive files remain restrictive after atomic replace. Metadata-only audit omits sensitive args/results.

## V030: Provider error and media compatibility

Source: PRD §§17.4, 25.5, 28–33, 47.

Normalize errors, cancellation, usage and model metadata across adapters; safe concise user failure; partial-stream failure is distinct from successful final output. Media support is adapter-dependent.

Acceptance: Fixtures cover tool streams, text deltas, missing usage, unsupported media, transient/terminal auth errors and abort; no hidden reasoning persists or displays; no side-effect replay follows provider retry.

## External dependency status

The user authorized implementation from the current public OpenClaw source. Its MIT-licensed [pinned revision](https://github.com/openclaw/openclaw/tree/0e79899fedc26ae9a90a196a8bc41b97fd39d7e5) supplies source-level evidence for a Codex public OAuth client, loopback callback and token flow, and a dedicated ChatGPT backend SSE transport pattern. The adapted source paths and license are recorded in [third-party notices](../../THIRD_PARTY_NOTICES.md). P implemented the Vian subscription OAuth and model adapter against that pattern; at integrated revision `183249d`, 97 combined offline tests, build and compiled CLI smoke passed. These are implementation/fixture results, not live compatibility evidence. Official OpenAI documentation alone does not document a reusable third-party client contract.

Blocked for live validation: Vian login, inference, refresh and multi-bot subscription behavior have not been verified against a live authorized account. Telegram test bot/users, Gemini and Gateway credentials, and a fresh Linux service environment also remain unavailable for their live checks. Supply access through a secret-safe execution environment when live checks are authorized; never place values in orchestration documents. V027 and the other live acceptance checks remain required release gates.

Example model IDs in the PRD are configurable examples, not verified availability promises. Headless OAuth uses a device/manual path only if supported by the established contract; report the actual supported path and any limitation.
