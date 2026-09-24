# Identity history requirements

Source: [Vian V1 PRD](../../Vian-V1-PRD.md). Section references below include all subordinate clauses. Each ID covers its full stated scope, not only the acceptance examples. Required behavior remains required when its external dependency is blocked.

## V010: Canonical identity and routing

Source: PRD §§3.5, 9, 18, 22–23, 43–44.

Bot UUID, principals, conversation and session IDs are transport-independent. Bind stable external identities explicitly. DMs resolve principal to conversation; groups/topics resolve chat/topic separately from sender. Replies retain session and map known canonical reply targets.

Acceptance: Use fake transport bindings to continue one conversation without rewriting history; reject raw Telegram IDs at canonical session lookup; topics separate and replies do not reset sessions. No future Gate implementation is required.

## V011: Access and pairing

Source: PRD §§21, 49.1, 49.6.

Default deny. Unknown private senders get a one-time short-lived pairing code, never model access or implicit principals. CLI lists pending/access, approves --as and revokes. Allowlisting uses numeric IDs, never usernames; groups require approved users/chats and mention/reply policy.

The owner can instead run `vian access verify <bot> [--as <principal>] [--minutes N]`. The CLI shows one random 12-character code and waits until its deadline (10 minutes by default; 1–30 allowed). The invited user sends that code as the entire text of a private Telegram message. Vian consumes it and binds that message's numeric sender to the selected canonical principal in one transaction; the CLI reports the sender and principal. Without `--as`, Vian generates a new opaque canonical principal UUID. Only one owner-issued code remains active per bot; issuing another expires the previous one. Codes are stored as SHA-256 digests, not logged or given to the model. Unknown messages while an owner code is pending receive no bot-issued pairing notice. Each sender has five attempts per ten minutes and each bot accepts at most 100 verification attempts per ten minutes. Verification messages themselves never enter the model inbox. The older requester-initiated pending/approve flow remains available when no owner code is pending.

Assumption: a 12-character uppercase hexadecimal code (48 random bits), a 10-minute default, 30-minute maximum, and per-sender/global attempt caps offer a simple manual entry flow with bounded guessing. Validate usability with real Telegram users before release.

Acceptance: Unauthorized input produces zero provider/tool calls; expiring/single-use approval survives restart; revocation blocks subsequent events/callbacks. Test wrong sender/chat, reused code and username impersonation.

## V012: Durable inbox and queues

Source: PRD §§24.1–24.4, 38.3, 68.5–68.6.

Persist inbound events with per-Gate idempotency keys before execution. One durable session lease; FIFO inbox order under both same-session policies. The user-approved V044 steering policy replaces the PRD queue default; queue remains configurable. Distinct sessions run concurrently under bounded global/per-bot limits, per-bot default 4 and per-session 1.

Acceptance: Five same-session messages retain order through restart; two principals overlap without cross-context; duplicate inbound update is accepted once; stale leases recover deterministically; capacity never exceeds configured bounds.

## V013: Interrupted tool safety

Source: PRD §§24.5, 68.7.

Track pending/started/succeeded/failed/interrupted tool states. A started call lacking completion after crash must never replay automatically. Give tools a run/call idempotency key and explain possible partial execution on next interaction.

Acceptance: Kill after started persistence and before result: restart marks interruption and executes no duplicate external mutation. Verify keys are available to native and MCP execution/audit context.

## V014: Audit source of truth

Source: PRD §§25, 43, 51–52.

Bot-local append-only meaningful event boundaries, no per-token persistence. Keep canonical content parts and Gate metadata separately. Record inbound/final messages, tool arguments/results or permitted redaction, state/timestamps/duration, run/session, provider/model/usage/finish/latency/correlation and delivery outcomes.

Acceptance: Golden transcripts check every boundary and correlation; restart preserves records; metadata-only mode removes content while retaining audit structure; credentials never persist. Summaries do not replace original events.

## V015: SQLite durability

Source: PRD §§25, 50, 54.

WAL, foreign keys, busy timeout, monotonic versioned migrations and transactional state/event updates. Support SQLite-safe backup while running; destructive migrations require pre-migration backup; one invalid bot cannot block others.

Acceptance: Inject transaction failure, concurrent writes and process death; verify referential integrity and no partial transition/event. Test old schema upgrade and backup restoration while preserving unrelated bots.

## V016: Summary-tail context

Source: PRD §§27.

Default summary-tail with maxRecentMessages 80, durable summaries separate from audit; audit summary creation; summary failure falls back to recent tail. No vector memory.

Acceptance: Long transcript triggers summary, preserves full source events and valid tool message relationships; failed summary still yields bounded useful context without another user/session leakage.

## V017: Model execution

Source: PRD §§28, 33, 47.

Use AI SDK model/tool loop with validated native/MCP/current-Gate tools, streaming, configured step/time bounds, cancellation, transactional audit, persisted final output before outbox, then lease release. Normalize provider/tool failures safely.

Acceptance: Fake scripted provider requests a tool then answers; test timeout, step limit, failure after partial stream, safe tool continuation and lease cleanup. No hidden reasoning or raw stack/credential reaches user.

## V018: Outbox and delivery order

Source: PRD §§34–35, 47, 68.8–68.9; user clarification 2026-09-22.

Persist final canonical content before sending. Durable ordered multipart outbox; one destination serializes messages/files while others overlap. Track retryable/terminal failures and platform penalty windows. Ambiguous sends are held as ambiguous for review/reconciliation, never automatically retried.

Acceptance: Restart cannot lose canonical output or resend confirmed successes. Inject 429, confirmed rejection, pre-send failure and post-send timeout separately; only confirmed failures retry. Ambiguous state survives restart and is visible to operator; later destination parts cannot silently overtake held content.

## V019: Session reset and group control

Source: PRD §§9.6, 45–46; user clarification 2026-09-22.

/new creates a session, retains conversation/principal/bindings/history and appends session_reset. Shared-group /stop requires active run initiator or designated bot administrator; /new requires active session initiator or designated bot administrator. Other approved users retain normal messaging access.

Acceptance: Test each authorized and unauthorized actor, including callbacks/native stop updates where sender is available. Re-check server-side role/initiator; unauthorized requests neither abort nor reset. Serialize reset with current run/queue and retain all prior history.

## Product decisions

The user clarified both rules on 2026-09-22 after the PRD was supplied. These rules resolve missing behavior, rather than weakening the source's duplicate-prevention requirement.

- Ambiguous delivery has durable state `ambiguous`. Hold for review/reconciliation, never automatic retry. Only confirmed failures can enter automatic retry. Status/doctor/history expose the held item and reason; do not invent an automatic reconciliation API. Any manual resend/reconciliation command needs an explicit product contract before adding it.
- Shared-group controls require the relevant initiator or a designated bot administrator. Persist the principal that created the active session and the principal that initiated each run. No Telegram group-admin status automatically grants Vian bot-admin authority. Administrator assignments must be explicit and locally owner-controlled.

Assumption: expose administrator principal IDs in validated bot access configuration, default empty. Local OS-owner control can explicitly assign them; pairing never grants administrator status. Foundation must encode this field and document it before consumers start.

The user subsequently approved this reset ordering on 2026-09-22: finish the active run and process ordinary messages accepted before /new, then reset before processing later messages. Persist /new as an ordered conversation barrier. Messages after that barrier cannot steer the old session. Preserve the barrier and ordering across restart; interrupted external work follows V013 rather than automatic replay.

## V044: Safe same-session steering

Source: user clarification on 2026-09-22, superseding PRD §§13,24.2,33 and §66's queue-default recommendation. The remaining serialization, durable inbox, audit and non-replay requirements remain in force.

Default `sameSessionPolicy` is `steer`; `queue` remains supported. Ordinary authorized follow-up messages enter the durable ordered inbox. During an active model run, incorporate them at the next safe model-step boundary after the current tool-call batch has settled and its results/audit are durably recorded. Do not cancel the model/tool work, run a second same-session model call concurrently, or replay completed tools. Preserve each message's canonical principal and audit identity even when several inputs contribute to one run.

If no usable tool boundary occurs before the final answer, pending messages start the next run in order. At the boundary, atomically claim a finite ordered batch so simultaneous arrivals have deterministic current-versus-next-step placement. Recheck access before exposing content to the model. Messages following a /new barrier belong to the new session and cannot be included in the old run. Existing maxSteps and runTimeoutSeconds bounds still apply and are not reset by steering; unconsumed input remains durable for the next run.

Acceptance: with a blocked tool, send follow-ups and verify the tool completes exactly once, then the next model step receives tool results plus authorized follow-ups in accepted order. Assert no cancellation, overlapping same-session runs or cross-session content. Verify both steer and queue settings, multiple tools in one batch, failed tool results, revoked senders, arrivals racing the boundary/final answer, process death before/after claim, run limits and active-run /new barriers. Every consumed message links to its run once; unconsumed messages survive restart. A crash after an external side effect follows V013 and does not replay it to rebuild a steered run.

Conflict resolved: the original PRD's queue default and example manifest are superseded by this explicit user instruction. The source file remains unchanged for provenance. Code/schema/generated init templates must default to steer; tests retain explicit queue coverage.
