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

Acceptance: Canary secrets from two bot roots never cross and cannot be found in captured CLI/log/history/provider error output; restrictive files remain restrictive after atomic replace. Metadata-only audit omits sensitive args/results.

## V030: Provider error and media compatibility

Source: PRD §§17.4, 25.5, 28–33, 47.

Normalize errors, cancellation, usage and model metadata across adapters; safe concise user failure; partial-stream failure is distinct from successful final output. Media support is adapter-dependent.

Acceptance: Fixtures cover tool streams, text deltas, missing usage, unsupported media, transient/terminal auth errors and abort; no hidden reasoning persists or displays; no side-effect replay follows provider retry.

## External dependency status

Blocked: no verified Vian-compatible subscription OAuth client/redirect/token/model transport contract or live test account was supplied. The official [Codex plan documentation](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) was opened during planning; it establishes product context but was not treated as a complete third-party client contract. Implementation must retrieve supported OpenAI documentation and, where needed, revision-pinned reference implementation/license evidence from PRD §71. Do not assume another client's credentials, registration or redirect can be reused. Ask for a supported client arrangement if public evidence cannot establish one. V027 remains required and release-blocking; fakes and Google/Gateway work may continue.

Blocked for live validation only: Telegram test bot/users, Gemini and Gateway credentials, a subscription account and a fresh Linux service environment have not been provided or inspected. Supply them through a secret-safe execution environment when live checks are authorized; never request values in orchestration documents. No current task needs these credentials.

Example model IDs in the PRD are configurable examples, not verified availability promises. Headless OAuth uses a device/manual path only if supported by the established contract; report the actual supported path and any limitation.
